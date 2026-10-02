import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { after, test } from 'node:test';
import { chromium, expect, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { Texture } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { readRoom } from '../src/scene/roomData.ts';

/** Load a public model in Node (textures skipped) to read room anchors for steering. */
async function loadModel(name: string) {
  const data = await readFile(new URL(`../public/models/${name}.glb`, import.meta.url));
  const loader = new GLTFLoader();
  // Named like the built-in WebP plugin so it replaces it: Node cannot decode images.
  loader.register(() => ({ name: 'EXT_texture_webp', loadTexture: () => Promise.resolve(new Texture()) }));
  return loader.parseAsync(data.buffer.slice(data.byteOffset, data.byteOffset + data.length), '');
}

const baseURL = process.env.VIEWER_URL ?? 'http://127.0.0.1:5173/';
/** The character studio lives at /study/; the root is the room page (tests/home.browser.ts). */
const studyURL = new URL('study/', baseURL).href;
const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL ?? 'msedge', headless: true });
const output = new URL('../test-results/', import.meta.url);
await mkdir(output, { recursive: true });
after(() => browser.close());

const versions = {
  v1: { label: 'V1 Original', file: 'developer.glb', status: 'V1 original conservada', revision: 'V1 / ORIGINAL', stage: 'V1 CONSERVADA', copy: 'V1 original conservada sin cambios' },
  v2: { label: 'V2 Model sheet', file: 'developer-v2.glb', status: 'V2 estudio anterior inacabado', revision: 'V2 / ESTUDIO ANTERIOR', stage: 'V2 CONSERVADA', copy: 'Estudio anterior inacabado' },
  v1rig: { label: 'V1 Animada', file: 'developer-v1-rig.glb', status: 'V1 Animada · Fase 2A', revision: 'V1 / FASE 2A', stage: 'FASE 2A', copy: 'Rig y ciclos en el sitio' },
  v4: { label: 'V4 Pulida', file: 'developer-v4.glb', status: 'V4 pulida · fiel a la referencia', revision: 'V4 / REFERENCIA', stage: 'V4 PULIDA', copy: 'Modelo independiente fiel a las fotos de referencia' },
  v4rig: { label: 'V4 Animada', file: 'developer-v4-interactions.glb', status: 'V4 Animada · rig, ciclos y asientos', revision: 'V4 / RIG + ASIENTOS', stage: 'V4 RIG', copy: 'sentarse, portátil y escribir' },
} as const;

