import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openTestDatabase } from '../../src/testing/node-sqlite.ts';
import { migrate } from '../../src/data/local/migrations.ts';
import { LocalRepository } from '../../src/data/local/repository.ts';
import { SyncRepository } from '../../src/data/sync/repository.ts';
import { SyncEngine } from '../../src/data/sync/engine.ts';
import { SyncFailure } from '../../src/data/sync/protocol.ts';
import { blockPage, safetyReceipt } from '../../src/data/safety.ts';
import type { SafetyRequest, SafetyReceipt } from '../../src/data/safety.ts';
import type { SyncTransport } from '../../src/data/sync/transport.ts';
const now = '2026-09-11T12:00:00.000Z', actor = 'a_' + '1'.repeat(32);
const receipt = (input: SafetyRequest): SafetyReceipt => input.operation === 'report_subject' ? { request_id: randomUUID(), operation_id: input.envelope.operation_id, report_id: randomUUID(), received: true } : { request_id: randomUUID(), operation_id: input.envelope.operation_id, actor_id: input.envelope.actor_id, blocked: input.operation === 'block_user' };
function fixture(path = ':memory:', account = randomUUID()) {
  const db = openTestDatabase(path); migrate(db); const local = new LocalRepository(db, randomUUID); local.activateAccount(account, now);
  const sync = new SyncRepository(local, account); return { db, local, account, sync, safety: sync.safety };
}
const clock = { now: () => Date.parse(now), random: () => 1, schedule: () => 0, cancel: () => {} };
const transport: SyncTransport = { pull: async after => ({ request_id: randomUUID(), changes: [], next_revision: after, has_more: false }), mutate: async () => { throw new Error('Unexpected check-in'); }, safety: async input => receipt(input) };

