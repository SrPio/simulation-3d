import {
  Color, Group, Matrix4, Mesh, MeshStandardMaterial, SkinnedMesh, SphereGeometry, Vector3, type Bone, type Material, type Object3D,
} from 'three';
import { partsOf, type Piece, type PunchBag } from './outsideData.ts';

/**
 * halloween.glb (scripts/blender/create_halloween.py) split up: `world` is read with the outside (its pumpkins, spiders
 * and graves are pieces of group 'halloween', its fence and cobwebs are merged with the outside); the rest is kept aside.
 */
export type HalloweenDress = {
  world: Object3D;
  /** Jason's hockey mask, modelled in the character's own frame (hung on its head bone by `wearMask`). */
  mask?: Object3D;
  /** The cauldron that replaces the office chair: its origin on the ground under the middle, facing +Z. */
  cauldron?: Object3D;
  /** Height of the brew's surface over the cauldron's foot and the rim's radius: the rider shows only above it. */
  brew: { height: number; radius: number };
  /** Meshes used as they are: the dressed pieces, the thrown pumpkin and its shards, the candies, the bat, the ghost. */
  library: Map<string, Object3D>;
};

export function takeHalloween(scene: Object3D): HalloweenDress {
  scene.updateMatrixWorld(true);
  const world = scene.getObjectByName('HalloweenWorld') ?? new Group();
  const mask = scene.getObjectByName('HalloweenMask');
  const cauldron = scene.getObjectByName('HalloweenCauldron');
  const library = new Map<string, Object3D>();
  for (const child of scene.getObjectByName('HalloweenLibrary')?.children ?? []) library.set(child.name, child);
  const brew = (cauldron?.userData.brew as number[] | undefined) ?? [0.95, 0.66];
  world.removeFromParent();
  return { world, mask, cauldron, brew: { height: brew[0], radius: brew[1] }, library };
}

/**
 * Halloween looks for pieces that keep their bodies: the pins become pumpkins, the ball an eye and the bricks (the
 * playground's and the end wall's) dark stone, one of three stones each. The dressed meshes have the same sizes.
 */
export function dressPieces(pieces: readonly Piece[], dress: HalloweenDress): void {
  const parts = (name: string) => {
    const object = dress.library.get(name);
    return object ? partsOf(object) : undefined;
  };
  const pin = parts('Halloween_Pin');
  const ball = parts('Halloween_Ball');
  const bricks = [0, 1, 2].map((index) => parts(`Halloween_Brick${index}`));
  let brick = 0;
  for (const piece of pieces) {
    if (piece.prop === 'pin' && pin) piece.parts = pin;
    else if (piece.prop === 'ball' && ball) piece.parts = ball;
    else if (piece.prop === 'brick' && (piece.group === 'bricks' || piece.group === 'wall')) {
      const stone = bricks[brick++ % bricks.length];
      if (stone) piece.parts = stone;
    }
  }
}

/** Where a punching bag's letters face (LETTERS turn in create_boxing.py): its ghost face looks the same way. */
const BAG_FACE_TURN = 0.35;

/**
 * A punching bag as a ghost: the cover and cap white and faintly glowing, the JS / TS letters hidden, and two black
 * eyes and an open mouth on its front, children of the bag so they swing with it.
 */
export function ghostBag(bag: PunchBag): void {
  const sheet = new MeshStandardMaterial({ color: 0xf4f4fa, roughness: 0.7, emissive: 0x5a5a6e, name: 'GhostBag' });
  const black = new MeshStandardMaterial({ color: 0x050507, roughness: 0.4, name: 'GhostBagEye' });
  const replaced = new Set<Material>();
  const letters: Mesh[] = [];
  bag.object.traverse((object) => {
    if (!(object instanceof Mesh)) return;
    const material = object.material as Material;
    if (/^BagLetters/.test(material.name)) letters.push(object);
    else if (/^(Bag_|BagCap)/.test(material.name)) {
      replaced.add(material);
      object.material = sheet;
    }
  });
  for (const mesh of letters) {
    mesh.removeFromParent();
    mesh.geometry.dispose();
    replaced.add(mesh.material as Material);
  }
  for (const material of replaced) material.dispose();
  const middle = -bag.centre;
  const forward = new Vector3(Math.sin(BAG_FACE_TURN), 0, Math.cos(BAG_FACE_TURN));
  const across = new Vector3(forward.z, 0, -forward.x);
  const face = new Group();
  face.name = `GhostFace_${bag.id}`;
  const eye = new SphereGeometry(1, 16, 10);
  for (const side of [-1, 1]) {
    const mesh = new Mesh(eye, black);
    mesh.scale.set(0.06, 0.1, 0.03);
    mesh.position.copy(forward).multiplyScalar(bag.radius - 0.01).addScaledVector(across, side * 0.1).setY(middle + 0.42);
    mesh.lookAt(mesh.position.clone().add(forward));
    face.add(mesh);
  }
  const mouth = new Mesh(eye, black);
  mouth.scale.set(0.045, 0.07, 0.025);
  mouth.position.copy(forward).multiplyScalar(bag.radius - 0.008).setY(middle + 0.17);
  mouth.lookAt(mouth.position.clone().add(forward));
  face.add(mouth);
  bag.object.add(face);
}

/**
 * Hang the hockey mask on the character's head bone. The mask is modelled over the head in its bind pose (in the
 * model's own frame): placed in the bone's frame by the head's inverse bind matrix, it follows every turn of the head.
 */
export function wearMask(model: Object3D, mask: Object3D): boolean {
  let skinned: SkinnedMesh | undefined;
  let head: Bone | undefined;
  model.traverse((object) => {
    if (skinned || !(object instanceof SkinnedMesh)) return;
    const bone = object.skeleton.bones.find((candidate) => candidate.name === 'head');
    if (bone) {
      skinned = object;
      head = bone;
    }
  });
  if (!skinned || !head) return false;
  model.updateMatrixWorld(true);
  const index = skinned.skeleton.bones.indexOf(head);
  // Model space → the skinned mesh's space → bind space → the head bone's space.
  const meshInModel = new Matrix4().copy(model.matrixWorld).invert().multiply(skinned.matrixWorld);
  const local = new Matrix4().copy(skinned.skeleton.boneInverses[index]).multiply(skinned.bindMatrix).multiply(meshInModel.invert()).multiply(mask.matrixWorld);
  mask.removeFromParent();
  local.decompose(mask.position, mask.quaternion, mask.scale);
  head.add(mask);
  mask.traverse((object) => {
    if (!(object instanceof Mesh)) return;
    object.castShadow = true;
    object.receiveShadow = true;
  });
  return true;
}

/** Candy colours: bright wrappers and gummies. */
export const CANDY_COLORS = [0xff3b6b, 0xffd23a, 0x3ad1ff, 0x7dff5a, 0xb36bff, 0xff8a1f, 0xffffff].map((hex) => new Color(hex));
