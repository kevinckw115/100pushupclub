# API contract

Names below are normative operations. Implement authenticated PostgreSQL RPCs or an Edge Function facade as appropriate. HTTP facades authenticate JWTs before database access and use user-scoped operations; privileged service credentials must never turn a submitted user_id into authorization. All responses have request_id; logs must not include payloads with email or auth tokens.

## Common conventions

- JSON input maximum 32 KB per single mutation; import batch maximum 50 entries and 512 KB. Reject oversize early.
- IDs UUID strings, revisions/epochs decimal strings, dates YYYY-MM-DD, timestamps ISO 8601 UTC. Schema validation exists both client-side and server-side.
- Error `{code, message, retryable, request_id, current_record?}`. Stable codes: INVALID_QUANTITY, INVALID_TIMEZONE, INVALID_LOCAL_DATE, CLOCK_AHEAD, UNAUTHENTICATED, ACCOUNT_UNAVAILABLE, NOT_FOUND_OR_FORBIDDEN, VERSION_CONFLICT, ENTITY_EXISTS, IDEMPOTENCY_KEY_REUSED, RATE_LIMITED, INVALID_CURSOR, INVITE_EXPIRED, CIRCLE_FULL, QUOTA_EXCEEDED.
- Never expose SQL errors, token material, another owner's record, or exact locations in errors.
- T10 adds INVALID_REQUEST (malformed shape/identity/version/source/epoch), INVALID_TIMESTAMP, and retryable SERVER_RETRY. Accepted mutation and pull DTOs include request_id. RPC arguments are `{envelope: CheckinMutation}` and `{after_revision, limit}` respectively. Application error bodies carry the declared HTTP error status; upstream Auth/gateway denials may precede application execution.
- Cursor is opaque and validated, never an arbitrary SQL predicate. Parameterize filters. Scope IDs resolve only through curated region hierarchy.

| Operation | Input | Output / semantics |
|---|---|---|
| bootstrap_profile | operation_id UUID; permanent verified session | own profile + sync state, created atomically if absent; random default alias; safe replay |
| mutate_checkin | envelope from contracts/domain.ts | Accepted record + revision + effective_public; receipt-replay semantics |
| pull_changes | after_revision string, limit default 100 max 500 | ordered snapshots, next_revision, has_more; owner only |
| get_profile | none | own alias, region, consent_epoch, public_enabled, status; never auth email through public DTO |
| update_profile | optional alias/region/public_enabled, expected consent_epoch for privacy changes | profile; stale epoch returns conflict; toggles/region changes increment epoch |
| read_club | scope_id, page cursor optional, limit default25 max50 | sanitized feed + counts and window metadata; safe guest access |
| list_regions | parent or normalized search term, cursor | curated public labels/IDs; max50 |
| resolve_region | region_id | selected region and ordered ancestor labels; inactive/missing region falls back to an active broader region or World |
| list_circles | none | own active circle summaries only |
| create_circle | name, IANA timezone, operation_id UUID | group + owner membership; idempotent and quota checked |
| create_invite | circle_id, operation_id | one-time-returned opaque code/link; owner only; 7-day expiry |
| preview_invite | code | name, member_count, expires_in; rate limited; no member identities |
| join_circle | code, operation_id | membership and group; consent required in UI; current membership idempotent |
| read_circle_today | circle_id | timezone, local date, counts, alphabetic member rows; server auth |
| manage_circle | operation_id, circle_id, action, target if needed | owner-checked remove/transfer/revoke/delete; regular member may leave self |
| block_user / unblock_user | target public alias identifier, operation_id | safe acknowledgement; enforce bilateral query filters |
| report_subject | subject_type, subject_id, reason enum, operation_id | receipt; reporter can submit only visible valid subject |
| request_account_deletion | recent verified session, operation_id | deletion job status; immediately prevents new visibility/writes |
| export_account | own verified session | paginated own records/preferences, never circle peers' data |

T16 safety RPCs use `{envelope: BlockMutation|ReportMutation}` and durable operation IDs. Block targets use public actor IDs; reports accept alias/checkin public IDs or a circle UUID visible to the caller. Bilateral blocks and live membership/visibility are checked on submission. list_blocks(after_actor=null,limit=25,max50) returns only the caller's blocked actor IDs and current safe labels. Reports allow10 new attempts per UTC hour with Retry-After; an original receipt remains replayable after the budget is exhausted. Staff-only staff_list_reports and staff_moderate require an enabled private staff record as well as a confirmed account; ordinary authenticated users receive403. Staff actions and audit insertion are atomic. See tools/backend/STAFF.md for exact inputs.

