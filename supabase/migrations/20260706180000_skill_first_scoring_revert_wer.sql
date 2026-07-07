-- Revert the "risk premium + Wallet Efficiency Rating (WER)" experiment and return
-- to the original skill-first scoring. Two problems with the reverted design:
--   1. Risk premium (1.5x base for rounds you PAID cash to enter) rewarded breaking
--      your streak / paying in - i.e. it paid off *bad* play. Removed.
--   2. WER (score / cents_spent / response_time) as the tie-breaker pulled in
--      response time and a derived "efficiency" number nobody asked for. Removed.
--
-- New rule (matches the "penny pincher" design): rank by highest points, then break
-- ties by the LEAST cash spent. Same trivia score -> the player who spent less to get
-- there wins. Pure skill on the scoreboard, frugality only as the tie-breaker.

-- 1. Drop the WER/response-time columns. total_cash_spent_cents stays: it's now the
--    tie-breaker itself (still accumulated in buy_round).
alter table public.player_game_stats
  drop column if exists weighted_efficiency_score,
  drop column if exists total_response_time_ms;

-- 2. Leaderboard index: highest score first, lowest cash spent breaks the tie.
create index if not exists idx_leaderboard_ranking
  on public.player_game_stats (game_id, total_score desc, total_cash_spent_cents asc);


