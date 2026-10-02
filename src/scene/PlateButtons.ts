import {
  CanvasTexture, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial, PlaneGeometry, SRGBColorSpace,
  type Camera, type Object3D, type Raycaster, type Vector3,
} from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import type { Plate } from './outsideData.ts';

const WIDTH = 1.7;
const HEIGHT = 0.42;
const DEPTH = 0.14;
/** Height of the button centre above the plate once risen: over the head of a character standing on it. */
const RISE = 3.0;
const ENTER = 0.38;
const LEAVE = 0.24;

type Button = { plate: Plate; group: Group; face: Mesh; body: Mesh; label: MeshBasicMaterial; shell: MeshStandardMaterial; progress: number; target: 0 | 1 };

const easeOutBack = (t: number) => 1 + 2.2 * (t - 1) ** 3 + 1.2 * (t - 1) ** 2;
const easeIn = (t: number) => t * t;

function labelTexture(text: string): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 640;
  canvas.height = 160;
  const context = canvas.getContext('2d')!;
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = '#f4ecff';
  context.font = '600 64px system-ui, "Segoe UI", Roboto, sans-serif';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(`${text}  ↗`, canvas.width / 2, canvas.height / 2 + 4);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

/**
 * One floating button per floor plate. It rises out of the plate with a short overshoot when the
 * character steps on, and sinks back when it leaves. Hidden buttons are not drawn and cost nothing;
 * the body geometry is shared and nothing casts shadows.
 */
export class PlateButtons {
  readonly root = new Group();
  private readonly buttons: Button[] = [];
  private readonly geometry = new RoundedBoxGeometry(WIDTH, HEIGHT, DEPTH, 4, 0.06);
  private readonly faceGeometry = new PlaneGeometry(WIDTH * 0.92, HEIGHT * 0.8);
  private reducedMotion = false;
  private clock = 0;

  constructor(plates: readonly Plate[]) {
    this.root.name = 'PlateButtons';
    for (const plate of plates) {
      const shell = new MeshStandardMaterial({ color: 0x2b2140, emissive: 0x6c48c9, emissiveIntensity: 0.55, roughness: 0.35, metalness: 0.2, transparent: true });
      const label = new MeshBasicMaterial({ map: labelTexture(plate.label), transparent: true, depthWrite: false });
      const body = new Mesh(this.geometry, shell);
      const face = new Mesh(this.faceGeometry, label);
      face.position.z = DEPTH / 2 + 0.002;
      body.name = `PlateButton_${plate.id}`;
      face.name = `PlateButtonLabel_${plate.id}`;
      // Drawn after the scene and on top of it, so the character never hides the link.
      for (const mesh of [body, face]) {
        mesh.renderOrder = 10;
        mesh.userData.plate = plate.id;
      }
      shell.depthTest = label.depthTest = false;
      const group = new Group();
      group.add(body, face);
      group.position.copy(plate.position);
      group.visible = false;
      this.root.add(group);
      this.buttons.push({ plate, group, face, body, label, shell, progress: 0, target: 0 });
    }
  }

  setReducedMotion(enabled: boolean): void {
    this.reducedMotion = enabled;
  }

  /** Show the button of this plate (undefined hides them all). */
  show(id: string | undefined): void {
    for (const button of this.buttons) button.target = button.plate.id === id ? 1 : 0;
  }

  get visible(): boolean {
    return this.buttons.some((button) => button.group.visible);
  }

  /** Visible state for tests: 'in' while rising or up, 'out' while sinking, 'hidden'. */
  state(id: string): 'in' | 'out' | 'hidden' {
    const button = this.buttons.find((entry) => entry.plate.id === id);
    if (!button || !button.group.visible) return 'hidden';
    return button.target === 1 ? 'in' : 'out';
  }

  /** World centre of a risen (or rising) button. */
  center(id: string): Vector3 | undefined {
    const button = this.buttons.find((entry) => entry.plate.id === id);
    return button && button.group.visible && button.target === 1 ? button.group.position.clone() : undefined;
  }

  update(delta: number, camera: Camera): void {
    this.clock += delta;
    for (const button of this.buttons) {
      const { group } = button;
      if (button.progress === button.target && !group.visible && button.target === 0) continue;
      if (this.reducedMotion) button.progress = button.target;
      else if (button.target === 1) button.progress = Math.min(1, button.progress + delta / ENTER);
      else button.progress = Math.max(0, button.progress - delta / LEAVE);
      const p = button.progress;
      group.visible = p > 0;
      if (!group.visible) continue;
      const shape = button.target === 1 ? easeOutBack(p) : easeIn(p);
      const bob = this.reducedMotion || p < 1 ? 0 : 0.025 * Math.sin(this.clock * 2.4);
      group.position.set(button.plate.position.x, button.plate.position.y + 0.05 + (RISE - 0.05) * shape + bob, button.plate.position.z);
      group.scale.setScalar(0.25 + 0.75 * Math.min(shape, 1.08));
      button.shell.opacity = button.label.opacity = Math.min(1, p * 1.6);
      // Always facing the camera, whatever the orbit.
      group.quaternion.copy(camera.quaternion);
    }
  }

  /** Plate link under the pointer, if a visible button is hit. */
  hit(raycaster: Raycaster): { id: string; link: string } | undefined {
    const targets: Object3D[] = this.buttons.filter((button) => button.group.visible && button.target === 1).map((button) => button.body);
    if (!targets.length) return undefined;
    const [first] = raycaster.intersectObjects(targets, false);
    const button = first && this.buttons.find((entry) => entry.body === first.object);
    return button ? { id: button.plate.id, link: button.plate.link } : undefined;
  }

  dispose(): void {
    this.geometry.dispose();
    this.faceGeometry.dispose();
    for (const button of this.buttons) {
      button.label.map?.dispose();
      button.label.dispose();
      button.shell.dispose();
    }
    this.root.removeFromParent();
  }
}
