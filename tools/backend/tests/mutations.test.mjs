import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { account, localEnvironment, removeAccount, request } from './environment.mjs';

const create = (overrides = {}) => {
  const time = new Date(Date.now() - 60000).toISOString();
  return { kind: 'create', mutation_id: randomUUID(), checkin_id: randomUUID(), quantity: 20, occurred_at: time, recorded_timezone: 'UTC', local_date: time.slice(0, 10), source: 'native', requested_public_epoch: null, ...overrides };
};

async function fixture(run) {
  const config = localEnvironment(), users = [], db = new pg.Client({ connectionString: config.db });
  await db.connect();
  const fresh = async () => {
    const user = await account(config); users.push(user);
    const boot = await request(config, '/rest/v1/rpc/bootstrap_profile', { token: user.token, body: { operation_id: randomUUID() } });
    assert.equal(boot.status, 200); return user;
  };
  const mutate = (user, envelope) => request(config, '/rest/v1/rpc/mutate_checkin', { token: user?.token, body: { envelope } });
  const pull = (user, after_revision = '0', limit = 100) => request(config, '/rest/v1/rpc/pull_changes', { token: user?.token, body: { after_revision, limit } });
  try { await run({ config, db, fresh, mutate, pull }); }
  finally { await db.end(); for (const user of users) await removeAccount(config, user); }
}

test('real RPC idempotency, canonical payloads, owner isolation, conflicts, tombstones and paginated pull', async () => fixture(async ({ db, fresh, mutate, pull }) => {
  const a = await fresh(), b = await fresh(), input = create();
  input.occurred_at = input.occurred_at.replace(/\.\d{3}Z$/, '.000Z');
  const first = await mutate(a, input);
  assert.equal(first.status, 200, JSON.stringify(first.data));
  assert.equal(first.data.revision, '1'); assert.equal(first.data.record.version, 1);
  assert.equal(first.data.effective_public, false); assert.equal(first.data.record.public_epoch, null);
  assert.ok(first.data.request_id); assert.equal('user_id' in first.data.record, false);
  const replay = await mutate(a, Object.fromEntries(Object.entries(input).reverse()));
  assert.deepEqual(replay.data, first.data);
  const normalized = await mutate(a, { ...input, occurred_at: input.occurred_at.replace('.000Z', 'Z'), mutation_id: input.mutation_id.toUpperCase(), checkin_id: input.checkin_id.toUpperCase() });
  assert.deepEqual(normalized.data, first.data);
  assert.equal((await mutate(a, { ...input, quantity: 21 })).data.code, 'IDEMPOTENCY_KEY_REUSED');
  const exists = await mutate(a, { ...input, mutation_id: randomUUID() });
  assert.equal(exists.data.code, 'ENTITY_EXISTS'); assert.deepEqual(exists.data.current_record, first.data.record);
  const hidden = await mutate(b, { ...input, mutation_id: randomUUID() });
  assert.equal(hidden.status, 404); assert.equal(hidden.data.code, 'NOT_FOUND_OR_FORBIDDEN'); assert.equal('current_record' in hidden.data, false);
  assert.ok((await mutate(null, input)).status >= 400);
  for (const kind of ['update', 'delete']) {
    const denied = await mutate(b, { kind, mutation_id: randomUUID(), checkin_id: input.checkin_id, expected_version: 1, ...(kind === 'update' ? { quantity: 99 } : {}) });
    assert.equal(denied.status, 404); assert.equal(denied.data.code, 'NOT_FOUND_OR_FORBIDDEN'); assert.equal('current_record' in denied.data, false);
  }
  assert.deepEqual((await pull(b)).data.changes, []);
  const update = { kind: 'update', mutation_id: randomUUID(), checkin_id: input.checkin_id, quantity: 35, expected_version: 1 };
  const edited = await mutate(a, update); assert.equal(edited.status, 200); assert.equal(edited.data.revision, '2');
  assert.equal(edited.data.record.quantity, 35); assert.equal(edited.data.record.local_date, input.local_date);
  const conflict = await mutate(a, { ...update, mutation_id: randomUUID(), quantity: 99 });
  assert.equal(conflict.status, 409); assert.equal(conflict.data.code, 'VERSION_CONFLICT'); assert.equal(conflict.data.current_record.quantity, 35);
  const deletion = { kind: 'delete', mutation_id: randomUUID(), checkin_id: input.checkin_id, expected_version: 2 };
  const deleted = await mutate(a, deletion); assert.equal(deleted.status, 200); assert.ok(deleted.data.record.deleted_at);
  assert.deepEqual((await mutate(a, deletion)).data, deleted.data);
  assert.equal((await mutate(a, { ...update, mutation_id: randomUUID(), expected_version: 3 })).data.code, 'VERSION_CONFLICT');
  const firstPage = await pull(a, '0', 2); assert.equal(firstPage.status, 200);
  assert.deepEqual(firstPage.data.changes.map(x => x.revision), ['1', '2']); assert.equal(firstPage.data.has_more, true); assert.equal(firstPage.data.next_revision, '2');
  const second = await pull(a, '2', 2); assert.equal(second.data.has_more, false); assert.equal(second.data.next_revision, '3'); assert.ok(second.data.changes[0].deleted_at);
  const empty = await pull(a, '3'); assert.deepEqual(empty.data.changes, []); assert.equal(empty.data.next_revision, '3');
  for (const cursor of ['-1', '01', '4', '9223372036854775808', '1 OR true', null]) assert.equal((await pull(a, cursor)).data.code, 'INVALID_CURSOR');
  assert.equal((await pull(a, '0', 501)).status, 400);
  const counts = await db.query('select (select count(*) from app_private.mutation_receipts where user_id=$1)::int receipts,(select count(*) from app_private.checkin_changes where user_id=$1)::int changes', [a.id]);
  assert.deepEqual(counts.rows[0], { receipts: 3, changes: 3 });
  await assert.rejects(db.query("update app_private.checkin_changes set snapshot='{}' where user_id=$1", [a.id]), /immutable/);
  await db.query("update app_private.profiles set account_status='suspended' where user_id=$1", [a.id]);
  assert.equal((await mutate(a, input)).status, 403); assert.equal((await pull(a)).status, 403);
}));

