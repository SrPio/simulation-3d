import { Group, SRGBColorSpace, Sprite, SpriteMaterial, Texture, TextureLoader } from 'three';
import type { Pin } from '../core/pins.ts';

/**
 * How a pin shows on the map: a small flat picture standing `lift` metres over the ground, always facing the camera
 * like the other 2D things in the world. Picked up it pops up `rise` metres and shrinks away over `take` seconds.
 */
export const PIN_LOOK = { lift: 0.15, rise: 0.6, take: 0.35 } as const;

type Shown = { pin: Pin; sprite: Sprite; taken?: number };

/**
 * The season pins lying on the map (src/core/pins.ts): each one a sprite with the pin's picture, always seen flat and
 * upright from the camera. `take` sends one away.
 */
export class SeasonPins {
  readonly root = new Group();
  private readonly shown: Shown[] = [];
  private readonly textures: Texture[] = [];

  constructor(pins: readonly Pin[], groundY: number, base: string) {
    this.root.name = 'SeasonPins';
    const loader = new TextureLoader();
    for (const pin of pins) {
      const texture = loader.load(`${base}${pin.image}`);
      texture.colorSpace = SRGBColorSpace;
      this.textures.push(texture);
      const sprite = new Sprite(new SpriteMaterial({ map: texture, alphaTest: 0.04 }));
      sprite.name = `SeasonPin_${pin.id}`;
      // Standing on its bottom edge.
      sprite.center.set(0.5, 0);
      sprite.scale.set(pin.height * pin.aspect, pin.height, 1);
      sprite.position.set(pin.at.x, groundY + PIN_LOOK.lift, pin.at.z);
      this.root.add(sprite);
      this.shown.push({ pin, sprite });
    }
  }

  /** The pins still lying on the map (not taken). */
  get waiting(): Pin[] {
    return this.shown.filter((item) => item.taken === undefined).map((item) => item.pin);
  }

  /** Pick a pin up: it pops up and is gone (at once with reduced motion). */
  take(id: string, reducedMotion: boolean): void {
    const item = this.shown.find((shown) => shown.pin.id === id);
    if (!item || item.taken !== undefined) return;
    item.taken = reducedMotion ? PIN_LOOK.take : 0;
  }

  update(delta: number): void {
    for (const item of [...this.shown]) {
      if (item.taken === undefined) continue;
      item.taken += delta;
      const t = Math.min(1, item.taken / PIN_LOOK.take);
      const { sprite, pin } = item;
      sprite.position.y += delta * (PIN_LOOK.rise / PIN_LOOK.take);
      const size = Math.max(0.001, 1 - t * t);
      sprite.scale.set(pin.height * pin.aspect * size, pin.height * size, 1);
      if (t >= 1) this.remove(item);
    }
  }

  private remove(item: Shown): void {
    this.shown.splice(this.shown.indexOf(item), 1);
    item.sprite.removeFromParent();
    item.sprite.material.dispose();
  }

  dispose(): void {
    for (const item of [...this.shown]) this.remove(item);
    for (const texture of this.textures) texture.dispose();
  }
}
