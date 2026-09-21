import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { chromium, expect } from '../../../apps/mobile/node_modules/@playwright/test/index.mjs';
import { account, localEnvironment, request, removeAccount } from './environment.mjs';
import { runDeletionWorker } from '../scripts/deletion-worker.mjs';
const config = localEnvironment(), users = [], db = new pg.Client({ connectionString: config.db }), errors = [];
let server, browser, page;
const button = name => page.getByRole('button', { name, exact: true });
const text = value => page.getByText(value).filter({ visible: true });
const rpc = async (user, name, body = {}) => { const value = await request(config, '/rest/v1/rpc/' + name, { token: user?.token, body }); expect(value.status).toBe(200); return value.data; };
const download = async label => { const waiting = page.waitForEvent('download'); await button(label).click(); const file = await waiting; return JSON.parse(await readFile(await file.path(), 'utf8')); };
try {
  await db.connect();
  for (let i = 0; i < 2; i++) { const user = await account(config); users.push(user); await rpc(user, 'bootstrap_profile', { operation_id: randomUUID() }); const now = new Date().toISOString(); await rpc(user, 'mutate_checkin', { envelope: { kind: 'create', mutation_id: randomUUID(), checkin_id: randomUUID(), quantity: i ? 75 : 20, occurred_at: now, recorded_timezone: 'UTC', local_date: now.slice(0, 10), source: 'native', requested_public_epoch: null } }); }
  server = spawn(process.execPath, ['scripts/preview.mjs'], { cwd: new URL('../../../apps/mobile/', import.meta.url), stdio: 'ignore' });
  for (let i = 0; i < 40; i++) { if (await fetch('http://127.0.0.1:8081').then(r => r.ok, () => false)) break; await new Promise(r => setTimeout(r, 250)); }
  browser = await chromium.launch({ channel: 'chrome', headless: true }); page = await browser.newPage({ viewport: { width: 390, height: 844 }, acceptDownloads: true }); page.on('pageerror', e => errors.push(e.message));
  await page.goto('http://127.0.0.1:8081'); await button('Get started').click(); await button('Log pushups').click(); await button('Add pushups').click(); await button('Settings').click(); await button('Export your data').click();
  const guest = await download('Export this device’s records'); expect(guest.scope).toBe('guest-on-this-device'); expect(guest.records.map(r => r.quantity)).toEqual([10]); expect(JSON.stringify(guest)).not.toMatch(/token|partition_id|accepted_json/);
  await expect(text(/1 records prepared\. Use your device/)).toBeVisible(); await button('Back').click(); await button('Sign in or recover account').click();
  const details = await request(config, '/auth/v1/admin/users/' + users[0].id, { admin: true, method: 'GET' }), email = details.data.email;
  await page.getByLabel('Email', { exact: true }).fill(email); await button('Send code').click(); await expect(text('Check your email for a sign-in code.')).toBeVisible();
  const generated = await request(config, '/auth/v1/admin/generate_link', { admin: true, body: { type: 'magiclink', email } });
  await page.getByLabel('Email code', { exact: true }).fill(generated.data.email_otp); await button('Verify code').click(); await expect(button('Log pushups')).toBeVisible(); await expect(text('80 to go. Take your time.')).toBeVisible({ timeout: 20000 });
  await button('Settings').click(); await button('Export your data').click(); const cloud = await download('Export saved cloud account'); expect(cloud.scope).toBe('saved-cloud-account'); expect(cloud.records.map(r => r.quantity)).toEqual([20]); expect(JSON.stringify(cloud)).not.toContain(users[1].id); expect(JSON.stringify(cloud)).not.toContain(email);
  await expect(text(/1 records prepared\. Use your device/)).toBeVisible(); await button('Back').click(); await button('Delete account').click();
  await page.getByLabel('Deletion account email', { exact: true }).fill(email); await button('Send deletion verification code').click(); await expect(text('Check your email for a deletion verification code.')).toBeVisible();
  const deletionCode = await request(config, '/auth/v1/admin/generate_link', { admin: true, body: { type: 'magiclink', email } });
  await page.getByLabel('Deletion verification code', { exact: true }).fill(deletionCode.data.email_otp); await button('Verify deletion code').click(); await expect(text('Ownership verified. Review the deletion scope, then confirm.')).toBeVisible();
  await expect(button('Confirm account deletion')).toBeDisabled(); await button('I understand what will be deleted').click();
  await page.context().setOffline(true); await button('Confirm account deletion').click(); await expect(text('Connect to the internet before continuing.')).toBeVisible(); await page.context().setOffline(false);
  await button('Confirm account deletion').click();
  await expect.poll(async () => (await db.query('select status from app_private.deletion_jobs where user_id=$1', [users[0].id])).rows[0]?.status).toBe('pending');
  // Reload after acceptance: proof and local cleanup marker must outlive the component and the session.
  await page.goto('http://127.0.0.1:8081/delete-account'); await expect(text('Deletion accepted. Primary cleanup is processing.')).toBeVisible({ timeout: 20000 });
  const finished = await runDeletionWorker({ dbUrl: config.db, apiUrl: config.api, adminKey: config.adminKey, steps: 30 }); expect(finished.completed).toBe(1);
  await button('Check deletion status').click(); await expect(text('Primary account cleanup is complete.')).toBeVisible({ timeout: 20000 });
  await page.evaluate(() => document.querySelectorAll('*').forEach(n => { if (n.scrollTop) n.scrollTop = 0; })); await page.screenshot({ path: '../../tracking/evidence/t19-deletion-web.png', fullPage: true });
  await button('Back to Settings').click(); await expect(button('Sign in or recover account')).toBeVisible(); await button('Back').click(); await expect(text('90 to go. Take your time.')).toBeVisible();
  expect((await rpc(users[1], 'export_account')).records[0].quantity).toBe(75); expect(errors).toEqual([]);
  console.log('PASS: actual guest/cloud JSON downloads exclude peers, fresh OTP and explicit deletion, offline denial, reload-safe status/cleanup, real Auth removal and original guest preservation.');
} catch (error) {
  console.error('Privacy browser diagnostic:', JSON.stringify({ errors, screen: (await page?.locator('body').innerText().catch(() => 'unavailable'))?.replace(/[\w.+-]+@[\w.-]+/g, '[email]').replace(/d_[a-f0-9]{64}/g, '[proof]').slice(0, 1800) })); throw error;
} finally {
  await browser?.close(); server?.kill();
  for (const user of users) if ((await db.query('select 1 from auth.users where id=$1', [user.id])).rowCount) await removeAccount(config, user);
  await db.query('delete from app_private.deletion_jobs where user_id=any($1::uuid[])', [users.map(u => u.id)]); await db.end();
}