OwnProfile also returns participation_terms_version and alias_change_required. ProfileMutation may include accepted_terms_version only after explicit acceptance of the displayed community-v1-2026-09-11 participation terms. Public enablement requires current acceptance and a resolved alias requirement; errors TERMS_REQUIRED and ALIAS_CHANGE_REQUIRED preserve pending client intent for review. Terms-only acceptance does not change the public epoch. Existing opt-ins are disabled by the migration until the new participation acceptance is provided; old epochs never republish.

All mutating operations beyond check-ins also require idempotency records appropriate to their operation. Their database writes, quotas and receipt must commit atomically. Rate limits still apply to replays to prevent endpoint flooding.

Directory RPCs permit anon/authenticated execution because they return only geographic labels. `list_regions(parent_id='world',search=null,cursor=null,limit=50)` trims/case-folds/unaccents search, requires2-80 characters when nonempty and uses literal substring matching. Pass parent_id=null for directory-wide search. Cursors bind the parent, search and source version. `resolve_region(region_id)` returns an active selected region and ordered ancestors, or MISSING_REGION with the closest active broader ancestor/World. Inputs and execution time are bounded; malformed requests/cursors return common API errors. No profile/coordinate/activity data appears in either response.

Profile RPC envelopes use `ProfileResponse` and `BootstrapProfileResult` in contracts/domain.ts. Bootstrap returns its original receipt for the same operation ID, after rechecking the live account. Its revision is informational; it must not advance the client pull cursor. `get_profile` returns current own configuration with a request ID and no authentication email. Generic operation receipts are stored separately from check-in mutation receipts.

## Public DTO

`read_club` response:

```json
{
  "request_id": "example",
  "requested_scope": "US-CA-ORANGE",
  "effective_scope": {"id":"US-CA", "label":"California"},
  "fallback_reason": "SPARSE_REGION",
  "window": {"label":"past 24 hours", "as_of":"2026-09-10T18:00:00Z"},
  "people_past_hour": 128,
  "pushups_past_24_hours": "3460",
  "items": [
    {"id":"opaque-public-entry-id", "actor_id":"opaque-alias-id", "username":"steadyben", "quantity":10, "relative_time":"just now"}
  ],
  "next_cursor": null
}
```

Example values are documentation only. `as_of` is the server query time, not a person's event timestamp. No owner UUID/auth email, lat/long, recorded timezone/date, exact per-event time, private count or hidden-region count is returned. Opaque actor identifiers enable blocking/reporting without exposing auth IDs. Generate scoped public identifiers server-side and map internally.

Feed pagination uses a validated cursor encoding boundary occurred_at/id and window anchor, without exposing exact event times: encrypt/authenticate cursor or use server-side random cursor handles. A signed but readable timestamp cursor would still disclose the timestamp. Recheck current privacy/block/suspension state on every page even with fixed window anchor. New activity is picked up by first-page refresh, not inserted into older pagination pages.

T14 implements read_club(scope_id='world',cursor=null,limit=25,max50). Cursors are integrity-protected encrypted PGP messages, bounded at16KB, expiring15 minutes after the initial millisecond anchor; they bind viewer, requested/effective scope and initial transaction snapshot. Invalid/tampered/stale-scope cursors return INVALID_CURSOR without plaintext. Public items contain only independently random entry/actor IDs, alias, quantity and coarse relative time. Cache-Control is no-store. update_profile takes `{envelope: ProfileMutation}`; privacy fields require expected_consent_epoch. New checked errors: CONSENT_CONFLICT with own profile, INVALID_ALIAS, ALIAS_UNAVAILABLE and INVALID_REGION. Reusing an operation ID with different semantics is rejected.

Aggregate scope threshold uses eligible unique contributors in the past 24 hours. If a narrow region is below 10, walk ancestors to the first eligible one or World. Compute counts/items under the same eligibility predicate and consistent snapshot. Authenticated responses vary by block list; never put them in a shared unauthenticated cache. Cache public guest responses at most 10 seconds with explicit visibility-change purge. Disable cache if purge correctness is unproven.

## Deletion and export implementation (T19)

request_account_deletion({envelope:{operation_id,status_token,confirm_delete:true}}) requires a confirmed permanent Auth identity, an existing session and a signed AMR authentication time within10 minutes. A refreshed token's iat does not qualify by itself. It allows suspended owners to delete their own accounts. The transaction locks the account, disables sharing, changes status to deleting, increments its epoch, records the job and revokes Auth refresh tokens/sessions. Replays require the original operation ID and status-token hash. All ordinary checked APIs reject the account immediately, including still-valid JWTs.

