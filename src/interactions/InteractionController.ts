import { WALK_CLIP_SPEED as WALK_SPEED } from '../character/CharacterController.ts';
import { overlaps, sweep, type Box2, type Floor, type Point2 } from '../world/collisions.ts';
import { InteractionState, type Seat } from './interactionState.ts';

/** A seat as the room exports it: where to walk to (one point per free side), where its clips start, and which way they face. */
export type SeatSpot = { seat: Seat; approaches: Point2[]; stand: Point2; yaw: number };
/** Which laptop is in use: the desk one (it stays on the desk) or one that appears on the lap on the bed. */
export type LaptopPlace = 'none' | 'desk' | 'lap';
export type Phase = 'free' | 'approaching' | 'aligning' | 'seated' | 'exiting';
export type ClipRequest = { name: string; loop: boolean };

/** Seats further than this from the character (to their nearest approach point) are not offered. */
export const REACH = 1.6;
/** Seconds for the lap laptop to appear (or disappear) and for any lid to open (or close). */
export const APPEAR_TIME = 0.15;
export const LID_TIME = 0.3;
const ARRIVED = 0.03;
const TURN_RATE = 9;
const SEAT_NAMES: Record<Seat, string> = { chair: 'la silla', bed: 'la cama' };

const distance = (a: Point2, b: Point2) => Math.hypot(a.x - b.x, a.z - b.z);
const wrap = (angle: number) => Math.atan2(Math.sin(angle), Math.cos(angle));

/**
 * Flow: free → approaching (walk with collisions to the nearest reachable approach point of the
 * seat) → aligning (short scripted step onto the seat's stand point and turn) → seated (clips driven
 * by InteractionState, advanced on clip end) → exiting (back out by the side used to sit down, or the
 * other one if that side is blocked) → free.
 * The laptop is never carried: on the chair the desk laptop opens; on the bed one appears on the lap.
 */
export class InteractionController {
  readonly state = new InteractionState();
  phase: Phase = 'free';
  seat?: SeatSpot;
  laptop: LaptopPlace = 'none';
  /** Lid of the laptop in use, 0 closed … 1 open (the desk laptop rests closed). */
  lid = 0;
  /** Lap laptop size while it appears or disappears, 0 … 1. */
  shown = 0;
  position: Point2 = { x: 0, z: 0 };
  yaw = 0;
  /** Why the last command was refused (Spanish, for the HUD); empty when it was accepted. */
  message = '';
  private entry?: Point2;
  private stalled = 0;
  private moving = false;
  private readonly seats: readonly SeatSpot[];
  private readonly boxes: readonly Box2[];
  private readonly floor: Floor;
  private readonly radius: number;

  constructor(seats: readonly SeatSpot[], boxes: readonly Box2[], floor: Floor, radius: number) {
    this.seats = seats;
    this.boxes = boxes;
    this.floor = floor;
    this.radius = radius;
  }

  /** The seat and approach point the character can use from here: close enough and with a clear straight path. */
  reachable(from: Point2): { spot: SeatSpot; approach: Point2 } | undefined {
    return this.seats
      .flatMap((spot) => spot.approaches.map((approach) => ({ spot, approach })))
      .filter(({ approach }) => distance(from, approach) <= REACH)
      .sort((a, b) => distance(from, a.approach) - distance(from, b.approach))
      .find(({ approach }) => {
        const end = sweep(from, { x: approach.x - from.x, z: approach.z - from.z }, this.radius, this.boxes, this.floor);
        return distance(end, approach) < 0.05;
      });
  }

  available(from: Point2): SeatSpot | undefined {
    return this.reachable(from)?.spot;
  }

  /** E: sit on the nearby seat, or stand up (closing the laptop first if typing). */
  interact(from: Point2, yaw: number): boolean {
    this.message = '';
    if (this.phase === 'free') {
      const target = this.reachable(from);
      if (!target) return this.refuse('Acércate a la silla o a la cama para sentarte.');
      this.seat = target.spot;
      this.entry = target.approach;
      this.position = { ...from };
      this.yaw = yaw;
      this.stalled = 0;
      this.phase = 'approaching';
      return true;
    }
    if (this.phase !== 'seated' || !this.state.can('stand')) return this.refuse('Espera a que termine el movimiento.');
    const exit = this.exitPoint();
    if (!exit) return this.refuse('La salida está bloqueada.');
    this.entry = exit;
    return this.state.command('stand');
  }

  /** L: open the laptop (it appears on the lap on the bed) or close it while seated. */
  laptopPress(): boolean {
    this.message = '';
    if (this.phase !== 'seated' || !this.state.can('laptop')) {
      return this.refuse(this.phase === 'free' ? 'Siéntate para usar el portátil.' : 'Espera a que termine el movimiento.');
    }
    if (this.state.stage === 'seated') this.laptop = this.seat!.seat === 'bed' ? 'lap' : 'desk';
    return this.state.command('laptop');
  }

  /** Clip the character should be playing, or undefined while the keyboard drives it. */
  clip(): ClipRequest | undefined {
    if (this.phase === 'free') return undefined;
    if (this.phase === 'seated') return { name: this.state.clip, loop: this.state.looping };
    return { name: this.moving ? 'walk' : 'idle', loop: true };
  }

