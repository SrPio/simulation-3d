import { WALK_SPEED } from '../character/CharacterController.ts';
import { overlaps, sweep, type Box2, type Point2 } from '../world/collisions.ts';
import { InteractionState, type Seat } from './interactionState.ts';

/** A seat as the room exports it: where to walk to, where its clips start, and which way they face. */
export type SeatSpot = { seat: Seat; approach: Point2; stand: Point2; yaw: number };
export type LaptopPlace = 'desk' | 'stowed' | 'lap';
export type Phase = 'free' | 'approaching' | 'aligning' | 'seated' | 'exiting';
export type ClipRequest = { name: string; loop: boolean };
export type LaptopEvents = { take: number; open: number; close: number; store: number };

/** Seats further than this from the character (to their approach point) are not offered. */
export const REACH = 1.6;
/** Fractions of laptop_draw / laptop_stow where the laptop is taken, opened, closed and stored (clip manifest). */
export const LAPTOP_EVENTS: LaptopEvents = { take: 0.25, open: 0.7, close: 0.3, store: 0.75 };
const ARRIVED = 0.03;
const TURN_RATE = 9;
const LID_SPEED = 2.5;
const SEAT_NAMES: Record<Seat, string> = { chair: 'la silla', bed: 'la cama' };

const distance = (a: Point2, b: Point2) => Math.hypot(a.x - b.x, a.z - b.z);
const wrap = (angle: number) => Math.atan2(Math.sin(angle), Math.cos(angle));

/**
 * Phase 5 flow: free → approaching (walk with collisions to the seat's approach point) → aligning
 * (short scripted step onto the seat's stand point and turn) → seated (clips driven by
 * InteractionState, advanced on clip end) → exiting (back to the approach point) → free.
 * One laptop, one place: on the desk, stowed (carried) or on the lap while seated on the bed.
 */
export class InteractionController {
  readonly state = new InteractionState();
  phase: Phase = 'free';
  seat?: SeatSpot;
  laptop: LaptopPlace = 'desk';
  /** Lid opening, 0 closed … 1 open. */
  lid = 1;
  position: Point2 = { x: 0, z: 0 };
  yaw = 0;
  /** Why the last command was refused (Spanish, for the HUD); empty when it was accepted. */
  message = '';
  private lidTarget = 1;
  private stalled = 0;
  private fired = new Set<string>();
  private readonly seats: readonly SeatSpot[];
  private readonly boxes: readonly Box2[];
  private readonly halfSize: number;
  private readonly radius: number;
  private readonly events: LaptopEvents;

  constructor(seats: readonly SeatSpot[], boxes: readonly Box2[], halfSize: number, radius: number,
    events: LaptopEvents = LAPTOP_EVENTS) {
    this.seats = seats;
    this.boxes = boxes;
    this.halfSize = halfSize;
    this.radius = radius;
    this.events = events;
  }

  /** The seat the character can sit on from here: close enough and with a clear straight path. */
  available(from: Point2): SeatSpot | undefined {
    return [...this.seats]
      .filter((spot) => distance(from, spot.approach) <= REACH)
      .sort((a, b) => distance(from, a.approach) - distance(from, b.approach))
      .find((spot) => {
        const end = sweep(from, { x: spot.approach.x - from.x, z: spot.approach.z - from.z }, this.radius, this.boxes, this.halfSize);
        return distance(end, spot.approach) < 0.05;
      });
  }

  /** E: sit on the nearby seat, or stand up (putting the laptop away first if typing). */
  interact(from: Point2, yaw: number): boolean {
    this.message = '';
    if (this.phase === 'free') {
      const spot = this.available(from);
      if (!spot) return this.refuse('Acércate a la silla o a la cama para sentarte.');
      this.seat = spot;
      this.position = { ...from };
      this.yaw = yaw;
      this.stalled = 0;
      this.phase = 'approaching';
      return true;
    }
    if (this.phase !== 'seated' || !this.state.can('stand')) return this.refuse('Espera a que termine el movimiento.');
    if (overlaps(this.seat!.approach, this.radius, this.boxes)) return this.refuse('La salida está bloqueada.');
    this.fired.clear();
    return this.state.command('stand');
  }

  /** L: take the laptop out (open it) or put it away while seated. */
  laptopPress(): boolean {
    this.message = '';
    if (this.phase !== 'seated' || !this.state.can('laptop')) {
      return this.refuse(this.phase === 'free' ? 'Siéntate para usar el portátil.' : 'Espera a que termine el movimiento.');
    }
    if (this.state.stage === 'seated' && this.seat!.seat === 'bed' && this.laptop === 'desk') {
      return this.refuse('El portátil está en el escritorio: úsalo allí y guárdalo para traerlo a la cama.');
    }
    this.fired.clear();
    return this.state.command('laptop');
  }

  /** Clip the character should be playing, or undefined while the keyboard drives it. */
  clip(): ClipRequest | undefined {
    if (this.phase === 'free') return undefined;
    if (this.phase === 'seated') return { name: this.state.clip, loop: this.state.looping };
    return { name: this.moving ? 'walk' : 'idle', loop: true };
  }

