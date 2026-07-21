-- Schedules the auto-curate-questions edge function (bounded, resumable AI
-- question drafting - see that function's header comment) to run every 30
-- minutes. Each run only fills the remaining shortfall toward a contest-ready
-- bar (5 approved+pending questions per grade level), so it's safe to run
-- indefinitely without double-generating.
--
-- The shared secret this job authenticates with is stored in Vault (created
-- out-of-band, NOT in this file, so the plaintext value never lands in git
-- history) and looked up by name at call time. It must match the
-- CURATOR_CRON_SECRET edge function secret.
--
-- To pause: select cron.unschedule('auto-curate-questions');
-- To resume: re-run this migration (cron.schedule upserts by job name).
-- To change pace/scope: adjust the cron expression or the jsonb body below,
-- then re-run.
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'auto-curate-questions',
  '*/30 * * * *',
  $$
  select net.http_post(
    url := 'https://pkvdthwqvjpxhqorfpub.supabase.co/functions/v1/auto-curate-questions',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'curator_cron_secret')
    ),
    body := jsonb_build_object('maxSubjects', 5, 'targetPerGrade', 5, 'perCall', 10, 'maxCalls', 8),
    timeout_milliseconds := 120000
  );
  $$
);
