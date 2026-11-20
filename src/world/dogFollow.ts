import type { Point2 } from './collisions.ts';

/**
 * Canela's behaviour, pure: she follows the character (to a spot behind and beside them, sitting down by herself when
 * they stand still a while), stays sitting where she was told to, runs after a thrown baseball, picks it up, brings it
 * back and puts it down at the character's feet. The viewer moves her body with collisions (`move`), plays the clip
 * `dogClip` names and swings her ears and tail.
 */

/** Her clips, as `rig_dog.py` writes them in `canela.manifest.json` (tests/dog.test.ts keeps them equal). */
export const DOG_CLIPS = {
  idle: { duration: 3.3333, loop: true },
  walk: { duration: 1.0417, loop: true, speed: 0.944 },
  run: { duration: 0.5417, loop: true, speed: 1.942 },
  jump: { duration: 1.3333, loop: false, takeoff: 0.2083, landing: 0.9583, lift: 0.2387 },
  sit: { duration: 2, loop: true },
  pickup: { duration: 0.875, loop: false, grab: 0.4167 },
} as const;

export type DogClip = keyof typeof DOG_CLIPS;

export const DOG = {
  /** Her collision circle (m). */
  radius: 0.26,
  /** Where she keeps to: this far behind the character and this far to their right (m). */
  behind: 1.0,
  side: 0.8,
  /** She sets off when that spot is farther than `start` and stops within `settle` of it (m). */
  start: 0.95,
  settle: 0.3,
  /** Fastest walk (m/s); faster is a run, up to `run`. */
  walk: 1.7,
  run: 7.6,
  /** How quickly her speed and heading follow what she wants (1/s). */
  accel: 6,
  turn: 9,
  /** Standing still this long (s), she sits down by herself; she gets up when the spot is `rise` away. */
  restSit: 5,
  rise: 1.6,
  /** Farther than this from the character (m), or stuck this long (s), she reappears beside them. */
  teleport: 24,
  stuck: 2.5,
  /** Her mouth is this far ahead of her middle (m); a ball within `reach` of it, slower than `catchSpeed` (m/s) and
   * lower than `catchHeight` over the ground (m), can be picked up. */
  mouth: 0.45,
  reach: 0.4,
  catchSpeed: 2.5,
  catchHeight: 0.35,
  /** She puts the ball down this far from the character, on her side (m). */
  dropAt: 0.8,
  /** Appearing, the jump clip starts here (s): she comes down out of the air and sits. */
  appear: 0.55,
} as const;

export type DogMode = 'appearing' | 'following' | 'staying' | 'fetching' | 'picking' | 'returning' | 'dropping';

export type DogState = {
  x: number;
  z: number;
  /** 0 faces +Z, like the character. */
  yaw: number;
  speed: number;
  mode: DogMode;
  /** Told to stay: she sits where she is until told to follow. */
  stay: boolean;
  /** Sitting now (told to stay, or resting while the character stands still). */
  sitting: boolean;
  /** Seconds standing still, seconds into the current clip of a timed mode, seconds without getting anywhere. */
  still: number;
  timer: number;
  stuck: number;
  carrying: boolean;
};

/** The ball she is after, where it is (y over the ground) and how fast it goes. */
export type DogBall = { x: number; y: number; z: number; speed: number };

export type DogInput = { character: { x: number; z: number; yaw: number }; ball: DogBall | null; delta: number };

/** What happened this step: she took the ball in her mouth, put it down, lost it, or jumped back beside the character. */
export type DogEvent = 'grab' | 'drop' | 'lost' | 'teleport' | 'landed';

export function dogAt(position: Point2, yaw: number, mode: DogMode = 'following'): DogState {
  return {
    x: position.x, z: position.z, yaw, speed: 0, mode, stay: false, sitting: mode !== 'appearing', still: DOG.restSit,
    timer: 0, stuck: 0, carrying: false,
  };
}

/** The spot she keeps to beside the character. */
export function followSpot(character: { x: number; z: number; yaw: number }): Point2 {
  const sin = Math.sin(character.yaw);
  const cos = Math.cos(character.yaw);
  // Forward (sin, cos); the character's right is (-cos, sin).
  return { x: character.x - sin * DOG.behind - cos * DOG.side, z: character.z - cos * DOG.behind + sin * DOG.side };
}

