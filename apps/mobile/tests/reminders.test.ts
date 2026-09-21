import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseReminderTime, reminderPlan, reconcileReminders } from '../src/domain/reminders.ts';
import type { Reminder, ReminderAdapter } from '../src/domain/reminders.ts';

const settings = { enabled: true, hour: 18, minute: 0 };
const now = new Date('2026-03-07T20:00:00Z');
const zone = 'America/Los_Angeles';

test('reminders follow local wall time across DST and handle invalid times', () => {
  assert.deepEqual(parseReminderTime('09:05'), { hour: 9, minute: 5 });
  for (const value of ['25:00', '12:60', '9:00', 'bad', '-1:00']) assert.throws(() => parseReminderTime(value));
  const plan = reminderPlan(now, zone, settings, false);
  assert.equal(plan.length, 7); assert.equal(new Set(plan.map(row => row.id)).size, 7);
  assert.equal(plan[0].at, '2026-03-08T02:00:00.000Z');
  assert.equal(plan[1].at, '2026-03-09T01:00:00.000Z');
  assert.equal(reminderPlan(new Date('2026-03-08T08:00:00Z'), zone, { ...settings, hour: 2, minute: 30 }, false)[0].at, '2026-03-08T10:30:00.000Z');
  assert.equal(reminderPlan(new Date('2026-11-01T07:00:00Z'), zone, { ...settings, hour: 1, minute: 30 }, false)[0].at, '2026-11-01T08:30:00.000Z');
});

// Unit-only OS stand-in. These tests do not claim notification delivery or permission UI.
function system() {
  const scheduled = new Map<string, Reminder>();
  const cancelled: string[] = [];
  let allowed = true, failAfter = Infinity, calls = 0;
  const adapter: ReminderAdapter = {
    permission: async () => allowed,
    list: async () => [...scheduled.values()],
    cancel: async id => { cancelled.push(id); scheduled.delete(id); },
    schedule: async reminder => { if (++calls > failAfter) throw new Error('OS scheduling failed'); scheduled.set(reminder.id, reminder); },
  };
  return { adapter, scheduled, cancelled, deny: () => { allowed = false; }, fail: (after: number) => { failAfter = after; calls = 0; } };
}

test('reconciliation is idempotent and cancels today on goal completion', async () => {
  const os = system();
  await reconcileReminders(os.adapter, settings, now, zone, false);
  await reconcileReminders(os.adapter, settings, now, zone, false);
  assert.equal(os.scheduled.size, 7); assert.equal(os.cancelled.length, 0);
  await reconcileReminders(os.adapter, settings, now, zone, true);
  assert.deepEqual(os.cancelled, ['pushupclub.reminder.2026-03-07']);
  assert.equal(os.scheduled.size, 7);
});

test('denied permission cancels reminders; disabling never requests permission', async () => {
  const os = system();
  await reconcileReminders(os.adapter, settings, now, zone, false);
  os.deny();
  assert.equal(await reconcileReminders(os.adapter, settings, now, zone, false), 'denied');
  assert.equal(os.scheduled.size, 0);
  os.adapter.permission = async () => { throw new Error('Do not ask permission while disabled'); };
  assert.equal(await reconcileReminders(os.adapter, { ...settings, enabled: false }, now, zone, false), 'off');
});

test('partial scheduling failure resumes without duplicates; time change replaces old alarms', async () => {
  const os = system(); os.fail(2);
  await assert.rejects(reconcileReminders(os.adapter, settings, now, zone, false));
  assert.equal(os.scheduled.size, 2);
  os.fail(Infinity);
  await reconcileReminders(os.adapter, settings, now, zone, false);
  assert.equal(os.scheduled.size, 7);
  await reconcileReminders(os.adapter, { ...settings, hour: 19 }, now, zone, false);
  assert.equal(os.scheduled.size, 7); assert.equal(os.cancelled.length, 7);
});
