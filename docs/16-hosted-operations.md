# Supabase scheduled cleanup and monitoring

The staging website uses Vercel. Scheduled cleanup uses the existing Supabase project, with no Render account or paid worker host. The owner selected this approach to avoid another paid service. These files prepare deployment; no hosted function, schedule, alert or backup has been configured automatically.

## Free-tier boundaries

Supabase supports pg_cron plus pg_net to invoke an Edge Function every minute. A 31-day month uses 44,640 scheduled invocations, plus tests/retries, which must fit the project's current Edge Function quota along with other usage. Free projects can pause, have runtime limits and do not provide the paid daily-backup guarantee. Check the actual plan and quotas before enabling this. No automatic paid upgrade is authorized.

The function reuses the existing deletion worker and aggregate metrics, takes a database advisory lock to prevent overlapping runs, requires a separate 256-bit scheduler secret, and rejects public/anonymous calls. Existing users' JWTs and publishable keys do not authorize it. Only the configured staging database/API are accepted. A successful HTTP response contains only an operations code. Logs contain aggregate counts, never user records, proof tokens, email addresses or secrets.

## 1. Merge the reviewed code

After all checks pass, merge task/supabase-scheduled-operations into main. It includes the earlier Expo linkage, standalone website and operations work. Do not merge or deploy the superseded Render branch separately. The final tree removes render.yaml and the Render runner.

GitHub's Operations Edge runtime checks resolve the pinned pg dependency in Deno and verify an unauthenticated POST is rejected. The backend suite verifies the same HTTP handler with real Auth/PostgreSQL cleanup, wrong-secret rejection and concurrent lock exclusion. Hosted Edge connectivity still requires verification after deployment.

## 2. Create the scheduler secret in Supabase

In the approved project ggeyfolfedercmfvwsqx, open SQL Editor and run this once:

```sql
select vault.create_secret(
  encode(extensions.gen_random_bytes(32), 'hex'),
  'operations_cron_secret'
);
```

This generates the value inside the database; the query result is the Vault record ID. If that named secret already exists, reuse it rather than creating a duplicate. In Vault, reveal/copy that value into the function secret below. Never put it in chat, the repository, Expo or Vercel.

## 3. Configure Edge Function secrets

Supabase > Edge Functions > Secrets:

| Name | Value/source |
|---|---|
| DELETION_API_URL | https://ggeyfolfedercmfvwsqx.supabase.co |
| DELETION_DATABASE_URL | Supabase Connect > Session pooler URI. Replace the password placeholder with the percent-encoded DB password and set sslmode=verify-full in the query string. Pooled username must be postgres.ggeyfolfedercmfvwsqx. Use session mode on 5432, not transaction mode, because the overlap lock lasts for a session. |
| OPERATIONS_CRON_SECRET | The64-character hexadecimal value from Vault above |
| OPERATIONS_HEARTBEAT_URL | Optional initially; the private HTTPS success-ping URL from the monitoring step below |

Supabase provides SUPABASE_SERVICE_ROLE_KEY to its own Edge runtime; do not copy it into any client. This staging worker checks its service_role JWT project reference. If the provider no longer exposes a legacy JWT for this project, stop and adapt the server configuration; a public key is not a substitute. Do not disable certificate validation if the pooler fails TLS verification. The current worker uses a privileged database connection; narrowly scoped production worker credentials remain a separate review.

## 4. Deploy through GitHub, then enable the schedule

1. On GitHub main, copy the full 40-character commit SHA you reviewed.
2. Actions > Deploy staging operations function > Run workflow. Select main and paste the SHA into reviewed_sha.
3. This deploys only staging-operations, using the existing GitHub staging access token. It does not apply migrations, change SMTP or create the schedule.
4. Confirm the function appears in Supabase. Its gateway JWT check is intentionally off because it authenticates its own dedicated scheduler secret. Never remove that header check or put the secret in a mobile app.
5. Open supabase/operations/enable-staging-schedule.sql in GitHub and copy the whole reviewed file into the staging project's SQL Editor. Check the project selection before running it. It enables pg_cron/pg_net and schedules one named job every minute; repeated runs update that named schedule.
6. In Integrations > Cron, confirm the job exists and is active. Inspect the function's Invocations/Logs for HTTP 200 and OPERATIONS_OK.

The cron SQL succeeding only confirms the HTTP request was queued. Verify the Edge response separately; pg_net does not turn an HTTP 503 into a failed cron SQL job. This read-only query can inspect recent HTTP outcomes:

```sql
select id, status_code, timed_out
from net._http_response
order by id desc
limit 20;
```

Never select/decode header secrets in shared screenshots. A job that reports success with an empty backlog verifies connectivity, not account cleanup. Complete a disposable-account deletion from the website, then wait for a scheduled run and confirm status becomes complete and the Auth user is absent. Do not use the owner's only account. Check an unrelated account still works.

## 5. Add free-tier heartbeat monitoring

A separate monitor is necessary to detect the whole Supabase project or scheduler stopping. Healthchecks.io has a free tier suitable for a single heartbeat check; verify the current limits before selecting it. Create a check named 100pushupclub-staging-operations, Period 1 minute, Grace 5 minutes, and enable an email integration to your confirmed operator inbox.

Copy its secret HTTPS ping URL into OPERATIONS_HEARTBEAT_URL in Supabase Edge secrets. The function sends an empty POST only after successful cleanup and healthy metrics. Any failed deletion, a pending deletion at least one day old, API/DB failure or missed function execution stops success pings. No check-in data or account identifier is sent to the monitor. Error status reaches the threshold well before the seven-day primary-cleanup target.

Wait for the check to become Up. To test actual alert delivery, temporarily deactivate the Cron job in Supabase, wait beyond the grace window, confirm the Down email, then reactivate and confirm recovery. Keep the test short and record completion. Do not leave deletion scheduling paused. The monitor cannot provide evidence until this delivery test passes.

## Support, backups, retention and costs still needing owner action

- Namecheap forwarding destination is the owner's confirmed Gmail inbox. Set alias support and test it from another mailbox. Forwarding receives mail only; Gmail replies normally use the Gmail sender. A branded outgoing mailbox remains a separate choice.
- In Supabase Database > Backups, record the actual plan, available backups and retention. Free-tier data needs a separately designed encrypted off-site backup process if it becomes valuable. No free managed daily backup is assumed or prepared by this task. Before production, verify a restore into an isolated project and preserve/reapply deletion jobs. Do not upload plaintext database dumps to GitHub artifacts.
- Moderation audits are currently append-only. Choose and implement a retention policy before the final privacy notice; the staging site explicitly says this is pending. No automatic purge or invented retention period is claimed.
- Review Supabase, Vercel and Resend usage/billing pages and available alerts. Choose budgets and recipients; alerts are not necessarily hard spending caps. Stay on current free tiers unless the owner chooses otherwise.
- Verify Resend failed deliveries, Supabase Auth/API error rates, OTP expiry/retry and gateway/source limits. Limiting Vercel website traffic alone does not protect direct anonymous Supabase API requests.
- Public root-domain rollout remains blocked by support delivery, final policy/retention, production configuration and hosted deletion evidence. Use the Vercel staging URL first.

Sources: [Supabase scheduling](https://supabase.com/docs/guides/functions/schedule-functions), [Edge limits](https://supabase.com/docs/guides/functions/limits), [database connections](https://supabase.com/docs/guides/database/connecting-to-postgres), [backup coverage](https://supabase.com/docs/guides/platform/backups), [Healthchecks documentation](https://healthchecks.io/docs/).
