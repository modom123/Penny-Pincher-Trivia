-- Trustly ("Pay by Bank") as an alternative payment rail to Stripe.
--
-- Context: Stripe classified this account as a restricted business (real-money
-- pay-to-enter cash-prize contests are gambling-adjacent under Stripe's
-- Restricted Businesses policy). Trustly is the standard rail for this exact
-- category (DFS/skill-contest platforms) - it moves money bank-to-bank via
-- ACH-style "Pay by Bank" rather than card networks, sidestepping the
-- card-network gambling-MCC problem entirely.
--
-- IMPORTANT - unlike every other integration in this repo, this one could NOT
-- be verified live: there is no Trustly sandbox account/credentials available
-- in this environment, and Trustly's own API reference (docs.trustly.com,
-- amer.developers.trustly.com) blocks automated fetches, so exact field names
-- below are the best cross-referenced answer from public search results, not
-- confirmed against the live reference. Every place that needs a final check
-- against a real Trustly sandbox is marked "VERIFY". Do not process a real
-- transaction on this until someone with sandbox credentials has confirmed
-- the request/response shapes against Trustly's actual reference docs.
--
-- Kept fully additive and dormant by default: existing Stripe code paths are
-- untouched, and platform_config.payment_processor (default 'stripe') is the
-- single switch that turns Trustly on for new deposits/withdrawals - the same
-- admin-editable-toggle pattern as geofence_enabled.

insert into public.platform_config (key, value)
values ('payment_processor', '"stripe"'::jsonb)
on conflict (key) do nothing;

-- Persistent bank-authorization reference from Trustly Pay's deferred flow:
-- established once (user picks their bank + authenticates), then reused for
-- every subsequent capture (deposit) or payout (withdrawal) - no need to
-- re-authenticate each purchase, similar in spirit to a saved Stripe payment
-- method or a Stripe Connect account id.
alter table public.profiles add column if not exists trustly_transaction_id text;

-- Ledger rows need to say which rail moved the money, and Trustly's own
-- reference is tracked separately from stripe_ref so the two are never
-- ambiguous in reconciliation.
alter table public.wallet_ledger add column if not exists processor varchar(20) not null default 'stripe';
alter table public.wallet_ledger add column if not exists trustly_ref varchar(255);

-- Notification (webhook) dedup, mirrors processed_stripe_events - Trustly
-- redelivers notifications until acknowledged, same as Stripe.
create table if not exists public.processed_trustly_notifications (
  notification_id varchar(255) primary key,
  created_at timestamptz not null default now()
);
alter table public.processed_trustly_notifications enable row level security;

-- credit_wallet_from_trustly: functionally identical to credit_wallet_from_stripe
-- (same cash/bonus -> wallet/promo split), just keyed on a Trustly notification
-- id instead of a Stripe event id, and tagged processor='trustly' on the ledger.
create or replace function public.credit_wallet_from_trustly(
  p_user_id uuid, p_cash_cents integer, p_bonus_cents integer, p_notification_id text)
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

  insert into public.processed_trustly_notifications (notification_id) values (p_notification_id)
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

  if coalesce(p_cash_cents, 0) > 0 then
    insert into public.wallet_ledger (user_id, entry_type, amount_cents, processor, trustly_ref)
    values (p_user_id, 'deposit', p_cash_cents, 'trustly', p_notification_id);
  end if;
  if coalesce(p_bonus_cents, 0) > 0 then
    insert into public.wallet_ledger (user_id, entry_type, amount_cents, processor, trustly_ref)
    values (p_user_id, 'bonus_grant', p_bonus_cents, 'trustly', p_notification_id);
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
revoke execute on function public.credit_wallet_from_trustly(uuid, integer, integer, text) from public, anon, authenticated;
grant execute on function public.credit_wallet_from_trustly(uuid, integer, integer, text) to service_role;

-- Service-role: trustly-webhook sets this once the bank-authorization
-- ("establish") step completes, mirroring set_connect_payouts_enabled's role
-- for Stripe Connect. Self-service isn't safe here (the transactionId has to
-- come from Trustly's own confirmed callback, not a client-asserted value).
create or replace function public.set_trustly_transaction_id(p_user_id uuid, p_transaction_id text)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  update public.profiles set trustly_transaction_id = p_transaction_id where user_id = p_user_id;
end;
$$;
revoke execute on function public.set_trustly_transaction_id(uuid, text) from public, anon, authenticated;
grant execute on function public.set_trustly_transaction_id(uuid, text) to service_role;

