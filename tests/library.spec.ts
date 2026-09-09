import { test, expect, type Page, type Locator } from '@playwright/test';
import { Encoder, type Encodable, type Mesg } from '@garmin/fitsdk';
import { readFile } from 'node:fs/promises';

function fitFile(name: string, date = '2026-08-01T08:00:00Z', sport = 'running', multi = false) {
  const encoder = new Encoder();
  const write = (mesgNum: number, fields: Record<string, unknown>) => encoder.writeMesg({ mesgNum, ...fields } as Encodable<Mesg>);
  const start = new Date(date);
  write(0, { type: 'activity', manufacturer: 'development', product: 1, serialNumber: 123, timeCreated: start });
  for (let session = 0; session < (multi ? 2 : 1); session++) {
    const time = (sec: number) => new Date(start.getTime() + (session * 1200 + sec) * 1000);
    write(21, { timestamp: time(0), event: 'timer', eventType: 'start' });
    for (let sec = 0; sec <= 900; sec += 15) write(20, { timestamp: time(sec), distance: sec * 3, speed: 3, heartRate: 140 + sec % 10, cadence: 85, altitude: 100 });
    write(21, { timestamp: time(900), event: 'timer', eventType: 'stopAll' });
    write(18, { timestamp: time(900), startTime: time(0), sport: session ? 'cycling' : sport, totalElapsedTime: 900, totalTimerTime: 900, totalDistance: 2700, avgHeartRate: 145, avgSpeed: 3 });
  }
  return { name, mimeType: 'application/octet-stream', buffer: Buffer.from(encoder.close()) };
}

const rows = (page: Page) => page.getByTestId('activity-row');
const libraryNav = (page: Page) => page.getByRole('button', { name: /^Activity library/ });
async function importFiles(page: Page, files: ReturnType<typeof fitFile>[]) {
  const picker = page.waitForEvent('filechooser');
  const choose = page.getByRole('button', { name: 'Choose files', exact: true });
  await (await choose.isVisible() ? choose : page.getByRole('button', { name: 'Import FIT files', exact: true })).click();
  await (await picker).setFiles(files);
  await expect(page.getByText(/\d+ imported · \d+ duplicates skipped/)).toBeVisible();
}
async function rowAction(row: Locator, action: 'Edit' | 'Remove') {
  await row.getByRole('button', { name: /^Actions for/ }).click();
  await row.getByRole('button', { name: action, exact: true }).click();
}
async function downloadBackup(page: Page) {
  await page.getByRole('button', { name: 'Backup', exact: true }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export backup' }).click();
  const file = await download;
  return readFile((await file.path())!, 'utf8');
}
async function restore(page: Page, contents: string) {
  await page.getByLabel('Restore library backup').setInputFiles({ name: 'backup.json', mimeType: 'application/json', buffer: Buffer.from(contents) });
}

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Choose files', exact: true })).toBeEnabled();
});

