import {
  AnimationMixer, Box3, CircleGeometry, Color, DirectionalLight, Group, HemisphereLight, InstancedMesh, LoopRepeat, PointLight,
  Mesh, MeshStandardMaterial, OrthographicCamera, Quaternion, Scene, SkinnedMesh, Vector3, type AnimationAction, type Object3D,
  type WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createRenderer, MAX_PIXEL_RATIO } from '../core/renderer';
import { mergeSkinnedMeshes, mergeStaticMeshes } from '../scene/mergeStatic.ts';
import { CharacterController, type Locomotion } from '../character/CharacterController';
import { KeyboardInput } from '../input/KeyboardInput';
import type { Box2 } from '../world/collisions';
import { disposeObjects, loadCharacter, loadRoom, modelVersions, roomFile, type ModelVersionId, type SceneId } from '../core/loadAssets';

export type ViewPreset = 'front' | 'left' | 'right' | 'back' | 'three-quarter';
export type LightPreset = 'neutral' | 'violet';
export type MovementState = 'ready' | 'unavailable' | 'seated';
export type ViewerStatus = { kind: 'loading' | 'ready' | 'error'; title: string; detail: string };
export type ModelStats = { meshes: number; triangles: number };
export type AnimationState = {
  clips: string[];
  clip: string;
  playing: boolean;
  speed: number;
  time: number;
  duration: number;
};

type ViewerOptions = {
  modelId: ModelVersionId;
  view: ViewPreset;
  light: LightPreset;
  wireframe: boolean;
  scene?: SceneId;
};

// Isometric diorama: the camera stays on the open side of the two room walls.
const ROOM_AZIMUTH = [0.14, Math.PI / 2 - 0.14] as const;
const ROOM_POLAR = [0.72, 1.22] as const;
const ROOM_VIEW = new Vector3(1, 0.95, 1);

type ViewerEvents = {
  status: (status: ViewerStatus) => void;
  stats: (stats: ModelStats | null) => void;
  orbit: () => void;
  animation: (state: AnimationState | null) => void;
  movement?: (state: MovementState | null) => void;
};

const LOCOMOTION = new Set(['idle', 'walk', 'run']);
const SHADOWLESS = /^(FloorPlank|Platform|Wall|Baseboard|Poster|NightCity|WindowGlass)/;

