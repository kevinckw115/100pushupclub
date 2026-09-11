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
import { circleResponse, circleReceipt, circleRequest } from '../../src/data/circles.ts';
import type { CircleRequest, CircleReceipt } from '../../src/data/circles.ts';
import type { SyncTransport } from '../../src/data/sync/transport.ts';
import { CheckedReader } from '../../src/data/checked-reader.ts';
const now = '2026-09-11T12:00:00.000Z', circleId = randomUUID(), memberId = 'm_' + '1'.repeat(32);
const summary = { id: circleId, name: 'Morning crew', timezone: 'America/Los_Angeles', is_owner: true, member_id: memberId, member_count: 1, name_change_required: false };
function fixture(path = ':memory:', account = randomUUID()) { const db = openTestDatabase(path); migrate(db); const local = new LocalRepository(db, randomUUID); local.activateAccount(account, now); const sync = new SyncRepository(local, account); return { db, local, account, sync, circles: sync.circles }; }
const receipt = (input: CircleRequest): CircleReceipt => ({ request_id: randomUUID(), operation_id: input.envelope.operation_id, circle: summary });
const clock = { now: () => Date.parse(now), random: () => 1, schedule: () => 0, cancel: () => {} };
const transport: SyncTransport = { pull: async after => ({ request_id: randomUUID(), changes: [], next_revision: after, has_more: false }), mutate: async () => { throw Error('Unexpected mutation'); }, circle: async input => receipt(input) };

