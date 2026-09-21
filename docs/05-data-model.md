# Data model and invariants

T19 deletion jobs retain a random job ID, stable operation ID, status-proof hash, data/auth/complete phase and sanitized retry metadata independently of the Auth/profile foreign keys. Request acceptance and session revocation are atomic. The privileged worker processes one owned live circle or100 deleted circles/500 records per step, preserving sorted user-before-circle locking and rechecking ownership candidates. It transfers to the earliest joined eligible active member, with UUID ties, or deletes the circle. Remaining own data is removed in bounded batches before profile/Auth deletion. Minimal append-only moderation audit is retained under the documented operational retention policy; backup/provider retention must be configured and disclosed before release.

T17 adds independently random membership member_id, rotated on rejoin, and validates interval ordering. Circle identity/creation time/fixed IANA timezone are immutable. Active-membership and native check-in window indexes support bounded reads. Eligibility requires both occurred_at and server created_at at or after the later of contributor and viewer current joined_at; newcomers receive no pre-interval history. Local midnight boundaries use PostgreSQL timezone rules including DST. Import, tombstone, moderation, account/deletion and bilateral block exclusions apply to rows and totals; the denominator remains actual active membership.

Circle writes lock sorted user advisory keys and profiles before circle/membership rows, serializing cross-circle quota checks and final-slot joins. Private invitation storage contains SHA256 hashes only. A private generated HMAC key derives retry-stable256-bit codes; operation receipts store hash-based request semantics and code-free results. A bounded private global preview budget complements per-account budgets. New helpers/tables deny public/anon/authenticated direct access; only checked RPCs are granted.

This is a normative schema specification, not deployable SQL. Codex must implement versioned migrations and prove behavior against real local PostgreSQL before deploying. Do not copy an incomplete example into production.

## Server tables

Keep application tables in a non-exposed schema such as app_private. Expose tightly scoped functions through the API schema. Apply grants and RLS even where functions are the primary access route. Use UUIDs for entity IDs, timestamptz for instants, date for personal calendar dates, bigint for monotonic revisions and sums. Serialize bigint values as decimal strings across JSON boundaries.

| Table | Required columns and constraints |
|---|---|
| profiles | user_id PK/FK auth.users, alias, alias_normalized UNIQUE, region_id nullable FK, public_enabled default false, consent_epoch bigint default 0, account_status active/deleting/suspended, created_at |
| account_sync_state | user_id PK, revision bigint default 0; row locked by every accepted check-in mutation |
| checkins | id UUID PK, user_id FK immutable, quantity int CHECK 1..999, occurred_at, recorded_timezone text, local_date date, source native/import, created_at server time, updated_at, deleted_at nullable, version int >=1, revision bigint, public_epoch nullable bigint, public_region_id nullable FK |
| mutation_receipts | user_id + mutation_id composite PK, canonical_payload_hash, immutable result JSON, created_at; account lifetime retention |
| operation_receipts | user_id + operation_id composite PK, operation name, semantic request hash, immutable result JSON, created_at; non-check-in mutation idempotency |
| request_budgets | account + operation key; current minute window and bounded usage counter; no private event content |
| reserved_aliases | normalized alias primary key; server-maintained reserved-name policy |
| checkin_changes | user_id + revision composite PK, checkin_id, immutable accepted record snapshot JSON; includes tombstones; account lifetime retention |
| regions | id stable text PK, parent_id FK nullable, kind world/country/admin1/locality, name, country_code nullable, timezone hint nullable; indexed hierarchy/closure |
| region_ancestors | region_id + ancestor_id composite PK; self and all ancestors; generated from vetted region import |
| circles | id UUID PK, owner_id FK, name length 3..40, timezone valid IANA, created_at, deleted_at nullable |
| circle_memberships | circle_id + user_id PK, joined_at, left_at nullable; rejoin replaces joined_at after locked capacity check |
| circle_invites | id UUID PK, circle_id FK, token_hash UNIQUE, expires_at, revoked_at nullable, created_by, created_at; raw token never stored |
| blocks | blocker_id + blocked_id PK, no self-block, created_at |
| reports | id UUID PK, reporter_id, subject_type alias/circle_name/checkin, subject_id, reason enum, status, created_at; no arbitrary public text |
| moderation_audit | id, staff identity, action, subject, private reason, created_at; backend staff only |
| staff_members | verified Auth user UUID, enabled flag; private administration only, no client CRUD |
| reserved_circle_names | normalized names rejected by staff; private checked name validation input |
| deletion_jobs | user_id UNIQUE, status, requested_at, last_attempt_at, completed_at, private error code |

