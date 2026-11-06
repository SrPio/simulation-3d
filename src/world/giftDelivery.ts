/**
 * Christmas: the gift delivery game. Gifts fall off the sleigh's sack while its thruster blows; one that comes to rest
 * within `radius` of the giant tree counts as delivered (once). The best count is kept like the best lap.
 */
export const DELIVERY = { radius: 5.2, still: 0.25 } as const;
const BEST_KEY = 'simulation-3d:gifts-best';

export type GiftAt = { x: number; z: number; speed: number };

export class GiftDelivery {
  delivered = 0;
  best: number;
  private readonly counted = new WeakSet<object>();
  private readonly storage: Storage | undefined;

  constructor(storage?: Storage) {
    this.storage = storage;
    let best = 0;
    try {
      best = Number(storage?.getItem(BEST_KEY) ?? 0) || 0;
    } catch {
      best = 0;
    }
    this.best = best;
  }

  /** Count the gifts (keyed by any object, e.g. their bodies) now resting under the tree at `centre`. Returns how many were new. */
  check(gifts: readonly { key: object; at: GiftAt }[], centre: { x: number; z: number }): number {
    let added = 0;
    for (const { key, at } of gifts) {
      if (this.counted.has(key) || at.speed > DELIVERY.still) continue;
      if (Math.hypot(at.x - centre.x, at.z - centre.z) > DELIVERY.radius) continue;
      this.counted.add(key);
      added++;
    }
    if (added) {
      this.delivered += added;
      if (this.delivered > this.best) {
        this.best = this.delivered;
        try {
          this.storage?.setItem(BEST_KEY, String(this.best));
        } catch {
          // Blocked storage: the best count lasts for this visit only.
        }
      }
    }
    return added;
  }

  /** A new round (Restablecer or the tree's reset zone): nothing delivered yet; the best stays. */
  reset(): void {
    this.delivered = 0;
  }
}
