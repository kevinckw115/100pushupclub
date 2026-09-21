alter table app_private.circle_memberships add column member_id text not null default ('m_'||encode(extensions.gen_random_bytes(16),'hex')) unique;
alter table app_private.circle_memberships add constraint membership_interval_order check(left_at is null or left_at>=joined_at);
create index checkins_circle_window on app_private.checkins(user_id,occurred_at,created_at) where source='native' and deleted_at is null and not moderation_excluded;
create index circle_invites_current on app_private.circle_invites(circle_id,expires_at) where revoked_at is null;
create function app_private.protect_circle_identity() returns trigger language plpgsql set search_path='' as $$
begin
  if tg_op='UPDATE' and (old.id,old.timezone,old.created_at) is distinct from (new.id,new.timezone,new.created_at) then raise exception 'Circle identity and timezone are immutable'; end if;
  if not exists(select 1 from pg_catalog.pg_timezone_names where name=new.timezone) then raise exception 'Invalid circle timezone'; end if;
  return new;
end;
$$;
create trigger immutable_circle_identity before insert or update on app_private.circles for each row execute function app_private.protect_circle_identity();

create function app_private.circle_summary(circle_key uuid, viewer uuid) returns jsonb language sql stable set search_path='' as $$
  select jsonb_build_object('id',c.id,'name',c.name,'timezone',c.timezone,'is_owner',c.owner_id=viewer,'member_id',m.member_id,
    'name_change_required',c.name_change_required,'member_count',(select count(*) from app_private.circle_memberships p where p.circle_id=c.id and p.left_at is null))
  from app_private.circles c join app_private.circle_memberships m on m.circle_id=c.id and m.user_id=viewer and m.left_at is null
  where c.id=circle_key and c.deleted_at is null;
$$;

create function app_private.circle_today(circle_key uuid, viewer uuid, anchor timestamptz) returns jsonb
language sql stable set search_path='' as $$
  with group_info as materialized (
    select c.*,v.joined_at viewer_since,(anchor at time zone c.timezone)::date local_day,
      ((anchor at time zone c.timezone)::date::timestamp at time zone c.timezone) day_start,
      (((anchor at time zone c.timezone)::date+1)::timestamp at time zone c.timezone) day_end
    from app_private.circles c join app_private.circle_memberships v on v.circle_id=c.id and v.user_id=viewer and v.left_at is null
      join app_private.profiles own on own.user_id=viewer and own.account_status='active'
    where c.id=circle_key and c.deleted_at is null and not exists(select 1 from app_private.deletion_jobs d where d.user_id=viewer)
  ), members as materialized (
    select m.user_id,m.member_id,m.joined_at,p.alias,
      (p.account_status='active' and not p.alias_change_required and not exists(select 1 from app_private.deletion_jobs d where d.user_id=m.user_id)
        and not exists(select 1 from app_private.blocks b where (b.blocker_id=viewer and b.blocked_id=m.user_id) or (b.blocker_id=m.user_id and b.blocked_id=viewer))) visible
    from group_info g join app_private.circle_memberships m on m.circle_id=g.id and m.left_at is null join app_private.profiles p on p.user_id=m.user_id
    order by m.member_id limit 21
  ), totals as materialized (
    select m.user_id,coalesce(sum(c.quantity),0)::bigint reps
    from members m cross join group_info g left join app_private.checkins c on c.user_id=m.user_id and c.source='native' and c.deleted_at is null and not c.moderation_excluded
      and c.occurred_at>=greatest(g.day_start,m.joined_at,g.viewer_since) and c.occurred_at<g.day_end and c.occurred_at<=anchor
      and c.created_at>=greatest(m.joined_at,g.viewer_since)
    where m.visible group by m.user_id
  )
  select jsonb_build_object('id',g.id,'name',g.name,'timezone',g.timezone,'local_date',to_char(g.local_day,'YYYY-MM-DD'),
    'is_owner',g.owner_id=viewer,'name_change_required',g.name_change_required,
    'total_reps',(select coalesce(sum(reps),0)::text from totals),'checked_in_count',(select count(*) from totals where reps>0),
    'active_member_count',(select count(*) from members),'hidden_activity',exists(select 1 from members where not visible),
    'members',coalesce((select jsonb_agg(jsonb_build_object('member_id',m.member_id,'username',m.alias,'total_reps',t.reps::text,'checked_in',t.reps>0,'is_self',m.user_id=viewer) order by lower(m.alias) collate "C",m.member_id)
      from members m join totals t on t.user_id=m.user_id where m.visible),'[]'::jsonb))
  from group_info g;
$$;

