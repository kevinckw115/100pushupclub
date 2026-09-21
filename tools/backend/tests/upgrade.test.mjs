import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { account, localEnvironment, removeAccount } from './environment.mjs';

test('populated baseline PostgreSQL upgrades preserve private records and receipts while invalidating old sharing', { timeout: 120000 }, async () => {
  const config = localEnvironment(), db = new pg.Client({ connectionString: config.db }), user = await account(config);
  await db.connect(); let transaction = false;
  try {
    // DDL and fixtures are isolated in one transaction and always rolled back; current disposable APIs are restored intact.
    await db.query('begin'); transaction = true;
    await db.query('drop schema app_private cascade; drop schema public cascade; create schema public; grant usage on schema public to anon,authenticated,service_role;');
    const directory = new URL('../../../supabase/migrations/', import.meta.url), files = (await readdir(directory)).filter(n => n.endsWith('.sql')).sort();
    await db.query(await readFile(new URL(files[0], directory), 'utf8'));
    const record = randomUUID(), receipt = randomUUID(), circle = randomUUID();
    await db.query("insert into app_private.profiles(user_id,alias,public_enabled) values($1,'upgrade_alias',true);", [user.id]);
    await db.query('insert into app_private.account_sync_state(user_id,revision) values($1,1)', [user.id]);
    await db.query("insert into app_private.checkins(id,user_id,quantity,occurred_at,recorded_timezone,local_date,source,version,revision) values($1,$2,35,'2026-09-10T12:00:00Z','UTC','2026-09-10','native',1,1)", [record, user.id]);
    await db.query("insert into app_private.mutation_receipts(user_id,mutation_id,canonical_payload_hash,result) values($1,$2,'preserve-original','{\"original\":true}'::jsonb)", [user.id, receipt]);
    await db.query("insert into app_private.circles(id,owner_id,name,timezone) values($1,$2,'Upgrade circle','UTC')", [circle, user.id]);
    await db.query('insert into app_private.circle_memberships(circle_id,user_id) values($1,$2)', [circle, user.id]);
    for (const file of files.slice(1)) await db.query(await readFile(new URL(file, directory), 'utf8'));
    const saved = (await db.query('select quantity,local_date::text,version,revision::text from app_private.checkins where id=$1 and user_id=$2', [record, user.id])).rows[0];
    assert.deepEqual(saved, { quantity: 35, local_date: '2026-09-10', version: 1, revision: '1' });
    assert.deepEqual((await db.query('select result from app_private.mutation_receipts where user_id=$1 and mutation_id=$2', [user.id, receipt])).rows[0].result, { original: true });
    const profile = (await db.query('select public_enabled,participation_terms_version from app_private.profiles where user_id=$1', [user.id])).rows[0]; assert.equal(profile.public_enabled, false); assert.equal(profile.participation_terms_version, null);
    assert.match((await db.query('select member_id from app_private.circle_memberships where circle_id=$1', [circle])).rows[0].member_id, /^m_[a-f0-9]{32}$/);
    assert.equal((await db.query("select has_table_privilege('authenticated','app_private.checkins','SELECT') allowed")).rows[0].allowed, false);
    assert.equal((await db.query('select revision::text from app_private.account_sync_state where user_id=$1', [user.id])).rows[0].revision, '1');
    await db.query('rollback'); transaction = false;
  } finally { if (transaction) await db.query('rollback'); await db.end(); await removeAccount(config, user); }
});
