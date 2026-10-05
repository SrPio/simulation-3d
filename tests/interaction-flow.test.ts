import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { Texture } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { CHARACTER_RADIUS } from '../src/character/CharacterController.ts';
import { APPEAR_TIME, InteractionController, LID_TIME, REACH } from '../src/interactions/InteractionController.ts';
import { readRoom, type RoomData } from '../src/scene/roomData.ts';
import { overlaps, type Box2, type Point2 } from '../src/world/collisions.ts';

async function room(): Promise<RoomData> {
  const data = await readFile(new URL('../public/models/room.glb', import.meta.url));
  const loader = new GLTFLoader();
  // Named like the built-in WebP plugin so it replaces it: Node cannot decode images.
  loader.register(() => ({ name: 'EXT_texture_webp', loadTexture: () => Promise.resolve(new Texture()) }));
  const { scene } = await loader.parseAsync(data.buffer.slice(data.byteOffset, data.byteOffset + data.length), '');
  return readRoom(scene);
}

const manifest = JSON.parse(await readFile(new URL('../public/models/developer-v4-interactions.manifest.json', import.meta.url), 'utf8'));
const durations = new Map<string, number>(manifest.clips.map((clip: { name: string; duration: number }) => [clip.name, clip.duration]));

/** Plays the requested clips like the viewer's mixer: time advances, one-shot clips report their end. */
function play(interaction: InteractionController, seconds: number, check?: () => void, until?: () => boolean) {
  let clip = '';
  let time = 0;
  for (let t = 0; t < seconds; t += 1 / 60) {
    if (until?.()) return;
    const request = interaction.clip();
    if (request && request.name !== clip) {
      clip = request.name;
      time = 0;
    }
    interaction.update(1 / 60);
    time += 1 / 60;
    if (request && !request.loop && time >= (durations.get(clip) ?? 1)) {
      interaction.clipFinished();
      clip = '';
    }
    check?.();
  }
  if (until) assert.fail(`timed out after ${seconds}s in ${interaction.phase}/${interaction.state.stage}`);
}

/** Play until the interaction settles in a stage (looping clip) or back to free. */
const settle = (interaction: InteractionController, stage: string, check?: () => void) =>
  play(interaction, 15, check, () => (stage === 'free' ? interaction.phase === 'free' : interaction.phase === 'seated' && interaction.state.stage === stage));

const chairOf = (data: RoomData) => data.seats.find((seat) => seat.seat === 'chair')!;
/** The chair's approach points: on the character's left (back wall side) and right (open side) when seated. */
const sides = (data: RoomData) => {
  const [a, b] = chairOf(data).approaches;
  return a.z < b.z ? { left: a, right: b } : { left: b, right: a };
};
/** Open floor a step away from each approach point. */
const near = (data: RoomData, where: 'left' | 'right' | 'bed'): Point2 => {
  if (where === 'bed') {
    const bed = data.seats.find((seat) => seat.seat === 'bed')!.approaches[0];
    return { x: bed.x + 0.3, z: bed.z + 0.4 };
  }
  const point = sides(data)[where];
  return where === 'left' ? { x: point.x + 0.5, z: point.z - 0.5 } : { x: point.x + 0.5, z: point.z + 0.5 };
};
const same = (a: Point2, b: Point2) => Math.hypot(a.x - b.x, a.z - b.z) < 1e-9;

test('the room exports both seats, the chair with an approach point on each side, and both laptop spots', async () => {
  const data = await room();
  assert.deepEqual(data.seats.map((seat) => seat.seat).sort(), ['bed', 'chair']);
  assert.equal(chairOf(data).approaches.length, 2, 'the chair is reachable from both sides');
  for (const seat of data.seats) {
    for (const point of seat.approaches) assert.equal(overlaps(point, CHARACTER_RADIUS, data.boxes), undefined, `${seat.seat} approach is free`);
  }
  const { left, right } = sides(data);
  const stand = chairOf(data).stand;
  assert.ok(left.z < stand.z && right.z > stand.z, 'one approach on each side of the chair');
  assert.ok(data.laptopSpots.has('desk') && data.laptopSpots.has('lap'));
});

test('E is only offered for a seat that is near and reachable, from either side of the chair', async () => {
  const data = await room();
  const interaction = new InteractionController(data.seats, data.boxes, data.halfSize, CHARACTER_RADIUS);
  assert.equal(interaction.available(data.spawn.position)?.seat, 'bed', 'the bed is a few steps from the spawn');
  for (const point of chairOf(data).approaches) {
    assert.ok(Math.hypot(point.x - data.spawn.position.x, point.z - data.spawn.position.z) > REACH, 'the chair is not');
  }
  for (const side of ['left', 'right'] as const) {
    assert.equal(interaction.available(near(data, side))?.seat, 'chair', side);
    assert.equal(interaction.prompt(near(data, side)), 'E: sentarse en la silla');
  }
  const far = { x: data.halfSize - 0.5, z: data.halfSize - 0.5 };
  assert.equal(interaction.available(far), undefined);
  assert.equal(interaction.interact(far, 0), false);
  assert.match(interaction.message, /Acércate/);
  // A wall between the character and the left approach removes the offer there (the right side is out of reach).
  const { left } = sides(data);
  const wall = { name: 'blocker', minX: left.x - 1, maxX: left.x + 1, minZ: left.z - 0.3, maxZ: left.z - 0.25 };
  const blocked = new InteractionController(data.seats, [...data.boxes, wall], data.halfSize, CHARACTER_RADIUS);
  assert.notEqual(blocked.available(near(data, 'left'))?.seat, 'chair', 'the blocked chair is not offered (the bed may still be)');
});

