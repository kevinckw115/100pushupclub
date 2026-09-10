# Native checks

Runner: Maestro CLI 2.10.0 (official release `cli-2.10.0`). Install it on a supported host with a connected simulator/emulator or device and install the app's development build first. Run `npm run test:e2e` from apps/mobile.

The smoke flow verifies startup only. Later flows must cover durable offline saves and restart, accessibility, and reminders. Do not record these as passed until executed on the named native target.
