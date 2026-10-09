import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { Texture, Vector3 } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as cannon from 'cannon-es';
import { BREAK_SPEED, PropPhysics } from '../src/world/PropPhysics.ts';
import { groundAt, rampHeight, readOutside, type OutsideData } from '../src/scene/outsideData.ts';
import { chairAt, driveStep, forwardSpeed, SWAY, type DriveWorld } from '../src/world/chairDrive.ts';

async function parse(file: string) {
  const data = await readFile(new URL(`../public/models/${file}.glb`, import.meta.url));
  const loader = new GLTFLoader();
  loader.register(() => ({ name: 'EXT_texture_webp', loadTexture: () => Promise.resolve(new Texture()) }));
  return { bytes: data.length, gltf: await loader.parseAsync(data.buffer.slice(data.byteOffset, data.byteOffset + data.length), '') };
}

/** The outside with the circuit read together, as the viewer does. */
async function world(): Promise<OutsideData> {
  const outside = (await parse('outside')).gltf.scene;
  outside.add((await parse('circuit')).gltf.scene);
  return readOutside(outside);
}

const QUARTER = Math.PI / 2;
const onQuarter = (yaw: number) => Math.abs(Math.round(yaw / QUARTER) * QUARTER - yaw) < 1e-3;

function distanceToRoad(point: { x: number; z: number }, road: { x: number; z: number }[]): number {
  let best = Infinity;
  for (let i = 1; i < road.length; i++) {
    const a = road[i - 1];
    const b = road[i];
    const length = Math.hypot(b.x - a.x, b.z - a.z) || 1;
    const t = Math.max(0, Math.min(1, ((point.x - a.x) * (b.x - a.x) + (point.z - a.z) * (b.z - a.z)) / (length * length)));
    best = Math.min(best, Math.hypot(point.x - (a.x + (b.x - a.x) * t), point.z - (a.z + (b.z - a.z) * t)));
  }
  return best;
}

test('circuit.glb holds the circuit things, light enough, all by the road and turned in quarter turns', async () => {
  const { bytes } = await parse('circuit');
  assert.ok(bytes < 300_000, `circuit.glb ${bytes} bytes`);
  const data = await world();
  const road = data.floors.find((floor) => floor.id === 'circuit')!;
  assert.equal(road.gap, 5);
  const pieces = data.props.filter((piece) => piece.group === 'circuit');
  const count = (kind: string) => pieces.filter((piece) => piece.name.startsWith(`Circuit_${kind}_`)).length;
  assert.deepEqual(
    ['pallet', 'brick', 'cone', 'drum', 'pipe', 'barrow', 'leg', 'plank', 'metal', 'tyre', 'chevron', 'works'].map(count),
    [10, 12, 13, 6, 2, 1, 12, 18, 4, 12, 6, 1],
  );
  const decor = (kind: string) => data.decor.filter((item) => item.kind === kind).length;
  assert.deepEqual(['ramp', 'jersey', 'sandbags', 'tyres', 'arch', 'light', 'lapboard'].map(decor), [8, 6, 2, 4, 2, 1, 1]);
  assert.equal(data.ramps.length, 8);
  assert.equal(data.tapes.length, 4);
  assert.ok(data.chair && data.lapBoard && data.trafficLight, 'chair, lap board and traffic light');
  assert.equal(data.floors.filter((floor) => floor.id === 'checker').length, 2);
  assert.equal(data.floors.filter((floor) => floor.id === 'chairhint').length, 1);
  assert.ok(data.zones.some((zone) => zone.id === 'reset-circuit'), 'reset zone');
  const zones = data.floors.filter((floor) => floor.id === 'about' || floor.id === 'playarea');
  const things = [
    ...pieces.map((piece) => ({ name: piece.name, position: piece.position, yaw: Math.atan2(-new Vector3(1, 0, 0).applyQuaternion(piece.quaternion).z, new Vector3(1, 0, 0).applyQuaternion(piece.quaternion).x) })),
    ...data.decor.filter((item) => item.name.startsWith('Circuit_') || item.name.startsWith('Arch_') || ['TrafficLight', 'LapBoard'].includes(item.name)),
  ];
  assert.ok(things.length > 100, `${things.length} things`);
  for (const thing of things) {
    assert.ok(distanceToRoad(thing.position, road.targets) <= road.gap / 2 + 4, `${thing.name} by the road`);
    assert.ok(onQuarter(thing.yaw), `${thing.name} yaw ${thing.yaw}`);
    for (const zone of zones) {
      const inside = Math.abs(thing.position.x - zone.position.x) < zone.size[0] / 2 && Math.abs(thing.position.z - zone.position.z) < zone.size[1] / 2;
      assert.ok(!inside, `${thing.name} in ${zone.id}`);
    }
  }
});

