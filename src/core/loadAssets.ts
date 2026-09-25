import { BufferGeometry, Material, Mesh, Object3D, Skeleton, SkinnedMesh, Texture } from 'three';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';

export const modelVersions = {
  v1: {
    label: 'V1 Original',
    file: 'models/developer.glb',
    revision: 'V1 / ORIGINAL',
    status: 'V1 original conservada',
    stage: 'V1 CONSERVADA',
    copy: 'V1 original conservada sin cambios. Continuamos desde V1 con rig y ciclos en el sitio. V2 es opcional; V3 está PAUSADA.',
    paused: false,
  },
  v1rig: {
    label: 'V1 Animada',
    file: 'models/developer-v1-rig.glb',
    revision: 'V1 / FASE 2A',
    status: 'V1 Animada · Fase 2A',
    stage: 'FASE 2A',
    copy: 'Fase 2A · Rig y ciclos en el sitio: reposo, caminar y correr. Sin objetos ni gameplay. Sentarse y usar el portátil vendrán después.',
    paused: false,
  },
  v2: {
    label: 'V2 Model sheet',
    file: 'models/developer-v2.glb',
    revision: 'V2 / ESTUDIO ANTERIOR',
    status: 'V2 estudio anterior inacabado',
    stage: 'V2 CONSERVADA',
    copy: 'V2 Model sheet · Estudio anterior inacabado de silueta y proporciones, conservado sin cambios.',
    paused: false,
  },
  v3: {
    label: 'V3 Detallada · PAUSADA',
    file: 'models/developer-v3.glb',
    revision: 'V3 / PAUSADA',
    status: 'V3 PAUSADA',
    stage: 'V3 PAUSADA',
    copy: 'V3 está PAUSADA. No se carga ningún archivo de V3; continuamos el plan desde V1.',
    paused: true,
  },
  v4: {
    label: 'V4 Pulida',
    file: 'models/developer-v4.glb',
    revision: 'V4 / REFERENCIA',
    status: 'V4 pulida · fiel a la referencia',
    stage: 'V4 PULIDA',
    copy: 'V4 Pulida · Modelo independiente fiel a las fotos de referencia: rostro, barba, gorra, sudadera y zapatillas detallados. La versión con rig es V4 Animada.',
    paused: false,
  },
  v4rig: {
    label: 'V4 Animada',
    file: 'models/developer-v4-rig.glb',
    revision: 'V4 / RIG',
    status: 'V4 Animada · rig y ciclos',
    stage: 'V4 RIG',
    copy: 'V4 Animada · Copia con rig de V4: reposo, caminar y correr en el sitio. La V4 estática se conserva sin cambios.',
    paused: false,
  },
} as const;

export type ModelVersionId = keyof typeof modelVersions;
export const defaultModelVersion: ModelVersionId = 'v1';

export function isModelVersionId(value: string): value is ModelVersionId {
  return Object.prototype.hasOwnProperty.call(modelVersions, value);
}

export function disposeObjects(roots: Object3D[]): void {
  const geometries = new Set<BufferGeometry>();
  const materials = new Set<Material>();
  const textures = new Set<Texture>();
  const skeletons = new Set<Skeleton>();
  const bitmaps = new Set<ImageBitmap>();
  for (const root of roots) {
    root.traverse((object) => {
      if (!(object instanceof Mesh)) return;
      geometries.add(object.geometry);
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
        materials.add(material);
        for (const value of Object.values(material)) {
          if (value instanceof Texture) textures.add(value);
        }
      }
      if (object instanceof SkinnedMesh) skeletons.add(object.skeleton);
    });
  }
  for (const texture of textures) {
    const images: unknown[] = Array.isArray(texture.source.data) ? texture.source.data : [texture.source.data];
    for (const image of images) {
      if (typeof ImageBitmap !== 'undefined' && image instanceof ImageBitmap) bitmaps.add(image);
    }
    texture.dispose();
  }
  skeletons.forEach((skeleton) => skeleton.dispose());
  materials.forEach((material) => material.dispose());
  geometries.forEach((geometry) => geometry.dispose());
  bitmaps.forEach((bitmap) => bitmap.close());
}

export const roomFile = 'models/room.glb';
export type SceneId = 'studio' | 'room';

export async function loadCharacter(modelId: ModelVersionId, signal: AbortSignal): Promise<GLTF> {
  if (!isModelVersionId(modelId)) throw new Error('MODEL_VERSION_INVALID');
  if (modelVersions[modelId].paused) throw new Error('MODEL_VERSION_PAUSED');
  return loadGlb(modelVersions[modelId].file, 'MODEL', signal);
}

export function loadRoom(signal: AbortSignal): Promise<GLTF> {
  return loadGlb(roomFile, 'ROOM', signal);
}

async function loadGlb(file: string, kind: 'MODEL' | 'ROOM', signal: AbortSignal): Promise<GLTF> {
  signal.throwIfAborted();
  const url = new URL(`${import.meta.env.BASE_URL}${file}`, window.location.href);
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`${kind}_HTTP_${response.status}`);
  const data = await response.arrayBuffer();
  signal.throwIfAborted();
  if (data.byteLength < 12 || new DataView(data).getUint32(0, true) !== 0x46546c67) {
    throw new Error('MODEL_INVALID_GLB');
  }
  const gltf = await new GLTFLoader().parseAsync(data, new URL('.', url).href);
  if (signal.aborted) {
    disposeObjects(gltf.scenes);
    signal.throwIfAborted();
  }
  return gltf;
}
