// Skills track acceptance (mock LLM). Ids come from SPEC-SKILLS.md "Mock corpus
// and test ids"; the corpus is server/skills/fixtures.ts.
import { test, expect, type Page } from '@playwright/test';

test.describe.configure({ mode: 'serial' });

const SKILL = 'cold-email';

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

test('frame a skill, prune the angle map, run mock research, calibrate', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('library')).toBeVisible();
  await page.getByTestId('track-skills').click();
  await expect(page.getByTestId('skills-lane')).toBeVisible();

  // --- Frame
  await page.getByTestId('new-skill').click();
  // The modal moves focus to its first field on a short timer; filling before
  // that fires can lose keystrokes, so wait for the focus to land.
  await expect(page.getByTestId('frame-name')).toBeFocused({ timeout: 3_000 });
  await page.getByTestId('frame-name').fill('Cold email');
  await page.getByTestId('frame-outcome').fill('5 qualified meetings a month');
  await page.getByTestId('frame-context').fill('B2B SaaS, $0 budget, sent ~50 cold emails ever');
  await page.getByTestId('frame-target-who').fill('VPs of Sales');
  await page.getByTestId('frame-target-industry').fill('B2B SaaS');
  await page.getByTestId('frame-target-where').fill('United States');
  await page.getByTestId('frame-target-deal').fill('$400/mo tool');
  await page.getByTestId('frame-target-different').fill('They are pitched all day.');
  await page.getByTestId('frame-level-new').click();
  await page.getByTestId('frame-submit').click();

  // --- Map: outline ladder; unchecking a parent takes its subtree with it
  await expect(page.getByTestId('skill-map')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('angle-targeting')).toBeVisible();
  // wide → narrow: niche angles are about the target, general ones are the craft
  await expect(page.getByTestId('angle-scope-icp')).toHaveText('niche');
  await expect(page.getByTestId('angle-scope-targeting')).toHaveText('general');
  await expect(page.getByTestId('angle-toggle-warmup')).toBeChecked();
  const estBefore = await page.getByTestId('map-est').innerText();
  await page.getByTestId('angle-toggle-deliverability').click();
  await expect(page.getByTestId('angle-toggle-warmup')).not.toBeChecked();
  await expect(page.getByTestId('map-est')).not.toHaveText(estBefore);
  await page.getByTestId('angle-toggle-deliverability').click(); // keep it for the corpus
  await expect(page.getByTestId('angle-toggle-warmup')).toBeChecked();
  await page.getByTestId('skip-to-drills').isVisible();
  await page.getByTestId('skip-to-make').isVisible();
  await page.getByTestId('start-research').click();

  // --- Research: live phases → done
  await expect(page.getByTestId('skill-research')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId('research-phase')).toHaveText('done', { timeout: 20_000 });
  await expect(page.getByTestId('research-log')).toContainText(/scout|source|claim|module/i);
  await expect(page.getByTestId('research-continue')).toBeEnabled();
  await page.getByTestId('research-continue').click();

  // --- Calibrate: probes are the course's checks (u2, u4, u6 — answer index 1).
  // The course's own trailing "No idea yet" is stripped and one is appended, so
  // each probe shows 3 real options, the opt-out at index 3, and an own-words row.
  await expect(page.getByTestId('skill-calibrate')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId('calib-opt-0-3')).toHaveText(/no idea yet/i);
  await expect(page.getByTestId('calib-opt-0-4')).toHaveCount(0);
  await page.getByTestId('calib-opt-0-1').click(); // correct
  await page.getByTestId('calib-opt-1-0').click(); // wrong
  await page.getByTestId('calib-own-2').click();   // own words, graded by the panel (mock: keyword overlap)
  await page.getByTestId('calib-own-input-2').fill('Add one new reason in two lines, never just bump it');
  await page.getByTestId('calib-submit').click();
  await expect(page.getByTestId('calib-summary')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('calib-own-note-2')).toContainText(/✓/);

  await page.getByTestId('grade-existing-toggle').click();
  await page.getByTestId('grade-existing-input').fill('Hi Priya, we are the leading platform. Got 15 minutes?');
  await page.getByTestId('grade-existing-submit').click();
  await expect(page.getByTestId('grade-existing-result')).toContainText(/trigger/i, { timeout: 10_000 });

  await page.getByTestId('calib-continue').click();
  await expect(page.getByTestId('skill-learn')).toBeVisible({ timeout: 10_000 });
});

