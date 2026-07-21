-- Push-notification infrastructure for "your tournament is starting soon"
-- reminders. A registered player gets alerted twice: 4 hours before
-- scheduled_start_at and again 30 minutes before. Each threshold is tracked
-- per-game (not per-player) so a single scheduled sweep sends to everyone
-- registered at once and never double-sends once the flag is set.
alter table public.profiles add column if not exists expo_push_token text;
alter table public.games add column if not exists reminder_4h_sent_at timestamptz;
alter table public.games add column if not exists reminder_30m_sent_at timestamptz;

-- Self-service: a player's own device registers/updates its push token.
create or replace function public.update_push_token(p_token text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;
  update public.profiles set expo_push_token = nullif(trim(coalesce(p_token, '')), '')
  where user_id = v_user_id;
end;
$$;

revoke all on function public.update_push_token(text) from public, anon, authenticated;
grant execute on function public.update_push_token(text) to authenticated;

-- Server-side lookup for the reminders edge function: which registration-stage
-- games cross the 4h or 30m threshold and haven't been notified for it yet,
-- plus every registered player's push token for that game.
create or replace function public.games_due_for_start_reminder(p_window_minutes integer)
returns table(game_id uuid, mode game_mode, scheduled_start_at timestamptz)
language sql
stable
security definer
set search_path to 'public'
as $$
  select g.game_id, g.mode, g.scheduled_start_at
  from public.games g
  where g.status = 'registration'
    and g.scheduled_start_at is not null
    and g.scheduled_start_at > now()
    and g.scheduled_start_at <= now() + make_interval(mins => p_window_minutes)
    and (
      (p_window_minutes = 240 and g.reminder_4h_sent_at is null)
      or (p_window_minutes = 30 and g.reminder_30m_sent_at is null)
    );
$$;

revoke all on function public.games_due_for_start_reminder(integer) from public, anon, authenticated;

create or replace function public.mark_start_reminder_sent(p_game_id uuid, p_window_minutes integer)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if p_window_minutes = 240 then
    update public.games set reminder_4h_sent_at = now() where game_id = p_game_id;
  elsif p_window_minutes = 30 then
    update public.games set reminder_30m_sent_at = now() where game_id = p_game_id;
  end if;
end;
$$;

revoke all on function public.mark_start_reminder_sent(uuid, integer) from public, anon, authenticated;

create or replace function public.list_push_tokens_for_game(p_game_id uuid)
returns table(user_id uuid, expo_push_token text)
language sql
stable
security definer
set search_path to 'public'
as $$
  select p.user_id, p.expo_push_token
  from public.player_game_stats pgs
  join public.profiles p on p.user_id = pgs.user_id
  where pgs.game_id = p_game_id and p.expo_push_token is not null;
$$;

revoke all on function public.list_push_tokens_for_game(uuid) from public, anon, authenticated;
