-- All-time leaderboard for the Lobby: top players by lifetime winnings.
-- lifetime_winnings_cents already accrues on every payout (see payout_game),
-- so this is a straight read - no new columns or triggers needed.
create or replace function public.list_top_winners(p_limit int default 20)
returns table (
  user_id uuid,
  username text,
  lifetime_winnings_cents int
)
language sql
security definer set search_path = public
as $$
  select p.user_id, p.username, p.lifetime_winnings_cents
  from public.profiles p
  where p.lifetime_winnings_cents > 0
  order by p.lifetime_winnings_cents desc, p.user_id
  limit least(greatest(coalesce(p_limit, 20), 1), 100);
$$;

revoke execute on function public.list_top_winners(int) from public, anon;
grant execute on function public.list_top_winners(int) to authenticated;
