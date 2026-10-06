import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { after, test } from 'node:test';
import { chromium, expect, type Page } from '@playwright/test';

const baseURL = process.env.VIEWER_URL ?? 'http://127.0.0.1:5173/';
const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL ?? 'msedge', headless: true });
const output = new URL('../test-results/', import.meta.url);
await mkdir(output, { recursive: true });
after(() => browser.close());
const shot = (name: string) => new URL(name, output).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const host = (page: Page) => page.locator('#canvas-host');
const position = async (page: Page) => (await host(page).getAttribute('data-position'))!.split(',').map(Number);
/** Spanish pages unless a test asks for another language (the first visit follows the browser language). */
const spanish = { locale: 'es-ES' } as const;

/** The options live in a menu that starts closed; open it before using them. */
async function openMenu(page: Page) {
  if (await page.locator('#room-tools').isHidden()) await page.locator('#menu-toggle').click();
  await expect(page.locator('#room-tools')).toBeVisible();
}

async function ready(page: Page) {
  await page.goto(baseURL);
  await expect(page.locator('.room-status')).toHaveAttribute('data-state', 'ready', { timeout: 30000 });
  await expect(page.locator('#viewer-overlay')).toBeHidden();
  await expect(host(page)).toHaveAttribute('data-movement', 'ready');
}

/** Steer with real keys towards a floor point; the fixed camera looks from azimuth 45°. */
async function walkTo(page: Page, target: { x: number; z: number }, until?: () => Promise<boolean>) {
  const forward = { x: -Math.SQRT1_2, z: -Math.SQRT1_2 };
  const right = { x: Math.SQRT1_2, z: -Math.SQRT1_2 };
  const held = new Set<string>();
  const hold = async (keys: string[]) => {
    for (const key of [...held]) if (!keys.includes(key)) { await page.keyboard.up(key); held.delete(key); }
    for (const key of keys) if (!held.has(key)) { await page.keyboard.down(key); held.add(key); }
  };
  for (let step = 0; step < 250; step++) {
    const [x, z] = await position(page);
    const dx = target.x - x;
    const dz = target.z - z;
    if (Math.hypot(dx, dz) < 0.15 || (until && await until())) break;
    const ahead = dx * forward.x + dz * forward.z;
    const side = dx * right.x + dz * right.z;
    const scale = Math.max(Math.abs(ahead), Math.abs(side));
    await hold([...(Math.abs(ahead) > scale * 0.4 ? [ahead > 0 ? 'KeyW' : 'KeyS'] : []), ...(Math.abs(side) > scale * 0.4 ? [side > 0 ? 'KeyD' : 'KeyA'] : [])]);
    await page.waitForTimeout(80);
  }
  await hold([]);
  await expect(host(page)).toHaveAttribute('data-locomotion', 'idle');
  await expect(host(page)).toHaveAttribute('data-run-clip', 'run_ual_sprint');
  await expect(host(page)).toHaveAttribute('data-walk-clip', 'walk_ual');
  await expect(host(page)).toHaveAttribute('data-jump-clip', 'jump_ual');
}

