import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { clubPage } from '../src/data/club.ts';
import type { ClubPage, PublicFeedRow } from '../src/data/club.ts';
import { ClubReader } from '../src/data/club-reader.ts';
import { SyncFailure } from '../src/data/sync/protocol.ts';
const flush = () => new Promise<void>(resolve => setImmediate(resolve));
const row = (id: number, quantity = 10): PublicFeedRow => ({ id: 'e_' + String(id).padStart(32, '0'), actor_id: 'a_' + String(id).padStart(32, '0'), username: 'person_' + id, quantity, relative_time: 'just now' });
const page = (items: PublicFeedRow[], scope = 'world'): ClubPage => ({ request_id: randomUUID(), requested_scope: scope, effective_scope: { id: 'world', label: 'World' }, fallback_reason: scope === 'world' ? null : 'SPARSE_REGION', window: { label: 'past 24 hours', as_of: '2026-09-11T12:00:00.000Z' }, pushups_past_24_hours: String(items.reduce((sum, row) => sum + row.quantity, 0)), people_past_hour: items.length, items, next_cursor: null });
function clock() {
  let now = 100000, serial = 0; const jobs = new Map<number, { at: number; run: () => void }>();
  return { now: () => now, random: () => 1, schedule: (run: () => void, delay: number) => { const id = ++serial; jobs.set(id, { at: now + delay, run }); return id; }, cancel: (id: unknown) => { jobs.delete(id as number); },
    async advance(ms: number) { now += ms; for (const [id, job] of [...jobs]) if (job.at <= now) { jobs.delete(id); job.run(); } await flush(); }, jobs };
}

test('public parser strips private fields and rejects raw IDs, timestamps, duplicate rows and mismatched scope', () => {
  const source = { ...page([row(1)]), secret: 'discard', items: [{ ...row(1), occurred_at: 'private', email: 'private' }] };
  const clean = clubPage(source, 'world');
  assert.deepEqual(Object.keys(clean.items[0]).sort(), ['actor_id', 'id', 'quantity', 'relative_time', 'username']);
  assert.equal(JSON.stringify(clean).includes('private'), false);
  assert.throws(() => clubPage(page([{ ...row(1), id: randomUUID() }]), 'world'));
  assert.throws(() => clubPage(page([{ ...row(1), relative_time: '2026-09-11T12:00:00Z' }]), 'world'));
  assert.throws(() => clubPage(page([row(1), row(1)]), 'world'));
  assert.throws(() => clubPage(page([]), 'gn:123'));
  assert.equal(clubPage({ ...page([]), pushups_past_24_hours: '9007199254740993' }, 'world').pushups_past_24_hours, '9007199254740993');
});

test('refresh removes revoked rows and corrects counts while new rows await explicit insertion', async () => {
  const time = clock(); let response = page([row(2), row(1)]);
  const reader = new ClubReader({ read: async () => response }, () => true, time);
  reader.setActive(true); await flush();
  response = page([row(3), row(2, 25)]);
  await time.advance(30000);
  assert.deepEqual(reader.snapshot().rows, [row(2, 25)]);
  assert.equal(reader.snapshot().page!.pushups_past_24_hours, '35');
  assert.deepEqual(reader.snapshot().updates!.items, response.items);
  reader.showUpdates(); assert.deepEqual(reader.snapshot().rows, response.items);
  response = page([]); await time.advance(30000);
  assert.deepEqual(reader.snapshot().rows, []); assert.equal(reader.snapshot().updates, null); reader.stop();
});

test('foreground polling, rapid refreshes and scope switches obey the ten-second request floor', async () => {
  const time = clock(), calls: string[] = [];
  const reader = new ClubReader({ read: async scope => { calls.push(scope); return page([row(calls.length)], scope); } }, () => true, time);
  reader.setActive(true); await flush();
  await Promise.all(Array.from({ length: 20 }, () => reader.refresh()));
  reader.setScope('gn:123'); reader.setScope('gn:456');
  assert.deepEqual(calls, ['world']); assert.equal(reader.snapshot().page, null);
  await time.advance(9999); assert.equal(calls.length, 1);
  await time.advance(1); assert.deepEqual(calls, ['world', 'gn:456']);
  reader.setActive(false); assert.equal(reader.snapshot().page, null);
  await time.advance(60000); assert.equal(calls.length, 2);
  reader.setActive(true); await flush(); assert.equal(calls.length, 3);
  reader.setOnline(false); assert.equal(reader.snapshot().status, 'offline'); assert.deepEqual(reader.snapshot().rows, []);
  await time.advance(60000); assert.equal(calls.length, 3); reader.stop(); assert.equal(time.jobs.size, 0);
});

test('late scope and identity responses cannot populate the current feed', async () => {
  const time = clock(); let release!: (value: ClubPage) => void, valid = true;
  const response = new Promise<ClubPage>(resolve => { release = resolve; });
  const reader = new ClubReader({ read: () => response }, () => valid, time);
  reader.setActive(true); reader.setScope('gn:123'); release(page([row(1)])); await flush();
  assert.equal(reader.snapshot().page, null); assert.deepEqual(reader.snapshot().rows, []);
  valid = false; await time.advance(30000); assert.equal(reader.snapshot().page, null); reader.stop();
});

test('Retry-After survives manual refresh and offline resume without leaking a previous page', async () => {
  const time = clock(); let calls = 0;
  const reader = new ClubReader({ read: async () => { calls++; throw new SyncFailure('RATE_LIMITED', { status: 429, retryable: true, retryAfterMs: 60000 }); } }, () => true, time);
  reader.setActive(true); await flush(); assert.equal(reader.snapshot().code, 'RATE_LIMITED');
  await reader.refresh(); reader.setOnline(false); reader.setOnline(true);
  await time.advance(59999); assert.equal(calls, 1);
  await time.advance(1); assert.equal(calls, 2); assert.equal(reader.snapshot().page, null); reader.stop();
});

test('pagination deduplicates rows, keeps a fixed window and discards a stale cursor', async () => {
  const time = clock(); let calls = 0;
  const reader = new ClubReader({ read: async () => {
    calls++; if (calls === 1) return { ...page([row(3), row(2)]), next_cursor: 'encrypted-1' };
    if (calls === 2) return { ...page([row(2), row(1)]), next_cursor: 'encrypted-2' };
    return { ...page([row(1)]), window: { label: 'past 24 hours', as_of: '2026-09-11T12:01:00.000Z' } };
  } }, () => true, time);
  reader.setActive(true); await flush(); await reader.more(); await time.advance(10000);
  assert.deepEqual(reader.snapshot().rows.map(row => row.id), [row(3).id, row(2).id, row(1).id]);
  await reader.more(); await time.advance(10000); assert.equal(reader.snapshot().code, 'INVALID_CURSOR'); assert.equal(reader.snapshot().page, null); reader.stop();
});
