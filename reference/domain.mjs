/**
 * Executable specification examples only. No persistence, authentication,
 * authorization, privacy projection or concurrent database behavior is provided.
 * Port/adapt pure rules; implement and test production adapters separately.
 */
import { createHash } from 'node:crypto';

export function parseQuantity(value) {
  if (typeof value === 'string') {
    if (!/^\d+$/.test(value.trim())) throw new Error('INVALID_QUANTITY');
    value = Number(value.trim());
  }
  if (!Number.isSafeInteger(value) || value < 1 || value > 999) {
    throw new Error('INVALID_QUANTITY');
  }
  return value;
}

export function canonicalInstant(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/.test(value)) {
    throw new Error('INVALID_TIMESTAMP');
  }
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error('INVALID_TIMESTAMP');
  const canonical = date.toISOString();
  if (canonical !== value.replace(/(?<!\.\d{3})Z$/, '.000Z')) throw new Error('INVALID_TIMESTAMP');
  return canonical;
}

export function localDateAt(instant, timezone) {
  if (typeof timezone !== 'string' || !timezone.trim()) throw new Error('INVALID_TIMEZONE');
  const date = new Date(canonicalInstant(instant));
  let formatter;
  try {
    formatter = new Intl.DateTimeFormat('en-US-u-ca-gregory-nu-latn', {
      timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit'
    });
  } catch { throw new Error('INVALID_TIMEZONE'); }
  const fields = Object.fromEntries(formatter.formatToParts(date).map(p => [p.type, p.value]));
  return `${fields.year}-${fields.month}-${fields.day}`;
}

export function dayMetrics(records, day) {
  const active = records.filter(r => r.local_date === day && !r.deleted_at);
  const total = active.reduce((sum, r) => sum + BigInt(parseQuantity(r.quantity)), 0n);
  return {
    total: total.toString(),
    remaining: Number(total < 100n ? 100n - total : 0n),
    progress: Number(total < 100n ? total : 100n) / 100,
    achieved: total >= 100n,
    active: total > 0n
  };
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function validateEnvelope(input) {
  if (!uuid.test(input.mutation_id) || !uuid.test(input.checkin_id)) throw new Error('INVALID_ID');
  const common = { kind: input.kind, mutation_id: input.mutation_id.toLowerCase(), checkin_id: input.checkin_id.toLowerCase() };
  if (input.kind === 'create') {
    const occurred_at = canonicalInstant(input.occurred_at);
    if (localDateAt(occurred_at, input.recorded_timezone) !== input.local_date) throw new Error('INVALID_LOCAL_DATE');
    if (!['native', 'import'].includes(input.source)) throw new Error('INVALID_SOURCE');
    if (input.requested_public_epoch !== null && !/^(0|[1-9]\d*)$/.test(input.requested_public_epoch ?? '')) throw new Error('INVALID_EPOCH');
    return { ...common, quantity: parseQuantity(input.quantity), occurred_at,
      recorded_timezone: input.recorded_timezone, local_date: input.local_date,
      source: input.source, requested_public_epoch: input.requested_public_epoch };
  }
  if (!['update', 'delete'].includes(input.kind)) throw new Error('INVALID_KIND');
  if (!Number.isSafeInteger(input.expected_version) || input.expected_version < 1) throw new Error('INVALID_VERSION');
  return input.kind === 'update'
    ? { ...common, quantity: parseQuantity(input.quantity), expected_version: input.expected_version }
    : { ...common, expected_version: input.expected_version };
}

export class ReferenceLedger {
  #records = new Map();
  #receipts = new Map();
  #revisions = new Map();
  #changes = new Map();

  // actor is a trusted test identity, NOT an example of accepting owner IDs over an API.
  apply(actor, input, now = '2026-09-10T18:00:00Z') {
    const mutation = validateEnvelope(input);
    const hash = createHash('sha256').update(JSON.stringify(mutation)).digest('hex');
    const receiptKey = `${actor}/${mutation.mutation_id}`;
    const receipt = this.#receipts.get(receiptKey);
    if (receipt) {
      if (receipt.hash !== hash) throw new Error('IDEMPOTENCY_KEY_REUSED');
      return structuredClone(receipt.result);
    }
    const serverNow = canonicalInstant(now);
    const existing = this.#records.get(mutation.checkin_id);
    if (existing && existing.actor !== actor) throw new Error('NOT_FOUND_OR_FORBIDDEN');
    let record;
    if (mutation.kind === 'create') {
      if (existing) throw new Error('ENTITY_EXISTS');
      if (Date.parse(mutation.occurred_at) > Date.parse(serverNow) + 300000) throw new Error('CLOCK_AHEAD');
      record = { id: mutation.checkin_id, quantity: mutation.quantity,
        occurred_at: mutation.occurred_at, recorded_timezone: mutation.recorded_timezone,
        local_date: mutation.local_date, source: mutation.source,
        created_at: serverNow, updated_at: serverNow, deleted_at: null,
        version: 1, public_epoch: null, public_region_id: null };
    } else {
      if (!existing) throw new Error('NOT_FOUND_OR_FORBIDDEN');
      if (existing.record.deleted_at || existing.record.version !== mutation.expected_version) throw new Error('VERSION_CONFLICT');
      record = { ...existing.record, updated_at: serverNow, version: existing.record.version + 1 };
      if (mutation.kind === 'update') record.quantity = mutation.quantity;
      else record.deleted_at = serverNow;
    }
    const revision = (this.#revisions.get(actor) ?? 0n) + 1n;
    record.revision = revision.toString();
    const result = { record, revision: record.revision, effective_public: false };
    this.#records.set(record.id, { actor, record: structuredClone(record) });
    this.#revisions.set(actor, revision);
    const changes = this.#changes.get(actor) ?? [];
    changes.push(structuredClone(record));
    this.#changes.set(actor, changes);
    this.#receipts.set(receiptKey, { hash, result: structuredClone(result) });
    return structuredClone(result);
  }

  pull(actor, after = '0', limit = 100) {
    if (!/^(0|[1-9]\d*)$/.test(after) || !Number.isInteger(limit) || limit < 1 || limit > 500) throw new Error('INVALID_CURSOR');
    const remaining = (this.#changes.get(actor) ?? []).filter(r => BigInt(r.revision) > BigInt(after));
    const changes = remaining.slice(0, limit);
    return structuredClone({ changes, next_revision: changes.at(-1)?.revision ?? after, has_more: remaining.length > limit });
  }
}
