import { SOUND_FILES, type RecordedSound } from './soundFiles.ts';

/** Sounds made in the browser instead of recorded: the swing of a blow, a chick's cheep, a bottle popping. */
export type SynthSound = 'whoosh' | 'chirp' | 'pop';
export type SoundName = RecordedSound | SynthSound;
/** Continuous sounds whose level and pitch follow something: the office chair's casters, the soda fizzing. */
export type LoopName = 'rolling' | 'fizz';

/**
 * How a sound plays. `velocity` is what the caller passes (an impact speed in m/s, a blow's power 0…1):
 * below `velocityMin` it stays silent, above it the volume grows by `velocityMultiplier` per unit within `volume`,
 * then squared (loudness is heard roughly as the square of the amplitude). Each play picks a random pitch in `rate`.
 * The same sound never plays again within `minDelta` ms (a pile of bricks settling is one clatter, not fifty).
 */
export type SoundDef = { minDelta: number; velocityMin: number; velocityMultiplier: number; volume: [number, number]; rate: [number, number] };

const fixed = (volume: number, rate: [number, number] = [0.95, 1.05], minDelta = 60): SoundDef =>
  ({ minDelta, velocityMin: 0, velocityMultiplier: 0, volume: [volume, volume], rate });
const impact = (velocityMin: number, velocityMultiplier: number, volume: [number, number], rate: [number, number], minDelta = 60): SoundDef =>
  ({ minDelta, velocityMin, velocityMultiplier, volume, rate });

export const SOUNDS: Record<SoundName, SoundDef> = {
  // Pieces, by what they are made of; velocity is the impact speed along the contact normal.
  brick: impact(1, 0.75, [0.2, 0.85], [0.5, 0.75], 100),
  wood: impact(0.7, 0.22, [0.15, 0.85], [0.9, 1.2]),
  woodHeavy: impact(1.5, 0.2, [0.4, 1], [0.8, 1], 120),
  pin: impact(0.6, 0.25, [0.25, 1], [0.95, 1.3], 30),
  ball: impact(0.6, 0.2, [0.3, 1], [0.55, 0.7], 80),
  cardboard: impact(0.7, 0.25, [0.15, 0.8], [0.9, 1.15]),
  plastic: impact(0.7, 0.28, [0.15, 0.75], [1, 1.3]),
  metal: impact(0.7, 0.2, [0.15, 0.8], [0.8, 1.1], 80),
  rubber: impact(0.9, 0.2, [0.2, 0.8], [0.6, 0.8], 80),
  laptop: impact(0.7, 0.22, [0.2, 0.85], [0.95, 1.2], 80),
  crash: impact(0.8, 0.22, [0.3, 1], [0.8, 1], 150),
  // The character; for a blow, velocity is its power 0…1.
  punch: impact(0, 0.8, [0.55, 1], [0.9, 1.1], 50),
  whoosh: impact(0, 0.7, [0.35, 0.85], [0.9, 1.1], 50),
  stepWood: fixed(0.42, [0.9, 1.1], 120),
  stepGround: fixed(0.38, [0.9, 1.1], 120),
  stepGrass: fixed(0.4, [0.9, 1.1], 120),
  cloth: fixed(0.55, [0.9, 1.1], 150),
  // Seats and the laptop.
  creak: fixed(0.6, [0.9, 1.1], 200),
  lidOpen: fixed(0.65),
  lidClose: fixed(0.7),
  key: fixed(0.38, [0.9, 1.25], 40),
  // The world.
  // The floor keys are keys of one keyboard: the same keystroke at the same pitch for all four.
  floorKey: fixed(0.85, [1, 1], 60),
  zone: fixed(0.55, [1, 1], 150),
  open: fixed(0.75, [1, 1], 150),
  reset: fixed(0.7, [1, 1], 150),
  beep: fixed(0.55, [1, 1], 100),
  beepGo: fixed(0.65, [1, 1], 100),
  lap: fixed(0.75, [1, 1], 200),
  best: fixed(0.85, [1, 1], 200),
  bell: impact(0, 1, [0.5, 1], [0.95, 1.05], 150),
  konami: fixed(0.85, [1, 1], 500),
  chirp: fixed(0.45, [0.85, 1.25], 70),
  pop: fixed(0.9, [0.9, 1.1], 150),
  ui: fixed(0.45, [1, 1], 40),
};

