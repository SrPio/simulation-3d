import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { AnimationMixer, Box3, LoopOnce, Quaternion, SkinnedMesh, Texture, Vector3, type Object3D } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { InteractionState } from '../src/interactions/interactionState.ts';

async function deskLaptop(room: Object3D) {
  const laptop = (await load('laptop')).scene;
  const anchor = room.getObjectByName('Anchor_DeskLaptop')!;
  laptop.position.copy(anchor.getWorldPosition(new Vector3()));
  laptop.quaternion.copy(anchor.getWorldQuaternion(new Quaternion()));
  laptop.updateMatrixWorld(true);
  return laptop;
}

async function load(file: string) {
  const data = await readFile(new URL(`../public/models/${file}.glb`, import.meta.url));
  const loader = new GLTFLoader();
  // Node has no image decoder; geometry and anchors are what these tests inspect.
  loader.register(() => ({ name: 'HeadlessTextures', loadTexture: () => Promise.resolve(new Texture()) }));
  return loader.parseAsync(data.buffer.slice(data.byteOffset, data.byteOffset + data.length), '');
}

test('seat and laptop transitions reject incompatible commands and stow before standing', () => {
  for (const seat of ['chair', 'bed'] as const) {
    const state = new InteractionState();
    assert.ok(state.setSeat(seat));
    assert.equal(state.command('laptop'), false);
    assert.ok(state.command('sit'));
    assert.equal(state.command('sit'), false);
    assert.equal(state.command('stand'), false);
    assert.equal(state.setSeat('chair'), false);
    state.finish();
    assert.equal(state.stage, 'seated');
    assert.ok(state.command('laptop'));
    assert.equal(state.command('laptop'), false);
    state.finish();
    assert.equal(state.clip, `typing_${seat}`);
    assert.equal(state.finish(), false);
    assert.ok(state.command('stand'));
    assert.equal(state.stage, 'stowing');
    state.finish();
    assert.equal(state.stage, 'standing');
    state.finish();
    assert.equal(state.stage, 'idle');
    state.reset();
    assert.ok(state.can('sit'));
  }
});

