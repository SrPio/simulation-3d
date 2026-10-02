import { Quaternion, Vector3, type Object3D } from 'three';
import type { SeatSpot } from '../interactions/InteractionController.ts';
import type { Seat } from '../interactions/interactionState.ts';
import type { Box2, Point2 } from '../world/collisions.ts';

export type Placement = { position: Vector3; quaternion: Quaternion };
export type RoomData = {
  spawn: { position: Point2; yaw: number };
  seats: SeatSpot[];
  /** Where each seat's clips start (the stand point) as a full transform for the character root. */
  seatPlacements: Map<Seat, Placement>;
  laptopSpots: Map<'desk' | 'lap', Placement>;
  boxes: Box2[];
  halfSize: number;
};

const yawOf = (quaternion: Quaternion) => {
  const forward = new Vector3(0, 0, 1).applyQuaternion(quaternion); // characters face +Z
  return Math.atan2(forward.x, forward.z);
};

/** Read the anchors and colliders the room GLB exports (see scripts/blender/create_room.py). */
export function readRoom(room: Object3D): RoomData {
  room.updateMatrixWorld(true);
  const boxes: Box2[] = [];
  const approaches = new Map<Seat, Point2[]>();
  const seatPlacements = new Map<Seat, Placement>();
  const laptopSpots = new Map<'desk' | 'lap', Placement>();
  let spawn = { position: { x: 0, z: 0 }, yaw: 0 };
  room.traverse((object) => {
    const data = object.userData as { collider?: string; size?: number[]; seat?: Seat; stand_offset?: number; laptop?: string };
    const position = object.getWorldPosition(new Vector3());
    const quaternion = object.getWorldQuaternion(new Quaternion());
    if (data.collider === 'box' && data.size) {
      // Sizes are stored in Blender axes: X stays X, Blender Y becomes three.js -Z.
      const [sx, sy] = data.size;
      boxes.push({ name: object.name, minX: position.x - sx / 2, maxX: position.x + sx / 2, minZ: position.z - sy / 2, maxZ: position.z + sy / 2 });
    } else if (object.name === 'Spawn') {
      spawn = { position: { x: position.x, z: position.z }, yaw: yawOf(quaternion) };
    } else if (data.seat && data.stand_offset !== undefined) {
      // Seat anchors carry stand_offset: the clips move the hips that far back onto the seat.
      const stand = position.clone().setY(0).add(new Vector3(0, 0, data.stand_offset).applyQuaternion(quaternion));
      seatPlacements.set(data.seat, { position: stand, quaternion });
    } else if (data.seat && object.name.includes('Approach')) {
      // One approach point per free side of the seat (the chair has two).
      approaches.set(data.seat, [...(approaches.get(data.seat) ?? []), { x: position.x, z: position.z }]);
    } else if (data.laptop === 'desk' || data.laptop === 'lap' || data.laptop === 'bed') {
      laptopSpots.set(data.laptop === 'desk' ? 'desk' : 'lap', { position, quaternion });
    }
  });
  const seats: SeatSpot[] = [];
  for (const [seat, placement] of seatPlacements) {
    const sides = approaches.get(seat);
    if (sides?.length) seats.push({ seat, approaches: sides, stand: { x: placement.position.x, z: placement.position.z }, yaw: yawOf(placement.quaternion) });
  }
  const halfSize = Number(room.getObjectByName('Room')?.userData.half_size ?? 2.9);
  return { spawn, seats, seatPlacements, laptopSpots, boxes, halfSize };
}
