# Operational handoff

Status: local/CI implementation; no hosted service, schedule, signed build or release has been provisioned. Use the final task branch, not the initial main scaffold. See tracking/PROGRESS.md for the current commit and evidence.

## Build and environments

From apps/mobile run `npm ci`, `npm run lint`, `npm run typecheck`, `npm test`, `npm run test:integration`, `npm run doctor`, then `npm run export`. Export invokes the textual credential/review-module audit. CI also performs full Hermes exports. This does not inspect an installed binary's entitlements or prove device behavior.

Copy .env.example to .env for local development. Leave services blank for guest-only development. A connected preview must explicitly select its own HTTPS Supabase URL and publishable key; missing configuration now fails. A new secret key or legacy service-role JWT is rejected before the build. EAS development/preview profiles exist; production intentionally fails in app.config.js. Never pass worker or database credentials to Expo. [Supabase key roles](https://supabase.com/docs/guides/getting-started/api-keys).

Before signed builds, configure the owner's Expo organization/project, owner-controlled application identifiers, development/preview identifier separation, URL scheme and signing accounts. Replace dev.local.pushupclub only after those values are confirmed. Add the production profile and remove the unconditional production guard only together with reviewed identity, production endpoint, verified gate evidence and release artifact metadata. Record the exact EAS CLI/build image/runtime and resolved public config. No EAS build was started here.

Install development builds on named iOS and Android devices. Run tests/e2e flows and ACCESSIBILITY.md, capture OS/device/build IDs and native screenshots. Inspect Android merged manifest and iOS entitlements/Info.plist for unnecessary location, camera, contacts, background capabilities or inherited SDK permissions. Check notification, SecureStore, native SQLite restart and share-sheet behavior on those builds. No OTA release is configured; native dependency changes need fresh native builds.

## Backend preparation

Use a separate nonproduction Supabase project and real OTP delivery. Verify the target project reference independently before any deployment. The disposable CI commands are in .github/workflows/backend-check.yml; never use db reset on hosted data. Run the fresh reset, pgTAP, real HTTP/concurrency, populated-schema upgrade and load tests before preparing a versioned migration deployment.

The upgrade test rebuilds the baseline inside one PostgreSQL transaction and always rolls it back on a disposable localhost database. It checks preservation of records, receipts, revisions and memberships through all migrations. This is not a hosted backup restore drill. Before live migration, restore a recent backup into an isolated project, reconcile counts/revisions and deletion jobs, measure migration duration and check old-client compatibility. Record the backup ID and recovery point; do not expose a restored deleted account while jobs are reapplied. Roll forward with a reviewed migration where possible. Restoring production can discard accepted writes since the recovery point and needs an explicit incident decision.

Deploy the deletion worker only in a server environment following tools/backend/DELETION.md. Schedule every minute, verify a test account completes and alert well before the seven-day target. Set justified moderation audit and provider backup retention and publish those actual values before beta. Supply an owner support email and HTTPS domain; publish /policies, /support and /delete-account with SPA fallback, COOP/COEP and TLS. Verify account deletion from a clean browser, including suspended accounts, without creating a replacement account.

## Signals and redaction

Run `node scripts/operations-metrics.mjs` from tools/backend with server-only OPERATIONS_DATABASE_URL. It emits pending/failed deletion counts, oldest pending age in seconds and open report count. The read-only transaction has a five-second statement timeout; failures emit one generic code, never the connection string or query payload. Restrict database access to the operations service; this is not a client RPC.

Configure provider dashboards for aggregate HTTP latency/error/429 counts and OTP delivery failures. Establish beta baselines before choosing alert thresholds. Alert on any failed deletion, increasing age/backlog, exhausted error budget or sustained OTP failure. Hosted alert delivery, a staff rota and spend limits remain unconfigured. Client telemetry SDKs are absent; never add tokens, emails, aliases, exact check-in times, location, invite codes, deletion proofs, record payloads or raw database dumps to diagnostics. Collect only consented, coarse aggregate performance/error information needed to resolve a defect.

## Incident actions

| Trigger | Immediate action | Recovery evidence |
|---|---|---|
| Backend unavailable | Leave local logging/outbox intact; communicate via configured support channel | Reconnect and confirm exactly one accepted mutation per original operation ID |
| Incorrect public visibility | Restrict affected read RPCs at server gateway while preserving private logging; inspect current consent predicate | Re-run privacy/revocation tests, confirm no stale private rows, restore reads after review |
| Broken sync client | Halt distribution; restrict affected remote write endpoint if necessary; preserve durable outbox and receipts | Test original-envelope replay and two-client convergence on fixed build |
| OTP delivery failure | Investigate provider aggregate failures/rate limits; keep guest use available | Existing-account OTP, expiry and retry succeed on both platforms |
| Deletion worker failure | Alert operator; keep account denied; repair schedule/credential/service and retry original job | Auth absence and complete status; peer records intact; oldest age recovers |
| Server credential exposure | Revoke/rotate affected privileged credential in provider controls and audit access | Old credential denied, worker/staff access restored, no secret in rebuilt artifacts |

These are runbooks, not implemented kill-switch UI or a claim that hosted alerting exists. A gateway restriction must be tested on staging before use. Record UTC incident times and aggregate outcomes privately; never paste sensitive diagnostic bodies into public issues.

## Review packet

Before authorizing release, complete docs/13-beta-review.md, review every blocked task and record candidate commit, dependency lockfile hash, migration head, signed artifact/build IDs and native evidence. Branch protection and store accounts are owner settings; CI presence does not imply protection is enabled. The current code intentionally cannot build an unconfigured production release.
