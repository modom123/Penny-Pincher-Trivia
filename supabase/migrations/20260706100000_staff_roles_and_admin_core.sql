create table public.staff_roles (
  user_id uuid not null references auth.users(id) on delete cascade,
  role varchar(20) not null, -- 'admin' | 'support' | 'compliance' | 'content_editor'
  created_at timestamptz not null default now(),
  primary key (user_id, role)
);
alter table public.staff_roles enable row level security;
-- Deliberately no client policies: staff role assignment is a service-role-only
-- action (done via the Supabase dashboard/SQL by a real admin), not self-service.

create table public.platform_config (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.platform_config enable row level security;
insert into public.platform_config (key, value) values ('blocked_states', '[]'::jsonb);

create table public.admin_audit_log (
  id uuid primary key default gen_random_uuid(),
  staff_user_id uuid not null references auth.users(id),
  action varchar(50) not null,
  target_user_id uuid,
  target_game_id uuid,
  details jsonb,
  created_at timestamptz not null default now()
);
alter table public.admin_audit_log enable row level security;

create table public.support_tickets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(user_id),
  subject varchar(200) not null,
  message text not null,
  status varchar(20) not null default 'open', -- open | in_progress | resolved
  assigned_staff_user_id uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.support_tickets enable row level security;

-- is_staff(): true if the calling user has ANY staff role, or a specific one
-- of required_roles if provided. SECURITY DEFINER + stable so it can be used
-- cheaply inside RLS policies without exposing staff_roles to clients.
create function public.is_staff(required_roles text[] default null)
returns boolean
language sql
security definer set search_path = public
stable
as $$
  select exists (
    select 1 from public.staff_roles sr
    where sr.user_id = auth.uid()
      and (required_roles is null or sr.role = any(required_roles))
  );
$$;
revoke execute on function public.is_staff(text[]) from public, anon;
grant execute on function public.is_staff(text[]) to authenticated, service_role;

create function public.log_admin_action(p_action varchar, p_target_user_id uuid, p_target_game_id uuid, p_details jsonb)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.admin_audit_log (staff_user_id, action, target_user_id, target_game_id, details)
  values (auth.uid(), p_action, p_target_user_id, p_target_game_id, p_details);
end;
$$;
revoke execute on function public.log_admin_action(varchar, uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.log_admin_action(varchar, uuid, uuid, jsonb) to service_role;
-- (called internally by other SECURITY DEFINER functions below, not directly by clients)

-- Staff read-access policies (in addition to players' own-row policies already in place).
create policy "profiles_select_staff" on public.profiles
  for select using (public.is_staff());
create policy "wallet_ledger_select_staff" on public.wallet_ledger
  for select using (public.is_staff(array['admin','compliance','support']));
create policy "cheat_flags_select_staff" on public.cheat_flags
  for select using (public.is_staff(array['admin','compliance']));
create policy "player_answers_select_staff" on public.player_answers
  for select using (public.is_staff(array['admin','compliance']));
-- Staff (content editors/admins) can read full question bank including correct_option;
-- players still have no policy on this table at all.
create policy "questions_all_staff" on public.questions
  for all using (public.is_staff(array['admin','content_editor']))
  with check (public.is_staff(array['admin','content_editor']));
create policy "game_rounds_select_staff" on public.game_rounds
  for select using (public.is_staff(array['admin','content_editor','compliance']));
create policy "platform_config_select_staff" on public.platform_config
  for select using (public.is_staff());
create policy "admin_audit_log_select_staff" on public.admin_audit_log
  for select using (public.is_staff(array['admin','compliance']));

-- support_tickets: players manage their own; staff (support/admin) see and update all.
create policy "support_tickets_select_own" on public.support_tickets
  for select using (auth.uid() = user_id or public.is_staff(array['admin','support']));
create policy "support_tickets_insert_own" on public.support_tickets
  for insert with check (auth.uid() = user_id);
create policy "support_tickets_update_staff" on public.support_tickets
  for update using (public.is_staff(array['admin','support']));
