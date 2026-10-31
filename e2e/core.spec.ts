// The brief's 22 test scenarios, numbered in comments. Runs in Chromium at iPhone sizes
// (viewport emulation; not WebKit and not a physical iPhone).
import { expect, test } from '@playwright/test';
import {
  breakdownResult,
  createTask,
  expectNoHorizontalScroll,
  expectNoSeriousA11yViolations,
  findFirstStep,
  mockAi,
  ok,
  setAiMode,
} from './helpers';

const TITLE = 'Reply to the landlord';

test('1, 2: a new user starts without an account', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'What are you stuck on?' })).toBeVisible();
  await expect(page.getByText(/sign in|log in|create account/i)).toHaveCount(0);
  await expectNoSeriousA11yViolations(page);
  await expectNoHorizontalScroll(page);
  await createTask(page, TITLE);
  await expectNoSeriousA11yViolations(page);
});

test('3, 4: live AI breakdown asks consent once, then shows the first step in 3 taps', async ({
  page,
}) => {
  const seen = await mockAi(page, () => ok(breakdownResult));
  await page.goto('/');
  await page.getByLabel('What are you stuck on?').fill('sort out the flat stuff');
  await page.getByRole('button', { name: 'Help me start' }).click(); // tap 1
  await findFirstStep(page); // tap 2
  const dialog = page.getByRole('dialog', { name: 'Use AI for this?' });
  await expect(dialog).toBeVisible();
  expect(seen).toHaveLength(0); // nothing sent before consent
  await dialog.getByRole('button', { name: 'OK, use AI' }).click(); // tap 3 (first time only)
  await expect(page.getByText('Open the email from the landlord')).toBeVisible();
  await expect(page.getByText('Step 1 of 4')).toBeVisible();
  await expect(page.locator('.tag', { hasText: 'AI' })).toBeVisible();
  expect(seen[0]).toMatchObject({ kind: 'breakdown', task: { title: 'sort out the flat stuff' } });
  await expectNoSeriousA11yViolations(page);

  // Second task: consent is remembered, so it's 2 taps.
  await createTask(page, 'Another thing');
  await findFirstStep(page);
  await expect(page.getByText('Open the email from the landlord')).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'Use AI for this?' })).toHaveCount(0);
});

