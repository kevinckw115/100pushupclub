/** Normative transport shapes. Add runtime validation in the implementation. */
export type UUID = string;
export type DecimalString = string; // non-negative integer, never Number(revision)
export type ISOInstant = string; // UTC ISO 8601; second or millisecond precision
export type LocalDate = string; // YYYY-MM-DD
export type IANATimezone = string;

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
  record: OwnCheckin;
  revision: DecimalString;
  effective_public: boolean;
}
export interface PullPage {
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
  total_reps: DecimalString; checked_in_count: number; active_member_count: number;
  hidden_activity: boolean;
  members: Array<{
    member_id: string; username: string; total_reps: DecimalString;
    checked_in: boolean; is_self: boolean;
  }>;
}
export type OutboxStatus = 'pending' | 'sending' | 'acknowledged' | 'conflict' | 'rejected';
export type SyncErrorCode =
  | 'INVALID_QUANTITY' | 'INVALID_TIMEZONE' | 'INVALID_LOCAL_DATE' | 'CLOCK_AHEAD'
  | 'UNAUTHENTICATED' | 'ACCOUNT_UNAVAILABLE' | 'NOT_FOUND_OR_FORBIDDEN'
  | 'VERSION_CONFLICT' | 'ENTITY_EXISTS' | 'IDEMPOTENCY_KEY_REUSED'
  | 'RATE_LIMITED' | 'INVALID_CURSOR';
