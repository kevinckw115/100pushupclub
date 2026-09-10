# Screens, routes, and states

Route paths are the intended Expo Router structure, not files already implemented. Today, Club, Circles, You are the four persistent tabs. Settings is reachable from the Today gear and You. Back behavior follows the native platform; Android back closes the keyboard before the sheet.

| ID / route | Content and actions | Required states |
|---|---|---|
| S01 /welcome | Wordmark, “100 is the goal. Start with what you can.”; Get started; Sign in | First run, returning account, offline guest |
| S02 /(tabs)/today | Date, headline, ring, total, remaining/completion copy, Log, today's entries | 0/35/100/125, loading DB, DB failure, pending sync |
| S03 /log modal | Quantity, +/-1, presets, projected total, Log, Cancel | Invalid/empty, >100 confirm, keyboard, saving, disk error |
| S04 /checkin/[id] modal | Quantity edit, recorded time locally, Save, Delete | Synced/pending, stale version, deleted elsewhere |
| S05 /(tabs)/club | Scope selector, actual scope, aggregate windows, recent rows | Guest, no region, sparse fallback, empty, stale/offline, report/block |
| S06 /region | Search/select country/state/broad locality; explain approximate scope | No permission prompt; missing locality -> ancestor |
| S07 /(tabs)/circles | Membership list; Create; Join | Signed-out explanation, zero groups, full quota, loading/error |
| S08 /circles/[id] | Name, timezone/date, checked-in/current-member ratio, total, alphabetic members | Empty, active, removed/left, offline cached banner |
| S09 /circles/create | Name 3–40 chars, fixed timezone, privacy disclosure | Invalid name, quota, successful creation |
| S10 /circles/join | Paste code or incoming link, preview name/member count, disclosure, Join | Expired/revoked/full, auth required, already member |
| S11 /circles/[id]/manage | Invite; revoke link; members; remove; transfer owner; leave/delete | Owner/member controls; final owner rules |
| S12 /(tabs)/you | Alias or guest state, 30-day history, active days/100-days, older history | Empty, dates with >100, edited past entry, loading |
| S13 /history/[date] | Daily total and entries; edit/delete existing records | Empty/deleted, historic date, no add/backdate control |
| S14 /settings | Account, region, sharing, reminders, haptics, export, policies, support, delete | Guest vs account, saving preferences, offline |
| S15 /auth | Email then OTP, resend countdown, recovery flow | Incorrect/expired code, rate limit, delivery failure, cancel |
| S16 /import | Guest count/total; Import or Keep separate | Restart mid-import, existing account, completion |
| S17 /privacy | Public-feed toggle and explanation, blocked list, delete account | Online-only consent change, pending network error |
| S18 /conflicts | Local requested value vs saved account value; Use account / Apply mine | Server deleted -> use deletion or create explicitly as new private entry |
| S19 /delete-account | Explain scope, reauthentication, confirm deletion | Offline unavailable, processing, failure, complete |

## Today and logging flow

1. First-run Get started creates a local guest partition and opens Today, without auth/location/notification dialogs.
2. Today total is the local materialized view including pending mutations for the active partition only.
3. Log opens with 10. Presets replace input. Tapping Log validates and atomically writes the entry and outbox if account-backed.
4. After commit, close sheet, update count and show “10 added.” with Undo for 8 seconds. A local disk error leaves the sheet/input intact and says nothing was saved.
5. Undo cancels an unsent create atomically or queues a delete after an already-sent create resolves. If request delivery is uncertain, retry the original mutation first to discover accepted state, then delete.
6. Today entries are newest first, using local recorded time, stable ID as tie-breaker. Edit changes quantity only.

## Community details

Feed ordering uses occurred_at descending and opaque ID tie-breaker, never magnitude. Response carries safe relative-time labels and no raw timestamp. The UI periodically refetches to keep labels fresh. Older delayed sync cannot jump to “just now.” Aggregates sum accepted eligible current records; a later edit corrects totals without emitting another check-in row.

Show “Updated 2 min ago” for cached content. “Live” only when subscribed and a successful fetch occurred in the past 60 seconds; otherwise “Recent check-ins.” Scope switch resets pagination and closes the previous subscription. Nearby means selected broad locality, not physical proximity or a radius.

When below disclosure threshold: “Showing California while your area gets started.” Do not display the suppressed area's exact contributor count. World empty: “No check-ins yet. Start with yours when you're ready.” Guests can browse but must sign in and explicitly enable public sharing to contribute.

## Circle details

Show every active member alphabetically, not just participants. Zero activity is neutral “No check-in yet.” Denominator counts all active members including blocked accounts; blocked rows and their contributions are hidden for that viewer, and caption states “Some activity is hidden.” Numerator and total use visible qualifying contributors only. This avoids implying a block removed group membership.

Join includes “Members can see your new check-ins while you're in this circle.” New members never receive prior personal history. For a group, qualifying activity must be non-imported and have occurred_at AND server created_at at or after the current membership joined_at. Rejoining starts a new membership interval. Group timezone shown in a short readable label with full IANA ID available on tap.

Owner can remove members, revoke invites, transfer ownership, or delete circle. An owner with other members must transfer ownership before leaving. A sole owner can delete. Regular members may leave at any time. Invite display has share-sheet/copy actions, not contact uploads or automatic messages.

## Auth/account details

Guest and signed-in partitions never blend silently. On signout, pause sync, clear the active account cache/session and return to the prior guest partition. If there are unsynced changes, explain “X check-ins haven't synced” and allow retry, cancel, or explicit discard-and-signout; do not lose data silently.

OTP sign-in uses code entry rather than requiring magic-link routing. Preserve guest partition across attempts. Auth email is never requested as a public alias. Account deletion invalidates public visibility immediately, then completes server cleanup and local cleanup. See release/security specs for deletion recovery.

After verified login, bootstrap profile/sync state idempotently and show the generated alias with an edit affordance. Complete bootstrap before import/sync; a failed bootstrap preserves local records and offers retry. Existing accounts keep their alias and preferences. Public sharing and circle joining show which alias others will see.

## Reminders

Off by default. Ask OS permission only when enabled. One daily local reminder at chosen local wall-clock time. Schedule rolling one-shot reminders for the next 7 days and refresh on app foreground/settings change. On reaching 100, cancel today's still-pending reminder; future reminders remain. Explain OS delivery may vary. Do not claim suppression on a second offline device; reminders are per-device and may be cancelled after its next sync. No reminder permission is needed for tracking.