test('phase 2A source and GLB remain byte-for-byte unchanged', async () => {
  for (const [file, expected] of Object.entries({
    'assets/blender/developer-v1-rig.blend': 'f3f7f646845af68eca9574e18753612e053234c9',
    'public/models/developer-v1-rig.glb': 'c8f40eb48595a68aaffd92af38bd72c1a47ea89c',
  })) {
    const bytes = await readFile(new URL(`../${file}`, import.meta.url));
    assert.equal(createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex'), expected);
  }
});

test('V4 interaction GLB sits on the room seats and types on the desk laptop', async () => {
  const { scene, animations } = await load('developer-v4-interactions');
  const room = (await load('room')).scene;
  room.updateMatrixWorld(true);
  assert.equal(animations.length, 15);
  const manifest = JSON.parse(await readFile(new URL('../public/models/developer-v4-interactions.manifest.json', import.meta.url), 'utf8'));
  const mixer = new AnimationMixer(scene);
  const bone = (name: string) => scene.getObjectByName(name)!.getWorldPosition(new Vector3());
  for (const seat of ['chair', 'bed'] as const) {
    const anchor = room.getObjectByName(seat === 'chair' ? 'Anchor_ChairSeat' : 'Anchor_BedSeat')!;
    const offset = manifest.seats[seat].stand_offset;
    assert.equal(anchor.userData.stand_offset, offset, `${seat}: clips and room agree on the stand offset`);
    const seatHeight = anchor.getWorldPosition(new Vector3()).y;
    for (const action of ['sit_down', 'seated', 'stand_up', 'laptop_draw', 'typing', 'laptop_stow']) {
      const name = `${action}_${seat}`;
      const clip = animations.find((entry) => entry.name === name);
      assert.ok(clip, name);
      mixer.stopAllAction();
      mixer.clipAction(clip).reset().setLoop(LoopOnce, 1).play().clampWhenFinished = true;
      for (const progress of [0, 0.25, 0.5, 0.75, 1]) {
        mixer.setTime(clip.duration * progress);
        scene.updateMatrixWorld(true);
        scene.traverse((object) => { if (object instanceof SkinnedMesh) object.skeleton.update(); });
        const bounds = new Box3().setFromObject(scene, true);
        assert.ok(bounds.min.y > -0.025, `${name}: floor ${bounds.min.y}`);
        for (const track of clip.tracks) assert.ok(Array.from(track.values).every(Number.isFinite), track.name);
        const seated = !(action === 'sit_down' && progress === 0) && !(action === 'stand_up' && progress === 1);
        const pelvis = bone('pelvis');
        if (seated && ['seated', 'typing', 'laptop_draw', 'laptop_stow'].includes(action)) {
          assert.ok(Math.abs(pelvis.y - manifest.seats[seat].hip_height) < 0.02, `${name}: hip height ${pelvis.y}`);
          assert.ok(pelvis.y - seatHeight > 0.03 && pelvis.y - seatHeight < 0.15, `${name}: hips rest on the ${seat}`);
          assert.ok(Math.abs(pelvis.z + offset) < 0.02, `${name}: hips moved back onto the ${seat} (${pelvis.z})`);
        }
        if (!seated) assert.ok(pelvis.y > 0.95, `${name}: standing at the clip edges`);
      }
    }
  }
  // Typing at the desk: place the character where the viewer does and compare with the room laptop.
  const anchor = room.getObjectByName('Anchor_ChairSeat')!;
  scene.quaternion.copy(anchor.getWorldQuaternion(new Quaternion()));
  scene.position.copy(anchor.getWorldPosition(new Vector3()).setY(0))
    .add(new Vector3(0, 0, manifest.seats.chair.stand_offset).applyQuaternion(scene.quaternion));
  mixer.stopAllAction();
  mixer.clipAction(animations.find((clip) => clip.name === 'typing_chair')!).reset().play();
  mixer.setTime(0.5);
  scene.updateMatrixWorld(true);
  // Wrists hover over the laptop's palm rest; the mesh test below checks the fingers against keys and screen.
  const laptop = new Box3().setFromObject((await deskLaptop(room)).getObjectByName('LaptopBase')!, true);
  laptop.min.x -= 0.05; laptop.min.z -= 0.05; laptop.max.x += 0.05; laptop.max.z += 0.05; laptop.max.y += 0.14;
  for (const side of ['L', 'R']) {
    const wrist = bone(`hand_${side}`);
    assert.ok(laptop.containsPoint(wrist), `typing_chair: ${side} wrist ${wrist.toArray().map((v) => v.toFixed(2))} over the laptop`);
  }
  mixer.stopAllAction();
  mixer.uncacheRoot(scene);
});

test('typing at the desk keeps the hand meshes on the keyboard, out of the laptop screen', async () => {
  const { scene, animations } = await load('developer-v4-interactions');
  const room = (await load('room')).scene;
  room.updateMatrixWorld(true);
  const manifest = JSON.parse(await readFile(new URL('../public/models/developer-v4-interactions.manifest.json', import.meta.url), 'utf8'));
  const anchor = room.getObjectByName('Anchor_ChairSeat')!;
  scene.quaternion.copy(anchor.getWorldQuaternion(new Quaternion()));
  scene.position.copy(anchor.getWorldPosition(new Vector3()).setY(0))
    .add(new Vector3(0, 0, manifest.seats.chair.stand_offset).applyQuaternion(scene.quaternion));
  const desk = await deskLaptop(room);
  const lid = new Box3().setFromObject(desk.getObjectByName('LaptopLid')!, true)
    .union(new Box3().setFromObject(desk.getObjectByName('Display')!, true));
  const base = new Box3().setFromObject(desk.getObjectByName('LaptopBase')!, true);
  const hands = ['Hand_L', 'Hand_R'].map((name) => scene.getObjectByName(name) as SkinnedMesh);
  const mixer = new AnimationMixer(scene);
  mixer.clipAction(animations.find((clip) => clip.name === 'typing_chair')!).play();
  const clip = animations.find((entry) => entry.name === 'typing_chair')!;
  const vertex = new Vector3();
  for (let i = 0; i < 8; i++) {
    mixer.setTime(clip.duration * i / 8);
    scene.updateMatrixWorld(true);
    for (const hand of hands) {
      hand.skeleton.update();
      let inside = 0;
      let below = 0;
      const positions = hand.geometry.getAttribute('position');
      for (let v = 0; v < positions.count; v++) {
        hand.getVertexPosition(v, vertex).applyMatrix4(hand.matrixWorld);
        if (lid.containsPoint(vertex)) inside++;
        if (vertex.x > base.min.x && vertex.x < base.max.x && vertex.z > base.min.z && vertex.z < base.max.z && vertex.y < base.max.y - 0.004) below++;
      }
      assert.equal(inside, 0, `frame ${i}: ${hand.name} has ${inside} vertices inside the laptop screen`);
      assert.equal(below, 0, `frame ${i}: ${hand.name} has ${below} vertices below the keyboard`);
    }
  }
  mixer.stopAllAction();
  mixer.uncacheRoot(scene);
});

test('laptop is a separate asset with one hinge, keyboard and display', async () => {
  const { scene } = await load('laptop');
  for (const name of ['Laptop', 'LaptopHinge', 'LaptopBase', 'Keyboard', 'Trackpad', 'Display', 'LaptopLid']) assert.ok(scene.getObjectByName(name), name);
  assert.equal(scene.getObjectByName('Developer'), undefined);
  const hinge = scene.getObjectByName('LaptopHinge')!;
  const open = scene.getObjectByName('Laptop')!.userData.hinge_open_radians;
  assert.ok(Math.abs(hinge.rotation.x - open) < 1e-4, 'exported open');
  scene.updateMatrixWorld(true);
  const lidTop = new Box3().setFromObject(scene.getObjectByName('LaptopLid')!, true).max.y;
  assert.ok(lidTop > 0.28, `open lid stands up: ${lidTop}`);
  hinge.rotation.x = 0;
  scene.updateMatrixWorld(true);
  const size = new Box3().setFromObject(scene).getSize(new Vector3());
  assert.ok(Math.abs(size.x - 0.48) < 0.01 && size.y < 0.04 && Math.abs(size.z - 0.32) < 0.01, `closed laptop ${size.toArray()}`);
});
