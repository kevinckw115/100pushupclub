insert into app_private.server_secrets(name,value) values('circle_invite_v1',encode(extensions.gen_random_bytes(32),'hex'));
create table app_private.global_budgets (operation text primary key,window_start timestamptz not null,used integer not null check(used between 0 and 301));
alter table app_private.global_budgets enable row level security;
revoke all on app_private.global_budgets from public,anon,authenticated;

create function app_private.lock_circle_users(actor uuid, target uuid default null) returns void language plpgsql set search_path='' as $$
declare current_user_id uuid;
begin
  for current_user_id in select distinct id from unnest(array[actor,target]) id where id is not null order by id loop
    perform pg_advisory_xact_lock(hashtextextended('circle-user:'||current_user_id::text,0));
  end loop;
  perform 1 from app_private.profiles where user_id=any(array[actor,target]) order by user_id for update;
end;
$$;
create function app_private.valid_circle_name(value text) returns boolean language sql stable set search_path='' as $$
  select value is not null and length(btrim(value)) between 3 and 40 and value !~ '[[:cntrl:]]'
    and not exists(select 1 from app_private.reserved_circle_names where name_normalized=lower(btrim(value)));
$$;
create function app_private.invite_code(actor uuid, operation_key uuid, circle_key uuid) returns text language sql stable set search_path='' as $$
  select 'pc_'||encode(extensions.hmac(convert_to('circle-invite:'||actor::text||':'||operation_key::text||':'||circle_key::text,'UTF8'),decode(value,'hex'),'sha256'),'hex')
  from app_private.server_secrets where name='circle_invite_v1';
$$;
create function app_private.take_invite_global_budget() returns boolean language plpgsql set search_path='' as $$
declare bucket timestamptz := date_trunc('minute',statement_timestamp()); used_count integer;
begin
  insert into app_private.global_budgets(operation,window_start,used) values('preview_invite',bucket,1)
  on conflict(operation) do update set window_start=excluded.window_start,
    used=case when app_private.global_budgets.window_start=excluded.window_start then least(301,app_private.global_budgets.used+1) else 1 end returning used into used_count;
  if used_count>300 then
    perform set_config('response.headers',jsonb_build_array(jsonb_build_object('Retry-After',greatest(1,ceil(extract(epoch from bucket+interval '1 minute'-statement_timestamp()))::integer)::text))::text,true);
    return false;
  end if;
  return true;
end;
$$;

create function public.preview_invite(code text) returns jsonb language plpgsql security definer set search_path='' set statement_timeout='5s' as $$
declare actor uuid; normalized text := lower(btrim(code)); result jsonb;
begin
  actor := app_private.require_user();
  if not exists(select 1 from app_private.profiles where user_id=actor) then return app_private.api_error('ACCOUNT_UNAVAILABLE',403); end if;
  if not app_private.take_budget(actor,'preview_invite',10) or not app_private.take_invite_global_budget() then return app_private.api_error('RATE_LIMITED',429,true); end if;
  if normalized is null or length(normalized)<>67 or normalized !~ '^pc_[0-9a-f]{64}$' then return app_private.api_error('INVITE_UNAVAILABLE',404); end if;
  select jsonb_build_object('request_id',gen_random_uuid(),'name',c.name,'timezone',c.timezone,
    'member_count',(select count(*) from app_private.circle_memberships m where m.circle_id=c.id and m.left_at is null),
    'expires_in_seconds',greatest(0,floor(extract(epoch from i.expires_at-statement_timestamp()))::integer)) into result
  from app_private.circle_invites i join app_private.circles c on c.id=i.circle_id join app_private.profiles owner on owner.user_id=c.owner_id
  where i.token_hash=encode(sha256(convert_to(normalized,'UTF8')),'hex') and i.revoked_at is null and i.expires_at>statement_timestamp()
    and c.deleted_at is null and not c.name_change_required and i.created_by=c.owner_id and owner.account_status='active' and not owner.alias_change_required
    and not exists(select 1 from app_private.deletion_jobs d where d.user_id=owner.user_id);
  if result is null then return app_private.api_error('INVITE_UNAVAILABLE',404); end if;
  return result;
