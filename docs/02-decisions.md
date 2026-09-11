# Decision log

Status key: **Approved** = explicit user direction. **Default** = architect-selected for implementation, changeable by the user. Defaults do not require reconfirmation before work.

| ID | Status | Decision | Reason |
|---|---|---|---|
| D01 | Approved | Name 100pushupclub; 100 reps/day; any set size | Original concept |
| D02 | Approved | Quiet, kind strength; only check-ins; no attention economy | Product identity |
| D03 | Approved | Geographic community and group features | Shared motivation |
| D04 | Approved | Option 5 Cream & Brick visual direction | Selected mockup |
| D05 | Default | React Native / Expo / TypeScript; Supabase; SQLite | Shared mobile code with managed backend |
| D06 | Default | Light mode only for V1 | Protect visual quality and scope |
| D07 | Default | Local guest; email OTP permanent accounts; no anonymous cloud users | Works on first launch offline; simple recovery and import |
| D08 | Default | 1–999 per entry; >100 confirmation; no total cap | Mistap protection without punishing participation |
| D09 | Default | Immutable captured local date; no backdating UI | Predictable history and smaller conflict surface |
| D10 | Default | Outbox, idempotent mutations, per-record versions | Retry safety and explicit multi-device conflicts |
| D11 | Default | Public off; current-consent epoch; future eligible entries only | No accidental retrospective sharing |
| D12 | Default | Community rolling 24h / 1h; circle fixed timezone | Accurate cross-border counts |
| D13 | Default | Broad manual geography; k=10 contributors for narrow scope | Reduced location disclosure and no GPS permission |
| D14 | Default | Private circles 2–20 intended members; 20 enforced max; 5 active circles/user | Small-group accountability and bounded V1 |
| D15 | Default | Email-only accounts; no social login/payments | Reduce external setup and authentication paths |
| D16 | Default | Local optional reminders; no community push notifications | Keep app quiet and avoid notification infrastructure |
| D17 | Default | Report/block aliases and circle names; basic staff moderation | User-entered names still create abuse surface |
| D18 | Default | Adults-first beta positioning; no DOB collection in V1 | Avoid designing a child-focused service by accident |
| D19 | Default | World feed readable through sanitized endpoint for guests | Community motivation before signup |
| D20 | Default | Invitation via expiring opaque link plus pasteable code | Usable before universal links are configured |
| D21 | Default | GeoNames versioned country/admin1/admin2 directory, with broad-locality curation | Concrete source for manual geographic selection |

## Changes to the earlier concept that are intentional

- Club aggregate label is “pushups in the past 24 hours,” not “pushups today.”
- Private circle “Today” includes its timezone and may differ from personal Today.
- Public user-entered names receive report/block controls; these do not add social posting.
- Sensitive raw timestamps and records do not stream to public devices; realtime signals trigger safe refetches.
- The screenshot's numbers are QA fixtures only. Real empty states are part of launch quality.

## Choices deferred until setup, not implementation blockers

Owner-controlled developer organization and store seller name; available reverse-domain app identifier; production region/data residency; support address and policy website; brand/name availability checks; distribution countries and final store age rating. Use clearly named local placeholders and document them; do not invent verified ownership or legal clearance. Reassess relevant requirements at release using official sources.

## ADR change template

### 2026-09-11 / ADR-010 / Deletion recovery after Auth removal and bounded exports

T19 adds recent signed-AMR/session verification, atomic deletion marking/session revocation and a server-only phased cleanup worker. Automatic circle ownership follows the existing earliest-member rule. The client supplies a random status capability before submission; its hash is retained independently of deleted Auth data. This permits anonymous proof-based status-only recovery after a lost response or token expiration without recreating an account. Status exposes no identity/content. Own export uses bounded UUID pages and a stable check-in revision check; concurrent changes require explicit restart. API/data/sync/types and real Auth/rollback/worker tests change together. Hosted scheduling, gateway limits, support and actual retention disclosures remain setup gates. Official semantics: https://supabase.com/docs/guides/auth/jwt-fields , https://supabase.com/docs/guides/auth/sessions , https://supabase.com/docs/reference/javascript/auth-admin-deleteuser .

### 2026-09-11 / ADR-009 / Checked circle intervals, quota locking and invitations

T17 implements contributor and viewer current-interval cutoffs on both event and server creation time, preventing newcomers from reading prejoin history. Random per-membership IDs rotate on rejoin; checked safety resolution maps them internally. Sorted user advisory/profile locks precede circle locks so20-member and5-circle limits remain atomic across concurrent joins. Authenticated invite preview uses10/account/minute plus300/global/minute budgets. SHA256-only invitation storage supports retryable creation through a private HMAC-derived256-bit code, code-free receipts and live owner/revocation checks. Transfer revokes previous owner's links. API/data/sync/types and real JWT, transaction, timezone and rollback tests change together. No hosted deployment. PostgreSQL17 primitives: https://www.postgresql.org/docs/17/explicit-locking.html and https://www.postgresql.org/docs/17/pgcrypto.html.

### 2026-09-11 / ADR-008 / Participation and checked safety operations

T16 makes documented participation acceptance explicit as versioned profile data and a database constraint. Existing opt-ins are turned off with epoch invalidation until acceptance; personal offline logging remains independent. Block/report operations use visible public subjects, caller-owned durable receipts and bounded budgets. Staff authorization uses a private enabled-account registry, with atomic append-only audits and no client role claims. Required names are hidden/replaced immediately; suspension/restoration never republishes old public history. API/data/sync/TypeScript contracts and real JWT/rollback tests change together. No hosted staff account or production deployment is provisioned by this implementation.

