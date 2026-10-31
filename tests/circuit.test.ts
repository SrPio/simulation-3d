import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { Texture, Vector3, type Mesh, type MeshStandardMaterial, type Object3D } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as cannon from 'cannon-es';
import { BREAK_SPEED, PropPhysics, type StaticBox } from '../src/world/PropPhysics.ts';
import { groundAt, rampHeight, readOutside, type OutsideData } from '../src/scene/outsideData.ts';
import { chairAt, driveStep, forwardSpeed, NITRO, PUSH, pushChair, strikeChair, SWAY, type DriveInput, type DriveWorld } from '../src/world/chairDrive.ts';
import { sweep, type Box2 } from '../src/world/collisions.ts';
import { CHARACTER_RADIUS } from '../src/character/CharacterController.ts';

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
  assert.ok(bytes < 340_000, `circuit.glb ${bytes} bytes`);
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
  assert.deepEqual(['ramp', 'jersey', 'sandbags', 'sack', 'tyres', 'arch', 'light', 'lapboard'].map(decor), [8, 6, 2, 2, 16, 2, 1, 1]);
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
const run = (state: ReturnType<typeof chairAt>, input: DriveInput, seconds: number, at: DriveWorld = flat) => {
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

/** The character walking at `speed` along +X from x = -1.5 into a free chair at the origin, as the viewer runs it. */
function walkInto(chair: ReturnType<typeof chairAt>, speed: number, seconds: number, at: DriveWorld = flat, offset = 0.1) {
  const block: Box2 = { name: 'OfficeChair', minX: 0, maxX: 0, minZ: 0, maxZ: 0 };
  let character = { x: -1.5, z: offset };
  let closest = Infinity;
  for (let t = 0; t < seconds; t += 1 / 60) {
    Object.assign(block, { minX: chair.x - PUSH.block, maxX: chair.x + PUSH.block, minZ: chair.z - PUSH.block, maxZ: chair.z + PUSH.block, yaw: chair.yaw });
    const from = character;
    character = sweep(character, { x: speed / 60, z: 0 }, CHARACTER_RADIUS, [block, ...at.boxes], at.floor);
    pushChair(chair, { ...character, vx: (character.x - from.x) * 60, vz: (character.z - from.z) * 60, radius: CHARACTER_RADIUS });
    const damping = Math.exp(-2.5 / 60);
    chair.vx *= damping;
    chair.vz *= damping;
    driveStep(chair, { throttle: 0, steer: 0, free: true }, 1 / 60, at);
    closest = Math.min(closest, Math.hypot(chair.x - character.x, chair.z - character.z));
  }
  return { character, closest };
}

test('the chair standing free is pushed out of the way by the character, rolling sideways too, and never tips', () => {
  // Facing +Z, pushed from its side along +X: the casters roll it that way, it keeps its heading and stays upright.
  const chair = chairAt(0, 0, 0);
  const { character, closest } = walkInto(chair, 1.6, 2);
  assert.ok(chair.x > 2, `rolled ahead of the character ${chair.x}`);
  assert.ok(character.x > 1.5, `the character kept walking ${character.x}`);
  assert.ok(closest > CHARACTER_RADIUS + PUSH.block - 1e-6, `never walked through it ${closest}`);
  assert.equal(chair.yaw, 0);
  assert.ok(Math.abs(chair.pitch) <= SWAY.limit * 1.5 && Math.abs(chair.roll) <= SWAY.limit * 1.5, 'upright');
  // Let go, it rolls to a stop.
  run(chair, { throttle: 0, steer: 0, free: true }, 6);
  assert.ok(Math.hypot(chair.vx, chair.vz) < 1e-6, 'comes to rest');
  // Pushed straight against a wall it can go no further and stops the character; a little off its middle, it slides along the wall out of the way.
  const walled: DriveWorld = { ...flat, boxes: [{ name: 'wall', minX: 1.2, maxX: 2, minZ: -5, maxZ: 5 }] };
  const stuck = chairAt(0, 0, 0);
  const pinned = walkInto(stuck, 1.6, 4, walled, 0);
  assert.ok(stuck.x < 1.2 - PUSH.radius + 1e-3, `held by the wall ${stuck.x}`);
  assert.ok(pinned.character.x < stuck.x - CHARACTER_RADIUS - PUSH.block + 1e-3, `the character is stopped by it ${pinned.character.x}`);
  const sliding = chairAt(0, 0, 0);
  const past = walkInto(sliding, 1.6, 4, walled, 0.2);
  assert.ok(sliding.z < -0.3 && past.closest > CHARACTER_RADIUS + PUSH.block - 1e-6, `slid aside ${sliding.z}`);
  // A kick sends it rolling along the blow; one too far away or too high misses.
  const kicked = chairAt(0, 0, 0);
  assert.ok(strikeChair(kicked, { x: -0.6, y: 0.3, z: 0 }, { x: 1, z: 0 }, 1));
  assert.ok(kicked.vx > 4 && Math.abs(kicked.vz) < 1e-9);
  assert.ok(!strikeChair(chairAt(0, 0, 0), { x: -2, y: 0.3, z: 0 }, { x: 1, z: 0 }, 1));
  assert.ok(!strikeChair(chairAt(0, 0, 0), { x: -0.6, y: 2, z: 0 }, { x: 1, z: 0 }, 1));
});

test('tyre walls follow the road, no two tyres start inside each other, the loose ones lie still and settle apart when knocked', async () => {
  const data = await world();
  const tyres = data.props.filter((piece) => piece.prop === 'tyre');
  const walls = data.decor.filter((item) => item.kind === 'tyres');
  assert.equal(tyres.length, 12);
  // Each tyre on the ground is a decor holding the shared tyre mesh (textured with the tread), four to a wall.
  const circuit = (await parse('circuit')).gltf.scene;
  circuit.updateMatrixWorld(true);
  // A tyre is two primitives (textured rubber, lettering): the loader makes a group of meshes sharing their geometry.
  const meshes = (object: Object3D) => {
    const found: Mesh[] = [];
    object.traverse((child) => { if ((child as Mesh).isMesh) found.push(child as Mesh); });
    return found;
  };
  const loose = meshes(circuit.getObjectByName(tyres[0].name)!);
  const shape = loose.map((part) => part.geometry);
  assert.ok(loose.some((part) => part.geometry.getAttribute('uv') && (part.material as MeshStandardMaterial).map), 'the tread is a texture');
  assert.equal(walls.length, 16);
  const grounded = walls.map((wall) => {
    const children = circuit.getObjectByName(wall.name)!.children;
    assert.equal(children.length, 1, wall.name);
    assert.deepEqual(meshes(children[0]).map((part) => part.geometry), shape, `${wall.name} shares the tyre`);
    return { name: wall.name, position: children[0].getWorldPosition(new Vector3()) };
  });
  const radius = tyres[0].half[0];
  const all = [...grounded, ...tyres.map((tyre) => ({ name: tyre.name, position: tyre.position }))];
  for (const [a, b] of all.flatMap((tyre, i) => all.slice(i + 1).map((other) => [tyre, other]))) {
    if (Math.abs(a.position.y - b.position.y) > 0.1) continue;
    assert.ok(Math.hypot(a.position.x - b.position.x, a.position.z - b.position.z) > 2 * radius - 0.02, `${a.name} and ${b.name} apart`);
  }
  // Each wall keeps its distance from the road's middle line along its length: it bends with the road.
  const road = data.floors.find((floor) => floor.id === 'circuit')!;
  for (let w = 0; w < 4; w++) {
    const distances = walls.slice(w * 4, w * 4 + 4).map((wall) => distanceToRoad(wall.position, road.targets));
    assert.ok(Math.max(...distances) - Math.min(...distances) < 0.1, `wall ${w} follows the road: ${distances.map((d) => d.toFixed(2)).join(' ')}`);
  }
  // The walls as the viewer makes them (decor `solid` boxes). Waking every tyre must not move it: they used to start
  // inside each other, and some fell through walls whose bounds the physics had worked out at the origin.
  const statics: StaticBox[] = walls.map((item) => {
    const [w, h, d] = item.solid!;
    return { center: { x: item.position.x, y: item.position.y + h / 2, z: item.position.z }, half: [w / 2, h / 2, d / 2], yaw: item.yaw };
  });
  const physics = new PropPhysics(cannon, tyres, statics, data.groundY);
  for (const body of physics.bodies) body.wakeUp();
  for (let i = 0; i < 120; i++) physics.step(1 / 60, { x: tyres[1].position.x + 1.5, y: data.groundY, z: tyres[1].position.z + 1.5 });
  for (const [index, body] of physics.bodies.entries()) {
    const rest = tyres[index].position;
    assert.ok(Math.hypot(body.position.x - rest.x, body.position.y - rest.y, body.position.z - rest.z) < 0.01, `${tyres[index].name} stays on its wall`);
  }
  // A hard knock along the wall: they bump and come to rest touching, not inside each other.
  const [a, b, c] = physics.bodies;
  const along = b.position.vsub(a.position);
  along.normalize();
  a.velocity.copy(along.scale(4));
  for (let i = 0; i < 300; i++) physics.step(1 / 60, { x: b.position.x + 1.5, y: data.groundY, z: b.position.z + 1.5 });
  for (const [p, q] of [[a, b], [b, c]]) assert.ok(Math.hypot(p.position.x - q.position.x, p.position.z - q.position.z) > 2 * radius - 0.03, 'apart at rest');
  assert.equal(physics.fallen(), 0);
});

test('sandbag walls are coffee sacks sharing one mesh and its printed jute texture', async () => {
  const data = await world();
  const walls = data.decor.filter((item) => item.kind === 'sandbags');
  const circuit = (await parse('circuit')).gltf.scene;
  const sacks = walls.flatMap((wall) => circuit.getObjectByName(wall.name)!.children as Mesh[]);
  assert.equal(sacks.length, 14);
  assert.equal(new Set(sacks.map((sack) => sack.geometry)).size, 1);
  const material = sacks[0].material as MeshStandardMaterial;
  assert.ok(material.map, 'the print');
  assert.ok(sacks[0].geometry.getAttribute('uv'), 'UVs for the print');
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

test('the soda nitro pushes the chair past its top speed until the bottles run dry, then they refill', () => {
  const plain = chairAt(0, 0, 0);
  const boosted = chairAt(0, 0, 0);
  run(plain, { throttle: 1, steer: 0 }, 0.15);
  run(boosted, { throttle: 1, steer: 0, nitro: true }, 0.15);
  assert.ok(boosted.pitch < plain.pitch - 0.05, 'lighting it kicks the seat back');
  run(plain, { throttle: 1, steer: 0 }, 2);
  run(boosted, { throttle: 1, steer: 0, nitro: true }, 2);
  assert.ok(forwardSpeed(boosted) > forwardSpeed(plain) + 1.5, `nitro ${forwardSpeed(boosted)} vs ${forwardSpeed(plain)}`);
  assert.ok(forwardSpeed(boosted) <= NITRO.maxSpeed + 1e-6);
  // It pushes even without the legs, and the fizz runs out after its burn time.
  const dry = chairAt(0, 0, 0);
  run(dry, { throttle: 0, steer: 0, nitro: true }, 0.5);
  assert.ok(dry.boosting && forwardSpeed(dry) > 2);
  run(dry, { throttle: 0, steer: 0, nitro: true }, NITRO.burn);
  assert.equal(dry.fuel, 0);
  assert.equal(dry.boosting, false, 'empty');
  // Held on, it does not light again until a little has refilled; let go, it fills back up.
  run(dry, { throttle: 0, steer: 0, nitro: false }, NITRO.refill * NITRO.restart * 0.5);
  run(dry, { throttle: 0, steer: 0, nitro: true }, 1 / 60);
  assert.equal(dry.boosting, false, 'not enough to relight');
  run(dry, { throttle: 0, steer: 0, nitro: false }, NITRO.refill);
  assert.equal(dry.fuel, 1);
});
