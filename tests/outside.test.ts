import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { Texture } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { CHARACTER_RADIUS, CLIP_ALTERNATIVES, CharacterController, JUMP } from '../src/character/CharacterController.ts';
import { groundAt, readOutside } from '../src/scene/outsideData.ts';
import { readRoom } from '../src/scene/roomData.ts';
import { MIN_VIEW_ANGLE, arrowYaw } from '../src/scene/Signpost.ts';
import { MESSAGES, type MessageKey } from '../src/core/i18n.ts';
import { overlaps, resolve, type Point2 } from '../src/world/collisions.ts';
import { AREA_MARGIN, signAt } from '../src/world/signs.ts';

async function load(file: string) {
  const data = await readFile(new URL(`../public/models/${file}.glb`, import.meta.url));
  const loader = new GLTFLoader();
  // Named like the built-in WebP plugin so it replaces it: Node cannot decode images.
  loader.register(() => ({ name: 'EXT_texture_webp', loadTexture: () => Promise.resolve(new Texture()) }));
  return { bytes: data, gltf: await loader.parseAsync(data.buffer.slice(data.byteOffset, data.byteOffset + data.length), '') };
}

function glbJson(bytes: Buffer) {
  const length = bytes.readUInt32LE(12);
  return JSON.parse(bytes.subarray(20, 20 + length).toString('utf8'));
}

const LINKS = {
  portfolio: 'https://andres-jaramillo.is-a.dev/',
  github: 'https://github.com/SrPio',
  linkedin: 'https://www.linkedin.com/in/andres-fernando-jaramillo-avila/',
};

test('outside GLB: no ground mesh, three standing signs linking to the portfolio, GitHub and LinkedIn', async () => {
  const { bytes, gltf } = await load('outside');
  const root = gltf.scene.getObjectByName('Outside');
  assert.ok(root, 'Outside root');
  assert.equal(gltf.scene.getObjectByName('Room'), undefined, 'the room stays in room.glb');
  assert.ok(bytes.length < 800_000, `outside.glb ${bytes.length} bytes`);
  const json = glbJson(bytes);
  assert.ok(json.extensionsUsed?.includes('EXT_texture_webp'), 'screenshots are embedded as WebP');
  assert.ok(json.images.length >= 3 && json.images.every((image: { mimeType: string }) => image.mimeType === 'image/webp'));
  // The endless ground is drawn by the viewer, not stored as a mesh.
  gltf.scene.traverse((object) => assert.ok(!/^Ground/.test(object.name), `no ground mesh: ${object.name}`));
  const { signs, bounds, groundY, platform } = readOutside(gltf.scene);
  assert.deepEqual(Object.fromEntries(signs.map((sign) => [sign.id, sign.link])), LINKS);
  // The room floor (0) stands a step above the outside ground.
  assert.equal(groundY, -0.12);
  assert.ok(platform.minX < -2.9 && platform.maxX > 2.9 && platform.minZ < -2.9 && platform.maxZ > 2.9, JSON.stringify(platform));
  assert.deepEqual(Object.fromEntries(signs.map((sign) => [sign.id, sign.title])), { portfolio: 'PORTAFOLIO', github: 'GITHUB', linkedin: 'LINKEDIN' });
  for (const sign of signs) {
    assert.ok(sign.label.length > 3, sign.id);
    assert.ok(Math.abs(sign.position.y - groundY) < 1e-4, `${sign.id} stands on the outside ground`);
    assert.ok(sign.board.bottom > 0.3 && sign.board.height > 1, `${sign.id}: a standing board`);
    // In a row 5 m in front of the back (-Z) wall line, past the room's open +X side, facing +Z like its window.
    assert.ok(Math.abs(sign.position.z - 1.95) < 0.05 && sign.position.x - sign.board.width / 2 > 3.2, `${sign.id} at ${sign.position.x},${sign.position.z}`);
    assert.ok(Math.cos(sign.yaw) > 0.999, `${sign.id} faces +Z`);
  }
  // A large walkable ground that still holds the whole room floor.
  assert.ok(bounds.minX <= -2.9 && bounds.minZ <= -2.9 && bounds.maxX > 15 && bounds.maxZ > 15, JSON.stringify(bounds));
});

