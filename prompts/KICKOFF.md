# Codex kickoff prompt

Build the complete V1 of 100pushupclub from this repository's development package. Read AGENTS.md, START_HERE.md, docs/02-decisions.md and tracking/PROGRESS.md first, then the documents relevant to the earliest unblocked task in tracking/tasks.json.

The approved design is Option 5 Cream & Brick. Use design/tokens.json, design/DESIGN_SYSTEM.md and design/option-5-cream-brick.png. Implement real native UI; do not embed screenshots as the interface. Keep the app quiet and beginner-friendly, with no posts, chat, likes, rankings or invented activity.

Inspect the workspace and toolchain. Preserve the package; scaffold the Expo app under apps/mobile. Run the package baseline checks, choose verified compatible dependencies, record versions and create the lockfile. Implement the full backlog in docs/09-build-plan.md in dependency order, beginning with a usable local tracker and continuing through accounts, sync, community, circles and release readiness.

Use the API/data/sync contracts as a single source of truth. Prioritize durable local saves, retry idempotency, account separation, consent and backend authorization. Implement real integration tests for these; the included reference model is not a replacement for SQLite/PostgreSQL testing.

Proceed autonomously on documented defaults and reversible implementation. Keep tracking/tasks.json, tracking/PROGRESS.md and tracking/EVIDENCE.md current. At each milestone provide actual screenshots/build instructions and evidence. Do not stop after M1 unless I ask or all remaining work is genuinely blocked. If external access is missing, finish independent work and state the exact unblock steps.

Never mark a device test or deployment as passed unless it ran. Distinguish implemented, automated-verified, native-verified and blocked. Prepare a reviewable release packet before any action requiring further authorization. Start now with repository/toolchain inspection and T01.
