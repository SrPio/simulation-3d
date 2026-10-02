export type QualityId = 'auto' | 'high' | 'low';

export type QualityProfile = {
  label: string;
  /** Pixel ratio range; the viewer adapts inside it from the frame time when min < max. */
  minRatio: number;
  maxRatio: number;
  shadows: boolean;
  shadowSize: number;
};

/**
 * Auto is the measured default (60 fps on an integrated GPU at max zoom). Alta trades frame time for a sharper
 * image on fast GPUs; Baja drops shadows and renders slightly under native resolution when needed.
 */
export const QUALITY: Record<QualityId, QualityProfile> = {
  auto: { label: 'Auto', minRatio: 1, maxRatio: 1.5, shadows: true, shadowSize: 2048 },
  high: { label: 'Alta', minRatio: 2, maxRatio: 2, shadows: true, shadowSize: 2048 },
  low: { label: 'Baja', minRatio: 0.75, maxRatio: 1, shadows: false, shadowSize: 1024 },
};

export const defaultQuality: QualityId = 'auto';

export function isQualityId(value: unknown): value is QualityId {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(QUALITY, value);
}

/** The pixel ratio range for a quality on this display: never above the device's own ratio. */
export function ratioRange(quality: QualityId, devicePixelRatio: number): { min: number; max: number } {
  const device = devicePixelRatio > 0 && Number.isFinite(devicePixelRatio) ? devicePixelRatio : 1;
  const max = Math.min(device, QUALITY[quality].maxRatio);
  return { min: Math.min(max, QUALITY[quality].minRatio), max };
}

/** Frame times (ms) above which resolution drops, and below which it rises again. */
export const SLOW_FRAME = 21;
export const FAST_FRAME = 14;
const STEP = 0.25;

/** Adaptive resolution: one step down when frames are slow (fill-rate bound), one step up when there is headroom. */
export function nextPixelRatio(current: number, averageFrame: number, range: { min: number; max: number }): number {
  const clamped = Math.min(range.max, Math.max(range.min, current));
  if (averageFrame > SLOW_FRAME && clamped > range.min) return Math.max(range.min, clamped - STEP);
  if (averageFrame < FAST_FRAME && clamped < range.max) return Math.min(range.max, clamped + STEP);
  return clamped;
}

export type Preferences = { quality: QualityId; reducedMotion: boolean | null };
const STORAGE_KEY = 'simulation-3d:preferences';

/** Stored viewer preferences; reducedMotion null means "follow the system setting". Storage may be unavailable. */
export function readPreferences(storage: Pick<Storage, 'getItem'> | undefined): Preferences {
  try {
    const value: unknown = JSON.parse(storage?.getItem(STORAGE_KEY) ?? 'null');
    const stored = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
    return {
      quality: isQualityId(stored.quality) ? stored.quality : defaultQuality,
      reducedMotion: typeof stored.reducedMotion === 'boolean' ? stored.reducedMotion : null,
    };
  } catch {
    return { quality: defaultQuality, reducedMotion: null };
  }
}

export function savePreferences(storage: Pick<Storage, 'setItem'> | undefined, preferences: Preferences): void {
  try {
    storage?.setItem(STORAGE_KEY, JSON.stringify(preferences));
  } catch {
    // Private mode or blocked storage: the choice still applies for this visit.
  }
}