test('sign zones lie in front of their boards, outside the room, and are detected with a margin', async () => {
  const { signs, bounds, boxes } = readOutside((await load('outside')).gltf.scene);
  for (const sign of signs) {
    const { area } = sign;
    const toZone = { x: area.center.x - sign.position.x, z: area.center.z - sign.position.z };
    assert.ok(toZone.z > 0.5 && Math.abs(toZone.x) < 1e-3, `${sign.id}: the zone is in front of the board`);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const corner = {
        x: area.center.x + sx * area.halfX * area.axisX.x + sz * area.halfZ * area.axisZ.x,
        z: area.center.z + sx * area.halfX * area.axisX.z + sz * area.halfZ * area.axisZ.z,
      };
      assert.ok(corner.x > 3.0 || corner.z > 3.0, `${sign.id}: corner outside the room`);
      assert.ok(corner.x < bounds.maxX && corner.z < bounds.maxZ && corner.x > bounds.minX && corner.z > bounds.minZ, `${sign.id}: on the ground`);
      assert.equal(overlaps(corner, 0.01, boxes), undefined, `${sign.id}: nothing blocks the zone`);
    }
    const centre = area.center;
    assert.equal(signAt(centre, signs)?.id, sign.id);
    const edge = (distance: number): Point2 => ({ x: centre.x + area.axisX.x * distance, z: centre.z + area.axisX.z * distance });
    assert.equal(signAt(edge(area.halfX + 0.05), signs), undefined, 'not in it yet');
    assert.equal(signAt(edge(area.halfX + 0.05), signs, sign.id)?.id, sign.id, 'stays while drifting off the edge');
    assert.equal(signAt(edge(area.halfX + AREA_MARGIN + 0.05), signs, sign.id), undefined, 'leaves past the margin');
  }
});

test('the character walks out of the room into each zone, but never through walls or signs', async () => {
  const room = readRoom((await load('room')).gltf.scene);
  const outside = readOutside((await load('outside')).gltf.scene);
  const { signs, bounds } = outside;
  const boxes = [...room.boxes, ...outside.boxes];
  const controller = new CharacterController(room.spawn, boxes, bounds);
  assert.equal(groundAt(controller.position, outside), 0, 'spawn on the room floor');
  const walk = (target: Point2, until?: () => boolean) => {
    for (let i = 0; i < 60 * 30; i++) {
      const dx = target.x - controller.position.x;
      const dz = target.z - controller.position.z;
      if (Math.hypot(dx, dz) < 0.1 || until?.()) return;
      // Steer with a camera looking along the walk direction: forward only.
      controller.update(1 / 60, { forward: 1, right: 0, run: false }, Math.atan2(-dx, -dz));
      assert.equal(overlaps(controller.position, CHARACTER_RADIUS, boxes), undefined);
    }
  };
  // Out through the open +X side, then along the zones.
  walk({ x: 3.6, z: 0.6 });
  assert.equal(groundAt(controller.position, outside), outside.groundY, 'down on the outside ground');
  for (const sign of signs) {
    let current: string | undefined;
    walk(sign.area.center, () => (current = signAt(controller.position, signs, current)?.id) === sign.id);
    assert.equal(current, sign.id, `reached the ${sign.id} zone: ${JSON.stringify(controller.position)}`);
  }
  // Walking straight at a board from behind stops at it.
  const github = signs.find((sign) => sign.id === 'github')!;
  const blocked = new CharacterController({ position: { x: github.position.x, z: -6 }, yaw: 0 }, boxes, bounds);
  for (let i = 0; i < 60 * 8; i++) blocked.update(1 / 60, { forward: 1, right: 0, run: false }, Math.PI);
  assert.ok(blocked.position.z < github.position.z, `stopped behind the board: ${JSON.stringify(blocked.position)}`);
  // Walls on -X and -Z still hold, also from outside, and the ground hidden behind them cannot be reached.
  for (const azimuth of [Math.PI / 2, 0]) {
    const walker = new CharacterController({ position: { x: 4, z: 4 }, yaw: 0 }, boxes, bounds);
    for (let i = 0; i < 60 * 25; i++) walker.update(1 / 60, { forward: 1, right: 0, run: true }, azimuth);
    assert.equal(overlaps(walker.position, CHARACTER_RADIUS, boxes), undefined);
    const { x, z } = walker.position;
    assert.ok(!(x < -3.08 && z < 3.08) && !(z < -3.08 && x < 3.08), `stays on the visible side: ${JSON.stringify(walker.position)}`);
    assert.ok(Math.max(Math.abs(x), Math.abs(z)) > 15, 'the ground goes on well past the room');
  }
});