test('strict validation, private imports/old consent, large revisions and bounded request rate', async () => fixture(async ({ config, db, fresh, mutate, pull }) => {
  const user = await fresh();
  const cases = [
    [{ quantity: 0 }, 'INVALID_QUANTITY'], [{ quantity: 1000 }, 'INVALID_QUANTITY'], [{ quantity: 1.5 }, 'INVALID_QUANTITY'], [{ quantity: '20' }, 'INVALID_QUANTITY'],
    [{ recorded_timezone: 'not/a/zone' }, 'INVALID_TIMEZONE'], [{ local_date: '1900-01-01' }, 'INVALID_LOCAL_DATE'],
    [{ occurred_at: '2026-02-30T12:00:00Z' }, 'INVALID_TIMESTAMP'], [{ occurred_at: '2026-01-01T00:00:60Z' }, 'INVALID_TIMESTAMP'],
    [{ source: 'other' }, 'INVALID_REQUEST'], [{ requested_public_epoch: '01' }, 'INVALID_REQUEST'], [{ user_id: randomUUID() }, 'INVALID_REQUEST'],
  ];
  for (const [overrides, code] of cases) {
    const response = await mutate(user, create(overrides)); assert.equal(response.status, 400, JSON.stringify(response.data)); assert.equal(response.data.code, code);
  }
  assert.equal((await mutate(user, create({ extra: 'x'.repeat(33000) }))).status, 400);
  for (const envelope of [[], null, { ...create(), mutation_id: 'bad' }, { kind: 'delete', mutation_id: randomUUID(), checkin_id: randomUUID(), expected_version: 0 }]) assert.equal((await mutate(user, envelope)).status, 400);
  const ahead = new Date(Date.now() + 600000).toISOString();
  assert.equal((await mutate(user, create({ occurred_at: ahead, local_date: ahead.slice(0, 10) }))).data.code, 'CLOCK_AHEAD');
  assert.equal((await request(config, '/rest/v1/rpc/update_profile', { token: user.token, body: { envelope: { operation_id: randomUUID(), accepted_terms_version: 'community-v1-2026-09-11' } } })).status, 200);
  await db.query('update app_private.profiles set public_enabled=true,consent_epoch=2 where user_id=$1', [user.id]);
  const shared = await mutate(user, create({ requested_public_epoch: '2' }));
  assert.equal(shared.status, 200, JSON.stringify(shared.data)); assert.equal(shared.data.effective_public, true); assert.equal(shared.data.record.public_epoch, '2');
  for (const overrides of [{ requested_public_epoch: '1' }, { source: 'import', requested_public_epoch: '2' }]) {
    const response = await mutate(user, create(overrides)); assert.equal(response.status, 200); assert.equal(response.data.effective_public, false); assert.equal(response.data.record.public_epoch, null);
  }
  await db.query("update app_private.account_sync_state set revision='9007199254740992' where user_id=$1", [user.id]);
  const large = await mutate(user, create()); assert.equal(large.data.revision, '9007199254740993');
  assert.equal((await pull(user, '9007199254740992')).data.next_revision, '9007199254740993');
  await db.query("update app_private.request_budgets set window_start=date_trunc('minute',clock_timestamp()),used=120 where user_id=$1", [user.id]);
  const limited = await mutate(user, create()); assert.equal(limited.status, 429); assert.equal(limited.data.code, 'RATE_LIMITED'); assert.ok(Number(limited.retryAfter) >= 1);
}));

