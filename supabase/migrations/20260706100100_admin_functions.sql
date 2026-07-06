-- Staff-gated admin actions, callable from the command center as the logged-in
-- staff member (auth.uid() must be in staff_roles with the right role). Every
-- action is written to admin_audit_log for accountability.

create function public.admin_create_game()
returns public.games
language plpgsql
security definer set search_path = public
as $$
declare
  v_game public.games;
begin
  if not public.is_staff(array['admin','support']) then
    raise exception 'Forbidden: staff access required';
  end if;
  v_game := public.create_game();
  perform public.log_admin_action('create_game', null, v_game.game_id, null);
  return v_game;
end;
$$;
revoke execute on function public.admin_create_game() from public, anon;
grant execute on function public.admin_create_game() to authenticated;


create function public.admin_force_payout(p_game_id uuid)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_result jsonb;
begin
  if not public.is_staff(array['admin']) then
    raise exception 'Forbidden: admin access required';
  end if;
  v_result := public.payout_game(p_game_id);
  perform public.log_admin_action('force_payout', null, p_game_id, v_result);
  return v_result;
end;
$$;
revoke execute on function public.admin_force_payout(uuid) from public, anon;
grant execute on function public.admin_force_payout(uuid) to authenticated;


create function public.admin_credit_wallet(p_user_id uuid, p_cents int, p_reason text)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_balance int;
begin
  if not public.is_staff(array['admin','support']) then
    raise exception 'Forbidden: staff access required';
  end if;
  if p_cents is null or p_cents = 0 then
    raise exception 'cents must be a non-zero integer (positive credit or negative debit)';
  end if;

  update public.profiles set wallet_balance_cents = greatest(wallet_balance_cents + p_cents, 0)
  where user_id = p_user_id
  returning wallet_balance_cents into v_balance;
  if not found then
    raise exception 'User % not found', p_user_id;
  end if;

  insert into public.wallet_ledger (user_id, entry_type, amount_cents, stripe_ref)
  values (p_user_id, 'admin_adjustment', p_cents, coalesce(p_reason, 'admin_adjustment'));

  perform public.log_admin_action('credit_wallet', p_user_id, null, jsonb_build_object('cents', p_cents, 'reason', p_reason));

  return jsonb_build_object('wallet_balance_cents', v_balance);
end;
$$;
revoke execute on function public.admin_credit_wallet(uuid, int, text) from public, anon;
grant execute on function public.admin_credit_wallet(uuid, int, text) to authenticated;


create function public.admin_suspend_account(p_user_id uuid, p_suspend boolean, p_reason text)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  if not public.is_staff(array['admin','compliance']) then
    raise exception 'Forbidden: staff access required';
  end if;

  update public.profiles set is_suspended = p_suspend where user_id = p_user_id;
  if not found then
    raise exception 'User % not found', p_user_id;
  end if;

  perform public.log_admin_action(
    case when p_suspend then 'suspend_account' else 'reinstate_account' end,
    p_user_id, null, jsonb_build_object('reason', p_reason)
  );
end;
$$;
revoke execute on function public.admin_suspend_account(uuid, boolean, text) from public, anon;
grant execute on function public.admin_suspend_account(uuid, boolean, text) to authenticated;


create function public.admin_update_blocked_states(p_states text[])
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  if not public.is_staff(array['admin','compliance']) then
    raise exception 'Forbidden: staff access required';
  end if;

  update public.platform_config set value = to_jsonb(p_states), updated_at = now()
  where key = 'blocked_states';

  perform public.log_admin_action('update_blocked_states', null, null, jsonb_build_object('states', p_states));
end;
$$;
revoke execute on function public.admin_update_blocked_states(text[]) from public, anon;
grant execute on function public.admin_update_blocked_states(text[]) to authenticated;


create function public.admin_upsert_question(
  p_question_id uuid, p_question_text text, p_options jsonb, p_correct_option varchar,
  p_difficulty_level int, p_category varchar, p_time_limit_seconds int
)
returns public.questions
language plpgsql
security definer set search_path = public
as $$
declare
  v_question public.questions;
begin
  if not public.is_staff(array['admin','content_editor']) then
    raise exception 'Forbidden: staff access required';
  end if;

  if p_question_id is null then
    insert into public.questions (question_text, options, correct_option, difficulty_level, category, time_limit_seconds)
    values (p_question_text, p_options, p_correct_option, p_difficulty_level, p_category, coalesce(p_time_limit_seconds, 12))
    returning * into v_question;
  else
    update public.questions set
      question_text = p_question_text,
      options = p_options,
      correct_option = p_correct_option,
      difficulty_level = p_difficulty_level,
      category = p_category,
      time_limit_seconds = coalesce(p_time_limit_seconds, 12)
    where question_id = p_question_id
    returning * into v_question;
  end if;

  perform public.log_admin_action('upsert_question', null, null, jsonb_build_object('question_id', v_question.question_id));
  return v_question;
end;
$$;
revoke execute on function public.admin_upsert_question(uuid, text, jsonb, varchar, int, varchar, int) from public, anon;
grant execute on function public.admin_upsert_question(uuid, text, jsonb, varchar, int, varchar, int) to authenticated;


create function public.admin_update_ticket(p_ticket_id uuid, p_status varchar, p_assign_to_self boolean)
returns public.support_tickets
language plpgsql
security definer set search_path = public
as $$
declare
  v_ticket public.support_tickets;
begin
  if not public.is_staff(array['admin','support']) then
    raise exception 'Forbidden: staff access required';
  end if;

  update public.support_tickets set
    status = coalesce(p_status, status),
    assigned_staff_user_id = case when p_assign_to_self then auth.uid() else assigned_staff_user_id end,
    updated_at = now()
  where id = p_ticket_id
  returning * into v_ticket;
  if not found then
    raise exception 'Ticket % not found', p_ticket_id;
  end if;

  perform public.log_admin_action('update_ticket', v_ticket.user_id, null, jsonb_build_object('ticket_id', p_ticket_id, 'status', p_status));
  return v_ticket;
end;
$$;
revoke execute on function public.admin_update_ticket(uuid, varchar, boolean) from public, anon;
grant execute on function public.admin_update_ticket(uuid, varchar, boolean) to authenticated;
