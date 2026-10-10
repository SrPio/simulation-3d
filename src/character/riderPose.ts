import { Object3D, Quaternion, Vector3 } from 'three';

/**
 * The rider of the office chair, posed on top of the seated clip: the trunk leans with the driving (forwards when
 * speeding up, back when braking, into the turns, pressed into the backrest by the nitro) and the hands stay on the
 * arm pads through a two-bone arm IK. Pure three.js on the rig's bones, so tests pose the real rig in Node.
 */

/** The lean as a damped spring (radians and rad/s): pitch forwards (+) / back (-), roll to the rider's left (+) / right (-). */
export type Lean = { pitch: number; roll: number; pitchRate: number; rollRate: number };
export const restLean = (): Lean => ({ pitch: 0, roll: 0, pitchRate: 0, rollRate: 0 });

export const LEAN = {
  /** Forward lean per m/s² of forward acceleration, and its limit. */
  accelGain: 0.07,
  /** Side lean per rad/s of turning (towards the inside of the turn). */
  turnGain: 0.16,
  limit: 0.32,
  /** The nitro presses the rider back this far (a negative pitch). */
  nitro: -0.3,
  stiffness: 34,
  damping: 7,
  /** How the lean is shared down the trunk: most in the lower back, some in the chest, a little in the neck. */
  spine: 0.5,
  chest: 0.3,
  neck: 0.2,
} as const;

/** Where the lean wants to be for the chair's forward acceleration (m/s²), its turn rate (rad/s, + to the left) and the nitro. */
export function leanTarget(accel: number, turnRate: number, nitro: boolean): { pitch: number; roll: number } {
  const clamp = (value: number) => Math.max(-LEAN.limit, Math.min(LEAN.limit, value));
  const pitch = nitro ? LEAN.nitro : clamp(accel * LEAN.accelGain);
  return { pitch, roll: clamp(turnRate * LEAN.turnGain) };
}

/** Move the lean towards its target like a damped spring (sub-stepped, frame-rate independent). */
export function leanStep(lean: Lean, target: { pitch: number; roll: number }, dt: number): void {
  const steps = Math.max(1, Math.ceil(dt / (1 / 120)));
  const h = dt / steps;
  for (let i = 0; i < steps; i++) {
    lean.pitchRate += ((target.pitch - lean.pitch) * LEAN.stiffness - lean.pitchRate * LEAN.damping) * h;
    lean.rollRate += ((target.roll - lean.roll) * LEAN.stiffness - lean.rollRate * LEAN.damping) * h;
    lean.pitch += lean.pitchRate * h;
    lean.roll += lean.rollRate * h;
  }
}

const parentQuaternion = new Quaternion();
const turn = new Quaternion();
const axisLocal = new Vector3();

/** Turn a bone by `angle` about an axis given in world space, through its own origin. */
export function rotateBone(bone: Object3D, axisWorld: Vector3, angle: number): void {
  if (!angle) return;
  bone.parent?.getWorldQuaternion(parentQuaternion) ?? parentQuaternion.identity();
  axisLocal.copy(axisWorld).applyQuaternion(parentQuaternion.invert()).normalize();
  turn.setFromAxisAngle(axisLocal, angle);
  bone.quaternion.premultiply(turn);
  bone.updateMatrixWorld(true);
}

/** Turn a bone so the direction from its origin to `from` (world) points at `to`, by `weight` 0…1. */
function aimBone(bone: Object3D, from: Vector3, to: Vector3, weight: number): void {
  const origin = bone.getWorldPosition(new Vector3());
  const a = from.clone().sub(origin).normalize();
  const b = to.clone().sub(origin).normalize();
  const world = new Quaternion().setFromUnitVectors(a, b);
  if (weight < 1) world.slerp(new Quaternion(), 1 - weight);
  bone.parent?.getWorldQuaternion(parentQuaternion) ?? parentQuaternion.identity();
  const inverse = parentQuaternion.clone().invert();
  // A world rotation R applied to the bone becomes P⁻¹ R P in its parent's space.
  const local = inverse.multiply(world).multiply(parentQuaternion);
  bone.quaternion.premultiply(local);
  bone.updateMatrixWorld(true);
}

/** Lean the trunk: pitch about the rider's right-left axis, roll about its forward axis (both in world space). */
export function applyLean(bones: { spine?: Object3D; chest?: Object3D; neck?: Object3D }, lean: Lean, right: Vector3, forward: Vector3): void {
  for (const [bone, share] of [[bones.spine, LEAN.spine], [bones.chest, LEAN.chest], [bones.neck, LEAN.neck]] as const) {
    if (!bone) continue;
    // Forwards is a turn about the rider's left (the right-hand rule with +Y up and +Z forward); left is about -forward.
    rotateBone(bone, right.clone().negate(), lean.pitch * share);
    rotateBone(bone, forward.clone().negate(), lean.roll * share);
  }
}

/**
 * Two-bone IK: turn the upper arm and the forearm so the wrist (the hand bone's origin) reaches `target`, the elbow
 * bending towards `pole`, blended by `weight`. Out of reach, the arm stretches straight towards the target.
 */
export function solveArm(upper: Object3D, fore: Object3D, hand: Object3D, target: Vector3, pole: Vector3, weight = 1): void {
  if (weight <= 0) return;
  const shoulder = upper.getWorldPosition(new Vector3());
  const elbow = fore.getWorldPosition(new Vector3());
  const wrist = hand.getWorldPosition(new Vector3());
  const upperLength = elbow.distanceTo(shoulder);
  const foreLength = wrist.distanceTo(elbow);
  const toTarget = target.clone().sub(shoulder);
  const reach = Math.min(Math.max(toTarget.length(), Math.abs(upperLength - foreLength) + 1e-4), upperLength + foreLength - 1e-4);
  const along = toTarget.normalize();
  // The elbow lies in the plane of the shoulder, the target and the pole, off the shoulder–target line.
  const side = pole.clone().sub(shoulder);
  side.addScaledVector(along, -side.dot(along));
  if (side.lengthSq() < 1e-8) side.set(0, -1, 0).addScaledVector(along, along.y);
  side.normalize();
  const cos = (upperLength * upperLength + reach * reach - foreLength * foreLength) / (2 * upperLength * reach);
  const sin = Math.sqrt(Math.max(0, 1 - cos * cos));
  const bent = shoulder.clone().addScaledVector(along, upperLength * cos).addScaledVector(side, upperLength * sin);
  aimBone(upper, elbow, bent, weight);
  const movedElbow = fore.getWorldPosition(new Vector3());
  const movedWrist = hand.getWorldPosition(new Vector3());
  const goal = movedElbow.clone().add(target.clone().sub(movedElbow).normalize().multiplyScalar(foreLength));
  aimBone(fore, movedWrist, goal, weight);
}

/** Lay the hand flat on the pad: its bone (wrist to knuckles) pointing along `forward`, a little down. */
export function restHand(hand: Object3D, forward: Vector3, weight = 1): void {
  if (weight <= 0) return;
  const wrist = hand.getWorldPosition(new Vector3());
  const child = hand.children.find((child) => child.type === 'Bone');
  const tip = child ? child.getWorldPosition(new Vector3()) : wrist.clone().add(new Vector3(0, -0.08, 0));
  const length = tip.distanceTo(wrist) || 0.08;
  const goal = wrist.clone().addScaledVector(forward.clone().setY(0).normalize().addScaledVector(new Vector3(0, -1, 0), 0.25).normalize(), length);
  aimBone(hand, tip, goal, weight);
}
