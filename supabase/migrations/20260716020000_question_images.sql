-- Picture questions: let a question carry an image ("Which country's flag is
-- this?"). Anti-fraud rationale: a plain text question + four text options can be
-- scraped and answered by a lookup bot in milliseconds; an image the player must
-- visually identify defeats simple text-lookup automation and complements the
-- existing sub-300ms speed flags in submit_answer. It raises the bar against
-- scripted bots -- not a silver bullet against image-recognition bots, but one more
-- layer. "Categories of pictures" is expressed with the existing `category` field
-- (e.g. 'Flags', 'Landmarks', 'Maps').
--
-- Images live in the public `question-images` Storage bucket (created below);
-- image_url stores the public object URL. The AI generator writes text only, so
-- picture questions are always human-authored -- staff attach an image in the
-- command center (upload -> bucket -> URL) and it flows draft -> promote -> live ->
-- start_round payload -> client.

-- 1. Schema: optional image on live questions and on drafts.
alter table public.questions       add column if not exists image_url text;
alter table public.question_drafts add column if not exists image_url text;

-- 2. admin_upsert_question gains an optional p_image_url. Drop + recreate (the arg
-- list changes); named-arg callers that omit it get the default null. Behaviour is
-- otherwise identical to 20260706100100.
drop function if exists public.admin_upsert_question(uuid, text, jsonb, varchar, int, varchar, int);
drop function if exists public.admin_upsert_question(uuid, text, jsonb, varchar, int, varchar, int, text);
create function public.admin_upsert_question(
  p_question_id uuid, p_question_text text, p_options jsonb, p_correct_option varchar,
  p_difficulty_level int, p_category varchar, p_time_limit_seconds int,
  p_image_url text default null
)
returns public.questions
language plpgsql
security definer set search_path = public
as $$
declare
  v_question public.questions;
begin
  if not public.is_staff(array['admin','content_editor']) then
    raise exception 'Forbidden: staff access required';
  end if;

  if p_question_id is null then
    insert into public.questions (question_text, options, correct_option, difficulty_level, category, time_limit_seconds, image_url)
    values (p_question_text, p_options, p_correct_option, p_difficulty_level, p_category, coalesce(p_time_limit_seconds, 12), p_image_url)
    returning * into v_question;
  else
    update public.questions set
      question_text = p_question_text,
      options = p_options,
      correct_option = p_correct_option,
      difficulty_level = p_difficulty_level,
      category = p_category,
      time_limit_seconds = coalesce(p_time_limit_seconds, 12),
      image_url = p_image_url
    where question_id = p_question_id
    returning * into v_question;
  end if;

  perform public.log_admin_action('upsert_question', null, null, jsonb_build_object('question_id', v_question.question_id));
  return v_question;
end;
$$;
revoke execute on function public.admin_upsert_question(uuid, text, jsonb, varchar, int, varchar, int, text) from public, anon;
grant execute on function public.admin_upsert_question(uuid, text, jsonb, varchar, int, varchar, int, text) to authenticated;

-- 3. promote_question_draft carries the draft's image_url onto the live question
-- (alongside subject_id/grade_level). Faithful copy of 20260706190000 + image.
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
    v_draft.difficulty_level, v_draft.category, v_draft.time_limit_seconds, v_draft.image_url
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

-- 4. start_round includes imageUrl in the broadcast payload so the client can render
-- the picture above the question. Faithful copy of 20260709000000 + image_url.
create or replace function public.start_round(p_game_id uuid, p_round_number int)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_round record;
  v_game record;
  v_pool int;
begin
  update public.games
  set current_round = p_round_number,
      status = 'active',
      started_at = coalesce(started_at, now())
  where game_id = p_game_id
  returning * into v_game;

  update public.game_rounds set started_at = now()
  where game_id = p_game_id and round_number = p_round_number;

  select gr.round_number, gr.cost_cents, gr.started_at, gr.is_overtime,
         coalesce(gr.time_limit_override_seconds, q.time_limit_seconds) as time_limit_seconds,
         q.question_text, q.options, q.image_url
  into v_round
  from public.game_rounds gr join public.questions q using (question_id)
  where gr.game_id = p_game_id and gr.round_number = p_round_number;
  if not found then
    raise exception 'No question configured for round %', p_round_number;
  end if;

  select total_prize_pool_cents into v_pool from public.games where game_id = p_game_id;

  return jsonb_build_object(
    'roundNumber', v_round.round_number,
    'questionText', v_round.question_text,
    'imageUrl', v_round.image_url,
    'options', v_round.options,
    'costCents', v_round.cost_cents,
    'timeLimitSeconds', v_round.time_limit_seconds,
    'isOvertime', v_round.is_overtime,
    'totalPrizePoolCents', v_pool,
    'serverStartTimeMs', (extract(epoch from v_round.started_at) * 1000)::bigint
  );
end;
$$;
revoke execute on function public.start_round(uuid, int) from public, anon, authenticated;
grant execute on function public.start_round(uuid, int) to service_role;

-- 5. Storage bucket for question images: public read (clients fetch the picture),
-- writes restricted to admin/content_editor staff.
insert into storage.buckets (id, name, public)
values ('question-images', 'question-images', true)
on conflict (id) do nothing;

drop policy if exists "question_images_public_read" on storage.objects;
create policy "question_images_public_read" on storage.objects
  for select using (bucket_id = 'question-images');

drop policy if exists "question_images_staff_insert" on storage.objects;
create policy "question_images_staff_insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'question-images' and public.is_staff(array['admin','content_editor']));

drop policy if exists "question_images_staff_update" on storage.objects;
create policy "question_images_staff_update" on storage.objects
  for update to authenticated
  using (bucket_id = 'question-images' and public.is_staff(array['admin','content_editor']));

drop policy if exists "question_images_staff_delete" on storage.objects;
create policy "question_images_staff_delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'question-images' and public.is_staff(array['admin','content_editor']));

-- 6. Sample "Flags" picture questions, seeded as DRAFTS (pending_review) so staff
-- review + approve them through the normal gate before they reach a real game.
-- image_url points at the bucket's public path convention; upload the matching PNG
-- (via the command center image picker or the Supabase dashboard) to complete each
-- one. Flag images are public domain. Uses the live project's storage origin.
insert into public.question_drafts
  (question_text, options, correct_option, difficulty_level, category, image_url, generated_by, status)
values
  ('Which country''s flag is shown in the image?',
   '{"A":"China","B":"Japan","C":"South Korea","D":"Bangladesh"}'::jsonb, 'B', 6, 'Flags',
   'https://pkvdthwqvjpxhqorfpub.supabase.co/storage/v1/object/public/question-images/flags/japan.png',
   'staff', 'pending_review'),
  ('Which country''s flag is shown in the image?',
   '{"A":"France","B":"Italy","C":"Ireland","D":"Mexico"}'::jsonb, 'A', 10, 'Flags',
   'https://pkvdthwqvjpxhqorfpub.supabase.co/storage/v1/object/public/question-images/flags/france.png',
   'staff', 'pending_review'),
  ('Which country''s flag is shown in the image?',
   '{"A":"Argentina","B":"Portugal","C":"Brazil","D":"Colombia"}'::jsonb, 'C', 14, 'Flags',
   'https://pkvdthwqvjpxhqorfpub.supabase.co/storage/v1/object/public/question-images/flags/brazil.png',
   'staff', 'pending_review');
