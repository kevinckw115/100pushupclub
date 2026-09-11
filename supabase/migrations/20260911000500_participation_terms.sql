create or replace function app_private.profile_json(actor uuid) returns jsonb
language sql stable set search_path='' as $$
  select jsonb_build_object('alias',alias,'region_id',region_id,'public_enabled',public_enabled,'consent_epoch',consent_epoch::text,'status',account_status,
    'participation_terms_version',participation_terms_version,'alias_change_required',alias_change_required)
  from app_private.profiles where user_id=actor;
$$;
create function app_private.require_participation() returns uuid language plpgsql security definer set search_path='' as $$
declare actor uuid := app_private.require_user();
begin
  if not exists(select 1 from app_private.profiles where user_id=actor and participation_terms_version='community-v1-2026-09-11' and participation_accepted_at is not null and not alias_change_required) then
    raise exception using errcode='42501',message='PARTICIPATION_REQUIRED';
  end if;
  return actor;
end;
$$;
revoke all on function app_private.require_participation() from public,anon,authenticated;

create or replace function public.update_profile(envelope jsonb) returns jsonb
language plpgsql security definer set search_path='' set lock_timeout='5s' set statement_timeout='10s' as $$
declare actor uuid; current_profile app_private.profiles; receipt app_private.operation_receipts;
  operation_key uuid; semantic jsonb; digest text; desired_alias text; desired_region text; desired_public boolean;
  expected_epoch bigint; next_epoch bigint; response jsonb; desired_terms text;
begin
  actor := app_private.require_user();
  select * into current_profile from app_private.profiles where user_id=actor for update;
  if not found or current_profile.account_status<>'active' then return app_private.api_error('ACCOUNT_UNAVAILABLE',403); end if;
  if not app_private.take_budget(actor,'update_profile',30) then return app_private.api_error('RATE_LIMITED',429,true); end if;
  if envelope is null or jsonb_typeof(envelope)<>'object' or octet_length(envelope::text)>4096
    or not envelope ? 'operation_id' or (envelope-'operation_id'-'alias'-'region_id'-'public_enabled'-'expected_consent_epoch'-'accepted_terms_version')<>'{}'::jsonb
    or (envelope-'operation_id'-'expected_consent_epoch')='{}'::jsonb then return app_private.api_error('INVALID_REQUEST',400); end if;
  if coalesce(envelope->>'operation_id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then return app_private.api_error('INVALID_REQUEST',400); end if;
  operation_key := (envelope->>'operation_id')::uuid;
  desired_alias := current_profile.alias; desired_region := current_profile.region_id; desired_public := current_profile.public_enabled;
  semantic := jsonb_build_object('operation_id',operation_key);
  desired_terms := current_profile.participation_terms_version;
  if envelope ? 'accepted_terms_version' then
    if jsonb_typeof(envelope->'accepted_terms_version') is distinct from 'string' or envelope->>'accepted_terms_version'<>'community-v1-2026-09-11' then return app_private.api_error('INVALID_REQUEST',400); end if;
    desired_terms := envelope->>'accepted_terms_version'; semantic := semantic||jsonb_build_object('accepted_terms_version',desired_terms);
  end if;
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
  if desired_public and desired_terms is distinct from 'community-v1-2026-09-11' then return app_private.api_error('TERMS_REQUIRED',409); end if;
  if desired_public and current_profile.alias_change_required and desired_alias=current_profile.alias then return app_private.api_error('ALIAS_CHANGE_REQUIRED',409); end if;
  next_epoch := current_profile.consent_epoch;
  if desired_public is distinct from current_profile.public_enabled or desired_region is distinct from current_profile.region_id then
    if next_epoch=9223372036854775807 then return app_private.api_error('ACCOUNT_UNAVAILABLE',403); end if;
    next_epoch := next_epoch+1;
  end if;
  begin
    update app_private.profiles set alias=desired_alias,region_id=desired_region,public_enabled=desired_public,consent_epoch=next_epoch,
      alias_change_required=case when desired_alias<>current_profile.alias then false else current_profile.alias_change_required end,
      participation_terms_version=desired_terms,
      participation_accepted_at=case when desired_terms is distinct from current_profile.participation_terms_version then statement_timestamp() else participation_accepted_at end
      where user_id=actor;
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

revoke all on function public.update_profile(jsonb) from public,anon;
grant execute on function public.update_profile(jsonb) to authenticated;
