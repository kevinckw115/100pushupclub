# Native A34 review matrix

Required setup: install the current development build on a named iPhone/iOS version and Android/device/API version. Configure a disposable/development backend for community routes. Record build commit, device, OS, text size, screen-reader/motion settings and outcome for each row. Screenshots alone are insufficient.

| Scenario | Required observation |
|---|---|
| VoiceOver / TalkBack, guest onboarding and Today | Logical order, title/goal/readout, tab selection, Settings and Log controls identified; decorative icons skipped |
| Quantity sheet | Focus enters sheet; background cannot be traversed; +/- and presets labelled; invalid quantity announced; save confirms only durable commit; focus returns meaningfully |
| Largest supported text, including200% | Count expands outside ring when needed; no clipped totals, buttons or fields; all actions reachable by scrolling at320pt-equivalent width |
| Software keyboard and Android back | Quantity/email/name fields stay visible; first back dismisses keyboard, next closes sheet; no lost saved data |
| Reduce Motion | Ring transitions and sheet animations respect setting; no information requires animation |
| Account / sharing / import | Pending and rejected states understandable; terms/consent choices spoken; ownership and import confirmation distinct |
| Club / circle / safety | Correct headings; alphabetical member traversal; overflow names identify target; no unexpected jump; block/leave clears private content |
| Export and deletion | System file/share controls work; fresh email verification and destructive confirmation reachable; interrupted cleanup recovers; guest data preserved |
| Reminder denied and enabled | No inaccessible loop; system settings route works; scheduling outcome honest |

Repeat offline/process termination and foreground recovery on both devices. Attach evidence and exact failures to tracking/evidence/T20.md. Until these observations exist, A34 and native release readiness remain blocked.