test('receipt insertion failure rolls back record, revision and change; retry accepts exactly once', async () => fixture(async ({ db, fresh, mutate, pull }) => {
  const user = await fresh(), input = create();
  await db.query("create function app_private.test_mutation_failure() returns trigger language plpgsql set search_path='' as $$ begin raise exception 'TEST_ATOMIC_FAILURE'; end $$; create trigger test_mutation_failure before insert on app_private.mutation_receipts for each row execute function app_private.test_mutation_failure();");
  try {
    const failed = await mutate(user, input); assert.equal(failed.status, 503); assert.equal(failed.data.code, 'SERVER_RETRY');
    assert.equal(JSON.stringify(failed.data).includes('TEST_ATOMIC_FAILURE'), false);
    const state = await db.query('select revision::text from app_private.account_sync_state where user_id=$1', [user.id]); assert.equal(state.rows[0].revision, '0');
    assert.equal((await db.query('select * from app_private.checkins where user_id=$1', [user.id])).rowCount, 0);
    assert.deepEqual((await pull(user)).data.changes, []);
  } finally { await db.query('drop trigger test_mutation_failure on app_private.mutation_receipts; drop function app_private.test_mutation_failure();'); }
  const accepted = await mutate(user, input); assert.equal(accepted.status, 200); assert.equal(accepted.data.revision, '1');
  assert.deepEqual((await mutate(user, input)).data, accepted.data);
}));

test('concurrent duplicate/edit RPCs serialize; uncommitted revision cannot be skipped by pull', async () => fixture(async ({ config, db, fresh, mutate, pull }) => {
  const user = await fresh(), input = create();
  const [left, right] = await Promise.all([mutate(user, input), mutate(user, input)]);
  assert.equal(left.status, 200); assert.deepEqual(left.data, right.data);
  const change = count => ({ kind: 'update', mutation_id: randomUUID(), checkin_id: input.checkin_id, quantity: count, expected_version: 1 });
  const race = await Promise.all([mutate(user, change(30)), mutate(user, change(40))]);
  assert.deepEqual(race.map(x => x.status).sort(), [200, 409]);
  const transaction = new pg.Client({ connectionString: config.db }); await transaction.connect();
  try {
    await transaction.query('begin'); await transaction.query('set local role authenticated');
    await transaction.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ sub: user.id, role: 'authenticated' })]);
    const held = await transaction.query('select public.mutate_checkin($1::jsonb) result', [JSON.stringify(create())]);
    assert.equal(held.rows[0].result.revision, '3');
    let settled = false;
    const pendingPull = pull(user, '2').then(result => { settled = true; return result; });
    let waiting = false;
    for (let n = 0; n < 50 && !waiting; n++) {
      waiting = (await db.query("select count(*)::int n from pg_stat_activity where wait_event_type='Lock' and query like '%pull_changes%' and pid<>pg_backend_pid()")).rows[0].n > 0;
      if (!waiting) await new Promise(resolve => setTimeout(resolve, 20));
    }
    assert.equal(waiting, true); assert.equal(settled, false);
    await transaction.query('commit');
    const page = await pendingPull; assert.equal(page.status, 200); assert.equal(page.data.next_revision, '3'); assert.equal(page.data.changes.length, 1);
  } finally { await transaction.query('rollback'); await transaction.end(); }
}));
