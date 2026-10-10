import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import * as cannon from 'cannon-es';
import { Box3, Mesh, Texture, Vector3, type MeshStandardMaterial, type Object3D } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MESSAGES } from '../src/core/i18n.ts';
import { readOutside, type OutsideData, type PunchBag } from '../src/scene/outsideData.ts';
import { overlaps } from '../src/world/collisions.ts';
import { PropPhysics } from '../src/world/PropPhysics.ts';

async function parse(file: string): Promise<Object3D> {
  const data = await readFile(new URL(`../public/models/${file}.glb`, import.meta.url));
  const loader = new GLTFLoader();
  loader.register(() => ({ name: 'EXT_texture_webp', loadTexture: () => Promise.resolve(new Texture()) }));
  return (await loader.parseAsync(data.buffer.slice(data.byteOffset, data.byteOffset + data.length), '')).scene;
}

/** The outside with the boxing corner read together, as the viewer does. */
async function world(): Promise<{ data: OutsideData; scene: Object3D }> {
  const scene = await parse('outside');
  scene.add(await parse('boxing'));
  return { data: readOutside(scene), scene };
}

const colour = (object: Object3D | undefined) => ((object as Mesh).material as MeshStandardMaterial).color.getHexString();

/** One bag's physics alone: its body, and its swing from the vertical (degrees). */
function hang(bags: PunchBag[]) {
  const physics = new PropPhysics(cannon, [], [], GROUND, [], bags.map(({ pivot, centre, radius, length, mass }) => ({ pivot, centre, radius, length, mass })));
  const swing = (index: number) => {
    const body = physics.bags[index];
    const down = new Vector3(body.position.x - bags[index].pivot.x, body.position.y - bags[index].pivot.y, body.position.z - bags[index].pivot.z);
    return Math.acos(Math.min(1, -down.y / down.length())) * 180 / Math.PI;
  };
  return { physics, swing };
}

/** The punch's fist above the ground at the blow (tests/strike.test.ts measures it on the rig). */
const FIST = 1.63;
const GROUND = -0.12;

/** The character a little in front of bag `bag` (+Z), punching it at fist height towards -Z with `power`. */
function punch(physics: PropPhysics, bag: PunchBag, power: number): number {
  const { x, z } = bag.pivot;
  return physics.strike({ x, z: z + 0.7 }, { x, y: GROUND + FIST, z: z + bag.radius + 0.1 }, { x: 0, z: -1 }, power);
}

