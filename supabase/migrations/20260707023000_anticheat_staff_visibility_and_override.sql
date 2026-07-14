-- Anti-cheat & fairness: give staff visibility into cheat_flags and a path to
-- reverse a disqualification.
--
-- submit_answer already does the real-time enforcement (server-clock-only
-- timing, input-velocity flags at 300ms/150ms-on-high-value-rounds thresholds,
-- auto-disqualification from the grand prize after 3 flags or 2 high-value
-- flags — reconciled from production in 20260707019000). What was missing: once
-- a player is flagged or disqualified, staff have NO way to see who, why, or in
-- which game, and a player who trips the heuristic on a false positive (fast
-- reflexes, not cheating) has no path back to grand-prize eligibility. For a
-- real-money product that's a support/trust gap, not just a nice-to-have.

-- Staff view: flagged players with their flag history and current standing, so
-- support/admin can review a case without hand-querying the database.
create or replace function public.admin_list_cheat_flags(p_game_id uuid default null, p_limit int default 100)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
begin
  if not public.is_staff(array['admin','support']) then
    raise exception 'Forbidden: staff access required';
  end if;

  return coalesce((
    select jsonb_agg(row_to_json(t))
    from (
      select
        cf.user_id,
        pr.username,
        cf.game_id,
        g.mode,
        count(*) as flag_count,
        jsonb_agg(jsonb_build_object('roundNumber', cf.round_number, 'reason', cf.reason, 'createdAt', cf.created_at) order by cf.created_at) as flags,
        pgs.is_eligible_for_grand_prize,
        pgs.is_eliminated
      from public.cheat_flags cf
      join public.profiles pr on pr.user_id = cf.user_id
      join public.games g on g.game_id = cf.game_id
      left join public.player_game_stats pgs on pgs.user_id = cf.user_id and pgs.game_id = cf.game_id
      where p_game_id is null or cf.game_id = p_game_id
      group by cf.user_id, pr.username, cf.game_id, g.mode, pgs.is_eligible_for_grand_prize, pgs.is_eliminated
      order by count(*) desc, max(cf.created_at) desc
      limit p_limit
    ) t
  ), '[]'::jsonb);
end;
$$;
revoke execute on function public.admin_list_cheat_flags(uuid, int) from public, anon;
grant execute on function public.admin_list_cheat_flags(uuid, int) to authenticated;


-- Staff override: reinstate a player's grand-prize eligibility after review
-- (e.g. the velocity heuristic false-positived on a genuinely fast player).
-- Does not clear the underlying cheat_flags rows — the audit trail stays intact
-- so a repeat reinstatement request is visible in context.
create or replace function public.admin_reinstate_eligibility(p_user_id uuid, p_game_id uuid, p_reason text default null)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_updated boolean;
begin
  if not public.is_staff(array['admin','support']) then
    raise exception 'Forbidden: staff access required';
  end if;

  update public.player_game_stats
  set is_eligible_for_grand_prize = true
  where user_id = p_user_id and game_id = p_game_id
  returning true into v_updated;

  if not v_updated then
    raise exception 'No player_game_stats row for that user/game';
  end if;

  perform public.log_admin_action('reinstate_eligibility', p_user_id, p_game_id,
    jsonb_build_object('reason', p_reason));

  return jsonb_build_object('reinstated', true, 'userId', p_user_id, 'gameId', p_game_id);
end;
$$;
revoke execute on function public.admin_reinstate_eligibility(uuid, uuid, text) from public, anon;
grant execute on function public.admin_reinstate_eligibility(uuid, uuid, text) to authenticated;
