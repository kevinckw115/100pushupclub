-- Disposable local development only. No sample users, reps or activity.
insert into app_private.regions(id,parent_id,kind,name,source_version)
values ('world',null,'world','World','internal-root-v1') on conflict do nothing;
insert into app_private.region_ancestors(region_id,ancestor_id)
values ('world','world') on conflict do nothing;
