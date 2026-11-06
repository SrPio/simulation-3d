import { CanvasTexture, Mesh, MeshBasicMaterial, PlaneGeometry, SRGBColorSpace } from 'three';
import { FONT } from './canvasText.ts';
import { daysToChristmas } from '../core/christmas.ts';
import { t } from '../core/i18n.ts';
import type { Scoreboard } from './outsideData.ts';

/** What the sign says: «FALTAN / 12 / DÍAS PARA NAVIDAD», one line on the 24th and 25th, and after them the new year. */
export function countdownLines(days: number | null): { top: string; number: string; bottom: string } {
  if (days === null) return { top: '', number: '', bottom: t('christmas.newYear') };
  if (days === 0) return { top: '', number: '', bottom: t('christmas.today') };
  return {
    top: t(days === 1 ? 'christmas.beforeOne' : 'christmas.before'),
    number: String(days),
    bottom: t(days === 1 ? 'christmas.afterOne' : 'christmas.after'),
  };
}

/**
 * Christmas: the big sign counting the days to Christmas Eve, painted on a canvas in the current language on the
 * sign's dark green face (CountdownBoard in christmas.glb). It repaints only when the text changes (the language, or
 * the day turning over while the page is open).
 */
export class CountdownBoard {
  readonly mesh: Mesh<PlaneGeometry, MeshBasicMaterial>;
  private readonly canvas = document.createElement('canvas');
  private readonly texture: CanvasTexture;
  private shown = '';

  constructor(board: Scoreboard) {
    this.canvas.width = 1024;
    this.canvas.height = Math.round((1024 * board.height) / board.width);
    this.texture = new CanvasTexture(this.canvas);
    this.texture.colorSpace = SRGBColorSpace;
    this.texture.anisotropy = 8;
    this.mesh = new Mesh(new PlaneGeometry(board.width, board.height), new MeshBasicMaterial({ map: this.texture, toneMapped: false }));
    this.mesh.name = 'CountdownBoard';
    // Just in front of the sign's face (its local +Z), its middle at the face's height.
    this.mesh.position.set(board.position.x + Math.sin(board.yaw) * 0.075, board.position.y + board.bottom + board.height / 2, board.position.z + Math.cos(board.yaw) * 0.075);
    this.mesh.rotation.y = board.yaw;
  }

  /** Paint today's count (`days` from daysToChristmas). */
  paint(days: number | null = daysToChristmas()): void {
    const { top, number, bottom } = countdownLines(days);
    const key = `${top}|${number}|${bottom}`;
    if (key === this.shown) return;
    this.shown = key;
    const ctx = this.canvas.getContext('2d');
    if (!ctx) return;
    const { width, height } = this.canvas;
    ctx.fillStyle = '#123322';
    ctx.fillRect(0, 0, width, height);
    ctx.strokeStyle = '#e8c45a';
    ctx.lineWidth = 14;
    ctx.strokeRect(22, 22, width - 44, height - 44);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if (!number) {
      ctx.fillStyle = '#ffffff';
      ctx.font = `700 120px ${FONT}`;
      ctx.fillText(bottom, width / 2, height / 2, width - 110);
    } else {
      ctx.fillStyle = '#ffffff';
      ctx.font = `600 70px ${FONT}`;
      ctx.fillText(top, width / 2, height * 0.2, width - 110);
      ctx.fillStyle = '#ffdf6b';
      ctx.font = `700 230px ${FONT}`;
      ctx.fillText(number, width / 2, height * 0.52);
      ctx.fillStyle = '#ffffff';
      ctx.font = `600 70px ${FONT}`;
      ctx.fillText(bottom, width / 2, height * 0.83, width - 110);
    }
    this.texture.needsUpdate = true;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
    this.texture.dispose();
    this.mesh.removeFromParent();
  }
}
