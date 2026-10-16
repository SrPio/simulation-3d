import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Vector3 } from 'three';
import { CINE_GLIDE, CINE_SHOTS, CineCamera, ORBIT_SPEED, SHOTS, WORLD_YAW, frameToWorld, frameYaw, shotPose, turnBetween } from '../src/scene/CineCamera.ts';

const feet = new Vector3(10, 0, 5);
const close = (a: number, b: number, tolerance = 1e-6) => Math.abs(a - b) <= tolerance;

test('the number keys reach nine distinct shots', () => {
  assert.equal(CINE_SHOTS.length, 9);
  assert.equal(new Set(CINE_SHOTS).size, 9);
  for (const shot of CINE_SHOTS) assert.ok(SHOTS[shot]);
});

test('a frame offset turns with the facing: forwards along it, right on the character\'s right', () => {
  // Facing +X (yaw π/2): forwards is +X and the right hand is +Z.
  const ahead = frameToWorld([0, 0, 2], Math.PI / 2, feet);
  assert.ok(close(ahead.x, 12) && close(ahead.z, 5));
  const right = frameToWorld([1, 0, 0], Math.PI / 2, feet);
  assert.ok(close(right.x, 10) && close(right.z, 6));
  assert.ok(close(turnBetween(3, -3), 2 * Math.PI - 6));
});

test('the close-up stands in front of the face and the wide shot looks from the isometric corner', () => {
  const face = shotPose('face', feet, 0, 0);
  assert.ok(face.position.z > feet.z + 2, 'in front of a character facing +Z');
  assert.ok(face.position.y > 2 && face.position.y < 2.5, 'at eye height');
  const low = shotPose('low', feet, 0, 0);
  assert.ok(low.position.y < 0.5 && low.aim.y > low.position.y, 'low and looking up');
  for (const facing of [0, 1, 2.5]) {
    const wide = shotPose('wide', feet, frameYaw(SHOTS.wide.frame, facing, facing, 0), 0);
    assert.ok(wide.position.x > feet.x + 10 && wide.position.z > feet.z + 10 && wide.position.y > 10, 'from +X+Z, high');
  }
  const top = shotPose('top', feet, 0, 0);
  assert.ok(close(top.position.x, feet.x) && top.position.y > 8 && close(top.up.z, 1), 'straight above, facing up the picture');
});

test('the push moves in and the pull moves out over their travel time', () => {
  const push = SHOTS.push;
  const start = shotPose('push', feet, 0, 0).position.distanceTo(feet);
  const end = shotPose('push', feet, 0, push.travel! + 1).position.distanceTo(feet);
  assert.ok(start > 9 && end < 4, `push ${start.toFixed(1)} → ${end.toFixed(1)}`);
  const from = shotPose('pull', feet, 0, 0).position;
  const to = shotPose('pull', feet, 0, SHOTS.pull.travel!).position;
  assert.ok(to.y > from.y + 10 && to.distanceTo(feet) > from.distanceTo(feet) * 5);
});

test('shots glide into each other, cut at once in cut mode, and jump with reduced motion', () => {
  const cine = new CineCamera();
  cine.setShot('face', true, 0);
  cine.update(1 / 60, feet, 0, false);
  const face = shotPose('face', feet, 0, 0).position;
  assert.ok(cine.camera.position.distanceTo(face) < 1e-6, 'the first shot starts in place');

  cine.setShot('wide', false, 0);
  cine.update(1 / 60, feet, 0, false);
  assert.ok(cine.camera.position.distanceTo(face) < 0.5, 'a glide starts from the old pose');
  for (let time = 0; time < CINE_GLIDE + 0.1; time += 1 / 60) cine.update(1 / 60, feet, 0, false);
  const wide = shotPose('wide', feet, WORLD_YAW, 0).position;
  assert.ok(cine.camera.position.distanceTo(wide) < 0.05, 'and ends on the new shot');

  cine.cut = true;
  cine.setShot('face', false, 0);
  cine.update(1 / 60, feet, 0, false);
  assert.ok(cine.camera.position.distanceTo(face) < 1e-6, 'a cut jumps');

  cine.cut = false;
  cine.setShot('top', false, 0);
  cine.update(1 / 60, feet, 0, true);
  assert.ok(cine.camera.position.distanceTo(shotPose('top', feet, 0, 0).position) < 1e-6, 'reduced motion jumps');
});

test('the orbit turns round the character and a locked camera stays put', () => {
  const cine = new CineCamera();
  cine.cut = true;
  cine.setShot('orbit', true, 0);
  cine.update(1 / 60, feet, 0, false);
  const angle = () => Math.atan2(cine.camera.position.x - feet.x, cine.camera.position.z - feet.z);
  const before = angle();
  for (let i = 0; i < 120; i++) cine.update(1 / 60, feet, 0, false);
  const turned = Math.abs(turnBetween(before, angle()));
  assert.ok(turned > ORBIT_SPEED * 1.5 && turned < ORBIT_SPEED * 2.5, `turned ${turned.toFixed(2)} rad in 2 s`);

  cine.frozen = true;
  const kept = cine.camera.position.clone();
  const moved = new Vector3(14, 0, 5);
  for (let i = 0; i < 60; i++) cine.update(1 / 60, moved, 0, false);
  assert.ok(cine.camera.position.distanceTo(kept) < 1e-6, 'the locked camera does not move');
  const looking = cine.camera.getWorldDirection(new Vector3());
  const toCharacter = moved.clone().setY(1.5).sub(kept).normalize();
  assert.ok(looking.dot(toCharacter) > 0.99, 'but turns to the character');
});
