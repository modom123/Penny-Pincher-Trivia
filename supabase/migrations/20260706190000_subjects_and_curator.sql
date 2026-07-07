-- Curator engine schema: a first-class subject taxonomy + a grade-based difficulty
-- model so "500 subjects x 500 questions" is structured, queryable, and its
-- curation progress is measurable.
--
-- Difficulty model (per the design): 20 levels, one school GRADE per level,
-- starting at 3rd grade and going up a grade each level -> grade_level 3..22
-- (3-12 school, 13-16 college, 17-22 graduate/expert). A 100-round game spends
-- 5 rounds per level (20 x 5 = 100). Bank target: 25 questions per subject per
-- grade_level x 20 levels = 500 per subject. The 25 candidates per level feed the
-- 5 rounds at that level with variety and randomization.

create table public.subjects (
  id uuid primary key default gen_random_uuid(),
  slug varchar(80) unique not null,
  name varchar(120) not null,
  domain varchar(80) not null,          -- top-level grouping (e.g. "Science & Nature")
  description text,
  sort_order int not null default 0,
  is_active boolean not null default true,
  target_question_count int not null default 500,   -- 25 per grade_level x 20 levels
  created_at timestamptz not null default now()
);
create index idx_subjects_domain on public.subjects(domain);

-- Grade-based difficulty on questions (live bank) and drafts (staging), plus the
-- subject link. All nullable so the existing 100 placeholder rows / legacy
-- free-text `category` rows stay valid; the old difficulty_level 1..100 column is
-- kept for backward compatibility with the legacy create_game path.
alter table public.questions
  add column subject_id uuid references public.subjects(id),
  add column grade_level int check (grade_level between 3 and 22);
alter table public.question_drafts
  add column subject_id uuid references public.subjects(id),
  add column grade_level int check (grade_level between 3 and 22);
create index idx_questions_subject_grade on public.questions(subject_id, grade_level);
create index idx_question_drafts_subject_grade on public.question_drafts(subject_id, grade_level);

-- Dedup guard for the curator: normalize the question text and block the same
-- question being drafted twice for the same subject. md5(lower(trimmed)) is
-- immutable, so it works as a STORED generated column. NULL subject_id rows
-- (legacy/manual) are exempt because NULLs are distinct in a unique index.
alter table public.question_drafts
  add column content_hash text generated always as (md5(lower(btrim(question_text)))) stored;
create unique index uq_question_drafts_subject_content
  on public.question_drafts(subject_id, content_hash)
  where subject_id is not null;

-- Round -> grade mapping for a 100-round game: 5 rounds per grade, starting at
-- grade 3. Round 1..5 -> grade 3, 6..10 -> grade 4, ..., 96..100 -> grade 22.
create or replace function public.round_grade_level(p_round int)
returns int
language sql immutable
as $$
  select 3 + ((greatest(least(p_round, 100), 1) - 1) / 5);
$$;

alter table public.subjects enable row level security;
-- Any signed-in user can read the taxonomy (clients show subject names/pickers).
create policy "subjects_read_authenticated" on public.subjects
  for select using (auth.uid() is not null);
-- Only staff (admin/content_editor) can edit the taxonomy.
create policy "subjects_write_staff" on public.subjects
  for all using (public.is_staff(array['admin','content_editor']))
  with check (public.is_staff(array['admin','content_editor']));


-- promote_question_draft: carry the draft's subject_id + grade_level onto the
-- promoted live question.
create or replace function public.promote_question_draft(p_draft_id uuid)
returns public.questions
language plpgsql
security definer set search_path = public
as $$
declare
  v_draft public.question_drafts;
  v_question public.questions;
begin
  if not public.is_staff(array['admin','content_editor']) then
    raise exception 'Forbidden: staff access required';
  end if;

  select * into v_draft from public.question_drafts where id = p_draft_id for update;
  if not found then
    raise exception 'Draft % not found', p_draft_id;
  end if;
  if v_draft.status = 'approved' then
    raise exception 'Draft already approved';
  end if;

  v_question := public.admin_upsert_question(
    null, v_draft.question_text, v_draft.options, v_draft.correct_option,
    v_draft.difficulty_level, v_draft.category, v_draft.time_limit_seconds
  );

  update public.questions
  set subject_id = v_draft.subject_id, grade_level = v_draft.grade_level
  where question_id = v_question.question_id;

  update public.question_drafts set status = 'approved', reviewed_by = auth.uid(), reviewed_at = now()
  where id = p_draft_id;

  select * into v_question from public.questions where question_id = v_question.question_id;
  return v_question;
