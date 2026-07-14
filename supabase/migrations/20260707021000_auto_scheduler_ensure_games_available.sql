-- Auto-scheduler: keep the lobby stocked with joinable games across all 3 modes.
--
-- Previously nothing ever created a game automatically — the `games` table was
-- empty in production and stayed that way until a human clicked "Create new
-- game" in the command-center. ensure_games_available() closes that gap: it
-- tops up the number of joinable (pending/active) games to a minimum, rotating
-- through original_escalator / streak_saver / milestone_booster so the website's
-- "three ways to play" is always actually playable.
--
-- Concurrency: multiple game-engine worker instances may poll simultaneously.
-- pg_advisory_xact_lock serializes the count-then-create so two workers can't
-- both see "below minimum" and over-create in the same instant. The lock is
-- released automatically at the end of this (implicit, single-statement-call)
-- transaction.
create or replace function public.ensure_games_available(p_min_joinable int default 3)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_joinable int;
  v_needed int;
  v_total_games int;
  v_modes public.game_mode[] := array['original_escalator','streak_saver','milestone_booster']::public.game_mode[];
  v_mode public.game_mode;
  v_created jsonb := '[]'::jsonb;
  v_game public.games;
  v_i int;
begin
  -- Serialize concurrent callers so the count-then-create below is race-free
  -- across multiple game-engine instances.
  perform pg_advisory_xact_lock(hashtext('ensure_games_available'));

  if p_min_joinable is null or p_min_joinable <= 0 then
    raise exception 'p_min_joinable must be positive';
  end if;

  select count(*) into v_joinable from public.games where status in ('pending', 'active');
  v_needed := p_min_joinable - v_joinable;
  if v_needed <= 0 then
    return jsonb_build_object('created', v_created, 'joinableBefore', v_joinable, 'joinableAfter', v_joinable);
  end if;

  select count(*) into v_total_games from public.games;

  for v_i in 1..v_needed loop
    -- Deterministic round-robin across modes so the field of games stays varied
    -- rather than piling up on whichever mode happened to run out first.
    v_mode := v_modes[((v_total_games + v_i - 1) % array_length(v_modes, 1)) + 1];
    v_game := public.create_game(v_mode);
    v_created := v_created || jsonb_build_object('gameId', v_game.game_id, 'mode', v_mode);
  end loop;

  return jsonb_build_object(
    'created', v_created,
    'joinableBefore', v_joinable,
    'joinableAfter', v_joinable + v_needed
  );
end;
$$;

revoke execute on function public.ensure_games_available(int) from public, anon, authenticated;
grant execute on function public.ensure_games_available(int) to service_role;
