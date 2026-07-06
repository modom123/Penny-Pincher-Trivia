-- Staff (admin/compliance) manual KYC override, for handling edge cases the
-- automated vendor flow can't resolve. Logged to the audit trail.
create function public.admin_set_kyc_status(p_user_id uuid, p_status varchar)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.is_staff(array['admin','compliance']) then
    raise exception 'Forbidden: staff access required';
  end if;
  if p_status not in ('unverified','pending','verified','rejected') then
    raise exception 'Invalid kyc status';
  end if;
  update public.profiles set
    kyc_status = p_status,
    kyc_verified_at = case when p_status = 'verified' then now() else kyc_verified_at end
  where user_id = p_user_id;
  perform public.log_admin_action('set_kyc_status', p_user_id, null, jsonb_build_object('status', p_status));
end;
$$;
revoke execute on function public.admin_set_kyc_status(uuid, varchar) from public, anon;
grant execute on function public.admin_set_kyc_status(uuid, varchar) to authenticated;