async function expectModel(page: Page, version: keyof typeof versions) {
  await expect(page.locator('.status')).toHaveAttribute('data-state', 'ready', { timeout: 30000 });
  await expect(page.locator('#canvas-host')).toHaveAttribute('data-model', version);
  await expect(page.locator('.version-selector button')).toHaveCount(5);
  if (!version.endsWith('rig')) await expect(page.locator('#animation-controls')).toBeHidden();
  await expect(page.locator('.version-selector [aria-pressed="true"]')).toHaveCount(1);
  await expect(page.getByRole('button', { name: versions[version].label, exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#status-label')).toHaveText(versions[version].status);
  await expect(page.locator('.revision-label')).toHaveText(versions[version].revision);
  await expect(page.locator('.stage-tag')).toHaveText(versions[version].stage);
  await expect(page.locator('#version-copy')).toContainText(versions[version].copy);
  await expect(page.locator('#canvas-host')).toHaveAttribute('aria-busy', 'false');
  await expect(page.locator('#viewer-overlay')).toBeHidden();
  await expect(page.locator('canvas')).toHaveCount(1);
  await expect(page.locator('#canvas-host canvas')).toBeVisible();
}

async function expectVersionSelectorFits(page: Page) {
  for (const button of await page.locator('.version-selector button').all()) {
    await expect(button).toBeEnabled();
    assert.ok(await button.evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      const parent = element.closest('.version-selector')!.getBoundingClientRect();
      return bounds.width > 0 && bounds.height >= 44 && bounds.left >= parent.left && bounds.right <= parent.right
        && element.scrollWidth <= element.clientWidth && element.scrollHeight <= element.clientHeight;
    }));
  }
}

async function ready(page: Page) {
  const response = page.waitForResponse('**/models/developer.glb');
  await page.goto(studyURL);
  assert.equal((await response).status(), 200);
  await expectModel(page, 'v1');
  await expectVersionSelectorFits(page);
}

async function frame(page: Page) {
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  return page.locator('#canvas-host canvas').screenshot();
}

test('desktop loads locally and camera, light, wireframe, orbit and zoom affect the rendered image', async () => {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  const errors: string[] = [];
  const external: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('request', (request) => {
    if (new URL(request.url()).origin !== new URL(baseURL).origin && request.url().startsWith('http')) external.push(request.url());
  });
  await ready(page);
  await expect(page.locator('#model-stats')).toContainText(/\d+ mallas/);
  await page.screenshot({ path: new URL('desktop-neutral.png', output).pathname.replace(/^\/([A-Za-z]:)/, '$1'), fullPage: true });
  const initial = await frame(page);
  for (const view of ['front', 'back', 'left', 'right', 'three-quarter']) {
    const button = page.locator(`[data-view="${view}"]`);
    await button.click();
    await expect(button).toHaveAttribute('aria-pressed', 'true');
    assert.ok((await frame(page)).length > 10000);
  }
  await page.locator('[data-view="front"]').click();
  const front = await frame(page);
  assert.ok(!initial.equals(front));
  await page.locator('[data-view="back"]').click();
  assert.ok(!front.equals(await frame(page)));
  await page.locator('[data-view="three-quarter"]').click();
  const neutral = await frame(page);
  await page.locator('button[data-light="violet"]').click();
  await expect(page.locator('#canvas-host')).toHaveAttribute('data-light', 'violet');
  const violet = await frame(page);
  assert.ok(!neutral.equals(violet));
  await page.screenshot({ path: new URL('desktop-violet.png', output).pathname.replace(/^\/([A-Za-z]:)/, '$1'), fullPage: true });
  await page.locator('#wireframe').check();
  assert.ok(!violet.equals(await frame(page)));
  await page.locator('#wireframe').uncheck();
  await page.locator('#zoom-in').click();
  assert.ok(!violet.equals(await frame(page)));
  await page.locator('#zoom-out').click();
  const canvas = await page.locator('canvas').boundingBox();
  assert.ok(canvas);
  await page.mouse.move(canvas.x + canvas.width * 0.5, canvas.y + canvas.height * 0.5);
  await page.mouse.down();
  await page.mouse.move(canvas.x + canvas.width * 0.6, canvas.y + canvas.height * 0.5, { steps: 8 });
  await page.mouse.up();
  await expect(page.locator('#view-label')).toHaveText('Vista libre');
  assert.ok(!violet.equals(await frame(page)));
  assert.deepEqual(errors, []);
  assert.deepEqual(external, []);
  await page.close();
});

test('narrow viewport keeps the canvas and controls usable without horizontal overflow', async () => {
  const page = await browser.newPage({ viewport: { width: 375, height: 812 }, isMobile: true, deviceScaleFactor: 1 });
  await ready(page);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  await page.locator('[data-view="front"]').click();
  await expect(page.locator('[data-view="front"]')).toHaveAttribute('aria-pressed', 'true');
  for (const version of ['v2', 'v4', 'v1'] as const) {
    await page.getByRole('button', { name: versions[version].label, exact: true }).click();
    await expectModel(page, version);
    await expect(page.locator('[data-view="front"]')).toHaveAttribute('aria-pressed', 'true');
    await expectVersionSelectorFits(page);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  }
  await page.setViewportSize({ width: 414, height: 896 });
  await expectVersionSelectorFits(page);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  await page.setViewportSize({ width: 375, height: 812 });
  await page.screenshot({ path: new URL('mobile.png', output).pathname.replace(/^\/([A-Za-z]:)/, '$1'), fullPage: true });
  await page.close();
});

test('missing V1 GLB shows an error and retry recovers without duplicate canvases', async (t) => {
  const page = await browser.newPage();
  t.after(() => page.close());
  const pattern = '**/models/developer.glb';
  await page.route(pattern, (route) => route.fulfill({ status: 404, body: '' }));
  await page.goto(studyURL);
  await expect(page.locator('.status')).toHaveAttribute('data-state', 'error', { timeout: 15000 });
  await expect(page.locator('#overlay-title')).toHaveText('No se pudo cargar V1 Original');
  await expect(page.locator('#overlay-detail')).toContainText('Falta el archivo models/developer.glb');
  await expect(page.locator('[data-view="front"]')).toBeDisabled();
  await expect(page.locator('button[data-light="violet"]')).toBeDisabled();
  await expectVersionSelectorFits(page);
  await page.unroute(pattern);
  const response = page.waitForResponse(pattern);
  await page.locator('#retry').click();
  assert.equal((await response).status(), 200);
  await expectModel(page, 'v1');
});

test('a corrupt V1 GLB is reported instead of displaying a placeholder', async (t) => {
  const page = await browser.newPage();
  t.after(() => page.close());
  const requests: string[] = [];
  page.on('request', (request) => {
    if (request.url().endsWith('.glb')) requests.push(request.url().split('/').at(-1)!);
  });
  await page.route('**/models/developer.glb', (route) => route.fulfill({ status: 200, body: 'not a binary model' }));
  await page.goto(studyURL);
  await expect(page.locator('.status')).toHaveAttribute('data-state', 'error', { timeout: 15000 });
  await expect(page.locator('#overlay-detail')).toContainText('models/developer.glb no está disponible o no es un GLB válido');
  await expect(page.locator('#canvas-host')).toHaveAttribute('data-model', 'v1');
  await expect(page.locator('canvas')).toHaveCount(0);
  assert.deepEqual(requests, ['developer.glb']);
});

test('V1 to V2 to V1 requests the selected files and preserves comparison controls', async (t) => {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  t.after(() => page.close());
  const requests: string[] = [];
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (request) => {
    const path = new URL(request.url()).pathname;
    if (path.endsWith('.glb')) requests.push(path);
  });
  await ready(page);
  await page.locator('[data-view="front"]').click();
  await page.locator('button[data-light="violet"]').click();
  await page.locator('#wireframe').check();
  const original = await frame(page);
  let previous = original;
  for (const version of ['v2', 'v1'] as const) {
    const response = page.waitForResponse(`**/models/${versions[version].file}`);
    await page.getByRole('button', { name: versions[version].label, exact: true }).click();
    assert.equal((await response).status(), 200);
    await expectModel(page, version);
    await expectVersionSelectorFits(page);
    await expect(page.locator('[data-view="front"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#view-label')).toHaveText('Vista frontal');
    await expect(page.locator('button[data-light="violet"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#canvas-host')).toHaveAttribute('data-light', 'violet');
    await expect(page.locator('#wireframe')).toBeChecked();
    await expect(page.locator('#canvas-host')).toHaveAttribute('data-wireframe', 'true');
    const image = await frame(page);
    assert.ok(!previous.equals(image), 'Each version must render different geometry');
    if (version === 'v1') assert.ok(original.equals(image), 'Returning to V1 must restore the same comparison view');
    previous = image;
    await page.locator('#wireframe').uncheck();
    assert.ok(!image.equals(await frame(page)), 'Wireframe must be applied to the loaded model');
    await page.locator('#wireframe').check();
  }
  const canvas = await page.locator('canvas').elementHandle();
  assert.ok(canvas);
  await page.getByRole('button', { name: 'V1 Original', exact: true }).click();
  await expectModel(page, 'v1');
  assert.ok(await canvas.evaluate((element) => element.isConnected), 'Reselecting V1 must not remount the viewer');
  assert.deepEqual(requests.map((path) => path.split('/').at(-1)), ['developer.glb', 'developer-v2.glb', 'developer.glb']);
  assert.deepEqual(errors, []);
});