end;
$$;
revoke execute on function public.promote_question_draft(uuid) from public, anon;
grant execute on function public.promote_question_draft(uuid) to authenticated;


-- Create a single-subject game: fill all 100 rounds from ONE subject, round R
-- getting a random APPROVED question at that round's grade level. Requires the
-- subject to be fully covered (>=1 approved question at every grade 3..22).
-- Mirrors the flat-rate escalator pricing (round N costs N cents).
create or replace function public.create_game_for_subject(p_subject_id uuid)
returns public.games
language plpgsql
security definer set search_path = public
as $$
declare
  v_game public.games;
  v_missing int;
begin
  if not exists (select 1 from public.subjects where id = p_subject_id and is_active) then
    raise exception 'Subject % not found or inactive', p_subject_id;
  end if;

  -- Every grade 3..22 must have at least one approved question for this subject.
  select count(*) into v_missing
  from generate_series(3, 22) g
  where not exists (
    select 1 from public.questions
    where subject_id = p_subject_id and grade_level = g
  );
  if v_missing > 0 then
    raise exception 'Subject not ready: % grade level(s) have no approved questions yet', v_missing;
  end if;

  insert into public.games (mode) values ('original_escalator') returning * into v_game;

  insert into public.game_rounds (game_id, round_number, question_id, cost_cents)
  select v_game.game_id, r.round_number, q.question_id, r.round_number
  from generate_series(1, 100) as r(round_number)
  cross join lateral (
    select question_id from public.questions
    where subject_id = p_subject_id and grade_level = public.round_grade_level(r.round_number)
    order by random() limit 1
  ) q;

  return v_game;
end;
$$;
revoke execute on function public.create_game_for_subject(uuid) from public, anon, authenticated;
grant execute on function public.create_game_for_subject(uuid) to service_role;


-- Curation coverage (staff dashboard): how full is each subject's bank, live vs.
-- pending review, and how many of the 20 grade levels are covered.
create or replace function public.subject_curation_status()
returns table (
  subject_id uuid,
  slug varchar,
  name varchar,
  domain varchar,
  target_question_count int,
  approved_count bigint,
  pending_count bigint,
  rejected_count bigint,
  grade_levels_covered bigint
)
language sql
stable
security definer set search_path = public
as $$
  select
    s.id, s.slug, s.name, s.domain, s.target_question_count,
    coalesce(q.approved_count, 0),
    coalesce(d.pending_count, 0),
    coalesce(d.rejected_count, 0),
    coalesce(q.levels_covered, 0)
  from public.subjects s
  left join (
    select subject_id,
           count(*) as approved_count,
           count(distinct grade_level) as levels_covered
    from public.questions where subject_id is not null
    group by subject_id
  ) q on q.subject_id = s.id
  left join (
    select subject_id,
           count(*) filter (where status = 'pending_review') as pending_count,
           count(*) filter (where status = 'rejected')       as rejected_count
    from public.question_drafts where subject_id is not null
    group by subject_id
  ) d on d.subject_id = s.id
  order by s.sort_order, s.name;
$$;
revoke execute on function public.subject_curation_status() from public, anon;
grant execute on function public.subject_curation_status() to authenticated;

-- Service-role helper the curator engine uses to find gaps: for one subject, how
-- many APPROVED (live) and PENDING questions exist at each grade level 3..22. The
-- engine compares approved+pending to the per-level target (default 25) to decide
-- what to generate next, so re-running only fills gaps (idempotent / resumable).
create or replace function public.subject_grade_coverage(p_subject_id uuid)
returns table (grade_level int, approved_count bigint, pending_count bigint)
language sql
stable
security definer set search_path = public
as $$
  with levels as (select generate_series(3, 22) as grade_level)
  select
    l.grade_level,
    coalesce(q.c, 0) as approved_count,
    coalesce(d.c, 0) as pending_count
  from levels l
  left join (
    select grade_level, count(*) c from public.questions
    where subject_id = p_subject_id group by grade_level
  ) q on q.grade_level = l.grade_level
  left join (
    select grade_level, count(*) c from public.question_drafts
    where subject_id = p_subject_id and status = 'pending_review' group by grade_level
  ) d on d.grade_level = l.grade_level
  order by l.grade_level;
$$;
revoke execute on function public.subject_grade_coverage(uuid) from public, anon, authenticated;
grant execute on function public.subject_grade_coverage(uuid) to service_role;
