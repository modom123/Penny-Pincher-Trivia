create function public.credit_wallet_from_stripe(p_user_id uuid, p_amount_cents int, p_stripe_event_id text)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_balance int;
begin
  -- Idempotency: Stripe may redeliver the same webhook event.
  insert into public.processed_stripe_events (event_id) values (p_stripe_event_id)
  on conflict do nothing;
  if not found then
    return jsonb_build_object('credited', false, 'duplicate', true);
  end if;

  update public.profiles set wallet_balance_cents = wallet_balance_cents + p_amount_cents
  where user_id = p_user_id
  returning wallet_balance_cents into v_balance;
  if not found then
    raise exception 'User % not found', p_user_id;
  end if;

  insert into public.wallet_ledger (user_id, entry_type, amount_cents, stripe_ref)
  values (p_user_id, 'deposit', p_amount_cents, p_stripe_event_id);

  return jsonb_build_object('credited', true, 'wallet_balance_cents', v_balance);
end;
$$;

revoke execute on function public.credit_wallet_from_stripe(uuid, int, text) from public, anon, authenticated;
grant execute on function public.credit_wallet_from_stripe(uuid, int, text) to service_role;


-- Withdrawals are two-phase: reserve the funds atomically first (so a user
-- can never withdraw the same balance twice), then the Edge Function calls
-- Stripe; on success it calls settle_withdrawal, on failure refund_withdrawal.
create function public.reserve_withdrawal(p_amount_cents int)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_balance int;
  v_connect_account_id varchar;
  v_ledger_id uuid;
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;
  if p_amount_cents is null or p_amount_cents <= 0 then
    raise exception 'cents must be a positive integer';
  end if;

  select wallet_balance_cents, stripe_connect_account_id into v_balance, v_connect_account_id
  from public.profiles where user_id = v_user_id for update;
  if v_connect_account_id is null then
    raise exception 'Stripe Connect account not linked. Complete onboarding first.';
  end if;
  if v_balance < p_amount_cents then
    raise exception 'Insufficient wallet balance';
  end if;

  update public.profiles set wallet_balance_cents = wallet_balance_cents - p_amount_cents
  where user_id = v_user_id;

  insert into public.wallet_ledger (user_id, entry_type, amount_cents, stripe_ref)
  values (v_user_id, 'withdrawal', -p_amount_cents, 'pending')
  returning id into v_ledger_id;

  return jsonb_build_object('ledgerId', v_ledger_id, 'connectAccountId', v_connect_account_id, 'amountCents', p_amount_cents);
end;
$$;

revoke execute on function public.reserve_withdrawal(int) from public, anon, authenticated;
grant execute on function public.reserve_withdrawal(int) to authenticated;


create function public.settle_withdrawal(p_ledger_id uuid, p_stripe_transfer_id text)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  update public.wallet_ledger set stripe_ref = p_stripe_transfer_id
  where id = p_ledger_id and entry_type = 'withdrawal';
end;
$$;

revoke execute on function public.settle_withdrawal(uuid, text) from public, anon, authenticated;
grant execute on function public.settle_withdrawal(uuid, text) to service_role;


create function public.refund_withdrawal(p_ledger_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v_row public.wallet_ledger;
begin
  select * into v_row from public.wallet_ledger where id = p_ledger_id and entry_type = 'withdrawal' and stripe_ref = 'pending';
  if not found then
    raise exception 'No pending withdrawal ledger entry % found', p_ledger_id;
  end if;

  update public.profiles set wallet_balance_cents = wallet_balance_cents + (-v_row.amount_cents)
  where user_id = v_row.user_id;

  update public.wallet_ledger set stripe_ref = 'refunded_failed_transfer' where id = p_ledger_id;
end;
$$;

revoke execute on function public.refund_withdrawal(uuid) from public, anon, authenticated;
grant execute on function public.refund_withdrawal(uuid) to service_role;
