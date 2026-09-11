import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openTestDatabase } from '../../src/testing/node-sqlite.ts';
import { migrate } from '../../src/data/local/migrations.ts';
import { LocalRepository } from '../../src/data/local/repository.ts';
import { DeletionRepository } from '../../src/data/local/deletion.ts';
import { LocalExportSnapshot } from '../../src/data/local/export.ts';
import { exportPage, deletionStatus } from '../../src/data/account-privacy.ts';
import { SyncRepository } from '../../src/data/sync/repository.ts';
import { SyncEngine } from '../../src/data/sync/engine.ts';
const now = '2026-09-11T12:00:00.000Z', proof = () => 'd_' + randomBytes(32).toString('hex');
function fixture(path = ':memory:') { const db = openTestDatabase(path); migrate(db); const local = new LocalRepository(db, randomUUID); return { db, local, deletion: new DeletionRepository(local) }; }

test('deletion proof and atomic cleanup marker survive restart while guest data remains separate', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pushup-deletion-')); let f = fixture(join(dir, 'local.db'));
  try {
    const guest = f.local.startGuest(now); f.local.create(guest.id, { id: randomUUID(), mutationId: randomUUID(), quantity: 35, occurredAt: now, timezone: 'UTC' });
    const account = randomUUID(); f.local.activateAccount(account, now); f.local.create(account, { id: randomUUID(), mutationId: randomUUID(), quantity: 10, occurredAt: now, timezone: 'UTC' });
    f.deletion.begin(account, proof()); const saved = f.deletion.pending()!; f.db.close(); f = fixture(join(dir, 'local.db'));
    assert.deepEqual(f.deletion.pending(), saved); assert.throws(() => f.deletion.dismiss(), /Confirm/);
    assert.throws(() => f.local.create(account, { id: randomUUID(), mutationId: randomUUID(), quantity: 5, occurredAt: now, timezone: 'UTC' }), /deletion/);
    const status = { request_id: randomUUID(), job_id: randomUUID(), status: 'processing' as const, completion_target_days: 7 as const };
    f.db.exec("CREATE TRIGGER fail_cleanup BEFORE INSERT ON preferences WHEN NEW.key='pending_logout' BEGIN SELECT RAISE(ABORT,'disk full'); END;");
    assert.throws(() => f.deletion.acknowledge(saved.request.operation_id, status), /disk full/); assert.equal(f.deletion.pending()!.phase, 'pending');
    f.db.exec('DROP TRIGGER fail_cleanup;'); f.deletion.acknowledge(saved.request.operation_id, status);
    assert.equal(JSON.parse(f.local.preference('device', 'pending_logout')!).id, account); assert.equal(JSON.parse(f.local.preference('device', 'reminders')!).enabled, false);
    f.local.signOutAccount(account, now, true); assert.equal(f.local.activePartition()!.id, guest.id); assert.equal(f.local.total(guest.id, now.slice(0, 10)), '35');
    assert.equal(f.local.db.all('SELECT * FROM local_checkins WHERE partition_id=?', account).length, 0);
    assert.throws(() => f.deletion.acknowledge(randomUUID(), status), /changed/);
    f.local.setPreference('device', 'pending_logout', '');
    f.local.setPreference('device', 'reminders', 'guest-preference');
    f.deletion.acknowledge(saved.request.operation_id, { ...status, status: 'complete' });
    assert.equal(f.local.preference('device', 'pending_logout'), '');
    assert.equal(f.local.preference('device', 'reminders'), 'guest-preference');
    f.deletion.dismiss(); assert.equal(f.deletion.pending(), null);
  } finally { f.db.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('pending deletion stops ordinary sync before another account request is sent', async () => {
  const f = fixture();
  try {
    const account = randomUUID(); f.local.activateAccount(account, now); f.deletion.begin(account, proof()); let calls = 0;
    const engine = new SyncEngine({ repo: new SyncRepository(f.local, account), valid: () => true, transport: { pull: async () => { calls++; throw Error('Must not send'); }, mutate: async () => { calls++; throw Error('Must not send'); } } });
    await engine.sync(); engine.stop(); assert.equal(calls, 0); f.deletion.reject('REAUTH_REQUIRED'); f.deletion.dismiss(); assert.equal(f.local.deletionPending(account), false);
  } finally { f.db.close(); }
});

test('local export is a stable bounded SQLite snapshot and excludes other partitions and private control data', () => {
  const f = fixture(); let snapshot: LocalExportSnapshot | undefined;
  try {
    const guest = f.local.startGuest(now), row = f.local.create(guest.id, { id: randomUUID(), mutationId: randomUUID(), quantity: 35, occurredAt: now, timezone: 'UTC' });
    const other = randomUUID(); f.local.activateAccount(other, now); f.local.create(other, { id: randomUUID(), mutationId: randomUUID(), quantity: 999, occurredAt: now, timezone: 'UTC' }); f.local.signOutAccount(other, now, true);
    f.local.setPreference('device', 'secret-test', 'must-never-export'); snapshot = new LocalExportSnapshot(f.local, guest.id);
    f.local.edit(guest.id, row.id, 50); const page = snapshot.page(); assert.equal(page[0].quantity, 35); assert.equal(page.length, 1);
    assert.deepEqual(Object.keys(page[0]).sort(), ['deleted', 'id', 'local_date', 'occurred_at', 'quantity', 'recorded_timezone', 'source', 'state']); assert.equal(JSON.stringify(page).includes('must-never-export'), false);
    assert.equal(snapshot.page(page[0].id).length, 0); snapshot.close(); snapshot = undefined;
    f.local.activateAccount(other, now); assert.throws(() => new LocalExportSnapshot(f.local, guest.id), /changed/);
  } finally { snapshot?.close(); f.db.close(); }
});

test('export and deletion parsers reject identity/cursor drift and strip unneeded server fields', () => {
  const status = deletionStatus({ request_id: randomUUID(), job_id: randomUUID(), status: 'processing', completion_target_days: 7, user_id: randomUUID(), email: 'private@example.invalid' }); assert.equal('email' in status, false);
  assert.throws(() => deletionStatus({ ...status, status: 'failed' }));
  const profile = { alias: 'my_alias', region_id: null, public_enabled: false, consent_epoch: '0', status: 'active', participation_terms_version: null, alias_change_required: false };
  const value = { request_id: randomUUID(), revision: '0', profile, records: [], next_id: null, peers: ['secret'] };
  assert.equal('peers' in exportPage(value, null, null), false); assert.throws(() => exportPage(value, null, '1')); assert.throws(() => exportPage({ ...value, next_id: randomUUID() }, null, null));
});
