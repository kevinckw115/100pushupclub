# Acceptance and verification matrix

These are required product tests to implement, not assertions that have already passed. Reference tests in this handoff cover only a subset of pure rules. Use injected clocks and deterministic IDs for tests, real SQLite for persistence, real local Supabase/PostgreSQL for authorization and concurrency, and native automation/manual evidence for device behavior.

| ID | Given / action / expected | Layer | Task |
|---|---|---|---|
| A01 | Fresh install offline → log 5 → total 5 persists after restart | SQLite + native | T04,T05 |
| A02 | 20 + 15 → total 35, remaining65, ring35%; 100/125 cap ring at100% | Domain + UI | T05 |
| A03 | Empty/0/-1/decimal/NaN/1000 rejected; 1 and999 accepted | Domain + API | T05,T10 |
| A04 | Double tap same in-flight Save → one record | UI + SQLite | T05 |
| A05 | DB commit fails → draft remains, no success/haptic or phantom total | Fault-injected repository + UI | T05 |
| A06 | Undo unsent/sending/accepted create → no final contribution, no duplicate | SQLite + real API | T11 |
| A07 | Past quantity edit/delete → daily metrics recomputed, date unchanged | Domain + SQLite | T06 |
| A08 | LA midnight and DST transitions → correct captured date; foreground refresh | Clock + native | T06 |
| A09 | Travel changes current Today but old entry date does not move | Domain | T06 |
| A10 | Server accepts request, response lost, retry exact body → same receipt/version/revision | Concurrent API/DB | T10,T11 |
| A11 | Mutation ID reused with different body → rejected, prior row unchanged | API/DB | T10 |
| A12 | Device A/B update same version → one accepted, other explicit conflict | Concurrent DB + UI | T11 |
| A13 | Edit races deletion → no tombstone resurrection | DB + UI | T11 |
| A14 | Crash between pull apply and cursor save → transaction rollback/replay loses nothing | SQLite fault injection | T11 |
| A15 | Delayed transaction + later write → cursor cannot miss committed changes | Concurrent Postgres | T10 |
| A16 | Account switched while response pending → no rows/session state cross partitions | Integration | T09,T11 |
| A17 | Guest import interrupted/repeated → exactly one copy, private, absent from circles | SQLite + DB | T12 |
| A18 | Another account queries/writes raw check-ins or owner IDs → denied | Real JWT/RLS | T08,T10 |
| A19 | Public off, deleted, import, old epoch, suspended → absent from feed AND counts | API/DB | T14,T16 |
| A20 | Offline create from prior consent epoch after disable/re-enable → personal save, private | Integration | T14 |
| A21 | Region has9 vs10 eligible users → fallback vs local; actual label truthful | API fixtures | T13,T14 |
| A22 | Feed/cursor/errors/realtime payload inspection → no private IDs/email/exact event time/location | API/native network | T14,T15 |
| A23 | 24h boundary/edit/delete → sums and distinct people accurate under same snapshot | DB | T14 |
| A24 | Block A/B → bilateral rows hidden and viewer counts consistent; cache not shared | API/UI | T16 |
| A25 | Realtime drops/reconnects → safe refetch; background stops; no scroll jump | Native integration | T15 |
| A26 | Two concurrent joins for last slot → one accepted, group never exceeds20 | Concurrent DB | T17 |
| A27 | Expired/revoked invite or removed member's JWT/socket → no read/join leak | API/realtime | T17 |
| A28 | Join/rejoin → no pre-join/imported history; zero members shown neutrally | DB/UI | T18 |
| A29 | Circle LA day vs Tokyo personal day → each correct and timezone labeled | Domain/DB/UI | T18 |
| A30 | Ordinary user calls staff tool → denied; staff action audited | API | T16 |
| A31 | Deletion accepted → public hidden/new writes denied immediately; retry completes cleanup | DB/auth/job | T19 |
| A32 | Export → only own records; guest export works without account | Integration | T19 |
| A33 | Reminder denied/re-enabled/time changed/goal achieved → correct per-device scheduling | Native iOS/Android | T07 |
| A34 | Screen readers/text200%/reduced motion/keyboard → every core action accessible | Native/manual | T20 |
| A35 | Release config → no demo adapters, fixtures, secrets, fake counts or dev endpoints | Bundle/config inspection | T22 |
| A36 | DB migration from previous fixture → no lost records and sync resumes | SQLite/Postgres | T21 |
| A37 | Both platforms log offline, recover account, join circle, delete account | Real device end-to-end | T23 |

## Test layers and commands to establish

During T01, define real scripts in apps/mobile/package.json for lint, typecheck, test, test:integration and an appropriate native E2E runner. Choose compatible maintained tooling and record it. Root `npm test` remains the reference-package check; do not report it as app coverage.

Use `supabase db reset` and `supabase test db` against a disposable local project once configured. Schema tests must check denied operations using client roles, not just service role. Concurrent transaction tests may require a separate integration runner and two database connections; a sequential pgTAP assertion is insufficient for commit-order races.

Native E2E can use a compatible runner such as Maestro, selected and pinned during setup. A screenshots-only browser test does not prove native persistence. If a target cannot be run, record it as not run with the exact requirement to unblock.

## Fixture rules

Use [scenarios.json](../fixtures/scenarios.json), fixed clocks and named test accounts. The design fixture has personal35 and circle185. Public3460 is an illustrative display fixture, not derived from the four visible feed entries; the API fixture generator must create a full underlying dataset if asserting its aggregate. Never confuse a visible feed page sum with all eligible records.

Synthetic fixtures must be isolated to tests/local development. Real beta empty states are valid. Test privacy with records that would be included absent one specific constraint, so tests can detect missing predicates.

## Evidence grades

1. SPECIFIED: contract exists.
2. IMPLEMENTED: code exists, not necessarily exercised.
3. AUTOMATED: named reproducible check passed in recorded environment.
4. NATIVE: device/emulator behavior inspected, target and build identified.
5. BETA: actual users exercised the flow and findings resolved.

Release-critical native gates need both relevant automated and native evidence. A percentage coverage number alone is not a completion criterion. Capture screenshots using sanitized test accounts and attach paths in the evidence ledger.
