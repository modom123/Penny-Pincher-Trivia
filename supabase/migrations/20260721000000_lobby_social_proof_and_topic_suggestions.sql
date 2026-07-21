-- Lobby social proof + player topic suggestions.
--
-- 1) list_game_players: who's signed up / playing a given game, for the Lobby
--    to show real names instead of the lobby feeling like a single-player screen.
-- 2) list_recent_winners: a live feed of actual recent payouts (real money,
--    real players) for a "recent winners" ticker. Deliberately reads only
--    real wallet_ledger 'payout' rows - no synthetic/fake activity, since this
--    is a real-money product and fabricating players/activity would be
--    misleading.
-- 3) my_compliance_status: add username, so the Lobby doesn't need a second
--    round trip just to render the player's own avatar initial.
-- 4) topic_suggestions: lightweight player-submitted "suggest a topic or
--    question" box, reviewed by staff in Command Center's Question Bank page
--    (same review-then-promote pattern as AI question_drafts, just simpler -
--    free text in, staff decide what becomes an actual question).

create or replace function public.list_game_players(p_game_id uuid)
returns table (
  user_id uuid,
  username text,
  total_score int,
  is_eliminated boolean
)
language sql
security definer set search_path = public
as $$
  select pgs.user_id, pr.username, pgs.total_score, pgs.is_eliminated
  from public.player_game_stats pgs
  join public.profiles pr on pr.user_id = pgs.user_id
  where pgs.game_id = p_game_id
  order by pgs.total_score desc, pr.username;
$$;
revoke execute on function public.list_game_players(uuid) from public, anon;
grant execute on function public.list_game_players(uuid) to authenticated;

create or replace function public.list_recent_winners(p_limit int default 15)
returns table (
  user_id uuid,
  username text,
  amount_cents int,
  game_id uuid,
  mode public.game_mode,
  created_at timestamptz
)
language sql
security definer set search_path = public
as $$
  select wl.user_id, pr.username, wl.amount_cents, wl.game_id, g.mode, wl.created_at
  from public.wallet_ledger wl
  join public.profiles pr on pr.user_id = wl.user_id
  join public.games g on g.game_id = wl.game_id
  where wl.entry_type = 'payout'
  order by wl.created_at desc
  limit least(greatest(coalesce(p_limit, 15), 1), 50);
$$;
revoke execute on function public.list_recent_winners(int) from public, anon;
grant execute on function public.list_recent_winners(int) to authenticated;

create or replace function public.my_compliance_status()
returns jsonb
language plpgsql
security definer set search_path = public
as $function$
declare
  v_p record; v_blocked jsonb; v_allowed jsonb; v_region_blocked boolean; v_geofence_enabled boolean;
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;
  select username, kyc_status, date_of_birth, lifetime_winnings_cents, tax_details_confirmed,
         region_state, wallet_balance_cents, promo_balance_cents,
         stripe_connect_account_id, stripe_connect_payouts_enabled
  into v_p from public.profiles where user_id = auth.uid();

  select coalesce((value)::boolean, true) into v_geofence_enabled
  from public.platform_config where key = 'geofence_enabled';
  v_geofence_enabled := coalesce(v_geofence_enabled, true);

  select value into v_blocked from public.platform_config where key = 'blocked_states';
  select value into v_allowed from public.platform_config where key = 'allowed_states';

  v_region_blocked := v_geofence_enabled and v_p.region_state is not null and (
    (v_allowed is not null and jsonb_array_length(v_allowed) > 0 and not (v_allowed ? v_p.region_state))
    or (v_blocked ? v_p.region_state)
  );

  return jsonb_build_object(
    'username', v_p.username,
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
    'stripeConnectLinked', v_p.stripe_connect_account_id is not null,
    'stripeConnectPayoutsEnabled', coalesce(v_p.stripe_connect_payouts_enabled, false)
  );
end;
$function$;

revoke execute on function public.my_compliance_status() from public, anon, authenticated;
grant execute on function public.my_compliance_status() to authenticated;

create table public.topic_suggestions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  suggestion_text text not null check (char_length(suggestion_text) between 3 and 500),
  status varchar(20) not null default 'new', -- new | reviewed | dismissed
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.topic_suggestions enable row level security;

create policy "topic_suggestions_own_insert" on public.topic_suggestions
  for insert with check (auth.uid() = user_id);
create policy "topic_suggestions_own_select" on public.topic_suggestions
  for select using (auth.uid() = user_id);
create policy "topic_suggestions_staff_all" on public.topic_suggestions
  for all using (public.is_staff(array['admin','content_editor']))
  with check (public.is_staff(array['admin','content_editor']));

create or replace function public.submit_topic_suggestion(p_text text)
returns public.topic_suggestions
language plpgsql
security definer set search_path = public
as $$
declare
  v_row public.topic_suggestions;
  v_trimmed text := trim(coalesce(p_text, ''));
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;
  if char_length(v_trimmed) < 3 then
    raise exception 'Please enter a bit more detail (at least 3 characters).';
  end if;
  if char_length(v_trimmed) > 500 then
    raise exception 'Keep it under 500 characters.';
  end if;
  insert into public.topic_suggestions (user_id, suggestion_text)
  values (auth.uid(), v_trimmed)
  returning * into v_row;
  return v_row;
end;
$$;
revoke execute on function public.submit_topic_suggestion(text) from public, anon;
grant execute on function public.submit_topic_suggestion(text) to authenticated;

create or replace function public.admin_set_topic_suggestion_status(p_id uuid, p_status text)
returns public.topic_suggestions
language plpgsql
security definer set search_path = public
as $$
declare
  v_row public.topic_suggestions;
begin
  if not public.is_staff(array['admin','content_editor']) then
    raise exception 'Forbidden: staff access required';
  end if;
  if p_status not in ('new','reviewed','dismissed') then
    raise exception 'Invalid status: %', p_status;
  end if;
  update public.topic_suggestions
    set status = p_status, reviewed_by = auth.uid(), reviewed_at = now()
    where id = p_id
    returning * into v_row;
  if not found then raise exception 'Suggestion not found'; end if;
  return v_row;
end;
$$;
revoke execute on function public.admin_set_topic_suggestion_status(uuid, text) from public, anon;
grant execute on function public.admin_set_topic_suggestion_status(uuid, text) to authenticated;
