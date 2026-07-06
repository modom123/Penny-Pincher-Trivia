-- "Trivia Alchemist": AI-assisted question drafting. Unlike the fully autonomous
-- design in the workforce doc, drafts always land here first and require a human
-- (admin/content_editor) to review and promote them - there is no automated
-- fact-checking pass in this build, so a human review step is the actual safety
-- mechanism, not an algorithmic one.
create table public.question_drafts (
  id uuid primary key default gen_random_uuid(),
  question_text text not null,
  options jsonb not null,
  correct_option varchar(1) not null,
  difficulty_level int not null check (difficulty_level between 1 and 100),
  category varchar(50),
  time_limit_seconds int not null default 12,
  status varchar(20) not null default 'pending_review', -- pending_review | approved | rejected
  generated_by varchar(20) not null default 'ai', -- ai | staff
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.question_drafts enable row level security;
create policy "question_drafts_all_staff" on public.question_drafts
  for all using (public.is_staff(array['admin','content_editor']))
  with check (public.is_staff(array['admin','content_editor']));

-- Promotes an approved draft into the live question bank via admin_upsert_question,
-- then marks the draft approved. Staff-gated same as admin_upsert_question.
create function public.promote_question_draft(p_draft_id uuid)
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

  update public.question_drafts set status = 'approved', reviewed_by = auth.uid(), reviewed_at = now()
  where id = p_draft_id;

  return v_question;
end;
$$;
revoke execute on function public.promote_question_draft(uuid) from public, anon;
grant execute on function public.promote_question_draft(uuid) to authenticated;

create function public.reject_question_draft(p_draft_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
begin
  if not public.is_staff(array['admin','content_editor']) then
    raise exception 'Forbidden: staff access required';
  end if;
  update public.question_drafts set status = 'rejected', reviewed_by = auth.uid(), reviewed_at = now()
  where id = p_draft_id;
end;
$$;
revoke execute on function public.reject_question_draft(uuid) from public, anon;
grant execute on function public.reject_question_draft(uuid) to authenticated;
