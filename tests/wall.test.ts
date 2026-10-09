import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import * as cannon from 'cannon-es';
import { Matrix4, Mesh, Texture, Vector3, type Object3D } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { GRAFFITI, surfaceFor } from '../src/scene/graffitiData.ts';
import { readOutside, type OutsideData } from '../src/scene/outsideData.ts';
import { PropPhysics } from '../src/world/PropPhysics.ts';

async function parse(file: string): Promise<Object3D> {
  const data = await readFile(new URL(`../public/models/${file}.glb`, import.meta.url));
  const loader = new GLTFLoader();
  loader.register(() => ({ name: 'EXT_texture_webp', loadTexture: () => Promise.resolve(new Texture()) }));
  return (await loader.parseAsync(data.buffer.slice(data.byteOffset, data.byteOffset + data.length), '')).scene;
}

/** The outside with the circuit read together, as the viewer does. */
async function world(): Promise<OutsideData> {
  const outside = await parse('outside');
  outside.add(await parse('circuit'));
  return readOutside(outside);
}

test('past the end of the circuit stand a brick wall with STOP sprayed on it and a stepped wall beside it, centred on the road', async () => {
  const data = await world();
  const bricks = data.props.filter((piece) => piece.group === 'wall');
  const across = bricks.filter((piece) => Math.abs(piece.position.z - 29) < 0.2);
  const beside = bricks.filter((piece) => Math.abs(piece.position.x + 9.6) < 0.2);
  assert.ok(across.length >= 70, `${across.length} bricks across the road`);
  assert.equal(beside.length, 15, 'a 5-4-3-2-1 pyramid');
  assert.ok(Math.max(...across.map((piece) => piece.position.y)) - data.groundY > 1.4, 'the wall stands above the character’s chest');
  assert.ok(!data.zones.some((zone) => zone.id === 'reset-wall'), 'no reset zone');
  // The road ends just past z 33: the wall stands beyond it, across where the road was heading.
  const end = data.floors.find((floor) => floor.id === 'circuit')!.targets.at(-1)!;
  assert.ok(Math.min(...across.map((piece) => piece.position.x)) < end.x && Math.max(...across.map((piece) => piece.position.x)) > end.x, 'across the road');
  assert.ok(Math.max(...across.map((piece) => piece.position.z)) < end.z, 'beyond its end');

  const spot = GRAFFITI.find((entry) => entry.id === 'wall-stop')!;
  assert.equal(spot.loose, 'wall');
  const meshes = bricks.map((piece) => {
    const mesh = new Mesh(piece.parts[0].geometry);
    mesh.matrixAutoUpdate = false;
    mesh.matrixWorld.copy(new Matrix4().compose(piece.position, piece.quaternion, new Vector3(1, 1, 1)));
    return mesh;
  });
  assert.ok(surfaceFor(spot, meshes, data.groundY), 'STOP lands on the bricks');
});

test('the wall comes down when the character walks into it and a reset puts it back', async () => {
  const data = await world();
  const pieces = data.props;
  const physics = new PropPhysics(cannon, pieces, [], data.groundY);
  const wall = pieces.map((piece, index) => ({ piece, index })).filter(({ piece }) => piece.group === 'wall' && Math.abs(piece.position.z - 29) < 0.2);
  // Walk through the middle of the wall from behind it.
  for (let step = 0; step < 240; step++) physics.step(1 / 60, { x: -3.95, y: data.groundY, z: 27.5 + step * 0.015 });
  const moved = wall.filter(({ piece, index }) => physics.bodies[index].position.distanceTo(piece.position as never) > 0.1);
  assert.ok(moved.length >= 5, `${moved.length} bricks knocked`);
  physics.reset('wall');
  for (const { piece, index } of wall) assert.ok(physics.bodies[index].position.distanceTo(piece.position as never) < 1e-6);
});

test('dashed dividers run across the playground between its games, clear of every piece and zone', async () => {
  const data = await world();
  const area = data.floors.find((floor) => floor.id === 'playarea')!;
  assert.equal(area.targets.length, 6, 'three dividers, two points each');
  const xs: number[] = [];
  for (let i = 0; i < area.targets.length; i += 2) {
    const [a, b] = [area.targets[i], area.targets[i + 1]];
    assert.equal(a.x, b.x, 'a divider runs along Z');
    assert.ok(Math.abs(b.z - a.z) > area.size[1] * 0.8, 'across the whole playground');
    xs.push(a.x);
  }
  const minZ = area.position.z - area.size[1] / 2;
  const maxZ = area.position.z + area.size[1] / 2;
  const inside = (point: { x: number; z: number }) => point.z > minZ && point.z < maxZ;
  for (const x of xs) {
    for (const piece of data.props.filter((entry) => inside(entry.position))) assert.ok(Math.abs(piece.position.x - x) > 0.8, `${piece.name} clear of ${x}`);
    for (const zone of data.zones.filter((entry) => inside(entry.position))) assert.ok(Math.abs(zone.position.x - x) > 1.2, `${zone.id} clear of ${x}`);
    for (const target of data.targets) assert.ok(Math.abs(target.position.x - x) > 1, `target ${target.index} clear of ${x}`);
  }
  // Each game on its own side: targets | bowling | bricks | tech.
  const lane = (group: string) => data.props.filter((entry) => entry.group === group && inside(entry.position)).map((entry) => entry.position.x);
  const between = (values: number[], lo: number, hi: number) => values.every((x) => x > lo && x < hi);
  assert.ok(between(data.targets.map((target) => target.position.x), -Infinity, xs[0]));
  assert.ok(between(lane('bowling'), xs[0], xs[1]));
  assert.ok(between(lane('bricks'), xs[1], xs[2]));
  assert.ok(between(lane('tech'), xs[2], Infinity));
});
