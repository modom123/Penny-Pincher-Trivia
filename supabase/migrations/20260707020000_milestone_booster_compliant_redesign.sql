-- Milestone Booster: compliant redesign.
--
-- The original milestone_booster design injected PLATFORM money into the prize
-- pool at rounds 25/50/75 (see game_bonus_injections' original comment). That was
-- pulled from production over a sweepstakes-classification concern: a
-- platform-funded bonus (value appearing from outside player entry fees) is a
-- different legal animal than a bonus funded purely by the field's own money.
--
-- This redesign keeps the "guaranteed boost at 25/50/75" feel but funds it
-- entirely from money already in the pool: at each milestone round, 5% of the
-- CURRENT total_prize_pool_cents (100% entry-fee-funded — buy_round only ever
-- adds the cash-derived prize_cut) is carved out and paid immediately, in real
-- cash, to whoever is leading at that moment (split evenly on a tie). The carve
-- reduces what's left for the final round-100 payout — nothing is invented, it's
-- a mid-game redistribution of the field's own money to reward strong early/mid
-- play. No outside capital ever enters the pool.
--
-- game_bonus_injections (previously "platform bonus was injected here") is
-- repurposed as the milestone-payout ledger. It was unused in production (0
-- rows), so this is a safe, non-breaking reuse. Its unique constraint moves from
-- (game_id, round_number) to (game_id, round_number, awarded_to_user_id) since a
-- tie can now produce more than one recipient per milestone round.

alter table public.game_bonus_injections
  add column if not exists awarded_to_user_id uuid references public.profiles(user_id);

alter table public.game_bonus_injections
  drop constraint if exists game_bonus_injections_game_id_round_number_key;
alter table public.game_bonus_injections
  add constraint game_bonus_injections_game_round_user_key
    unique (game_id, round_number, awarded_to_user_id);

comment on table public.game_bonus_injections is
  'Milestone Booster pool bonuses: a % of the (100% entry-fee-funded) prize pool '
  'carved out and paid to the round-25/50/75 leader(s). Not platform-funded — see '
  '20260707020000_milestone_booster_compliant_redesign.sql.';

-- ---------------------------------------------------------------------------
-- award_milestone_bonus: carve MILESTONE_BONUS_PCT of the current pool and pay
-- the current leader(s). Called by start_round for milestone_booster games at
-- rounds 25/50/75. Safe to call on a game/round where it doesn't apply — returns
-- {'applied': false, ...} rather than raising, so start_round can call it
-- unconditionally without extra branching.
-- ---------------------------------------------------------------------------
create or replace function public.award_milestone_bonus(p_game_id uuid, p_round_number int)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_bonus_pct constant numeric := 0.05; -- 5% of the current pool per milestone
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
  -- Idempotent: never double-pay the same milestone if start_round is retried.
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
    and current_round_reached >= p_round_number;

  if v_top_score is null then
    return jsonb_build_object('applied', false, 'reason', 'no_eligible_players');
  end if;

  select array_agg(user_id order by user_id) into v_recipients
  from public.player_game_stats
  where game_id = p_game_id
    and is_eligible_for_grand_prize = true
    and is_eliminated = false
    and current_round_reached >= p_round_number
    and total_score = v_top_score;

  v_recipient_count := array_length(v_recipients, 1);
  v_share := v_bonus / v_recipient_count; -- integer division
  v_remainder := v_bonus - (v_share * v_recipient_count); -- first recipient absorbs rounding

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

-- ---------------------------------------------------------------------------
-- start_round: call award_milestone_bonus for milestone_booster games at
-- rounds 25/50/75, and surface the result under 'milestoneBonus' in the round
-- payload so clients can show it. Reads totalPrizePoolCents AFTER the bonus
-- carve so the payload's pool figure is accurate. Otherwise identical to the
-- prior (drifted, non-milestone) production definition.
-- ---------------------------------------------------------------------------
create or replace function public.start_round(p_game_id uuid, p_round_number integer)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_round record;
  v_game record;
  v_pool int;
  v_milestone jsonb := jsonb_build_object('applied', false);
begin
  update public.games
  set current_round = p_round_number,
      status = 'active',
      started_at = coalesce(started_at, now())
  where game_id = p_game_id
  returning * into v_game;

  update public.game_rounds set started_at = now()
  where game_id = p_game_id and round_number = p_round_number;

  if v_game.mode = 'milestone_booster' and p_round_number in (25, 50, 75) then
    v_milestone := public.award_milestone_bonus(p_game_id, p_round_number);
  end if;

  select gr.round_number, gr.cost_cents, gr.started_at, gr.is_overtime,
         coalesce(gr.time_limit_override_seconds, q.time_limit_seconds) as time_limit_seconds,
         q.question_text, q.options
  into v_round
  from public.game_rounds gr join public.questions q using (question_id)
  where gr.game_id = p_game_id and gr.round_number = p_round_number;
  if not found then
    raise exception 'No question configured for round %', p_round_number;
  end if;

  select total_prize_pool_cents into v_pool from public.games where game_id = p_game_id;

  return jsonb_build_object(
    'roundNumber', v_round.round_number,
    'questionText', v_round.question_text,
    'options', v_round.options,
    'costCents', v_round.cost_cents,
    'timeLimitSeconds', v_round.time_limit_seconds,
    'isOvertime', v_round.is_overtime,
    'totalPrizePoolCents', v_pool,
    'milestoneBonus', v_milestone,
    'serverStartTimeMs', (extract(epoch from v_round.started_at) * 1000)::bigint
  );
end;
$$;

revoke execute on function public.start_round(uuid, integer) from public, anon, authenticated;
grant execute on function public.start_round(uuid, integer) to service_role;
