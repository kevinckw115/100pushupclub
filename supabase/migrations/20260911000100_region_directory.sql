create extension if not exists unaccent with schema extensions;
create extension if not exists pg_trgm with schema extensions;
alter table app_private.regions add column source_code text;
alter table app_private.regions add column active boolean not null default true;
create unique index regions_source_code on app_private.regions(source_code) where source_code is not null;
create function app_private.region_search(value text) returns text
language sql immutable strict set search_path='' as $$
  select lower(extensions.unaccent('extensions.unaccent'::regdictionary, btrim(value)));
$$;
alter table app_private.regions add column search_name text generated always as (app_private.region_search(name)) stored;
create index regions_search on app_private.regions using gin(search_name extensions.gin_trgm_ops);
create index regions_page on app_private.regions(parent_id,search_name,id) where active;
create table app_private.directory_versions (
  version text primary key, manifest jsonb not null, current boolean not null default false
);
create unique index directory_current on app_private.directory_versions(current) where current;
alter table app_private.directory_versions enable row level security;
revoke all on app_private.directory_versions from public,anon,authenticated;

create function app_private.region_json(item app_private.regions) returns jsonb
language sql stable set search_path='' as $$
  select jsonb_build_object('id',item.id,'parent_id',item.parent_id,'kind',item.kind,'name',item.name,
    'label',concat_ws(' · ',item.name,case when parent.kind<>'world' then parent.name end,
      case when country.id is distinct from item.id and country.id is distinct from parent.id then country.name end),
    'has_children',exists(select 1 from app_private.regions child where child.parent_id=item.id and child.active))
  from (select 1) dummy left join app_private.regions parent on parent.id=item.parent_id
  left join app_private.regions country on country.source_code=item.country_code and country.kind='country';
$$;

create function public.list_regions(parent_id text default 'world', search text default null, cursor text default null, "limit" integer default 50)
returns jsonb language plpgsql stable security definer set search_path='' set statement_timeout='3s' as $$
declare parent_key alias for $1; page_limit alias for $4;
  term text; version_key text; position jsonb; last_item app_private.regions; results jsonb; next_key text;
begin
  if page_limit is null or page_limit<1 or page_limit>50 or length(coalesce(search,''))>80 or length(coalesce(parent_key,''))>80 or length(coalesce(cursor,''))>1024 then return app_private.api_error('INVALID_REQUEST',400); end if;
  term := app_private.region_search(coalesce(search,''));
  if term<>'' and length(term)<2 then return app_private.api_error('INVALID_REQUEST',400); end if;
  if parent_key is not null and not exists(select 1 from app_private.regions r where r.id=parent_key and r.active) then return app_private.api_error('INVALID_REQUEST',400); end if;
  select v.version into version_key from app_private.directory_versions v where v.current;
  if version_key is null then return app_private.api_error('SERVER_RETRY',503,true); end if;
  if cursor is not null then
    begin position := convert_from(decode(cursor,'base64'),'UTF8')::jsonb;
    exception when others then return app_private.api_error('INVALID_CURSOR',400); end;
    if jsonb_typeof(position)<>'object' or position->>'version' is distinct from version_key or position->>'parent' is distinct from parent_key or position->>'search' is distinct from term then return app_private.api_error('INVALID_CURSOR',400); end if;
    select * into last_item from app_private.regions r where r.id=position->>'last' and r.active;
    if not found or (parent_key is not null and last_item.parent_id is distinct from parent_key) or (term<>'' and strpos(last_item.search_name,term)=0) then return app_private.api_error('INVALID_CURSOR',400); end if;
  end if;
  with candidates as materialized (
    select r.* from app_private.regions r where r.active and r.kind<>'world'
      and (parent_key is null or r.parent_id=parent_key)
      and (term='' or r.search_name like '%'||replace(replace(replace(term,'\','\\'),'%','\%'),'_','\_')||'%' escape '\')
      and (cursor is null or (r.search_name,r.id)>(last_item.search_name,last_item.id))
      and not exists(select 1 from app_private.region_ancestors a join app_private.regions ancestor on ancestor.id=a.ancestor_id where a.region_id=r.id and not ancestor.active)
      order by r.search_name,r.id limit page_limit+1
  ), page as (select * from candidates order by search_name,id limit page_limit)
  select coalesce(jsonb_agg(app_private.region_json(p::app_private.regions) order by p.search_name,p.id),'[]'::jsonb),
    case when (select count(*) from candidates)>page_limit then (select id from page order by search_name desc,id desc limit 1) end
    into results,next_key from page p;
  return jsonb_build_object('request_id',gen_random_uuid(),'version',version_key,'items',results,
    'next_cursor',case when next_key is not null then replace(encode(convert_to(jsonb_build_object('parent',parent_key,'search',term,'last',next_key,'version',version_key)::text,'UTF8'),'base64'),E'\n','') end);
end;
$$;

create function public.resolve_region(region_id text) returns jsonb
language plpgsql stable security definer set search_path='' set statement_timeout='3s' as $$
declare selected app_private.regions; requested alias for $1; parents jsonb; version_key text;
begin
  if requested is null or length(requested)>80 then return app_private.api_error('INVALID_REQUEST',400); end if;
  select r.* into selected from app_private.regions r join app_private.region_ancestors a on a.ancestor_id=r.id
    where a.region_id=requested and r.active
      and not exists(select 1 from app_private.region_ancestors chain join app_private.regions parent on parent.id=chain.ancestor_id where chain.region_id=r.id and not parent.active)
    order by case r.kind when 'locality' then 3 when 'admin1' then 2 when 'country' then 1 else 0 end desc limit 1;
  if not found then select * into selected from app_private.regions where id='world'; end if;
  select coalesce(jsonb_agg(app_private.region_json(r) order by case r.kind when 'world' then 0 when 'country' then 1 when 'admin1' then 2 else 3 end),'[]'::jsonb)
    into parents from app_private.region_ancestors a join app_private.regions r on r.id=a.ancestor_id where a.region_id=selected.id and r.active;
  select version into version_key from app_private.directory_versions where current;
  return jsonb_build_object('request_id',gen_random_uuid(),'version',version_key,'region',app_private.region_json(selected),'ancestors',parents,
    'fallback_reason',case when selected.id is distinct from requested then 'MISSING_REGION' end);
end;
$$;
revoke all on function app_private.region_search(text), app_private.region_json(app_private.regions) from public,anon,authenticated;
revoke all on function public.list_regions(text,text,text,integer), public.resolve_region(text) from public,anon,authenticated;
grant execute on function public.list_regions(text,text,text,integer), public.resolve_region(text) to anon,authenticated;
