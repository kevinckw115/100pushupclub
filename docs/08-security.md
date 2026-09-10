# Privacy, authorization, and abuse controls

This document specifies product engineering controls, not a legal opinion. Verify release declarations against actual data flows and current store requirements.

## Access matrix

| Resource | Local guest | Signed-in owner | Other user/member | Staff service |
|---|---|---|---|---|
| Personal local records | Own device partition | Active account partition | No | No remote access |
| Server raw checkins/change log/receipts | No | Checked owner API | No | Audited operational access |
| Auth email/session | No cloud auth | Own auth flow | Never | Limited auth administration |
| Sanitized public feed | Read eligible projection | Read with block filtering | Same | Moderation |
| Circle totals/member aliases | No | If active member | If active member | Audited support |
| Invite creation/member removal | No | Circle owner | No | Audited override |
| Reports | No | Submit/receipt | No access to others' reports | Review queue |
| Moderation | No | No | No | Verified staff role only |

## Implementation requirements

- Private tables have no anon/authenticated direct CRUD grants. Functions get only required EXECUTE privileges. Explicitly revoke PostgreSQL's default PUBLIC execute where inappropriate.
- Where SECURITY DEFINER is necessary, fix search_path, schema-qualify relations, avoid dynamic SQL, verify auth.uid()/account status, and prevent callers supplying ownership. Grant no service-role key to the mobile runtime.
- Policies and grants must be exercised using unauthenticated, user A, user B, member, removed member, suspended, and staff identities. Admin-client tests cannot prove mobile RLS.
- Protect private realtime topics with current membership. Recheck and evict revoked membership; generic invalidation payloads contain no sensitive data even if an old socket lingers. Every subsequent read reauthorizes.
- Public projections filter consent epoch, deletion, suspension, moderation and blocks at read time. A function that filters only in the UI is a failure.
- Public-enabled=false is a server-enforced state. Offline toggle changes remain pending visibly; UI must not claim sharing stopped until the server confirms. Existing public data already seen cannot be recalled from another person's memory/screenshot.
- Use HTTPS, secure session storage, explicit release-environment config and data minimization. Do not collect GPS, contacts, images, body measurements or DOB in V1.
- Client `.env` EXPO_PUBLIC variables are public by definition. Only service URL and publishable key belong there; secret keys go in server secret management.

## Reporting and moderation

Even without posts, aliases and circle names are user-provided content. Include terms acceptance for participation, report/block controls, a support contact, and basic staff review. Apple and Google provide UGC guidance; recheck actual applicability before submission. [Apple guidelines](https://developer.apple.com/app-store/review/guidelines/), [Google UGC policy](https://support.google.com/googleplay/android-developer/answer/9876937).

Build minimal staff operations as authenticated scripts or a small private tool, not a public social dashboard: list open reports, hide abusive public entry, require alias/name change, suspend/restore account, resolve report, audit actor/reason. Staff operations must reject ordinary account sessions. Never run a generic service-role SQL console in the mobile app.

Circle invite tokens contain at least 128 bits of randomness, are stored only as cryptographic hashes, expire after 7 days, and are revocable. Repeated join of an active membership returns it unchanged. Revocation prevents future joins; it does not remove existing members. Logs redact raw invite tokens and OTPs.

## Account deletion

Require online recent authentication and deliberate confirmation. Server transaction changes account_status to deleting and disables sharing before queuing cleanup. Mutation and read APIs reject deleting accounts; public/circle projections hide them. The retryable job handles ownership transfer/deletion, dependent rows and auth deletion. No new writes can race cleanup because mutations recheck status under lock.

Revoke refresh sessions. Existing short-lived JWTs are not trusted merely because cryptographically valid; account-status checks prevent further use. Local app clears account partition, session, notifications and caches after acknowledgement, preserving separate guest data. If cleanup fails, job retries and support can inspect its status without exposing content. Set an operational deletion completion target of 7 days; policies must accurately describe backup retention rather than promising instant removal from backups.

Provide both an in-app initiation flow and a public account-deletion request page tied to verified account ownership. Do not delete an account based solely on a submitted email. Google documents the deletion surfaces and disclosure expectations. [Google deletion requirements](https://support.google.com/googleplay/android-developer/answer/13327111).

## Telemetry

Capture only error code, app/build version, platform, sanitized request ID and coarse timing. Mask emails, aliases, region identifiers, invite URLs, payloads, database contents and auth headers. No session replay in V1. Define a short operational log retention, initially 30 days, and verify provider settings. Staff audit records can have a separately documented retention justified by operations.

## Security acceptance

Cross-account read/write attempts; forged owner fields; direct table access; definer bypass; raw-data realtime subscription; block leakage; profile toggle concurrent with create; removed member with existing token/socket; account deleting with unexpired JWT; invite brute-force limits; alias collision races; public cache contamination; raw timestamp leakage through cursors/errors; sensitive-data-free telemetry. All are release gates, not optional polish.