### 2026-09-11 / ADR-007 / Current public eligibility and opaque pagination

T14 adds idempotent checked profile mutations with expected consent epochs. Alias-only edits preserve epochs; actual sharing toggles and region changes increment them, invalidating previous contributions. Public actor/entry IDs are independently random and immutable. Feed cursors use pgcrypto PGP AES256 encryption with integrity protection and a private generated key, binding viewer, requested/effective scope, 15-minute window anchor, boundary and initial PostgreSQL snapshot. Check-in creation_xid captures the top-level transaction ID so a delayed commit cannot enter an older page; current quantities, consent, deletion, suspension, moderation and blocks still apply on every read. The same materialized eligibility set drives sparse-scope selection, rows and counts. No public response cache is enabled. Authenticated feed budgets are30/minute/session; guest gateway limits remain a deployment gate. Data/API/sync/TypeScript contracts and real concurrency/privacy tests accompany the migration.

### 2026-09-11 / ADR-006 / Versioned public region directory

T13 implements D21 using the checked September11 GeoNames snapshot and its CC BY4.0 attribution. Countries/first-level regions are included; only US counties/equivalents are promoted to broad localities. Stable geoname-backed IDs retain source codes independently of ISO assumptions. The private directory adds source_code, active status, normalized search indexes and a version manifest. Public list_regions and resolve_region RPCs expose labels and hierarchy only, with50-row limits, scope/version-bound opaque cursors and active-ancestor fallback. Manual browsing choice persists locally per partition; account region/privacy mutation remains the T14 consent contract. No GPS, geocoding calls or source coordinates enter profiles. Generated data is an initial migration; future data releases require separate reviewed migrations.

### 2026-09-11 / ADR-005 / Explicit durable guest import

T12 snapshots at most50 selected guest records per consent transaction. Migration4 extends the existing deduplication ledger with immutable source content, collision/retry state and cleanup markers. Source and mutation IDs persist across restart. Another-owner create collision remaps a new destination/mutation atomically; same-owner identical imported content is acknowledged, while mismatches require an explicit choice. Signout pauses incomplete imports and clears account response snapshots; explicit resume uses the original request to resolve uncertain acceptance. Import copies cannot be edited until acceptance, preserving the consent snapshot. Cleanup removes only unchanged guest copies with a currently confirmed matching account snapshot, after pending/conflicting imports are resolved. No server API changes; imports use checked CREATE with source=import and null public epoch, retaining original dates and exclusion from circle history.

### 2026-09-10 / ADR-004 / Durable client reconciliation

T11 records acknowledged parent versions, retry delays and unresolved sync issues in SQLite migration3. Dependent edits use the exact parent acknowledgment version even if a newer snapshot has arrived; they never silently overwrite that newer version. Accepted snapshots and pull cursors commit together while local intent remains visible. An unaccepted optimistic deletion may be cancelled explicitly; guest deletions and accepted server tombstones remain permanent. Replacement check-ins use a fresh ID and current recorded time with no public consent epoch. Client and initial server mutation UUID validation now agree on versions1-8 and RFC variant bits, preventing accepted but unreadable records. There is no deployed database to migrate. Data/API/sync contracts and failure/concurrent-client tests accompany this change.

### 2026-09-10 / ADR-001 / Profile bootstrap transport and operation receipts

The API already required idempotency for non-check-in writes but left their receipt storage and profile envelope implicit. T08 defines separate operation_receipts, typed own-profile envelopes with request IDs, and an informational bootstrap revision. Replays recheck live account availability. A bootstrap revision never initializes a pull cursor, preventing a new device from skipping existing history. No product visibility or ownership rule changes. API, data, sync and TypeScript contracts updated together; real JWT, receipt-replay and concurrency tests added. Initial schema only, so no existing production data migration is needed.

Date / ID / prior decision / new decision / user direction or evidence / impacted contracts and tests / migration or compatibility consequences. Keep old records rather than silently rewriting history.

### 2026-09-10 / ADR-002 / Development auth transport and session persistence

T09 allows HTTP only for development Supabase loopback endpoints (localhost,127.0.0.1,Android emulator10.0.2.2 on port54321). Preview/production retain HTTPS. This enables disposable connected UI tests without hosted secrets. Native sessions use SecureStore with journaled two-slot rotation; web preview sessions are memory-only and require sign-in after reload. Installation/logout markers reside in SQLite and contain no tokens. These are implementation details of the existing auth contract; no public data or server ownership change. Tests cover rotation write failures, Unicode size, real SQLite cleanup and real Supabase OTP.

### 2026-09-10 / ADR-003 / Checked mutation and pull transport

T10 makes request IDs explicit in accepted mutation/pull types, adds validation/transient error codes, and defines PostgreSQL RPC argument wrappers. Strict quantity/time/date/source/epoch validation precedes acceptance; the reference five-minute future-clock tolerance becomes explicit. An account fixed-minute budget includes receipt replays and commits ordinary rejection counts, while transaction failures roll back everything. Pull shares the profile lock and reads one bounded snapshot page. Data/API/sync/TypeScript contracts updated together. New private budget table and immutable-snapshot triggers ship in a separate migration; no existing production deployment is changed. Real Postgres/JWT tests verify the transport, locks, rollback and privacy boundaries.

### 2026-09-11 / ADR-011 / UTC validation fast path

The100k-record resilience setup exposed repeated generation of PostgreSQL timezone metadata in the row trigger. Forward migration010 recognizes the always-valid exact name UTC directly; all other names retain catalog validation. Date consistency, immutable fields and tombstones are unchanged. Tests reject invalid names and inconsistent UTC dates without disabling constraints. No API/data/sync contract changes or timezone-rule cache were introduced.
