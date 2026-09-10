# Implementation setup

## First session

1. Inspect OS, Node, package manager, available emulators/devices, network and Git status.
2. Run existing package checks. Record baseline before modifying reference contracts.
3. Verify current stable Expo setup from official docs. Scaffold a TypeScript/Router project into apps/mobile; preserve the root handoff package.
4. Install compatible native modules through `npx expo install` from the mobile directory. Generate one lockfile; record versions. Do not install a guessed mix of SDK and React Native versions.
5. Add real mobile scripts and CI. Build production UI components from design tokens and execute M0/M1.

Use an Expo development build for native integrations. EAS can create cloud builds; local iOS compilation requires the appropriate Apple toolchain. Do not assume an iOS simulator exists on Windows/Linux. [Expo development builds](https://docs.expo.dev/develop/development-builds/introduction/).

## External access milestones

| Needed by | Required setup | What can proceed without it |
|---|---|---|
| M0 native review | Emulator or physical device and compatible build tooling | Domain, components, repository tests |
| M2 hosted integration | Supabase development URL/publishable key, migrations, email OTP delivery | Disposable local backend and sync simulations |
| M3 geography | Curated licensed region data with source/version | Small clearly labeled local test hierarchy |
| M4 invitation links | Owned web domain and associated app links for polished links | Pasteable opaque invite code and development links |
| M5 beta distribution | Expo/EAS and relevant developer-account access | Local builds, docs, native automation where available |
| M5 public release | Production service config, website/support, store ownership | Review packet, migration rehearsals, preview builds |

A blocker is exact: “Need a Supabase development project with OTP email configured to run A17 on physical phones.” “Need backend” is too vague. Do not claim simulated credentials or generated URLs are live.

## Configuration

Use [mobile.env.example](../templates/mobile.env.example) as a template. Public runtime values are EXPO_PUBLIC_APP_ENV, EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY. APP_ENV must be an allowed value; production must reject placeholders and test adapters. Validate at build/startup and make missing connected features explicit while allowing local guest mode in development.

Store admin/service credentials in server secret management only. Configure OTP templates, email provider, rate limits and redirect allowlists; verify recovery on both platforms. Do not silently add social login.

Set final bundle ID/application ID from the owner's verified namespace. In development use an obvious temporary identifier. Store configs must be generated after owner/project IDs exist, not fabricated in this handoff.

## Geographic directory implementation

T13 should import a versioned GeoNames snapshot using countryInfo.txt, admin1CodesASCII.txt and admin2Codes.txt. Those files provide country and administrative names/codes; the export describes its CC BY 4.0 license and data limitations. Preserve attribution and a link under Settings → About. [GeoNames export documentation](https://download.geonames.org/export/dump/).

Our implementation: map world → country → first-level administrative area → curated broad second-level area. In the US, Nearby uses counties. Elsewhere use a second-level area only after confirming it is an appropriate broad locality; otherwise fall back to the first-level area/country. Do not pretend every administrative level is a metro or use tiny administrative units merely because they exist. Show State/Region in UI where appropriate. Document coverage rather than inventing missing regions.

Use stable internal IDs backed by source geoname IDs, preserve original code/name mapping, record source URLs/download date/SHA-256/license in an import manifest, reject orphan parents, and generate ancestor rows. Source administrative codes are not uniformly ISO codes; never assume they are. The synthetic US-CA-ORANGE fixture ID is not a production source code. Do not import coordinates into user profiles or require a live third-party geocoding call when logging. Release directory updates are separate reviewed data migrations.

## Dependency and document drift

This package is dated September10,2026. SDK APIs and store policies can change. Use [the source register](13-sources.md) to verify relevant APIs at bootstrap/release, then pin compatible versions. Do not re-research unrelated libraries every task. Record a decision if an implementation constraint requires changing the stack or contract.
