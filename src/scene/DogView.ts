import {
  AnimationMixer, LoopOnce, LoopRepeat, Mesh, Quaternion, SkinnedMesh, Vector3, type AnimationAction, type AnimationClip,
  type Bone, type Object3D,
} from 'three';
import { DOG, DOG_CLIPS, dogClip, dogExcitement, type DogClip, type DogState } from '../world/dogFollow.ts';
import type { BlobShadows } from './BlobShadows.ts';

/**
 * Canela on screen: her rig from canela.glb placed where `dogFollow` says, the clip it names cross-faded in, her ears
 * swinging on springs (they lag when she sets off or stops and flap as she runs) and her tail held up and wagging (more
 * when she is excited), lying back on the ground when she sits.
 */

/**
 * The ears are soft flaps: each is a chain of three bones, and each joint below the root hangs off where it rests on the
 * head by a damped spring (`stiffness`, 1/s², softer towards the tip; `damping`, 1/s), the bones kept at their
 * lengths, so the flap lags, bends and folds instead of swinging as one stiff piece. What moves them is physics, not a
 * set wave: the head's jolts throw the joints the other way (`inertia`, the share of the head's acceleration a joint
 * feels, the jolts capped at `jolt` m/s²), and the air pushes against each joint's speed through it (`drag`, 1/s,
 * more towards the tip), so running streams the flaps back and every stride shakes them a little. At speed the air
 * also flutters them (`flutter`, m/s² at the tip at `liftSpeed` m/s). They stay on the head: a joint moves out from
 * the cheek at most `out` (m) and never into it (`into`), nor rises more than `rise` (m) above the root.
 */
export const EAR = {
  stiffness: [240, 160, 110], damping: 6, inertia: 0.7, jolt: 45, drag: [0.8, 1.6, 2.6], flutter: 1.8, liftSpeed: 5,
  out: 0.05, into: 0.004, rise: 0.03,
} as const;
/** The tail: wag (radians either side, beats per second) from calm to excited, and how far it lies back when she sits. */
export const TAIL = { wag: [0.12, 0.55], rate: [1.6, 6.5], sitDroop: -0.55, sitWag: 0.12, ease: 5 } as const;
/** Cross-fades between clips (s): sitting down and getting up take longer. */
const FADE = { normal: 0.22, sit: 0.45 } as const;

/** One ear: its bones from the head down, each bone's rest turn and the direction to its next joint in its own frame,
 * the joints' rest places in the head's frame (root first, tip last) and the moving joints in the world. */
type Ear = {
  bones: Bone[]; rest: Quaternion[]; along: Vector3[]; lengths: number[]; hang: Vector3[]; outward: number;
  joints: Vector3[]; offsets: Vector3[]; velocity: Vector3[]; targets: Vector3[]; pace: Vector3[]; ready: boolean;
};

export class DogView {
  readonly root: Object3D;
  readonly mouth: Object3D | undefined;
  private readonly mixer: AnimationMixer;
  private readonly actions = new Map<DogClip, AnimationAction>();
  private current?: DogClip;
  private readonly ears: Ear[] = [];
  private readonly tail: { bone: Bone; rest: Quaternion; up: Vector3; side: Vector3 }[] = [];
  private droop = 0;
  private wagPhase = 0;
  /** Seconds of ear time, for the wind's flutter. */
  private flapPhase = 0;
  private appearing = false;
  private excitement = 0;
  private lastX = 0;
  private lastZ = 0;
  private readonly shadows: BlobShadows;
  private readonly shadowSlot: number;