test.describe('with a demo plan', () => {
  test.beforeEach(async ({ page }) => {
    await setAiMode(page, 'Demo');
    await createTask(page, TITLE);
    await findFirstStep(page);
    await expect(page.getByText('Step 1 of')).toBeVisible();
  });

  test('demo mode is clearly labeled and sends nothing', async ({ page }) => {
    let calls = 0;
    await page.route('**/api/ai', (r) => {
      calls++;
      return r.abort();
    });
    await expect(page.locator('.tag.demo', { hasText: 'Demo' })).toBeVisible();
    await page.getByRole('button', { name: 'Make it easier' }).click();
    await expect(page.getByText('Made it smaller.')).toBeVisible();
    expect(calls).toBe(0);
  });

  test('5: smaller steps via "make it easier" (with undo) and the refine preview', async ({
    page,
  }) => {
    const first = await page.locator('.domino-step').textContent();
    await page.getByRole('button', { name: 'Make it easier' }).click();
    await expect(page.locator('.domino-step')).not.toHaveText(first!);
    await page.getByRole('button', { name: 'Undo' }).click();
    await expect(page.locator('.domino-step')).toHaveText(first!);

    await page.getByRole('button', { name: /See all steps/ }).click();
    await page.getByRole('button', { name: 'Smaller steps' }).click();
    const preview = page.getByRole('dialog', { name: 'Proposed changes' });
    await expect(preview).toBeVisible();
    await expectNoSeriousA11yViolations(page);
    await preview.getByRole('button', { name: 'Apply' }).click();
    await expect(preview).toBeHidden();
    await expect(page.getByText(/Earlier versions \(\d+\)/)).toBeVisible();
  });

  test('6, 7, 8: completing a step, then refining, keeps the finished step', async ({ page }) => {
    const first = (await page.locator('.domino-step').textContent())!;
    await page.getByRole('button', { name: "I've done it" }).click();
    await expect(page.getByText('Step 2 of')).toBeVisible();
    await expect(page.locator('.celebrate')).toBeVisible();

    await page.getByRole('button', { name: /See all steps/ }).click();
    await expect(page.getByRole('button', { name: `Done: ${first}` })).toBeVisible();
    await page.getByRole('button', { name: 'Bare minimum' }).click();
    const preview = page.getByRole('dialog', { name: 'Proposed changes' });
    await preview.getByRole('button', { name: 'Apply' }).click();
    // The finished step is never removed by a refinement without the user's say-so.
    await expect(page.getByRole('button', { name: `Done: ${first}` })).toBeVisible();
  });

  test('9, 10, 22: progress survives reload and closing the app, and resume finds the next step', async ({
    page,
    context,
  }) => {
    await page.getByRole('button', { name: "I've done it" }).click();
    await expect(page.getByText('Step 2 of')).toBeVisible();
    const next = (await page.locator('.domino-step').textContent())!;

    await page.reload();
    await expect(page.getByText('Step 2 of')).toBeVisible();
    await expect(page.locator('.domino-step')).toHaveText(next);

    await page.close();
    const again = await context.newPage();
    await again.goto('/');
    const resume = again.getByRole('region', { name: 'Pick up where you left off' });
    await expect(resume).toContainText(TITLE);
    await expect(resume).toContainText(next);
    await resume.getByRole('link', { name: 'Resume' }).click();
    await expect(again.locator('.domino-step')).toHaveText(next);
  });

  test('12, 13: timer starts, pauses, resumes, and survives backgrounding and reload', async ({
    page,
  }) => {
    await page.clock.install();
    await page.reload();
    await page.getByRole('button', { name: 'Start (2 min)' }).click();
    const timer = page.getByRole('timer');
    await expect(timer).toHaveAccessibleName(/2 minutes left/);

    await page.clock.fastForward(30_000);
    await page.getByRole('button', { name: 'Pause' }).click();
    await expect(page.locator('p.muted', { hasText: 'Paused' })).toBeVisible();
    const pausedName = await timer.getAttribute('aria-label');
    await page.clock.fastForward(60_000);
    await expect(timer).toHaveAttribute('aria-label', pausedName!);

    await page.getByRole('button', { name: 'Resume' }).click();
    await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible(); // saved
    await page.reload(); // interruption: state comes from stored timestamps
    await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible();
    await expect(page.getByRole('timer')).toHaveAccessibleName(
      /1 minute|less than a minute|90 seconds|1 min/,
    );

    // Backgrounded past the end: on return it shows time's up, not a negative clock.
    await page.clock.fastForward(5 * 60_000);
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await expect(page.getByText("Time's up.", { exact: true }).first()).toBeVisible();
    await page.getByRole('button', { name: 'Made progress' }).click();
    await expect(page.getByRole('heading', { name: 'Nice' })).toBeVisible();
  });

  test('parking a thought keeps the timer going and shows it afterwards', async ({ page }) => {
    await page.getByRole('button', { name: 'Start (2 min)' }).click();
    await page.getByRole('button', { name: 'Park a thought' }).click();
    await page.getByLabel('Thought to park').fill('email Sam about Friday');
    await page.getByRole('button', { name: 'Park it' }).click();
    await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible();
    await page.getByRole('button', { name: 'Finish' }).click();
    await page.getByRole('button', { name: 'Got it done' }).click();
    await expect(page.getByText('email Sam about Friday')).toBeVisible();
  });

  test('20: deleting one task with undo does not touch others; editing a step works', async ({
    page,
  }) => {
    await page.getByRole('button', { name: /See all steps/ }).click();
    const firstText = (await page.locator('.step-list .step-text').first().textContent())!;
    await page.getByRole('button', { name: `More options: ${firstText}` }).click();
    await page.getByRole('button', { name: 'Edit wording' }).click();
    await page.getByLabel('Edit step').fill('My own wording');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByText('My own wording')).toBeVisible();
    await expect(page.getByText(/edited by you/)).toBeVisible();

    await createTask(page, 'Second task stays');
    await page.goto('/tasks');
    await page.getByRole('link', { name: new RegExp(TITLE) }).click();
    await page.getByRole('button', { name: /See all steps/ }).click();
    await page.getByRole('button', { name: 'Delete task' }).click();
    await page.getByRole('button', { name: 'Undo' }).click();
    await page.goto('/tasks');
    await expect(page.getByRole('link', { name: new RegExp(TITLE) })).toBeVisible();
    await expect(page.getByRole('link', { name: /Second task stays/ })).toBeVisible();
    await page.getByRole('link', { name: new RegExp(TITLE) }).click();
    await page.getByRole('button', { name: /See all steps/ }).click();
    await expect(page.getByText('My own wording')).toBeVisible();
  });
});

