import { CanvasTexture, Mesh, MeshBasicMaterial, PlaneGeometry, SRGBColorSpace } from 'three';
import { FONT } from './canvasText.ts';
import { t } from '../core/i18n.ts';
import type { Scoreboard } from './outsideData.ts';

/**
 * Christmas: the board by the giant tree, a chalkboard showing how many gifts were brought there off the sleigh this
 * round and the best count, painted on a canvas in the current language.
 */
export class GiftBoard {
  readonly mesh: Mesh<PlaneGeometry, MeshBasicMaterial>;
  private readonly canvas = document.createElement('canvas');
  private readonly texture: CanvasTexture;
  private shown = '';

  constructor(board: Scoreboard) {
    this.canvas.width = 512;
    this.canvas.height = Math.round((512 * board.height) / board.width);
    this.texture = new CanvasTexture(this.canvas);
    this.texture.colorSpace = SRGBColorSpace;
    this.mesh = new Mesh(new PlaneGeometry(board.width, board.height), new MeshBasicMaterial({ map: this.texture, toneMapped: false }));
    this.mesh.name = 'GiftBoard';
    // Just in front of the board's face (its local +Z), its middle at the board's height.
    this.mesh.position.set(board.position.x + Math.sin(board.yaw) * 0.065, board.position.y + board.bottom + board.height / 2, board.position.z + Math.cos(board.yaw) * 0.065);
    this.mesh.rotation.y = board.yaw;
  }

  paint(delivered: number, best: number): void {
    const key = `${t('christmas.delivered')}|${delivered}|${best}`;
    if (key === this.shown) return;
    this.shown = key;
    const ctx = this.canvas.getContext('2d');
    if (!ctx) return;
    const { width, height } = this.canvas;
    ctx.fillStyle = '#123322';
    ctx.fillRect(0, 0, width, height);
    ctx.strokeStyle = '#e8c45a';
    ctx.lineWidth = 8;
    ctx.strokeRect(10, 10, width - 20, height - 20);
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `600 34px ${FONT}`;
    ctx.fillText(t('christmas.delivered'), width / 2, height * 0.2, width - 50);
    ctx.font = `700 120px ${FONT}`;
    ctx.fillStyle = '#ffdf6b';
    ctx.fillText(String(delivered), width / 2, height * 0.52);
    ctx.font = `500 30px ${FONT}`;
    ctx.fillStyle = '#cfe8d8';
    ctx.fillText(`${t('christmas.best')}: ${best}`, width / 2, height * 0.83, width - 50);
    this.texture.needsUpdate = true;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
    this.texture.dispose();
    this.mesh.removeFromParent();
  }
}