test('uncertain block survives file reopen, protects signout, and retries the exact request', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'pushup-safety-')); let f = fixture(join(dir, 'local.db'));
  try {
    f.safety.queue('block_user', { actor_id: actor }); const pending = f.safety.pending()!.request;
    assert.throws(() => f.local.signOutAccount(f.account, now, false), /decision/);
    assert.throws(() => f.safety.queue('unblock_user', { actor_id: actor }), /pending/);
    const sent: unknown[] = [];
    let engine = new SyncEngine({ repo: f.sync, clock, valid: () => true, transport: { ...transport, safety: async input => { sent.push(input); throw new SyncFailure('NETWORK', { retryable: true }); } } });
    await engine.sync(); engine.stop(); assert.equal(f.safety.pending()!.state, 'sending'); assert.throws(() => f.safety.discardRejected(), /may have reached/);
    const account = f.account; f.db.close(); f = fixture(join(dir, 'local.db'), account);
    assert.deepEqual(f.safety.pending()!.request, pending);
    engine = new SyncEngine({ repo: f.sync, clock, valid: () => true, transport: { ...transport, safety: async input => { sent.push(input); return receipt(input); } } });
    await engine.retry(); engine.stop(); assert.deepEqual(sent, [pending, pending]); assert.equal(f.safety.pending(), null);
    assert.equal(JSON.parse(f.local.preference(account, 'safety_receipt')!).receipt.actor_id, actor);
  } finally { f.db.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('receipt insertion failure rolls back acknowledgement and malformed receipts cannot clear intent', () => {
  const f = fixture();
  try {
    f.safety.queue('block_user', { actor_id: actor }); const pending = f.safety.pending()!.request;
    assert.throws(() => f.safety.accept(pending.envelope.operation_id, { ...receipt(pending), operation_id: randomUUID() }));
    f.db.exec("CREATE TRIGGER fail_receipt BEFORE INSERT ON preferences WHEN NEW.key='safety_receipt' BEGIN SELECT RAISE(ABORT,'disk full'); END;");
    assert.throws(() => f.safety.accept(pending.envelope.operation_id, receipt(pending)), /disk full/);
    assert.deepEqual(f.safety.pending()!.request, pending); assert.equal(f.local.preference(f.account, 'safety_receipt'), null);
    f.db.exec('DROP TRIGGER fail_receipt;'); f.safety.reject(pending.envelope.operation_id, 'NOT_FOUND_OR_FORBIDDEN'); f.safety.discardRejected(); assert.equal(f.safety.pending(), null);
  } finally { f.db.close(); }
});

test('hour-long report rate delay does not hold up personal check-in synchronization', async () => {
  const f = fixture();
  try {
    f.safety.queue('report_subject', { subject_type: 'alias', subject_id: actor, reason: 'abuse' });
    const local = f.local.create(f.account, { id: randomUUID(), mutationId: randomUUID(), quantity: 20, occurredAt: now, timezone: 'UTC' });
    let reports = 0, mutations = 0, blocks = 0;
    const engine = new SyncEngine({ repo: f.sync, clock, valid: () => true, transport: { ...transport,
      safety: async input => { if (input.operation !== 'report_subject') { blocks++; return receipt(input); } reports++; throw new SyncFailure('RATE_LIMITED', { status: 429, retryable: true, retryAfterMs: 3600000 }); },
      mutate: async () => { mutations++; return { request_id: randomUUID(), revision: '1', effective_public: false, record: { id: local.id, quantity: 20, occurred_at: now, recorded_timezone: 'UTC', local_date: now.slice(0, 10), source: 'native', created_at: now, updated_at: now, deleted_at: null, version: 1, revision: '1', public_epoch: null, public_region_id: null } }; },
    } });
    await engine.sync(); await engine.retry();
    f.safety.queue('block_user', { actor_id: actor }); await engine.sync(); engine.stop();
    assert.equal(blocks, 1); assert.equal(f.safety.pending()!.request.operation, 'report_subject');
    assert.equal(reports, 1); assert.equal(mutations, 1); assert.equal(f.local.unsynced(f.account), 0);
    assert.equal(f.safety.retryDelay(clock.now()), 3600000); assert.equal(f.safety.retryDelay(clock.now() - 7200000), 3600000);
  } finally { f.db.close(); }
});

test('an in-flight report acknowledgement preserves a newly queued priority block', async () => {
  const f = fixture();
  try {
    f.safety.queue('report_subject', { subject_type: 'alias', subject_id: actor, reason: 'abuse' });
    const report = f.safety.pending()!.request; let finish!: (value: SafetyReceipt) => void;
    const gate = new Promise<SafetyReceipt>(resolve => { finish = resolve; });
    const engine = new SyncEngine({ repo: f.sync, clock, valid: () => true, transport: { ...transport, safety: input => input.operation === 'report_subject' ? gate : Promise.resolve(receipt(input)) } });
    const work = engine.sync(); f.safety.queue('block_user', { actor_id: actor });
    const block = f.safety.pending()!.request; assert.equal(block.operation, 'block_user');
    finish(receipt(report)); await work; assert.deepEqual(f.safety.pending()!.request, block);
    await engine.sync(); engine.stop(); assert.equal(f.safety.pending(), null);
  } finally { f.db.close(); }
});

test('late safety receipt after account discard cannot recreate account state', async () => {
  const f = fixture();
  try {
    f.safety.queue('block_user', { actor_id: actor }); const pending = f.safety.pending()!.request;
    let finish!: (value: SafetyReceipt) => void, valid = true;
    const gate = new Promise<SafetyReceipt>(resolve => { finish = resolve; });
    const engine = new SyncEngine({ repo: f.sync, clock, valid: () => valid, transport: { ...transport, safety: () => gate } });
    const work = engine.sync(); valid = false; f.local.signOutAccount(f.account, now, true); finish(receipt(pending)); await work; engine.stop();
    assert.equal(f.local.preference(f.account, 'safety_receipt'), null); assert.equal(f.local.activePartition()!.kind, 'guest');
  } finally { f.db.close(); }
});

test('blocked-list parser strips unneeded data and rejects cursor disorder and wrong-target receipts', () => {
  const request: SafetyRequest = { operation: 'block_user', envelope: { actor_id: actor, operation_id: randomUUID() } };
  assert.throws(() => safetyReceipt({ ...receipt(request), actor_id: 'a_' + '2'.repeat(32) }, request));
  const source = { request_id: randomUUID(), items: [{ actor_id: actor, alias: 'valid_alias', user_id: randomUUID(), email: 'private' }], next_actor: null };
  assert.deepEqual(Object.keys(blockPage(source, null).items[0]).sort(), ['actor_id', 'alias']);
  assert.throws(() => blockPage(source, actor));
});
