-- Trustly deposits move over ACH, which can bounce DAYS after an initial
-- "pending success" (e.g. an R01 insufficient-funds return) - unlike a card
-- charge, a bank-pull isn't reliably final the moment it's captured. Per
-- Trustly's own docs: "If a credit notification has been sent but Trustly
-- never receives the funds, a debit notification is sent to the merchant's
-- NotificationURL." Without handling that, a bad account would mean
-- permanently-free tokens. See trustly-webhook's debit-notification branch.
--
-- *** VERIFY *** same caveat as the rest of the Trustly integration: the
-- exact notification field names that trigger this path are not confirmed
-- against a live sandbox.
create or replace function public.reverse_trustly_credit(p_user_id uuid, p_cents integer, p_notification_id text)
returns jsonb
language plpgsql
security definer set search_path = public
as $function$
declare
  v_balance int;
begin
  if coalesce(p_cents, 0) <= 0 then
    raise exception 'cents must be positive';
  end if;

  insert into public.processed_trustly_notifications (notification_id) values (p_notification_id)
  on conflict do nothing;
  if not found then
    return jsonb_build_object('reversed', false, 'duplicate', true);
  end if;

  -- Clawing back a bounced deposit can take a wallet negative if it's already
  -- been spent - that's an expected, real possibility for a bounced ACH pull,
  -- not a bug; it's a receivable against the player, same as any bank would
  -- treat an overdraft from a returned deposit.
  update public.profiles
  set wallet_balance_cents = wallet_balance_cents - p_cents
  where user_id = p_user_id
  returning wallet_balance_cents into v_balance;
  if not found then
    raise exception 'User % not found', p_user_id;
  end if;

  insert into public.wallet_ledger (user_id, entry_type, amount_cents, processor, trustly_ref)
  values (p_user_id, 'deposit_reversed', -p_cents, 'trustly', p_notification_id);

  return jsonb_build_object('reversed', true, 'wallet_balance_cents', v_balance);
end;
$function$;
revoke execute on function public.reverse_trustly_credit(uuid, integer, text) from public, anon, authenticated;
grant execute on function public.reverse_trustly_credit(uuid, integer, text) to service_role;
