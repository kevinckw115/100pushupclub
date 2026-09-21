create function app_private.resolve_circle_actor(viewer uuid, member_key text) returns text language sql stable set search_path='' as $$
  select p.public_actor_id from app_private.circle_memberships target
  join app_private.profiles p on p.user_id=target.user_id
  join app_private.circles c on c.id=target.circle_id and c.deleted_at is null
  join app_private.circle_memberships own on own.circle_id=c.id and own.user_id=viewer and own.left_at is null
  where target.member_id=member_key and target.left_at is null;
$$;
revoke all on function app_private.resolve_circle_actor(uuid,text) from public,anon,authenticated;

create or replace function app_private.safety_action(envelope jsonb, action_name text) returns jsonb
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
    if (envelope-'operation_id'-'actor_id')<>'{}'::jsonb or coalesce(envelope->>'actor_id','') !~ '^[am]_[0-9a-f]{32}$' then return app_private.api_error('INVALID_REQUEST',400); end if;
    subject_kind := 'alias'; subject_key := envelope->>'actor_id';
  end if;
  if not app_private.take_budget(actor,case when action_name='report_subject' then 'report_requests' else action_name end,30) then return app_private.api_error('RATE_LIMITED',429,true); end if;
  digest := encode(sha256(convert_to((envelope||jsonb_build_object('operation_id',operation_key))::text,'UTF8')),'hex');
  select * into receipt from app_private.operation_receipts where user_id=actor and operation_id=operation_key;
  if found then
    if receipt.operation<>action_name or receipt.request_hash<>digest then return app_private.api_error('IDEMPOTENCY_KEY_REUSED',409); end if;
    return receipt.result;
  end if;
  if subject_kind='alias' and subject_key ~ '^m_' then
    subject_key := app_private.resolve_circle_actor(actor,subject_key);
    if subject_key is null then return app_private.api_error('NOT_FOUND_OR_FORBIDDEN',404); end if;
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
    response := jsonb_build_object('request_id',gen_random_uuid(),'operation_id',operation_key,'actor_id',envelope->>'actor_id','blocked',action_name='block_user');
  end if;
  insert into app_private.operation_receipts(user_id,operation_id,operation,request_hash,result) values(actor,operation_key,action_name,digest,response);
  return response;
exception
  when insufficient_privilege then return app_private.api_error('ACCOUNT_UNAVAILABLE',403);
  when others then return app_private.api_error('SERVER_RETRY',503,true);
end;
$$;
revoke all on function app_private.safety_action(jsonb,text) from public,anon,authenticated;
