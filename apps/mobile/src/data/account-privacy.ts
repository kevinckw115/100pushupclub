import { uuid } from '../domain/checkin.ts';
import { decimal, ownCheckin, ownProfile, SyncFailure } from './sync/protocol.ts';
import type { AccountDeletionStatus, AccountExportPage } from '../../../../contracts/domain.ts';
export type { AccountDeletionStatus, AccountExportPage, RequestAccountDeletion } from '../../../../contracts/domain.ts';
export function deletionStatus(value: unknown): AccountDeletionStatus {
  const v = value as AccountDeletionStatus;
  if (!v || !['processing', 'complete'].includes(v.status) || v.completion_target_days !== 7) throw new SyncFailure('PROTOCOL');
  return { request_id: uuid(v.request_id), job_id: uuid(v.job_id), status: v.status, completion_target_days: 7 };
}
export function exportPage(value: unknown, after: string | null, revision: string | null): AccountExportPage {
  const v = value as AccountExportPage;
  if (!v || !Array.isArray(v.records) || v.records.length > 500 || (revision !== null && v.revision !== revision)) throw new SyncFailure('PROTOCOL');
  const records = v.records.map(ownCheckin), head = decimal(v.revision); let previous = after ?? '';
  for (const record of records) { if (record.id <= previous || BigInt(record.revision) > BigInt(head)) throw new SyncFailure('PROTOCOL'); previous = record.id; }
  if (v.next_id !== null && (!records.length || uuid(v.next_id) !== previous)) throw new SyncFailure('PROTOCOL');
  return { request_id: uuid(v.request_id), revision: head, profile: ownProfile(v.profile), records, next_id: v.next_id };
}
export async function deletionPost(url: string, key: string, operation: 'request_account_deletion' | 'account_deletion_status', body: unknown, token?: string, signal?: AbortSignal): Promise<AccountDeletionStatus> {
  const controller = new AbortController(), abort = () => controller.abort(); signal?.addEventListener('abort', abort, { once: true }); const timer = setTimeout(abort, 15000);
  try {
    if (signal?.aborted) throw new SyncFailure('STALE_SCOPE');
    const response = await fetch(url + '/rest/v1/rpc/' + operation, { method: 'POST', headers: { apikey: key, 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: JSON.stringify(body), signal: controller.signal });
    const text = await response.text(); if (text.length > 10000) throw new SyncFailure('PROTOCOL');
    const value = JSON.parse(text);
    if (response.ok) return deletionStatus(value);
    const code = typeof value?.code === 'string' && /^[A-Z_]{1,50}$/.test(value.code) ? value.code : 'SERVER_RETRY';
    const retry = response.headers.get('retry-after'); const retryAfterMs = retry && /^\d+$/.test(retry) ? Number(retry) * 1000 : 0;
    throw new SyncFailure(code, { status: response.status, retryable: response.status >= 500 || response.status === 429, retryAfterMs: Math.min(retryAfterMs, 2147483647) });
  } catch (error) { if (error instanceof SyncFailure) throw error; throw new SyncFailure('NETWORK', { retryable: true }); }
  finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
}
