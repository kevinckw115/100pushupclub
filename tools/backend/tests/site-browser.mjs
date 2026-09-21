import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { chromium, expect } from '../../../apps/mobile/node_modules/@playwright/test/index.mjs';
import { account, localEnvironment, request, removeAccount } from './environment.mjs';
import { runDeletionWorker } from '../scripts/deletion-worker.mjs';
const config = localEnvironment(), users = [], db = new pg.Client({ connectionString: config.db });
let browser, server;
try {
  await db.connect();
  const built = spawnSync(process.execPath, ['apps/site/build.mjs'], { cwd: new URL('../../../', import.meta.url), env: { ...process.env, SITE_LOCAL_TEST: '1', SITE_SUPABASE_URL: config.api, SITE_SUPABASE_PUBLISHABLE_KEY: config.key }, stdio: 'inherit' });
  if (built.status !== 0) throw new Error('Site build failed');
  for (let i = 0; i < 2; i++) {
    const user = await account(config); users.push(user);
    const result = await request(config, '/rest/v1/rpc/bootstrap_profile', { token: user.token, body: { operation_id: randomUUID() } }); expect(result.status).toBe(200);
  }
  // Deletion must not require ordinary profile bootstrap, even for a suspended account.
  await db.query("update app_private.profiles set account_status='suspended' where user_id=$1", [users[0].id]);
  server = spawn(process.execPath, ['apps/site/serve.mjs'], { cwd: new URL('../../../', import.meta.url), stdio: 'ignore' });
  for (let i = 0; i < 40; i++) { if (await fetch('http://127.0.0.1:8082').then(r => r.ok, () => false)) break; await new Promise(r => setTimeout(r, 250)); }
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } }), errors = [];
  page.on('pageerror', () => errors.push('PAGE_ERROR'));
  const details = await request(config, '/auth/v1/admin/users/' + users[0].id, { admin: true, method: 'GET' });
  await page.goto('http://127.0.0.1:8082/delete-account/');
  await page.getByLabel('Account email', { exact: true }).fill(details.data.email);
  await page.getByRole('button', { name: 'Send verification code', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('check its inbox');
  const code = await request(config, '/auth/v1/admin/generate_link', { admin: true, body: { type: 'magiclink', email: details.data.email } });
  await page.getByLabel('Email code', { exact: true }).fill(code.data.email_otp);
  await page.getByRole('button', { name: 'Verify code', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Ownership verified');
  await page.getByRole('button', { name: 'Confirm account deletion', exact: true }).click();
  expect((await db.query('select 1 from app_private.deletion_jobs where user_id=$1', [users[0].id])).rowCount).toBe(0);
  await page.getByRole('checkbox').check();
  await page.context().setOffline(true);
  await page.getByRole('button', { name: 'Confirm account deletion', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Could not confirm');
  const before = await page.evaluate(() => localStorage.getItem('100pushupclub.deletion.v1'));
  expect(before).toBeTruthy(); expect(before).not.toContain('access_token'); expect(before).not.toContain(details.data.email);
  await page.context().setOffline(false);
  await page.getByRole('button', { name: 'Confirm account deletion', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Deletion accepted');
  expect(await page.evaluate(() => localStorage.getItem('100pushupclub.deletion.v1'))).toBe(before);
  await page.reload(); await page.getByRole('button', { name: 'Check deletion status', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Deletion accepted');
  const finished = await runDeletionWorker({ dbUrl: config.db, apiUrl: config.api, adminKey: config.adminKey, steps: 30 }); expect(finished.completed).toBe(1);
  await page.getByRole('button', { name: 'Check deletion status', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Primary account cleanup is complete');
  expect((await db.query('select 1 from auth.users where id=$1', [users[1].id])).rowCount).toBe(1);
  await page.screenshot({ path: '../../tracking/evidence/public-site-deletion.png', fullPage: true });
  await page.getByRole('button', { name: 'Remove completed recovery record', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Verify your account email');
  expect(errors).toEqual([]);
  expect((await fetch('http://127.0.0.1:8082/settings')).status).toBe(404);
  console.log('PASS: standalone site real OTP, suspended ownership, explicit confirmation, offline durable retry, reload status, Auth cleanup and peer isolation.');
} finally {
  await browser?.close(); server?.kill();
  for (const user of users) if ((await db.query('select 1 from auth.users where id=$1', [user.id])).rowCount) await removeAccount(config, user);
  await db.query('delete from app_private.deletion_jobs where user_id=any($1::uuid[])', [users.map(u => u.id)]); await db.end();
}
