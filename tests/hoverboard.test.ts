import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { AnimationMixer, Quaternion, Texture, Vector3, type AnimationClip, type Object3D } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { BOARD, STANCE_TURN, boardAt, boardJump, boardSpeed, boardStep, deckHeight, hopFraction, type BoardWorld } from '../src/world/boardDrive.ts';
import { STANCE, poseBoard } from '../src/character/boardPose.ts';
import { restLean } from '../src/character/riderPose.ts';
import { SnowmenHunt } from '../src/world/snowmenHunt.ts';
import { HOVERBOARD_KEY, readBoardUnlocked, saveBoardUnlocked, seasonId } from '../src/core/hoverboard.ts';
import { RUN_SPEED } from '../src/character/CharacterController.ts';

async function load(file: string): Promise<{ scene: Object3D; animations: AnimationClip[] }> {
  const data = readFileSync(new URL(`../public/models/${file}`, import.meta.url));
  const loader = new GLTFLoader();
  loader.register(() => ({ name: 'EXT_texture_webp', loadTexture: () => Promise.resolve(new Texture()) }));
  return loader.parseAsync(data.buffer.slice(data.byteOffset, data.byteOffset + data.length), '');
}

const open: BoardWorld = { boxes: [], floor: { minX: -100, maxX: 100, minZ: -100, maxZ: 100 }, ground: () => 0 };
const run = (state: ReturnType<typeof boardAt>, input: { x: number; z: number }, seconds: number, world = open) => {
  for (let t = 0; t < seconds; t += 1 / 60) boardStep(state, input, 1 / 60, world);
};

test('a snowman counts once its three balls have crumbled; the count adds up over resets and tells once', () => {
  const balls = [0, 1, 2, 3, 4, 5].map((index) => ({ index, joint: `snowman_${Math.floor(index / 3)}` }));
  const hunt = new SnowmenHunt(balls);
  let told = 0;
  hunt.onAll = () => told++;
  const gone = new Set<number>();
  const crumbled = (index: number) => gone.has(index);
  assert.equal(hunt.total, 2);
  gone.add(0).add(1);
  assert.deepEqual(hunt.update(crumbled), [], 'two balls are not a snowman');
  gone.add(2);
  assert.deepEqual(hunt.update(crumbled), ['snowman_0']);
  // Restablecer puts every ball back: what was destroyed stays counted.
  gone.clear();
  assert.equal(hunt.update(crumbled).length, 0);
  assert.equal(hunt.count, 1);
  gone.add(3).add(4).add(5);
  hunt.update(crumbled);
  hunt.update(crumbled);
  assert.ok(hunt.done);
  assert.equal(told, 1, 'the unlock is told once');
  assert.equal(new SnowmenHunt([]).done, false, 'no snowmen, nothing to unlock');
});

