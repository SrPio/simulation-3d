import { Group, Mesh, Plane, Vector3, type Object3D } from 'three';
import { applyLean, restHand, solveArm, type Lean } from './riderPose.ts';

/**
 * The office chair and its rider, shared by the world (CharacterViewer) and the laptop's chair downhill minigame: the
 * chair's moving parts, the rider's root on its seat, the Halloween cauldron or the Christmas sleigh hung in the
 * chair's place, the rider cut at the vessel's brim, and the trunk lean plus the hands on the arm pads.
 */

export type Side = 'right' | 'left';
export type ChairBottle = { side: Side; liquid?: Object3D; cap?: Object3D; nozzle: Object3D };

/** The office chair's moving parts: base and casters on the ground, the upper part on the gas lift. */
export type ChairRig = {
  root: Object3D;
  base: Object3D;
  upper: Object3D;
  /** Where the hips go, a child of the upper part. */
  seat: Object3D;
  casters: Object3D[];
  wheels: Object3D[];
  /** Tops of the arm pads, by the rider's side: the hands rest there. */
  armrests: Partial<Record<Side, Object3D>>;
  /** The nitro's soda bottles: the liquid (scaled along its local Y as it empties), the cap that pops off, the mouth. */
  bottles: ChairBottle[];
};

/** Where the rider's wrists rest on the office chair's arm pads: ahead of the pad's middle and above its top (m). */
export const RIDER_WRIST = { ahead: 0.02, up: 0.045 };
/** How far ahead of the office chair's seat centre the rider sits (m). */
export const RIDER_FORWARD = 0.15;
/** Halloween: how far behind the cauldron's middle the rider's hips are (m), leaving room for the legs in front. */
export const RIDER_BACK = 0.16;
/** Christmas: the top of the sleigh's floor above its origin (create_christmas.py build_sleigh: the floor box tops at 0.34). */
export const SLEIGH_FLOOR = 0.34;

/** The chair's parts by name (circuit.glb `OfficeChair`); undefined when it lacks its base, upper part or seat. */
export function takeChairRig(object: Object3D): ChairRig | undefined {
  const base = object.getObjectByName('ChairBase');
  const upper = object.getObjectByName('ChairUpper');
  const seat = object.getObjectByName('OfficeChair_Seat');
  if (!base || !upper || !seat) return undefined;
  const casters: Object3D[] = [];
  const wheels: Object3D[] = [];
  for (let k = 0; k < 5; k++) {
    const caster = object.getObjectByName(`ChairCaster_${k}`);
    const wheel = object.getObjectByName(`ChairWheel_${k}`);
    if (caster && wheel) {
      casters.push(caster);
      wheels.push(wheel);
    }
  }
  const armrests: Partial<Record<Side, Object3D>> = {};
  const bottles: ChairBottle[] = [];
  for (const side of ['right', 'left'] as const) {
    const armrest = object.getObjectByName(`ChairArmrest_${side}`);
    if (armrest) armrests[side] = armrest;
    const nozzle = object.getObjectByName(`ChairNozzle_${side}`);
    if (nozzle) bottles.push({ side, nozzle, liquid: object.getObjectByName(`ChairBottleLiquid_${side}`), cap: object.getObjectByName(`ChairBottleCap_${side}`) });
  }
  return { root: object, base, upper, seat, casters, wheels, armrests, bottles };
}

/**
 * The rider's root on the chair, a child of its upper part: the seat clips start from the stand point, on the ground
 * stand_offset in front of the seat, so the root sits there (and a little forward, or the legs sink into the cushion).
 */
export function mountRider(rig: ChairRig): { rider: Group; offset: number } {
  const rider = new Group();
  rider.name = 'OfficeChair_Rider';
  const offset = Number(rig.seat.userData.stand_offset ?? 0.2);
  rider.position.set(rig.seat.position.x, -rig.upper.position.y, rig.seat.position.z + offset + RIDER_FORWARD);
  rider.quaternion.copy(rig.seat.quaternion);
  rig.upper.add(rider);
  return { rider, offset };
}

/**
 * Halloween's cauldron or Christmas' sleigh in the chair's place: the chair's parts stay as the pivots (the vessel hangs
 * from its upper part, so it sways the same) but are not drawn; the vessel's tubes or thrusters take the bottles' place
 * for the nitro and its grips the arm pads'.
 */
