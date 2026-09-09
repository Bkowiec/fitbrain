import { test, expect, type Page } from '@playwright/test';
import { Encoder, type Encodable, type Mesg } from '@garmin/fitsdk';

interface SessionFixture { sport?: string; duration?: number; speed?: number; power?: number; hr?: number }
function recording(name: string, date: string, sessions: SessionFixture[], maxHr?: number) {
  const encoder = new Encoder();
  const write = (mesgNum: number, fields: Record<string, unknown>) => encoder.writeMesg({ mesgNum, ...fields } as Encodable<Mesg>);
  const start = Date.parse(`${date}T08:00:00Z`);
  write(0, { type: 'activity', manufacturer: 'development', product: 1, timeCreated: new Date(start) });
  if (maxHr) write(7, { maxHeartRate: maxHr });
  let offset = 0;
  for (const s of sessions) {
    const duration = s.duration ?? 600, speed = s.speed ?? 3, hr = s.hr ?? 140;
    const at = (sec: number) => new Date(start + (offset + sec) * 1000);
    write(21, { timestamp: at(0), event: 'timer', eventType: 'start' });
    for (let sec = 0; sec <= duration; sec++) write(20, { timestamp: at(sec), distance: sec * speed, speed, heartRate: hr, ...(s.power !== undefined ? { power: s.power } : {}) });
    write(21, { timestamp: at(duration), event: 'timer', eventType: 'stopAll' });
    write(18, { timestamp: at(duration), startTime: at(0), sport: s.sport ?? 'running', totalTimerTime: duration, totalElapsedTime: duration, totalDistance: duration * speed, avgSpeed: speed, avgHeartRate: hr, ...(s.power !== undefined ? { avgPower: s.power } : {}) });
    offset += duration + 120;
  }
  return { name, mimeType: 'application/octet-stream', buffer: Buffer.from(encoder.close()) };
}
async function importRecordings(page: Page, files: ReturnType<typeof recording>[]) {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Choose files', exact: true })).toBeEnabled();
  await page.getByLabel('Import FIT files', { exact: true }).setInputFiles(files);
  await expect(page.getByText(`${files.length} imported · 0 duplicates skipped`)).toBeVisible();
}
async function trends(page: Page) {
  await page.getByRole('button', { name: 'Trends and records', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Trends and records', exact: true })).toBeVisible();
}

test('weekly history separates multi-sport sessions and record sources open the matching session', async ({ page }, testInfo) => {
  await importRecordings(page, [
    recording('older-run.fit', '2026-07-20', [{ speed: 2.5, duration: 800 }], 190),
    recording('run.fit', '2026-08-03', [{}], 190),
    recording('multi.fit', '2026-08-10', [{ speed: 3.5 }, { sport: 'cycling', speed: 10, power: 200 }], 190),
    recording('ride.fit', '2026-08-17', [{ sport: 'cycling', speed: 8, power: 250 }], 190),
  ]);
  await trends(page);
  await expect(page.getByTestId('history-sessions').locator('.tile-value')).toHaveText('5');
  await expect(page.getByTestId('history-distance').locator('.tile-value')).toHaveText('16.7km');
  await expect(page.getByTestId('history-time').locator('.tile-value')).toHaveText('53:20');
  await page.getByRole('combobox', { name: 'Period', exact: true }).selectOption('all');
  await expect(page.getByTestId('history-sessions')).not.toContainText('previous period');
  await page.getByText('Weekly totals', { exact: true }).click();
  const gap = page.getByRole('table', { name: 'Weekly totals', exact: true }).getByRole('row').filter({ hasText: '2026-07-27' });
  await expect(gap).toContainText('0 km');
  await page.getByRole('combobox', { name: 'Sport', exact: true }).selectOption('running');
  await expect(page.getByTestId('history-sessions').locator('.tile-value')).toHaveText('3');
  await expect(page.getByTestId('history-distance').locator('.tile-value')).toHaveText('5.9km');
  await expect(page.getByRole('table', { name: 'Running fastest efforts' }).getByRole('row').filter({ hasText: '1 km' })).toContainText('4:46');
  await expect(page.getByRole('table', { name: 'Similar activities', exact: true }).getByRole('row')).toHaveCount(3);
  await page.screenshot({ path: testInfo.outputPath('trends-desktop.png'), fullPage: true });
  await page.getByRole('combobox', { name: 'Sport', exact: true }).selectOption('cycling');
  await expect(page.getByTestId('history-distance').locator('.tile-value')).toHaveText('10.8km');
  await expect(page.getByRole('table', { name: 'Cycling peak power' }).getByRole('row').nth(1)).toContainText('250 W');
  await page.getByRole('table', { name: 'Cycling fastest efforts' }).getByRole('button').first().click();
  await expect(page.getByRole('heading', { name: 'Overview', exact: true })).toBeVisible();
  await expect(page.getByLabel('Session', { exact: true })).toHaveValue('1');
  await expect(page.getByRole('button', { name: 'Back to trends' })).toBeVisible();
  await page.getByRole('button', { name: 'Charts', exact: true }).click();
  await expect(page).toHaveURL(/\/1\/charts$/);
  await page.goBack();
  await expect(page.getByRole('heading', { name: 'Overview', exact: true })).toBeVisible();
  await page.goForward();
  await expect(page.getByRole('heading', { name: 'Charts', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Back to trends' }).click();
  await expect(page).toHaveURL(/#\/trends$/);
  await expect(page.getByRole('combobox', { name: 'Sport', exact: true })).toHaveValue('cycling');
  await expect(page.getByRole('combobox', { name: 'Period', exact: true })).toHaveValue('all');
  await expect(page.getByRole('table', { name: 'Weekly totals', exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(100);
  await page.goForward();
  await expect(page).toHaveURL(/\/1\/overview$/);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Overview', exact: true })).toBeVisible();
  await expect(page.getByLabel('Session', { exact: true })).toHaveValue('1');
});

test('zone definitions stay separate until athlete settings trigger a consistent recalculation', async ({ page }) => {
  await importRecordings(page, [recording('first.fit', '2026-08-01', [{}], 180), recording('second.fit', '2026-08-02', [{}], 200)]);
  await trends(page);
  const definitions = page.getByRole('combobox', { name: 'Zone definition', exact: true });
  await expect(definitions.locator('option')).toHaveCount(2);
  await expect(page.getByText(/1 of 2 sessions share this definition/)).toBeVisible();
  await page.getByRole('button', { name: /^Athlete settings/ }).click();
  await page.getByRole('spinbutton', { name: /^Max heart rate/ }).fill('190');
  await page.getByRole('button', { name: 'Apply and re-analyze' }).click();
  await expect(definitions.locator('option')).toHaveCount(1);
  await expect(page.getByText(/2 of 2 sessions share this definition/)).toBeVisible();
  await page.getByText('Zone totals', { exact: true }).click();
  await expect(page.getByRole('table', { name: 'Zone totals' }).getByRole('row').filter({ hasText: 'Z3' })).toContainText('20:00');
  await page.reload();
  await trends(page);
  await expect(definitions.locator('option')).toHaveCount(1);
  await expect(page.getByTestId('history-sessions').locator('.tile-value')).toHaveText('2');
});

test('legacy library entries are enriched without losing notes; custom dates and deletion update totals', async ({ page }) => {
  await importRecordings(page, [recording('first.fit', '2026-08-01', [{}]), recording('second.fit', '2026-08-08', [{}])]);
  await page.evaluate(async () => {
    await new Promise<void>((resolve, reject) => {
      const open = indexedDB.open('fitbrain-library', 1);
      open.onsuccess = () => {
        const db = open.result;
        const tx = db.transaction('activities', 'readwrite');
        const store = tx.objectStore('activities');
        const request = store.getAll();
        request.onsuccess = () => request.result.forEach((a) => { delete a.history; a.notes = 'Preserve my note'; store.put(a); });
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onabort = () => { db.close(); reject(tx.error); };
      };
      open.onerror = () => reject(open.error);
    });
  });
  await page.reload();
  await trends(page);
  await expect(page.getByTestId('history-sessions').locator('.tile-value')).toHaveText('2');
  await page.getByRole('combobox', { name: 'Period', exact: true }).selectOption('custom');
  await page.getByRole('region', { name: 'History filters' }).getByLabel('From date').fill('2026-08-08');
  await page.getByRole('region', { name: 'History filters' }).getByLabel('To date').fill('2026-08-08');
  await expect(page.getByTestId('history-sessions').locator('.tile-value')).toHaveText('1');
  await page.getByRole('button', { name: /^Activity library/ }).click();
  const last = page.getByTestId('activity-row').filter({ hasText: 'second.fit' });
  await expect(last).toContainText('Preserve my note');
  await last.getByRole('button', { name: /^Actions for/ }).click();
  await last.getByRole('button', { name: 'Remove', exact: true }).click();
  await page.getByRole('button', { name: 'Remove activity' }).click();
  await expect(page.getByTestId('activity-row')).toHaveCount(1);
  await trends(page);
  await expect(page.getByText('No sessions match this period and these filters.')).toBeVisible();
});

test('empty history leads to the library and mobile history fits the viewport', async ({ page }, testInfo) => {
  await page.goto('/');
  await trends(page);
  await page.getByRole('button', { name: 'Go to activity library' }).click();
  await expect(page.getByRole('button', { name: 'Choose files' })).toBeVisible();
  await importRecordings(page, [recording('a.fit', '2026-08-01', [{}], 190), recording('b.fit', '2026-08-08', [{}], 190)]);
  await trends(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('img', { name: 'Weekly distance', exact: true })).toBeVisible();
  await expect(page.getByRole('table', { name: 'Running fastest efforts' })).toBeHidden();
  await expect(page.locator('.history-record-cards').getByText('1 km', { exact: true })).toBeVisible();
  await page.locator('.history-comparison-cards').getByText('More metrics', { exact: true }).first().click();
  await expect(page.locator('.history-comparison-cards').getByText('Avg HR', { exact: true }).first()).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  await page.screenshot({ path: testInfo.outputPath('trends-mobile.png'), fullPage: true });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