test('learn with claim chips, then every drill kind counts as a rep', async ({ page }) => {
  await page.goto(`/#/skill/${SKILL}/learn/first-line`);
  await expect(page.getByTestId('skill-learn')).toBeVisible({ timeout: 10_000 });
  await expect(page.getByTestId('primer-deck')).toBeVisible();

  // Claim chip → evidence card
  await page.getByTestId('claim-chip-c1').first().click();
  await expect(page.getByTestId('evidence-card-c1')).toBeVisible();
  await expect(page.getByTestId('evidence-card-c1')).toContainText(/solid/i);
  await page.keyboard.press('Escape');

  // Walk the deck: answer checks with option 1 (correct in the corpus)
  for (let i = 0; i < 8; i++) {
    if (await page.getByTestId('primer-finish').isVisible().catch(() => false)) break;
    const opt = page.getByTestId('check-opt-1');
    if (await opt.isVisible().catch(() => false)) await opt.click();
    const next = page.getByTestId('primer-next');
    if (await next.isEnabled().catch(() => false)) await next.click();
  }

  // Skip to drills is always there
  await page.getByTestId('learn-to-drills').click();
  await expect(page.getByTestId('skill-drills')).toBeVisible({ timeout: 10_000 });
  const repsBefore = Number((await page.getByTestId('rep-counter').innerText()).replace(/\D+/g, '') || '0');

  // Predict the winner (real A/B): lowercase subject won
  await expect(page.getByTestId('drill-d-predict-1')).toBeVisible();
  await page.getByTestId('predict-opt-1').click();
  await expect(page.getByTestId('predict-result')).toContainText(/31%/, { timeout: 10_000 });
  await page.getByTestId('drill-next').click();

  // Sprint: three trigger lines under the timer
  await expect(page.getByTestId('drill-d-sprint-1')).toBeVisible();
  await expect(page.getByTestId('sprint-timer')).toBeVisible();
  await page.getByTestId('sprint-line-0').fill('saw you opened 6 SDR roles this month');
  await page.getByTestId('sprint-line-1').fill('noticed the hiring push on your careers page');
  await page.getByTestId('sprint-line-2').fill('love your podcast');
  await page.getByTestId('sprint-submit').click();
  await expect(page.getByTestId('sprint-feedback')).toContainText(/trigger/i, { timeout: 10_000 });
  await page.getByTestId('drill-next').click();

  // Spot the mistake: the about-us line
  await expect(page.getByTestId('drill-d-spot-1')).toBeVisible();
  await page.getByTestId('spot-seg-2').click();
  await expect(page.getByTestId('spot-result')).toContainText(/about you/i, { timeout: 10_000 });
  await page.getByTestId('drill-next').click();

  // Rewrite for Tom
  await expect(page.getByTestId('drill-d-rewrite-1')).toBeVisible();
  await page.getByTestId('rewrite-input').fill('Tom — saw you opened 6 SDR roles. Ramp in 30 days, not 90. Worth a look?');
  await page.getByTestId('rewrite-submit').click();
  await expect(page.getByTestId('rewrite-feedback')).toContainText(/phone|good/i, { timeout: 10_000 });

  // Four drills = four reps
  await expect(page.getByTestId('rep-counter')).toContainText(String(repsBefore + 4), { timeout: 10_000 });

  await page.getByTestId('drills-to-make').click();
  await expect(page.getByTestId('skill-make')).toBeVisible({ timeout: 10_000 });
});

