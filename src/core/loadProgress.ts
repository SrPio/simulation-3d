import type { LoadProgress } from './loadAssets.ts';

/** Share of the loading line the downloads fill; the rest is building the scene until it is ready. */
export const DOWNLOAD_SHARE = 0.9;

/**
 * Several downloads as one fraction 0…1 for the loading screen: bytes received over bytes expected, never going back
 * (a file whose real size beats its estimate grows the total, which would otherwise pull the line back).
 */
export class ProgressMeter {
  private readonly files = new Map<string, { loaded: number; total: number }>();
  private shown = 0;
  private readonly onChange: (fraction: number) => void;

  constructor(onChange: (fraction: number) => void) {
    this.onChange = onChange;
  }

  /** Start tracking a file with its expected size; the returned callback takes the loader's reports. */
  file(id: string, expected: number): LoadProgress {
    this.files.set(id, { loaded: 0, total: Math.max(1, expected) });
    return (loaded, total) => {
      this.files.set(id, { loaded, total: Math.max(1, total, loaded) });
      this.report(this.downloaded * DOWNLOAD_SHARE);
    };
  }

  /** Fraction of the expected bytes received, 0…1. */
  get downloaded(): number {
    let loaded = 0;
    let total = 0;
    for (const file of this.files.values()) {
      loaded += file.loaded;
      total += file.total;
    }
    return total > 0 ? Math.min(1, loaded / total) : 0;
  }

  get fraction(): number {
    return this.shown;
  }

  /** Move the line on to at least this fraction (downloads done, scene being built, ready). */
  report(fraction: number): void {
    const next = Math.min(1, Math.max(this.shown, fraction));
    if (next === this.shown) return;
    this.shown = next;
    this.onChange(next);
  }
}