test('circle creation persists the exact uncertain request across restart and prevents silent signout loss', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'pushup-circles-')); let f = fixture(join(dir, 'local.db'));
  try {
    f.circles.queue('create_circle', { name: summary.name, timezone: summary.timezone, accept_circle_sharing: true }); const pending = f.circles.pending()!.request;
    assert.throws(() => f.local.signOutAccount(f.account, now, false), /decision/);
    let engine = new SyncEngine({ repo: f.sync, clock, valid: () => true, transport: { ...transport, circle: async () => { throw new SyncFailure('NETWORK', { retryable: true }); } } });
    await engine.sync(); engine.stop(); assert.throws(() => f.circles.discardRejected(), /may have reached/);
    const account = f.account; f.db.close(); f = fixture(join(dir, 'local.db'), account); assert.deepEqual(f.circles.pending()!.request, pending);
    engine = new SyncEngine({ repo: f.sync, clock, valid: () => true, transport: { ...transport, circle: async input => { assert.deepEqual(input, pending); return receipt(input); } } });
    await engine.retry(); engine.stop(); assert.equal(f.circles.pending(), null); assert.equal(f.circles.last()!.receipt.operation_id, pending.envelope.operation_id);
  } finally { f.db.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('circle acknowledgment and retry delay are atomic, bounded, and identity fenced', async () => {
  const f = fixture();
  try {
    f.circles.queue('create_circle', { name: summary.name, timezone: summary.timezone, accept_circle_sharing: true }); const pending = f.circles.pending()!.request;
    f.db.exec("CREATE TRIGGER fail_circle_receipt BEFORE INSERT ON preferences WHEN NEW.key='circle_receipt' BEGIN SELECT RAISE(ABORT,'disk full'); END;");
    assert.throws(() => f.circles.accept(pending.envelope.operation_id, receipt(pending)), /disk full/); assert.deepEqual(f.circles.pending()!.request, pending); assert.equal(f.circles.last(), null);
    f.db.exec('DROP TRIGGER fail_circle_receipt;'); let calls = 0;
    const engine = new SyncEngine({ repo: f.sync, clock, valid: () => true, transport: { ...transport, circle: async () => { calls++; throw new SyncFailure('RATE_LIMITED', { status: 429, retryable: true, retryAfterMs: 60000 }); } } });
    await engine.sync(); await engine.retry(); engine.stop(); assert.equal(calls, 1); assert.equal(f.circles.retryDelay(clock.now() - 3600000), 60000);
    f.local.signOutAccount(f.account, now, true); assert.throws(() => f.circles.accept(pending.envelope.operation_id, receipt(pending)), /STALE_SCOPE/);
  } finally { f.db.close(); }
});

test('removed membership rejection requires an explicit new operation rather than silent reinstatement', async () => {
  const f = fixture();
  try {
    f.circles.queue('join_circle', { code: 'pc_' + '2'.repeat(64), accept_circle_sharing: true }); const old = f.circles.pending()!.request.envelope.operation_id;
    const engine = new SyncEngine({ repo: f.sync, clock, valid: () => true, transport: { ...transport, circle: async () => { throw new SyncFailure('MEMBERSHIP_CHANGED', { status: 409 }); } } });
    await engine.sync(); engine.stop(); assert.equal(f.circles.pending()!.state, 'rejected'); assert.throws(() => f.circles.queue('join_circle', { code: 'pc_' + '2'.repeat(64), accept_circle_sharing: true }));
    f.circles.discardRejected(); f.circles.queue('join_circle', { code: 'pc_' + '2'.repeat(64), accept_circle_sharing: true }); assert.notEqual(f.circles.pending()!.request.envelope.operation_id, old);
  } finally { f.db.close(); }
});

test('circle parser strips private properties and rejects inconsistent totals, order, identities and receipts', () => {
  const result = { request_id: randomUUID(), circle: { ...summary, local_date: '2026-09-11', total_reps: '185', checked_in_count: 2, active_member_count: 3, hidden_activity: false, owner_id: randomUUID(), members: [
    { member_id: 'm_' + '1'.repeat(32), username: 'alpha', total_reps: '100', checked_in: true, is_self: true, email: 'private@example.invalid' },
    { member_id: 'm_' + '2'.repeat(32), username: 'bravo', total_reps: '85', checked_in: true, is_self: false },
    { member_id: 'm_' + '3'.repeat(32), username: 'charlie', total_reps: '0', checked_in: false, is_self: false },
  ] } };
  const parsed = circleResponse(result, circleId); assert.equal(parsed.circle.total_reps, '185'); assert.equal(JSON.stringify(parsed).includes('email'), false); assert.equal(JSON.stringify(parsed).includes('owner_id'), false);
  assert.throws(() => circleResponse({ ...result, circle: { ...result.circle, total_reps: '186' } }, circleId));
  assert.throws(() => circleResponse({ ...result, circle: { ...result.circle, members: [...result.circle.members].reverse() } }, circleId));
  assert.throws(() => circleResponse(result, randomUUID()));
  const input = circleRequest('manage_circle', { operation_id: randomUUID(), circle_id: circleId, action: 'leave' });
  assert.throws(() => circleReceipt({ request_id: randomUUID(), operation_id: input.envelope.operation_id, circle_id: randomUUID(), applied: true }, input));
  assert.throws(() => circleRequest('create_circle', { operation_id: randomUUID(), name: 'Morning', timezone: 'UTC', accept_circle_sharing: false }));
});

test('checked private reader clears on blur/offline/invalidation and rejects late responses', async () => {
  let resolve!: (value: string) => void, time = 0, calls = 0, task: (() => void) | null = null;
  const c = { now: () => time, random: () => 1, schedule: (run: () => void) => { task = run; return 1; }, cancel: () => { task = null; } };
  const reader = new CheckedReader(() => { calls++; return new Promise<string>(r => { resolve = r; }); }, () => true, c);
  reader.setActive(true); reader.setActive(false); resolve('stale private data'); await Promise.resolve(); assert.equal(reader.snapshot().value, null);
  time = 10000; reader.setActive(true); resolve('current'); await Promise.resolve(); assert.equal(reader.snapshot().value, 'current');
  reader.setOnline(false); assert.equal(reader.snapshot().value, null); assert.equal(reader.snapshot().status, 'offline');
  reader.setOnline(true); assert.equal(calls, 2); time = 20000; (task as unknown as () => void)(); resolve('new'); await Promise.resolve(); assert.equal(reader.snapshot().value, 'new');
  reader.invalidate(); assert.equal(reader.snapshot().value, null); reader.stop(); assert.equal(task, null);
});

test('checked reader honors server rate pauses across focus and device clock rollback', async () => {
  let time = 100000, calls = 0;
  const reader = new CheckedReader(async () => { calls++; throw new SyncFailure('RATE_LIMITED', { retryable: true, retryAfterMs: 60000 }); }, () => true, { now: () => time, random: () => 1, schedule: () => 0, cancel: () => {} });
  reader.setActive(true); await Promise.resolve(); assert.equal(reader.snapshot().code, 'RATE_LIMITED');
  reader.setActive(false); reader.setActive(true); await reader.refresh(); assert.equal(calls, 1);
  time = 0; await reader.refresh(); assert.equal(calls, 1); time = 60000; await reader.refresh(); assert.equal(calls, 2); reader.stop();
});
