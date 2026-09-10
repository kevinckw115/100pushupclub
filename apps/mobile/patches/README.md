# Expo SQLite web bridge patch

expo-sqlite 57.0.2 writes its synchronous worker response length by assigning a Uint32Array into a Uint8Array. Typed-array `set` converts each element to one byte, truncating the length above 255. Reading three full check-ins reproduced a JSON parse failure in the real Expo browser adapter.

The patch writes the 32-bit length into a view over the actual response buffer. `patch-package` reapplies it during `npm ci`/`npm install`; a version mismatch must fail rather than silently skip the patch. This changes the browser worker bridge only.

Regression: run `npm run build:review`, serve with `node scripts/preview.mjs`, then `node scripts/review-logging.mjs --failure`. The build helper adds review routes temporarily and removes them after export. It saves and reads multiple real SQLite rows, reloads, edits, deletes and exercises rollback. Remove the patch only after verifying an upstream fix with that flow. Native behavior still needs its own device evidence.
