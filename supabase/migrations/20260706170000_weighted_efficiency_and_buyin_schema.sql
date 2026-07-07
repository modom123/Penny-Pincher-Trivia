-- Weighted Point Efficiency Matrix (per the game-of-skill design doc): track
-- cash spent and cumulative response time per player-game so the Wallet
-- Efficiency Rating (WER) can break ties at game end.
alter table public.player_game_stats add column total_cash_spent_cents int not null default 0;
alter table public.player_game_stats add column total_response_time_ms bigint not null default 0;
alter table public.player_game_stats add column weighted_efficiency_score numeric(16,6) not null default 0;
comment on column public.player_game_stats.weighted_efficiency_score is
  'WER, computed at game end: total_score / greatest(total_cash_spent_cents,1) / greatest(total_response_time_ms,1). Higher = more points per cent and faster = wins ties.';

-- Per-game token buy-in limits (nullable = no limit). Enforcement wired up
-- once the cash-pool/buy-in model is confirmed.
alter table public.games add column min_buy_in_tokens int;
alter table public.games add column max_buy_in_tokens int;
