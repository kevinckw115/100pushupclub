# Expo SQLite web bridge patch

expo-sqlite 57.0.2 writes its synchronous worker response length by assigning a Uint32Array into a Uint8Array. Typed-array `set` converts each element to one byte, truncating the length above 255. Reading three full check-ins reproduced a JSON parse failure in the real Expo browser adapter.

The patch writes the 32-bit length into a view over the actual response buffer. `patch-package` reapplies it during `npm ci`/`npm install`; a version mismatch must fail rather than silently skip the patch. This changes the browser worker bridge only.

Regression: run `npm run build:review`, serve with `node scripts/preview.mjs`, then `node scripts/review-logging.mjs --failure`. The build helper adds review routes temporarily and removes them after export. It saves and reads multiple real SQLite rows, reloads, edits, deletes and exercises rollback. Remove the patch only after verifying an upstream fix with that flow. Native behavior still needs its own device evidence.

T09 also replaces the worker synchronous wait loop iteration limit with a five-second elapsed-time deadline. Concurrent cold starts reproduced SQLITE_WORKER_TIMEOUT (5/6 initial sessions and1/4 diagnostic sessions) even though the worker was healthy. Iteration count depends on CPU speed and scheduling. The deadline remains bounded and leaves native SQLite unchanged. Regression: ordinary `npm run export:web`, preview server, `node scripts/review-startup.mjs`; six isolated browser contexts must reach onboarding, create a guest, and reload persisted Today without storage errors. All six passed after the patch.
