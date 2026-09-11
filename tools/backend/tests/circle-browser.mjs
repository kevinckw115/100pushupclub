import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { chromium, expect } from '../../../apps/mobile/node_modules/@playwright/test/index.mjs';
import { account, localEnvironment, request, removeAccount } from './environment.mjs';
const config = localEnvironment(), users = [], errors = [], db = new pg.Client({ connectionString: config.db });
let server, browser, a, b;
const rpc = async (user, name, body = {}) => { const r = await request(config, '/rest/v1/rpc/' + name, { token: user.token, body }); expect(r.status).toBe(200); return r.data; };
const op = (user, name, fields) => rpc(user, name, { envelope: { operation_id: randomUUID(), ...fields } });
const create = (user, quantity) => { const time = new Date().toISOString(); return rpc(user, 'mutate_checkin', { envelope: { kind: 'create', mutation_id: randomUUID(), checkin_id: randomUUID(), quantity, occurred_at: time, recorded_timezone: 'Asia/Tokyo', local_date: new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(time)), source: 'native', requested_public_epoch: null } }); };
const visibleText = (page, value, options) => page.getByText(value, options).filter({ visible: true });
const button = (page, name) => page.getByRole('button', { name, exact: true });
async function login(user) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } }); page.on('pageerror', e => errors.push(e.message));
  await page.goto('http://127.0.0.1:8081'); await button(page, 'Get started').click(); await button(page, 'Settings').click(); await button(page, 'Sign in or recover account').click();
  const details = await request(config, '/auth/v1/admin/users/' + user.id, { admin: true, method: 'GET' }), email = details.data.email;
  await page.getByLabel('Email', { exact: true }).fill(email); await button(page, 'Send code').click(); await expect(page.getByText('Check your email for a sign-in code.')).toBeVisible();
  const code = await request(config, '/auth/v1/admin/generate_link', { admin: true, body: { type: 'magiclink', email } }); expect(code.status).toBe(200);
  await page.getByLabel('Email code', { exact: true }).fill(code.data.email_otp); await button(page, 'Verify code').click(); await expect(button(page, 'Log pushups')).toBeVisible();
  return page;
}
try {
  await db.connect();
  for (let i = 0; i < 3; i++) { const user = await account(config); users.push(user); await rpc(user, 'bootstrap_profile', { operation_id: randomUUID() }); await op(user, 'update_profile', { alias: ['circle_zebra', 'circle_alpha', 'circle_middle'][i], ...(i ? { accepted_terms_version: 'community-v1-2026-09-11' } : {}) }); }
  await create(users[0], 45); await create(users[1], 55); // Personal history before either membership.
  server = spawn(process.execPath, ['scripts/preview.mjs'], { cwd: new URL('../../../apps/mobile/', import.meta.url), stdio: 'ignore' });
  for (let i = 0; i < 40; i++) { if (await fetch('http://127.0.0.1:8081').then(r => r.ok, () => false)) break; await new Promise(resolve => setTimeout(resolve, 250)); }
  browser = await chromium.launch({ channel: 'chrome', headless: true }); a = await login(users[0]);
  await a.getByRole('tab', { name: 'Circles', exact: true }).click(); await expect(visibleText(a, 'No circles yet. Create a small group or join with an invite.')).toBeVisible({ timeout: 20000 });
  await button(a, 'Create a circle').click(); await expect(button(a, 'Create my circle')).toBeDisabled(); await button(a, 'Review alias and participation').click();
  await button(a, 'Accept participation terms').click(); await button(a, 'Save account settings').click(); await expect(visibleText(a, /Last confirmed sharing: off\. Only future eligible/)).toBeVisible({ timeout: 20000 });
  await button(a, 'Back').click(); await a.getByLabel('Circle name', { exact: true }).fill('Morning crew'); await a.getByLabel('Circle timezone', { exact: true }).fill('America/Los_Angeles');
  await expect(visibleText(a, /Members can see your new check-ins/)).toBeVisible(); await button(a, 'Accept circle sharing').click();
  await a.context().setOffline(true); await button(a, 'Create my circle').click(); await expect(visibleText(a, /Your circle request is saved on this device/)).toBeVisible();
  await a.context().setOffline(false); await expect(button(a, 'Open circle')).toBeVisible({ timeout: 25000 }); await button(a, 'Open circle').click();
  await expect(a.getByLabel('0 circle pushups today', { exact: true })).toBeVisible({ timeout: 20000 });
  const circle = (await rpc(users[0], 'list_circles')).items[0];
  await button(a, 'Manage circle').click(); await button(a, 'Create invite code').click();
  await expect(a.getByLabel('Current invite code', { exact: true })).toBeVisible({ timeout: 20000 }); const invitation = await a.getByLabel('Current invite code', { exact: true }).innerText();
  await a.context().grantPermissions(['clipboard-read', 'clipboard-write']); await button(a, 'Copy invite code').click(); await expect(visibleText(a, 'Invite code copied.', { exact: true })).toBeVisible();
  expect(await a.evaluate(() => navigator.clipboard.readText())).toBe(invitation);
  b = await login(users[1]); await b.getByRole('tab', { name: 'Circles', exact: true }).click(); await button(b, 'Join with an invite').click();
  await b.getByLabel('Invite code', { exact: true }).fill(invitation); await button(b, 'Preview invite').click(); await expect(b.getByRole('heading', { name: 'Morning crew', exact: true })).toBeVisible({ timeout: 20000 });
  await expect(button(b, 'Join this circle')).toBeDisabled(); await button(b, 'Accept circle sharing').click(); await button(b, 'Join this circle').click(); await expect(button(b, 'Open circle')).toBeVisible({ timeout: 20000 }); await button(b, 'Open circle').click();
  await expect(b.getByLabel('0 circle pushups today', { exact: true })).toBeVisible({ timeout: 20000 });
  await create(users[0], 100); await create(users[1], 85); await op(users[2], 'join_circle', { code: invitation, accept_circle_sharing: true });
  await button(a, 'Back to circle').click(); await expect(a.getByLabel('185 circle pushups today', { exact: true })).toBeVisible({ timeout: 25000 });
  await expect(visibleText(a, /2 of 3 members checked in/)).toBeVisible(); await expect(visibleText(a, 'No check-in yet today', { exact: true })).toBeVisible(); await expect(visibleText(a, /America\/Los_Angeles · Fixed circle timezone/)).toBeVisible();
  const aliases = await a.locator('[aria-label^="Report or block "]').evaluateAll(nodes => nodes.map(n => n.getAttribute('aria-label'))); expect(aliases).toEqual(['Report or block circle_alpha', 'Report or block circle_middle']);
  await a.evaluate(() => document.querySelectorAll('*').forEach(n => { if (n.scrollTop) n.scrollTop = 0; })); await a.screenshot({ path: '../../tracking/evidence/t18-circle-web.png', fullPage: true });
  await a.context().setOffline(true); await expect(visibleText(a, /Circle activity is hidden until current membership/)).toBeVisible({ timeout: 20000 }); await expect(a.getByLabel('185 circle pushups today', { exact: true })).toHaveCount(0);
  await a.context().setOffline(false); await expect(a.getByLabel('185 circle pushups today', { exact: true })).toBeVisible({ timeout: 25000 });
  await button(b, 'Manage circle').click(); await button(b, 'Leave circle').click(); await button(b, 'Confirm leave').click(); await expect(visibleText(b, /This circle or member is no longer available/)).toBeVisible({ timeout: 20000 });
  await button(b, 'Back to circles').click(); await expect(visibleText(b, 'No circles yet. Create a small group or join with an invite.')).toBeVisible({ timeout: 20000 });
  await button(b, 'Join with an invite').click(); await b.getByLabel('Invite code', { exact: true }).fill(invitation); await button(b, 'Preview invite').click(); await expect(b.getByRole('heading', { name: 'Morning crew', exact: true })).toBeVisible(); await button(b, 'Accept circle sharing').click(); await button(b, 'Join this circle').click(); await expect(button(b, 'Open circle')).toBeVisible({ timeout: 20000 }); await button(b, 'Open circle').click();
  await expect(b.getByLabel('0 circle pushups today', { exact: true })).toBeVisible({ timeout: 20000 });
  await button(a, 'Refresh circle').click(); await expect(a.getByLabel('100 circle pushups today', { exact: true })).toBeVisible({ timeout: 20000 }); await button(a, 'Manage circle').click();
  await button(a, 'Transfer ownership to circle_alpha').click(); await button(a, 'Confirm transfer').click(); await expect(button(a, 'Leave circle')).toBeVisible({ timeout: 20000 });
  await button(a, 'Leave circle').click(); await button(a, 'Confirm leave').click(); await expect(visibleText(a, /This circle or member is no longer available/)).toBeVisible({ timeout: 20000 });
  await button(b, 'Manage circle').click(); await expect(button(b, 'Delete circle')).toBeVisible({ timeout: 20000 }); await button(b, 'Delete circle').click(); await button(b, 'Confirm delete').click(); await expect(visibleText(b, /This circle or member is no longer available/)).toBeVisible({ timeout: 20000 });
  await button(b, 'Back to circles').click(); await expect(visibleText(b, 'No circles yet. Create a small group or join with an invite.')).toBeVisible({ timeout: 20000 });
  expect((await rpc(users[0], 'pull_changes', { after_revision: '0' })).changes.length).toBe(2); expect(circle.id).toBeTruthy(); expect(errors).toEqual([]);
  console.log('PASS: real circle consent/offline create/invite copy/join,185 aggregate and zero member, fixed LA timezone, offline clearing, leave/rejoin history exclusion, owner transfer and deletion preserve personal logs.');
} catch (error) {
  const sanitize = value => value.replace(/pc_[a-f0-9]{64}/g, '[invite]').replace(/[\w.+-]+@[\w.-]+/g, '[email]').replace(/\b\d{6,10}\b/g, '[code]');
  console.error('Circle browser diagnostic:', sanitize(JSON.stringify({ errors, screen: (await b?.locator('body').innerText().catch(() => 'unavailable'))?.slice(0, 1800), owner: (await a?.locator('body').innerText().catch(() => 'unavailable'))?.slice(0, 1800) }))); throw error;
} finally { await browser?.close(); server?.kill(); await db.query('delete from app_private.circles where owner_id=any($1::uuid[])', [users.map(u => u.id)]); await db.end(); for (const user of users) await removeAccount(config, user); }
