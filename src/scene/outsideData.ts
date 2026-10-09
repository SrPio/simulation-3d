import { Color, Matrix4, Mesh, Quaternion, Vector3, type BufferGeometry, type Material, type MeshStandardMaterial, type Object3D, type Texture } from 'three';
import type { Bounds, Box2, Point2 } from '../world/collisions.ts';

/** Floor zone in front of a sign: an oriented rectangle on the ground. */
export type SignArea = { center: Point2; axisX: Point2; axisZ: Point2; halfX: number; halfZ: number };

export type PieceGroup = 'name' | 'tag' | 'keys' | 'bowling' | 'bricks' | 'decor' | 'tech';
/** What a reset zone puts back: a group of pieces, or the targets lane (its thrown laptops and score). */
export type ResetTarget = PieceGroup | 'targets';

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
  /** What a reset zone puts back. */
  target?: ResetTarget;
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
/** One material of a piece's mesh: its geometry and colour, and its texture when it has one (the tech cubes' logos). */
export type PiecePart = { geometry: BufferGeometry; color: Color; map?: Texture };

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
  /** The tool a tech cube shows ('typescript', 'node', …). */
  tech?: string;
  /** A cardboard box's flaps: each part at its hinge on the rim (`matrix`, in the piece's own axes), opening about its local X. */
  flaps?: (PiecePart & { matrix: Matrix4; position: Vector3; quaternion: Quaternion })[];
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
  id: 'intro' | 'crossroads' | 'controls' | 'playground' | 'bowling' | 'footprints' | 'about' | 'targets' | 'tech' | 'playarea' | 'prints' | 'circuit';
  position: Vector3;
  yaw: number;
  size: [number, number];
  /** Width left free for the 3D keys in the middle of the intro sentence. */
  gap: number;
  /** Ground points the painted arrows point at. */
  targets: Point2[];
  /** Zone each crossroads arrow is named after, one per target ('about', 'playground'; the text is `floor.<id>`). */
  labels: string[];
  /** Throw line of the targets lane, this far ahead (local +Z) of the block centre. */
  line: number;
  /** A trail of footprints: where each foot lands on the ground and the heading it points along (atan2(dz, dx)). */
  steps: { x: number; z: number; heading: number }[];
};

/** Street lamp in the crossroads circle; it carries one arrow board per crossroads arrow. */
export type Lamppost = {
  /** Foot of the pole on the outside ground. */
  position: Vector3;
  height: number;
  poleRadius: number;
  /** Height of the first arrow board's centre above the foot, and the drop to each next one. */
  arrowsTop: number;
  arrowStep: number;
  /** The zones the arrows point at, in order from the top: the crossroads' labels and targets. */
  arrows: { id: string; target: Point2 }[];
};

/** A fixed decor object (tree, rock, bench, rack, the bust, globe, glass case, scoreboard): its blob shadow and the box pieces bounce off. */
export type Decor = {
  name: string;
  kind: string;
  position: Vector3;
  yaw: number;
  shadow: [number, number];
  /** Width, height, depth from the ground; none for things too small to stop a piece. */
  solid?: [number, number, number];
};

/** Where the viewer paints a plaque (the bust's, the globe's, the diplomas): a rectangle facing local +Z. */
export type Plaque = { id: string; position: Vector3; yaw: number; size: [number, number] };

/** A standing target: its foot, the centre height of its disc, the ring radii (outer to inner) and their points. */
export type Target = { index: number; object: Object3D; position: Vector3; yaw: number; radius: number; centre: number; rings: number[]; points: number[] };

/** Board next to the targets where the viewer paints the score. */
export type Scoreboard = { position: Vector3; yaw: number; width: number; height: number; bottom: number };

/** Stand of the globe: the viewer draws the sphere (radius, centre height above the foot) with its pin on Colombia. */
export type Globe = { position: Vector3; radius: number; centre: number };

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
  lamppost?: Lamppost;
  decor: Decor[];
  plaques: Plaque[];
  targets: Target[];
  scoreboard?: Scoreboard;
  globe?: Globe;
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

const PROP_GROUPS = new Set<string>(['keys', 'bowling', 'bricks', 'decor', 'tech']);
const RESET_TARGETS = new Set<string>([...PROP_GROUPS, 'targets']);

function shapeOf(data: { radius?: number; cylinders?: number[] }): PieceShape {
  if (typeof data.radius === 'number') return { kind: 'sphere', radius: data.radius };
  if (data.cylinders?.length && data.cylinders.length % 3 === 0) {
    const cylinders = [];
    for (let i = 0; i < data.cylinders.length; i += 3) cylinders.push({ radius: data.cylinders[i], height: data.cylinders[i + 1], y: data.cylinders[i + 2] });
    return { kind: 'cylinders', cylinders };
  }
  return { kind: 'box' };
}

const FLAP = /_Flap_\d+$/;

/** The meshes of a node: itself, or the one-material children the loader makes of a multi-material mesh (not its flaps). */
function partsOf(object: Object3D): PiecePart[] {
  const meshes = object instanceof Mesh ? [object] : object.children.filter((child): child is Mesh => child instanceof Mesh && !FLAP.test(child.name));
  return meshes.map((mesh) => {
    const material = mesh.material as MeshStandardMaterial;
    return { geometry: mesh.geometry, color: (material.color ?? new Color(1, 1, 1)).clone(), ...(material.map ? { map: material.map } : {}) };
  });
}

