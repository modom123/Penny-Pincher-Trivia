-- Player-facing game history. There was no player-facing dashboard/stats view
-- at all — a player could see the live game they're in, but nothing about past
-- games (result, score, whether they cashed). self-service (auth.uid()-scoped,
-- no staff gate) since a player only ever sees their own history.
create or replace function public.my_game_history(p_limit int default 20)
returns jsonb
language sql
security definer set search_path = public
as $$
  select coalesce(jsonb_agg(row_to_json(t) order by t.created_at desc), '[]'::jsonb)
  from (
    select
      g.game_id,
      g.mode,
      g.status,
      g.current_round,
      g.total_rounds,
      g.created_at,
      g.completed_at,
      pgs.total_score,
      pgs.current_round_reached,
      pgs.is_eliminated,
      pgs.is_eligible_for_grand_prize,
      coalesce((
        select sum(wl.amount_cents) from public.wallet_ledger wl
        where wl.user_id = auth.uid() and wl.game_id = g.game_id and wl.entry_type = 'payout'
      ), 0) as payout_cents,
      coalesce((
        select sum(wl.amount_cents) from public.wallet_ledger wl
        where wl.user_id = auth.uid() and wl.game_id = g.game_id and wl.entry_type = 'milestone_bonus'
      ), 0) as milestone_bonus_cents,
      coalesce((
        select sum(-wl.amount_cents) from public.wallet_ledger wl
        where wl.user_id = auth.uid() and wl.game_id = g.game_id and wl.entry_type = 'round_debit'
      ), 0) as spent_cents
    from public.player_game_stats pgs
    join public.games g on g.game_id = pgs.game_id
    where pgs.user_id = auth.uid()
    order by g.created_at desc
    limit greatest(least(coalesce(p_limit, 20), 100), 1)
  ) t;
$$;
revoke execute on function public.my_game_history(int) from public, anon;
grant execute on function public.my_game_history(int) to authenticated;


-- Lightweight lifetime stats summary (games played, won, net) for a profile
-- header. Same self-service scope as my_game_history.
create or replace function public.my_player_stats()
returns jsonb
language sql
security definer set search_path = public
as $$
  select jsonb_build_object(
    'gamesPlayed', (select count(*) from public.player_game_stats where user_id = auth.uid()),
    'gamesWon', (
      select count(distinct game_id) from public.wallet_ledger
      where user_id = auth.uid() and entry_type = 'payout'
    ),
    'lifetimeWinningsCents', coalesce((select lifetime_winnings_cents from public.profiles where user_id = auth.uid()), 0),
    'lifetimeSpentCents', coalesce((
      select sum(-amount_cents) from public.wallet_ledger where user_id = auth.uid() and entry_type = 'round_debit'
    ), 0)
  );
$$;
revoke execute on function public.my_player_stats() from public, anon;
grant execute on function public.my_player_stats() to authenticated;
