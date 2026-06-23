-- Deposit reminders (issue #93): store the admin-configured lead time (seconds)
-- for deposit reminders on rotational pools. NULL means reminders are disabled.
alter table public.pools
  add column if not exists reminder_lead_time bigint null;
