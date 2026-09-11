create extension if not exists pgcrypto with schema extensions;

create table app_private.request_budgets (
  user_id uuid references app_private.profiles(user_id) on delete cascade,
  operation text not null, window_start timestamptz not null, used integer not null check(used between 0 and 121),
  primary key(user_id,operation)
);
alter table app_private.request_budgets enable row level security;
revoke all on app_private.request_budgets from public, anon, authenticated;

create function app_private.api_error(code text, status integer, retryable boolean default false, current_record jsonb default null) returns jsonb
language plpgsql set search_path='' as $$
begin
  perform set_config('response.status',status::text,true);
  return jsonb_build_object('code',code,'message',case
    when code='VERSION_CONFLICT' then 'This check-in changed on another device.'
    when code='RATE_LIMITED' then 'Please wait before retrying.'
    when code='ACCOUNT_UNAVAILABLE' then 'This account is unavailable.'
    when code='UNAUTHENTICATED' then 'Sign in to continue.'
    when code='NOT_FOUND_OR_FORBIDDEN' then 'This check-in is unavailable.'
    when code='SERVER_RETRY' then 'The request could not be completed. Retry the same request.'
    else 'The request could not be accepted.' end,
    'retryable',retryable,'request_id',gen_random_uuid())
    || case when current_record is null then '{}'::jsonb else jsonb_build_object('current_record',current_record) end;
end $$;

