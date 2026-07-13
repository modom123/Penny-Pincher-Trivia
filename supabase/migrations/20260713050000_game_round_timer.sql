-- Per-game question timer. Staff choose how many seconds players get per
-- question when creating a game (default 12). The value is stamped onto every
-- round's time_limit_override_seconds, which start_round already honors
-- (coalesce(override, question default)). Server timing/anti-cheat is unchanged.

alter table public.games add column if not exists round_seconds int not null default 12;

-- admin_create_game gains a per-question timer (seconds, clamped 5-60) and an
-- auto-approve toggle. Auto-approve skips the review gate: the game is created
-- ready to run ('pending') instead of 'draft'.
drop function if exists public.admin_create_game(public.game_mode, public.payout_scheme);
create or replace function public.admin_create_game(
  p_mode public.game_mode default 'original_escalator',
  p_payout_scheme public.payout_scheme default 'standard',
  p_round_seconds int default 12,
  p_auto_approve boolean default false)
returns public.games
language plpgsql
security definer set search_path = public
as $$
declare
  v_game public.games;
  v_secs int := least(greatest(coalesce(p_round_seconds, 12), 5), 60);
  v_status text := case when p_auto_approve then 'pending' else 'draft' end;
begin
  if not public.is_staff(array['admin','support']) then
    raise exception 'Forbidden: staff access required';
  end if;
  v_game := public.create_game(p_mode);
  update public.games
    set payout_scheme = p_payout_scheme, round_seconds = v_secs, status = v_status
    where game_id = v_game.game_id returning * into v_game;
  update public.game_rounds
    set time_limit_override_seconds = v_secs
    where game_id = v_game.game_id;
  perform public.log_admin_action(
    case when p_auto_approve then 'create_game_auto' else 'create_game' end,
    null, v_game.game_id,
    jsonb_build_object('mode', p_mode, 'payoutScheme', p_payout_scheme,
      'roundSeconds', v_secs, 'autoApprove', p_auto_approve));
  return v_game;
end;
$$;
revoke execute on function public.admin_create_game(public.game_mode, public.payout_scheme, int, boolean) from public, anon;
grant execute on function public.admin_create_game(public.game_mode, public.payout_scheme, int, boolean) to authenticated;
