import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { openTestDatabase } from '../../src/testing/node-sqlite.ts';
import { migrate } from '../../src/data/local/migrations.ts';
import { LocalRepository } from '../../src/data/local/repository.ts';
import { SyncRepository } from '../../src/data/sync/repository.ts';
import { SyncEngine } from '../../src/data/sync/engine.ts';
import { SyncFailure, ownCheckin, pullPage } from '../../src/data/sync/protocol.ts';
import type { OwnCheckin, PullPage } from '../../src/data/sync/protocol.ts';

const now = '2026-09-10T15:00:00.000Z';
function fixture() {
  const db = openTestDatabase(':memory:'); migrate(db);
  const local = new LocalRepository(db, randomUUID), id = randomUUID();
  local.activateAccount(id, now);
  const sync = new SyncRepository(local, id);
  const create = () => local.create(id, { id: randomUUID(), mutationId: randomUUID(), quantity: 20, occurredAt: now, timezone: 'UTC' });
  return { db, local, id, sync, create };
}
function snapshot(id: string, version = 1, count = 20, deleted = false): OwnCheckin {
  return { id, quantity: count, occurred_at: now, recorded_timezone: 'UTC', local_date: '2026-09-10', source: 'native', created_at: now, updated_at: now, deleted_at: deleted ? now : null, version, revision: String(version), public_epoch: null, public_region_id: null };
}
const page = (...changes: OwnCheckin[]): PullPage => ({ request_id: randomUUID(), changes, next_revision: changes.at(-1)?.revision ?? '0', has_more: false });
const result = (record: OwnCheckin) => ({ request_id: randomUUID(), record, revision: record.revision, effective_public: false });
const clock = { now: () => Date.parse(now), random: () => 1, schedule: () => 0, cancel: () => {} };

test('dependent Undo freezes the acknowledged parent version even after a newer pull', () => {
  const f = fixture();
  try {
    const row = f.create(), sending = f.sync.beginNext(now)!;
    f.local.delete(f.id, row.id);
    f.sync.applyPage('0', page(snapshot(row.id, 2, 30)));
    f.sync.acknowledge(sending, result(snapshot(row.id)));
    const deletion = f.sync.beginNext(now)!;
    assert.equal(JSON.parse(deletion.request_json!).expected_version, 1);
    assert.equal(f.local.get(f.id, row.id)?.quantity, 30);
    assert.equal(f.local.get(f.id, row.id)?.deleted, 1);
    f.sync.fail(deletion, new SyncFailure('VERSION_CONFLICT', { status: 409, record: snapshot(row.id, 2, 30) }));
    f.sync.useAccount(row.id);
    assert.equal(f.local.total(f.id, '2026-09-10'), '30');
    assert.equal(f.local.unsynced(f.id), 0);
  } finally { f.db.close(); }
});

test('cursor failure rolls back the entire received page', () => {
  const f = fixture();
  try {
    const record = snapshot(randomUUID());
    f.db.exec("CREATE TRIGGER fail_cursor BEFORE UPDATE ON sync_cursors BEGIN SELECT RAISE(ABORT,'disk failure'); END;");
    assert.throws(() => f.sync.applyPage('0', page(record)), /disk failure/);
    assert.equal(f.sync.cursor(), '0'); assert.equal(f.local.get(f.id, record.id), null);
    f.db.exec('DROP TRIGGER fail_cursor;');
    f.sync.applyPage('0', page(record));
    assert.equal(f.sync.cursor(), '1'); assert.equal(f.local.total(f.id, '2026-09-10'), '20');
  } finally { f.db.close(); }
});

test('conflicting edit preserves local intent and explicit reapply uses a fresh mutation', () => {
  const f = fixture();
  try {
    const record = snapshot(randomUUID()); f.sync.applyPage('0', page(record));
    f.local.edit(f.id, record.id, 45);
    const sending = f.sync.beginNext(now)!;
    f.sync.fail(sending, new SyncFailure('VERSION_CONFLICT', { status: 409, record: snapshot(record.id, 2, 25) }));
    assert.equal(f.sync.details(record.id).local.quantity, 45);
    assert.equal(f.sync.details(record.id).remote?.quantity, 25);
    f.sync.applyMine(record.id, 45);
    const next = f.sync.beginNext(now)!;
    assert.notEqual(next.mutation_id, sending.mutation_id);
    assert.equal(JSON.parse(next.request_json!).expected_version, 2);
    f.sync.acknowledge(next, result(snapshot(record.id, 3, 45)));
    assert.equal(f.local.total(f.id, '2026-09-10'), '45');
  } finally { f.db.close(); }
});

test('server deletion requires a new private record and leaves its tombstone permanent', () => {
  const f = fixture();
  try {
    const record = snapshot(randomUUID()); f.sync.applyPage('0', page(record));
    f.local.edit(f.id, record.id, 35);
    f.sync.fail(f.sync.beginNext(now)!, new SyncFailure('VERSION_CONFLICT', { status: 409, record: snapshot(record.id, 2, 20, true) }));
    assert.throws(() => f.sync.applyMine(record.id, 35), /REPLACEMENT_REQUIRED/);
    const newId = f.sync.replacePrivately(record.id, 35, '2026-09-11T12:00:00Z', 'UTC');
    assert.notEqual(newId, record.id);
    assert.equal(f.local.get(f.id, record.id)?.deleted, 1);
    assert.throws(() => f.db.run('UPDATE local_checkins SET deleted=0 WHERE id=?', record.id));
    assert.equal(f.local.total(f.id, '2026-09-11'), '35');
    assert.equal(JSON.parse(f.sync.beginNext(now)!.request_json!).requested_public_epoch, null);
  } finally { f.db.close(); }
});