account_deletion_status(status_token) is available without a session because Auth is eventually removed. Its random256-bit capability is supplied by the client before deletion and stored only as a hash on the server. It returns job_id, processing/complete and the seven-day operational target, with no account identifiers, content, email or failure internals. Unknown proofs return a generic404; global budget300/minute and no-store responses apply. Hosted source/gateway limits remain required. Do not put proofs in URLs/logs.

export_account(after_id=null,expected_revision=null,limit=500) returns bounded caller-only profile/records/revision/next_id. Subsequent pages must supply the initial revision; intervening check-in changes return EXPORT_CHANGED so clients restart explicitly. It includes own tombstones/imports and exact own recorded fields, never circle peers, public activity or reports about others. Budget30/minute/account. Server worker functions have no client grants.

## Circle DTO

T17 implements authenticated list_circles(), read_circle_today(circle_id), list_circle_invites(circle_id), preview_invite(code), and envelope-based create_circle, join_circle, create_invite, manage_circle. Exact inputs/results are in contracts/domain.ts. Create/join require accept_circle_sharing=true and current participation acceptance. Management actions are leave/delete/remove/transfer/revoke_invite/rename. Owners transfer before leaving or delete the circle. Timezone is immutable. Reads allow30/minute/account; writes share30/minute/account. Preview requires a verified account,10/minute/account and300/minute globally; hosted gateway source limits remain a deployment gate.

List contains at most5 summaries; detail at most20 member rows and includes is_owner/name_change_required. Member IDs are random per membership and rotate on rejoin. Checked management and alias report/block actions resolve these internally without returning Auth IDs or global public actors in circle responses. list_blocks still returns the caller's global opaque blocked-actor IDs for later unblocking.

Invites expire after seven days, with at most5 active links per circle. Preview returns only name/timezone/member_count/relative expiry. Codes have256 bits from a private HMAC key; only SHA256 hashes enter invitation storage. Create-invite receipts omit codes; authorized unchanged-owner replay derives the identical code only while the invitation remains valid. Transfer, moderation-required name changes and deletion revoke links. Clients retain uncertain operation IDs, then fetch current state after acknowledgment; a create/join replay after removal or rejoining returns MEMBERSHIP_CHANGED. Management receipts acknowledge past effects and do not reapply them.

Return circle id/name/timezone/date, total_reps decimal string, checked_in_count, active_member_count, hidden_activity boolean, and member rows `{member_id, username, total_reps, checked_in, is_self}`. No individual check-in times or quantities are needed. member_id is a circle-scoped opaque identifier; management resolves it after authorization. Member list order is case-insensitive alias plus stable ID, not rep count.

## Abuse budgets (initial configurable defaults)

Authenticated check-in mutations: 120/minute/account; public feed: 30/minute/session plus gateway IP protections; invite preview: 10/minute/source and bounded global budget; report: 10/hour/account. Imports use a separately bounded queue. Validate realistic payload size and quantity, but do not claim to verify exercise. All limits return Retry-After and preserve local pending reps.

The check-in RPC enforces a fixed UTC minute budget including receipt replays and validated error requests. Usage saturates at121 and resets on a new minute. RATE_LIMITED returns HTTP429 and Retry-After seconds. A transient rolled-back transaction does not retain budget state or any partial accepted record. The RPC bounds its parsed envelope at32KB; deployment ingress limits must also bound raw HTTP bodies. Profile/record lock waits are bounded at5seconds and requests at10seconds. Import transport batching/queue limits remain a T12 concern.

Guest feed endpoint needs gateway limits; a mobile publishable API key is not a secret or proof of a unique person. Do not solve abuse by embedding a privileged secret in the app.
# Client protocol validation (T11)

Guest import uses the existing single CREATE RPC with source=import and requested_public_epoch=null. A local batch of at most50 selections creates independent stable mutation receipts; no unimplemented server batch endpoint is called. NOT_FOUND_OR_FORBIDDEN for an import CREATE permits a durable destination remap without exposing the other owner; ENTITY_EXISTS carries only the authenticated owner's snapshot and is checked for identical imported content before acknowledgment.

Mutation and check-in UUIDs use versions1-8 with RFC variant bits, case-insensitively accepted and normalized lowercase. Accepted record revisions are positive decimal int64 strings; pull cursor0 represents a fresh client. Clients validate bounded, strictly ordered pages and retain precision beyond JavaScript safe integers. Imported records cannot have public epoch/region metadata. Authentication is attached as a verified bearer session; no user ID is submitted in mutation or pull bodies.
