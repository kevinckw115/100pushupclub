import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pg from 'pg';
import { localEnvironment, account, request, removeAccount } from './environment.mjs';
import { openTestDatabase } from '../../../apps/mobile/src/testing/node-sqlite.ts';
import { migrate } from '../../../apps/mobile/src/data/local/migrations.ts';
import { LocalRepository } from '../../../apps/mobile/src/data/local/repository.ts';
import { SyncRepository } from '../../../apps/mobile/src/data/sync/repository.ts';
import { SyncEngine } from '../../../apps/mobile/src/data/sync/engine.ts';
import { HttpSyncTransport } from '../../../apps/mobile/src/data/sync/transport.ts';
import { SyncFailure } from '../../../apps/mobile/src/data/sync/protocol.ts';

test('guest import survives restart and both UUID collisions against real accounts', { timeout: 90000 }, async () => {
  const config = localEnvironment(), a = await account(config), b = await account(config);
  const sql = new pg.Client({ connectionString: config.db }); await sql.connect();
  const directory = mkdtempSync(join(tmpdir(), 'pushupclub-import-')), file = join(directory, 'local.db');
  let db, local, sync, engine;
  const clock = { now: Date.now, random: () => 1, schedule: () => 0, cancel: () => {} };
  const http = new HttpSyncTransport(config.api, config.key, { userId: b.id, valid: () => true, token: async () => b.token });
  function open() { db = openTestDatabase(file); migrate(db); local = new LocalRepository(db, randomUUID); sync = new SyncRepository(local, b.id); }
  try {
    for (const user of [a, b]) assert.equal((await request(config, '/rest/v1/rpc/bootstrap_profile', { token: user.token, body: { operation_id: randomUUID() } })).status, 200);
    const now = new Date().toISOString(); open();
    const guest = local.startGuest(now);
    const rows = Array.from({ length: 3 }, () => local.create(guest.id, { id: randomUUID(), mutationId: randomUUID(), quantity: 20, occurredAt: now, timezone: 'UTC' }));
    local.activateAccount(b.id, now);
    const selection = rows.map(r => ({ partition: guest.id, id: r.id }));
    sync.imports.start(selection);
    for (const [index, user] of [a, b].entries()) {
      const body = { envelope: { kind: 'create', mutation_id: randomUUID(), checkin_id: rows[index].id, quantity: 5, occurred_at: now, recorded_timezone: 'UTC', local_date: now.slice(0, 10), source: 'native', requested_public_epoch: null } };
      assert.equal((await request(config, '/rest/v1/rpc/mutate_checkin', { token: user.token, body })).status, 200);
    }
    // Even an opted-in account must never publish imported history.
    assert.equal((await request(config, '/rest/v1/rpc/update_profile', { token: b.token, body: { envelope: { operation_id: randomUUID(), public_enabled: true, region_id: null, expected_consent_epoch: '0', accepted_terms_version: 'community-v1-2026-09-11' } } })).status, 200);
    let lost = false, original;
    engine = new SyncEngine({ repo: sync, valid: () => true, clock, transport: {
      pull: (...args) => http.pull(...args),
      mutate: async (...args) => {
        const accepted = await http.mutate(...args);
        if (args[0].checkin_id === rows[2].id && !lost) { lost = true; original = JSON.stringify(args[0]); throw new SyncFailure('NETWORK', { retryable: true }); }
        return accepted;
      },
    } });
    await engine.sync(); assert.equal(lost, true);
    engine.stop(); db.close(); open(); sync.clearRetry();
    const replay = sync.beginNext(new Date().toISOString());
    assert.equal(replay.request_json, original);
    engine = new SyncEngine({ repo: sync, transport: http, valid: () => true, clock });
    await engine.sync();
    assert.equal(sync.imports.counts().acknowledged, 2); assert.equal(sync.imports.counts().conflict, 1);
    const otherOwner = sync.imports.jobs().find(j => j.source_id === rows[0].id);
    assert.notEqual(otherOwner.destination_id, rows[0].id);
    sync.imports.resolve(rows[1].id, 'separate'); await engine.sync();
    sync.imports.start(selection); await engine.sync();
    assert.equal(sync.imports.counts().acknowledged, 3);
    assert.equal(local.total(b.id, now.slice(0, 10)), '65');
    assert.equal(local.total(guest.id, now.slice(0, 10)), '60');
    const accepted = await sql.query("SELECT quantity,source,public_epoch,public_region_id FROM app_private.checkins WHERE user_id=$1 AND source='import'", [b.id]);
    assert.equal(accepted.rows.length, 3);
    for (const r of accepted.rows) { assert.equal(r.quantity, 20); assert.equal(r.public_epoch, null); assert.equal(r.public_region_id, null); }
    assert.equal(sync.imports.cleanup(), 3); assert.equal(local.total(guest.id, now.slice(0, 10)), '0');
    assert.equal((await sql.query('SELECT COUNT(*)::integer count FROM app_private.checkins WHERE user_id=$1', [a.id])).rows[0].count, 1);
  } finally {
    engine?.stop(); db?.close(); await sql.end();
    rmSync(directory, { recursive: true, force: true });
    await removeAccount(config, a); await removeAccount(config, b);
  }
});
