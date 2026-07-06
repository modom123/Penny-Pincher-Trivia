create function public.admin_start_sudden_death_round(p_game_id uuid)
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
  v_result := public.start_sudden_death_round(p_game_id);
  perform public.log_admin_action('start_sudden_death_round', null, p_game_id, v_result);
  return v_result;
end;
$$;
revoke execute on function public.admin_start_sudden_death_round(uuid) from public, anon;
grant execute on function public.admin_start_sudden_death_round(uuid) to authenticated;
