import AxeBuilder from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';

export const breakdownResult = {
  steps: [
    { text: 'Open the email from the landlord', tier: 'required', estimateMin: 1 },
    { text: 'Write one sentence saying what you need', tier: 'required', estimateMin: 3 },
    { text: 'Add the dates you are free', tier: 'required', estimateMin: 3 },
    { text: 'Read it once and press send', tier: 'required', estimateMin: 2 },
  ],
  firstStepIndex: 0,
  question: null,
  safetyNote: null,
};

/** Mocks the AI proxy. `handler` returns [status, body] per request kind. */
export async function mockAi(
  page: Page,
  handler: (req: { kind: string; [k: string]: unknown }) => [number, unknown] | 'hang' | 'abort',
) {
  const seen: { kind: string; [k: string]: unknown }[] = [];
  await page.route('**/api/ai', async (route) => {
    const req = route.request().postDataJSON();
    seen.push(req);
    const out = handler(req);
    if (out === 'abort') return route.abort('internetdisconnected');
    if (out === 'hang') return; // never fulfilled: exercises the client timeout
    const [status, body] = out;
    await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  });
  return seen;
}

export const ok = (result: unknown): [number, unknown] => [200, { ok: true, result }];

export async function setAiMode(page: Page, mode: 'Use AI' | 'Demo' | 'Off') {
  await page.goto('/settings');
  const radio = page
    .getByRole('group', { name: 'AI help' })
    .getByRole('radio', { name: new RegExp(`^${mode}`) });
  await radio.click();
  await expect(radio).toBeChecked();
}

/** Types a task on the home screen and taps "Help me start". */
export async function createTask(page: Page, title: string) {
  await page.goto('/');
  await page.getByLabel('What are you stuck on?').fill(title);
  await page.getByRole('button', { name: 'Help me start' }).click();
  await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible();
}

export async function findFirstStep(page: Page) {
  await page.getByRole('button', { name: 'Find the first step' }).first().click();
}

export async function expectNoSeriousA11yViolations(page: Page) {
  const results = await new AxeBuilder({ page: page as never })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  const serious = results.violations.filter(
    (v) => v.impact === 'serious' || v.impact === 'critical',
  );
  expect(
    serious.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`),
  ).toEqual([]);
}

export async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}
