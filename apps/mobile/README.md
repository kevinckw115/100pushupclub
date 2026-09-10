# Mobile development

From this directory, use Node 24.12+ and `npm ci`. On Windows with restricted PowerShell scripts, use `npm.cmd`.

- `npm start`: Metro development server.
- `npm run android` / `npm run ios`: build and run a development client with the platform toolchain installed.
- `npm run web`: browser rendering preview; does not verify native storage or notifications.
- `npm run lint`, `npm run typecheck`, `npm test`, `npm run test:integration`: automated checks.
- `npm run doctor`: Expo compatibility checks.
- `npm run export`: bundle Android, iOS, and web; this is not a native binary build.
- `npm run export:web`: browser bundle with a check excluding review/test modules.
- `npm run build:review`: temporary development-only component/failure review routes, removed from source after export; then run the scripts/review-*.mjs checks with the preview server running.
- `npm run test:e2e`: Maestro flows against an installed development build.

The temporary identifier is `dev.local.pushupclub`. EAS development/preview profiles are provided, but require an owner-controlled Expo project before cloud builds. Production configuration deliberately fails until service configuration and final app identity are supplied. Local guest development requires no secrets.

Native setup: install Android Studio, Android SDK 36, compatible JDK, and an emulator or USB-debugging device for Android. iOS requires macOS with Xcode compatible with Expo SDK 57, or an authorized EAS project and physical iPhone. Native evidence must be recorded separately from browser screenshots.

Version references: [Expo SDK 57](https://docs.expo.dev/versions/v57.0.0/), [Router setup](https://docs.expo.dev/router/installation/).