test('rotated colliders push the character out along their own axes', () => {
  const board = { name: 'board', minX: -1, maxX: 1, minZ: -0.05, maxZ: 0.05, yaw: Math.PI / 4 };
  const inside = resolve({ x: 0.3, z: -0.2 }, CHARACTER_RADIUS, [board]);
  assert.equal(overlaps(inside, CHARACTER_RADIUS, [board]), undefined);
  // Far along the turned board's length it still blocks; the same point is free for an unturned box.
  const along = { x: Math.cos(Math.PI / 4) * 0.9, z: -Math.sin(Math.PI / 4) * 0.9 };
  assert.ok(overlaps(along, CHARACTER_RADIUS, [board]));
  assert.equal(overlaps(along, CHARACTER_RADIUS, [{ ...board, yaw: undefined }]), undefined);
});

test('jump: a short hop forward while airborne, no double jump, and walls still stop it', () => {
  const controller = new CharacterController({ position: { x: 0, z: 0 }, yaw: 0 }, [], 50);
  assert.ok(controller.jump());
  assert.equal(controller.jump(), false, 'no jump while in the air');
  let airborne = 0;
  let t = 0;
  for (; controller.jumping && t < 3; t += 1 / 60) {
    const before = controller.position.z;
    assert.equal(controller.update(1 / 60, { forward: 0, right: 1, run: false }, 0), controller.jumping ? 'jump' : 'idle');
    if (controller.airborne) airborne++;
    else if (controller.jumping) assert.ok(Math.abs(controller.position.z - before) < 1e-9 || controller.position.z - before < 0.03, 'crouch and landing stay in place');
  }
  assert.ok(Math.abs(t - JUMP.duration) < 0.05, `lasts the clip: ${t}`);
  assert.ok(airborne > 10);
  assert.ok(Math.abs(controller.position.z - JUMP.distance) < 0.03, `forward along the facing: ${controller.position.z}`);
  assert.ok(Math.abs(controller.position.x) < 1e-9, 'keys do not steer in the air');
  const wall = { name: 'wall', minX: -1, maxX: 1, minZ: 0.5, maxZ: 0.6 };
  const blocked = new CharacterController({ position: { x: 0, z: 0 }, yaw: 0 }, [wall], 50);
  blocked.jump();
  for (let i = 0; i < 60; i++) blocked.update(1 / 60, { forward: 0, right: 0, run: false }, 0);
  for (let i = 0; i < 2; i++) { blocked.jump(); for (let j = 0; j < 60; j++) blocked.update(1 / 60, { forward: 0, right: 0, run: false }, 0); }
  assert.ok(blocked.position.z <= 0.5 - CHARACTER_RADIUS + 1e-6, `stopped by the wall: ${blocked.position.z}`);
});

test('jumping while running keeps the speed, skips the crouch and runs on after landing', () => {
  const run = { forward: 1, right: 0, run: true };
  const controller = new CharacterController({ position: { x: 0, z: 0 }, yaw: 0 }, [], 50);
  controller.jumpSpec = CLIP_ALTERNATIVES.jump_ual.jump!;
  for (let i = 0; i < 120; i++) controller.update(1 / 60, run, Math.PI);
  const speed = controller.speed;
  assert.ok(speed > 3, `running at ${speed}`);
  const start = controller.position.z;
  assert.ok(controller.jump());
  const { duration, air } = controller.jumpSpec;
  assert.ok(controller.jumpStart > 0 && controller.jumpStart < air[0] * duration, 'starts close to take-off');
  let t = 0;
  for (; controller.jumping && t < 3; t += 1 / 60) {
    const before = controller.position.z;
    controller.update(1 / 60, run, Math.PI);
    if (controller.jumping) assert.ok(controller.position.z - before > speed / 60 * 0.9, `keeps moving at ${t.toFixed(2)} s`);
  }
  // Back to running right after touching down, long before the clip's own end.
  assert.ok(t < (air[1] - air[0]) * duration + 0.25, `lands into the run after ${t.toFixed(2)} s`);
  assert.equal(controller.locomotion(), 'run');
  assert.ok(controller.position.z - start > 2, `a long jump: ${(controller.position.z - start).toFixed(2)} m`);
  // Without keys after landing it slows down and stops by the end of the clip.
  const stop = new CharacterController({ position: { x: 0, z: 0 }, yaw: 0 }, [], 50);
  stop.jumpSpec = CLIP_ALTERNATIVES.jump_ual.jump!;
  for (let i = 0; i < 120; i++) stop.update(1 / 60, run, Math.PI);
  stop.jump();
  for (let i = 0; i < 200 && stop.jumping; i++) stop.update(1 / 60, { forward: 0, right: 0, run: true }, Math.PI);
  assert.equal(stop.locomotion(), 'idle');
});