const drag = async (page: Page) => {
  const box = (await page.locator('canvas').boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 220, box.y + box.height / 2 + 40, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(700);
};

test('the root shows only the room with V4, neutral light, a fixed following camera and no external requests', async (t) => {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce', ...spanish });
  t.after(() => page.close());
  const errors: string[] = [];
  const external: string[] = [];
  const models: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.protocol.startsWith('http') && url.origin !== new URL(baseURL).origin) external.push(request.url());
    if (url.pathname.endsWith('.glb')) models.push(url.pathname.split('/').at(-1)!);
  });
  await ready(page);
  // The options start folded away behind the menu button; Escape folds them again.
  const menu = page.locator('#menu-toggle');
  await expect(page.locator('#room-tools')).toBeHidden();
  await expect(menu).toHaveAttribute('aria-expanded', 'false');
  await menu.click();
  await expect(page.locator('#room-tools')).toBeVisible();
  await expect(menu).toHaveAttribute('aria-expanded', 'true');
  await page.keyboard.press('Escape');
  await expect(page.locator('#room-tools')).toBeHidden();
  await openMenu(page);
  // The room page ignores the system setting: reduced motion starts off and its own switch turns it on (stored).
  const motion = page.getByRole('button', { name: 'Reducido' });
  await expect(motion).toHaveAttribute('aria-pressed', 'false');
  await expect(host(page)).toHaveAttribute('data-reduced-motion', 'false');
  await motion.click();
  await expect(motion).toHaveAttribute('aria-pressed', 'true');
  await expect(host(page)).toHaveAttribute('data-reduced-motion', 'true');
  await expect(page.locator('html')).toHaveAttribute('data-reduced-motion', 'true');
  assert.deepEqual(models.sort(), ['developer-v4-interactions.glb', 'laptop.glb', 'outside.glb', 'room.glb']);
  await expect(host(page)).toHaveAttribute('data-letters', '0');
  await expect(page.locator('.sidebar, .version-selector, #animation-controls')).toHaveCount(0);
  await expect(page.locator('canvas')).toHaveCount(1);
  await expect(host(page)).toHaveAttribute('data-scene', 'room');
  await expect(host(page)).toHaveAttribute('data-light', 'neutral');
  await expect(page.getByRole('button', { name: 'Neutra' })).toHaveAttribute('aria-pressed', 'true');
  await expect(host(page)).toHaveAttribute('data-camera', 'follow');
  await expect(page.locator('#camera-free')).toHaveAttribute('aria-pressed', 'false');
  const before = await host(page).getAttribute('data-orbit');
  const [azimuth, , zoom] = before!.split(',').map(Number);
  assert.ok(Math.abs(azimuth - Math.PI / 4) < 0.01, `isometric corner view: ${before}`);
  assert.ok(Math.abs(zoom - 0.9) < 1e-6, `widest zoom: ${before}`);
  await drag(page);
  await page.mouse.wheel(0, -600);
  await page.waitForTimeout(400);
  assert.equal(await host(page).getAttribute('data-orbit'), before, 'dragging and the wheel do not move the fixed camera');
  // A press on the scene folded the menu away.
  await expect(page.locator('#room-tools')).toBeHidden();
  await openMenu(page);
  await page.locator('#camera-free').click();
  await expect(host(page)).toHaveAttribute('data-camera', 'free');
  await expect(page.locator('#camera-free')).toHaveAttribute('aria-pressed', 'true');
  await drag(page);
  assert.notEqual(await host(page).getAttribute('data-orbit'), before, 'the free camera orbits');
  await openMenu(page);
  await page.locator('#camera-free').click();
  await expect(host(page)).toHaveAttribute('data-camera', 'follow');
  await expect(host(page)).toHaveAttribute('data-orbit', before!);
  await page.getByRole('button', { name: 'Violeta' }).click();
  await expect(host(page)).toHaveAttribute('data-light', 'violet');
  await page.getByRole('button', { name: 'Neutra' }).click();
  await page.getByRole('button', { name: 'Baja' }).click();
  await expect(host(page)).toHaveAttribute('data-quality', 'low');
  await expect(host(page)).toHaveAttribute('data-shadows', 'false');
  await page.getByRole('button', { name: 'Auto' }).click();
  await expect(host(page)).toHaveAttribute('data-quality', 'auto');
  await page.screenshot({ path: shot('home.png') });
  assert.deepEqual(external, []);
  assert.deepEqual(errors, []);
});

