// With `yarn serve` running: on the first graph, draw a mark on the graph, one in the grey area outside it, and one
// that is undone; resize the window mid-trial; finish the study; then print the saved drawing scene from the
// auto-downloaded participant JSON and screenshot the ?participantId= replay at a different window size.
// Screenshots: annotated.png (live), resized.png (after resize), replay.png (analysis view).
// Run: node scripts/check-excalidraw-trial.mjs <output-dir>
import { chromium } from 'playwright';
import fs from 'node:fs';

const out = process.argv[2];
const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
let file = null;
page.on('download', async (d) => { if (!file) { file = `${out}/participant.json`; await d.saveAs(file); } });
await page.goto('http://localhost:8080/vlat-graphs');
await page.locator('.excalidraw-layer canvas').first().waitFor({ timeout: 30000 });
await page.waitForTimeout(500);

const imageBox = () => page.locator('.annotation-image-stage img').boundingBox();
let img = await imageBox();
const stage = await page.locator('.annotation-image-stage').boundingBox();
const drag = async (x0, y0, x1, y1) => {
  await page.mouse.move(x0, y0);
  await page.mouse.down();
  for (let i = 1; i <= 15; i += 1) {
    await page.mouse.move(x0 + (x1 - x0) * i / 15, y0 + (y1 - y0) * i / 15);
    await page.waitForTimeout(15);
  }
  await page.mouse.up();
  await page.waitForTimeout(200);
};
const at = (fx, fy) => [img.x + img.width * fx, img.y + img.height * fy];
await drag(...at(0.1, 0.1), ...at(0.5, 0.1)); // A: on the graph
await drag(...at(0.1, 0.5), ...at(0.5, 0.9)); // B: undone
await page.getByRole('button', { name: 'Undo' }).click();
await page.waitForTimeout(200);
await drag(stage.x + 10, stage.y + stage.height - 10, img.x - 5, stage.y + stage.height - 10); // C: grey area, left of graph
// Panning and zooming should not move the marks.
await page.mouse.move(...at(0.5, 0.5));
await page.mouse.wheel(0, 400);
await page.keyboard.down('Control'); await page.mouse.wheel(0, -300); await page.keyboard.up('Control');
await page.waitForTimeout(300);
await page.screenshot({ path: `${out}/annotated.png` });

await page.setViewportSize({ width: 1100, height: 760 });
await page.waitForTimeout(800);
await page.screenshot({ path: `${out}/resized.png` });
img = await imageBox();
console.log('image after resize', img);

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
const scene = ans.answer.drawing;
console.log(key, 'answer keys', Object.keys(ans.answer));
console.log('image', scene.image, 'stage', scene.stage, 'appState', scene.appState);
console.log('markTimes', scene.markTimes);
for (const e of scene.elements) {
  const pts = e.points ?? [];
  const toImage = ([px, py]) => [((e.x + px - scene.image[0]) / scene.image[2]).toFixed(3), ((e.y + py - scene.image[1]) / scene.image[3]).toFixed(3)];
  console.log(e.id, e.type, { deleted: e.isDeleted, color: e.strokeColor, width: e.strokeWidth, n: pts.length, first: toImage(pts[0]), last: toImage(pts.at(-1)) });
}
for (const [location, graph] of Object.entries(ans.provenanceGraph ?? {})) {
  const nodes = Object.values(graph?.nodes ?? {});
  if (nodes.length) console.log('provenance', location, nodes.length, 'nodes, labels', [...new Set(nodes.map((n) => n.label))]);
}
console.log('trial JSON size (bytes)', JSON.stringify(ans).length, 'file size (bytes)', fs.statSync(file).size);
const otherDrawings = Object.entries(data.answers).filter(([k, a]) => k.startsWith('graph-') && a.answer.drawing?.elements?.length);
console.log('graphs with marks', otherDrawings.map(([k]) => k));

await page.setViewportSize({ width: 1280, height: 720 });
await page.goto(`${graphUrl}?participantId=${data.participantId}`);
await page.locator('.excalidraw-layer canvas').first().waitFor({ timeout: 30000 });
await page.waitForTimeout(2000);
await page.screenshot({ path: `${out}/replay-start.png` });
// Play the recording through, then screenshot the final state.
await page.getByRole('button', { name: 'Play' }).click();
await page.getByRole('button', { name: 'Restart' }).waitFor({ timeout: 60000 });
await page.waitForTimeout(500);
await page.screenshot({ path: `${out}/replay.png` });
await browser.close();
