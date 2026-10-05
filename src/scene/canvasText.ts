/** The project typeface (see --font in the stylesheets): the installed Windows font, never downloaded. */
export const FONT = '"Bahnschrift", "Segoe UI", system-ui, sans-serif';

/** A keyboard key drawn as an outlined rounded cap with its label; returns its width. */
export function drawKey(context: CanvasRenderingContext2D, label: string, x: number, y: number, height: number): number {
  context.save();
  context.font = `700 ${Math.round(height * 0.46)}px ${FONT}`;
  context.textBaseline = 'middle';
  context.textAlign = 'center';
  const width = Math.max(height, context.measureText(label).width + height * 0.62);
  context.lineWidth = Math.max(2, height * 0.065);
  context.beginPath();
  context.roundRect(x, y, width, height, height * 0.18);
  context.stroke();
  context.fillText(label, x + width / 2, y + height * 0.53);
  context.restore();
  return width;
}

/** A filled arrow from (x, y) of `length` pixels pointing along `angle` (radians, canvas axes). */
export function drawArrow(context: CanvasRenderingContext2D, x: number, y: number, angle: number, length: number, width: number): void {
  context.save();
  context.translate(x, y);
  context.rotate(angle);
  const head = width * 1.9;
  context.beginPath();
  context.moveTo(0, -width / 2);
  context.lineTo(length - head, -width / 2);
  context.lineTo(length - head, -width * 1.25);
  context.lineTo(length, 0);
  context.lineTo(length - head, width * 1.25);
  context.lineTo(length - head, width / 2);
  context.lineTo(0, width / 2);
  context.closePath();
  context.fill();
  context.restore();
}
