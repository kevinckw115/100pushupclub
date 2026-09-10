# Instructions for implementation agents

Build 100pushupclub according to this package. The approved look is Option 5, Cream & Brick. These instructions govern this repository; explicit current user instructions take precedence.

## Context and authority

- Read README, START_HERE, the decision log, current progress, and task status before implementation.
- Load the specifications relevant to the current task, rather than repeatedly loading the whole repository.
- Authority order: current user direction; product decisions and contracts; design tokens and screen specifications; reference image; illustrative copy or fixtures. The screenshot is inspiration for rendering, not a backend requirement.
- API/data/sync documents form one contract. If a change spans them, update them together and add an ADR entry in the decision log.
- The existing reference model is partial and is not production persistence or an authorization mechanism.

## Working loop

1. Inspect the repository and available toolchain before choosing compatible dependency versions.
2. Select the earliest unblocked task in tracking/tasks.json whose dependencies are complete.
3. Write a short plan identifying behavior, files, and verification for that task.
4. Implement a complete thin slice. Run relevant checks and inspect UI on an available target.
5. Fix failures; do not disable assertions or replace integration tests with mocks to obtain a pass.
6. Record exact evidence and limitations, update task status and progress, then continue to the next task.
7. Before finishing a session, leave commands, blockers, and next action in tracking/PROGRESS.md.

Continue autonomously through reversible implementation work. Do not repeatedly request confirmation for documented defaults. Ask only for materially missing product decisions, credentials/access that cannot be supplied otherwise, or actions outside current authorization. Do not publish releases or mutate a live production environment based solely on this package.

## Engineering constraints

- No invented live activity, inflated totals, rankings, posts, chat, photos, fitness claims, or extra monetization features.
- Core logging must work offline and must survive process termination.
- Persist a check-in and its outbox mutation in one SQLite transaction.
- Identity and ownership come from the verified session, never a submitted user ID.
- Do not expose raw private check-ins, emails, exact timestamps/location data, or backend secrets to public clients.
- New backend functions require explicit grants/revokes, fixed search_path where relevant, authorization tests, input validation, and bounded queries.
- Never sum mutable cached totals as the source of truth; accepted check-in records determine totals.
- Use design tokens. Do not replace the approved UI with a generic dashboard or a screenshot embedded as an interface.
- Maintain one compatible dependency lockfile for the mobile app; no speculative version pinning or unrelated upgrades.
- Do not overwrite this package when scaffolding Expo. Scaffold into apps/mobile.
- No empty handlers, pretend save operations, TODO-backed core flows, or success toasts before a local durable commit.
- Keep test adapters separate from real production adapters. No sample identities or counts in release builds.
- A browser preview is useful but does not satisfy native SQLite, notification, accessibility, or device gates.

## Done means evidence

Use the task-specific checks in docs/09-build-plan.md and docs/10-verification.md. Report implemented, automated-verified, device-verified, and blocked separately. Add tests for real invariants and failure modes; avoid tests that merely repeat styles or mock away the behavior under test.

Do not stop after the local milestone unless the user asks or remaining tasks are genuinely blocked. If blocked, finish independent work and provide the exact remaining setup steps. No guarantee of store acceptance or success percentage.