  constructor(scene: Object3D, clips: AnimationClip[], shadows: BlobShadows, shadowSlot: number) {
    this.root = scene;
    this.shadows = shadows;
    this.shadowSlot = shadowSlot;
    scene.traverse((object) => {
      if (object instanceof SkinnedMesh) object.frustumCulled = false;
      if (object instanceof Mesh) object.castShadow = true;
    });
    scene.updateMatrixWorld(true);
    this.mouth = scene.getObjectByName('Canela_Mouth');
    this.mixer = new AnimationMixer(scene);
    for (const clip of clips) {
      const name = clip.name as DogClip;
      if (!(name in DOG_CLIPS)) continue;
      const action = this.mixer.clipAction(clip);
      const loop = DOG_CLIPS[name].loop;
      action.setLoop(loop ? LoopRepeat : LoopOnce, Infinity);
      action.clampWhenFinished = !loop;
      this.actions.set(name, action);
    }
    // Ears: the chain of bones down each flap, and where its joints hang in the head's frame.
    const head = scene.getObjectByName('head');
    for (const side of ['L', 'R']) {
      const found = [`ear${side}`, `ear1${side}`, `ear2${side}`].map((name) => scene.getObjectByName(name));
      if (!head || found.some((bone) => !bone)) continue;
      const chain = found as Bone[];
      const places = chain.map((bone) => bone.getWorldPosition(new Vector3()));
      // The last bone ends at the tip: as long as the one before, along its own axis (+Y runs along a bone).
      const n = places.length;
      const lastAxis = new Vector3(0, 1, 0).applyQuaternion(chain[n - 1].getWorldQuaternion(new Quaternion()));
      places.push(places[n - 1].clone().addScaledVector(lastAxis, places[n - 1].distanceTo(places[n - 2])));
      const along = chain.map((bone, i) => {
        const inverse = bone.getWorldQuaternion(new Quaternion()).invert();
        return places[i + 1].clone().sub(places[i]).normalize().applyQuaternion(inverse);
      });
      const hang = places.map((place) => head.worldToLocal(place.clone()));
      this.ears.push({
        bones: chain, rest: chain.map((bone) => bone.quaternion.clone()), along,
        lengths: chain.map((_, i) => places[i].distanceTo(places[i + 1])), hang, outward: Math.sign(hang[0].x) || 1,
        joints: places, offsets: places.map(() => new Vector3()), velocity: places.map(() => new Vector3()),
        targets: places.map((place) => place.clone()), pace: places.map(() => new Vector3()), ready: false,
      });
    }
    // Tail: its bones, and the dog's up and sideways axes in the frame of what each one hangs from.
    for (const name of ['tail1', 'tail2', 'tail3']) {
      const bone = scene.getObjectByName(name) as Bone | undefined;
      if (!bone?.parent) continue;
      const inverse = bone.parent.getWorldQuaternion(new Quaternion()).invert();
      this.tail.push({
        bone, rest: bone.quaternion.clone(),
        up: new Vector3(0, 1, 0).applyQuaternion(inverse).normalize(),
        side: new Vector3(1, 0, 0).applyQuaternion(inverse).normalize(),
      });
    }
  }

  /** Jump to a place at once (no swinging ears from the jump). */
  place(dog: DogState, y: number): void {
    this.root.position.set(dog.x, y, dog.z);
    this.root.rotation.y = dog.yaw;
    this.lastX = dog.x;
    this.lastZ = dog.z;
    for (const ear of this.ears) ear.ready = false;
  }

  private play(clip: DogClip, rate: number): void {
    const action = this.actions.get(clip);
    if (!action) return;
    action.timeScale = rate;
    if (this.current === clip && !(clip === 'jump' || clip === 'pickup')) return;
    if (this.current === clip && action.isRunning()) return;
    const previous = this.current ? this.actions.get(this.current) : undefined;
    const fade = clip === 'sit' || this.current === 'sit' ? FADE.sit : FADE.normal;
    action.reset();
    // Appearing she comes down out of the jump's top; jumping on or off the bed she takes off from the start.
    if (clip === 'jump') action.time = this.appearing ? DOG.appear : 0;
    action.play();
    if (previous && previous !== action) action.crossFadeFrom(previous, fade, false);
    this.current = clip;
  }

  /** Restart a one-shot clip (picking up, then putting down: the same clip twice in a row). */
  replay(): void {
    if (this.current) this.actions.get(this.current)?.reset().play();
  }