create function public.list_circles() returns jsonb language plpgsql security definer set search_path='' set lock_timeout='5s' set statement_timeout='5s' as $$
declare actor uuid; items jsonb;
begin
  actor := app_private.require_user(); perform 1 from app_private.profiles where user_id=actor for share;
  if not found then return app_private.api_error('ACCOUNT_UNAVAILABLE',403); end if;
  perform app_private.require_user();
  if not app_private.take_budget(actor,'list_circles',30) then return app_private.api_error('RATE_LIMITED',429,true); end if;
  select coalesce(jsonb_agg(summary order by lower(summary->>'name') collate "C",summary->>'id'),'[]'::jsonb) into items from (
    select app_private.circle_summary(c.id,actor) summary from app_private.circle_memberships m join app_private.circles c on c.id=m.circle_id
    where m.user_id=actor and m.left_at is null and c.deleted_at is null order by lower(c.name) collate "C",c.id limit 6
  ) selected;
  if jsonb_array_length(items)>5 then return app_private.api_error('SERVER_RETRY',503,true); end if;
  return jsonb_build_object('request_id',gen_random_uuid(),'items',items);
exception when insufficient_privilege then return app_private.api_error('ACCOUNT_UNAVAILABLE',403);
  when others then return app_private.api_error('SERVER_RETRY',503,true);
end;
$$;

create function public.read_circle_today(circle_id uuid) returns jsonb language plpgsql security definer set search_path='' set lock_timeout='5s' set statement_timeout='5s' as $$
declare actor uuid; result jsonb;
begin
  actor := app_private.require_user(); perform 1 from app_private.profiles where user_id=actor for share;
  if not found then return app_private.api_error('ACCOUNT_UNAVAILABLE',403); end if;
  perform app_private.require_user();
  if not app_private.take_budget(actor,'read_circle_today',30) then return app_private.api_error('RATE_LIMITED',429,true); end if;
  perform 1 from app_private.circles c where c.id=circle_id and c.deleted_at is null for share;
  if not found then return app_private.api_error('NOT_FOUND_OR_FORBIDDEN',404); end if;
  result := app_private.circle_today(circle_id,actor,statement_timestamp());
  if result is null then return app_private.api_error('NOT_FOUND_OR_FORBIDDEN',404); end if;
  if (result->>'active_member_count')::integer>20 then return app_private.api_error('SERVER_RETRY',503,true); end if;
  return jsonb_build_object('request_id',gen_random_uuid(),'circle',result);
exception when insufficient_privilege then return app_private.api_error('ACCOUNT_UNAVAILABLE',403);
  when others then return app_private.api_error('SERVER_RETRY',503,true);
end;
$$;

create function public.list_circle_invites(circle_id uuid) returns jsonb language plpgsql security definer set search_path='' set lock_timeout='5s' set statement_timeout='5s' as $$
declare actor uuid; items jsonb;
begin
  actor := app_private.require_user(); perform 1 from app_private.profiles where user_id=actor for share;
  if not found then return app_private.api_error('ACCOUNT_UNAVAILABLE',403); end if;
  perform app_private.require_user();
  if not app_private.take_budget(actor,'list_circle_invites',30) then return app_private.api_error('RATE_LIMITED',429,true); end if;
  perform 1 from app_private.circles c where c.id=circle_id and c.owner_id=actor and c.deleted_at is null for share;
  if not found or not exists(select 1 from app_private.circle_memberships m where m.circle_id=list_circle_invites.circle_id and m.user_id=actor and m.left_at is null) then return app_private.api_error('NOT_FOUND_OR_FORBIDDEN',404); end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',i.id,'expires_at',app_private.utc_text(i.expires_at)) order by i.expires_at,i.id),'[]'::jsonb) into items from (
    select v.id,v.expires_at from app_private.circle_invites v where v.circle_id=list_circle_invites.circle_id and v.revoked_at is null and v.expires_at>statement_timestamp() order by v.expires_at,v.id limit 6
  ) i;
  if jsonb_array_length(items)>5 then return app_private.api_error('SERVER_RETRY',503,true); end if;
  return jsonb_build_object('request_id',gen_random_uuid(),'items',items);
exception when insufficient_privilege then return app_private.api_error('ACCOUNT_UNAVAILABLE',403);
  when others then return app_private.api_error('SERVER_RETRY',503,true);
end;
$$;

revoke all on function app_private.protect_circle_identity(),app_private.circle_summary(uuid,uuid),app_private.circle_today(uuid,uuid,timestamptz) from public,anon,authenticated;
revoke all on function public.list_circles(),public.read_circle_today(uuid),public.list_circle_invites(uuid) from public,anon,authenticated;
grant execute on function public.list_circles(),public.read_circle_today(uuid),public.list_circle_invites(uuid) to authenticated;
