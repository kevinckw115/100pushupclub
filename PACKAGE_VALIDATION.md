# Package validation

Validated September 10, 2026 in the authoring environment.

| Check | Observed result |
|---|---|
| `node --test tests/domain.test.mjs` | PASS: 29 tests, 0 failures, 0 skipped |
| `node --check contracts/domain.ts` | PASS: syntax accepted; this is not a TypeScript typecheck |
| `python3 scripts/validate_package.py` | PASS: 29 required files, local Markdown targets, JSON, 23-task dependency graph, 37 acceptance scenarios, fixture arithmetic and PNG signature |
| Palette contrast calculation | Main text/cream 11.10:1; secondary text/cream 4.65:1; cream/brick button 6.03:1; secondary text/surface 4.90:1 |
| Manual contract review | Clarified profile bootstrap, account partitions, consent races, guest import, circle membership windows, cursor disclosure and region-source provenance |

Runtime used: Node v24.19.0; Python 3.12.14. The Node tests were run directly, without installing packages. The included npm scripts wrap those commands. The included GitHub workflow has not run on GitHub.

## Scope of verification

The reference model exercises pure quantities/date calculations and sequential examples of replay, record versions and tombstones. It does not implement real storage transactions, concurrent PostgreSQL commits, authenticated sessions, consent filtering, realtime or native UI. Its actor argument is a test identity, not production authorization.

The TypeScript contract received a syntax check only. Full typechecking belongs to the implemented app toolchain. Contrast calculations cover specified text/color pairs, not a completed accessibility audit.

## Not yet built or tested

Expo app, native SQLite adapter, backend migrations/functions/RLS, OTP integration, production sync worker, geography import, live feed, circles, notification delivery, deletion jobs, mobile end-to-end tests, device screenshots, hosted deployments and store submission. These are explicitly assigned to T01–T23 and A01–A37.

No claim of app completion, production readiness, store approval or a success percentage is made by these package checks.
