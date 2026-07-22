-- Backfills two things this repo's migration history was missing, plus fixes the
-- bug they were hiding:
--
-- 1) BACKFILL: public.referrals, apply_referral_code(), my_referral_status(),
--    on_play_reward_referral()/reward_referral_if_qualified() already exist live
--    in the database (confirmed via pg_get_functiondef) but were never committed
--    as a migration - reconciling that drift here with `create table if not
--    exists`/`create or replace function` so this file is idempotent against
--    the already-applied state, not a rewrite of history.
--
-- 2) REAL BUG: mobile/src/contexts/AuthContext.tsx's checkUsername() selects
--    profiles.username_set, and mobile/src/screens/UsernamePickerScreen.tsx
--    calls set_username() - NEITHER the column nor the function has ever
--    existed. Before this session's AuthContext fix (see the "Fix stuck
--    blue-screen on load" commit), that meant checkUsername() threw on every
--    single login, which left setLoading(false) unreachable and the whole app
--    stuck on a blank blue screen - the reported "have to hit refresh" bug.
--    That fix stopped the hang, but it also means needsUsername now silently
--    defaults to false for everyone, so UsernamePickerScreen - the ONLY place
--    apply_referral_code() is ever called from the UI - has never actually
--    been reached by a single user. That is why referral shares were
--    producing zero attributed signups: the code to apply them was
--    unreachable, not just badly received.
create table if not exists public.referrals (
  id uuid primary key default gen_random_uuid(),
  referrer_id uuid not null references public.profiles(user_id) on delete cascade,
  referred_id uuid not null references public.profiles(user_id) on delete cascade unique,
  reward_cents int not null default 500,
  status text not null default 'pending' check (status in ('pending', 'rewarded')),
  created_at timestamptz not null default now(),
  rewarded_at timestamptz,
  constraint referrer_ne_referred check (referrer_id <> referred_id)
);
alter table public.referrals enable row level security;
drop policy if exists "referrals_select_own" on public.referrals;
create policy "referrals_select_own" on public.referrals
  for select to authenticated using (auth.uid() = referrer_id or auth.uid() = referred_id);

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

  if not exists (
    select 1 from public.player_game_stats
    where user_id = p_referred_id and total_cash_spent_cents > 0
  ) then
    return;
  end if;

  update public.profiles
  set wallet_balance_cents = wallet_balance_cents + v_ref.reward_cents,
      promo_balance_cents = promo_balance_cents + v_ref.reward_cents
  where user_id = v_ref.referrer_id;

  insert into public.wallet_ledger (user_id, entry_type, amount_cents)
  values (v_ref.referrer_id, 'referral_bonus', v_ref.reward_cents);

  update public.referrals set status = 'rewarded', rewarded_at = now() where id = v_ref.id;
end;
$$;

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

drop trigger if exists reward_referral_on_play on public.player_game_stats;
create trigger reward_referral_on_play after insert on public.player_game_stats
  for each row execute function public.on_play_reward_referral();

-- Fix: add the missing username_set column (default true so EXISTING users are
-- never unexpectedly routed to a username picker they've never seen) and the
-- missing set_username() RPC, then have handle_new_user() set the flag
-- correctly for new signups going forward: true when a real username was
-- supplied at signup (email/password, via signUp()'s metadata), false when one
-- wasn't (Google OAuth, which only supplies name/email/avatar - these are
-- exactly the accounts UsernamePickerScreen's comment says it's "mainly" for).
alter table public.profiles add column if not exists username_set boolean not null default true;

create or replace function public.set_username(p_username text)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_username text := trim(p_username);
begin
  if v_user is null then raise exception 'Not authenticated'; end if;
  if v_username !~ '^[A-Za-z0-9_]{3,20}$' then
    raise exception 'INVALID_USERNAME: Username must be 3-20 letters, numbers, or underscores.';
  end if;

  begin
    update public.profiles set username = v_username, username_set = true where user_id = v_user;
  exception when unique_violation then
    raise exception 'USERNAME_TAKEN: That username is already in use.';
  end;

  return jsonb_build_object('username', v_username);
end;
$$;
revoke execute on function public.set_username(text) from public, anon;
grant execute on function public.set_username(text) to authenticated;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_code text;
  v_ref_code text;
  v_referrer uuid;
  v_meta_username text := nullif(trim(new.raw_user_meta_data->>'username'), '');
begin
  loop
    v_code := upper(substr(md5(random()::text || clock_timestamp()::text || new.id::text), 1, 8));
    exit when not exists (select 1 from public.profiles where referral_code = v_code);
  end loop;

  insert into public.profiles (user_id, username, referral_code, username_set)
  values (
    new.id,
    coalesce(v_meta_username, 'player_' || substr(new.id::text, 1, 8)),
    v_code,
    v_meta_username is not null
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
