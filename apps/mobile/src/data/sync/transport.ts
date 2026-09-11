import { accepted, ownCheckin, ownProfile, pullPage, SyncFailure } from './protocol.ts';
import type { CheckinMutation, MutationAccepted, PullPage } from './protocol.ts';
import type { OwnProfile, ProfileMutation } from '../../../../../contracts/domain.ts';
import { blockPage, safetyReceipt } from '../safety.ts';
import type { SafetyRequest, SafetyReceipt, BlockPage } from '../safety.ts';
import { circleList, circleResponse, circleReceipt, inviteList, invitePreview } from '../circles.ts';
import type { CircleRequest, CircleReceipt } from '../circles.ts';

export interface SyncTransport {
  mutate(input: CheckinMutation, signal: AbortSignal): Promise<MutationAccepted>;
  pull(after: string, signal: AbortSignal): Promise<PullPage>;
  getProfile?(signal: AbortSignal): Promise<OwnProfile>;
  updateProfile?(input: ProfileMutation, signal: AbortSignal): Promise<OwnProfile>;
  safety?(input: SafetyRequest, signal: AbortSignal): Promise<SafetyReceipt>;
  circle?(input: CircleRequest, signal: AbortSignal): Promise<CircleReceipt>;
}
export interface AccountLease {
  userId: string;
  valid(): boolean;
  token(refresh: boolean): Promise<string | null>;
}
export class HttpSyncTransport implements SyncTransport {
  readonly url: string; readonly key: string; readonly lease: AccountLease;
  constructor(url: string, key: string, lease: AccountLease) { this.url = url.replace(/\/$/, ''); this.key = key; this.lease = lease; }
  private async post(operation: string, body: unknown, signal: AbortSignal): Promise<unknown> {
    for (let attempt = 0; attempt < 2; attempt++) {
      if (!this.lease.valid() || signal.aborted) throw new SyncFailure('STALE_SCOPE');
      const token = await this.lease.token(attempt === 1);
      if (!this.lease.valid() || signal.aborted) throw new SyncFailure('STALE_SCOPE');
      if (!token) throw new SyncFailure('UNAUTHENTICATED', { status: 401 });
      const controller = new AbortController(), abort = () => controller.abort();
      signal.addEventListener('abort', abort, { once: true });
      const timeout = setTimeout(abort, 15000);
      try {
        const response = await fetch(this.url + '/rest/v1/rpc/' + operation, { method: 'POST', headers: { apikey: this.key, Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: controller.signal });
        if (!this.lease.valid() || signal.aborted) throw new SyncFailure('STALE_SCOPE');
        if (response.status === 401 && attempt === 0) continue;
        const text = await response.text();
        if (text.length > 1000000) throw new SyncFailure('PROTOCOL');
        let value: Record<string, unknown>;
        try { value = JSON.parse(text); } catch { throw new SyncFailure(response.status >= 500 ? 'SERVER_RETRY' : 'PROTOCOL', { status: response.status, retryable: response.status >= 500 }); }
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new SyncFailure('PROTOCOL');
        if (response.ok) return value;
        const suppliedCode = typeof value.code === 'string' && /^[A-Z_]{1,50}$/.test(value.code) ? value.code : null;
        if (!suppliedCode && response.status < 500 && ![401, 403, 429].includes(response.status)) throw new SyncFailure('PROTOCOL');
        const code = response.status === 401 ? 'UNAUTHENTICATED' : response.status === 403 ? (suppliedCode === 'PARTICIPATION_REQUIRED' ? suppliedCode : 'ACCOUNT_UNAVAILABLE') : suppliedCode ?? 'SERVER_RETRY';
        const retryAfter = response.headers.get('retry-after');
        const retryAfterMs = retryAfter && /^\d+$/.test(retryAfter) ? Number(retryAfter) * 1000 : 0;
        if (!Number.isFinite(retryAfterMs) || retryAfterMs > 2147483647) throw new SyncFailure('PROTOCOL');
        let record, profile;
        try { record = value.current_record ? ownCheckin(value.current_record) : undefined; profile = value.profile ? ownProfile(value.profile) : undefined; } catch { throw new SyncFailure('PROTOCOL'); }
        if (['VERSION_CONFLICT', 'ENTITY_EXISTS'].includes(code) && !record) throw new SyncFailure('PROTOCOL');
        throw new SyncFailure(code, { status: response.status, retryable: response.status === 429 || response.status >= 500, record, profile,
          retryAfterMs });
      } catch (error) {
        if (error instanceof SyncFailure) throw error;
        if (!this.lease.valid() || signal.aborted) throw new SyncFailure('STALE_SCOPE');
        throw new SyncFailure('NETWORK', { retryable: true });
      } finally { clearTimeout(timeout); signal.removeEventListener('abort', abort); }
    }
    throw new SyncFailure('UNAUTHENTICATED', { status: 401 });
  }
  async mutate(input: CheckinMutation, signal: AbortSignal): Promise<MutationAccepted> {
    const data = await this.post('mutate_checkin', { envelope: input }, signal);
    try { return accepted(data, input.checkin_id); } catch { throw new SyncFailure('PROTOCOL'); }
  }
  async circle(input: CircleRequest, signal: AbortSignal): Promise<CircleReceipt> { return circleReceipt(await this.post(input.operation, { envelope: input.envelope }, signal), input); }
  async circles(signal: AbortSignal) { return circleList(await this.post('list_circles', {}, signal)); }
  async circleToday(id: string, signal: AbortSignal) { return circleResponse(await this.post('read_circle_today', { circle_id: id }, signal), id); }
  async circleInvites(id: string, signal: AbortSignal) { return inviteList(await this.post('list_circle_invites', { circle_id: id }, signal)); }
  async previewInvite(code: string, signal: AbortSignal) { return invitePreview(await this.post('preview_invite', { code }, signal)); }
  async pull(after: string, signal: AbortSignal): Promise<PullPage> {
    const data = await this.post('pull_changes', { after_revision: after, limit: 100 }, signal);
    try { return pullPage(data, after); } catch { throw new SyncFailure('PROTOCOL'); }
  }
  async getProfile(signal: AbortSignal): Promise<OwnProfile> {
    const data = await this.post('get_profile', {}, signal) as { profile: unknown };
    try { return ownProfile(data.profile); } catch { throw new SyncFailure('PROTOCOL'); }
  }
  async safety(input: SafetyRequest, signal: AbortSignal): Promise<SafetyReceipt> {
    const data = await this.post(input.operation, { envelope: input.envelope }, signal);
    try { return safetyReceipt(data, input); } catch { throw new SyncFailure('PROTOCOL'); }
  }
  async listBlocks(after: string | null, signal: AbortSignal): Promise<BlockPage> {
    const data = await this.post('list_blocks', { after_actor: after, limit: 25 }, signal);
    try { return blockPage(data, after); } catch { throw new SyncFailure('PROTOCOL'); }
  }
  async updateProfile(input: ProfileMutation, signal: AbortSignal): Promise<OwnProfile> {
    const data = await this.post('update_profile', { envelope: input }, signal) as { profile: unknown };
    try {
      const profile = ownProfile(data.profile);
      if ((input.alias !== undefined && profile.alias !== input.alias.trim()) || (input.public_enabled !== undefined && profile.public_enabled !== input.public_enabled)
        || (input.region_id !== undefined && profile.region_id !== (input.region_id === 'world' ? null : input.region_id))
        || (input.accepted_terms_version !== undefined && profile.participation_terms_version !== input.accepted_terms_version)) throw new Error('Unexpected profile receipt.');
      return profile;
    } catch { throw new SyncFailure('PROTOCOL'); }
  }
}
