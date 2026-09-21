import { localDate } from './checkin.ts';
import { shiftDate } from './calendar.ts';

export interface ReminderSettings { enabled: boolean; hour: number; minute: number }
export interface Reminder { id: string; at: string }
export function parseReminderTime(value: string): { hour: number; minute: number } {
  const match = /^(\d{2}):(\d{2})$/.exec(value.trim());
  if (!match || Number(match[1]) > 23 || Number(match[2]) > 59) throw new Error('Use a time from 00:00 to 23:59.');
  return { hour: Number(match[1]), minute: Number(match[2]) };
}

export function wallClock(date: string, hour: number, minute: number, zone: string): Date {
  const [year, month, day] = date.split('-').map(Number);
  const target = Date.UTC(year, month - 1, day, hour, minute);
  let candidate = target;
  const attempts: number[] = [];
  const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  for (let step = 0; step < 5; step++) {
    attempts.push(candidate);
    const parts = formatter.formatToParts(new Date(candidate));
    const value = (type: string) => Number(parts.find(part => part.type === type)!.value);
    const represented = Date.UTC(value('year'), value('month') - 1, value('day'), value('hour'), value('minute'));
    if (represented === target) return new Date(candidate);
    candidate += target - represented;
  }
  // A nonexistent spring-forward wall time moves forward across the gap.
  return new Date(Math.max(...attempts.slice(-2)));
}

export function reminderPlan(now: Date, timezone: string, settings: ReminderSettings, goalReached: boolean): Reminder[] {
  if (!settings.enabled) return [];
  if (!Number.isInteger(settings.hour) || !Number.isInteger(settings.minute) || settings.hour < 0 || settings.hour > 23 || settings.minute < 0 || settings.minute > 59) throw new Error('Invalid reminder time.');
  const today = localDate(now.toISOString(), timezone), result: Reminder[] = [];
  for (let offset = 0; offset <= 7 && result.length < 7; offset++) {
    if (offset === 0 && goalReached) continue;
    const date = shiftDate(today, offset);
    const at = wallClock(date, settings.hour, settings.minute, timezone);
    if (at > now) result.push({ id: `pushupclub.reminder.${date}`, at: at.toISOString() });
  }
  return result;
}

export interface ReminderAdapter {
  list: () => Promise<Reminder[]>;
  permission: () => Promise<boolean>;
  cancel: (id: string) => Promise<void>;
  schedule: (reminder: Reminder) => Promise<void>;
}

export async function reconcileReminders(adapter: ReminderAdapter, settings: ReminderSettings, now: Date, zone: string, goalReached: boolean) {
  const allowed = settings.enabled && await adapter.permission();
  const plan = allowed ? reminderPlan(now, zone, settings, goalReached) : [];
  const current = await adapter.list();
  const desired = new Map(plan.map(reminder => [reminder.id, reminder.at]));
  const retained = new Set<string>();
  for (const reminder of current) {
    if (desired.get(reminder.id) !== reminder.at) await adapter.cancel(reminder.id);
    else retained.add(reminder.id);
  }
  for (const reminder of plan) if (!retained.has(reminder.id)) await adapter.schedule(reminder);
  return !settings.enabled ? 'off' : allowed ? 'scheduled' : 'denied';
}
