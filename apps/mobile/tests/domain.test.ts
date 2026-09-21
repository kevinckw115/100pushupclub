import { test } from 'node:test';
import assert from 'node:assert/strict';
import { instant, localDate, metrics, quantity } from '../src/domain/checkin.ts';

test('quantity rejects ambiguous values and accepts boundaries', () => {
  for (const value of ['', 0, -1, 1.1, NaN, 1000, '1e2', '3.0', '+5', null, true, '5pushups']) assert.throws(() => quantity(value));
  assert.equal(quantity(' 001 '), 1);
  assert.equal(quantity('999'), 999);
});
test('recorded dates handle midnight, DST repeats, and travel without reassigning history', () => {
  assert.equal(localDate('2026-09-11T06:59:59Z', 'America/Los_Angeles'), '2026-09-10');
  assert.equal(localDate('2026-09-11T07:00:00Z', 'America/Los_Angeles'), '2026-09-11');
  assert.equal(localDate('2026-11-01T08:30:00Z', 'America/Los_Angeles'), '2026-11-01');
  assert.equal(localDate('2026-11-01T09:30:00Z', 'America/Los_Angeles'), '2026-11-01');
  assert.equal(localDate('2026-09-10T23:00:00Z', 'Asia/Tokyo'), '2026-09-11');
  for (const value of ['2026-02-30T01:00:00Z', 'bad', '2026-01-01']) assert.throws(() => instant(value));
  assert.throws(() => localDate('2026-01-01T00:00:00Z', ''));
  assert.throws(() => localDate('2026-01-01T00:00:00Z', 'fake/zone'));
});
test('metrics derive exact totals and cap only the ring', () => {
  assert.deepEqual(metrics([20, 15]), { total: '35', remaining: '65', progress: 0.35 });
  assert.deepEqual(metrics([100, 25]), { total: '125', remaining: '0', progress: 1 });
  assert.deepEqual(metrics([]), { total: '0', remaining: '100', progress: 0 });
});