test('batch import persists across reload, skips renamed duplicates and isolates invalid files', async ({ page }, testInfo) => {
  await expect(page.getByRole('navigation', { name: 'Sections' }).getByRole('button')).toHaveCount(3);
  await page.screenshot({ path: testInfo.outputPath('library-empty-desktop.png'), fullPage: true });
  const run = fitFile('run.fit');
  const ride = fitFile('ride.fit', '2026-08-02T08:00:00Z', 'cycling');
  await importFiles(page, [run, { ...run, name: 'renamed.fit' }, { name: 'bad.fit', mimeType: 'application/octet-stream', buffer: Buffer.from('invalid') }, ride]);
  await expect(page.getByText('2 imported · 1 duplicates skipped · 1 failed')).toBeVisible();
  await expect(rows(page)).toHaveCount(2);
  await expect(page.getByText(/bad.fit:.*FIT file/)).toBeVisible();
  await page.reload();
  await expect(rows(page)).toHaveCount(2);
  await page.screenshot({ path: testInfo.outputPath('library-desktop.png'), fullPage: true });
  await rows(page).filter({ hasText: 'run.fit' }).getByRole('button', { name: /^Running/ }).click();
  await expect(page.getByRole('heading', { name: 'Overview', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Computed metrics' })).toBeHidden();
  await expect(page.locator('.overview-headline .tile')).toHaveCount(4);
  await page.getByText('Advanced metrics', { exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Computed metrics' })).toBeVisible();
  await page.getByText('Advanced metrics', { exact: true }).click();
  await page.screenshot({ path: testInfo.outputPath('overview-desktop.png'), fullPage: true });
  await libraryNav(page).click();
  await expect(rows(page)).toHaveCount(2);
});

test('single imports open analysis, and identical files retain their existing metadata', async ({ page }) => {
  const run = fitFile('single.fit');
  await importFiles(page, [run]);
  await expect(page.getByRole('heading', { name: 'Overview', exact: true })).toBeVisible();
  await libraryNav(page).click();
  await rowAction(rows(page), 'Edit');
  await page.getByLabel('Activity title', { exact: true }).fill('Morning trail');
  await page.getByLabel('Tags', { exact: true }).fill(' Trail, easy, trail ');
  await page.getByRole('textbox', { name: 'Notes', exact: true }).fill('Felt relaxed on the hills.');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByRole('form')).toHaveCount(0);
  await importFiles(page, [{ ...run, name: 'another-name.fit' }]);
  await expect(page.getByText('0 imported · 1 duplicates skipped')).toBeVisible();
  await libraryNav(page).click();
  await expect(rows(page)).toHaveCount(1);
  await expect(rows(page).getByRole('button', { name: 'Morning trail', exact: true })).toBeVisible();
  await page.reload();
  await expect(rows(page).getByText('Felt relaxed on the hills.')).toBeVisible();
  await expect(rows(page).locator('.library-tags .tag')).toHaveText(['trail', 'easy']);
});

test('filters combine sport, inclusive dates, search and tags; sorting and reset work', async ({ page }) => {
  await importFiles(page, [fitFile('older.fit'), fitFile('newer.fit', '2026-08-02T08:00:00Z'), fitFile('ride.fit', '2026-08-03T08:00:00Z', 'cycling')]);
  await expect(rows(page).first()).toContainText('ride.fit');
  await page.getByRole('button', { name: /^More filters/ }).click();
  await page.getByLabel('Sort by').selectOption('oldest');
  await expect(rows(page).first()).toContainText('older.fit');
  await rowAction(rows(page).filter({ hasText: 'newer.fit' }), 'Edit');
  await page.getByLabel('Tags', { exact: true }).fill('easy');
  await page.getByRole('textbox', { name: 'Notes', exact: true }).fill('Forest loop');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByRole('form')).toHaveCount(0);
  await page.getByRole('combobox', { name: 'Sport', exact: true }).selectOption('running');
  await page.getByLabel('From date').fill('2026-08-02');
  await page.getByLabel('To date').fill('2026-08-02');
  await page.getByRole('combobox', { name: 'Tag', exact: true }).selectOption('easy');
  await page.getByLabel('Search', { exact: true }).fill('forest');
  await expect(rows(page)).toHaveCount(1);
  await expect(rows(page)).toContainText('newer.fit');
  await page.getByLabel('Search', { exact: true }).fill('missing');
  await expect(page.getByText('No activities match these filters.')).toBeVisible();
  await page.getByRole('button', { name: 'Reset filters' }).click();
  await expect(rows(page)).toHaveCount(3);
});

test('backup restores original bytes and notes into an empty browser; merge preserves edits', async ({ page, browser }) => {
  const files = [fitFile('run.fit'), fitFile('ride.fit', '2026-08-03T08:00:00Z', 'cycling')];
  await importFiles(page, files);
  await rowAction(rows(page).filter({ hasText: 'run.fit' }), 'Edit');
  await page.getByLabel('Activity title', { exact: true }).fill('Saved run');
  await page.getByRole('textbox', { name: 'Notes', exact: true }).fill('Backup note');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByRole('form')).toHaveCount(0);
  const backup = await downloadBackup(page);
  const content = JSON.parse(backup);
  expect(Buffer.from(content.activities.find((a: { fileName: string }) => a.fileName === 'run.fit').fit, 'base64')).toEqual(files[0].buffer);
  const other = await browser.newContext();
  const restored = await other.newPage();
  await restored.goto(page.url());
  await expect(restored.getByRole('button', { name: 'Restore backup', exact: true })).toBeEnabled();
  await restore(restored, backup);
  await expect(restored.getByText('2 restored · 0 duplicates skipped')).toBeVisible();
  await expect(rows(restored)).toHaveCount(2);
  await expect(rows(restored).getByText('Backup note')).toBeVisible();
  await rowAction(rows(restored).filter({ hasText: 'run.fit' }), 'Edit');
  await restored.getByRole('textbox', { name: 'Notes', exact: true }).fill('Newer local note');
  await restored.getByRole('button', { name: 'Save changes' }).click();
  await expect(restored.getByRole('form')).toHaveCount(0);
  await restore(restored, backup);
  await expect(restored.getByText('0 restored · 2 duplicates skipped')).toBeVisible();
  await expect(rows(restored).getByText('Newer local note')).toBeVisible();
  await rows(restored).getByRole('button', { name: 'Saved run', exact: true }).click();
  await expect(restored.getByRole('heading', { name: 'Overview', exact: true })).toBeVisible();
  await other.close();
});

test('corrupt or unsupported backups leave the library unchanged', async ({ page }) => {
  await importFiles(page, [fitFile('keep.fit'), fitFile('second.fit', '2026-08-02T08:00:00Z')]);
  const backup = JSON.parse(await downloadBackup(page));
  // Remove both first, so a valid first entry would expose an incremental restore bug.
  for (let i = 0; i < 2; i++) {
    await rowAction(rows(page).first(), 'Remove');
    await page.getByRole('button', { name: 'Remove activity', exact: true }).click();
    await expect(rows(page)).toHaveCount(1 - i);
  }
  backup.activities[1].id = '0'.repeat(64);
  await restore(page, JSON.stringify(backup));
  await expect(page.getByRole('alert')).toContainText('integrity check');
  await expect(rows(page)).toHaveCount(0);
  await restore(page, JSON.stringify({ ...backup, version: 99 }));
  await expect(page.getByRole('alert')).toContainText('version is not supported');
  await restore(page, '{bad json');
  await expect(page.getByRole('alert')).toContainText('invalid JSON');
  await page.reload();
  await expect(rows(page)).toHaveCount(0);
});

test('multi-session files reopen with session selection, and removing the open file clears analysis', async ({ page }) => {
  await importFiles(page, [fitFile('multisport.fit', undefined, 'running', true)]);
  await expect(page.getByLabel('Session', { exact: true })).toBeVisible();
  await page.getByLabel('Session', { exact: true }).selectOption('1');
  await expect(page.getByRole('heading', { name: 'Overview', exact: true })).toBeVisible();
  await libraryNav(page).click();
  await expect(rows(page)).toContainText('2 sessions');
  await expect(rows(page)).toContainText('5.4 km');
  await rowAction(rows(page), 'Remove');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(rows(page)).toHaveCount(1);
  await rowAction(rows(page), 'Remove');
  await page.getByRole('button', { name: 'Remove activity', exact: true }).click();
  await expect(rows(page)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Overview', exact: true })).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Drop your .fit files here' })).toBeVisible();
});

