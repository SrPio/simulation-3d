/**
 * Christmas: destroying every snowman on the map unlocks the snow hoverboard. A snowman counts once all three of its
 * balls have crumbled (src/world/PropPhysics.ts `crumbled`). What is destroyed adds up over the visit: putting the
 * snowmen back (Restablecer, the tree's reset zone) does not undo it, so they can be knocked down a few at a time.
 */
export class SnowmenHunt {
  /** Ball indices of each snowman, by its joint name. */
  private readonly snowmen: Map<string, number[]>;
  private readonly destroyed = new Set<string>();
  private told = false;
  /** Called once, when the last snowman is destroyed. */
  onAll?: () => void;

  constructor(balls: Iterable<{ index: number; joint: string }>) {
    this.snowmen = new Map();
    for (const { index, joint } of balls) {
      const list = this.snowmen.get(joint) ?? [];
      list.push(index);
      this.snowmen.set(joint, list);
    }
  }

  get total(): number {
    return this.snowmen.size;
  }

  get count(): number {
    return this.destroyed.size;
  }

  get done(): boolean {
    return this.total > 0 && this.count >= this.total;
  }

  /** Check the balls; returns the snowmen destroyed by this call. */
  update(crumbled: (index: number) => boolean): string[] {
    const fresh: string[] = [];
    for (const [joint, balls] of this.snowmen) {
      if (this.destroyed.has(joint) || !balls.every(crumbled)) continue;
      this.destroyed.add(joint);
      fresh.push(joint);
    }
    if (this.done && !this.told) {
      this.told = true;
      this.onAll?.();
    }
    return fresh;
  }
}
