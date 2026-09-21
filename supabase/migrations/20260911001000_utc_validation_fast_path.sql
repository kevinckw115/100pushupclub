-- UTC is always a PostgreSQL timezone name. Avoid rebuilding pg_timezone_names
-- for this common canonical name; every other name retains catalog validation.
create or replace function app_private.protect_checkin() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.recorded_timezone is distinct from 'UTC' and not exists (select 1 from pg_catalog.pg_timezone_names where name=new.recorded_timezone) then
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
revoke all on function app_private.protect_checkin() from public,anon,authenticated;
