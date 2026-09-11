import type { CircleSummary, CircleList, CircleResponse, CircleJoined, CircleManaged, CreateCircle, JoinCircle, CreateInvite, ManageCircle, InviteCreated, InviteList, InvitePreview } from '../../../../contracts/domain.ts';
import { uuid } from '../domain/checkin.ts';
import { decimal, SyncFailure } from './sync/protocol.ts';
export type { CircleSummary, CircleList, CircleResponse, CircleJoined, CircleManaged, CreateCircle, JoinCircle, CreateInvite, ManageCircle, InviteCreated, InviteList, InvitePreview } from '../../../../contracts/domain.ts';
export { PARTICIPATION_TERMS_VERSION } from '../../../../contracts/domain.ts';
export type CircleRequest = { operation: 'create_circle'; envelope: CreateCircle } | { operation: 'join_circle'; envelope: JoinCircle } | { operation: 'create_invite'; envelope: CreateInvite } | { operation: 'manage_circle'; envelope: ManageCircle };
export type CircleReceipt = CircleJoined | CircleManaged | InviteCreated;
const fail = (): never => { throw new SyncFailure('PROTOCOL'); };
export function circleTimezone(value: unknown): string { if (typeof value !== 'string' || !value || value.length > 100) return fail(); try { new Intl.DateTimeFormat('en', { timeZone: value }).format(); } catch { return fail(); } return value; }
const timezone = circleTimezone;
const localDate = (v: unknown): string => typeof v === 'string' && /^\d{4}-\d\d-\d\d$/.test(v) && new Date(v + 'T00:00:00Z').toISOString().slice(0, 10) === v ? v : fail();
const bool = (v: unknown): boolean => typeof v === 'boolean' ? v : fail();
const count = (v: unknown, max = 20): number => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= max ? v : fail();
const memberId = (v: unknown): string => typeof v === 'string' && /^m_[a-f0-9]{32}$/.test(v) ? v : fail();
const name = (v: unknown): string => typeof v === 'string' && v.trim().length >= 3 && v.length <= 40 && !/[\x00-\x1f\x7f]/.test(v) ? v : fail();
const code = (v: unknown): string => typeof v === 'string' && /^pc_[a-f0-9]{64}$/.test(v) ? v : fail();
const instant = (v: unknown): string => typeof v === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(v) && Number.isFinite(Date.parse(v)) ? v : fail();
export function circleSummary(v: CircleSummary): CircleSummary {
  if (!v || count(v.member_count) < 1) fail();
  return { id: uuid(v.id), name: name(v.name), timezone: timezone(v.timezone), is_owner: bool(v.is_owner), member_id: memberId(v.member_id), member_count: count(v.member_count), name_change_required: bool(v.name_change_required) };
}
export function circleList(value: unknown): CircleList {
  const v = value as CircleList;
  if (!v || !Array.isArray(v.items) || v.items.length > 5) fail();
  const items = v.items.map(circleSummary); if (new Set(items.map(i => i.id)).size !== items.length) fail();
  return { request_id: uuid(v.request_id), items };
}
export function circleResponse(value: unknown, id: string): CircleResponse {
  const v = value as CircleResponse, c = v?.circle;
  if (!c || c.id !== id || !Array.isArray(c.members) || c.members.length > 20) fail();
  const members = c.members.map(m => {
    if (!m || typeof m.username !== 'string' || !/^[A-Za-z0-9_]{3,20}$/.test(m.username)) fail();
    const reps = decimal(m.total_reps); if (bool(m.checked_in) !== (BigInt(reps) > 0n)) fail();
    return { member_id: memberId(m.member_id), username: m.username, total_reps: reps, checked_in: m.checked_in, is_self: bool(m.is_self) };
  });
  const active = count(c.active_member_count), checked = count(c.checked_in_count), hidden = bool(c.hidden_activity), total = decimal(c.total_reps);
  if (!active || members.length > active || (!hidden && members.length !== active) || new Set(members.map(m => m.member_id)).size !== members.length || members.filter(m => m.is_self).length > 1
    || members.filter(m => m.checked_in).length !== checked || members.reduce((sum, m) => sum + BigInt(m.total_reps), 0n).toString() !== total) fail();
  for (let i = 1; i < members.length; i++) { const a = members[i - 1], b = members[i]; if (a.username.toLowerCase() > b.username.toLowerCase() || (a.username.toLowerCase() === b.username.toLowerCase() && a.member_id >= b.member_id)) fail(); }
  return { request_id: uuid(v.request_id), circle: { id: uuid(id), name: name(c.name), timezone: timezone(c.timezone), local_date: localDate(c.local_date), is_owner: bool(c.is_owner), name_change_required: bool(c.name_change_required), total_reps: total, checked_in_count: checked, active_member_count: active, hidden_activity: hidden, members } };
}
export function inviteList(value: unknown): InviteList {
  const v = value as InviteList; if (!v || !Array.isArray(v.items) || v.items.length > 5) fail();
  const items = v.items.map(i => ({ id: uuid(i.id), expires_at: instant(i.expires_at) })); if (new Set(items.map(i => i.id)).size !== items.length) fail();
  return { request_id: uuid(v.request_id), items };
}
export function invitePreview(value: unknown): InvitePreview {
  const v = value as InvitePreview; if (!v) fail();
  return { request_id: uuid(v.request_id), name: name(v.name), timezone: timezone(v.timezone), member_count: count(v.member_count), expires_in_seconds: count(v.expires_in_seconds, 604800) };
}
export function circleRequest(operation: CircleRequest['operation'], input: unknown): CircleRequest {
  const e = input as Record<string, unknown>; if (!e) fail(); const operation_id = uuid(e.operation_id as string);
  if (operation === 'create_circle') { if (e.accept_circle_sharing !== true) fail(); return { operation, envelope: { operation_id, name: name(e.name).trim(), timezone: timezone(e.timezone as string), accept_circle_sharing: true } }; }
  if (operation === 'join_circle') { if (e.accept_circle_sharing !== true) fail(); return { operation, envelope: { operation_id, code: code(e.code), accept_circle_sharing: true } }; }
  const circle_id = uuid(e.circle_id as string);
  if (operation === 'create_invite') return { operation, envelope: { operation_id, circle_id } };
  const base = { operation_id, circle_id };
  if (e.action === 'leave' || e.action === 'delete') return { operation, envelope: { ...base, action: e.action } };
  if (e.action === 'rename') return { operation, envelope: { ...base, action: e.action, name: name(e.name).trim() } };
  if (e.action === 'remove' || e.action === 'transfer') return { operation, envelope: { ...base, action: e.action, member_id: memberId(e.member_id) } };
  if (e.action === 'revoke_invite') return { operation, envelope: { ...base, action: e.action, invite_id: uuid(e.invite_id as string) } };
  return fail();
}
export function circleReceipt(value: unknown, request: CircleRequest): CircleReceipt {
  const v = value as CircleReceipt; if (!v || v.operation_id !== request.envelope.operation_id) fail();
  const base = { request_id: uuid(v.request_id), operation_id: uuid(v.operation_id) };
  if (request.operation === 'create_circle' || request.operation === 'join_circle') {
    const circle = circleSummary((v as CircleJoined).circle);
    if (request.operation === 'create_circle' && circle.timezone !== request.envelope.timezone) fail();
    return { ...base, circle };
  }
  if (!('circle_id' in v) || v.circle_id !== request.envelope.circle_id) fail();
  if (request.operation === 'manage_circle') { if ((v as CircleManaged).applied !== true) fail(); return { ...base, circle_id: request.envelope.circle_id, applied: true }; }
  const i = (v as InviteCreated).invite; if (!i) fail();
  return { ...base, circle_id: request.envelope.circle_id, invite: { id: uuid(i.id), code: code(i.code), expires_at: instant(i.expires_at) } };
}