T16 profiles add participation_terms_version/participation_accepted_at and alias_change_required. A database constraint disallows public_enabled unless current participation acceptance exists and no alias change is required. Circles add name_change_required; reports capture a minimal private subject context at submission so renaming does not erase the review context. Moderation audit UPDATE/DELETE is rejected by a trigger; action, audit and original receipt commit atomically. Reports keep enum reasons and never accept arbitrary public text. A separate fixed-hour request-budget key enforces report limits.

Checkin ID collisions across accounts return generic NOT_FOUND_OR_FORBIDDEN, never information about the other owner. Receipt IDs are account-scoped. Quantity updates are absolute new values, never increments to an aggregate. Deleted check-ins remain tombstoned and cannot be restored under the same ID. Creating a deliberate replacement requires a new ID and defaults private.

Foreign-key cascades must be planned around account deletion: remove memberships, contributions, blocks, receipts and change history; delete/transfer owned circles under the documented rule. For account deletion, transfer owned circles to the earliest-joined active member with UUID tie-breaker, or delete if alone. User-triggered ordinary circle leave still requires explicit transfer. Deletion is not blocked by abandoned circle ownership.

## Integrity and indexes

- On the first verified permanent login, a checked idempotent bootstrap operation creates profiles and account_sync_state atomically. Assign a random non-identifying unique alias such as member_ plus 12 random lowercase alphanumerics, retrying uniqueness collisions; do not derive it from email or the auth UUID. Offer alias editing before enabling public sharing/joining circles. Existing profile bootstrap returns the existing row. Account setup must not depend on an unimplemented auth trigger or allow the client to assign arbitrary ownership.

- Validate IANA timezone using server-supported timezone names and derive local_date from occurred_at in that zone at CREATE. Require client-supplied date to match, otherwise INVALID_LOCAL_DATE. Preserve all three thereafter.
- UTC input uses seconds or exactly three fractional digits and rejects normalized impossible dates/times. New records more than five minutes ahead of server time return CLOCK_AHEAD, matching the reference rule. Mutation receipts and change snapshots reject UPDATE; account cleanup may delete them.
- Index checkins(user_id, local_date, occurred_at DESC, id) for personal reads; eligible public time-window lookup on occurred_at, public_region_id and user_id; circle memberships on user_id and active status; changes on (user_id, revision); receipts on their composite PK.
- Alias normalization is lowercase ASCII after trim; require /^[A-Za-z0-9_]{3,20}$/ and uniqueness in a database constraint. Use a server-maintained reserved-term policy.
- Per-profile privacy updates lock the profile and increment consent_epoch; create-checkin also locks profile before sync state. Lock order is always profile → account_sync_state → checkin. This prevents a consent race and deadlocks across those functions.
- Circle mutation lock order is circle row, then memberships. Capacity checks and inserts occur in the same transaction. Repeated join is idempotent and doesn't reset joined_at for an active member.
- Circle maximum 20 active members, maximum 5 active circles per user. Concurrent joins to different circles require a user-level lock for quota enforcement, taken before circle locks; order users deterministically when more than one must be locked.
- Use checked arithmetic and bigint SUM. Accepted revisions are allocated under per-user row lock inside the same transaction as changes/receipts; do not use a global sequence as a committed sync cursor.

## Public eligibility

T14 adds independently random public_actor_id/public_entry_id and immutable creation_xid to the private profile/check-in tables. Owner snapshots continue to omit these internal columns. A private RLS-protected server_secrets row stores the generated feed cursor key. The initial transaction snapshot excludes records committed after the first page, while later edits/privacy changes remain current. No exposed table contains cursor keys or private owner mappings.

