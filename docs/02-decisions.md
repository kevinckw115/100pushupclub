# Decision log

Status key: **Approved** = explicit user direction. **Default** = architect-selected for implementation, changeable by the user. Defaults do not require reconfirmation before work.

| ID | Status | Decision | Reason |
|---|---|---|---|
| D01 | Approved | Name 100pushupclub; 100 reps/day; any set size | Original concept |
| D02 | Approved | Quiet, kind strength; only check-ins; no attention economy | Product identity |
| D03 | Approved | Geographic community and group features | Shared motivation |
| D04 | Approved | Option 5 Cream & Brick visual direction | Selected mockup |
| D05 | Default | React Native / Expo / TypeScript; Supabase; SQLite | Shared mobile code with managed backend |
| D06 | Default | Light mode only for V1 | Protect visual quality and scope |
| D07 | Default | Local guest; email OTP permanent accounts; no anonymous cloud users | Works on first launch offline; simple recovery and import |
| D08 | Default | 1–999 per entry; >100 confirmation; no total cap | Mistap protection without punishing participation |
| D09 | Default | Immutable captured local date; no backdating UI | Predictable history and smaller conflict surface |
| D10 | Default | Outbox, idempotent mutations, per-record versions | Retry safety and explicit multi-device conflicts |
| D11 | Default | Public off; current-consent epoch; future eligible entries only | No accidental retrospective sharing |
| D12 | Default | Community rolling 24h / 1h; circle fixed timezone | Accurate cross-border counts |
| D13 | Default | Broad manual geography; k=10 contributors for narrow scope | Reduced location disclosure and no GPS permission |
| D14 | Default | Private circles 2–20 intended members; 20 enforced max; 5 active circles/user | Small-group accountability and bounded V1 |
| D15 | Default | Email-only accounts; no social login/payments | Reduce external setup and authentication paths |
| D16 | Default | Local optional reminders; no community push notifications | Keep app quiet and avoid notification infrastructure |
| D17 | Default | Report/block aliases and circle names; basic staff moderation | User-entered names still create abuse surface |
| D18 | Default | Adults-first beta positioning; no DOB collection in V1 | Avoid designing a child-focused service by accident |
| D19 | Default | World feed readable through sanitized endpoint for guests | Community motivation before signup |
| D20 | Default | Invitation via expiring opaque link plus pasteable code | Usable before universal links are configured |
| D21 | Default | GeoNames versioned country/admin1/admin2 directory, with broad-locality curation | Concrete source for manual geographic selection |

## Changes to the earlier concept that are intentional

- Club aggregate label is “pushups in the past 24 hours,” not “pushups today.”
- Private circle “Today” includes its timezone and may differ from personal Today.
- Public user-entered names receive report/block controls; these do not add social posting.
- Sensitive raw timestamps and records do not stream to public devices; realtime signals trigger safe refetches.
- The screenshot's numbers are QA fixtures only. Real empty states are part of launch quality.

## Choices deferred until setup, not implementation blockers

Owner-controlled developer organization and store seller name; available reverse-domain app identifier; production region/data residency; support address and policy website; brand/name availability checks; distribution countries and final store age rating. Use clearly named local placeholders and document them; do not invent verified ownership or legal clearance. Reassess relevant requirements at release using official sources.

## ADR change template

Date / ID / prior decision / new decision / user direction or evidence / impacted contracts and tests / migration or compatibility consequences. Keep old records rather than silently rewriting history.
