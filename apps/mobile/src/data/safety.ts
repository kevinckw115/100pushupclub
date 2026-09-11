import type { SafetyOperation, BlockMutation, ReportMutation, BlockReceipt, ReportReceipt, BlockPage } from '../../../../contracts/domain.ts';
import { uuid } from '../domain/checkin.ts';
import { SyncFailure } from './sync/protocol.ts';
export type { SafetyOperation, BlockMutation, ReportMutation, BlockReceipt, ReportReceipt, BlockPage } from '../../../../contracts/domain.ts';
export type SafetyRequest = { operation: 'block_user' | 'unblock_user'; envelope: BlockMutation } | { operation: 'report_subject'; envelope: ReportMutation };
export type SafetyReceipt = BlockReceipt | ReportReceipt;
export function safetyRequest(operation: SafetyOperation, value: unknown): SafetyRequest {
  const v = value as ReportMutation & BlockMutation;
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('Invalid safety request.');
  const operation_id = uuid(v.operation_id);
  if (operation === 'block_user' || operation === 'unblock_user') {
    if (!/^a_[0-9a-f]{32}$/.test(v.actor_id) || Object.keys(v).some(key => !['operation_id', 'actor_id'].includes(key))) throw new Error('Choose an account from current activity.');
    return { operation, envelope: { operation_id, actor_id: v.actor_id } };
  }
  if (operation !== 'report_subject' || !['alias', 'circle_name', 'checkin'].includes(v.subject_type) || !['abuse', 'impersonation', 'inappropriate_name', 'other'].includes(v.reason)
    || Object.keys(v).some(key => !['operation_id', 'subject_type', 'subject_id', 'reason'].includes(key))) throw new Error('Choose a subject and report reason.');
  if (v.subject_type === 'circle_name') uuid(v.subject_id);
  else if (!(v.subject_type === 'alias' ? /^a_[0-9a-f]{32}$/ : /^e_[0-9a-f]{32}$/).test(v.subject_id)) throw new Error('Choose a subject from current activity.');
  return { operation, envelope: { operation_id, subject_type: v.subject_type, subject_id: v.subject_id, reason: v.reason } };
}
export function safetyReceipt(value: unknown, request: SafetyRequest): SafetyReceipt {
  const v = value as BlockReceipt & ReportReceipt;
  if (!v || v.operation_id !== request.envelope.operation_id) throw new SyncFailure('PROTOCOL');
  const request_id = uuid(v.request_id), operation_id = uuid(v.operation_id);
  if (request.operation === 'report_subject') {
    if (v.received !== true) throw new SyncFailure('PROTOCOL');
    return { request_id, operation_id, report_id: uuid(v.report_id), received: true };
  }
  if (v.actor_id !== request.envelope.actor_id || v.blocked !== (request.operation === 'block_user')) throw new SyncFailure('PROTOCOL');
  return { request_id, operation_id, actor_id: v.actor_id, blocked: v.blocked };
}
export function blockPage(value: unknown, after: string | null): BlockPage {
  const p = value as BlockPage;
  if (!p || !Array.isArray(p.items) || p.items.length > 50 || (p.next_actor !== null && !/^a_[0-9a-f]{32}$/.test(p.next_actor))) throw new SyncFailure('PROTOCOL');
  let previous = after;
  const items = p.items.map(row => {
    if (!/^a_[0-9a-f]{32}$/.test(row.actor_id) || (previous !== null && row.actor_id <= previous) || !(/^[A-Za-z0-9_]{3,20}$/.test(row.alias) || row.alias === 'Account unavailable')) throw new SyncFailure('PROTOCOL');
    previous = row.actor_id; return { actor_id: row.actor_id, alias: row.alias };
  });
  if (p.next_actor !== null && (!items.length || p.next_actor !== items.at(-1)!.actor_id)) throw new SyncFailure('PROTOCOL');
  return { request_id: uuid(p.request_id), items, next_actor: p.next_actor };
}