A record is eligible only if: account active; profile public_enabled; not deleted; source native; public_epoch equals current profile consent_epoch; public_region_id is the profile's current region snapshot (or world-only null); occurred_at lies in the requested rolling window. Checkin epoch is assigned only during native CREATE when its requested epoch matches current server consent. Otherwise the record saves privately, with the response saying so. UPDATE never changes sharing metadata or bumps feed ordering.

Every consent toggle and region change increments epoch. Disabling sharing or changing region immediately makes all earlier contributions ineligible. Re-enabling affects future records only. Imported and corrected replacement records are private. A record is public only to broad scopes containing its public_region_id; null-region public entries are World-only.

Public aggregates count DISTINCT owners and SUM current eligible quantities, not event count. Reported-but-unreviewed entries remain until user blocks or staff hides/suspends; confirmed abusive entries can be marked excluded through an audited moderation flag added during implementation. Include that flag in every feed/aggregate eligibility predicate.

## Circle eligibility

Require viewer to be a current member and active account. Join authorizes visibility of new native entries from current members after both membership joined_at and entry server-created time. Calculate occurred_at within the circle's current day, using its fixed timezone. Exclude deleted entries, imported history, inactive members and suspended/deleting accounts. Public_enabled has no effect on circle sharing. No raw personal local_date or recorded_timezone is returned.

Blocks suppress both directions of member/activity rows for that viewer, but do not alter actual membership. Circle denominator remains actual membership; totals/numerator reflect visible members with a “Some activity is hidden” label. Public counts/rows also apply bilateral blocks for authenticated viewers; threshold eligibility itself uses global contributors before viewer-specific blocks to avoid different geography fallback by block list.

## Local SQLite

| Table | Purpose |
|---|---|
| local_partitions | guest UUID or account UUID; active selection; never silently cross-read |
| local_checkins | composite partition/id key; immutable time fields; accepted server snapshot plus local projected quantity/deletion; server version/revision; pending/conflict/error state |
| outbox | partition + mutation_id unique; entity_id, operation, immutable serialized request once sent, base_version, dependency mutation, attempts, next_retry_at, status |
| sync_cursors | partition, last applied revision string |
| guest_imports | guest partition, account id, checkin id, stable mutation id, state; unique tuple |
| preferences | partition-specific settings; device-only reminder settings separately keyed |
| cached_queries | identity + scope + request key, sanitized payload, fetched_at, expiry |
| local_schema_migrations | version and applied time |

SQLite writes use bound parameters and transactions. Maintain the accepted server snapshot separately from optimistic projection so a pull cannot erase a pending edit. Personal totals sum only visible nondeleted projections for the active partition and date. An uncertain sent request is never overwritten by editing its body.

Tombstones/receipts/change snapshots persist for account lifetime in V1; retention optimization requires a full-resync protocol first. Account deletion removes them. Guest local history persists until explicit discard/import cleanup or app removal. Provide export before destructive local actions.
# Client reconciliation storage (T11)

T13 directory storage adds source_code, active and normalized search_name to regions, plus private RLS-protected directory_versions containing the checked source manifest. Region IDs are stable geoname-backed text; inactive rows and ancestors remain available for broader-region fallback. Source labels and hierarchy are public through bounded RPCs, never direct table grants. The mobile directory cache holds at most20 sanitized public pages and labels an offline fallback; browsing choice is a durable per-partition preference.

T12 migration4 adds immutable guest source snapshots, collision response/code, bounded automatic collision attempts and cleanup markers to `guest_imports`. State is pending, acknowledged, conflict, paused or cancelled. Account/destination is unique. The ledger survives signout for deduplication, but account response snapshots are cleared; incomplete jobs require explicit resume. Guest snapshots are original local guest data, never tokens. Check-in/outbox/job creation and acknowledgment/ledger updates are atomic.

SQLite migration3 adds `outbox.acknowledged_version`, `retry_delay_ms`, retry/entity indexes and owner-partitioned `sync_issues`. The acknowledgment version belongs to that exact request, not the newest pulled entity. Issues retain the rejected mutation and owner snapshot until an explicit choice. Accepted snapshots plus the page cursor commit in one transaction. The display projection retains unsynced intent separately from accepted JSON. Cancelling an optimistic deletion may restore an accepted live value; an accepted tombstone or deleted guest record cannot be resurrected.
