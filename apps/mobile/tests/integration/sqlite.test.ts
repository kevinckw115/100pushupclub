import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { openTestDatabase } from '../../src/testing/node-sqlite.ts';
import { migrate } from '../../src/data/local/migrations.ts';
import { LocalRepository } from '../../src/data/local/repository.ts';

const now = '2026-09-10T15:00:00Z';
const input = (count = 20) => ({ id: randomUUID(), mutationId: randomUUID(), quantity: count, occurredAt: now, timezone: 'UTC' });

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'pushupclub-sqlite-'));
  const file = join(directory, 'test.db');
  const db = openTestDatabase(file);
  migrate(db);
  const repo = new LocalRepository(db, randomUUID);
  return { directory, file, db, repo, cleanup: () => { db.close(); rmSync(directory, { recursive: true }); } };
}

test('file persists after a worker exits without shutdown handlers', () => {
  const f = fixture();
  try {
    const guest = f.repo.startGuest(now);
    f.repo.create(guest.id, input());
    const child = spawnSync(process.execPath, ['tests/fixtures/commit-child.ts', f.file, guest.id], { encoding: 'utf8' });
    assert.equal(child.status, 0, child.stderr);
    const reopened = openTestDatabase(f.file);
    const repo = new LocalRepository(reopened, randomUUID);
    assert.equal(repo.total(guest.id, '2026-09-10'), '35');
    assert.equal(repo.activePartition()?.id, guest.id);
    reopened.close();
  } finally { f.cleanup(); }
});

test('closing every connection and reopening preserves the committed guest log', () => {
  const directory = mkdtempSync(join(tmpdir(), 'pushupclub-reopen-'));
  const file = join(directory, 'test.db');
  let db = openTestDatabase(file);
  try {
    migrate(db);
    const repo = new LocalRepository(db, randomUUID);
    const guest = repo.startGuest(now);
    repo.create(guest.id, input());
    db.close();
    db = openTestDatabase(file);
    migrate(db);
    assert.equal(new LocalRepository(db, randomUUID).total(guest.id, '2026-09-10'), '20');
  } finally { db.close(); rmSync(directory, { recursive: true }); }
});

test('account check-in and outbox commit together; trigger failure rolls both back', () => {
  const f = fixture();
  try {
    const account = randomUUID();
    // Test setup only. Account partition creation will require verified auth in T09.
    f.db.run("INSERT INTO local_partitions(id,kind,created_at) VALUES(?,'account',?)", account, now);
    f.repo.create(account, input());
    assert.equal(f.db.all('SELECT * FROM outbox').length, 1);
    f.db.exec("CREATE TRIGGER inject_disk_failure BEFORE INSERT ON outbox BEGIN SELECT RAISE(ABORT,'simulated write failure'); END;");
    assert.throws(() => f.repo.create(account, input(15)), /simulated write failure/);
    assert.equal(f.repo.total(account, '2026-09-10'), '20');
    assert.equal(f.db.all('SELECT * FROM outbox').length, 1);
  } finally { f.cleanup(); }
});

test('guest has no cloud outbox, repeated startup keeps identity, partitions cannot cross-read', () => {
  const f = fixture();
  try {
    const guest = f.repo.startGuest(now);
    const record = f.repo.create(guest.id, input());
    assert.equal(f.repo.startGuest(now).id, guest.id);
    const other = randomUUID();
    f.db.run("INSERT INTO local_partitions(id,kind,created_at) VALUES(?,'account',?)", other, now);
    assert.equal(f.repo.get(other, record.id), null);
    assert.equal(f.repo.total(other, '2026-09-10'), '0');
    assert.equal(f.db.all('SELECT * FROM outbox').length, 0);
  } finally { f.cleanup(); }
});

test('constraints reject invalid quantities, time edits, resurrection and sent request changes', () => {
  const f = fixture();
  try {
    const account = randomUUID();
    f.db.run("INSERT INTO local_partitions(id,kind,created_at) VALUES(?,'account',?)", account, now);
    const record = f.repo.create(account, input());
    for (const count of [0, -1, 1.2, 1000]) {
      assert.throws(() => f.repo.create(account, input(count)));
      assert.throws(() => f.db.run('UPDATE local_checkins SET quantity=? WHERE id=?', count, record.id));
    }
    assert.throws(() => f.db.run("UPDATE local_checkins SET local_date='2026-09-11' WHERE id=?", record.id));
    f.db.run('UPDATE local_checkins SET deleted=1,accepted_json=? WHERE id=?', JSON.stringify({ deleted_at: now }), record.id);
    assert.throws(() => f.db.run('UPDATE local_checkins SET deleted=0 WHERE id=?', record.id));
    f.db.exec("UPDATE outbox SET status='sending';");
    assert.throws(() => f.db.exec("UPDATE outbox SET request_json='{}';"));
  } finally { f.cleanup(); }
});

