import { Matrix4, Mesh, SkinnedMesh, type BufferGeometry, type Material, type Object3D } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * Merge every static (non-skinned) mesh under `root` that shares a material into one mesh, baking
 * transforms relative to `root`. The room has ~180 small pieces; a draw call per material renders it identically
 * for a fraction of the CPU/driver cost, in both the colour and the shadow pass.
 * Non-mesh nodes (anchors, colliders, light markers) are left untouched.
 */
export function mergeStaticMeshes(root: Object3D): { before: number; after: number } {
  root.updateMatrixWorld(true);
  const toRoot = root.matrixWorld.clone().invert();
  type Group = { material: Material; geometries: BufferGeometry[]; meshes: Mesh[] };
  const groups = new Map<string, Group>();
  root.traverse((object) => {
    if (!(object instanceof Mesh) || (object as { isSkinnedMesh?: boolean }).isSkinnedMesh || Array.isArray(object.material)) return;
    const geometry = object.geometry as BufferGeometry;
    const attributes = Object.keys(geometry.attributes).sort().join(',');
    const key = `${object.material.uuid}|${attributes}|${geometry.index ? 'i' : 'n'}`;
    const group: Group = groups.get(key) ?? { material: object.material, geometries: [], meshes: [] };
    group.geometries.push(geometry.clone().applyMatrix4(new Matrix4().multiplyMatrices(toRoot, object.matrixWorld)));
    group.meshes.push(object);
    groups.set(key, group);
  });
  const before = [...groups.values()].reduce((sum, group) => sum + group.meshes.length, 0);
  let after = 0;
  for (const { material, geometries, meshes } of groups.values()) {
    const merged = meshes.length > 1 ? mergeGeometries(geometries, false) : null;
    if (!merged) {
      geometries.forEach((geometry) => geometry.dispose());
      after += meshes.length;
      continue;
    }
    const mesh = new Mesh(merged, material);
    mesh.name = `Merged_${material.name || 'material'}`;
    mesh.castShadow = meshes.some((item) => item.castShadow);
    mesh.receiveShadow = meshes.some((item) => item.receiveShadow);
    root.add(mesh);
    for (const item of meshes) {
      item.removeFromParent();
      item.geometry.dispose();
    }
    geometries.forEach((geometry) => geometry.dispose());
    after += 1;
  }
  return { before, after };
}

/**
 * Merge skinned meshes that share a skeleton, bind matrix, transform and material. The rigged
 * characters export one mesh per part (~44); merged they deform identically with a few draw calls.
 */
export function mergeSkinnedMeshes(root: Object3D): { before: number; after: number } {
  root.updateMatrixWorld(true);
  type Group = { material: Material; geometries: BufferGeometry[]; meshes: SkinnedMesh[] };
  const groups = new Map<string, Group>();
  const signature = (matrix: Matrix4) => matrix.elements.map((value) => value.toFixed(5)).join(',');
  let before = 0;
  root.traverse((object) => {
    if (!(object instanceof SkinnedMesh) || Array.isArray(object.material) || object.morphTargetInfluences) return;
    before++;
    const geometry = object.geometry as BufferGeometry;
    const attributes = Object.keys(geometry.attributes).sort().join(',');
    const key = [object.skeleton.uuid, object.material.uuid, attributes, geometry.index ? 'i' : 'n',
      signature(object.bindMatrix), signature(object.matrixWorld), object.parent?.uuid].join('|');
    const group: Group = groups.get(key) ?? { material: object.material, geometries: [], meshes: [] };
    group.geometries.push(geometry);
    group.meshes.push(object);
    groups.set(key, group);
  });
  let after = 0;
  for (const { material, geometries, meshes } of groups.values()) {
    const merged = meshes.length > 1 ? mergeGeometries(geometries, false) : null;
    if (!merged) {
      after += meshes.length;
      continue;
    }
    const [first] = meshes;
    const mesh = new SkinnedMesh(merged, material);
    mesh.name = `Merged_${material.name || 'skin'}`;
    mesh.position.copy(first.position);
    mesh.quaternion.copy(first.quaternion);
    mesh.scale.copy(first.scale);
    mesh.bind(first.skeleton, first.bindMatrix);
    first.parent!.add(mesh);
    for (const item of meshes) {
      item.removeFromParent();
      item.geometry.dispose();
    }
    after += 1;
  }
  return { before, after };
}
