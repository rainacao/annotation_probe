// Finish the study in local Chrome (with `yarn serve` running) and count participant-JSON downloads on the end page.
// With uiConfig.autoDownloadStudy the file should download exactly once.
// Run: node scripts/check-auto-download.mjs [studyId] [secondsToWatch]
import { chromium } from 'playwright';

const studyId = process.argv[2] ?? 'vlat-graphs';
const watchMs = (Number(process.argv[3]) || 15) * 1000;
const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
const downloads = [];
page.on('download', (d) => downloads.push(d.suggestedFilename()));
await page.goto(`http://localhost:8080/${studyId}`);

const end = page.getByText('Thank you for completing');
const next = page.getByRole('button', { name: 'Next', exact: true });
while (!(await end.isVisible())) {
  const text = page.getByPlaceholder('Enter your answer');
  if (await text.isVisible()) await text.fill('test');
  const radio = page.getByRole('radio').first();
  if (await radio.isVisible()) await radio.check();
  if (await next.isVisible() && await next.isEnabled()) await next.click();
  await page.waitForTimeout(250);
}
await page.waitForTimeout(watchMs);
console.log(`downloads in ${watchMs / 1000}s on the end page: ${downloads.length}`, [...new Set(downloads)]);
await browser.close();
process.exit(downloads.length === 1 ? 0 : 1);
