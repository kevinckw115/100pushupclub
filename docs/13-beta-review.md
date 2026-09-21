# Beta and owner review packet

Prepared for review, not executed. No beta participants, device results, signed artifacts or store acceptance are claimed. T23 remains blocked until T22 setup and real device/user access exist.

## Setup checklist

1. Supply owner Expo organization/project, signing access and intended application identifiers. Install the candidate on iOS and Android, including an older/smaller phone.
2. Configure a separate hosted development backend, tested OTP delivery, the deletion worker schedule, staff/support ownership and HTTPS policy/support/deletion pages. Set actual backup/audit retention before publishing policy copy.
3. Complete native SQLite/secure-storage/reminder/share/accessibility checks in tests/e2e and ACCESSIBILITY.md. Capture exact commit, build ID, device/OS and result. Browser evidence in tracking/evidence is supplementary.
4. Recruit approximately 10-20 consenting adults with varied ability and both platforms for at least one week. Invitations require owner action/authorization; none were sent. Include users who use large text or assistive technology. Explain the test's purpose, optional public sharing and deletion/export controls without collecting personal fitness histories for research.
5. Give participants the configured support channel and a short issue form. Ask for device/build, steps, expected/actual behavior and approximate frequency. Do not request tokens, full databases, deletion proof, invite codes or account passwords. Redact screenshots before sharing.

## Device acceptance record

For every row record pass/fail/blocked, candidate commit/build, device/OS, timestamp, evidence location and defect ID. Use separate records per platform; blank means unverified.

| Gate | Procedure and required result | iOS | Android |
|---|---|---|---|
| A01-A06 durable logging | First launch offline; add20+15; double tap once; force-stop during/after save; reopen35; reconnect without duplicates | Unverified | Unverified |
| A07-A09 history | Midnight, DST and timezone change; past edit; recorded day unchanged | Unverified | Unverified |
| A10-A18 account integrity | OTP recovery, two-device conflicts/Undo, lost response, offline signout warning, switch identity, guest import interrupted/replayed | Unverified | Unverified |
| A19-A25 community | Explicit terms/sharing; off removes prior activity; block/report; foreground/offline clears stale data; refresh preserves scroll | Unverified | Unverified |
| A26-A30 circles | Create, copy/share invite, join consent,185 total/alphabetical zero member, fixed day, remove/leave/transfer, report name | Unverified | Unverified |
| A31-A32 privacy | Export owned data only; fresh deletion OTP; offline denial; accepted deletion blocks old session; restart/status and worker completion; guest retained | Unverified | Unverified |
| A33-A34 platform UX | Notifications denied/allowed/delivered/cancelled; haptics; VoiceOver/TalkBack;200% text; keyboard/back; Reduce Motion | Unverified | Unverified |
| A35-A37 candidate | Resolved environment/binary permissions; migration retains data and resumes sync; repeat offline/account/circle/deletion end-to-end | Unverified | Unverified |

Measure local durable-save p95 and warm Today on a representative midrange phone; retain the sample count/device and timing method. Desktop SQLite and disposable-CI HTTP timing do not satisfy these device/deployment budgets. Re-run the load scenario from the intended deployment region and record provider request volume/spend.

## One-week feedback

Ask after ordinary use: Was logging fast? Did you trust it saved? Was100 inviting or discouraging? Did community motivate or pressure you? Which label confused you? Did you return after a missed day? Record anonymized themes with consent. Keep feature requests separate from defects and avoid inventing aggregate activity or success percentages.

Use tracking/beta-findings.csv for actual findings only. Severity0: privacy/data loss/duplication or inaccessible core flow; stop distribution and fix before resuming. Severity1: core task blocked without workaround; fix before candidate. Severity2: recoverable usability problem; triage with owner. Each fix gets a task branch, reproduction, meaningful regression check and both affected device outcomes. No findings yet means the beta has not run, not that blocker count is zero.

## Store content draft

Proposed short description: "Log pushups a little at a time."

Proposed description: "Keep a daily record of your pushups with a goal of100. Log privately on your phone, including offline. An optional account saves your records across devices. Choose whether to share new activity with the Club, or join a small private circle. Edit your check-ins, review history, export your own records, and delete your account from Settings."

This describes implemented behavior; it is not a fitness outcome claim. Kevin still needs to review wording, branding/icon artwork and candidate visuals. Current evidence images are browser reviews, not store screenshots. Capture actual native Today0/35/100/125, History, Club, Circle and Settings from the candidate; use clearly identified test accounts and no fabricated live activity. The scaffold asset files are not approved store artwork.

| Implemented data/capability | Disclosure preparation |
|---|---|
| Email and verified account ID | Account authentication/recovery; private to Auth and authorized server paths |
| Check-in quantity/date/time/timezone | Personal tracking and account sync; treat fitness-related data accurately in current platform forms |
| Manual region and opt-in alias/activity | Community scope and explicit public participation; no GPS permission |
| Circle memberships and member totals | Shared with current authorized members under join-time/block rules |
| Reports, blocks and moderation audit | Safety and abuse handling; disclose actual approved retention |
| Local reminders/haptics | Optional platform functionality; no marketing push service implemented |
| Export files | User-initiated device download/share; native temporary file cleanup |
| Telemetry | No client analytics/advertising SDK added; server aggregate diagnostics; provider logging/retention still needs review |

Review the actual SDK inventory, native manifests and current store disclosure forms before submitting answers. Do not mark collection absent merely because it is not public. Tracking/advertising, permissions and age/distribution declarations require owner review against the final build and service configuration. No forms were submitted.

## Final approval record

Record candidate Git SHA, mobile lockfile SHA256, migration head, Expo/runtime/build image versions, EAS build IDs, native artifact checksums, signed application IDs/version/build numbers, hosted environment reference, support/policy/deletion URLs, retention settings, staff rota, backup/restore drill and native evidence links. Do not place credentials in this record.

Exit only after actual beta evidence exists, unresolved loss/duplicate/privacy blockers are zero, critical native flows pass and Kevin reviews warmth/speed/Option5 rendering. Record known limitations individually. Owner approval to submit/publish is separate from preparation; no release has been published.
