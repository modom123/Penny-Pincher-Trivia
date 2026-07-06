-- Fraud Sentinel enhancement: the general 300ms human-reaction floor applies
-- everywhere, but rounds 80+ ("Level 80+" per the anti-cheat design doc) are
-- worth far more and get a stricter 150ms bar plus a lower strike tolerance
-- (2 instead of 3) before disqualification - answering a high-difficulty,
-- high-value question that fast is a much stronger bot signal than doing it
-- on an early, low-value round.
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
  v_answer_id uuid;
  v_flag_count int;
  v_high_value_flag_count int;
  v_cheat_flagged boolean := false;
  v_flag_reason varchar;
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
    'timeTakenMs', v_time_taken_ms,
    'cheatFlag', v_cheat_flagged
  );
end;
$$;
