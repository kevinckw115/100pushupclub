alter table app_private.profiles add column public_actor_id text not null default ('a_'||encode(extensions.gen_random_bytes(16),'hex')) unique;
alter table app_private.checkins add column public_entry_id text not null default ('e_'||encode(extensions.gen_random_bytes(16),'hex')) unique;
alter table app_private.checkins add column creation_xid xid8 not null default pg_current_xact_id();
create function app_private.protect_public_identity() returns trigger language plpgsql set search_path='' as $$
begin
  if tg_table_name='profiles' then
    if old.public_actor_id is distinct from new.public_actor_id then raise exception 'Immutable public identity'; end if;
  elsif (old.public_entry_id,old.creation_xid) is distinct from (new.public_entry_id,new.creation_xid) then raise exception 'Immutable public identity'; end if;
  return new;
end;
$$;
create trigger protect_public_actor before update on app_private.profiles for each row execute function app_private.protect_public_identity();
create trigger protect_public_entry before update on app_private.checkins for each row execute function app_private.protect_public_identity();
create table app_private.server_secrets (name text primary key, value text not null);
alter table app_private.server_secrets enable row level security;
revoke all on app_private.server_secrets from public,anon,authenticated;
insert into app_private.server_secrets values('feed_cursor_v1',encode(extensions.gen_random_bytes(32),'hex'));

create function app_private.take_budget(actor uuid, operation_key text, maximum integer) returns boolean
language plpgsql set search_path='' as $$
declare current_window timestamptz := date_trunc('minute',statement_timestamp()); used_count integer;
begin
  if maximum<1 or maximum>120 then raise exception 'Invalid internal budget'; end if;
  insert into app_private.request_budgets(user_id,operation,window_start,used) values(actor,operation_key,current_window,1)
  on conflict(user_id,operation) do update set
    window_start=excluded.window_start,
    used=case when app_private.request_budgets.window_start=excluded.window_start then least(maximum+1,app_private.request_budgets.used+1) else 1 end
  returning used into used_count;
  if used_count>maximum then
    perform set_config('response.headers',jsonb_build_array(jsonb_build_object('Retry-After',greatest(1,ceil(extract(epoch from current_window+interval '1 minute'-statement_timestamp()))::integer)::text))::text,true);
    return false;
  end if;
  return true;
end;
$$;

create function public.update_profile(envelope jsonb) returns jsonb
language plpgsql security definer set search_path='' set lock_timeout='5s' set statement_timeout='10s' as $$
declare actor uuid; current_profile app_private.profiles; receipt app_private.operation_receipts;
  operation_key uuid; semantic jsonb; digest text; desired_alias text; desired_region text; desired_public boolean;
  expected_epoch bigint; next_epoch bigint; response jsonb;
