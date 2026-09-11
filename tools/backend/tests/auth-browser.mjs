import { spawn, spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { chromium, expect } from '../../../apps/mobile/node_modules/@playwright/test/index.mjs';
import { localEnvironment, request, removeAccount } from './environment.mjs';
const config = localEnvironment();
const app = new URL('../../../apps/mobile/', import.meta.url);
const build = spawnSync(process.execPath, ['scripts/export.mjs', 'web'], { cwd: app, stdio: 'inherit', env: { ...process.env, EXPO_PUBLIC_APP_ENV: 'development', EXPO_PUBLIC_SUPABASE_URL: config.api, EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: config.key } });
if (build.status !== 0) throw new Error('Connected browser build failed.');
const server = spawn(process.execPath, ['scripts/preview.mjs'], { cwd: app, stdio: 'ignore' });
let browser, user, page;
const errors = [];
try {
  for (let attempt = 0; attempt < 40; attempt++) {
    if (await fetch('http://127.0.0.1:8081').then(response => response.ok, () => false)) break;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  const startups = spawnSync(process.execPath, ['scripts/review-startup.mjs'], { cwd: app, stdio: 'inherit' });
  if (startups.status !== 0) throw new Error('Concurrent cold-start regression failed.');
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.text().startsWith('Local storage initialization failed')) console.log(message.text()); });
  await page.goto('http://127.0.0.1:8081');
  await page.getByRole('button', { name: 'Get started', exact: true }).click();
  await page.getByRole('button', { name: 'Log pushups', exact: true }).click();
  // Default 10; this record must still exist in the guest partition after logout.
  await page.getByRole('button', { name: 'Add pushups', exact: true }).click();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Sign in or recover account', exact: true }).click();
  const email = `browser-${randomUUID()}@example.invalid`;
  const created = await request(config, '/auth/v1/admin/users', { admin: true, body: { email, email_confirm: true } });
  expect(created.status).toBe(200); user = { id: created.data.id };
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByRole('button', { name: 'Send code', exact: true }).click();
  await expect(page.getByText('Check your email for a sign-in code.')).toBeVisible();
  await page.getByLabel('Email code', { exact: true }).fill('0000000000');
  await page.getByRole('button', { name: 'Verify code', exact: true }).click();
  await expect(page.getByText('That code is incorrect or expired. Request another code.')).toBeVisible();
  const generated = await request(config, '/auth/v1/admin/generate_link', { admin: true, body: { type: 'magiclink', email } });
  expect(generated.status).toBe(200);
  await page.getByLabel('Email code', { exact: true }).fill(generated.data.email_otp);
  await page.getByRole('button', { name: 'Verify code', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Log pushups', exact: true })).toBeVisible();
  await expect(page.getByText('100 to go. Take your time.', { exact: true }).filter({ visible: true })).toBeVisible();
  await page.context().setOffline(true);
  await page.getByRole('button', { name: 'Log pushups', exact: true }).click();
  await page.getByRole('button', { name: 'Add pushups', exact: true }).click();
  await expect(page.getByText('90 to go. Take your time.', { exact: true }).filter({ visible: true })).toBeVisible();
  await expect(page.getByText('1 check-ins haven\u2019t synced yet.', { exact: true }).filter({ visible: true })).toBeVisible();
  await page.context().setOffline(false);
  await page.getByRole('button', { name: 'Retry sync', exact: true }).click();
  await expect(page.getByText('All check-ins synced.', { exact: true }).filter({ visible: true })).toBeVisible({ timeout: 20000 });
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByText('All check-ins synced.', { exact: true }).filter({ visible: true })).toBeVisible();
  await page.getByRole('button', { name: 'Sign out on this phone', exact: true }).click();
  await page.goto('http://127.0.0.1:8081');
  await expect(page.getByText('90 to go. Take your time.', { exact: true }).filter({ visible: true })).toBeVisible();
  expect(errors).toEqual([]);
  console.log('PASS: real Auth OTP, invalid code/retry, partition isolation, offline account save, reconnect synchronization, guest restoration.');
} catch (error) {
  const body = await page?.locator('body').innerText().catch(() => 'unavailable');
  console.error('Browser diagnostic:', JSON.stringify({ errors, screen: body?.replace(/[^\s@]+@[^\s@]+/g, '[email]').replace(/\b\d{6,10}\b/g, '[code]').slice(0, 1000) }));
  throw error;
} finally { await browser?.close(); server.kill(); if (user) await removeAccount(config, user); }
