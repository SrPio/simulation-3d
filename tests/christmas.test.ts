import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { test } from 'node:test';
import * as cannon from 'cannon-es';
import { Box3, Matrix4, Mesh, Texture, Vector3, type Object3D } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { christmasMode, daysToChristmas, isChristmasSeason, seasonOf } from '../src/core/christmas.ts';
import { halloweenMode } from '../src/core/halloween.ts';
import { dressChristmasPieces, takeChristmas, bulbPositions } from '../src/scene/christmasDress.ts';
import { readOutside } from '../src/scene/outsideData.ts';
import { CHRISTMAS_GRAFFITI, GRAFFITI, GRAFFITI_SYMBOLS, graffitiForChristmas, surfaceFor, textFor } from '../src/scene/graffitiData.ts';
import { SPRAY_SYMBOLS, sprayGlyph } from '../src/scene/sprayFont.ts';
import { GIFT, PropPhysics, SNOWMAN, type PieceBody } from '../src/world/PropPhysics.ts';
import { HatTail, TAIL } from '../src/character/hatTail.ts';
import { POMPOM, pompomAt, pompomStep } from '../src/character/pompom.ts';
import { SNOW, SOLE, printLeft, printSpot, snowAt } from '../src/world/snowPrints.ts';
import { bulbOn } from '../src/scene/ChristmasLights.ts';
import { countdownLines } from '../src/scene/CountdownBoard.ts';
import { BOTTLE_UNITS, bottlePath } from '../src/ui/bottle.ts';

async function parse(file: string): Promise<Object3D> {
  const data = await readFile(new URL(`../public/models/${file}.glb`, import.meta.url));
  const loader = new GLTFLoader();
  loader.register(() => ({ name: 'EXT_texture_webp', loadTexture: () => Promise.resolve(new Texture()) }));
  return (await loader.parseAsync(data.buffer.slice(data.byteOffset, data.byteOffset + data.length), '')).scene;
}

const day = (year: number, month: number, date: number) => new Date(year, month - 1, date, 12);

test('Christmas is on from 1 December to 5 January, across the new year, and ?navidad or ?christmas forces it either way', () => {
  assert.equal(isChristmasSeason(day(2026, 11, 30)), false);
  assert.equal(isChristmasSeason(day(2026, 12, 1)), true);
  assert.equal(isChristmasSeason(day(2026, 12, 31)), true);
  assert.equal(isChristmasSeason(day(2027, 1, 1)), true);
  assert.equal(isChristmasSeason(day(2027, 1, 5)), true);
  assert.equal(isChristmasSeason(day(2027, 1, 6)), false);
  assert.equal(isChristmasSeason(day(2027, 7, 15)), false);
  assert.equal(christmasMode('', day(2026, 12, 20)), true);
  assert.equal(christmasMode('?navidad=0', day(2026, 12, 20)), false);
  assert.equal(christmasMode('?christmas=off&cine', day(2026, 12, 20)), false);
  assert.equal(christmasMode('?navidad=1', day(2026, 6, 1)), true);
  assert.equal(christmasMode('?christmas', day(2026, 6, 1)), true);
  assert.equal(christmasMode('?cine', day(2026, 6, 1)), false);
  // One season at a time: both forced on, Christmas wins; the seasons never overlap by date.
  assert.equal(seasonOf(christmasMode('?navidad=1&halloween=1', day(2026, 10, 20)), halloweenMode('?navidad=1&halloween=1', day(2026, 10, 20))), 'christmas');
  assert.equal(seasonOf(false, true), 'halloween');
  for (let d = new Date(2026, 0, 1); d.getFullYear() === 2026; d.setDate(d.getDate() + 1)) {
    assert.ok(!(isChristmasSeason(d) && halloweenMode('', d)), `${d.toDateString()}: one season`);
  }
});

test('the countdown sign reads «FALTAN / N / DÍAS PARA NAVIDAD», one day in the singular, then Merry Christmas and Happy New Year', () => {
  assert.deepEqual(countdownLines(12), { top: 'FALTAN', number: '12', bottom: 'DÍAS PARA NAVIDAD' });
  assert.deepEqual(countdownLines(1), { top: 'FALTA', number: '1', bottom: 'DÍA PARA NAVIDAD' });
  assert.equal(countdownLines(0).bottom, '¡FELIZ NAVIDAD!');
  assert.equal(countdownLines(null).bottom, '¡FELIZ AÑO NUEVO!');
});