test('7 (live): refining after a step is done keeps it unless the user agrees', async ({
  page,
}) => {
  await mockAi(page, (req) => {
    if (req.kind === 'breakdown') return ok(breakdownResult);
    const steps = req.steps as { id: string; status: string }[];
    const done = steps.find((s) => s.status === 'done')!;
    const todo = steps.find((s) => s.status === 'todo')!;
    return ok({
      ops: [
        {
          op: 'remove',
          stepId: done.id,
          afterStepId: null,
          text: null,
          tier: null,
          estimateMin: null,
        },
        {
          op: 'update',
          stepId: todo.id,
          afterStepId: null,
          text: 'Write a two-line reply',
          tier: null,
          estimateMin: 2,
        },
        {
          op: 'remove',
          stepId: 'made-up-id',
          afterStepId: null,
          text: null,
          tier: null,
          estimateMin: null,
        },
      ],
      summary: 'Shorter plan.',
    });
  });
  await createTask(page, TITLE);
  await findFirstStep(page);
  await page.getByRole('button', { name: 'OK, use AI' }).click();
  await page.getByRole('button', { name: "I've done it" }).click();
  await page.getByRole('button', { name: /See all steps/ }).click();
  await page.getByLabel('Tell it what to change').fill('I only need a short reply');
  await page.getByRole('button', { name: 'Change', exact: true }).click();
  const preview = page.getByRole('dialog', { name: 'Proposed changes' });
  await expect(preview.getByText('Write a two-line reply')).toBeVisible();
  await expect(preview.getByRole('group', { name: /finished or edited steps/ })).toBeVisible();
  await preview.getByRole('button', { name: 'Apply' }).click();
  await expect(
    page.getByRole('button', { name: 'Done: Open the email from the landlord' }),
  ).toBeVisible();
  await expect(page.getByText('Write a two-line reply')).toBeVisible();
});

test('11: works without AI connectivity', async ({ page, context }) => {
  await page.goto('/');
  await context.setOffline(true);
  await page.getByLabel('What are you stuck on?').fill('Clean my kitchen');
  await page.getByRole('button', { name: 'Help me start' }).click();
  await findFirstStep(page);
  // Consent comes first; then the offline check fails fast and quick steps appear.
  await page.getByRole('button', { name: 'OK, use AI' }).click();
  await expect(page.getByText(/offline/i)).toBeVisible();
  await expect(page.locator('.domino-step')).toBeVisible();
  await expect(page.locator('.tag', { hasText: 'Quick steps' })).toBeVisible();
  await page.getByRole('button', { name: "I've done it" }).click();
  await expect(page.getByText('Step 2 of')).toBeVisible();
  await context.setOffline(false);
});

test('11 (AI off): quick steps without any network use', async ({ page }) => {
  let calls = 0;
  await page.route('**/api/ai', (r) => {
    calls++;
    return r.abort();
  });
  await setAiMode(page, 'Off');
  await createTask(page, 'Do the laundry');
  await findFirstStep(page);
  await expect(page.locator('.domino-step')).toBeVisible();
  expect(calls).toBe(0);
});

