-- Replaces the winners-only ticker with a broader "Live Activity" feed: wins,
-- game sign-ups, and streak bonuses, all sourced from real wallet_ledger rows
-- (no synthetic activity - see 20260721000000's note on why that matters for
-- a real-money product). More entry types means the feed still has real
-- things happening in it even before many games have completed.
drop function if exists public.list_recent_winners(int);

create or replace function public.list_recent_activity(p_limit int default 20)
returns table (
  kind text,
  user_id uuid,
  username text,
  amount_cents int,
  game_id uuid,
  mode public.game_mode,
  created_at timestamptz
)
language sql
security definer set search_path = public
as $$
  select
    case wl.entry_type
      when 'payout' then 'won'
      when 'entry_fee_debit' then 'joined'
      when 'streak_bonus' then 'streak'
    end as kind,
    wl.user_id, pr.username,
    abs(wl.amount_cents) as amount_cents,
    wl.game_id, g.mode, wl.created_at
  from public.wallet_ledger wl
  join public.profiles pr on pr.user_id = wl.user_id
  join public.games g on g.game_id = wl.game_id
  where wl.entry_type in ('payout', 'entry_fee_debit', 'streak_bonus')
  order by wl.created_at desc
  limit least(greatest(coalesce(p_limit, 20), 1), 50);
$$;
revoke execute on function public.list_recent_activity(int) from public, anon;
grant execute on function public.list_recent_activity(int) to authenticated;
