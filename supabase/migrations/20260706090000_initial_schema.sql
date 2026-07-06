-- Penny Pincher Trivia schema. All money is stored as integer cents ("pennies")
-- to avoid floating point drift. auth.users (Supabase Auth) is the identity
-- source of truth; public.profiles holds app-specific fields 1:1 with it.

create extension if not exists pgcrypto;

create table public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  username varchar(50) unique not null,
  wallet_balance_cents int not null default 0 check (wallet_balance_cents >= 0),
  stripe_customer_id varchar(255),
  stripe_connect_account_id varchar(255),
  is_suspended boolean not null default false,
  created_at timestamptz not null default now()
);

-- Auto-create a profile row whenever a new auth user signs up.
create function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (user_id, username)
  values (new.id, coalesce(new.raw_user_meta_data->>'username', 'player_' || substr(new.id::text, 1, 8)));
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create table public.games (
  game_id uuid primary key default gen_random_uuid(),
  status varchar(20) not null default 'pending', -- pending | active | completed
  current_round int not null default 0,
  total_rounds int not null default 100,
  total_prize_pool_cents int not null default 0,
  admin_revenue_pool_cents int not null default 0,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz
);

create table public.questions (
  question_id uuid primary key default gen_random_uuid(),
  question_text text not null,
  options jsonb not null,
  correct_option varchar(1) not null,
  difficulty_level int not null check (difficulty_level between 1 and 100),
  category varchar(50),
  time_limit_seconds int not null default 12
);

-- Assigns a specific question to a specific round within a specific game instance.
create table public.game_rounds (
  game_id uuid not null references public.games(game_id),
  round_number int not null check (round_number between 1 and 100),
  question_id uuid not null references public.questions(question_id),
  cost_cents int not null,
  started_at timestamptz,
  ended_at timestamptz,
  primary key (game_id, round_number)
);

create table public.player_game_stats (
  player_game_id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(user_id),
  game_id uuid not null references public.games(game_id),
  total_score int not null default 0,
  current_round_reached int not null default 0,
  is_eliminated boolean not null default false,
  pre_bought_all boolean not null default false,
  is_eligible_for_grand_prize boolean not null default true,
  unique (user_id, game_id)
);

create table public.player_answers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(user_id),
  game_id uuid not null references public.games(game_id),
  round_number int not null,
  question_id uuid not null references public.questions(question_id),
  selected_option varchar(1),
  is_correct boolean not null default false,
  time_taken_ms int not null,
  points_awarded int not null default 0,
  answered_at timestamptz not null default now(),
  unique (user_id, game_id, round_number)
);

-- Immutable append-only ledger. amount_cents is signed: positive = credit, negative = debit.
create table public.wallet_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(user_id),
  entry_type varchar(20) not null, -- deposit | round_debit | payout | withdrawal
  amount_cents int not null,
  game_id uuid references public.games(game_id),
  round_number int,
  stripe_ref varchar(255),
  created_at timestamptz not null default now()
);

create table public.cheat_flags (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(user_id),
  game_id uuid references public.games(game_id),
  round_number int,
  reason varchar(100) not null,
  created_at timestamptz not null default now()
);

-- Dedup table so Stripe webhook retries never double-credit a wallet.
create table public.processed_stripe_events (
  event_id varchar(255) primary key,
  created_at timestamptz not null default now()
);

create index idx_player_answers_game on public.player_answers(game_id);
create index idx_player_game_stats_game on public.player_game_stats(game_id);
create index idx_wallet_ledger_user on public.wallet_ledger(user_id);
