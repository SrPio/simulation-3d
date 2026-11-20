import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { DOG, DOG_CLIPS, dogAt, dogClip, dogStep, fetchBall, followSpot, placeDog, toggleStay, type DogBall, type DogEvent, type DogRest, type DogState } from '../src/world/dogFollow.ts';
import { sweep, type Box2, type Point2 } from '../src/world/collisions.ts';
import { DOG_KEY, readDog, saveDog } from '../src/core/dog.ts';
import { DOG_STICK, dogStick } from '../src/input/GamepadInput.ts';
import { BASEBALL, PropPhysics } from '../src/world/PropPhysics.ts';

const open = (from: Point2, step: Point2) => ({ x: from.x + step.x, z: from.z + step.z });

/** Run her for `seconds` at 60 fps with the character standing at `character`, collecting what happened. */
function run(dog: DogState, seconds: number, character = { x: 0, z: 0, yaw: 0 }, ball: () => DogBall | null = () => null,
  move = open): DogEvent[] {
  const events: DogEvent[] = [];
  for (let t = 0; t < seconds; t += 1 / 60) events.push(...dogStep(dog, { character, ball: ball(), delta: 1 / 60 }, move));
  return events;
}

test('her clips match the manifest rig_dog.py writes', async () => {
  const manifest = JSON.parse(await readFile(new URL('../public/models/canela.manifest.json', import.meta.url), 'utf8'));
  for (const [name, clip] of Object.entries(DOG_CLIPS)) {
    const written = manifest.clips[name];
    assert.ok(written, name);
    for (const [key, value] of Object.entries(clip)) {
      if (typeof value === 'number') assert.ok(Math.abs(written[key] - value) < 2e-3, `${name}.${key}: ${written[key]} vs ${value}`);
      else assert.equal(written[key], value, `${name}.${key}`);
    }
  }
});

test('she follows the character to a spot behind and beside them, and sits once they stand still', () => {
  const dog = dogAt({ x: 8, z: 8 }, 0);
  const character = { x: 0, z: 0, yaw: 0 };
  run(dog, 0.5, character);
  assert.ok(dog.speed > DOG.walk, `she runs to catch up (${dog.speed.toFixed(2)} m/s)`);
  assert.equal(dogClip(dog).clip, 'run');
  run(dog, 6, character);
  const spot = followSpot(character);
  assert.ok(Math.hypot(dog.x - spot.x, dog.z - spot.z) < DOG.start, 'she keeps to her spot');
  // Facing +Z, the spot is behind (−Z) and to the character's right (−X).
  assert.ok(spot.z < 0 && spot.x < 0);
  run(dog, DOG.restSit + 0.5, character);
  assert.ok(dog.sitting, 'still a while, she sits down');
  assert.equal(dogClip(dog).clip, 'sit');
  // The character walks off: she gets up and comes along.
  run(dog, 0.5, { x: 6, z: 0, yaw: Math.PI / 2 });
  assert.ok(!dog.sitting && dog.speed > 0.5);
});

test('told to stay (G) she sits where she is however far the character goes; told again she follows', () => {
  const dog = dogAt({ x: 1, z: 1 }, 0);
  toggleStay(dog);
  assert.equal(dog.mode, 'staying');
  run(dog, 3, { x: 40, z: 0, yaw: 0 });
  assert.deepEqual([dog.x, dog.z], [1, 1], 'she has not moved');
  assert.equal(dogClip(dog).clip, 'sit');
  toggleStay(dog);
  assert.equal(dog.mode, 'following');
  run(dog, 1, { x: 6, z: 0, yaw: 0 });
  assert.ok(dog.x > 1.5, 'she comes');
});

test('a thrown ball: she runs to it, picks it up, brings it to the character and puts it down at their feet', () => {
  const dog = dogAt({ x: -1, z: -1 }, 0);
  toggleStay(dog);
  const ball: DogBall = { x: 0, y: 0, z: 9, speed: 0 };
  fetchBall(dog);
  assert.equal(dog.mode, 'fetching', 'even sitting, she goes after it');
  const character = { x: 0, z: 0, yaw: 0 };
  let held = true;
  const events = run(dog, 12, character, () => (held ? ball : null));
  assert.ok(events.includes('grab'), 'she took it in her mouth');
  assert.ok(events.includes('drop'), 'she put it down');
  assert.ok(events.indexOf('grab') < events.indexOf('drop'));
  const away = Math.hypot(dog.x - character.x, dog.z - character.z);
  assert.ok(away < DOG.dropAt + DOG.radius + 0.2, `put down beside the character (${away.toFixed(2)} m)`);
  assert.ok(!dog.carrying);
  assert.equal(dog.mode, 'staying', 'then back to what she was told');
  held = false;
});

test('a ball still flying fast is not picked up; one that vanishes is given up', () => {
  const dog = dogAt({ x: 0, z: 0 }, 0);
  fetchBall(dog);
  const fast: DogBall = { x: 0, y: 0, z: 0.45, speed: 6 };
  run(dog, 0.3, { x: 0, z: -3, yaw: 0 }, () => fast);
  assert.notEqual(dog.mode, 'picking');
  const events = run(dog, 0.1, { x: 0, z: -3, yaw: 0 }, () => null);
  assert.ok(events.includes('lost'));
  assert.equal(dog.mode, 'following');
});

