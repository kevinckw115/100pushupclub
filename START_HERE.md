# Start here

## For Kevin

1. Extract this entire folder into a new project directory. Keep the design image and all supporting files together.
2. Open that directory in Codex. A GitHub repository is recommended for durable version history; creating it is separate from extracting the package.
3. Give Codex the contents of [the kickoff prompt](prompts/KICKOFF.md).
4. Codex should bootstrap the app under `apps/mobile`, preserve these specifications, and complete the milestones in order. Its first reviewable result is a working local tracker using Cream & Brick.
5. Review real screenshots and an installable development build. Use the acceptance matrix to distinguish simulated, automated, and device-verified results.

No service accounts are needed to begin the local tracker. Before connected testing, provide access to your Expo project and a development Supabase project through the development environment. Email delivery needs configuration before a public beta. Store distribution will also need your Apple and Google developer accounts. Never paste secret service credentials into chat or into mobile source files.

## What this package decides

- Expo / React Native / TypeScript, Supabase, and SQLite.
- Local-only guest mode before an email OTP account; aliases only in community views.
- 100 daily target, unlimited total, set entry of 1–999, wall/knee/incline counted equally.
- Community uses explicitly labeled rolling windows; private circles use a fixed group timezone.
- Public sharing defaults off; circle membership includes an explicit activity-sharing disclosure.
- Approximate manually selected geography; no GPS collection.
- Light Cream & Brick theme only in V1. Dark mode remains future work.

These are implementation defaults selected for this package unless labeled user-approved in [the decision log](docs/02-decisions.md). They permit progress without repeated product questions. User changes supersede them.

## Checkpoints to expect

| Checkpoint | Reviewable proof |
|---|---|
| Local tracker | Log 20 and 15, see 35, restart the app, edit and undo, cross midnight |
| Connected accounts | Import guest reps once, recover account, use a second device, disconnect/reconnect without duplication |
| Community | Two real test accounts; private records remain invisible; geographic fallback works |
| Circles | Join by invitation, inspect shared totals, remove/leave and verify access disappears |
| Release candidate | Native iOS/Android evidence, working deletion, accessibility pass, no demo content |

## How to steer the build

Comment on the actual experience: “logging takes too many taps,” “this cream is too yellow,” or “I can’t tell whether it saved.” Ask the agent to update the relevant specification and regression checks as it changes behavior. Do not let one-off UI patches become competing product rules.

The app can be reviewed as it grows. External access blockers should be recorded precisely while independent local work continues. A missing account must not become a reason to stop all implementation, and an unavailable device must not become a reason to claim a device test passed.
