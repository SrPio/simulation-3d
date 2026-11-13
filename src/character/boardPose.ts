import { Object3D, Quaternion, Vector3 } from 'three';
import { applyLean, rotateBone, solveArm, type Lean } from './riderPose.ts';

/**
 * The rider of the snow hoverboard, posed on top of the idle clip like a skateboarder: standing across the board with
 * the left foot towards the nose, hips lowered so the knees bend, each sole on its foot mark (two-bone leg IK, knees
 * forwards and a little apart, feet kept flat on the tilting deck), the trunk a little forward and leaning with the ride,
 * the head and chest turned to look where it goes, and the arms held out for balance. Pure three.js on the rig's bones
 * (the side names are mirrored: `_L` is the rider's right), so tests pose the real rig in Node.
 */
export const STANCE = {
  /** How far the hips drop (m), plus the landing dip on top. */
  crouch: 0.06,
  /** Constant forward lean of the trunk (rad). */
  lean: 0.14,
  /** Turn towards the direction of travel (rad, about the vertical): chest, neck and head. */
  chest: 0.22,
  neck: 0.4,
  head: 0.55,
  /** Arms out from the sides (rad) and the elbows' bend (rad); the arms swing with the lean. */
  armOut: 0.95,
  elbow: 0.45,
  armSwing: 1.2,
  /** Knees point this far out of the facing towards their own end of the board (0…1). */
  kneesApart: 0.35,
} as const;

/** Bones `poseBoard` turns (and `pelvis`, which it also moves): put back to the clip's pose before the next frame. */
export const BOARD_BONES = [
  'pelvis', 'spine', 'chest', 'neck', 'head',
  'thigh_L', 'shin_L', 'foot_L', 'thigh_R', 'shin_R', 'foot_R',
  'upper_arm_L', 'forearm_L', 'upper_arm_R', 'forearm_R',
] as const;

export type BoardStance = {
  /** World points where the soles stand: the front foot (the rider's left) and the back one. */
  front: Vector3;
  back: Vector3;
  /** The deck's tilt in the world (its bank), applied to the feet so they stay flat on it. */
  tilt: Quaternion;
  /** The trunk's lean: pitch over the toes (+) or heels, roll towards the nose (+, the rider's left). */
  lean: Lean;
  /** Extra knee bend (m) from the landing dip. */
  dip: number;
  /** 0 (the clip as it is) … 1 (the full stance). */
  weight: number;
};

const parentQuaternion = new Quaternion();

/** Set a bone's world rotation. */
function setWorldQuaternion(bone: Object3D, world: Quaternion): void {
  bone.parent?.getWorldQuaternion(parentQuaternion) ?? parentQuaternion.identity();
  bone.quaternion.copy(parentQuaternion.invert().multiply(world));
  bone.updateMatrixWorld(true);
}

/** Pose the model (placed with its feet on the deck's middle, facing across the board) after the mixer has set the idle pose. */
export function poseBoard(model: Object3D, stance: BoardStance): void {
  const weight = Math.min(Math.max(stance.weight, 0), 1);
  if (weight <= 0) return;
  model.updateMatrixWorld(true);
  const bone = (name: string) => model.getObjectByName(name);
  const up = new Vector3(0, 1, 0);
  const facing = new Vector3(0, 0, 1).transformDirection(model.matrixWorld);
  const right = new Vector3(-1, 0, 0).transformDirection(model.matrixWorld);
  const pelvis = bone('pelvis');
  // The rider's left leg (rig `_R`) goes to the front foot mark, the right one (`_L`) to the back.
  const legs = [
    { thigh: bone('thigh_R'), shin: bone('shin_R'), foot: bone('foot_R'), mark: stance.front, out: right.clone().negate() },
    { thigh: bone('thigh_L'), shin: bone('shin_L'), foot: bone('foot_L'), mark: stance.back, out: right.clone() },
  ];
  const root = model.getWorldPosition(new Vector3());
  // Before anything moves: how high each ankle stands over the soles, and how the feet are turned.
  const rest = legs.map(({ foot }) => foot ? {
    ankle: foot.getWorldPosition(new Vector3()),
    turn: foot.getWorldQuaternion(new Quaternion()),
  } : undefined);
  // Lower the hips.
  if (pelvis?.parent) {
    const world = pelvis.getWorldPosition(new Vector3()).addScaledVector(up, -(STANCE.crouch + stance.dip) * weight);
    pelvis.position.copy(pelvis.parent.worldToLocal(world));
    pelvis.updateMatrixWorld(true);
  }
  // Each sole on its mark, the knee bending forwards and a little out towards its own end.
  for (const [i, leg] of legs.entries()) {
    const before = rest[i];
    if (!leg.thigh || !leg.shin || !leg.foot || !before) continue;
    const ankleHeight = before.ankle.y - root.y;
    const goal = leg.mark.clone().addScaledVector(up, ankleHeight);
    const target = before.ankle.clone().lerp(goal, weight);
    const knee = leg.thigh.getWorldPosition(new Vector3()).lerp(target, 0.5)
      .addScaledVector(facing, 1).addScaledVector(leg.out, STANCE.kneesApart);
    solveArm(leg.thigh, leg.shin, leg.foot, target, knee, 1);
    // The foot as it stood in the clip (flat, toes along the facing), tilted with the deck.
    setWorldQuaternion(leg.foot, before.turn.clone().premultiply(new Quaternion().slerp(stance.tilt, weight)));
  }
  // The trunk: a little forward, plus the ride's lean, and turned to look where it goes (towards the rider's left).
  const lean = { ...stance.lean, pitch: (STANCE.lean + stance.lean.pitch) * weight, roll: stance.lean.roll * weight };
  applyLean({ spine: bone('spine'), chest: bone('chest'), neck: bone('neck') }, lean, right, facing);
  for (const [name, angle] of [['chest', STANCE.chest], ['neck', STANCE.neck], ['head', STANCE.head]] as const) {
    const part = bone(name);
    if (part) rotateBone(part, up, angle * weight);
  }
  // Arms out for balance, elbows a little bent, swinging against the lean.
  for (const [suffix, side] of [['L', -1], ['R', 1]] as const) {
    const upper = bone(`upper_arm_${suffix}`);
    const fore = bone(`forearm_${suffix}`);
    // A positive turn about the facing lifts an arm towards the rider's left: the right arm (_L) turns the other way.
    if (upper) {
      rotateBone(upper, facing, side * (STANCE.armOut + side * stance.lean.roll * STANCE.armSwing) * weight);
      rotateBone(upper, right, -stance.lean.pitch * STANCE.armSwing * weight);
    }
    if (fore) rotateBone(fore, right, STANCE.elbow * weight);
  }
}
