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
