create type public.game_mode as enum ('original_escalator', 'streak_saver', 'milestone_booster');
alter table public.games add column mode public.game_mode not null default 'original_escalator';

-- Platform-funded prize-pool bonuses injected at milestone rounds (milestone_booster
-- mode only). Not tied to any single user, so tracked separately from wallet_ledger.
-- NOTE per legal/03-official-rules-DRAFT.md: a platform-funded bonus (as opposed to a
-- bonus funded purely by entry fees) may raise its own sweepstakes-classification
-- question - confirm with counsel before enabling milestone_booster in production.
create table public.game_bonus_injections (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games(game_id),
  round_number int not null,
  amount_cents int not null,
  created_at timestamptz not null default now(),
  unique (game_id, round_number)
);
alter table public.game_bonus_injections enable row level security;
create policy "game_bonus_injections_select_all" on public.game_bonus_injections
  for select to authenticated using (true);

-- Overtime rounds (round_number > total_rounds) created only during Sudden Death.
alter table public.game_rounds add column is_overtime boolean not null default false;
alter table public.game_rounds add column time_limit_override_seconds int;

-- Tracks which players are contesting a tied top-3 boundary during Sudden Death,
-- and which placement is in dispute.
create table public.sudden_death_participants (
  game_id uuid not null references public.games(game_id),
  user_id uuid not null references public.profiles(user_id),
  contested_place_start int not null,
  contested_place_end int not null,
  created_at timestamptz not null default now(),
  primary key (game_id, user_id)
);
alter table public.sudden_death_participants enable row level security;
create policy "sudden_death_participants_select_all" on public.sudden_death_participants
  for select to authenticated using (true);

alter table public.games add column in_sudden_death boolean not null default false;

-- Original schema capped round_number at 100 - overtime rounds go past that.
alter table public.game_rounds drop constraint game_rounds_round_number_check;
alter table public.game_rounds add constraint game_rounds_round_number_check check (round_number >= 1);
