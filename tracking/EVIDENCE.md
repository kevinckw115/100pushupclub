# Product evidence ledger

No product implementation evidence yet. Package validation belongs to [PACKAGE_VALIDATION.md](../PACKAGE_VALIDATION.md).

For each task add:

- Task and acceptance IDs:
- Build/commit and backend migration versions:
- Environment and dependency versions:
- Exact command, result and date:
- Native target/build and screenshot paths:
- Failure scenarios actually exercised:
- Known limitations or not-run checks:
- Status: implemented / automated / native / beta / blocked:

Never copy expected outputs here as if they were observed results.

## T01

See [bootstrap evidence](evidence/T01.md). Implemented and automated checks passed except the explicitly recorded native-bytecode/Python gates. Browser screen inspected; native not run.

## T02

[Component evidence](evidence/T02.md): browser interactions and screenshots checked; native accessibility remains open.

## T03

[SQLite evidence](evidence/T03.md): real host SQLite persistence, process exit, migration, atomic rollback and isolation verified. Native adapter unverified.

## T04

[Guest/Today evidence](evidence/T04.md): actual Expo browser SQLite setup/reload and navigation passed; native and populated states remain open.

## T05

[Logging evidence](evidence/T05.md): 11 real integration checks and browser save/edit/delete/Undo/failure flow passed; one-line SDK web bridge fix verified through fresh install. Native checks not run.

## T06

[History evidence](evidence/T06.md): clock, SQLite pagination and browser midnight/history flow passed; native lifecycle pending.

## T07

[Preference/reminder evidence](evidence/T07.md): planner policy and browser persistence verified; native delivery/permission/haptics not run. Ordinary exports now exclude review code.

T08: verified disposable Postgres/Auth security, constraints, rollback and race gates; see tracking/evidence/T08.md.
T09: implemented email OTP and secure partition lifecycle; real Auth/browser and storage failure gates pass, native delivery/storage pending; see tracking/evidence/T09.md.

T10: real PostgreSQL/JWT mutation, conflict, rollback, cursor, rate and concurrency gates passed atfa74bff; tracking/evidence/T10.md.
