import { Color } from 'three';

/** The violet the words, borders and marks on the ground are painted in. */
const VIOLET = 0xb79bff;
/** Christmas: a dark grey with a hint of violet, so they read on the white snow. */
export const SNOW_INK = 0x46424f;

let ink = VIOLET;

/** The colour for what is painted on the ground (the floor texts, the sign zones' borders and titles, the like count). */
export const groundInk = (): Color => new Color(ink);

/** Christmas sets the snow ink before the outside is built; anything else keeps the violet. */
export function setGroundInk(snow: boolean): void {
  ink = snow ? SNOW_INK : VIOLET;
}
