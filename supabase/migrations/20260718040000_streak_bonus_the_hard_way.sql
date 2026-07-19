-- "3 the hard way": once a player has answered 3 CONSECUTIVE rounds correctly,
-- every correct answer while that streak holds refunds the round's cost back
-- to them as bonus/promo tokens (non-withdrawable, spent first on future
-- rounds in buy_round - same as any other bonus balance). The first two
-- correct answers in a fresh streak refund nothing; a single wrong answer
-- resets it to zero. This only ever adds bonus tokens - it never touches
-- cash, so real-money payouts stay exactly what deposits fund (see
-- reserve_withdrawal, buy_round's 60/40 cash split - both untouched).
--
-- Why bonus tokens and not score: this is deliberately independent of the
-- existing score formula (round*10 + speed bonus / -round*10 penalty, see
-- 20260706180000_skill_first_scoring_revert_wer.sql) and of that formula's
-- history - the previously-reverted "Wallet Efficiency Rating" tried to
-- normalize score by cash spent and ended up rewarding low-volume bad play.
-- This doesn't touch score or rank at all; it only changes how far a skilled
-- player's money takes them, which is the actual goal (a $10 player who
-- plays well should be able to reach round 100, not hit a hard wall at
-- round 44 regardless of skill).
--
-- Note for Streak Saver mode: that mode already waives round cost entirely on
-- a 1-correct-answer streak, so once a player is inside a Streak Saver streak,
-- this 3-in-a-row bonus can "refund" a round that already cost 0 - i.e. it
-- mints bonus tokens from a round they didn't pay for. Left uniform across
-- all three modes for now since that's what was tested; revisit if that
-- stacking turns out to be too generous in practice.
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
  v_streak_len int := 0;
  v_streak_bonus_cents int := 0;
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  select gr.round_number, gr.started_at, gr.ended_at, gr.is_overtime, gr.cost_cents, q.correct_option, q.time_limit_seconds
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

  -- "3 the hard way": count this round plus the two immediately before it. If
  -- all three were answered correctly, the streak has just reached (or is
  -- still holding at) 3+, so refund this round's cost as bonus tokens.
  if v_is_correct then
    select count(*) into v_streak_len
    from public.player_answers
    where user_id = v_user_id and game_id = p_game_id
      and round_number in (p_round_number, p_round_number - 1, p_round_number - 2)
      and is_correct = true;

    if v_streak_len = 3 and v_round.cost_cents > 0 then
      v_streak_bonus_cents := v_round.cost_cents;
      update public.profiles
      set wallet_balance_cents = wallet_balance_cents + v_streak_bonus_cents,
          promo_balance_cents = promo_balance_cents + v_streak_bonus_cents
      where user_id = v_user_id;

      insert into public.wallet_ledger (user_id, entry_type, amount_cents, game_id, round_number)
      values (v_user_id, 'streak_bonus', v_streak_bonus_cents, p_game_id, p_round_number);
    end if;
  end if;

  insert into public.websocket_logs (user_id, game_id, round_number, event_type, server_time_taken_ms, detail)
  values (v_user_id, p_game_id, p_round_number, 'answer_accepted', v_time_taken_ms,
          jsonb_build_object('isCorrect', v_is_correct, 'pointsAwarded', v_points, 'newTotalScore', v_new_total,
                              'streakBonusCents', v_streak_bonus_cents));

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
    'cheatFlag', v_cheat_flagged,
    'streakBonusCents', v_streak_bonus_cents
  );
end;
$$;
