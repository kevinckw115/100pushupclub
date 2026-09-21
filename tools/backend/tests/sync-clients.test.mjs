import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { localEnvironment, account, request, removeAccount } from './environment.mjs';
import { openTestDatabase } from '../../../apps/mobile/src/testing/node-sqlite.ts';
import { migrate } from '../../../apps/mobile/src/data/local/migrations.ts';
import { LocalRepository } from '../../../apps/mobile/src/data/local/repository.ts';
import { SyncRepository } from '../../../apps/mobile/src/data/sync/repository.ts';
import { SyncEngine } from '../../../apps/mobile/src/data/sync/engine.ts';
import { HttpSyncTransport } from '../../../apps/mobile/src/data/sync/transport.ts';
import { SyncFailure } from '../../../apps/mobile/src/data/sync/protocol.ts';

test('production SQLite clients converge through real RPC replay, Undo, conflicts and deletion', { timeout: 90000 }, async () => {
  const config = localEnvironment(), user = await account(config);
  const directory = mkdtempSync(join(tmpdir(), 'pushupclub-sync-'));
  const clients = [];
  const noTimer = { now: Date.now, random: () => 1, schedule: () => 0, cancel: () => {} };
  function client(file) {
    const db = openTestDatabase(file); migrate(db);
    const local = new LocalRepository(db, randomUUID); local.activateAccount(user.id, new Date().toISOString());
    const repo = new SyncRepository(local, user.id);
    const http = new HttpSyncTransport(config.api, config.key, { userId: user.id, valid: () => true, token: async () => user.token });
    const value = { db, local, repo, http, engine: null, closed: false };
    value.engine = new SyncEngine({ repo, transport: http, valid: () => true, clock: noTimer });
    clients.push(value); return value;
  }
  const create = c => c.local.create(user.id, { id: randomUUID(), mutationId: randomUUID(), quantity: 20, occurredAt: new Date().toISOString(), timezone: 'UTC' });
  try {
    assert.equal((await request(config, '/rest/v1/rpc/bootstrap_profile', { token: user.token, body: { operation_id: randomUUID() } })).status, 200);
    let a = client(join(directory, 'a.db'));
    const b = client(join(directory, 'b.db'));
    const row = create(a), sent = [];
    a.engine.stop();
    a.engine = new SyncEngine({ repo: a.repo, valid: () => true, clock: noTimer, transport: {
      pull: (...args) => a.http.pull(...args),
      mutate: async (...args) => { sent.push(JSON.stringify(args[0])); await a.http.mutate(...args); throw new SyncFailure('NETWORK', { retryable: true }); },
    } });
    await a.engine.sync();
    assert.equal(a.local.unsynced(user.id), 1);
    a.engine.stop(); a.db.close(); a.closed = true;
    a = client(join(directory, 'a.db')); a.repo.clearRetry();
    const replay = a.repo.beginNext(new Date().toISOString());
    assert.equal(replay.request_json, sent[0]);
    await a.engine.sync(); await b.engine.sync();
    assert.equal(a.local.unsynced(user.id), 0);
    assert.equal(b.local.get(user.id, row.id).quantity, 20);
    assert.equal(b.db.all('SELECT * FROM local_checkins').length, 1);

    // Hold a committed create response while the user presses Undo.
    const undo = create(a); let release, entered;
    const ready = new Promise(resolve => { entered = resolve; });
    const gate = new Promise(resolve => { release = resolve; });
    a.engine.stop();
    a.engine = new SyncEngine({ repo: a.repo, valid: () => true, clock: noTimer, transport: {
      pull: (...args) => a.http.pull(...args),
      mutate: async (...args) => { const result = await a.http.mutate(...args); if (args[0].checkin_id === undo.id && args[0].kind === 'create') { entered(); await gate; } return result; },
    } });
    const syncing = a.engine.sync(); await ready;
    a.local.delete(user.id, undo.id); release(); await syncing; await b.engine.sync();
    assert.equal(b.local.get(user.id, undo.id).deleted, 1);
    assert.equal(b.local.get(user.id, undo.id).server_version, 2);

    // Freeze both edits against the same base before either response arrives.
    a.local.edit(user.id, row.id, 30); b.local.edit(user.id, row.id, 40);
    const qa = a.repo.beginNext(new Date().toISOString()), qb = b.repo.beginNext(new Date().toISOString());
    const responses = await Promise.allSettled([a.http.mutate(JSON.parse(qa.request_json), new AbortController().signal), b.http.mutate(JSON.parse(qb.request_json), new AbortController().signal)]);
    assert.equal(responses.filter(r => r.status === 'fulfilled').length, 1);
    let loser;
    for (const [i, c] of [a, b].entries()) {
      const response = responses[i], queued = [qa, qb][i];
      if (response.status === 'fulfilled') c.repo.acknowledge(queued, response.value);
      else { assert.equal(response.reason.code, 'VERSION_CONFLICT'); c.repo.fail(queued, response.reason); loser = c; }
    }
    const intended = loser === a ? 30 : 40;
    assert.equal(loser.repo.details(row.id).local.quantity, intended);
    loser.repo.applyMine(row.id, intended);
    await loser.engine.sync(); await a.engine.sync(); await b.engine.sync();
    for (const c of [a, b]) { assert.equal(c.local.get(user.id, row.id).quantity, intended); assert.equal(c.local.get(user.id, row.id).server_version, 3); }

    b.local.edit(user.id, row.id, 50);
    a.local.delete(user.id, row.id); await a.engine.sync(); await b.engine.sync();
    assert.equal(b.repo.details(row.id).remote.deleted_at !== null, true);
    assert.equal(b.repo.details(row.id).local.quantity, 50);
    const replacement = b.repo.replacePrivately(row.id, 50, new Date().toISOString(), 'UTC');
    await b.engine.sync(); await a.engine.sync();
    assert.notEqual(replacement, row.id);
    for (const c of [a, b]) {
      assert.equal(c.local.get(user.id, row.id).deleted, 1);
      assert.equal(c.local.get(user.id, replacement).quantity, 50);
      assert.equal(JSON.parse(c.local.get(user.id, replacement).accepted_json).public_epoch, null);
      assert.equal(c.local.unsynced(user.id), 0);
    }
    assert.equal(a.repo.cursor(), b.repo.cursor());
    const invalid = await request(config, '/rest/v1/rpc/mutate_checkin', { token: user.token, body: { envelope: { kind: 'delete', mutation_id: randomUUID(), checkin_id: '00000000-0000-0000-0000-000000000000', expected_version: 1 } } });
    assert.equal(invalid.status, 400);
  } finally {
    for (const c of clients) { c.engine.stop(); if (!c.closed) c.db.close(); }
    rmSync(directory, { recursive: true, force: true });
    await removeAccount(config, user);
  }
});