export function hangVessel(rig: ChairRig, rider: Group, offset: number, vessel: Object3D, kind: 'cauldron' | 'sleigh'): void {
  rig.root.traverse((object) => {
    if (object instanceof Mesh) object.visible = false;
  });
  vessel.removeFromParent();
  // The cauldron's middle RIDER_BACK ahead of the rider's hips (the seated clip puts them stand_offset behind its
  // origin); the sleigh's origin under the hips. Both on the ground, facing ahead.
  vessel.position.set(rider.position.x, rider.position.y, rider.position.z - offset + (kind === 'cauldron' ? RIDER_BACK : 0));
  vessel.quaternion.copy(rider.quaternion);
  rig.upper.add(vessel);
  const clear = kind === 'cauldron' ? /Tube|Brew/ : /Glass|Fuel/;
  vessel.traverse((object) => {
    if (!(object instanceof Mesh)) return;
    object.castShadow = !clear.test(object.name);
    object.receiveShadow = true;
  });
  rig.bottles.length = 0;
  const prefix = kind === 'cauldron' ? 'Cauldron' : 'Sleigh';
  for (const side of ['right', 'left'] as const) {
    const nozzle = vessel.getObjectByName(`${prefix}Nozzle_${side}`);
    if (nozzle) {
      rig.bottles.push(kind === 'cauldron'
        ? { side, nozzle, liquid: vessel.getObjectByName(`CauldronTubeLiquid_${side}`), cap: vessel.getObjectByName(`CauldronTubeCork_${side}`) }
        : { side, nozzle, liquid: vessel.getObjectByName(`SleighFuel_${side}`) });
    }
    const grip = vessel.getObjectByName(`${prefix}Grip_${side}`);
    if (grip) rig.armrests[side] = grip;
  }
}

/** Cut the model's materials at `plane` (renderer local clipping must be on). Set before the shaders compile, or they are rebuilt. */
export function clipModel(model: Object3D, plane: Plane): void {
  model.traverse((object) => {
    if (!(object instanceof Mesh)) return;
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      if (material.clippingPlanes?.includes(plane)) continue;
      material.clippingPlanes = [plane];
      material.clipShadows = true;
      material.needsUpdate = true;
    }
  });
}

/** The bones `poseRider` turns: put back to the clip's pose before the next frame's posing. */
export const RIDER_BONES = ['spine', 'chest', 'neck', 'upper_arm_L', 'forearm_L', 'hand_L', 'upper_arm_R', 'forearm_R', 'hand_R'] as const;

/**
 * Lean the rider's trunk by `lean` and put the hands on the arm pads (or the vessel's grips), both blended by `weight`.
 * Call after the mixer has set the seated clip's pose.
 */
export function poseRider(model: Object3D, rig: ChairRig, lean: Lean, weight: number): void {
  if (weight <= 0) return;
  model.updateMatrixWorld(true);
  const ahead = new Vector3(0, 0, 1).transformDirection(model.matrixWorld);
  const right = new Vector3(-1, 0, 0).transformDirection(model.matrixWorld);
  const bone = (name: string) => model.getObjectByName(name);
  applyLean({ spine: bone('spine'), chest: bone('chest'), neck: bone('neck') },
    { ...lean, pitch: lean.pitch * weight, roll: lean.roll * weight }, right, ahead);
  // The rig's side names are mirrored: _L is the rider's right arm.
  for (const [side, suffix, out] of [['right', 'L', 1], ['left', 'R', -1]] as const) {
    const pad = rig.armrests[side];
    const upper = bone(`upper_arm_${suffix}`);
    const fore = bone(`forearm_${suffix}`);
    const hand = bone(`hand_${suffix}`);
    if (!pad || !upper || !fore || !hand) continue;
    // The wrist just above the pad, a little ahead of its middle.
    const wrist = pad.getWorldPosition(new Vector3()).addScaledVector(ahead, RIDER_WRIST.ahead).add(new Vector3(0, RIDER_WRIST.up, 0));
    // The elbow bends outwards and back.
    const pole = upper.getWorldPosition(new Vector3()).addScaledVector(right, 0.4 * out).addScaledVector(ahead, -0.5).add(new Vector3(0, -0.3, 0));
    solveArm(upper, fore, hand, wrist, pole, weight);
    restHand(hand, ahead, weight);
  }
}