test('make: ghost refused, hint flags the about-us line, run, v2 delta, ship, evidence', async ({ page }) => {
  await page.goto(`/#/skill/${SKILL}/make/first-line`);
  await expect(page.getByTestId('skill-make')).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('.cm-content')).toBeVisible();

  // --- Ghost: hollow, Tab refused, typed through
  await page.locator('.cm-content').click();
  await page.keyboard.press('Control+Shift+Space');
  const ghost = page.locator('.cm-ghost').first();
  await expect(ghost).toBeVisible({ timeout: 10_000 });
  await expect(ghost).toContainText('subject: your q3 hiring');
  await page.keyboard.press('Tab');
  await expect(page.getByTestId('ghost-refuse')).toBeVisible(); // refused, nothing inserted
  await expect(ghost).toBeVisible();
  await page.keyboard.type('subject: your q3 hiring', { delay: 12 });
  await expect(ghost).toBeHidden({ timeout: 5_000 }); // fully typed through
  await expect(page.locator('.cm-line').first()).toHaveText('subject: your q3 hiring');

  // --- Draft v1 with an about-us line
  await typeInEditor(page, '\nPriya — saw you opened 6 SDR roles this month.\nWe are the leading SDR ramp platform trusted by 500 companies.\nWorth a look, or is ramp not the bottleneck right now?');

  // --- Hint flags line 3
  await page.keyboard.press('Control+Space');
  await expect(page.getByTestId('hint-text')).toBeVisible({ timeout: 10_000 });
  await expect(page.locator('.cm-nudge-dot')).toHaveCount(1, { timeout: 10_000 });

  // --- Run → persona margin with a bail + scorecard
  await page.getByTestId('make-run').click();
  await expect(page.getByTestId('persona-margin')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('persona-priya')).toBeVisible();
  await expect(page.getByTestId('reaction-bail').first()).toContainText(/stopped reading/i);
  await expect(page.getByTestId('scorecard')).toBeVisible();
  await expect(page.getByTestId('score-r-trigger')).toBeVisible();
  await expect(page.getByTestId('predicted-range')).toContainText(/%/);
  await expect(page.getByTestId('biggest-lever')).toContainText(/c1/);
  await expect(page.getByTestId('version-1')).toBeVisible();

  // --- v2 without the about-us line → positive delta
  await replaceEditorContent(page, 'subject: your q3 hiring\nPriya — saw you opened 6 SDR roles this month.\nRamp usually takes 90 days; two teams your size got it to 30.\nWorth a look, or is ramp not the bottleneck right now?');
  await page.getByTestId('make-run').click();
  await expect(page.getByTestId('version-2')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId('version-delta-2')).toContainText(/\+/, { timeout: 20_000 });
  await expect(page.getByTestId('reaction-bail')).toHaveCount(0);

  // --- Ship real results → prediction vs reality row
  await page.getByTestId('ship-open').click();
  await page.getByTestId('ship-sent').fill('100');
  await page.getByTestId('ship-replies').fill('5');
  await page.getByTestId('ship-submit').click();
  await expect(page.getByTestId('ship-sh1')).toContainText(/5(\.0)?\s*%/, { timeout: 10_000 });

  // --- Evidence tab: cards (contested shows both sides) and the consensus grid
  await page.getByTestId('rail-tab-evidence').click();
  await expect(page.getByTestId('evidence-cards')).toBeVisible();
  await expect(page.getByTestId('evidence-card-c3')).toContainText(/against/i);
  await expect(page.getByTestId('evidence-card-c1').getByTestId('specificity-niche')).toBeVisible();
  await expect(page.getByTestId('evidence-card-c6').getByTestId('specificity-general')).toBeVisible();
  await page.getByTestId('evidence-view-grid').click();
  await expect(page.getByTestId('evidence-grid')).toBeVisible();
  await expect(page.getByTestId('grid-cell-c1-reddit')).toBeVisible();

  // --- Library card shows the reps
  await page.goto('/');
  await page.getByTestId('track-skills').click();
  await expect(page.getByTestId(`skill-card-${SKILL}`)).toContainText(/rep/i);
  await expect(page.getByTestId(`skill-card-${SKILL}`).getByTestId('skill-target')).toBeVisible();
});
