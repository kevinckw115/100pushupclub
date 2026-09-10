# Official source register

Checked September 10, 2026. These are implementation references, not copied implementation code. Product rules, quantities, thresholds and architecture defaults in this package are our design decisions unless stated otherwise. Verify version-sensitive APIs during bootstrap and store requirements at release.

| Source | Use in this package |
|---|---|
| [Expo development builds](https://docs.expo.dev/develop/development-builds/introduction/) | Native development workflow and cloud/local build choices |
| [Expo SQLite](https://docs.expo.dev/versions/latest/sdk/sqlite/) | Persistent local database and transactions; native-first verification |
| [Expo SecureStore](https://docs.expo.dev/versions/latest/sdk/securestore/) | Platform-specific session storage limitations |
| [Expo notifications](https://docs.expo.dev/versions/latest/sdk/notifications/) | Permission, scheduling and native testing APIs |
| [Supabase React Native auth](https://supabase.com/docs/guides/auth/quickstarts/react-native) | Auth client integration |
| [Supabase email passwordless](https://supabase.com/docs/guides/auth/auth-email-passwordless) | Email OTP path |
| [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security) | Database ownership and authorization controls |
| [Supabase realtime authorization](https://supabase.com/docs/guides/realtime/authorization) | Private-channel controls; safe invalidation architecture |
| [Supabase anonymous auth](https://supabase.com/docs/guides/auth/auth-anonymous) | Considered alternative; V1 chooses device-only guest mode instead |
| [Apple review guidelines](https://developer.apple.com/app-store/review/guidelines/) | Release review, accounts and user-entered content |
| [Google account deletion](https://support.google.com/googleplay/android-developer/answer/13327111) | In-app and web account deletion preparation |
| [Google UGC](https://support.google.com/googleplay/android-developer/answer/9876937) | Moderation/report/block assessment |
| [GeoNames exports and license](https://download.geonames.org/export/dump/) | Country and administrative-area data for the curated region directory |

This source review does not establish brand availability, provider cost, legal compliance, production scalability, or store approval. Those require the actual implementation and owner setup. No current pricing estimates or guaranteed launch dates are embedded in the build plan.
