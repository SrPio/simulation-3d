import { Box3, Quaternion, Vector3, type Object3D } from 'three';
import type { Bounds, Point2 } from '../world/collisions.ts';

/** A floor plate outside the room: a site screenshot that shows a link button when stepped on. */
export type Plate = {
  id: string;
  link: string;
  label: string;
  /** Centre of the plate's top face. */
  position: Vector3;
  /** Plate axes on the floor (unit vectors) and half sizes along them. */
  axisX: Point2;
  axisZ: Point2;
  halfX: number;
  halfZ: number;
};
export type OutsideData = { bounds: Bounds; plates: Plate[] };

/** Read the walkable bounds and the plates the outside GLB exports (see scripts/blender/create_outside.py). */
export function readOutside(root: Object3D): OutsideData {
  root.updateMatrixWorld(true);
  const plates: Plate[] = [];
  let bounds: Bounds | undefined;
  root.traverse((object) => {
    const data = object.userData as { bounds?: number[]; link?: string; label?: string; size?: number[] };
    if (data.bounds?.length === 4) {
      // Stored in Blender XY: X stays X, Blender Y becomes three.js -Z.
      const [minX, maxX, minY, maxY] = data.bounds;
      bounds = { minX, maxX, minZ: -maxY, maxZ: -minY };
    }
    if (!data.link || !data.size || !object.name.startsWith('Plate_')) return;
    const quaternion = object.getWorldQuaternion(new Quaternion());
    const x = new Vector3(1, 0, 0).applyQuaternion(quaternion);
    const z = new Vector3(0, 0, 1).applyQuaternion(quaternion);
    plates.push({
      id: object.name.slice('Plate_'.length).toLowerCase(),
      link: data.link,
      label: data.label ?? data.link,
      position: object.getWorldPosition(new Vector3()).setY(new Box3().setFromObject(object).max.y),
      axisX: { x: x.x, z: x.z },
      axisZ: { x: z.x, z: z.z },
      halfX: data.size[0] / 2,
      halfZ: data.size[1] / 2,
    });
  });
  if (!bounds) throw new Error('ROOM_OUTSIDE_BOUNDS');
  return { bounds, plates };
}
