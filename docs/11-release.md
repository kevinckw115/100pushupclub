# Operations, beta, and release

## Environment separation

Local: disposable Supabase stack, deterministic seeds, test OTP setup. Development: separate hosted project for device integration. Production: independent data/secrets/config and no fixtures. EAS profiles development/preview/production must select the intended backend explicitly. A preview build must never inherit production by an empty environment variable fallback.

No paid services, app-store submissions or live migrations are performed by this handoff. During implementation, follow the user's current authorization. Complete and verify reviewable artifacts before asking for any final external release decision.

## CI gates to implement

On app changes: reproducible locked install, lint, typecheck, domain/component tests, SQLite integration and package contract checks. On backend changes: fresh database reset, grants/RLS tests, mutation and concurrency tests. On release candidate: native E2E evidence on both platforms, visual/accessibility checklist, release configuration audit and artifact identification.

PR descriptions identify problem, behavior, evidence and limitations. Branch protection should match the checks once the owner enables repository settings. Never claim a CI gate exists merely because it appears in a document.

## Migration/deployment discipline

Use versioned forward migrations; test against fresh and prior schemas with realistic fixtures. Prefer expand/contract changes compatible with one prior app version because users update at different times. Feature flags may disable public reads or circles without disabling local tracking. Avoid destructive table drops as a rollback strategy.

Before production migration: backup/restore capability checked, migration timing measured, privacy queries validated, rollback/forward-fix plan written. Database restore can lose newly accepted writes, so document that risk and prefer reversible feature disable where possible. App over-the-air updates must remain compatible with the installed native runtime; native dependency changes require new builds. Verify current Expo guidance at release.

## Operating signals

Monitor API error rate/latency, queue age, rate-limit events, auth delivery failures, deletion-job backlog, and moderation backlog. Client telemetry is opt-in where appropriate and redacted per security spec. Do not monitor people by alias or fine location. Record provider spend and request volume during beta; realtime fan-out is an explicit capacity concern.

Incident runbooks must cover backend outage (local logging continues), bad public data (disable projection and repair), auth delivery failure (guest still works), broken sync release (pause remote writes, preserve outbox), and leaked credentials (rotate server secrets, audit access; do not rotate publishable key as if it were a secret).

## Beta

Invite approximately 10–20 consenting adults with varied fitness levels and both phone platforms. Test for at least one week of ordinary use, not only scripted demos. Include an older/smaller phone and users relying on larger text. Give a support channel and a way to report errors without sending full personal database contents.

Ask: How fast did logging feel? Did you trust that it saved? Did 100 feel inviting or discouraging? Did community motivate or pressure you? Did any label confuse you? Did you return after missing a day? Track defects separately from feature requests.

Exit: no unresolved data-loss/duplication/privacy defects; critical native flows pass; design reviewed by Kevin; all blocked release requirements explicitly resolved. Do not promise store review approval or a calendar launch date before these are known.

## Store/release packet

- Owner-controlled name, bundle/application ID, developer accounts and store listings.
- Signed builds, version/build numbers, backend migration version and release notes.
- Accurate screenshots of the implemented Option5 app, never concept mockups presented as shipped functionality.
- Support URL, privacy policy, terms, verified account deletion web page and in-app flow.
- Accurate data disclosures and permissions based on the actual app and SDK inventory.
- Reviewer instructions for authentication and a permitted review account/flow; do not publish real users' credentials.
- Age rating/distribution selections and any health/fitness declarations reviewed against current forms.
- Confirmation that no location/camera/contact permissions or unneeded background modes slipped in.
- Moderation/report/block behavior demonstrated for aliases and circle names.

Apple's review guidelines include account deletion and UGC considerations; Google's account deletion and UGC pages describe its expectations. Recheck before submission; this document does not replace current platform review. [Apple](https://developer.apple.com/app-store/review/guidelines/), [Google deletion](https://support.google.com/googleplay/android-developer/answer/13327111), [Google UGC](https://support.google.com/googleplay/android-developer/answer/9876937).
