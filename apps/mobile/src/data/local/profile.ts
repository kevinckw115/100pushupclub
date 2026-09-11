import type { LocalRepository } from './repository.ts';
import type { OwnProfile, ProfileMutation } from '../../../../../contracts/domain.ts';
import { ownProfile, decimal, SyncFailure } from '../sync/protocol.ts';
import { uuid } from '../../domain/checkin.ts';
export type { OwnProfile, ProfileMutation } from '../../../../../contracts/domain.ts';
export interface PendingProfile { request: ProfileMutation; state: 'pending' | 'sending' | 'rejected'; code?: string; retryAt?: number; retryDelay?: number }
export class ProfileRepository {
  readonly local: LocalRepository; readonly account: string;
  constructor(local: LocalRepository, account: string) { this.local = local; this.account = account; }
  private active() { const p = this.local.activePartition(); if (p?.id !== this.account || p.kind !== 'account') throw new SyncFailure('STALE_SCOPE'); }
  cached(): OwnProfile | null {
    this.active(); const value = this.local.preference(this.account, 'account_profile');
    try { return value ? ownProfile(JSON.parse(value)) : null; } catch { return null; }
  }
  pending(): PendingProfile | null {
    this.active(); const value = this.local.preference(this.account, 'pending_profile'); return value ? JSON.parse(value) : null;
  }
  store(profile: OwnProfile): boolean {
    this.active(); const serialized = JSON.stringify(ownProfile(profile));
    if (serialized === this.local.preference(this.account, 'account_profile')) return false;
    this.local.setPreference(this.account, 'account_profile', serialized); return true;
  }
  queue(fields: Omit<ProfileMutation, 'operation_id'>) {
    this.active();
    if (this.pending()) throw new Error('Resolve the pending account change first.');
    if (!this.cached()) throw new Error('Connect to load account settings first.');
    if (fields.alias !== undefined && !/^[A-Za-z0-9_]{3,20}$/.test(fields.alias.trim())) throw new Error('Use 3 to 20 letters, numbers or underscores for your alias.');
    if (fields.region_id !== undefined && fields.region_id !== null && !/^gn:[1-9]\d{0,18}$/.test(fields.region_id)) throw new Error('Choose a region from the directory.');
    if (fields.region_id !== undefined || fields.public_enabled !== undefined) decimal(fields.expected_consent_epoch);
    if (fields.alias === undefined && fields.region_id === undefined && fields.public_enabled === undefined) throw new Error('There are no changes to save.');
    const request = { ...fields, ...(fields.alias !== undefined ? { alias: fields.alias.trim() } : {}), operation_id: uuid(this.local.makeId()) };
    this.local.setPreference(this.account, 'pending_profile', JSON.stringify({ request, state: 'pending' }));
  }
  sending(operationId: string) {
    const current = this.pending(); if (!current || current.request.operation_id !== operationId || current.state === 'rejected') throw new SyncFailure('STALE_SCOPE');
    this.local.setPreference(this.account, 'pending_profile', JSON.stringify({ ...current, state: 'sending' }));
  }
  accept(operationId: string, latest: OwnProfile) {
    this.local.db.transaction(() => {
      const pending = this.pending(); if (!pending || pending.request.operation_id !== operationId) throw new SyncFailure('STALE_SCOPE');
      this.store(latest); this.local.setPreference(this.account, 'pending_profile', '');
      this.local.setPreference(this.account, 'profile_ack', operationId);
    });
  }
  reject(operationId: string, code: string, profile?: OwnProfile) {
    this.local.db.transaction(() => {
      const pending = this.pending(); if (!pending || pending.request.operation_id !== operationId) throw new SyncFailure('STALE_SCOPE');
      if (profile) this.store(profile);
      this.local.setPreference(this.account, 'pending_profile', JSON.stringify({ ...pending, state: 'rejected', code }));
    });
  }
  discardRejected() {
    const pending = this.pending(); if (pending?.state !== 'rejected') throw new Error('This change may already have reached the server. Retry to confirm it.');
    this.local.setPreference(this.account, 'pending_profile', '');
  }
  retryDelay(now: number): number {
    const pending = this.pending(); if (!pending?.retryAt || pending.state === 'rejected') return 0;
    if (pending.retryAt - now > (pending.retryDelay ?? 0) + 1000) {
      pending.retryAt = now + (pending.retryDelay ?? 0); this.local.setPreference(this.account, 'pending_profile', JSON.stringify(pending));
    }
    return Math.max(0, pending.retryAt - now);
  }
  defer(now: number, delay: number) {
    const pending = this.pending(); if (pending && pending.state !== 'rejected') this.local.setPreference(this.account, 'pending_profile', JSON.stringify({ ...pending, retryAt: now + delay, retryDelay: delay }));
  }
  clearRetry() { const pending = this.pending(); if (pending) this.local.setPreference(this.account, 'pending_profile', JSON.stringify({ ...pending, retryAt: 0 })); }
  publicEpoch(): string | null { const profile = this.cached(); return !this.pending() && profile?.status === 'active' && profile.public_enabled ? profile.consent_epoch : null; }
}