-- settle_withdrawal gains an optional processor tag; existing Stripe callers
-- (withdraw/index.ts's stripe.transfers.create path) are unaffected since the
-- new param defaults to 'stripe'. p_ref keeps the old parameter name
-- (p_stripe_transfer_id) semantically retired but positionally compatible -
-- it's really just "whatever reference string the processor gave back".
create or replace function public.settle_withdrawal(p_ledger_id uuid, p_ref text, p_processor text default 'stripe')
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  update public.wallet_ledger set stripe_ref = p_ref, processor = p_processor
  where id = p_ledger_id and entry_type = 'withdrawal';
end;
$$;
revoke execute on function public.settle_withdrawal(uuid, text, text) from public, anon, authenticated;
grant execute on function public.settle_withdrawal(uuid, text, text) to service_role;

-- reserve_withdrawal: same compliance gates as before (KYC, age, tax lock),
-- but the payout-account gate now branches on which processor is active.
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
  v_processor text;
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;
  if p_amount_cents is null or p_amount_cents <= 0 then
    raise exception 'cents must be a positive integer';
  end if;

  select coalesce(value #>> '{}', 'stripe') into v_processor
  from public.platform_config where key = 'payment_processor';
  v_processor := coalesce(v_processor, 'stripe');

  select wallet_balance_cents, promo_balance_cents, stripe_connect_account_id,
         stripe_connect_payouts_enabled, kyc_status, trustly_transaction_id,
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

  if v_processor = 'trustly' then
    if v_p.trustly_transaction_id is null then
      raise exception 'BANK_LINK_REQUIRED: Link a bank account before withdrawing.';
    end if;
  else
    if v_p.stripe_connect_account_id is null then
      raise exception 'CONNECT_REQUIRED: Link a payout account before withdrawing.';
    end if;
    if not v_p.stripe_connect_payouts_enabled then
      raise exception 'CONNECT_PENDING: Your payout account is still being verified by Stripe. Finish onboarding or check back shortly.';
    end if;
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

  return jsonb_build_object(
    'ledgerId', v_ledger_id, 'amountCents', p_amount_cents, 'processor', v_processor,
    'connectAccountId', v_p.stripe_connect_account_id, 'trustlyTransactionId', v_p.trustly_transaction_id
  );
end;
$function$;
revoke execute on function public.reserve_withdrawal(int) from public, anon, authenticated;
grant execute on function public.reserve_withdrawal(int) to authenticated;

-- my_compliance_status: adds the active processor + Trustly link state so the
-- client knows whether to show "link bank account" or "link payout account".
create or replace function public.my_compliance_status()
returns jsonb
language plpgsql
security definer set search_path = public
as $function$
declare
  v_p record; v_blocked jsonb; v_allowed jsonb; v_region_blocked boolean; v_geofence_enabled boolean;
  v_processor text;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  select kyc_status, date_of_birth, lifetime_winnings_cents, tax_details_confirmed,
         region_state, wallet_balance_cents, promo_balance_cents,
         stripe_connect_account_id, stripe_connect_payouts_enabled, trustly_transaction_id
  into v_p from public.profiles where user_id = auth.uid();

  select coalesce((value)::boolean, true) into v_geofence_enabled
  from public.platform_config where key = 'geofence_enabled';
  v_geofence_enabled := coalesce(v_geofence_enabled, true);

  select coalesce(value #>> '{}', 'stripe') into v_processor
  from public.platform_config where key = 'payment_processor';
  v_processor := coalesce(v_processor, 'stripe');

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
    'paymentProcessor', v_processor,
    'stripeConnectLinked', v_p.stripe_connect_account_id is not null,
    'stripeConnectPayoutsEnabled', coalesce(v_p.stripe_connect_payouts_enabled, false),
    'trustlyLinked', v_p.trustly_transaction_id is not null
  );
end;
$function$;
revoke execute on function public.my_compliance_status() from public, anon, authenticated;
grant execute on function public.my_compliance_status() to authenticated;

-- Staff toggle: which processor new deposits/withdrawals use. Switching this
-- back to 'stripe' instantly reverts the client to the existing, unaffected
-- Stripe flow - nothing about the Stripe code paths is removed or altered.
create or replace function public.admin_set_payment_processor(p_processor text)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  if not public.is_staff(array['admin']) then
    raise exception 'Forbidden: staff access required';
  end if;
  if p_processor not in ('stripe', 'trustly') then
    raise exception 'processor must be ''stripe'' or ''trustly''';
  end if;
  insert into public.platform_config (key, value) values ('payment_processor', to_jsonb(p_processor))
  on conflict (key) do update set value = to_jsonb(p_processor);
  perform public.log_admin_action('set_payment_processor', null, null, jsonb_build_object('processor', p_processor));
end;
$$;
revoke execute on function public.admin_set_payment_processor(text) from public, anon;
grant execute on function public.admin_set_payment_processor(text) to authenticated;
