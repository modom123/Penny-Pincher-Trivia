-- Refer-a-friend: a player earns 500 tokens when a friend they referred signs up
-- AND plays (buys their first real-cash round).
--
-- Design decisions baked in here:
--   * The 500-token reward is PROMO (non-withdrawable) value, credited via the
--     same wallet/promo split the rest of the money core uses. Handing out
--     withdrawable cash per signup would be a fraud + pool-solvency hole; promo
--     tokens give $5 of play value but can never be cashed out.
--   * "Signs up AND plays" = the referred user has spent real cash on at least
--     one round (player_game_stats.total_cash_spent_cents > 0). Because a brand
--     new account holds no promo, its first round is necessarily paid in real
--     cash, so activating a referral costs a genuine deposit -> natural
--     anti-farming gate on top of promo-only rewards.
--   * A user can be referred at most once, never by themselves, and each
--     referral pays out at most once.

-- 1. Attribution columns on profiles.
alter table public.profiles
  add column referral_code text unique,
  add column referred_by uuid references public.profiles(user_id);

-- 2. Referral ledger: one row per (referrer -> referred) relationship.
create table public.referrals (
  id uuid primary key default gen_random_uuid(),
  referrer_id uuid not null references public.profiles(user_id) on delete cascade,
  referred_id uuid not null unique references public.profiles(user_id) on delete cascade,
  reward_cents int not null default 500,
  status text not null default 'pending' check (status in ('pending', 'rewarded')),
  created_at timestamptz not null default now(),
  rewarded_at timestamptz,
  constraint referrer_ne_referred check (referrer_id <> referred_id)
);
create index idx_referrals_referrer on public.referrals(referrer_id);

alter table public.referrals enable row level security;
-- Either party may read their own referral rows; all writes go through the
-- SECURITY DEFINER functions below (no insert/update/delete policies).
create policy "referrals_select_own" on public.referrals
  for select to authenticated using (auth.uid() = referrer_id or auth.uid() = referred_id);


-- 3. Signup: give every new profile a unique referral code, and attribute the
-- new user to a referrer if they signed up with a code in their auth metadata
-- (options.data.referral_code). Supersedes the initial handle_new_user.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_code text;
  v_ref_code text;
  v_referrer uuid;
begin
  -- Unique 8-char code; retry on the (rare) collision. md5() is a core function
  -- (no pgcrypto/extensions-schema dependency, so it works under search_path=public).
  loop
    v_code := upper(substr(md5(random()::text || clock_timestamp()::text || new.id::text), 1, 8));
    exit when not exists (select 1 from public.profiles where referral_code = v_code);
  end loop;

  insert into public.profiles (user_id, username, referral_code)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'username', 'player_' || substr(new.id::text, 1, 8)),
    v_code
  );

  v_ref_code := upper(nullif(trim(new.raw_user_meta_data->>'referral_code'), ''));
  if v_ref_code is not null then
    select user_id into v_referrer from public.profiles where referral_code = v_ref_code;
    if v_referrer is not null and v_referrer <> new.id then
      update public.profiles set referred_by = v_referrer where user_id = new.id;
      insert into public.referrals (referrer_id, referred_id)
      values (v_referrer, new.id)
      on conflict (referred_id) do nothing;
    end if;
  end if;

  return new;
end;
$$;


