-- Username gate: every player picks a unique username we can track them by.
-- Email signups still pass one at signup; OAuth (Google) users don't, so we mark
-- profiles with username_set=false and the app makes them choose one before play.

alter table public.profiles add column if not exists username_set boolean not null default false;

-- Existing accounts already have usable usernames — don't force them to re-pick.
update public.profiles set username_set = true where username_set = false;

-- On signup, record whether a username was actually supplied (email flow) vs a
-- placeholder (OAuth). handle_new_user is trigger-only.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (user_id, username, username_set)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'username', 'player_' || substr(new.id::text, 1, 8)),
    (new.raw_user_meta_data->>'username') is not null
  );
  return new;
end;
$$;
revoke execute on function public.handle_new_user() from public, anon, authenticated, service_role;

-- Let a signed-in player claim a username (validated + unique, case-insensitive).
create or replace function public.set_username(p_username text)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_clean text;
begin
  if v_uid is null then raise exception 'Not authenticated'; end if;
  v_clean := trim(p_username);
  if v_clean !~ '^[A-Za-z0-9_]{3,20}$' then
    raise exception 'USERNAME_INVALID: use 3-20 letters, numbers, or underscores';
  end if;
  if exists (
    select 1 from public.profiles
    where lower(username) = lower(v_clean) and user_id <> v_uid
  ) then
    raise exception 'USERNAME_TAKEN: that username is already in use';
  end if;
  update public.profiles set username = v_clean, username_set = true where user_id = v_uid;
  return jsonb_build_object('username', v_clean);
end;
$$;
revoke execute on function public.set_username(text) from public, anon;
grant execute on function public.set_username(text) to authenticated;

-- Include usernames in the live end_round leaderboard so the in-game finalists
-- list shows real names instead of a truncated user id.
create or replace function public.end_round(p_game_id uuid, p_round_number int)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_correct varchar(1);
  v_total_rounds int;
  v_pool int;
  v_leaderboard jsonb;
begin
  update public.game_rounds set ended_at = now()
  where game_id = p_game_id and round_number = p_round_number;

  select q.correct_option into v_correct
  from public.game_rounds gr join public.questions q using (question_id)
  where gr.game_id = p_game_id and gr.round_number = p_round_number;

  select total_rounds, total_prize_pool_cents into v_total_rounds, v_pool
  from public.games where game_id = p_game_id;

  select coalesce(jsonb_agg(jsonb_build_object('userId', user_id, 'username', username, 'score', total_score)), '[]'::jsonb)
  into v_leaderboard
  from (
    select pgs.user_id, pr.username, pgs.total_score
    from public.player_game_stats pgs join public.profiles pr on pr.user_id = pgs.user_id
    where pgs.game_id = p_game_id order by pgs.total_score desc limit 10
  ) top;

  return jsonb_build_object(
    'roundNumber', p_round_number,
    'correctOption', v_correct,
    'leaderboard', v_leaderboard,
    'totalPrizePoolCents', v_pool,
    'isFinalRound', p_round_number >= v_total_rounds
  );
end;
$$;
revoke execute on function public.end_round(uuid, int) from public, anon, authenticated;
grant execute on function public.end_round(uuid, int) to service_role;
