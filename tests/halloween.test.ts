import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { test } from 'node:test';
import * as cannon from 'cannon-es';
import { Box3, Mesh, Raycaster, Texture, Vector3, type Object3D } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { halloweenMode, isHalloweenSeason } from '../src/core/halloween.ts';
import { dressPieces, takeHalloween } from '../src/scene/halloweenDress.ts';
import { readOutside } from '../src/scene/outsideData.ts';
import { GRAFFITI, GRAFFITI_SYMBOLS, HALLOWEEN_GRAFFITI, graffitiForHalloween, surfaceFor, textFor } from '../src/scene/graffitiData.ts';
import { SPRAY_SYMBOLS, sprayGlyph } from '../src/scene/sprayFont.ts';
import { CANDY, MAX_CANDIES, PropPhysics } from '../src/world/PropPhysics.ts';
import { GHOST, fleeStep, ghostAt } from '../src/world/ghosts.ts';
import { InteractionController } from '../src/interactions/InteractionController.ts';
import { BOTTLE_UNITS, bottlePath } from '../src/ui/bottle.ts';
import { shardStep, shardsOf } from '../src/scene/CandyBurst.ts';
import { seeded } from '../src/scene/graffitiData.ts';

async function parse(file: string): Promise<Object3D> {
  const data = await readFile(new URL(`../public/models/${file}.glb`, import.meta.url));
  const loader = new GLTFLoader();
  loader.register(() => ({ name: 'EXT_texture_webp', loadTexture: () => Promise.resolve(new Texture()) }));
  return (await loader.parseAsync(data.buffer.slice(data.byteOffset, data.byteOffset + data.length), '')).scene;
}

test('Halloween is on from 1 October to 5 November of every year, and ?halloween forces it either way', () => {
  const day = (year: number, month: number, date: number) => new Date(year, month - 1, date, 12);
  assert.equal(isHalloweenSeason(day(2026, 9, 30)), false);
  assert.equal(isHalloweenSeason(day(2026, 10, 1)), true);
  assert.equal(isHalloweenSeason(day(2026, 10, 31)), true);
  assert.equal(isHalloweenSeason(day(2027, 11, 5)), true);
  assert.equal(isHalloweenSeason(day(2027, 11, 6)), false);
  assert.equal(isHalloweenSeason(day(2027, 3, 15)), false);
  assert.equal(halloweenMode('', day(2026, 10, 29)), true);
  assert.equal(halloweenMode('?halloween=0', day(2026, 10, 29)), false);
  assert.equal(halloweenMode('?halloween=off&cine', day(2026, 10, 29)), false);
  assert.equal(halloweenMode('?halloween=1', day(2026, 6, 1)), true);
  assert.equal(halloweenMode('?halloween', day(2026, 6, 1)), true);
  assert.equal(halloweenMode('?cine', day(2026, 6, 1)), false);
});

test('halloween.glb: its world, the mask, the cauldron and the library, within its size budget', async () => {
  const size = (await stat(new URL('../public/models/halloween.glb', import.meta.url))).size;
  assert.ok(size < 800_000, `${size} bytes`);
  const dress = takeHalloween(await parse('halloween'));
  assert.ok(dress.mask, 'the hockey mask');
  assert.ok(dress.cauldron, 'the cauldron');
  for (const side of ['right', 'left']) {
    for (const name of [`CauldronGrip_${side}`, `CauldronTubeLiquid_${side}`, `CauldronTubeCork_${side}`, `CauldronNozzle_${side}`]) {
      assert.ok(dress.cauldron.getObjectByName(name), name);
    }
  }
  assert.ok(dress.brew.height > 0.8 && dress.brew.height < 1.1, `the brew at ${dress.brew.height} m`);
  for (const name of ['Halloween_Pin', 'Halloween_Ball', 'Halloween_Brick0', 'Halloween_Brick1', 'Halloween_Brick2', 'ThrownPumpkin', 'PumpkinShard',
    'Candy_Wrapped', 'Candy_Lollipop', 'Candy_Gummy', 'Bat', 'Ghost']) assert.ok(dress.library.has(name), name);
  // The test tubes lie along the cauldron's sides, mouths backwards; their brew empties down to the bottom of the tube
  // like the cola in the chair's bottles: its origin at the bottom of the tube's inside, its level along local +Y.
  const liquid = dress.cauldron.getObjectByName('CauldronTubeLiquid_left') as Mesh;
  const box = new Box3().setFromBufferAttribute(liquid.geometry.getAttribute('position') as never);
  assert.ok(box.min.y > -0.01 && box.max.y > 0.08 && box.max.y < 0.15, 'the brew rises from its origin along +Y');
  assert.ok(box.max.z - box.min.z > 0.3, 'lying along the tube');
  const nozzle = dress.cauldron.getObjectByName('CauldronNozzle_left')!.position;
  const cork = dress.cauldron.getObjectByName('CauldronTubeCork_left')!.position;
  assert.ok(nozzle.z < cork.z - 0.03 && Math.abs(nozzle.y - cork.y) < 0.01, 'the mouth points backwards, level');
});

