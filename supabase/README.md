# Disposable backend development

Install Node24.12+ and a Docker-compatible runtime. From tools/backend run `npm ci`. From the repository root:

```sh
node tools/backend/scripts/cli.mjs start -x studio,imgproxy,storage-api,edge-runtime,logflare,vector,supavisor
node tools/backend/scripts/cli.mjs db reset --local
node tools/backend/scripts/cli.mjs test db
cd tools/backend
npm test
```

These reset/test commands are only for the disposable local stack. The test runner refuses non-local API and database hosts. It creates temporary Auth users and verifies real JWT/RLS behavior and concurrent PostgreSQL constraints, then removes those users. No hosted project is linked or deployed by this workflow.

The local seed contains only the World hierarchy root, no sample activity or users. Application tables live in app_private, with no client grants and RLS enabled. Checked public functions derive identity from the verified permanent session and use a fixed search_path. Profile bootstrap revisions are informational; a new client must still pull from its own durable cursor.

Native/hosted OTP integration requires the owner’s development Supabase and Expo projects later. CI runs the disposable backend with no production credentials.
