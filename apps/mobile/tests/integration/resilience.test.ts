import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openTestDatabase } from '../../src/testing/node-sqlite.ts';
import { migrate } from '../../src/data/local/migrations.ts';
import { LocalRepository } from '../../src/data/local/repository.ts';
import { LocalExportSnapshot } from '../../src/data/local/export.ts';

test('abrupt exit between check-in and outbox writes rolls back the entire transaction', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pushup-interrupt-')), file = join(dir, 'local.db'); let db = openTestDatabase(file);
  try {
    migrate(db); const local = new LocalRepository(db, randomUUID), account = randomUUID(); local.activateAccount(account, '2026-09-11T12:00:00Z');
    local.create(account, { id: randomUUID(), mutationId: randomUUID(), quantity: 20, occurredAt: '2026-09-11T12:00:00Z', timezone: 'UTC' }); db.close();
    const child = spawnSync(process.execPath, ['tests/fixtures/interrupt-child.ts', file, account], { encoding: 'utf8' }); assert.equal(child.status, 73);
    db = openTestDatabase(file); migrate(db); const reopened = new LocalRepository(db, randomUUID);
    assert.equal(reopened.total(account, '2026-09-11'), '20'); assert.equal(reopened.unsynced(account), 1); assert.equal(db.all<{ integrity_check: string }>('PRAGMA integrity_check')[0].integrity_check, 'ok');
  } finally { db.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('100k local records retain indexed day/history access and bounded consistent export pages', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pushup-load-')), db = openTestDatabase(join(dir, 'local.db')); let snapshot: LocalExportSnapshot | undefined;
  try {
    migrate(db); const local = new LocalRepository(db, randomUUID), guest = local.startGuest('2026-09-11T12:00:00Z');
    const seedStart = performance.now();
    db.transaction(() => db.run("WITH RECURSIVE n(value) AS (SELECT 1 UNION ALL SELECT value+1 FROM n WHERE value<100000) INSERT INTO local_checkins(partition_id,id,quantity,occurred_at,recorded_timezone,local_date,source,state) SELECT ?,printf('%08x-0000-4000-8000-000000000000',value),1,strftime('%Y-%m-%dT12:00:00.000Z','2026-09-11',printf('-%d days',value%100)),'UTC',date('2026-09-11',printf('-%d days',value%100)),'native','local' FROM n", guest.id));
    const seedMs = performance.now() - seedStart, times: number[] = [];
    for (let i = 0; i < 100; i++) { const start = performance.now(); assert.equal(local.total(guest.id, '2026-09-11'), '1000'); assert.equal(local.day(guest.id, '2026-09-11').length, 100); times.push(performance.now() - start); }
    const plans = db.all<{ detail: string }>('EXPLAIN QUERY PLAN SELECT SUM(quantity) FROM local_checkins WHERE partition_id=? AND local_date=? AND deleted=0', guest.id, '2026-09-11'); assert.ok(plans.some(p => /INDEX checkins_by_day/.test(p.detail)));
    const start = performance.now(); snapshot = new LocalExportSnapshot(local, guest.id); let after = '', count = 0, pages = 0;
    for (;;) { const rows = snapshot.page(after); if (!rows.length) break; assert.ok(rows.length <= 500); count += rows.length; pages++; after = rows[rows.length - 1].id; }
    assert.equal(count, 100000); assert.equal(pages, 200); assert.equal(local.history(guest.id, '2026-09-11').length, 30);
    times.sort((a, b) => a - b); console.log(JSON.stringify({ benchmark: 'host-sqlite-only', records: count, seed_ms: Math.round(seedMs), day_and_page_p95_ms: Math.round(times[94] * 100) / 100, snapshot_and_200_pages_ms: Math.round(performance.now() - start), native_device_verified: false }));
  } finally { snapshot?.close(); db.close(); rmSync(dir, { recursive: true, force: true }); }
});
