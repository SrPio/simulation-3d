import { Color, Mesh, Quaternion, Vector3, type BufferGeometry, type Material, type MeshStandardMaterial, type Object3D } from 'three';
import type { Bounds, Box2, Point2 } from '../world/collisions.ts';

/** Floor zone in front of a sign: an oriented rectangle on the ground. */
export type SignArea = { center: Point2; axisX: Point2; axisZ: Point2; halfX: number; halfZ: number };

export type PieceGroup = 'name' | 'tag' | 'keys' | 'bowling' | 'bricks';

/**
 * A floor zone outside the room. 'link' zones lie in front of a standing sign with a screenshot of a site
 * and open its link; 'reset' zones put a group of loose pieces (the pins, the bricks) back in place.
 */
export type Sign = {
  id: string;
  kind: 'link' | 'reset';
  link: string;
  label: string;
  /** Word written on the ground in front of the zone (the viewer shows the current language's). */
  title: string;
  /** Piece group a reset zone puts back. */
  target?: PieceGroup;
  /** Foot of the sign, between its posts, on the outside ground (the zone centre for reset zones). */
  position: Vector3;
  /** Rotation about +Y; the board faces its local +Z (towards the corner camera). */
  yaw: number;
  /** Standing board of a link zone. */
  board?: { width: number; height: number; bottom: number };
  area: SignArea;
};

/** Collision shape about the piece origin: its box (half sizes), a sphere, or stacked cylinders along +Y. */
export type PieceShape =
  | { kind: 'box' }
  | { kind: 'sphere'; radius: number }
  | { kind: 'cylinders'; cylinders: { radius: number; height: number; y: number }[] };
/** One material of a piece's mesh: its geometry and colour. */
export type PiecePart = { geometry: BufferGeometry; color: Color };

/** A loose piece moved by the physics: the name letters, the tagline, the arrow keys, the pins and ball, the bricks. */
export type Piece = {
  name: string;
  group: PieceGroup;
  parts: PiecePart[];
  position: Vector3;
  quaternion: Quaternion;
  /** Half sizes of its bounding box along its own axes: width, height, depth (blob shadows, box bodies). */
  half: [number, number, number];
  shape: PieceShape;
  mass: number;
};

/** One loose letter (the standing name or the flat tagline): its mesh, centred on the letter, and the box its physics body uses. */
export type Letter = Piece & {
  /** 'name' for the standing ANDRES JARAMILLO letters, 'tag' for the flat "<Developer />" pieces. */
  word: 'name' | 'tag';
  geometry: BufferGeometry;
  material: Material;
};

/** Where the viewer paints on the ground: a block in its own axes (local +X along the text, +Z towards the camera). */
export type FloorBlock = {
  id: 'intro' | 'crossroads' | 'controls' | 'playground' | 'bowling' | 'footprints';
  position: Vector3;
  yaw: number;
  size: [number, number];
  /** Width left free for the 3D keys in the middle of the intro sentence. */
  gap: number;
  /** Ground points the painted arrows point at. */
  targets: Point2[];
};

export type OutsideData = {
  bounds: Bounds;
  /** Height of the outside ground; the room floor is at 0, a step above it. */
  groundY: number;
  /** Room platform footprint: inside it the floor is at 0. */
  platform: Bounds;
  boxes: Box2[];
  signs: Sign[];
  /** Reset zones of the playground. */
  zones: Sign[];
  letters: Letter[];
  /** Arrow keys, pins, ball and bricks. */
  props: Piece[];
  floors: FloorBlock[];
};

export const LETTER_MASS = 1.5;

/** Blender XY rectangle [minX, maxX, minY, maxY] in three.js XZ: Blender Y becomes three.js -Z. */
function fromBlender([minX, maxX, minY, maxY]: number[]): Bounds {
  return { minX, maxX, minZ: -maxY, maxZ: -minY };
}

const yawOf = (quaternion: Quaternion) => {
  const x = new Vector3(1, 0, 0).applyQuaternion(quaternion);
  return Math.atan2(-x.z, x.x);
};

function areaOf(position: Vector3, quaternion: Quaternion, size: number[], offset: number): SignArea {
  const axisX = new Vector3(1, 0, 0).applyQuaternion(quaternion);
  const axisZ = new Vector3(0, 0, 1).applyQuaternion(quaternion);
  return {
    center: { x: position.x + axisZ.x * offset, z: position.z + axisZ.z * offset },
    axisX: { x: axisX.x, z: axisX.z },
    axisZ: { x: axisZ.x, z: axisZ.z },
    halfX: size[0] / 2,
    halfZ: size[1] / 2,
  };
}

const PROP_GROUPS = new Set<string>(['keys', 'bowling', 'bricks']);

