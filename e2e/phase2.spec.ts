// Phase 2 tools in demo mode, at iPhone sizes (Chromium emulation, not a real iPhone).
import { expect, test, type Page } from '@playwright/test';
import { createTask, expectNoSeriousA11yViolations, findFirstStep, setAiMode } from './helpers';

async function dump(page: Page, text: string) {
  await page.goto('/dump');
  await page.getByLabel('Brain dump').fill(text);
  await page.getByRole('button', { name: 'Sort it into tasks' }).click();
}

test.beforeEach(async ({ page }) => {
  await setAiMode(page, 'Demo');
});

test('brain dump becomes tasks, then roulette picks one and starts a challenge', async ({
  page,
}) => {
  await dump(page, '- call the dentist\n- email Sam about Friday; buy milk');
  await expect(page.getByRole('heading', { name: /Found 3 things/ })).toBeVisible();
  await expect(page.locator('.tag.demo')).toBeVisible();
  await expectNoSeriousA11yViolations(page);
  await page.getByRole('checkbox', { name: 'Keep: Buy milk' }).uncheck();
  await page.getByRole('button', { name: 'Save 2 tasks' }).click();
  await expect(page.getByRole('heading', { name: 'Saved 2 tasks' })).toBeVisible();

  await page.getByRole('link', { name: 'Pick one for me' }).click();
  await expect(page.getByText('Choosing from 2 tasks.')).toBeVisible();
  await expectNoSeriousA11yViolations(page);
  await page.getByRole('button', { name: 'Pick for me' }).click();
  const picked = page.locator('.domino-step');
  const first = await picked.textContent();
  expect(['Call the dentist', 'Email Sam about Friday']).toContain(first);
  await page.getByRole('button', { name: 'Not this one' }).click();
  await expect(picked).not.toHaveText(first!);
  await page.getByRole('button', { name: 'Not this one' }).click();
  await expect(page.getByText("That's everything that fits right now.")).toBeVisible();
  await page.getByRole('button', { name: 'Start over' }).click();
  await page.getByRole('button', { name: 'Start (2 min)' }).click();
  await expect(page.getByRole('timer')).toBeVisible();
  await expect(page.locator('.challenge')).toBeVisible();
});

test('14: roulette only picks eligible tasks', async ({ page }) => {
  await dump(page, 'finished thing\nopen thing\ndeleted thing');
  await page.getByRole('button', { name: 'Save 3 tasks' }).click();
  // Wait for the write to land before navigating, or the reload can cut it off.
  await expect(page.getByRole('heading', { name: 'Saved 3 tasks' })).toBeVisible();
  await page.goto('/tasks');
  await page.getByRole('button', { name: 'Options for Finished thing' }).click();
  await page.getByRole('button', { name: 'Mark done' }).click();
  await page.getByRole('button', { name: 'Options for Deleted thing' }).click();
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page.getByRole('link', { name: /Deleted thing/ })).toHaveCount(0);

  await page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('link', { name: 'Unstick' })
    .click();
  await page.getByRole('link', { name: 'Pick for me' }).click();
  await expect(page.getByText('Choosing from 1 task.')).toBeVisible();
  for (let i = 0; i < 5; i++) {
    await page.getByRole('button', { name: 'Pick for me' }).click();
    await expect(page.locator('.domino-step')).toHaveText('Open thing');
    await page.reload();
  }
});

