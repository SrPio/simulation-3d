import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import * as cannon from 'cannon-es';
import { Texture } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { readOutside, type OutsideData } from '../src/scene/outsideData.ts';
import { PropPhysics, type PieceBody } from '../src/world/PropPhysics.ts';

async function outside(): Promise<OutsideData> {
  const data = await readFile(new URL('../public/models/outside.glb', import.meta.url));
  const loader = new GLTFLoader();
  loader.register(() => ({ name: 'EXT_texture_webp', loadTexture: () => Promise.resolve(new Texture()) }));
  const gltf = await loader.parseAsync(data.buffer.slice(data.byteOffset, data.byteOffset + data.length), '');
  return readOutside(gltf.scene);
}

const bodies = (data: OutsideData): PieceBody[] => data.letters.map((letter) => ({
  position: letter.position, quaternion: letter.quaternion, half: letter.half,
}));

test('the name: one standing letter per character of ANDRES JARAMILLO, on the outside ground', async () => {
  const data = await outside();
  const name = data.letters.filter((letter) => letter.word === 'name');
  const chars = name.map((letter) => letter.name.split('_')[2]).join('');
  assert.equal(chars, 'ANDRESJARAMILLO');
  for (const letter of name) {
    const [w, h, d] = letter.half.map((half) => half * 2);
    assert.ok(h > 0.5 && h < 0.7, `${letter.name}: height ${h}`);
    assert.ok(w > 0.05 && w < 0.8 && d > 0.15 && d < 0.3, `${letter.name}: ${w} x ${d}`);
    assert.ok(Math.abs(letter.position.y - h / 2 - data.groundY) < 0.01, `${letter.name} stands on the ground`);
    assert.ok(letter.position.x > 3.2 || letter.position.z > 3.2, `${letter.name} is outside the room`);
    const triangles = (letter.geometry.index?.count ?? letter.geometry.getAttribute('position').count) / 3;
    assert.ok(triangles < 800, `${letter.name}: ${triangles} triangles`);
  }
  // In a row along +X in front of the room (+Z), reading left to right on screen (screen-right is +X -Z).
  for (const letter of name) assert.ok(letter.position.z > 4 && letter.position.x < -1, `${letter.name} left of the room's front`);
  const along = name.map((letter) => letter.position.x - letter.position.z);
  assert.deepEqual([...along].sort((a, b) => a - b), along);
});

test('the tagline: "<Developer />" pieces lie flat in front of the name, smaller than its letters', async () => {
  const data = await outside();
  const name = data.letters.filter((letter) => letter.word === 'name');
  const tag = data.letters.filter((letter) => letter.word === 'tag');
  assert.equal(tag.length, 12, 'one piece per visible character of <Developer />');
  const capHeight = Math.min(...name.map((letter) => letter.half[1] * 2));
  for (const piece of tag) {
    const [w, h, d] = piece.half.map((half) => half * 2);
    assert.ok(h < 0.12, `${piece.name} lies flat: ${h} m thick`);
    // Letters are shorter than the name's capitals; only the slash reaches about the same height.
    assert.ok(d < capHeight * (piece.name === 'Tag_10' ? 1.1 : 0.85) && w < 0.4, `${piece.name} smaller than the name: ${w} x ${d}`);
    assert.ok(Math.abs(piece.position.y - h / 2 - data.groundY) < 0.01, `${piece.name} rests on the ground`);
    assert.ok(piece.position.z > Math.max(...name.map((letter) => letter.position.z)) + 0.4, `${piece.name} in front of the name`);
  }
  const xs = tag.map((piece) => piece.position.x);
  assert.deepEqual([...xs].sort((a, b) => a - b), xs, 'reads left to right');
});

test('letters stay standing and asleep without contact, and the world is skipped far from them', async () => {
  const data = await outside();
  const physics = new PropPhysics(cannon, bodies(data), [], data.groundY);
  assert.equal(physics.step(1 / 60, { x: 0, y: 0, z: 0 }), false, 'nothing near or awake: skipped');
  const first = data.letters[0].position;
  // Close by but not touching: the world steps, nothing moves.
  for (let i = 0; i < 60 * 5; i++) physics.step(1 / 60, { x: first.x + 1.2, y: data.groundY, z: first.z + 1.2 });
  assert.equal(physics.fallen(), 0);
  assert.equal(physics.active, false);
  for (const [index, body] of physics.bodies.entries()) {
    assert.ok(body.position.distanceTo(new cannon.Vec3(data.letters[index].position.x, data.letters[index].position.y, data.letters[index].position.z)) < 1e-6);
  }
});

test('the character walking through the name knocks letters over, and reset stands them up again', async () => {
  const data = await outside();
  const physics = new PropPhysics(cannon, bodies(data), [], data.groundY);
  // Walk from the front through the middle letters (towards -Z), at walking speed.
  const target = data.letters[7].position;
  const direction = { x: 0, z: -1 };
  let fallen = 0;
  for (let i = 0; i < 60 * 6; i++) {
    const t = i / 60;
    const s = -2 + t * 0.8;
    physics.step(1 / 60, { x: target.x + direction.x * s, y: data.groundY, z: target.z + direction.z * s });
    fallen = Math.max(fallen, physics.fallen());
  }
  assert.ok(fallen >= 1, `fallen letters: ${fallen}`);
  // They settle and fall asleep again once the character has gone.
  for (let i = 0; i < 60 * 8; i++) physics.step(1 / 60, { x: 30, y: data.groundY, z: 30 });
  assert.equal(physics.active, false, 'asleep again');
  for (const body of physics.bodies) assert.ok(body.position.y > data.groundY, 'nothing sank into the ground');
  physics.reset();
  assert.equal(physics.fallen(), 0);
  assert.equal(physics.active, false);
});

test('reset with the character among the letters and something still moving: the character goes back without sweeping the letters', async () => {
  const data = await outside();
  const physics = new PropPhysics(cannon, bodies(data), [], data.groundY);
  const target = data.letters[7].position;
  // Where the browser test stands after walking through the name: in front of it, with the spawn behind the letters.
  const among = { x: -3.7, y: data.groundY, z: 6.2 };
  for (let i = 0; i < 30; i++) physics.step(1 / 60, among);
  // A laptop still in the air elsewhere keeps the world awake through the reset.
  physics.reset();
  physics.throwLaptop({ position: { x: target.x + 8, y: data.groundY + 2, z: target.z }, quaternion: new cannon.Quaternion() }, { x: 0, y: 3, z: 0 }, { x: 0, y: 0, z: 0 });
  const spawn = { x: 2.3, y: 0, z: 2.3 };
  for (let i = 0; i < 60; i++) physics.step(1 / 60, spawn);
  assert.equal(physics.fallen(['name', 'tag']), 0, 'the letters stand where they were put back');
});