test('the world of halloween.glb reads as loose pumpkins, spiders and graves, a graveyard fence and cobwebs', async () => {
  const outside = await parse('outside');
  const dress = takeHalloween(await parse('halloween'));
  outside.add(dress.world);
  const data = readOutside(outside);
  const pieces = data.props.filter((piece) => piece.group === 'halloween');
  const count = (prop: string) => pieces.filter((piece) => piece.prop === prop).length;
  assert.ok(count('pumpkin') >= 12, `${count('pumpkin')} pumpkins`);
  assert.ok(count('spider') >= 4, `${count('spider')} spiders`);
  assert.equal(count('grave'), 5);
  for (const piece of pieces) {
    assert.ok(piece.mass > 0 && piece.half.every((half) => half > 0.05), `${piece.name}: a body`);
    assert.ok(piece.position.y > data.groundY && piece.position.y - piece.half[1] < data.groundY + 0.05, `${piece.name}: standing on the ground`);
    assert.ok(Math.abs(piece.position.x) > 3.1 || Math.abs(piece.position.z) > 3.1, `${piece.name}: outside the room`);
  }
  assert.ok(data.decor.some((item) => item.kind === 'graveyard' && item.solid), 'the fence stops pieces');
  assert.ok(dress.world.getObjectByName('Cobweb_Room'), 'a cobweb in the room corner');
});

test('the dressed pin, ball and bricks have the sizes of the pieces they dress', async () => {
  const outside = await parse('outside');
  const dress = takeHalloween(await parse('halloween'));
  const pieces = readOutside(outside).props.filter((piece) => ['pin', 'ball', 'brick'].includes(piece.prop ?? ''));
  const before = pieces.map((piece) => new Box3().setFromBufferAttribute(piece.parts[0].geometry.getAttribute('position') as never));
  dressPieces(pieces, dress);
  for (const [k, piece] of pieces.entries()) {
    const after = new Box3();
    for (const part of piece.parts) after.union(new Box3().setFromBufferAttribute(part.geometry.getAttribute('position') as never));
    for (const axis of ['x', 'y', 'z'] as const) {
      assert.ok(Math.abs(after.min[axis] - before[k].min[axis]) < 0.03 && Math.abs(after.max[axis] - before[k].max[axis]) < 0.03, `${piece.name} ${axis}`);
    }
    assert.ok(piece.parts.every((part) => part.map && part.geometry.getAttribute('uv')), `${piece.name}: textured from the atlas`);
  }
});

test('the hockey mask covers the whole face and the cap, clear of both, its strap round the back of the head', async () => {
  const character = await parse('developer-v4-interactions');
  const dress = takeHalloween(await parse('halloween'));
  const mask = dress.mask!;
  character.updateMatrixWorld(true);
  mask.updateMatrixWorld(true);
  const head: Object3D[] = [];
  character.traverse((object) => {
    if (object instanceof Mesh && /^(Head|Beard|Moustache|Lips|Eyebrows|Hair|Sphere|Cap)/.test(object.name)) head.push(object);
  });
  assert.ok(head.length >= 3, 'the head meshes');
  const ray = new Raycaster();
  let checked = 0;
  for (let x = -0.16; x <= 0.16; x += 0.04) {
    for (let y = 1.98; y <= 2.6; y += 0.04) {
      ray.set(new Vector3(x, y, 2), new Vector3(0, 0, -1));
      const shell = ray.intersectObject(mask, true)[0];
      const face = ray.intersectObjects(head, true)[0];
      if (!shell || !face) continue;
      // The front of the shell is the first hit; its back is 7 mm behind it, still clear of the face.
      assert.ok(shell.point.z - 0.007 > face.point.z + 0.005, `clear of the face at ${x.toFixed(2)}, ${y.toFixed(2)}: ${(shell.point.z - face.point.z).toFixed(3)} m`);
      checked++;
    }
  }
  assert.ok(checked > 60, `${checked} points checked`);
  // From the chin to the top of the cap.
  const size = new Box3().setFromObject(mask);
  assert.ok(size.min.y < 1.95 && size.max.y > 2.6, `${size.min.y.toFixed(2)} … ${size.max.y.toFixed(2)} m`);
  const strap: number[] = [];
  mask.traverse((object) => {
    if (!(object instanceof Mesh) || (object.material as { name: string }).name !== 'MaskStrap') return;
    const box = new Box3().setFromObject(object);
    strap.push(box.max.y, box.min.z);
  });
  assert.ok(strap.length, 'the strap');
  assert.ok(strap[0] < 2.4, `the strap stays low on the head (top ${strap[0].toFixed(2)} m)`);
  assert.ok(strap[1] < -0.15, 'it goes round the back of the head');
});