-- 3. submit_answer: original scoring, no risk premium, no response-time tracking.
--    Correct  -> round*10 + time bonus (ms left on the clock).
--    Wrong    -> penalty of round*10 (no time component).
--    Running total is floored at 0 so it can never go negative.
create or replace function public.submit_answer(p_game_id uuid, p_round_number int, p_selected_option varchar)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_round record;
  v_time_taken_ms int;
  v_grace_ms constant int := 500;
  v_min_human_reaction_ms constant int := 300;
  v_high_value_round_threshold constant int := 80;
  v_high_value_reaction_ms constant int := 150;
  v_disqualify_after_flags constant int := 3;
  v_disqualify_after_high_value_flags constant int := 2;
  v_entry record;
  v_is_correct boolean;
  v_points int;
  v_new_total int;
  v_answer_id uuid;
  v_flag_count int;
  v_high_value_flag_count int;
  v_cheat_flagged boolean := false;
  v_flag_reason varchar;
  v_rejected_reason varchar;
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  select gr.round_number, gr.started_at, gr.ended_at, gr.is_overtime, q.correct_option, q.time_limit_seconds
  into v_round
  from public.game_rounds gr join public.questions q using (question_id)
  where gr.game_id = p_game_id and gr.round_number = p_round_number
  for update of gr;
  if not found then
    raise exception 'Round not found for this game';
  end if;
  if v_round.started_at is null then
    raise exception 'This round has not started yet';
  end if;

  v_time_taken_ms := extract(epoch from (clock_timestamp() - v_round.started_at)) * 1000;

  if v_round.ended_at is not null then
    v_rejected_reason := 'round_already_closed';
  elsif v_time_taken_ms > v_round.time_limit_seconds * 1000 + v_grace_ms then
    v_rejected_reason := 'past_cutoff';
  end if;

  if v_rejected_reason is not null then
    insert into public.websocket_logs (user_id, game_id, round_number, event_type, server_time_taken_ms, detail)
    values (v_user_id, p_game_id, p_round_number, 'answer_rejected', v_time_taken_ms,
            jsonb_build_object('reason', v_rejected_reason, 'timeLimitSeconds', v_round.time_limit_seconds));
    if v_rejected_reason = 'round_already_closed' then
      raise exception 'This round is not currently accepting answers';
    else
      raise exception 'Answer rejected: submitted after the round closed';
    end if;
  end if;

  if v_round.is_overtime then
    if not exists (select 1 from public.sudden_death_participants where game_id = p_game_id and user_id = v_user_id) then
      raise exception 'Not eligible for sudden death overtime';
    end if;
  end if;

  select current_round_reached into v_entry
  from public.player_game_stats where user_id = v_user_id and game_id = p_game_id for update;
  if not found or v_entry.current_round_reached < p_round_number then
    raise exception 'You must buy this round before answering (spectators cannot score)';
  end if;

  v_is_correct := p_selected_option = v_round.correct_option;
  -- Correct: base (round*10) + time bonus. Wrong: penalty of round*10 (no time
  -- component). The aggregate total is floored at 0 below so it never goes negative.
  v_points := case when v_is_correct
    then p_round_number * 10 + greatest((v_round.time_limit_seconds * 1000 - v_time_taken_ms)::int, 0)
    else -(p_round_number * 10)
  end;

  insert into public.player_answers
    (user_id, game_id, round_number, question_id, selected_option, is_correct, time_taken_ms, points_awarded)
  select v_user_id, p_game_id, p_round_number, gr.question_id, p_selected_option, v_is_correct, v_time_taken_ms::int, v_points
  from public.game_rounds gr where gr.game_id = p_game_id and gr.round_number = p_round_number
  on conflict (user_id, game_id, round_number) do nothing
  returning id into v_answer_id;
  if v_answer_id is null then
    raise exception 'You already answered this round';
  end if;

  update public.player_game_stats
  set total_score = greatest(total_score + v_points, 0)
  where user_id = v_user_id and game_id = p_game_id
  returning total_score into v_new_total;

  insert into public.websocket_logs (user_id, game_id, round_number, event_type, server_time_taken_ms, detail)
  values (v_user_id, p_game_id, p_round_number, 'answer_accepted', v_time_taken_ms,
          jsonb_build_object('isCorrect', v_is_correct, 'pointsAwarded', v_points, 'newTotalScore', v_new_total));

  if p_round_number >= v_high_value_round_threshold and v_time_taken_ms < v_high_value_reaction_ms then
    v_cheat_flagged := true;
    v_flag_reason := 'input_velocity_too_fast_high_value_round';
  elsif v_time_taken_ms < v_min_human_reaction_ms then
    v_cheat_flagged := true;
    v_flag_reason := 'input_velocity_too_fast';
  end if;

  if v_cheat_flagged then
    insert into public.cheat_flags (user_id, game_id, round_number, reason)
    values (v_user_id, p_game_id, p_round_number, v_flag_reason);

    select count(*) into v_flag_count from public.cheat_flags
    where user_id = v_user_id and game_id = p_game_id;
    select count(*) into v_high_value_flag_count from public.cheat_flags
    where user_id = v_user_id and game_id = p_game_id and reason = 'input_velocity_too_fast_high_value_round';

    if v_flag_count >= v_disqualify_after_flags or v_high_value_flag_count >= v_disqualify_after_high_value_flags then
      update public.player_game_stats set is_eligible_for_grand_prize = false
      where user_id = v_user_id and game_id = p_game_id;
    end if;
  end if;

  return jsonb_build_object(
    'roundNumber', p_round_number,
    'isCorrect', v_is_correct,
    'pointsAwarded', v_points,
    'newTotalScore', v_new_total,
    'timeTakenMs', v_time_taken_ms,
    'cheatFlag', v_cheat_flagged
  );
end;
$$;


-- 4. payout_game: rank by (total_score DESC, total_cash_spent_cents ASC). No WER.
--    Sudden Death Overtime now opens only on a true dead heat - identical score AND
--    identical cash spent - since cash spent already resolves most "ties".
create or replace function public.payout_game(p_game_id uuid)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_game record;
  v_winner record;
  v_place int := 0;
  v_distributed int := 0;
  v_share int;
  v_payouts jsonb := '[]'::jsonb;
  v_tied_ranks int[];
