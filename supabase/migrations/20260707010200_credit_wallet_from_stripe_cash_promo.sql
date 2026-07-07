-- Money core, part 4: Stripe credit splits a purchase into cash + bonus (promo).
--
-- A "$20 -> 2,800 tokens" bundle = 2000c cash + 800c bonus: the wallet gains all
-- 2,800 tokens (spendable), but 800 of them are promo (play-only, non-withdrawable).
-- Idempotent on the Stripe event id. Signature changed from the old single-amount
-- version, so the old (uuid,int,text) overload is dropped.
drop function if exists public.credit_wallet_from_stripe(uuid, integer, text);

create or replace function public.credit_wallet_from_stripe(
  p_user_id uuid, p_cash_cents integer, p_bonus_cents integer, p_stripe_event_id text)
returns jsonb
language plpgsql
security definer set search_path = public
as $function$
declare
  v_balance int;
  v_promo int;
  v_total int := coalesce(p_cash_cents, 0) + coalesce(p_bonus_cents, 0);
begin
  if coalesce(p_cash_cents, 0) < 0 or coalesce(p_bonus_cents, 0) < 0 then
    raise exception 'cash and bonus must be non-negative';
  end if;

  -- Idempotency: Stripe may redeliver the same webhook event.
  insert into public.processed_stripe_events (event_id) values (p_stripe_event_id)
  on conflict do nothing;
  if not found then
    return jsonb_build_object('credited', false, 'duplicate', true);
  end if;

  update public.profiles
  set wallet_balance_cents = wallet_balance_cents + v_total,
      promo_balance_cents = promo_balance_cents + coalesce(p_bonus_cents, 0)
  where user_id = p_user_id
  returning wallet_balance_cents, promo_balance_cents into v_balance, v_promo;
  if not found then
    raise exception 'User % not found', p_user_id;
  end if;

  -- Real cash in (withdrawable basis) is logged as a deposit; the bonus grant is
  -- logged separately so it never looks like withdrawable cash in reconciliation.
  if coalesce(p_cash_cents, 0) > 0 then
    insert into public.wallet_ledger (user_id, entry_type, amount_cents, stripe_ref)
    values (p_user_id, 'deposit', p_cash_cents, p_stripe_event_id);
  end if;
  if coalesce(p_bonus_cents, 0) > 0 then
    insert into public.wallet_ledger (user_id, entry_type, amount_cents, stripe_ref)
    values (p_user_id, 'bonus_grant', p_bonus_cents, p_stripe_event_id);
  end if;

  return jsonb_build_object(
    'credited', true,
    'wallet_balance_cents', v_balance,
    'promo_balance_cents', v_promo,
    'cashCents', coalesce(p_cash_cents, 0),
    'bonusCents', coalesce(p_bonus_cents, 0)
  );
end;
$function$;

revoke execute on function public.credit_wallet_from_stripe(uuid, integer, integer, text) from public, anon, authenticated;
grant execute on function public.credit_wallet_from_stripe(uuid, integer, integer, text) to service_role;
