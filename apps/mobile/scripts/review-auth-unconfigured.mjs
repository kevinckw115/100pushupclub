import { chromium, expect } from '@playwright/test';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('http://127.0.0.1:8081');
  await page.getByRole('button', { name: 'Get started', exact: true }).click();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Sign in or recover account', exact: true }).click();
  await expect(page.getByText('Account sign-in is not connected yet. You can keep tracking privately on this phone.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Send code', exact: true })).toHaveCount(0);
  await page.screenshot({ path: '../../tracking/evidence/t09-auth-unconfigured-web.png' });
  await page.getByRole('button', { name: 'Cancel sign-in', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Log pushups', exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Log pushups', exact: true })).toBeVisible();
  expect(errors).toEqual([]);
  console.log('PASS: unconfigured sign-in is honest, cancellation and guest cold reload work.');
} finally { await browser.close(); }
