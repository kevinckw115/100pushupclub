import { chromium, expect } from '@playwright/test';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('http://127.0.0.1:8081');
  await page.getByRole('button', { name: 'Get started', exact: true }).click();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Haptics: on', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Haptics: off', exact: true })).toBeVisible();
  await page.getByLabel('Reminder time', { exact: true }).fill('25:00');
  await page.getByRole('button', { name: 'Save reminder time', exact: true }).click();
  await expect(page.getByText('Use a time from 00:00 to 23:59.')).toBeVisible();
  await page.getByLabel('Reminder time', { exact: true }).fill('19:45');
  await page.getByRole('button', { name: 'Save reminder time', exact: true }).click();
  await expect(page.getByText('Reminder preference saved.')).toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Haptics: off', exact: true })).toBeVisible();
  await expect(page.getByLabel('Reminder time', { exact: true })).toHaveValue('19:45');
  await expect(page.getByText('Reminders are available in the iPhone and Android app.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Enable reminders', exact: true })).toHaveCount(0);
  await page.screenshot({ path: '../../tracking/evidence/t07-settings-web.png' });
  expect(errors).toEqual([]);
  console.log('PASS: actual SQLite preference persistence, invalid time rejection, truthful browser reminder availability. No native delivery claim.');
} finally { await browser.close(); }
