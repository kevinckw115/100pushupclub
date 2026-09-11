# 100pushupclub — Codex development package

Version 1.0 · September 10, 2026 · Target: iPhone and Android

**Start with [current progress](tracking/PROGRESS.md).** The [Expo mobile app](apps/mobile/README.md) now includes durable logging, account synchronization, opt-in Club activity, private circles, safety controls, export and account deletion. Work is committed on separate stacked task branches; `task/t23-beta-review` contains the combined implementation. Native device, hosted operations and beta gates remain open; this is not a release-ready app.

For local guest use, run `npm ci` then `npm run web` from `apps/mobile` with Node24.12+. Use `npm.cmd` on Windows if PowerShell blocks npm.ps1. Connected testing uses a disposable Supabase stack in CI; an owner-configured development backend and OTP delivery are needed on phones. See the [operations runbook](docs/12-operations-runbook.md), [beta review packet](docs/13-beta-review.md) and [source candidate record](tracking/review-candidate.json).

The target is a quiet, encouraging pushup tracker: accumulate 100 in a day, log any set size, and see others showing up. No posts, photos, likes, comments, followers, or rankings. Option 5, Cream & Brick, is the approved visual direction.

## Read in this order

1. [Agent operating instructions](AGENTS.md)
2. [Product specification](docs/01-product.md) and [decisions](docs/02-decisions.md)
3. [Design system](design/DESIGN_SYSTEM.md) and [screen specification](docs/03-screens.md)
4. [Architecture](docs/04-architecture.md), [data model](docs/05-data-model.md), and [sync protocol](docs/06-sync.md)
5. [API contract](docs/07-api.md) and [security](docs/08-security.md)
6. [Implementation backlog](docs/09-build-plan.md) and [acceptance matrix](docs/10-verification.md)
7. [Operations and release](docs/11-release.md), [setup](docs/12-setup.md), and [sources](docs/13-sources.md)

## What is executable now

With Node 22.18+ or Node 24 LTS and Python 3.10+ installed:

```sh
npm test
python3 scripts/validate_package.py
```

No dependency installation is needed for these package checks. They verify reference domain behavior, fixture consistency, palette contrast, and package integrity. **They do not verify Expo, SQLite, PostgreSQL, authentication, realtime, or either mobile platform.** Those gates are deliberately assigned to implementation milestones.

## Included assets and contracts

- [Approved visual reference](design/option-5-cream-brick.png)
- [Machine-readable design tokens](design/tokens.json)
- [Shared TypeScript contract](contracts/domain.ts)
- [Deterministic QA fixtures](fixtures/scenarios.json)
- [Reference model](reference/domain.mjs), with tests
- [Codex kickoff prompt](prompts/KICKOFF.md) and [resume prompt](prompts/RESUME.md)
- [Task status](tracking/tasks.json), [progress](tracking/PROGRESS.md), and [evidence ledger](tracking/EVIDENCE.md)

## Completion standard

A task is done only when its implemented behavior and required evidence both exist. A milestone may be implemented but device-unverified. Never describe that state as release-ready. Complete the entire V1 backlog; stages control sequencing, not a reduction of the requested scope.

The package is intentionally explicit about retries, timezones, guest migration, privacy, and empty states. Success still depends on implementation quality, device testing, service access, and real user feedback. No success percentage is promised.
