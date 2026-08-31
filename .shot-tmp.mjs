import { chromium } from '@playwright/test';

const OUT = '/tmp/claude-0/-home-user-omnilearn/73c89a4a-ba3f-5180-a913-3be7e41fad79/scratchpad';
const base = 'http://localhost:4655';

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
page.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE ERR:', m.text()); });
page.on('pageerror', (e) => console.log('PAGE ERROR:', e.message));

await page.goto(base + '/#/');
await page.waitForSelector('[data-testid="library"]');
await page.screenshot({ path: `${OUT}/01-library-empty.png` });

// new project
await page.getByTestId('new-project').click();
await page.getByTestId('goal-input').fill('I want to implement multi-head self-attention in numpy from scratch');
await page.screenshot({ path: `${OUT}/02-goal.png` });
await page.getByTestId('goal-submit').click();
await page.waitForSelector('[data-testid="plan-review"]', { timeout: 20000 });
await page.screenshot({ path: `${OUT}/03-plan.png` });
await page.getByTestId('plan-add-milestone').click();
await page.getByTestId('plan-title-2').fill('extra step');
await page.getByTestId('plan-up-2').click();
await page.screenshot({ path: `${OUT}/03b-plan-edited.png` });
await page.getByTestId('plan-delete-1').click();
await page.getByTestId('plan-accept').click();

await page.waitForSelector('[data-testid="calibration"]', { timeout: 20000 });
await page.screenshot({ path: `${OUT}/04-calibration.png`, fullPage: true });

// answer: q0 correct, q1 correct, q2 wrong, q3 no idea
const calib = await (await page.request.post(`${base}/api/projects/attention-from-scratch/calibration`, { data: { milestoneId: 'sdpa' } })).json();
const picks = calib.questions.map((q, i) => {
  if (i === 0 || i === 1) return q.answerIndex;
  if (i === 2) return (q.answerIndex + 1) % (q.options.length - 1);
  return q.options.length - 1;
});
for (let i = 0; i < picks.length; i++) await page.getByTestId(`calib-opt-${i}-${picks[i]}`).click();
await page.screenshot({ path: `${OUT}/05-calibration-answered.png`, fullPage: true });
await page.getByTestId('calib-submit').click();

await page.waitForSelector('[data-testid="primer-deck"]', { timeout: 20000 });
await page.waitForTimeout(600);
await page.screenshot({ path: `${OUT}/06-deck-story.png`, fullPage: true });

// scroll the story to test scrollytelling
const scroller = page.locator('.story-scroll');
await scroller.evaluate((el) => { el.scrollTop = el.scrollHeight * 0.55; });
await page.waitForTimeout(800);
const active = await page.locator('.story-beat[data-active="true"]').count();
const activeIdx = await page.locator('.story-beat').evaluateAll((els) => els.findIndex((e) => e.dataset.active === 'true'));
console.log('active beats:', active, 'index:', activeIdx);
await page.screenshot({ path: `${OUT}/07-story-scrolled.png`, fullPage: true });

await page.getByTestId('primer-next').click();
await page.waitForTimeout(300);
await page.screenshot({ path: `${OUT}/08-card.png`, fullPage: true });
await page.getByTestId('primer-next').click();
await page.waitForTimeout(200);
// wrong answer first
await page.getByTestId('check-opt-1').click();
await page.waitForTimeout(300);
console.log('data-correct after wrong:', await page.getByTestId('primer-check').getAttribute('data-correct'));
await page.screenshot({ path: `${OUT}/09-check-wrong.png`, fullPage: true });
await page.getByTestId('check-opt-0').click();
await page.waitForTimeout(400);
console.log('data-correct after right:', await page.getByTestId('primer-check').getAttribute('data-correct'));
console.log('softmax cleared:', await page.getByTestId('concept-softmax').getAttribute('data-cleared'));
await page.screenshot({ path: `${OUT}/10-check-right.png`, fullPage: true });

await page.getByTestId('primer-next').click();
await page.waitForTimeout(200);
await page.getByTestId('check-opt-0').click();
await page.waitForTimeout(1400);
await page.screenshot({ path: `${OUT}/11-finish.png`, fullPage: true });
console.log('start-building visible:', await page.getByTestId('start-building').isVisible());
console.log('weighted-sum cleared:', await page.getByTestId('concept-weighted-sum').getAttribute('data-cleared'));

// back to library, look at a populated card + schemes
await page.goto(base + '/#/');
await page.waitForSelector('[data-testid="library"]');
await page.waitForTimeout(400);
await page.screenshot({ path: `${OUT}/12-library-cards.png` });

for (const s of ['blackboard', 'arcade', 'mint']) {
  await page.getByTestId('settings').click();
  await page.getByTestId(`scheme-${s}`).click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/13-scheme-${s}.png` });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
}
await page.getByTestId('settings').click();
await page.getByTestId('scheme-arcade').click();
await page.waitForTimeout(300);
await page.keyboard.press('Escape');
await page.goto(base + '/#/milestone/attention-from-scratch/multihead');
await page.waitForSelector('[data-testid="calibration"]', { timeout: 20000 });
await page.screenshot({ path: `${OUT}/14-arcade-calibration.png`, fullPage: true });

await page.getByTestId('settings') .isVisible().catch(() => {});
await browser.close();
console.log('done');
