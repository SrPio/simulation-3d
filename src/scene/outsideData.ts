import { Mesh, Quaternion, Vector3, type BufferGeometry, type Material, type Object3D } from 'three';
import type { Bounds, Box2, Point2 } from '../world/collisions.ts';

/** Floor zone in front of a sign: an oriented rectangle on the ground. */
export type SignArea = { center: Point2; axisX: Point2; axisZ: Point2; halfX: number; halfZ: number };

/** A standing sign outside the room with a screenshot of a site; its floor zone opens the link. */
export type Sign = {
  id: string;
  link: string;
  label: string;
  /** Foot of the sign, between its posts, on the outside ground. */
  position: Vector3;
  /** Rotation about +Y; the board faces its local +Z (towards the corner camera). */
  yaw: number;
  board: { width: number; height: number; bottom: number };
  area: SignArea;
};

/** One letter of the name: its mesh (geometry centred on the letter) and the box its physics body uses. */
export type Letter = {
  name: string;
  geometry: BufferGeometry;
  material: Material;
  position: Vector3;
  quaternion: Quaternion;
  /** Half sizes along the letter's own axes: width, height, depth. */
  half: [number, number, number];
};

export type OutsideData = {
  bounds: Bounds;
  /** Height of the outside ground; the room floor is at 0, a step above it. */
  groundY: number;
  /** Room platform footprint: inside it the floor is at 0. */
  platform: Bounds;
  boxes: Box2[];
  signs: Sign[];
  letters: Letter[];
};

/** Blender XY rectangle [minX, maxX, minY, maxY] in three.js XZ: Blender Y becomes three.js -Z. */
function fromBlender([minX, maxX, minY, maxY]: number[]): Bounds {
  return { minX, maxX, minZ: -maxY, maxZ: -minY };
}

const yawOf = (quaternion: Quaternion) => {
  const x = new Vector3(1, 0, 0).applyQuaternion(quaternion);
  return Math.atan2(-x.z, x.x);
};

/** Read what the outside GLB exports (see scripts/blender/create_outside.py). */
export function readOutside(root: Object3D): OutsideData {
  root.updateMatrixWorld(true);
  const signs: Sign[] = [];
  const letters: Letter[] = [];
  const boxes: Box2[] = [];
  let bounds: Bounds | undefined;
  let platform: Bounds = { minX: 0, maxX: 0, minZ: 0, maxZ: 0 };
  let groundY = 0;
  root.traverse((object) => {
    const data = object.userData as {
      bounds?: number[]; platform?: number[]; ground_y?: number; link?: string; label?: string;
      board?: number[]; area?: number[]; area_offset?: number; collider?: string; size?: number[]; box?: number[];
    };
    if (data.bounds?.length === 4) {
      bounds = fromBlender(data.bounds);
      if (data.platform?.length === 4) platform = fromBlender(data.platform);
      groundY = data.ground_y ?? 0;
    }
    const position = object.getWorldPosition(new Vector3());
    const quaternion = object.getWorldQuaternion(new Quaternion());
    const yaw = yawOf(quaternion);
    if (data.collider === 'box' && data.size) {
      // Sizes in Blender axes: X stays X, Blender Y becomes three.js Z. Turned boxes keep their yaw.
      const [sx, sy] = data.size;
      boxes.push({ name: object.name, minX: position.x - sx / 2, maxX: position.x + sx / 2, minZ: position.z - sy / 2, maxZ: position.z + sy / 2, ...(Math.abs(yaw) > 1e-4 ? { yaw } : {}) });
    } else if (object.name.startsWith('Sign_') && data.link && data.board && data.area) {
      const axisX = new Vector3(1, 0, 0).applyQuaternion(quaternion);
      const axisZ = new Vector3(0, 0, 1).applyQuaternion(quaternion);
      const offset = data.area_offset ?? 0;
      signs.push({
        id: object.name.slice('Sign_'.length).toLowerCase(),
        link: data.link,
        label: data.label ?? data.link,
        position,
        yaw,
        board: { width: data.board[0], height: data.board[1], bottom: data.board[2] },
        area: {
          center: { x: position.x + axisZ.x * offset, z: position.z + axisZ.z * offset },
          axisX: { x: axisX.x, z: axisX.z },
          axisZ: { x: axisZ.x, z: axisZ.z },
          halfX: data.area[0] / 2,
          halfZ: data.area[1] / 2,
        },
      });
    } else if (object instanceof Mesh && object.name.startsWith('Letter_') && data.box?.length === 3) {
      letters.push({
        name: object.name,
        geometry: object.geometry,
        material: object.material as Material,
        position,
        quaternion,
        half: [data.box[0] / 2, data.box[1] / 2, data.box[2] / 2],
      });
    }
  });
  if (!bounds) throw new Error('ROOM_OUTSIDE_BOUNDS');
  letters.sort((a, b) => a.name.localeCompare(b.name));
  return { bounds, groundY, platform, boxes, signs, letters };
}

/** Floor height under a point: the room floor on its platform, the outside ground elsewhere. */
export function groundAt(point: Point2, outside: Pick<OutsideData, 'groundY' | 'platform'>): number {
  const { platform } = outside;
  const onPlatform = point.x >= platform.minX && point.x <= platform.maxX && point.z >= platform.minZ && point.z <= platform.maxZ;
  return onPlatform ? 0 : outside.groundY;
}