function shapeOf(data: { radius?: number; cylinders?: number[] }): PieceShape {
  if (typeof data.radius === 'number') return { kind: 'sphere', radius: data.radius };
  if (data.cylinders?.length && data.cylinders.length % 3 === 0) {
    const cylinders = [];
    for (let i = 0; i < data.cylinders.length; i += 3) cylinders.push({ radius: data.cylinders[i], height: data.cylinders[i + 1], y: data.cylinders[i + 2] });
    return { kind: 'cylinders', cylinders };
  }
  return { kind: 'box' };
}

/** The meshes of a node: itself, or the one-material children the loader makes of a multi-material mesh. */
function partsOf(object: Object3D): PiecePart[] {
  const meshes = object instanceof Mesh ? [object] : object.children.filter((child): child is Mesh => child instanceof Mesh);
  return meshes.map((mesh) => ({ geometry: mesh.geometry, color: ((mesh.material as MeshStandardMaterial).color ?? new Color(1, 1, 1)).clone() }));
}

type Extras = {
  bounds?: number[]; platform?: number[]; ground_y?: number; link?: string; label?: string;
  board?: number[]; area?: number[]; area_offset?: number; collider?: string; size?: number[]; box?: number[]; title?: string;
  zone?: string; target?: string; floor?: string; gap?: number; targets?: number[];
  prop?: string; group?: string; mass?: number; radius?: number; cylinders?: number[];
};

/** Read what the outside GLB exports (see scripts/blender/create_outside.py). */
export function readOutside(root: Object3D): OutsideData {
  root.updateMatrixWorld(true);
  const signs: Sign[] = [];
  const zones: Sign[] = [];
  const letters: Letter[] = [];
  const props: Piece[] = [];
  const floors: FloorBlock[] = [];
  const boxes: Box2[] = [];
  let bounds: Bounds | undefined;
  let platform: Bounds = { minX: 0, maxX: 0, minZ: 0, maxZ: 0 };
  let groundY = 0;
  root.traverse((object) => {
    const data = object.userData as Extras;
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
      signs.push({
        id: object.name.slice('Sign_'.length).toLowerCase(),
        kind: 'link',
        link: data.link,
        label: data.label ?? data.link,
        title: data.title ?? '',
        position,
        yaw,
        board: { width: data.board[0], height: data.board[1], bottom: data.board[2] },
        area: areaOf(position, quaternion, data.area, data.area_offset ?? 0),
      });
    } else if (object.name.startsWith('Zone_') && data.zone === 'reset' && data.area && PROP_GROUPS.has(data.target ?? '')) {
      const target = data.target as PieceGroup;
      zones.push({ id: `reset-${target}`, kind: 'reset', link: '', label: target, title: 'RESET', target, position, yaw, area: areaOf(position, quaternion, data.area, 0) });
    } else if (object.name.startsWith('Floor_') && data.floor && data.size?.length === 2) {
      const targets: Point2[] = [];
      const flat = data.targets ?? [];
      for (let i = 0; i + 1 < flat.length; i += 2) targets.push({ x: flat[i], z: flat[i + 1] });
      floors.push({ id: data.floor as FloorBlock['id'], position, yaw, size: [data.size[0], data.size[1]], gap: data.gap ?? 0, targets });
    } else if (data.prop && PROP_GROUPS.has(data.group ?? '') && data.box?.length === 3) {
      props.push({
        name: object.name,
        group: data.group as PieceGroup,
        parts: partsOf(object),
        position,
        quaternion,
        half: [data.box[0] / 2, data.box[1] / 2, data.box[2] / 2],
        shape: shapeOf(data),
        mass: data.mass ?? 1,
      });
    } else if (object instanceof Mesh && /^(Letter|Tag)_/.test(object.name) && data.box?.length === 3) {
      const word = object.name.startsWith('Tag_') ? 'tag' : 'name';
      letters.push({
        name: object.name,
        word,
        group: word,
        geometry: object.geometry,
        material: object.material as Material,
        parts: partsOf(object),
        position,
        quaternion,
        half: [data.box[0] / 2, data.box[1] / 2, data.box[2] / 2],
        shape: { kind: 'box' },
        mass: LETTER_MASS,
      });
    }
  });
  if (!bounds) throw new Error('ROOM_OUTSIDE_BOUNDS');
  // The name first, then the tagline, each in reading order; the props by group and name.
  letters.sort((a, b) => a.word.localeCompare(b.word) || a.name.localeCompare(b.name));
  props.sort((a, b) => a.group.localeCompare(b.group) || a.name.localeCompare(b.name));
  return { bounds, groundY, platform, boxes, signs, zones, letters, props, floors };
}

/** Floor height under a point: the room floor on its platform, the outside ground elsewhere. */
export function groundAt(point: Point2, outside: Pick<OutsideData, 'groundY' | 'platform'>): number {
  const { platform } = outside;
  const onPlatform = point.x >= platform.minX && point.x <= platform.maxX && point.z >= platform.minZ && point.z <= platform.maxZ;
  return onPlatform ? 0 : outside.groundY;
}
