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
  const context = await browser.newContext();
  try {
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => {
      window.__reviewMegabyteBuffers = 0;
      window.SharedArrayBuffer = new Proxy(window.SharedArrayBuffer, { construct(target, args) {
        if (args[0] === 1024 * 1024) window.__reviewMegabyteBuffers++;
        return Reflect.construct(target, args);
      } });
    });
    await page.goto('http://127.0.0.1:8081');
    await page.getByRole('button', { name: 'Get started', exact: true }).click();
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    for (let i = 0; i < 50; i++) await page.getByRole('button', { name: /^Haptics: (on|off)$/ }).click();
    const buffers = await page.evaluate(() => window.__reviewMegabyteBuffers);
    expect(buffers).toBeGreaterThan(0); expect(buffers).toBeLessThanOrEqual(2); expect(errors).toEqual([]);
    console.log('PASS: repeated real SQLite preference interactions reuse completed shared buffers; allocations=' + buffers);
  } finally { await context.close(); }
} finally { await browser.close(); }