test('the office chair stands at the start with its seat as high as the room chair, so the chair clips fit', async () => {
  const data = await world();
  const room = (await parse('room')).gltf.scene;
  room.updateMatrixWorld(true);
  const roomSeat = room.getObjectByName('Anchor_ChairSeat')!.getWorldPosition(new Vector3()).y;
  const chair = data.chair!;
  const seat = chair.object.getObjectByName('OfficeChair_Seat')!.getWorldPosition(new Vector3()).y;
  assert.ok(Math.abs(seat - chair.position.y - roomSeat) < 0.01, `seat ${seat - chair.position.y} vs ${roomSeat}`);
  assert.equal(chair.object.getObjectByName('OfficeChair_Seat')!.userData.stand_offset, 0.2);
  for (const name of ['ChairBase', 'ChairUpper', ...[0, 1, 2, 3, 4].flatMap((k) => [`ChairCaster_${k}`, `ChairWheel_${k}`])]) assert.ok(chair.object.getObjectByName(name), name);
  // It faces along the road, just before the start line, with the painted arrow behind it pointing at it.
  const start = data.floors.filter((floor) => floor.id === 'checker').sort((a, b) => a.position.distanceTo(chair.position) - b.position.distanceTo(chair.position))[0];
  const forward = { x: Math.sin(chair.yaw), z: Math.cos(chair.yaw) };
  assert.ok((start.position.x - chair.position.x) * forward.x + (start.position.z - chair.position.z) * forward.z > 1, 'the start line is ahead');
  const hint = data.floors.find((floor) => floor.id === 'chairhint')!;
  assert.ok(Math.hypot(hint.targets[0].x - chair.position.x, hint.targets[0].z - chair.position.z) < 0.01, 'the arrow points at the chair');
  assert.ok((chair.position.x - hint.position.x) * forward.x + (chair.position.z - hint.position.z) * forward.z > 1.5, 'the arrow lies behind it');
});

test('ramps raise the ground along their local +Z, bumps rise and fall', async () => {
  const data = await world();
  const up = data.ramps.find((ramp) => ramp.profile === 'up')!;
  const along = (ramp: typeof up, t: number) => ({ x: ramp.position.x + Math.sin(ramp.yaw) * ramp.length * (t - 0.5), z: ramp.position.z + Math.cos(ramp.yaw) * ramp.length * (t - 0.5) });
  assert.ok(rampHeight(along(up, 0.02), up) < 0.05);
  assert.ok(Math.abs(rampHeight(along(up, 0.98), up) - up.height * 0.98) < 1e-6);
  assert.ok(Math.abs(groundAt(along(up, 0.5), data) - (data.groundY + up.height / 2)) < 1e-6, 'groundAt includes the ramp');
  const bump = data.ramps.find((ramp) => ramp.profile === 'bump')!;
  assert.ok(rampHeight(along(bump, 0.5), bump) > rampHeight(along(bump, 0.1), bump));
});

const flat: DriveWorld = { boxes: [], floor: { minX: -100, maxX: 100, minZ: -100, maxZ: 100 }, ground: () => 0 };
const run = (state: ReturnType<typeof chairAt>, input: { throttle: number; steer: number }, seconds: number, at: DriveWorld = flat) => {
  for (let t = 0; t < seconds; t += 1 / 60) driveStep(state, input, 1 / 60, at);
};

test('the chair drives like a small wheeled vehicle: speed limits, braking, reversing and speed-dependent steering', () => {
  const chair = chairAt(0, 0, 0);
  run(chair, { throttle: 1, steer: 0 }, 4);
  assert.ok(forwardSpeed(chair) > 5 && forwardSpeed(chair) <= 5.5 + 1e-6, `top speed ${forwardSpeed(chair)}`);
  assert.ok(chair.z > 10 && Math.abs(chair.x) < 1e-6, 'straight along its heading (+Z at yaw 0)');
  run(chair, { throttle: -1, steer: 0 }, 0.8);
  assert.ok(forwardSpeed(chair) < 0.5, `braked ${forwardSpeed(chair)}`);
  run(chair, { throttle: -1, steer: 0 }, 4);
  assert.ok(forwardSpeed(chair) < -1.5 && forwardSpeed(chair) >= -2.2 - 1e-6, `reverse ${forwardSpeed(chair)}`);
  const parked = chairAt(0, 0, 0);
  run(parked, { throttle: 0, steer: 1 }, 1);
  const moving = chairAt(0, 0, 0);
  run(moving, { throttle: 1, steer: 0 }, 2);
  const before = moving.yaw;
  run(moving, { throttle: 1, steer: 1 }, 1);
  assert.ok(parked.yaw > 0 && parked.yaw < 0.7, `swivel standing ${parked.yaw}`);
  assert.ok(moving.yaw - before > 1.5, `turn rolling ${moving.yaw - before}`);
  assert.ok(moving.x > 0, 'A turns left: towards +X when heading +Z');
  const coasting = chairAt(0, 0, 0);
  run(coasting, { throttle: 1, steer: 0 }, 2);
  run(coasting, { throttle: 0, steer: 0 }, 8);
  assert.ok(Math.abs(forwardSpeed(coasting)) < 1e-6, 'rolls to a stop');
});

