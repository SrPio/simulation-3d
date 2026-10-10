import assert from 'node:assert/strict';
import { statSync } from 'node:fs';
import { test } from 'node:test';
import { EXPECTED_BYTES } from '../src/core/loadAssets.ts';
import { DOWNLOAD_SHARE, ProgressMeter } from '../src/core/loadProgress.ts';
import { coverScale, easeIn, FILL, fillStep, finishSpeed, outlineCentre } from '../src/home/StartScreen.ts';
import { ACTION_ICONS, HEAD_OUTLINE } from '../src/ui/silhouettes.ts';

/** The points of an SVG path made of M/L/Z commands, one list per closed loop. */
function loops(d: string): { x: number; y: number }[][] {
  return d.split('Z').filter(Boolean).map((part) => [...part.matchAll(/[ML](-?[\d.]+) (-?[\d.]+)/g)].map((m) => ({ x: Number(m[1]), y: Number(m[2]) })));
}

test('the head outline is one closed loop in profile with the cap brim behind, starting under the chin', () => {
  const [head, ...rest] = loops(HEAD_OUTLINE.d);
  assert.equal(rest.length, 0, 'a single loop the loading line can follow');
  assert.ok(head.length > 60, `smooth enough (${head.length} points)`);
  const xs = head.map((p) => p.x);
  const ys = head.map((p) => p.y);
  assert.ok(Math.min(...ys) >= -0.5 && Math.max(...ys) <= HEAD_OUTLINE.height + 0.5);
  assert.ok(Math.min(...xs) >= -0.5 && Math.max(...xs) <= HEAD_OUTLINE.width + 0.5);
  // The line starts at the lowest point (under the chin and beard).
  assert.ok(head[0].y >= Math.max(...ys) - 0.5, 'starts at the bottom');
  // Facing right: the backwards brim is the leftmost point, above the middle of the head.
  const brim = head.reduce((best, p) => (p.x < best.x ? p : best));
  assert.ok(brim.x < HEAD_OUTLINE.width * 0.1 && brim.y < HEAD_OUTLINE.height * 0.75, 'brim sticks out behind');
});

test('every touch button has a filled profile figure inside its 100 × 100 box', () => {
  const names = Object.keys(ACTION_ICONS);
  assert.deepEqual(names.sort(), ['jump', 'kick', 'laptop', 'nitro', 'open', 'punch', 'run', 'sit', 'throw']);
  for (const [name, d] of Object.entries(ACTION_ICONS)) {
    const points = loops(d).flat();
    assert.ok(points.length > 30, name);
    for (const p of points) assert.ok(p.x >= 3.5 && p.x <= 96.5 && p.y >= 3.5 && p.y <= 96.5, `${name} stays in its box`);
    const width = Math.max(...points.map((p) => p.x)) - Math.min(...points.map((p) => p.x));
    const height = Math.max(...points.map((p) => p.y)) - Math.min(...points.map((p) => p.y));
    assert.ok(Math.max(width, height) > 90, `${name} fills its box`);
    // The kick, the throw and the seated figures with a laptop or the bottles spread sideways; standing ones are tall.
    if (['laptop', 'nitro', 'kick', 'throw'].includes(name)) assert.ok(width > height * 0.55, `${name} is wide`);
    if (['open', 'punch'].includes(name)) assert.ok(height > width, `${name} is tall`);
  }
});

test('the loading line only moves forward and fills once the scene is ready', () => {
  const seen: number[] = [];
  const meter = new ProgressMeter((fraction) => seen.push(fraction));
  const model = meter.file('model', 1000);
  const room = meter.file('room', 1000);
  model(500, 1000);
  room(1000, 1000);
  // A file larger than its estimate grows the total: the line must not go back.
  model(900, 3000);
  model(3000, 3000);
  assert.ok(seen.every((value, i) => i === 0 || value >= seen[i - 1]), 'monotonic');
  assert.ok(Math.abs(meter.fraction - DOWNLOAD_SHARE) < 1e-9, 'downloads fill their share only');
  meter.report(1);
  assert.equal(meter.fraction, 1);
  assert.equal(seen.at(-1), 1);
});

test('the expected sizes of the room page files are close to the real ones', () => {
  for (const [file, bytes] of Object.entries(EXPECTED_BYTES)) {
    const real = statSync(new URL(`../public/${file}`, import.meta.url)).size;
    assert.ok(Math.abs(real - bytes) / real < 0.4, `${file}: ${bytes} vs ${real}`);
  }
});

test('the opening grows the hole until it covers every corner of the screen', () => {
  assert.equal(easeIn(0), 0);
  assert.equal(easeIn(1), 1);
  for (let t = 0.1; t < 1; t += 0.1) assert.ok(easeIn(t) > easeIn(t - 0.1));
  for (const [width, height] of [[1440, 900], [390, 844], [2560, 1080]]) {
    const centre = { x: width / 2, y: height / 2 };
    const inner = 0.3 * Math.min(width, height) * 0.46;
    const scale = coverScale(width, height, centre, inner);
    assert.ok(inner * scale >= Math.hypot(width / 2, height / 2), `${width}×${height}`);
  }
});

test('the head is centred by its area, which sits behind the cap brim and inside the skull', () => {
  const centre = outlineCentre(HEAD_OUTLINE.d);
  assert.ok(centre.x > HEAD_OUTLINE.width / 2 + 3, `right of the box middle the brim pulls back (${centre.x.toFixed(1)})`);
  assert.ok(centre.x < HEAD_OUTLINE.width * 0.75 && centre.y > HEAD_OUTLINE.height * 0.3 && centre.y < HEAD_OUTLINE.height * 0.7);
});

test('the shown progress fills smoothly from 0 to 100 however fast the scene loads', () => {
  const run = (readyAt: number) => {
    let shown = 0;
    let time = 0;
    let finish = 0;
    let biggest = 0;
    while (shown < 1 && time < 60000) {
      if (!finish && time >= readyAt) finish = finishSpeed(shown);
      const next = fillStep(shown, time, 16, finish);
      assert.ok(next >= shown, 'never goes back');
      biggest = Math.max(biggest, next - shown);
      shown = next;
      time += 16;
    }
    return { time, biggest, shown };
  };
  // Loaded at once (a warm cache): it still takes the whole fill, never jumping.
  const instant = run(0);
  assert.ok(instant.time >= FILL.FILL_MS * 0.95 && instant.time <= FILL.FILL_MS + 400, `${instant.time} ms`);
  assert.ok(instant.biggest < 0.01);
  // A slow load: it waits below 100 and finishes within FINISH_MS once ready.
  const slow = run(8000);
  assert.ok(slow.time >= 8000 && slow.time <= 8000 + FILL.FINISH_MS + 32, `${slow.time} ms`);
  let shown = 0;
  for (let time = 0; time < 20000; time += 16) shown = fillStep(shown, time, 16, 0);
  assert.ok(shown > FILL.HOLD_AT && shown <= FILL.CREEP_MAX, 'never reaches 100 before the scene is ready');
});
