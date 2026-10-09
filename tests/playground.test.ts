import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import * as cannon from 'cannon-es';
import { Texture } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { readOutside, type OutsideData, type Piece } from '../src/scene/outsideData.ts';
import { LID_CLOSED, LID_LIMIT, PropPhysics } from '../src/world/PropPhysics.ts';

async function outside(): Promise<OutsideData> {
  const data = await readFile(new URL('../public/models/outside.glb', import.meta.url));
  const loader = new GLTFLoader();
  loader.register(() => ({ name: 'EXT_texture_webp', loadTexture: () => Promise.resolve(new Texture()) }));
  const gltf = await loader.parseAsync(data.buffer.slice(data.byteOffset, data.byteOffset + data.length), '');
  return readOutside(gltf.scene);
}

const physicsFor = (pieces: readonly Piece[], data: OutsideData) => new PropPhysics(cannon, pieces, [], data.groundY);
const pins = (data: OutsideData) => data.props.filter((piece) => piece.group === 'bowling' && piece.shape.kind === 'cylinders');
const ball = (data: OutsideData) => data.props.find((piece) => piece.shape.kind === 'sphere')!;
const far = { x: 100, y: -0.12, z: 100 };

test('the playground: four arrow keys, ten pins in a triangle, a ball in front of them and stacked bricks', async () => {
  const data = await outside();
  const groups = Object.groupBy(data.props, (piece) => piece.group);
  assert.equal(groups.keys?.length, 4);
  assert.equal(groups.bowling?.length, 11);
  assert.ok((groups.bricks?.length ?? 0) >= 40, `${groups.bricks?.length} bricks`);
  for (const piece of data.props) {
    assert.ok(piece.parts.length >= 1 && piece.mass > 0, piece.name);
    assert.ok(piece.position.y > data.groundY, `${piece.name} above the ground`);
  }
  // A 4-3-2-1 triangle: the head pin nearest the ball, every row half a pin wider.
  const triangle = pins(data);
  assert.equal(triangle.length, 10);
  const target = ball(data).position;
  const distances = triangle.map((pin) => Math.hypot(pin.position.x - target.x, pin.position.z - target.z)).sort((a, b) => a - b);
  assert.ok(distances[0] > 3.5 && distances[0] < 6, `ball ${distances[0].toFixed(2)} m from the head pin`);
  for (const [a, b] of triangle.flatMap((pin, i) => triangle.slice(i + 1).map((other) => [pin, other]))) {
    assert.ok(Math.hypot(a.position.x - b.position.x, a.position.z - b.position.z) > 0.45, `${a.name} and ${b.name} apart`);
  }
  // Every piece of a kind shares one geometry.
  assert.equal(new Set(triangle.map((pin) => pin.parts[0].geometry)).size, 1);
  assert.equal(data.zones.map((zone) => zone.target).sort().join(), 'bowling,bricks,targets,tech');
  assert.deepEqual([...new Set(data.floors.map((floor) => floor.id))].sort(), ['about', 'bowling', 'controls', 'crossroads', 'footprints', 'intro', 'playarea', 'prints', 'targets', 'tech']);
});

test('pins and bricks stand still and asleep until something touches them', async () => {
  const data = await outside();
  const pieces = [...data.props];
  const physics = physicsFor(pieces, data);
  // Close to everything at once is impossible; wake the world near each stack and let it run.
  for (const piece of [pins(data)[0], ...data.props.filter((entry) => entry.group === 'bricks').filter((_, i) => i % 15 === 0)]) {
    for (let i = 0; i < 120; i++) physics.step(1 / 60, { x: piece.position.x + 1.3, y: data.groundY, z: piece.position.z + 1.3 });
  }
  assert.equal(physics.fallen(), 0);
  assert.equal(physics.active, false);
  for (const [index, body] of physics.bodies.entries()) {
    const rest = pieces[index].position;
    assert.ok(Math.hypot(body.position.x - rest.x, body.position.y - rest.y, body.position.z - rest.z) < 0.01, `${pieces[index].name} did not move`);
  }
});