begin
  actor := app_private.require_user();
  select * into current_profile from app_private.profiles where user_id=actor for update;
  if not found or current_profile.account_status<>'active' then return app_private.api_error('ACCOUNT_UNAVAILABLE',403); end if;
  if not app_private.take_budget(actor,'update_profile',30) then return app_private.api_error('RATE_LIMITED',429,true); end if;
  if envelope is null or jsonb_typeof(envelope)<>'object' or octet_length(envelope::text)>4096
    or not envelope ? 'operation_id' or (envelope-'operation_id'-'alias'-'region_id'-'public_enabled'-'expected_consent_epoch')<>'{}'::jsonb
    or (envelope-'operation_id'-'expected_consent_epoch')='{}'::jsonb then return app_private.api_error('INVALID_REQUEST',400); end if;
  if coalesce(envelope->>'operation_id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then return app_private.api_error('INVALID_REQUEST',400); end if;
  operation_key := (envelope->>'operation_id')::uuid;
  desired_alias := current_profile.alias; desired_region := current_profile.region_id; desired_public := current_profile.public_enabled;
  semantic := jsonb_build_object('operation_id',operation_key);
  if envelope ? 'alias' then
    if jsonb_typeof(envelope->'alias')<>'string' or btrim(envelope->>'alias') !~ '^[A-Za-z0-9_]{3,20}$' then return app_private.api_error('INVALID_ALIAS',400); end if;
    desired_alias := btrim(envelope->>'alias'); semantic := semantic||jsonb_build_object('alias',desired_alias);
  end if;
  if envelope ? 'region_id' then
    if jsonb_typeof(envelope->'region_id') not in ('string','null') or length(coalesce(envelope->>'region_id',''))>80 then return app_private.api_error('INVALID_REGION',400); end if;
    desired_region := envelope->>'region_id';
    if desired_region='world' then desired_region := null; end if;
    semantic := semantic||jsonb_build_object('region_id',desired_region);
  end if;
  if envelope ? 'public_enabled' then
    if jsonb_typeof(envelope->'public_enabled')<>'boolean' then return app_private.api_error('INVALID_REQUEST',400); end if;
    desired_public := (envelope->>'public_enabled')::boolean; semantic := semantic||jsonb_build_object('public_enabled',desired_public);
  end if;
  if envelope ? 'region_id' or envelope ? 'public_enabled' or envelope ? 'expected_consent_epoch' then
    if jsonb_typeof(envelope->'expected_consent_epoch') is distinct from 'string' or coalesce(envelope->>'expected_consent_epoch','') !~ '^(0|[1-9][0-9]{0,18})$' then return app_private.api_error('INVALID_REQUEST',400); end if;
    if (envelope->>'expected_consent_epoch')::numeric>9223372036854775807 then return app_private.api_error('INVALID_REQUEST',400); end if;
    expected_epoch := (envelope->>'expected_consent_epoch')::bigint;
    semantic := semantic||jsonb_build_object('expected_consent_epoch',expected_epoch::text);
  end if;
  digest := encode(sha256(convert_to(semantic::text,'UTF8')),'hex');
  select * into receipt from app_private.operation_receipts r where r.user_id=actor and r.operation_id=operation_key;
  if found then
    if receipt.operation<>'update_profile' or receipt.request_hash<>digest then return app_private.api_error('IDEMPOTENCY_KEY_REUSED',409); end if;
    return receipt.result;
  end if;
  if expected_epoch is not null and expected_epoch<>current_profile.consent_epoch then
    return app_private.api_error('CONSENT_CONFLICT',409)||jsonb_build_object('profile',app_private.profile_json(actor));
  end if;
  if desired_region is not null and not exists(select 1 from app_private.regions r where r.id=desired_region and r.active
    and not exists(select 1 from app_private.region_ancestors a join app_private.regions p on p.id=a.ancestor_id where a.region_id=r.id and not p.active)) then return app_private.api_error('INVALID_REGION',400); end if;
  if exists(select 1 from app_private.reserved_aliases where alias_normalized=lower(desired_alias)) then return app_private.api_error('ALIAS_UNAVAILABLE',409); end if;
  next_epoch := current_profile.consent_epoch;
  if desired_public is distinct from current_profile.public_enabled or desired_region is distinct from current_profile.region_id then
    if next_epoch=9223372036854775807 then return app_private.api_error('ACCOUNT_UNAVAILABLE',403); end if;
    next_epoch := next_epoch+1;
  end if;
  begin
    update app_private.profiles set alias=desired_alias,region_id=desired_region,public_enabled=desired_public,consent_epoch=next_epoch where user_id=actor;
  exception when unique_violation then return app_private.api_error('ALIAS_UNAVAILABLE',409); end;
  response := jsonb_build_object('request_id',gen_random_uuid(),'profile',app_private.profile_json(actor));
  insert into app_private.operation_receipts(user_id,operation_id,operation,request_hash,result) values(actor,operation_key,'update_profile',digest,response);
  return response;
exception
  when insufficient_privilege then return app_private.api_error('ACCOUNT_UNAVAILABLE',403);
  when lock_not_available or deadlock_detected or serialization_failure then return app_private.api_error('SERVER_RETRY',503,true);
  when others then return app_private.api_error('SERVER_RETRY',503,true);
end;
$$;

create function app_private.public_records(anchor timestamptz, initial_snapshot pg_snapshot)
returns table(id uuid,user_id uuid,quantity integer,occurred_at timestamptz,public_region_id text,alias text,actor_id text,entry_id text)
language sql stable set search_path='' as $$
  select c.id,c.user_id,c.quantity,c.occurred_at,c.public_region_id,p.alias,p.public_actor_id,c.public_entry_id
  from app_private.checkins c join app_private.profiles p on p.user_id=c.user_id
  where p.account_status='active' and p.public_enabled and c.deleted_at is null and c.source='native' and not c.moderation_excluded
    and c.public_epoch=p.consent_epoch and c.public_region_id is not distinct from p.region_id
    and c.occurred_at>=anchor-interval '24 hours' and c.occurred_at<=anchor and c.created_at<=anchor
    and pg_visible_in_snapshot(c.creation_xid,initial_snapshot)
    and not exists(select 1 from app_private.deletion_jobs j where j.user_id=p.user_id);
$$;

create function public.read_club(scope_id text default 'world', cursor text default null, "limit" integer default 25) returns jsonb
language plpgsql security definer set search_path='' set statement_timeout='5s' as $$
declare requested alias for $1; page_limit alias for $3; actor uuid; key text; position jsonb;
  initial_snapshot pg_snapshot := pg_current_snapshot();
  anchor timestamptz := date_trunc('milliseconds',statement_timestamp()); boundary_time timestamptz; boundary_id uuid;
  resolved jsonb; starting_scope text; effective_id text; effective_label text; total text; people integer;
  items jsonb; next_boundary_time timestamptz; next_boundary_id uuid; next_cursor text; reason text;
begin
  if auth.role()='authenticated' then
    actor := app_private.require_user();
    if not exists(select 1 from app_private.profiles where user_id=actor) then return app_private.api_error('ACCOUNT_UNAVAILABLE',403); end if;
    if not app_private.take_budget(actor,'read_club:'||coalesce(auth.jwt()->>'session_id',actor::text),30) then return app_private.api_error('RATE_LIMITED',429,true); end if;
  elsif coalesce(auth.role(),'anon')<>'anon' then return app_private.api_error('UNAUTHENTICATED',401); end if;
  perform set_config('response.headers','[{"Cache-Control":"no-store"}]',true);
  if requested is null or requested !~ '^(world|gn:[1-9][0-9]{0,18})$' or page_limit is null or page_limit<1 or page_limit>50 or length(coalesce(cursor,''))>16384 then return app_private.api_error('INVALID_REQUEST',400); end if;
  select value into key from app_private.server_secrets where name='feed_cursor_v1';
  if key is null then return app_private.api_error('SERVER_RETRY',503,true); end if;
  if cursor is not null then
    begin
      position := extensions.pgp_sym_decrypt(decode(cursor,'base64'),key)::jsonb;
      if position->>'v'<>'1' or position->>'viewer' is distinct from coalesce(actor::text,'guest') or position->>'requested' is distinct from requested then return app_private.api_error('INVALID_CURSOR',400); end if;
      anchor := (position->>'anchor')::timestamptz; boundary_time := (position->>'before_time')::timestamptz; boundary_id := (position->>'before_id')::uuid;
      initial_snapshot := (position->>'snapshot')::pg_snapshot;
      if initial_snapshot is null or anchor is null or boundary_time is null or boundary_id is null or anchor>statement_timestamp() or anchor<statement_timestamp()-interval '15 minutes'
        or boundary_time>anchor or boundary_time<anchor-interval '24 hours' then return app_private.api_error('INVALID_CURSOR',400); end if;
    exception when others then return app_private.api_error('INVALID_CURSOR',400); end;
  end if;
  resolved := public.resolve_region(requested); starting_scope := resolved->'region'->>'id';
  if length(initial_snapshot::text)>8000 then return app_private.api_error('SERVER_RETRY',503,true); end if;
  with eligible as materialized (select * from app_private.public_records(anchor,initial_snapshot)),
  scope_candidates as (
    select r.id,r.name,r.kind from app_private.regions r join app_private.region_ancestors a on a.ancestor_id=r.id where a.region_id=starting_scope and r.active
  ), chosen as (
    select s.* from scope_candidates s where s.id='world' or (select count(*) from (
      select distinct e.user_id from eligible e join app_private.region_ancestors a on a.region_id=e.public_region_id where a.ancestor_id=s.id limit 10
    ) contributors)>=10 order by case s.kind when 'locality' then 3 when 'admin1' then 2 when 'country' then 1 else 0 end desc limit 1
  ), visible as materialized (
    select e.* from eligible e cross join chosen s where (s.id='world' or exists(select 1 from app_private.region_ancestors a where a.region_id=e.public_region_id and a.ancestor_id=s.id))
      and (actor is null or not exists(select 1 from app_private.blocks b where (b.blocker_id=actor and b.blocked_id=e.user_id) or (b.blocked_id=actor and b.blocker_id=e.user_id)))
  ), candidates as materialized (
    select * from visible v where boundary_time is null or (v.occurred_at,v.id)<(boundary_time,boundary_id) order by v.occurred_at desc,v.id desc limit page_limit+1
  ), page as (select * from candidates order by occurred_at desc,id desc limit page_limit)
  select (select id from chosen),(select name from chosen),
    (select coalesce(sum(quantity),0)::text from visible),
    (select count(distinct user_id)::integer from visible where occurred_at>=anchor-interval '1 hour'),
    (select coalesce(jsonb_agg(jsonb_build_object('id',p.entry_id,'actor_id',p.actor_id,'username',p.alias,'quantity',p.quantity,
      'relative_time',case when extract(epoch from anchor-p.occurred_at)<60 then 'just now' when extract(epoch from anchor-p.occurred_at)<3600 then floor(extract(epoch from anchor-p.occurred_at)/60)::integer||'m ago' else floor(extract(epoch from anchor-p.occurred_at)/3600)::integer||'h ago' end)
      order by p.occurred_at desc,p.id desc),'[]'::jsonb) from page p),
    case when (select count(*) from candidates)>page_limit then (select occurred_at from page order by occurred_at,id limit 1) end,
    case when (select count(*) from candidates)>page_limit then (select id from page order by occurred_at,id limit 1) end
    into effective_id,effective_label,total,people,items,next_boundary_time,next_boundary_id;
  if effective_id is null then return app_private.api_error('SERVER_RETRY',503,true); end if;
  if cursor is not null and position->>'effective' is distinct from effective_id then return app_private.api_error('INVALID_CURSOR',400); end if;
  if next_boundary_id is not null then
    next_cursor := replace(encode(extensions.pgp_sym_encrypt(jsonb_build_object('v',1,'viewer',coalesce(actor::text,'guest'),'requested',requested,'effective',effective_id,
      'anchor',app_private.utc_text(anchor),'snapshot',initial_snapshot::text,'before_time',app_private.utc_text(next_boundary_time),'before_id',next_boundary_id)::text,key,'cipher-algo=aes256,compress-algo=0,disable-mdc=0,sess-key=1'),'base64'),E'\n','');
  end if;
  reason := case when resolved->>'fallback_reason' is not null then 'NO_REGION' when effective_id<>requested then 'SPARSE_REGION' end;
  return jsonb_build_object('request_id',gen_random_uuid(),'requested_scope',requested,'effective_scope',jsonb_build_object('id',effective_id,'label',effective_label),
    'fallback_reason',reason,'window',jsonb_build_object('label','past 24 hours','as_of',app_private.utc_text(anchor)),
    'people_past_hour',people,'pushups_past_24_hours',total,'items',items,'next_cursor',next_cursor);
exception
  when insufficient_privilege then return app_private.api_error('ACCOUNT_UNAVAILABLE',403);
  when lock_not_available or deadlock_detected or serialization_failure then return app_private.api_error('SERVER_RETRY',503,true);
  when others then return app_private.api_error('SERVER_RETRY',503,true);
end;
$$;
revoke all on function app_private.take_budget(uuid,text,integer), app_private.public_records(timestamptz,pg_snapshot), app_private.protect_public_identity() from public,anon,authenticated;
revoke all on function public.update_profile(jsonb), public.read_club(text,text,integer) from public,anon,authenticated;
grant execute on function public.update_profile(jsonb) to authenticated;
grant execute on function public.read_club(text,text,integer) to anon,authenticated;