test('energy matching leaves out tasks that need more energy', async ({ page }) => {
  await dump(page, 'easy thing\nhard thing');
  await page.getByRole('button', { name: 'Save 2 tasks' }).click();
  // Wait for the write to land before navigating, or the reload can cut it off.
  await expect(page.getByRole('heading', { name: 'Saved 2 tasks' })).toBeVisible();
  await page.goto('/tasks');
  await page.getByRole('link', { name: /Hard thing/ }).click();
  await page.getByRole('button', { name: 'Write my own steps' }).click();
  await page.getByText('Details: pin, due date, energy').click();
  await page
    .getByRole('group', { name: /Energy it takes/ })
    .getByRole('button', { name: 'Plenty' })
    .click();
  await expect(
    page.getByRole('group', { name: /Energy it takes/ }).getByRole('button', { name: 'Plenty' }),
  ).toHaveAttribute('aria-pressed', 'true');

  await page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('link', { name: 'Unstick' })
    .click();
  await page.getByRole('link', { name: 'Pick for me' }).click();
  await expect(page.getByText('Choosing from 2 tasks.')).toBeVisible();
  await page
    .getByRole('group', { name: /How's your energy/ })
    .getByRole('button', { name: 'Low' })
    .click();
  await expect(page.getByText('Choosing from 1 task.')).toBeVisible();
  await page.getByRole('button', { name: 'Pick for me' }).click();
  await expect(page.locator('.domino-step')).toHaveText('Easy thing');
});

test('good-enough version hides optional steps and closes the task', async ({ page }) => {
  await createTask(page, 'Clean my kitchen');
  await findFirstStep(page);
  await page.getByRole('button', { name: 'Good-enough version' }).click();
  await expect(page.getByRole('heading', { name: 'Good-enough version' })).toBeVisible();
  await expect(page.getByText(/2 optional steps hidden/)).toBeVisible();
  await expectNoSeriousA11yViolations(page);
  const required = page
    .getByRole('list', { name: 'Required steps' })
    .getByRole('button', { name: /^Not done/ });
  await expect(required).toHaveCount(4);
  for (let left = 4; left > 0; left--) {
    await required.first().click();
    await expect(required).toHaveCount(left - 1);
  }
  await page.getByRole('button', { name: 'Call it done (good enough)' }).click();
  await expect(page.getByText('Done. Good enough is done.')).toBeVisible();
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Tasks' }).click();
  await page.getByText(/Done \(1\)/).click();
  await expect(page.getByText('Done (good enough)')).toBeVisible();
});

test('good-enough version warns on safety-related tasks', async ({ page }) => {
  await createTask(page, 'Refill my prescription');
  await findFirstStep(page);
  await page.getByRole('button', { name: 'Good-enough version' }).click();
  await expect(page.getByRole('note')).toContainText('health, safety, money, or a deadline');
});

test('almost done: diagnosis leads to the finish line', async ({ page }) => {
  await createTask(page, 'Clean my kitchen');
  await page.getByRole('button', { name: "I'm almost done but can't finish" }).click();
  await page.getByRole('button', { name: 'Find the finish line' }).click();
  await expect(page.getByRole('heading', { name: 'Finish line' })).toBeVisible();
  await expect(page.getByRole('heading', { name: /Must do \(4\)/ })).toBeVisible();
  await expectNoSeriousA11yViolations(page);
  await page.getByRole('button', { name: 'Suggest one' }).click();
  await expect(page.getByLabel('What does "done" mean here?')).toHaveValue(/^Done when/);
  await page.getByLabel('What does "done" mean here?').fill('Counters clear and dishes away');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Saved.', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('What does "done" mean here?')).toHaveValue(
    'Counters clear and dishes away',
  );
  const mustDo = page
    .getByRole('list', { name: 'Must do' })
    .getByRole('button', { name: /^Not done/ });
  for (let left = 4; left > 0; left--) {
    await mustDo.first().click();
    await expect(mustDo).toHaveCount(left - 1);
  }
  await page.getByRole('button', { name: 'Call it done, skip the polish' }).click();
  await expect(page.getByText('This task is done.')).toBeVisible();
});

test('distracted: setup prompts before a sprint, never blocking', async ({ page }) => {
  await createTask(page, 'Clean my kitchen');
  await page.getByRole('button', { name: 'I keep getting distracted' }).click();
  await page.getByRole('button', { name: 'Focus sprint' }).first().click();
  await page.getByRole('button', { name: '10 minutes' }).click();
  const setup = page.getByRole('dialog', { name: 'Quick setup (optional)' });
  await expect(setup).toBeVisible();
  await expectNoSeriousA11yViolations(page);
  await setup.getByRole('checkbox', { name: 'Get some water' }).check();
  await setup.getByRole('button', { name: 'Start the timer' }).click();
  await expect(page.getByRole('timer')).toHaveAccessibleName(/10 minutes left/);
});

test('time-estimate check after finishing a step', async ({ page }) => {
  await page.clock.install();
  await createTask(page, 'Clean my kitchen');
  await findFirstStep(page);
  await page.getByRole('button', { name: 'Start (2 min)' }).click();
  await expect(page.getByRole('timer')).toBeVisible();
  await page.clock.fastForward(3 * 60_000);
  await page.getByRole('button', { name: 'Got it done' }).click();
  const check = page.getByRole('region', { name: 'Time check' });
  await expect(check).toContainText('about 3 min');
  await expect(check).toContainText('1 min');
});

test('pin and due date show on the task list', async ({ page }) => {
  await createTask(page, 'Renew passport');
  await page.getByRole('button', { name: 'Write my own steps' }).click();
  await page.getByText('Details: pin, due date, energy').click();
  await page.getByRole('button', { name: 'Pin this task' }).click();
  await page.getByLabel('Due date (optional)').fill('2099-01-01');
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Tasks' }).click();
  await expect(page.getByRole('link', { name: /Renew passport/ })).toContainText('Pinned');
  await expect(page.getByRole('link', { name: /Renew passport/ })).toContainText('due in');
});

test('every new tool is reachable from Home in 3 taps or fewer', async ({ page }) => {
  await dump(page, 'one thing');
  await page.getByRole('button', { name: 'Save 1 task' }).click();
  // Wait for the write to land before navigating, or the reload can cut it off.
  await expect(page.getByRole('heading', { name: 'Saved 1 task' })).toBeVisible();
  await page.goto('/');
  await page.getByRole('link', { name: 'Pick for me' }).click(); // 1
  await page.getByRole('button', { name: 'Pick for me' }).click(); // 2
  await page.getByRole('button', { name: 'Start (2 min)' }).click(); // 3
  await expect(page.getByRole('timer')).toBeVisible();
  await page.goto('/');
  await page.getByRole('link', { name: 'Brain dump' }).click(); // 1
  await expect(page.getByLabel('Brain dump')).toBeVisible();
});