test('a ball still rolling: she trots along beside it and bends down only once it has all but stopped', () => {
  const dog = dogAt({ x: 0, z: 0 }, 0);
  fetchBall(dog);
  // The ball rolls on ahead of her, slowing down by 0.4 m/s every second.
  const ball: DogBall = { x: 0, y: 0, z: 3, speed: 1.8 };
  let pickedAt = -1;
  for (let t = 0; t < 8 && pickedAt < 0; t += 1 / 60) {
    ball.speed = Math.max(0, ball.speed - 0.4 / 60);
    ball.z += ball.speed / 60;
    dogStep(dog, { character: { x: 0, z: -4, yaw: 0 }, ball, delta: 1 / 60 }, open);
    if (dog.mode === 'picking') pickedAt = t;
  }
  assert.ok(pickedAt > 0, 'she picks it up in the end');
  assert.ok(ball.speed < DOG.catchSpeed, `only once it is slow (${ball.speed.toFixed(2)} m/s)`);
  // It rolls off from under her nose before she has it: she goes after it again.
  ball.z += 1;
  dogStep(dog, { character: { x: 0, z: -4, yaw: 0 }, ball, delta: 1 / 60 }, open);
  assert.equal(dog.mode, 'fetching');
  assert.ok(!dog.carrying);
});

test('the character sits on the bed: she jumps up beside them, sits, and jumps down when they get up', () => {
  const dog = dogAt({ x: 2, z: 0 }, 0);
  const character = { x: 0, z: -1.5, yaw: 0 };
  const rest: DogRest = { at: { x: 0.75, z: -2.25 }, height: 0.63, yaw: 0, from: { x: 0.75, z: -1.3 } };
  const step = (seconds: number, seated: boolean) => {
    const events: DogEvent[] = [];
    for (let t = 0; t < seconds; t += 1 / 60) events.push(...dogStep(dog, { character, ball: null, delta: 1 / 60, rest: seated ? rest : undefined }, open));
    return events;
  };
  let heights: number[] = [];
  for (let t = 0; t < 6 && dog.mode !== 'perched'; t += 1 / 60) {
    dogStep(dog, { character, ball: null, delta: 1 / 60, rest }, open);
    heights.push(dog.lift);
  }
  assert.equal(dog.mode, 'perched', 'up on the bed');
  assert.ok(Math.hypot(dog.x - rest.at.x, dog.z - rest.at.z) < 1e-6 && Math.abs(dog.lift - rest.height) < 1e-6);
  assert.ok(Math.max(...heights) > rest.height + 0.1, 'she jumps up over the edge');
  assert.equal(dogClip(dog).clip, 'sit');
  step(3, true);
  assert.equal(dog.mode, 'perched', 'she stays up while they sit');
  // They get up: she jumps down to the floor in front of the bed and follows again.
  heights = [];
  for (let t = 0; t < 3 && dog.mode !== 'following'; t += 1 / 60) {
    dogStep(dog, { character, ball: null, delta: 1 / 60 }, open);
    heights.push(dog.lift);
  }
  assert.equal(dog.mode, 'following');
  assert.equal(dog.lift, 0);
  assert.ok(Math.hypot(dog.x - rest.from.x, dog.z - rest.from.z) < DOG.settle + 0.15, 'down where she jumped up from');
  // A ball thrown while she is up there: she jumps down first, then runs after it.
  step(4, true);
  assert.equal(dog.mode, 'perched');
  fetchBall(dog);
  assert.equal(dog.mode, 'leaping');
  const ball: DogBall = { x: 3, y: 0, z: 2, speed: 0 };
  for (let t = 0; t < 2 && dog.mode === 'leaping'; t += 1 / 60) dogStep(dog, { character, ball, delta: 1 / 60, rest }, open);
  assert.equal(dog.mode, 'fetching');
});

test('invited while the character sits on the bed, she comes down right onto it beside them and sits', () => {
  const dog = dogAt({ x: 0, z: 0 }, 0, 'appearing');
  const rest: DogRest = { at: { x: 0.75, z: -2.25 }, height: 0.63, yaw: 0, from: { x: 0.75, z: -1.3 } };
  placeDog(dog, rest.at, rest.yaw, true, rest);
  assert.equal(dog.mode, 'appearing');
  assert.equal(dog.lift, rest.height, 'up at the height of the bed');
  // The character still sits there: she lands on the bed and stays.
  const events: DogEvent[] = [];
  for (let t = 0; t < DOG_CLIPS.jump.duration + 1; t += 1 / 60) {
    events.push(...dogStep(dog, { character: { x: 0, z: -1.5, yaw: 0 }, ball: null, delta: 1 / 60, rest }, open));
  }
  assert.ok(events.includes('landed'));
  assert.equal(dog.mode, 'perched');
  assert.equal(dogClip(dog).clip, 'sit');
  // The character gets up: she jumps down to the floor in front of the bed.
  for (let t = 0; t < 3 && dog.mode !== 'following'; t += 1 / 60) dogStep(dog, { character: { x: 0, z: -1, yaw: 0 }, ball: null, delta: 1 / 60 }, open);
  assert.equal(dog.mode, 'following');
  assert.ok(Math.hypot(dog.x - rest.from.x, dog.z - rest.from.z) < 1e-6 && dog.lift === 0);
});

