// Smoke-test the participant flow (fixation -> graph -> NASA-TLX -> next fixation) in local Chrome.
// Run with `yarn serve` in another terminal: node scripts/smoke-study-flow.mjs <screenshot-dir>
// Checks that the fixation cross is centred on the upcoming graph and that each step advances.

import { chromium } from 'playwright';
const out = process.argv[2] ?? '.';
const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
// Time the cross in the page itself (Playwright's polling adds lag): first frame shown -> removed.
await page.addInitScript(() => {
  window.crossTimes = [];
  let shownAt = null;
  new MutationObserver(() => {
    const present = !!document.querySelector('.fixation-cross');
    if (present && shownAt === null) shownAt = performance.now();
    if (!present && shownAt !== null) { window.crossTimes.push(Math.round(performance.now() - shownAt)); shownAt = null; }
  }).observe(document, { childList: true, subtree: true });
});
await page.goto('http://localhost:8080/vlat-graphs');
const cross = page.locator('.fixation-cross');
await cross.waitFor({ timeout: 20000 });
const cb = await cross.boundingBox();
const bg = await page.evaluate(() => getComputedStyle(document.querySelector('.mantine-AppShell-main')).backgroundColor);
await page.screenshot({ path: `${out}/1-fixation.png` });
await page.locator('.annotation-layer').waitFor({ timeout: 20000 });
await page.waitForTimeout(500);
const ib = await page.locator('.annotation-image-stage img').boundingBox();
await page.screenshot({ path: `${out}/2-graph.png` });
console.log('main bg', bg);
console.log('cross centre', cb.x + cb.width / 2, cb.y + cb.height / 2);
console.log('image centre', ib.x + ib.width / 2, ib.y + ib.height / 2);
console.log('cross on screen ms (expected durationMs)', await page.evaluate(() => window.crossTimes));
await page.getByPlaceholder('Enter your answer').fill('test');
await page.getByRole('button', { name: 'Next', exact: true }).click();
await page.getByText('Mental Demand').waitFor({ timeout: 10000 });
await page.waitForTimeout(500);
await page.screenshot({ path: `${out}/3-tlx.png`, fullPage: true });
const sliders = page.locator('.mantine-Slider-root');
console.log('tlx sliders', await sliders.count());
for (let i = 0; i < await sliders.count(); i += 1) {
  const b = await sliders.nth(i).boundingBox();
  await page.mouse.click(b.x + b.width * 0.3, b.y + b.height / 2);
}
await page.getByRole('button', { name: 'Next', exact: true }).click();
await page.locator('.fixation-cross').waitFor({ timeout: 10000 });
console.log('second fixation reached', page.url());
console.log('page errors', errors);
await browser.close();
