-- Staff need to actually find a player - by email or a short reference
-- number - instead of only ever seeing a raw UUID (see FinancialsPage,
-- SupportPage's manual user_id paste box). This adds:
--
-- 1) profiles.client_number: a short, sequential, human-friendly ID (starts
--    at 1000) for referencing a client in support conversations, Stripe
--    metadata, and reconciliation - instead of a 36-character UUID.
-- 2) list_clients: a staff-only directory (join against auth.users for
--    email, since that's not otherwise queryable by the client) with a
--    simple search by username / email / client number.
alter table public.profiles
  add column client_number bigint generated always as identity (start with 1000);
alter table public.profiles
  add constraint profiles_client_number_key unique (client_number);

create or replace function public.list_clients(p_search text default null)
returns table (
  user_id uuid,
  client_number bigint,
  username text,
  email text,
  wallet_balance_cents int,
  promo_balance_cents int,
  lifetime_winnings_cents int,
  kyc_status text,
  region_state text,
  is_suspended boolean,
  stripe_customer_id text,
  stripe_connect_account_id text,
  created_at timestamptz
)
language plpgsql
security definer set search_path = public
as $$
declare
  v_search text := nullif(trim(coalesce(p_search, '')), '');
begin
  if not public.is_staff(array['admin','support','compliance']) then
    raise exception 'Forbidden: staff access required';
  end if;

  return query
  select p.user_id, p.client_number, p.username, u.email::text,
         p.wallet_balance_cents, p.promo_balance_cents, p.lifetime_winnings_cents,
         p.kyc_status, p.region_state, p.is_suspended,
         p.stripe_customer_id, p.stripe_connect_account_id, p.created_at
  from public.profiles p
  join auth.users u on u.id = p.user_id
  where v_search is null
     or p.username ilike '%' || v_search || '%'
     or u.email ilike '%' || v_search || '%'
     or p.client_number::text = v_search
  order by p.client_number
  limit 500;
end;
$$;
revoke execute on function public.list_clients(text) from public, anon;
grant execute on function public.list_clients(text) to authenticated;
