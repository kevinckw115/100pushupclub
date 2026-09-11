# Progress

## Current state

T01-T07 implemented on separate task branches. Local tracker has automated domain, real SQLite and browser evidence. Native device/build gates remain open. See the evidence ledger for exact limitations.

## Current task

T17/T18 implemented with passing CI; T18 final877e64e includes the full circle browser flow. T19 client9453e69 is awaiting connected CI;54 SQLite tests and real guest export passed. T20 independent compact browser/keyboard/heading review passed, but native A34 is blocked by missing iOS/Android targets/toolchain. Next: T21 resilience/performance on a new branch while finishing T19 CI. Hosted scheduling, support/domain/retention and native device gates remain open.

## Fixed direction

Option5 Cream & Brick; local guest; email OTP account; offline-first personal logging; opt-in public feed; private circles; no social posting or rankings.

## External dependencies

Native build target, development Supabase and OTP delivery, region dataset, production/store ownership. None prevents beginning local implementation.

## Session update template

Date / task / files changed / exact checks / evidence paths / implemented vs verified / blocker if any / next action. Preserve previous entries beneath the current summary.

## 2026-09-10: T01

Branch task/t01-toolchain-bootstrap. App scaffold, Router, lockfile, dev/preview configs, CI and check scripts implemented. See [exact evidence](evidence/T01.md). Commands from apps/mobile: npm.cmd ci; npm.cmd run lint; npm.cmd run typecheck; npm.cmd test; npm.cmd run test:integration; npm.cmd run doctor; node node_modules/expo/bin/cli export --platform web. Full export blocked by Hermes spawn EPERM. Native target and Python unavailable. Next: T02 components, then T03 real SQLite; independent missing-gate exception documented in T01 evidence. Each task gets a new branch stacked on the prior task commit.

## 2026-09-10: T02

Branch task/t02-design-components. Shared UI implemented; browser component review passed, screenshots inspected. Commands: npm.cmd run typecheck; npm.cmd run lint; node node_modules/expo/bin/cli export --platform web --dev --no-minify; node scripts/review-components.mjs (with preview server running). Native text/keyboard/accessibility gates remain open. Next: T03 domain and real SQLite repository on a new branch.

## 2026-09-10: T03

Branch task/t03-domain-sqlite. Domain, migrations, Expo SQLite driver and transactional repository implemented. 5 unit and 8 integration checks passed; typecheck/lint passed. Exact evidence in evidence/T03.md. Native adapter awaits a target. Next T04: durable guest onboarding and Today using actual storage, on a new branch.

## 2026-09-10: T04

Branch task/t04-guest-today. Durable guest onboarding and Today implemented. Web export and node scripts/review-guest.mjs passed; screenshots inspected. Typecheck/lint passed. Native first-launch gate unavailable. Next T05: logging, editing, deletion and Undo on a new branch, with actual saved 0/35/100/125 UI checks.

## 2026-09-10: T05

Branch task/t05-log-edit-undo. Durable logging, editing, deletion, Undo and explicit large-entry confirmation implemented. 11 integration tests and node scripts/review-logging.mjs --failure passed against real SQLite; screenshots inspected. npm.cmd ci reapplies scoped Expo SQLite web bridge patch. Native Maestro flow added but requires device/build. Next T06: history pagination and day refresh; T07 reminders afterward. Each gets its own branch.

## 2026-09-10: T06

Branch task/t06-history-day-boundaries. History and day watcher implemented. Seven unit and12 integration tests passed; node scripts/review-history.mjs passed with controlled browser clock and real SQLite. Typecheck/lint passed. Next T07: preferences and local reminders on a new branch; native tests require target setup.

## 2026-09-10: T07

Branch task/t07-preferences-reminders. Local preferences, haptics and notification adapters implemented. Eleven unit checks, typecheck/lint and Doctor21/21 passed. npm.cmd run export:web and node scripts/review-settings.mjs passed; ordinary bundle excludes review/test modules. npm.cmd run build:review then node scripts/review-logging.mjs --failure passed and removed generated routes. Native A33 needs a device/build. Asked about native target and Expo/Supabase project setup; no response yet. Next T08 on a new branch: real backend schema and authorization tests.

## 2026-09-10: T09 in progress

New branch task/t09-auth-partitions. Email OTP, session chunks and partition signout implemented; real SQLite and storage fault tests pass. Disposable Supabase OTP/browser checks queued for CI. Native secure storage and hosted email delivery still need owner setup. Next: resolve CI and record T09 evidence, then T10 checked mutation/pull RPCs on a new branch.

## 2026-09-10: T10 in progress

New branch task/t10-mutation-pull-api. Added checked mutation/pull functions, bounded replay-aware request budget, immutable changes/receipts, canonical validation and decimal cursors. Backend tests cover real concurrent HTTP/SQL writes, rollback and read waiting. Commands: node --check tools/backend/tests/mutations.test.mjs passed. Fresh Supabase reset/runtime tests will run in GitHub Actions (local native Supabase executable still blocked). Next: fix any CI failures, then T11 worker on its own branch.
