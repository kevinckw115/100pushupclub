export function quantity(value: unknown): number {
  if (typeof value !== 'string' && typeof value !== 'number') throw new Error('Enter a whole number from 1 to 999.');
  const input = String(value).trim();
  if (!/^\d+$/.test(input)) throw new Error('Enter a whole number from 1 to 999.');
  const parsed = Number(input);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 999) throw new Error('Enter a whole number from 1 to 999.');
  return parsed;
}

export function uuid(value: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) throw new Error('Invalid record identifier.');
  return value.toLowerCase();
}

export function instant(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/.test(value)) throw new Error('Invalid recorded time.');
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error('Invalid recorded time.');
  const canonical = date.toISOString();
  if (canonical !== value.replace(/(?<!\.\d{3})Z$/, '.000Z')) throw new Error('Invalid recorded time.');
  return canonical;
}

export function localDate(occurredAt: string, timezone: string): string {
  instant(occurredAt);
  if (!timezone || typeof timezone !== 'string') throw new Error('A recorded timezone is required.');
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(occurredAt));
  return ['year', 'month', 'day'].map(type => parts.find(part => part.type === type)!.value).join('-');
}

export function metrics(quantities: number[]) {
  const total = quantities.reduce((sum, n) => sum + BigInt(quantity(n)), 0n);
  return { total: String(total), remaining: String(total < 100n ? 100n - total : 0n), progress: total >= 100n ? 1 : Number(total) / 100 };
}