test('a thrown pumpkin bursts on the ground into candies that can be kicked; past the cap the oldest go', () => {
  const groundY = 0;
  const physics = new PropPhysics(cannon, [], [], groundY);
  const pumpkin = physics.throwPumpkin({ x: 0, y: 2, z: 0 }, { x: 3, y: 1, z: 0 }, { x: 0, y: 0, z: 0 });
  for (let i = 0; i < 120 && physics.pumpkins.length; i++) physics.step(1 / 60, undefined);
  assert.equal(physics.pumpkins.length, 0, 'burst');
  assert.ok(!physics.world.bodies.includes(pumpkin.body), 'its body left the world');
  assert.equal(physics.smashed.length, 1);
  assert.ok(physics.smashed[0].position.x > 0.3, 'it burst where it landed, ahead of where it left');
  assert.equal(physics.candies.length, CANDY.count);
  for (let i = 0; i < 180; i++) physics.step(1 / 60, undefined);
  for (const candy of physics.candies) assert.ok(candy.position.y > groundY - 0.01 && candy.position.y < groundY + 0.3, 'candies lie on the ground');
  const candy = physics.candies[0];
  const before = candy.position.clone();
  physics.strike({ x: before.x - 0.6, z: before.z }, { x: before.x - 0.1, y: before.y, z: before.z }, { x: 1, z: 0 }, 1);
  for (let i = 0; i < 20; i++) physics.step(1 / 60, undefined);
  assert.ok(candy.position.x > before.x + 0.3, 'a kick sends a candy flying');
  for (let k = 0; k < 8; k++) physics.spawnCandies({ x: k, y: 0.2, z: 3 }, { x: 0, y: 0, z: 0 });
  assert.equal(physics.candies.length, MAX_CANDIES);
  assert.ok(physics.retiredCandies.length > 0, 'the oldest retired');
  physics.reset();
  assert.equal(physics.candies.length + physics.pumpkins.length + physics.smashed.length, 0, 'Restablecer clears them');
});

test('pumpkin shards fly out all round, bounce on the ground and slow down', () => {
  const shards = shardsOf({ x: 0, y: 0.3, z: 0 }, { x: 2, y: 0, z: 0 }, seeded(3));
  assert.ok(shards.length >= 5);
  const angles = shards.map((shard) => Math.atan2(shard.velocity.z, shard.velocity.x));
  assert.ok(Math.max(...angles) - Math.min(...angles) > Math.PI, 'all round');
  for (let i = 0; i < 120; i++) for (const shard of shards) shardStep(shard, 1 / 60, 0);
  for (const shard of shards) {
    assert.ok(shard.position.y >= 0, 'never under the ground');
    assert.ok(Math.hypot(shard.velocity.x, shard.velocity.z) < 2.5, 'slowed by the bounces');
  }
});

test('the cauldron is got into and out of in a blink, without the walk or the sitting clips', () => {
  const spot = { seat: 'office' as const, approaches: [{ x: 1, z: 0 }, { x: -1, z: 0 }], stand: { x: 0, z: 0 }, yaw: 0 };
  const controller = new InteractionController([spot], [], { minX: -10, maxX: 10, minZ: -10, maxZ: 10 }, 0.3);
  const calls: boolean[] = [];
  controller.instant.add('office');
  controller.onInstant = (inside) => calls.push(inside);
  assert.ok(controller.interact({ x: 1.4, z: 0 }, 0));
  assert.equal(controller.phase, 'seated');
  assert.equal(controller.state.stage, 'seated');
  assert.equal(controller.state.clip, 'seated_chair');
  assert.deepEqual(controller.position, spot.stand);
  assert.ok(controller.interact(controller.position, 0));
  assert.equal(controller.phase, 'free');
  assert.equal(controller.state.stage, 'idle');
  assert.ok(spot.approaches.some((point) => point.x === controller.position.x && point.z === controller.position.z), 'standing beside it');
  assert.deepEqual(calls, [true, false]);
  // Other seats still walk over and play their clips.
  const chair = new InteractionController([{ ...spot, seat: 'chair' }], [], { minX: -10, maxX: 10, minZ: -10, maxZ: 10 }, 0.3);
  chair.instant.add('office');
  assert.ok(chair.interact({ x: 1.4, z: 0 }, 0));
  assert.equal(chair.phase, 'approaching');
});

