-- Money core, part 3: withdrawals may only draw the CASH-funded balance.
--
-- withdrawable = wallet_balance_cents - promo_balance_cents. Promo/bonus tokens
-- are play-only and can never leave the platform. Deducting from wallet_balance
-- (promo unchanged) keeps the promo <= wallet invariant because we require
-- amount <= (wallet - promo). All KYC/age/tax/Connect gates are unchanged.
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

  select wallet_balance_cents, promo_balance_cents, stripe_connect_account_id, kyc_status,
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

  if v_p.stripe_connect_account_id is null then
    raise exception 'Stripe Connect account not linked. Complete onboarding first.';
  end if;

  -- Only cash-funded balance is withdrawable; bonus/promo tokens are excluded.
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

  return jsonb_build_object('ledgerId', v_ledger_id, 'connectAccountId', v_p.stripe_connect_account_id, 'amountCents', p_amount_cents);
end;
$function$;

revoke execute on function public.reserve_withdrawal(int) from public, anon, authenticated;
grant execute on function public.reserve_withdrawal(int) to authenticated;