  update(dt: number): void {
    const step = Math.min(Math.max(dt, 0), 0.05);
    if (this.phase === 'approaching') this.approach(step);
    else if (this.phase === 'aligning') this.align(step);
    else if (this.phase === 'exiting') this.exit(step);
    else if (this.phase === 'seated') this.animateLaptop(step);
  }

  /** A non-looping seat clip ended: advance the state machine. */
  clipFinished(): void {
    if (this.phase !== 'seated' || !this.state.finish()) return;
    if (this.state.stage === 'idle') {
      this.position = { ...this.seat!.stand };
      this.yaw = this.seat!.yaw;
      this.phase = 'exiting';
    }
  }

  /** Abandon any interaction (manual clip choice, reset): an open laptop closes, the lap one disappears. */
  reset(): void {
    this.state.reset();
    this.phase = 'free';
    this.seat = undefined;
    this.entry = undefined;
    this.moving = false;
    this.laptop = 'none';
    this.lid = this.shown = 0;
  }

  /** HUD text for the current situation. */
  prompt(from: Point2): string {
    if (this.phase === 'free') {
      const spot = this.available(from);
      return spot ? `E: sentarse en ${SEAT_NAMES[spot.seat]}` : '';
    }
    const where = SEAT_NAMES[this.seat!.seat];
    if (this.phase === 'approaching' || this.phase === 'aligning') return `Yendo a ${where}…`;
    if (this.phase === 'exiting') return 'Levantándose…';
    const stage = this.state.stage;
    if (stage === 'seated') return `Sentado en ${where} · L: abrir el portátil · E: levantarse`;
    if (stage === 'typing') return 'Programando · L: cerrar el portátil · E: cerrarlo y levantarse';
    const transitions: Partial<Record<typeof stage, string>> = {
      sitting: 'Sentándose…', opening: 'Abriendo el portátil…', closing: 'Cerrando el portátil…', standing: 'Levantándose…',
    };
    return transitions[stage] ?? '';
  }

  private refuse(message: string): false {
    this.message = message;
    return false;
  }

  /** Leave by the side used to sit down; if something blocks it now, by any other free side. */
  private exitPoint(): Point2 | undefined {
    const spot = this.seat!;
    const sides = [...(this.entry ? [this.entry] : []), ...spot.approaches.filter((point) => point !== this.entry)];
    return sides.find((point) => !overlaps(point, this.radius, this.boxes));
  }

  private animateLaptop(step: number): void {
    const stage = this.state.stage;
    const lap = this.laptop === 'lap';
    if (stage === 'opening') {
      if (lap && this.shown < 1) this.shown = Math.min(1, this.shown + step / APPEAR_TIME);
      else this.lid = Math.min(1, this.lid + step / LID_TIME);
      if (this.lid >= 1) this.state.laptopDone();
    } else if (stage === 'closing') {
      if (this.lid > 0) this.lid = Math.max(0, this.lid - step / LID_TIME);
      else if (lap && this.shown > 0) this.shown = Math.max(0, this.shown - step / APPEAR_TIME);
      if (this.lid <= 0 && (!lap || this.shown <= 0)) {
        this.laptop = 'none';
        this.state.laptopDone();
      }
    }
  }

  private turnTowards(target: number, step: number): number {
    const turn = wrap(target - this.yaw);
    this.yaw += turn * (1 - Math.exp(-step * TURN_RATE));
    return Math.abs(wrap(target - this.yaw));
  }

  private approach(step: number): void {
    const target = this.entry!;
    const gap = distance(this.position, target);
    if (gap < ARRIVED) {
      this.phase = 'aligning';
      return;
    }
    const advance = Math.min(gap, WALK_SPEED * step);
    const next = sweep(this.position, { x: (target.x - this.position.x) / gap * advance, z: (target.z - this.position.z) / gap * advance },
      this.radius, this.boxes, this.floor);
    this.stalled = distance(next, this.position) < advance * 0.25 ? this.stalled + step : 0;
    this.turnTowards(Math.atan2(target.x - this.position.x, target.z - this.position.z), step);
    this.position = next;
    this.moving = true;
    if (this.stalled > 0.6) {
      this.reset();
      this.message = 'El camino al asiento está bloqueado.';
    }
  }

  /** Scripted last step onto the stand point: it overlaps the seat's collider by design. */
  private align(step: number): void {
    const spot = this.seat!;
    if (this.walkTowards(spot.stand, step)) return;
    if (this.turnTowards(spot.yaw, step) > 0.02) return;
    this.yaw = spot.yaw;
    this.state.setSeat(spot.seat);
    this.state.command('sit');
    this.phase = 'seated';
  }

  private exit(step: number): void {
    const target = this.entry!;
    if (this.walkTowards(target, step)) return;
    this.phase = 'free';
    this.seat = undefined;
    this.entry = undefined;
  }

  /** One straight scripted step; false once the target is reached. */
  private walkTowards(target: Point2, step: number): boolean {
    const gap = distance(this.position, target);
    if (gap > ARRIVED) {
      const advance = Math.min(gap, WALK_SPEED * step);
      this.turnTowards(Math.atan2(target.x - this.position.x, target.z - this.position.z), step);
      this.position = { x: this.position.x + (target.x - this.position.x) / gap * advance, z: this.position.z + (target.z - this.position.z) / gap * advance };
      this.moving = true;
      return true;
    }
    this.position = { ...target };
    this.moving = false;
    return false;
  }
}
