-- Option B: keep the milestone_booster mode and its flat per-tier pricing, but
-- REMOVE the platform-funded prize-pool bonus injections at rounds 25/50/75.
--
-- Why: the tiered pricing is just an alternative skill-contest pricing curve
-- (legally the same posture as original_escalator). It was the *house-funded*
-- $5 bonus added on top of entry fees that risked reclassifying the contest as a
-- sweepstakes/promotion (a heavier regulatory category) -- flagged in
-- legal/03-official-rules-DRAFT.md. Stripping the injection keeps the prize pool
-- funded solely by player entry fees (60/40), so every mode holds the same
-- "pool = redistributed entry fees" story.
--
-- Redefines start_round to drop the injection block; otherwise identical to the
-- prior definition (20260707010400). create_game's tiered pricing is unchanged.
-- The game_bonus_injections table is intentionally KEPT so historical rows and
-- the Financials reconciliation (debits + bonuses == pool + cut) still balance;
-- no new rows will be written.

create or replace function public.start_round(p_game_id uuid, p_round_number int)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_round record;
  v_game record;
  v_pool int;
begin
  update public.games
  set current_round = p_round_number,
      status = 'active',
      started_at = coalesce(started_at, now())
  where game_id = p_game_id
  returning * into v_game;

  update public.game_rounds set started_at = now()
  where game_id = p_game_id and round_number = p_round_number;

  -- (Milestone platform-funded bonus injection removed -- see migration header.)

  select gr.round_number, gr.cost_cents, gr.started_at, gr.is_overtime,
         coalesce(gr.time_limit_override_seconds, q.time_limit_seconds) as time_limit_seconds,
         q.question_text, q.options
  into v_round
  from public.game_rounds gr join public.questions q using (question_id)
  where gr.game_id = p_game_id and gr.round_number = p_round_number;
  if not found then
    raise exception 'No question configured for round %', p_round_number;
  end if;

  -- Prize pool is now funded solely by entry fees (60/40 split in buy_round).
  select total_prize_pool_cents into v_pool from public.games where game_id = p_game_id;

  return jsonb_build_object(
    'roundNumber', v_round.round_number,
    'questionText', v_round.question_text,
    'options', v_round.options,
    'costCents', v_round.cost_cents,
    'timeLimitSeconds', v_round.time_limit_seconds,
    'isOvertime', v_round.is_overtime,
    'totalPrizePoolCents', v_pool,
    'serverStartTimeMs', (extract(epoch from v_round.started_at) * 1000)::bigint
  );
end;
$$;

revoke execute on function public.start_round(uuid, int) from public, anon, authenticated;
grant execute on function public.start_round(uuid, int) to service_role;
