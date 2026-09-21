# Browser-operated website setup

## What is ready

The standalone site is in apps/site. It exposes only home, support, policies and verified account deletion. It has no mobile tracker, community feed, analytics, external scripts or privileged keys. Design colors are generated from design/tokens.json. It uses the existing Supabase deletion contracts, with email OTP (create_user=false), in-memory access tokens and a browser-local durable recovery proof. Clearing browser storage loses that proof. The recovery record is never put in a URL or log.

This first deployment is a staging review, visibly labeled and excluded from indexing. It is pinned to the approved staging backend. Production data, final retention language, verified support delivery and working hosted cleanup are separate release gates.

## Vercel

1. Merge the reviewed website task branch after CI passes. If Expo linkage is not merged, this branch also includes that earlier commit; the comparison shows both changes.
2. In Vercel choose Add New > Project, import kevinckw115/100pushupclub and name the project 100pushupclub-support-staging.
3. Keep Root Directory at the repository root. Framework Preset is Other. The committed vercel.json selects build command `node apps/site/build.mjs`, output `apps/site/dist`, and skips dependency installation. No local commands are needed.
4. Use main as the production branch. Vercel's label "Production" means this project's primary deployment; the site and Supabase project are still staging.
5. Once the support mailbox has been tested, add environment variable SITE_SUPPORT_EMAIL with its actual address. Until then, the site explicitly says support setup is pending. Never add a database password, Supabase admin/service key or Resend key to this project.
6. Deploy and share the generated vercel.app URL. Keep Deployment Protection enabled for review if available on your plan. A reviewer must sign in or have a permitted access link; do not paste bypass secrets into chat.
7. Check /, /support/, /policies/, /delete-account/ and that /settings is not a mobile app route. Confirm HTTPS and browser console/network behavior. A complete staging deletion test needs a disposable consenting account and a working cleanup worker; do not use your only account.
8. Only after review, add staging.100pushupclub.com in Vercel Settings > Domains. Enter the exact CNAME target Vercel provides in Namecheap Advanced DNS with Host staging. Do not invent an IP or modify the Resend/auth or root mail records. Wait for Vercel's TLS verification.

The root domain 100pushupclub.com is reserved for the final public site, after production endpoint, support, privacy and cleanup checks. The site build currently refuses other remote backends, preventing accidental production configuration. WAF/source limits for Auth and the Supabase anonymous endpoints still need provider configuration and staging tests; a limit on the website alone does not protect direct Supabase requests.

## Support mailbox

If Namecheap Free Email Forwarding is already selected and root MX records point to Namecheap forwarding servers, open Domain List > Manage > Redirect Email and add alias support with the owner's confirmed destination. Keep existing auth-subdomain Resend records intact. Test delivery from a different mailbox.

Forwarding is inbound only. Replies from Gmail normally show the Gmail address. To reply as support@100pushupclub.com, choose a mailbox provider with outbound SMTP and configure its supplied DNS; do not assume Resend SMTP is a human support mailbox. Confirm the desired reply identity before purchasing a mailbox or changing MX records.

## Verification

Local: `node apps/site/build.mjs`, `node --test tests/site-recovery.test.mjs`, then `node apps/site/serve.mjs` for localhost:8082. Browser review covers all four pages at 390px. GitHub backend CI runs tools/backend/tests/site-browser.mjs against disposable local Auth/PostgreSQL, including a suspended account, fresh OTP, confirmation, offline retry, status after reload, actual worker cleanup and peer isolation. This does not certify deployed headers, DNS, mailbox, gateway limits or production retention.

Sources: [Vercel project configuration](https://vercel.com/docs/project-configuration), [Namecheap email forwarding](https://www.namecheap.com/support/knowledgebase/article.aspx/308/2214/how-to-set-up-free-email-forwarding/).