test('library is usable on mobile without horizontal page overflow', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: testInfo.outputPath('library-empty-mobile.png'), fullPage: true });
  await importFiles(page, [fitFile('run.fit'), fitFile('ride.fit', '2026-08-03T08:00:00Z', 'cycling')]);
  await expect(rows(page)).toHaveCount(2);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await rowAction(rows(page).first(), 'Edit');
  await expect(page.getByRole('textbox', { name: 'Notes', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('library-mobile.png'), fullPage: true });
});

test('an interrupted storage transaction never leaves a library entry without its FIT file', async ({ page }) => {
  await page.evaluate(() => {
    const add = IDBObjectStore.prototype.add;
    IDBObjectStore.prototype.add = function (...args) {
      const request = add.apply(this, args);
      if (this.name === 'files') this.transaction.abort();
      return request;
    };
  });
  await importFiles(page, [fitFile('interrupted.fit')]);
  await expect(page.getByText('0 imported · 0 duplicates skipped · 1 failed')).toBeVisible();
  await page.reload();
  await expect(rows(page)).toHaveCount(0);
  await importFiles(page, [fitFile('interrupted.fit')]);
  await expect(page.getByText('1 imported · 0 duplicates skipped')).toBeVisible();
});

test('pagination preserves the full library in backups even while filters are active', async ({ page }) => {
  await importFiles(page, Array.from({ length: 26 }, (_, i) => fitFile(`run-${i}.fit`, `2026-08-${String(i + 1).padStart(2, '0')}T08:00:00Z`)));
  await expect(rows(page)).toHaveCount(25);
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(rows(page)).toHaveCount(1);
  await page.getByLabel('Search', { exact: true }).fill('run-0.fit');
  await expect(rows(page)).toHaveCount(1);
  expect(JSON.parse(await downloadBackup(page)).activities).toHaveLength(26);
});

