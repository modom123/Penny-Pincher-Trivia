-- Removes Stripe as an active payment/identity path now that the platform is
-- committing fully to Trustly (Stripe flagged the account as a restricted
-- business for the payments/Connect side). Historical Stripe columns
-- (stripe_customer_id, stripe_connect_account_id, stripe_connect_payouts_enabled,
-- wallet_ledger.stripe_ref) are LEFT IN PLACE - they're the audit trail for any
-- real transactions that already happened through Stripe, and wallet_ledger.stripe_ref
-- is still used as the generic external-ref/status column regardless of
-- processor (see reserve_withdrawal's 'pending' sentinel). Only the ACTIVE
-- branching/dead code is removed so there's one clear path, not two.
--
-- KYC replacement: Trustly ID reuses the exact same bank-authorization flow
-- already built (trustly-establish-bank-auth/trustly-confirm-bank-auth) -
-- adding kycType to the establishData object at establish time grants access
-- to a GET endpoint returning bank-verified name/address/dateOfBirth plus an
-- `eligible` flag (OFAC/SDN/PEP screening). So linking a bank account now
-- does double duty: payment authorization AND identity verification in one
-- step, via apply_kyc_result (already provider-agnostic - built for
-- "Persona/Stripe Identity", works identically for Trustly ID).

drop function if exists public.admin_set_payment_processor(text);
drop function if exists public.credit_wallet_from_stripe(uuid, integer, integer, text);
drop function if exists public.set_connect_payouts_enabled(text, boolean);

-- reserve_withdrawal: Trustly-only gate (was branching on platform_config.payment_processor).
create or replace function public.reserve_withdrawal(p_amount_cents integer)
returns jsonb
language plpgsql
security definer set search_path = public
as $function$
declare
  v_user_id uuid := auth.uid();
  v_p record;
  v_ledger_id uuid;
  v_withdrawable_cents int;
  v_tax_lock_cents constant int := 55000; -- $550, per go-live design (locks before the $600 1099 threshold)
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;
  if p_amount_cents is null or p_amount_cents <= 0 then
    raise exception 'cents must be a positive integer';
  end if;

  select wallet_balance_cents, promo_balance_cents, kyc_status, trustly_transaction_id,
         date_of_birth, lifetime_winnings_cents, tax_details_confirmed
  into v_p
  from public.profiles where user_id = v_user_id for update;

  if v_p.kyc_status <> 'verified' then
    raise exception 'KYC_REQUIRED: Identity verification is required before withdrawing.';
  end if;
  if v_p.date_of_birth is null or v_p.date_of_birth > (current_date - interval '18 years') then
    raise exception 'AGE_REQUIREMENT: You must be at least 18 years old to withdraw.';
  end if;

  if v_p.lifetime_winnings_cents >= v_tax_lock_cents and not v_p.tax_details_confirmed then
    raise exception 'TAX_DETAILS_REQUIRED: You are approaching the federal tax reporting threshold. Please confirm your tax details to continue cashing out.';
  end if;

  if v_p.trustly_transaction_id is null then
    raise exception 'BANK_LINK_REQUIRED: Link a bank account before withdrawing.';
  end if;

  v_withdrawable_cents := v_p.wallet_balance_cents - v_p.promo_balance_cents;
  if v_withdrawable_cents < p_amount_cents then
    raise exception 'INSUFFICIENT_WITHDRAWABLE: Your withdrawable (cash) balance is %c. Bonus tokens (%c) are play-only and cannot be withdrawn.',
      v_withdrawable_cents, v_p.promo_balance_cents;
  end if;

  update public.profiles set wallet_balance_cents = wallet_balance_cents - p_amount_cents
  where user_id = v_user_id;

  insert into public.wallet_ledger (user_id, entry_type, amount_cents, stripe_ref)
  values (v_user_id, 'withdrawal', -p_amount_cents, 'pending')
  returning id into v_ledger_id;

  return jsonb_build_object(
    'ledgerId', v_ledger_id, 'amountCents', p_amount_cents, 'trustlyTransactionId', v_p.trustly_transaction_id
  );
end;
$function$;
revoke execute on function public.reserve_withdrawal(int) from public, anon, authenticated;
grant execute on function public.reserve_withdrawal(int) to authenticated;

-- my_compliance_status: Trustly-only fields (was returning both processors' state).
create or replace function public.my_compliance_status()
returns jsonb
language plpgsql
security definer set search_path = public
as $function$
declare
  v_p record; v_blocked jsonb; v_allowed jsonb; v_region_blocked boolean; v_geofence_enabled boolean;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  select kyc_status, date_of_birth, lifetime_winnings_cents, tax_details_confirmed,
         region_state, wallet_balance_cents, promo_balance_cents, trustly_transaction_id
  into v_p from public.profiles where user_id = auth.uid();

  select coalesce((value)::boolean, true) into v_geofence_enabled
  from public.platform_config where key = 'geofence_enabled';
  v_geofence_enabled := coalesce(v_geofence_enabled, true);

  select value into v_blocked from public.platform_config where key = 'blocked_states';
  select value into v_allowed from public.platform_config where key = 'allowed_states';

  v_region_blocked := v_geofence_enabled and v_p.region_state is not null and (
    (v_allowed is not null and jsonb_array_length(v_allowed) > 0 and not (v_allowed ? v_p.region_state))
    or (v_blocked ? v_p.region_state)
  );

  return jsonb_build_object(
    'kycStatus', v_p.kyc_status,
    'isAdult', v_p.date_of_birth is not null and v_p.date_of_birth <= (current_date - interval '18 years'),
    'lifetimeWinningsCents', v_p.lifetime_winnings_cents,
    'taxDetailsConfirmed', v_p.tax_details_confirmed,
    'taxThresholdCents', 55000,
    'regionState', v_p.region_state,
    'regionBlocked', v_region_blocked,
    'geofenceEnabled', v_geofence_enabled,
    'allowedStates', coalesce(v_allowed, '[]'::jsonb),
    'walletBalanceCents', v_p.wallet_balance_cents,
    'promoBalanceCents', v_p.promo_balance_cents,
    'withdrawableCents', v_p.wallet_balance_cents - v_p.promo_balance_cents,
    'trustlyLinked', v_p.trustly_transaction_id is not null
  );
end;
$function$;
revoke execute on function public.my_compliance_status() from public, anon, authenticated;
grant execute on function public.my_compliance_status() to authenticated;