test('v1 database upgrades transactionally without losing records or queued work', () => {
  const db = openTestDatabase(':memory:');
  try {
    migrate(db, 1);
    const repo = new LocalRepository(db, randomUUID);
    const account = randomUUID();
    db.run("INSERT INTO local_partitions(id,kind,created_at) VALUES(?,'account',?)", account, now);
    const record = repo.create(account, input());
    migrate(db);
    migrate(db);
    assert.equal(repo.get(account, record.id)?.quantity, 20);
    assert.equal(db.all('SELECT * FROM outbox').length, 1);
    assert.equal(db.all('SELECT * FROM local_schema_migrations').length, 3);
  } finally { db.close(); }
});

test('failed migration rolls back schema changes and version marker together', () => {
  const db = openTestDatabase(':memory:');
  try {
    migrate(db, 1);
    db.exec('CREATE INDEX outbox_ready ON outbox(partition_id);');
    assert.throws(() => migrate(db), /already exists/);
    assert.equal(db.all("SELECT name FROM sqlite_master WHERE name='checkins_by_day'").length, 0);
    assert.equal(db.all('SELECT * FROM local_schema_migrations').length, 1);
    db.exec('DROP INDEX outbox_ready;');
    migrate(db);
    assert.equal(db.all('SELECT * FROM local_schema_migrations').length, 3);
  } finally { db.close(); }
});

test('quantity edit and deletion recompute totals without moving the recorded day', () => {
  const f = fixture();
  try {
    const guest = f.repo.startGuest(now);
    const row = f.repo.create(guest.id, input());
    f.repo.edit(guest.id, row.id, 35);
    assert.equal(f.repo.get(guest.id, row.id)?.local_date, '2026-09-10');
    assert.equal(f.repo.total(guest.id, '2026-09-10'), '35');
    f.repo.delete(guest.id, row.id);
    assert.equal(f.repo.total(guest.id, '2026-09-10'), '0');
    assert.throws(() => f.repo.edit(guest.id, row.id, 10));
  } finally { f.cleanup(); }
});

test('unsent create can be corrected or undone without a cloud effect', () => {
  const f = fixture();
  try {
    const account = randomUUID();
    f.db.run("INSERT INTO local_partitions(id,kind,created_at) VALUES(?,'account',?)", account, now);
    const row = f.repo.create(account, input());
    f.repo.edit(account, row.id, 15);
    const queued = f.db.all<{ request_json: string }>('SELECT request_json FROM outbox');
    assert.equal(queued.length, 1);
    assert.equal(JSON.parse(queued[0].request_json).quantity, 15);
    f.repo.delete(account, row.id);
    assert.equal(f.db.all('SELECT * FROM outbox').length, 0);
    assert.equal(f.repo.total(account, '2026-09-10'), '0');
  } finally { f.cleanup(); }
});

test('in-flight undo retains exact request and queues a dependent deletion', () => {
  const f = fixture();
  try {
    const account = randomUUID();
    f.db.run("INSERT INTO local_partitions(id,kind,created_at) VALUES(?,'account',?)", account, now);
    const row = f.repo.create(account, input());
    const original = f.db.all<{ mutation_id: string; request_json: string }>('SELECT mutation_id,request_json FROM outbox')[0];
    f.db.exec("UPDATE outbox SET status='sending';");
    f.repo.delete(account, row.id);
    const queue = f.db.all<{ request_json: string | null; dependency_mutation: string | null; operation: string }>('SELECT * FROM outbox ORDER BY sequence');
    assert.equal(queue[0].request_json, original.request_json);
    assert.equal(queue[1].operation, 'delete');
    assert.equal(queue[1].request_json, null);
    assert.equal(queue[1].dependency_mutation, original.mutation_id);
    assert.equal(f.repo.total(account, '2026-09-10'), '0');
  } finally { f.cleanup(); }
});

test('history pages include rest days; record pagination preserves timestamp ties', () => {
  const f = fixture();
  try {
    const guest = f.repo.startGuest(now);
    for (let n = 0; n < 101; n++) f.repo.create(guest.id, input(1));
    const first = f.repo.day(guest.id, '2026-09-10');
    const last = first.at(-1)!;
    const second = f.repo.day(guest.id, '2026-09-10', { time: last.occurred_at, id: last.id });
    assert.equal(first.length, 100); assert.equal(second.length, 1);
    assert.equal(new Set([...first, ...second].map(row => row.id)).size, 101);
    const history = f.repo.history(guest.id, '2026-09-10');
    assert.equal(history.length, 30); assert.equal(history[0].total, '101');
    assert.equal(history[1].total, '0'); assert.equal(history.at(-1)?.date, '2026-08-12');
    assert.equal(f.repo.history(guest.id, '2026-08-11')[0].total, '0');
    f.repo.delete(guest.id, first[0].id); f.repo.edit(guest.id, first[1].id, 10);
    assert.equal(f.repo.history(guest.id, '2026-09-10')[0].total, '109');
  } finally { f.cleanup(); }
});
