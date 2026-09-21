/** Normative transport shapes. Add runtime validation in the implementation. */
export type UUID = string;
export type DecimalString = string; // non-negative integer, never Number(revision)
export type ISOInstant = string; // UTC ISO 8601; second or millisecond precision
export type LocalDate = string; // YYYY-MM-DD
export type IANATimezone = string;
export const PARTICIPATION_TERMS_VERSION = 'community-v1-2026-09-11';

/** Own account configuration; never an authentication email or public actor DTO. */
export interface OwnProfile {
  alias: string;
  region_id: string | null;
  public_enabled: boolean;
  consent_epoch: DecimalString;
  status: 'active' | 'deleting' | 'suspended';
  participation_terms_version: string | null;
  alias_change_required: boolean;
}
export interface ProfileResponse { request_id: UUID; profile: OwnProfile }
export interface ProfileMutation {
  operation_id: UUID; alias?: string; region_id?: string | null; public_enabled?: boolean;
  expected_consent_epoch?: DecimalString; // Required when region or sharing is submitted.
  accepted_terms_version?: string; // Only after the user explicitly accepts the displayed participation terms.
}
export interface BootstrapProfileResult extends ProfileResponse {
  revision: DecimalString; // informational; never initialize a client pull cursor from this
}

export interface CreateCheckin {
  kind: 'create';
  mutation_id: UUID;
  checkin_id: UUID;
  quantity: number;
  occurred_at: ISOInstant;
  recorded_timezone: IANATimezone;
  local_date: LocalDate;
  source: 'native' | 'import';
  requested_public_epoch: DecimalString | null;
}
export interface UpdateCheckin {
  kind: 'update'; mutation_id: UUID; checkin_id: UUID;
  quantity: number; expected_version: number;
}
export interface DeleteCheckin {
  kind: 'delete'; mutation_id: UUID; checkin_id: UUID;
  expected_version: number;
}
export type CheckinMutation = CreateCheckin | UpdateCheckin | DeleteCheckin;

/** Owner-only DTO. Never broadcast or return through public/circle endpoints. */
export interface OwnCheckin {
  id: UUID;
  quantity: number;
  occurred_at: ISOInstant;
  recorded_timezone: IANATimezone;
  local_date: LocalDate;
  source: 'native' | 'import';
  created_at: ISOInstant;
  updated_at: ISOInstant;
  deleted_at: ISOInstant | null;
  version: number;
  revision: DecimalString;
  public_epoch: DecimalString | null;
  public_region_id: string | null;
}
export interface MutationAccepted {
  request_id: UUID;
  record: OwnCheckin;
  revision: DecimalString;
  effective_public: boolean;
}
export interface PullPage {
  request_id: UUID;
  changes: OwnCheckin[];
  next_revision: DecimalString;
  has_more: boolean;
}
export interface PublicFeedRow {
  id: string; // opaque projection identifier, not checkin UUID
  actor_id: string; // opaque alias identifier, not auth UUID
  username: string;
  quantity: number;
  relative_time: string; // no underlying exact per-event timestamp
}
export interface ClubPage {
  request_id: string;
  requested_scope: string;
  effective_scope: { id: string; label: string };
  fallback_reason: 'SPARSE_REGION' | 'NO_REGION' | null;
  window: { label: 'past 24 hours'; as_of: ISOInstant };
  people_past_hour: number;
  pushups_past_24_hours: DecimalString;
  items: PublicFeedRow[];
  next_cursor: string | null; // encrypted or random; must not reveal event times
}
export interface CircleToday {
  id: UUID; name: string; timezone: IANATimezone; local_date: LocalDate;
  is_owner: boolean; name_change_required: boolean;
  total_reps: DecimalString; checked_in_count: number; active_member_count: number;
  hidden_activity: boolean;
  members: Array<{
    member_id: string; username: string; total_reps: DecimalString;
    checked_in: boolean; is_self: boolean;
  }>;
}
export type OutboxStatus = 'pending' | 'sending' | 'acknowledged' | 'conflict' | 'rejected';
export type SyncErrorCode =
  | 'REAUTH_REQUIRED' | 'DELETION_ALREADY_REQUESTED' | 'EXPORT_CHANGED'
  | 'CIRCLE_LIMIT' | 'CIRCLE_FULL' | 'INVALID_CIRCLE_NAME' | 'INVITE_UNAVAILABLE' | 'INVITE_LIMIT'
  | 'CIRCLE_NAME_REQUIRED' | 'OWNER_TRANSFER_REQUIRED' | 'MEMBERSHIP_CHANGED' | 'PARTICIPATION_REQUIRED'
  | 'TERMS_REQUIRED' | 'ALIAS_CHANGE_REQUIRED' | 'STAFF_REQUIRED'
  | 'CONSENT_CONFLICT' | 'INVALID_ALIAS' | 'ALIAS_UNAVAILABLE' | 'INVALID_REGION'
  | 'INVALID_REQUEST' | 'INVALID_TIMESTAMP' | 'SERVER_RETRY'
  | 'INVALID_QUANTITY' | 'INVALID_TIMEZONE' | 'INVALID_LOCAL_DATE' | 'CLOCK_AHEAD'
  | 'UNAUTHENTICATED' | 'ACCOUNT_UNAVAILABLE' | 'NOT_FOUND_OR_FORBIDDEN'
  | 'VERSION_CONFLICT' | 'ENTITY_EXISTS' | 'IDEMPOTENCY_KEY_REUSED'
  | 'RATE_LIMITED' | 'INVALID_CURSOR';