test('chair from the right: walk up, sit, open the desk laptop, type, and E closes it before standing on the same side', async () => {
  const data = await room();
  const interaction = new InteractionController(data.seats, data.boxes, data.halfSize, CHARACTER_RADIUS);
  const chair = chairOf(data);
  assert.ok(interaction.interact(near(data, 'right'), 0));
  assert.equal(interaction.phase, 'approaching');
  settle(interaction, 'seated', () => {
    if (interaction.phase === 'approaching') assert.equal(overlaps(interaction.position, CHARACTER_RADIUS, data.boxes), undefined, 'the approach never walks through furniture');
  });
  assert.deepEqual(interaction.position, chair.stand);
  assert.ok(Math.abs(interaction.yaw - chair.yaw) < 1e-9);
  assert.equal(interaction.laptop, 'none');
  assert.equal(interaction.laptopPress(), true);
  assert.equal(interaction.state.stage, 'opening');
  assert.equal(interaction.laptop, 'desk', 'the desk laptop is used at the chair');
  assert.equal(interaction.laptopPress(), false, 'no double command during a transition');
  assert.equal(interaction.interact(interaction.position, 0), false, 'E waits for the transition');
  let frames = 0;
  settle(interaction, 'typing', () => { frames++; });
  assert.ok(frames / 60 <= LID_TIME + 0.05, `the lid just opens: ${frames / 60}s`);
  assert.equal(interaction.lid, 1);
  assert.equal(interaction.shown, 0, 'nothing appears on the lap at the chair');
  assert.match(interaction.prompt(interaction.position), /L: cerrar/);
  assert.ok(interaction.interact(interaction.position, 0));
  assert.equal(interaction.state.stage, 'closing');
  settle(interaction, 'free');
  assert.equal(interaction.laptop, 'none');
  assert.equal(interaction.lid, 0);
  assert.ok(same(interaction.position, sides(data).right), 'back out on the side used to sit down');
});

test('chair from the left: if that side gets blocked while seated, standing up leaves by the other one', async () => {
  const data = await room();
  const boxes: Box2[] = [...data.boxes];
  const interaction = new InteractionController(data.seats, boxes, data.halfSize, CHARACTER_RADIUS);
  const { left, right } = sides(data);
  assert.ok(interaction.interact(near(data, 'left'), 0));
  settle(interaction, 'seated');
  boxes.push({ name: 'bag', minX: left.x - 0.1, maxX: left.x + 0.1, minZ: left.z - 0.1, maxZ: left.z + 0.1 });
  assert.ok(interaction.interact(interaction.position, 0));
  settle(interaction, 'free');
  assert.ok(same(interaction.position, right));
});

test('bed: the laptop appears on the lap and opens, even with the desk laptop in the room, then closes and disappears', async () => {
  const data = await room();
  const interaction = new InteractionController(data.seats, data.boxes, data.halfSize, CHARACTER_RADIUS);
  assert.ok(interaction.interact(near(data, 'bed'), 0));
  settle(interaction, 'seated');
  assert.equal(interaction.seat?.seat, 'bed');
  assert.ok(interaction.laptopPress(), 'always available on the bed');
  assert.equal(interaction.laptop, 'lap');
  let sawAppearing = false;
  let frames = 0;
  settle(interaction, 'typing', () => {
    frames++;
    if (interaction.shown > 0 && interaction.shown < 1) {
      sawAppearing = true;
      assert.equal(interaction.lid, 0, 'it opens once it has appeared');
    }
  });
  assert.ok(sawAppearing);
  assert.ok(frames / 60 <= APPEAR_TIME + LID_TIME + 0.05, `quick: ${frames / 60}s`);
  assert.equal(interaction.shown, 1);
  assert.equal(interaction.lid, 1);
  assert.ok(interaction.laptopPress());
  settle(interaction, 'seated');
  assert.equal(interaction.laptop, 'none');
  assert.equal(interaction.shown, 0);
  assert.ok(interaction.laptopPress());
  settle(interaction, 'typing');
  interaction.reset();
  assert.equal(interaction.laptop, 'none', 'abandoning the seat never leaves a laptop on an empty lap');
  assert.equal(interaction.shown, 0);
});

test('sitting down and standing up are quick clips of under a second', () => {
  for (const seat of ['chair', 'bed']) {
    for (const action of ['sit_down', 'stand_up']) {
      const duration = durations.get(`${action}_${seat}`)!;
      assert.ok(duration > 0.6 && duration <= 0.8, `${action}_${seat}: ${duration}s`);
    }
  }
});

test('standing up is refused while every exit is blocked', async () => {
  const data = await room();
  const boxes: Box2[] = [...data.boxes];
  const interaction = new InteractionController(data.seats, boxes, data.halfSize, CHARACTER_RADIUS);
  interaction.interact(near(data, 'right'), 0);
  settle(interaction, 'seated');
  for (const point of chairOf(data).approaches) boxes.push({ name: 'bag', minX: point.x - 0.1, maxX: point.x + 0.1, minZ: point.z - 0.1, maxZ: point.z + 0.1 });
  assert.equal(interaction.interact(interaction.position, 0), false);
  assert.match(interaction.message, /bloqueada/);
  boxes.splice(-2);
  assert.ok(interaction.interact(interaction.position, 0));
});
