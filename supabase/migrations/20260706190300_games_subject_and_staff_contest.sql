-- Link a game to the subject it was built from (single-subject contests), and give
-- staff a gated way to publish one from the command center.

alter table public.games add column subject_id uuid references public.subjects(id);

-- Rebuild create_game_for_subject to also stamp games.subject_id.
create or replace function public.create_game_for_subject(p_subject_id uuid)
returns public.games
language plpgsql
security definer set search_path = public
as $$
declare
  v_game public.games;
  v_short int;
begin
  if not exists (select 1 from public.subjects where id = p_subject_id and is_active) then
    raise exception 'Subject % not found or inactive', p_subject_id;
  end if;

  select count(*) into v_short
  from generate_series(3, 22) g
  where (select count(*) from public.questions
         where subject_id = p_subject_id and grade_level = g) < 5;
  if v_short > 0 then
    raise exception
      'Subject not ready: % grade level(s) have fewer than 5 approved questions', v_short;
  end if;

  insert into public.games (mode, subject_id) values ('original_escalator', p_subject_id) returning * into v_game;

  insert into public.game_rounds (game_id, round_number, question_id, cost_cents)
  with rounds as (
    select r as round_number,
           public.round_grade_level(r) as grade,
           ((r - 1) % 5) + 1 as slot
    from generate_series(1, 100) r
  ),
  ranked_q as (
    select grade_level, question_id,
           row_number() over (partition by grade_level order by random()) as rn
    from public.questions
    where subject_id = p_subject_id and grade_level between 3 and 22
  )
  select v_game.game_id, rd.round_number, rq.question_id, rd.round_number
  from rounds rd
  join ranked_q rq on rq.grade_level = rd.grade and rq.rn = rd.slot;

  return v_game;
end;
$$;
revoke execute on function public.create_game_for_subject(uuid) from public, anon, authenticated;
grant execute on function public.create_game_for_subject(uuid) to service_role;

-- Staff-gated wrapper so the command center can publish a subject contest.
-- Every action is written to the admin audit log (same pattern as other admin RPCs).
create or replace function public.admin_create_subject_contest(p_subject_id uuid)
returns public.games
language plpgsql
security definer set search_path = public
as $$
declare
  v_game public.games;
begin
  if not public.is_staff(array['admin','content_editor']) then
    raise exception 'Forbidden: staff access required';
  end if;

  v_game := public.create_game_for_subject(p_subject_id);

  insert into public.admin_audit_log (staff_user_id, action, target_game_id, details)
  values (auth.uid(), 'create_subject_contest', v_game.game_id,
          jsonb_build_object('subjectId', p_subject_id));

  return v_game;
end;
$$;
revoke execute on function public.admin_create_subject_contest(uuid) from public, anon;
grant execute on function public.admin_create_subject_contest(uuid) to authenticated;

-- Which subjects are ready to publish (>= 5 approved questions at every grade 3..22)?
-- Powers the "publish a themed contest" picker in the command center.
create or replace function public.subjects_ready_for_contest()
returns table (subject_id uuid, slug varchar, name varchar, domain varchar, min_per_grade bigint, ready boolean)
language sql
stable
security definer set search_path = public
as $$
  with per_grade as (
    select s.id, g.grade,
           (select count(*) from public.questions q
            where q.subject_id = s.id and q.grade_level = g.grade) as cnt
    from public.subjects s
    cross join generate_series(3, 22) as g(grade)
    where s.is_active
  )
  select s.id, s.slug, s.name, s.domain,
         min(pg.cnt) as min_per_grade,
         (min(pg.cnt) >= 5) as ready
  from public.subjects s
  join per_grade pg on pg.id = s.id
  group by s.id, s.slug, s.name, s.domain, s.sort_order
  order by (min(pg.cnt) >= 5) desc, s.sort_order;
$$;
revoke execute on function public.subjects_ready_for_contest() from public, anon;
grant execute on function public.subjects_ready_for_contest() to authenticated;
