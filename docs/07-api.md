# API contract

Names below are normative operations. Implement authenticated PostgreSQL RPCs or an Edge Function facade as appropriate. HTTP facades authenticate JWTs before database access and use user-scoped operations; privileged service credentials must never turn a submitted user_id into authorization. All responses have request_id; logs must not include payloads with email or auth tokens.

## Common conventions

- JSON input maximum 32 KB per single mutation; import batch maximum 50 entries and 512 KB. Reject oversize early.
- IDs UUID strings, revisions/epochs decimal strings, dates YYYY-MM-DD, timestamps ISO 8601 UTC. Schema validation exists both client-side and server-side.
- Error `{code, message, retryable, request_id, current_record?}`. Stable codes: INVALID_QUANTITY, INVALID_TIMEZONE, INVALID_LOCAL_DATE, CLOCK_AHEAD, UNAUTHENTICATED, ACCOUNT_UNAVAILABLE, NOT_FOUND_OR_FORBIDDEN, VERSION_CONFLICT, ENTITY_EXISTS, IDEMPOTENCY_KEY_REUSED, RATE_LIMITED, INVALID_CURSOR, INVITE_EXPIRED, CIRCLE_FULL, QUOTA_EXCEEDED.
- Never expose SQL errors, token material, another owner's record, or exact locations in errors.
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

All mutating operations beyond check-ins also require idempotency records appropriate to their operation. Their database writes, quotas and receipt must commit atomically. Rate limits still apply to replays to prevent endpoint flooding.

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

Aggregate scope threshold uses eligible unique contributors in the past 24 hours. If a narrow region is below 10, walk ancestors to the first eligible one or World. Compute counts/items under the same eligibility predicate and consistent snapshot. Authenticated responses vary by block list; never put them in a shared unauthenticated cache. Cache public guest responses at most 10 seconds with explicit visibility-change purge. Disable cache if purge correctness is unproven.

## Circle DTO

Return circle id/name/timezone/date, total_reps decimal string, checked_in_count, active_member_count, hidden_activity boolean, and member rows `{member_id, username, total_reps, checked_in, is_self}`. No individual check-in times or quantities are needed. member_id is a circle-scoped opaque identifier; management resolves it after authorization. Member list order is case-insensitive alias plus stable ID, not rep count.

## Abuse budgets (initial configurable defaults)

Authenticated check-in mutations: 120/minute/account; public feed: 30/minute/session plus gateway IP protections; invite preview: 10/minute/source and bounded global budget; report: 10/hour/account. Imports use a separately bounded queue. Validate realistic payload size and quantity, but do not claim to verify exercise. All limits return Retry-After and preserve local pending reps.

Guest feed endpoint needs gateway limits; a mobile publishable API key is not a secret or proof of a unique person. Do not solve abuse by embedding a privileged secret in the app.
