# Operator setup status

Last reconciled: 2026-09-22. This is the current operator checklist; older entries in PROGRESS.md are historical. Dashboard changes not reported or independently checked remain unconfirmed. Code/CI completion does not imply hosted deployment.

## Completed

| Item | Evidence and scope |
|---|---|
| GitHub repository and core implementation | PRs #1–#3 merged. Main is `425c348569212820c47caa06efae5722c8ee918b`. |
| Domain purchase | Owner confirmed Namecheap ownership of `100pushupclub.com`. Website DNS/hosting is separate. |
| Resend sending domain | Owner confirmed `auth.100pushupclub.com` verified. |
| Supabase custom SMTP | Owner saved settings and received an actual sign-in code from the configured sender. Full app sign-in/session/sync is not yet verified. |
| GitHub staging credentials | Migration workflow successfully authenticated and applied changes. Project reference is now pinned in the workflow; the old project-ID variable is not required. |
| Staging database deployment | [Apply run35639437161](https://github.com/kevinckw115/100pushupclub/actions/runs/35639437161) applied all12 migrations; local and remote versions matched. Hosted `resolve_region(world)` returned HTTP200. This is recorded verification from September21, not a fresh uptime check. |
| Expo account and project | Owner `foodib115`; project `100pushupclub`; ID `8509924c-03cc-4a2f-81e8-98ed695ba7e6`. App linkage is prepared in PR #4, not yet merged. |
| Expo preview environment variables | Owner confirmed adding app environment, staging URL and publishable key. Not yet exercised by an actual cloud build. |
| Vercel account | Owner confirmed an existing account; no project/deployment confirmed. |

## Prepared and automated-verified; awaiting operator deployment

[PR #4](https://github.com/kevinckw115/100pushupclub/pull/4) is **open, unmerged**. It contains Expo linkage, the standalone staging website, Supabase scheduled cleanup and monitoring support. All four checks passed source `0d8f24e874c54a0cadfe73e88e3978f8f7bd3672`:

- [Package checks](https://github.com/kevinckw115/100pushupclub/actions/runs/35664821352)
- [Mobile checks](https://github.com/kevinckw115/100pushupclub/actions/runs/35664821353)
- [Backend and browser checks](https://github.com/kevinckw115/100pushupclub/actions/runs/35664821351), including real account deletion and scheduler authorization/overlap tests
- [Edge runtime checks](https://github.com/kevinckw115/100pushupclub/actions/runs/35664821551)

These checks use disposable test infrastructure. They do not certify the hosted worker, DNS, email forwarding or alert delivery.

## Remaining, in execution order

| ID | Status | Owner / action | Completion evidence |
|---|---|---|---|
| O01 | Ready | Kevin: review and merge PR #4. Do not deploy the superseded Render branch. | PR merged and resulting main checks green. |
| O02 | Destination chosen; setup unconfirmed | Kevin: Namecheap forwarding alias `support` to the confirmed Gmail inbox. Test from another mailbox. | Support email received. Forwarding alone does not enable replies from the branded address. |
| O03 | Ready after O01 | Kevin: Vercel Add New Project → import repository, root directory unchanged, framework Other. Use committed build settings. Add SITE_SUPPORT_EMAIL only after O02 passes. | Share generated staging URL; verify home/support/privacy/deletion routes and deployed headers. |
| O04 | Not started/confirmed | Kevin: after website review, add `staging.100pushupclub.com` using Vercel's exact DNS instructions. | Vercel domain verification and working HTTPS. Public root-domain rollout is deferred. |
| O05 | Code ready; secrets unconfirmed | Kevin: create/reuse Vault scheduler secret; configure Edge DB/API/cron secrets following the operations guide. | Settings saved in Supabase; never share secret values in chat. |
| O06 | Awaiting O01/O05 | Kevin: run **Deploy staging operations function** on main with reviewed commit SHA. | Successful workflow and function visible in Supabase. |
| O07 | Awaiting O06 | Kevin: run reviewed staging schedule SQL in Supabase SQL Editor. | One active minute-by-minute Cron job and HTTP200/OPERATIONS_OK from the function. Queued HTTP requests alone are insufficient. |
| O08 | Awaiting hosted website/worker | Kevin + assistant: complete deletion with a consenting disposable staging account. | Account access stops, cleanup completes, Auth user is removed, and another account still works. |
| O09 | Not started/confirmed | Kevin: create a free-tier heartbeat monitor, set its private ping URL in Edge secrets, and enable operator email notifications. | Healthy pings plus actual missed-run and recovery emails from a controlled test. |
| O10 | Review required | Kevin + assistant: inspect provider plans/usage, choose available spend alerts and recipients; verify OTP/API rate limits and failure monitoring. | Recorded limits, recipients and working alerts. No paid upgrade authorized. |
| O11 | Unresolved before production | Kevin + assistant: choose backup storage/retention, implement recovery, and decide moderation-audit retention. | Successful isolated restore drill and accurate final policy. Supabase free-tier managed daily backups are not assumed; audit purge is not implemented. |
| O12 | Pending engineering and operator access | Assistant + Kevin: finish Android identifiers, cloud-build automation/credentials, then create preview APK. | Successful build linked to the Expo project and staging backend. No APK has been built yet. |
| O13 | Deferred by owner | Kevin: install/run Android emulator on home laptop, install APK and test. | Actual native logging/restart/offline/sync, notifications, secure storage and accessibility results. |
| O14 | Deferred | iPhone testing, Apple membership/signing, production environment, public release and store accounts. | Separate later milestones; none blocks starting Android staging tests. |

## Current decisions and constraints

- Native iOS/Android product; website is only home/support/privacy/account deletion.
- Android emulator testing comes first, on the owner's home laptop. iPhone testing is deferred; owner currently has a regular Apple ID only.
- Avoid another paid worker host. Use prepared Supabase Cron/Edge setup within plan quotas; Render was removed from the final code.
- Support forwarding to the owner's Gmail is approved but not confirmed configured or tested.
- Work laptop ThreatLocker prevents some local tooling. Operator instructions use dashboards and GitHub Actions.
- Provider credentials/dashboard access remain with Kevin. Configuration instructions are prepared; hosted actions are not silently marked complete.

## Next session

Start with **O01–O03: merge PR #4, verify support forwarding, and create the Vercel staging project**. Then work through O05–O09 using the step-by-step guide. Update this ledger with dates and run/deployment links after each actual completion.

- [Website and mailbox instructions](../docs/15-website-operations.md)
- [Supabase schedule, monitoring and remaining infrastructure](../docs/16-hosted-operations.md)
- [Project progress and history](PROGRESS.md)
