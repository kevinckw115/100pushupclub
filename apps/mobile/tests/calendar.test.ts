import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nextDayDelay, shiftDate, watchDay } from '../src/domain/calendar.ts';

test('next midnight honors short and long LA daylight-saving days', () => {
  assert.equal(nextDayDelay(new Date('2026-03-08T08:00:00Z'), 'America/Los_Angeles'), 23 * 60 * 60 * 1000);
  assert.equal(nextDayDelay(new Date('2026-11-01T07:00:00Z'), 'America/Los_Angeles'), 25 * 60 * 60 * 1000);
  assert.equal(nextDayDelay(new Date('2026-09-11T06:59:59Z'), 'America/Los_Angeles'), 1000);
  assert.equal(shiftDate('2024-03-01', -1), '2024-02-29');
});
test('watcher refreshes at midnight and travel, and cancellation stops updates', () => {
  let now = new Date('2026-09-11T06:59:59Z'), zone = 'America/Los_Angeles', changes = 0;
  let callback: () => void = () => { throw new Error('No timer scheduled'); };
  let delay = 0, cancelled = false;
  const stop = watchDay({ now: () => now, timezone: () => zone, schedule: (fn, ms) => { callback = fn; delay = ms; return 1; }, cancel: () => { cancelled = true; }, onChange: () => changes++ });
  assert.equal(delay, 1000);
  now = new Date('2026-09-11T07:00:00Z'); callback(); assert.equal(changes, 1);
  zone = 'Asia/Tokyo'; callback(); assert.equal(changes, 2);
  stop(); callback(); assert.equal(changes, 2); assert.equal(cancelled, true);
});
