import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import pg from 'pg';
import { account, localEnvironment, removeAccount, request } from './environment.mjs';
import { runDeletionWorker } from '../scripts/deletion-worker.mjs';

test('own export, recent-auth deletion, immediate revocation and retryable cleanup preserve peers', { timeout: 120000 }, async () => {
  const config = localEnvironment(), db = new pg.Client({ connectionString: config.db }), users = [];
  await db.connect();
  const call = (user, name, body = {}) => request(config, '/rest/v1/rpc/' + name, { token: user?.token, body });
  const op = (user, name, fields) => call(user, name, { envelope: { operation_id: randomUUID(), ...fields } });
  const ok = result => { assert.equal(result.status, 200, JSON.stringify(result.data)); return result.data; };
  const create = (user, quantity) => { const now = new Date().toISOString(); return call(user, 'mutate_checkin', { envelope: { kind: 'create', mutation_id: randomUUID(), checkin_id: randomUUID(), quantity, occurred_at: now, recorded_timezone: 'UTC', local_date: now.slice(0, 10), source: 'native', requested_public_epoch: '1' } }); };
  try {
    for (let i = 0; i < 3; i++) { const u = await account(config); users.push(u); ok(await call(u, 'bootstrap_profile', { operation_id: randomUUID() })); ok(await op(u, 'update_profile', { public_enabled: true, expected_consent_epoch: '0', accepted_terms_version: 'community-v1-2026-09-11' })); }
    const [a, b, c] = users;
    ok(await create(a, 10)); ok(await create(a, 20)); ok(await create(b, 75));
    const first = ok(await call(a, 'export_account', { limit: 1 })); assert.equal(first.records.length, 1); assert.ok(first.next_id); assert.equal(first.revision, '2');
    const second = ok(await call(a, 'export_account', { after_id: first.next_id, expected_revision: first.revision, limit: 1 })); assert.equal(second.next_id, null);
    assert.deepEqual([first.records[0].quantity, second.records[0].quantity].sort((a, b) => a - b), [10, 20]);
    assert.equal(JSON.stringify([first, second]).includes(b.id), false); assert.equal(JSON.stringify([first, second]).includes('email'), false);
    ok(await create(a, 5)); assert.equal((await call(a, 'export_account', { after_id: first.next_id, expected_revision: first.revision, limit: 1 })).data.code, 'EXPORT_CHANGED');
    assert.equal((await call(a, 'export_account', { limit: 501 })).status, 400); assert.equal((await call(null, 'export_account')).status, 401);
    const circle = ok(await op(a, 'create_circle', { name: 'Deletion circle', timezone: 'UTC', accept_circle_sharing: true })).circle;
    const alone = ok(await op(a, 'create_circle', { name: 'Solo deletion circle', timezone: 'UTC', accept_circle_sharing: true })).circle;
    const invitation = ok(await op(a, 'create_invite', { circle_id: circle.id })).invite;
    ok(await op(b, 'join_circle', { code: invitation.code, accept_circle_sharing: true })); ok(await op(c, 'join_circle', { code: invitation.code, accept_circle_sharing: true }));
    // Exercise deterministic earliest-member tie break as well as normal owner cleanup.
    await db.query("update app_private.circle_memberships set joined_at=date_trunc('second',joined_at) where circle_id=$1 and user_id<>$2", [circle.id, a.id]);
    const expectedOwner = [b.id, c.id].sort()[0];
    const input = { operation_id: randomUUID(), status_token: 'd_' + randomBytes(32).toString('hex'), confirm_delete: true };
    assert.equal((await op(null, 'request_account_deletion', input)).status, 401);
    assert.equal((await op(a, 'request_account_deletion', { ...input, confirm_delete: false })).status, 400);
    // Trusted test connection changes only the signed-claim fixture; production requests still pass through real Auth/PostgREST.
    const claims = JSON.parse(Buffer.from(a.token.split('.')[1], 'base64url').toString()); claims.amr = [{ method: 'password', timestamp: Math.floor(Date.now() / 1000) - 3600 }];
    await db.query('begin');
    try {
      await db.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify(claims)]);
      const old = (await db.query('select public.request_account_deletion($1::jsonb) result', [JSON.stringify(input)])).rows[0].result;
      assert.equal(old.code, 'REAUTH_REQUIRED');
    } finally { await db.query('rollback'); }
    const sessionsBefore = Number((await db.query('select count(*) from auth.sessions where user_id=$1', [a.id])).rows[0].count); assert.ok(sessionsBefore > 0);
    const refreshToken = (await db.query('select token from auth.refresh_tokens where user_id=$1 and not revoked limit 1', [a.id])).rows[0]?.token; assert.ok(refreshToken);
    await db.query("create function app_private.test_deletion_failure() returns trigger language plpgsql as $$ begin raise exception 'job disk failure'; end $$; create trigger test_deletion_failure before insert on app_private.deletion_jobs for each row execute function app_private.test_deletion_failure();");
    try {
      assert.equal((await op(a, 'request_account_deletion', input)).status, 503);
      assert.equal(ok(await call(a, 'get_profile')).profile.public_enabled, true);
      assert.equal(Number((await db.query('select count(*) from auth.sessions where user_id=$1', [a.id])).rows[0].count), sessionsBefore);
    } finally { await db.query('drop trigger test_deletion_failure on app_private.deletion_jobs; drop function app_private.test_deletion_failure();'); }
    const raced = await Promise.all([op(a, 'request_account_deletion', input), create(a, 7)]); const deletion = ok(raced[0]); assert.ok([200, 403].includes(raced[1].status));
    assert.equal(deletion.status, 'processing'); assert.equal(deletion.completion_target_days, 7);
    assert.deepEqual(Object.keys(deletion).sort(), ['completion_target_days', 'job_id', 'request_id', 'status']);
    assert.equal(ok(await op(a, 'request_account_deletion', input)).job_id, deletion.job_id);
    assert.equal((await op(a, 'request_account_deletion', { ...input, operation_id: randomUUID() })).data.code, 'DELETION_ALREADY_REQUESTED');
    for (const name of ['get_profile', 'list_circles', 'export_account']) assert.equal((await call(a, name)).status, 403);
    assert.equal((await create(a, 1)).status, 403); assert.equal((await call(a, 'read_circle_today', { circle_id: circle.id })).status, 403);
    assert.equal((await call(null, 'read_club', { scope_id: 'world' })).data.pushups_past_24_hours, '75');
    assert.equal(Number((await db.query('select count(*) from auth.sessions where user_id=$1', [a.id])).rows[0].count), 0);
    const refreshed = await request(config, '/auth/v1/token?grant_type=refresh_token', { body: { refresh_token: refreshToken } }); assert.ok(refreshed.status >= 400);
    assert.equal(ok(await call(null, 'account_deletion_status', { status_token: input.status_token })).status, 'processing');
    assert.equal((await call(null, 'account_deletion_status', { status_token: 'd_' + '0'.repeat(64) })).status, 404);
    const rawJob = (await db.query('select * from app_private.deletion_jobs where user_id=$1', [a.id])).rows[0]; assert.equal(JSON.stringify(rawJob).includes(input.status_token), false);
    // Fail Auth deletion after data cleanup, verify hidden data remains gone and retry resumes the Auth phase.
    const failed = await runDeletionWorker({ dbUrl: config.db, apiUrl: config.api, adminKey: 'invalid-local-test-key', steps: 30 }); assert.equal(failed.failed, 1);
    assert.equal((await db.query('select 1 from app_private.profiles where user_id=$1', [a.id])).rowCount, 0);
    assert.equal((await db.query('select 1 from auth.users where id=$1', [a.id])).rowCount, 1);
    assert.equal((await db.query('select owner_id from app_private.circles where id=$1', [circle.id])).rows[0].owner_id, expectedOwner);
    assert.equal((await db.query('select 1 from app_private.circles where id=$1', [alone.id])).rowCount, 0);
    assert.equal((await call(b, 'preview_invite', { code: invitation.code })).data.code, 'INVITE_UNAVAILABLE');
    await db.query("update app_private.deletion_jobs set last_attempt_at=now()-interval '2 minutes' where user_id=$1", [a.id]);
    const finished = await runDeletionWorker({ dbUrl: config.db, apiUrl: config.api, adminKey: config.adminKey, steps: 10 }); assert.equal(finished.completed, 1);
    assert.equal(ok(await call(null, 'account_deletion_status', { status_token: input.status_token })).status, 'complete');
    assert.equal((await db.query('select 1 from auth.users where id=$1', [a.id])).rowCount, 0);
    assert.equal((await call(a, 'export_account')).status, 403);
    assert.equal(ok(await call(b, 'export_account')).records[0].quantity, 75);
    assert.deepEqual(await runDeletionWorker({ dbUrl: config.db, apiUrl: config.api, adminKey: config.adminKey }), { advanced: 0, completed: 0, failed: 0 });
  } finally {
    await db.query('delete from app_private.circles where owner_id=any($1::uuid[])', [users.map(u => u.id)]);
    for (const u of users) if ((await db.query('select 1 from auth.users where id=$1', [u.id])).rowCount) await removeAccount(config, u);
    await db.query('delete from app_private.deletion_jobs where user_id=any($1::uuid[])', [users.map(u => u.id)]); await db.end();
  }
});