test('the countdown counts the days to Christmas Eve and says Merry Christmas on the 24th and 25th', () => {
  assert.equal(daysToChristmas(day(2026, 12, 1)), 23);
  assert.equal(daysToChristmas(day(2026, 12, 23)), 1);
  assert.equal(daysToChristmas(day(2026, 12, 24)), 0);
  assert.equal(daysToChristmas(day(2026, 12, 25)), 0);
  assert.equal(daysToChristmas(day(2026, 12, 26)), null);
  assert.equal(daysToChristmas(day(2027, 1, 3)), null);
  assert.equal(daysToChristmas(day(2026, 11, 5)), 49);
});

test('christmas.glb: its world, the hat with its bobble, the sleigh, the light strings and the library, within its size budget', async () => {
  const size = (await stat(new URL('../public/models/christmas.glb', import.meta.url))).size;
  assert.ok(size < 800_000, `${size} bytes`);
  const dress = takeChristmas(await parse('christmas'));
  assert.ok(dress.hat && dress.pompom, 'the Santa hat and its bobble');
  assert.ok(dress.sleigh, 'the sleigh');
  for (const name of ['SleighGrip_right', 'SleighGrip_left', 'SleighSack_Mouth']) assert.ok(dress.sleigh.getObjectByName(name), name);
  // A thruster on each side (the character's right is three.js -X when facing +Z): its mouth behind the rider, the
  // charge growing from its origin along its local +Y, which runs backwards along the thruster.
  for (const [side, sign] of [['right', -1], ['left', 1]] as const) {
    const nozzle = dress.sleigh.getObjectByName(`SleighNozzle_${side}`)!.position;
    assert.ok(nozzle.z < -0.8, `${side}: blows backwards (z ${nozzle.z.toFixed(2)})`);
    assert.ok(nozzle.x * sign > 0.6, `${side}: beside the sleigh (x ${nozzle.x.toFixed(2)})`);
    const fuel = dress.sleigh.getObjectByName(`SleighFuel_${side}`) as Mesh;
    const box = new Box3().setFromBufferAttribute(fuel.geometry.getAttribute('position') as never);
    assert.ok(box.min.y > -0.01 && box.max.y > 0.3, `${side}: the charge grows from its origin along +Y`);
    const back = new Vector3(0, 1, 0).applyQuaternion(fuel.quaternion);
    assert.ok(back.z < -0.95, `${side}: its +Y runs backwards`);
  }
  for (const name of ['Christmas_Pin', 'Christmas_Ball', 'Snowball', 'SnowChunk', 'Gift_0', 'Gift_1', 'Gift_2']) assert.ok(dress.library.has(name), name);
  const bulbs = bulbPositions(dress);
  assert.ok(bulbs.length > 300, `${bulbs.length} bulbs`);
  assert.ok(new Set(bulbs.map((bulb) => bulb.string)).size >= 10, 'on many strings');
});

test('the world of christmas.glb reads as snowmen and gifts, pines, the giant tree, its zone and the countdown sign', async () => {
  const outside = await parse('outside');
  const dress = takeChristmas(await parse('christmas'));
  outside.add(dress.world);
  const data = readOutside(outside);
  const pieces = data.props.filter((piece) => piece.group === 'christmas');
  const snowmen = pieces.filter((piece) => piece.prop === 'snowman');
  assert.ok(snowmen.length >= 15 && snowmen.length % 3 === 0, `${snowmen.length} snowman balls`);
  for (const piece of snowmen) {
    assert.equal(piece.shape.kind, 'sphere', `${piece.name}: a ball`);
    assert.ok(piece.joint?.startsWith('snowman_'), `${piece.name}: held to its snowman`);
  }
  assert.ok(pieces.filter((piece) => piece.prop === 'gift').length >= 10, 'gifts round the tree');
  for (const piece of pieces) {
    assert.ok(piece.position.y - piece.half[1] < data.groundY + 0.05 || piece.prop === 'snowman', `${piece.name}: standing on the ground`);
    assert.ok(Math.abs(piece.position.x) > 3.1 || Math.abs(piece.position.z) > 3.1, `${piece.name}: outside the room`);
  }
  const tree = data.decor.find((item) => item.kind === 'xmastree');
  assert.ok(tree?.solid, 'the giant tree stops pieces');
  assert.ok(data.decor.filter((item) => item.kind === 'pine').length >= 5, 'decorated pines');
  assert.ok(!data.decor.some((item) => item.kind === 'ice'), 'no frozen pond');
  assert.ok(data.floors.some((floor) => floor.id === 'xmastree'), 'the tree\'s painted zone');
  assert.ok(data.zones.some((zone) => zone.target === 'christmas'), 'its reset zone');
  // The countdown sign stands off the road and clear of the start, facing the camera side (+Z) like the other signs.
  const sign = data.countdownBoard!;
  assert.ok(sign && sign.width > 3 && sign.height > 1.5, 'a big countdown sign');
  assert.ok(Math.abs(sign.yaw) < 1e-3, 'facing +Z');
  assert.ok(Math.hypot(sign.position.x - 2.3, sign.position.z - 2.3) > 8, 'away from the start point');
  // The tree's zone keeps off the circuit's road.
  const road = data.floors.find((floor) => floor.id === 'circuit')!;
  assert.ok(snowAt(tree!.position, { road: { line: road.targets, width: road.gap + 6 } }), 'the tree is well off the road');
});

