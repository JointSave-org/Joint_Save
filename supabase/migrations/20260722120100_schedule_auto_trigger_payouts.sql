-- Schedules the auto-trigger-payouts Edge Function to run every 15 minutes via
-- pg_cron + pg_net, following Supabase's documented pattern for invoking Edge
-- Functions from a cron job. Applying this migration is safe on its own, but
-- the scheduled call will fail until two one-time manual steps are done (see
-- supabase/README.md for the full walkthrough):
--
--   1. Store the project URL and service-role key in Supabase Vault so the
--      cron command below never needs a secret committed to a migration file:
--        select vault.create_secret('https://<project-ref>.supabase.co', 'project_url');
--        select vault.create_secret('<service-role-key>', 'service_role_key');
--
--   2. Deploy the function: `supabase functions deploy auto-trigger-payouts`
--      and set its secrets: `supabase secrets set RELAYER_SECRET_KEY=...`
--
-- cron.schedule() upserts by job name, so re-running this migration (e.g. to
-- change the schedule) is idempotent.

create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;

select
  cron.schedule(
    'auto-trigger-payouts-every-15-min',
    '*/15 * * * *',
    $$
    select
      net.http_post(
        url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url') || '/functions/v1/auto-trigger-payouts',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key')
        ),
        body := '{}'::jsonb,
        timeout_milliseconds := 300000
      ) as request_id;
    $$
  );
