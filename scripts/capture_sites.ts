/**
 * Screenshots of the portfolio and GitHub profile used as textures for the floor plates outside the
 * room. Run by hand (needs the network): `node scripts/capture_sites.ts`, then
 * `blender ... --python scripts/blender/create_outside.py -- --replace-generated`.
 */
import { mkdir } from 'node:fs/promises';
import { chromium } from '@playwright/test';

export const SITES = {
  portfolio: 'https://andres-jaramillo.is-a.dev/',
  github: 'https://github.com/SrPio',
} as const;

const output = new URL('../assets/textures/outside/', import.meta.url);
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL ?? 'msedge', headless: true });
try {
  for (const [name, url] of Object.entries(SITES)) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, colorScheme: 'dark', reducedMotion: 'reduce' });
    await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
    await page.waitForTimeout(2500);
    await page.screenshot({ path: new URL(`${name}.png`, output).pathname.replace(/^\/([A-Za-z]:)/, '$1') });
    console.log(`${name}: ${url}`);
    await page.close();
  }
} finally {
  await browser.close();
}
