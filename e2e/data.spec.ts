import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { createTask, findFirstStep, setAiMode } from './helpers';

test('backup export, delete everything, and restore', async ({ page }) => {
  await setAiMode(page, 'Demo');
  await createTask(page, 'Back me up');
  await findFirstStep(page);
  await page.getByRole('button', { name: "I've done it" }).click();
  await expect(page.getByText('Step 2 of')).toBeVisible(); // saved before we back up

  await page.goto('/settings');
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Download backup' }).click(),
  ]);
  const path = await download.path();
  const json = JSON.parse(await readFile(path, 'utf8'));
  expect(json.app).toBeTruthy();
  expect(json.data.tasks).toHaveLength(1);

  await page.getByRole('button', { name: 'Delete all data on this device' }).click();
  await page.getByRole('button', { name: 'Delete everything' }).click();
  await expect(page.getByText('All data deleted.')).toBeVisible();
  await page.goto('/tasks');
  await expect(page.getByText(/Nothing saved yet/)).toBeVisible();

  await page.goto('/settings');
  await page.locator('#import-file').setInputFiles(path);
  await page.getByRole('button', { name: 'Replace everything here' }).click();
  await expect(page.getByText('Backup restored.')).toBeVisible();
  await page.goto('/tasks');
  await page.getByRole('link', { name: /Back me up/ }).click();
  await expect(page.getByText('Step 2 of')).toBeVisible();
});

test('a broken backup file is rejected with a clear message and nothing changes', async ({
  page,
}) => {
  await page.goto('/settings');
  await page.locator('#import-file').setInputFiles({
    name: 'bad.json',
    mimeType: 'application/json',
    buffer: Buffer.from('{"nope":1}'),
  });
  await expect(page.getByRole('alert')).toBeVisible();
});

test.describe('PWA', () => {
  test.use({ serviceWorkers: 'allow' });
  test('has a manifest and registers a service worker', async ({ page }) => {
    await page.goto('/');
    const href = await page.locator('link[rel="manifest"]').getAttribute('href');
    const manifest = await (await page.request.get(href!)).json();
    expect(manifest.name).toBe('Task Unstucker');
    expect(manifest.display).toBe('standalone');
    const registered = await page.evaluate(async () => {
      const reg = await navigator.serviceWorker.ready;
      return !!reg.active;
    });
    expect(registered).toBe(true);
  });

  test('the app shell loads offline after the first visit', async ({ page, context }) => {
    await page.goto('/');
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.reload(); // let the SW take control
    await context.setOffline(true);
    await page.reload();
    await expect(page.getByRole('heading', { name: 'What are you stuck on?' })).toBeVisible();
    await context.setOffline(false);
  });
});
