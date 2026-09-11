alter table app_private.deletion_jobs add column id uuid not null default gen_random_uuid() unique;
alter table app_private.deletion_jobs add column operation_id uuid;
alter table app_private.deletion_jobs add column status_hash text unique;
alter table app_private.deletion_jobs add column phase text not null default 'data' check(phase in ('data','auth','complete'));
alter table app_private.deletion_jobs add column attempts integer not null default 0;
create index deletion_jobs_pending on app_private.deletion_jobs(requested_at) where status<>'complete';
create index checkins_export on app_private.checkins(user_id,id);
create index reports_reporter on app_private.reports(reporter_id,id);
create index reports_subject on app_private.reports(subject_id,id);

create function app_private.deletion_status(job app_private.deletion_jobs) returns jsonb language sql stable set search_path='' as $$
  select jsonb_build_object('request_id',gen_random_uuid(),'job_id',job.id,'status',case when job.status='complete' then 'complete' else 'processing' end,'completion_target_days',7);
$$;
create function public.request_account_deletion(envelope jsonb) returns jsonb language plpgsql security definer set search_path='' set lock_timeout='5s' set statement_timeout='10s' as $$
declare actor uuid := auth.uid(); operation_key uuid; proof_hash text; job app_private.deletion_jobs; recent boolean;
begin
  if actor is null or auth.role() is distinct from 'authenticated' then return app_private.api_error('UNAUTHENTICATED',401); end if;
  if envelope is null or jsonb_typeof(envelope)<>'object' or octet_length(envelope::text)>2048 or (envelope-'operation_id'-'status_token'-'confirm_delete')<>'{}'::jsonb
    or envelope->'confirm_delete' is distinct from 'true'::jsonb or coalesce(envelope->>'operation_id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or coalesce(envelope->>'status_token','') !~ '^d_[0-9a-f]{64}$' then return app_private.api_error('INVALID_REQUEST',400); end if;
  operation_key := (envelope->>'operation_id')::uuid; proof_hash := encode(sha256(convert_to(envelope->>'status_token','UTF8')),'hex');
  perform app_private.lock_circle_users(actor);
  select * into job from app_private.deletion_jobs where user_id=actor;
  if found then
    if job.operation_id is distinct from operation_key or job.status_hash is distinct from proof_hash then return app_private.api_error('DELETION_ALREADY_REQUESTED',409); end if;
    return app_private.deletion_status(job);
  end if;
  if not exists(select 1 from auth.users where id=actor and not coalesce(is_anonymous,false) and email_confirmed_at is not null)
    or not exists(select 1 from app_private.profiles where user_id=actor) then return app_private.api_error('ACCOUNT_UNAVAILABLE',403); end if;
  if not app_private.take_budget(actor,'request_account_deletion',10) then return app_private.api_error('RATE_LIMITED',429,true); end if;
  -- Signed AMR authentication time survives token refresh. A new iat alone is insufficient.
  select exists(select 1 from jsonb_array_elements(coalesce(auth.jwt()->'amr','[]'::jsonb)) a
    where a->>'method' in ('otp','password','totp','sso/saml','sso/oidc','oauth') and coalesce(a->>'timestamp','') ~ '^[0-9]{1,12}$'
      and (a->>'timestamp')::bigint between floor(extract(epoch from statement_timestamp()-interval '10 minutes'))::bigint and ceil(extract(epoch from statement_timestamp()+interval '30 seconds'))::bigint) into recent;
  if not recent or not exists(select 1 from auth.sessions s where s.user_id=actor and s.id::text=auth.jwt()->>'session_id') then return app_private.api_error('REAUTH_REQUIRED',403); end if;
  update app_private.profiles set account_status='deleting',public_enabled=false,consent_epoch=consent_epoch+1 where user_id=actor;
  insert into app_private.deletion_jobs(user_id,status,operation_id,status_hash) values(actor,'pending',operation_key,proof_hash) returning * into job;
  -- Auth owns these tables. Disposable-version tests verify refresh-token/session revocation before any cleanup call.
  delete from auth.refresh_tokens where user_id=actor::text;
  delete from auth.sessions where user_id=actor;
  return app_private.deletion_status(job);
exception when unique_violation then return app_private.api_error('IDEMPOTENCY_KEY_REUSED',409);
  when others then return app_private.api_error('SERVER_RETRY',503,true);
end;
$$;

create function public.account_deletion_status(status_token text) returns jsonb language plpgsql security definer set search_path='' set statement_timeout='5s' as $$
declare job app_private.deletion_jobs; used_count integer; bucket timestamptz := date_trunc('minute',statement_timestamp());
begin
  insert into app_private.global_budgets(operation,window_start,used) values('deletion_status',bucket,1)
    on conflict(operation) do update set window_start=excluded.window_start,used=case when app_private.global_budgets.window_start=excluded.window_start then least(301,app_private.global_budgets.used+1) else 1 end returning used into used_count;
  if used_count>300 then perform set_config('response.headers','[{"Retry-After":"60"}]',true); return app_private.api_error('RATE_LIMITED',429,true); end if;
  if status_token is null or status_token !~ '^d_[0-9a-f]{64}$' then return app_private.api_error('NOT_FOUND_OR_FORBIDDEN',404); end if;
  select * into job from app_private.deletion_jobs where status_hash=encode(sha256(convert_to(status_token,'UTF8')),'hex');
  if not found then return app_private.api_error('NOT_FOUND_OR_FORBIDDEN',404); end if;
  perform set_config('response.headers','[{"Cache-Control":"no-store"}]',true);
  return app_private.deletion_status(job);
end;
$$;

create function public.export_account(after_id uuid default null, expected_revision text default null, "limit" integer default 500) returns jsonb
language plpgsql security definer set search_path='' set lock_timeout='5s' set statement_timeout='10s' as $$
declare actor uuid; revision bigint; items jsonb; has_more boolean; next_id uuid;
begin
  actor := app_private.require_user(); perform 1 from app_private.profiles where user_id=actor for share; perform app_private.require_user();
  if "limit" is null or "limit"<1 or "limit">500 or (expected_revision is not null and (expected_revision !~ '^(0|[1-9][0-9]{0,18})$' or length(expected_revision)>19)) or (after_id is not null and expected_revision is null) then return app_private.api_error('INVALID_REQUEST',400); end if;
  if not app_private.take_budget(actor,'export_account',30) then return app_private.api_error('RATE_LIMITED',429,true); end if;
  select s.revision into revision from app_private.account_sync_state s where user_id=actor;
  if revision is null then return app_private.api_error('ACCOUNT_UNAVAILABLE',403); end if;
  if expected_revision is not null and expected_revision<>revision::text then return app_private.api_error('EXPORT_CHANGED',409); end if;
  select coalesce(jsonb_agg(record order by id),'[]'::jsonb) into items from (
    select c.id,app_private.checkin_json(c) record from app_private.checkins c where c.user_id=actor and (after_id is null or c.id>after_id) order by c.id limit export_account."limit"
  ) page;
  if jsonb_array_length(items)>0 then next_id := (items->(jsonb_array_length(items)-1)->>'id')::uuid; end if;
  select exists(select 1 from app_private.checkins c where c.user_id=actor and c.id>next_id) into has_more;
  perform set_config('response.headers','[{"Cache-Control":"no-store"}]',true);
  return jsonb_build_object('request_id',gen_random_uuid(),'revision',revision::text,'profile',app_private.profile_json(actor),'records',items,'next_id',case when has_more then next_id else null end);
exception when insufficient_privilege then return app_private.api_error('ACCOUNT_UNAVAILABLE',403);
  when others then return app_private.api_error('SERVER_RETRY',503,true);
end;
$$;

-- Called only by the privileged server worker through a database connection, never a mobile RPC.
-- Each transaction transfers/deletes one owned live circle or removes at most100 historical circles.
create function app_private.advance_deletion(actor uuid) returns text language plpgsql set search_path='' set lock_timeout='5s' set statement_timeout='15s' as $$
declare job app_private.deletion_jobs; group_id uuid; candidate uuid; rechecked uuid; removed integer;
begin
  select * into job from app_private.deletion_jobs where user_id=actor for update;
  if not found then return 'missing'; end if;
  if job.status='complete' then return 'complete'; end if;
  if job.phase='auth' then return 'auth'; end if;
  select c.id into group_id from app_private.circles c where c.owner_id=actor and c.deleted_at is null order by c.id limit 1;
  if group_id is not null then
    select m.user_id into candidate from app_private.circle_memberships m join app_private.profiles p on p.user_id=m.user_id
      where m.circle_id=group_id and m.user_id<>actor and m.left_at is null and p.account_status='active' and not p.alias_change_required and not exists(select 1 from app_private.deletion_jobs d where d.user_id=p.user_id)
      order by m.joined_at,m.user_id limit 1;
  end if;
  perform app_private.lock_circle_users(actor,candidate);
  if exists(select 1 from app_private.profiles where user_id=actor and account_status<>'deleting') then raise exception 'Account is not deleting'; end if;
  update app_private.deletion_jobs set status='running',last_attempt_at=clock_timestamp(),attempts=attempts+1,error_code=null where user_id=actor;
  if group_id is not null then
    perform 1 from app_private.circles where id=group_id and owner_id=actor and deleted_at is null for update;
    if not found then return 'data'; end if;
    select m.user_id into rechecked from app_private.circle_memberships m join app_private.profiles p on p.user_id=m.user_id
      where m.circle_id=group_id and m.user_id<>actor and m.left_at is null and p.account_status='active' and not p.alias_change_required and not exists(select 1 from app_private.deletion_jobs d where d.user_id=p.user_id)
      order by m.joined_at,m.user_id limit 1;
    if candidate is distinct from rechecked then return 'data'; end if;
    if candidate is null then delete from app_private.circles where id=group_id;
    else update app_private.circles set owner_id=candidate where id=group_id;
      update app_private.circle_memberships set left_at=clock_timestamp() where circle_id=group_id and user_id=actor and left_at is null;
      update app_private.circle_invites set revoked_at=coalesce(revoked_at,clock_timestamp()) where circle_id=group_id;
    end if;
    return 'data';
  end if;
  delete from app_private.circles where id in (select id from app_private.circles where owner_id=actor and deleted_at is not null order by id limit 100);
  get diagnostics removed = row_count; if removed>0 then return 'data'; end if;
  delete from app_private.reports where id in (select r.id from app_private.reports r where r.reporter_id=actor or r.subject_id in (select public_actor_id from app_private.profiles where user_id=actor) or r.subject_id in (select public_entry_id from app_private.checkins where user_id=actor) order by r.id limit 500);
  get diagnostics removed = row_count; if removed>0 then return 'data'; end if;
  delete from app_private.checkins where id in (select id from app_private.checkins where user_id=actor order by id limit 500);
  get diagnostics removed = row_count; if removed>0 then return 'data'; end if;
  delete from app_private.checkin_changes where user_id=actor and revision in (select revision from app_private.checkin_changes where user_id=actor order by revision limit 500);
  get diagnostics removed = row_count; if removed>0 then return 'data'; end if;
  delete from app_private.mutation_receipts where user_id=actor and mutation_id in (select mutation_id from app_private.mutation_receipts where user_id=actor order by mutation_id limit 500);
  get diagnostics removed = row_count; if removed>0 then return 'data'; end if;
  delete from app_private.operation_receipts where user_id=actor and operation_id in (select operation_id from app_private.operation_receipts where user_id=actor order by operation_id limit 500);
  get diagnostics removed = row_count; if removed>0 then return 'data'; end if;
  delete from app_private.profiles where user_id=actor;
  update app_private.deletion_jobs set phase='auth' where user_id=actor;
  return 'auth';
end;
$$;
revoke all on function app_private.deletion_status(app_private.deletion_jobs),app_private.advance_deletion(uuid) from public,anon,authenticated;
revoke all on function public.request_account_deletion(jsonb),public.account_deletion_status(text),public.export_account(uuid,text,integer) from public,anon,authenticated;
grant execute on function public.request_account_deletion(jsonb),public.export_account(uuid,text,integer) to authenticated;
grant execute on function public.account_deletion_status(text) to anon,authenticated;