/** A box's hinged flaps, from its `<name>_Flap_<i>` children. */
function flapsOf(object: Object3D): { flaps?: Piece['flaps'] } {
  const flaps = object.children.filter((child) => FLAP.test(child.name)).sort((a, b) => a.name.localeCompare(b.name))
    .flatMap((child) => partsOf(child).map((part) => ({ ...part, matrix: child.matrix.clone(), position: child.position.clone(), quaternion: child.quaternion.clone() })));
  return flaps.length ? { flaps } : {};
}

type Extras = {
  bounds?: number[]; platform?: number[]; ground_y?: number; link?: string; label?: string;
  board?: number[]; area?: number[]; area_offset?: number; collider?: string; size?: number[]; box?: number[]; title?: string;
  zone?: string; target?: string | number; floor?: string; line?: number; steps?: number[]; decor?: string; shadow?: number[]; solid?: number[];
  plaque?: number[]; text?: string; centre?: number; rings?: number[]; points?: number[]; tech?: string; gap?: number; targets?: number[]; labels?: string;
  height?: number; pole_radius?: number; arrows_top?: number; arrow_step?: number;
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
  let lamppost: Lamppost | undefined;
  const decor: Decor[] = [];
  const plaques: Plaque[] = [];
  const targets: Target[] = [];
  let scoreboard: Scoreboard | undefined;
  let globe: Globe | undefined;
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
    } else if (data.decor && data.shadow?.length === 2) {
      decor.push({
        name: object.name, kind: data.decor, position, yaw, shadow: [data.shadow[0], data.shadow[1]],
        ...(data.solid?.length === 3 ? { solid: [data.solid[0], data.solid[1], data.solid[2]] as [number, number, number] } : {}),
      });
      if (object.name === 'Globe' && data.radius && data.centre) globe = { position, radius: data.radius, centre: data.centre };
      if (object.name === 'Scoreboard' && data.board?.length === 3) {
        scoreboard = { position, yaw, width: data.board[0], height: data.board[1], bottom: data.board[2] };
      }
    } else if (object.name.startsWith('Plaque_') && data.plaque?.length === 2 && data.text) {
      plaques.push({ id: data.text, position, yaw, size: [data.plaque[0], data.plaque[1]] });
    } else if (/^Target_\d+$/.test(object.name) && typeof data.target === 'number' && data.radius && data.centre && data.rings && data.points) {
      targets.push({ index: data.target, object, position, yaw, radius: data.radius, centre: data.centre, rings: data.rings, points: data.points });
    } else if (object.name === 'Lamppost' && data.height && data.arrows_top) {
      lamppost = { position, height: data.height, poleRadius: data.pole_radius ?? 0.06, arrowsTop: data.arrows_top, arrowStep: data.arrow_step ?? 0.5, arrows: [] };
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
    } else if (object.name.startsWith('Zone_') && data.zone === 'reset' && data.area && RESET_TARGETS.has(String(data.target ?? ''))) {
      const target = data.target as ResetTarget;
      zones.push({ id: `reset-${target}`, kind: 'reset', link: '', label: target, title: 'RESET', target, position, yaw, area: areaOf(position, quaternion, data.area, 0) });
    } else if (object.name.startsWith('Floor_') && data.floor && data.size?.length === 2) {
      const targets: Point2[] = [];
      const flat = data.targets ?? [];
      for (let i = 0; i + 1 < flat.length; i += 2) targets.push({ x: flat[i], z: flat[i + 1] });
      const labels = (data.labels ?? '').split(',').filter(Boolean);
      const steps: FloorBlock['steps'] = [];
      const flatSteps = data.steps ?? [];
      for (let i = 0; i + 2 < flatSteps.length; i += 3) steps.push({ x: flatSteps[i], z: flatSteps[i + 1], heading: flatSteps[i + 2] });
      floors.push({ id: data.floor as FloorBlock['id'], position, yaw, size: [data.size[0], data.size[1]], gap: data.gap ?? 0, targets, labels, line: data.line ?? 0, steps });
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
        ...(data.tech ? { tech: data.tech } : {}),
        ...flapsOf(object),
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
  const crossroads = floors.find((floor) => floor.id === 'crossroads');
  if (lamppost && crossroads) lamppost.arrows = crossroads.targets.map((target, i) => ({ id: crossroads.labels[i] ?? '', target }));
  targets.sort((a, b) => a.index - b.index);
  return { bounds, groundY, platform, boxes, signs, zones, letters, props, floors, lamppost, decor, plaques, targets, scoreboard, globe };
}

/** Floor height under a point: the room floor on its platform, the outside ground elsewhere. */
export function groundAt(point: Point2, outside: Pick<OutsideData, 'groundY' | 'platform'>): number {
  const { platform } = outside;
  const onPlatform = point.x >= platform.minX && point.x <= platform.maxX && point.z >= platform.minZ && point.z <= platform.maxZ;
  return onPlatform ? 0 : outside.groundY;
}
