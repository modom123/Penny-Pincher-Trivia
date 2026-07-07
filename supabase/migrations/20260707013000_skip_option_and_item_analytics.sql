-- Skill-vs-chance hardening:
--   (1) A SKIP/PASS option so a player who blanks on a question isn't forced into a
--       coin-flip guess. A skip scores 0 with NO penalty (declining to answer is not
--       a wrong answer). This removes forced-chance from the game: you only ever
--       gamble on an answer you choose to commit to. Skips also break a streak
--       (only a correct answer earns the free next round) and are never cheat-flagged.
--   (2) Item analytics: per-question correct-rate and a discrimination score, so
--       mis-calibrated questions (that inject noise rather than measure skill) can be
--       found and re-tiered. Turns the contest into a *measured* skill test.

-- Pass a NULL / 'SKIP' / 'PASS' / '-' as p_selected_option to skip the round.
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
  v_is_skip boolean;
  v_is_correct boolean;
  v_stored_option varchar;
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

  -- Skip / pass: not an answer, so no penalty and no cheat-flagging.
  v_is_skip := p_selected_option is null or upper(btrim(p_selected_option)) in ('', 'SKIP', 'PASS', '-');
  v_is_correct := (not v_is_skip) and p_selected_option = v_round.correct_option;
  v_stored_option := case when v_is_skip then null else p_selected_option end;

  -- Skip: 0 (no penalty). Correct: base (round*10) + time bonus. Wrong: penalty of
  -- round*10 (no time component). Aggregate total is floored at 0 below.
  v_points := case
    when v_is_skip then 0
    when v_is_correct then p_round_number * 10 + greatest((v_round.time_limit_seconds * 1000 - v_time_taken_ms)::int, 0)
    else -(p_round_number * 10)
  end;

  insert into public.player_answers
    (user_id, game_id, round_number, question_id, selected_option, is_correct, time_taken_ms, points_awarded)
  select v_user_id, p_game_id, p_round_number, gr.question_id, v_stored_option, v_is_correct, v_time_taken_ms::int, v_points
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
          jsonb_build_object('isCorrect', v_is_correct, 'skipped', v_is_skip,
                             'pointsAwarded', v_points, 'newTotalScore', v_new_total));

  -- Cheat detection applies to real answers only (a skip can be instant and is fine).
  if not v_is_skip then
    if p_round_number >= v_high_value_round_threshold and v_time_taken_ms < v_high_value_reaction_ms then
      v_cheat_flagged := true;
      v_flag_reason := 'input_velocity_too_fast_high_value_round';
    elsif v_time_taken_ms < v_min_human_reaction_ms then
      v_cheat_flagged := true;
      v_flag_reason := 'input_velocity_too_fast';
    end if;
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
    'skipped', v_is_skip,
    'pointsAwarded', v_points,
    'newTotalScore', v_new_total,
    'timeTakenMs', v_time_taken_ms,
    'cheatFlag', v_cheat_flagged
  );
end;
$$;


-- Item analytics: for each question that has been played enough, how often players
-- answer it correctly (over real attempts, skips excluded) and how well it separates
-- strong from weak players. discrimination = avg game score of players who got it
-- right minus avg game score of players who got it wrong; a low/negative value means
-- the question isn't measuring skill (miscalibrated or ambiguous) and should be
-- reviewed or re-tiered. Staff-only.
create or replace function public.question_item_analytics(p_min_answered int default 20)
returns table (
  question_id uuid,
  question_text text,
  category varchar,
  grade_level int,
  times_answered bigint,
  correct_count bigint,
  correct_rate numeric,
  avg_score_correct numeric,
  avg_score_wrong numeric,
  discrimination numeric
)
language plpgsql
stable
security definer set search_path = public
as $$
begin
  if not public.is_staff(array['admin','content_editor']) then
    raise exception 'Forbidden: staff access required';
  end if;

  return query
  with ans as (
    select pa.question_id, pa.is_correct, pa.selected_option, s.total_score
    from public.player_answers pa
    join public.player_game_stats s on s.user_id = pa.user_id and s.game_id = pa.game_id
  )
  select
    q.question_id, q.question_text, q.category, q.grade_level,
    count(*) filter (where a.selected_option is not null)                         as times_answered,
    count(*) filter (where a.is_correct)                                          as correct_count,
    round(avg((a.is_correct)::int::numeric) filter (where a.selected_option is not null), 4) as correct_rate,
    round(avg(a.total_score) filter (where a.is_correct), 1)                      as avg_score_correct,
    round(avg(a.total_score) filter (where a.selected_option is not null and not a.is_correct), 1) as avg_score_wrong,
    round(
      coalesce(avg(a.total_score) filter (where a.is_correct), 0)
      - coalesce(avg(a.total_score) filter (where a.selected_option is not null and not a.is_correct), 0), 1
    )                                                                             as discrimination
  from public.questions q
  join ans a on a.question_id = q.question_id
  group by q.question_id, q.question_text, q.category, q.grade_level
  having count(*) filter (where a.selected_option is not null) >= p_min_answered
  order by discrimination asc nulls last, correct_rate desc;
end;
$$;
revoke execute on function public.question_item_analytics(int) from public, anon;
grant execute on function public.question_item_analytics(int) to authenticated;
