-- Replaces create_game()/admin_create_game() to accept a mode and price rounds
-- accordingly, and updates buy_round/start_round/submit_answer/payout_game for
-- streak-saver waivers, milestone bonus injections, and Sudden Death Overtime.

drop function if exists public.create_game();
drop function if exists public.admin_create_game();

-- original_escalator: round N costs N cents (unchanged).
-- streak_saver: same "sticker price" per round as escalator, but buy_round below
--   waives it when the player's previous round was a correct answer.
-- milestone_booster: flat per-tier pricing regardless of exact round number.
create function public.create_game(p_mode public.game_mode default 'original_escalator')
returns public.games
language plpgsql
security definer set search_path = public
as $$
declare
  v_game public.games;
  v_missing int[];
begin
  insert into public.games (status, current_round, total_rounds, mode) values ('pending', 0, 100, p_mode) returning * into v_game;

  select array_agg(r) into v_missing
  from generate_series(1, 100) r
  where not exists (select 1 from public.questions q where q.difficulty_level = r);
  if v_missing is not null then
    raise exception 'No question bank entries for rounds: %', v_missing;
  end if;

  insert into public.game_rounds (game_id, round_number, question_id, cost_cents)
  select
    v_game.game_id,
    q.difficulty_level,
    q.question_id,
    case p_mode
      when 'milestone_booster' then
        case
          when q.difficulty_level <= 25 then 10   -- Bronze
          when q.difficulty_level <= 50 then 25   -- Silver
          when q.difficulty_level <= 75 then 50   -- Gold
          else 100                                -- Platinum
        end
      else q.difficulty_level -- original_escalator and streak_saver both use round-N-cents as the sticker price
    end
  from (
    select distinct on (difficulty_level) difficulty_level, question_id
    from public.questions
    where difficulty_level between 1 and 100
    order by difficulty_level, random()
  ) q;

  return v_game;
end;
$$;

revoke execute on function public.create_game(public.game_mode) from public, anon, authenticated;
grant execute on function public.create_game(public.game_mode) to service_role;


create function public.admin_create_game(p_mode public.game_mode default 'original_escalator')
returns public.games
language plpgsql
security definer set search_path = public
as $$
declare
  v_game public.games;
begin
  if not public.is_staff(array['admin','support']) then
    raise exception 'Forbidden: staff access required';
  end if;
  v_game := public.create_game(p_mode);
  perform public.log_admin_action('create_game', null, v_game.game_id, jsonb_build_object('mode', p_mode));
  return v_game;
end;
$$;
revoke execute on function public.admin_create_game(public.game_mode) from public, anon;
grant execute on function public.admin_create_game(public.game_mode) to authenticated;


create or replace function public.start_round(p_game_id uuid, p_round_number int)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_round record;
  v_game record;
  v_bonus_cents constant int := 500; -- $5 platform-funded booster; [OPS: tune], [COUNSEL: confirm legality before enabling milestone_booster]
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
    insert into public.game_bonus_injections (game_id, round_number, amount_cents)
    values (p_game_id, p_round_number, v_bonus_cents)
    on conflict (game_id, round_number) do nothing;

    if found then
      update public.games set total_prize_pool_cents = total_prize_pool_cents + v_bonus_cents
      where game_id = p_game_id;
    end if;
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

  return jsonb_build_object(
    'roundNumber', v_round.round_number,
    'questionText', v_round.question_text,
    'options', v_round.options,
    'costCents', v_round.cost_cents,
    'timeLimitSeconds', v_round.time_limit_seconds,
    'isOvertime', v_round.is_overtime,
    'serverStartTimeMs', (extract(epoch from v_round.started_at) * 1000)::bigint
  );
end;
$$;


