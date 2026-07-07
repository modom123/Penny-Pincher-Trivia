-- Money core, part 1: split the wallet into cash-funded vs promo (bonus) value.
--
-- profiles.wallet_balance_cents remains TOTAL spendable (cash + promo). The new
-- promo_balance_cents tracks the non-withdrawable bonus slice; withdrawable cash
-- = wallet_balance_cents - promo_balance_cents. This is what closes the
-- bonus-token cash-out arbitrage (buy $20 -> 2,800 tokens, withdraw $28) and the
-- pool-solvency hole (only cash funds the real prize pool).
alter table public.profiles
  add column promo_balance_cents int not null default 0 check (promo_balance_cents >= 0);

-- Invariant: the promo slice can never exceed the total balance.
alter table public.profiles
  add constraint promo_not_over_total check (promo_balance_cents <= wallet_balance_cents);

-- Total tokens (cash + promo) spent per player-game, used to enforce the per-game
-- MAX buy-in cap. (total_cash_spent_cents already tracks only real cash, for WER.)
alter table public.player_game_stats
  add column total_tokens_spent_cents int not null default 0;
