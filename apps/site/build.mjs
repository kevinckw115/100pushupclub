import { mkdir, writeFile, copyFile, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = new URL('./', import.meta.url), out = new URL('./dist/', root);
const api = process.env.SITE_SUPABASE_URL ?? 'https://ggeyfolfedercmfvwsqx.supabase.co';
const key = process.env.SITE_SUPABASE_PUBLISHABLE_KEY ?? 'sb_publishable_Azk0YpXofjkh4QJhreZt7g_b7A0DLWn';
const local = process.env.SITE_LOCAL_TEST === '1';
const endpoint = new URL(api);
if ((!local && api !== 'https://ggeyfolfedercmfvwsqx.supabase.co') ||
    (local && !['127.0.0.1', 'localhost'].includes(endpoint.hostname))) throw new Error('Site is restricted to staging or explicit localhost tests.');
if (!local && !/^sb_publishable_[A-Za-z0-9_-]+$/.test(key)) throw new Error('Site requires a public publishable key.');
const support = process.env.SITE_SUPPORT_EMAIL ?? '';
if (support && !/^[A-Za-z0-9._+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(support)) throw new Error('Invalid support email.');
const escape = value => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');
await mkdir(out, { recursive: true });
const tokens = JSON.parse(await readFile(new URL('../../design/tokens.json', root), 'utf8'));
await writeFile(new URL('tokens.css', out), ':root{' + Object.entries(tokens.colors).map(([k,v]) => `--${k}:${v}`).join(';') + '}');
await writeFile(new URL('config.json', out), JSON.stringify({ api, key }));
for (const name of ['style.css', 'deletion.mjs', 'client.mjs']) await copyFile(new URL(name, root), new URL(name, out));
const contact = support ? `<a href="mailto:${escape(support)}">${escape(support)}</a>` : 'Support email setup is in progress for this private staging review.';
const pages = {
  'index.html': ['100pushupclub', '<p class="lead">A quiet place to keep showing up.</p><p>100pushupclub is a native mobile pushup tracker. This website provides account help, privacy information and account deletion.</p><p>The app is being tested. No public release is available here.</p>'],
  'support/index.html': ['Support', `<p>For app or account problems, contact: ${contact}</p><p>Include your app version and a short description. Do not send sign-in codes, session tokens, invitation codes, deletion recovery proofs or database exports.</p><p>You can request <a href="/delete-account/">account deletion</a> without installing the app.</p>`],
  'policies/index.html': ['Privacy and participation', `<h2>Your personal log</h2><p>Guest check-ins stay on your device. Signing in enables cloud synchronization. Importing guest history is your choice and keeps those records private.</p><h2>Sharing</h2><p>Public sharing starts off. When enabled, eligible new activity can show your alias, quantity and approximate relative time. Regions are manually selected; the app does not request GPS. Circle membership separately shares eligible new activity with that circle. Imported and pre-join activity stay private.</p><h2>Participation</h2><p>Log your own activity honestly. Do not harass, impersonate or abuse others. Use the app to report or block inappropriate behavior.</p><h2>Export and deletion</h2><p>Export your records in the app before deleting. Deletion requires a fresh email code and explicit confirmation. Accepted requests immediately disable account access. Primary cleanup has a seven-day operational target. Separate guest records stay on your device. Owned circles transfer to an eligible member or are deleted if none remains.</p><h2>Staging operations</h2><p>This is a staging policy, not a final public-launch notice. Backup expiry, moderation-audit retention and the hosted cleanup schedule still require operator verification before public launch. Minimal moderation audit records and provider backups can remain separately from primary account data.</p><h2>This website</h2><p>The deletion page keeps a recovery proof in this browser so you can check status after your account is removed. Sign-in tokens remain in memory. No analytics or advertising scripts are included. Hosting and authentication providers may retain operational logs.</p><p>Contact: ${contact}</p>`],
  'delete-account/index.html': ['Delete account', `<p>This deletes your cloud account, check-ins, sharing settings and memberships. Export your records in the app first if you want a copy. Separate guest records stay on your device.</p><p>Owned circles transfer to the earliest eligible member or are deleted if none remains. Account access stops when deletion is accepted. Primary cleanup has a seven-day operational target; see <a href="/policies/">retention information</a>.</p>
<p id="message" role="status" aria-live="polite">Loading secure account tools…</p>
<section id="recovery" hidden><h2>Saved request</h2><p>A recovery record is saved in this browser. Keep it until cleanup is complete.</p><button id="status" type="button">Check deletion status</button><button id="forget" type="button" hidden>Remove completed recovery record</button></section>
<form id="send-form" hidden><label for="email">Account email</label><input id="email" type="email" autocomplete="email" required maxlength="254"><button type="submit">Send verification code</button></form>
<form id="verify-form" hidden><label for="code">Email code</label><input id="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6,10}" required maxlength="10"><button type="submit">Verify code</button></form>
<form id="delete-form" hidden><label class="confirm"><input id="confirm" type="checkbox" required> I understand the deletion scope and want to delete my account.</label><button type="submit">Confirm account deletion</button></form>
<noscript>Enable JavaScript to verify ownership and request account deletion.</noscript>`],
};
for (const [path, [title, body]] of Object.entries(pages)) {
  const target = new URL(path, out); await mkdir(new URL('./', target), { recursive: true });
  await writeFile(target, `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>${title} · 100pushupclub</title><link rel="stylesheet" href="/tokens.css"><link rel="stylesheet" href="/style.css">${path.startsWith('delete-account') ? '<script type="module" src="/deletion.mjs"></script>' : ''}</head><body><a class="skip" href="#main">Skip to content</a><header><a class="brand" href="/">100pushupclub</a><span>Staging review</span></header><main id="main"><h1>${title}</h1>${body}</main><footer><nav aria-label="Help"><a href="/support/">Support</a><a href="/policies/">Privacy</a><a href="/delete-account/">Delete account</a></nav></footer></body></html>`);
}
await writeFile(new URL('404.html', out), '<!doctype html><html lang="en"><meta charset="utf-8"><title>Page not found</title><h1>Page not found</h1><a href="/">Return to 100pushupclub</a></html>');
console.log('Staging support site built: ' + fileURLToPath(out));
