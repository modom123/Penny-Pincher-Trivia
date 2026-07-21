-- The Lobby card showed prize pool, entry fee, and a generic per-mode blurb,
-- but nothing about buy-in limits, the payout split, or the per-question
-- timer - a player had no way to know these before joining; buy-in limits in
-- particular only ever surfaced as a mid-game error (MIN_BUYIN_REQUIRED /
-- MAX_BUYIN_REACHED). Exposing them upfront so the Lobby actually shows all
-- the information a player needs to decide whether to join.
drop function if exists public.list_lobby_games();

create function public.list_lobby_games()
returns table (
  game_id uuid,
  status text,
  mode public.game_mode,
  current_round int,
  total_rounds int,
  total_prize_pool_cents int,
  in_sudden_death boolean,
  scheduled_start_at timestamptz,
  entry_fee_cents int,
  min_players int,
  player_count int,
  is_registered boolean,
  join_open boolean,
  subject_name text,
  subject_domain text,
  min_buy_in_tokens int,
  max_buy_in_tokens int,
  payout_scheme public.payout_scheme,
  round_seconds int
)
language sql
security definer set search_path = public
as $$
  select
    g.game_id, g.status::text, g.mode, g.current_round, g.total_rounds,
    g.total_prize_pool_cents, g.in_sudden_death, g.scheduled_start_at,
    g.entry_fee_cents, g.min_players,
    (select count(*)::int from public.player_game_stats p where p.game_id = g.game_id) as player_count,
    exists (
      select 1 from public.player_game_stats p
      where p.game_id = g.game_id and p.user_id = auth.uid()
    ) as is_registered,
    case
      when g.status = 'registration' then (g.scheduled_start_at is null or g.scheduled_start_at > now())
      when g.status = 'active' then g.current_round <= coalesce(
        (select (value #>> '{}')::int from public.platform_config where key = 'late_join_cutoff_round'), 30)
      else false
    end as join_open,
    s.name::text, s.domain::text,
    g.min_buy_in_tokens, g.max_buy_in_tokens, g.payout_scheme, g.round_seconds
  from public.games g
  left join public.subjects s on s.id = g.subject_id
  where g.status in ('registration', 'pending', 'active')
  order by
    case g.status when 'active' then 0 when 'registration' then 1 else 2 end,
    g.scheduled_start_at nulls last,
    g.created_at desc;
$$;

revoke execute on function public.list_lobby_games() from public, anon;
grant execute on function public.list_lobby_games() to authenticated;
