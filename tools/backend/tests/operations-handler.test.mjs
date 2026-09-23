import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import pg from 'pg';
import { operationsHandler } from '../scripts/operations-handler.mjs';
import { account, localEnvironment, request, removeAccount } from './environment.mjs';
test('operations HTTP authorization, overlap lock and real account cleanup', async () => {
  const config = localEnvironment(), secret = randomBytes(32).toString('hex');
  const handler = operationsHandler({ OPERATIONS_LOCAL_TEST: '1', DELETION_API_URL: config.api, DELETION_DATABASE_URL: config.db, DELETION_ADMIN_KEY: config.adminKey, OPERATIONS_CRON_SECRET: secret });
  const invoke = key => handler(new Request('https://example.invalid/operations', { method: 'POST', headers: key ? { 'x-operations-key': key } : {} }));
  assert.equal((await handler(new Request('https://example.invalid/operations'))).status, 405);
  assert.equal((await invoke()).status, 401); assert.equal((await invoke(config.key)).status, 401);
  assert.equal((await invoke('a'.repeat(64))).status, 401);
  const user = await account(config), db = new pg.Client({ connectionString: config.db });
  await db.connect();
  try {
    assert.equal((await request(config, '/rest/v1/rpc/bootstrap_profile', { token: user.token, body: { operation_id: randomUUID() } })).status, 200);
    const accepted = await request(config, '/rest/v1/rpc/request_account_deletion', { token: user.token, body: { envelope: { operation_id: randomUUID(), status_token: 'd_' + randomBytes(32).toString('hex'), confirm_delete: true } } });
    assert.equal(accepted.status, 200);
    await db.query('select pg_advisory_lock(100, 2201)');
    assert.equal((await invoke(secret)).status, 409);
    assert.equal((await db.query('select 1 from auth.users where id=$1', [user.id])).rowCount, 1);
    await db.query('select pg_advisory_unlock(100, 2201)');
    const response = await invoke(secret); assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { code: 'OPERATIONS_OK' });
    assert.equal((await db.query('select 1 from auth.users where id=$1', [user.id])).rowCount, 0);
  } finally {
    await db.query('select pg_advisory_unlock_all()');
    if ((await db.query('select 1 from auth.users where id=$1', [user.id])).rowCount) await removeAccount(config, user);
    await db.query('delete from app_private.deletion_jobs where user_id=$1', [user.id]); await db.end();
  }
});