test('Space hops forward, F throws a laptop, the character knocks over the name letters and steps down to the outside ground', async (t) => {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, ...spanish });
  t.after(() => page.close());
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await ready(page);
  await expect(host(page)).toHaveAttribute('data-physics', 'ready', { timeout: 10000 });
  await expect(host(page)).toHaveAttribute('data-elevation', '0.00');
  await expect(host(page)).toHaveAttribute('data-thrown', '0');
  const start = await position(page);
  await page.keyboard.press('Space');
  await expect(host(page)).toHaveAttribute('data-locomotion', 'jump');
  await expect(host(page)).toHaveAttribute('data-locomotion', 'idle', { timeout: 3000 });
  const landed = await position(page);
  const hop = Math.hypot(landed[0] - start[0], landed[1] - start[1]);
  assert.ok(hop > 0.3 && hop < 0.7, `a short hop forward: ${hop}`);
  // F plays the throw where the character stands and a laptop leaves the hand; held movement keys wait until it ends.
  await page.keyboard.press('KeyF');
  await expect(host(page)).toHaveAttribute('data-locomotion', 'throw');
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(500);
  assert.deepEqual(await position(page), landed, 'no movement while throwing');
  await expect(host(page)).toHaveAttribute('data-thrown', '1');
  await expect(host(page)).toHaveAttribute('data-thrown-lid', /^-?\d+\.\d\d$/);
  await expect(host(page)).toHaveAttribute('data-locomotion', 'walk', { timeout: 3000 });
  await page.keyboard.up('KeyW');
  await expect(host(page)).toHaveAttribute('data-locomotion', 'idle', { timeout: 3000 });
  // Three at most: the fourth throw retires the oldest.
  for (let throws = 2; throws <= 4; throws++) {
    await page.keyboard.press('KeyF');
    await expect(host(page)).toHaveAttribute('data-locomotion', 'idle', { timeout: 4000 });
    await expect(host(page)).toHaveAttribute('data-thrown', String(Math.min(throws, 3)));
  }
  // Out of the open front and through the name (between R and A).
  await walkTo(page, { x: 0.5, z: 3.6 });
  await walkTo(page, { x: -3.7, z: 6.2 });
  await expect(host(page)).toHaveAttribute('data-elevation', '-0.12');
  await expect.poll(async () => Number(await host(page).getAttribute('data-letters')), { timeout: 5000 }).toBeGreaterThan(0);
  await page.waitForTimeout(800);
  await page.screenshot({ path: shot('home-letters.png') });
  await page.locator('#hud-reset').click();
  await expect(host(page)).toHaveAttribute('data-letters', '0');
  await expect(host(page)).toHaveAttribute('data-thrown', '0');
  await expect(host(page)).toHaveAttribute('data-elevation', '0.00');
  assert.deepEqual(errors, []);
});

test('near a seat a speech bubble shows the key to sit down; it leaves when the character sits', async (t) => {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, ...spanish });
  t.after(() => page.close());
  await ready(page);
  // The character starts by the room's front corner, out of reach of both seats; walking towards the bed offers it.
  await expect(host(page)).toHaveAttribute('data-bubble', 'hidden');
  await expect(host(page)).toHaveAttribute('data-position', '2.30,2.30');
  await walkTo(page, { x: 0.2, z: -0.6 }, async () => (await host(page).getAttribute('data-prompt')) === 'bed');
  await expect(host(page)).toHaveAttribute('data-prompt', 'bed');
  await expect(host(page)).toHaveAttribute('data-bubble', 'shown');
  const bubble = page.locator('.seat-bubble-body');
  await expect(bubble).toBeVisible();
  await expect(bubble).toContainText('Sentarse');
  const box = (await bubble.boundingBox())!;
  const canvas = (await page.locator('canvas').boundingBox())!;
  assert.ok(box.y > canvas.y && box.y + box.height < canvas.y + canvas.height / 2 + 120, 'over the character');
  await page.screenshot({ path: shot('home-bubble.png') });
  await page.keyboard.press('KeyE');
  await expect(host(page)).toHaveAttribute('data-bubble', 'hidden');
  await expect(bubble).toBeHidden();
  await expect(host(page)).toHaveAttribute('data-interaction', 'seated', { timeout: 8000 });
});