  update(delta: number, dog: DogState, y: number, reducedMotion: boolean): void {
    const { clip, rate } = dogClip(dog);
    this.appearing = dog.mode === 'appearing';
    this.play(clip, rate);
    this.root.position.set(dog.x, y, dog.z);
    this.root.rotation.y = dog.yaw;
    this.mixer.update(delta);
    this.root.updateMatrixWorld(true);
    const speed = delta > 0 ? Math.hypot(dog.x - this.lastX, dog.z - this.lastZ) / delta : 0;
    this.lastX = dog.x;
    this.lastZ = dog.z;
    this.poseTail(delta, dog, reducedMotion);
    this.swingEars(delta, Math.min(speed, 12), reducedMotion);
    // Her blob shadow, a little longer than wide, turned with her.
    this.shadows.set(this.shadowSlot, dog.x, dog.z, dog.yaw, 0.55, 0.95, 0.42);
  }

  /** The tail stands up and wags (faster and wider when she is excited); sitting, it lies back with a slow sweep. */
  private poseTail(delta: number, dog: DogState, reducedMotion: boolean): void {
    const ease = 1 - Math.exp(-TAIL.ease * delta);
    this.excitement += (dogExcitement(dog) - this.excitement) * ease;
    const sitting = dog.sitting && dog.speed < 0.05 && dog.mode !== 'picking' && dog.mode !== 'dropping';
    this.droop += ((sitting ? TAIL.sitDroop : 0) - this.droop) * ease;
    const e = this.excitement;
    const amplitude = reducedMotion ? 0 : sitting ? TAIL.sitWag : TAIL.wag[0] + (TAIL.wag[1] - TAIL.wag[0]) * e;
    const beats = TAIL.rate[0] + (TAIL.rate[1] - TAIL.rate[0]) * e;
    this.wagPhase = (this.wagPhase + delta * beats * Math.PI * 2) % (Math.PI * 2);
    const wag = Math.sin(this.wagPhase) * amplitude;
    const turn = new Quaternion();
    const bend = new Quaternion();
    for (const [index, part] of this.tail.entries()) {
      // The root takes the droop and most of the wag; the rest follow a little behind.
      const share = index === 0 ? 1 : 0.35;
      const lag = Math.sin(this.wagPhase - index * 0.6) * amplitude * share;
      turn.setFromAxisAngle(part.up, index === 0 ? wag : lag);
      bend.setFromAxisAngle(part.side, index === 0 ? this.droop : this.droop * 0.15);
      part.bone.quaternion.copy(turn).multiply(bend).multiply(part.rest);
    }
    this.root.updateMatrixWorld(true);
  }

