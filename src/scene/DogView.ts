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
 * The ears are soft flaps: each is a chain of three bones whose joints are pulled towards where they hang from the head
 * by springs, softer down the flap (`stiffness`, 1/s², from the first joint below the root to the tip), damped
 * (`damping`, 1/s) and kept at their lengths, so the flap lags, bends and folds instead of swinging as one stiff piece.
 * They stay on the head: a joint moves out from the cheek at most `out` (m) and never into it (`into`), nor rises more
 * than `rise` (m) above the root. Running streams them back and up (`lift`, m at the tip at `liftSpeed` m/s) and
 * bounces them with the stride (`flap`, m at the tip).
 */
export const EAR = {
  stiffness: [150, 70, 38], damping: 7, out: 0.035, into: 0.004, rise: 0.02, lift: 0.11, liftSpeed: 5, flap: 0.025,
} as const;
/** The tail: wag (radians either side, beats per second) from calm to excited, and how far it lies back when she sits. */
export const TAIL = { wag: [0.12, 0.55], rate: [1.6, 6.5], sitDroop: -0.55, sitWag: 0.12, ease: 5 } as const;
/** Cross-fades between clips (s): sitting down and getting up take longer. */
const FADE = { normal: 0.22, sit: 0.45 } as const;

/** One ear: its bones from the head down, each bone's rest turn and the direction to its next joint in its own frame,
 * the joints' rest places in the head's frame (root first, tip last) and the moving joints in the world. */
type Ear = {
  bones: Bone[]; rest: Quaternion[]; along: Vector3[]; lengths: number[]; hang: Vector3[]; outward: number;
  joints: Vector3[]; velocity: Vector3[]; ready: boolean;
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
  private flapPhase = 0;
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
        joints: places, velocity: places.map(() => new Vector3()), ready: false,
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
    if (clip === 'jump') action.time = DOG.appear;
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
    // In the head's frame +Z is forwards: running streams the flaps back and up, and the stride bounces them.
    this.flapPhase = (this.flapPhase + delta * (2 + speed * 1.1) * Math.PI * 2) % (Math.PI * 2);
    const stream = EAR.lift * run;
    const bounce = EAR.flap * run * Math.sin(this.flapPhase);
    const local = new Vector3();
    const world = new Quaternion();
    const restWorld = new Quaternion();
    const swing = new Quaternion();
    const rest = new Vector3();
    const now = new Vector3();
    for (const ear of this.ears) {
      for (const [i, bone] of ear.bones.entries()) bone.quaternion.copy(ear.rest[i]);
      ear.bones[0].updateMatrixWorld(true);
      if (reducedMotion) {
        ear.ready = false;
        continue;
      }
      const last = ear.hang.length - 1;
      const targets = ear.hang.map((place, i) => {
        local.copy(place);
        local.z -= stream * (i / last);
        local.y += (stream * 0.45 + bounce) * (i / last);
        return head.localToWorld(local.clone());
      });
      if (!ear.ready) {
        for (const [i, joint] of ear.joints.entries()) joint.copy(targets[i]);
        for (const velocity of ear.velocity) velocity.set(0, 0, 0);
        ear.ready = true;
      }
      const top = ear.hang[0].y + EAR.rise;
      for (let step = 0; step < steps; step++) {
        ear.joints[0].copy(targets[0]);
        for (let i = 1; i <= last; i++) {
          const pull = targets[i].clone().sub(ear.joints[i]).multiplyScalar(EAR.stiffness[i - 1])
            .addScaledVector(ear.velocity[i], -EAR.damping);
          ear.velocity[i].addScaledVector(pull, dt);
          ear.joints[i].addScaledVector(ear.velocity[i], dt);
        }
        for (let i = 1; i <= last; i++) {
          // Each bone keeps its length from the joint above, and the flap stays against the head.
          const arm = ear.joints[i].clone().sub(ear.joints[i - 1]).normalize();
          ear.joints[i].copy(ear.joints[i - 1]).addScaledVector(arm, ear.lengths[i - 1]);
          head.worldToLocal(local.copy(ear.joints[i]));
          const off = (local.x - ear.hang[i].x) * ear.outward;
          local.x = ear.hang[i].x + ear.outward * Math.min(EAR.out, Math.max(-EAR.into, off));
          local.y = Math.min(local.y, top);
          ear.joints[i].copy(head.localToWorld(local));
        }
      }
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