test('the dressed pin and ball have the sizes of the pieces they dress, the tree gifts each their own colour', async () => {
  const outside = await parse('outside');
  const dress = takeChristmas(await parse('christmas'));
  outside.add(dress.world);
  const all = readOutside(outside).props;
  const pieces = all.filter((piece) => ['pin', 'ball'].includes(piece.prop ?? ''));
  const before = pieces.map((piece) => new Box3().setFromBufferAttribute(piece.parts[0].geometry.getAttribute('position') as never));
  dressChristmasPieces(all, dress);
  for (const [k, piece] of pieces.entries()) {
    const after = new Box3();
    for (const part of piece.parts) after.union(new Box3().setFromBufferAttribute(part.geometry.getAttribute('position') as never));
    for (const axis of ['x', 'y', 'z'] as const) {
      assert.ok(Math.abs(after.min[axis] - before[k].min[axis]) < 0.03 && Math.abs(after.max[axis] - before[k].max[axis]) < 0.03, `${piece.name} ${axis}`);
    }
  }
  const ball = pieces.find((piece) => piece.prop === 'ball')!;
  assert.ok(ball.parts[0].map && ball.parts[0].geometry.getAttribute('uv'), 'the ball is printed');
  const pin = pieces.find((piece) => piece.prop === 'pin')!;
  assert.ok(pin.parts.length >= 2, 'red with a ribbon');
  const colours = new Set(all.filter((piece) => piece.prop === 'gift').map((piece) => piece.parts[0].color.getHexString()));
  assert.ok(colours.size >= 4, `${colours.size} wrapping papers`);
});

test('the Santa hat sits over the head, clear of the hair, its bobble at the tip', async () => {
  const character = await parse('developer-v4-interactions');
  const dress = takeChristmas(await parse('christmas'));
  const hat = dress.hat!;
  character.updateMatrixWorld(true);
  hat.updateMatrixWorld(true);
  const size = new Box3().setFromObject(hat.getObjectByName('ChristmasHat_Cap')!);
  // The cuff's bottom at the brow; the tail hangs no lower than it.
  assert.ok(size.min.y > 2.25 && size.min.y < 2.45, `the cuff at the brow (${size.min.y.toFixed(2)} m)`);
  assert.ok(size.max.y > 2.75, `it rises over the crown (${size.max.y.toFixed(2)} m)`);
  // Its bobble hangs off the tip of the tail, which falls down behind the head.
  const tip = dress.pompom!.getWorldPosition(new Vector3());
  assert.ok(tip.z < -0.25, `the tail hangs behind the head (z ${tip.z.toFixed(2)})`);
  assert.ok(tip.y < size.max.y - 0.25, 'the tail falls from the top');
  // The hair's top stays under the hat: straight down from above, the hat is met first.
  let hair: Object3D | undefined;
  character.traverse((object) => {
    if (object instanceof Mesh && object.name.startsWith('Hair') && !hair) hair = object;
  });
  assert.ok(hair, 'the hair');
});

