import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { Box3, Texture } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { CAREER_START, experienceYears } from '../src/core/experience.ts';
import { MESSAGES, t } from '../src/core/i18n.ts';
import { readOutside } from '../src/scene/outsideData.ts';
import { overlaps } from '../src/world/collisions.ts';
import { SHOUT_REACH, shoutAt, shoutSpots } from '../src/world/shouts.ts';
import { RUBIK, RubikPuzzle, isSolved, nearCube, quarter, solvedCubies, turnLayer, type Axis } from '../src/world/rubik.ts';

async function load(file: string) {
  const data = await readFile(new URL(`../public/models/${file}`, import.meta.url));
  const loader = new GLTFLoader();
  loader.register(() => ({ name: 'EXT_texture_webp', loadTexture: () => Promise.resolve(new Texture()) }));
  return (await loader.parseAsync(data.buffer.slice(data.byteOffset, data.byteOffset + data.length), '')).scene;
}

/** Run the puzzle for `seconds` in steps of a 60 Hz frame. */
function run(puzzle: RubikPuzzle, seconds: number, near: boolean): number {
  let turns = 0;
  for (let t = 0; t < seconds; t += 1 / 60) turns += puzzle.update(1 / 60, near);
  return turns;
}

test('a quarter turn four times is no turn, and turning a layer and back leaves the cube solved', () => {
  for (const axis of [0, 1, 2] as Axis[]) {
    const cubies = solvedCubies();
    for (let i = 0; i < 4; i++) turnLayer(cubies, { axis, layer: 1, turn: 1 });
    assert.ok(isSolved(cubies), `axis ${axis}`);
    turnLayer(cubies, { axis, layer: -1, turn: -1 });
    assert.ok(!isSolved(cubies));
    assert.equal(cubies.filter((cubie) => cubie.at[axis] === -1).length, 9, 'a layer is nine cubies');
    turnLayer(cubies, { axis, layer: -1, turn: 1 });
    assert.ok(isSolved(cubies));
  }
  const r = quarter(1, 1);
  assert.deepEqual([r[0] * 1 + r[2] * 0, r[6] * 1 + r[8] * 0], [0, -1], '+X turns to -Z about +Y');
});

test('the cube starts scrambled, solves itself turn by turn when the character comes near, then lights the number', () => {
  const puzzle = new RubikPuzzle();
  assert.equal(puzzle.history.length, RUBIK.scramble);
  assert.ok(!isSolved(puzzle.cubies));
  assert.equal(puzzle.phase, 'scrambled');
  // Away it stays scrambled and still.
  assert.equal(run(puzzle, 5, false), 0);
  assert.equal(puzzle.reveal, 0);
  puzzle.update(1 / 60, true);
  assert.equal(puzzle.phase, 'solving');
  const solveTime = RUBIK.scramble * (RUBIK.solveTurn + 1 / 60) + RUBIK.revealTime + 0.2;
  assert.ok(solveTime < 4.5, 'solved within a few seconds');
  const turns = run(puzzle, solveTime, true);
  assert.equal(turns, RUBIK.scramble, 'one turn per scrambling turn');
  assert.ok(isSolved(puzzle.cubies));
  assert.equal(puzzle.reveal, 1);
  assert.equal(puzzle.phase, 'solved');
  // Walking away: the number goes out, then it scrambles itself again.
  run(puzzle, RUBIK.hideTime + RUBIK.scrambleDelay + RUBIK.scramble * (RUBIK.scrambleTurn + RUBIK.scramblePause) + 1, false);
  assert.equal(puzzle.reveal, 0);
  assert.equal(puzzle.history.length, RUBIK.scramble);
  assert.ok(!isSolved(puzzle.cubies));
});

test('coming back halfway through a new scramble solves only what was scrambled; reduced motion solves at once', () => {
  const puzzle = new RubikPuzzle(9);
  run(puzzle, 4, true);
  assert.ok(isSolved(puzzle.cubies));
  run(puzzle, RUBIK.hideTime + RUBIK.scrambleDelay + 3 * (RUBIK.scrambleTurn + RUBIK.scramblePause), false);
  const scrambled = puzzle.history.length;
  assert.ok(scrambled > 0 && scrambled < RUBIK.scramble);
  run(puzzle, scrambled * 0.2 + RUBIK.revealTime + 0.5, true);
  assert.ok(isSolved(puzzle.cubies));
  const still = new RubikPuzzle(3);
  assert.equal(still.update(1 / 60, true, true), 1);
  assert.ok(isSolved(still.cubies));
  assert.equal(still.reveal, 1);
});

