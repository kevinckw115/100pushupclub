import type { ClubPage, PublicFeedRow } from '../../../../contracts/domain.ts';
import { decimal, SyncFailure } from './sync/protocol.ts';
import type { AccountLease } from './sync/transport.ts';
export type { ClubPage, PublicFeedRow } from '../../../../contracts/domain.ts';
export const isScope = (value: unknown): value is string => typeof value === 'string' && /^(world|gn:[1-9]\d{0,18})$/.test(value);
export function clubPage(value: unknown, scope: string): ClubPage {
  const p = value as ClubPage;
  if (!p || p.requested_scope !== scope || typeof p.request_id !== 'string' || p.request_id.length > 100
    || !isScope(p.effective_scope?.id) || typeof p.effective_scope.label !== 'string' || !p.effective_scope.label || p.effective_scope.label.length > 1200
    || ![null, 'SPARSE_REGION', 'NO_REGION'].includes(p.fallback_reason) || p.window?.label !== 'past 24 hours'
    || typeof p.window.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(p.window.as_of) || !Number.isFinite(Date.parse(p.window.as_of))
    || !Number.isSafeInteger(p.people_past_hour) || p.people_past_hour < 0 || !Array.isArray(p.items) || p.items.length > 50
    || (p.next_cursor !== null && (typeof p.next_cursor !== 'string' || !p.next_cursor || p.next_cursor.length > 16384))) throw new SyncFailure('PROTOCOL');
  const items = p.items.map((row): PublicFeedRow => {
    if (!row || !/^e_[a-f0-9]{32}$/.test(row.id) || !/^a_[a-f0-9]{32}$/.test(row.actor_id)
      || !/^[A-Za-z0-9_]{3,20}$/.test(row.username) || !Number.isInteger(row.quantity) || row.quantity < 1 || row.quantity > 999
      || !/^(just now|[1-5]?[0-9]m ago|(?:[1-9]|1[0-9]|2[0-4])h ago)$/.test(row.relative_time)) throw new SyncFailure('PROTOCOL');
    return { id: row.id, actor_id: row.actor_id, username: row.username, quantity: row.quantity, relative_time: row.relative_time };
  });
  if (new Set(items.map(row => row.id)).size !== items.length || (p.next_cursor && !items.length)) throw new SyncFailure('PROTOCOL');
  return { request_id: p.request_id, requested_scope: scope, effective_scope: { id: p.effective_scope.id, label: p.effective_scope.label }, fallback_reason: p.fallback_reason,
    window: { label: 'past 24 hours', as_of: p.window.as_of }, people_past_hour: p.people_past_hour, pushups_past_24_hours: decimal(p.pushups_past_24_hours), items, next_cursor: p.next_cursor };
}
export interface ClubTransport { read(scope: string, cursor: string | null, signal: AbortSignal): Promise<ClubPage> }
export class HttpClubTransport implements ClubTransport {
  readonly url: string; readonly key: string; readonly lease: AccountLease | null; readonly valid: () => boolean;
  constructor(url: string, key: string, lease: AccountLease | null, valid: () => boolean) { this.url = url; this.key = key; this.lease = lease; this.valid = valid; }
  async read(scope: string, cursor: string | null, signal: AbortSignal): Promise<ClubPage> {
    for (let attempt = 0; attempt < 2; attempt++) {
      if (!this.valid() || signal.aborted) throw new SyncFailure('STALE_SCOPE');
      const token = this.lease ? await this.lease.token(attempt === 1) : null;
      if (!this.valid() || signal.aborted) throw new SyncFailure('STALE_SCOPE');
      if (this.lease && !token) throw new SyncFailure('UNAUTHENTICATED', { status: 401 });
      const controller = new AbortController(), abort = () => controller.abort();
      signal.addEventListener('abort', abort, { once: true }); const timer = setTimeout(abort, 15000);
      try {
        const response = await fetch(this.url + '/rest/v1/rpc/read_club', { method: 'POST', headers: { apikey: this.key, 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: JSON.stringify({ scope_id: scope, cursor, limit: 25 }), signal: controller.signal });
        if (response.status === 401 && this.lease && attempt === 0) continue;
        const text = await response.text(); if (text.length > 100000) throw new SyncFailure('PROTOCOL');
        if (!this.valid() || signal.aborted) throw new SyncFailure('STALE_SCOPE');
        let value;
        try { value = JSON.parse(text); } catch { throw new SyncFailure(response.status >= 500 ? 'SERVER_RETRY' : 'PROTOCOL', { status: response.status, retryable: response.status >= 500 }); }
        if (response.ok) return clubPage(value, scope);
        const raw = response.headers.get('retry-after'), retryAfterMs = raw && /^\d+$/.test(raw) ? Number(raw) * 1000 : 0;
        if (!Number.isFinite(retryAfterMs) || retryAfterMs > 2147483647) throw new SyncFailure('PROTOCOL');
        const code = response.status === 401 ? 'UNAUTHENTICATED' : response.status === 403 ? 'ACCOUNT_UNAVAILABLE' : ['INVALID_CURSOR', 'INVALID_SCOPE', 'RATE_LIMITED'].includes(value?.code) ? value.code : 'SERVER_RETRY';
        throw new SyncFailure(code, { status: response.status, retryable: response.status === 429 || response.status >= 500, retryAfterMs });
      } catch (error) {
        if (error instanceof SyncFailure) throw error;
        if (!this.valid() || signal.aborted) throw new SyncFailure('STALE_SCOPE');
        throw new SyncFailure('NETWORK', { retryable: true });
      } finally { clearTimeout(timer); signal.removeEventListener('abort', abort); }
    }
    throw new SyncFailure('UNAUTHENTICATED', { status: 401 });
  }
}