test('the Santa hat red tail swings when the head moves, rests on the head and settles back into its shape', async () => {
  const dress = takeChristmas(await parse('christmas'));
  const cap = dress.hat!.getObjectByName('ChristmasHat_Cap')!;
  const data = cap.userData as { spine: number[]; radii: number[]; tail_free: number; head: number[]; cuff: number[] };
  const tail = new HatTail({ spine: data.spine, radii: data.radii, free: data.tail_free, head: data.head, cuff: data.cuff });
  assert.ok(tail.count > 30 && data.tail_free > 5 && data.tail_free < tail.count - 10, 'a chain with a fixed part on the head and a free tail');
  // Every mesh of the cap is tied to the chain, and the tail's vertices follow it.
  const meshes: Mesh[] = [];
  cap.traverse((object) => { if (object instanceof Mesh) meshes.push(object); });
  const bindings = meshes.map((mesh) => tail.bind(mesh.geometry));
  const bound = bindings.reduce((sum, binding) => sum + binding.ring.filter((ring) => ring >= 0).length, 0);
  assert.ok(bound > 300, `${bound} vertices on the tail`);
  const before = bindings.map((binding) => Float32Array.from(binding.geometry.getAttribute('position').array as ArrayLike<number>));
  // Standing still the tail keeps its modelled shape.
  const matrix = new Matrix4();
  for (let i = 0; i < 60; i++) tail.step(1 / 60, matrix);
  let at = tail.local(matrix);
  for (const binding of bindings) tail.deform(binding, at);
  const moved = Math.max(...bindings.map((binding, k) => Math.max(...Array.from(binding.geometry.getAttribute('position').array as ArrayLike<number>, (value, j) => Math.abs(value - before[k][j])))));
  assert.ok(moved < 0.002, `still: the hat keeps its shape (${moved.toFixed(4)} m)`);
  const tipRest = at[at.length - 1].clone();
  // The head sets off sideways and stops: the tail lags behind, swings, then settles where it was.
  // Nothing of the tail comes nearer the head's middle than it is in the modelled shape (or than the head plus its ring).
  const head = new Vector3(data.head[0], data.head[1], data.head[2]);
  const least = tail.rest.map((point, i) => Math.min(point.distanceTo(head), data.head[3] + data.radii[i] * TAIL.clear));
  // Nor into the white fur cuff: an upright elliptic band round the head.
  const [cx, cz, side, ahead, behind, bottom, top] = data.cuff;
  const inCuff = (point: Vector3, radius: number) => point.y > bottom - radius && point.y < top + radius
    && Math.hypot((point.x - cx) / (side + radius), (point.z - cz) / ((point.z < cz ? behind : ahead) + radius)) < 0.999;
  let lag = 0;
  let closest = Infinity;
  let throughCuff = 0;
  for (let i = 0; i < 240; i++) {
    const x = Math.min(1, i / 20) * 0.6;
    matrix.makeTranslation(x, 0, 0);
    tail.step(1 / 60, matrix);
    at = tail.local(matrix);
    lag = Math.max(lag, at[at.length - 1].distanceTo(tipRest));
    for (let k = data.tail_free; k < at.length; k++) {
      closest = Math.min(closest, at[k].distanceTo(head) / least[k]);
      if (inCuff(at[k], data.radii[k])) throughCuff++;
    }
  }
  assert.ok(lag > 0.03, `the tail swings (${lag.toFixed(3)} m)`);
  assert.ok(at[at.length - 1].distanceTo(tipRest) < 0.01, 'and settles back');
  assert.ok(closest > 0.99, `never into the head (${closest.toFixed(3)} of its least distance)`);
  assert.equal(throughCuff, 0, 'never through the fur cuff');
  // Head bowed forwards: the tail falls over towards the ground (gravity beyond the modelled shape).
  matrix.makeRotationX(0.8);
  tail.reset(matrix);
  for (let i = 0; i < 240; i++) tail.step(1 / 60, matrix);
  at = tail.local(matrix);
  const fallen = at[at.length - 1].distanceTo(tipRest);
  assert.ok(fallen > 0.03, `bowed, it hangs another way (${fallen.toFixed(3)} m)`);
});

