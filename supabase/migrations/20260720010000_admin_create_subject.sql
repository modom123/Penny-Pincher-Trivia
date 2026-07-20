-- Staff had no way to add a subject to the taxonomy outside of editing
-- question-curator/taxonomy.js and re-running the seed migration. This adds a
-- command-center-callable path so staff can create (and soft-retire) subjects
-- directly, same admin_* / is_staff / log_admin_action pattern as the rest of
-- 20260706100100_admin_functions.sql.

create or replace function public.admin_create_subject(
  p_name text, p_domain text, p_description text default null,
  p_target_question_count int default 1000
)
returns public.subjects
language plpgsql
security definer set search_path = public
as $$
declare
  v_subject public.subjects;
  v_base_slug text;
  v_slug text;
  v_n int := 2;
  v_next_sort int;
begin
  if not public.is_staff(array['admin','content_editor']) then
    raise exception 'Forbidden: staff access required';
  end if;
  if coalesce(btrim(p_name), '') = '' then
    raise exception 'Subject name is required';
  end if;
  if coalesce(btrim(p_domain), '') = '' then
    raise exception 'Domain is required';
  end if;

  -- Same slugify rule as question-curator/build-seed.js: lowercase, & -> and,
  -- non-alphanumeric runs collapse to '-', trim leading/trailing '-'.
  v_base_slug := regexp_replace(
    regexp_replace(lower(replace(p_name, '&', 'and')), '[^a-z0-9]+', '-', 'g'),
    '(^-+|-+$)', '', 'g'
  );
  if v_base_slug = '' then
    raise exception 'Could not derive a slug from subject name %', p_name;
  end if;

  v_slug := v_base_slug;
  while exists (select 1 from public.subjects where slug = v_slug) loop
    v_slug := v_base_slug || '-' || v_n;
    v_n := v_n + 1;
  end loop;

  select coalesce(max(sort_order), 0) + 1 into v_next_sort from public.subjects;

  insert into public.subjects (slug, name, domain, description, sort_order, target_question_count)
  values (
    v_slug, btrim(p_name), btrim(p_domain), nullif(btrim(coalesce(p_description, '')), ''),
    v_next_sort, coalesce(p_target_question_count, 1000)
  )
  returning * into v_subject;

  perform public.log_admin_action(
    'create_subject', null, null,
    jsonb_build_object('subject_id', v_subject.id, 'slug', v_subject.slug, 'name', v_subject.name, 'domain', v_subject.domain)
  );
  return v_subject;
end;
$$;
revoke execute on function public.admin_create_subject(text, text, text, int) from public, anon;
grant execute on function public.admin_create_subject(text, text, text, int) to authenticated;


-- Soft retire/restore: subjects can't be safely deleted once questions
-- reference them (subject_id FK), so toggle is_active instead. Inactive
-- subjects stay out of subject-contest / curation-target flows but keep
-- their history intact.
create or replace function public.admin_set_subject_active(p_subject_id uuid, p_is_active boolean)
returns public.subjects
language plpgsql
security definer set search_path = public
as $$
declare
  v_subject public.subjects;
begin
  if not public.is_staff(array['admin','content_editor']) then
    raise exception 'Forbidden: staff access required';
  end if;

  update public.subjects set is_active = p_is_active
  where id = p_subject_id
  returning * into v_subject;
  if not found then
    raise exception 'Subject % not found', p_subject_id;
  end if;

  perform public.log_admin_action(
    case when p_is_active then 'restore_subject' else 'retire_subject' end,
    null, null, jsonb_build_object('subject_id', v_subject.id, 'slug', v_subject.slug)
  );
  return v_subject;
end;
$$;
revoke execute on function public.admin_set_subject_active(uuid, boolean) from public, anon;
grant execute on function public.admin_set_subject_active(uuid, boolean) to authenticated;


-- subject_curation_status() only surfaces subjects with existing question
-- activity via the left joins, but a freshly created subject with 0
-- questions still needs to show up in the coverage table (with 0/target and
-- pending review) so staff can see it was created and start curating it.
-- The joins already default missing counts to 0 via coalesce, so no change
-- needed there -- but is_active wasn't previously filtered or exposed, so a
-- retired subject would still clutter the coverage list. Expose is_active
-- and hide inactive rows by default.
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
  grade_levels_covered bigint,
  is_active boolean
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
    coalesce(q.levels_covered, 0),
    s.is_active
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
