// Bahnschrift comes with Windows only and cannot be served. Elsewhere (Android, iOS, macOS, Linux) the page falls
// back to Barlow Semi Condensed (SIL OFL), a close DIN-like match bundled with the site: no external request, and a
// browser that has Bahnschrift never downloads it.
import '@fontsource/barlow-semi-condensed/latin-400.css';
import '@fontsource/barlow-semi-condensed/latin-500.css';
import '@fontsource/barlow-semi-condensed/latin-600.css';
import '@fontsource/barlow-semi-condensed/latin-700.css';

const WEIGHTS = [400, 500, 600, 700];
const WAIT_LIMIT = 3000;

/** Whether the installed Windows typeface is available (then nothing needs loading). */
function hasBahnschrift(): boolean {
  try {
    return document.fonts.check('16px "Bahnschrift"') && measures('"Bahnschrift"') !== measures('monospace');
  } catch {
    return false;
  }
}

function measures(family: string): number {
  const context = document.createElement('canvas').getContext('2d');
  if (!context) return 0;
  context.font = `16px ${family}, monospace`;
  return context.measureText('ANDRES jaramillo 0123').width;
}

let ready: Promise<void> | undefined;

/**
 * Resolves once the fallback weights are loaded, so canvas labels (which never repaint on a late font) are drawn in
 * the project typeface. Never rejects and gives up after WAIT_LIMIT ms so a slow network cannot hold the scene.
 */
export function fontsReady(): Promise<void> {
  if (ready) return ready;
  if (typeof document === 'undefined' || !document.fonts || hasBahnschrift()) return (ready = Promise.resolve());
  const loads = Promise.all(WEIGHTS.map((weight) => document.fonts.load(`${weight} 16px "Barlow Semi Condensed"`, 'ÁáÑñ¿¡')))
    .then(() => undefined, () => undefined);
  const limit = new Promise<void>((resolve) => setTimeout(resolve, WAIT_LIMIT));
  return (ready = Promise.race([loads, limit]));
}
