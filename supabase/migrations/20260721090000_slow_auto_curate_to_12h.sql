-- Temporary throttle: until the first real tournament completes and starts
-- funding the content budget on its own (see fund_content_budget_on_completion),
-- run auto-curate-questions every 12h instead of every 30min so the one-time
-- manual budget seed isn't burned through before then. Bump this back down
-- once real revenue is flowing in.
select cron.alter_job(
  (select jobid from cron.job where jobname = 'auto-curate-questions'),
  schedule => '0 */12 * * *'
);
