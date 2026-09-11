import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { openTestDatabase } from '../../src/testing/node-sqlite.ts';
import { migrate } from '../../src/data/local/migrations.ts';
import { LocalRepository } from '../../src/data/local/repository.ts';
import { SyncRepository } from '../../src/data/sync/repository.ts';
import { SyncFailure } from '../../src/data/sync/protocol.ts';
import type { OwnCheckin } from '../../src/data/sync/protocol.ts';

const now = '2026-09-10T12:00:00.000Z';
function fixture() {
  const db = openTestDatabase(':memory:'); migrate(db);
  const local = new LocalRepository(db, randomUUID), guest = local.startGuest(now);
  const row = local.create(guest.id, { id: randomUUID(), mutationId: randomUUID(), quantity: 20, occurredAt: now, timezone: 'UTC' });
  const account = randomUUID(); local.activateAccount(account, now);
  const sync = new SyncRepository(local, account), imports = sync.imports;
  return { db, local, guest, row, account, sync, imports, select: [{ partition: guest.id, id: row.id }] };
}
function record(id: string, amount = 20): OwnCheckin {
  return { id, quantity: amount, occurred_at: now, recorded_timezone: 'UTC', local_date: '2026-09-10', source: 'import', created_at: now, updated_at: now, deleted_at: null, version: 1, revision: '1', public_epoch: null, public_region_id: null };
}
const result = (r: OwnCheckin) => ({ request_id: randomUUID(), record: r, revision: r.revision, effective_public: false });

test('explicit import atomically snapshots guest records and repeated consent creates one job', () => {
  const f = fixture();
  try {
    assert.equal(f.local.unsynced(f.account), 0);
    f.db.exec("CREATE TRIGGER fail_import BEFORE INSERT ON outbox BEGIN SELECT RAISE(ABORT,'disk failure'); END;");
    assert.throws(() => f.imports.start(f.select), /disk failure/);
    assert.equal(f.imports.jobs().length, 0); assert.equal(f.local.get(f.account, f.row.id), null);
    f.db.exec('DROP TRIGGER fail_import;');
    f.imports.start(f.select); f.imports.start(f.select); f.imports.resume();
    assert.equal(f.imports.jobs().length, 1); assert.equal(f.local.unsynced(f.account), 1);
    const sending = f.sync.beginNext(now)!;
    assert.equal(JSON.parse(sending.request_json!).source, 'import');
    assert.equal(JSON.parse(sending.request_json!).requested_public_epoch, null);
    assert.equal(f.local.total(f.guest.id, '2026-09-10'), '20');
    assert.throws(() => f.local.edit(f.account, f.row.id, 30), /Finish this guest import/);
    assert.throws(() => f.imports.cleanup(), /Finish or cancel/);
    f.sync.acknowledge(sending, result(record(f.row.id)));
    assert.equal(f.imports.counts().acknowledged, 1);
    assert.equal(f.imports.cleanup(), 1); assert.equal(f.imports.cleanup(), 0);
    assert.equal(f.local.total(f.guest.id, '2026-09-10'), '0');
    assert.equal(f.local.total(f.account, '2026-09-10'), '20');
  } finally { f.db.close(); }
});

test('signout pauses uncertain imports and explicit resume keeps the exact mutation', () => {
  const f = fixture();
  try {
    f.imports.start(f.select); const request = f.sync.beginNext(now)!;
    f.local.signOutAccount(f.account, now, true);
    const second = randomUUID(); f.local.activateAccount(second, now);
    const other = new SyncRepository(f.local, second); other.imports.resume();
    assert.equal(f.local.unsynced(second), 0); assert.equal(other.imports.jobs().length, 0);
    f.local.activateAccount(f.account, now); f.imports.resume();
    assert.equal(f.local.unsynced(f.account), 0); assert.equal(f.imports.counts().paused, 1);
    f.imports.resumePaused();
    assert.equal(f.sync.beginNext(now)!.request_json, request.request_json);
    // An already accepted identical imported record is safely acknowledged.
    f.sync.fail(f.sync.beginNext(now)!, new SyncFailure('ENTITY_EXISTS', { status: 409, record: record(f.row.id) }));
    assert.equal(f.imports.counts().acknowledged, 1); assert.equal(f.local.unsynced(f.account), 0);
  } finally { f.db.close(); }
});

