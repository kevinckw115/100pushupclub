import { chromium, expect } from '@playwright/test';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('http://127.0.0.1:8081');
  await page.getByRole('button', { name: 'Get started', exact: true }).click();
  const total = async n => expect(page.getByRole('img', { name: `${n} pushups today, goal 100.` })).toBeVisible();
  const open = () => page.getByRole('button', { name: 'Log pushups', exact: true }).click();
  const input = () => page.getByLabel('Pushup quantity');
  const add = async n => { await open(); await input().fill(String(n)); await page.getByTestId('save-checkin').click(); };
  await total(0);
  await open();
  await input().fill('0');
  await page.getByTestId('save-checkin').click();
  await expect(page.getByText('Enter a whole number from 1 to 999.')).toBeVisible();
  await input().fill('20');
  await page.getByTestId('save-checkin').evaluate(element => { element.click(); element.click(); });
  await total(20);
  await add(15);
  await total(35);
  await page.reload();
  await total(35);
  await page.screenshot({ path: '../../tracking/evidence/t05-today-35-web.png' });
  await add(65); await total(100);
  await page.reload(); await total(100);
  await page.screenshot({ path: '../../tracking/evidence/t05-today-100-web.png' });
  await add(25); await total(125);
  await page.screenshot({ path: '../../tracking/evidence/t05-today-125-web.png' });
  await page.getByRole('button', { name: 'Undo', exact: true }).click(); await total(100);
  await page.getByRole('button', { name: /^15 pushups/ }).click();
  await input().fill('10');
  await page.getByRole('button', { name: 'Save changes', exact: true }).click(); await total(95);
  await page.getByRole('button', { name: /^10 pushups/ }).click();
  await page.getByRole('button', { name: 'Delete check-in', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm delete', exact: true }).click(); await total(85);
  await add(150);
  await expect(page.getByText('Add 150 pushups?', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Keep editing', exact: true }).click();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click(); await total(85);
  // This route installs a real SQLite failing trigger only in a development export.
  if (process.argv.includes('--failure')) {
    await page.goto('http://127.0.0.1:8081/_dev/storage');
    await page.getByRole('button', { name: 'Arm test storage failure', exact: true }).click();
    await add(5);
    await expect(page.getByText('Nothing was saved.', { exact: false })).toBeVisible();
    await expect(input()).toHaveValue('5');
    await expect(page.getByText('5 added.', { exact: true })).toHaveCount(0);
    await page.screenshot({ path: '../../tracking/evidence/t05-storage-failure-web.png' });
    await page.getByRole('button', { name: 'Cancel', exact: true }).click(); await total(85);
    await page.getByRole('button', { name: 'Disarm test storage failure', exact: true }).click();
    await add(5); await total(90);
  }
  expect(errors).toEqual([]);
  console.log('PASS: real SQLite saves 20+15, duplicate-click guard, reload, 100/125, undo/edit/delete, validation and >100 confirmation' + (process.argv.includes('--failure') ? ', real SQLite failure preserves draft and retry works.' : '.'));
} finally { await browser.close(); }
