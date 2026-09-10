# Ordered implementation backlog

All tasks are pending at handoff. [tasks.json](../tracking/tasks.json) is the machine-readable dependency graph. Finish V1; do not stop permanently at M1. Each task must include functioning code, relevant tests, and evidence. A missing external service may block its integration gate while independent tasks continue.

## M0 — foundation

| Task | Dependencies | Deliverable | Required acceptance |
|---|---|---|---|
| T01 Toolchain/bootstrap | none | Expo TypeScript app under apps/mobile, Router, lockfile, build configs, lint/typecheck/unit CI | Fresh install reproducible; expo-doctor reviewed; placeholder screen runs on available native target; versions recorded |
| T02 Design components | T01 | Tokens, screen shell, navigation, buttons, ring, sheet, rows | Option 5 screenshots; 35%/100% ring; 48px targets; no clipped large text |
| T03 Domain/SQLite | T01 | Production domain layer, versioned local schema, transactional repositories | Real SQLite persistence across close/reopen; migration fixture upgrade; invalid data rejected |

M0 exit: compatible project exists and layout/data foundations work. Handoff tests alone do not satisfy this milestone.

## M1 — personal tracker

| Task | Dependencies | Deliverable | Required acceptance |
|---|---|---|---|
| T04 Guest onboarding/Today | T02,T03 | First-run guest, active partition, total/date states | First launch offline; 0/35/100/125 screens; account data never in guest |
| T05 Log/edit/delete/undo | T04 | Durable logging, presets/custom input, >100 confirm, corrections | 20+15=35; one double-tap effect; crash/restart survives; Undo and failure paths |
| T06 History/day boundaries | T05 | Daily history, pagination, immutable date rules | Midnight and foreground refresh; DST and travel fixtures; past edit updates metrics |
| T07 Local preferences/reminders | T05 | Haptics, optional one-shot reminders, permission flow | Denied permission harmless; local timezone schedule; no duplicate reminder; cancel today's on completion |

M1 exit: Kevin can use a real local tracker on a phone. Capture native screenshots and install instructions. If device access is absent, mark native review blocked and continue backend/local automated work.

## M2 — account integrity

| Task | Dependencies | Deliverable | Required acceptance |
|---|---|---|---|
| T08 Server schema/security | T03 | Migrations, constraints/indexes, grants/RLS, local seeds | Fresh reset passes; A/B/guest denial tests; alias uniqueness race |
| T09 Auth/partition lifecycle | T04,T08 | Email OTP, secure storage adapter, recovery/signout | Code expiry/retry; cold start; account switch ignores old responses; no token logs |
| T10 Mutation/pull API | T08 | Transactional checked RPCs, receipts, changes/cursor | Real Postgres duplicate requests, concurrency, version conflict, rollback/pull tests |
| T11 Client synchronization | T05,T09,T10 | Outbox worker, replay, optimistic projection, conflict UI | Lost response; in-flight undo; two-device edit/delete; atomic pull cursor; network recovery |
| T12 Guest import | T09,T11 | Explicit consent, durable import mapping and cleanup | Import twice/restart halfway; existing account; UUID collision; no public or circle history leakage |

M2 exit: two account-backed clients converge without lost or duplicate accepted reps. This is the primary correctness gate before adding public feeds.

## M3 — community

| Task | Dependencies | Deliverable | Required acceptance |
|---|---|---|---|
| T13 Region directory | T08 | Licensed/versioned country-admin-locality import; search; manual picker | Consistent ancestor lookup, missing region fallback, provenance, no GPS permission |
| T14 Consent/public queries | T10,T13 | Epoch preferences, sanitized feed, aggregates, sparse fallback | Off/private/import/deleted/old-epoch excluded; toggle/create race; cursor does not expose exact time |
| T15 Club interface/live refresh | T02,T09,T14 | Scope tabs, safe feed, background behavior, invalidation/fallback polling | Two real accounts; 24h/1h labels; stale state; new-row scroll behavior; bounded refresh |
| T16 Report/block/moderation | T09,T14 | User controls + authenticated staff tools/audit | Bilateral filtering, ordinary-user staff denial, cache purge, suspended-user exclusion |

M3 exit: real opt-in activity appears with accurate labels and no private field leakage. Capture raw client response inspection as evidence.

## M4 — small groups

| Task | Dependencies | Deliverable | Required acceptance |
|---|---|---|---|
| T17 Circle backend | T10,T16 | Membership rules, quotas, invites, ownership, authorized reads | Concurrent final-slot joins; invite revoke/expiry; removed member denied; join-time filters |
| T18 Circle UI | T02,T09,T17 | List/create/join/detail/manage routes; share/copy code | Consent shown; 185 fixture; alphabetic all-member list; fixed timezone; leave/transfer flows |

M4 exit: real users create/join/leave a circle, and membership changes promptly change authorized access. No public leaderboard or chat added.

## M5 — release readiness

| Task | Dependencies | Deliverable | Required acceptance |
|---|---|---|---|
| T19 Deletion/export/support | T12,T16,T18 | Export, in-app deletion + verified web request, cleanup job, policy/support surfaces | Deletion interrupts writes; old token denied; owner cleanup; retries; export excludes peers |
| T20 Native accessibility/visual | T06,T07,T15,T18,T19 | Full screen-state polish on both platforms | VoiceOver/TalkBack, text 200%, small screens/keyboard, reduced motion, all Option 5 states |
| T21 Resilience/performance | T11,T15,T18,T19 | Load/query benchmarks, recovery drills, redacted telemetry | 100k-record/100-client initial budget; offline/foreground loops; migrations preserve data |
| T22 Delivery/operations | T19,T20,T21 | Dev/preview/production config, CI gates, beta builds, release runbook | No demo/secret flags in release; tested migration/rollback path; store assets and declarations prepared |
| T23 Beta acceptance/fixes | T22 | Small mixed-ability user beta, triaged findings, fixes | Actual device evidence; blocker defects zero; no known lost/duplicate records; user validates warmth/speed |

M5 exit: release candidate with accurate evidence and a concrete owner review packet. Actual submission/publishing follows current user authorization and available accounts; record any store review outcome separately.

## Task completion protocol

For each Txx append evidence: commit/hash if available, changed files, exact commands and exit codes, environment, screenshots/native target, API/DB scenario proof, known limitations. Update tracking state to in_progress/implemented/verified/blocked as appropriate. Only verified satisfies downstream dependencies unless the downstream work is explicitly independent of the missing gate and that exception is documented.

Do not downgrade a required test because a mock version passes. Do not repeatedly run unrelated suites after a task's risks are resolved. Preserve a clean path from fresh checkout to each check.
