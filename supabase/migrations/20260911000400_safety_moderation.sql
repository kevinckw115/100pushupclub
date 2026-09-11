alter table app_private.profiles add column alias_change_required boolean not null default false;
alter table app_private.profiles add column participation_terms_version text;
alter table app_private.profiles add column participation_accepted_at timestamptz;
-- Existing opt-ins need an explicit participation acceptance; past epochs never republish.
update app_private.profiles set public_enabled=false,consent_epoch=case when consent_epoch<9223372036854775807 then consent_epoch+1 else consent_epoch end where public_enabled;
alter table app_private.profiles add constraint public_participation_confirmed check (not public_enabled or coalesce(participation_terms_version='community-v1-2026-09-11' and participation_accepted_at is not null and not alias_change_required,false));
alter table app_private.circles add column name_change_required boolean not null default false;
alter table app_private.reports add column context jsonb not null default '{}'::jsonb;
create table app_private.staff_members (user_id uuid primary key references auth.users(id) on delete cascade, enabled boolean not null default true);
alter table app_private.staff_members enable row level security;
revoke all on app_private.staff_members from public,anon,authenticated;

create function app_private.require_staff() returns uuid language plpgsql security definer set search_path='' as $$
declare actor uuid := app_private.require_user();
begin
  if not exists(select 1 from app_private.staff_members where user_id=actor and enabled) then raise exception using errcode='42501',message='STAFF_REQUIRED'; end if;
  return actor;
end;
$$;
create function app_private.protect_moderation_audit() returns trigger language plpgsql set search_path='' as $$
begin raise exception 'Moderation audit is append-only'; end;
$$;
create trigger immutable_moderation_audit before update or delete on app_private.moderation_audit for each row execute function app_private.protect_moderation_audit();

create function app_private.visible_subject(viewer uuid, subject_kind text, subject_key text) returns jsonb
language sql stable set search_path='' as $$
  select context from (
    select jsonb_build_object('alias',r.alias,'quantity',r.quantity) context from app_private.public_records(statement_timestamp(),pg_current_snapshot()) r
    where subject_kind='checkin' and r.entry_id=subject_key and r.user_id<>viewer and not exists(select 1 from app_private.blocks b where (b.blocker_id=viewer and b.blocked_id=r.user_id) or (b.blocker_id=r.user_id and b.blocked_id=viewer))
    union all
    select jsonb_build_object('alias',p.alias) from app_private.profiles p
    where subject_kind='alias' and p.public_actor_id=subject_key and p.user_id<>viewer and p.account_status='active' and not p.alias_change_required
      and not exists(select 1 from app_private.deletion_jobs d where d.user_id=p.user_id)
      and not exists(select 1 from app_private.blocks b where (b.blocker_id=viewer and b.blocked_id=p.user_id) or (b.blocker_id=p.user_id and b.blocked_id=viewer))
      and (exists(select 1 from app_private.public_records(statement_timestamp(),pg_current_snapshot()) r where r.user_id=p.user_id)
        or exists(select 1 from app_private.circle_memberships a join app_private.circle_memberships b on b.circle_id=a.circle_id join app_private.circles c on c.id=a.circle_id
          where a.user_id=viewer and b.user_id=p.user_id and a.left_at is null and b.left_at is null and c.deleted_at is null))
    union all
    select jsonb_build_object('name',c.name) from app_private.circles c join app_private.circle_memberships m on m.circle_id=c.id
    where subject_kind='circle_name' and c.id=case when subject_key ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then subject_key::uuid end
      and c.deleted_at is null and m.user_id=viewer and m.left_at is null
  ) visible limit 1;
$$;

create function app_private.take_report_budget(actor uuid) returns boolean language plpgsql set search_path='' as $$
declare bucket timestamptz := date_trunc('hour',statement_timestamp()); used_count integer;
begin
  insert into app_private.request_budgets(user_id,operation,window_start,used) values(actor,'report_subject',bucket,1)
  on conflict(user_id,operation) do update set window_start=excluded.window_start,
    used=case when app_private.request_budgets.window_start=excluded.window_start then least(11,app_private.request_budgets.used+1) else 1 end
  returning used into used_count;
  if used_count>10 then
    perform set_config('response.headers',jsonb_build_array(jsonb_build_object('Retry-After',greatest(1,ceil(extract(epoch from bucket+interval '1 hour'-statement_timestamp()))::integer)::text))::text,true);
    return false;
  end if;
  return true;
end;
$$;

