# Staging setup without local CLI commands

GitHub Actions runs the pinned Supabase CLI on an Ubuntu runner. The approved staging project is `ggeyfolfedercmfvwsqx`. This workflow deploys database migrations only; it does not deploy Expo builds, email settings, a website or the deletion worker.

## One-time GitHub configuration

1. Open repository Settings > Environments > staging.
2. Under environment **secrets**, add `SUPABASE_ACCESS_TOKEN` (Supabase account access token) and `SUPABASE_DB_PASSWORD` (this project's database password).
3. The workflow already pins the public project reference to `ggeyfolfedercmfvwsqx`. No `SUPABASE_PROJECT_ID` variable is required; an existing variable can remain but is not used.
4. Merge the reviewed staging-workflow PR after its checks pass. Manual workflows must exist on the default branch before GitHub displays Run workflow.

Do not paste tokens or passwords into chat. The two credentials must be environment secrets. The project reference is public configuration committed with the workflow and independently checked by the deployment guard.

## Preview first

1. Open the repository's Actions tab and select **Staging database migrations**.
2. Click **Run workflow**, keep branch **main**, select mode **preview**, and leave reviewed_sha blank.
3. Open the completed run. Confirm the Summary shows the expected project and copy its full 40-character commit SHA.
4. Open the **Inspect migration history** and **Preview pending migrations** steps. For an empty app database, expect the 12 repository migrations from `20260910000100_private_schema.sql` through `20260911001000_utc_validation_fast_path.sql`. Existing applied migrations should not be pending again.
5. Stop if the project, migration history, or proposed migrations differ from expectations. Share the run link for review; do not use reset or migration repair to bypass a mismatch.

Preview does not apply application migrations. Linking may initialize Supabase migration metadata. The log, not a successful job alone, determines whether the proposed changes are appropriate.

## Apply the reviewed preview

1. After reviewing the successful preview, run the same workflow on **main**, mode **apply**.
2. Paste the full preview commit SHA into **reviewed_sha**. If main changed since preview, apply refuses to run; preview the new commit first.
3. The workflow repeats the preview, applies pending migrations, and lists the resulting history. Confirm local and remote versions align. The SHA guard checks commit equality; it does not independently certify that a human reviewed the previous run.
4. Share the completed run link. Next verify the hosted region API, then sign in from the app and test profile creation and sync. Receiving an OTP alone is not that end-to-end verification.

No reset, seed, config push or test fixtures are used. Existing SMTP settings remain managed in the Supabase dashboard. A failed apply may leave earlier migrations committed; inspect history and fix forward before retrying. This workflow is only for the approved nonproduction project. Existing meaningful data requires backup/recovery preparation in the operations runbook before applying changes.

## Next operator inputs

- Expo account username or organization, and project dashboard link if already created. Do not supply the account password. Cloud build setup follows after ownership is known.
- Test-device availability (Android and/or iPhone); iPhone distribution also requires the relevant Apple signing setup.
- Support mailbox, policy/support/deletion website, deletion-worker hosting/schedule and alerts remain separate deployment tasks. The public website is a support/legal/deletion surface; the product is the native app.

References: [Supabase environment deployments](https://supabase.com/docs/guides/deployment/managing-environments), [GitHub manual workflow runs](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/manually-run-a-workflow).
