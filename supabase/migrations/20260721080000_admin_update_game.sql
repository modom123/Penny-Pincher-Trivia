-- Lets staff edit a tournament's configuration while it's still waiting to
-- launch (draft, or registration with nobody signed up yet / signed up but
-- not exceeding a lowered min_players). Mirrors admin_create_game's field
-- set and validation, minus p_auto_approve (status isn't touched here).
create or replace function public.admin_update_game(
  p_game_id uuid,
  p_mode game_mode,
  p_payout_scheme payout_scheme,
  p_round_seconds integer,
  p_min_buy_in_tokens integer default null,
  p_max_buy_in_tokens integer default null,
  p_reup_cutoff_round integer default 30,
  p_min_players integer default 3
)
returns games
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_game public.games;
  v_secs int := least(greatest(coalesce(p_round_seconds, 12), 5), 60);
  v_cutoff int := least(greatest(coalesce(p_reup_cutoff_round, 30), 1), 100);
  v_min_players int := greatest(coalesce(p_min_players, 3), 1);
  v_player_count int;
begin
  if not public.is_staff(array['admin','support']) then
    raise exception 'Forbidden: staff access required';
  end if;

  select * into v_game from public.games where game_id = p_game_id for update;
  if not found then
    raise exception 'Game not found';
  end if;
  if v_game.status not in ('draft', 'registration') then
    raise exception 'Only a draft or registration-stage game can be edited (this game is %)', v_game.status;
  end if;

  select count(*)::int into v_player_count from public.player_game_stats where game_id = p_game_id;

  if v_player_count > 0 and p_mode is distinct from v_game.mode then
    raise exception 'Cannot change game mode after % player(s) have already registered', v_player_count;
  end if;
  if v_min_players < v_player_count then
    raise exception 'Min players (%) cannot be less than the % player(s) already registered', v_min_players, v_player_count;
  end if;
  if p_min_buy_in_tokens is not null and p_max_buy_in_tokens is not null
     and p_min_buy_in_tokens > p_max_buy_in_tokens then
    raise exception 'min_buy_in_tokens (%) cannot exceed max_buy_in_tokens (%)', p_min_buy_in_tokens, p_max_buy_in_tokens;
  end if;

  -- Only reachable when v_player_count = 0 (guarded above), so nobody has
  -- paid a round cost under the old mode's pricing yet.
  if p_mode is distinct from v_game.mode then
    update public.game_rounds
      set cost_cents = case p_mode
        when 'milestone_booster' then
          case
            when round_number <= 25 then 10
            when round_number <= 50 then 25
            when round_number <= 75 then 50
            else 100
          end
        else round_number
      end
      where game_id = p_game_id;
  end if;

  update public.games
    set mode = p_mode, payout_scheme = p_payout_scheme, round_seconds = v_secs,
        min_buy_in_tokens = p_min_buy_in_tokens, max_buy_in_tokens = p_max_buy_in_tokens,
        reup_cutoff_round = v_cutoff, min_players = v_min_players
    where game_id = p_game_id returning * into v_game;

  update public.game_rounds
    set time_limit_override_seconds = v_secs
    where game_id = p_game_id;

  perform public.log_admin_action('update_game', null, p_game_id,
    jsonb_build_object('mode', p_mode, 'payoutScheme', p_payout_scheme,
      'roundSeconds', v_secs, 'minBuyInTokens', p_min_buy_in_tokens,
      'maxBuyInTokens', p_max_buy_in_tokens, 'reupCutoffRound', v_cutoff,
      'minPlayers', v_min_players));

  return v_game;
end;
$$;

revoke all on function public.admin_update_game(uuid, game_mode, payout_scheme, integer, integer, integer, integer, integer) from public, anon, authenticated;
grant execute on function public.admin_update_game(uuid, game_mode, payout_scheme, integer, integer, integer, integer, integer) to authenticated;
