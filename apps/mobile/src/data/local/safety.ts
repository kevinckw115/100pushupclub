import type { LocalRepository } from './repository.ts';
import { safetyRequest, safetyReceipt } from '../safety.ts';
import type { SafetyRequest, SafetyReceipt, SafetyOperation, BlockMutation, ReportMutation } from '../safety.ts';
import { SyncFailure } from '../sync/protocol.ts';
export interface PendingSafety { request: SafetyRequest; state: 'pending' | 'sending' | 'rejected'; code?: string; retryAt?: number; retryDelay?: number }
export class SafetyRepository {
  readonly local: LocalRepository; readonly account: string;
  constructor(local: LocalRepository, account: string) { this.local = local; this.account = account; }
  private active() { const p = this.local.activePartition(); if (p?.id !== this.account || p.kind !== 'account') throw new SyncFailure('STALE_SCOPE'); }
  all(): PendingSafety[] { this.active(); const value = this.local.preference(this.account, 'pending_safety'); if (!value) return []; const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed : [parsed]; }
  pending(): PendingSafety | null { const all = this.all(); return all.find(p => p.state !== 'rejected' && p.request.operation !== 'report_subject') ?? all.find(p => p.state !== 'rejected') ?? all[0] ?? null; }
  private find(operationId: string) { return this.all().find(p => p.request.envelope.operation_id === operationId) ?? null; }
  private save(all: PendingSafety[]) { this.active(); this.local.setPreference(this.account, 'pending_safety', all.length ? JSON.stringify(all) : ''); }
  private write(value: PendingSafety) { const all = this.all().filter(p => p.request.envelope.operation_id !== value.request.envelope.operation_id); this.save([...all, value]); }
  queue(operation: SafetyOperation, fields: Omit<BlockMutation, 'operation_id'> | Omit<ReportMutation, 'operation_id'>) {
    if (this.all().some(p => (p.request.operation === 'report_subject') === (operation === 'report_subject'))) throw new Error('Resolve the pending request of this kind first.');
    const request = safetyRequest(operation, { ...fields, operation_id: this.local.makeId() }); this.write({ request, state: 'pending' });
  }
  sending(operationId: string) {
    const p = this.find(operationId); if (!p || p.state === 'rejected') throw new SyncFailure('STALE_SCOPE');
    this.write({ ...p, state: 'sending' });
  }
  accept(operationId: string, receipt: SafetyReceipt) {
    this.local.db.transaction(() => {
      const p = this.find(operationId); if (!p) throw new SyncFailure('STALE_SCOPE');
      const result = safetyReceipt(receipt, p.request);
      this.local.setPreference(this.account, 'safety_receipt', JSON.stringify({ operation: p.request.operation, receipt: result }));
      this.save(this.all().filter(p => p.request.envelope.operation_id !== operationId));
    });
  }
  reject(operationId: string, code: string) { const p = this.find(operationId); if (!p) throw new SyncFailure('STALE_SCOPE'); this.write({ ...p, state: 'rejected', code }); }
  discardRejected(operationId = this.pending()?.request.envelope.operation_id) { const p = operationId ? this.find(operationId) : null; if (p?.state !== 'rejected') throw new Error('This request may have reached the server. Retry to confirm it.'); this.save(this.all().filter(p => p.request.envelope.operation_id !== operationId)); }
  defer(operationId: string, now: number, delay: number, code: string) { const p = this.find(operationId); if (p && p.state !== 'rejected') this.write({ ...p, retryAt: now + delay, retryDelay: delay, code }); }
  retryDelay(now: number, operationId = this.pending()?.request.envelope.operation_id) {
    const p = operationId ? this.find(operationId) : null; if (!p?.retryAt || p.state === 'rejected') return 0;
    if (p.retryAt - now > (p.retryDelay ?? 0) + 1000) { p.retryAt = now + (p.retryDelay ?? 0); this.write(p); }
    return Math.max(0, p.retryAt - now);
  }
  clearRetry() { this.save(this.all().map(p => p.code === 'NETWORK' ? { ...p, retryAt: 0 } : p)); }
}
