-- Sweeps every 5 minutes for registration-stage games crossing the 4h/30m
-- start-reminder thresholds. 5-minute granularity is plenty precise for a
-- "starts in ~4 hours" / "starts in ~30 minutes" heads-up; each threshold is
-- idempotent per game (see games_due_for_start_reminder), so more frequent
-- sweeps just mean tighter timing, never duplicate sends.
select cron.schedule(
  'send-tournament-reminders',
  '*/5 * * * *',
  $$
  select net.http_post(
    url := 'https://pkvdthwqvjpxhqorfpub.supabase.co/functions/v1/send-tournament-reminders',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'notifications_cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
  $$
);