test('the jump in the controller matches the rig manifest', async () => {
  const manifest = JSON.parse(await readFile(new URL('../public/models/developer-v4-rig.manifest.json', import.meta.url), 'utf8'));
  const jump = manifest.clips.find((clip: { name: string }) => clip.name === 'jump');
  assert.ok(Math.abs(jump.duration - JUMP.duration) < 1e-9);
  assert.deepEqual(jump.air, JUMP.air);
  assert.equal(jump.distance, JUMP.distance);
});

test('the crossroads lamppost carries one arrow per zone, none for the controls, and blocks the way', async () => {
  const data = readOutside((await load('outside')).gltf.scene);
  const lamp = data.lamppost!;
  assert.ok(lamp, 'lamppost');
  const crossroads = data.floors.find((floor) => floor.id === 'crossroads')!;
  const controls = data.floors.find((floor) => floor.id === 'controls')!;
  assert.ok(Math.hypot(lamp.position.x - crossroads.position.x, lamp.position.z - crossroads.position.z) < 1e-3, 'in the circle');
  assert.ok(lamp.height > 2.5 && lamp.arrowsTop < lamp.height && lamp.arrowsTop - (lamp.arrows.length - 1) * lamp.arrowStep > 1.2);
  assert.deepEqual(lamp.arrows.map((arrow) => arrow.id), ['about', 'playground']);
  assert.deepEqual(crossroads.labels, ['about', 'playground']);
  for (const arrow of lamp.arrows) {
    for (const language of ['es', 'en'] as const) assert.ok(MESSAGES[language][`floor.${arrow.id}` as MessageKey], `${language} name for ${arrow.id}`);
    assert.ok(Math.hypot(arrow.target.x - controls.position.x, arrow.target.z - controls.position.z) > 3, `${arrow.id} is not the controls`);
  }
  const box = data.boxes.find((entry) => entry.name === 'Collider_Lamppost')!;
  assert.ok(box && box.minX < lamp.position.x && box.maxX > lamp.position.x && box.minZ < lamp.position.z && box.maxZ > lamp.position.z);
  const pushed = resolve({ x: lamp.position.x + 0.1, z: lamp.position.z }, CHARACTER_RADIUS, data.boxes);
  assert.ok(Math.hypot(pushed.x - lamp.position.x, pushed.z - lamp.position.z) >= 0.25 + CHARACTER_RADIUS - 1e-3, 'the character goes round the pole');
});

test('signpost arrows point at their zone but never turn edge-on to the default view', () => {
  const view = { x: 1, z: 1 };
  const viewYaw = Math.atan2(-view.z, view.x);
  const pole = { x: 0, z: 0 };
  for (let degrees = 0; degrees < 360; degrees += 5) {
    const angle = degrees * Math.PI / 180;
    const target = { x: Math.cos(angle) * 5, z: -Math.sin(angle) * 5 };
    const yaw = arrowYaw(pole, target, view);
    const offView = Math.abs(Math.sin(yaw - viewYaw));
    assert.ok(offView >= Math.sin(MIN_VIEW_ANGLE) - 1e-9, `${degrees}°: ${offView.toFixed(3)} off the line of sight`);
    // It still points on the target's side, and exactly at it when that is already readable.
    const towards = Math.cos(yaw - angle);
    assert.ok(towards > Math.cos(MIN_VIEW_ANGLE) - 1e-9, `${degrees}°: points away`);
    if (Math.abs(Math.sin(angle - viewYaw)) > Math.sin(MIN_VIEW_ANGLE) + 1e-6) assert.ok(towards > 1 - 1e-9, `${degrees}°: turned without need`);
  }
});
