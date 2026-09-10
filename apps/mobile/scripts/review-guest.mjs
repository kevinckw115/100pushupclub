import { chromium, expect } from '@playwright/test';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('http://127.0.0.1:8081');
  await expect(page.getByRole('button', { name: 'Get started', exact: true })).toBeVisible({ timeout: 20000 });
  await page.screenshot({ path: '../../tracking/evidence/t04-welcome-web.png' });
  await context.setOffline(true);
  await page.getByRole('button', { name: 'Get started', exact: true }).click();
  await expect(page.getByRole('img', { name: '0 pushups today, goal 100.' })).toBeVisible();
  await page.screenshot({ path: '../../tracking/evidence/t04-today-zero-web.png' });
  await context.setOffline(false);
  await page.reload();
  await expect(page.getByRole('img', { name: '0 pushups today, goal 100.' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Get started', exact: true })).toHaveCount(0);
  await page.getByRole('tab', { name: 'Club', exact: true }).click();
  await expect(page.getByText('Community is not connected yet.', { exact: false })).toBeVisible();
  await page.getByRole('tab', { name: 'Today', exact: true }).click();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Back to Today' }).click();
  await expect(page.getByRole('img', { name: '0 pushups today, goal 100.' })).toBeVisible();
  expect(errors).toEqual([]);
  console.log('PASS: Expo SQLite guest setup offline after asset load, reload persistence, tabs/settings, no page errors. Native first-launch-offline gate remains open.');
} finally { await browser.close(); }
