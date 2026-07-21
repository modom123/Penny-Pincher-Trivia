-- question-images is a public Storage bucket, which already serves individual
-- object URLs (getPublicUrl()) without needing an RLS SELECT policy - the
-- bucket's public flag covers that. The broad SELECT policy this migration
-- removes only ever enabled listing/enumerating every file via the
-- storage.objects table (PostgREST/`.list()`), which nothing in the app uses
-- and which the security advisor flags as unnecessary exposure.
drop policy if exists question_images_public_read on storage.objects;