test('18: malformed AI output falls back to quick steps', async ({ page }) => {
  await mockAi(page, () => ok({ steps: 'definitely not steps', firstStepIndex: 'x' }));
  await createTask(page, TITLE);
  await findFirstStep(page);
  await page.getByRole('button', { name: 'OK, use AI' }).click();
  await expect(page.getByText(/couldn't produce usable steps/)).toBeVisible();
  await expect(page.locator('.domino-step')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Try AI again' })).toBeVisible();
});

test('18b: AI output with markup is shown as plain text', async ({ page }) => {
  await mockAi(page, () =>
    ok({
      ...breakdownResult,
      steps: [
        {
          text: '<img src=x onerror="window.__pwned=1">Open the email',
          tier: 'required',
          estimateMin: 1,
        },
      ],
    }),
  );
  await createTask(page, TITLE);
  await findFirstStep(page);
  await page.getByRole('button', { name: 'OK, use AI' }).click();
  await expect(page.locator('.domino-step')).toContainText('Open the email');
  expect(
    await page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned),
  ).toBeUndefined();
  await expect(page.locator('.domino-step img')).toHaveCount(0);
});

test('19: AI not set up on the server (real proxy, no key) falls back', async ({ page }) => {
  await createTask(page, TITLE);
  await findFirstStep(page);
  await page.getByRole('button', { name: 'OK, use AI' }).click();
  await expect(page.getByText(/AI isn't set up yet/)).toBeVisible();
  await expect(page.locator('.domino-step')).toBeVisible();
});

test('19: AI unavailable, rate limited, or timed out falls back', async ({ page }) => {
  let mode: 'busy' | 'down' = 'busy';
  await mockAi(page, () =>
    mode === 'busy' ? [429, { ok: false, error: { code: 'rate_limited', message: '' } }] : 'abort',
  );
  await createTask(page, TITLE);
  await findFirstStep(page);
  await page.getByRole('button', { name: 'OK, use AI' }).click();
  await expect(page.getByText(/AI is busy/)).toBeVisible();
  mode = 'down';
  await page.getByRole('button', { name: 'Try AI again' }).click();
  await expect(page.getByText(/can't be reached/)).toBeVisible();
});

test('19: a hung AI request times out and falls back', async ({ page }) => {
  await page.clock.install();
  await mockAi(page, () => 'hang');
  await createTask(page, TITLE);
  await findFirstStep(page);
  await page.getByRole('button', { name: 'OK, use AI' }).click();
  await expect(page.getByRole('button', { name: /Finding a first step/ }).first()).toBeVisible();
  await page.clock.fastForward(26_000);
  await expect(page.getByText(/took too long/)).toBeVisible();
  await expect(page.locator('.domino-step')).toBeVisible();
});

test('15: motion and celebrations can be turned off', async ({ page }) => {
  await setAiMode(page, 'Demo');
  await page
    .getByRole('group', { name: 'Motion' })
    .getByRole('radio', { name: /^Reduce motion/ })
    .click();
  await page
    .getByRole('group', { name: 'Celebrations' })
    .getByRole('radio', { name: /^Off/ })
    .click();
  await expect(page.locator('html')).toHaveAttribute('data-motion', 'reduced');
  await page.reload();
  await expect(page.getByRole('radio', { name: /^Reduce motion/ })).toBeChecked();
  await createTask(page, TITLE);
  await findFirstStep(page);
  await page.getByRole('button', { name: "I've done it" }).click();
  await expect(page.getByText('Step 2 of')).toBeVisible();
  await expect(page.locator('.celebrate')).toHaveCount(0);
  await expect(page.locator('.burst')).toHaveCount(0);
});

test('16: a very long title does not break the mobile layout', async ({ page }) => {
  await setAiMode(page, 'Demo');
  const long = 'Supercalifragilisticexpialidociousreallylongwordwithoutspaces '.repeat(4).trim();
  await createTask(page, long.slice(0, 300));
  await expectNoHorizontalScroll(page);
  await findFirstStep(page);
  await expectNoHorizontalScroll(page);
  await page.goto('/tasks');
  await expectNoHorizontalScroll(page);
});

test('17: empty states and missing things are understandable', async ({ page }) => {
  await page.goto('/tasks');
  await expect(page.getByText(/Nothing saved yet/)).toBeVisible();
  await expectNoSeriousA11yViolations(page);
  await page.goto('/task/does-not-exist');
  await expect(page.getByRole('heading', { name: "This task isn't here" })).toBeVisible();
  await page.goto('/nowhere');
  await expect(page.getByRole('heading', { name: 'Nothing here' })).toBeVisible();
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Help me start' })).toBeDisabled();
});

test('21: key flows work with the keyboard alone', async ({ page }) => {
  await setAiMode(page, 'Demo');
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toBeFocused();
  await page.keyboard.press('Tab'); // skip header link
  let focused = '';
  for (let i = 0; i < 6 && focused !== 'TEXTAREA'; i++) {
    focused = await page.evaluate(() => document.activeElement?.tagName ?? '');
    if (focused !== 'TEXTAREA') await page.keyboard.press('Tab');
  }
  expect(focused).toBe('TEXTAREA');
  await page.keyboard.type('Start my essay');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { level: 1, name: 'Start my essay' })).toBeFocused();
  await page.getByRole('button', { name: 'Find the first step' }).first().focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('.domino-step')).toBeVisible();
  await page.getByRole('button', { name: "I've done it" }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByText('Step 2 of')).toBeVisible();
  await page.getByRole('button', { name: /Focus sprint/ }).focus();
  await page.keyboard.press('Enter');
  const picker = page.getByRole('dialog');
  await expect(picker).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(picker).toBeHidden();
  await expectNoSeriousA11yViolations(page);
});

test('accessibility: main screens have no serious axe violations', async ({ page }) => {
  await setAiMode(page, 'Demo');
  await expectNoSeriousA11yViolations(page); // settings
  await createTask(page, TITLE);
  await expectNoSeriousA11yViolations(page); // diagnosis
  await findFirstStep(page);
  await expectNoSeriousA11yViolations(page); // first domino
  await page.getByRole('button', { name: /See all steps/ }).click();
  await expectNoSeriousA11yViolations(page); // all steps
  await page.goto('/do');
  await expectNoSeriousA11yViolations(page); // timer picker
  await page.goto('/tasks');
  await expectNoSeriousA11yViolations(page);
});

test('14: task roulette', async () => {
  test.skip(true, 'Task Roulette is Phase 2 in the approved plan; not built yet.');
});
