# Operator setup status

Last reconciled: 2026-09-23. This is the current operator checklist; older entries in PROGRESS.md are historical. Dashboard changes not reported or independently checked remain unconfirmed. Code/CI completion does not imply hosted deployment.

## Completed

| Item | Evidence and scope |
|---|---|
| GitHub repository and core implementation | PRs #1-#5 merged. Latest checked main is `48b15a824b7020453926e77023d2a3985c010bd2`; all four main CI workflows passed. |
| Domain purchase | Owner confirmed Namecheap ownership of `100pushupclub.com`. Website DNS/hosting is separate. |
| Namecheap email DNS records | Owner confirmed saving the Resend-requested records; sending-domain verification succeeded. Detailed record inventory and evidence below. These email records are already done; website DNS is separate. |
| Supabase staging project | Created and accessible at `https://ggeyfolfedercmfvwsqx.supabase.co`; owner supplied the project URL and public publishable key. Auth settings and region API were checked during setup. |
| Resend sending domain | Owner confirmed `auth.100pushupclub.com` verified. |
| Supabase custom SMTP | Owner saved settings and received an actual sign-in code from the configured sender. Full app sign-in/session/sync is not yet verified. |
| GitHub staging credentials | Migration workflow successfully authenticated and applied changes. Project reference is now pinned in the workflow; the old project-ID variable is not required. |
| Staging database deployment | [Apply run35639437161](https://github.com/kevinckw115/100pushupclub/actions/runs/35639437161) applied all12 migrations; local and remote versions matched. Hosted `resolve_region(world)` returned HTTP200. This is recorded verification from September21, not a fresh uptime check. |
| Expo account and project | Owner `foodib115`; project `100pushupclub`; ID `8509924c-03cc-4a2f-81e8-98ed695ba7e6`. App linkage merged through PR #4; no preview APK has been built yet. |
| Expo preview environment variables | Owner confirmed adding app environment, staging URL and publishable key. Not yet exercised by an actual cloud build. |
| Vercel account | Owner confirmed an existing account; no project/deployment confirmed. |

## Detailed setup history from our conversation

This inventory includes work Kevin performed in dashboards following the walkthrough, not only code changes. **Owner-confirmed** means Kevin explicitly reported completion. **Checked** means a workflow, API or DNS lookup supplied separate evidence during that session. These are historical results, not a fresh check of every provider today. Secret values are intentionally omitted.

### Domain and Namecheap DNS — completed

- Kevin bought `100pushupclub.com` from Namecheap and confirmed access to Advanced DNS: “I just bought a new domain from namecheap for 100pushupclub.com”.
- We used `auth.100pushupclub.com` for authentication email sending through Resend.
- Kevin entered the Resend DNS records in Namecheap and reported “Saved records.” He subsequently confirmed the Resend domain status was verified.
- The earlier DNS review found the following records. These are email-authentication records, not website-hosting records:

| Type | Namecheap host / full DNS name | Value or purpose | Evidence |
|---|---|---|---|
| TXT | `resend._domainkey.auth` / `resend._domainkey.auth.100pushupclub.com` | Resend-provided DKIM public key. Use the full provider value in the dashboard; the long key is not duplicated here. | Saved by owner; DKIM TXT observed in DNS; domain verified. |
| CNAME | `rsend.auth` / `rsend.auth.100pushupclub.com` | `rsend.forge.rmta.net` | Saved by owner; CNAME observed in DNS. |
| CNAME | `send.auth` / `send.auth.100pushupclub.com` | `send.forge.rmta.net` | Saved by owner; CNAME observed in DNS. |
| TXT | `_dmarc` / `_dmarc.100pushupclub.com` | `v=DMARC1; p=none;` | Optional record included in setup; TXT observed in DNS. This is a monitoring policy, not enforcement. |

Existing root-domain Namecheap forwarding MX records were preserved and observed (`eforward1`–`eforward5.registrar-servers.com`). Their presence does **not** prove the `support` alias has been created. No Vercel/staging website DNS record has been confirmed yet. Do not ask Kevin to redo the completed Resend records.

### Resend and authentication email — completed

- Resend account/domain setup was performed; owner explicitly reported the sending domain as **Verified**.
- The SMTP configuration we walked through used host `smtp.resend.com`, port `465`, username `resend`, and a dedicated Resend API key as the password. Sender: `signin@auth.100pushupclub.com`; display name: `100pushupclub`.
- Kevin confirmed that Supabase SMTP settings were saved. This is owner confirmation of the dashboard setup, not a claim that the assistant read the stored SMTP password.
- One authorized test OTP request was accepted by Supabase. Kevin confirmed: “yes! received email from sender with code.” This verifies delivery to his test inbox and receipt of a code from the sender.
- Code-based email template instructions were supplied. The delivered code is confirmed; separate saves of every individual template were not explicitly reported, so those clicks are not invented as additional completed tasks.
- Resend sending and Supabase SMTP are already set up. Support inbox forwarding and a branded reply mailbox are separate items, not part of SMTP sign-in delivery.

### Supabase project, Auth and database — completed within staging scope

- Kevin set up the staging project and shared URL `https://ggeyfolfedercmfvwsqx.supabase.co`, project reference `ggeyfolfedercmfvwsqx`, and an `sb_publishable_…` public client key.
- A read-only Auth settings check found email authentication enabled, signups allowed and email confirmation required. These settings plus successful code delivery support the email-OTP path; social sign-in providers were not configured or promised.
- The project URL and publishable key were also connected to the ignored local development environment. This was assistant-side configuration, separate from Kevin's dashboard work.
- After the GitHub workflow setup, Kevin successfully ran the migration preview: [run35639118067](https://github.com/kevinckw115/100pushupclub/actions/runs/35639118067). It showed the 12 expected pending migrations on the correct project.
- Kevin then ran **apply** with reviewed commit `425c348569212820c47caa06efae5722c8ee918b`: [run35639437161](https://github.com/kevinckw115/100pushupclub/actions/runs/35639437161). Logs verified all 12 migrations applied and local/remote history aligned.
- The hosted region RPC returned HTTP200 with World and region dataset version `geonames-2026-09-11` after deployment.
- Full app OTP verification/session creation, profile bootstrap and phone-to-backend synchronization still need an installed-build test. A working email and deployed schema do not replace that test.

### GitHub setup — completed; newest deployment PR still pending

- Repository: `kevinckw115/100pushupclub`. Core implementation and staging-workflow/fix PRs #1–#3 are merged.
- Kevin created/configured the **staging** GitHub environment and reported “staging env vars added in Github.” The walkthrough used secrets `SUPABASE_ACCESS_TOKEN` and `SUPABASE_DB_PASSWORD`, plus variable `SUPABASE_PROJECT_ID`.
- Early runs received an empty project-ID variable despite Kevin reporting it added. We fixed the workflow to pin the approved public staging reference. Kevin's later successful preview and apply demonstrate that workflow authentication/connectivity worked. The old variable is no longer a blocker or required setup step.
- Kevin has created PR #4 for the combined Expo/website/operations work. Its four checks passed; merge and subsequent hosted deployment remain separate actions.

### Expo and testing preparation — completed account/configuration, no build yet

- Kevin created an Expo account: `foodib115`.
- Kevin created project `100pushupclub` and supplied its [dashboard link](https://expo.dev/accounts/foodib115/projects/100pushupclub).
- Kevin found and supplied project ID `8509924c-03cc-4a2f-81e8-98ed695ba7e6`. Assistant-side app linkage is implemented and checked in PR #4.
- Kevin explicitly confirmed “Expo env vars added” after the Preview / Plain text instructions for `EXPO_PUBLIC_APP_ENV=preview`, `EXPO_PUBLIC_SUPABASE_URL`, and `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`. No secret backend credential was requested for those public variables.
- Kevin confirmed a regular Apple ID without paid Apple Developer membership, then chose Android emulator testing on his home laptop first. This is an agreed plan; emulator installation and APK testing have not been reported complete.

### Hosting, support and monitoring decisions — confirmed choices, not completed deployment

- Kevin already has Vercel, but reported no project for this app. Vercel is selected for the standalone website.
- Kevin approved forwarding `support@100pushupclub.com` to his existing Gmail inbox. That destination is confirmed; alias creation and a received forwarding test are not yet confirmed.
- Kevin requested a no-paid-host alternative for the scheduled worker. The prepared solution now uses Supabase Cron/Edge Functions; no Render subscription is needed for this plan.
- Healthchecks monitoring, Supabase Vault/Edge secrets, function deployment, Cron activation, alert-delivery testing, backups and final retention decisions have not been reported complete.

## Prepared and automated-verified; awaiting operator deployment

[PR #4](https://github.com/kevinckw115/100pushupclub/pull/4) and [PR #5](https://github.com/kevinckw115/100pushupclub/pull/5) are **merged**. All four main CI workflows passed at `48b15a824b7020453926e77023d2a3985c010bd2`. PR #4 supplied the implementation; PR #5 recorded operator history. The implementation contains Expo linkage, the standalone staging website, Supabase scheduled cleanup and monitoring support. The earlier PR checks also passed source `0d8f24e874c54a0cadfe73e88e3978f8f7bd3672`:

- [Package checks](https://github.com/kevinckw115/100pushupclub/actions/runs/35664821352)
- [Mobile checks](https://github.com/kevinckw115/100pushupclub/actions/runs/35664821353)
- [Backend and browser checks](https://github.com/kevinckw115/100pushupclub/actions/runs/35664821351), including real account deletion and scheduler authorization/overlap tests
- [Edge runtime checks](https://github.com/kevinckw115/100pushupclub/actions/runs/35664821551)

These checks use disposable test infrastructure. They do not certify the hosted worker, DNS, email forwarding or alert delivery.

## Operator checklist

| ID | Status | Owner / action | Completion evidence |
|---|---|---|---|
| O01 | Complete 2026-09-23 | PRs #4 and #5 merged; no further merge action required for these changes. | Resulting main at 48b15a8 passed all four CI workflows. |
| O02 | Destination chosen; setup unconfirmed | Kevin: Namecheap forwarding alias `support` to the confirmed Gmail inbox. Test from another mailbox. | Support email received. Forwarding alone does not enable replies from the branded address. |
| O03 | Ready | Kevin: Vercel Add New Project → import repository, root directory unchanged, framework Other. Use committed build settings. Add SITE_SUPPORT_EMAIL only after O02 passes. | Share generated staging URL; verify home/support/privacy/deletion routes and deployed headers. |
| O04 | Not started/confirmed | Kevin: after website review, add `staging.100pushupclub.com` using Vercel's exact DNS instructions. | Vercel domain verification and working HTTPS. Public root-domain rollout is deferred. |
| O05 | Code ready; secrets unconfirmed | Kevin: create/reuse Vault scheduler secret; configure Edge DB/API/cron secrets following the operations guide. | Settings saved in Supabase; never share secret values in chat. |
| O06 | Awaiting O05 | Kevin: run **Deploy staging operations function** on main with reviewed commit SHA. | Successful workflow and function visible in Supabase. |
| O07 | Awaiting O06 | Kevin: run reviewed staging schedule SQL in Supabase SQL Editor. | One active minute-by-minute Cron job and HTTP200/OPERATIONS_OK from the function. Queued HTTP requests alone are insufficient. |
| O08 | Awaiting hosted website/worker | Kevin + assistant: complete deletion with a consenting disposable staging account. | Account access stops, cleanup completes, Auth user is removed, and another account still works. |
| O09 | Not started/confirmed | Kevin: create a free-tier heartbeat monitor, set its private ping URL in Edge secrets, and enable operator email notifications. | Healthy pings plus actual missed-run and recovery emails from a controlled test. |
| O10 | Review required | Kevin + assistant: inspect provider plans/usage, choose available spend alerts and recipients; verify OTP/API rate limits and failure monitoring. | Recorded limits, recipients and working alerts. No paid upgrade authorized. |
| O11 | Unresolved before production | Kevin + assistant: choose backup storage/retention, implement recovery, and decide moderation-audit retention. | Successful isolated restore drill and accurate final policy. Supabase free-tier managed daily backups are not assumed; audit purge is not implemented. |
| O12 | Pending engineering and operator access | Assistant + Kevin: finish Android identifiers, cloud-build automation/credentials, then create preview APK. | Successful build linked to the Expo project and staging backend. No APK has been built yet. |
| O13 | Home laptop available; emulator setup unconfirmed | Kevin: install/run Android emulator on home laptop, install APK and test. | Actual native logging/restart/offline/sync, notifications, secure storage and accessibility results. |
| O14 | Deferred | iPhone testing, Apple membership/signing, production environment, public release and store accounts. | Separate later milestones; none blocks starting Android staging tests. |

## Current decisions and constraints

- Native iOS/Android product; website is only home/support/privacy/account deletion.
- Android emulator testing comes first, on the owner's home laptop. iPhone testing is deferred; owner currently has a regular Apple ID only.
- Avoid another paid worker host. Use prepared Supabase Cron/Edge setup within plan quotas; Render was removed from the final code.
- Support forwarding to the owner's Gmail is approved but not confirmed configured or tested.
- Work laptop ThreatLocker prevents some local tooling. Operator instructions use dashboards and GitHub Actions.
- Provider credentials/dashboard access remain with Kevin. Configuration instructions are prepared; hosted actions are not silently marked complete.

## Next session

Prioritize **O12/O13: create an Android preview APK and run it on the now-available home laptop**. Confirm its operating system and Android Studio availability first. Test guest logging, restart persistence, offline logging, and email sign-in/sync. Support forwarding and Vercel setup (O02/O03) can proceed independently, followed by hosted operations O05-O09. End-to-end account deletion needs the deployed worker. Update this ledger with dates and run/deployment links after each actual completion.

- [Website and mailbox instructions](../docs/15-website-operations.md)
- [Supabase schedule, monitoring and remaining infrastructure](../docs/16-hosted-operations.md)
- [Project progress and history](PROGRESS.md)