create or replace function public.buy_round(p_game_id uuid, p_round_number int)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_round_cost int;
  v_admin_cut int;
  v_prize_cut int;
  v_profile record;
  v_round record;
  v_game record;
  v_streak_free boolean := false;
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  select wallet_balance_cents, is_suspended into v_profile
  from public.profiles where user_id = v_user_id for update;
  if not found then
    raise exception 'Profile not found';
  end if;
  if v_profile.is_suspended then
    raise exception 'Account suspended';
  end if;

  select * into v_round from public.game_rounds
  where game_id = p_game_id and round_number = p_round_number for update;
  if not found then
    raise exception 'Round not found for this game';
  end if;

  select * into v_game from public.games
  where game_id = p_game_id and status = 'active' for update;
  if not found then
    raise exception 'Game is not active';
  end if;
  if v_game.current_round <> p_round_number then
    raise exception 'Round % is not the currently open round (current round is %)', p_round_number, v_game.current_round;
  end if;

  if v_round.is_overtime then
    if not exists (select 1 from public.sudden_death_participants where game_id = p_game_id and user_id = v_user_id) then
      raise exception 'Not eligible for sudden death overtime';
    end if;
  end if;

  if v_game.mode = 'streak_saver' and p_round_number > 1 and not v_round.is_overtime then
    select exists (
      select 1 from public.player_answers
      where user_id = v_user_id and game_id = p_game_id and round_number = p_round_number - 1 and is_correct = true
    ) into v_streak_free;
  end if;

  v_round_cost := case when v_streak_free then 0 else v_round.cost_cents end;

  if v_round_cost > 0 and v_profile.wallet_balance_cents < v_round_cost then
    raise exception 'Insufficient tokens in wallet for this round';
  end if;

  v_admin_cut := round(v_round_cost * 0.40);
  v_prize_cut := v_round_cost - v_admin_cut;

  if v_round_cost > 0 then
    update public.profiles set wallet_balance_cents = wallet_balance_cents - v_round_cost
    where user_id = v_user_id;
  end if;

  update public.games
  set total_prize_pool_cents = total_prize_pool_cents + v_prize_cut,
      admin_revenue_pool_cents = admin_revenue_pool_cents + v_admin_cut
  where game_id = p_game_id
  returning * into v_game;

  insert into public.wallet_ledger (user_id, entry_type, amount_cents, game_id, round_number)
  values (v_user_id, 'round_debit', -v_round_cost, p_game_id, p_round_number);

  insert into public.player_game_stats (user_id, game_id, current_round_reached)
  values (v_user_id, p_game_id, p_round_number)
  on conflict (user_id, game_id) do update set current_round_reached = excluded.current_round_reached;

  return jsonb_build_object(
    'success', true,
    'deductedCents', v_round_cost,
    'streakFree', v_streak_free,
    'gamePoolState', jsonb_build_object(
      'gameId', v_game.game_id,
      'currentRound', v_game.current_round,
      'totalPrizePoolCents', v_game.total_prize_pool_cents
    )
  );
end;
$$;


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
  v_disqualify_after_flags constant int := 3;
  v_entry record;
  v_is_correct boolean;
  v_points int;
  v_answer_id uuid;
  v_flag_count int;
  v_cheat_flagged boolean := false;
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
  if v_round.ended_at is not null then
    raise exception 'This round is not currently accepting answers';
  end if;

  if v_round.is_overtime then
    if not exists (select 1 from public.sudden_death_participants where game_id = p_game_id and user_id = v_user_id) then
      raise exception 'Not eligible for sudden death overtime';
    end if;
  end if;

  -- Server clock is the only source of truth for timing - the client's
  -- reported timestamp is never trusted for scoring or cutoff.
  v_time_taken_ms := extract(epoch from (clock_timestamp() - v_round.started_at)) * 1000;
  if v_time_taken_ms > v_round.time_limit_seconds * 1000 + v_grace_ms then
    raise exception 'Answer rejected: submitted after the round closed';
  end if;

  select current_round_reached into v_entry
  from public.player_game_stats where user_id = v_user_id and game_id = p_game_id for update;
  if not found or v_entry.current_round_reached < p_round_number then
    raise exception 'You must buy this round before answering (spectators cannot score)';
  end if;

  v_is_correct := p_selected_option = v_round.correct_option;
  v_points := case when v_is_correct
    then p_round_number * 10 + greatest((v_round.time_limit_seconds * 1000 - v_time_taken_ms)::int, 0)
    else 0
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

  update public.player_game_stats set total_score = total_score + v_points
  where user_id = v_user_id and game_id = p_game_id;

  if v_time_taken_ms < v_min_human_reaction_ms then
    v_cheat_flagged := true;
    insert into public.cheat_flags (user_id, game_id, round_number, reason)
    values (v_user_id, p_game_id, p_round_number, 'input_velocity_too_fast');

    select count(*) into v_flag_count from public.cheat_flags
    where user_id = v_user_id and game_id = p_game_id;

    if v_flag_count >= v_disqualify_after_flags then
      update public.player_game_stats set is_eligible_for_grand_prize = false
      where user_id = v_user_id and game_id = p_game_id;
    end if;
  end if;

  return jsonb_build_object(
    'roundNumber', p_round_number,
    'isCorrect', v_is_correct,
    'pointsAwarded', v_points,
    'timeTakenMs', v_time_taken_ms,
    'cheatFlag', v_cheat_flagged
  );
