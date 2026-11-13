// With `yarn serve` running: draw three marks on the first graph (undoing the second), finish the study, and print the
// saved annotationEvents from the auto-downloaded participant JSON next to the windowEvents mousedowns. Also screenshots
// the live marks (annotated.png) and the read-only ?participantId= view (replay.png).
// Run: node scripts/check-annotation-events.mjs <output-dir>
import { chromium } from 'playwright';
import fs from 'node:fs';
const out = process.argv[2];
const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
let file = null;
page.on('download', async (d) => { if (!file) { file = `${out}/participant.json`; await d.saveAs(file); } });
await page.goto('http://localhost:8080/vlat-graphs');
await page.locator('.annotation-layer').waitFor({ timeout: 30000 });
await page.waitForTimeout(300);
const img = await page.locator('.annotation-image-stage img').boundingBox();
const drag = async (fx0, fy0, fx1, fy1) => {
  await page.mouse.move(img.x + img.width * fx0, img.y + img.height * fy0);
  await page.mouse.down();
  for (let i = 1; i <= 10; i += 1) {
    await page.mouse.move(img.x + img.width * (fx0 + (fx1 - fx0) * i / 10), img.y + img.height * (fy0 + (fy1 - fy0) * i / 10));
    await page.waitForTimeout(15);
  }
  await page.mouse.up();
};
await drag(0.1, 0.1, 0.5, 0.1);           // A: horizontal line near top
await drag(0.1, 0.5, 0.5, 0.9);           // B: diagonal (will be undone)
await page.getByRole('button', { name: 'Undo' }).click();
await drag(0.9, 0.2, 1.03, 0.2);          // C: runs into the right margin (x > 1)
await page.screenshot({ path: `${out}/annotated.png` });
const graphUrl = page.url().split('?')[0];
const end = page.getByText('Thank you for completing');
const next = page.getByRole('button', { name: 'Next', exact: true });
while (!(await end.isVisible())) {
  const radio = page.getByRole('radio').first();
  if (await radio.isVisible()) await radio.check();
  if (await next.isVisible() && await next.isEnabled()) await next.click();
  await page.waitForTimeout(250);
}
for (let i = 0; i < 40 && !file; i += 1) await page.waitForTimeout(250);
await page.waitForTimeout(500);
const data = JSON.parse(fs.readFileSync(file, 'utf8'));
const [key, ans] = Object.entries(data.answers).find(([k]) => k.startsWith('graph-treemap'));
const events = ans.answer.annotationEvents;
console.log(key, 'answer keys', Object.keys(ans.answer));
for (const [t, action, d] of events) {
  if (action === 'draw') console.log(t, 'draw', { end: d.end, ms: d.end - t, image: d.image, nPoints: d.points.length, first: d.points[0], last: d.points.at(-1) });
  else console.log(t, action, d);
}
console.log('window mousedowns during trial', ans.windowEvents.filter((e) => e[1] === 'mousedown').map((e) => e[0]));
await page.goto(`${graphUrl}?participantId=${data.participantId}`);
await page.locator('.annotation-layer').waitFor({ timeout: 30000 });
await page.waitForTimeout(1500);
await page.locator('.annotation-image-stage').screenshot({ path: `${out}/replay.png` });
console.log('replay undo button disabled (read-only):', await page.getByRole('button', { name: 'Undo' }).isDisabled());
await browser.close();
