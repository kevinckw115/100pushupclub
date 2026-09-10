-- Private application data. Client roles use checked public functions only.
create schema if not exists app_private;
revoke all on schema app_private from public, anon, authenticated;
alter default privileges in schema app_private revoke all on tables from public, anon, authenticated;
alter default privileges in schema app_private revoke all on sequences from public, anon, authenticated;
alter default privileges in schema app_private revoke execute on functions from public, anon, authenticated;

create table app_private.regions (
  id text primary key, parent_id text references app_private.regions(id),
  kind text not null check (kind in ('world','country','admin1','locality')),
  name text not null check (length(name) between 1 and 200), country_code text,
  source_geoname_id bigint unique, source_version text, timezone_hint text,
  check (parent_id is distinct from id)
);
create index regions_parent on app_private.regions(parent_id, name, id);
create table app_private.region_ancestors (
  region_id text references app_private.regions(id) on delete cascade,
  ancestor_id text references app_private.regions(id) on delete cascade,
  primary key (region_id, ancestor_id)
);
create table app_private.reserved_aliases (alias_normalized text primary key);
insert into app_private.reserved_aliases values ('admin'),('administrator'),('support'),('moderator'),('100pushupclub');

create table app_private.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  alias text not null check (alias ~ '^[A-Za-z0-9_]{3,20}$'),
  alias_normalized text generated always as (lower(alias)) stored unique,
  region_id text references app_private.regions(id), public_enabled boolean not null default false,
  consent_epoch bigint not null default 0 check (consent_epoch >= 0),
  account_status text not null default 'active' check (account_status in ('active','deleting','suspended')),
  created_at timestamptz not null default now()
);
create table app_private.account_sync_state (
  user_id uuid primary key references app_private.profiles(user_id) on delete cascade,
  revision bigint not null default 0 check (revision >= 0)
);
create table app_private.checkins (
  id uuid primary key, user_id uuid not null references app_private.profiles(user_id) on delete cascade,
  quantity integer not null check (quantity between 1 and 999),
  occurred_at timestamptz not null, recorded_timezone text not null, local_date date not null,
  source text not null check (source in ('native','import')),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz,
  version integer not null check (version >= 1), revision bigint not null check (revision >= 1),
  public_epoch bigint check (public_epoch >= 0), public_region_id text references app_private.regions(id),
  moderation_excluded boolean not null default false,
  check (source = 'native' or (public_epoch is null and public_region_id is null))
);
create index checkins_personal_day on app_private.checkins(user_id, local_date, occurred_at desc, id);
create index checkins_public_window on app_private.checkins(occurred_at desc, public_region_id, user_id) where deleted_at is null and source='native' and not moderation_excluded;
create table app_private.mutation_receipts (
  user_id uuid references app_private.profiles(user_id) on delete cascade,
  mutation_id uuid, canonical_payload_hash text not null, result jsonb not null,
  created_at timestamptz not null default now(), primary key (user_id, mutation_id)
);
create table app_private.checkin_changes (
  user_id uuid references app_private.profiles(user_id) on delete cascade,
  revision bigint check (revision >= 1), checkin_id uuid not null,
  snapshot jsonb not null, primary key (user_id, revision)
);
create table app_private.operation_receipts (
  user_id uuid references app_private.profiles(user_id) on delete cascade,
  operation_id uuid, operation text not null, request_hash text not null, result jsonb not null,
  created_at timestamptz not null default now(), primary key (user_id, operation_id)
);

create table app_private.circles (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null references app_private.profiles(user_id),
  name text not null check (length(btrim(name)) between 3 and 40), timezone text not null,
  created_at timestamptz not null default now(), deleted_at timestamptz
);
create table app_private.circle_memberships (
  circle_id uuid references app_private.circles(id) on delete cascade,
  user_id uuid references app_private.profiles(user_id) on delete cascade,
  joined_at timestamptz not null default now(), left_at timestamptz,
  primary key (circle_id, user_id)
);
create index circle_memberships_user on app_private.circle_memberships(user_id, circle_id) where left_at is null;
create table app_private.circle_invites (
  id uuid primary key default gen_random_uuid(), circle_id uuid not null references app_private.circles(id) on delete cascade,
  token_hash text not null unique, expires_at timestamptz not null, revoked_at timestamptz,
  created_by uuid not null references app_private.profiles(user_id) on delete cascade,
  created_at timestamptz not null default now()
);
create table app_private.blocks (
  blocker_id uuid references app_private.profiles(user_id) on delete cascade,
  blocked_id uuid references app_private.profiles(user_id) on delete cascade,
  created_at timestamptz not null default now(), primary key (blocker_id, blocked_id), check (blocker_id <> blocked_id)
);
create index blocks_reverse on app_private.blocks(blocked_id, blocker_id);
create table app_private.reports (
  id uuid primary key default gen_random_uuid(), reporter_id uuid references app_private.profiles(user_id) on delete set null,
  subject_type text not null check (subject_type in ('alias','circle_name','checkin')), subject_id text not null,
  reason text not null check (reason in ('abuse','impersonation','inappropriate_name','other')),
  status text not null default 'open' check (status in ('open','resolved','dismissed')), created_at timestamptz not null default now()
);
create index reports_open on app_private.reports(created_at, id) where status='open';
create table app_private.moderation_audit (
  id uuid primary key default gen_random_uuid(), staff_id uuid not null, action text not null,
  subject_id text not null, reason text not null, created_at timestamptz not null default now()
);
create table app_private.deletion_jobs (
  user_id uuid primary key, status text not null check (status in ('pending','running','complete','failed')),
  requested_at timestamptz not null default now(), last_attempt_at timestamptz, completed_at timestamptz, error_code text
);

