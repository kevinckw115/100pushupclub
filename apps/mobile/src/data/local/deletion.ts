import type { LocalRepository } from './repository.ts';
import { uuid } from '../../domain/checkin.ts';
import { deletionStatus } from '../account-privacy.ts';
import type { AccountDeletionStatus, RequestAccountDeletion } from '../account-privacy.ts';
export interface LocalDeletion { accountId: string; request: RequestAccountDeletion; phase: 'pending' | 'rejected' | 'acknowledged' | 'complete'; status?: AccountDeletionStatus; error?: string }
export class DeletionRepository {
  readonly local: LocalRepository;
  constructor(local: LocalRepository) { this.local = local; }
  pending(): LocalDeletion | null { const v = this.local.preference('device', 'account_deletion'); return v ? JSON.parse(v) : null; }
  private write(v: LocalDeletion | null) { this.local.setPreference('device', 'account_deletion', v ? JSON.stringify(v) : ''); }
  begin(accountId: string, statusToken: string) {
    if (this.pending()) throw new Error('Resolve the existing deletion request first.');
    if (!/^d_[a-f0-9]{64}$/.test(statusToken)) throw new Error('Invalid deletion recovery proof.');
    const active = this.local.activePartition(); if (active?.kind === 'account' && active.id !== accountId) throw new Error('Delete only the account currently signed in.');
    this.write({ accountId: uuid(accountId), request: { operation_id: uuid(this.local.makeId()), status_token: statusToken, confirm_delete: true }, phase: 'pending' });
  }
  reject(code: string) { const p = this.pending(); if (!p || !['pending', 'rejected'].includes(p.phase)) throw new Error('Deletion state changed.'); this.write({ ...p, phase: 'rejected', error: code }); }
  retry() { const p = this.pending(); if (p?.phase === 'rejected') this.write({ ...p, phase: 'pending', error: undefined }); }
  acknowledge(operationId: string, value: AccountDeletionStatus) {
    this.local.db.transaction(() => {
      const p = this.pending(); if (!p || p.request.operation_id !== operationId) throw new Error('Deletion request changed.'); const status = deletionStatus(value);
      if (p.status && p.status.job_id !== status.job_id) throw new Error('Deletion response mismatch.');
      this.write({ ...p, phase: status.status === 'complete' ? 'complete' : 'acknowledged', status, error: undefined });
      const active = this.local.activePartition();
      if (active?.id === p.accountId || (active?.kind !== 'account' && ['pending', 'rejected'].includes(p.phase))) {
        this.local.setPreference('device', 'pending_logout', JSON.stringify({ id: p.accountId, discard: true }));
        this.local.setPreference('device', 'reminders', JSON.stringify({ enabled: false, hour: 18, minute: 0 }));
      }
      this.local.db.run('DELETE FROM guest_imports WHERE account_partition=?', p.accountId);
    });
  }
  dismiss() { const p = this.pending(); if (p?.phase !== 'rejected' && p?.phase !== 'complete') throw new Error('Confirm the request status before removing its recovery proof.'); this.write(null); }
}