export class CharacterViewer {
  private readonly scene = new Scene();
  private readonly camera = new OrthographicCamera(-2, 2, 2, -2, 0.01, 100);
  private readonly abort = new AbortController();
  private readonly key = new DirectionalLight(0xfff2e5, 3.4);
  private readonly fill = new DirectionalLight(0xdbe4ff, 2.3);
  private readonly rim = new DirectionalLight(0xe0d1ff, 3);
  private readonly ambient = new HemisphereLight(0xf2edff, 0x82768f, 2.2);
  private renderer?: WebGLRenderer;
  private controls?: OrbitControls;
  private observer?: ResizeObserver;
  private model?: Group;
  private assetRoots: Group[] = [];
  private floor?: Mesh<CircleGeometry, MeshStandardMaterial>;
  private room?: Group;
  private readonly roomLights: PointLight[] = [];
  private readonly standPoints = new Map<string, { position: Vector3; quaternion: Quaternion }>();
  private controller?: CharacterController;
  private keyboard?: KeyboardInput;
  /** True while keyboard movement owns the clip choice; a clip picked by hand is left alone otherwise. */
  private driving = false;
  private movementState: MovementState | null = null;
  /** Adaptive resolution: drop the pixel ratio when frames are slow (fill-rate bound), raise it back when there is headroom. */
  private pixelRatio = Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO);
  private frameAverage = 1000 / 60;
  private framesSinceAdjust = 0;
  private readonly bounds = new Vector3(1, 2.5, 1);
  private readonly center = new Vector3(0, 1.25, 0);
  private cameraDistance = 7;
  private disposed = false;
  private contextLost = false;
  private ready = false;
  private wireframe = false;
  private mixer?: AnimationMixer;
  private readonly actions = new Map<string, AnimationAction>();
  private activeClip = '';
  private playing = true;
  private speed = 1;
  private lastFrame?: number;
  private fadeRemaining = 0;

  constructor(
    private readonly host: HTMLElement,
    private readonly events: ViewerEvents,
    private readonly options: ViewerOptions,
  ) {
    this.wireframe = options.wireframe;
    const version = modelVersions[options.modelId];
    this.events.status({ kind: 'loading', title: `Cargando ${version.label}`, detail: `Preparando ${version.file}. ${version.copy}` });
    this.events.stats(null);
    this.events.animation(null);
    try {
      document.addEventListener('visibilitychange', this.resetDelta, { signal: this.abort.signal });
      if (this.inRoom) this.keyboard = new KeyboardInput(window, this.abort.signal);
      this.renderer = createRenderer();
      this.host.append(this.renderer.domElement);
      this.renderer.domElement.addEventListener('webglcontextlost', this.onContextLost);
      this.renderer.domElement.addEventListener('webglcontextrestored', this.onContextRestored);
      this.controls = new OrbitControls(this.camera, this.renderer.domElement);
      this.controls.enablePan = false;
      this.controls.enableDamping = true;
      this.controls.dampingFactor = 0.08;
      this.controls.minZoom = 0.65;
      this.controls.maxZoom = 2.4;
      this.controls.minPolarAngle = 0.12;
      this.controls.maxPolarAngle = Math.PI / 2 + 0.12;
      if (this.inRoom) {
        [this.controls.minAzimuthAngle, this.controls.maxAzimuthAngle] = ROOM_AZIMUTH;
        [this.controls.minPolarAngle, this.controls.maxPolarAngle] = ROOM_POLAR;
        this.controls.minZoom = 0.9;
        this.controls.maxZoom = 3.2;
      }
      this.controls.enabled = false;
      this.controls.addEventListener('start', this.onOrbit);
      this.configureLights();
      this.setView(this.options.view);
      this.setLight(this.options.light);
      this.observer = new ResizeObserver(this.resize);
      this.observer.observe(this.host);
      this.resize();
      this.renderer.setAnimationLoop(this.animate);
      void this.load();
    } catch (error) {
      this.dispose();
      const unavailable = error instanceof Error && error.message === 'WEBGL_UNAVAILABLE';
      this.events.status({
        kind: 'error',
        title: unavailable ? 'WebGL 2 no está disponible' : 'No se pudo iniciar el visor',
        detail: unavailable
          ? 'Activa la aceleración gráfica o abre este estudio en un navegador compatible. Después, vuelve a intentarlo.'
          : 'El estudio no pudo crear el contexto gráfico. Puedes volver a intentarlo.',
      });
    }
  }

  private configureLights(): void {
    this.key.position.set(3, 6, 5);
    this.key.castShadow = true;
    this.key.shadow.mapSize.set(2048, 2048);
    this.key.shadow.normalBias = 0.018;
    this.key.shadow.bias = -0.00015;
    this.key.shadow.radius = 4;
    this.fill.position.set(-4, 3, 3);
    this.rim.position.set(2, 5, -4);
    this.scene.add(this.key, this.fill, this.rim, this.ambient);
    this.scene.add(this.key.target, this.fill.target, this.rim.target);
  }

  private get inRoom(): boolean {
    return this.options.scene === 'room';
  }

  private async load(): Promise<void> {
    try {
      const [gltf, roomGltf] = await Promise.all([
        loadCharacter(this.options.modelId, this.abort.signal),
        this.inRoom ? loadRoom(this.abort.signal) : Promise.resolve(undefined),
      ]);
      if (this.disposed) {
        disposeObjects([...gltf.scenes, ...(roomGltf?.scenes ?? [])]);
        return;
      }
      this.assetRoots = [...gltf.scenes, ...(roomGltf?.scenes ?? [])];
      this.model = gltf.scene;
      if (roomGltf) {
        this.placeInRoom(roomGltf.scene);
        // Everything receives shadows; only furniture casts them. Floor, walls, posters and the
        // window backdrop cannot shadow anything visible, so they stay out of the shadow pass.
        roomGltf.scene.traverse((object) => {
          if (!(object instanceof Mesh)) return;
          object.receiveShadow = true;
          object.castShadow = !SHADOWLESS.test(object.name);
        });
        mergeStaticMeshes(roomGltf.scene);
      }
      // Fewer draw calls: static and skinned parts are merged by material (they render identically).
      mergeStaticMeshes(this.model);
      mergeSkinnedMeshes(this.model);
      if (gltf.animations.length) {
        this.mixer = new AnimationMixer(this.model);
        for (const [index, clip] of gltf.animations.entries()) {
          const name = clip.name || `Clip ${index + 1}`;
          const key = this.actions.has(name) ? `${name} (${index + 1})` : name;
          this.actions.set(key, this.mixer.clipAction(clip).setLoop(LoopRepeat, Infinity));
        }
        const names = [...this.actions.keys()];
        this.selectClip(names.find((name) => name.toLowerCase() === 'idle') ?? names[0]);
        this.model.updateMatrixWorld(true);
      }
      const box = new Box3().setFromObject(this.model, true);
      if (box.isEmpty() || ![...box.min.toArray(), ...box.max.toArray()].every(Number.isFinite)) {
        throw new Error('MODEL_EMPTY');
      }
      if (this.room) box.setFromObject(this.room, true);
      box.getSize(this.bounds);
      box.getCenter(this.center);
      if (this.bounds.length() <= 0) throw new Error('MODEL_EMPTY');
      const stats: ModelStats = { meshes: 0, triangles: 0 };
      const count = (object: Object3D) => {
        if (!(object instanceof Mesh)) return;
        if (!this.room || !this.isInRoom(object)) {
          object.castShadow = true; // room pieces got their shadow flags before merging
          object.receiveShadow = true;
        }
        if (object instanceof SkinnedMesh && this.mixer) object.frustumCulled = false;
        stats.meshes += 1;
        const geometry = object.geometry;
        const count = geometry.index?.count ?? geometry.getAttribute('position')?.count ?? 0;
        const start = geometry.drawRange.start;
        const drawn = Math.max(0, Math.min(count - start, geometry.drawRange.count));
        stats.triangles += Math.floor(drawn / 3) * (object instanceof InstancedMesh ? object.count : 1);
      };
      this.model.traverse(count);
      if (stats.meshes === 0 || stats.triangles === 0) throw new Error('MODEL_EMPTY');
      this.room?.traverse(count);
      this.scene.add(this.model);
      if (this.room) this.scene.add(this.room);
      else this.createFloor(this.mixer ? 0 : box.min.y);
      this.frameLights();
      this.cameraDistance = Math.max(this.bounds.length() * 2.5, 1);
      this.camera.far = this.cameraDistance * 10;
      this.camera.near = this.cameraDistance / 1000;
      this.setView(this.options.view);
      this.setLight(this.options.light);
      this.setWireframe(this.wireframe);
      this.resize();
      this.ready = true;
      if (this.controls) this.controls.enabled = !this.contextLost;
      this.events.stats(stats);
      if (!this.contextLost) this.showReady();
    } catch (error) {
      if (this.disposed || this.abort.signal.aborted) return;
      this.dispose();
      this.events.stats(null);
      const message = error instanceof Error ? error.message : '';
      if (message.startsWith('ROOM_')) {
        this.events.status({
          kind: 'error',
          title: 'No se pudo cargar la habitación',
          detail: message === 'ROOM_HTTP_404'
            ? `Falta el archivo ${roomFile}. Genera la habitación y vuelve a intentarlo, o vuelve al estudio.`
            : `El archivo ${roomFile} no está disponible o no es un GLB válido. Vuelve a intentarlo, o vuelve al estudio.`,
        });
        return;
      }
      this.events.status({
        kind: 'error',
        title: `No se pudo cargar ${modelVersions[this.options.modelId].label}`,
        detail: message === 'MODEL_HTTP_404'
          ? `Falta el archivo ${modelVersions[this.options.modelId].file}. Añade el modelo y vuelve a intentarlo, o selecciona otra versión.`
          : `El archivo ${modelVersions[this.options.modelId].file} no está disponible o no es un GLB válido. Comprueba el modelo y vuelve a intentarlo, o selecciona otra versión.`,
      });
    }
  }

  /** Puts the character on the room's Spawn anchor and turns the Light_* anchors into point lights. */
  private placeInRoom(room: Group): void {
    this.room = room;
    room.updateMatrixWorld(true);
    // Stand points: the spawn, and for each seat the spot in front of it where its clips start.
    // Seat anchors carry stand_offset: the clips move the hips that far back onto the seat.
    room.traverse((object) => {
      const data = object.userData as { seat?: string; stand_offset?: number };
      const key = object.name === 'Spawn' ? 'spawn' : data.stand_offset !== undefined ? data.seat : undefined;
      if (!key) return;
      const quaternion = object.getWorldQuaternion(new Quaternion());
      const position = object.getWorldPosition(new Vector3()).setY(0);
      position.add(new Vector3(0, 0, data.stand_offset ?? 0).applyQuaternion(quaternion));
      this.standPoints.set(key, { position, quaternion });
    });
    const boxes: Box2[] = [];
    room.traverse((object) => {
      const data = object.userData as { collider?: string; size?: number[] };
      if (data.collider !== 'box' || !data.size) return;
      const centre = object.getWorldPosition(new Vector3());
      // Sizes are stored in Blender axes: X stays X, Blender Y becomes three.js -Z.
      const [sx, sy] = data.size;
      boxes.push({ name: object.name, minX: centre.x - sx / 2, maxX: centre.x + sx / 2, minZ: centre.z - sy / 2, maxZ: centre.z + sy / 2 });
    });
    const spawn = this.standPoints.get('spawn');
    if (spawn) {
      const facing = new Vector3(0, 0, 1).applyQuaternion(spawn.quaternion);
      const halfSize = Number(room.getObjectByName('Room')?.userData.half_size ?? 2.9);
      this.controller = new CharacterController({ position: { x: spawn.position.x, z: spawn.position.z }, yaw: Math.atan2(facing.x, facing.z) }, boxes, halfSize);
    }
    this.placeForClip('');
    room.traverse((object) => {
      const data = object.userData as { light?: string; color?: number[]; intensity?: number };
      if (data.light !== 'point' || !data.color) return;
      const light = new PointLight(new Color().setRGB(data.color[0], data.color[1], data.color[2]), (data.intensity ?? 1) * 1.6, 6.5, 1.6);
      light.name = `${object.name}_Point`;
      object.getWorldPosition(light.position);
      this.roomLights.push(light);
      this.scene.add(light);
    });
  }

  private placeForClip(clip: string): void {
    if (!this.room || !this.model) return;
    const seat = clip.endsWith('_chair') ? 'chair' : clip.endsWith('_bed') ? 'bed' : 'spawn';
    const point = this.standPoints.get(seat) ?? this.standPoints.get('spawn');
    if (seat === 'spawn' && this.controller) {
      this.applyController();
    } else if (point) {
      this.model.position.copy(point.position);
      this.model.quaternion.copy(point.quaternion);
    }
    this.host.dataset.seat = seat;
  }

  private isInRoom(object: Object3D): boolean {
    for (let node: Object3D | null = object; node; node = node.parent) if (node === this.room) return true;
    return false;
  }

  private applyController(): void {
    if (!this.model || !this.controller) return;
    this.model.position.set(this.controller.position.x, 0, this.controller.position.z);
    this.model.quaternion.setFromAxisAngle(new Vector3(0, 1, 0), this.controller.yaw);
    const position = `${this.controller.position.x.toFixed(2)},${this.controller.position.z.toFixed(2)}`;
    if (this.host.dataset.position !== position) this.host.dataset.position = position;
  }

  private setMovement(state: MovementState | null): void {
    if (state === this.movementState) return;
    this.movementState = state;
    this.host.dataset.movement = state ?? 'none';
    this.events.movement?.(state);
  }

  /** Back to the spawn point, standing idle. */
  resetPosition(): void {
    if (!this.controller || this.disposed) return;
    this.controller.reset();
    this.driving = false;
    this.keyboard?.clear();
    if (this.actions.has('idle')) this.selectClip('idle');
    this.placeForClip(this.activeClip);
    this.host.dataset.locomotion = 'idle';
  }

  /** Keyboard locomotion for the room: camera-relative movement with colliders and matched clip rates. */
  private drive(delta: number): void {
    if (!this.controller || !this.controls) return;
    if (!this.mixer || !this.actions.has('walk') || !this.actions.has('idle')) {
      this.setMovement('unavailable');
      return;
    }
    if (!LOCOMOTION.has(this.activeClip)) {
      this.setMovement('seated');
      return;
    }
    this.setMovement('ready');
    const keys = this.keyboard?.active ?? false;
    if (!keys && !this.driving) return;
    if (keys && !this.driving) {
      this.driving = true;
      if (!this.playing) this.setPlaying(true);
    }
    const mode: Locomotion = this.controller.update(delta, this.keyboard!.intent, this.controls.getAzimuthalAngle());
    const clip = this.actions.has(mode) ? mode : 'walk';
    if (clip !== this.activeClip) this.selectClip(clip);
    if (this.fadeRemaining <= 0) this.actions.get(clip)?.setEffectiveTimeScale(this.controller.clipRate());
    this.applyController();
    this.host.dataset.locomotion = mode;
    if (!keys && mode === 'idle') this.driving = false;
  }

  private createFloor(y: number): void {
    const radius = Math.max(Math.hypot(this.bounds.x, this.bounds.z) * 0.85, this.bounds.y * 0.48);
    this.floor = new Mesh(
      new CircleGeometry(radius, 96),
      new MeshStandardMaterial({ color: 0x302839, roughness: 0.96, metalness: 0 }),
    );
    this.floor.name = 'PresentationFloor';
    this.floor.rotation.x = -Math.PI / 2;
    this.floor.position.set(this.center.x, y - 0.008, this.center.z);
    this.floor.receiveShadow = true;
    this.scene.add(this.floor);
  }

  private frameLights(): void {
    const size = Math.max(this.bounds.length(), 1);
    this.key.position.copy(this.center).add(new Vector3(1.2, 2, 1.8).multiplyScalar(size));
    this.fill.position.copy(this.center).add(new Vector3(-1.5, 1, 1.2).multiplyScalar(size));
    this.rim.position.copy(this.center).add(new Vector3(1, 1.6, -1.5).multiplyScalar(size));
    for (const light of [this.key, this.fill, this.rim]) light.target.position.copy(this.center);
    const shadow = this.key.shadow.camera;
    shadow.left = shadow.bottom = -size;
    shadow.right = shadow.top = size;
    shadow.near = 0.1;
    shadow.far = size * 8;
    shadow.updateProjectionMatrix();
  }

  setView(preset: ViewPreset): void {
    const directions: Record<ViewPreset, Vector3> = {
      front: new Vector3(0, 0.04, 1),
      left: new Vector3(1, 0.04, 0),
      right: new Vector3(-1, 0.04, 0),
      back: new Vector3(0, 0.04, -1),
      'three-quarter': new Vector3(0.8, 0.2, 1),
    };
    if (this.inRoom) {
      // Isometric diorama angles; presets that would look through a wall fall back to the corner view.
      directions.front = new Vector3(0.35, 0.95, 1);
      directions.left = new Vector3(1, 0.95, 0.35);
      directions.right = directions.back = directions['three-quarter'] = ROOM_VIEW.clone();
    }
    const damping = this.controls?.enableDamping;
    if (this.controls) {
      this.controls.enableDamping = false;
      this.controls.update();
      this.controls.target.copy(this.center);
    }
    this.camera.position.copy(this.center).add(directions[preset].normalize().multiplyScalar(this.cameraDistance));
    this.camera.zoom = 1;
    this.camera.lookAt(this.center);
    this.camera.updateProjectionMatrix();
    this.controls?.update();
    if (this.controls) this.controls.enableDamping = damping ?? true;
  }

  zoom(factor: number): void {
    if (!this.ready || this.contextLost || !this.controls) return;
    this.camera.zoom = Math.min(this.controls.maxZoom, Math.max(this.controls.minZoom, this.camera.zoom * factor));
    this.camera.updateProjectionMatrix();
    this.controls.update();
  }

  setLight(preset: LightPreset): void {
    const violet = preset === 'violet';
    if (this.inRoom) {
      // Night mood comes from the room's own lamp, LED and screen lights; the studio rig only fills in.
      this.key.color.set(violet ? 0x9d82ff : 0xfff0e0);
      this.key.intensity = violet ? 0.55 : 1.8;
      this.fill.color.set(violet ? 0x6f5bd6 : 0xdbe4ff);
      this.fill.intensity = violet ? 0.35 : 1.0;
      this.rim.intensity = 0;
      this.ambient.color.set(violet ? 0x7a5cc4 : 0xf2edff);
      this.ambient.intensity = violet ? 0.45 : 1.2;
      this.host.dataset.light = preset;
      return;
    }
    this.key.color.set(violet ? 0xc4a2ff : 0xfff2e5);
    this.key.intensity = violet ? 2.6 : 3.4;
    this.fill.color.set(violet ? 0x8c83ff : 0xdbe4ff);
    this.fill.intensity = violet ? 1.7 : 2.3;
    this.rim.color.set(violet ? 0xc244ff : 0xe0d1ff);
    this.rim.intensity = violet ? 5 : 3;
    this.ambient.color.set(violet ? 0x9e7bd4 : 0xf2edff);
    this.ambient.intensity = violet ? 1.1 : 2.2;
    this.host.dataset.light = preset;
    if (this.floor) this.floor.material.color.copy(new Color(violet ? 0x362942 : 0x302839));
  }

  setWireframe(enabled: boolean): void {
    this.wireframe = enabled;
    const apply = (object: Object3D) => {
      if (!(object instanceof Mesh)) return;
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
        if ('wireframe' in material) material.wireframe = enabled;
      }
    };
    this.model?.traverse(apply);
    this.room?.traverse(apply);
    this.host.dataset.wireframe = String(enabled);
  }

  selectClip(name: string): void {
    const action = this.actions.get(name);
    if (!action || !this.mixer || this.disposed || name === this.activeClip) return;
    const previous = this.actions.get(this.activeClip);
    this.finishFade();
    this.activeClip = name;
    const seat = (clip: string) => clip.match(/_(chair|bed)$/)?.[1] ?? 'spawn';
    const moved = !!this.room && seat(name) !== seat(previous?.getClip().name ?? '');
    this.placeForClip(name);
    action.reset().setEffectiveTimeScale(1).setEffectiveWeight(1).play();
    if (previous && this.playing && !moved) {
      action.crossFadeFrom(previous, 0.2, false);
      this.fadeRemaining = 0.2;
    } else {
      previous?.stop();
    }
    this.resetDelta();
    this.mixer.update(0);
    this.emitAnimation();
  }

  setPlaying(playing: boolean): void {
    if (!this.mixer || this.disposed) return;
    this.playing = playing;
    this.resetDelta();
    this.emitAnimation();
  }

  setAnimationSpeed(speed: number): void {
    if (!this.mixer || this.disposed || ![0.25, 0.5, 1].includes(speed)) return;
    this.speed = speed;
    this.mixer.timeScale = speed;
    this.resetDelta();
    this.emitAnimation();
  }

  scrub(progress: number): void {
    const action = this.actions.get(this.activeClip);
    if (!action || !this.mixer || this.disposed || !Number.isFinite(progress)) return;
    this.playing = false;
    this.finishFade();
    action.time = Math.max(0, Math.min(1000, progress)) / 1000 * action.getClip().duration;
    this.resetDelta();
    this.mixer.update(0);
    this.model?.updateMatrixWorld(true);
    this.emitAnimation();
  }

  private finishFade(): void {
    for (const [name, action] of this.actions) {
      action.stopFading().stopWarping();
      if (name !== this.activeClip) action.stop();
      else action.enabled = true;
    }
    this.actions.get(this.activeClip)?.setEffectiveWeight(1).setEffectiveTimeScale(1);
    this.fadeRemaining = 0;
  }

  private emitAnimation(): void {
    const action = this.actions.get(this.activeClip);
    this.events.animation(action ? {
      clips: [...this.actions.keys()], clip: this.activeClip, playing: this.playing,
      speed: this.speed, time: action.time, duration: action.getClip().duration,
    } : null);
  }

  private readonly resetDelta = (): void => {
    this.lastFrame = undefined;
  };

  /** Frame the whole room box as seen from the isometric corner view, with a small margin. */
  private roomSpan(aspect: number): number {
    const view = ROOM_VIEW.clone().normalize();
    const right = new Vector3(0, 1, 0).cross(view).normalize();
    const up = view.clone().cross(right);
    let width = 0;
    let height = 0;
    for (const sx of [-0.5, 0.5]) for (const sy of [-0.5, 0.5]) for (const sz of [-0.5, 0.5]) {
      const corner = new Vector3(sx * this.bounds.x, sy * this.bounds.y, sz * this.bounds.z);
      width = Math.max(width, Math.abs(corner.dot(right)) * 2);
      height = Math.max(height, Math.abs(corner.dot(up)) * 2);
    }
    return Math.max(height, width / aspect, 0.1) * 1.06;
  }

  private readonly resize = (): void => {
    if (this.disposed || !this.renderer) return;
    const width = Math.max(this.host.clientWidth, 1);
    const height = Math.max(this.host.clientHeight, 1);
    const aspect = width / height;
    const span = this.room
      ? this.roomSpan(aspect)
      : Math.max(this.bounds.y * 1.42, Math.hypot(this.bounds.x, this.bounds.z) * 1.45 / aspect, 0.1);
    this.camera.left = -span * aspect / 2;
    this.camera.right = span * aspect / 2;
    this.camera.top = span / 2;
    this.camera.bottom = -span / 2;
    this.camera.updateProjectionMatrix();
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.setSize(width, height, false);
    this.host.dataset.pixelRatio = this.pixelRatio.toFixed(2);
  };

  private readonly animate = (time: number): void => {
    if (this.disposed || this.contextLost || !this.renderer || document.hidden) {
      this.resetDelta();
      return;
    }
    const frame = this.lastFrame === undefined ? undefined : time - this.lastFrame;
    const delta = frame === undefined ? 0 : Math.min(Math.max(frame / 1000, 0), 0.05);
    this.lastFrame = time;
    if (frame !== undefined) this.adaptResolution(frame);
    if (this.ready && this.room) this.drive(delta);
    if (this.ready && this.mixer && this.playing) {
      this.mixer.update(delta);
      if (this.fadeRemaining > 0) {
        this.fadeRemaining -= delta * this.speed;
        if (this.fadeRemaining <= 0) this.finishFade();
      }
      this.emitAnimation();
    }
    this.controls?.update();
    this.renderer.render(this.scene, this.camera);
  };

  private adaptResolution(frame: number): void {
    if (frame > 250) return; // a stall (tab switch, GC) is not a steady frame rate
    this.frameAverage += (frame - this.frameAverage) * 0.05;
    if (++this.framesSinceAdjust < 90) return;
    const ceiling = Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO);
    let next = this.pixelRatio;
    if (this.frameAverage > 21 && this.pixelRatio > 1) next = Math.max(1, this.pixelRatio - 0.25);
    else if (this.frameAverage < 14 && this.pixelRatio < ceiling) next = Math.min(ceiling, this.pixelRatio + 0.25);
    this.framesSinceAdjust = 0;
    if (next === this.pixelRatio) return;
    this.pixelRatio = next;
    this.resize();
  }

  private readonly onOrbit = (): void => {
    this.events.orbit();
  };

  private readonly onContextLost = (event: Event): void => {
    event.preventDefault();
    if (this.disposed) return;
    this.contextLost = true;
    this.resetDelta();
    this.renderer?.setAnimationLoop(null);
    if (this.controls) this.controls.enabled = false;
    this.events.status({ kind: 'error', title: 'Se ha interrumpido el contexto gráfico', detail: 'Esperando a que se restablezca la GPU. También puedes reiniciar el visor con Volver a intentar.' });
  };

  private readonly onContextRestored = (): void => {
    if (this.disposed) return;
    this.contextLost = false;
    this.resetDelta();
    if (this.controls) this.controls.enabled = this.ready;
    this.renderer?.setAnimationLoop(this.animate);
    if (this.ready) this.showReady();
    else this.events.status({ kind: 'loading', title: `Cargando ${modelVersions[this.options.modelId].label}`, detail: `Contexto recuperado. Preparando ${modelVersions[this.options.modelId].file}.` });
  };

  private showReady(): void {
    const version = modelVersions[this.options.modelId];
    this.events.status({ kind: 'ready', title: version.status, detail: version.copy });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.abort.abort();
    this.observer?.disconnect();
    this.renderer?.setAnimationLoop(null);
    this.controls?.removeEventListener('start', this.onOrbit);
    this.controls?.dispose();
    this.resetDelta();
    this.mixer?.stopAllAction();
    if (this.model) this.mixer?.uncacheRoot(this.model);
    this.actions.clear();
    this.mixer = undefined;
    this.activeClip = '';
    this.events.animation(null);
    this.events.movement?.(null);
    disposeObjects([...this.assetRoots, this.scene]);
    this.key.shadow.dispose();
    this.fill.shadow.dispose();
    this.rim.shadow.dispose();
    this.scene.clear();
    this.assetRoots = [];
    if (this.renderer) {
      const canvas = this.renderer.domElement;
      canvas.removeEventListener('webglcontextlost', this.onContextLost);
      canvas.removeEventListener('webglcontextrestored', this.onContextRestored);
      this.renderer.dispose();
      this.renderer.forceContextLoss();
      canvas.remove();
    }
  }
}