test('library navigation restores filters and scroll, reload reopens a route, and deleted routes explain the missing activity', async ({ page }) => {
  await importFiles(page, Array.from({ length: 12 }, (_, i) => fitFile(`run-${i}.fit`, `2026-08-${String(i + 1).padStart(2, '0')}T08:00:00Z`)));
  await page.getByLabel('Search', { exact: true }).fill('run-');
  const source = rows(page).filter({ hasText: 'run-4.fit' });
  await source.getByRole('button', { name: /^Running/ }).scrollIntoViewIfNeeded();
  const position = await page.evaluate(() => window.scrollY);
  expect(position).toBeGreaterThan(100);
  await source.getByRole('button', { name: /^Running/ }).click();
  await expect(page.getByRole('heading', { name: 'Overview', exact: true })).toBeVisible();
  const activityUrl = page.url();
  await page.goBack();
  await expect(page.getByLabel('Search', { exact: true })).toHaveValue('run-');
  await expect.poll(async () => Math.abs(await page.evaluate(() => window.scrollY) - position)).toBeLessThan(3);
  await page.goForward();
  await expect(page.getByRole('heading', { name: 'Overview', exact: true })).toBeVisible();
  await page.reload();
  await expect(page).toHaveURL(activityUrl);
  await expect(page.getByRole('heading', { name: 'Overview', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Back to library' }).click();
  await rowAction(source, 'Remove');
  await page.getByRole('button', { name: 'Remove activity', exact: true }).click();
  await expect(source).toHaveCount(0);
  await page.goto(activityUrl);
  await expect(page.getByRole('heading', { name: 'Activity not found' })).toBeVisible();
  await page.getByRole('button', { name: 'Go to activity library' }).click();
  await expect(rows(page)).toHaveCount(11);
});

test('action menus support keyboard dismissal, and mobile navigation keeps focus inside the drawer', async ({ page }, testInfo) => {
  await importFiles(page, [fitFile('run.fit'), fitFile('ride.fit', '2026-08-02T08:00:00Z', 'cycling')]);
  const actions = rows(page).first().getByRole('button', { name: /^Actions for/ });
  await actions.focus();
  await actions.press('Enter');
  const edit = rows(page).first().getByRole('button', { name: 'Edit', exact: true });
  await expect(edit).toBeVisible();
  await edit.press('Escape');
  await expect(edit).toBeHidden();
  await expect(actions).toBeFocused();
  await actions.click();
  await page.getByRole('heading', { name: 'Activity library', exact: true }).click();
  await expect(edit).toBeHidden();
  await page.setViewportSize({ width: 320, height: 740 });
  await page.getByRole('button', { name: /^More filters/ }).click();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const size = await page.getByRole('button', { name: 'Import FIT files', exact: true }).boundingBox();
  expect(size!.height).toBeGreaterThanOrEqual(44);
  await page.getByRole('button', { name: 'Open menu' }).click();
  await expect(page.getByRole('button', { name: 'Close menu' })).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  expect(await page.evaluate(() => document.querySelector('#app-sidebar')!.contains(document.activeElement))).toBe(true);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Open menu' })).toBeFocused();
  await expect(page.getByLabel('Search', { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Open menu' }).click();
  await page.getByRole('radio', { name: 'Dark', exact: true }).click();
  await page.getByRole('button', { name: 'Close menu' }).click();
  await page.screenshot({ path: testInfo.outputPath('library-mobile-dark.png'), fullPage: true });
});