-- 4. Apply a code after signup (for users who didn't enter one), allowed only
-- before their first round so it can't be claimed retroactively.
create or replace function public.apply_referral_code(p_code text)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_code text := upper(nullif(trim(p_code), ''));
  v_referrer uuid;
begin
  if v_user is null then raise exception 'Not authenticated'; end if;
  if v_code is null then raise exception 'INVALID_CODE: A referral code is required.'; end if;

  if exists (select 1 from public.profiles where user_id = v_user and referred_by is not null) then
    raise exception 'ALREADY_REFERRED: You already have a referrer on file.';
  end if;
  if exists (select 1 from public.player_game_stats where user_id = v_user) then
    raise exception 'ALREADY_PLAYED: A referral code must be applied before your first round.';
  end if;

  select user_id into v_referrer from public.profiles where referral_code = v_code;
  if v_referrer is null then raise exception 'INVALID_CODE: That referral code was not found.'; end if;
  if v_referrer = v_user then raise exception 'SELF_REFERRAL: You cannot refer yourself.'; end if;

  update public.profiles set referred_by = v_referrer where user_id = v_user;
  insert into public.referrals (referrer_id, referred_id)
  values (v_referrer, v_user)
  on conflict (referred_id) do nothing;

  return jsonb_build_object('applied', true, 'referrerId', v_referrer);
end;
$$;

revoke execute on function public.apply_referral_code(text) from public, anon;
grant execute on function public.apply_referral_code(text) to authenticated;


-- 5. Reward logic: when a referred user has played with real cash, pay the
-- referrer their promo bonus exactly once. Idempotent via the pending->rewarded
-- status flip under a row lock.
create or replace function public.reward_referral_if_qualified(p_referred_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v_ref record;
begin
  select * into v_ref from public.referrals
  where referred_id = p_referred_id and status = 'pending'
  for update;
  if not found then return; end if;

  -- Qualification: the referred friend has actually played (real cash spent).
  if not exists (
    select 1 from public.player_game_stats
    where user_id = p_referred_id and total_cash_spent_cents > 0
  ) then
    return;
  end if;

  -- Credit the referrer with promo (play-only, non-withdrawable) tokens.
  update public.profiles
  set wallet_balance_cents = wallet_balance_cents + v_ref.reward_cents,
      promo_balance_cents = promo_balance_cents + v_ref.reward_cents
  where user_id = v_ref.referrer_id;

  insert into public.wallet_ledger (user_id, entry_type, amount_cents)
  values (v_ref.referrer_id, 'referral_bonus', v_ref.reward_cents);

  update public.referrals set status = 'rewarded', rewarded_at = now() where id = v_ref.id;
end;
$$;

-- Trigger-only; never exposed as an RPC (defense in depth, matching handle_new_user).
revoke execute on function public.reward_referral_if_qualified(uuid) from public, anon, authenticated, service_role;

-- Fire on a player's first participation in any game (buy_round inserts the
-- player_game_stats row). Subsequent rounds in the same game are UPDATEs, and
-- the status guard makes re-firing across games a no-op.
create or replace function public.on_play_reward_referral()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  perform public.reward_referral_if_qualified(new.user_id);
  return new;
end;
$$;
revoke execute on function public.on_play_reward_referral() from public, anon, authenticated, service_role;

create trigger reward_referral_on_play
  after insert on public.player_game_stats
  for each row execute function public.on_play_reward_referral();


-- 6. Self-serve status for the UI: your code, counts, and tokens earned.
create or replace function public.my_referral_status()
returns jsonb
language sql
security definer set search_path = public
as $$
  select jsonb_build_object(
    'referralCode', p.referral_code,
    'rewardPerReferralCents', 500,
    'referredBy', p.referred_by,
    'totalReferred', (select count(*) from public.referrals r where r.referrer_id = p.user_id),
    'rewardedCount', (select count(*) from public.referrals r where r.referrer_id = p.user_id and r.status = 'rewarded'),
    'pendingCount', (select count(*) from public.referrals r where r.referrer_id = p.user_id and r.status = 'pending'),
    'tokensEarnedCents', coalesce(
      (select sum(reward_cents) from public.referrals r where r.referrer_id = p.user_id and r.status = 'rewarded'), 0)
  )
  from public.profiles p
  where p.user_id = auth.uid();
$$;

revoke execute on function public.my_referral_status() from public, anon;
grant execute on function public.my_referral_status() to authenticated;


-- 7. Harden the client-write guard: the referral columns and the promo balance
-- join wallet_balance_cents as server-only fields, so a client can't self-assign
-- a referrer, mint a referral code, or lower its own promo slice to inflate its
-- withdrawable cash.
--
-- This also FIXES a latent bug in the original guard. It gated on
-- auth.role() = 'authenticated' (the JWT claim), which stays 'authenticated'
-- even inside SECURITY DEFINER functions - so the guard would have blocked
-- buy_round's own wallet write for any real authenticated caller. The correct
-- signal is the effective Postgres role (current_user): 'authenticated' for a
-- direct client UPDATE, but the function owner ('postgres') inside a definer
-- function. Reading current_user requires the trigger itself to run
-- SECURITY INVOKER (a definer trigger would always see its own owner).
create or replace function public.prevent_client_wallet_edit()
returns trigger
language plpgsql
security invoker set search_path = public
as $$
begin
  -- current_user is the function owner inside SECURITY DEFINER money functions,
  -- so those pass; only direct client updates run as 'authenticated'.
  if current_user = 'authenticated' then
    if new.wallet_balance_cents is distinct from old.wallet_balance_cents then
      raise exception 'wallet_balance_cents can only be changed via server-side functions';
    end if;
    if new.promo_balance_cents is distinct from old.promo_balance_cents then
      raise exception 'promo_balance_cents can only be changed via server-side functions';
    end if;
    if new.referral_code is distinct from old.referral_code then
      raise exception 'referral_code cannot be changed';
    end if;
    if new.referred_by is distinct from old.referred_by then
      raise exception 'referred_by can only be set via apply_referral_code';
    end if;
  end if;
  return new;
end;
$$;