test('the language switch turns the page and the floor texts to English or Spanish and remembers the choice', async (t) => {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: 'en-US' });
  t.after(() => page.close());
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await ready(page);
  // First visit: the browser language.
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.locator('#hud-hint')).toHaveText(/^E: sit on the bed$|W A S D or arrows/);
  await expect(page.getByRole('button', { name: 'EN', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#status-label')).toHaveText('Ready');
  await expect(page.locator('.seat-bubble')).toContainText('Sit down');
  await page.getByRole('button', { name: 'ES', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'es');
  await expect(page.locator('#status-label')).toHaveText('Listo');
  await expect(page.locator('#hud-reset')).toHaveText('Restablecer posición');
  await expect(page.locator('.seat-bubble')).toContainText('Sentarse');
  await openMenu(page);
  await expect(page.getByRole('button', { name: 'Neutra' })).toBeVisible();
  await page.reload();
  await expect(page.locator('.room-status')).toHaveAttribute('data-state', 'ready', { timeout: 30000 });
  await expect(page.locator('html')).toHaveAttribute('lang', 'es');
  await expect(page.getByRole('button', { name: 'ES', exact: true })).toHaveAttribute('aria-pressed', 'true');
  assert.deepEqual(errors, []);
});

test('each sign has a floor zone: walking in raises it, and Enter or a click opens the site in a new tab', async (t) => {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, ...spanish });
  t.after(() => page.close());
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await ready(page);
  await expect(page.locator('#sign-link')).toBeHidden();
  await expect(host(page)).toHaveAttribute('data-sign', 'none');
  await expect(host(page)).toHaveAttribute('data-sign-area', 'none');
  // Out through the open +X side, past the intro keys to the crossroads; the zones lie in front of the row of signs.
  await walkTo(page, { x: 3.6, z: 0.6 });
  await walkTo(page, { x: 7.0, z: 1.8 });
  // The intro's arrow keys are fixed on the floor: stepping on one sinks it, stepping off lets it spring back.
  await expect(host(page)).toHaveAttribute('data-keys', 'none');
  await walkTo(page, { x: 9.0, z: -0.96 }, async () => (await host(page).getAttribute('data-keys')) === 'down');
  await expect(host(page)).toHaveAttribute('data-keys', 'down');
  await page.screenshot({ path: shot('home-key.png') });
  await walkTo(page, { x: 9.0, z: 1.8 });
  await expect(host(page)).toHaveAttribute('data-keys', 'none');
  await walkTo(page, { x: 19.5, z: 1.2 });
  for (const [id, link, target, open] of [
    ['portfolio', 'https://andres-jaramillo.is-a.dev/', { x: 24.0, z: -1.5 }, 'click'],
    ['github', 'https://github.com/SrPio', { x: 27.2, z: -1.5 }, 'enter'],
    ['linkedin', 'https://www.linkedin.com/in/andres-fernando-jaramillo-avila/', { x: 30.4, z: -1.5 }, 'enter'],
  ] as const) {
    await walkTo(page, target, async () => (await host(page).getAttribute('data-sign')) === id);
    await expect(host(page)).toHaveAttribute('data-sign', id);
    const anchor = page.locator('#sign-link');
    await expect(anchor).toBeVisible();
    await expect(anchor).toHaveAttribute('href', link);
    await expect(anchor).toHaveAttribute('target', '_blank');
    await expect(anchor).toHaveAttribute('rel', /noopener/);
    await expect(host(page)).toHaveAttribute('data-sign-area', /^\d+,\d+$/);
    await page.waitForTimeout(600);
    await page.screenshot({ path: shot(`home-sign-${id}.png`) });
    // The new tab is intercepted so the test stays offline.
    await page.context().route(link, (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<title>stub</title>' }));
    const popup = page.waitForEvent('popup', { timeout: 5000 });
    if (open === 'enter') {
      await page.keyboard.press('Enter');
    } else {
      const [x, y] = (await host(page).getAttribute('data-sign-area'))!.split(',').map(Number);
      await page.mouse.click(x, y);
    }
    const tab = await popup;
    await tab.waitForURL(link);
    await tab.close();
  }
  await walkTo(page, { x: 28.0, z: 1.6 });
  await expect(host(page)).toHaveAttribute('data-sign', 'none');
  await expect(page.locator('#sign-link')).toBeHidden();
  await expect(host(page)).toHaveAttribute('data-sign-area', 'none');
  // Away from every zone Enter opens nothing.
  let opened = false;
  page.on('popup', () => { opened = true; });
  await page.keyboard.press('Enter');
  await page.waitForTimeout(500);
  assert.equal(opened, false);
  // The bowling reset zone: Enter puts the pins back, no link, no new tab.
  await walkTo(page, { x: 25.0, z: 19.6 }, async () => (await host(page).getAttribute('data-sign')) === 'reset-bowling');
  await expect(host(page)).toHaveAttribute('data-sign', 'reset-bowling');
  await expect(page.locator('#sign-link')).toBeHidden();
  await page.keyboard.press('Enter');
  await expect(host(page)).toHaveAttribute('data-pins', '0');
  await page.waitForTimeout(500);
  assert.equal(opened, false);
  await page.screenshot({ path: shot('home-playground.png') });
  assert.deepEqual(errors, []);
});

test('the root works on a phone-sized viewport without horizontal scrolling', async (t) => {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, ...spanish });
  t.after(() => page.close());
  await ready(page);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'no horizontal overflow');
  await expect(page.getByRole('button', { name: 'ES', exact: true })).toBeVisible();
  await openMenu(page);
  for (const name of ['Auto', 'Alta', 'Baja', 'Neutra', 'Violeta', 'Libre']) {
    const button = page.getByRole('button', { name, exact: true });
    await expect(button).toBeVisible();
    const box = (await button.boundingBox())!;
    assert.ok(box.x >= 0 && box.x + box.width <= 390, `${name} inside the screen`);
  }
  await page.screenshot({ path: shot('home-mobile.png') });
});
