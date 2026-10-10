import type { PieceGroup } from '../scene/outsideData.ts';
import type { RecordedSound } from './soundFiles.ts';

const BY_PROP: Record<string, RecordedSound> = {
  brick: 'brick', pin: 'pin', ball: 'ball', box: 'cardboard', cone: 'plastic', chevron: 'plastic', works: 'plastic', tech: 'plastic',
  pallet: 'wood', plank: 'wood', leg: 'wood', drum: 'metal', pipe: 'metal', metal: 'metal', barrow: 'metal', tyre: 'rubber', key: 'stone',
};

/** What a loose piece sounds like when it hits something: the name letters are stone, the rest goes by its prop. */
export function pieceSound(piece: { group: PieceGroup; prop?: string }): RecordedSound {
  if (piece.group === 'name' || piece.group === 'tag') return 'stone';
  return (piece.prop && BY_PROP[piece.prop]) || (piece.group === 'bricks' || piece.group === 'wall' ? 'brick' : 'wood');
}
