import { Color } from 'three';

/** The violet the words, borders and marks on the ground are painted in. */
const VIOLET = 0xb79bff;
/** Christmas: a dark grey with a hint of violet, so they read on the white snow. */
export const SNOW_INK = 0x46424f;

let ink = VIOLET;

/** The colour for what is painted on the ground (the floor texts, the sign zones' borders and titles, the like count). */
export const groundInk = (): Color => new Color(ink);

/**
 * The striped fence that rises round a zone and how strong its stripes are: the light violet on the dark ground; on the
 * snow a deep violet, drawn twice as strong, or it is lost against the white.
 */
export const fenceInk = (): { color: Color; strength: number } =>
  ink === SNOW_INK ? { color: new Color(0x4b2fb4), strength: 2.1 } : { color: new Color(VIOLET), strength: 1 };

/** The words lying on the ground in front of a zone (ENTER and where it leads): white, or a dark ink on the snow. */
export const labelInk = (): Color => new Color(ink === SNOW_INK ? 0x2f2a42 : 0xffffff);

/** Christmas sets the snow ink before the outside is built; anything else keeps the violet. */
export function setGroundInk(snow: boolean): void {
  ink = snow ? SNOW_INK : VIOLET;
}
