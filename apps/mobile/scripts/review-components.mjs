import { chromium, expect } from '@playwright/test';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('http://127.0.0.1:8081');
  await expect(page.getByRole('img', { name: '35 pushups today, goal 100.' })).toBeVisible();
  await page.screenshot({ path: '../../tracking/evidence/t02-35-web.png', fullPage: true });
  await page.getByRole('button', { name: 'Review 100', exact: true }).click();
  await expect(page.getByRole('img', { name: '100 pushups today, goal 100.' })).toBeVisible();
  await page.screenshot({ path: '../../tracking/evidence/t02-100-web.png', fullPage: true });
  await page.getByRole('button', { name: 'Review quantity sheet' }).click();
  await page.getByRole('button', { name: '25 pushups', exact: true }).click();
  await expect(page.getByLabel('Pushup quantity')).toHaveValue('25');
  await page.getByRole('button', { name: 'Decrease quantity' }).click();
  await expect(page.getByLabel('Pushup quantity')).toHaveValue('24');
  await page.screenshot({ path: '../../tracking/evidence/t02-sheet-web.png', fullPage: true });
  await page.getByRole('button', { name: 'Close review' }).click();
  await page.getByRole('tab', { name: 'You', exact: true }).click();
  await expect(page.getByRole('tab', { name: 'You', exact: true })).toHaveAttribute('aria-selected', 'true');
  await page.setViewportSize({ width: 320, height: 640 });
  await page.screenshot({ path: '../../tracking/evidence/t02-compact-web.png', fullPage: true });
  expect(errors).toEqual([]);
  console.log('PASS: 35/100 ring labels, sheet presets/step, tab selection, compact rendering; no page errors.');
} finally { await browser.close(); }
