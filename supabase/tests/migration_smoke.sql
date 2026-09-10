-- migration_smoke.sql — asserts the post-migration schema equals the API
-- contract described in frontend/lib/supabase.ts.
--
-- Run AFTER applying fixtures/base_schema.sql and every
-- supabase/migrations/*.sql file, in order. Each assertion raises an
-- exception on failure so `psql -v ON_ERROR_STOP=1` fails the harness.
--
-- These checks re-derive the expected end-state from the database's own
-- catalogs (tables, columns, indexes, constraints, triggers, RLS policies),
-- so they are structural: they verify the migrations actually created and
-- locked down the schema the frontend/types depend on.

-- ── Expected tables ───────────────────────────────────────────────────────
do $$
declare
  expected_tables text[] := array[
    'pools', 'pool_members', 'pool_activity',
    'pool_daily_metrics', 'pool_health_scores',
    'user_profiles', 'notifications', 'join_requests',
    'deposit_reminders', 'admin_actions', 'cron_job_logs',
    'pool_messages', 'event_index_log', 'pool_templates',
    'email_digests', 'security_alerts', 'governance_votes',
    'disputes', 'dispute_votes', 'bridge_transactions',
    'incidents', 'pause_authorizations', 'archive_log'
  ];
  missing text := '';
  t text;
begin
  foreach t in array expected_tables loop
    if to_regclass(format('%I.%I', 'public', t)) is null then
      missing := missing || t || ' ';
    end if;
  end loop;
  if missing <> '' then
    raise exception 'missing tables: %', missing;
  end if;
end $$;

-- ── Expected columns per table ─────────────────────────────────────────────
do $$
declare
  expected jsonb := jsonb_build_object(
    'pools', jsonb_build_array(
      'id','name','description','type','status','creator_address',
      'contract_address','token_address','token_symbol','token_decimals',
      'supported_tokens','total_saved','target_amount','progress',
      'members_count','next_payout','next_recipient','created_at','updated_at',
      'contribution_amount','round_duration','frequency','schedule_config',
      'pause_reason','paused_at','deadline','minimum_deposit','withdrawal_fee',
      'yield_enabled','archived_at','archive_reason','completed_at',
      'emergency_withdrawn_at'
    ),
    'pool_members', jsonb_build_array(
      'id','pool_id','member_address','contribution_amount','status','joined_at'
    ),
    'pool_activity', jsonb_build_array(
      'id','pool_id','activity_type','user_address','amount','token_amount',
      'description','tx_hash','on_chain_timestamp','block_number','fee_charged',
      'created_at'
    ),
    'pool_daily_metrics', jsonb_build_array(
      'id','pool_id','date','total_balance','total_deposits',
      'total_withdrawals','active_members_count','created_at'
    ),
    'pool_health_scores', jsonb_build_array(
      'id','pool_id','health_score','participation_rate','risk_indicator',
      'last_calculated_at'
    ),
    'user_profiles', jsonb_build_array(
      'wallet_address','email','notification_preferences','muted_pools',
      'created_at','updated_at'
    ),
    'notifications', jsonb_build_array(
      'id','wallet_address','pool_id','activity_type','message','read',
      'priority','created_at'
    ),
    'join_requests', jsonb_build_array(
      'id','pool_id','requester_address','status','created_at','responded_at',
      'responder_id'
    ),
    'deposit_reminders', jsonb_build_array(
      'id','pool_id','wallet_address','round_deadline','created_at'
    )
  );
  tbl text;
  col text;
  missing text := '';
  rec record;
  col_rec record;
begin
  for rec in select key, value from jsonb_each(expected) loop
    tbl := rec.key;
    for col_rec in
      select elem::text as c from jsonb_array_elements_text(rec.value::jsonb) elem
    loop
      col := col_rec.c;
      if to_regclass(format('%I.%I', 'public', tbl)) is null then
        continue;
      end if;
      if not exists (
        select 1 from information_schema.columns c
        where c.table_schema = 'public' and c.table_name = tbl
          and c.column_name = col
      ) then
        missing := missing || tbl || '.' || col || ' ';
      end if;
    end loop;
  end loop;
  if missing <> '' then raise exception 'missing columns: %', missing; end if;
end $$;

-- ── Column types for the columns migrations add ────────────────────────────
do $$
declare
  expected jsonb := jsonb_build_object(
    'pools.token_symbol', 'text',
    'pools.token_decimals', 'integer',
    'pools.supported_tokens', 'jsonb',
    'pools.schedule_config', 'jsonb',
    'pool_activity.token_amount', 'numeric',
    'pool_activity.on_chain_timestamp', 'timestamp with time zone',
    'pool_activity.block_number', 'bigint',
    'pool_activity.fee_charged', 'bigint'
  );
  k text;
  tbl text;
  col text;
begin
  for k in select j from jsonb_object_keys(expected) j loop
    tbl := split_part(k, '.', 1);
    col := split_part(k, '.', 2);
    if not exists (
      select 1 from information_schema.columns c
      where c.table_schema = 'public' and c.table_name = tbl
        and c.column_name = col
        and c.data_type = expected->>k
    ) then
      raise exception '% should have type %', k, expected->>k;
    end if;
  end loop;
end $$;

-- ── Expected indexes ───────────────────────────────────────────────────────
do $$
declare
  expected text[] := array[
    'idx_pool_daily_metrics_pool_id',
    'idx_pool_daily_metrics_date',
    'idx_pool_health_scores_pool_id',
    'idx_user_profiles_email',
    'idx_notifications_wallet',
    'idx_notifications_unread',
    'idx_join_requests_pool_id',
    'idx_join_requests_requester',
    'idx_deposit_reminders_pool_deadline',
    'idx_deposit_reminders_wallet',
    'idx_admin_actions_pool_id',
    'idx_cron_job_logs_job_created',
    'idx_cron_job_logs_pool_id',
    'idx_pool_activity_pool_created',
    'idx_pool_activity_pool_type',
    'idx_pool_messages_pool_created',
    'idx_pool_messages_sender_recent'
  ];
  missing text := '';
  i text;
begin
  foreach i in array expected loop
    if not exists (
      select 1 from pg_indexes where schemaname = 'public' and indexname = i
    ) then
      missing := missing || i || ' ';
    end if;
  end loop;
  if missing <> '' then raise exception 'missing indexes: %', missing; end if;
end $$;

-- ── RLS enabled + locked-down tables have only SELECT policies ─────────────
do $$
declare
  locked_down text[] := array[
    'pools','pool_members','pool_activity','pool_daily_metrics',
    'pool_health_scores','user_profiles','notifications','join_requests',
    'deposit_reminders','admin_actions','event_index_log','pool_messages',
    'pool_templates','email_digests','security_alerts','governance_votes',
    'disputes','dispute_votes','bridge_transactions','incidents',
    'pause_authorizations','archive_log','cron_job_logs'
  ];
  t text;
  missing text := '';
begin
  foreach t in array locked_down loop
    if not exists (
      select 1 from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = t and c.relrowsecurity
    ) then
      missing := missing || t || ' ';
    end if;
  end loop;
  if missing <> '' then
    raise exception 'tables missing RLS: %', missing;
  end if;
end $$;

-- ── Locked-down write tables expose NO write policies (SELECT-public only) ─
do $$
declare
  read_only text[] := array[
    'pools','pool_members','pool_activity','pool_daily_metrics',
    'pool_health_scores','user_profiles','notifications','join_requests',
    'deposit_reminders'
  ];
  t text;
  offenders text := '';
begin
  foreach t in array read_only loop
    if exists (
      select 1 from pg_policies
      where schemaname = 'public' and tablename = t
        and cmd in ('INSERT','UPDATE','DELETE')
    ) then
      offenders := offenders || t || ' ';
    end if;
  end loop;
  if offenders <> '' then
    raise exception 'tables expose write policies (should be service-role only): %', offenders;
  end if;
end $$;

-- ── Expected policy names ──────────────────────────────────────────────────
do $$
declare
  expected text[] := array[
    'pools_select_public',
    'pool_members_select_public',
    'pool_activity_select_public',
    'pool_daily_metrics_select_public',
    'pool_health_scores_select_public',
    'join_requests_select_public',
    'admin_actions_select_public',
    'event_index_log_select_public',
    'security_alerts_select_public',
    'governance_votes_select_public',
    'disputes_select_public',
    'dispute_votes_select_public',
    'incidents_select_public',
    'archive_log_select_public',
    'Members can read pool messages',
    'Members can insert own messages',
    'Pool template owners and public reads',
    'Pool template owners insert',
    'Pool template owners update',
    'Pool template owners delete'
  ];
  missing text := '';
  p text;
begin
  foreach p in array expected loop
    if not exists (
      select 1 from pg_policies
      where schemaname = 'public' and policyname = p
    ) then
      missing := missing || p || '; ';
    end if;
  end loop;
  if missing <> '' then raise exception 'missing policies: %', missing; end if;
end $$;

-- ── Constraints ────────────────────────────────────────────────────────────
do $$
declare
  checks text[] := array[
    'pools_archive_reason_valid',
    'pools_archive_fields_pair',
    'pools_status_valid',
    'pool_messages_sender_lowercase'
  ];
  missing text := '';
  c text;
begin
  foreach c in array checks loop
    if not exists (
      select 1 from pg_constraint where conname = c and connamespace = 'public'::regnamespace
    ) then
      missing := missing || c || ' ';
    end if;
  end loop;
  if missing <> '' then raise exception 'missing constraints: %', missing; end if;
end $$;

-- ── Triggers ───────────────────────────────────────────────────────────────
do $$
declare
  expected text[] := array['pool_templates_touch_updated'];
  missing text := '';
  t text;
begin
  foreach t in array expected loop
    if not exists (
      select 1 from pg_trigger where tgname = t and not tgisinternal
    ) then
      missing := missing || t || ' ';
    end if;
  end loop;
  if missing <> '' then raise exception 'missing triggers: %', missing; end if;
end $$;

\echo 'migration_smoke: OK'