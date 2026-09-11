import { instant, localDate, quantity, uuid } from '../../domain/checkin.ts';
import type { OwnCheckin, MutationAccepted, PullPage } from '../../../../../contracts/domain.ts';
export type { OwnCheckin, MutationAccepted, PullPage, CheckinMutation } from '../../../../../contracts/domain.ts';

export function decimal(value: unknown): string {
  if (typeof value !== 'string' || !/^(0|[1-9]\d{0,18})$/.test(value) || BigInt(value) > 9223372036854775807n) throw new Error('Invalid revision.');
  return value;
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid response.');
  return value as Record<string, unknown>;
}
function string(value: unknown): string { if (typeof value !== 'string') throw new Error('Invalid response field.'); return value; }
export function ownCheckin(value: unknown): OwnCheckin {
  const row = object(value);
  if (typeof row.quantity !== 'number' || !Number.isInteger(row.version) || (row.version as number) < 1 || (row.version as number) > 2147483647) throw new Error('Invalid check-in version or quantity.');
  const time = instant(string(row.occurred_at)), zone = string(row.recorded_timezone);
  if (localDate(time, zone) !== row.local_date || !['native', 'import'].includes(string(row.source))) throw new Error('Invalid check-in identity.');
  if (decimal(row.revision) === '0' || (row.source === 'import' && (row.public_epoch !== null || row.public_region_id !== null))) throw new Error('Invalid accepted check-in.');
  return {
    id: uuid(string(row.id)), quantity: quantity(row.quantity), occurred_at: time,
    recorded_timezone: zone, local_date: string(row.local_date), source: row.source as OwnCheckin['source'],
    created_at: instant(string(row.created_at)), updated_at: instant(string(row.updated_at)),
    deleted_at: row.deleted_at === null ? null : instant(string(row.deleted_at)),
    version: row.version as number, revision: decimal(row.revision),
    public_epoch: row.public_epoch === null ? null : decimal(row.public_epoch),
    public_region_id: row.public_region_id === null ? null : string(row.public_region_id),
  };
}
export function accepted(value: unknown, id: string): MutationAccepted {
  const row = object(value), record = ownCheckin(row.record), revision = decimal(row.revision);
  if (record.id !== id || record.revision !== revision || typeof row.effective_public !== 'boolean') throw new Error('Unexpected mutation response.');
  return { request_id: uuid(string(row.request_id)), record, revision, effective_public: row.effective_public };
}
export function pullPage(value: unknown, after: string): PullPage {
  const row = object(value);
  if (!Array.isArray(row.changes) || row.changes.length > 500 || typeof row.has_more !== 'boolean') throw new Error('Invalid pull response.');
  const changes = row.changes.map(ownCheckin);
  let previous = BigInt(decimal(after));
  for (const item of changes) { if (BigInt(item.revision) <= previous) throw new Error('Unordered revisions.'); previous = BigInt(item.revision); }
  const next = decimal(row.next_revision);
  if (BigInt(next) !== previous || (row.has_more && !changes.length)) throw new Error('Invalid pull cursor.');
  return { request_id: uuid(string(row.request_id)), changes, next_revision: next, has_more: row.has_more };
}

export class SyncFailure extends Error {
  readonly code: string; readonly status: number; readonly retryable: boolean;
  readonly record?: OwnCheckin; readonly retryAfterMs: number;
  constructor(code: string, options: { status?: number; retryable?: boolean; record?: OwnCheckin; retryAfterMs?: number } = {}) {
    super(code); this.code = code; this.status = options.status ?? 0; this.retryable = options.retryable ?? false;
    this.record = options.record; this.retryAfterMs = options.retryAfterMs ?? 0;
  }
}
