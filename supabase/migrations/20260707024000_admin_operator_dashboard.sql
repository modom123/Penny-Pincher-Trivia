-- Admin controls & operator dashboard: give staff the visibility and levers a
-- real launch day needs.
--
-- 1. Engine health. The #1 operational risk found during go-live prep: the
--    game-engine worker has no deploy target configured anywhere, and even once
--    deployed, staff had no way to see "is it actually running" short of
--    querying games.engine_lease_owner by hand. admin_engine_health() surfaces
--    that at a glance.
-- 2. Live standings. Staff could not see a game's leaderboard mid-flight -
--    only players see their own top-10 via the round:end broadcast.
-- 3. Config-backed scheduler. MIN_JOINABLE_GAMES/AUTO_SCHEDULE were worker env
--    vars, meaning changing them required a redeploy. Promote them to
--    platform_config (already used for the state allowlist) so ops can tune
--    game supply live during launch week; the worker prefers the config value
--    and falls back to its env var default if unset.

-- ---------------------------------------------------------------------------
-- 1. Engine health
-- ---------------------------------------------------------------------------
create or replace function public.admin_engine_health()
returns jsonb
language plpgsql
security definer set search_path = public
as $$
begin
  if not public.is_staff(array['admin','support']) then
    raise exception 'Forbidden: staff access required';
  end if;

  return jsonb_build_object(
    'pendingGames', (select count(*) from public.games where status = 'pending'),
    'activeGamesDriven', (
      select count(*) from public.games
      where status = 'active' and engine_lease_owner is not null and engine_lease_expires_at > now()
    ),
    'activeGamesStalled', (
      -- active but no live lease: either never claimed or a worker died and no
      -- one has reclaimed it yet. If this is ever > 0 for more than a poll
      -- interval, no healthy worker is running.
      select count(*) from public.games
      where status = 'active' and (engine_lease_owner is null or engine_lease_expires_at is null or engine_lease_expires_at <= now())
    ),
    'completedGames', (select count(*) from public.games where status = 'completed'),
    'leaseHolders', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'workerId', engine_lease_owner, 'gameCount', game_count, 'oldestLeaseExpiresAt', oldest_expiry
      )), '[]'::jsonb)
      from (
        select engine_lease_owner, count(*) as game_count, min(engine_lease_expires_at) as oldest_expiry
        from public.games
        where engine_lease_owner is not null and engine_lease_expires_at > now()
        group by engine_lease_owner
      ) t
    )
  );
end;
$$;
revoke execute on function public.admin_engine_health() from public, anon;
grant execute on function public.admin_engine_health() to authenticated;


-- ---------------------------------------------------------------------------
-- 2. Live per-game standings for staff (players only ever see their own
-- top-10 via the round:end broadcast; this is the full field).
-- ---------------------------------------------------------------------------
create or replace function public.admin_game_leaderboard(p_game_id uuid)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
begin
  if not public.is_staff(array['admin','support']) then
    raise exception 'Forbidden: staff access required';
  end if;

  return coalesce((
    select jsonb_agg(row_to_json(t) order by (row_to_json(t)->>'rank')::int)
    from (
      select
        rank() over (order by pgs.total_score desc, pgs.total_cash_spent_cents asc) as rank,
        pgs.user_id, pr.username, pgs.total_score, pgs.current_round_reached,
        pgs.is_eligible_for_grand_prize, pgs.is_eliminated, pgs.total_cash_spent_cents
      from public.player_game_stats pgs
      join public.profiles pr on pr.user_id = pgs.user_id
      where pgs.game_id = p_game_id
    ) t
  ), '[]'::jsonb);
end;
$$;
revoke execute on function public.admin_game_leaderboard(uuid) from public, anon;
grant execute on function public.admin_game_leaderboard(uuid) to authenticated;


-- ---------------------------------------------------------------------------
-- 3. Config-backed scheduler
-- ---------------------------------------------------------------------------
insert into public.platform_config (key, value) values
  ('min_joinable_games', '3'::jsonb),
  ('auto_schedule_enabled', 'true'::jsonb)
on conflict (key) do nothing;

create or replace function public.admin_get_scheduler_config()
returns jsonb
language plpgsql
security definer set search_path = public
as $$
begin
  if not public.is_staff(array['admin','support']) then
    raise exception 'Forbidden: staff access required';
  end if;
  return jsonb_build_object(
    'minJoinableGames', coalesce((select value from public.platform_config where key = 'min_joinable_games'), '3'::jsonb),
    'autoScheduleEnabled', coalesce((select value from public.platform_config where key = 'auto_schedule_enabled'), 'true'::jsonb)
  );
end;
$$;
revoke execute on function public.admin_get_scheduler_config() from public, anon;
grant execute on function public.admin_get_scheduler_config() to authenticated;

create or replace function public.admin_set_scheduler_config(p_min_joinable_games int, p_auto_schedule_enabled boolean)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
begin
  if not public.is_staff(array['admin','support']) then
    raise exception 'Forbidden: staff access required';
  end if;
  if p_min_joinable_games is null or p_min_joinable_games <= 0 or p_min_joinable_games > 50 then
    raise exception 'min_joinable_games must be between 1 and 50';
  end if;

  insert into public.platform_config (key, value) values ('min_joinable_games', to_jsonb(p_min_joinable_games))
    on conflict (key) do update set value = excluded.value, updated_at = now();
  insert into public.platform_config (key, value) values ('auto_schedule_enabled', to_jsonb(p_auto_schedule_enabled))
    on conflict (key) do update set value = excluded.value, updated_at = now();

  perform public.log_admin_action('set_scheduler_config', null, null,
    jsonb_build_object('minJoinableGames', p_min_joinable_games, 'autoScheduleEnabled', p_auto_schedule_enabled));

  return public.admin_get_scheduler_config();
end;
$$;
revoke execute on function public.admin_set_scheduler_config(int, boolean) from public, anon;
grant execute on function public.admin_set_scheduler_config(int, boolean) to authenticated;

-- Service-role read used by the game-engine worker each poll tick: config
-- value if present, else the caller's own env-var default.
create or replace function public.engine_scheduler_config(p_default_min_joinable int default 3, p_default_auto_schedule boolean default true)
returns jsonb
language sql
security definer set search_path = public
as $$
  select jsonb_build_object(
    'minJoinableGames', coalesce((select (value#>>'{}')::int from public.platform_config where key = 'min_joinable_games'), p_default_min_joinable),
    'autoScheduleEnabled', coalesce((select (value#>>'{}')::boolean from public.platform_config where key = 'auto_schedule_enabled'), p_default_auto_schedule)
  );
$$;
revoke execute on function public.engine_scheduler_config(int, boolean) from public, anon, authenticated;
grant execute on function public.engine_scheduler_config(int, boolean) to service_role;
