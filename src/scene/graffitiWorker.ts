// Paints the graffiti spots off the page (see paintGraffiti in Graffiti.ts) and hands them back as bitmaps.
import { textFor, type GraffitiSpot } from './graffitiData.ts';
import { paintSpot } from './graffitiPaint.ts';

self.onmessage = (event: MessageEvent<GraffitiSpot[]>) => {
  try {
    const paintings = event.data.map((spot) => {
      const es = paintSpot(spot, 'es').transferToImageBitmap();
      const en = spot.text && textFor(spot, 'en') !== textFor(spot, 'es') ? paintSpot(spot, 'en').transferToImageBitmap() : es;
      return { es, en };
    });
    const bitmaps = [...new Set(paintings.flatMap(({ es, en }) => [es, en]))];
    self.postMessage(paintings, { transfer: bitmaps });
  } catch {
    // The page paints them itself.
    self.postMessage(null);
  }
};
