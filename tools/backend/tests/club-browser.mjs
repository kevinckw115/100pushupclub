import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { chromium, expect } from '../../../apps/mobile/node_modules/@playwright/test/index.mjs';
import { localEnvironment, account, request, removeAccount } from './environment.mjs';
const config = localEnvironment(), users = [];
let browser, server, page;
const errors = [];
const rpc = async (user, name, envelope) => {
  const result = await request(config, '/rest/v1/rpc/' + name, { token: user.token, body: { envelope } });
  expect(result.status).toBe(200); return result.data;
};
const create = (user, quantity) => {
  const now = new Date().toISOString();
  return rpc(user, 'mutate_checkin', { kind: 'create', mutation_id: randomUUID(), checkin_id: randomUUID(), quantity, occurred_at: now, recorded_timezone: 'UTC', local_date: now.slice(0, 10), source: 'native', requested_public_epoch: '1' });
};
try {
  for (let i = 0; i < 2; i++) {
    const user = await account(config); users.push(user); user.alias = 'club_' + randomUUID().slice(0, 8);
    expect((await request(config, '/rest/v1/rpc/bootstrap_profile', { token: user.token, body: { operation_id: randomUUID() } })).status).toBe(200);
    await rpc(user, 'update_profile', { operation_id: randomUUID(), alias: user.alias, public_enabled: true, expected_consent_epoch: '0', accepted_terms_version: 'community-v1-2026-09-11' });
    await create(user, (i + 1) * 10);
  }
  // auth-browser exports the ordinary connected build immediately before this script.
  server = spawn(process.execPath, ['scripts/preview.mjs'], { cwd: new URL('../../../apps/mobile/', import.meta.url), stdio: 'ignore' });
  for (let i = 0; i < 40; i++) { if (await fetch('http://127.0.0.1:8081').then(r => r.ok, () => false)) break; await new Promise(resolve => setTimeout(resolve, 250)); }
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.on('pageerror', error => errors.push(error.message));
  let reads = 0; page.on('request', request => { if (request.url().endsWith('/rpc/read_club')) reads++; });
  await page.goto('http://127.0.0.1:8081');
  await page.getByRole('button', { name: 'Get started', exact: true }).click();
  await page.getByRole('tab', { name: 'Club', exact: true }).click();
  await expect(page.getByLabel('30 pushups in the past 24 hours', { exact: true })).toBeVisible({ timeout: 20000 });
  await expect(page.getByText('2 people checked in during the past hour.', { exact: true })).toBeVisible();
  for (const user of users) await expect(page.getByText(user.alias, { exact: true })).toBeVisible();
  const before = await page.evaluate(() => {
    const scroller = [...document.querySelectorAll('div')].find(node => /auto|scroll/.test(getComputedStyle(node).overflowY) && node.scrollHeight > node.clientHeight + 100);
    if (!scroller) throw new Error('Expected a scrolling Club screen'); scroller.scrollTop = 180; return scroller.scrollTop;
  });
  await create(users[1], 7);
  await expect(page.getByRole('button', { name: 'Show updated check-ins', exact: true })).toBeEnabled({ timeout: 40000 });
  await expect(page.getByText(/^7 pushups/)).toHaveCount(0);
  const after = await page.evaluate(() => [...document.querySelectorAll('div')].find(node => /auto|scroll/.test(getComputedStyle(node).overflowY) && node.scrollHeight > node.clientHeight + 100)?.scrollTop);
  expect(after).toBe(before);
  await page.getByRole('button', { name: 'Show updated check-ins', exact: true }).click();
  await expect(page.getByText(/^7 pushups/)).toBeVisible();
  await rpc(users[0], 'update_profile', { operation_id: randomUUID(), public_enabled: false, expected_consent_epoch: '1' });
  await page.getByRole('button', { name: 'Refresh Club', exact: true }).click();
  await expect(page.getByText(users[0].alias, { exact: true })).toHaveCount(0, { timeout: 20000 });
  await expect(page.getByLabel('27 pushups in the past 24 hours', { exact: true })).toBeVisible();
  await page.context().setOffline(true);
  await page.getByRole('button', { name: 'Refresh Club', exact: true }).click();
  await expect(page.getByText(/Public activity is hidden until/)).toBeVisible({ timeout: 20000 });
  await expect(page.getByText(users[1].alias, { exact: true })).toHaveCount(0);
  await page.context().setOffline(false);
  await page.getByRole('button', { name: 'Refresh Club', exact: true }).click();
  await expect(page.getByLabel('27 pushups in the past 24 hours', { exact: true })).toBeVisible({ timeout: 40000 });
  await page.getByRole('button', { name: 'Change browsing region', exact: true }).click();
  await page.getByLabel('Search regions', { exact: true }).fill('Orange County');
  await page.getByRole('heading', { name: 'Orange County \u00b7 California \u00b7 United States', exact: true }).locator('..').getByRole('button', { name: 'Use Orange County', exact: true }).click();
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await page.getByRole('button', { name: 'My region', exact: true }).click();
  await expect(page.getByText('Showing World while your area gets started.', { exact: true })).toBeVisible({ timeout: 20000 });
  await page.evaluate(() => document.querySelectorAll('*').forEach(node => { if (node.scrollTop) node.scrollTop = 0; }));
  await page.screenshot({ path: '../../tracking/evidence/t15-club-web.png', fullPage: true });
  await page.getByRole('tab', { name: 'Today', exact: true }).click();
  const stopped = reads;
  await page.waitForTimeout(32000);
  expect(reads).toBe(stopped);
  expect(errors).toEqual([]);
  console.log('PASS: two real public contributors, exact window totals, deferred insertion without scroll jump, consent removal, offline purge, region fallback and polling stops on tab blur.');
} catch (error) {
  console.error('Club browser diagnostic:', JSON.stringify({ errors, screen: (await page?.locator('body').innerText().catch(() => 'unavailable'))?.slice(0, 1800) })); throw error;
} finally { await browser?.close(); server?.kill(); for (const user of users) await removeAccount(config, user); }
