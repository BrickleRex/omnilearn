import { test, expect, type Page } from '@playwright/test';
import type { Calibration } from '../shared/types';

test.describe.configure({ mode: 'serial' });

const PROJECT_ID = 'attention-from-scratch';

async function typeInEditor(page: Page, text: string) {
  await page.locator('.cm-content').click();
  await page.keyboard.type(text, { delay: 8 });
}

async function replaceEditorContent(page: Page, text: string) {
  await page.locator('.cm-content').click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.press('Delete');
  await page.keyboard.type(text, { delay: 8 });
}

test('create a project, calibrate, and learn through the primer', async ({ page, request }) => {
  await page.goto('/');
  await expect(page.getByTestId('library')).toBeVisible();

  // New project flow (mock plan is instant)
  await page.getByTestId('new-project').click();
  await page.getByTestId('goal-input').fill('I want to implement multi-head self-attention in numpy from scratch');
  await page.getByTestId('goal-submit').click();
  await expect(page.getByTestId('plan-review')).toBeVisible({ timeout: 15_000 });
  await page.getByTestId('plan-accept').click();

  // Lands in the milestone flow -> calibration
  await expect(page.getByTestId('calibration')).toBeVisible({ timeout: 15_000 });

  // Fetch the calibration through the API so we can answer deterministically:
  // q0 correct, q1 correct, q2 wrong, q3 "No idea yet" (last option).
  const calib = (await (
    await request.post(`/api/projects/${PROJECT_ID}/calibration`, { data: { milestoneId: 'sdpa' } })
  ).json()) as Calibration;
  expect(calib.questions.length).toBe(4);

  const picks = calib.questions.map((q, i) => {
    if (i === 0 || i === 1) return q.answerIndex; // correct
    if (i === 2) return (q.answerIndex + 1) % (q.options.length - 1); // wrong, not "No idea"
    return q.options.length - 1; // "No idea yet"
  });
  for (let i = 0; i < picks.length; i++) {
    await page.getByTestId(`calib-opt-${i}-${picks[i]}`).click();
  }
  await page.getByTestId('calib-submit').click();

  // Primer deck for the two uncleared concepts (softmax story + weighted-sum card + 2 checks)
  await expect(page.getByTestId('primer-deck')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('concept-dot-product')).toHaveAttribute('data-cleared', 'true');
  await expect(page.getByTestId('concept-scaling')).toHaveAttribute('data-cleared', 'true');
  await expect(page.getByTestId('concept-softmax')).toHaveAttribute('data-cleared', 'false');

  // Walk the deck; answer every check with option 0 (mock answerIndex is always 0)
  for (let guard = 0; guard < 12; guard++) {
    const check = page.getByTestId('primer-check');
    if (await check.isVisible().catch(() => false)) {
      await page.getByTestId('check-opt-0').click();
    }
    const start = page.getByTestId('start-building');
    if (await start.isVisible().catch(() => false)) break;
    const next = page.getByTestId('primer-next');
    if (await next.isEnabled().catch(() => false)) await next.click();
    else await page.waitForTimeout(250);
  }

  await expect(page.getByTestId('concept-softmax')).toHaveAttribute('data-cleared', 'true');
  await expect(page.getByTestId('concept-weighted-sum')).toHaveAttribute('data-cleared', 'true');
  await page.getByTestId('start-building').click();
  await expect(page.getByTestId('workspace')).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('.cm-content')).toBeVisible();
});

test('guidance loop: hint, ghost line, run pulse, watcher nudge, explore mode', async ({ page }) => {
  // Fast watcher mode for e2e (1s tick, no throttle)
  await page.addInitScript(() => localStorage.setItem('omnilearnFastWatch', '1'));
  await page.goto(`/#/workspace/${PROJECT_ID}/sdpa`);
  await expect(page.getByTestId('workspace')).toBeVisible();
  await expect(page.locator('.cm-content')).toBeVisible();

  // --- Hint (Ctrl+Space) -> compass detail + footlight typeout
  await page.locator('.cm-content').click();
  await page.keyboard.press('Control+Space');
  await expect(page.getByTestId('compass-detail')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId('compass-detail')).toContainText(/k transposed/i);
  await expect(page.getByTestId('footlight-text')).toContainText(/k transposed/i, { timeout: 10_000 });

  // --- Ghost line (Ctrl+Shift+Space): hollow widget, Tab refused, type-through
  await page.locator('.cm-content').click();
  await page.keyboard.press('End');
  await page.keyboard.press('Control+Shift+Space');
  const ghost = page.getByTestId('ghost-widget');
  await expect(ghost).toBeVisible({ timeout: 10_000 });
  await expect(ghost).toContainText('scores');

  await page.keyboard.press('Tab');
  await expect(page.getByTestId('ghost-refuse')).toBeVisible();
  await expect(ghost).toBeVisible(); // still there, nothing auto-inserted

  const ghostLine = 'scores = q @ k.T / np.sqrt(dk)';
  await page.keyboard.type(ghostLine, { delay: 12 });
  await expect(ghost).toBeHidden({ timeout: 5_000 }); // fully typed through
  await expect(page.locator('.cm-content')).toContainText('np.sqrt(dk)');

  // --- Run (failing): NameError keeps the rail open with stderr
  await page.getByTestId('run-btn').click();
  await expect(page.getByTestId('rail')).toHaveAttribute('data-state', /open|pinned/, { timeout: 20_000 });
  await expect(page.getByTestId('rail-run-out')).toContainText(/NameError|Error/i, { timeout: 20_000 });

  // --- Watcher nudge: NameError run + BUG! marker, fast watch -> lamp + note
  await typeInEditor(page, '\n# BUG!');
  await expect(page.getByTestId('footlight-lamp')).toHaveAttribute('data-state', 'nudge', { timeout: 30_000 });
  await page.keyboard.press('Alt+h');
  await expect(page.getByTestId('footlight-text')).toContainText(/dk/i);

  // --- Explore mode silences the watcher and clears the nudge
  await page.getByTestId('explore-toggle').click();
  await expect(page.getByTestId('explore-toggle')).toHaveAttribute('data-on', 'true');
  await expect(page.getByTestId('footlight-lamp')).not.toHaveAttribute('data-state', 'nudge');
  await page.getByTestId('explore-toggle').click();

  // --- Run (passing): rail pulses open then auto-collapses to strip
  await replaceEditorContent(page, 'print("hi omnilearn")');
  await page.getByTestId('run-btn').click();
  await expect(page.getByTestId('rail-run-out')).toContainText('hi omnilearn', { timeout: 20_000 });
  await expect(page.getByTestId('rail')).toHaveAttribute('data-state', 'strip', { timeout: 10_000 });

  // --- Shell tab: real pty round-trip
  await page.getByTestId('rail').click();
  await page.getByTestId('rail-tab-shell').click();
  await page.getByTestId('rail-shell').click();
  await page.keyboard.type('echo e2e-pty-check', { delay: 15 });
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('rail-shell')).toContainText('e2e-pty-check', { timeout: 15_000 });

  // --- Last step + passing run -> milestone done -> library shows progress
  const lastPip = page.locator('[data-testid="compass"] [data-pip]').last();
  await lastPip.click();
  await page.getByTestId('run-btn').click();
  await expect(page.getByTestId('milestone-done')).toBeVisible({ timeout: 20_000 });
  await page.getByTestId('milestone-done').click();
  await expect(page.getByTestId('library')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId(`project-card-${PROJECT_ID}`)).toContainText(/1\s*\/\s*2/);
});