for (const version of ['v2', 'v1rig', 'v4', 'v4rig'] as const) {
  const { label, file } = versions[version];

  test(`failed ${version.toUpperCase()} never silently falls back and V1 remains selectable`, async (t) => {
    const page = await browser.newPage();
    t.after(() => page.close());
    const requests: string[] = [];
    page.on('request', (request) => {
      if (request.url().endsWith('.glb')) requests.push(request.url().split('/').at(-1)!);
    });
    await page.route(`**/models/${file}`, (route) => route.fulfill({ status: 404, body: '' }));
    await ready(page);
    await page.getByRole('button', { name: label, exact: true }).click();
    const expectedRequests = ['developer.glb', file];
    await expect(page.locator('#animation-controls')).toBeHidden();
    await expect(page.locator('.status')).toHaveAttribute('data-state', 'error', { timeout: 15000 });
    await expect(page.locator('#overlay-title')).toHaveText(`No se pudo cargar ${label}`);
    await expect(page.locator('#overlay-detail')).toContainText(`Falta el archivo models/${file}`);
    await expect(page.locator('#canvas-host')).toHaveAttribute('data-model', version);
    await expect(page.getByRole('button', { name: label, exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('canvas')).toHaveCount(0);
    assert.deepEqual(requests, expectedRequests);
    const original = page.getByRole('button', { name: 'V1 Original', exact: true });
    await expect(original).toBeEnabled();
    await original.focus();
    await page.keyboard.press('Enter');
    await expectModel(page, 'v1');
    assert.deepEqual(requests, [...expectedRequests, 'developer.glb']);
    await page.getByRole('button', { name: label, exact: true }).click();
    await expect(page.locator('.status')).toHaveAttribute('data-state', 'error', { timeout: 15000 });
    await expect(page.locator('#overlay-title')).toHaveText(`No se pudo cargar ${label}`);
    await expect(page.locator('#overlay-detail')).toContainText(`Falta el archivo models/${file}`);
    await expect(page.locator('canvas')).toHaveCount(0);
    await original.click();
    await expectModel(page, 'v1');
    assert.deepEqual(requests, [...expectedRequests, 'developer.glb', file, 'developer.glb']);
  });

  test(`a delayed ${version.toUpperCase()} load is aborted when V1 is selected and cannot revert the viewer`, async (t) => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
    const release = Promise.withResolvers<void>();
    const finished = Promise.withResolvers<void>();
    t.after(async () => { release.resolve(); await page.close(); });
    let held = false;
    let aborted = false;
    const errors: string[] = [];
    const requests: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('request', (request) => {
      if (request.url().endsWith('.glb')) requests.push(request.url().split('/').at(-1)!);
    });
    page.on('requestfailed', (request) => {
      if (request.url().endsWith(`/models/${file}`)) aborted = true;
    });
    await page.route(`**/models/${file}`, async (route) => {
      const response = await route.fetch();
      assert.equal(response.status(), 200);
      held = true;
      await release.promise;
      try {
        await route.fulfill({ response });
      } catch (error) {
        if (!aborted) throw error;
      } finally {
        finished.resolve();
      }
    });
    await ready(page);
    await page.getByRole('button', { name: label, exact: true }).click();
    await expect.poll(() => held, { timeout: 15000 }).toBe(true);
    await expect(page.locator('.status')).toHaveAttribute('data-state', 'loading');
    await expect(page.locator('#canvas-host')).toHaveAttribute('aria-busy', 'true');
    await expect(page.locator('#animation-controls')).toBeHidden();
    await expect(page.locator('[data-view="front"]')).toBeDisabled();
    await expect(page.locator('canvas')).toHaveCount(1);
    await expectVersionSelectorFits(page);
    const originalResponse = page.waitForResponse('**/models/developer.glb');
    await page.getByRole('button', { name: 'V1 Original', exact: true }).click();
    assert.equal((await originalResponse).status(), 200);
    await expectModel(page, 'v1');
    await expect.poll(() => aborted).toBe(true);
    const original = await frame(page);
    const stats = await page.locator('#model-stats').textContent();
    release.resolve();
    await finished.promise;
    await page.waitForTimeout(500);
    await expectModel(page, 'v1');
    await expect(page.locator('#model-stats')).toHaveText(stats!);
    assert.ok(original.equals(await frame(page)), `The stale ${version.toUpperCase()} response must not change the V1 render`);
    assert.deepEqual(requests, ['developer.glb', file, 'developer.glb']);
    assert.deepEqual(errors, []);
  });
}

async function animated(page: Page) {
  const response = page.waitForResponse('**/models/developer-v1-rig.glb');
  await page.getByRole('button', { name: 'V1 Animada', exact: true }).click();
  assert.equal((await response).status(), 200);
  await expectModel(page, 'v1rig');
  await expect(page.locator('#animation-controls')).toBeVisible();
  await expect(page.getByLabel('Clip', { exact: true })).toBeEnabled();
  await expect(page.getByLabel('Clip', { exact: true })).toHaveValue('idle');
  for (const [name, label] of [['idle', 'Reposo'], ['walk', 'Caminar'], ['run', 'Correr']]) {
    await expect(page.locator(`#animation-clip option[value="${name}"]`)).toHaveText(`${label} (${name})`);
  }
}

async function scrub(page: Page, progress: number) {
  await page.getByLabel('Posición de la animación', { exact: true }).evaluate((element: HTMLInputElement, value) => {
    element.value = String(value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
  }, progress);
  await expect(page.locator('#animation-controls')).toHaveAttribute('data-playing', 'false');
  await expect(page.locator('#animation-timeline')).toHaveValue(String(progress));
}

test('Habitación places the selected character in the isometric diorama and Estudio restores the pedestal', async (t) => {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  t.after(() => page.close());
  const errors: string[] = [];
  const requests: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (request) => {
    if (request.url().endsWith('.glb')) requests.push(request.url().split('/').at(-1)!);
  });
  await ready(page);
  const studio = await frame(page);
  const room = page.waitForResponse('**/models/room.glb');
  await page.getByRole('button', { name: 'Habitación', exact: true }).click();
  assert.equal((await room).status(), 200);
  await expectModel(page, 'v1');
  await expect(page.locator('#canvas-host')).toHaveAttribute('data-scene', 'room');
  await expect(page.getByRole('button', { name: 'Habitación', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#scene-copy')).toContainText('Diorama isométrico');
  await expect(page.locator('.orbit-label')).toHaveText('ÓRBITA LIMITADA');
  await expect(page.locator('[data-view="back"]')).toBeDisabled();
  await expect(page.locator('[data-view="right"]')).toBeDisabled();
  await expect(page.locator('[data-view="front"]')).toBeEnabled();
  await expect(page.locator('#model-stats')).toContainText('mallas');
  const meshes = Number((await page.locator('#model-stats').textContent())!.split(' ')[0].replace(/\./g, ''));
  assert.ok(meshes > 20 && meshes < 100, `Room merged by material for fewer draw calls: ${meshes} meshes`);
  const ratio = Number(await page.locator('#canvas-host').getAttribute('data-pixel-ratio'));
  assert.ok(ratio >= 1 && ratio <= 1.5, `Pixel ratio capped for fill rate: ${ratio}`);
  const diorama = await frame(page);
  assert.ok(!studio.equals(diorama), 'The diorama must render differently from the studio');
  await page.locator('[data-view="front"]').click();
  assert.ok(!diorama.equals(await frame(page)), 'Diorama presets still move the camera');
  await page.getByRole('button', { name: 'V4 Animada', exact: true }).click();
  await expectModel(page, 'v4rig');
  await expect(page.locator('#canvas-host')).toHaveAttribute('data-scene', 'room');
  await expect(page.locator('#animation-controls')).toBeVisible();
  await page.screenshot({ path: new URL('room-v4.png', output).pathname.replace(/^\/([A-Za-z]:)/, '$1'), fullPage: true });
  await page.getByRole('button', { name: 'Estudio', exact: true }).click();
  await expectModel(page, 'v4rig');
  await expect(page.locator('#canvas-host')).toHaveAttribute('data-scene', 'studio');
  await expect(page.locator('.orbit-label')).toHaveText('ÓRBITA 360°');
  await expect(page.locator('[data-view="back"]')).toBeEnabled();
  assert.deepEqual(requests, ['developer.glb', 'developer.glb', 'room.glb', 'laptop.glb', 'outside.glb', 'developer-v4-interactions.glb', 'room.glb', 'laptop.glb', 'outside.glb', 'developer-v4-interactions.glb']);
  assert.deepEqual(errors, []);
});

test('in the room, chair and bed clips move V4 to their seat and locomotion returns to the spawn', async (t) => {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  t.after(() => page.close());
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await ready(page);
  await page.getByRole('button', { name: 'Habitación', exact: true }).click();
  await expectModel(page, 'v1');
  await page.getByRole('button', { name: 'V4 Animada', exact: true }).click();
  await expectModel(page, 'v4rig');
  const clip = page.getByLabel('Clip', { exact: true });
  await expect(page.locator('#animation-clip option')).toHaveCount(12);
  await expect(page.locator('#animation-clip option').nth(3)).toHaveText('Saltar (jump)');
  await expect(page.locator('#animation-clip option').nth(4)).toHaveText('Sentarse · silla (sit_down_chair)');
  await expect(page.locator('#canvas-host')).toHaveAttribute('data-seat', 'spawn');
  const frames: Record<string, Buffer> = {};
  for (const [name, seat] of [['typing_chair', 'chair'], ['typing_bed', 'bed'], ['walk', 'spawn']] as const) {
    await clip.selectOption(name);
    await expect(page.locator('#canvas-host')).toHaveAttribute('data-seat', seat);
    await scrub(page, 400);
    frames[name] = await frame(page);
  }
  assert.ok(!frames.typing_chair.equals(frames.typing_bed) && !frames.typing_bed.equals(frames.walk));
  await clip.selectOption('typing_chair');
  await scrub(page, 400);
  assert.ok(frames.typing_chair.equals(await frame(page)), 'Returning to the chair reproduces the same seated pose and placement');
  await page.screenshot({ path: new URL('room-typing.png', output).pathname.replace(/^\/([A-Za-z]:)/, '$1'), fullPage: true });
  assert.deepEqual(errors, []);
});

async function roomWithV4(page: Page) {
  await ready(page);
  await page.getByRole('button', { name: 'Habitación', exact: true }).click();
  await expectModel(page, 'v1');
  await page.getByRole('button', { name: 'V4 Animada', exact: true }).click();
  await expectModel(page, 'v4rig');
  await expect(page.locator('#room-hud')).toHaveAttribute('data-state', 'ready');
  await page.locator('#hud-help').focus();
  await page.locator('#hud-help').blur();
}

const position = async (page: Page) => (await page.locator('#canvas-host').getAttribute('data-position'))!.split(',').map(Number);

test('in the room WASD walks, Shift runs, releasing stops and Restablecer returns to the spawn', async (t) => {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  t.after(() => page.close());
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await roomWithV4(page);
  await expect(page.locator('#hud-hint')).toHaveText('E: sentarse en la cama', { timeout: 5000 });
  const spawn = await position(page);
  await page.keyboard.down('KeyW');
  await expect(page.locator('#canvas-host')).toHaveAttribute('data-locomotion', 'walk');
  await expect(page.locator('#animation-clip')).toHaveValue('walk');
  await page.waitForTimeout(500);
  const walked = await position(page);
  assert.ok(Math.hypot(walked[0] - spawn[0], walked[1] - spawn[1]) > 0.1, `W moves the character: ${walked} from ${spawn}`);
  await page.keyboard.down('Shift');
  await expect(page.locator('#canvas-host')).toHaveAttribute('data-locomotion', 'run');
  await expect(page.locator('#animation-clip')).toHaveValue('run');
  await page.keyboard.up('Shift');
  await page.keyboard.up('KeyW');
  await expect(page.locator('#canvas-host')).toHaveAttribute('data-locomotion', 'idle');
  await expect(page.locator('#animation-clip')).toHaveValue('idle');
  const rested = await position(page);
  await page.waitForTimeout(300);
  assert.deepEqual(await position(page), rested, 'idle stays put');
  await page.keyboard.down('ArrowLeft');
  await page.waitForTimeout(400);
  await page.keyboard.up('ArrowLeft');
  assert.notDeepEqual(await position(page), rested, 'arrow keys move too');
  await walkTo(page, { x: 2.2, z: 2.2 });
  await expect(page.locator('#hud-hint')).toHaveText('W A S D o flechas para caminar · Shift para correr · Espacio para saltar');
  await expect(page.locator('#canvas-host')).toHaveAttribute('data-prompt', 'none');
  await page.getByRole('button', { name: 'Restablecer posición', exact: true }).click();
  assert.deepEqual(await position(page), spawn);
  await expect(page.locator('#canvas-host')).toHaveAttribute('data-locomotion', 'idle');
  await page.getByRole('button', { name: 'Ayuda', exact: true }).click();
  await expect(page.locator('#hud-help-text')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Ayuda', exact: true })).toHaveAttribute('aria-expanded', 'true');
  await page.screenshot({ path: new URL('room-hud.png', output).pathname.replace(/^\/([A-Za-z]:)/, '$1'), fullPage: true });
  assert.deepEqual(errors, []);
});

test('movement keys are ignored inside controls and released when the window loses focus', async (t) => {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  t.after(() => page.close());
  await roomWithV4(page);
  const start = await position(page);
  await page.getByLabel('Velocidad de animación', { exact: true }).focus();
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(400);
  await page.keyboard.up('KeyW');
  assert.deepEqual(await position(page), start, 'keys typed into a select do not walk');
  await page.locator('#hud-help').focus();
  await page.keyboard.down('KeyD');
  await expect(page.locator('#canvas-host')).toHaveAttribute('data-locomotion', 'walk');
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await expect(page.locator('#canvas-host')).toHaveAttribute('data-locomotion', 'idle');
  await page.keyboard.up('KeyD');
});

test('the HUD explains when movement is unavailable: seated, static versions and the studio', async (t) => {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  t.after(() => page.close());
  await roomWithV4(page);
  await page.getByLabel('Clip', { exact: true }).selectOption('typing_chair');
  await expect(page.locator('#room-hud')).toHaveAttribute('data-state', 'seated');
  await expect(page.locator('#hud-hint')).toContainText('Está sentado');
  await expect(page.getByRole('button', { name: 'Restablecer posición', exact: true })).toBeDisabled();
  await page.locator('#hud-help').focus();
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(300);
  await page.keyboard.up('KeyW');
  await expect(page.locator('#canvas-host')).toHaveAttribute('data-seat', 'chair');
  await expect(page.locator('#animation-clip')).toHaveValue('typing_chair');
  await page.getByLabel('Clip', { exact: true }).selectOption('idle');
  await expect(page.locator('#room-hud')).toHaveAttribute('data-state', 'ready');
  await page.getByRole('button', { name: 'V4 Pulida', exact: true }).click();
  await expectModel(page, 'v4');
  await expect(page.locator('#room-hud')).toHaveAttribute('data-state', 'unavailable');
  await expect(page.locator('#hud-hint')).toContainText('Elige V1 Animada o V4 Animada');
  await page.getByRole('button', { name: 'Estudio', exact: true }).click();
  await expectModel(page, 'v4');
  await expect(page.locator('#room-hud')).toBeHidden();
});

/** Steer with real keys towards a floor point (the default diorama camera looks from azimuth 45°). */
async function walkTo(page: Page, target: { x: number; z: number }, until?: () => Promise<boolean>) {
  const forward = { x: -Math.SQRT1_2, z: -Math.SQRT1_2 };
  const right = { x: Math.SQRT1_2, z: -Math.SQRT1_2 };
  const held = new Set<string>();
  const hold = async (keys: string[]) => {
    for (const key of [...held]) if (!keys.includes(key)) { await page.keyboard.up(key); held.delete(key); }
    for (const key of keys) if (!held.has(key)) { await page.keyboard.down(key); held.add(key); }
  };
  for (let step = 0; step < 150; step++) {
    const [x, z] = await position(page);
    const dx = target.x - x;
    const dz = target.z - z;
    if (Math.hypot(dx, dz) < 0.12 || (until && await until())) break;
    const ahead = dx * forward.x + dz * forward.z;
    const side = dx * right.x + dz * right.z;
    const scale = Math.max(Math.abs(ahead), Math.abs(side));
    await hold([...(Math.abs(ahead) > scale * 0.4 ? [ahead > 0 ? 'KeyW' : 'KeyS'] : []), ...(Math.abs(side) > scale * 0.4 ? [side > 0 ? 'KeyD' : 'KeyA'] : [])]);
    await page.waitForTimeout(80);
  }
  await hold([]);
  await expect(page.locator('#canvas-host')).toHaveAttribute('data-locomotion', 'idle');
}

const interaction = (page: Page) => page.locator('#canvas-host');
const press = async (page: Page, key: 'KeyE' | 'KeyL') => { await page.keyboard.press(key); };

test('E sits on the bed from the spawn, L makes a laptop appear on the lap, E closes it and stands back up', async (t) => {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  t.after(() => page.close());
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await roomWithV4(page);
  await expect(interaction(page)).toHaveAttribute('data-prompt', 'bed');
  await expect(page.locator('#hud-hint')).toHaveText('E: sentarse en la cama');
  await expect(interaction(page)).toHaveAttribute('data-laptop', 'none');
  await press(page, 'KeyE');
  await expect(interaction(page)).toHaveAttribute('data-interaction', /approaching|aligning/);
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(300);
  await page.keyboard.up('KeyW');
  await expect(interaction(page)).toHaveAttribute('data-interaction', 'seated', { timeout: 15000 });
  await expect(page.locator('#animation-clip')).toHaveValue('seated_bed');
  await expect(interaction(page)).toHaveAttribute('data-seat', 'bed');
  await expect(page.locator('#hud-hint')).toContainText('Sentado en la cama');
  await page.screenshot({ path: new URL('room-bed-seated.png', output).pathname.replace(/^\/([A-Za-z]:)/, '$1'), fullPage: true });
  await press(page, 'KeyL');
  await expect(interaction(page)).toHaveAttribute('data-laptop', 'lap');
  await expect(interaction(page)).toHaveAttribute('data-interaction', 'typing', { timeout: 3000 });
  await expect(interaction(page)).toHaveAttribute('data-lid', 'open');
  await expect(page.locator('#animation-clip')).toHaveValue('typing_bed');
  await page.screenshot({ path: new URL('room-bed-typing.png', output).pathname.replace(/^\/([A-Za-z]:)/, '$1'), fullPage: true });
  await press(page, 'KeyE');
  await expect(interaction(page)).toHaveAttribute('data-interaction', /closing|standing/);
  await expect(interaction(page)).toHaveAttribute('data-interaction', 'standing', { timeout: 3000 });
  await expect(interaction(page)).toHaveAttribute('data-laptop', 'none');
  await expect(interaction(page)).toHaveAttribute('data-interaction', 'free', { timeout: 15000 });
  await expect(interaction(page)).toHaveAttribute('data-locomotion', 'idle');
  await expect(page.locator('#animation-clip')).toHaveValue('idle');
  assert.deepEqual(errors, []);
});

test('the chair is reachable from both sides and its desk laptop just opens and closes', async (t) => {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  t.after(() => page.close());
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await roomWithV4(page);
  const room = readRoom((await loadModel('room')).scene);
  const chair = room.seats.find((seat) => seat.seat === 'chair')!;
  const [left, right] = [...chair.approaches].sort((a, b) => a.z - b.z);
  // Left side: around the desk along the bed side, then up to the end of the desk where the chair's corridor starts.
  await walkTo(page, { x: -0.3, z: -1.25 });
  await walkTo(page, { x: left.x + 0.3, z: left.z - 0.3 }, async () => (await interaction(page).getAttribute('data-prompt')) === 'chair');
  await expect(interaction(page)).toHaveAttribute('data-prompt', 'chair');
  await press(page, 'KeyE');
  await expect(interaction(page)).toHaveAttribute('data-interaction', 'seated', { timeout: 15000 });
  await expect(interaction(page)).toHaveAttribute('data-seat', 'chair');
  await press(page, 'KeyL');
  await expect(interaction(page)).toHaveAttribute('data-laptop', 'desk');
  await expect(interaction(page)).toHaveAttribute('data-interaction', 'typing', { timeout: 3000 });
  await expect(page.locator('#animation-clip')).toHaveValue('typing_chair');
  await expect(interaction(page)).toHaveAttribute('data-lid', 'open');
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(300);
  await page.keyboard.up('KeyW');
  await expect(interaction(page)).toHaveAttribute('data-interaction', 'typing');
  await page.screenshot({ path: new URL('room-desk-typing.png', output).pathname.replace(/^\/([A-Za-z]:)/, '$1'), fullPage: true });
  await press(page, 'KeyL');
  await expect(interaction(page)).toHaveAttribute('data-interaction', 'seated', { timeout: 3000 });
  await expect(interaction(page)).toHaveAttribute('data-laptop', 'none');
  await expect(interaction(page)).toHaveAttribute('data-lid', 'closed');
  await press(page, 'KeyE');
  await expect(interaction(page)).toHaveAttribute('data-interaction', 'free', { timeout: 15000 });
  // Right side: back between the desk and the bed, past the open end of the desk, and in from the front of the room.
  await walkTo(page, { x: -0.3, z: -1.25 });
  await walkTo(page, { x: -0.3, z: 2.3 });
  await walkTo(page, { x: right.x + 0.4, z: right.z + 0.4 }, async () => (await interaction(page).getAttribute('data-prompt')) === 'chair');
  await expect(interaction(page)).toHaveAttribute('data-prompt', 'chair');
  await press(page, 'KeyE');
  await expect(interaction(page)).toHaveAttribute('data-interaction', 'seated', { timeout: 15000 });
  await expect(interaction(page)).toHaveAttribute('data-seat', 'chair');
  await press(page, 'KeyE');
  await expect(interaction(page)).toHaveAttribute('data-interaction', 'free', { timeout: 15000 });
  const [x, z] = await position(page);
  assert.ok(Math.hypot(x - right.x, z - right.z) < 0.05, `left by the right side: ${x},${z}`);
  assert.deepEqual(errors, []);
});

test('picking a clip by hand or resetting abandons the seat without stranding the laptop on a lap', async (t) => {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  t.after(() => page.close());
  await roomWithV4(page);
  await press(page, 'KeyE');
  await expect(interaction(page)).toHaveAttribute('data-interaction', 'seated', { timeout: 15000 });
  await page.getByLabel('Clip', { exact: true }).selectOption('walk');
  await expect(interaction(page)).toHaveAttribute('data-interaction', 'free');
  await expect(interaction(page)).toHaveAttribute('data-laptop', 'none');
  await press(page, 'KeyE');
  await expect(interaction(page)).toHaveAttribute('data-interaction', /approaching|aligning|seated|sitting/);
  await page.getByRole('button', { name: 'Restablecer posición', exact: true }).click();
  await expect(interaction(page)).toHaveAttribute('data-interaction', 'free');
  await expect(page.locator('#animation-clip')).toHaveValue('idle');
});

test('a missing room GLB reports the room, not the character, and Estudio still works', async (t) => {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  t.after(() => page.close());
  await page.route('**/models/room.glb', (route) => route.fulfill({ status: 404, body: '' }));
  await ready(page);
  await page.getByRole('button', { name: 'Habitación', exact: true }).click();
  await expect(page.locator('.status')).toHaveAttribute('data-state', 'error', { timeout: 15000 });
  await expect(page.locator('#overlay-title')).toHaveText('No se pudo cargar la habitación');
  await expect(page.locator('#overlay-detail')).toContainText('Falta el archivo models/room.glb');
  await expect(page.locator('canvas')).toHaveCount(0);
  await page.getByRole('button', { name: 'Estudio', exact: true }).click();
  await expectModel(page, 'v1');
});

test('V4 Animada exposes idle, walk and run and every clip changes the pose', async (t) => {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  t.after(() => page.close());
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await ready(page);
  const response = page.waitForResponse('**/models/developer-v4-interactions.glb');
  await page.getByRole('button', { name: 'V4 Animada', exact: true }).click();
  assert.equal((await response).status(), 200);
  await expectModel(page, 'v4rig');
  await expect(page.locator('#animation-controls')).toBeVisible();
  await expect(page.getByLabel('Clip', { exact: true })).toHaveValue('idle');
  for (const [name, label] of [['idle', 'Reposo'], ['walk', 'Caminar'], ['run', 'Correr']]) {
    await expect(page.locator(`#animation-clip option[value="${name}"]`)).toHaveText(`${label} (${name})`);
  }
  const frames: Buffer[] = [];
  for (const clip of ['idle', 'walk', 'run']) {
    await page.getByLabel('Clip', { exact: true }).selectOption(clip);
    await scrub(page, 300);
    frames.push(await frame(page));
  }
  assert.ok(!frames[0].equals(frames[1]) && !frames[1].equals(frames[2]), 'Each V4 clip must pose the rig differently');
  await scrub(page, 700);
  assert.ok(!frames[2].equals(await frame(page)), 'Scrubbing the run must move the rig');
  await page.screenshot({ path: new URL('animated-v4-run.png', output).pathname.replace(/^\/([A-Za-z]:)/, '$1'), fullPage: true });
  assert.deepEqual(errors, []);
});

test('V1 Animada discovers clips, scrubs deterministic poses, pauses and resumes at accessible speeds', async (t) => {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  t.after(() => page.close());
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await ready(page);
  await animated(page);
  await expect(page.locator('#animation-copy')).toContainText('Sentarse y usar el portátil vendrán después');
  await expect(page.locator('#animation-timeline')).toHaveAttribute('min', '0');
  await expect(page.locator('#animation-timeline')).toHaveAttribute('max', '1000');
  await scrub(page, 300);
  const idle = await frame(page);
  await page.getByLabel('Clip', { exact: true }).selectOption('walk');
  await scrub(page, 300);
  const walk = await frame(page);
  assert.ok(!idle.equals(walk), 'Exported walking tracks must change the pose');
  await page.waitForTimeout(350);
  assert.ok(walk.equals(await frame(page)), 'Paused animation must remain pixel stable');
  await page.getByRole('button', { name: 'Reproducir animación', exact: true }).click();
  await page.getByLabel('Clip', { exact: true }).selectOption('run');
  await scrub(page, 300);
  const run = await frame(page);
  assert.ok(!walk.equals(run), 'Exported running tracks must change the pose');
  await page.waitForTimeout(350);
  assert.ok(run.equals(await frame(page)), 'Scrubbing must cancel any running crossfade');
  await page.screenshot({ path: new URL('animated-run.png', output).pathname.replace(/^\/([A-Za-z]:)/, '$1'), fullPage: true });
  await scrub(page, 700);
  assert.ok(!run.equals(await frame(page)));
  await scrub(page, 300);
  assert.ok(run.equals(await frame(page)), 'Seeking to the same time must reproduce the same pose');
  await scrub(page, 1000);
  await scrub(page, 0);
  await scrub(page, 300);
  const speed = page.getByLabel('Velocidad de animación', { exact: true });
  for (const value of ['0.25', '0.5', '1']) {
    await speed.selectOption(value);
    await expect(speed).toHaveValue(value);
    await expect(page.locator('#animation-timeline')).toHaveValue('300');
    assert.ok(run.equals(await frame(page)), 'Speed changes must not advance a paused pose');
  }
  await speed.selectOption('0.25');
  await speed.focus();
  await expect(speed).toBeFocused();
  await page.getByRole('button', { name: 'Reproducir animación', exact: true }).click();
  await page.waitForTimeout(180);
  await page.getByRole('button', { name: 'Pausar animación', exact: true }).click();
  const resumed = Number(await page.locator('#animation-timeline').inputValue());
  assert.ok(resumed > 300 && resumed < 800, 'Play must resume, not reset the selected action');
  const advanced = await frame(page);
  assert.ok(!run.equals(advanced), 'Playback must advance the GLB pose');
  await page.waitForTimeout(300);
  assert.ok(advanced.equals(await frame(page)));
  assert.deepEqual(errors, []);
});

test('repeated V1 Animada to V1 switches dispose the old viewer and restore a single reproducible animation', async (t) => {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  t.after(() => page.close());
  const requests: string[] = [];
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (request) => { if (request.url().endsWith('.glb')) requests.push(request.url().split('/').at(-1)!); });
  await ready(page);
  await page.locator('[data-view="front"]').click();
  await page.locator('button[data-light="violet"]').click();
  const original = await frame(page);
  let rigPose: Buffer | undefined;
  for (let cycle = 0; cycle < 3; cycle++) {
    await animated(page);
    await expect(page.locator('[data-view="front"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('#canvas-host')).toHaveAttribute('data-light', 'violet');
    await expect(page.locator('#animation-speed')).toHaveValue('1');
    await page.getByLabel('Clip', { exact: true }).selectOption('walk');
    await scrub(page, 300);
    const pose = await frame(page);
    if (rigPose) assert.ok(rigPose.equals(pose), 'A fresh mixer must reproduce the same pose');
    rigPose = pose;
    const canvas = await page.locator('canvas').elementHandle();
    assert.ok(canvas);
    await page.getByRole('button', { name: 'Reproducir animación', exact: true }).click();
    await page.locator('[data-model="v1"]').click();
    await expectModel(page, 'v1');
    assert.equal(await canvas.evaluate((element) => element.isConnected), false);
    await page.waitForTimeout(300);
    assert.ok(original.equals(await frame(page)), 'Old mixers must not affect V1 or reappear through stale events');
    await expect(page.locator('#animation-controls')).toBeHidden();
  }
  assert.deepEqual(requests, ['developer.glb', ...Array.from({ length: 3 }, () => ['developer-v1-rig.glb', 'developer.glb']).flat()]);
  assert.deepEqual(errors, []);
});

test('animated controls fit on mobile and remain keyboard usable', async (t) => {
  const page = await browser.newPage({ viewport: { width: 375, height: 812 }, isMobile: true });
  t.after(() => page.close());
  await ready(page);
  await animated(page);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await expectVersionSelectorFits(page);
  await page.getByRole('button', { name: 'Pausar animación', exact: true }).click();
  const timeline = page.getByLabel('Posición de la animación', { exact: true });
  await timeline.focus();
  await page.keyboard.press('Home');
  await expect(timeline).toHaveValue('0');
  await page.keyboard.press('ArrowRight');
  await expect(timeline).toHaveValue('1');
  await expect(timeline).toHaveAttribute('aria-valuetext', /s$/);
});

test('animated playback suspends while hidden and context recovery preserves a scrubbed pose', async (t) => {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  t.after(() => page.close());
  await ready(page);
  await animated(page);
  await page.getByLabel('Clip', { exact: true }).selectOption('walk');
  await scrub(page, 300);
  const pose = await frame(page);
  const supported = await page.locator('canvas').evaluate((canvas: HTMLCanvasElement) => {
    const extension = canvas.getContext('webgl2')?.getExtension('WEBGL_lose_context');
    if (!extension) return false;
    extension.loseContext();
    setTimeout(() => extension.restoreContext(), 1000);
    return true;
  });
  assert.ok(supported);
  await expect(page.locator('.status')).toHaveAttribute('data-state', 'error');
  await expect(page.locator('#animation-clip')).toBeDisabled();
  await expect(page.locator('#animation-play')).toBeDisabled();
  await expectModel(page, 'v1rig');
  await expect(page.locator('#animation-clip')).toBeEnabled();
  await expect(page.locator('#animation-timeline')).toHaveValue('300');
  assert.ok(pose.equals(await frame(page)), 'Context restoration must preserve paused time and pose');
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.getByRole('button', { name: 'Reproducir animación', exact: true }).click();
  await page.waitForTimeout(400);
  await expect(page.locator('#animation-timeline')).toHaveValue('300');
  await page.evaluate(() => {
    Reflect.deleteProperty(document, 'hidden');
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect.poll(async () => Number(await page.locator('#animation-timeline').inputValue())).not.toBe(300);
  await page.getByRole('button', { name: 'Pausar animación', exact: true }).click();
  const resumed = await frame(page);
  assert.ok(!pose.equals(resumed));
  await page.waitForTimeout(250);
  assert.ok(resumed.equals(await frame(page)));
});

test('a lost graphics context recovers and reenables the controls', async () => {
  const page = await browser.newPage();
  await ready(page);
  await page.locator('[data-view="front"]').click();
  await page.locator('button[data-light="violet"]').click();
  await page.locator('#wireframe').check();
  const supported = await page.locator('canvas').evaluate((canvas: HTMLCanvasElement) => {
    const extension = canvas.getContext('webgl2')?.getExtension('WEBGL_lose_context');
    if (!extension) return false;
    extension.loseContext();
    setTimeout(() => extension.restoreContext(), 1500);
    return true;
  });
  assert.ok(supported);
  await expect(page.locator('.status')).toHaveAttribute('data-state', 'error');
  await expect(page.locator('[data-view="front"]')).toBeDisabled();
  await expectModel(page, 'v1');
  await expect(page.locator('[data-view="front"]')).toBeEnabled();
  await expect(page.locator('[data-view="front"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('button[data-light="violet"]')).toBeEnabled();
  await expect(page.locator('#canvas-host')).toHaveAttribute('data-light', 'violet');
  await expect(page.locator('#canvas-host')).toHaveAttribute('data-wireframe', 'true');
  await expect(page.locator('#wireframe')).toBeChecked();
  assert.ok((await frame(page)).length > 10000);
  await page.close();
});

test('missing WebGL2 produces an actionable message', async () => {
  const page = await browser.newPage();
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (kind, ...args) {
      return kind === 'webgl2' ? null : original.apply(this, [kind, ...args]);
    } as typeof original;
  });
  await page.goto(studyURL);
  await expect(page.locator('#overlay-title')).toHaveText('WebGL 2 no está disponible');
  await expect(page.locator('#retry')).toBeVisible();
  await page.close();
});

test('quality presets change resolution and shadows live, persist across reloads and report the frame cost', async (t) => {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 2, reducedMotion: 'reduce' });
  t.after(() => page.close());
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await roomWithV4(page);
  const host = page.locator('#canvas-host');
  const ratio = async () => Number(await host.getAttribute('data-pixel-ratio'));
  await expect(page.locator('button[data-quality="auto"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(host).toHaveAttribute('data-quality', 'auto');
  await expect(host).toHaveAttribute('data-shadows', 'true');
  assert.ok(await ratio() >= 1 && await ratio() <= 1.5);
  await expect(page.locator('#render-stats')).toContainText(/\d+ fps · [\d,]+ ms · [\d,]+× · \d+ draw calls/, { timeout: 5000 });
  const calls = Number(await host.getAttribute('data-draw-calls'));
  assert.ok(calls > 10 && calls < 200, `Merged room and character draw calls: ${calls}`);
  const auto = await frame(page);
  await page.locator('button[data-quality="low"]').click();
  await expect(host).toHaveAttribute('data-shadows', 'false');
  await expect(page.locator('#quality-copy')).toContainText('Sin sombras');
  assert.ok(await ratio() <= 1);
  const low = await frame(page);
  assert.ok(!auto.equals(low), 'Baja renders without shadows at a lower resolution');
  await page.locator('button[data-quality="high"]').click();
  await expect(host).toHaveAttribute('data-shadows', 'true');
  assert.equal(await ratio(), 2);
  await expect(host).toHaveAttribute('data-model', 'v4rig');
  await page.reload();
  await expectModel(page, 'v1');
  await expect(page.locator('button[data-quality="high"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(host).toHaveAttribute('data-quality', 'high');
  assert.equal(await ratio(), 2);
  assert.deepEqual(errors, []);
});

test('Reducir movimiento follows the system setting, can be overridden and stops interface transitions', async (t) => {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  t.after(() => page.close());
  await ready(page);
  const host = page.locator('#canvas-host');
  const transition = () => page.locator('.switch-track').first().evaluate((element) => getComputedStyle(element).transitionDuration);
  await expect(page.locator('#reduced-motion')).not.toBeChecked();
  await expect(host).toHaveAttribute('data-reduced-motion', 'false');
  assert.notEqual(await transition(), '0s');
  await page.locator('#reduced-motion').check();
  await expect(host).toHaveAttribute('data-reduced-motion', 'true');
  await expect(page.locator('html')).toHaveAttribute('data-reduced-motion', 'true');
  assert.equal(await transition(), '0s');
  await page.reload();
  await expectModel(page, 'v1');
  await expect(page.locator('#reduced-motion')).toBeChecked();

  const system = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  t.after(() => system.close());
  await ready(system);
  await expect(system.locator('#reduced-motion')).toBeChecked();
  await expect(system.locator('#canvas-host')).toHaveAttribute('data-reduced-motion', 'true');
  await system.locator('#reduced-motion').uncheck();
  await expect(system.locator('#canvas-host')).toHaveAttribute('data-reduced-motion', 'false');
  assert.notEqual(await system.locator('.switch-track').first().evaluate((element) => getComputedStyle(element).transitionDuration), '0s');
});

test('switching scenes and versions many times keeps one graphics context and a bounded heap', async (t) => {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' });
  t.after(() => page.close());
  const warnings: string[] = [];
  page.on('console', (message) => { if (/WebGL|context/i.test(message.text()) && message.type() !== 'log') warnings.push(message.text()); });
  page.on('pageerror', (error) => warnings.push(error.message));
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Performance.enable');
  const heap = async () => {
    await cdp.send('HeapProfiler.collectGarbage');
    const { metrics } = await cdp.send('Performance.getMetrics');
    return metrics.find((metric) => metric.name === 'JSHeapUsedSize')!.value / 1e6;
  };
  await roomWithV4(page);
  const cycle = async () => {
    await page.getByRole('button', { name: 'Estudio', exact: true }).click();
    await expectModel(page, 'v4rig');
    await page.getByRole('button', { name: 'Habitación', exact: true }).click();
    await expectModel(page, 'v4rig');
  };
  await cycle();
  const before = await heap();
  for (let index = 0; index < 6; index += 1) await cycle();
  const after = await heap();
  await expect(page.locator('canvas')).toHaveCount(1);
  assert.ok(after - before < 40, `JS heap grew from ${before.toFixed(1)} MB to ${after.toFixed(1)} MB`);
  assert.deepEqual(warnings, []);
});
