/**
 * A small icon for each sticker of the album, drawn on a round badge in the stamp's corner beside the character's
 * silhouette. Minimal line drawings in a 24 × 24 box: white strokes (`s`) and white fills (`f`) only, so they keep the
 * stamps' two colours (the theme's accent and white).
 */

/** Strokes are drawn 2 units wide with round ends; `f` parts are filled. */
const s = (d: string) => `<path class="i-s" d="${d}"/>`;
const f = (d: string) => `<path class="i-f" d="${d}"/>`;

export const STAMP_ICONS: Record<string, string> = {
  // Two shoe prints, one ahead of the other.
  'first-steps': f('M7.5 4.5c1.9 0 3 1.8 3 4.2 0 2.6-1.2 4.3-3 4.3s-3-1.7-3-4.3c0-2.4 1.1-4.2 3-4.2zM6 14.2h3v1.6c0 1-.6 1.7-1.5 1.7S6 16.8 6 15.8z')
    + f('M16.5 8c1.9 0 3 1.8 3 4.2 0 2.6-1.2 4.3-3 4.3s-3-1.7-3-4.3c0-2.4 1.1-4.2 3-4.2zM15 17.7h3v1.6c0 1-.6 1.7-1.5 1.7s-1.5-.7-1.5-1.7z'),
  // A window with its title bar.
  devos: s('M4 6.5h16v11H4zM4 9.5h16') + f('M6 7.2h1.3v1.3H6zM8.3 7.2h1.3v1.3H8.3z'),
  // A camera.
  tourist: s('M4 8.5h3.5l1.5-2h6l1.5 2H20v10H4z') + s('M12 10.5a3 3 0 1 1 0 6 3 3 0 0 1 0-6z'),
  // A cup of coffee, steaming.
  colombia: s('M5 11h11v3.5a4.5 4.5 0 0 1-4.5 4.5h-2A4.5 4.5 0 0 1 5 14.5zM16 12.5h1.5a2 2 0 0 1 0 4H16') + s('M8.5 8c-.8-1 .8-2 0-3M12 8c-.8-1 .8-2 0-3'),
  // A cube seen from a corner.
  experience: s('M12 3.5l7.5 4.2v8.6L12 20.5l-7.5-4.2V7.7zM12 12l7.5-4.3M12 12L4.5 7.7M12 12v8.5'),
  // Two links of a chain.
  connected: s('M10 14l4-4M8.5 11l-2 2a3 3 0 0 0 4.3 4.3l2-2M15.5 13l2-2a3 3 0 0 0-4.3-4.3l-2 2'),
  // A mountain with an arrow running down its side.
  'sled-run': s('M2.5 19.5L9 7l4 6.5 2-3 6.5 9z') + s('M8.5 10.5l7 7M15.5 13.5v4h-4'),
  // A lightning bolt.
  'sled-1000': f('M13.5 3L6 13.5h5L9.5 21 18 10h-5.2z'),
  // A bowling pin.
  strike: f('M12 3c1.6 0 2.4 1.3 2.4 2.8 0 1.2-.7 2-.9 2.8.1 1 2.5 2.8 2.5 6.4 0 3.4-1.5 6-4 6s-4-2.6-4-6c0-3.6 2.4-5.4 2.5-6.4-.2-.8-.9-1.6-.9-2.8C9.6 4.3 10.4 3 12 3z'),
  // A target.
  bullseye: s('M12 4a8 8 0 1 1 0 16 8 8 0 0 1 0-16zM12 8a4 4 0 1 1 0 8 4 4 0 0 1 0-8z') + f('M12 10.6a1.4 1.4 0 1 1 0 2.8 1.4 1.4 0 0 1 0-2.8z'),
  // A wall of bricks with the top brick knocked off and flying.
  demolition: s('M3.5 20.5h12v-8h-12zM3.5 16.5h12M9.5 12.5v4M6.5 16.5v4M12.5 16.5v4') + f('M15.8 4.6l4.6 1.4-1.2 3.6-4.6-1.4z') + s('M13 11l1.5-1.5'),
  // A chequered flag.
  lap: s('M6 21V4') + f('M6 4h3.5v3H6zM13 4h3.5v3H13zM9.5 7H13v3H9.5zM16.5 7H20v3h-3.5zM6 10h3.5v3H6zM13 10h3.5v3H13z') + s('M6 4h14v9H6'),
  // A cross of arrows, like a pad's.
  konami: f('M9.5 3.5h5v6h6v5h-6v6h-5v-6h-6v-5h6z'),
  // A punching bag on its chain.
  heavyweight: s('M12 2.5v3.5M8.5 6h7v11.5a3.5 3.5 0 0 1-7 0zM8.5 10.5h7'),
  // A ramp, something flying off it.
  liftoff: s('M3.5 19.5h11l-11-5.5zM14 9.5c2-3 4.5-4 6.5-3.5M17.5 4.5l3 1.5-1.3 3'),
  // A snowflake.
  hoverboard: s('M12 3v18M4.2 7.5l15.6 9M4.2 16.5l15.6-9M9.6 3.9L12 6l2.4-2.1M9.6 20.1L12 18l2.4 2.1'),
  // A plank snapped in two, the halves tipped apart, with flying chips.
  splinters: f('M2.5 11.5l7.6-1.4 1 1.6-1.2 1 1.4 1.3-8.2 1.5z') + f('M21.5 11.5l-7.6-1.4-1 1.6 1.2 1-1.4 1.3 8.2 1.5z') + s('M12 4.5v2.5M8.5 6l1 1.8M15.5 6l-1 1.8'),
  // A star.
  festive: f('M12 3l2.6 5.6 6.1.7-4.5 4.2 1.2 6L12 16.5l-5.4 3 1.2-6-4.5-4.2 6.1-.7z'),
};

/** The badge's markup for a sticker (empty when it has no icon). */
export function stampIcon(id: string): string {
  const icon = STAMP_ICONS[id];
  return icon ? `<svg class="album-badge" viewBox="0 0 24 24" aria-hidden="true">${icon}</svg>` : '';
}