/** Sit or follow (G): a sitting dog stays put; told again, she follows. Ignored while she is busy with a ball. */
export function toggleStay(dog: DogState): void {
  dog.stay = !dog.stay;
  if (dog.mode === 'following' || dog.mode === 'staying') {
    dog.mode = dog.stay ? 'staying' : 'following';
    dog.sitting = dog.stay;
    dog.still = dog.stay ? DOG.restSit : 0;
  }
}

/** A ball was thrown: she goes after it whatever she was doing (except coming down from a jump). */
export function fetchBall(dog: DogState): void {
  if (dog.mode === 'appearing' || dog.mode === 'picking' || dog.mode === 'dropping' || dog.carrying) return;
  dog.mode = 'fetching';
  dog.sitting = false;
  dog.timer = 0;
  dog.stuck = 0;
}

/** Put her somewhere at once (beside the character), coming down from a little jump. */
export function placeDog(dog: DogState, at: Point2, yaw: number, appear = true): void {
  dog.x = at.x;
  dog.z = at.z;
  dog.yaw = yaw;
  dog.speed = 0;
  dog.stuck = 0;
  dog.timer = 0;
  dog.carrying = false;
  dog.mode = appear ? 'appearing' : dog.stay ? 'staying' : 'following';
  dog.sitting = !appear;
  dog.still = DOG.restSit;
}

function angleTo(from: number, to: number): number {
  return Math.atan2(Math.sin(to - from), Math.cos(to - from));
}

function idleMode(dog: DogState): DogMode {
  return dog.stay ? 'staying' : 'following';
}

/**
 * One step. `move` slides her from where she is by a step, with collisions, and returns where she ends up.
 */