test('lost response retains exact sending envelope and a restarted worker replays it', async () => {
  const f = fixture(); let engine: SyncEngine | undefined;
  try {
    const record = f.create(), requests: string[] = [];
    let dropped = false;
    const transport = {
      pull: async () => page(),
      mutate: async (input: unknown) => { requests.push(JSON.stringify(input)); if (!dropped) { dropped = true; throw new SyncFailure('NETWORK', { retryable: true }); } return result(snapshot(record.id)); },
    };
    engine = new SyncEngine({ repo: f.sync, transport, valid: () => true, clock });
    await engine.sync(); engine.stop();
    assert.equal(f.local.unsynced(f.id), 1);
    f.sync.clearRetry();
    engine = new SyncEngine({ repo: new SyncRepository(f.local, f.id), transport, valid: () => true, clock });
    await engine.sync();
    assert.equal(requests.length, 2); assert.equal(requests[0], requests[1]);
    assert.equal(f.local.unsynced(f.id), 0);
  } finally { engine?.stop(); f.db.close(); }
});

test('late response after account discard cannot recreate rows or touch the new account', async () => {
  const f = fixture(); let release!: (value: ReturnType<typeof result>) => void;
  let started!: () => void; const ready = new Promise<void>(resolve => { started = resolve; });
  let valid = true;
  const row = f.create();
  const engine = new SyncEngine({ repo: f.sync, valid: () => valid, clock, transport: {
    pull: async () => page(), mutate: async () => { started(); return new Promise(resolve => { release = resolve; }); },
  } });
  try {
    const pending = engine.sync(); await ready;
    valid = false; engine.stop(); f.local.signOutAccount(f.id, now, true);
    const next = randomUUID(); f.local.activateAccount(next, now);
    release(result(snapshot(row.id))); await pending;
    assert.equal(f.local.activePartition()?.id, next);
    assert.equal(f.db.all('SELECT * FROM local_checkins').length, 0);
    assert.equal(new SyncRepository(f.local, next).cursor(), '0');
  } finally { engine.stop(); f.db.close(); }
});

test('rate retry survives clock rollback and does not send before its restored deadline', async () => {
  const f = fixture(); let calls = 0, time = Date.parse(now);
  const engine = new SyncEngine({ repo: f.sync, valid: () => true, clock: { ...clock, now: () => time }, transport: {
    pull: async () => page(), mutate: async () => { calls++; throw new SyncFailure('RATE_LIMITED', { status: 429, retryable: true, retryAfterMs: 30000 }); },
  } });
  try {
    f.create(); await engine.sync(); await engine.retry(); assert.equal(calls, 1);
    time -= 3600000; await engine.sync();
    assert.equal(Date.parse(f.sync.nextRetry()!) - time, 30000);
    time += 29999; await engine.sync(); assert.equal(calls, 1);
    time++; await engine.sync(); assert.equal(calls, 2);
  } finally { engine.stop(); f.db.close(); }
});

test('response parser preserves large revision strings and rejects malformed pages', () => {
  const record = snapshot(randomUUID()); record.revision = '9007199254740993';
  assert.equal(pullPage(page(record), '0').next_revision, record.revision);
  assert.throws(() => pullPage({ ...page(record), next_revision: '9007199254740992' }, '0'));
  assert.throws(() => ownCheckin({ ...record, revision: '0' }));
  assert.throws(() => ownCheckin({ ...record, source: 'import', public_epoch: '1' }));
  assert.equal(ownCheckin({ ...record, id: record.id.toUpperCase() }).id, record.id);
});

test('foreground pause leaves sending work durable and rapid resume coalesces requests', async () => {
  const f = fixture(); let calls = 0, inFlight = 0, maximum = 0;
  let started!: () => void; const ready = new Promise<void>(resolve => { started = resolve; });
  const row = f.create();
  const engine = new SyncEngine({ repo: f.sync, valid: () => true, clock, transport: {
    pull: async () => page(),
    mutate: async (_input, signal) => {
      calls++; inFlight++; maximum = Math.max(maximum, inFlight);
      try {
        if (calls === 1) { started(); await new Promise<void>((_resolve, reject) => signal.addEventListener('abort', () => reject(new SyncFailure('STALE_SCOPE')), { once: true })); }
        return result(snapshot(row.id));
      } finally { inFlight--; }
    },
  } });
  try {
    const pending = engine.sync(); await ready;
    for (let n = 0; n < 10; n++) void engine.sync();
    engine.setForeground(false); await pending;
    assert.equal(f.local.unsynced(f.id), 1); assert.equal(calls, 1);
    engine.setForeground(true); await engine.sync();
    assert.equal(calls, 2); assert.equal(maximum, 1); assert.equal(f.local.unsynced(f.id), 0);
  } finally { engine.stop(); f.db.close(); }
});

test('v2 acknowledged requests retain dependency versions during upgrade', () => {
  const db = openTestDatabase(':memory:');
  try {
    migrate(db, 2); const local = new LocalRepository(db, randomUUID), id = randomUUID();
    local.activateAccount(id, now);
    const row = local.create(id, { id: randomUUID(), mutationId: randomUUID(), quantity: 20, occurredAt: now, timezone: 'UTC' });
    db.exec("UPDATE outbox SET status='acknowledged';");
    db.run('UPDATE local_checkins SET server_version=1 WHERE id=?', row.id);
    local.edit(id, row.id, 30); db.exec("UPDATE outbox SET status='acknowledged';");
    migrate(db);
    assert.deepEqual(db.all<{ acknowledged_version: number }>('SELECT acknowledged_version FROM outbox ORDER BY sequence').map(r => r.acknowledged_version), [1, 2]);
  } finally { db.close(); }
});
