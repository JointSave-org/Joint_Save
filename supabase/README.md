# Supabase

This directory holds the project's Postgres migrations (`migrations/`) and
Deno Edge Functions (`functions/`).

## Edge Functions

| Function | Trigger | Purpose |
| --- | --- | --- |
| `notify-pool-event` | DB webhook on `pool_activity` INSERT | Emails members about deposits/payouts/rounds |
| `send-deposit-reminders` | Scheduled (cron) | Reminds members who haven't deposited before a round deadline |
| `cron/auto-trigger-payouts` | pg_cron, every 15 minutes | Auto-triggers `trigger_payout` for expired rotational pool rounds |

Deploy a function with:

```bash
supabase functions deploy <function-name>
```

Set its secrets (never commit these — use the dashboard or CLI):

```bash
supabase secrets set SOME_SECRET=value
```

## `cron/auto-trigger-payouts` — relayer wallet setup

This function eliminates the need for a human relayer: every 15 minutes it
checks all active rotational pools, and for any whose round deadline has
passed on-chain, it signs and submits `trigger_payout` itself using a
dedicated relayer keypair. See `supabase/migrations/20260722120000_cron_job_logs.sql`
for the audit table and `20260722120100_schedule_auto_trigger_payouts.sql`
for the pg_cron schedule.

### 1. Generate a relayer keypair

```bash
stellar keys generate relayer --network testnet
stellar keys address relayer   # public key (G...)
stellar keys show relayer      # secret key (S...) — keep this private
```

Or with the JS SDK: `Keypair.random()`.

### 2. Fund it on testnet

```bash
curl "https://friendbot.stellar.org/?addr=<RELAYER_PUBLIC_KEY>"
```

This gives the account 10,000 XLM on testnet, which is enough for a very
long time at Soroban transaction fee rates. The function itself checks the
relayer's balance every run and logs a `warning` row to `cron_job_logs` if it
drops below 10 XLM (configurable via `MIN_RELAYER_BALANCE_XLM`) so it can be
topped up before it runs out and starts failing.

### 3. Store the secret key as an encrypted Edge Function secret

**Never** put the relayer secret key in a plaintext env var or commit it
anywhere. Store it as a Supabase secret, which is encrypted at rest and only
readable by your deployed functions:

```bash
supabase secrets set RELAYER_SECRET_KEY=S...
```

### 4. Wire up the pg_cron schedule

The migration that schedules the 15-minute cron (`net.http_post` → the
deployed function) needs two values in Supabase Vault so the schedule itself
never contains a secret:

```sql
select vault.create_secret('https://<project-ref>.supabase.co', 'project_url');
select vault.create_secret('<service-role-key>', 'service_role_key');
```

Run these once in the SQL editor (or via the CLI against your project)
before or after applying `20260722120100_schedule_auto_trigger_payouts.sql` —
`cron.schedule` just stores the command text, so applying the migration
first is fine; the job simply won't successfully call out until the vault
secrets exist.

### 5. Verify

- `GET /api/cron/health` reports the last successful run and any failures in
  the last 24 hours.
- `cron_job_logs` (service-role read only) has one row per pool the job
  looked at, plus a `pool_id IS NULL` heartbeat row per completed run.