test('another owner UUID collision remaps durably without changing historical content', () => {
  const f = fixture();
  try {
    f.imports.start(f.select); const sending = f.sync.beginNext(now)!;
    f.sync.fail(sending, new SyncFailure('NOT_FOUND_OR_FORBIDDEN', { status: 404 }));
    const job = f.imports.jobs()[0], next = f.sync.beginNext(now)!;
    assert.notEqual(job.destination_id, f.row.id); assert.notEqual(job.mutation_id, sending.mutation_id);
    assert.equal(next.entity_id, job.destination_id);
    assert.equal(JSON.parse(next.request_json!).occurred_at, now);
    assert.equal(f.local.get(f.account, f.row.id), null);
    assert.equal(f.local.get(f.guest.id, f.row.id)?.quantity, 20);
    assert.equal(f.local.unsynced(f.account), 1);
  } finally { f.db.close(); }
});

test('same-owner mismatch preserves both values until an explicit separate import', () => {
  const f = fixture();
  try {
    f.imports.start(f.select);
    const remote = record(f.row.id, 35);
    f.sync.fail(f.sync.beginNext(now)!, new SyncFailure('ENTITY_EXISTS', { status: 409, record: remote }));
    assert.equal(f.imports.counts().conflict, 1); assert.equal(f.sync.issues().length, 1);
    f.imports.resolve(f.row.id, 'separate');
    const job = f.imports.jobs()[0];
    assert.notEqual(job.destination_id, remote.id);
    assert.equal(f.local.get(f.account, remote.id)?.quantity, 35);
    assert.equal(f.local.get(f.account, job.destination_id)?.quantity, 20);
    f.sync.acknowledge(f.sync.beginNext(now)!, result(record(job.destination_id)));
    assert.equal(f.local.total(f.account, '2026-09-10'), '55');
  } finally { f.db.close(); }
});

test('existing native account record is never overwritten by a guest ID collision', () => {
  const f = fixture();
  try {
    f.local.create(f.account, { id: f.row.id, mutationId: randomUUID(), quantity: 45, occurredAt: now, timezone: 'UTC' });
    f.imports.start(f.select);
    assert.equal(f.imports.counts().conflict, 1);
    f.imports.resolve(f.row.id, 'keep');
    assert.equal(f.local.get(f.account, f.row.id)?.quantity, 45);
    assert.equal(f.local.unsynced(f.account), 1);
    assert.equal(f.local.get(f.guest.id, f.row.id)?.quantity, 20);
  } finally { f.db.close(); }
});

test('acknowledgment and ledger roll back together; cleanup preserves changed guest values', () => {
  const f = fixture();
  try {
    f.imports.start(f.select); const sending = f.sync.beginNext(now)!;
    f.db.exec("CREATE TRIGGER fail_ack BEFORE UPDATE OF state ON guest_imports WHEN NEW.state='acknowledged' BEGIN SELECT RAISE(ABORT,'disk failure'); END;");
    assert.throws(() => f.sync.acknowledge(sending, result(record(f.row.id))), /disk failure/);
    assert.equal(f.local.get(f.account, f.row.id)?.server_version, 0);
    assert.equal(f.local.unsynced(f.account), 1);
    f.db.exec('DROP TRIGGER fail_ack;'); f.sync.acknowledge(sending, result(record(f.row.id)));
    f.local.edit(f.guest.id, f.row.id, 40);
    assert.equal(f.imports.cleanup(), 0);
    assert.equal(f.local.get(f.guest.id, f.row.id)?.quantity, 40);
    assert.throws(() => f.db.exec("UPDATE guest_imports SET snapshot_json='{}';"), /Import source cannot change/);
  } finally { f.db.close(); }
});

test('cleanup never removes a guest copy whose account copy was later deleted', () => {
  const f = fixture();
  try {
    f.imports.start(f.select); f.sync.acknowledge(f.sync.beginNext(now)!, result(record(f.row.id)));
    const deleted = { ...record(f.row.id), version: 2, revision: '2', deleted_at: now };
    f.sync.applyPage('0', { request_id: randomUUID(), changes: [record(f.row.id), deleted], next_revision: '2', has_more: false });
    assert.equal(f.imports.cleanup(), 0);
    assert.equal(f.local.total(f.guest.id, '2026-09-10'), '20');
    f.local.signOutAccount(f.account, now, false);
    assert.equal(f.db.all<{ remote_json: null }>('SELECT remote_json FROM guest_imports')[0].remote_json, null);
    assert.equal(f.db.all('SELECT * FROM guest_imports').length, 1);
  } finally { f.db.close(); }
});
