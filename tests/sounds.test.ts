import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { test } from 'node:test';
import { Texture } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { pieceSound } from '../src/audio/pieceSounds.ts';
import { SOUND_FILES } from '../src/audio/soundFiles.ts';
import { SOUNDS, distanceGain, soundGain } from '../src/audio/Sounds.ts';
import { readOutside } from '../src/scene/outsideData.ts';

test('impacts are silent below their threshold and grow louder with speed up to a ceiling', () => {
  const brick = SOUNDS.brick;
  assert.equal(soundGain(brick, brick.velocityMin - 0.1), 0);
  let previous = 0;
  for (let speed = brick.velocityMin; speed < 12; speed += 0.5) {
    const gain = soundGain(brick, speed);
    assert.ok(gain >= previous && gain > 0, `louder at ${speed}`);
    previous = gain;
  }
  assert.equal(previous, brick.volume[1] ** 2, 'capped');
  // A fixed sound plays at its one volume whatever it is given.
  assert.equal(soundGain(SOUNDS.zone, 0), SOUNDS.zone.volume[0] ** 2);
  assert.equal(soundGain(SOUNDS.zone, 5), SOUNDS.zone.volume[0] ** 2);
});

test('sounds fade with distance from the character and stop far away', () => {
  assert.equal(distanceGain(0), 1);
  assert.equal(distanceGain(5), 1);
  assert.ok(distanceGain(15) < distanceGain(10) && distanceGain(10) < 1);
  assert.equal(distanceGain(40), 0);
});

test('every recorded sound has its files and settings, within a small budget', () => {
  let bytes = 0;
  for (const [name, files] of Object.entries(SOUND_FILES)) {
    assert.ok(name in SOUNDS, `${name} has settings`);
    assert.ok(files.length > 0);
    for (const file of files) {
      const url = new URL(`../public/sounds/${file}`, import.meta.url);
      assert.ok(existsSync(url), file);
      bytes += statSync(url).size;
    }
  }
  assert.ok(bytes < 500 * 1024, `${(bytes / 1024).toFixed(0)} KB`);
  for (const def of Object.values(SOUNDS)) {
    assert.ok(def.volume[0] <= def.volume[1] && def.volume[1] <= 1 && def.rate[0] <= def.rate[1] && def.rate[0] > 0);
  }
});

test('each loose piece outside and on the circuit sounds of what it is made of', async () => {
  const loader = new GLTFLoader();
  loader.register(() => ({ name: 'EXT_texture_webp', loadTexture: () => Promise.resolve(new Texture()) }));
  const load = async (file: string) => {
    const data = readFileSync(new URL(`../public/models/${file}`, import.meta.url));
    return (await loader.parseAsync(data.buffer.slice(data.byteOffset, data.byteOffset + data.length), '')).scene;
  };
  const outside = await load('outside.glb');
  outside.add(await load('circuit.glb'));
  const data = readOutside(outside);
  const heard = new Map<string, string>();
  for (const piece of [...data.letters, ...data.props]) heard.set(`${piece.group}/${piece.prop ?? '-'}`, pieceSound(piece));
  assert.equal(heard.get('name/-'), 'stone');
  assert.equal(heard.get('bricks/brick'), 'brick');
  assert.equal(heard.get('wall/brick'), 'brick');
  assert.equal(heard.get('bowling/pin'), 'pin');
  assert.equal(heard.get('bowling/ball'), 'ball');
  assert.equal(heard.get('decor/box'), 'cardboard');
  assert.equal(heard.get('circuit/pallet'), 'wood');
  assert.equal(heard.get('circuit/plank'), 'wood');
  assert.equal(heard.get('circuit/drum'), 'metal');
  assert.equal(heard.get('circuit/tyre'), 'rubber');
  assert.equal(heard.get('circuit/cone'), 'plastic');
  for (const [kind, sound] of heard) assert.ok(sound in SOUND_FILES, `${kind} → ${sound}`);
});
