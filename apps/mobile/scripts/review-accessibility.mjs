import { chromium, expect } from '@playwright/test';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 320, height: 640 }, reducedMotion: 'reduce' }), errors = [];
  page.on('pageerror', error => errors.push(error.message)); const button = name => page.getByRole('button', { name, exact: true });
  await page.goto('http://127.0.0.1:8081'); await button('Get started').focus(); await page.keyboard.press('Enter');
  await expect(button('Log pushups')).toBeVisible(); await button('Log pushups').focus(); await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Log pushups', exact: true })).toBeVisible();
  await page.getByLabel('Pushup quantity', { exact: true }).fill('0'); await button('Add pushups').focus(); await page.keyboard.press('Enter');
  await expect(page.getByRole('alert')).toContainText('Enter a whole number from 1 to 999.');
  await page.getByLabel('Pushup quantity', { exact: true }).fill('35'); await button('Add pushups').focus(); await page.keyboard.press('Enter');
  await expect(page.getByRole('img', { name: '35 pushups today, goal 100.', exact: true })).toBeVisible();
  await page.screenshot({ path: '../../tracking/evidence/t20-compact-today-web.png' });
  await button('Settings').focus(); await page.keyboard.press('Enter'); await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
  await button('Privacy and participation').focus(); await page.keyboard.press('Enter'); await expect(page.getByRole('heading', { name: 'Privacy and participation', exact: true })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1); expect(overflow).toBe(false);
  await button('Back').click(); await button('Export your data').click(); await expect(page.getByRole('heading', { name: 'Export your data', exact: true })).toBeVisible();
  const smallTargets = await page.locator('[role="button"]').evaluateAll(nodes => nodes.filter(n => { const r = n.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(n).visibility !== 'hidden' && (r.width < 48 || r.height < 48); }).map(n => n.getAttribute('aria-label') || n.textContent));
  expect(smallTargets).toEqual([]); await page.screenshot({ path: '../../tracking/evidence/t20-compact-export-web.png' });
  expect(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(true); expect(errors).toEqual([]);
  console.log('PASS compact320px keyboard activation, labelled quantity/error/save, heading navigation,48px controls and no horizontal page overflow. Native screen readers/system text remain unverified.');
} finally { await browser.close(); }
