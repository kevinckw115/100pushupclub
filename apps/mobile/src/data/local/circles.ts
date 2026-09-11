import type { LocalRepository } from './repository.ts';
import { circleRequest, circleReceipt } from '../circles.ts';
import type { CircleRequest, CircleReceipt } from '../circles.ts';
import { SyncFailure } from '../sync/protocol.ts';
export interface PendingCircle { request: CircleRequest; state: 'pending' | 'sending' | 'rejected'; code?: string; retryAt?: number; retryDelay?: number }
export class CircleRepository {
  readonly local: LocalRepository; readonly account: string;
  constructor(local: LocalRepository, account: string) { this.local = local; this.account = account; }
  private active() { const p = this.local.activePartition(); if (p?.id !== this.account || p.kind !== 'account') throw new SyncFailure('STALE_SCOPE'); }
  pending(): PendingCircle | null { this.active(); const v = this.local.preference(this.account, 'pending_circle'); return v ? JSON.parse(v) : null; }
  private write(v: PendingCircle | null) { this.active(); this.local.setPreference(this.account, 'pending_circle', v ? JSON.stringify(v) : ''); }
  queue(operation: CircleRequest['operation'], fields: object) {
    if (this.pending()) throw new Error('Resolve your pending circle request first.');
    this.write({ request: circleRequest(operation, { ...fields, operation_id: this.local.makeId() }), state: 'pending' });
  }
  private matching(id: string) { const p = this.pending(); if (!p || p.request.envelope.operation_id !== id) throw new SyncFailure('STALE_SCOPE'); return p; }
  sending(id: string) { const p = this.matching(id); if (p.state === 'rejected') throw new SyncFailure('STALE_SCOPE'); this.write({ ...p, state: 'sending' }); }
  accept(id: string, receipt: CircleReceipt) {
    this.local.db.transaction(() => { const p = this.matching(id), checked = circleReceipt(receipt, p.request);
      this.local.setPreference(this.account, 'circle_receipt', JSON.stringify({ operation: p.request.operation, receipt: checked })); this.write(null);
    });
  }
  last(): { operation: CircleRequest['operation']; receipt: CircleReceipt } | null { this.active(); const v = this.local.preference(this.account, 'circle_receipt'); return v ? JSON.parse(v) : null; }
  reject(id: string, code: string) { this.write({ ...this.matching(id), state: 'rejected', code }); }
  discardRejected() { if (this.pending()?.state !== 'rejected') throw new Error('This request may have reached the server. Retry to confirm it.'); this.write(null); }
  defer(id: string, now: number, delay: number, code: string) { this.write({ ...this.matching(id), retryAt: now + delay, retryDelay: delay, code }); }
  retryDelay(now: number) { const p = this.pending(); if (!p?.retryAt || p.state === 'rejected') return 0; if (p.retryAt - now > (p.retryDelay ?? 0) + 1000) { p.retryAt = now + (p.retryDelay ?? 0); this.write(p); } return Math.max(0, p.retryAt - now); }
  clearNetworkRetry() { const p = this.pending(); if (p?.code === 'NETWORK') this.write({ ...p, retryAt: 0 }); }
}