begin
  select * into v_game from public.games where game_id = p_game_id for update;
  if not found then
    raise exception 'Game not found';
  end if;
  if v_game.status = 'completed' then
    raise exception 'Game already paid out';
  end if;
  if v_game.current_round < v_game.total_rounds then
    raise exception 'Game has not reached its final round yet (%/%)', v_game.current_round, v_game.total_rounds;
  end if;

  -- Tie detection ranks by (score, then least cash spent). A cash-spent difference
  -- resolves what would otherwise look like a tie; only a true dead heat opens overtime.
  select array_agg(distinct rnk) into v_tied_ranks
  from (
    select user_id, rank() over (order by total_score desc, total_cash_spent_cents asc) as rnk
    from public.player_game_stats
    where game_id = p_game_id and is_eligible_for_grand_prize = true and is_eliminated = false
  ) ranked
  where rnk <= 3
  group by rnk
  having count(*) > 1;

  if v_tied_ranks is not null then
    delete from public.sudden_death_participants where game_id = p_game_id;
    insert into public.sudden_death_participants (game_id, user_id, contested_place_start, contested_place_end)
    select p_game_id, ranked.user_id, ranked.rnk, ranked.rnk
    from (
      select user_id, rank() over (order by total_score desc, total_cash_spent_cents asc) as rnk
      from public.player_game_stats
      where game_id = p_game_id and is_eligible_for_grand_prize = true and is_eliminated = false
    ) ranked
    where ranked.rnk = any(v_tied_ranks);
    update public.games set in_sudden_death = true where game_id = p_game_id;
    return jsonb_build_object(
      'status', 'sudden_death', 'gameId', p_game_id, 'tiedRanks', v_tied_ranks,
      'participants', (
        select coalesce(jsonb_agg(jsonb_build_object('userId', user_id, 'contestedPlace', contested_place_start)), '[]'::jsonb)
        from public.sudden_death_participants where game_id = p_game_id
      )
    );
  end if;

  for v_winner in
    select user_id, total_score from public.player_game_stats
    where game_id = p_game_id and is_eligible_for_grand_prize = true and is_eliminated = false
    order by total_score desc, total_cash_spent_cents asc limit 3
  loop
    v_place := v_place + 1;
    v_share := case
      when v_place = least((select count(*) from public.player_game_stats where game_id = p_game_id and is_eligible_for_grand_prize = true and is_eliminated = false), 3)
        then v_game.total_prize_pool_cents - v_distributed
      when v_place = 1 then round(v_game.total_prize_pool_cents * 0.5)
      when v_place = 2 then round(v_game.total_prize_pool_cents * 0.3)
      else round(v_game.total_prize_pool_cents * 0.2)
    end;
    v_distributed := v_distributed + v_share;

    update public.profiles
    set wallet_balance_cents = wallet_balance_cents + v_share,
        lifetime_winnings_cents = lifetime_winnings_cents + v_share
    where user_id = v_winner.user_id;

    insert into public.wallet_ledger (user_id, entry_type, amount_cents, game_id)
    values (v_winner.user_id, 'payout', v_share, p_game_id);

    v_payouts := v_payouts || jsonb_build_object(
      'userId', v_winner.user_id, 'place', v_place, 'amountCents', v_share, 'totalScore', v_winner.total_score
    );
  end loop;

  update public.games set status = 'completed', completed_at = now(), in_sudden_death = false where game_id = p_game_id;
  delete from public.sudden_death_participants where game_id = p_game_id;

  return jsonb_build_object(
    'status', 'completed', 'gameId', p_game_id,
    'totalPrizePoolCents', v_game.total_prize_pool_cents,
    'adminRevenuePoolCents', v_game.admin_revenue_pool_cents,
    'payouts', v_payouts
  );
end;
$$;


-- 5. Leaderboard read endpoint (Supabase-native equivalent of GET
--    /api/games/:gameId/leaderboard). Rank by highest score, lowest cash spent.
--    Cash is returned in cents to match the rest of the schema; clients format to $.
create or replace function public.get_game_leaderboard(p_game_id uuid, p_limit int default 100)
returns table (
  rank bigint,
  user_id uuid,
  username varchar,
  total_score int,
  total_cash_spent_cents int,
  is_eliminated boolean,
  is_eligible_for_grand_prize boolean
)
language sql
stable
security definer set search_path = public
as $$
  select
    rank() over (order by s.total_score desc, s.total_cash_spent_cents asc) as rank,
    s.user_id,
    p.username,
    s.total_score,
    s.total_cash_spent_cents,
    s.is_eliminated,
    s.is_eligible_for_grand_prize
  from public.player_game_stats s
  join public.profiles p on p.user_id = s.user_id
  where s.game_id = p_game_id
  order by s.total_score desc, s.total_cash_spent_cents asc
  limit least(p_limit, 500);
$$;
revoke execute on function public.get_game_leaderboard(uuid, int) from public, anon;
grant execute on function public.get_game_leaderboard(uuid, int) to authenticated;
