// Measure whether drawing gets slower as a study progresses (with `yarn serve` running).
// Draws the same strokes on every trial and reports, per trial: the time to dispatch the stroke input
// (grows when input handlers get slower), main-thread long-task time while drawing, the time from Next to
// the next screen, and the JS heap. Fixation and TLX can be on or off.
// Run: node scripts/check-drawing-lag.mjs [studyId (default vlat-graphs)] [strokes per trial (default 6)]
import { chromium } from 'playwright';

const studyId = process.argv[2] || 'vlat-graphs';
const strokes = Number(process.argv[3] || 6);
const POINTS = 40;

const browser = await chromium.launch({ channel: 'chrome', args: ['--enable-precise-memory-info'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.addInitScript(() => {
  window.__longTasks = 0;
  new PerformanceObserver((list) => { list.getEntries().forEach((e) => { window.__longTasks += e.duration; }); })
    .observe({ type: 'longtask', buffered: true });
});
// The test browser's own connection to GitHub drops now and then, which leaves a trial waiting for its
// image; fetch the chart images from Node instead so network hiccups don't stall the measurement.
const images = new Map();
await page.route('https://raw.githubusercontent.com/**', async (route) => {
  const url = route.request().url();
  if (!images.has(url)) images.set(url, await route.fetch());
  await route.fulfill({ response: images.get(url) });
});
// PROFILE=1 also prints the functions using the most CPU while drawing on each trial.
const cdp = await page.context().newCDPSession(page);
if (process.env.PROFILE) { await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 500 }); }
await page.goto(`http://localhost:8080/${studyId}`);

// The consent page is optional: accept it if the study shows it, then press Start on the introduction.
const consent = page.getByText('Consent to Participate');
const start = page.getByRole('button', { name: 'Start' });
await Promise.race([consent.waitFor({ timeout: 30000 }), start.waitFor({ timeout: 30000 })]);
if (await consent.isVisible()) {
  await page.getByRole('radio', { name: 'Accept' }).check();
  await page.getByRole('button', { name: 'Agree' }).click();
}
await start.click();

const end = page.getByText('Thank you');
const layer = page.locator('.annotation-layer');
console.log('trial  strokeInput_ms  perPoint_ms  longTask_ms  next_ms  heap_MB');
for (let trial = 1; ; trial += 1) {
  await Promise.race([layer.waitFor({ timeout: 60000 }), end.waitFor({ timeout: 60000 })]);
  if (await end.isVisible()) break;
  await page.waitForTimeout(500);
  const box = await layer.boundingBox();
  await page.evaluate(() => { window.__longTasks = 0; });
  if (process.env.PROFILE) { await cdp.send('Profiler.start'); }
  const t0 = Date.now();
  for (let s = 0; s < strokes; s += 1) {
    const y = box.y + box.height * (0.2 + 0.6 * (s / Math.max(1, strokes - 1)));
    await page.mouse.move(box.x + box.width * 0.2, y);
    await page.mouse.down();
    for (let p = 1; p <= POINTS; p += 1) {
      await page.mouse.move(box.x + box.width * (0.2 + 0.6 * (p / POINTS)), y + 20 * Math.sin(p / 3));
    }
    await page.mouse.up();
  }
  const strokeMs = Date.now() - t0;
  await page.waitForTimeout(300);
  if (process.env.PROFILE) {
    // Self time per function (with its bundle file), to see what grows from trial to trial.
    const { profile } = await cdp.send('Profiler.stop');
    const self = new Map();
    const dt = profile.timeDeltas;
    const byId = new Map(profile.nodes.map((n) => [n.id, n]));
    profile.samples.forEach((id, i) => {
      const { functionName, url, lineNumber } = byId.get(id).callFrame;
      const key = `${functionName || '(anon)'} ${url.split('/').slice(-1)[0].split('?')[0]}:${lineNumber + 1}`;
      self.set(key, (self.get(key) ?? 0) + (dt[i] ?? 0) / 1000);
    });
    console.log([...self].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k, v]) => `      ${v.toFixed(0).padStart(6)} ms  ${k}`).join('\n'));
  }
  const longTask = await page.evaluate(() => window.__longTasks);
  const heap = await page.evaluate(() => performance.memory.usedJSHeapSize / 2 ** 20);

  await page.getByRole('radio').first().check();
  const shown = await page.locator('.annotation-image-stage img').getAttribute('src');
  const t1 = Date.now();
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  const tlx = page.getByText('Mental Demand');
  // The next screen is a TLX page, a fixation cross, a different chart, or the end page.
  await page.waitForFunction((src) => {
    const img = document.querySelector('.annotation-image-stage img');
    return document.querySelector('.fixation-cross') || (img && img.getAttribute('src') !== src)
      || /Mental Demand|Thank you/.test(document.body.innerText);
  }, shown, { timeout: 60000 });
  const nextMs = Date.now() - t1;
  if (await tlx.isVisible()) {
    const sliders = page.locator('.mantine-Slider-root');
    for (let j = 0; j < 6; j += 1) { const b = await sliders.nth(j).boundingBox(); await page.mouse.click(b.x + b.width * 0.3, b.y + b.height / 2); }
    await page.getByRole('button', { name: 'Next', exact: true }).click();
  }
  console.log(String(trial).padStart(5), String(strokeMs).padStart(15), (strokeMs / (strokes * (POINTS + 2))).toFixed(2).padStart(12),
    String(Math.round(longTask)).padStart(12), String(nextMs).padStart(8), heap.toFixed(1).padStart(8));
}
await browser.close();
