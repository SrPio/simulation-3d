/** Ground-plane collision for a circular character against axis-aligned boxes (room colliders). */

/** A box on the floor. With `yaw` it is turned about +Y around its centre and min/max are its unturned extents. */
export type Box2 = { name: string; minX: number; maxX: number; minZ: number; maxZ: number; yaw?: number };
export type Point2 = { x: number; z: number };
/** Walkable floor rectangle. A number is a square room of that half size centred at the origin. */
export type Bounds = { minX: number; maxX: number; minZ: number; maxZ: number };
export type Floor = Bounds | number;

/** Point in the box's own (unturned) frame, and back. Plain boxes pass through. */
function toBox(box: Box2, x: number, z: number, inverse = false): Point2 {
  if (!box.yaw) return { x, z };
  const cx = (box.minX + box.maxX) / 2;
  const cz = (box.minZ + box.maxZ) / 2;
  const cos = Math.cos(box.yaw);
  const sin = inverse ? -Math.sin(box.yaw) : Math.sin(box.yaw);
  const dx = x - cx;
  const dz = z - cz;
  return { x: cx + dx * cos - dz * sin, z: cz + dx * sin + dz * cos };
}

export function floorBounds(floor: Floor): Bounds {
  return typeof floor === 'number' ? { minX: -floor, maxX: floor, minZ: -floor, maxZ: floor } : floor;
}

/** Push a circle out of every box it overlaps, keeping the tangential motion (sliding). */
export function resolve(point: Point2, radius: number, boxes: readonly Box2[], iterations = 4): Point2 {
  let { x, z } = point;
  for (let pass = 0; pass < iterations; pass++) {
    let moved = false;
    for (const box of boxes) {
      const local = toBox(box, x, z);
      const pushed = pushOut(local, radius, box);
      if (!pushed) continue;
      moved = true;
      ({ x, z } = toBox(box, pushed.x, pushed.z, true));
    }
    if (!moved) break;
  }
  return { x, z };
}

/** The circle pushed out of one box in the box's own frame, or undefined when they do not overlap. */
function pushOut({ x, z }: Point2, radius: number, box: Box2): Point2 | undefined {
  const cx = Math.min(Math.max(x, box.minX), box.maxX);
  const cz = Math.min(Math.max(z, box.minZ), box.maxZ);
  const dx = x - cx;
  const dz = z - cz;
  const distance = Math.hypot(dx, dz);
  if (distance >= radius) return undefined;
  if (distance > 1e-9) return { x: cx + dx / distance * radius, z: cz + dz / distance * radius };
  // Centre inside the box: leave through the nearest face.
  const exits = [x - box.minX + radius, box.maxX - x + radius, z - box.minZ + radius, box.maxZ - z + radius];
  const nearest = exits.indexOf(Math.min(...exits));
  if (nearest === 0) return { x: box.minX - radius, z };
  if (nearest === 1) return { x: box.maxX + radius, z };
  if (nearest === 2) return { x, z: box.minZ - radius };
  return { x, z: box.maxZ + radius };
}

/** Keep the circle inside the walkable floor. */
export function clampToFloor(point: Point2, radius: number, floor: Floor): Point2 {
  const { minX, maxX, minZ, maxZ } = floorBounds(floor);
  const clamp = (value: number, min: number, max: number) => min + radius > max - radius ? (min + max) / 2 : Math.min(Math.max(value, min + radius), max - radius);
  return { x: clamp(point.x, minX, maxX), z: clamp(point.z, minZ, maxZ) };
}

/**
 * Move from `from` by `delta` in sub-steps no longer than half the radius, so a long frame cannot
 * tunnel through thin furniture, resolving collisions after every sub-step.
 */
export function sweep(from: Point2, delta: Point2, radius: number, boxes: readonly Box2[], floor: Floor): Point2 {
  const length = Math.hypot(delta.x, delta.z);
  const steps = Math.max(1, Math.ceil(length / (radius * 0.5)));
  let point = { ...from };
  for (let i = 0; i < steps; i++) {
    point = { x: point.x + delta.x / steps, z: point.z + delta.z / steps };
    point = clampToFloor(resolve(point, radius, boxes), radius, floor);
  }
  return point;
}

export function overlaps(point: Point2, radius: number, boxes: readonly Box2[]): Box2 | undefined {
  return boxes.find((box) => {
    const local = toBox(box, point.x, point.z);
    const cx = Math.min(Math.max(local.x, box.minX), box.maxX);
    const cz = Math.min(Math.max(local.z, box.minZ), box.maxZ);
    return Math.hypot(local.x - cx, local.z - cz) < radius - 1e-6;
  });
}