  /** The ears' joints follow where they hang from the head on springs, held at their lengths and on the head; then
   * each bone, root first, is turned to point at its next joint. */
  private swingEars(delta: number, speed: number, reducedMotion: boolean): void {
    const head = this.root.getObjectByName('head');
    if (!head) return;
    const steps = Math.max(1, Math.min(8, Math.ceil(delta / (1 / 120))));
    const dt = Math.min(delta, 0.1) / steps;
    const run = Math.min(1, speed / EAR.liftSpeed);
    this.flapPhase += delta;
    const time = this.flapPhase;
    const local = new Vector3();
    const world = new Quaternion();
    const restWorld = new Quaternion();
    const swing = new Quaternion();
    const rest = new Vector3();
    const now = new Vector3();
    const up = new Vector3();
    const pace = new Vector3();
    const jolt = new Vector3();
    const force = new Vector3();
    const before = new Vector3();
    for (const [side, ear] of this.ears.entries()) {
      for (const [i, bone] of ear.bones.entries()) bone.quaternion.copy(ear.rest[i]);
      ear.bones[0].updateMatrixWorld(true);
      if (reducedMotion) {
        ear.ready = false;
        continue;
      }
      const last = ear.hang.length - 1;
      // Where the joints rest on the head now.
      const targets = ear.hang.map((place) => head.localToWorld(place.clone()));
      if (!ear.ready) {
        for (const [i, from] of ear.targets.entries()) from.copy(targets[i]);
        for (const vector of [...ear.offsets, ...ear.velocity, ...ear.pace]) vector.set(0, 0, 0);
        ear.ready = true;
      }
      up.set(0, 1, 0).transformDirection(head.matrixWorld);
      const frame = Math.max(delta, 1e-4);
      for (let i = 1; i <= last; i++) {
        // How fast the place it rests on moves, and how hard it was jolted since the last frame.
        pace.subVectors(targets[i], ear.targets[i]).divideScalar(frame);
        jolt.subVectors(pace, ear.pace[i]).divideScalar(frame).clampLength(0, EAR.jolt);
        ear.pace[i].copy(pace);
        const offset = ear.offsets[i];
        const velocity = ear.velocity[i];
        const gust = Math.sin(time * 17 + side * 2.1 + i) * 0.6 + Math.sin(time * 29 + side * 4.3 + i * 2) * 0.4;
        for (let step = 0; step < steps; step++) {
          // Spring and damping hold it on its place; the jolt throws it back, the air pushes against its speed.
          force.copy(offset).multiplyScalar(-EAR.stiffness[i - 1]).addScaledVector(velocity, -EAR.damping)
            .addScaledVector(jolt, -EAR.inertia)
            .addScaledVector(pace, -EAR.drag[i - 1]).addScaledVector(velocity, -EAR.drag[i - 1])
            .addScaledVector(up, EAR.flutter * run * run * gust * (i / last));
          velocity.addScaledVector(force, dt);
          offset.addScaledVector(velocity, dt);
        }
      }
      // Each bone keeps its length from the joint above, and the flap stays against the head; what that takes away
      // from a joint's swing is taken from its speed too.
      ear.joints[0].copy(targets[0]);
      for (let i = 1; i <= last; i++) {
        before.addVectors(targets[i], ear.offsets[i]);
        const joint = ear.joints[i];
        const arm = before.clone().sub(ear.joints[i - 1]).normalize();
        joint.copy(ear.joints[i - 1]).addScaledVector(arm, ear.lengths[i - 1]);
        head.worldToLocal(local.copy(joint));
        const off = (local.x - ear.hang[i].x) * ear.outward;
        local.x = ear.hang[i].x + ear.outward * Math.min(EAR.out, Math.max(-EAR.into, off));
        joint.copy(head.localToWorld(local));
        joint.y = Math.min(joint.y, ear.joints[0].y + EAR.rise);
        ear.velocity[i].addScaledVector(local.subVectors(joint, before), 1 / frame);
        ear.offsets[i].subVectors(joint, targets[i]);
      }
      for (const [i, from] of ear.targets.entries()) from.copy(targets[i]);
      // Turn each bone, root first, from where its next joint lies at rest to where it is now.
      for (const [i, bone] of ear.bones.entries()) {
        bone.parent!.getWorldQuaternion(world);
        restWorld.copy(world).multiply(ear.rest[i]);
        rest.copy(ear.along[i]).applyQuaternion(restWorld);
        now.copy(ear.joints[i + 1]).sub(ear.joints[i]);
        if (now.lengthSq() < 1e-10) continue;
        now.normalize();
        swing.setFromUnitVectors(rest, now);
        bone.quaternion.copy(world.invert().multiply(swing.multiply(restWorld)));
        bone.updateMatrixWorld(true);
        // The next joint is where this bone now ends (the clamps may have shortened the gap a little).
        bone.getWorldPosition(local);
        ear.joints[i + 1].copy(local).addScaledVector(now, ear.lengths[i]);
      }
    }
  }

  get clip(): DogClip | undefined {
    return this.current;
  }

  hideShadow(): void {
    this.shadows.hide(this.shadowSlot);
  }

  dispose(): void {
    this.mixer.stopAllAction();
    this.root.removeFromParent();
  }
}