test('the seat sways back when speeding up, forward when braking, and settles', () => {
  const chair = chairAt(0, 0, 0);
  let back = 0;
  for (let t = 0; t < 0.5; t += 1 / 60) {
    driveStep(chair, { throttle: 1, steer: 0 }, 1 / 60, flat);
    back = Math.min(back, chair.pitch);
  }
  assert.ok(back < -0.05, `leans back ${back}`);
  run(chair, { throttle: 1, steer: 0 }, 3);
  assert.ok(Math.abs(chair.pitch) < 0.02, `settles at speed ${chair.pitch}`);
  let forward = 0;
  for (let t = 0; t < 0.6; t += 1 / 60) {
    driveStep(chair, { throttle: -1, steer: 0 }, 1 / 60, flat);
    forward = Math.max(forward, chair.pitch);
  }
  assert.ok(forward > 0.1 && forward <= SWAY.limit * 1.5, `leans forward ${forward}`);
  run(chair, { throttle: 0, steer: 0 }, 4);
  assert.ok(Math.abs(chair.pitch) < 0.01 && Math.abs(chair.pitchRate) < 0.05, 'and comes to rest');
});

test('the chair flies off a ramp and lands, and slides along walls instead of passing them', () => {
  const ramp = { position: new Vector3(0, 0, 3), yaw: 0, length: 2.6, width: 2.6, height: 0.9, profile: 'up' as const };
  const jump: DriveWorld = { ...flat, ground: (x, z) => rampHeight({ x, z }, ramp) };
  const chair = chairAt(0, 0, 0);
  let flew = false;
  let top = 0;
  for (let t = 0; t < 3; t += 1 / 60) {
    driveStep(chair, { throttle: 1, steer: 0 }, 1 / 60, jump);
    flew ||= chair.airborne;
    top = Math.max(top, chair.y);
  }
  assert.ok(flew, 'airborne off the top');
  assert.ok(top > 0.9, `flies above the ramp ${top}`);
  assert.ok(!chair.airborne && chair.y === 0, 'lands');
  const walled: DriveWorld = { ...flat, boxes: [{ name: 'wall', minX: -5, maxX: 5, minZ: 2, maxZ: 3 }] };
  const blocked = chairAt(0, 0, 0.3);
  run(blocked, { throttle: 1, steer: 0 }, 3, walled);
  assert.ok(blocked.z < 2 - 0.4, `stopped by the wall ${blocked.z}`);
  assert.ok(blocked.x > 0.3, `slid along it ${blocked.x}`);
});

test('a wooden fence holds together when the character runs into it and breaks into planks when the chair hits it fast', async () => {
  const data = await world();
  const fence = data.props.filter((piece) => piece.joint === 'WoodFence_0');
  assert.equal(fence.length, 5);
  const legs = fence.filter((piece) => piece.half[1] > 0.3);
  const centre = legs[0].position.clone().add(legs[1].position).multiplyScalar(0.5);
  const across = new Vector3(0, 0, 1).applyQuaternion(fence.find((piece) => piece.half[1] < 0.3)!.quaternion);
  const physics = new PropPhysics(cannon, fence, [], data.groundY);
  assert.equal(physics.joints.length, 6);
  assert.equal(physics.broken, 0);
  // Running (3.2 m/s) through where it stands.
  for (let t = 0; t < 3; t += 1 / 60) {
    const s = -2 + 3.2 * t;
    physics.step(1 / 60, { x: centre.x + across.x * s, y: data.groundY, z: centre.z + across.z * s });
  }
  assert.equal(physics.broken, 0, 'running into it does not break it');
  physics.reset();
  // The chair at full speed.
  const yaw = Math.atan2(across.x, across.z);
  for (let t = 0; t < 1.5; t += 1 / 60) {
    const s = -3 + 5.5 * t;
    physics.step(1 / 60, undefined, { x: centre.x + across.x * s, y: data.groundY, z: centre.z + across.z * s, yaw });
  }
  assert.ok(physics.broken > 0, `the chair breaks it (${physics.broken} locks, at ${BREAK_SPEED} m/s)`);
  physics.reset();
  assert.equal(physics.broken, 0, 'a reset puts it back together');
});