/** The volume a sound plays at for a velocity, 0 when it should stay silent. */
export function soundGain(def: SoundDef, velocity: number): number {
  if (def.velocityMin > 0 && velocity < def.velocityMin) return 0;
  const raw = (velocity - def.velocityMin) * def.velocityMultiplier;
  const volume = Math.min(def.volume[1], Math.max(def.volume[0], raw));
  return volume * volume;
}

/** Quieter with distance from the listener (the character): full up to 5 m, silent past 35 m. */
export function distanceGain(distance: number): number {
  if (distance <= 5) return 1;
  if (distance >= 35) return 0;
  return 1 / (1 + (distance - 5) / 6);
}

const isRecorded = (name: SoundName): name is RecordedSound => name in SOUND_FILES;

/**
 * The page's sound effects on the Web Audio API. Nothing is created until `unlock` (START, a user gesture), then the
 * recorded files load in the background; a sound asked for before its file arrives is skipped. Muting and a hidden
 * page silence the master gain.
 */
export class Sounds {
  private context?: AudioContext;
  private master?: GainNode;
  private readonly buffers = new Map<RecordedSound, AudioBuffer[]>();
  private readonly last = new Map<SoundName, number>();
  private noise?: AudioBuffer;
  private crackle?: AudioBuffer;
  private muted: boolean;
  private hidden = false;
  private readonly base: string;
  private readonly loops = new Map<LoopName, { gain: GainNode; filter: BiquadFilterNode; source: AudioBufferSourceNode }>();
  /** The last sound played, for tests. */
  onPlay?: (name: SoundName) => void;

  constructor(options: { muted: boolean; base: string }) {
    this.muted = options.muted;
    this.base = options.base;
  }

  get unlocked(): boolean {
    return this.context !== undefined;
  }

  get isMuted(): boolean {
    return this.muted;
  }