test('the boxing corner among the brick stacks holds a yellow JS bag and a blue TS bag in the logos’ colours and letters', async () => {
  const { data, scene } = await world();
  assert.deepEqual(data.bags.map((bag) => bag.id), ['js', 'ts']);
  const [js, ts] = data.bags;
  assert.equal(colour(scene.getObjectByName('PunchBag_JS_Body')?.children[0] ?? scene.getObjectByName('PunchBag_JS_Body')), 'f7df1e', 'JavaScript yellow');
  assert.equal(colour(scene.getObjectByName('PunchBag_TS_Body')?.children[0] ?? scene.getObjectByName('PunchBag_TS_Body')), '3178c6', 'TypeScript blue');
  assert.equal(colour(scene.getObjectByName('PunchBag_JS_Letters')), '000000', 'black JS');
  assert.equal(colour(scene.getObjectByName('PunchBag_TS_Letters')), 'ffffff', 'white TS');
  scene.updateMatrixWorld(true);
  for (const bag of data.bags) {
    const letters = new Box3().setFromObject(scene.getObjectByName(`PunchBag_${bag.id.toUpperCase()}_Letters`)!);
    // On the bag's lower part, on its front (+Z, towards the camera).
    assert.ok(letters.max.y < bag.pivot.y - bag.centre, `${bag.id} letters at the bottom`);
    assert.ok(letters.getCenter(new Vector3()).z > bag.pivot.z + bag.radius * 0.5, `${bag.id} letters on the front`);
  }
  // Side by side along +X under one gantry, in the bricks' part of the playground (between its second and third
  // dividers), inside the playground and clear of every brick even at a full swing.
  assert.ok(Math.abs(js.pivot.z - ts.pivot.z) < 1e-3 && Math.abs(js.pivot.y - ts.pivot.y) < 1e-3 && js.pivot.x < ts.pivot.x);
  const area = data.floors.find((floor) => floor.id === 'playarea')!;
  const [, bowling, bricks] = area.targets.filter((_, i) => i % 2 === 0).map((point) => point.x);
  for (const bag of data.bags) {
    assert.ok(bag.pivot.x > bowling + 1 && bag.pivot.x < bricks - 1, `${bag.id} with the bricks`);
    assert.ok(Math.abs(bag.pivot.z - area.position.z) < area.size[1] / 2 - 1.5, `${bag.id} inside the playground`);
    for (const brick of data.props.filter((piece) => piece.group === 'bricks')) {
      assert.ok(Math.hypot(brick.position.x - bag.pivot.x, brick.position.z - bag.pivot.z) > 1.8, `${brick.name} clear of the ${bag.id} bag`);
    }
  }
  // The character stops at the bag.
  for (const bag of data.bags) {
    const bottom = bag.pivot.y - bag.centre - bag.length / 2 - data.groundY;
    const top = bag.pivot.y - bag.centre + bag.length / 2 - data.groundY;
    // Hung like a real bag: its middle between the top of the character's sternum (about 1.8 m) and its eyes (2.24 m),
    // and the punch (its fist about 1.63 m up) lands on it.
    const middle = (bottom + top) / 2;
    assert.ok(middle > 1.8 && middle < 2.24, `${bag.id} middle at ${middle.toFixed(2)} m`);
    assert.ok(bottom < FIST - 0.2 && top > FIST + 0.5, `${bag.id} from ${bottom.toFixed(2)} to ${top.toFixed(2)} m`);
    assert.ok(overlaps({ x: bag.pivot.x, z: bag.pivot.z }, 0.01, data.boxes), `${bag.id} blocks the character`);
  }
  assert.ok(data.floors.some((floor) => floor.id === 'boxing'), 'its painted name');
  assert.equal(MESSAGES.es['floor.boxing'], 'SACOS DE BOXEO');
});

test('a punched bag only swings like a pendulum from its hook, further the harder the blow, and settles back', async () => {
  const { data } = await world();
  const { physics, swing } = hang(data.bags);
  const step = (seconds: number, watch: (index: number) => void = () => {}) => {
    for (let t = 0; t < seconds * 60; t++) {
      physics.step(1 / 60, undefined);
      watch(0);
    }
  };
  assert.equal(punch(physics, data.bags[0], 1), 1, 'the blow lands on the bag');
  let widest = 0;
  let twist = 0;
  let slack = 0;
  step(3, (index) => {
    const body = physics.bags[index];
    const bag = data.bags[index];
    widest = Math.max(widest, swing(index));
    const axis = new Vector3(0, 1, 0).applyQuaternion(body.quaternion as never);
    twist = Math.max(twist, Math.abs(axis.dot(new Vector3(body.angularVelocity.x, body.angularVelocity.y, body.angularVelocity.z))));
    const hook = new Vector3(body.position.x, body.position.y, body.position.z).add(axis.multiplyScalar(bag.centre));
    slack = Math.max(slack, hook.distanceTo(new Vector3(bag.pivot.x, bag.pivot.y, bag.pivot.z)));
  });
  assert.ok(widest > 25 && widest < 55, `a full blow swings it ${widest.toFixed(1)}°`);
  assert.ok(twist < 1e-6, 'no spin about its own axis');
  assert.ok(slack < 0.02, `held at its hook (${slack.toFixed(3)} m)`);
  assert.ok(swing(1) < 0.5, 'the other bag hangs still');
  // Away from the character first (-Z), then back.
  step(25);
  assert.ok(swing(0) < 2, `settled (${swing(0).toFixed(2)}°)`);

  physics.reset();
  assert.ok(swing(0) < 1e-6, 'a reset hangs it still');
  punch(physics, data.bags[0], 0);
  let tap = 0;
  step(3, () => { tap = Math.max(tap, swing(0)); });
  assert.ok(tap > 3 && tap < widest / 2, `a tap only nudges it (${tap.toFixed(1)}°)`);
});
