# Staff review

This CLI uses a confirmed permanent account's short-lived authenticated access token. Staff authorization comes from the private staff_members table, not user-editable metadata or a client-supplied role. Keep the token and private reason files in the operator environment; never add them to the mobile app, repository, logs or command arguments. No generic SQL console is exposed to clients.

Deployment owner setup: create/verify the operator's Auth account, bootstrap its profile, and provision its UUID in app_private.staff_members through the controlled database administration path. Review that UUID independently before granting access. Disable the row to revoke future actions, including receipt replays. No staff identity is seeded in production; disposable tests provision their own accounts.

Environment: STAFF_API_URL, STAFF_PUBLISHABLE_KEY, STAFF_ACCESS_TOKEN. Outside localhost the URL must use HTTPS. From tools/backend:

```
node scripts/staff.mjs list --limit 25
node scripts/staff.mjs list --after REPORT_UUID --limit 25
node scripts/staff.mjs moderate hide_entry ENTRY_ID --operation-id UUID --reason-file PRIVATE_FILE
node scripts/staff.mjs moderate require_alias ACTOR_ID --operation-id UUID --reason-file PRIVATE_FILE
node scripts/staff.mjs moderate require_circle_name CIRCLE_UUID --operation-id UUID --reason-file PRIVATE_FILE
node scripts/staff.mjs moderate suspend ACTOR_ID --operation-id UUID --reason-file PRIVATE_FILE
node scripts/staff.mjs moderate restore ACTOR_ID --operation-id UUID --reason-file PRIVATE_FILE
node scripts/staff.mjs moderate resolve_report REPORT_UUID --operation-id UUID --reason-file PRIVATE_FILE --resolution resolved
```

Use a fresh UUID for new intent, and the same UUID/reason for an uncertain retry. Each accepted action and immutable audit entry commit together. A failed audit write rolls the action back. Resolving a report supports resolved/dismissed; unreviewed reports do not automatically hide activity. Names and public entry IDs in the review queue are private operational data; do not copy the output into analytics.

Requiring an alias change disables sharing and invalidates its prior epoch. The account must choose a different alias before re-enabling participation. Requiring a circle name change immediately replaces the public name with “Name needs review” and revokes invites; the owner can rename through the circle API. Suspension blocks checked user APIs and hides activity; restoration leaves sharing off and never republishes old epochs. Staff cannot suspend/restore itself or restore a deleting account. Personal check-in quantities are never rewritten by moderation.

Hosted staff provisioning, support address, policy URLs and operational access review remain deployment gates. The repository does not claim these have been configured.
