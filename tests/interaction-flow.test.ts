import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { Texture } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { CHARACTER_RADIUS } from '../src/character/CharacterController.ts';
import { InteractionController, LAPTOP_EVENTS, REACH } from '../src/interactions/InteractionController.ts';
import { readRoom, type RoomData } from '../src/scene/roomData.ts';
import { overlaps, type Point2 } from '../src/world/collisions.ts';

async function room(): Promise<RoomData> {
  const data = await readFile(new URL('../public/models/room.glb', import.meta.url));
  const loader = new GLTFLoader();
  loader.register(() => ({ name: 'HeadlessTextures', loadTexture: () => Promise.resolve(new Texture()) }));
  const { scene } = await loader.parseAsync(data.buffer.slice(data.byteOffset, data.byteOffset + data.length), '');
  return readRoom(scene);
}

const manifest = JSON.parse(await readFile(new URL('../public/models/developer-v4-interactions.manifest.json', import.meta.url), 'utf8'));
const durations = new Map<string, number>(manifest.clips.map((clip: { name: string; duration: number }) => [clip.name, clip.duration]));
const events = manifest.clips.find((clip: { name: string }) => clip.name === 'laptop_draw_chair').events;
const stow = manifest.clips.find((clip: { name: string }) => clip.name === 'laptop_stow_chair').events;

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
    const duration = durations.get(clip) ?? 1;
    interaction.update(1 / 60, request ? Math.min(time / duration, 1) : 0);
    time += 1 / 60;
    if (request && !request.loop && time >= duration) {
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

const near = (data: RoomData, seat: 'chair' | 'bed'): Point2 => {
  const spot = data.seats.find((entry) => entry.seat === seat)!;
  // Open floor just past the end of the desk (chair) or in front of the bed.
  return seat === 'chair' ? { x: spot.approach.x + 0.5, z: spot.approach.z - 0.5 } : { x: spot.approach.x + 0.3, z: spot.approach.z + 0.4 };
};

test('the room exports both seats with clear approach points and laptop spots', async () => {
  const data = await room();
  assert.deepEqual(data.seats.map((seat) => seat.seat).sort(), ['bed', 'chair']);
  for (const seat of data.seats) assert.equal(overlaps(seat.approach, CHARACTER_RADIUS, data.boxes), undefined, `${seat.seat} approach is free`);
  assert.ok(data.laptopSpots.has('desk') && data.laptopSpots.has('lap'));
  assert.equal(manifest.clips.find((clip: { name: string }) => clip.name === 'laptop_draw_bed').events.take, events.take);
  assert.deepEqual(LAPTOP_EVENTS, { ...events, ...stow }, 'the viewer uses the laptop event times of the clip manifest');
});

test('E is only offered for a seat that is near and reachable', async () => {
  const data = await room();
  const interaction = new InteractionController(data.seats, data.boxes, data.halfSize, CHARACTER_RADIUS);
  assert.equal(interaction.available(data.spawn.position)?.seat, 'bed', 'the bed is a few steps from the spawn');
  const chair = data.seats.find((seat) => seat.seat === 'chair')!;
  assert.ok(Math.hypot(chair.approach.x - data.spawn.position.x, chair.approach.z - data.spawn.position.z) > REACH, 'the chair is not');
  assert.equal(interaction.available(near(data, 'chair'))?.seat, 'chair');
  assert.equal(interaction.prompt(near(data, 'chair')), 'E: sentarse en la silla');
  const far = { x: data.halfSize - 0.5, z: data.halfSize - 0.5 };
  assert.equal(interaction.available(far), undefined);
  assert.equal(interaction.interact(far, 0), false);
  assert.match(interaction.message, /Acércate/);
  // A wall between the character and the seat removes the offer.
  const wall = { name: 'blocker', minX: chair.approach.x - 1, maxX: chair.approach.x + 1, minZ: chair.approach.z + 0.25, maxZ: chair.approach.z + 0.3 };
  const blocked = new InteractionController(data.seats, [...data.boxes, wall], data.halfSize, CHARACTER_RADIUS);
  assert.notEqual(blocked.available(near(data, 'chair'))?.seat, 'chair', 'the blocked chair is not offered (the bed may still be)');
});

test('chair: walk up, sit, open the laptop, type, and E while typing stows it before standing', async () => {
  const data = await room();
  const interaction = new InteractionController(data.seats, data.boxes, data.halfSize, CHARACTER_RADIUS, { ...events, ...stow });
  const chair = data.seats.find((seat) => seat.seat === 'chair')!;
  assert.ok(interaction.interact(near(data, 'chair'), 0));
  assert.equal(interaction.phase, 'approaching');
  settle(interaction, 'seated', () => {
    if (interaction.phase === 'approaching') assert.equal(overlaps(interaction.position, CHARACTER_RADIUS, data.boxes), undefined, 'the approach never walks through furniture');
  });
  assert.equal(interaction.phase, 'seated');
  assert.equal(interaction.state.stage, 'seated');
  assert.deepEqual(interaction.position, chair.stand);
  assert.ok(Math.abs(interaction.yaw - chair.yaw) < 1e-9);
  assert.equal(interaction.laptopPress(), true);
  assert.equal(interaction.laptopPress(), false, 'no double command during a transition');
  assert.equal(interaction.interact(interaction.position, 0), false, 'E waits for the transition');
  settle(interaction, 'typing');
  assert.equal(interaction.state.stage, 'typing');
  assert.equal(interaction.laptop, 'desk');
  assert.equal(interaction.lid, 1);
  assert.match(interaction.prompt(interaction.position), /L: guardar/);
  assert.ok(interaction.interact(interaction.position, 0));
  assert.equal(interaction.state.stage, 'stowing');
  settle(interaction, 'free');
  assert.equal(interaction.laptop, 'stowed', 'stowing carries the laptop away from the desk');
  assert.equal(interaction.lid, 0);
  assert.equal(interaction.phase, 'free');
  assert.deepEqual(interaction.position, chair.approach, 'back on the clear approach point');
});

test('bed: the laptop only comes to the lap when carried, and is never in two places', async () => {
  const data = await room();
  const interaction = new InteractionController(data.seats, data.boxes, data.halfSize, CHARACTER_RADIUS, { ...events, ...stow });
  assert.ok(interaction.interact(data.spawn.position, 0));
  settle(interaction, 'seated');
  assert.equal(interaction.state.stage, 'seated');
  assert.equal(interaction.laptopPress(), false, 'the laptop is still on the desk');
  assert.match(interaction.message, /escritorio/);
  assert.ok(interaction.interact(interaction.position, 0));
  settle(interaction, 'free');
  assert.equal(interaction.phase, 'free');
  // Carry it: sit at the desk, take it, stow it.
  assert.ok(interaction.interact(near(data, 'chair'), 0));
  settle(interaction, 'seated');
  interaction.laptopPress();
  settle(interaction, 'typing');
  interaction.laptopPress();
  settle(interaction, 'seated');
  assert.equal(interaction.laptop, 'stowed');
  interaction.interact(interaction.position, 0);
  settle(interaction, 'free');
  assert.equal(interaction.phase, 'free');
  // Now the bed takes it onto the lap: closed when it appears, then opened.
  assert.ok(interaction.interact(data.spawn.position, 0));
  settle(interaction, 'seated');
  assert.ok(interaction.laptopPress());
  let sawClosedOnLap = false;
  settle(interaction, 'typing', () => {
    assert.ok(interaction.laptop !== 'desk', 'never back on the desk while it is in use on the bed');
    if (interaction.laptop === 'lap' && interaction.lid < 0.05) sawClosedOnLap = true;
  });
  assert.ok(sawClosedOnLap);
  assert.equal(interaction.laptop, 'lap');
  assert.equal(interaction.state.stage, 'typing');
  interaction.reset();
  assert.equal(interaction.laptop, 'stowed', 'abandoning the seat never leaves the laptop on an empty lap');
});

test('standing up is refused while the exit is blocked', async () => {
  const data = await room();
  const chair = data.seats.find((seat) => seat.seat === 'chair')!;
  const boxes = [...data.boxes];
  const interaction = new InteractionController(data.seats, boxes, data.halfSize, CHARACTER_RADIUS);
  interaction.interact(near(data, 'chair'), 0);
  settle(interaction, 'seated');
  boxes.push({ name: 'bag', minX: chair.approach.x - 0.1, maxX: chair.approach.x + 0.1, minZ: chair.approach.z - 0.1, maxZ: chair.approach.z + 0.1 });
  assert.equal(interaction.interact(interaction.position, 0), false);
  assert.match(interaction.message, /bloqueada/);
  boxes.pop();
  assert.ok(interaction.interact(interaction.position, 0));
});
