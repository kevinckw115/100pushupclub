import { chromium, expect } from '@playwright/test';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  await Promise.all(Array.from({ length: 6 }, async (_, index) => {
    const context = await browser.newContext();
    try {
      const page = await context.newPage(), errors = [];
      page.on('pageerror', error => errors.push(error.message));
      page.on('console', message => { if (message.text().startsWith('Local storage initialization failed')) errors.push(message.text()); });
      await page.goto('http://127.0.0.1:8081');
      await expect(page.getByRole('button', { name: 'Get started', exact: true })).toBeVisible({ timeout: 15000 });
      await page.getByRole('button', { name: 'Get started', exact: true }).click();
      await expect(page.getByRole('button', { name: 'Log pushups', exact: true })).toBeVisible();
      await page.reload();
      await expect(page.getByRole('button', { name: 'Log pushups', exact: true })).toBeVisible();
      expect(errors).toEqual([]);
      console.log(`PASS: independent browser ${index + 1} cold start and persisted guest restart.`);
    } finally { await context.close(); }
  }));
} finally { await browser.close(); }