test('near the cube with hysteresis', () => {
  assert.ok(nearCube(RUBIK.reach - 0.1, false));
  assert.ok(!nearCube(RUBIK.reach + 0.1, false));
  assert.ok(nearCube(RUBIK.reach + 0.1, true), 'keeps solving at the edge');
  assert.ok(!nearCube(RUBIK.reach + RUBIK.margin + 0.1, true));
});

test('the experience pedestal stands in the about-me plaza behind the Colombian corner, its cube floating over it', async () => {
  const outside = await load('outside.glb');
  for (const file of ['colombia.glb', 'univalle.glb', 'experience.glb']) outside.add(await load(file));
  const data = readOutside(outside);
  const pedestal = data.decor.find((entry) => entry.kind === 'experience')!;
  const colombia = data.decor.find((entry) => entry.kind === 'colombia')!;
  assert.ok(pedestal && data.experience, 'pedestal and cube spot');
  assert.ok(Math.cos(pedestal.yaw) > 0.999, 'faces +Z');
  assert.ok(pedestal.position.z < colombia.position.z - 1.5, 'behind the Colombian corner');
  const portfolio = data.signs.find((sign) => sign.id === 'portfolio')!;
  assert.ok(pedestal.position.z > portfolio.position.z + 2, 'in front of the signs');
  assert.ok(pedestal.position.x < colombia.position.x - 1, 'towards the left edge of the plaza, behind the flag');
  const plaza = data.floors.find((floor) => floor.id === 'about')!;
  assert.ok(pedestal.position.x - 1 > plaza.position.x - plaza.size[0] / 2, 'inside the plaza');
  for (const sign of data.signs) {
    const { area } = sign;
    assert.ok(Math.abs(pedestal.position.x - area.center.x) > area.halfX + 1, `clear of the ${sign.id} zone`);
  }
  const { position, edge, drop } = data.experience!;
  assert.ok(Math.hypot(position.x - pedestal.position.x, position.z - pedestal.position.z) < 1e-3, 'over the pedestal');
  const top = new Box3().setFromObject(outside.getObjectByName('ExperienceProjector')!).max.y;
  assert.ok(Math.abs(position.y - drop - top) < 0.01, 'drop reaches the projector');
  // Tipped onto a corner it still clears the projector.
  assert.ok(position.y - top > edge * Math.sqrt(3) / 2 - 0.15, 'floats clear');
  assert.ok(overlaps({ x: pedestal.position.x, z: pedestal.position.z }, 0.01, data.boxes), 'the character walks round it');
  assert.ok(data.plaques.some((plaque) => plaque.id === 'experience'));
  assert.equal(MESSAGES.es['about.experience'], 'Años de experiencia');
  assert.equal(MESSAGES.en['about.experience'], 'Years of experience');
  // Room to walk between it and the Colombian corner.
  const base = data.boxes.find((box) => box.name === 'Collider_Colombia')!;
  const own = data.boxes.find((box) => box.name === 'Collider_Experience')!;
  assert.ok(base.minZ - own.maxZ > 0.6, 'a path behind the Colombian corner');
});

test('the years of experience count from 2022 by the system year, and the character shouts them near the cube', async () => {
  assert.equal(CAREER_START, 2022);
  assert.equal(experienceYears(new Date(2026, 9, 20)), 4);
  assert.equal(experienceYears(new Date(2027, 0, 1)), 5);
  assert.equal(experienceYears(new Date(2022, 5, 1)), 1, 'never less than one');
  assert.equal(experienceYears(), new Date().getFullYear() - 2022);
  assert.equal(t('shout.experience', { years: '4' }, 'es'), '+4 años\ncreando experiencias web interactivas');
  assert.equal(t('shout.experience', { years: '4' }, 'en'), '+4 years\nbuilding interactive web experiences');
  const outside = await load('outside.glb');
  for (const file of ['colombia.glb', 'experience.glb']) outside.add(await load(file));
  const spots = shoutSpots(readOutside(outside).decor);
  const spot = spots.find((entry) => entry.id === 'experience')!;
  assert.ok(spot, 'the cube is a shouting landmark');
  assert.equal(shoutAt({ x: spot.x + spot.halfX + SHOUT_REACH - 0.1, z: spot.z }, spots), 'experience');
});