create function app_private.safety_action(envelope jsonb, action_name text) returns jsonb
language plpgsql security definer set search_path='' set lock_timeout='5s' set statement_timeout='10s' as $$
declare actor uuid; target uuid; operation_key uuid; digest text; receipt app_private.operation_receipts;
  subject_kind text; subject_key text; report_reason text; report_context jsonb; response jsonb; report_id uuid;
begin
  actor := app_private.require_user();
  perform 1 from app_private.profiles where user_id=actor and account_status='active' for update;
  if not found then return app_private.api_error('ACCOUNT_UNAVAILABLE',403); end if;
  if action_name not in ('block_user','unblock_user','report_subject') or envelope is null or jsonb_typeof(envelope)<>'object' or octet_length(envelope::text)>2048
    or coalesce(envelope->>'operation_id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then return app_private.api_error('INVALID_REQUEST',400); end if;
  operation_key := (envelope->>'operation_id')::uuid;
  if action_name='report_subject' then
    if (envelope-'operation_id'-'subject_type'-'subject_id'-'reason')<>'{}'::jsonb or coalesce(envelope->>'subject_type','') not in ('alias','circle_name','checkin')
      or jsonb_typeof(envelope->'subject_id') is distinct from 'string' or length(envelope->>'subject_id')>80
      or coalesce(envelope->>'reason','') not in ('abuse','impersonation','inappropriate_name','other') then return app_private.api_error('INVALID_REQUEST',400); end if;
    subject_kind := envelope->>'subject_type'; subject_key := envelope->>'subject_id'; report_reason := envelope->>'reason';
  else
    if (envelope-'operation_id'-'actor_id')<>'{}'::jsonb or coalesce(envelope->>'actor_id','') !~ '^a_[0-9a-f]{32}$' then return app_private.api_error('INVALID_REQUEST',400); end if;
    subject_kind := 'alias'; subject_key := envelope->>'actor_id';
  end if;
  if not app_private.take_budget(actor,case when action_name='report_subject' then 'report_requests' else action_name end,30) then return app_private.api_error('RATE_LIMITED',429,true); end if;
  digest := encode(sha256(convert_to((envelope||jsonb_build_object('operation_id',operation_key))::text,'UTF8')),'hex');
  select * into receipt from app_private.operation_receipts where user_id=actor and operation_id=operation_key;
  if found then
    if receipt.operation<>action_name or receipt.request_hash<>digest then return app_private.api_error('IDEMPOTENCY_KEY_REUSED',409); end if;
    return receipt.result;
  end if;
  if action_name='report_subject' then
    if not app_private.take_report_budget(actor) then return app_private.api_error('RATE_LIMITED',429,true); end if;
    report_context := app_private.visible_subject(actor,subject_kind,subject_key);
    if report_context is null then return app_private.api_error('NOT_FOUND_OR_FORBIDDEN',404); end if;
    insert into app_private.reports(reporter_id,subject_type,subject_id,reason,context) values(actor,subject_kind,subject_key,report_reason,report_context) returning id into report_id;
    response := jsonb_build_object('request_id',gen_random_uuid(),'operation_id',operation_key,'report_id',report_id,'received',true);
  else
    select user_id into target from app_private.profiles where public_actor_id=subject_key;
    if target is null or target=actor then return app_private.api_error('NOT_FOUND_OR_FORBIDDEN',404); end if;
    if not exists(select 1 from app_private.blocks where blocker_id=actor and blocked_id=target) and app_private.visible_subject(actor,'alias',subject_key) is null then return app_private.api_error('NOT_FOUND_OR_FORBIDDEN',404); end if;
    if action_name='block_user' then insert into app_private.blocks(blocker_id,blocked_id) values(actor,target) on conflict do nothing;
    else delete from app_private.blocks where blocker_id=actor and blocked_id=target; end if;
    response := jsonb_build_object('request_id',gen_random_uuid(),'operation_id',operation_key,'actor_id',subject_key,'blocked',action_name='block_user');
  end if;
  insert into app_private.operation_receipts(user_id,operation_id,operation,request_hash,result) values(actor,operation_key,action_name,digest,response);
  return response;
exception
  when insufficient_privilege then return app_private.api_error('ACCOUNT_UNAVAILABLE',403);
  when others then return app_private.api_error('SERVER_RETRY',503,true);
end;
$$;
create function public.block_user(envelope jsonb) returns jsonb language sql security definer set search_path='' as $$ select app_private.safety_action(envelope,'block_user'); $$;
create function public.unblock_user(envelope jsonb) returns jsonb language sql security definer set search_path='' as $$ select app_private.safety_action(envelope,'unblock_user'); $$;
create function public.report_subject(envelope jsonb) returns jsonb language sql security definer set search_path='' as $$ select app_private.safety_action(envelope,'report_subject'); $$;

create function public.list_blocks(after_actor text default null, "limit" integer default 25) returns jsonb
language plpgsql security definer set search_path='' set statement_timeout='5s' as $$
declare actor uuid; items jsonb; last_key text; count_rows integer;
begin
  actor := app_private.require_user();
  if not exists(select 1 from app_private.profiles where user_id=actor) then return app_private.api_error('ACCOUNT_UNAVAILABLE',403); end if;
  if "limit" is null or "limit"<1 or "limit">50 or (after_actor is not null and after_actor !~ '^a_[a-f0-9]{32}$') then return app_private.api_error('INVALID_REQUEST',400); end if;
  if not app_private.take_budget(actor,'list_blocks',30) then return app_private.api_error('RATE_LIMITED',429,true); end if;
  with selected as (select p.public_actor_id actor_id,case when p.account_status<>'active' or p.alias_change_required then 'Account unavailable' else p.alias end alias
    from app_private.blocks b join app_private.profiles p on p.user_id=b.blocked_id where b.blocker_id=actor and (after_actor is null or p.public_actor_id>after_actor) order by p.public_actor_id limit "limit"+1),
  shown as (select * from selected order by actor_id limit "limit")
  select coalesce((select jsonb_agg(to_jsonb(s) order by actor_id) from shown s),'[]'::jsonb),(select max(actor_id) from shown),(select count(*) from selected) into items,last_key,count_rows;
  return jsonb_build_object('request_id',gen_random_uuid(),'items',items,'next_actor',case when count_rows>"limit" then last_key end);
exception when insufficient_privilege then return app_private.api_error('ACCOUNT_UNAVAILABLE',403);
  when others then return app_private.api_error('SERVER_RETRY',503,true);
end;
$$;

create function public.staff_list_reports(after_report uuid default null, "limit" integer default 25) returns jsonb
language plpgsql security definer set search_path='' set statement_timeout='5s' as $$
declare actor uuid; after_time timestamptz; items jsonb; last_key uuid; count_rows integer;
begin
  actor := app_private.require_staff();
  if "limit" is null or "limit"<1 or "limit">50 then return app_private.api_error('INVALID_REQUEST',400); end if;
  if not app_private.take_budget(actor,'staff_list_reports',60) then return app_private.api_error('RATE_LIMITED',429,true); end if;
  if after_report is not null then select created_at into after_time from app_private.reports where id=after_report; if not found then return app_private.api_error('INVALID_CURSOR',400); end if; end if;
  with selected as (select id,subject_type,subject_id,reason,context,created_at from app_private.reports where status='open'
    and (after_report is null or (created_at,id)>(after_time,after_report)) order by created_at,id limit "limit"+1),
  shown as (select * from selected order by created_at,id limit "limit")
  select coalesce((select jsonb_agg(to_jsonb(s) order by created_at,id) from shown s),'[]'::jsonb),(select id from shown order by created_at desc,id desc limit 1),(select count(*) from selected) into items,last_key,count_rows;
  return jsonb_build_object('request_id',gen_random_uuid(),'items',items,'next_report',case when count_rows>"limit" then last_key end);
exception when insufficient_privilege then return app_private.api_error('STAFF_REQUIRED',403);
  when others then return app_private.api_error('SERVER_RETRY',503,true);
end;
$$;

create function public.staff_moderate(envelope jsonb) returns jsonb
language plpgsql security definer set search_path='' set lock_timeout='5s' set statement_timeout='10s' as $$
declare actor uuid; operation_key uuid; action_name text; subject_key text; private_reason text;
  target uuid; digest text; receipt app_private.operation_receipts; response jsonb; current_status text;
begin
  actor := app_private.require_staff();
  perform 1 from app_private.profiles where user_id=actor for update;
  if not found then return app_private.api_error('STAFF_REQUIRED',403); end if;
  if not app_private.take_budget(actor,'staff_moderate',60) then return app_private.api_error('RATE_LIMITED',429,true); end if;
  if envelope is null or jsonb_typeof(envelope)<>'object' or octet_length(envelope::text)>4096 or (envelope-'operation_id'-'action'-'subject_id'-'reason'-'resolution')<>'{}'::jsonb
    or coalesce(envelope->>'operation_id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or coalesce(envelope->>'action','') not in ('hide_entry','require_alias','require_circle_name','suspend','restore','resolve_report')
    or jsonb_typeof(envelope->'subject_id') is distinct from 'string' or length(envelope->>'subject_id')>80
    or jsonb_typeof(envelope->'reason') is distinct from 'string' or length(btrim(envelope->>'reason')) not between 5 and 500 then return app_private.api_error('INVALID_REQUEST',400); end if;
  action_name := envelope->>'action'; subject_key := envelope->>'subject_id'; private_reason := btrim(envelope->>'reason'); operation_key := (envelope->>'operation_id')::uuid;
  if (action_name='resolve_report' and coalesce(envelope->>'resolution','') not in ('resolved','dismissed')) or (action_name<>'resolve_report' and envelope ? 'resolution') then return app_private.api_error('INVALID_REQUEST',400); end if;
  digest := encode(sha256(convert_to((envelope||jsonb_build_object('operation_id',operation_key,'reason',private_reason))::text,'UTF8')),'hex');
  select * into receipt from app_private.operation_receipts where user_id=actor and operation_id=operation_key;
  if found then if receipt.operation<>'staff_moderate' or receipt.request_hash<>digest then return app_private.api_error('IDEMPOTENCY_KEY_REUSED',409); end if; return receipt.result; end if;
  if action_name='hide_entry' then
    update app_private.checkins set moderation_excluded=true where public_entry_id=subject_key;
    if not found then return app_private.api_error('NOT_FOUND_OR_FORBIDDEN',404); end if;
  elsif action_name in ('require_alias','suspend','restore') then
    select user_id,account_status into target,current_status from app_private.profiles where public_actor_id=subject_key for update;
    if not found or target=actor or current_status='deleting' or exists(select 1 from app_private.deletion_jobs where user_id=target) then return app_private.api_error('NOT_FOUND_OR_FORBIDDEN',404); end if;
    update app_private.profiles set public_enabled=false,consent_epoch=case when consent_epoch<9223372036854775807 then consent_epoch+1 else consent_epoch end,
      alias_change_required=case when action_name='require_alias' then true else alias_change_required end,
      account_status=case when action_name='suspend' then 'suspended' when action_name='restore' then 'active' else account_status end where user_id=target;
  elsif action_name='require_circle_name' then
    if subject_key !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then return app_private.api_error('INVALID_REQUEST',400); end if;
    update app_private.circles set name='Name needs review',name_change_required=true where id=subject_key::uuid and deleted_at is null;
    if not found then return app_private.api_error('NOT_FOUND_OR_FORBIDDEN',404); end if;
    update app_private.circle_invites set revoked_at=coalesce(revoked_at,statement_timestamp()) where circle_id=subject_key::uuid;
  else
    if subject_key !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then return app_private.api_error('INVALID_REQUEST',400); end if;
    update app_private.reports set status=envelope->>'resolution' where id=subject_key::uuid;
    if not found then return app_private.api_error('NOT_FOUND_OR_FORBIDDEN',404); end if;
  end if;
  insert into app_private.moderation_audit(staff_id,action,subject_id,reason) values(actor,action_name,subject_key,private_reason);
  response := jsonb_build_object('request_id',gen_random_uuid(),'operation_id',operation_key,'applied',true);
  insert into app_private.operation_receipts(user_id,operation_id,operation,request_hash,result) values(actor,operation_key,'staff_moderate',digest,response);
  return response;
exception when insufficient_privilege then return app_private.api_error('STAFF_REQUIRED',403);
  when others then return app_private.api_error('SERVER_RETRY',503,true);
end;
$$;

revoke all on function app_private.require_staff(),app_private.protect_moderation_audit(),app_private.visible_subject(uuid,text,text),app_private.take_report_budget(uuid),app_private.safety_action(jsonb,text) from public,anon,authenticated;
revoke all on function public.block_user(jsonb),public.unblock_user(jsonb),public.report_subject(jsonb),public.list_blocks(text,integer),public.staff_list_reports(uuid,integer),public.staff_moderate(jsonb) from public,anon,authenticated;
grant execute on function public.block_user(jsonb),public.unblock_user(jsonb),public.report_subject(jsonb),public.list_blocks(text,integer),public.staff_list_reports(uuid,integer),public.staff_moderate(jsonb) to authenticated;