-- Migration-time identifiers come only from this private schema, never client input.
do $$ declare item record; begin
  for item in select tablename from pg_catalog.pg_tables where schemaname='app_private' loop
    execute format('alter table app_private.%I enable row level security', item.tablename);
  end loop;
end $$;
revoke all on all tables in schema app_private from public, anon, authenticated;
revoke all on all sequences in schema app_private from public, anon, authenticated;

create function app_private.require_user() returns uuid
language plpgsql security definer set search_path = '' as $$
declare actor uuid := auth.uid();
begin
  if actor is null or auth.role() is distinct from 'authenticated' then
    raise exception using errcode='42501', message='UNAUTHENTICATED';
  end if;
  if not exists (select 1 from auth.users where id=actor and not coalesce(is_anonymous,false) and email_confirmed_at is not null) then
    raise exception using errcode='42501', message='ACCOUNT_UNAVAILABLE';
  end if;
  if exists (select 1 from app_private.profiles where user_id=actor and account_status <> 'active')
     or exists (select 1 from app_private.deletion_jobs where user_id=actor) then
    raise exception using errcode='42501', message='ACCOUNT_UNAVAILABLE';
  end if;
  return actor;
end $$;

create function app_private.profile_json(actor uuid) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object('alias', alias, 'region_id', region_id, 'public_enabled', public_enabled,
    'consent_epoch', consent_epoch::text, 'status', account_status)
  from app_private.profiles where user_id=actor;
$$;

create function public.bootstrap_profile(operation_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare actor uuid; profile app_private.profiles; receipt app_private.operation_receipts;
  result jsonb; candidate text; attempt integer;
begin
  actor := app_private.require_user();
  if operation_id is null then raise exception using errcode='22023', message='INVALID_INPUT'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(actor::text, 0));
  select * into profile from app_private.profiles where user_id=actor for update;
  if found and profile.account_status <> 'active' then raise exception using errcode='42501', message='ACCOUNT_UNAVAILABLE'; end if;
  select * into receipt from app_private.operation_receipts r where r.user_id=actor and r.operation_id=bootstrap_profile.operation_id;
  if found then
    if receipt.operation <> 'bootstrap_profile' then raise exception using errcode='22023', message='IDEMPOTENCY_KEY_REUSED'; end if;
    return receipt.result;
  end if;
  if profile.user_id is null then
    for attempt in 1..5 loop
      candidate := 'member_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 12);
      begin
        insert into app_private.profiles(user_id,alias) values(actor,candidate) returning * into profile;
        exit;
      exception when unique_violation then
        if attempt=5 then raise exception using errcode='P0001', message='ALIAS_ALLOCATION_FAILED'; end if;
      end;
    end loop;
  end if;
  insert into app_private.account_sync_state(user_id) values(actor) on conflict do nothing;
  result := jsonb_build_object('request_id',operation_id::text,'profile',app_private.profile_json(actor),
    'revision',(select revision::text from app_private.account_sync_state where user_id=actor));
  insert into app_private.operation_receipts(user_id,operation_id,operation,request_hash,result)
    values(actor,operation_id,'bootstrap_profile',encode(sha256(convert_to('{}','UTF8')),'hex'),result);
  return result;
end $$;

create function public.get_profile() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare actor uuid := app_private.require_user(); result jsonb;
begin
  result := app_private.profile_json(actor);
  if result is null then raise exception using errcode='P0001', message='PROFILE_NOT_READY'; end if;
  return jsonb_build_object('request_id',gen_random_uuid()::text,'profile',result);
end $$;

create function app_private.protect_checkin() returns trigger
language plpgsql set search_path = '' as $$
begin
  if not exists (select 1 from pg_catalog.pg_timezone_names where name=new.recorded_timezone) then
    raise exception using errcode='22023', message='INVALID_TIMEZONE';
  end if;
  if (new.occurred_at at time zone new.recorded_timezone)::date <> new.local_date then
    raise exception using errcode='22023', message='INVALID_LOCAL_DATE';
  end if;
  if tg_op='UPDATE' then
    if (old.id,old.user_id,old.occurred_at,old.recorded_timezone,old.local_date,old.source)
       is distinct from (new.id,new.user_id,new.occurred_at,new.recorded_timezone,new.local_date,new.source) then
      raise exception using errcode='22023', message='IMMUTABLE_RECORD_FIELDS';
    end if;
    if old.deleted_at is not null and new.deleted_at is null then raise exception using errcode='22023', message='RECORD_DELETED'; end if;
  end if;
  return new;
end $$;
create trigger protect_checkin before insert or update on app_private.checkins for each row execute function app_private.protect_checkin();

revoke all on all functions in schema app_private from public, anon, authenticated;
revoke all on function public.bootstrap_profile(uuid), public.get_profile() from public, anon, authenticated;
grant execute on function public.bootstrap_profile(uuid), public.get_profile() to authenticated;