  private moving = false;

  update(dt: number, clipProgress: number): void {
    const step = Math.min(Math.max(dt, 0), 0.05);
    if (this.phase === 'approaching') this.approach(step);
    else if (this.phase === 'aligning') this.align(step);
    else if (this.phase === 'exiting') this.exit(step);
    else if (this.phase === 'seated') this.laptopEvents(clipProgress);
    const lidStep = LID_SPEED * step;
    this.lid = this.lid < this.lidTarget ? Math.min(this.lidTarget, this.lid + lidStep) : Math.max(this.lidTarget, this.lid - lidStep);
  }

  /** A non-looping seat clip ended: advance the state machine. */
  clipFinished(): void {
    if (this.phase !== 'seated') return;
    const stage = this.state.stage;
    if (stage === 'drawing') this.laptopEvents(1);
    if (stage === 'stowing') this.laptopEvents(1);
    if (!this.state.finish()) return;
    this.fired.clear();
    if (this.state.stage === 'idle') {
      this.position = { ...this.seat!.stand };
      this.yaw = this.seat!.yaw;
      this.phase = 'exiting';
    }
  }

  /** Abandon any interaction (manual clip choice, reset): the laptop never stays on a lap nobody sits on. */
  reset(): void {
    this.state.reset();
    this.phase = 'free';
    this.seat = undefined;
    this.moving = false;
    this.fired.clear();
    if (this.laptop === 'lap') this.laptop = 'stowed';
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
    if (stage === 'seated') {
      const laptop = this.seat!.seat === 'bed' && this.laptop === 'desk' ? 'el portátil está en el escritorio' : 'L: sacar el portátil';
      return `Sentado en ${where} · ${laptop} · E: levantarse`;
    }
    if (stage === 'typing') return 'Programando · L: guardar el portátil · E: guardarlo y levantarse';
    const transitions: Partial<Record<typeof stage, string>> = {
      sitting: 'Sentándose…', drawing: 'Sacando el portátil…', stowing: 'Guardando el portátil…', standing: 'Levantándose…',
    };
    return transitions[stage] ?? '';
  }

  private refuse(message: string): false {
    this.message = message;
    return false;
  }

  private turnTowards(target: number, step: number): number {
    const turn = wrap(target - this.yaw);
    this.yaw += turn * (1 - Math.exp(-step * TURN_RATE));
    return Math.abs(wrap(target - this.yaw));
  }

  private approach(step: number): void {
    const target = this.seat!.approach;
    const gap = distance(this.position, target);
    if (gap < ARRIVED) {
      this.phase = 'aligning';
      return;
    }
    const advance = Math.min(gap, WALK_SPEED * step);
    const next = sweep(this.position, { x: (target.x - this.position.x) / gap * advance, z: (target.z - this.position.z) / gap * advance },
      this.radius, this.boxes, this.halfSize);
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
    const gap = distance(this.position, spot.stand);
    if (gap > ARRIVED) {
      const advance = Math.min(gap, WALK_SPEED * step);
      this.turnTowards(Math.atan2(spot.stand.x - this.position.x, spot.stand.z - this.position.z), step);
      this.position = { x: this.position.x + (spot.stand.x - this.position.x) / gap * advance, z: this.position.z + (spot.stand.z - this.position.z) / gap * advance };
      this.moving = true;
      return;
    }
    this.position = { ...spot.stand };
    this.moving = false;
    if (this.turnTowards(spot.yaw, step) > 0.02) return;
    this.yaw = spot.yaw;
    this.state.setSeat(spot.seat);
    this.state.command('sit');
    this.fired.clear();
    this.phase = 'seated';
  }

  private exit(step: number): void {
    const target = this.seat!.approach;
    const gap = distance(this.position, target);
    if (gap > ARRIVED) {
      const advance = Math.min(gap, WALK_SPEED * step);
      this.turnTowards(Math.atan2(target.x - this.position.x, target.z - this.position.z), step);
      this.position = { x: this.position.x + (target.x - this.position.x) / gap * advance, z: this.position.z + (target.z - this.position.z) / gap * advance };
      this.moving = true;
      return;
    }
    this.position = { ...target };
    this.moving = false;
    this.phase = 'free';
    this.seat = undefined;
  }

  private once(name: string, progress: number, at: number, run: () => void): void {
    if (progress >= at && !this.fired.has(name)) {
      this.fired.add(name);
      run();
    }
  }

  private laptopEvents(progress: number): void {
    const stage = this.state.stage;
    if (stage === 'drawing') {
      this.once('take', progress, this.events.take, () => {
        if (this.laptop === 'stowed') {
          this.laptop = this.seat!.seat === 'bed' ? 'lap' : 'desk';
          this.lid = this.lidTarget = 0;
        }
      });
      this.once('open', progress, this.events.open, () => { this.lidTarget = 1; });
    } else if (stage === 'stowing') {
      this.once('close', progress, this.events.close, () => { this.lidTarget = 0; });
      this.once('store', progress, this.events.store, () => { this.laptop = 'stowed'; });
    }
  }
}
