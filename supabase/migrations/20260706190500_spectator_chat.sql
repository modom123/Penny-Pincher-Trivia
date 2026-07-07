-- Spectator chat for the "Climax": during a live game (and its Sudden Death
-- Overtime), players and spectators can text-chat while watching the finalists.
-- Persisted (moderation + history) with the username snapshotted at post time so
-- readers never need cross-user profile access. Delivery is via Supabase Realtime
-- postgres_changes on this table (added to the publication below).

create table public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.games(game_id) on delete cascade,
  user_id uuid not null references public.profiles(user_id),
  username varchar(50) not null,   -- snapshot: readers don't need profiles RLS access
  body varchar(280) not null,
  created_at timestamptz not null default now()
);
create index idx_chat_messages_game on public.chat_messages(game_id, created_at);

alter table public.chat_messages enable row level security;
-- Any signed-in user can read a game's chat (players + spectators).
create policy "chat_read_authenticated" on public.chat_messages
  for select using (auth.uid() is not null);
-- No direct client inserts; posting goes through post_chat_message (validation +
-- rate limit + username snapshot), so there is no INSERT policy.

-- Post a chat message. Auth required; body trimmed to 1..280 chars; the game must
-- be live ('active', which also covers Sudden Death Overtime). Light rate limit:
-- at most one message every 2 seconds per user, and not while suspended.
create function public.post_chat_message(p_game_id uuid, p_body text)
returns public.chat_messages
language plpgsql
security definer set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_username varchar;
  v_suspended boolean;
  v_status varchar;
  v_body text := btrim(coalesce(p_body, ''));
  v_row public.chat_messages;
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;
  if length(v_body) = 0 then
    raise exception 'Message is empty';
  end if;
  if length(v_body) > 280 then
    v_body := left(v_body, 280);
  end if;

  select username, is_suspended into v_username, v_suspended
  from public.profiles where user_id = v_user_id;
  if v_suspended then
    raise exception 'Account suspended';
  end if;

  select status into v_status from public.games where game_id = p_game_id;
  if v_status is null then
    raise exception 'Game not found';
  end if;
  if v_status <> 'active' then
    raise exception 'Chat is only open during a live game';
  end if;

  if exists (
    select 1 from public.chat_messages
    where user_id = v_user_id and created_at > now() - interval '2 seconds'
  ) then
    raise exception 'You are sending messages too fast. Slow down a moment.';
  end if;

  insert into public.chat_messages (game_id, user_id, username, body)
  values (p_game_id, v_user_id, v_username, v_body)
  returning * into v_row;
  return v_row;
end;
$$;
revoke execute on function public.post_chat_message(uuid, text) from public, anon;
grant execute on function public.post_chat_message(uuid, text) to authenticated;

-- Staff moderation: delete a message.
create function public.staff_delete_chat_message(p_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  if not public.is_staff(array['admin','support','compliance']) then
    raise exception 'Forbidden: staff access required';
  end if;
  delete from public.chat_messages where id = p_id;
end;
$$;
revoke execute on function public.staff_delete_chat_message(uuid) from public, anon;
grant execute on function public.staff_delete_chat_message(uuid) to authenticated;

-- Enable Realtime delivery for chat inserts. Guarded so it is a no-op if the
-- table is already published (or the publication is configured differently).
do $$
begin
  alter publication supabase_realtime add table public.chat_messages;
exception when others then
  -- publication missing / already a member / "for all tables" — safe to ignore
  null;
end $$;