test('the ball rolled at the pins knocks most of them down, and the reset zone stands them up again', async () => {
  const data = await outside();
  const bowling = data.props.filter((piece) => piece.group === 'bowling');
  const physics = physicsFor(bowling, data);
  const index = bowling.indexOf(ball(data));
  const head = pins(data).map((pin) => pin.position).sort((a, b) => a.distanceTo(ball(data).position) - b.distanceTo(ball(data).position))[0];
  const body = physics.bodies[index];
  const direction = new cannon.Vec3(head.x - body.position.x, 0, head.z - body.position.z);
  direction.normalize();
  body.wakeUp();
  body.velocity.set(direction.x * 7, 0, direction.z * 7);
  let knocked = 0;
  for (let i = 0; i < 60 * 6; i++) {
    physics.step(1 / 60, far);
    knocked = Math.max(knocked, physics.fallen(['bowling']));
  }
  assert.ok(knocked >= 5, `${knocked} pins knocked down`);
  physics.reset('bowling');
  assert.equal(physics.fallen(), 0);
  assert.equal(physics.active, false);
});

test('walking into a brick wall brings bricks down; resetting the bricks rebuilds it', async () => {
  const data = await outside();
  const bricks = data.props.filter((piece) => piece.group === 'bricks');
  const physics = physicsFor(bricks, data);
  // The first stack is the wall: walk through its middle along the screen-up direction.
  const wall = bricks.slice(0, 28);
  const centre = wall.reduce((sum, brick) => ({ x: sum.x + brick.position.x / wall.length, z: sum.z + brick.position.z / wall.length }), { x: 0, z: 0 });
  const heights = (count: number) => physics.bodies.slice(0, count).map((brick) => brick.position.y);
  const before = Math.max(...heights(28));
  const along = { x: -Math.SQRT1_2, z: -Math.SQRT1_2 };
  for (let i = 0; i < 60 * 4; i++) {
    const s = -2 + (i / 60) * 1.6;
    physics.step(1 / 60, { x: centre.x + along.x * s, y: data.groundY, z: centre.z + along.z * s });
  }
  for (let i = 0; i < 60 * 6; i++) physics.step(1 / 60, far);
  assert.ok(Math.max(...heights(28)) < before - 0.2, 'the top bricks came down');
  physics.reset('bricks');
  assert.ok(Math.abs(Math.max(...heights(28)) - before) < 1e-6);
  assert.equal(physics.active, false);
});

test('a thrown laptop flies, swings its lid within the hinge and knocks a pin over', async () => {
  const data = await outside();
  const bowling = data.props.filter((piece) => piece.group === 'bowling');
  const physics = physicsFor(bowling, data);
  const pin = pins(data)[0].position;
  // From 3 m in front of a pin, at shoulder height, towards it.
  const start = { x: pin.x + 2.1, y: data.groundY + 0.9, z: pin.z + 2.1 };
  const direction = { x: -Math.SQRT1_2, z: -Math.SQRT1_2 };
  const yaw = Math.atan2(direction.x, direction.z);
  const quaternion = new cannon.Quaternion().setFromEuler(0, yaw, 0);
  const laptop = physics.throwLaptop({ position: start, quaternion }, { x: direction.x * 5.5, y: 1.5, z: direction.z * 5.5 }, { x: 0, y: 1, z: 0 }, 6);
  let widest = 0;
  let lowest = Infinity;
  for (let i = 0; i < 60 * 6; i++) {
    physics.step(1 / 60, far);
    const angle = physics.lidAngle(laptop);
    widest = Math.max(widest, angle);
    lowest = Math.min(lowest, angle);
  }
  assert.ok(widest > 0.4, `the lid opened in flight (${widest.toFixed(2)} rad)`);
  // A hard landing may push it a little past the open stop for a moment; it settles back near it. It never
  // closes through the keys.
  assert.ok(widest < LID_LIMIT + 0.6 && lowest > LID_CLOSED - 0.005, `the hinge held: ${lowest.toFixed(2)} … ${widest.toFixed(2)}`);
  assert.ok(physics.lidAngle(laptop) < LID_LIMIT + 0.3, `resting at ${physics.lidAngle(laptop).toFixed(2)} rad`);
  // The hinge keeps the lid on the base's back edge.
  const gap = laptop.base.pointToWorldFrame(new cannon.Vec3(0, 0.011, 0.16)).distanceTo(laptop.lid.pointToWorldFrame(new cannon.Vec3(0, -0.006, 0.155)));
  assert.ok(gap < 0.03, `hinge gap ${gap.toFixed(3)} m`);
  assert.ok(physics.fallen(['bowling']) >= 1, 'a pin went down');
  assert.ok(laptop.base.position.y > data.groundY && laptop.base.position.y < data.groundY + 0.5, 'it lies on the ground');
  physics.reset();
  assert.equal(physics.laptops.length, 0, 'a full reset clears thrown laptops');
});