test('the unlock lasts the season (January belongs to the December before) and blocked storage stays quiet', () => {
  assert.equal(seasonId(new Date(2026, 11, 3)), '2026');
  assert.equal(seasonId(new Date(2027, 0, 5)), '2026');
  const store = new Map<string, string>();
  const storage = { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => void store.set(key, value) };
  assert.equal(readBoardUnlocked(storage, new Date(2026, 11, 10)), false);
  saveBoardUnlocked(storage, new Date(2026, 11, 10));
  assert.equal(store.get(HOVERBOARD_KEY), '2026');
  assert.equal(readBoardUnlocked(storage, new Date(2027, 0, 2)), true, 'still this season after new year');
  assert.equal(readBoardUnlocked(storage, new Date(2027, 11, 2)), false, 'locked again next season');
  const blocked = { getItem: (): string | null => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
  assert.equal(readBoardUnlocked(blocked), false);
  assert.doesNotThrow(() => saveBoardUnlocked(blocked));
  assert.equal(readBoardUnlocked(undefined), false);
});

test('the board speeds up past running towards its top speed, coasts to a stop and floats over the ground', () => {
  const state = boardAt(0, 0, 0);
  run(state, { x: 0, z: 1 }, 1);
  assert.ok(boardSpeed(state) > 3 && boardSpeed(state) < BOARD.maxSpeed, `speeding up (${boardSpeed(state).toFixed(2)})`);
  run(state, { x: 0, z: 1 }, 4);
  assert.ok(boardSpeed(state) > RUN_SPEED * 1.5 && boardSpeed(state) <= BOARD.maxSpeed + 1e-6, 'faster than running, not past its top speed');
  assert.ok(state.z > 15 && Math.abs(state.x) < 1e-6, 'straight ahead');
  run(state, { x: 0, z: 0 }, 20);
  assert.ok(boardSpeed(state) < 0.05, 'coasts to a stop');
  assert.ok(Math.abs(deckHeight(state) - BOARD.hover) <= BOARD.bob + 1e-9, 'hovers with a small bob');
  // A half push asks for half the speed.
  const slow = boardAt(0, 0, 0);
  run(slow, { x: 0, z: 0.5 }, 6);
  assert.ok(Math.abs(boardSpeed(slow) - BOARD.maxSpeed * 0.5) < 0.3);
});

test('it turns towards the wanted direction at a limited rate, slower when fast, and drifts', () => {
  const standing = boardAt(0, 0, 0);
  boardStep(standing, { x: 1, z: 0 }, 0.1, open);
  const fast = boardAt(0, 0, 0, BOARD.maxSpeed);
  boardStep(fast, { x: 1, z: 0 }, 0.1, open);
  assert.ok(standing.heading > fast.heading && fast.heading > 0, 'both turn towards +X, the fast one less');
  assert.ok(standing.heading <= BOARD.turnRate * 0.1 + 1e-6);
  run(fast, { x: 1, z: 0 }, 0.4);
  assert.ok(Math.abs(fast.slide) > 0.3, 'its old motion slides sideways in a hard turn');
  run(fast, { x: 1, z: 0 }, 3);
  assert.ok(Math.abs(fast.heading - Math.PI / 2) < 0.01 && Math.abs(fast.slide) < 0.2, 'then it grips along its new heading');
  // Asked to go back the way it came, it brakes as it turns round.
  const back = boardAt(0, 0, 0, 6);
  run(back, { x: 0, z: -1 }, 0.3);
  assert.ok(boardSpeed(back) < 5);
});

test('walls stop it and it slides along them; it hops, lands with a dip and follows ramps', () => {
  const wall: BoardWorld = { ...open, boxes: [{ name: 'Wall', minX: -5, maxX: 5, minZ: 3, maxZ: 4 }] };
  const state = boardAt(0, 0, 0.3, 6);
  let impact = 0;
  for (let t = 0; t < 1.5; t += 1 / 60) impact = Math.max(impact, boardStep(state, { x: 0.3, z: 1 }, 1 / 60, wall));
  assert.ok(impact > 1, 'a knock');
  assert.ok(state.z <= 3 - BOARD.radius + 1e-6 && state.x > 0.5, 'held off the wall, sliding along it');
  const hop = boardAt(0, 0, 0, 4);
  assert.equal(boardJump(hop), true);
  assert.equal(boardJump(hop), false, 'not again in the air');
  let top = 0;
  for (let t = 0; t < 1.2; t += 1 / 60) {
    boardStep(hop, { x: 0, z: 1 }, 1 / 60, open);
    top = Math.max(top, hop.y);
  }
  assert.ok(Math.abs(top - BOARD.jump ** 2 / (2 * BOARD.gravity)) < 0.06, `hop height ${top.toFixed(2)}`);
  assert.equal(hop.airborne, false);
  const ramp: BoardWorld = { ...open, ground: (_x, z) => (z > 2 && z < 6 ? (z - 2) * 0.25 : 0) };
  const climbing = boardAt(0, 0, 0, 6);
  let highest = 0;
  let flew = false;
  for (let t = 0; t < 1.5; t += 1 / 60) {
    boardStep(climbing, { x: 0, z: 1 }, 1 / 60, ramp);
    highest = Math.max(highest, climbing.y);
    flew ||= climbing.airborne && climbing.z > 6;
  }
  assert.ok(highest >= 0.95, 'up the ramp');
  assert.ok(flew, 'and off its top');
  // Landing pushes the knees down (a positive dip) for a moment.
  const landing = boardAt(0, 0, 0);
  boardJump(landing);
  let dip = 0;
  for (let t = 0; t < 1.2; t += 1 / 60) {
    boardStep(landing, { x: 0, z: 0 }, 1 / 60, open);
    dip = Math.max(dip, landing.dip);
  }
  assert.ok(dip > 0.03, `dip ${dip.toFixed(3)}`);
});

test('getting on follows the jump clip: nothing before take-off, all of it after landing', () => {
  const air = [0.12, 0.48] as const;
  assert.equal(hopFraction(0.1, 1.667, air), 0);
  assert.equal(hopFraction(1.0, 1.667, air), 1);
  const middle = hopFraction(0.3 * 1.667, 1.667, air);
  assert.ok(middle > 0.4 && middle < 0.6);
  // Standing across the board, left foot forward: the character's left side faces the nose.
  const heading = 0.7;
  const facing = heading + STANCE_TURN;
  const left = { x: Math.cos(facing), z: -Math.sin(facing) };
  assert.ok(Math.abs(left.x - Math.sin(heading)) < 1e-9 && Math.abs(left.z - Math.cos(heading)) < 1e-9);
});

test('christmas.glb has the hoverboard with its foot marks and pads', async () => {
  const { scene } = await load('christmas.glb');
  const board = scene.getObjectByName('ChristmasHoverboard');
  assert.ok(board, 'ChristmasHoverboard');
  board.updateMatrixWorld(true);
  const front = board.getObjectByName('Hoverboard_Foot_front')!.getWorldPosition(new Vector3()).sub(board.getWorldPosition(new Vector3()));
  const back = board.getObjectByName('Hoverboard_Foot_back')!.getWorldPosition(new Vector3()).sub(board.getWorldPosition(new Vector3()));
  assert.ok(front.z > 0.2 && back.z < -0.2, 'front foot towards the nose (+Z)');
  assert.ok(Math.abs(front.y) < 0.01 && Math.abs(back.y) < 0.01, 'on the deck\'s top');
  assert.equal([0, 1].filter((i) => board.getObjectByName(`Hoverboard_Pad_${i}`)).length, 2);
  const length = Number(board.userData.length);
  assert.ok(length > 1.1 && length < 1.6, `deck length ${length}`);
});

test('on the real rig, the soles stand on the foot marks with the knees bent, and the stance blends in', async () => {
  const { scene: model, animations } = await load('developer-v4-interactions.glb');
  const mixer = new AnimationMixer(model);
  mixer.clipAction(animations.find((clip) => clip.name === 'idle')!).play();
  mixer.update(0);
  model.updateMatrixWorld(true);
  const at = (name: string) => model.getObjectByName(name)!.getWorldPosition(new Vector3());
  const ankle = at('foot_L').y;
  const pelvis = at('pelvis').y;
  // The model faces -X (across a board heading +Z): its left (rig _R) towards +Z, the nose.
  model.quaternion.setFromAxisAngle(new Vector3(0, 1, 0), STANCE_TURN);
  model.updateMatrixWorld(true);
  const front = new Vector3(0, 0, 0.33);
  const back = new Vector3(0, 0, -0.33);
  poseBoard(model, { front, back, tilt: new Quaternion(), lean: restLean(), dip: 0, weight: 1 });
  model.updateMatrixWorld(true);
  assert.ok(at('foot_R').distanceTo(front.clone().setY(ankle)) < 0.02, 'left foot on the front mark');
  assert.ok(at('foot_L').distanceTo(back.clone().setY(ankle)) < 0.02, 'right foot on the back mark');
  assert.ok(Math.abs(at('pelvis').y - (pelvis - STANCE.crouch)) < 0.01, 'hips lowered');
  for (const side of ['L', 'R']) {
    const hip = at(`thigh_${side}`);
    const knee = at(`shin_${side}`);
    const foot = at(`foot_${side}`);
    const angle = hip.sub(knee).angleTo(foot.sub(knee)) * 180 / Math.PI;
    assert.ok(angle > 130 && angle < 165, `knee ${side} bent ${angle.toFixed(1)}°`);
    // The knee bends forwards (the facing is -X), not backwards.
    assert.ok(at(`shin_${side}`).x < at(`thigh_${side}`).x + 0.02, `knee ${side} forwards`);
  }
  // The arms are held out from the sides.
  const shoulder = at('upper_arm_R');
  const wrist = at('hand_R');
  assert.ok(wrist.y > shoulder.y - 0.55, 'the left arm is raised off the side');
});
