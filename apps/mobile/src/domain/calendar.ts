import { localDate } from './checkin.ts';

export function calendarDate(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) !== value) throw new Error('Invalid calendar date.');
  return value;
}
export function shiftDate(date: string, days: number): string {
  const result = new Date(calendarDate(date) + 'T00:00:00Z');
  result.setUTCDate(result.getUTCDate() + days);
  return result.toISOString().slice(0, 10);
}
export function nextDayDelay(now: Date, timezone: string): number {
  const today = localDate(now.toISOString(), timezone);
  let lower = now.getTime(), upper = lower + 36 * 60 * 60 * 1000;
  while (upper - lower > 1) {
    const middle = Math.floor((lower + upper) / 2);
    if (localDate(new Date(middle).toISOString(), timezone) === today) lower = middle;
    else upper = middle;
  }
  return upper - now.getTime();
}

export function watchDay(options: { now: () => Date; timezone: () => string; schedule: (callback: () => void, delay: number) => unknown; cancel: (handle: unknown) => void; onChange: () => void }) {
  const stamp = () => `${localDate(options.now().toISOString(), options.timezone())}|${options.timezone()}`;
  let previous = stamp(), stopped = false, handle: unknown;
  const schedule = () => { handle = options.schedule(tick, Math.min(60_000, Math.max(1, nextDayDelay(options.now(), options.timezone())))); };
  const tick = () => {
    if (stopped) return;
    const current = stamp();
    if (current !== previous) { previous = current; options.onChange(); }
    schedule();
  };
  schedule();
  return () => { stopped = true; options.cancel(handle); };
}