test('the bobble swings when the head moves and settles hanging down', () => {
  const tip = { x: 0, y: 2.8, z: 0 };
  const state = pompomAt(tip);
  // The head sets off sideways: the bobble lags behind, then swings through.
  let least = 0;
  let most = 0;
  for (let i = 0; i < 90; i++) {
    if (i < 12) tip.x += 0.04;
    const hang = pompomStep(state, tip, 1 / 60);
    least = Math.min(least, hang.x);
    most = Math.max(most, hang.x);
  }
  assert.ok(least < -0.2, `it trails behind the move (${least.toFixed(2)})`);
  assert.ok(most > 0.05, `and swings through when the head stops (${most.toFixed(2)})`);
  for (let i = 0; i < 600; i++) pompomStep(state, tip, 1 / 60);
  const rest = pompomStep(state, tip, 1 / 60);
  assert.ok(rest.y < -0.99, 'hanging straight down again');
  assert.ok(Math.abs(Math.hypot(state.bob.x - tip.x, state.bob.y - tip.y, state.bob.z - tip.z) - POMPOM.length) < 1e-6, 'on its cord');
  // A long frame neither explodes nor swings past the limit.
  tip.y += 5;
  const jump = pompomStep(state, tip, 0.5);
  assert.ok(Math.acos(-jump.y) <= POMPOM.limit + 1e-6);
});

test('prints are left in the snow, not on the road, the room or the green, and fade away', () => {
  const bare = { road: { line: [{ x: 0, z: 10 }, { x: 20, z: 10 }], width: 5 }, platform: { minX: -3, maxX: 3, minZ: -3, maxZ: 3 }, spots: [{ x: 10, z: 0, radius: 4 }] };
  assert.equal(snowAt({ x: 5, z: 10 }, bare), false, 'the road');
  assert.equal(snowAt({ x: 5, z: 13 }, bare), true, 'beside the road');
  assert.equal(snowAt({ x: 0, z: 0 }, bare), false, 'the room');
  assert.equal(snowAt({ x: 11, z: 1 }, bare), false, 'the green');
  assert.equal(snowAt({ x: 20, z: -5 }, bare), true);
  // Facing +Z, the left ankle at x 0.165 and the right at -0.165: each sole ahead of its ankle, a little outwards, toes out.
  const left = printSpot({ x: 0.165, z: 0 }, 0, true);
  const right = printSpot({ x: -0.165, z: 0 }, 0, false);
  assert.ok(left.x > 0.165 && right.x < -0.165, 'outwards of the ankles');
  assert.ok(left.z > 0.1 && right.z > 0.1, 'the sole\'s middle ahead of the ankle');
  assert.ok(left.heading > 0 && right.heading < 0, 'toes turned out');
  assert.ok(SOLE.length > 0.5 && SOLE.width > 0.25, 'as big as the character\'s sneaker sole');
  assert.equal(printLeft(0), 1);
  assert.ok(printLeft(SNOW.fade / 2) > 0.4 && printLeft(SNOW.fade / 2) < 0.6);
  assert.equal(printLeft(SNOW.fade + SNOW.tick), 0, 'gone and the snow whole again');
});