exception when insufficient_privilege then return app_private.api_error('ACCOUNT_UNAVAILABLE',403);
  when others then return app_private.api_error('SERVER_RETRY',503,true);
end;
$$;

create function app_private.circle_write(envelope jsonb, operation_name text) returns jsonb
language plpgsql security definer set search_path='' set lock_timeout='5s' set statement_timeout='10s' as $$
declare actor uuid; target uuid; operation_key uuid; circle_key uuid; invite_key uuid; semantic jsonb; digest text;
  normalized_code text; code_hash text; desired_name text; desired_timezone text; action_name text;
  current_circle app_private.circles; member app_private.circle_memberships; target_member app_private.circle_memberships;
  invitation app_private.circle_invites; receipt app_private.operation_receipts; response jsonb; joined_time timestamptz;
  member_count integer; quota_count integer; generated_code text;
begin
  actor := app_private.require_user();
  if operation_name not in ('create_circle','join_circle','create_invite','manage_circle') or envelope is null or jsonb_typeof(envelope)<>'object' or octet_length(envelope::text)>4096
    or coalesce(envelope->>'operation_id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then return app_private.api_error('INVALID_REQUEST',400); end if;
  operation_key := (envelope->>'operation_id')::uuid; semantic := jsonb_build_object('operation_id',operation_key);
  if operation_name='create_circle' then
    if (envelope-'operation_id'-'name'-'timezone'-'accept_circle_sharing')<>'{}'::jsonb or envelope->'accept_circle_sharing' is distinct from 'true'::jsonb
      or jsonb_typeof(envelope->'name') is distinct from 'string' or jsonb_typeof(envelope->'timezone') is distinct from 'string' then return app_private.api_error('INVALID_REQUEST',400); end if;
    desired_name := btrim(envelope->>'name'); desired_timezone := envelope->>'timezone';
    if not app_private.valid_circle_name(desired_name) then return app_private.api_error('INVALID_CIRCLE_NAME',400); end if;
    if length(desired_timezone)>100 or not exists(select 1 from pg_catalog.pg_timezone_names where name=desired_timezone) then return app_private.api_error('INVALID_TIMEZONE',400); end if;
    semantic := semantic||jsonb_build_object('name',desired_name,'timezone',desired_timezone,'accept_circle_sharing',true);
  elsif operation_name='join_circle' then
    if (envelope-'operation_id'-'code'-'accept_circle_sharing')<>'{}'::jsonb or envelope->'accept_circle_sharing' is distinct from 'true'::jsonb or jsonb_typeof(envelope->'code') is distinct from 'string' then return app_private.api_error('INVALID_REQUEST',400); end if;
    normalized_code := lower(btrim(envelope->>'code'));
    if length(normalized_code)<>67 or normalized_code !~ '^pc_[0-9a-f]{64}$' then return app_private.api_error('INVITE_UNAVAILABLE',404); end if;
    code_hash := encode(sha256(convert_to(normalized_code,'UTF8')),'hex'); semantic := semantic||jsonb_build_object('code_hash',code_hash,'accept_circle_sharing',true);
  else
    if coalesce(envelope->>'circle_id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then return app_private.api_error('INVALID_REQUEST',400); end if;
    circle_key := (envelope->>'circle_id')::uuid; semantic := semantic||jsonb_build_object('circle_id',circle_key);
    if operation_name='create_invite' then
      if (envelope-'operation_id'-'circle_id')<>'{}'::jsonb then return app_private.api_error('INVALID_REQUEST',400); end if;
    else
      action_name := envelope->>'action';
      if coalesce(action_name,'') not in ('leave','delete','remove','transfer','revoke_invite','rename') then return app_private.api_error('INVALID_REQUEST',400); end if;
      semantic := semantic||jsonb_build_object('action',action_name);
      if action_name in ('remove','transfer') then
        if (envelope-'operation_id'-'circle_id'-'action'-'member_id')<>'{}'::jsonb or coalesce(envelope->>'member_id','') !~ '^m_[0-9a-f]{32}$' then return app_private.api_error('INVALID_REQUEST',400); end if;
        select user_id into target from app_private.circle_memberships m where m.circle_id=circle_key and m.member_id=envelope->>'member_id' and m.left_at is null;
        semantic := semantic||jsonb_build_object('member_id',envelope->>'member_id');
      elsif action_name='revoke_invite' then
        if (envelope-'operation_id'-'circle_id'-'action'-'invite_id')<>'{}'::jsonb or coalesce(envelope->>'invite_id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then return app_private.api_error('INVALID_REQUEST',400); end if;
        invite_key := (envelope->>'invite_id')::uuid; semantic := semantic||jsonb_build_object('invite_id',invite_key);
      elsif action_name='rename' then
        if (envelope-'operation_id'-'circle_id'-'action'-'name')<>'{}'::jsonb or jsonb_typeof(envelope->'name') is distinct from 'string' then return app_private.api_error('INVALID_REQUEST',400); end if;
        desired_name := btrim(envelope->>'name'); if not app_private.valid_circle_name(desired_name) then return app_private.api_error('INVALID_CIRCLE_NAME',400); end if;
        semantic := semantic||jsonb_build_object('name',desired_name);
      elsif (envelope-'operation_id'-'circle_id'-'action')<>'{}'::jsonb then return app_private.api_error('INVALID_REQUEST',400); end if;
    end if;
  end if;
  perform app_private.lock_circle_users(actor,target);
  actor := app_private.require_user();
  if not exists(select 1 from app_private.profiles where user_id=actor) then return app_private.api_error('ACCOUNT_UNAVAILABLE',403); end if;
  if not app_private.take_budget(actor,'circle_writes',30) then return app_private.api_error('RATE_LIMITED',429,true); end if;
  digest := encode(sha256(convert_to(semantic::text,'UTF8')),'hex');
  select * into receipt from app_private.operation_receipts where user_id=actor and operation_id=operation_key;
  if found then
    if receipt.operation<>operation_name or receipt.request_hash<>digest then return app_private.api_error('IDEMPOTENCY_KEY_REUSED',409); end if;
    -- Management receipts acknowledge past effects only; they never return current private group data or reapply an old removal.
    if operation_name='manage_circle' then return receipt.result; end if;
    if operation_name in ('create_circle','join_circle') then
      circle_key := (receipt.result->'circle'->>'id')::uuid;
      perform 1 from app_private.circles where id=circle_key and deleted_at is null for update;
      if not found or not exists(select 1 from app_private.circle_memberships m where m.circle_id=circle_key and m.user_id=actor and m.left_at is null and m.member_id=receipt.result->'circle'->>'member_id') then return app_private.api_error('MEMBERSHIP_CHANGED',409); end if;
      return receipt.result;
    end if;
    select * into current_circle from app_private.circles where id=circle_key and deleted_at is null for update;
    if not found or current_circle.owner_id<>actor then return app_private.api_error('NOT_FOUND_OR_FORBIDDEN',404); end if;
    select * into invitation from app_private.circle_invites where id=(receipt.result->'invite'->>'id')::uuid and circle_id=circle_key;
    if not found or invitation.revoked_at is not null or invitation.expires_at<=clock_timestamp() or current_circle.name_change_required then return app_private.api_error('INVITE_UNAVAILABLE',404); end if;
    perform app_private.require_participation(); generated_code := app_private.invite_code(actor,operation_key,circle_key);
    if generated_code is null or encode(sha256(convert_to(generated_code,'UTF8')),'hex')<>invitation.token_hash then return app_private.api_error('INVITE_UNAVAILABLE',404); end if;
    return jsonb_set(receipt.result,'{invite,code}',to_jsonb(generated_code));
  end if;

  if operation_name='create_circle' then
    perform app_private.require_participation();
    select count(*) into quota_count from app_private.circle_memberships m join app_private.circles c on c.id=m.circle_id where m.user_id=actor and m.left_at is null and c.deleted_at is null;
    if quota_count>=5 then return app_private.api_error('CIRCLE_LIMIT',409); end if;
    circle_key := gen_random_uuid(); joined_time := date_trunc('milliseconds',clock_timestamp());
    insert into app_private.circles(id,owner_id,name,timezone,created_at) values(circle_key,actor,desired_name,desired_timezone,joined_time);
    insert into app_private.circle_memberships(circle_id,user_id,joined_at) values(circle_key,actor,joined_time);
    response := jsonb_build_object('request_id',gen_random_uuid(),'operation_id',operation_key,'circle',app_private.circle_summary(circle_key,actor));
  else
    if operation_name='join_circle' then
      perform app_private.require_participation();
      select circle_id into circle_key from app_private.circle_invites where token_hash=code_hash;
      if not found then return app_private.api_error('INVITE_UNAVAILABLE',404); end if;
    end if;
    select * into current_circle from app_private.circles where id=circle_key and deleted_at is null for update;
    if not found then return app_private.api_error('NOT_FOUND_OR_FORBIDDEN',404); end if;
    select * into member from app_private.circle_memberships m where m.circle_id=circle_key and m.user_id=actor and m.left_at is null;
    if operation_name='join_circle' then
      select * into invitation from app_private.circle_invites where token_hash=code_hash and circle_id=circle_key;
      if not found or invitation.revoked_at is not null or invitation.expires_at<=clock_timestamp() or invitation.created_by<>current_circle.owner_id or current_circle.name_change_required
        or not exists(select 1 from app_private.profiles p where p.user_id=current_circle.owner_id and p.account_status='active' and not p.alias_change_required and not exists(select 1 from app_private.deletion_jobs d where d.user_id=p.user_id)) then return app_private.api_error('INVITE_UNAVAILABLE',404); end if;
      if member.user_id is null then
        select count(*) into member_count from app_private.circle_memberships m where m.circle_id=circle_key and m.left_at is null;
        if member_count>=20 then return app_private.api_error('CIRCLE_FULL',409); end if;
        select count(*) into quota_count from app_private.circle_memberships m join app_private.circles c on c.id=m.circle_id where m.user_id=actor and m.left_at is null and c.deleted_at is null;
        if quota_count>=5 then return app_private.api_error('CIRCLE_LIMIT',409); end if;
        joined_time := date_trunc('milliseconds',clock_timestamp());
        insert into app_private.circle_memberships(circle_id,user_id,joined_at) values(circle_key,actor,joined_time)
        on conflict(circle_id,user_id) do update set joined_at=excluded.joined_at,left_at=null,member_id='m_'||encode(extensions.gen_random_bytes(16),'hex');
      end if;
      response := jsonb_build_object('request_id',gen_random_uuid(),'operation_id',operation_key,'circle',app_private.circle_summary(circle_key,actor));
    elsif member.user_id is null then return app_private.api_error('NOT_FOUND_OR_FORBIDDEN',404);
    elsif operation_name='create_invite' then
      perform app_private.require_participation();
      if current_circle.owner_id<>actor then return app_private.api_error('NOT_FOUND_OR_FORBIDDEN',404); end if;
      if current_circle.name_change_required then return app_private.api_error('CIRCLE_NAME_REQUIRED',409); end if;
      if (select count(*) from app_private.circle_invites i where i.circle_id=circle_key and i.revoked_at is null and i.expires_at>clock_timestamp())>=5 then return app_private.api_error('INVITE_LIMIT',409); end if;
      generated_code := app_private.invite_code(actor,operation_key,circle_key);
      if generated_code is null then return app_private.api_error('SERVER_RETRY',503,true); end if;
      insert into app_private.circle_invites(circle_id,token_hash,expires_at,created_by) values(circle_key,encode(sha256(convert_to(generated_code,'UTF8')),'hex'),clock_timestamp()+interval '7 days',actor) returning * into invitation;
      response := jsonb_build_object('request_id',gen_random_uuid(),'operation_id',operation_key,'circle_id',circle_key,'invite',jsonb_build_object('id',invitation.id,'expires_at',app_private.utc_text(invitation.expires_at)));
    else
      if action_name='leave' then
        if current_circle.owner_id=actor then return app_private.api_error('OWNER_TRANSFER_REQUIRED',409); end if;
        update app_private.circle_memberships m set left_at=clock_timestamp() where m.circle_id=circle_key and m.user_id=actor and m.left_at is null;
      else
        if current_circle.owner_id<>actor then return app_private.api_error('NOT_FOUND_OR_FORBIDDEN',404); end if;
        if action_name='delete' then
          update app_private.circles set deleted_at=clock_timestamp() where id=circle_key;
          update app_private.circle_memberships m set left_at=clock_timestamp() where m.circle_id=circle_key and m.left_at is null;
          update app_private.circle_invites i set revoked_at=coalesce(revoked_at,clock_timestamp()) where i.circle_id=circle_key;
        elsif action_name='rename' then update app_private.circles set name=desired_name,name_change_required=false where id=circle_key;
        elsif action_name='revoke_invite' then
          update app_private.circle_invites i set revoked_at=coalesce(revoked_at,clock_timestamp()) where i.id=invite_key and i.circle_id=circle_key;
          if not found then return app_private.api_error('NOT_FOUND_OR_FORBIDDEN',404); end if;
        else
          select * into target_member from app_private.circle_memberships m where m.circle_id=circle_key and m.member_id=envelope->>'member_id' and m.left_at is null;
          if not found or target_member.user_id=actor or target_member.user_id is distinct from target then return app_private.api_error('NOT_FOUND_OR_FORBIDDEN',404); end if;
          if action_name='remove' then update app_private.circle_memberships m set left_at=clock_timestamp() where m.circle_id=circle_key and m.user_id=target;
          else
            if not exists(select 1 from app_private.profiles p where p.user_id=target and p.account_status='active' and not p.alias_change_required and not exists(select 1 from app_private.deletion_jobs d where d.user_id=target)) then return app_private.api_error('NOT_FOUND_OR_FORBIDDEN',404); end if;
            update app_private.circles set owner_id=target where id=circle_key;
            update app_private.circle_invites i set revoked_at=coalesce(revoked_at,clock_timestamp()) where i.circle_id=circle_key;
          end if;
        end if;
      end if;
      response := jsonb_build_object('request_id',gen_random_uuid(),'operation_id',operation_key,'circle_id',circle_key,'applied',true);
    end if;
  end if;
  insert into app_private.operation_receipts(user_id,operation_id,operation,request_hash,result) values(actor,operation_key,operation_name,digest,response);
  if operation_name='create_invite' then return jsonb_set(response,'{invite,code}',to_jsonb(generated_code)); end if;
  return response;
exception when insufficient_privilege then return app_private.api_error(case when sqlerrm='PARTICIPATION_REQUIRED' then 'PARTICIPATION_REQUIRED' else 'ACCOUNT_UNAVAILABLE' end,403);
  when others then return app_private.api_error('SERVER_RETRY',503,true);
end;
$$;

create function public.create_circle(envelope jsonb) returns jsonb language sql security definer set search_path='' as $$ select app_private.circle_write(envelope,'create_circle'); $$;
create function public.join_circle(envelope jsonb) returns jsonb language sql security definer set search_path='' as $$ select app_private.circle_write(envelope,'join_circle'); $$;
create function public.create_invite(envelope jsonb) returns jsonb language sql security definer set search_path='' as $$ select app_private.circle_write(envelope,'create_invite'); $$;
create function public.manage_circle(envelope jsonb) returns jsonb language sql security definer set search_path='' as $$ select app_private.circle_write(envelope,'manage_circle'); $$;
revoke all on function app_private.lock_circle_users(uuid,uuid),app_private.valid_circle_name(text),app_private.invite_code(uuid,uuid,uuid),app_private.take_invite_global_budget(),app_private.circle_write(jsonb,text) from public,anon,authenticated;
revoke all on function public.preview_invite(text),public.create_circle(jsonb),public.join_circle(jsonb),public.create_invite(jsonb),public.manage_circle(jsonb) from public,anon,authenticated;
grant execute on function public.preview_invite(text),public.create_circle(jsonb),public.join_circle(jsonb),public.create_invite(jsonb),public.manage_circle(jsonb) to authenticated;