test('real intellisense and the Ask tutor tab', async ({ page }) => {
  await page.goto(`/#/workspace/${PROJECT_ID}/sdpa`);
  await expect(page.getByTestId('workspace')).toBeVisible();
  await expect(page.locator('.cm-content')).toBeVisible();

  // --- jedi completions: np. must offer real numpy members like zeros
  await page.locator('.cm-content').click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.press('Delete');
  await page.keyboard.type('import numpy as np\nnp.', { delay: 15 });
  const tooltip = page.locator('.cm-tooltip-autocomplete');
  // The tooltip virtualizes its list, so assert membership only after filtering.
  await expect(tooltip).toBeVisible({ timeout: 10_000 });
  await expect(tooltip).toContainText('abs', { timeout: 10_000 }); // jedi surface arrived
  await page.keyboard.type('ze', { delay: 40 });
  await expect(tooltip).toContainText('zeros', { timeout: 10_000 });
  await expect(tooltip).toContainText('zeros_like');
  await page.keyboard.press('Escape');

  // --- Ask tab: Ctrl+/ opens the tutor, mock reply knows the milestone
  await page.keyboard.press('Control+/');
  await expect(page.getByTestId('rail-ask')).toBeVisible({ timeout: 5_000 });
  await page.getByTestId('ask-input').fill('what is the task here');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('rail-ask')).toContainText(/mock tutor/i, { timeout: 15_000 });
  await expect(page.getByTestId('rail-ask')).toContainText(/Scaled dot-product attention/i);

  // history survives a reload
  await page.reload();
  await expect(page.locator('.cm-content')).toBeVisible();
  await page.keyboard.press('Control+/');
  await expect(page.getByTestId('rail-ask')).toContainText('what is the task here', { timeout: 10_000 });
  await expect(page.getByTestId('rail-ask')).toContainText(/mock tutor/i);
  await page.keyboard.press('Control+/'); // fold the chat away again

  // --- hint look-back: an unambiguous mistake in earlier code gets flagged
  await replaceEditorContent(page, 'import numpy as np\nscores = q @ q\n');
  await page.keyboard.press('Control+Space');
  await expect(page.getByTestId('footlight-lamp')).toHaveAttribute('data-state', 'nudge', { timeout: 15_000 });
  await page.keyboard.press('Alt+h');
  await expect(page.getByTestId('footlight-text')).toContainText(/scoring q against itself/i, { timeout: 10_000 });

  // --- back to the primer: review mode never auto-forwards to the editor
  await page.getByTestId('review-primer').click();
  await expect(page.getByTestId('milestone-flow')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId('primer-deck')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('primer-deck')).not.toContainText("let's build"); // not auto-jumped to the finale
  await page.goBack();
  await expect(page.getByTestId('workspace')).toBeVisible({ timeout: 10_000 });
});

test('theme schemes switch and persist', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('library')).toBeVisible();
  await page.getByTestId('settings').click();
  await page.getByTestId('scheme-blackboard').click();
  await expect(page.locator('html')).toHaveAttribute('data-scheme', 'blackboard');

  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(bg).not.toBe('rgb(242, 239, 232)'); // no longer the sunshower ground

  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-scheme', 'blackboard', { timeout: 10_000 });

  await page.getByTestId('settings').click();
  await page.getByTestId('scheme-arcade').click();
  await expect(page.locator('html')).toHaveAttribute('data-scheme', 'arcade');
  await page.getByTestId('scheme-sunshower').click();
  await expect(page.locator('html')).toHaveAttribute('data-scheme', 'sunshower');
});