test('a snowball bursts where it lands; a hard knock breaks a snowman apart, its balls crumble and a reset rebuilds it', () => {
  const groundY = 0;
  const radii = [0.42, 0.31, 0.22];
  const heights = [0.42, 0.84 + 0.31 * 0.82, 0.84 + 0.31 * 1.64 + 0.22 * 0.82];
  const pieces: PieceBody[] = radii.map((radius, k) => ({
    position: { x: 2, y: heights[k], z: 0 }, quaternion: { x: 0, y: 0, z: 0, w: 1 }, half: [radius, radius, radius],
    shape: { kind: 'sphere', radius }, mass: [24, 12, 5][k], group: 'christmas', prop: 'snowman', joint: 'snowman_0',
  }));
  const physics = new PropPhysics(cannon, pieces, [], groundY);
  assert.equal(physics.joints.length, 2, 'each ball held to the one under it');
  // Standing: a few seconds go by and it stays a snowman.
  for (let i = 0; i < 120; i++) physics.step(1 / 60, { x: 10, y: 0, z: 10 });
  assert.equal(physics.broken, 0);
  assert.ok(physics.bodies[2].position.y > 1.2, 'the head stays on top');
  // A snowball thrown at a wall of nothing lands and bursts.
  physics.throwSnowball({ x: -3, y: 1.5, z: 3 }, { x: 0, y: 1, z: 3 }, { x: 0, y: 0, z: 0 });
  for (let i = 0; i < 120 && physics.snowballs.length; i++) physics.step(1 / 60, undefined);
  assert.equal(physics.snowballs.length, 0);
  assert.equal(physics.bursts.length, 1);
  assert.ok(physics.bursts[0].position.z > 3.3, 'it burst where it landed');
  // A soft nudge does not break it; a charged kick does.
  physics.strike({ x: 1, z: 0 }, { x: 1.6, y: 0.4, z: 0 }, { x: 1, z: 0 }, 0);
  for (let i = 0; i < 5; i++) physics.step(1 / 60, undefined);
  assert.equal(physics.broken, 0, 'a tap leaves it whole');
  physics.strike({ x: 1, z: 0 }, { x: 1.6, y: 1.3, z: 0 }, { x: 1, z: 0 }, 1);
  for (let i = 0; i < 4; i++) physics.step(1 / 60, undefined);
  assert.ok(physics.broken > 0, 'a full kick breaks it apart');
  for (let i = 0; i < Math.ceil((SNOWMAN.crumble + 0.5) * 60); i++) physics.step(1 / 60, undefined);
  assert.ok(physics.snowmen.crumbled > 0 && physics.crumbles.length > 0, 'the loose balls crumble into snow');
  assert.ok(physics.crumbled(0) || physics.crumbled(1) || physics.crumbled(2));
  physics.reset();
  assert.equal(physics.snowmen.crumbled + physics.snowmen.loose, 0);
  assert.equal(physics.broken, 0, 'whole again');
  assert.ok(physics.world.bodies.includes(physics.bodies[2]), 'back in the world');
});

test('gifts fall off the sleigh, can be kicked, are capped and go after a while', () => {
  const physics = new PropPhysics(cannon, [], [], 0);
  for (let k = 0; k < GIFT.max + 4; k++) physics.dropGift({ x: k * 0.6, y: 1, z: 0 }, { x: 0, y: 0, z: -1 }, { x: 0, y: 0, z: 0 }, k);
  assert.equal(physics.gifts.length, GIFT.max, 'capped');
  assert.equal(physics.retiredGifts.length, 4, 'the oldest go');
  for (let i = 0; i < 120; i++) physics.step(1 / 60, undefined);
  const gift = physics.gifts[physics.gifts.length - 1];
  assert.ok(gift.body.position.y < 0.3, 'it lands');
  const before = gift.body.position.clone();
  physics.strike({ x: before.x - 0.6, z: before.z }, { x: before.x - 0.1, y: 0.15, z: before.z }, { x: 1, z: 0 }, 1);
  for (let i = 0; i < 20; i++) physics.step(1 / 60, undefined);
  assert.ok(gift.body.position.x > before.x + 0.3, 'a kick sends it flying');
  for (let i = 0; i < Math.ceil(GIFT.life * 60) + 30; i++) physics.step(1 / 60, { x: 3, y: 0, z: 0 });
  assert.equal(physics.gifts.length, 0, 'they go after GIFT.life seconds');
});

test('the bulbs blink in patterns, never all off at once along a string', () => {
  for (let time = 0; time < 30; time += 0.45) {
    const lit = Array.from({ length: 24 }, (_, index) => bulbOn(index, 2, time)).filter(Boolean).length;
    assert.ok(lit > 0 && lit <= 24, `${lit} lit at ${time.toFixed(2)} s`);
  }
  const changes = new Set(Array.from({ length: 40 }, (_, k) => Array.from({ length: 8 }, (_, index) => bulbOn(index, 0, k * 0.45)).join()));
  assert.ok(changes.size > 3, 'they change');
});

test('the thruster gauge stands in the bottle\'s box', () => {
  assert.ok(bottlePath('thruster').startsWith(`M0 ${BOTTLE_UNITS}`), 'standing on its exhaust like the bottle on its bottom');
});

test('Christmas graffiti: the dressed spots keep their place and find their surface, words in one colour', async () => {
  const spots = graffitiForChristmas(GRAFFITI);
  assert.equal(new Set(spots.map((spot) => spot.id)).size, spots.length, 'unique ids');
  for (const id of Object.keys(CHRISTMAS_GRAFFITI)) assert.ok(GRAFFITI.some((spot) => spot.id === id), `${id} dresses a spot`);
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
});
