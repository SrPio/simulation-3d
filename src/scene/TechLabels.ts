import './techLabels.css';
import { Vector3, type Camera } from 'three';
import { MESSAGES, t, type MessageKey } from '../core/i18n.ts';

/** How long a label stays (ms); it fades out at the end of its CSS animation. */
export const LABEL_TIME = 2500;
/** Height of the label above the cube's centre (m). */
const LIFT = 0.55;

type Shown = { element: HTMLDivElement; tech: string; until: number; at: () => { x: number; y: number; z: number } };

/** Text of a tool's label: what it is used for here (`tech.<id>`), or its name. */
export function techText(tech: string): string {
  const key = `tech.${tech}` as MessageKey;
  return key in MESSAGES.es ? t(key) : tech;
}

/**
 * Short labels over the tech tower's cubes: when a cube falls, what the tool does in this project floats over it for
 * LABEL_TIME and fades. They live in the page, always facing the screen, placed on the cube every frame.
 */
export class TechLabels {
  private readonly host: HTMLElement;
  private readonly shown: Shown[] = [];
  private readonly point = new Vector3();

  constructor(host: HTMLElement) {
    this.host = host;
  }

  /** Show `tech`'s label over the body at `at` (read every frame while the label lives). */
  show(tech: string, at: Shown['at'], now: number): void {
    this.remove(tech);
    const element = document.createElement('div');
    element.className = 'tech-label';
    element.setAttribute('aria-hidden', 'true');
    element.dataset.tech = tech;
    const body = document.createElement('div');
    body.className = 'tech-label-body';
    body.textContent = techText(tech);
    element.append(body);
    this.host.append(element);
    this.shown.push({ element, tech, until: now + LABEL_TIME, at });
  }

  /** Place the living labels on screen; drop the ones whose time is up. */
  update(camera: Camera, width: number, height: number, now: number): void {
    for (const entry of [...this.shown]) {
      if (now >= entry.until) {
        this.remove(entry.tech);
        continue;
      }
      const at = entry.at();
      this.point.set(at.x, at.y + LIFT, at.z).project(camera);
      entry.element.style.transform = `translate3d(${((this.point.x + 1) / 2 * width).toFixed(1)}px, ${((1 - this.point.y) / 2 * height).toFixed(1)}px, 0)`;
    }
    const value = this.shown.map((entry) => entry.tech).join(',') || 'none';
    if (this.host.dataset.techLabels !== value) this.host.dataset.techLabels = value;
  }

  setLanguage(): void {
    for (const entry of this.shown) entry.element.firstElementChild!.textContent = techText(entry.tech);
  }

  clear(): void {
    for (const entry of [...this.shown]) this.remove(entry.tech);
  }

  private remove(tech: string): void {
    const index = this.shown.findIndex((entry) => entry.tech === tech);
    if (index < 0) return;
    this.shown[index].element.remove();
    this.shown.splice(index, 1);
  }

  dispose(): void {
    this.clear();
  }
}
