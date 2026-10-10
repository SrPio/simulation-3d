import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { BOTTLE_FULL, BOTTLE_PROFILE, BOTTLE_UNITS, bottlePath, liquidLevel } from '../src/ui/bottle.ts';
import { gaugeState } from '../src/home/NitroGauge.ts';
import { NITRO } from '../src/world/chairDrive.ts';

test('the gauge bottle has the same outline as the 3D bottle on the chair', () => {
  const source = readFileSync(new URL('../scripts/blender/create_circuit.py', import.meta.url), 'utf8');
  const block = /BOTTLE_PROFILE = \[([\s\S]*?)\]\n/.exec(source)?.[1];
  assert.ok(block, 'BOTTLE_PROFILE in create_circuit.py');
  const blender = [...block.matchAll(/\(([\d.]+), ([\d.]+)\)/g)].map((match) => [Number(match[1]), Number(match[2])]);
  assert.deepEqual(BOTTLE_PROFILE.map((point) => [...point]), blender);
});

test('the silhouette is closed, mirrored round the axis and stands mouth up', () => {
  const path = bottlePath();
  assert.ok(path.startsWith(`M0 ${BOTTLE_UNITS} `) && path.endsWith(' Z'));
  const points = [...path.matchAll(/(-?[\d.]+) (-?[\d.]+)/g)].slice(1).map((match) => [Number(match[1]), Number(match[2])]);
  const half = points.length / 2;
  for (let k = 0; k < half; k++) {
    const [x, y] = points[k];
    const [mx, my] = points[points.length - 1 - k];
    assert.ok(x > 0 && Math.abs(x + mx) < 1e-9 && y === my, `point ${k} mirrored`);
  }
  assert.ok(Math.min(...points.map(([, y]) => y)) === 0, 'the mouth at the top');
});

test('the cola stands at the fuel left and the gauge reads the nitro state', () => {
  assert.equal(liquidLevel(0), BOTTLE_UNITS);
  assert.ok(Math.abs(liquidLevel(1) - (1 - BOTTLE_FULL) * BOTTLE_UNITS) < 1e-9);
  assert.ok(liquidLevel(0.5) > liquidLevel(0.6), 'more fuel stands higher');
  assert.equal(liquidLevel(2), liquidLevel(1));
  assert.equal(liquidLevel(Number.NaN), BOTTLE_UNITS);
  assert.equal(gaugeState('boosting', 0.4), 'boosting');
  assert.equal(gaugeState('none', 1), 'full');
  assert.equal(gaugeState('none', 0.5), 'refilling');
  assert.equal(gaugeState('empty', 0.1), 'empty');
  assert.equal(gaugeState('none', NITRO.restart / 2), 'empty');
});