end;
$$;


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

  -- Detect ties at any of the top-3 places using rank() (ties share a rank and
  -- skip the next one, e.g. scores 100/90/90/80 -> ranks 1/2/2/4). Any rank
  -- <=3 held by more than one player is an unresolved tie for that placement.
  select array_agg(distinct rnk) into v_tied_ranks
  from (
    select user_id, rank() over (order by total_score desc) as rnk
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
      select user_id, rank() over (order by total_score desc) as rnk
      from public.player_game_stats
      where game_id = p_game_id and is_eligible_for_grand_prize = true and is_eliminated = false
    ) ranked
    where ranked.rnk = any(v_tied_ranks);

    update public.games set in_sudden_death = true where game_id = p_game_id;

    return jsonb_build_object(
      'status', 'sudden_death',
      'gameId', p_game_id,
      'tiedRanks', v_tied_ranks,
      'participants', (
        select coalesce(jsonb_agg(jsonb_build_object('userId', user_id, 'contestedPlace', contested_place_start)), '[]'::jsonb)
        from public.sudden_death_participants where game_id = p_game_id
      )
    );
  end if;

  -- No tie (or tie just resolved by an overtime round) - pay out normally.
  for v_winner in
    select user_id, total_score from public.player_game_stats
    where game_id = p_game_id and is_eligible_for_grand_prize = true and is_eliminated = false
    order by total_score desc limit 3
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

    update public.profiles set wallet_balance_cents = wallet_balance_cents + v_share
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
    'status', 'completed',
    'gameId', p_game_id,
    'totalPrizePoolCents', v_game.total_prize_pool_cents,
    'adminRevenuePoolCents', v_game.admin_revenue_pool_cents,
    'payouts', v_payouts
  );
end;
$$;


-- Creates the next overtime round (round_number > total_rounds), restricted to
-- sudden_death_participants, at a flat premium fee with a shrinking timer.
create function public.start_sudden_death_round(p_game_id uuid)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_game record;
  v_next_round int;
  v_overtime_index int;
  v_time_limit int;
  v_question_id uuid;
  v_cost_cents constant int := 100; -- flat $1 premium entry fee per the design doc
begin
  select * into v_game from public.games where game_id = p_game_id for update;
  if not found then
    raise exception 'Game not found';
  end if;
  if not v_game.in_sudden_death then
    raise exception 'Game % is not in sudden death overtime', p_game_id;
  end if;

  select coalesce(max(round_number), v_game.total_rounds) + 1 into v_next_round
  from public.game_rounds where game_id = p_game_id;
  v_overtime_index := v_next_round - v_game.total_rounds;
  v_time_limit := greatest(11 - v_overtime_index, 3); -- shrinking timer: 10s, 9s, ... floor 3s

  select question_id into v_question_id
  from public.questions
  where question_id not in (select question_id from public.game_rounds where game_id = p_game_id)
  order by random() limit 1;
  if v_question_id is null then
    -- Question bank exhausted (every question already used in this game) - reuse one at random.
    select question_id into v_question_id from public.questions order by random() limit 1;
  end if;

  insert into public.game_rounds (game_id, round_number, question_id, cost_cents, is_overtime, time_limit_override_seconds)
  values (p_game_id, v_next_round, v_question_id, v_cost_cents, true, v_time_limit);

  return public.start_round(p_game_id, v_next_round);
end;
$$;

revoke execute on function public.start_sudden_death_round(uuid) from public, anon, authenticated;
grant execute on function public.start_sudden_death_round(uuid) to service_role;
