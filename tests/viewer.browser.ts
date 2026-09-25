import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { after, test } from 'node:test';
import { chromium, expect, type Page } from '@playwright/test';

const baseURL = process.env.VIEWER_URL ?? 'http://127.0.0.1:5173/';
const browser = await chromium.launch({ channel: process.env.BROWSER_CHANNEL ?? 'msedge', headless: true });
const output = new URL('../test-results/', import.meta.url);
await mkdir(output, { recursive: true });
after(() => browser.close());

const versions = {
  v1: { label: 'V1 Original', file: 'developer.glb', status: 'V1 original conservada', revision: 'V1 / ORIGINAL', stage: 'V1 CONSERVADA', copy: 'V1 original conservada sin cambios' },
  v2: { label: 'V2 Model sheet', file: 'developer-v2.glb', status: 'V2 estudio anterior inacabado', revision: 'V2 / ESTUDIO ANTERIOR', stage: 'V2 CONSERVADA', copy: 'Estudio anterior inacabado' },
  v1rig: { label: 'V1 Animada', file: 'developer-v1-rig.glb', status: 'V1 Animada · Fase 2A', revision: 'V1 / FASE 2A', stage: 'FASE 2A', copy: 'Rig y ciclos en el sitio' },
  v4: { label: 'V4 Pulida', file: 'developer-v4.glb', status: 'V4 pulida · fiel a la referencia', revision: 'V4 / REFERENCIA', stage: 'V4 PULIDA', copy: 'Modelo independiente fiel a las fotos de referencia' },
  v4rig: { label: 'V4 Animada', file: 'developer-v4-rig.glb', status: 'V4 Animada · rig y ciclos', revision: 'V4 / RIG', stage: 'V4 RIG', copy: 'reposo, caminar y correr en el sitio' },
} as const;

async function expectModel(page: Page, version: keyof typeof versions) {
  await expect(page.locator('.status')).toHaveAttribute('data-state', 'ready', { timeout: 30000 });
  await expect(page.locator('#canvas-host')).toHaveAttribute('data-model', version);
  await expect(page.locator('.version-selector button')).toHaveCount(6);
  await expect(page.locator('[data-model="v3"]')).toBeDisabled();
  await expect(page.locator('[data-model="v3"]')).toContainText('PAUSADA');
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
    if (await button.getAttribute('data-model') === 'v3') await expect(button).toBeDisabled();
    else await expect(button).toBeEnabled();
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
  await page.goto(baseURL);
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
  await page.goto(baseURL);
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
  await page.goto(baseURL);
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

test('V3 stays visibly paused and cannot request its GLB even through a synthetic click', async (t) => {
  const page = await browser.newPage();
  t.after(() => page.close());
  const requests: string[] = [];
  page.on('request', (request) => { if (request.url().endsWith('.glb')) requests.push(request.url().split('/').at(-1)!); });
  await ready(page);
  const paused = page.locator('[data-model="v3"]');
  await expect(paused).toBeDisabled();
  await expect(paused).toContainText('PAUSADA');
  await expect(page.locator('#paused-copy')).toContainText('No se carga ningún archivo de V3');
  await paused.dispatchEvent('click');
  await page.waitForTimeout(250);
  await expectModel(page, 'v1');
  assert.deepEqual(requests, ['developer.glb']);
});

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
  assert.ok(meshes > 150, `Room and character meshes: ${meshes}`);
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
  assert.deepEqual(requests, ['developer.glb', 'developer.glb', 'room.glb', 'developer-v4-rig.glb', 'room.glb', 'developer-v4-rig.glb']);
  assert.deepEqual(errors, []);
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
  const response = page.waitForResponse('**/models/developer-v4-rig.glb');
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
  await page.goto(baseURL);
  await expect(page.locator('#overlay-title')).toHaveText('WebGL 2 no está disponible');
  await expect(page.locator('#retry')).toBeVisible();
  await page.close();
});
