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
import type { OwnProfile } from '../../src/data/local/profile.ts';
import type { SyncTransport } from '../../src/data/sync/transport.ts';
const now = '2026-09-11T12:00:00.000Z';
const on: OwnProfile = { alias: 'test_person', region_id: null, public_enabled: true, consent_epoch: '1', status: 'active', participation_terms_version: 'community-v1-2026-09-11', alias_change_required: false };
const off = { ...on, public_enabled: false, consent_epoch: '2' };
function fixture(path = ':memory:', account = randomUUID()) {
  const db = openTestDatabase(path); migrate(db); const local = new LocalRepository(db, randomUUID);
  local.activateAccount(account, now); const sync = new SyncRepository(local, account);
  return { db, local, sync, account, profile: sync.profile };
}
const clock = { now: () => Date.parse(now), random: () => 1, schedule: () => 0, cancel: () => {} };
const transport: SyncTransport = {
  mutate: async () => { throw new Error('No check-in expected'); },
  pull: async after => ({ request_id: randomUUID(), changes: [], next_revision: after, has_more: false }),
  getProfile: async () => off, updateProfile: async () => off,
};

test('uncertain sharing request survives file reopen and replays exactly before confirming current state', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'pushup-profile-')), path = join(dir, 'local.sqlite');
  let f = fixture(path);
  try {
    f.profile.store(on); assert.equal(f.profile.publicEpoch(), '1');
    f.profile.queue({ public_enabled: false, expected_consent_epoch: '1' });
    const request = f.profile.pending()!.request;
    assert.equal(f.profile.publicEpoch(), null);
    assert.throws(() => f.local.signOutAccount(f.account, now, false), /decision/);
    assert.throws(() => f.profile.queue({ alias: 'another_alias' }), /pending/);
    const sent: unknown[] = [];
    let engine = new SyncEngine({ repo: f.sync, valid: () => true, clock, transport: { ...transport,
      updateProfile: async input => { sent.push(input); return off; },
      getProfile: async () => { throw new SyncFailure('NETWORK', { retryable: true }); },
    } });
    await engine.sync(); engine.stop();
    assert.equal(f.profile.pending()!.state, 'sending'); assert.equal(f.profile.cached()!.public_enabled, true);
    assert.throws(() => f.profile.discardRejected(), /may already/);
    const account = f.account; f.db.close(); f = fixture(path, account);
    assert.deepEqual(f.profile.pending()!.request, request);
    f.profile.clearRetry();
    // The original off receipt is older than another device's new on state.
    engine = new SyncEngine({ repo: f.sync, valid: () => true, clock, transport: { ...transport,
      updateProfile: async input => { sent.push(input); return off; }, getProfile: async () => ({ ...on, consent_epoch: '3' }),
    } });
    await engine.sync(); engine.stop();
    assert.deepEqual(sent, [request, request]); assert.equal(f.profile.pending(), null); assert.equal(f.profile.publicEpoch(), '3');
  } finally { f.db.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('profile acknowledgement is atomic and rejected consent needs an explicit fresh request', () => {
  const f = fixture();
  try {
    f.profile.store(on); f.profile.queue({ public_enabled: false, expected_consent_epoch: '1' });
    const request = f.profile.pending()!.request;
    f.db.exec("CREATE TRIGGER fail_ack BEFORE INSERT ON preferences WHEN NEW.key='profile_ack' BEGIN SELECT RAISE(ABORT,'disk full'); END;");
    assert.throws(() => f.profile.accept(request.operation_id, off), /disk full/);
    assert.equal(f.profile.cached()!.consent_epoch, '1'); assert.deepEqual(f.profile.pending()!.request, request);
    f.db.exec('DROP TRIGGER fail_ack;');
    f.profile.reject(request.operation_id, 'CONSENT_CONFLICT', { ...on, consent_epoch: '3' });
    assert.equal(f.profile.publicEpoch(), null); assert.equal(f.profile.pending()!.state, 'rejected');
    f.profile.discardRejected(); f.profile.queue({ public_enabled: false, expected_consent_epoch: '3' });
    assert.notEqual(f.profile.pending()!.request.operation_id, request.operation_id);
    assert.equal(f.profile.pending()!.request.expected_consent_epoch, '3');
  } finally { f.db.close(); }
});

test('profile rate deadline survives worker restart and rebases a backwards clock', async () => {
  const f = fixture();
  try {
    f.profile.store(on); f.profile.queue({ public_enabled: false, expected_consent_epoch: '1' });
    let calls = 0;
    const engine = new SyncEngine({ repo: f.sync, valid: () => true, clock, transport: { ...transport, updateProfile: async () => { calls++; throw new SyncFailure('RATE_LIMITED', { status: 429, retryable: true, retryAfterMs: 60000 }); } } });
    await engine.sync(); engine.stop(); assert.equal(calls, 1);
    assert.equal(f.profile.retryDelay(clock.now() - 3600000), 60000);
    const restarted = new SyncEngine({ repo: f.sync, valid: () => true, clock: { ...clock, now: () => clock.now() - 3600000 }, transport: { ...transport, updateProfile: async () => { calls++; return off; } } });
    await restarted.sync(); restarted.stop(); assert.equal(calls, 1);
  } finally { f.db.close(); }
});

test('a late profile response cannot rewrite a signed-out partition', async () => {
  const f = fixture();
  try {
    f.profile.store(on); let valid = true;
    let finish!: (value: OwnProfile) => void;
    const received = new Promise<OwnProfile>(resolve => { finish = resolve; });
    const engine = new SyncEngine({ repo: f.sync, valid: () => valid, clock, transport: { ...transport, getProfile: () => received } });
    const work = engine.sync(); valid = false; f.local.signOutAccount(f.account, now, false); finish(on);
    await work; engine.stop(); assert.equal(f.local.preference(f.account, 'account_profile'), null);
  } finally { f.db.close(); }
});