test('ghosts flee from the character and drift back home once it has gone', () => {
  const ghost = ghostAt({ x: 0, z: 0 }, 0);
  for (let i = 0; i < 120; i++) fleeStep(ghost, { x: -1, z: 0 }, 1 / 60);
  assert.ok(ghost.x > 1.5, `fled to ${ghost.x.toFixed(2)}`);
  for (let i = 0; i < 600; i++) fleeStep(ghost, { x: ghost.x - 0.5, z: 0 }, 1 / 60);
  assert.ok(Math.hypot(ghost.x, ghost.z) < GHOST.leash + 0.6, 'on its leash');
  for (let i = 0; i < 1200; i++) fleeStep(ghost, undefined, 1 / 60);
  assert.ok(Math.hypot(ghost.x, ghost.z) < 0.2, 'home again');
});

test('the test tube gauge is a narrow tube in the bottle\'s box', () => {
  const xs = (path: string) => [...path.matchAll(/(-?[\d.]+) (-?[\d.]+)/g)].map((match) => Math.abs(Number(match[1])));
  assert.ok(Math.max(...xs(bottlePath('tube'))) < 12, 'narrow');
  assert.ok(Math.max(...xs(bottlePath('tube'))) < Math.max(...xs(bottlePath('bottle'))));
  assert.ok(bottlePath('tube').startsWith(`M0 ${BOTTLE_UNITS}`), 'standing on its bottom like the bottle');
});

test('Halloween graffiti: the dressed spots keep their place and find their surface, words in one colour', async () => {
  const spots = graffitiForHalloween(GRAFFITI);
  assert.equal(new Set(spots.map((spot) => spot.id)).size, spots.length, 'unique ids');
  for (const id of Object.keys(HALLOWEEN_GRAFFITI)) assert.ok(GRAFFITI.some((spot) => spot.id === id), `${id} dresses a spot`);
  for (const spot of spots) {
    assert.ok(!!spot.text !== !!spot.symbol, `${spot.id}: either words or a symbol`);
    if (spot.symbol) assert.ok(GRAFFITI_SYMBOLS.includes(spot.symbol), `${spot.id}: ${spot.symbol}`);
    if (spot.symbol && spot.symbol in SPRAY_SYMBOLS) assert.equal(spot.style, 'spray');
    for (const language of ['es', 'en'] as const) {
      if (!spot.text) break;
      const text = textFor(spot, language);
      assert.ok(text.split('\n').length <= 2, `${spot.id}: one or two lines`);
      for (const char of text.replace(/[\s\n]/g, '')) assert.ok(sprayGlyph(char), `${spot.id} (${language}): a glyph for ${char}`);
    }
  }
  const outside = await parse('outside');
  outside.add(await parse('circuit'));
  outside.updateMatrixWorld(true);
  const data = readOutside(outside);
  for (const spot of spots.filter((placed) => !placed.loose && placed.at[1] !== 'ground')) {
    assert.ok(surfaceFor(spot, [outside], data.groundY), `${spot.id}: found its surface`);
  }
  // The symbols on the concrete barriers are painted like the chick in sunglasses on its barrier: filled, as wide, as high.
  const chick = GRAFFITI.find((spot) => spot.id === 'barrier-chick')!;
  for (const spot of spots.filter((placed) => placed.id.startsWith('barrier-') && placed.symbol && placed.id.endsWith('-halloween'))) {
    assert.ok(!(spot.symbol! in SPRAY_SYMBOLS), `${spot.id}: a filled symbol`);
    assert.equal(spot.width, chick.width, `${spot.id}: as wide as the chick`);
    assert.equal(spot.at[1], chick.at[1], `${spot.id}: as high as the chick`);
  }
});
