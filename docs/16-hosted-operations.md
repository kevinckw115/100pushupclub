# Hosted deletion and monitoring setup

This is a reviewable staging deployment plan, not evidence that a schedule or alert is running. Vercel serves the standalone website. The existing Node/PostgreSQL deletion worker needs scheduled execution separately. The prepared Render Blueprint runs cleanup and aggregate diagnostics every minute in one job, avoiding a second monitoring service. No paid resource has been created.

## Cost and account

Render cron has a minimum charge of US$1 per month per service, with additional usage-based compute billing. This is a minimum, not an estimate or a cap. Review the current plan and projected usage before creating it. If a paid service is unsuitable, do not deploy this Blueprint; select another scheduler and preserve the one-minute execution and monitoring requirements. A sporadic manual run does not satisfy the deletion completion commitment.

## Browser setup

1. Merge task/hosted-deletion-operations after its checks pass. It is stacked on task/public-support-site and Expo linkage. Review the full main comparison before merging.
2. Create/sign in to Render, connect GitHub, and authorize access only to this repository as needed.
3. Choose New > Blueprint, select the repository/main and render.yaml. Confirm one cron job only, `100pushupclub-staging-operations`, the quoted price, and schedule `* * * * *` (UTC). Choose a region near the Supabase project before creation.
4. Supply the two server-only secrets below in Render's form. They must never go in Vercel site settings, Expo settings, source code or chat.
5. Review the resulting service and deploy when ready. The first deployment starts scheduled execution against staging and may process existing accepted deletion jobs. Future source updates are manual because autoDeployTrigger is off.

| Setting | Where to obtain it |
|---|---|
| DELETION_DATABASE_URL | Supabase project > Connect > Session pooler. Copy the actual URI, replace the password placeholder with your percent-encoded DB password, and set `sslmode=verify-full` in its query string. Expected pooled username is `postgres.ggeyfolfedercmfvwsqx`. Keep certificate verification enabled. |
| DELETION_ADMIN_KEY | Supabase project settings > API Keys > Legacy keys > service_role. This existing worker uses an Auth-admin JWT; the publishable key and Supabase account access token are not substitutes. |

The guard restricts the API, database project and service-role JWT reference to staging. It checks configuration, not the JWT signature; Supabase authenticates the real key. Session pooler supports IPv4 and avoids assuming the direct database address is reachable. If certificate validation fails, diagnose the provider CA/connection settings instead of turning verification off. This staging worker uses the privileged postgres connection required by the current worker contract; production should review narrowly scoped worker credentials separately.

## Validate scheduled cleanup

1. Open Render Runs and wait for a scheduled run to finish. Success logs contain only counts and four aggregate metrics. Empty backlog is a connectivity check, not a completed deletion test.
2. Create a consenting disposable staging account through the app and ensure profile creation completes. Request deletion on the staged website using a fresh email code.
3. Confirm access stops immediately, then wait for a scheduled worker run and check status in the original browser. It should report primary cleanup complete. Verify the test Auth user is absent in Supabase and an unrelated account remains usable.
4. Record deployment commit, run timestamp and outcome without email addresses, tokens or deletion proofs. Do not use your only account or delete any other user's account as a test.

## Failure and missing-run alerts

The operations wrapper exits nonzero for worker failures, invalid configuration, failed metrics queries, any failed deletion, or pending deletion age of at least one day. Runs have a55-second process deadline. Render's single-run guarantee prevents concurrent cron executions. Database cleanup phases remain retryable after termination.

In Render workspace > Integrations > Notifications, select Email and Only failure notifications. Check the cron service's override inherits that setting. A failed cron execution supports email alerts. To test the route without touching data, temporarily set DELETION_API_URL to an invalid target, run once and verify the generic target failure alert arrives, then restore the approved URL immediately and verify success. This is an operator test; do not leave the scheduler intentionally broken.

Failure notifications do not prove detection of a scheduler that never runs. Configure a separate dead-man/heartbeat check with your chosen monitoring provider: expected interval1minute and grace5minutes; set its HTTPS ping URL as the Render-only secret OPERATIONS_HEARTBEAT_URL. The wrapper sends an empty POST only after cleanup and metrics are healthy. Verify provider email delivery and a missed-heartbeat alert by temporarily removing the heartbeat setting, then restore it. Never publish the secret ping URL. No heartbeat provider or email notification has been configured by this code change.

## Backups, retention, spend and public exposure

- In Supabase Database > Backups, record the actual plan, available backups and retention window. The free tier must not be described as having the paid daily-backup guarantee. Before valuable production data, choose managed backups or an encrypted off-site backup workflow, then restore into an isolated project and verify data and deletion-job handling. Never put plaintext database dumps in GitHub artifacts.
- Decide and implement moderation-audit retention before publishing a final privacy notice. The current audit is append-only and no timed purge is implemented; do not invent a retention period in website copy.
- Review Supabase, Vercel, Resend and Render billing/usage pages; enable available spending notifications/limits and choose recipient and budget. A notification is not necessarily a hard cap. Verify plan-specific behavior in each provider dashboard.
- Inspect Resend failed deliveries and Supabase Auth/API errors. Define baseline alert thresholds after staging traffic exists. Test OTP expiry/retry and rate limits. Anonymous API endpoints still require source/gateway abuse controls; website protection alone does not cover direct Supabase API access.
- Keep staging private and visibly labeled. Public root-domain rollout requires final support/retention policies, production configuration and an end-to-end deletion test.

Sources: [Render cron pricing and scheduling](https://render.com/docs/cronjobs), [Render email notifications](https://render.com/docs/notifications), [Supabase connections](https://supabase.com/docs/guides/database/connecting-to-postgres), [Supabase backups](https://supabase.com/docs/guides/platform/backups).
