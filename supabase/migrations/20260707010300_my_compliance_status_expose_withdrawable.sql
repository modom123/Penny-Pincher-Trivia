-- Money core, part 5: expose the wallet split to the client.
--
-- Adds promoBalanceCents (non-withdrawable bonus) and withdrawableCents
-- (= wallet - promo) so the mobile Wallet screen can show cash vs bonus clearly.
create or replace function public.my_compliance_status()
returns jsonb
language plpgsql
security definer set search_path = public
as $function$
declare v_p record; v_blocked jsonb;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  select kyc_status, date_of_birth, lifetime_winnings_cents, tax_details_confirmed,
         region_state, wallet_balance_cents, promo_balance_cents
  into v_p from public.profiles where user_id = auth.uid();
  select value into v_blocked from public.platform_config where key = 'blocked_states';
  return jsonb_build_object(
    'kycStatus', v_p.kyc_status,
    'isAdult', v_p.date_of_birth is not null and v_p.date_of_birth <= (current_date - interval '18 years'),
    'lifetimeWinningsCents', v_p.lifetime_winnings_cents,
    'taxDetailsConfirmed', v_p.tax_details_confirmed,
    'taxThresholdCents', 55000,
    'regionState', v_p.region_state,
    'regionBlocked', v_p.region_state is not null and (v_blocked ? v_p.region_state),
    'walletBalanceCents', v_p.wallet_balance_cents,
    'promoBalanceCents', v_p.promo_balance_cents,
    'withdrawableCents', v_p.wallet_balance_cents - v_p.promo_balance_cents
  );
end;
$function$;

revoke execute on function public.my_compliance_status() from public, anon, authenticated;
grant execute on function public.my_compliance_status() to authenticated;
