# Product specification

## Purpose and audience

100pushupclub helps an everyday beginner build a habit by logging manageable sets toward 100 pushups in a day. It supplies quiet evidence that other people are making the same effort. The central action is recording completed reps, not consuming content.

User-approved principles: encouraging, kind, firm, simple; no ego or attention signaling; set-by-set logging; geographic community; aliases instead of personal details; no social posts. Option 5 is approved. Implementation defaults are identified in the decision log.

## Scope of V1

| Area | Required behavior |
|---|---|
| Today | Zero/partial/100+/offline/error states, total, progress, check-in list |
| Logging | Any integer 1–999, presets 5/10/20/25, edit quantity, undo/delete |
| History | 30-day default view, older paginated history, daily totals and active days |
| Guest | Fully local personal tracking without network or registration |
| Account | Email OTP signup/sign-in, guest import, recovery, signout, deletion |
| Club | Nearby/state/country/world filters, sanitized recent feed, aggregate participation |
| Circles | Create, invitation, join, member activity, leave/remove/transfer ownership |
| Settings | Alias, region, public sharing, local reminders, haptics, export, privacy/support |
| Operations | Minimal authenticated moderation tools, reports/blocks, error telemetry, deletion jobs |

Not in V1: automatic camera counting, workout plans, health-platform integration, other exercise types, paid subscriptions, ads, wearable app, public web tracker, dark theme, chat or leaderboards. Marketing/privacy/deletion web pages are supporting release surfaces, not a second tracker application.

## Rules

- A rep is self-reported. Wall, knee, incline, and standard reps all count equally. No proof uploads or form scoring.
- Goal is always 100. Participation begins at 1. No weekly catch-up debt or streak penalties.
- Entry limit 999 is input protection, not exercise advice. Totals can exceed 100 and do not receive escalating rewards. Confirmation for entries above 100: “Add 150 pushups?” with Edit and Add.
- Logging captures current time and IANA timezone, deriving an immutable local date. V1 has no user backdating or editing of timestamps. Quantity can be corrected or deleted later.
- Log success occurs after local storage commits. Unsynced entries remain part of the visible personal total and are labeled privately when needed.
- Progress ring = min(total/100, 1). At 100+ show the actual total and “100 today. Nicely done.” No negative remaining quantity.
- Undo is available for 8 seconds; entry editing/deletion remains available afterward. Undoing a sent create becomes a delete, never a request to subtract an untracked amount.
- History counts a day as active if its nondeleted total is greater than zero. 100-days are dates whose total is at least 100. Rest dates show neutral blanks/zero, not red failures.
- Date rollover refreshes on foreground and at midnight while open. Repeated timezone dates combine under that calendar date in personal history; existing dates never move.
- Device time is acceptable for personal records. The server rejects timestamps more than five minutes ahead of its clock; the app preserves rejected records locally and offers correction guidance, without silently changing their recorded day.

## Identity and visibility

Guest data is device-only. On first account login, offer “Bring this device’s X check-ins into your account?” with Import and Keep separate. This prevents importing someone else’s records on a shared phone. IDs make repeated imports safe; imported history is private and never becomes a live feed event.

Authentication email is private. Public alias: 3–20 ASCII letters, digits or underscores, case-insensitive uniqueness, no email/URL, with a reserved/prohibited term check. Preserve display casing. Alias changes update displayed identity; stable internal IDs handle reports and blocks. No avatar uploads or profile biographies.

Public sharing is off by default. Enabling it shares only future eligible check-ins. Disabling it removes the user's existing public contributions from feed/aggregates, invalidates their share permissions, and does not republish them if sharing is enabled again. See the consent epoch in data/sync docs.

Joining a circle explicitly permits other current members to see qualifying rep totals while membership remains active, regardless of public-feed preference. Explain this before Join. Only activity created after joining and occurring after joining is included; no imported history. Leaving removes access and contributions to current queries. No post-leave history page for former members.

## Time semantics

Personal Today follows the device's current local date. Each saved entry keeps its recorded date and timezone permanently.

Community uses rolling “past hour” and “past 24 hours” windows, using server time and occurred_at, across every geography. This intentionally replaces the mockup's ambiguous community “today.” Old offline logs do not become new live activity.

Each circle uses a fixed IANA timezone chosen by its creator, defaulting to their device timezone. Group “Today” is the current calendar day in that timezone, based on occurred_at. Show the timezone near the group date. It can differ from someone's personal Today; explain in the detail sheet. Timezone cannot change in V1.

## Community experience

Recent rows have only alias, set quantity, and bucketed relative time. They have no user-detail destination. Overflow offers report/block. Foreground updates are quiet, no sound or per-entry push notification. Preserve reading position with a “New check-ins” affordance when scrolled away from top.

Default scope is Nearby if a region exists and is eligible; otherwise World. Geography is selected manually from a curated hierarchy: country → state/administrative area → broad metro/county. Do not request GPS or contacts. Never draw individual map pins. Narrow scopes require at least 10 distinct eligible contributors in the past 24 hours; otherwise use the next eligible ancestor, ultimately World. State the actual scope shown, not the originally requested scope. World may show a truthful small/empty feed without an anonymity claim.

Raw records and exact event times remain server-only. Relative time is bucketed as just now, 1 min ago, etc. This is reduced disclosure, not guaranteed anonymity. Small named circles are explicitly a separate consent model.

## Success measures

During beta evaluate: time to log, successful save rate, duplicate/lost record incidents, users returning to log within 7 days, and whether community feels encouraging. Store minimal aggregate events without email, alias, location, free text, or rep quantities in third-party analytics. Targets are internal goals, not claims: typical preset logging within 3 taps; no lost acknowledged local saves; no duplicate accepted mutations.

Beta feedback should include beginners who log fewer than 10 reps. High totals are not a proxy for product success.