create function app_private.utc_text(value timestamptz) returns text
language sql immutable set search_path='' as $$
  select to_char(value at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
$$;

create function app_private.checkin_json(value app_private.checkins) returns jsonb
language sql stable set search_path='' as $$
  select jsonb_build_object('id',(value).id,'quantity',(value).quantity,
    'occurred_at',app_private.utc_text((value).occurred_at),'recorded_timezone',(value).recorded_timezone,
    'local_date',to_char((value).local_date,'YYYY-MM-DD'),'source',(value).source,
    'created_at',app_private.utc_text((value).created_at),'updated_at',app_private.utc_text((value).updated_at),
    'deleted_at',app_private.utc_text((value).deleted_at),'version',(value).version,'revision',(value).revision::text,
    'public_epoch',(value).public_epoch::text,'public_region_id',(value).public_region_id);
$$;

create function app_private.protect_snapshot() returns trigger
language plpgsql set search_path='' as $$ begin raise exception 'Accepted snapshots and receipts are immutable'; end $$;
create trigger immutable_change before update on app_private.checkin_changes for each row execute function app_private.protect_snapshot();
create trigger immutable_receipt before update on app_private.mutation_receipts for each row execute function app_private.protect_snapshot();

create function public.mutate_checkin(envelope jsonb) returns jsonb
language plpgsql security definer set search_path='' set lock_timeout='5s' set statement_timeout='10s' as $$
declare
  actor uuid; profile app_private.profiles; item app_private.checkins;
  mutation_key uuid; entity_id uuid; kind text; count_value integer; base_version integer;
  happened timestamptz; day_value date; zone text; source_value text; requested_epoch bigint;
  canonical jsonb; canonical_hash text; receipt app_private.mutation_receipts;
  required text[]; new_revision bigint; snapshot jsonb; result jsonb;
  window_value timestamptz := date_trunc('minute',clock_timestamp()); used_value integer;
  now_value timestamptz := clock_timestamp(); effective boolean;
begin
  actor := app_private.require_user();
  select * into profile from app_private.profiles where user_id=actor for update;
  if not found then return app_private.api_error('ACCOUNT_UNAVAILABLE',403); end if;
  perform app_private.require_user();
  select revision+1 into new_revision from app_private.account_sync_state where user_id=actor for update;
  if not found then return app_private.api_error('ACCOUNT_UNAVAILABLE',403); end if;
  insert into app_private.request_budgets(user_id,operation,window_start,used) values(actor,'checkin',window_value,1)
    on conflict(user_id,operation) do update set window_start=excluded.window_start,
      used=case when app_private.request_budgets.window_start=excluded.window_start then least(app_private.request_budgets.used,120)+1 else 1 end
    returning used into used_value;
  if used_value>120 then
    perform set_config('response.headers',jsonb_build_array(jsonb_build_object('Retry-After',greatest(1,ceil(extract(epoch from window_value+interval '1 minute'-clock_timestamp())))::text))::text,true);
    return app_private.api_error('RATE_LIMITED',429,true);
  end if;
  if envelope is null or jsonb_typeof(envelope)<>'object' or octet_length(envelope::text)>32768 then
    return app_private.api_error('INVALID_REQUEST',400);
  end if;
  kind := envelope->>'kind';
  required := case kind
    when 'create' then array['kind','mutation_id','checkin_id','quantity','occurred_at','recorded_timezone','local_date','source','requested_public_epoch']
    when 'update' then array['kind','mutation_id','checkin_id','quantity','expected_version']
    when 'delete' then array['kind','mutation_id','checkin_id','expected_version'] end;
  if required is null or not (envelope ?& required) or (envelope-required)<>'{}'::jsonb then return app_private.api_error('INVALID_REQUEST',400); end if;
  if coalesce(envelope->>'mutation_id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or coalesce(envelope->>'checkin_id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then return app_private.api_error('INVALID_REQUEST',400); end if;
  mutation_key := (envelope->>'mutation_id')::uuid; entity_id := (envelope->>'checkin_id')::uuid;
  canonical := jsonb_build_object('kind',kind,'mutation_id',mutation_key,'checkin_id',entity_id);
  if kind in ('create','update') then
    if jsonb_typeof(envelope->'quantity')<>'number' or (envelope->>'quantity')::numeric<>trunc((envelope->>'quantity')::numeric)
      or (envelope->>'quantity')::numeric not between 1 and 999 then return app_private.api_error('INVALID_QUANTITY',400); end if;
    count_value := (envelope->>'quantity')::numeric::integer;
    canonical := canonical || jsonb_build_object('quantity',count_value);
  end if;
  if kind='create' then
    if coalesce(envelope->>'occurred_at','') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$' then return app_private.api_error('INVALID_TIMESTAMP',400); end if;
    begin happened := (envelope->>'occurred_at')::timestamptz;
    exception when datetime_field_overflow or invalid_datetime_format then return app_private.api_error('INVALID_TIMESTAMP',400); end;
    if app_private.utc_text(happened)<>regexp_replace(envelope->>'occurred_at','(?<!\.\d{3})Z$','.000Z') then return app_private.api_error('INVALID_TIMESTAMP',400); end if;
    zone := envelope->>'recorded_timezone';
    if zone is null or length(zone)>100 or zone ~ '^(posix|right)/' or not exists(select 1 from pg_timezone_names where name=zone) then return app_private.api_error('INVALID_TIMEZONE',400); end if;
    day_value := (happened at time zone zone)::date;
    if coalesce(envelope->>'local_date','')<>to_char(day_value,'YYYY-MM-DD') then return app_private.api_error('INVALID_LOCAL_DATE',400); end if;
    source_value := envelope->>'source';
    if source_value is null or source_value not in ('native','import') then return app_private.api_error('INVALID_REQUEST',400); end if;
    if envelope->'requested_public_epoch'<>'null'::jsonb then
      if jsonb_typeof(envelope->'requested_public_epoch')<>'string' or (envelope->>'requested_public_epoch') !~ '^(0|[1-9]\d{0,18})$' then return app_private.api_error('INVALID_REQUEST',400); end if;
      begin requested_epoch := (envelope->>'requested_public_epoch')::bigint;
      exception when numeric_value_out_of_range then return app_private.api_error('INVALID_REQUEST',400); end;
    end if;
    canonical := canonical || jsonb_build_object('occurred_at',app_private.utc_text(happened),'recorded_timezone',zone,'local_date',to_char(day_value,'YYYY-MM-DD'),'source',source_value,'requested_public_epoch',requested_epoch::text);
  else
    if jsonb_typeof(envelope->'expected_version')<>'number' or (envelope->>'expected_version')::numeric<>trunc((envelope->>'expected_version')::numeric)
      or (envelope->>'expected_version')::numeric not between 1 and 2147483646 then return app_private.api_error('INVALID_REQUEST',400); end if;
    base_version := (envelope->>'expected_version')::numeric::integer;
    canonical := canonical || jsonb_build_object('expected_version',base_version);
  end if;
  canonical_hash := encode(extensions.digest(convert_to(canonical::text,'UTF8'),'sha256'),'hex');
  select * into receipt from app_private.mutation_receipts r where r.user_id=actor and r.mutation_id=mutation_key;
  if found then
    if receipt.canonical_payload_hash<>canonical_hash then return app_private.api_error('IDEMPOTENCY_KEY_REUSED',409); end if;
    return receipt.result;
  end if;
  select * into item from app_private.checkins where id=entity_id and user_id=actor for update;
  if kind='create' then
    if found then return app_private.api_error('ENTITY_EXISTS',409,false,app_private.checkin_json(item)); end if;
    if happened>now_value+interval '5 minutes' then return app_private.api_error('CLOCK_AHEAD',400); end if;
    insert into app_private.checkins(id,user_id,quantity,occurred_at,recorded_timezone,local_date,source,created_at,updated_at,version,revision,public_epoch,public_region_id)
      values(entity_id,actor,count_value,happened,zone,day_value,source_value,now_value,now_value,1,new_revision,
        case when source_value='native' and profile.public_enabled and requested_epoch=profile.consent_epoch then profile.consent_epoch end,
        case when source_value='native' and profile.public_enabled and requested_epoch=profile.consent_epoch then profile.region_id end)
      on conflict(id) do nothing returning * into item;
    if not found then return app_private.api_error('NOT_FOUND_OR_FORBIDDEN',404); end if;
  else
    if not found then return app_private.api_error('NOT_FOUND_OR_FORBIDDEN',404); end if;
    if item.deleted_at is not null or item.version<>base_version then return app_private.api_error('VERSION_CONFLICT',409,false,app_private.checkin_json(item)); end if;
    update app_private.checkins set quantity=case when kind='update' then count_value else quantity end,
      deleted_at=case when kind='delete' then now_value else deleted_at end,
      updated_at=now_value,version=version+1,revision=new_revision where id=entity_id and user_id=actor returning * into item;
  end if;
  update app_private.account_sync_state set revision=new_revision where user_id=actor;
  snapshot := app_private.checkin_json(item);
  effective := item.deleted_at is null and not item.moderation_excluded and profile.public_enabled and item.source='native'
    and item.public_epoch=profile.consent_epoch and item.public_region_id is not distinct from profile.region_id
    and item.occurred_at between now_value-interval '24 hours' and now_value;
  result := jsonb_build_object('request_id',gen_random_uuid(),'record',snapshot,'revision',new_revision::text,'effective_public',coalesce(effective,false));
  insert into app_private.checkin_changes(user_id,revision,checkin_id,snapshot) values(actor,new_revision,entity_id,snapshot);
  insert into app_private.mutation_receipts(user_id,mutation_id,canonical_payload_hash,result) values(actor,mutation_key,canonical_hash,result);
  return result;
exception
  when insufficient_privilege then return app_private.api_error(case when auth.uid() is null then 'UNAUTHENTICATED' else 'ACCOUNT_UNAVAILABLE' end,403);
  when lock_not_available or deadlock_detected then return app_private.api_error('SERVER_RETRY',503,true);
  when others then return app_private.api_error('SERVER_RETRY',503,true);
end $$;

create function public.pull_changes(after_revision text default '0', "limit" integer default 100) returns jsonb
language plpgsql security definer set search_path='' set lock_timeout='5s' set statement_timeout='10s' as $$
declare page_limit alias for $2; actor uuid; cursor_value bigint; head bigint; result jsonb;
begin
  actor := app_private.require_user();
  perform 1 from app_private.profiles where user_id=actor for share;
  if not found then return app_private.api_error('ACCOUNT_UNAVAILABLE',403); end if;
  perform app_private.require_user();
  if after_revision is null or after_revision !~ '^(0|[1-9]\d{0,18})$' or page_limit is null or page_limit not between 1 and 500 then return app_private.api_error('INVALID_CURSOR',400); end if;
  begin cursor_value := after_revision::bigint;
  exception when numeric_value_out_of_range then return app_private.api_error('INVALID_CURSOR',400); end;
  select revision into head from app_private.account_sync_state where user_id=actor;
  if head is null then return app_private.api_error('ACCOUNT_UNAVAILABLE',403); end if;
  if cursor_value>head then return app_private.api_error('INVALID_CURSOR',400); end if;
  with candidates as materialized (
    select revision,snapshot from app_private.checkin_changes where user_id=actor and revision>cursor_value order by revision limit page_limit+1
  ), page as (select * from candidates order by revision limit page_limit)
  select jsonb_build_object('request_id',gen_random_uuid(),'changes',coalesce(jsonb_agg(snapshot order by revision),'[]'::jsonb),
    'next_revision',coalesce(max(revision),cursor_value)::text,'has_more',(select count(*) from candidates)>page_limit) into result from page;
  return result;
exception
  when insufficient_privilege then return app_private.api_error(case when auth.uid() is null then 'UNAUTHENTICATED' else 'ACCOUNT_UNAVAILABLE' end,403);
  when others then return app_private.api_error('SERVER_RETRY',503,true);
end $$;

revoke all on function app_private.api_error(text,integer,boolean,jsonb), app_private.utc_text(timestamptz), app_private.checkin_json(app_private.checkins), app_private.protect_snapshot() from public, anon, authenticated;
revoke all on function public.mutate_checkin(jsonb), public.pull_changes(text,integer) from public, anon, authenticated;
grant execute on function public.mutate_checkin(jsonb), public.pull_changes(text,integer) to authenticated;
