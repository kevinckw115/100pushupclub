# Progress

## Current state

PR #1 is merged into main at a05484a8efddfbe80ac3a9491b899c82f0c6dee6; backend, mobile and package CI all passed that commit. T01-T19 implementation and T20-T23 independent work are present. Native and hosted release gates remain open.

## Current task

Current branch: task/fix-staging-project-target. Preparing manual staging migration preview/apply and browser instructions in docs/14-staging-deployment.md. No hosted migrations have been applied by this task. Historical implementation evidence follows: T19 deletion-status retry fix0f4c930 passed all CI, including actual export/deletion/cleanup browser flow; screenshot inspected. T21 forced-exit,100k local records,100k backend/100-client load and populated upgrades passed. Combined source9b06540 passed backend34623108975, mobile34623108995 and package34623108976; backend load p95=50ms on disposable CI localhost. T22 preview/credential guards, bundle audit and aggregate operations diagnostics are implemented. T20 native accessibility and T22/T23 signed-build/device/beta gates are blocked by missing owner/native/hosted setup. See docs/12-operations-runbook.md and docs/13-beta-review.md.

## Fixed direction

Option5 Cream & Brick; local guest; email OTP account; offline-first personal logging; opt-in public feed; private circles; no social posting or rankings.

## External dependencies

Native build target, development Supabase and OTP delivery, region dataset, production/store ownership. None prevents beginning local implementation.

## Session update template

Date / task / files changed / exact checks / evidence paths / implemented vs verified / blocker if any / next action. Preserve previous entries beneath the current summary.

## 2026-09-21: Browser-operated staging migrations

Branch task/staging-deployment-workflow, based on merged main a05484a. Added manual preview/apply workflow, staging target and reviewed-commit validation, negative guard tests and docs/14-staging-deployment.md. Updated stale branch guidance. Local verification: node --test tests/*.test.mjs passed33/33; workflow parsed with installed yaml package; git diff --check passed. Main backend/mobile/package CI success verified through GitHub API. No local Supabase CLI execution or hosted migration attempted because of ThreatLocker; no native testing. Owner confirms GitHub staging settings and Expo account; environment metadata inspection returned403. Next: merge reviewed workflow after CI, run preview from GitHub Actions on main, inspect migration list, then explicitly apply with reviewed SHA. Expo owner/project identity remains required for cloud builds.

## 2026-09-19: PR #1 Expo dependency validation fix

Updated apps/mobile/package.json and package-lock.json for Expo, notifications, sharing and Router patch compatibility. The lockfile resolves Expo57.0.24, notifications57.0.20, sharing57.0.21 and Router57.0.22; current Doctor also required the Router update. Existing expo-sqlite57.0.3 patch remains applied.

Automated verification on Windows with Node24.19.0: clean npm ci --ignore-scripts=false passed before the final Router update; final dependency tree passed node node_modules/expo-doctor/build/index.js (21/21), node node_modules/eslint/bin/eslint.js ., node node_modules/typescript/bin/tsc --noEmit, node --test --test-reporter=dot tests/*.test.ts (23), node --test --test-reporter=dot tests/integration/*.test.ts (56), and node scripts/export.mjs (web/iOS/Android plus bundle audits). Commands run from apps/mobile. No native-device testing performed; existing release gates remain open. Next action: verify GitHub validation on the pushed PR commit.

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

## 2026-09-11: T19-T23 completion work

Separate task branches pushed for deletion/export, accessibility, resilience, delivery and beta review. Local commands from apps/mobile: npm.cmd test (23 passed), npm.cmd run typecheck (passed), npm.cmd run lint (passed), node --test tests/integration/resilience.test.ts (2 passed), node --test tests/integration/privacy.test.ts (4 passed), npm.cmd run export:web (passed;4 textual artifacts audited). Root node --test tests/release-bundle.test.mjs passed. Full Hermes and disposable Postgres/Auth/browser checks run in GitHub Actions; final results are recorded in task evidence. No native target or hosted deployment was used.

Next action: supply owner Expo/project/signing identifiers, a native iOS and Android target, hosted development Supabase/OTP, support email/domain and actual retention/scheduled-deletion/staff setup. Follow the setup order in docs/13-beta-review.md; perform one-week real beta and log actual findings. Production remains fail-closed; no store submission or invitation sent.

## Staging target configuration correction

User preview log showed an empty SUPABASE_PROJECT_ID while both secrets were available. The exact GitHub variable-resolution cause is unverified. Pinned the public staging reference directly in the workflow, retaining the independent target guard; no operator variable is now required. Updated browser runbook. Verification: node --test tests/staging-guard.test.mjs passed3/3; parsed actual workflow YAML and passed its target into validateStaging with test credentials successfully; git diff --check passed. No hosted changes applied. Next: merge this task branch and start a fresh main/preview workflow run (rerunning an old job uses old workflow code).