test('beside any other seat she goes to her spot on the floor and sits there', () => {
  const dog = dogAt({ x: 4, z: 4 }, 0);
  const rest: DogRest = { at: { x: 1, z: 1 }, height: 0, yaw: 1, from: { x: 1, z: 1 } };
  for (let t = 0; t < 6; t += 1 / 60) dogStep(dog, { character: { x: 0, z: 0, yaw: 0 }, ball: null, delta: 1 / 60, rest }, open);
  assert.ok(Math.hypot(dog.x - 1, dog.z - 1) < DOG.settle + 0.05);
  assert.ok(dog.sitting);
  assert.equal(dog.lift, 0);
});

test('far away or stuck against a wall she jumps back beside the character', () => {
  const dog = dogAt({ x: 60, z: 0 }, 0);
  const events = run(dog, 0.1);
  assert.ok(events.includes('teleport'));
  assert.equal(dog.mode, 'appearing');
  run(dog, DOG_CLIPS.jump.duration);
  assert.equal(dog.mode, 'following');
  // A wall between her and the character.
  const wall: Box2 = { name: 'wall', minX: -10, maxX: 10, minZ: 2, maxZ: 2.4 };
  const stuck = dogAt({ x: 0, z: 5 }, Math.PI);
  const slide = (from: Point2, step: Point2) => sweep(from, step, DOG.radius, [wall], 50);
  const events2 = run(stuck, DOG.stuck + 1.5, { x: 0, z: -2, yaw: Math.PI }, () => null, slide);
  assert.ok(events2.includes('teleport'));
});

test('appearing she comes down out of a jump, lands and sits', () => {
  const dog = dogAt({ x: 0, z: 0 }, 0);
  placeDog(dog, followSpot({ x: 0, z: 0, yaw: 0 }), 0);
  assert.equal(dogClip(dog).clip, 'jump');
  const events = run(dog, DOG_CLIPS.jump.duration);
  assert.ok(events.includes('landed'));
  assert.ok(dog.sitting);
});

test('she comes back on later visits once brought, until sent home', () => {
  const store = new Map<string, string>();
  const storage = { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => void store.set(key, value) };
  assert.equal(readDog(storage), false);
  saveDog(storage, true);
  assert.equal(store.get(DOG_KEY), 'with-you');
  assert.equal(readDog(storage), true);
  saveDog(storage, false);
  assert.equal(readDog(storage), false);
  const blocked = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
  assert.equal(readDog(blocked), false);
  assert.doesNotThrow(() => saveDog(blocked, true));
});

test('the right stick pushed down once is one sit/follow command', () => {
  let held = false;
  let presses = 0;
  for (const y of [0, 0.5, 0.8, 0.9, 0.75, 0.5, 0.2, 0.85, 0.1]) {
    const step = dogStick(y, held);
    held = step.held;
    if (step.press) presses++;
  }
  assert.equal(presses, 2);
  assert.ok(DOG_STICK.on > DOG_STICK.off);
});

test('a thrown baseball bounces, rolls to a stop and stays until she takes it', async () => {
  const physics = await PropPhysics.load([], [], 0);
  const ball = physics.throwBaseball({ x: 0, y: 2, z: 0 }, { x: 0, y: 2, z: 6 }, { x: 0, y: 0, z: 0 });
  let bounced = false;
  let falling = false;
  for (let i = 0; i < 60 * 8; i++) {
    physics.step(1 / 60, undefined);
    if (ball.body.velocity.y < -1) falling = true;
    if (falling && ball.body.velocity.y > 0.5) bounced = true;
  }
  assert.ok(bounced, 'it bounces off the ground');
  assert.ok(ball.body.position.z > 5, `it flies and rolls on (${ball.body.position.z.toFixed(1)} m)`);
  assert.ok(Math.abs(ball.body.position.y - BASEBALL.radius) < 0.02 && ball.body.velocity.length() < 0.3, 'it comes to rest on the ground');
  assert.equal(physics.baseballs.length, 1);
  physics.takeBaseball(ball);
  assert.equal(physics.baseballs.length, 0);
  assert.equal(physics.retiredBalls.length, 0, 'taken in her mouth, not taken away');
  // Past the limit the oldest is taken away.
  for (let i = 0; i <= BASEBALL.max; i++) physics.throwBaseball({ x: i, y: 1, z: 0 }, { x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 });
  assert.equal(physics.baseballs.length, BASEBALL.max);
  assert.equal(physics.retiredBalls.length, 1);
});
