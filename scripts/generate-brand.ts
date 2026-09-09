/** Regenerate the complete identity from the same vector geometry as the React logo. */
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { MARK_F, MARK_B, MARK_TRANSFORM, WORDMARK_PATH, WORDMARK_WIDTH, WORDMARK_HEIGHT } from '../src/brand/geometry';

const dir = new URL('../public/brand/', import.meta.url);
await mkdir(dir, { recursive: true });
const ink = '#0b0b0b', paper = '#fcfcfb', blue = '#2a78d6', nightBlue = '#3987e5';
const mark = (accent = blue, color = ink) => `<g transform="${MARK_TRANSFORM}"><path fill="${accent}" d="${MARK_F}"/><path fill="${color}" d="${MARK_B}"/></g>`;
const word = (height: number, color = ink) => `<g transform="scale(${height / WORDMARK_HEIGHT})"><path fill="${color}" d="${WORDMARK_PATH}"/></g>`;
const lockup = (size: number, accent = blue, color = ink) => `<g transform="scale(${size / 32})">${mark(accent, color)}</g><g transform="translate(${size * 1.3} ${size * 0.16})">${word(size * 0.68, color)}</g>`;
const svg = (width: number, height: number, content: string, title = 'FitBrain') => `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${title}"><title>${title}</title>${content}</svg>\n`;
const save = (file: string, data: string) => writeFile(new URL(file, dir), data);

const icon = svg(512, 512, `<rect width="512" height="512" fill="${ink}"/><g transform="translate(64 64) scale(12)">${mark(nightBlue, paper)}</g>`);
await save('app-icon.svg', icon);
await save('mark.svg', svg(32, 32, mark()));
await save('mark-dark.svg', svg(32, 32, mark(nightBlue, paper)));
await save('mark-mono.svg', svg(32, 32, mark(ink, ink)));
await save('mark-white.svg', svg(32, 32, mark('#fff', '#fff')));
const logoSize = 80, logoWidth = Math.ceil(logoSize * 1.3 + logoSize * 0.68 * WORDMARK_WIDTH / WORDMARK_HEIGHT);
await save('logo.svg', svg(logoWidth, logoSize, lockup(logoSize)));
await save('logo-dark.svg', svg(logoWidth, logoSize, lockup(logoSize, nightBlue, paper)));
await save('logo-mono.svg', svg(logoWidth, logoSize, lockup(logoSize, ink, ink)));
await save('logo-white.svg', svg(logoWidth, logoSize, lockup(logoSize, '#fff', '#fff')));

await writeFile(new URL('../favicon.svg', dir), svg(32, 32, `<style>:root{--mark-accent:${blue};color:${ink}}@media(prefers-color-scheme:dark){:root{--mark-accent:${nightBlue};color:${paper}}}</style>${mark('var(--mark-accent)', 'currentColor')}`));

await save('readme-header.svg', svg(1200, 280, `
  <style>.background{fill:${paper}}.ink{color:${ink}}.accent{--brand-accent:${blue}}.muted{fill:#65635e}.frame{stroke:#e3e2dd}
    @media(prefers-color-scheme:dark){.background{fill:#1a1a19}.ink{color:${paper}}.accent{--brand-accent:${nightBlue}}.muted{fill:#a6a49d}.frame{stroke:#2c2c2a}}
    text{font-family:"Source Sans 3","Segoe UI",system-ui,sans-serif}
  </style>
  <rect class="background frame" x=".5" y=".5" width="1199" height="279" rx="3"/>
  <g class="ink accent"><g transform="translate(950 18) scale(7.5)" opacity=".06">${mark('var(--brand-accent)', 'currentColor')}</g>
    <g transform="translate(42 32)">${lockup(56, 'var(--brand-accent)', 'currentColor')}</g>
    <text x="48" y="148" fill="currentColor" font-size="28" font-weight="600" letter-spacing="-.6">Read everything your watch recorded.</text>
  </g>
  <text class="muted" x="48" y="183" font-size="16">Training insights from your FIT files. Everything stays on your device.</text>
  <path class="frame" d="M48 213H896"/>
  <text class="muted" x="48" y="244" font-size="13">Garmin · Suunto · Wahoo · COROS · Polar · Zwift</text>
  <text class="muted" x="896" y="244" text-anchor="end" font-size="13">LOCAL FIRST / OPEN SOURCE</text>
`, 'FitBrain: read everything your watch recorded.'));

const preview = svg(1200, 760, `
  <style>text{font-family:"Avenir Next","Segoe UI",system-ui,sans-serif}.label{font-size:12px;letter-spacing:1.4px;font-weight:500}</style>
  <rect width="1200" height="760" fill="#f4f4f1"/>
  <text class="label" x="48" y="46" fill="#65635e">FITBRAIN / VISUAL IDENTITY</text>
  <text x="1152" y="46" text-anchor="end" fill="#65635e" font-size="13">FB monogram</text>
  <rect x="32" y="74" width="556" height="292" rx="3" fill="${paper}"/>
  <rect x="612" y="74" width="556" height="292" rx="3" fill="${ink}"/>
  <text class="label" x="60" y="114" fill="#65635e">LIGHT</text>
  <text class="label" x="640" y="114" fill="#a6a49d">DARK</text>
  <g transform="translate(94 189)">${lockup(92)}</g>
  <g transform="translate(674 189)">${lockup(92, nightBlue, paper)}</g>
  <rect x="32" y="390" width="360" height="328" rx="3" fill="${paper}"/>
  <rect x="416" y="390" width="360" height="328" rx="3" fill="${paper}"/>
  <rect x="800" y="390" width="368" height="328" rx="3" fill="${paper}"/>
  <text class="label" x="60" y="430" fill="#65635e">APP ICON</text>
  <rect x="124" y="471" width="176" height="176" rx="36" fill="${ink}"/>
  <g transform="translate(145 492) scale(4.125)">${mark(nightBlue, paper)}</g>
  <text class="label" x="444" y="430" fill="#65635e">MONOCHROME</text>
  <g transform="translate(527 493) scale(4.3)">${mark(ink, ink)}</g>
  <text class="label" x="828" y="430" fill="#65635e">SMALL SIZES</text>
  ${[16, 24, 32, 48].map((size, i) => `<g transform="translate(${846 + i * 76} ${565 - size / 2}) scale(${size / 32})">${mark()}</g><text x="${846 + i * 76 + size / 2}" y="632" fill="#65635e" font-size="12" text-anchor="middle">${size} px</text>`).join('')}
`, 'FitBrain logo: light, dark, app icon and small sizes');
await save('preview.svg', preview);

const browser = await chromium.launch({ channel: process.env.FITBRAIN_BROWSER_CHANNEL || undefined });
try {
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  // Render PNG exports from the vector source; no bitmap editing or font downloads.
  for (const [file, width, height, source] of [
    ['../icon-512.png', 512, 512, icon],
    ['../apple-touch-icon.png', 180, 180, icon],
    ['preview.png', 1200, 760, preview],
  ] as const) {
    await page.setViewportSize({ width, height });
    await page.setContent(`<html><body style="margin:0"><img alt="FitBrain" width="${width}" height="${height}" src="data:image/svg+xml;base64,${Buffer.from(source).toString('base64')}" /></body></html>`);
    await page.locator('img').evaluate((img: HTMLImageElement) => img.decode());
    await page.screenshot({ path: fileURLToPath(new URL(file, dir)), omitBackground: true });
  }
} finally { await browser.close(); }
console.log('Generated logo variants, README header, favicon, app icons and preview.');
