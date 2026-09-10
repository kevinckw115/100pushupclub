import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { account, localEnvironment, removeAccount, request } from './environment.mjs';

test('real JWT bootstrap, owner isolation, grants/RLS, suspension and alias race', async () => {
  const config = localEnvironment();
  const db = new pg.Client({ connectionString: config.db });
  await db.connect();
  const users = [];
  try {
    const a = await account(config); users.push(a);
    const b = await account(config); users.push(b);
    const operation = randomUUID();
    const first = await request(config, '/rest/v1/rpc/bootstrap_profile', { token: a.token, body: { operation_id: operation } });
    assert.equal(first.status, 200, 'authenticated bootstrap succeeds');
    assert.equal(first.data.profile.public_enabled, false);
    assert.equal(first.data.profile.consent_epoch, '0');
    assert.equal(first.data.revision, '0');
    assert.match(first.data.profile.alias, /^member_[a-f0-9]{12}$/);
    const replay = await request(config, '/rest/v1/rpc/bootstrap_profile', { token: a.token, body: { operation_id: operation } });
    assert.deepEqual(replay.data, first.data);
    const other = await request(config, '/rest/v1/rpc/bootstrap_profile', { token: b.token, body: { operation_id: randomUUID() } });
    assert.equal(other.status, 200); assert.notEqual(other.data.profile.alias, first.data.profile.alias);
    assert.deepEqual(Object.keys(first.data.profile).sort(), ['alias','consent_epoch','public_enabled','region_id','status']);
    const own = await request(config, '/rest/v1/rpc/get_profile', { token: a.token, body: {} });
    assert.equal(own.data.profile.alias, first.data.profile.alias);
    const guest = await request(config, '/rest/v1/rpc/get_profile', { body: {} });
    assert.ok(guest.status >= 400);
    const forged = await request(config, '/rest/v1/rpc/bootstrap_profile', { token: a.token, body: { operation_id: randomUUID(), user_id: b.id } });
    assert.ok(forged.status >= 400, 'submitted ownership is not accepted');
    const invalid = await request(config, '/rest/v1/rpc/bootstrap_profile', { token: a.token, body: { operation_id: null } });
    assert.ok(invalid.status >= 400);
    for (const user of [a,b]) {
      const raw = await request(config, '/rest/v1/checkins?select=*', { token: user.token, method: 'GET', headers: { 'Accept-Profile': 'app_private' } });
      assert.ok(raw.status >= 400, 'private schema is not exposed');
    }
    const atomic = await db.query('select (select count(*) from app_private.profiles where user_id=$1)::int profiles, (select count(*) from app_private.account_sync_state where user_id=$1)::int sync, (select count(*) from app_private.operation_receipts where user_id=$1)::int receipts', [a.id]);
    assert.deepEqual(atomic.rows[0], { profiles: 1, sync: 1, receipts: 1 });
    const checkin = randomUUID();
    await db.query("insert into app_private.checkins(id,user_id,quantity,occurred_at,recorded_timezone,local_date,source,version,revision) values($1,$2,20,'2026-09-10T12:00:00Z','UTC','2026-09-10','native',1,1)", [checkin,a.id]);
    for (const value of [0,1000]) await assert.rejects(db.query('update app_private.checkins set quantity=$1 where id=$2', [value,checkin]), error => error.code === '23514');
    await assert.rejects(db.query("update app_private.checkins set recorded_timezone='not/a/zone' where id=$1", [checkin]), error => error.code === '22023');
    await assert.rejects(db.query('update app_private.checkins set user_id=$1 where id=$2', [b.id,checkin]), error => error.code === '22023');
    await db.query('update app_private.checkins set deleted_at=now() where id=$1', [checkin]);
    await assert.rejects(db.query('update app_private.checkins set deleted_at=null where id=$1', [checkin]), error => error.code === '22023');
    for (const role of ['anon','authenticated']) {
      await db.query('begin');
      await db.query('set local role ' + role); // Fixed test role names, not user input.
      await assert.rejects(db.query('select * from app_private.checkins'), error => error.code === '42501');
      await db.query('rollback');
    }
    const checks = await db.query("select c.relname, c.relrowsecurity, has_table_privilege('authenticated',c.oid,'SELECT,INSERT,UPDATE,DELETE') as grants from pg_class c join pg_namespace n on c.relnamespace=n.oid where n.nspname='app_private' and c.relkind='r'");
    assert.ok(checks.rows.length >= 15);
    for (const row of checks.rows) { assert.equal(row.relrowsecurity, true); assert.equal(row.grants, false); }
    const functions = await db.query("select p.proname,p.prosecdef,p.proconfig from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('bootstrap_profile','get_profile')");
    assert.equal(functions.rows.length, 2);
    for (const fn of functions.rows) { assert.equal(fn.prosecdef, true); assert.ok(fn.proconfig.some(value => /^search_path=(""|)$/.test(value))); }
    await db.query("update app_private.profiles set account_status='suspended' where user_id=$1", [a.id]);
    assert.equal((await request(config, '/rest/v1/rpc/get_profile', { token: a.token, body: {} })).status, 403);
    assert.equal((await request(config, '/rest/v1/rpc/bootstrap_profile', { token: a.token, body: { operation_id: operation } })).status, 403);
    await db.query("update app_private.profiles set account_status='active' where user_id=$1", [a.id]);
    await db.query("insert into app_private.deletion_jobs(user_id,status) values($1,'pending')", [a.id]);
    assert.equal((await request(config, '/rest/v1/rpc/bootstrap_profile', { token: a.token, body: { operation_id: operation } })).status, 403);
    await db.query('delete from app_private.deletion_jobs where user_id=$1', [a.id]);

    const rollbackUser = await account(config); users.push(rollbackUser);
    await db.query("create function app_private.test_fail_receipt() returns trigger language plpgsql set search_path='' as $$ begin raise exception 'TEST_RECEIPT_FAILURE'; end $$; create trigger test_fail_receipt before insert on app_private.operation_receipts for each row execute function app_private.test_fail_receipt();");
    try {
      const failed = await request(config, '/rest/v1/rpc/bootstrap_profile', { token: rollbackUser.token, body: { operation_id: randomUUID() } });
      assert.ok(failed.status >= 400);
      const absent = await db.query('select (select count(*) from app_private.profiles where user_id=$1)::int profiles, (select count(*) from app_private.account_sync_state where user_id=$1)::int sync', [rollbackUser.id]);
      assert.deepEqual(absent.rows[0], { profiles: 0, sync: 0 });
    } finally { await db.query('drop trigger test_fail_receipt on app_private.operation_receipts; drop function app_private.test_fail_receipt();'); }

    const left = new pg.Client({ connectionString: config.db }), right = new pg.Client({ connectionString: config.db });
    await Promise.all([left.connect(), right.connect()]);
    try {
      await Promise.all([left.query('begin'), right.query('begin')]);
      await left.query("update app_private.profiles set alias='same_alias' where user_id=$1", [a.id]);
      const pending = right.query("update app_private.profiles set alias='SAME_ALIAS' where user_id=$1", [b.id]).then(() => null, error => error.code);
      let waiting = false;
      for (let i = 0; i < 40 && !waiting; i++) {
        waiting = (await db.query('select wait_event_type from pg_stat_activity where pid=$1', [right.processID])).rows[0]?.wait_event_type === 'Lock';
        if (!waiting) await new Promise(resolve => setTimeout(resolve, 25));
      }
      assert.equal(waiting, true, 'second connection actually waits on concurrent uniqueness lock');
      await left.query('commit');
      assert.equal(await pending, '23505');
      await right.query('rollback');
    } finally { await Promise.all([left.end(),right.end()]); }
  } finally {
    await db.end();
    for (const user of users) await removeAccount(config, user);
  }
});
