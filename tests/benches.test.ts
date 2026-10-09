import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { Box3, Mesh, Texture, type Object3D } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { CHARACTER_RADIUS } from '../src/character/CharacterController.ts';
import { InteractionController } from '../src/interactions/InteractionController.ts';
import { readOutside } from '../src/scene/outsideData.ts';
import { overlaps } from '../src/world/collisions.ts';

async function parse(file: string): Promise<Object3D> {
  const data = await readFile(new URL(`../public/models/${file}.glb`, import.meta.url));
  const loader = new GLTFLoader();
  loader.register(() => ({ name: 'EXT_texture_webp', loadTexture: () => Promise.resolve(new Texture()) }));
  return (await loader.parseAsync(data.buffer.slice(data.byteOffset, data.byteOffset + data.length), '')).scene;
}

const manifest = JSON.parse(await readFile(new URL('../public/models/developer-v4-interactions.manifest.json', import.meta.url), 'utf8'));
const durations = new Map<string, number>(manifest.clips.map((clip: { name: string; duration: number }) => [clip.name, clip.duration]));

/** Plays the requested clips like the viewer's mixer until `until` holds. */
function playUntil(interaction: InteractionController, until: () => boolean, clips: string[] = []): void {
  let clip = '';
  let time = 0;
  for (let step = 0; step < 60 * 15; step++) {
    if (until()) return;
    const request = interaction.clip();
    if (request && request.name !== clip) {
      clip = request.name;
      clips.push(clip);
      time = 0;
    }
    interaction.update(1 / 60);
    time += 1 / 60;
    if (request && !request.loop && time >= (durations.get(clip) ?? 1)) {
      interaction.clipFinished();
      clip = '';
    }
  }
  assert.fail(`timed out in ${interaction.phase}/${interaction.state.stage}`);
}

test('every park bench has a backrest, a seat as high as the bed and a free spot in front to sit down from', async () => {
  const outside = await parse('outside');
  const data = readOutside(outside);
  const benches = data.decor.filter((entry) => entry.kind === 'bench');
  assert.ok(benches.length >= 5, `${benches.length} benches`);
  assert.equal(data.benches.length, benches.length, 'each bench is a seat');
  // One primitive per material (wood, iron): the bench's points in its own axes.
  const points: [number, number][] = [];
  outside.getObjectByName(benches[0].name)!.traverse((object) => {
    if (!(object instanceof Mesh)) return;
    const position = object.geometry.getAttribute('position');
    for (let i = 0; i < position.count; i++) points.push([position.getY(i), position.getZ(i)]);
  });
  const top = Math.max(...points.map(([y]) => y));
  assert.ok(top > 1.1, `a backrest (${top.toFixed(2)} m high)`);
  // The seat slats' tops are where the hips go, as high as the bed's duvet (0.63 m), so the bed's clips fit.
  const seat = Math.max(...points.filter(([y, z]) => z > -0.2 && z < 0.2 && y < 0.7).map(([y]) => y));
  assert.ok(Math.abs(seat - 0.63) < 0.01, `seat at ${seat.toFixed(3)} m`);
  for (const spot of data.benches) {
    const bench = benches.find((entry) => entry.name === spot.id)!;
    assert.equal(spot.seat, 'bench');
    assert.ok(Math.abs(spot.yaw - bench.yaw) < 1e-6, `${spot.id} faces the bench's front`);
    const ahead = (point: { x: number; z: number }) => (point.x - bench.position.x) * Math.sin(bench.yaw) + (point.z - bench.position.z) * Math.cos(bench.yaw);
    assert.ok(ahead(spot.stand) > 0.3 && ahead(spot.approaches[0]) > ahead(spot.stand), `${spot.id}: stand and approach in front`);
    assert.equal(overlaps(spot.approaches[0], CHARACTER_RADIUS, data.boxes), undefined, `${spot.id}: approach is free`);
  }
});

test('on a bench the character sits with the bed clips, the laptop appears on the lap, and E stands up again', async () => {
  const data = readOutside(await parse('outside'));
  const interaction = new InteractionController(data.benches, data.boxes, data.bounds, CHARACTER_RADIUS);
  const spot = data.benches[0];
  const from = { x: spot.approaches[0].x + Math.sin(spot.yaw) * 0.6, z: spot.approaches[0].z + Math.cos(spot.yaw) * 0.6 };
  assert.equal(interaction.available(from)?.id, spot.id);
  assert.equal(interaction.prompt(from), 'E: sentarse en la banca');
  const clips: string[] = [];
  assert.ok(interaction.interact(from, 0));
  playUntil(interaction, () => interaction.phase === 'seated' && interaction.state.stage === 'seated', clips);
  assert.ok(clips.includes('sit_down_bed'), clips.join(','));
  assert.deepEqual(interaction.position, spot.stand);
  assert.ok(interaction.laptopPress());
  assert.equal(interaction.laptop, 'lap', 'the laptop appears on the lap like on the bed');
  playUntil(interaction, () => interaction.state.stage === 'typing', clips);
  assert.equal(interaction.clip()?.name, 'typing_bed');
  assert.ok(interaction.interact(interaction.position, 0), 'E closes the laptop and stands up');
  playUntil(interaction, () => interaction.phase === 'free', clips);
  assert.equal(interaction.laptop, 'none');
  assert.ok(clips.includes('stand_up_bed'));
  assert.deepEqual(interaction.position, spot.approaches[0]);
});

test('the bust keeps only its trunk, neck and head, all inside the pedestal top', async () => {
  const outside = await parse('outside');
  outside.updateMatrixWorld(true);
  const bust = outside.getObjectByName('Bust')!;
  const stone = new Box3().setFromObject(outside.getObjectByName('BustStone')!);
  const top = new Box3().setFromObject(outside.getObjectByName('BustPedestalTop')!);
  assert.ok(stone.min.x >= top.min.x && stone.max.x <= top.max.x, `bust x ${stone.min.x.toFixed(2)}…${stone.max.x.toFixed(2)} within ${top.min.x.toFixed(2)}…${top.max.x.toFixed(2)}`);
  assert.ok(stone.min.z >= top.min.z && stone.max.z <= top.max.z, 'bust z within the pedestal');
  // No arms: the bust is about as wide as the head under the cap, not the shoulders and sleeves of the T-pose.
  assert.ok(stone.max.x - bust.position.x < 0.9, `half width ${(stone.max.x - bust.position.x).toFixed(2)} m`);
});
