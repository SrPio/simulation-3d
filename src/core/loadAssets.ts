import { BufferGeometry, Material, Mesh, Object3D, Skeleton, SkinnedMesh, Texture } from 'three';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';

export const modelVersions = {
  v1: {
    label: 'V1 Original',
    file: 'models/developer.glb',
    revision: 'V1 / ORIGINAL',
    status: 'V1 original conservada',
    stage: 'V1 CONSERVADA',
    copy: 'V1 original conservada sin cambios. Continuamos desde V1 con rig y ciclos en el sitio. V2 es opcional.',
  },
  v1rig: {
    label: 'V1 Animada',
    file: 'models/developer-v1-rig.glb',
    revision: 'V1 / FASE 2A',
    status: 'V1 Animada · Fase 2A',
    stage: 'FASE 2A',
    copy: 'Fase 2A · Rig y ciclos en el sitio: reposo, caminar y correr. Sin objetos ni gameplay. Sentarse y usar el portátil vendrán después.',
  },
  v2: {
    label: 'V2 Model sheet',
    file: 'models/developer-v2.glb',
    revision: 'V2 / ESTUDIO ANTERIOR',
    status: 'V2 estudio anterior inacabado',
    stage: 'V2 CONSERVADA',
    copy: 'V2 Model sheet · Estudio anterior inacabado de silueta y proporciones, conservado sin cambios.',
  },
  v4: {
    label: 'V4 Pulida',
    file: 'models/developer-v4.glb',
    revision: 'V4 / REFERENCIA',
    status: 'V4 pulida · fiel a la referencia',
    stage: 'V4 PULIDA',
    copy: 'V4 Pulida · Modelo independiente fiel a las fotos de referencia: rostro, barba, gorra, sudadera y zapatillas detallados. La versión con rig es V4 Animada.',
  },
  v4rig: {
    label: 'V4 Animada',
    file: 'models/developer-v4-interactions.glb',
    revision: 'V4 / RIG + ASIENTOS',
    status: 'V4 Animada · rig, ciclos y asientos',
    stage: 'V4 RIG',
    copy: 'V4 Animada · Reposo, caminar, correr y saltar, más sentarse, portátil y escribir en silla y cama. En Habitación se coloca en el asiento de cada clip.',
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

/** Bytes received and expected so far for one file (the expected size is an estimate when the server compresses). */
export type LoadProgress = (loaded: number, total: number) => void;

/** Rough sizes of the room page's files, for the loading line when the response has no usable Content-Length. */
export const EXPECTED_BYTES: Record<string, number> = {
  'models/developer-v4-interactions.glb': 6_300_000,
  'models/room.glb': 1_220_000,
  'models/laptop.glb': 24_000,
  'models/outside.glb': 880_000,
  'models/circuit.glb': 300_000,
  'models/colombia.glb': 153_000,
  'models/boxing.glb': 155_000,
  'models/univalle.glb': 29_000,
};

export async function loadCharacter(modelId: ModelVersionId, signal: AbortSignal, progress?: LoadProgress): Promise<GLTF> {
  if (!isModelVersionId(modelId)) throw new Error('MODEL_VERSION_INVALID');
  return loadGlb(modelVersions[modelId].file, 'MODEL', signal, progress);
}

export function loadRoom(signal: AbortSignal, progress?: LoadProgress): Promise<GLTF> {
  return loadGlb(roomFile, 'ROOM', signal, progress);
}

export const laptopFile = 'models/laptop.glb';

/** The laptop model, shown on the desk and on the lap. Its failures are reported as room failures. */
export function loadLaptop(signal: AbortSignal, progress?: LoadProgress): Promise<GLTF> {
  return loadGlb(laptopFile, 'ROOM', signal, progress);
}

export const outsideFile = 'models/outside.glb';

/** Signs, name letters and walkable bounds outside the room. Its failures are reported as room failures. */
export function loadOutside(signal: AbortSignal, progress?: LoadProgress): Promise<GLTF> {
  return loadGlb(outsideFile, 'ROOM', signal, progress);
}

export const circuitFile = 'models/circuit.glb';

/** The circuit's office chair, ramps, obstacles and fences, read together with the outside. Failures count as room failures. */
export function loadCircuit(signal: AbortSignal, progress?: LoadProgress): Promise<GLTF> {
  return loadGlb(circuitFile, 'ROOM', signal, progress);
}

export const colombiaFile = 'models/colombia.glb';

/** The about-me plaza's Colombian corner (hat, cup, pin and flag), read together with the outside. Failures count as room failures. */
export function loadColombia(signal: AbortSignal, progress?: LoadProgress): Promise<GLTF> {
  return loadGlb(colombiaFile, 'ROOM', signal, progress);
}

export const boxingFile = 'models/boxing.glb';

/** The playground's boxing corner (the gantry and the JS and TS punching bags), read together with the outside. Failures count as room failures. */
export function loadBoxing(signal: AbortSignal, progress?: LoadProgress): Promise<GLTF> {
  return loadGlb(boxingFile, 'ROOM', signal, progress);
}

export const univalleFile = 'models/univalle.glb';

/** The about-me plaza's Universidad del Valle logo on its base, read together with the outside. Failures count as room failures. */
export function loadUnivalle(signal: AbortSignal, progress?: LoadProgress): Promise<GLTF> {
  return loadGlb(univalleFile, 'ROOM', signal, progress);
}

export const chickFile = 'models/chick.glb';

/** The chick in sunglasses that rains down with the Konami code: fetched only the first time the code is typed. */
export function loadChick(signal: AbortSignal): Promise<GLTF> {
  return loadGlb(chickFile, 'ROOM', signal);
}

/** The body as it arrives, reporting the bytes so far (the loading screen draws its line with them). */
async function readBody(response: Response, file: string, progress?: LoadProgress): Promise<ArrayBuffer> {
  if (!progress || !response.body) return response.arrayBuffer();
  // A compressed response's Content-Length counts the compressed bytes, not the ones the reader hands over.
  const length = response.headers.get('content-encoding') ? 0 : Number(response.headers.get('content-length') ?? 0);
  let total = length > 0 ? length : EXPECTED_BYTES[file] ?? 1_000_000;
  const parts: Uint8Array[] = [];
  let loaded = 0;
  const reader = response.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
    loaded += value.byteLength;
    total = Math.max(total, loaded);
    progress(loaded, total);
  }
  progress(loaded, loaded);
  const data = new Uint8Array(loaded);
  let offset = 0;
  for (const part of parts) {
    data.set(part, offset);
    offset += part.byteLength;
  }
  return data.buffer;
}

async function loadGlb(file: string, kind: 'MODEL' | 'ROOM', signal: AbortSignal, progress?: LoadProgress): Promise<GLTF> {
  signal.throwIfAborted();
  const url = new URL(`${import.meta.env.BASE_URL}${file}`, window.location.href);
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`${kind}_HTTP_${response.status}`);
  const data = await readBody(response, file, progress);
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