export interface SyncErrorResponse {
  code: SyncErrorCode; message: string; retryable: boolean; request_id: UUID;
  current_record?: OwnCheckin;
  profile?: OwnProfile;
}
export interface MutationRPCInput { envelope: CheckinMutation }
export interface PullRPCInput { after_revision: DecimalString; limit?: number }

export interface Region {
  id: string; parent_id: string | null; kind: 'world' | 'country' | 'admin1' | 'locality';
  name: string; label: string; has_children: boolean;
}
export interface RegionPage { request_id: UUID; version: string; items: Region[]; next_cursor: string | null }
export interface ResolvedRegion { request_id: UUID; version: string; region: Region; ancestors: Region[]; fallback_reason: 'MISSING_REGION' | null }

export type SafetyOperation = 'block_user' | 'unblock_user' | 'report_subject';
export interface BlockMutation { operation_id: UUID; actor_id: string }
export interface ReportMutation { operation_id: UUID; subject_type: 'alias' | 'circle_name' | 'checkin'; subject_id: string; reason: 'abuse' | 'impersonation' | 'inappropriate_name' | 'other' }
export interface BlockReceipt { request_id: UUID; operation_id: UUID; actor_id: string; blocked: boolean }
export interface ReportReceipt { request_id: UUID; operation_id: UUID; report_id: UUID; received: true }
export interface BlockPage { request_id: UUID; items: Array<{ actor_id: string; alias: string }>; next_actor: string | null }

export interface CircleSummary { id: UUID; name: string; timezone: IANATimezone; is_owner: boolean; member_id: string; member_count: number; name_change_required: boolean }
export interface CircleList { request_id: UUID; items: CircleSummary[] }
export interface CircleResponse { request_id: UUID; circle: CircleToday }
export interface CircleJoined { request_id: UUID; operation_id: UUID; circle: CircleSummary }
export interface CreateCircle { operation_id: UUID; name: string; timezone: IANATimezone; accept_circle_sharing: true }
export interface JoinCircle { operation_id: UUID; code: string; accept_circle_sharing: true }
export interface CreateInvite { operation_id: UUID; circle_id: UUID }
export interface InviteCreated { request_id: UUID; operation_id: UUID; circle_id: UUID; invite: { id: UUID; code: string; expires_at: ISOInstant } }
export interface InvitePreview { request_id: UUID; name: string; timezone: IANATimezone; member_count: number; expires_in_seconds: number }
export interface InviteList { request_id: UUID; items: Array<{ id: UUID; expires_at: ISOInstant }> }
export type ManageCircle = { operation_id: UUID; circle_id: UUID } & (
  { action: 'leave' | 'delete' } | { action: 'rename'; name: string } | { action: 'remove' | 'transfer'; member_id: string } | { action: 'revoke_invite'; invite_id: UUID }
);
export interface CircleManaged { request_id: UUID; operation_id: UUID; circle_id: UUID; applied: true }
export interface RequestAccountDeletion { operation_id: UUID; status_token: string; confirm_delete: true }
export interface AccountDeletionStatus { request_id: UUID; job_id: UUID; status: 'processing' | 'complete'; completion_target_days: 7 }
export interface AccountExportPage { request_id: UUID; revision: DecimalString; profile: OwnProfile; records: OwnCheckin[]; next_id: UUID | null }
