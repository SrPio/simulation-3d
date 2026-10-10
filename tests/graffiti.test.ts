import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { Texture, type Object3D } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { Matrix4, Mesh, Raycaster, Vector3 } from 'three';
import { GRAFFITI, GRAFFITI_SYMBOLS, JITTER, glyphLayout, seeded, surfaceFor, textFor, type GraffitiSpot } from '../src/scene/graffitiData.ts';
import { SPRAY_CHARACTERS, SPRAY_SYMBOLS, sprayGlyph } from '../src/scene/sprayFont.ts';
import { readOutside } from '../src/scene/outsideData.ts';

async function parse(file: string): Promise<Object3D> {
  const data = await readFile(new URL(`../public/models/${file}.glb`, import.meta.url));
  const loader = new GLTFLoader();
  loader.register(() => ({ name: 'EXT_texture_webp', loadTexture: () => Promise.resolve(new Texture()) }));
  return (await loader.parseAsync(data.buffer.slice(data.byteOffset, data.byteOffset + data.length), '')).scene;
}

test('graffiti spots: words sprayed in one colour, known symbols, sensible sizes and faces the corner camera sees', () => {
  assert.equal(new Set(GRAFFITI.map((spot) => spot.id)).size, GRAFFITI.length, 'unique ids');
  for (const spot of GRAFFITI) {
    assert.ok(!!spot.text !== !!spot.symbol, `${spot.id}: either words or a symbol`);
    if (spot.symbol) assert.ok(GRAFFITI_SYMBOLS.includes(spot.symbol), `${spot.id}: ${spot.symbol}`);
    if (spot.symbol && spot.symbol in SPRAY_SYMBOLS) assert.equal(spot.style, 'spray', `${spot.id}: can-stroke symbols are sprayed`);
    for (const language of ['es', 'en'] as const) {
      if (!spot.text) break;
      const text = textFor(spot, language);
      assert.ok(text.trim().length > 0 && text.split('\n').length <= 2, `${spot.id} (${language}): one or two lines`);
      for (const char of text.replace(/[\s\n]/g, '')) assert.ok(sprayGlyph(char), `${spot.id} (${language}): a glyph for ${char}`);
      for (const line of spot.crossed ?? []) assert.ok(line < text.split('\n').length, `${spot.id} (${language}): strikes line ${line}`);
    }
    if (spot.text) {
      // Words are simple strokes of one colour: no fade, no outline.
      assert.equal(spot.style, 'spray', `${spot.id}: words are sprayed`);
      assert.ok(spot.fade === undefined && spot.outline === undefined, `${spot.id}: one colour`);
    }
    if (spot.circled || spot.crossed) assert.ok(spot.text, `${spot.id}: rings and strikes go on words`);
    for (const line of spot.crossed ?? []) assert.ok(Number.isInteger(line) && line >= 0, `${spot.id}: strikes line ${line}`);
    assert.ok(['x', 'z', 'up'].includes(spot.face), `${spot.id}: +X, +Z or up only (the perspective rule)`);
    assert.ok(spot.width >= 0.3 && spot.width <= 4, `${spot.id}: ${spot.width} m wide`);
    assert.ok(Math.abs(spot.tilt ?? 0) <= 20, `${spot.id}: tilted ${spot.tilt}°`);
    for (const colour of [spot.color, spot.fade, spot.outline]) if (colour) assert.match(colour, /^#[0-9a-f]{6}$/i, `${spot.id}: ${colour}`);
  }
});

test('the spray capitals cover letters, digits, punctuation and Spanish accents, inside their box', () => {
  for (const char of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!?.,-*"_=;{}[]|/<>()#&+:ÁÉÍÓÚÑÜ') assert.ok(SPRAY_CHARACTERS.includes(char), char);
  assert.equal(sprayGlyph('a'), sprayGlyph('A'), 'lower case is painted as capitals');
  assert.equal(sprayGlyph(' '), undefined);
  for (const char of SPRAY_CHARACTERS) {
    const glyph = sprayGlyph(char)!;
    assert.ok(glyph.width > 0 && glyph.strokes.length > 0, char);
    for (const [x, y] of glyph.strokes.flat()) {
      assert.ok(x > -0.3 && x < glyph.width + 0.3 && y > -0.35 && y < 1.2, `${char}: point ${x.toFixed(2)},${y.toFixed(2)}`);
    }
  }
  // Technology logos are can-stroke symbols too.
  for (const logo of ['react', 'js', 'ts', 'node', 'git', 'three', 'vite', 'html', 'css', 'terminal']) assert.ok(logo in SPRAY_SYMBOLS, logo);
  for (const [name, symbol] of Object.entries(SPRAY_SYMBOLS)) {
    assert.ok(GRAFFITI_SYMBOLS.includes(name as never), name);
    assert.ok(symbol.strokes.length + (symbol.blobs?.length ?? 0) > 0, name);
  }
});

test('messy lettering is the same for a seed, different for another, and strays only within its style', () => {
  for (const style of ['spray', 'piece', 'tag'] as const) {
    const a = glyphLayout('HOLA\nMUNDO', style, 7);
    assert.deepEqual(a, glyphLayout('HOLA\nMUNDO', style, 7));
    assert.notDeepEqual(a, glyphLayout('HOLA\nMUNDO', style, 8));
    assert.equal(a.length, 9);
    assert.deepEqual([...new Set(a.map((glyph) => glyph.line))], [0, 1]);
    const jitter = JITTER[style];
    for (const glyph of a) {
      assert.ok(Math.abs(glyph.turn) <= jitter.turn && Math.abs(glyph.scale - 1) <= jitter.scale && Math.abs(glyph.shift) <= jitter.shift);
    }
    assert.equal(new Set(a.map((glyph) => glyph.turn.toFixed(4))).size, a.length, 'no two letters alike');
  }
  const random = seeded(3);
  const values = Array.from({ length: 1000 }, random);
  assert.ok(values.every((value) => value >= 0 && value < 1));
  assert.ok(Math.abs(values.reduce((sum, value) => sum + value, 0) / values.length - 0.5) < 0.05);
});

test('graffiti find the surface in front of them (a circuit barrier) or lie flat on open ground', async () => {
  const outside = await parse('outside');
  outside.add(await parse('circuit'));
  outside.updateMatrixWorld(true);
  const data = readOutside(outside);
  const spot = (at: GraffitiSpot['at'], face: GraffitiSpot['face']): GraffitiSpot => ({ id: 'probe', text: 'DEV', style: 'spray', at, face, width: 1, color: '#121014', seed: 1 });
  // A concrete barrier behind the room, on its +Z face.
  const barrier = surfaceFor(spot([5.63, 0.3, -11.78], 'z'), [outside], data.groundY);
  assert.ok(barrier && barrier.point.y > data.groundY && Math.abs(barrier.point.z + 11.9) < 0.3, 'on the barrier');
  // Open ground: nothing to project on, so it lies flat.
  assert.equal(surfaceFor(spot([-6.5, 'ground', 22.5], 'up'), [outside], data.groundY), undefined);
  for (const placed of GRAFFITI.filter((spot) => !spot.loose)) {
    const [x, , z] = placed.at;
    assert.ok(x > data.bounds.minX && x < data.bounds.maxX && z > data.bounds.minZ && z < data.bounds.maxZ, `${placed.id}: inside the bounds`);
    if (placed.at[1] !== 'ground') assert.ok(surfaceFor(placed, [outside], data.groundY), `${placed.id}: found its surface`);
  }
});

test('paint lying on a slope (the ramp) reaches the surface from one end of the words to the other', async () => {
  const outside = await parse('outside');
  outside.add(await parse('circuit'));
  outside.updateMatrixWorld(true);
  const data = readOutside(outside);
  const ramp = GRAFFITI.find((spot) => spot.id === 'ramp-jump')!;
  const centre = surfaceFor(ramp, [outside], data.groundY)!.point;
  const tilt = ((ramp.tilt ?? 0) * Math.PI) / 180;
  const along = new Vector3(Math.cos(tilt), 0, -Math.sin(tilt));
  // The decal box reaches half its depth above and below the centre; the slope under both ends must stay inside it.
  const half = (ramp.depth ?? 0.45) / 2;
  for (const side of [-0.48, 0.48]) {
    const at = centre.clone().addScaledVector(along, side * ramp.width);
    const hit = new Raycaster(at.clone().setY(at.y + 2), new Vector3(0, -1, 0)).intersectObject(outside, true)[0];
    assert.ok(hit, `slope under the ${side < 0 ? 'start' : 'end'}`);
    assert.ok(Math.abs(hit.point.y - centre.y) < half, `${side < 0 ? 'start' : 'end'}: ${(hit.point.y - centre.y).toFixed(2)} m from the centre, box reaches ${half} m`);
  }
});

test('words read in both languages; ones that only exist in English stay the same', () => {
  const both = GRAFFITI.filter((spot) => spot.text && typeof spot.text !== 'string');
  assert.ok(both.length >= 3, 'some words change with the language');
  for (const spot of both) assert.notEqual(textFor(spot, 'es'), textFor(spot, 'en'), `${spot.id}: a translation`);
  const force = GRAFFITI.find((spot) => spot.id === 'barrier-force')!;
  assert.equal(textFor(force, 'es'), textFor(force, 'en'), 'a command reads the same');
});

test('the JAVA graffiti lands on the bricks of the playground wall, spread over many of them', async () => {
  const outside = await parse('outside');
  const data = readOutside(outside);
  const spot = GRAFFITI.find((entry) => entry.id === 'wall-java')!;
  assert.equal(spot.loose, 'bricks');
  const bricks = data.props.filter((piece) => piece.group === spot.loose).map((piece) => {
    const mesh = new Mesh(piece.parts[0].geometry);
    mesh.matrixAutoUpdate = false;
    mesh.matrixWorld.copy(new Matrix4().compose(piece.position, piece.quaternion, new Vector3(1, 1, 1)));
    return { piece, mesh };
  });
  const hit = surfaceFor(spot, bricks.map((brick) => brick.mesh), data.groundY);
  assert.ok(hit, 'a brick under the spot');
  // The paint spans about its width along the wall: the bricks whose front faces lie inside it.
  const covered = bricks.filter(({ piece }) => Math.abs(piece.position.x - spot.at[0]) < spot.width / 2 && Math.abs(piece.position.z - spot.at[2]) < 0.3
    && Math.abs(piece.position.y - (spot.at[1] as number)) < 0.5);
  assert.ok(covered.length >= 8, `${covered.length} bricks under the paint`);
});
