-- SECURITY: dev_credit_wallet previously let ANY authenticated user credit up to
-- $1,000 of WITHDRAWABLE cash to their own wallet -> a free-money / cash-out hole.
-- Lock it down for real money:
--   1. Staff admins only (is_staff check inside; Forbidden otherwise).
--   2. Credits the PROMO (play-only, non-withdrawable) balance, never withdrawable
--      cash -- so even QA testing can't mint cashable money.
--   3. Every use is written to the admin audit log.
create or replace function public.dev_credit_wallet(p_cents integer)
returns jsonb
language plpgsql
security definer set search_path = public
as $function$
declare
  v_user_id uuid := auth.uid();
  v_balance int;
  v_promo int;
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;
  -- Staff-admin gate: normal players can no longer self-credit.
  if not public.is_staff(array['admin']) then
    raise exception 'Forbidden: dev credit is restricted to admin staff (test tool only)';
  end if;
  if p_cents is null or p_cents <= 0 or p_cents > 100000 then
    raise exception 'cents must be a positive integer up to 100000';
  end if;

  -- Credit PROMO only: spendable for testing, but never withdrawable.
  update public.profiles
  set wallet_balance_cents = wallet_balance_cents + p_cents,
      promo_balance_cents = promo_balance_cents + p_cents
  where user_id = v_user_id
  returning wallet_balance_cents, promo_balance_cents into v_balance, v_promo;

  insert into public.wallet_ledger (user_id, entry_type, amount_cents, stripe_ref)
  values (v_user_id, 'bonus_grant', p_cents, 'dev-credit');

  perform public.log_admin_action('dev_credit_wallet', v_user_id, null, jsonb_build_object('cents', p_cents));

  return jsonb_build_object('wallet_balance_cents', v_balance, 'promo_balance_cents', v_promo);
end;
$function$;

revoke execute on function public.dev_credit_wallet(int) from public, anon, authenticated;
grant execute on function public.dev_credit_wallet(int) to authenticated;
