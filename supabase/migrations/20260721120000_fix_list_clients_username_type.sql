-- list_clients has been raising "structure of query does not match function
-- result type" on every call since it was written: profiles.username is
-- varchar(50), but the function declares its return column as text without
-- casting, and Postgres requires an exact type match in RETURN QUERY. This
-- silently broke Command Center's Clients page (the frontend swallows the
-- RPC error and just renders an empty list).
create or replace function public.list_clients(p_search text default null)
returns table(
  user_id uuid, client_number bigint, username text, email text,
  wallet_balance_cents integer, promo_balance_cents integer, lifetime_winnings_cents integer,
  kyc_status text, region_state text, is_suspended boolean,
  stripe_customer_id text, stripe_connect_account_id text, created_at timestamptz
)
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_search text := nullif(trim(coalesce(p_search, '')), '');
begin
  if not public.is_staff(array['admin','support','compliance']) then
    raise exception 'Forbidden: staff access required';
  end if;

  return query
  select p.user_id, p.client_number, p.username::text, u.email::text,
         p.wallet_balance_cents, p.promo_balance_cents, p.lifetime_winnings_cents,
         p.kyc_status::text, p.region_state::text, p.is_suspended,
         p.stripe_customer_id::text, p.stripe_connect_account_id::text, p.created_at
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
