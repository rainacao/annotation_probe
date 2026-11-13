// Walk all 12 items at two viewports (with `yarn serve` running) and check each graph fits inside the stage, has its top/bottom white padding, and that the preceding fixation cross was centred on it.
// Run: node scripts/check-stimulus-fit.mjs <screenshot-dir>
import { chromium } from 'playwright';
const browser = await chromium.launch({ channel: 'chrome' });
for (const vp of [{ width: 1440, height: 900 }, { width: 1280, height: 720 }]) {
  const page = await browser.newPage({ viewport: vp });
  await page.goto('http://localhost:8080/vlat-graphs');
  for (let i = 0; i < 12; i += 1) {
    const cross = page.locator('.fixation-cross');
    await cross.waitFor({ timeout: 20000 });
    await page.waitForTimeout(200);
    const cb = await cross.boundingBox();
    await page.locator('.annotation-layer').waitFor({ timeout: 20000 });
    await page.waitForTimeout(300);
    const r = await page.evaluate(() => {
      const img = document.querySelector('.annotation-image-stage img').getBoundingClientRect();
      const stage = document.querySelector('.annotation-image-stage').getBoundingClientRect();
      const bd = document.querySelector('.annotation-backdrop').getBoundingClientRect();
      return { name: document.querySelector('.annotation-image-stage img').src.split('/').pop(), img, stage, bd };
    });
    const fits = r.img.top >= r.stage.top && r.img.bottom <= r.stage.bottom && r.img.left >= r.stage.left && r.img.right <= r.stage.right;
    const dx = Math.abs(cb.x + cb.width / 2 - (r.img.x + r.img.width / 2));
    const dy = Math.abs(cb.y + cb.height / 2 - (r.img.y + r.img.height / 2));
    console.log(vp.width, r.name.padEnd(16), 'fits', fits, 'img', Math.round(r.img.width), 'x', Math.round(r.img.height), 'pad top/bottom', Math.round(r.img.top - r.bd.top), Math.round(r.bd.bottom - r.img.bottom), 'cross off', dx.toFixed(2), dy.toFixed(2));
    await page.getByRole('radio').first().check();
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await page.getByText('Mental Demand').waitFor();
    const sliders = page.locator('.mantine-Slider-root');
    for (let j = 0; j < 6; j += 1) { const b = await sliders.nth(j).boundingBox(); await page.mouse.click(b.x + b.width * 0.3, b.y + b.height / 2); }
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    if (i === 0) await page.screenshot({ path: process.argv[2] + `/fit-${vp.width}.png` });
  }
  await page.close();
}
await browser.close();
