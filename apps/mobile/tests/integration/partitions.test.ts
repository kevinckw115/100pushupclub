import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { openTestDatabase } from '../../src/testing/node-sqlite.ts';
import { migrate } from '../../src/data/local/migrations.ts';
import { LocalRepository } from '../../src/data/local/repository.ts';
import { Generation } from '../../src/domain/generation.ts';
const now = '2026-09-10T00:00:00Z';
const input = () => ({ id: randomUUID(), mutationId: randomUUID(), quantity: 20, occurredAt: now, timezone: 'UTC' });
test('explicit sign-out protects pending account work, purges its cache, and restores the original guest', () => {
  const db = openTestDatabase(':memory:');
  try {
    migrate(db); const repo = new LocalRepository(db, randomUUID);
    const guest = repo.startGuest(now); repo.create(guest.id, input());
    const account = repo.activateAccount(randomUUID(), now); repo.create(account.id, input());
    assert.equal(repo.unsynced(account.id), 1);
    assert.throws(() => repo.signOutAccount(account.id, now, false), /decision/);
    assert.equal(repo.activePartition()?.id, account.id);
    repo.signOutAccount(account.id, now, true);
    assert.equal(repo.activePartition()?.id, guest.id);
    assert.equal(repo.total(guest.id, '2026-09-10'), '20');
    assert.equal(repo.total(account.id, '2026-09-10'), '0');
    assert.equal(db.all('SELECT * FROM outbox').length, 0);
    assert.equal(db.all('SELECT * FROM sync_cursors').length, 0);
  } finally { db.close(); }
});
test('late account response cannot reactivate former identity after a switch', async () => {
  const db = openTestDatabase(':memory:');
  try {
    migrate(db); const repo = new LocalRepository(db, randomUUID), epoch = new Generation();
    const a = randomUUID(), b = randomUUID(), ticket = epoch.next();
    let resolve!: (id: string) => void;
    const response = new Promise<string>(done => { resolve = done; });
    const pending = response.then(id => { if (epoch.current(ticket)) repo.activateAccount(id, now); });
    epoch.next(); repo.activateAccount(b, now); resolve(a); await pending;
    assert.equal(repo.activePartition()?.id, b);
    assert.equal(db.all('SELECT * FROM local_partitions WHERE id=?', a).length, 0);
    assert.equal(db.all<{ revision: string }>('SELECT revision FROM sync_cursors')[0].revision, '0');
  } finally { db.close(); }
});
test('sign-out storage failure rolls the entire partition cleanup back', () => {
  const db = openTestDatabase(':memory:');
  try {
    migrate(db); const repo = new LocalRepository(db, randomUUID);
    const account = repo.activateAccount(randomUUID(), now); repo.create(account.id, input());
    db.exec("CREATE TRIGGER test_delete_failure BEFORE DELETE ON local_partitions BEGIN SELECT RAISE(ABORT,'injected'); END;");
    assert.throws(() => repo.signOutAccount(account.id, now, true), /injected/);
    assert.equal(repo.unsynced(account.id), 1); assert.equal(repo.activePartition()?.id, account.id);
    assert.equal(repo.total(account.id, '2026-09-10'), '20');
  } finally { db.close(); }
});