  /** Create the audio context (allowed from a user gesture) and start fetching the files. */
  unlock(): void {
    if (this.context) {
      void this.context.resume();
      return;
    }
    const Context = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Context) return;
    this.context = new Context();
    this.master = this.context.createGain();
    this.master.connect(this.context.destination);
    this.applyLevel();
    this.noise = this.makeNoise(1.5, () => Math.random() * 2 - 1);
    // Fizz: a hiss with sparse sharp pops of bursting bubbles.
    this.crackle = this.makeNoise(2, () => (Math.random() < 0.012 ? (Math.random() * 2 - 1) * 1.6 : (Math.random() * 2 - 1) * 0.18));
    void this.loadAll();
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    this.applyLevel();
    if (muted) void this.context?.suspend();
    else if (!this.hidden) void this.context?.resume();
  }

  /** A hidden page goes quiet and comes back as it was. */
  setHidden(hidden: boolean): void {
    this.hidden = hidden;
    this.applyLevel();
  }

  private applyLevel(): void {
    if (!this.master || !this.context) return;
    this.master.gain.setTargetAtTime(this.muted || this.hidden ? 0 : 0.8, this.context.currentTime, 0.03);
  }

  private async loadAll(): Promise<void> {
    const context = this.context;
    if (!context) return;
    await Promise.all(Object.entries(SOUND_FILES).map(async ([name, files]) => {
      const buffers = await Promise.all(files.map(async (file) => {
        try {
          const response = await fetch(`${this.base}sounds/${file}`);
          if (!response.ok) return undefined;
          return await context.decodeAudioData(await response.arrayBuffer());
        } catch {
          return undefined;
        }
      }));
      const loaded = buffers.filter((buffer): buffer is AudioBuffer => buffer !== undefined);
      if (loaded.length) this.buffers.set(name as RecordedSound, loaded);
    }));
  }

  private makeNoise(seconds: number, sample: () => number): AudioBuffer | undefined {
    if (!this.context) return undefined;
    const buffer = this.context.createBuffer(1, Math.round(this.context.sampleRate * seconds), this.context.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = sample();
    return buffer;
  }

  /**
   * Play a sound for a velocity (see SoundDef), quieter with `distance` from the character. Returns whether it played.
   */
  play(name: SoundName, velocity = 0, distance = 0): boolean {
    const context = this.context;
    const master = this.master;
    if (!context || !master || this.muted || this.hidden || context.state !== 'running') return false;
    const def = SOUNDS[name];
    const now = performance.now();
    if (now - (this.last.get(name) ?? -Infinity) < def.minDelta) return false;
    const volume = soundGain(def, velocity) * distanceGain(distance);
    if (volume <= 0.001) return false;
    const rate = def.rate[0] + Math.random() * (def.rate[1] - def.rate[0]);
    if (isRecorded(name)) {
      const variants = this.buffers.get(name);
      if (!variants) return false;
      const source = context.createBufferSource();
      source.buffer = variants[Math.floor(Math.random() * variants.length)];
      source.playbackRate.value = rate;
      const gain = context.createGain();
      gain.gain.value = volume;
      source.connect(gain).connect(master);
      source.start();
    } else this.synth(name, volume, rate);
    this.last.set(name, now);
    this.onPlay?.(name);
    return true;
  }

  private synth(name: SynthSound, volume: number, rate: number): void {
    const context = this.context!;
    const master = this.master!;
    const t = context.currentTime;
    const gain = context.createGain();
    gain.connect(master);
    if (name === 'whoosh' && this.noise) {
      // Air rushing past: band-passed noise sweeping up and fading.
      const source = context.createBufferSource();
      source.buffer = this.noise;
      const filter = context.createBiquadFilter();
      filter.type = 'bandpass';
      filter.Q.value = 1.4;
      filter.frequency.setValueAtTime(380 * rate, t);
      filter.frequency.exponentialRampToValueAtTime(2200 * rate, t + 0.22);
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(volume, t + 0.06);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
      source.connect(filter).connect(gain);
      source.start(t, Math.random() * 0.5, 0.32);
    } else if (name === 'chirp') {
      // Two quick rising cheeps.
      for (const offset of [0, 0.11]) {
        const osc = context.createOscillator();
        const note = context.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(2300 * rate, t + offset);
        osc.frequency.exponentialRampToValueAtTime(3600 * rate, t + offset + 0.05);
        osc.frequency.exponentialRampToValueAtTime(2800 * rate, t + offset + 0.08);
        note.gain.setValueAtTime(0.0001, t + offset);
        note.gain.exponentialRampToValueAtTime(volume * 0.6, t + offset + 0.012);
        note.gain.exponentialRampToValueAtTime(0.0001, t + offset + 0.09);
        osc.connect(note).connect(master);
        osc.start(t + offset);
        osc.stop(t + offset + 0.1);
      }
    } else if (name === 'pop' && this.noise) {
      // A bottle bursting open: a sharp crack of noise over a low thump.
      const source = context.createBufferSource();
      source.buffer = this.noise;
      const filter = context.createBiquadFilter();
      filter.type = 'highpass';
      filter.frequency.value = 1200;
      gain.gain.setValueAtTime(volume, t);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
      source.connect(filter).connect(gain);
      source.start(t, 0, 0.14);
      const osc = context.createOscillator();
      const thump = context.createGain();
      osc.frequency.setValueAtTime(190 * rate, t);
      osc.frequency.exponentialRampToValueAtTime(55, t + 0.16);
      thump.gain.setValueAtTime(volume * 0.9, t);
      thump.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
      osc.connect(thump).connect(master);
      osc.start(t);
      osc.stop(t + 0.2);
    }
  }

  /**
   * Set a continuous sound's level (0 stops it) and brightness (0…1): the casters rolling (low rumble that rises with
   * speed) or the soda fizzing (a crackling hiss).
   */
  loop(name: LoopName, level: number, brightness = 0.5): void {
    const context = this.context;
    if (!context || !this.master) return;
    let loop = this.loops.get(name);
    if (!loop && level <= 0.001) return;
    if (!loop) {
      const buffer = name === 'fizz' ? this.crackle : this.noise;
      if (!buffer) return;
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.loop = true;
      const filter = context.createBiquadFilter();
      filter.type = name === 'fizz' ? 'highpass' : 'lowpass';
      const gain = context.createGain();
      gain.gain.value = 0;
      source.connect(filter).connect(gain).connect(this.master);
      source.start();
      loop = { gain, filter, source };
      this.loops.set(name, loop);
    }
    const t = context.currentTime;
    // The casters stay a soft, dark rumble: a low ceiling on the filter and a quiet level even at full speed.
    const frequency = name === 'fizz' ? 2200 + brightness * 2600 : 120 + brightness * 480;
    loop.filter.frequency.setTargetAtTime(frequency, t, 0.05);
    loop.gain.gain.setTargetAtTime(Math.max(0, level) * (name === 'fizz' ? 0.5 : 0.22), t, 0.06);
  }

  dispose(): void {
    for (const loop of this.loops.values()) loop.source.stop();
    this.loops.clear();
    void this.context?.close();
    this.context = undefined;
  }
}