export function dogStep(dog: DogState, input: DogInput, move: (from: Point2, step: Point2) => Point2): DogEvent[] {
  const events: DogEvent[] = [];
  const dt = Math.min(Math.max(input.delta, 0), 0.1);
  const { character, ball } = input;
  dog.timer += dt;

  if (dog.mode === 'appearing') {
    if (dog.timer >= DOG_CLIPS.jump.duration - DOG.appear) {
      dog.mode = idleMode(dog);
      dog.sitting = true;
      dog.still = DOG.restSit;
      dog.timer = 0;
      events.push('landed');
    }
    return events;
  }

  const far = Math.hypot(character.x - dog.x, character.z - dog.z) > DOG.teleport;
  if ((far && dog.mode !== 'staying') || dog.stuck > DOG.stuck) {
    const spot = followSpot(character);
    const lost = dog.carrying || dog.mode === 'fetching' || dog.mode === 'picking';
    placeDog(dog, spot, character.yaw);
    if (lost) events.push('lost');
    events.push('teleport');
    return events;
  }

  // Where she wants to go and how fast.
  let target: Point2 | undefined;
  let want = 0;
  let face: number | undefined;
  switch (dog.mode) {
    case 'following': {
      const spot = followSpot(character);
      const d = Math.hypot(spot.x - dog.x, spot.z - dog.z);
      const moving = dog.speed > 0.05;
      if (d > (moving ? DOG.settle : dog.sitting ? DOG.rise : DOG.start)) {
        target = spot;
        want = Math.min(DOG.run, Math.max(0.9, (d - DOG.settle) * 2.2));
      }
      face = Math.atan2(character.x - dog.x, character.z - dog.z);
      break;
    }
    case 'staying':
      dog.sitting = true;
      break;
    case 'fetching': {
      if (!ball) {
        dog.mode = idleMode(dog);
        events.push('lost');
        break;
      }
      const mouth = { x: dog.x + Math.sin(dog.yaw) * DOG.mouth, z: dog.z + Math.cos(dog.yaw) * DOG.mouth };
      const reach = Math.hypot(ball.x - mouth.x, ball.z - mouth.z);
      if (reach < DOG.reach && ball.speed < DOG.catchSpeed && ball.y < DOG.catchHeight) {
        dog.mode = 'picking';
        dog.timer = 0;
        dog.speed = 0;
        break;
      }
      const d = Math.hypot(ball.x - dog.x, ball.z - dog.z);
      target = { x: ball.x, z: ball.z };
      // Flat out, then slowing as she gets there (but never stopping short).
      want = Math.min(DOG.run, Math.max(1.2, (d - DOG.mouth * 0.6) * 3));
      break;
    }
    case 'picking':
      if (!dog.carrying && dog.timer >= DOG_CLIPS.pickup.grab) {
        if (!ball) {
          dog.mode = idleMode(dog);
          events.push('lost');
          break;
        }
        dog.carrying = true;
        events.push('grab');
      }
      if (dog.timer >= DOG_CLIPS.pickup.duration) {
        dog.mode = 'returning';
        dog.timer = 0;
      }
      break;
    case 'returning': {
      const away = Math.hypot(dog.x - character.x, dog.z - character.z) || 1;
      const spot = { x: character.x + ((dog.x - character.x) / away) * DOG.dropAt, z: character.z + ((dog.z - character.z) / away) * DOG.dropAt };
      const d = Math.hypot(spot.x - dog.x, spot.z - dog.z);
      if (d < 0.2 || away <= DOG.dropAt + 0.05) {
        const toward = Math.atan2(character.x - dog.x, character.z - dog.z);
        if (dog.speed < 0.3 && Math.abs(angleTo(dog.yaw, toward)) < 0.35) {
          dog.mode = 'dropping';
          dog.timer = 0;
          dog.speed = 0;
        }
        face = toward;
      } else {
        target = spot;
        want = Math.min(DOG.run, Math.max(0.9, d * 2.4));
      }
      break;
    }
    case 'dropping':
      if (dog.carrying && dog.timer >= DOG_CLIPS.pickup.grab) {
        dog.carrying = false;
        events.push('drop');
      }
      if (dog.timer >= DOG_CLIPS.pickup.duration) {
        dog.mode = idleMode(dog);
        dog.sitting = true;
        dog.still = DOG.restSit;
        dog.timer = 0;
      }
      break;
  }

  // Speed and heading ease towards what she wants; she moves the way she faces.
  const ease = 1 - Math.exp(-DOG.accel * dt);
  dog.speed += (want - dog.speed) * ease;
  if (dog.speed < 0.02 && want === 0) dog.speed = 0;
  const heading = target ? Math.atan2(target.x - dog.x, target.z - dog.z) : face;
  if (heading !== undefined && (target || dog.speed < 0.3)) {
    const turn = 1 - Math.exp(-(target ? DOG.turn : DOG.turn * 0.4) * dt);
    dog.yaw += angleTo(dog.yaw, heading) * turn;
  }
  if (dog.speed > 0) {
    const step = { x: Math.sin(dog.yaw) * dog.speed * dt, z: Math.cos(dog.yaw) * dog.speed * dt };
    const to = move({ x: dog.x, z: dog.z }, step);
    const moved = Math.hypot(to.x - dog.x, to.z - dog.z);
    const meant = Math.hypot(step.x, step.z);
    dog.stuck = target && meant > 1e-4 && moved < meant * 0.25 ? dog.stuck + dt : 0;
    dog.x = to.x;
    dog.z = to.z;
  } else {
    dog.stuck = 0;
  }

  // Resting: still a while, she sits; on the way again, she gets up.
  if (dog.mode === 'following') {
    if (dog.speed > 0.05) {
      dog.still = 0;
      dog.sitting = false;
    } else {
      dog.still += dt;
      if (dog.still >= DOG.restSit) dog.sitting = true;
    }
  } else if (dog.mode !== 'staying') {
    dog.sitting = false;
  }
  return events;
}

/** The clip she plays now and how fast it runs, so her paws keep pace with the ground. */
export function dogClip(dog: DogState): { clip: DogClip; rate: number } {
  if (dog.mode === 'appearing') return { clip: 'jump', rate: 1 };
  if (dog.mode === 'picking' || dog.mode === 'dropping') return { clip: 'pickup', rate: 1 };
  if (dog.speed < 0.05) return { clip: dog.sitting ? 'sit' : 'idle', rate: 1 };
  if (dog.speed <= DOG.walk) return { clip: 'walk', rate: Math.min(2.2, Math.max(0.5, dog.speed / DOG_CLIPS.walk.speed)) };
  return { clip: 'run', rate: Math.min(3.4, Math.max(0.8, dog.speed / DOG_CLIPS.run.speed)) };
}

/** How excited her tail is: 0 calm … 1 wagging hard (with the ball, running after it, just come back). */
export function dogExcitement(dog: DogState): number {
  if (dog.mode === 'fetching' || dog.mode === 'returning' || dog.carrying) return 1;
  if (dog.mode === 'picking' || dog.mode === 'dropping' || dog.mode === 'appearing') return 0.8;
  if (dog.speed > 0.05) return 0.55;
  return dog.sitting ? 0.2 : 0.35;
}
