-- Fix an off-by-one in award_milestone_bonus's eligibility check.
--
-- current_round_reached is only set by buy_round, which happens AFTER
-- start_round broadcasts round:start to clients (engine flow: start_round ->
-- broadcast -> clients buy_round -> submit_answer -> end_round). So at the exact
-- moment start_round(50) runs (where the milestone bonus is triggered), no
-- player has current_round_reached >= 50 yet — everyone is still sitting at 49.
-- The original filter (`>= p_round_number`) would therefore find zero eligible
-- players in every real game and silently pay out nothing. Caught in end-to-end
-- verification before any real game ran it (production had 0 games at the time).
--
-- Fix: eligibility is "reached at least the previous round" (still actively
-- playing into this milestone round), i.e. `>= p_round_number - 1`.
create or replace function public.award_milestone_bonus(p_game_id uuid, p_round_number int)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_bonus_pct constant numeric := 0.05;
  v_game record;
  v_pool int;
  v_bonus int;
  v_top_score int;
  v_recipients uuid[];
  v_recipient_count int;
  v_share int;
  v_remainder int;
  v_i int;
  v_uid uuid;
  v_result_recipients jsonb := '[]'::jsonb;
begin
  select * into v_game from public.games where game_id = p_game_id for update;
  if not found or v_game.mode <> 'milestone_booster' then
    return jsonb_build_object('applied', false, 'reason', 'not_milestone_booster');
  end if;
  if p_round_number not in (25, 50, 75) then
    return jsonb_build_object('applied', false, 'reason', 'not_a_milestone_round');
  end if;
  if exists (select 1 from public.game_bonus_injections where game_id = p_game_id and round_number = p_round_number) then
    return jsonb_build_object('applied', false, 'reason', 'already_awarded');
  end if;

  v_pool := v_game.total_prize_pool_cents;
  v_bonus := floor(v_pool * v_bonus_pct)::int;
  if v_bonus <= 0 then
    return jsonb_build_object('applied', false, 'reason', 'pool_too_small');
  end if;

  select max(total_score) into v_top_score
  from public.player_game_stats
  where game_id = p_game_id
    and is_eligible_for_grand_prize = true
    and is_eliminated = false
    and current_round_reached >= p_round_number - 1;

  if v_top_score is null then
    return jsonb_build_object('applied', false, 'reason', 'no_eligible_players');
  end if;

  select array_agg(user_id order by user_id) into v_recipients
  from public.player_game_stats
  where game_id = p_game_id
    and is_eligible_for_grand_prize = true
    and is_eliminated = false
    and current_round_reached >= p_round_number - 1
    and total_score = v_top_score;

  v_recipient_count := array_length(v_recipients, 1);
  v_share := v_bonus / v_recipient_count;
  v_remainder := v_bonus - (v_share * v_recipient_count);

  update public.games set total_prize_pool_cents = total_prize_pool_cents - v_bonus
  where game_id = p_game_id;

  for v_i in 1..v_recipient_count loop
    v_uid := v_recipients[v_i];
    declare
      v_paid int := v_share + (case when v_i = 1 then v_remainder else 0 end);
      v_username text;
    begin
      update public.profiles
      set wallet_balance_cents = wallet_balance_cents + v_paid,
          lifetime_winnings_cents = lifetime_winnings_cents + v_paid
      where user_id = v_uid
      returning username into v_username;

      insert into public.wallet_ledger (user_id, entry_type, amount_cents, game_id, round_number)
      values (v_uid, 'milestone_bonus', v_paid, p_game_id, p_round_number);

      insert into public.game_bonus_injections (game_id, round_number, amount_cents, awarded_to_user_id)
      values (p_game_id, p_round_number, v_paid, v_uid);

      v_result_recipients := v_result_recipients || jsonb_build_object(
        'userId', v_uid, 'username', v_username, 'amountCents', v_paid
      );
    end;
  end loop;

  return jsonb_build_object(
    'applied', true,
    'roundNumber', p_round_number,
    'totalBonusCents', v_bonus,
    'remainingPoolCents', v_pool - v_bonus,
    'recipients', v_result_recipients
  );
end;
$$;

revoke execute on function public.award_milestone_bonus(uuid, int) from public, anon, authenticated;
grant execute on function public.award_milestone_bonus(uuid, int) to service_role;
