import {
  AnimationMixer, Box3, CircleGeometry, Color, DirectionalLight, Group, HemisphereLight, InstancedMesh, LoopOnce, LoopRepeat, PointLight,
  Raycaster, RepeatWrapping, Vector2, type Texture,
  Matrix4, Mesh, MeshStandardMaterial, OrthographicCamera, Quaternion, Scene, SkinnedMesh, Vector3, type AnimationAction, type Object3D,
  type WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createRenderer } from '../core/renderer';
import { QUALITY, defaultQuality, nextPixelRatio, ratioRange, type QualityId } from '../core/quality.ts';
import { mergeSkinnedMeshes, mergeStaticMeshes } from '../scene/mergeStatic.ts';
import {
  CHARACTER_RADIUS, CLIP_ALTERNATIVES, CharacterController, DEFAULT_GAIT_CLIPS, JUMP, RUN_CLIP_SPEED, STRIKE_CHARGE, STRIKE_MIN_POWER, STRIKES,
  THROW_CLIP, THROW_HAND, THROW_RELEASE, WALK_CLIP_SPEED, throwDirection, throwSpeed, WALK_SPEED, strikeCharge, strikeLaunch, strikePower, type Gait, type Locomotion, type StrikeKind,
} from '../character/CharacterController';
import { getLanguage, onLanguage, t } from '../core/i18n.ts';
import { KeyboardInput, type HoldAction, type PressAction } from '../input/KeyboardInput';
import {
  EXPECTED_BYTES, circuitFile, colombiaFile, disposeObjects, loadColombia, laptopFile, loadCharacter, loadChick, loadCircuit, loadLaptop, loadOutside, loadRoom, modelVersions, outsideFile, roomFile,
  type ModelVersionId, type SceneId,
} from '../core/loadAssets';
import { DOWNLOAD_SHARE, ProgressMeter } from '../core/loadProgress.ts';
import { distanceGain, type SoundName, type Sounds } from '../audio/Sounds.ts';
import { pieceSound } from '../audio/pieceSounds.ts';
import { InteractionController } from '../interactions/InteractionController.ts';
import { readRoom, type RoomData } from '../scene/roomData.ts';
import { groundAt, readOutside, type OutsideData, type Piece, type Sign } from '../scene/outsideData.ts';
import { SignAreas, signText } from '../scene/SignAreas.ts';
import { FloorTexts } from '../scene/FloorTexts.ts';
import { Signpost } from '../scene/Signpost.ts';
import { SeatBubble } from '../scene/SeatBubble.ts';
import { ChargeMeter } from '../scene/ChargeMeter.ts';
import { InfiniteFloor } from '../scene/InfiniteFloor.ts';
import { BlobShadows } from '../scene/BlobShadows.ts';
import { PieceMeshes } from '../scene/PieceMeshes.ts';
import { AboutPlaza } from '../scene/AboutPlaza.ts';
import { TargetsView } from '../scene/TargetsView.ts';
import { CircuitView } from '../scene/CircuitView.ts';
import { DRIVE, NITRO, chairAt, driveStep, forwardSpeed, type ChairState } from '../world/chairDrive.ts';
import { applyLean, leanStep, leanTarget, restHand, restLean, solveArm, type Lean } from '../character/riderPose.ts';
import { SodaSpray } from '../scene/SodaSpray.ts';
import type { SeatSpot } from '../interactions/InteractionController.ts';
import type { FloorBlock } from '../scene/outsideData.ts';
import { RoomReveal } from '../scene/RoomReveal.ts';
import { Graffiti } from '../scene/Graffiti.ts';
import { GRAFFITI } from '../scene/graffitiData.ts';
import { hiddenBehind, revealStep, type Bounds3 } from '../world/reveal.ts';
import { TargetGame, type Lane } from '../world/targets.ts';
import { signAt } from '../world/signs.ts';
import { KEY_SINK, onKey, pressStep, type FloorKey } from '../world/keyPress.ts';
import { ChickRain } from '../scene/ChickRain.ts';
import { LAPTOP, MAX_CHICKS, PropPhysics, type ChairPusher, type StaticBox, type TargetDisc, type TargetHit, type ThrownLaptop } from '../world/PropPhysics.ts';

export type ViewPreset = 'front' | 'left' | 'right' | 'back' | 'three-quarter';
export type LightPreset = 'neutral' | 'violet';
export type MovementState = 'ready' | 'unavailable' | 'seated' | 'interacting';
/** Room camera: 'follow' keeps the isometric angle and widest zoom and only tracks the character; 'free' also orbits and zooms. */
export type CameraMode = 'follow' | 'free';
export type SignLink = { id: string; link: string; label: string };
export type ViewerStatus = { kind: 'loading' | 'ready' | 'error'; title: string; detail: string };
export type ModelStats = { meshes: number; triangles: number };
/** Measured rendering cost, sampled about twice a second. */
export type RenderStats = { fps: number; frameMs: number; pixelRatio: number; drawCalls: number; triangles: number };
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
  quality?: QualityId;
  /** Decorative motion off: no camera inertia and a still laptop screen. Character animation is content and stays. */
  reducedMotion?: boolean;
  /** Room only; defaults to 'free' (the studio's limited orbit). */
  cameraMode?: CameraMode;
  /** Room only: where the character starts (and Restablecer returns it) instead of the room's Spawn anchor. */
  spawn?: { position: { x: number; z: number }; yaw: number };
  /** Room only: the page's sound effects (the studio is silent). */
  sounds?: Sounds;
  /** Room only: a touch screen. The intro's keyboard keys and the controls panel are left off the floor (the controls are on screen). */
  touch?: boolean;
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
  movement?: (state: MovementState | null, text?: string) => void;
  render?: (stats: RenderStats | null) => void;
  /** Shift switched running on or off. */
  run?: (running: boolean) => void;
  /** The character walked into a sign's floor zone (Enter opens its link) or left it. */
  sign?: (sign: SignLink | null) => void;
  /** How much of the scene has loaded, 0…1 (downloads, then building it); 1 when it is ready. */
  progress?: (fraction: number) => void;
};

const LOCOMOTION = new Set(['idle', 'walk', 'run', 'jump']);
/** How quickly the camera catches up with the character (1/s); frame-rate independent. */
const FOLLOW_RATE = 4;
const SHADOWLESS = /^(FloorPlank|Platform|Wall|Baseboard|Poster|NightCity|WindowGlass)/;
/** How quickly the character steps down to the outside ground or back up onto the room floor (1/s). */
const STEP_RATE = 25;
/** Radius of the round grass bed at the crossroads (CROSSROADS_GREEN in create_outside.py): footsteps there sound of grass. */
const CROSSROADS_GREEN = 4;
/** Where the rider's wrists rest on the office chair's arm pads: ahead of the pad's middle and above its top (m). */
const RIDER_WRIST = { ahead: 0.02, up: 0.045 };
/** How far ahead of the office chair's seat centre the rider sits (m). */
const RIDER_FORWARD = 0.15;
/** Blob shadow slots: the character first, then the signs, then the loose pieces, then the thrown laptops. */
const CHARACTER_SHADOW = 0;
/** cannon-es sleepState of a sleeping body. */
const FLAP_SLEEPING = 2;
/** Blob shadow slots of the thrown laptops, after the pieces. */
const THROWN_SHADOWS = 3;
/** Seconds a retired thrown laptop takes to shrink away. */
const SHRINK_TIME = 0.3;
/** Head height for the seat bubble's tail, above the character's feet. */
const BUBBLE_HEIGHT = 2.45;
/** A released strike plays its blow up to this much faster at full power: a charged hit is also a snappier one. */
const STRIKE_SNAP = 0.7;
/** Feet around the character's centre that press a floor key. */
const FOOT_RADIUS = 0.15;
/** Rotation about +Y of a turned object (its local +X on the ground). */
const yawOf = (quaternion: Quaternion) => {
  const x = new Vector3(1, 0, 0).applyQuaternion(quaternion);
  return Math.atan2(-x.z, x.x);
};

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
  private movementText = '';
  private roomData?: RoomData;
  private interaction?: InteractionController;
  private outside?: Group;
  private outsideData?: OutsideData;
  private areas?: SignAreas;
  private sign?: string;
  /** The office chair's rider: trunk lean, how much the pose holds (0 standing … 1 seated), and the chair's last forward speed and heading. */
  private riderLean: Lean = restLean();
  private riderWeight = 0;
  private riderAccel = 0;
  private riderLast?: { forward: number; yaw: number };
  /**
   * Bones the rider pose turned last frame: their clip pose and what was written over it. A bone the seated clip has no
   * track for keeps what was written, so it is put back before posing again (otherwise the lean would pile up).
   */
  private readonly riderBones = new Map<Object3D, { clip: Quaternion; posed: Quaternion }>();
  /** The nitro: Space held while riding, the soda spray, where each bottle cap belongs, and whether it sprayed last frame. */
  private nitroHeld = false;
  /** What the sign zones' labels show to open them (setOpenKey). */
  private openKeyLabel = 'ENTER';
  private spray?: SodaSpray;
  private readonly capHomes = new Map<Object3D, { parent: Object3D; position: Vector3; quaternion: Quaternion }>();
  private capsPopped = false;
  private wasBoosting = false;
  /** Sound state followed frame by frame (see updateSounds). */
  private wasAirborne = false;
  private stepHalf?: number;
  private lastStage = 'idle';
  private typingIn = 0;
  private rolling = 0;
  private chairAirborne = false;
  private lastLight = -1;
  /** Loading progress for the loading screen (`data-progress`, the progress event). */
  private readonly progress = new ProgressMeter((fraction) => {
    this.host.dataset.progress = fraction.toFixed(2);
    this.events.progress?.(fraction);
  });
  private ground?: InfiniteFloor;
  private shadows?: BlobShadows;
  private pieces?: PieceMeshes;
  private pieceList: Piece[] = [];
  /** The arrow keys of the intro: fixed on the floor, they sink while the character stands on them. */
  private floorKeys: { index: number; name: string; piece: Piece; area: FloorKey; depth: number }[] = [];
  private pressedKeys = '';
  private floorTexts?: FloorTexts;
  private signpost?: Signpost;
  /** Blob shadows of things that never move (the character's, the signs', the lamppost's), before the pieces' ones. */
  private staticShadows = 0;
  private bubble?: SeatBubble;
  /** The about-me plaza's plaques and globe. */
  private about?: AboutPlaza;
  /** Spray-painted words and symbols on the outside's surfaces and ground (graffitiData.ts). */
  private graffiti?: Graffiti;
  /** The standing targets and their scoreboard, and the round being played on their lane. */
  private targetsView?: TargetsView;
  private circuit?: CircuitView;
  /** The office chair: its driving state, where it stood at first, the seat spot offered to the character and the rider's root. */
  private chairDrive?: ChairState;
  private chairRest?: { x: number; z: number; yaw: number };
  private chairSpot?: SeatSpot;
  private chairRider?: Group;
  private chairPusher?: ChairPusher;
  private circuitClock = 0;
  private chairShadow = -1;
  /** The traffic light's sequence starts when the rider sits down. */
  private lightsAt = -Infinity;
  private wasRiding = false;
  /** Start and finish lines (the painted checker blocks), the lap in progress and the best one. */
  private lines?: { start: FloorBlock; finish: FloorBlock };
  private lap: { start?: number; time?: number; best?: number } = {};
  /** Where the chair or the character was last frame, for the tapes and the lines. */
  private circuitLast?: { x: number; z: number };
  private readonly targetGame = new TargetGame();
  private targetLane?: Lane;
  /** Thrown laptops whose throw counts for the targets round (thrown from behind the line). */
  private countedThrows = new WeakSet<ThrownLaptop>();
  /** Labels over the tech tower's cubes as they fall; the cubes (piece indices) already labelled since the last reset. */
  /** The see-through window in the room while it hides the character, and the room's bounds it is tested against. */
  private reveal?: RoomReveal;
  private roomBounds?: Bounds3;
  private revealAmount = 0;
  /** Cardboard boxes (piece indices): their flaps follow their own bodies. */
  private boxes: number[] = [];
  /** Link signs and playground reset zones: the floor zones the character can step into. */
  private zones: Sign[] = [];
  private physics?: PropPhysics;
  /** A throw is under way and its laptop has not appeared yet: it shows up only at THROW_RELEASE, already leaving the hand. */
  private pendingThrow = false;
  /** A seat is in reach of the character moving freely: the speech bubble shows over its head. */
  private nearSeat = false;
  /** Thrown laptops on screen: base and lid follow their bodies; retired ones shrink away. */
  private thrown: { laptop: ThrownLaptop; base: Group; lid: Object3D; shrink: number }[] = [];
  /** The Konami code's chick shower (the chick model is fetched the first time the code is typed). */
  private chickRain?: ChickRain;
  private chickLoading = false;
  private fallenLetters = -1;
  /** Height of the character's feet: 0 on the room floor, the outside ground elsewhere. */
  private elevation = 0;
  private readonly raycaster = new Raycaster();
  private readonly pointer = new Vector2();
  private pointerStart?: { x: number; y: number };
  private hover?: { x: number; y: number };
  private cameraMode: CameraMode = 'free';
  /** Point the room camera looks at; it follows the character. */
  private readonly focus = new Vector3();
  /** The desk laptop always stands on the desk; the lap one only exists while it is used on the bed. */
  private deskLaptop?: Group;
  private lapLaptop?: Group;
  private readonly laptopHinges = new Map<Group, Object3D | undefined>();
  private laptopOpen = 0;
  private laptopScreen?: Texture;
  /** A refused E/L press is explained in the HUD for a moment. */
  private notice = { text: '', until: 0 };
  /** Adaptive resolution: drop the pixel ratio when frames are slow (fill-rate bound), raise it back when there is headroom. */
  private quality: QualityId = defaultQuality;
  private reducedMotion = false;
  private pixelRatio = 1;
  private frameAverage = 1000 / 60;
  private framesSinceAdjust = 0;
  private sample = { frames: 0, time: 0, calls: 0, triangles: 0 };
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
  /** Clips that play while walking, running and jumping with the keyboard: procedural or one of CLIP_ALTERNATIVES. */
  private readonly gait: Record<Gait, string> = { ...DEFAULT_GAIT_CLIPS };
  /** F plays the throw in place, charged like a strike (`strike` kind 'throw'); movement keys wait until it ends. */
  private throwing = false;
  /**
   * J (punch) or K (kick) in progress: the limb draws back while the key is down (charge in seconds), then strikes
   * on release with strikePower(charge); `launched` once the clip jumped into the swing, `hit` once the blow pushed
   * what is in front.
   */
  private strike?: { kind: StrikeKind; held: boolean; charge: number; power: number; launched: boolean; hit: boolean };
  private chargeMeter?: ChargeMeter;
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
    this.quality = options.quality ?? defaultQuality;
    this.reducedMotion = options.reducedMotion ?? false;
    this.cameraMode = options.cameraMode ?? 'free';
    this.pixelRatio = ratioRange(this.quality, window.devicePixelRatio).max;
    const version = modelVersions[options.modelId];
    this.events.status({ kind: 'loading', title: t('viewer.loading', { label: version.label }), detail: t('viewer.preparing', { file: version.file, copy: version.copy }) });
    this.events.stats(null);
    this.events.animation(null);
    try {
      document.addEventListener('visibilitychange', this.resetDelta, { signal: this.abort.signal });
      const stopLanguage = onLanguage(this.onLanguage);
      this.abort.signal.addEventListener('abort', () => { stopLanguage(); });
      if (this.inRoom) this.keyboard = new KeyboardInput(window, this.abort.signal);
      this.renderer = createRenderer();
      this.host.append(this.renderer.domElement);
      this.renderer.domElement.addEventListener('webglcontextlost', this.onContextLost);
      this.renderer.domElement.addEventListener('webglcontextrestored', this.onContextRestored);
      if (this.inRoom) {
        const canvas = this.renderer.domElement;
        canvas.addEventListener('pointerdown', this.onPointerDown, { signal: this.abort.signal });
        canvas.addEventListener('pointerup', this.onPointerUp, { signal: this.abort.signal });
        canvas.addEventListener('pointermove', this.onPointerMove, { signal: this.abort.signal });
      }
      this.controls = new OrbitControls(this.camera, this.renderer.domElement);
      this.controls.enablePan = false;
      this.controls.enableDamping = !this.reducedMotion;
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
      this.applyCameraMode();
      this.controls.addEventListener('start', this.onOrbit);
      this.controls.addEventListener('change', this.onCameraChange);
      this.configureLights();
      this.setQuality(this.quality);
      this.setReducedMotion(this.reducedMotion);
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
        title: unavailable ? t('viewer.webgl') : t('viewer.start'),
        detail: unavailable
          ? t('viewer.webglDetail')
          : t('viewer.startDetail'),
      });
    }
  }

  private configureLights(): void {
    this.key.position.set(3, 6, 5);
    this.key.castShadow = true;
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
      const meter = this.progress;
      const track = (file: string) => meter.file(file, EXPECTED_BYTES[file] ?? 1_000_000);
      const [gltf, roomGltf, laptopGltf, outsideGltf, circuitGltf, colombiaGltf] = await Promise.all([
        loadCharacter(this.options.modelId, this.abort.signal, track(modelVersions[this.options.modelId].file)),
        this.inRoom ? loadRoom(this.abort.signal, track(roomFile)) : Promise.resolve(undefined),
        this.inRoom ? loadLaptop(this.abort.signal, track(laptopFile)) : Promise.resolve(undefined),
        this.inRoom ? loadOutside(this.abort.signal, track(outsideFile)) : Promise.resolve(undefined),
        this.inRoom ? loadCircuit(this.abort.signal, track(circuitFile)) : Promise.resolve(undefined),
        this.inRoom ? loadColombia(this.abort.signal, track(colombiaFile)) : Promise.resolve(undefined),
      ]);
      meter.report(DOWNLOAD_SHARE);
      const scenes = [...gltf.scenes, ...(roomGltf?.scenes ?? []), ...(laptopGltf?.scenes ?? []), ...(outsideGltf?.scenes ?? []), ...(circuitGltf?.scenes ?? []), ...(colombiaGltf?.scenes ?? [])];
      if (this.disposed) {
        disposeObjects(scenes);
        return;
      }
      this.assetRoots = scenes;
      this.model = gltf.scene;
      if (roomGltf) {
        // The circuit is read as part of the outside: its pieces, decor, floors and zones join the outside's.
        if (outsideGltf && circuitGltf) outsideGltf.scene.add(circuitGltf.scene);
        if (outsideGltf && colombiaGltf) outsideGltf.scene.add(colombiaGltf.scene);
        if (outsideGltf) this.addOutside(outsideGltf.scene);
        this.placeInRoom(roomGltf.scene);
        // Everything receives shadows; only furniture casts them. Floor, walls, posters and the
        // window backdrop cannot shadow anything visible, so they stay out of the shadow pass.
        roomGltf.scene.traverse((object) => {
          if (!(object instanceof Mesh)) return;
          object.receiveShadow = true;
          object.castShadow = !SHADOWLESS.test(object.name);
        });
        mergeStaticMeshes(roomGltf.scene);
        this.reveal = new RoomReveal(roomGltf.scene);
        const bounds = new Box3().setFromObject(roomGltf.scene);
        this.roomBounds = { min: bounds.min.clone(), max: bounds.max.clone() };
        if (laptopGltf) this.addLaptop(laptopGltf.scene);
      }
      // Fewer draw calls: static and skinned parts are merged by material (they render identically).
      mergeStaticMeshes(this.model);
      mergeSkinnedMeshes(this.model);
      if (gltf.animations.length) {
        this.mixer = new AnimationMixer(this.model);
        // One-shot seat clips advance the interaction when they end (no timers).
        this.mixer.addEventListener('finished', (event) => {
          if (event.action !== this.actions.get(this.activeClip)) return;
          if (this.throwing) this.endThrow();
          else if (this.strike) this.endStrike();
          else this.interaction?.clipFinished();
        });
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
        if (!this.room || !(this.isInRoom(object) || this.isInRoom(object, this.outside))) {
          object.castShadow = true; // room and outside pieces got their shadow flags before merging
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
      this.outside?.traverse(count);
      this.scene.add(this.model);
      if (this.room) this.scene.add(this.room);
      if (this.outside) this.scene.add(this.outside);
      for (const object of [this.ground?.mesh, this.shadows?.mesh, this.areas?.root, this.floorTexts?.mesh, this.signpost?.root, this.pieces?.root, this.about?.root, this.targetsView?.root, this.circuit?.root, this.graffiti?.root]) if (object) this.scene.add(object);
      if (!this.ground) this.createFloor(this.mixer ? 0 : box.min.y);
      this.frameLights();
      this.cameraDistance = Math.max(this.bounds.length() * 2.5, 1);
      this.camera.far = this.cameraDistance * 10;
      this.camera.near = this.cameraDistance / 1000;
      this.focus.copy(this.focusTarget());
      this.setView(this.options.view);
      this.setLight(this.options.light);
      this.setWireframe(this.wireframe);
      this.resize();
      this.ready = true;
      this.progress.report(1);
      if (this.controls) this.controls.enabled = !this.contextLost;
      this.events.stats(stats);
      if (!this.contextLost) this.showReady();
      void this.loadPhysics();
    } catch (error) {
      if (this.disposed || this.abort.signal.aborted) return;
      this.dispose();
      this.events.stats(null);
      const message = error instanceof Error ? error.message : '';
      if (message.startsWith('ROOM_')) {
        const files = `${roomFile}, ${laptopFile} ${t('word.or')} ${outsideFile}`;
        this.events.status({
          kind: 'error',
          title: t('viewer.room'),
          detail: message === 'ROOM_HTTP_404'
            ? t('viewer.roomMissing', { files })
            : t('viewer.roomInvalid', { files }),
        });
        return;
      }
      this.events.status({
        kind: 'error',
        title: t('viewer.model', { label: modelVersions[this.options.modelId].label }),
        detail: message === 'MODEL_HTTP_404'
          ? t('viewer.modelMissing', { file: modelVersions[this.options.modelId].file })
          : t('viewer.modelInvalid', { file: modelVersions[this.options.modelId].file }),
      });
    }
  }

  /** Puts the character on the room's Spawn anchor and turns the Light_* anchors into point lights. */
  private placeInRoom(room: Group): void {
    this.room = room;
    // Spawn, seats (approach, stand point, facing), laptop spots and colliders from the room anchors.
    const data = readRoom(room);
    this.roomData = data;
    const spawn = this.options.spawn ?? data.spawn;
    this.standPoints.set('spawn', {
      position: new Vector3(spawn.position.x, 0, spawn.position.z),
      quaternion: new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), spawn.yaw),
    });
    for (const [seat, placement] of data.seatPlacements) this.standPoints.set(seat, placement);
    // With the outside ground the character can leave the room through its two open sides.
    const floor = this.outsideData?.bounds ?? data.halfSize;
    const boxes = [...data.boxes, ...(this.outsideData?.boxes ?? [])];
    this.controller = new CharacterController(spawn, boxes, floor);
    // The park benches outside are seats too (the bed's clips, the laptop on the lap).
    this.interaction = new InteractionController([...data.seats, ...(this.outsideData?.benches ?? [])], boxes, floor, CHARACTER_RADIUS);
    this.setupChair();
    if (this.keyboard) {
      this.keyboard.onPress = this.onPress;
      this.keyboard.onRelease = this.onRelease;
      this.chargeMeter ??= new ChargeMeter(this.host);
      this.host.dataset.strike = 'none';
      this.keyboard.onRunChange = (running) => {
        this.host.dataset.run = String(running);
        this.events.run?.(running);
      };
      this.host.dataset.run = String(this.keyboard.run);
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
    const spot = this.interaction?.seat;
    const seat = clip.endsWith('_chair') ? (spot?.seat === 'office' ? 'office' : 'chair')
      : clip.endsWith('_bed') ? (spot?.seat === 'bench' ? 'bench' : 'bed') : 'spawn';
    if (seat === 'bench' && spot) {
      // A bench's clips start on the outside ground at its stand point, facing its front.
      this.standPoints.set('bench', {
        position: new Vector3(spot.stand.x, this.elevation, spot.stand.z),
        quaternion: new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), spot.yaw),
      });
    }
    const point = this.standPoints.get(seat) ?? this.standPoints.get('spawn');
    if ((seat === 'bed' || seat === 'bench') && point) this.placeLapLaptop(point);
    if (seat === 'spawn' && this.controller) {
      this.applyController();
    } else if (point) {
      this.model.position.copy(point.position);
      this.model.quaternion.copy(point.quaternion);
    }
    this.host.dataset.seat = seat;
  }

  /** The lap laptop sits where it does on the bed relative to the bed's stand point, from this stand point. */
  private placeLapLaptop(point: { position: Vector3; quaternion: Quaternion }): void {
    const bed = this.standPoints.get('bed');
    const spot = this.roomData?.laptopSpots.get('lap');
    if (!this.lapLaptop || !bed || !spot) return;
    const one = new Vector3(1, 1, 1);
    const offset = new Matrix4().compose(bed.position, bed.quaternion, one).invert()
      .multiply(new Matrix4().compose(spot.position, spot.quaternion, one));
    new Matrix4().compose(point.position, point.quaternion, one).multiply(offset)
      .decompose(this.lapLaptop.position, this.lapLaptop.quaternion, new Vector3());
  }

  private isInRoom(object: Object3D, root: Object3D | undefined = this.room): boolean {
    for (let node: Object3D | null = object; node; node = node.parent) if (node === root) return true;
    return false;
  }

  /**
   * Everything outside the room: the endless ground, the signs and reset zones, the painted floor, the name
   * letters and the playground pieces. None of it is in the shadow map; blob shadows stand in for it on the ground.
   */
  private addOutside(outside: Group): void {
    this.outside = outside;
    const data = readOutside(outside);
    this.outsideData = data;
    // The loose pieces move on their own: they leave the static GLB before it is merged.
    for (const group of ['Letters', 'Tagline', 'Keys', 'Bowling', 'Bricks', 'Clutter', 'Tech', 'CircuitPieces']) outside.getObjectByName(group)?.removeFromParent();
    // The chair, the tapes and the traffic light's lenses move or change: the circuit view keeps them out of the merge.
    this.circuit = new CircuitView(data);
    // The flag waves: its cloth stays out of the merge, keeping where it hangs.
    const flag = outside.getObjectByName('ColombiaFlag_Cloth');
    if (flag) {
      outside.updateMatrixWorld(true);
      flag.matrixWorld.decompose(flag.position, flag.quaternion, flag.scale);
      flag.removeFromParent();
    }
    // The targets rock when hit: they leave the static scene too, drawn by their own view.
    const targets = outside.getObjectByName('Targets');
    targets?.removeFromParent();
    outside.traverse((object) => {
      if (!(object instanceof Mesh)) return;
      object.receiveShadow = false;
      object.castShadow = false;
    });
    mergeStaticMeshes(outside);
    this.ground = new InfiniteFloor(data.groundY);
    // Loose pieces first (their order matches the physics bodies), then the floor keys, which stay put and only sink.
    // On a touch screen there are no keys on the floor: being last, leaving them out keeps the physics indices.
    const fixed = this.options.touch ? [] : data.props.filter((piece) => piece.group === 'keys');
    this.pieceList = [...data.letters, ...data.props.filter((piece) => piece.group !== 'keys'), ...fixed];
    this.floorKeys = fixed.map((piece, i) => ({
      index: this.pieceList.length - fixed.length + i,
      name: piece.name.replace(/^Key_/, '').toLowerCase(),
      piece,
      area: { center: { x: piece.position.x, z: piece.position.z }, yaw: yawOf(piece.quaternion), halfX: piece.half[0], halfZ: piece.half[2] },
      depth: 0,
    }));
    const pieceShadows = 1 + data.signs.length + data.decor.length + (data.lamppost ? 1 : 0);
    this.staticShadows = pieceShadows;
    // The last slot is the office chair's.
    this.chairShadow = pieceShadows + this.pieceList.length + THROWN_SHADOWS;
    // Then one slot per raining chick.
    this.shadows = new BlobShadows(this.chairShadow + 1 + MAX_CHICKS, data.groundY);
    for (const [index, sign] of data.signs.entries()) {
      this.shadows.set(1 + index, sign.position.x, sign.position.z, sign.yaw, (sign.board?.width ?? 2) + 0.5, 0.55, 0.45);
    }
    for (const [index, item] of data.decor.entries()) {
      this.shadows.set(1 + data.signs.length + index, item.position.x, item.position.z, item.yaw, item.shadow[0], item.shadow[1], 0.45);
    }
    if (data.lamppost) {
      const { position } = data.lamppost;
      this.shadows.set(pieceShadows - 1, position.x, position.z, 0, 0.8, 0.8, 0.5);
      // Its arrows stay readable from the default isometric view (ROOM_VIEW).
      this.signpost = new Signpost(data.lamppost, { x: ROOM_VIEW.x, z: ROOM_VIEW.z });
      this.host.dataset.signpost = this.signpost.arrows.map((arrow) => arrow.id).join(',');
    }
    // Graffiti: on the merged static surfaces, and on loose pieces (a brick wall) whose poses it then follows. Built
    // before the pieces' source geometry is released.
    if (GRAFFITI.length) this.graffiti = new Graffiti(GRAFFITI, [outside], data.groundY, this.pieceList, getLanguage());
    this.host.dataset.graffiti = this.graffiti?.painted.join(',') || 'none';
    if (this.pieceList.length) {
      this.pieces = new PieceMeshes(this.pieceList, this.shadows, pieceShadows, data.groundY);
      if (this.graffiti) {
        const graffiti = this.graffiti;
        this.pieces.onPose = (index, matrix) => graffiti.followPiece(index, matrix);
      }
      // The batched mesh holds its own copy of the pieces' geometry.
      for (const geometry of new Set(this.pieceList.flatMap((piece) => [...piece.parts, ...(piece.flaps ?? [])].map((part) => part.geometry)))) geometry.dispose();
      this.boxes = this.pieceList.flatMap((piece, index) => (piece.flaps?.length ? [index] : []));
    }
    this.shadows.flush();
    this.zones = [...data.signs, ...data.zones];
    this.areas = new SignAreas(this.zones, data.groundY);
    this.areas.setOpenKey(this.openKeyLabel);
    this.areas.setReducedMotion(this.reducedMotion);
    this.floorTexts = new FloorTexts(this.options.touch ? data.floors.filter((floor) => floor.id !== 'controls') : data.floors, data.groundY, !!this.options.touch);
    this.about = new AboutPlaza(data.plaques);
    if (flag) this.about.waveFlag(flag);
    if (data.targets.length) {
      this.targetsView = new TargetsView(data.targets, data.scoreboard);
      if (targets) this.targetsView.root.add(targets);
      const lane = data.floors.find((floor) => floor.id === 'targets');
      // Throws count from behind the painted line, between the lane's sides (the lane keeps the block yaw, 0).
      if (lane) this.targetLane = { minX: lane.position.x - lane.size[0] / 2, maxX: lane.position.x + lane.size[0] / 2, lineZ: lane.position.z + lane.line, depth: 3 };
    }
    this.bubble = new SeatBubble(this.host);
    this.host.dataset.sign = 'none';
    this.host.dataset.signArea = 'none';
    this.host.dataset.letters = '0';
    this.host.dataset.pins = '0';
    this.host.dataset.thrown = '0';
    this.host.dataset.score = '0';
    this.host.dataset.throws = '0';
    this.host.dataset.targetsHit = '0';
    this.host.dataset.tech = '0';
  }

  /**
   * Physics for the loose pieces and thrown laptops, loaded after the scene is up (cannon-es is its own
   * chunk); until then the pieces stand still and F only plays the throw.
   */
  private async loadPhysics(): Promise<void> {
    const data = this.outsideData;
    if (!data || this.physics) return;
    const { platform, groundY } = data;
    // The room platform (top at the room floor), the sign boards, and the room's furniture and walls: pieces bounce off them.
    const statics: StaticBox[] = [{
      center: { x: (platform.minX + platform.maxX) / 2, y: -0.17, z: (platform.minZ + platform.maxZ) / 2 },
      half: [(platform.maxX - platform.minX) / 2, 0.17, (platform.maxZ - platform.minZ) / 2],
      yaw: 0,
    }];
    // The floor keys are fixed: thrown laptops and rolling pieces bounce off their caps.
    for (const key of this.floorKeys) {
      const { position, half } = key.piece;
      statics.push({ center: { x: position.x, y: position.y, z: position.z }, half, yaw: key.area.yaw });
    }
    for (const sign of data.signs) {
      if (!sign.board) continue;
      const height = sign.board.bottom + sign.board.height;
      statics.push({ center: { x: sign.position.x, y: sign.position.y + height / 2, z: sign.position.z }, half: [sign.board.width / 2 + 0.1, height / 2, 0.08], yaw: sign.yaw });
    }
    if (data.lamppost) {
      const { position, height } = data.lamppost;
      statics.push({ center: { x: position.x, y: position.y + height / 2, z: position.z }, half: [0.12, height / 2, 0.12], yaw: 0 });
    }
    // Trees, rocks, benches, the bust, the Colombian corner and the scoreboard.
    for (const item of data.decor) {
      if (!item.solid) continue;
      const [w, h, d] = item.solid;
      statics.push({ center: { x: item.position.x, y: item.position.y + h / 2, z: item.position.z }, half: [w / 2, h / 2, d / 2], yaw: item.yaw });
    }
    // The circuit's ramps: a sloped board each, rising along the ramp's local +Z.
    for (const ramp of data.ramps) {
      if (ramp.profile !== 'up') continue;
      const slope = Math.atan2(ramp.height, ramp.length);
      const length = Math.hypot(ramp.height, ramp.length);
      statics.push({ center: { x: ramp.position.x, y: ramp.position.y + ramp.height / 2 - 0.05, z: ramp.position.z }, half: [ramp.width / 2, 0.05, length / 2], yaw: ramp.yaw, pitch: -slope });
    }
    // The targets' posts; their discs are reported when a thrown laptop hits them.
    const discs: TargetDisc[] = [];
    for (const target of data.targets) {
      const { position, yaw, centre, radius } = target;
      statics.push({ center: { x: position.x, y: position.y + (centre - radius) / 2, z: position.z - 0.05 }, half: [0.05, (centre - radius) / 2, 0.05], yaw });
      discs.push({ center: { x: position.x + Math.sin(yaw) * 0.025, y: position.y + centre, z: position.z + Math.cos(yaw) * 0.025 }, radius, yaw });
    }
    this.room?.traverse((object) => {
      const extras = object.userData as { collider?: string; size?: number[] };
      if (extras.collider !== 'box' || extras.size?.length !== 3) return;
      // Blender sizes: X, Y (three.js Z) and Z (height); the anchor sits at the box centre.
      const [sx, sy, sz] = extras.size;
      const center = object.getWorldPosition(new Vector3());
      statics.push({ center: { x: center.x, y: center.y, z: center.z }, half: [sx / 2, sz / 2, sy / 2], yaw: 0 });
    });
    try {
      const loose = this.pieceList.length - this.floorKeys.length;
      const physics = await PropPhysics.load(this.pieceList.slice(0, loose), statics, groundY, discs);
      if (this.disposed) return;
      physics.onTargetHit = this.onTargetHit;
      physics.onImpact = (impact) => {
        const name = impact.source === 'laptop' ? 'laptop' : impact.source === 'chick' ? 'chirp' : pieceSound(this.pieceList[impact.source]);
        this.sound(name, impact.speed, impact.position);
      };
      physics.onBreak = () => this.sound('woodHeavy', 6);
      this.physics = physics;
      this.host.dataset.physics = 'ready';
    } catch {
      // Without the physics chunk the pieces simply stay where they stand.
    }
  }

  private addLaptop(laptop: Group): void {
    this.laptopOpen = Number(laptop.getObjectByName('Laptop')?.userData.hinge_open_radians ?? 1.85);
    laptop.traverse((object) => {
      if (!(object instanceof Mesh)) return;
      object.castShadow = object.receiveShadow = true;
      const material = object.material as MeshStandardMaterial;
      if (object.name === 'Display' && material.map) {
        // The screen scrolls its code while typing; emission uses the same image.
        this.laptopScreen = material.map;
        this.laptopScreen.wrapT = RepeatWrapping;
        if (material.emissiveMap) material.emissiveMap = this.laptopScreen;
        this.laptopScreen.needsUpdate = true;
      }
    });
    // The lap copy shares geometry, materials and the scrolling screen texture with the desk one.
    const lap = laptop.clone(true);
    for (const copy of [laptop, lap]) {
      this.laptopHinges.set(copy, copy.getObjectByName('LaptopHinge'));
      this.scene.add(copy);
    }
    this.deskLaptop = laptop;
    this.lapLaptop = lap;
    for (const [place, copy] of [['desk', laptop], ['lap', lap]] as const) {
      const spot = this.roomData?.laptopSpots.get(place);
      if (spot) {
        copy.position.copy(spot.position);
        copy.quaternion.copy(spot.quaternion);
      }
    }
    this.syncLaptop(0);
  }

  /** The desk laptop opens while used at the chair; the lap one appears, opens, closes and disappears on the bed. */
  private syncLaptop(delta: number): void {
    if (!this.deskLaptop || !this.lapLaptop || !this.interaction) return;
    const { laptop: place, lid, shown } = this.interaction;
    const hinge = (copy: Group, amount: number) => {
      const node = this.laptopHinges.get(copy);
      if (node) node.rotation.x = this.laptopOpen * amount;
    };
    hinge(this.deskLaptop, place === 'desk' ? lid : 0);
    hinge(this.lapLaptop, place === 'lap' ? lid : 0);
    const size = place === 'lap' ? shown * shown * (3 - 2 * shown) : 0;
    this.lapLaptop.visible = size > 0.001;
    this.lapLaptop.scale.setScalar(Math.max(size, 0.001));
    const typing = this.interaction.phase === 'seated' && this.interaction.state.stage === 'typing';
    if (this.laptopScreen && typing && !this.reducedMotion) this.laptopScreen.offset.y = (this.laptopScreen.offset.y - delta * 0.035) % 1;
    const state = place === 'none' ? 'closed' : lid >= 0.999 ? 'open' : lid <= 0.001 ? 'closed' : 'moving';
    if (this.host.dataset.laptop !== place) this.host.dataset.laptop = place;
    if (this.host.dataset.lid !== state) this.host.dataset.lid = state;
  }

  private readonly onPress = (action: PressAction): void => {
    if (action === 'konami') {
      void this.rainChicks();
      return;
    }
    if (action === 'open') {
      if (this.ready) this.openSign(this.sign);
      return;
    }
    if (action === 'reset') {
      if (this.ready) this.resetPosition();
      return;
    }
    if (action === 'jump' && this.riding) {
      // On the office chair Space is the nitro, held as long as the key is down.
      this.nitroHeld = true;
      return;
    }
    const interaction = this.interaction;
    if (!interaction || !this.controller || !this.ready || this.controller.jumping || this.throwing || this.strike) return;
    if (action === 'punch' || action === 'kick') {
      // Like the throw: only from free keyboard movement, in place; movement keys wait until it ends.
      const clip = STRIKES[action].clip;
      if (interaction.phase !== 'free' || !this.isLocomotion(this.activeClip) || !this.actions.has(clip)) return;
      this.strike = { kind: action, held: true, charge: 0, power: 0, launched: false, hit: false };
      this.controller.speed = 0;
      this.driving = true;
      if (!this.playing) this.setPlaying(true);
      this.selectClip(clip, false);
      this.host.dataset.locomotion = action;
      this.host.dataset.strike = 'charging';
      return;
    }
    if (action === 'throw') {
      // Like the jump: only from free keyboard movement, never from a seat or a clip picked by hand. While F is down
      // the throwing arm draws back with the charge; on release the laptop flies further the longer it charged.
      if (interaction.phase !== 'free' || !this.isLocomotion(this.activeClip) || !this.actions.has(THROW_CLIP)) return;
      this.throwing = true;
      this.strike = { kind: 'throw', held: true, charge: 0, power: 0, launched: false, hit: false };
      this.host.dataset.strike = 'charging';
      this.controller.speed = 0;
      this.driving = true;
      if (!this.playing) this.setPlaying(true);
      this.selectClip(THROW_CLIP, false);
      this.host.dataset.locomotion = 'throw';
      this.holdLaptop();
      return;
    }
    if (action === 'jump') {
      // Only from free keyboard movement, never from a seat or a clip picked by hand.
      if (interaction.phase !== 'free' || !this.isLocomotion(this.activeClip) || !this.actions.has('jump')) return;
      this.controller.jump();
      this.sound('cloth');
      this.driving = true;
      if (!this.playing) this.setPlaying(true);
      this.selectClip(this.gaitClip('jump'), false);
      // A jump while walking or running starts just before take-off instead of crouching from a standstill.
      const start = this.controller.jumpStart;
      if (start > 0) {
        this.actions.get(this.activeClip)!.time = start;
        this.mixer?.update(0);
      }
      this.host.dataset.locomotion = 'jump';
      return;
    }
    if (!this.hasSeatClips()) return;
    if (interaction.phase === 'free' && !this.isLocomotion(this.activeClip)) return; // a seat clip picked by hand
    const accepted = action === 'interact'
      ? interaction.interact(this.controller.position, this.controller.yaw)
      : interaction.laptopPress();
    if (accepted && interaction.phase === 'approaching') {
      this.driving = false;
      this.controller.speed = 0;
      if (!this.playing) this.setPlaying(true);
    }
    this.notice = accepted ? { text: '', until: 0 } : { text: interaction.message, until: performance.now() + 2500 };
  };

  /** J, K or F let go: the held wind-up turns into the blow or the throw, stronger the longer it charged. */
  private readonly onRelease = (action: HoldAction): void => {
    if (action === 'jump') {
      this.nitroHeld = false;
      return;
    }
    const strike = this.strike;
    if (!strike || strike.kind !== action || !strike.held) return;
    strike.held = false;
    strike.power = strikePower(strike.charge);
    this.host.dataset.strike = 'striking';
    this.host.dataset.strikePower = strike.power.toFixed(2);
  };

  /**
   * While the key is down the fist or leg draws back with the charge; once let go (and ready) the blow continues
   * from the matching pose in the swing, and at the hit time it knocks away what is in front of the fist or foot.
   */
  private updateStrike(delta: number): void {
    const strike = this.strike;
    if (!strike || !this.model || !this.controller) return;
    const spec = STRIKES[strike.kind];
    const action = this.actions.get(spec.clip);
    if (!action) return;
    if (strike.held) {
      if (action.time >= spec.ready) {
        strike.charge += delta * this.speed;
        action.time = strikeCharge(spec, strike.charge);
        action.setEffectiveTimeScale(0);
      }
      return;
    }
    if (!strike.launched) {
      // A tap before the stance is ready lets the clip get there first.
      if (action.time < spec.ready) return;
      strike.launched = true;
      this.sound('whoosh', strike.power);
      action.time = strikeLaunch(spec, strike.charge);
      const snap = (strike.power - STRIKE_MIN_POWER) / (1 - STRIKE_MIN_POWER);
      action.setEffectiveTimeScale(1 + STRIKE_SNAP * snap);
      return;
    }
    if (strike.hit || action.time < spec.hit) return;
    strike.hit = true;
    // The throw's `hit` is the laptop leaving the hand (updateThrow).
    if (!this.physics || strike.kind === 'throw') return;
    this.model.updateMatrixWorld(true);
    const bone = this.model.getObjectByName(spec.bone);
    if (!bone) return;
    const yaw = this.controller.yaw;
    const forward = { x: Math.sin(yaw), z: Math.cos(yaw) };
    const point = bone.getWorldPosition(new Vector3()).add(new Vector3(forward.x * spec.reach, 0, forward.z * spec.reach));
    const hits = this.physics.strike(this.controller.position, point, forward, strike.power);
    this.host.dataset.strikeHits = String(hits);
    if (hits) this.sound('punch', strike.power);
  }

  private cancelStrike(): void {
    this.strike = undefined;
    if (this.host.dataset.strike) this.host.dataset.strike = 'none';
  }

  /** The strike clip ended: back to idle, and the keys move the character again. */
  private endStrike(): void {
    this.cancelStrike();
    this.driving = false;
    if (this.actions.has('idle')) this.selectClip('idle');
    this.host.dataset.locomotion = 'idle';
  }

  /** The charge bar over the head while a strike key is held. */
  private updateChargeMeter(): void {
    if (!this.chargeMeter || !this.model) return;
    if (!this.strike?.held) {
      this.chargeMeter.update(false);
      return;
    }
    const point = this.model.position.clone().setY(this.model.position.y + BUBBLE_HEIGHT).project(this.camera);
    this.chargeMeter.update(true, this.strike.charge / STRIKE_CHARGE, (point.x + 1) / 2 * this.host.clientWidth, (1 - point.y) / 2 * this.host.clientHeight);
  }

  private hasSeatClips(): boolean {
    return this.actions.has('sit_down_chair') && this.actions.has('sit_down_bed');
  }

  private noticeText(): string {
    return performance.now() < this.notice.until ? this.notice.text : '';
  }

  /** Phase 5: the interaction walks the character to a seat and runs the seat/laptop clips. */
  private driveInteraction(delta: number): void {
    this.nearSeat = false;
    const interaction = this.interaction!;
    interaction.update(delta);
    const request = interaction.clip();
    // The scripted walk to and from a seat uses the keyboard's walk clip and pace.
    const walking = request?.name === 'walk';
    const name = walking ? this.gaitClip('walk') : request?.name;
    if (request && name && name !== this.activeClip && this.actions.has(name)) this.selectClip(name, request.loop);
    if (walking && this.fadeRemaining <= 0) this.actions.get(this.activeClip)?.setEffectiveTimeScale(WALK_SPEED / this.controller!.walkClipSpeed);
    if (interaction.phase === 'free') {
      // Back on the approach point: hand control back to the keyboard there.
      this.controller!.position = { ...interaction.position };
      this.controller!.yaw = interaction.yaw;
      this.controller!.speed = 0;
      this.driving = false;
      if (this.activeClip !== 'idle') this.selectClip('idle');
      this.applyController();
      this.host.dataset.locomotion = 'idle';
    } else if (interaction.phase === 'seated') {
      this.placeForClip(this.activeClip);
    } else if (this.model) {
      this.model.position.set(interaction.position.x, this.elevation, interaction.position.z);
      this.model.quaternion.setFromAxisAngle(new Vector3(0, 1, 0), interaction.yaw);
    }
    this.host.dataset.interaction = interaction.phase === 'seated' ? interaction.state.stage : interaction.phase;
    this.setMovement('interacting', this.noticeText() || interaction.prompt(interaction.position));
  }

  private applyController(): void {
    if (!this.model || !this.controller) return;
    this.model.position.set(this.controller.position.x, this.elevation, this.controller.position.z);
    this.model.quaternion.setFromAxisAngle(new Vector3(0, 1, 0), this.controller.yaw);
    const position = `${this.controller.position.x.toFixed(2)},${this.controller.position.z.toFixed(2)}`;
    if (this.host.dataset.position !== position) this.host.dataset.position = position;
  }

  private setMovement(state: MovementState | null, text = ''): void {
    if (state === this.movementState && text === this.movementText) return;
    this.movementState = state;
    this.movementText = text;
    this.host.dataset.movement = state ?? 'none';
    this.events.movement?.(state, text || undefined);
  }

  /** The throw clip ended: back to idle, and the keys move the character again. */
  private endThrow(): void {
    this.throwing = false;
    this.cancelStrike();
    this.driving = false;
    this.dropHeldLaptop();
    if (this.actions.has('idle')) this.selectClip('idle');
    this.host.dataset.locomotion = 'idle';
  }

  /** A closed copy of the room laptop (it shares geometry and materials) for the throw. */
  private laptopCopy(): Group | undefined {
    if (!this.deskLaptop) return undefined;
    const copy = this.deskLaptop.clone(true);
    const hinge = copy.getObjectByName('LaptopHinge');
    if (hinge) hinge.rotation.x = 0;
    copy.position.set(0, 0, 0);
    copy.quaternion.identity();
    copy.scale.setScalar(1);
    copy.visible = true;
    return copy;
  }

  /** F: nothing shows in the hand during the wind-up; the laptop appears at THROW_RELEASE, leaving it (updateThrow). */
  private holdLaptop(): void {
    this.pendingThrow = !!this.physics && !!this.model?.getObjectByName(THROW_HAND);
  }

  private dropHeldLaptop(): void {
    this.pendingThrow = false;
  }

  /** Base centre and orientation of the laptop in the hand: closed, level, facing where the character faces. */
  private heldPose(): { position: Vector3; quaternion: Quaternion } | undefined {
    const hand = this.model?.getObjectByName(THROW_HAND);
    if (!hand || !this.controller) return undefined;
    const position = hand.getWorldPosition(new Vector3());
    // Held by its back edge, the keys facing up.
    const quaternion = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), this.controller.yaw);
    position.add(new Vector3(0, 0.02, -LAPTOP.depth / 2 + 0.04).applyQuaternion(quaternion));
    return { position, quaternion };
  }

  /** At the release time (after the charge was let go) the laptop appears at the hand and goes straight to the physics. */
  private updateThrow(): void {
    const action = this.actions.get(THROW_CLIP);
    if (!this.throwing || !this.pendingThrow || !action || !this.model || this.strike?.held || !this.strike?.launched) return;
    if (action.time < THROW_RELEASE) return;
    this.model.updateMatrixWorld(true);
    const pose = this.heldPose();
    if (!pose) return;
    this.pendingThrow = false;
    this.throwLaptop(pose, this.strike.power);
  }

  /** Put a laptop copy (origin at the foot of its base) so its base centre is at `center`. */
  private placeLaptop(copy: Group, center: Vector3, quaternion: Quaternion): void {
    copy.quaternion.copy(quaternion);
    copy.position.copy(center).sub(new Vector3(0, LAPTOP.base / 2, 0).applyQuaternion(quaternion));
  }

  private throwLaptop(pose: { position: Vector3; quaternion: Quaternion }, power: number): void {
    if (!this.physics || !this.controller) return;
    const yaw = this.controller.yaw;
    const forward = throwDirection(this.controller.position, yaw, pose.position);
    const speed = throwSpeed(power);
    const jitter = () => (Math.random() - 0.5) * 2;
    const laptop = this.physics.throwLaptop(
      { position: pose.position, quaternion: pose.quaternion },
      { x: forward.x * speed.forward, y: speed.up, z: forward.z * speed.forward },
      { x: jitter() * 0.6, y: jitter() * 1.5, z: jitter() * 0.6 },
      4 + Math.random() * 4,
    );
    // A throw from behind the targets' line counts for the round (the first one after a full round starts a new one).
    if (this.targetLane && this.targetGame.throwFrom(this.controller.position, this.targetLane)) {
      this.countedThrows.add(laptop);
      this.reportTargets();
    }
    const base = this.laptopCopy();
    const lid = base?.getObjectByName('LaptopHinge');
    if (!base || !lid) return;
    // The lid follows its own body: it leaves the copy and goes straight into the scene.
    this.scene.add(base, lid);
    this.thrown.push({ laptop, base, lid, shrink: 0 });
    this.syncThrown(0);
  }

  /** ↑ ↑ ↓ ↓ ← → ← → B A: chicks in sunglasses rain round the character (outside, once the physics is ready). */
  private async rainChicks(): Promise<void> {
    if (!this.ready || !this.physics || !this.model || !this.outsideData || this.chickLoading) return;
    this.sound('konami');
    if (!this.chickRain) {
      this.chickLoading = true;
      try {
        const gltf = await loadChick(this.abort.signal);
        if (this.disposed) return;
        this.assetRoots.push(gltf.scene);
        this.chickRain = new ChickRain(gltf.scene, this.shadows, this.chairShadow + 1, this.outsideData.groundY);
        this.scene.add(this.chickRain.root);
      } catch {
        return;
      } finally {
        this.chickLoading = false;
      }
    }
    this.chickRain.start({ x: this.model.position.x, z: this.model.position.z });
    this.host.dataset.konami = String(Number(this.host.dataset.konami ?? 0) + 1);
  }

  /** Thrown laptops follow their bodies; ones the physics retired shrink away, then leave the scene. */
  private syncThrown(delta: number): void {
    const physics = this.physics;
    if (!physics) return;
    for (const laptop of physics.retired.splice(0)) {
      const entry = this.thrown.find((item) => item.laptop === laptop);
      if (entry) entry.shrink = this.reducedMotion ? SHRINK_TIME : Math.max(entry.shrink, 1e-6);
    }
    const shadowStart = this.staticShadows + this.pieceList.length;
    const center = new Vector3();
    const quaternion = new Quaternion();
    this.thrown = this.thrown.filter((entry) => {
      if (entry.shrink >= SHRINK_TIME) {
        entry.base.removeFromParent();
        entry.lid.removeFromParent();
        return false;
      }
      return true;
    });
    for (const [index, entry] of this.thrown.entries()) {
      const { base, lid } = entry.laptop;
      if (entry.shrink > 0) entry.shrink = Math.min(SHRINK_TIME, entry.shrink + delta);
      const size = entry.shrink > 0 ? Math.max(0.001, 1 - entry.shrink / SHRINK_TIME) : 1;
      center.set(base.position.x, base.position.y, base.position.z);
      quaternion.set(base.quaternion.x, base.quaternion.y, base.quaternion.z, base.quaternion.w);
      this.placeLaptop(entry.base, center, quaternion);
      // The hinge node sits on the lid's back edge, turned like the lid (rotation 0 is closed on the keys).
      const hinge = new Vector3(0, -LAPTOP.lid / 2 - 0.001, LAPTOP.depth / 2 - 0.005);
      quaternion.set(lid.quaternion.x, lid.quaternion.y, lid.quaternion.z, lid.quaternion.w);
      entry.lid.position.set(lid.position.x, lid.position.y, lid.position.z).add(hinge.applyQuaternion(quaternion));
      entry.lid.quaternion.copy(quaternion);
      entry.base.scale.setScalar(size);
      entry.lid.scale.setScalar(size);
      if (this.shadows && index < THROWN_SHADOWS) {
        const lift = Math.max(0, base.position.y - (this.outsideData?.groundY ?? 0));
        const yaw = Math.atan2(2 * (quaternion.w * quaternion.y + quaternion.x * quaternion.z), 1 - 2 * (quaternion.y ** 2 + quaternion.z ** 2));
        this.shadows.set(shadowStart + index, base.position.x, base.position.z, yaw, LAPTOP.width * size + 0.15, LAPTOP.depth * size + 0.15,
          0.45 * Math.max(0, 1 - lift / 2) ** 2 * size);
      }
    }
    if (this.shadows) for (let index = this.thrown.length; index < THROWN_SHADOWS; index++) this.shadows.hide(shadowStart + index);
    const count = String(physics.laptops.length);
    if (this.host.dataset.thrown !== count) this.host.dataset.thrown = count;
    const last = physics.laptops.at(-1);
    const lid = last ? physics.lidAngle(last).toFixed(2) : 'none';
    if (this.host.dataset.thrownLid !== lid) this.host.dataset.thrownLid = lid;
  }

  /** A thrown laptop touched a target: it rocks, and a counted throw scores by the ring it hit. */
  private readonly onTargetHit = (hit: TargetHit): void => {
    const target = this.outsideData?.targets[hit.target];
    if (!target) return;
    let ring = -1;
    for (const [index, radius] of target.rings.entries()) if (hit.distance <= radius) ring = index;
    if (this.countedThrows.has(hit.laptop)) this.targetGame.hit(hit.distance, target.rings, target.points);
    this.targetsView?.hit(hit.target, ring);
    // The rings ring brighter towards the centre.
    if (ring >= 0) this.sound('bell', (ring + 1) / target.rings.length, target.position);
    this.reportTargets();
  };

  /** Score, throws and hits of the targets round (data-score, data-throws, data-targets-hit) and the scoreboard. */
  private reportTargets(): void {
    const { score, throws, hits } = this.targetGame;
    this.targetsView?.setScore(score, throws);
    if (!this.outside) return;
    this.host.dataset.score = String(score);
    this.host.dataset.throws = String(throws);
    this.host.dataset.targetsHit = String(hits);
  }

  /** data-tech counts the tech tower's cubes that are down. */
  private checkTech(): void {
    const physics = this.physics;
    if (!physics) return;
    const value = String(physics.fallen(['tech']));
    if (this.host.dataset.tech !== value) this.host.dataset.tech = value;
  }

  /** Box flaps follow their bodies (only the awake ones, or all of them); data-boxes-open counts the ones standing open. */
  private syncFlaps(all = false): void {
    const physics = this.physics;
    if (!physics || !this.pieces || !this.boxes.length) return;
    let open = 0;
    for (const index of this.boxes) {
      for (const [k, flap] of (physics.flaps[index] ?? []).entries()) {
        if (all || flap.body.sleepState !== FLAP_SLEEPING) this.pieces.setFlap(index, k, flap.body);
        if (physics.flapAngle(index, k) > 0.6) open++;
      }
    }
    const value = String(open);
    if (this.host.dataset.boxesOpen !== value && this.outside) this.host.dataset.boxesOpen = value;
  }

  /** While the room stands between the camera and the character, a window opens in it around the character. */
  private updateReveal(delta: number): void {
    if (!this.reveal || !this.roomBounds || !this.model || !this.renderer) return;
    const toCamera = this.camera.getWorldDirection(new Vector3()).negate();
    const hidden = hiddenBehind(this.model.position, toCamera, this.roomBounds);
    this.revealAmount = revealStep(this.revealAmount, hidden, delta, this.reducedMotion);
    const size = this.renderer.getDrawingBufferSize(new Vector2());
    const chest = this.model.position.clone().setY(this.model.position.y + 1.2);
    this.reveal.update(this.camera, chest, this.revealAmount, size.x, size.y);
    const value = this.revealAmount > 0.5 ? 'open' : 'none';
    if (this.host.dataset.reveal !== value) this.host.dataset.reveal = value;
  }

  private resetTargets(): void {
    this.physics?.clearThrown();
    this.targetGame.reset();
    this.targetsView?.reset();
    this.reportTargets();
  }

  private clearThrown(): void {
    for (const entry of this.thrown) {
      entry.base.removeFromParent();
      entry.lid.removeFromParent();
    }
    this.thrown = [];
    this.dropHeldLaptop();
  }

  /** Back to the spawn point, standing idle. */
  resetPosition(): void {
    if (!this.controller || this.disposed) return;
    this.throwing = false;
    this.cancelStrike();
    this.clearThrown();
    this.controller.reset();
    this.interaction?.reset();
    this.syncLaptop(0);
    this.driving = false;
    this.keyboard?.clear();
    if (this.actions.has('idle')) this.selectClip('idle');
    this.elevation = 0;
    this.placeForClip(this.activeClip);
    this.host.dataset.locomotion = 'idle';
    this.physics?.reset();
    this.chickRain?.clear();
    this.pieces?.reset();
    this.syncFlaps(true);
    this.targetGame.reset();
    this.targetsView?.reset();
    this.reportTargets();
    this.checkTech();
    for (const key of this.floorKeys) key.depth = 0;
    this.resetCircuit();
    this.syncThrown(0);
    this.reportLetters();
  }

  /** Keyboard locomotion for the room: camera-relative movement with colliders and matched clip rates. */
  private drive(delta: number): void {
    if (!this.controller || !this.controls) return;
    if (!this.mixer || !this.actions.has('walk') || !this.actions.has('idle')) {
      this.setMovement('unavailable');
      return;
    }
    if (this.throwing || this.strike) return;
    if (!this.isLocomotion(this.activeClip)) {
      this.setMovement('seated');
      return;
    }
    const seat = this.hasSeatClips() ? this.interaction?.available(this.controller.position)?.seat : undefined;
    const prompt = seat ? this.interaction!.prompt(this.controller.position) : '';
    this.setMovement('ready', this.noticeText() || prompt);
    this.host.dataset.interaction = 'free';
    this.syncGait();
    this.host.dataset.prompt = seat ?? 'none';
    this.nearSeat = !!seat;
    const keys = this.keyboard?.active ?? false;
    if (!keys && !this.driving && !this.controller.jumping) return;
    if (keys && !this.driving) {
      this.driving = true;
      if (!this.playing) this.setPlaying(true);
    }
    const mode: Locomotion = this.controller.update(delta, this.keyboard!.intent, this.controls.getAzimuthalAngle());
    const clip = mode === 'idle' ? 'idle' : this.gaitClip(mode);
    if (clip !== this.activeClip) this.selectClip(clip, mode !== 'jump');
    if (this.fadeRemaining <= 0) this.actions.get(clip)?.setEffectiveTimeScale(this.controller.clipRate());
    this.applyController();
    this.host.dataset.locomotion = mode;
    if (!keys && mode === 'idle') this.driving = false;
  }

  /** Whether the character sits on the office chair (sitting down, riding or getting up). */
  private get riding(): boolean {
    return this.interaction?.phase === 'seated' && this.interaction.seat?.seat === 'office';
  }

  /** The office chair: its driving state, the rider's root on its seat and the seat offered to the character. */
  private setupChair(): void {
    const rig = this.circuit?.chair;
    const data = this.outsideData;
    if (!rig || !data?.chair || !this.interaction) return;
    const { position, yaw } = data.chair;
    this.chairRest = { x: position.x, z: position.z, yaw };
    this.chairDrive = chairAt(position.x, position.z, yaw);
    // The seat clips start from the stand point: on the ground, stand_offset in front of the seat.
    const rider = new Group();
    rider.name = 'OfficeChair_Rider';
    const offset = Number(rig.seat.userData.stand_offset ?? 0.2);
    // A little forward of the seat's middle: on the larger chair the legs would otherwise sink into the cushion and arms.
    rider.position.set(rig.seat.position.x, -rig.upper.position.y, rig.seat.position.z + offset + RIDER_FORWARD);
    rider.quaternion.copy(rig.seat.quaternion);
    rig.upper.add(rider);
    this.chairRider = rider;
    this.chairSpot = { seat: 'office', approaches: [], stand: { x: 0, z: 0 }, yaw };
    this.lap = { best: readBestLap() };
    this.interaction.setSeat(this.chairSpot);
    this.spray = new SodaSpray();
    this.spray.density = this.nitroDensity();
    this.scene.add(this.spray.mesh);
    for (const bottle of rig.bottles) {
      if (bottle.cap?.parent) this.capHomes.set(bottle.cap, { parent: bottle.cap.parent, position: bottle.cap.position.clone(), quaternion: bottle.cap.quaternion.clone() });
    }
    const checkers = data.floors.filter((floor) => floor.id === 'checker');
    if (checkers.length === 2) {
      const near = (floor: FloorBlock) => Math.hypot(floor.position.x - position.x, floor.position.z - position.z);
      const [start, finish] = [...checkers].sort((a, b) => near(a) - near(b));
      this.lines = { start, finish };
    }
    this.poseChair();
  }

  /** Put the chair's parts where its state says, and keep its seat spot and the rider's stand point up to date. */
  private poseChair(): void {
    const rig = this.circuit?.chair;
    const state = this.chairDrive;
    if (!rig || !state || !this.outsideData) return;
    rig.root.position.set(state.x, this.outsideData.groundY + state.y, state.z);
    rig.root.rotation.set(0, state.yaw, 0);
    rig.upper.rotation.set(state.pitch, 0, state.roll);
    for (const caster of rig.casters) caster.rotation.y = state.casterYaw - state.yaw;
    for (const wheel of rig.wheels) wheel.rotation.x = state.rolled / 0.05;
    rig.root.updateMatrixWorld(true);
    if (this.shadows && this.chairShadow >= 0) {
      const lift = Math.min(state.y, 1.5);
      this.shadows.set(this.chairShadow, state.x, state.z, state.yaw, 1.2 - lift * 0.3, 1.2 - lift * 0.3, 0.5 * (1 - lift * 0.4));
    }
    const rider = this.chairRider;
    const spot = this.chairSpot;
    if (!rider || !spot) return;
    const position = rider.getWorldPosition(new Vector3());
    this.standPoints.set('office', { position, quaternion: rider.getWorldQuaternion(new Quaternion()) });
    const forward = { x: Math.sin(state.yaw), z: Math.cos(state.yaw) };
    const left = { x: Math.cos(state.yaw), z: -Math.sin(state.yaw) };
    spot.stand = { x: position.x, z: position.z };
    spot.yaw = state.yaw;
    // Its sides first (where the character steps off to), then the front.
    spot.approaches = [
      { x: position.x + left.x * 0.85 + forward.x * 0.15, z: position.z + left.z * 0.85 + forward.z * 0.15 },
      { x: position.x - left.x * 0.85 + forward.x * 0.15, z: position.z - left.z * 0.85 + forward.z * 0.15 },
      { x: position.x + forward.x * 0.75, z: position.z + forward.z * 0.75 },
    ];
  }

  /**
   * The circuit each frame: drive the office chair while it is ridden (W/S, A/D), let the tapes drop when something fast
   * goes through, run the traffic light when the rider sits down, and time a lap from the start line to the finish.
   */
  private updateCircuit(delta: number): void {
    const state = this.chairDrive;
    const data = this.outsideData;
    if (!state || !data || !this.circuit) return;
    this.circuitClock += delta;
    const riding = this.riding;
    const driving = riding && this.interaction!.state.stage === 'seated';
    if (riding && !this.wasRiding) this.lightsAt = this.circuitClock;
    this.wasRiding = riding;
    const world = {
      boxes: [...(this.roomData?.boxes ?? []), ...data.boxes],
      floor: data.bounds,
      ground: (x: number, z: number) => groundAt({ x, z }, data) - data.groundY,
    };
    if (driving) {
      const intent = this.keyboard?.intent ?? { forward: 0, right: 0, run: false };
      const knock = driveStep(state, { throttle: intent.forward, steer: -intent.right, nitro: this.nitroHeld }, delta, world);
      if (knock > 1) this.sound('crash', knock);
      this.setMovement('interacting', t('prompt.driving'));
    } else if (Math.hypot(state.vx, state.vz) > 0.01 || state.airborne || Math.abs(state.pitch) > 1e-3) {
      // Nobody pedalling: it rolls to a stop (quickly once the rider gets up) and the seat settles.
      const damping = Math.exp(-delta * (riding ? 6 : 2.5));
      state.vx *= damping;
      state.vz *= damping;
      driveStep(state, { throttle: 0, steer: 0 }, delta, world);
    }
    if (!driving) {
      this.nitroHeld = false;
      state.boosting = false;
    }
    this.poseChair();
    this.updateNitro(delta);
    this.chairPusher = driving ? { x: state.x, y: data.groundY + state.y, z: state.z, yaw: state.yaw } : undefined;
    // What goes through a tape or a line: the chair while ridden, otherwise the character.
    const mover = riding ? { x: state.x, z: state.z } : this.model ? { x: this.model.position.x, z: this.model.position.z } : undefined;
    const speed = riding ? Math.hypot(state.vx, state.vz) : this.controller?.speed ?? 0;
    const last = this.circuitLast;
    if (mover && last) {
      for (const [index, tape] of this.circuit.tapes.entries()) {
        if (tape.cut !== undefined || speed < 1.2) continue;
        const half = tape.length / 2;
        const ax = { x: Math.cos(tape.yaw), z: -Math.sin(tape.yaw) };
        const a = { x: tape.position.x - ax.x * half, z: tape.position.z - ax.z * half };
        const b = { x: tape.position.x + ax.x * half, z: tape.position.z + ax.z * half };
        if (crosses(last, mover, a, b)) {
          this.circuit.cut(index);
          this.sound('tape', 0, tape.position);
        }
      }
      if (driving && this.lines) {
        const across = (line: FloorBlock) => {
          const half = line.size[0] / 2;
          const ax = { x: Math.cos(line.yaw), z: -Math.sin(line.yaw) };
          return crosses(last, mover, { x: line.position.x - ax.x * half, z: line.position.z - ax.z * half }, { x: line.position.x + ax.x * half, z: line.position.z + ax.z * half });
        };
        if (across(this.lines.start) && forwardSpeed(state) > 0) {
          this.lap = { start: this.circuitClock, best: this.lap.best };
          this.sound('lap');
        }
        else if (this.lap.start !== undefined && across(this.lines.finish)) {
          const time = this.circuitClock - this.lap.start;
          const best = Math.min(time, this.lap.best ?? Infinity);
          if (best === time) saveBestLap(time);
          this.sound(best === time ? 'best' : 'lap');
          this.lap = { time, best };
        }
      }
    }
    this.circuitLast = mover;
    const running = this.lap.start !== undefined;
    this.circuit.setLap(running ? this.circuitClock - this.lap.start! : this.lap.time, this.lap.best, running);
    const lit = this.circuitClock - this.lightsAt;
    const light = !riding ? -1 : lit < 0.8 ? 0 : lit < 1.6 ? 1 : lit < 4 ? 2 : -1;
    if (light !== this.lastLight && light >= 0) this.sound(light === 2 ? 'beepGo' : 'beep');
    this.lastLight = light;
    this.circuit.setLights(light);
    this.circuit.update(delta, this.reducedMotion);
    const host = this.host.dataset;
    const drive = driving ? 'driving' : riding ? 'seated' : 'none';
    if (host.drive !== drive) host.drive = drive;
    host.chair = `${state.x.toFixed(2)},${state.z.toFixed(2)},${state.yaw.toFixed(2)},${forwardSpeed(state).toFixed(2)},${state.pitch.toFixed(3)}`;
    const tapes = String(this.circuit.cutCount);
    if (host.tapes !== tapes) host.tapes = tapes;
    const broken = String(this.physics?.broken ?? 0);
    if (host.broken !== broken) host.broken = broken;
    const lap = this.lap.time === undefined ? (running ? 'running' : 'none') : this.lap.time.toFixed(1);
    if (host.lap !== lap) host.lap = lap;
  }

  /** The circuit's tapes whole again and, unless someone rides it, the chair back by the start. */
  private resetCircuit(): void {
    this.circuit?.reset();
    this.spray?.reset((cap) => {
      const home = this.capHomes.get(cap);
      if (!home) return;
      home.parent.add(cap);
      cap.position.copy(home.position);
      cap.quaternion.copy(home.quaternion);
    });
    this.capsPopped = false;
    if (!this.riding && this.chairRest) {
      this.chairDrive = chairAt(this.chairRest.x, this.chairRest.z, this.chairRest.yaw);
      this.poseChair();
    }
    this.lap = { best: this.lap.best };
  }

  /** A sound effect, quieter the further `at` is from the character; `data-sound-last` names the last one heard. */
  private sound(name: SoundName, velocity = 0, at?: { x: number; z: number }): void {
    const sounds = this.options.sounds;
    if (!sounds) return;
    const here = this.model?.position;
    const distance = at && here ? Math.hypot(at.x - here.x, at.z - here.z) : 0;
    if (sounds.play(name, velocity, distance)) this.host.dataset.soundLast = name;
  }

  /**
   * Sounds that follow the state each frame: footsteps on the beats of the walk or run clip (wood in the room,
   * grass on the crossroads green, ground elsewhere), landing, the seat and laptop stages, typing, and the office
   * chair's casters rolling louder and brighter with speed, plus its landing after a ramp.
   */
  private updateSounds(delta: number): void {
    const sounds = this.options.sounds;
    const controller = this.controller;
    if (!sounds || !controller || !this.model) return;
    const airborne = controller.airborne;
    if (this.wasAirborne && !airborne) this.sound(this.stepSound());
    this.wasAirborne = airborne;
    const action = this.actions.get(this.activeClip);
    const locomotion = this.host.dataset.locomotion;
    if (action && !airborne && (locomotion === 'walk' || locomotion === 'run')) {
      // Two steps per loop: on its start and half way.
      const phase = (action.time / action.getClip().duration) % 1;
      const half = phase >= 0.5 ? 1 : 0;
      if (this.stepHalf !== undefined && half !== this.stepHalf) this.sound(this.stepSound());
      this.stepHalf = half;
    } else this.stepHalf = undefined;
    const stage = this.interaction?.phase === 'seated' ? this.interaction.state.stage : 'idle';
    if (stage !== this.lastStage) {
      if (stage === 'sitting' || stage === 'standing') this.sound('creak');
      else if (stage === 'opening') this.sound('lidOpen');
      else if (stage === 'closing') this.sound('lidClose');
      this.lastStage = stage;
    }
    if (stage === 'typing') {
      this.typingIn -= delta;
      if (this.typingIn <= 0) {
        this.sound('key');
        this.typingIn = 0.07 + Math.random() * 0.16;
      }
    }
    const chair = this.chairDrive;
    if (chair) {
      const speed = Math.hypot(chair.vx, chair.vz);
      // The rumble rises quickly and dies away a little slower; it fades with the chair's distance.
      const target = chair.airborne ? 0 : Math.min(speed / DRIVE.maxSpeed, 1);
      this.rolling += (target - this.rolling) * (1 - Math.exp(-delta * (target > this.rolling ? 10 : 5)));
      const away = distanceGain(Math.hypot(chair.x - this.model.position.x, chair.z - this.model.position.z));
      sounds.loop('rolling', this.rolling < 0.02 ? 0 : this.rolling * away, this.rolling);
      if (this.chairAirborne && !chair.airborne) this.sound('crash', 2.5, chair);
      this.chairAirborne = chair.airborne;
    }
  }

  /**
   * The rider of the office chair over the seated clip: the trunk leans forwards when the chair speeds up, back when it
   * brakes and into the turns, and the hands rest on the arm pads. The pose blends in at the end of sitting down and out
   * as the rider stands up.
   */
  private poseRider(delta: number): void {
    const rig = this.circuit?.chair;
    const chair = this.chairDrive;
    const model = this.model;
    if (!rig || !chair || !model) return;
    const stage = this.riding ? this.interaction!.state.stage : 'idle';
    const action = this.actions.get(this.activeClip);
    const progress = action ? action.time / action.getClip().duration : 0;
    const target = stage === 'seated' || (stage === 'sitting' && progress > 0.6) ? 1 : 0;
    this.riderWeight += (target - this.riderWeight) * (1 - Math.exp(-delta * 8));
    if (target === 0 && this.riderWeight < 0.01) this.riderWeight = 0;
    const forward = forwardSpeed(chair);
    if (this.riderLast && delta > 0) {
      const accel = (forward - this.riderLast.forward) / delta;
      this.riderAccel += (accel - this.riderAccel) * (1 - Math.exp(-delta * 12));
      let turned = chair.yaw - this.riderLast.yaw;
      turned = Math.atan2(Math.sin(turned), Math.cos(turned));
      leanStep(this.riderLean, leanTarget(this.riderAccel, turned / delta, chair.boosting), delta);
    }
    this.riderLast = { forward, yaw: chair.yaw };
    for (const [bone, { clip, posed }] of this.riderBones) if (bone.quaternion.equals(posed)) bone.quaternion.copy(clip);
    this.riderBones.clear();
    const weight = this.riderWeight;
    if (weight <= 0) return;
    const names = ['spine', 'chest', 'neck', 'upper_arm_L', 'forearm_L', 'hand_L', 'upper_arm_R', 'forearm_R', 'hand_R'];
    const touched = names.map((name) => model.getObjectByName(name)).filter((bone): bone is Object3D => !!bone);
    for (const bone of touched) this.riderBones.set(bone, { clip: bone.quaternion.clone(), posed: new Quaternion() });
    model.updateMatrixWorld(true);
    const ahead = new Vector3(0, 0, 1).transformDirection(model.matrixWorld);
    const right = new Vector3(-1, 0, 0).transformDirection(model.matrixWorld);
    const bone = (name: string) => model.getObjectByName(name);
    const lean = this.riderLean;
    applyLean({ spine: bone('spine'), chest: bone('chest'), neck: bone('neck') },
      { ...lean, pitch: lean.pitch * weight, roll: lean.roll * weight }, right, ahead);
    // The rig's side names are mirrored: _L is the rider's right arm.
    for (const [side, suffix, out] of [['right', 'L', 1], ['left', 'R', -1]] as const) {
      const pad = rig.armrests[side];
      const upper = bone(`upper_arm_${suffix}`);
      const fore = bone(`forearm_${suffix}`);
      const hand = bone(`hand_${suffix}`);
      if (!pad || !upper || !fore || !hand) continue;
      // The wrist just above the pad, a little ahead of its middle.
      const wrist = pad.getWorldPosition(new Vector3()).addScaledVector(ahead, RIDER_WRIST.ahead).add(new Vector3(0, RIDER_WRIST.up, 0));
      // The elbow bends outwards and back.
      const pole = upper.getWorldPosition(new Vector3()).addScaledVector(right, 0.4 * out).addScaledVector(ahead, -0.5).add(new Vector3(0, -0.3, 0));
      solveArm(upper, fore, hand, wrist, pole, weight);
      restHand(hand, ahead, weight);
    }
    for (const [bone, entry] of this.riderBones) entry.posed.copy(bone.quaternion);
  }

  /** Half the soda drops in low quality or with reduced motion. */
  private nitroDensity(): number {
    return this.quality === 'low' || this.reducedMotion ? 0.5 : 1;
  }

  /**
   * The nitro's show: a pop and a gush when it lights (the caps fly off the first time), the jet and the fizz while it
   * pushes, the bottles emptying with the fuel; `data-nitro` (none | boosting | empty) and `data-fuel`.
   */
  private updateNitro(delta: number): void {
    const rig = this.circuit?.chair;
    const state = this.chairDrive;
    const spray = this.spray;
    if (!rig || !state || !spray || !this.outsideData) return;
    const boosting = state.boosting;
    const back = new Vector3(-Math.sin(state.yaw), 0, -Math.cos(state.yaw));
    const carried = new Vector3(state.vx, state.vy, state.vz);
    const lit = boosting && !this.wasBoosting;
    if (lit) {
      this.sound('pop');
      if (!this.capsPopped) {
        for (const bottle of rig.bottles) if (bottle.cap) spray.launchCap(bottle.cap, back, carried);
        this.capsPopped = true;
      }
    }
    if (boosting) spray.emit(rig.bottles.map((bottle) => bottle.nozzle.getWorldPosition(new Vector3())), back, carried, delta, lit);
    this.wasBoosting = boosting;
    this.options.sounds?.loop('fizz', boosting ? 0.9 : 0, 0.4 + state.fuel * 0.6);
    for (const bottle of rig.bottles) if (bottle.liquid) bottle.liquid.scale.y = Math.max(0.03, state.fuel);
    spray.update(delta, this.outsideData.groundY);
    const nitro = boosting ? 'boosting' : state.fuel < NITRO.restart ? 'empty' : 'none';
    if (this.host.dataset.nitro !== nitro) this.host.dataset.nitro = nitro;
    const fuel = state.fuel.toFixed(2);
    if (this.host.dataset.fuel !== fuel) this.host.dataset.fuel = fuel;
  }

  /** What the feet are on: the room's wooden floor, the crossroads green or the outside ground. */
  private stepSound(): SoundName {
    const position = this.model?.position;
    const data = this.outsideData;
    if (!position || !data) return 'stepWood';
    const { platform } = data;
    if (position.x >= platform.minX && position.x <= platform.maxX && position.z >= platform.minZ && position.z <= platform.maxZ) return 'stepWood';
    const lamp = data.lamppost?.position;
    if (lamp && Math.hypot(position.x - lamp.x, position.z - lamp.z) < CROSSROADS_GREEN) return 'stepGrass';
    return 'stepGround';
  }

  /** Sign zones: the fence of the zone the character walks into rises; leaving it (or jumping out) lowers it. */
  private checkSign(): void {
    if (!this.outsideData || !this.areas || !this.model || this.controller?.airborne) return;
    const sign = signAt({ x: this.model.position.x, z: this.model.position.z }, this.zones, this.sign);
    if (sign?.id === this.sign) return;
    this.sign = sign?.id;
    if (sign) this.sound('zone');
    this.areas.show(sign?.id);
    this.host.dataset.sign = sign?.id ?? 'none';
    this.emitSign();
  }

  /** The HUD link for the link zone the character stands in (reset zones only need Enter on the ground). */
  private emitSign(): void {
    const sign = this.zones.find((entry) => entry.id === this.sign);
    this.events.sign?.(sign?.kind === 'link' ? { id: sign.id, link: sign.link, label: signText(sign).label } : null);
  }

  /** A link zone opens its site in a new tab; a reset zone puts its pieces back (Enter in the zone, or a click on it or the board). */
  private openSign(id: string | undefined): void {
    const sign = id ? this.zones.find((entry) => entry.id === id) : undefined;
    if (!sign) return;
    this.areas?.pulse(sign.id);
    this.sound(sign.kind === 'reset' ? 'reset' : 'open');
    if (sign.kind === 'reset') {
      if (sign.target === 'targets') this.resetTargets();
      else if (sign.target) this.physics?.reset(sign.target);
      if (sign.target === 'circuit') this.resetCircuit();
      if (sign.target === 'tech') this.checkTech();
      if (this.physics) this.pieces?.sync(this.physics.bodies, true);
      this.syncFlaps(true);
      this.reportLetters();
      return;
    }
    window.open(sign.link, '_blank', 'noopener,noreferrer');
  }

  private readonly onLanguage = (): void => {
    if (this.disposed) return;
    this.areas?.setLanguage();
    this.floorTexts?.paint();
    this.signpost?.paint();
    this.about?.paint();
    this.graffiti?.setLanguage(getLanguage());
    this.targetsView?.paint();
    this.bubble?.setLanguage();
    this.notice = { text: '', until: 0 };
    if (this.sign) this.emitSign();
  };

  /** Screen position (CSS px) of the current sign zone's centre, for tests and tooling. */
  private reportSign(): void {
    const center = this.sign && this.renderer ? this.areas?.center(this.sign) : undefined;
    let value = 'none';
    if (center && this.renderer) {
      const point = center.project(this.camera);
      const bounds = this.renderer.domElement.getBoundingClientRect();
      value = `${Math.round(bounds.left + (point.x + 1) / 2 * bounds.width)},${Math.round(bounds.top + (1 - point.y) / 2 * bounds.height)}`;
    }
    if (this.host.dataset.signArea !== value && this.outside) this.host.dataset.signArea = value;
  }

  /** Feet step down onto the outside ground or up onto the room floor over a few frames, not in one jump. */
  private updateElevation(delta: number): void {
    if (!this.model || !this.outsideData) return;
    if (this.riding) {
      // On the office chair the seat carries the character (over ramps and through the air).
      this.elevation = this.model.position.y;
      return;
    }
    const target = groundAt({ x: this.model.position.x, z: this.model.position.z }, this.outsideData);
    if (this.reducedMotion || Math.abs(target - this.elevation) < 1e-3) this.elevation = target;
    else this.elevation += (target - this.elevation) * (1 - Math.exp(-delta * STEP_RATE));
    this.model.position.y = this.elevation;
    const value = this.elevation.toFixed(2);
    if (this.host.dataset.elevation !== value) this.host.dataset.elevation = value;
  }

  /** Piece physics, thrown laptops, the character's blob shadow outside the room, and the ground that follows the view. */
  private updateOutside(delta: number): void {
    if (!this.model || !this.outsideData || !this.shadows) return;
    const lift = this.controller?.lift ?? 0;
    const { x, z } = this.model.position;
    if (this.physics && this.physics.step(delta, { x, y: this.elevation + lift, z }, this.chairPusher)) {
      this.pieces?.sync(this.physics.bodies);
      this.syncFlaps();
      this.reportLetters();
      this.checkTech();
    }
    this.targetsView?.update(delta, this.reducedMotion);
    this.updateReveal(delta);
    if (this.thrown.length || this.physics?.retired.length) this.syncThrown(delta);
    if (this.chickRain && this.physics) {
      this.chickRain.update(delta, this.physics);
      const chicks = String(this.chickRain.count);
      if (this.host.dataset.chicks !== chicks) this.host.dataset.chicks = chicks;
    }
    if (this.elevation < -1e-3 || groundAt({ x, z }, this.outsideData) < 0) {
      const fade = 1 - lift / 0.8;
      this.shadows.set(CHARACTER_SHADOW, x, z, 0, 0.8 * (1 - lift * 0.4), 0.8 * (1 - lift * 0.4), 0.5 * fade);
    } else {
      this.shadows.hide(CHARACTER_SHADOW);
    }
    this.shadows.flush();
  }

  /** Floor keys go down under the character's feet and spring back up when it steps off (not while airborne). */
  private updateKeys(delta: number): void {
    if (!this.floorKeys.length || !this.model || !this.pieces) return;
    const feet = { x: this.model.position.x, z: this.model.position.z };
    const grounded = !this.controller?.airborne;
    const pressed: string[] = [];
    for (const key of this.floorKeys) {
      const down = grounded && onKey(feet, key.area, FOOT_RADIUS);
      if (down) pressed.push(key.name);
      const depth = pressStep(key.depth, down, delta, this.reducedMotion);
      if (depth === key.depth) continue;
      if (key.depth === 0 && depth > 0) this.sound('floorKey');
      key.depth = depth;
      const { position, quaternion } = key.piece;
      this.pieces.set(key.index, { position: { x: position.x, y: position.y - KEY_SINK * depth, z: position.z }, quaternion });
    }
    const value = pressed.join(',') || 'none';
    if (value !== this.pressedKeys) {
      this.pressedKeys = value;
      this.host.dataset.keys = value;
    }
  }

  /** Toppled name letters and bowling pins (data-letters, data-pins). */
  private reportLetters(): void {
    const fallen = this.physics?.fallen(['name', 'tag']) ?? 0;
    const pins = String(this.physics?.fallen(['bowling']) ?? 0);
    if (this.host.dataset.pins !== pins && this.outside) this.host.dataset.pins = pins;
    if (fallen === this.fallenLetters) return;
    this.fallenLetters = fallen;
    this.host.dataset.letters = String(fallen);
  }

  /** The speech bubble over the head while a seat is in reach (free movement only), placed on the screen each frame. */
  private updateBubble(): void {
    if (!this.bubble || !this.model || !this.renderer) return;
    const visible = this.nearSeat && !this.throwing && !this.strike && this.interaction?.phase === 'free' && this.isLocomotion(this.activeClip);
    if (!visible) {
      this.bubble.update(false);
      return;
    }
    const point = this.model.position.clone().setY(this.model.position.y + BUBBLE_HEIGHT).project(this.camera);
    const width = this.host.clientWidth;
    const height = this.host.clientHeight;
    this.bubble.update(true, (point.x + 1) / 2 * width, (1 - point.y) / 2 * height);
  }

  private readonly onPointerDown = (event: PointerEvent): void => {
    this.pointerStart = { x: event.clientX, y: event.clientY };
  };

  /** A click (not a drag of the orbit) on a sign or its floor zone opens its site in a new tab. */
  private readonly onPointerUp = (event: PointerEvent): void => {
    const start = this.pointerStart;
    this.pointerStart = undefined;
    if (!start || Math.hypot(event.clientX - start.x, event.clientY - start.y) > 6) return;
    this.openSign(this.signUnder(event.clientX, event.clientY));
  };

  /** Hover is resolved once per frame at most, however fast pointer events arrive. */
  private readonly onPointerMove = (event: PointerEvent): void => {
    this.hover = { x: event.clientX, y: event.clientY };
  };

  private updateHover(): void {
    if (!this.hover || !this.renderer) return;
    const cursor = this.signUnder(this.hover.x, this.hover.y) ? 'pointer' : '';
    this.hover = undefined;
    if (this.renderer.domElement.style.cursor !== cursor) this.renderer.domElement.style.cursor = cursor;
  }

  private signUnder(clientX: number, clientY: number): string | undefined {
    if (!this.areas || !this.renderer || !this.ready) return undefined;
    const bounds = this.renderer.domElement.getBoundingClientRect();
    this.pointer.set((clientX - bounds.left) / bounds.width * 2 - 1, -((clientY - bounds.top) / bounds.height) * 2 + 1);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    return this.areas.hit(this.raycaster)?.id;
  }

  /** Where the room camera should look: the character (at the room's mid height), or the model centre in the studio. */
  private focusTarget(): Vector3 {
    if (!this.room || !this.model) return this.center.clone();
    return new Vector3(this.model.position.x, this.center.y, this.model.position.z);
  }

  /** Move camera and orbit target together towards the character, keeping the current angle and zoom. */
  private followCharacter(delta: number): void {
    if (!this.room || !this.model || !this.controls) return;
    const target = this.focusTarget();
    const before = this.focus.clone();
    if (this.reducedMotion) this.focus.copy(target);
    else this.focus.lerp(target, 1 - Math.exp(-delta * FOLLOW_RATE));
    const shift = this.focus.clone().sub(before);
    if (shift.lengthSq() === 0) return;
    this.camera.position.add(shift);
    this.controls.target.add(shift);
  }

  /** Fixed isometric camera that follows the character, or the free limited orbit. */
  setCameraMode(mode: CameraMode): void {
    if (this.disposed || !['follow', 'free'].includes(mode)) return;
    this.cameraMode = mode;
    this.applyCameraMode();
    if (mode === 'follow' && this.ready) this.setView('three-quarter');
  }

  private applyCameraMode(): void {
    if (!this.controls) return;
    const locked = this.inRoom && this.cameraMode === 'follow';
    this.controls.enableRotate = !locked;
    this.controls.enableZoom = !locked;
    this.host.dataset.camera = this.inRoom ? this.cameraMode : 'studio';
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
    const center = this.room ? this.focus : this.center;
    if (this.controls) {
      this.controls.enableDamping = false;
      this.controls.update();
      this.controls.target.copy(center);
    }
    this.camera.position.copy(center).add(directions[preset].normalize().multiplyScalar(this.cameraDistance));
    // The fixed room camera keeps the widest zoom of the orbit.
    this.camera.zoom = this.inRoom && this.cameraMode === 'follow' && this.controls ? this.controls.minZoom : 1;
    this.camera.lookAt(center);
    this.camera.updateProjectionMatrix();
    this.controls?.update();
    if (this.controls) this.controls.enableDamping = damping ?? !this.reducedMotion;
  }

  zoom(factor: number): void {
    if (!this.ready || this.contextLost || !this.controls || (this.inRoom && this.cameraMode === 'follow')) return;
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
      this.ground?.setLight(violet);
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

  /** Pixel ratio range and shadows for a quality preset; applies live, without reloading the scene. */
  setQuality(quality: QualityId): void {
    if (this.disposed) return;
    this.quality = quality;
    if (this.spray) this.spray.density = this.nitroDensity();
    const profile = QUALITY[quality];
    const range = ratioRange(quality, window.devicePixelRatio);
    this.pixelRatio = Math.min(range.max, Math.max(range.min, quality === 'auto' ? this.pixelRatio : range.max));
    this.framesSinceAdjust = 0;
    // Only the key light casts shadows. Toggling castShadow recompiles the lit materials on the next frame.
    this.key.castShadow = profile.shadows;
    if (this.key.shadow.mapSize.x !== profile.shadowSize) {
      this.key.shadow.mapSize.set(profile.shadowSize, profile.shadowSize);
      this.key.shadow.map?.dispose();
      this.key.shadow.map = null;
    }
    this.host.dataset.quality = quality;
    this.host.dataset.shadows = String(profile.shadows);
    this.resize();
  }

  /** The key the sign zones' labels show: ENTER, a gamepad button, or none on a touch screen. */
  setOpenKey(key: string): void {
    this.openKeyLabel = key;
    this.areas?.setOpenKey(key);
  }

  /** The page's actions: the keyboard, which the touch controls and a gamepad feed too. */
  get input(): KeyboardInput | undefined {
    return this.keyboard;
  }

  /** Keys drive the character only while this is on (the room page holds them until START is pressed). */
  setInputEnabled(enabled: boolean): void {
    if (!this.keyboard) return;
    this.keyboard.enabled = enabled;
    if (!enabled) this.keyboard.clear();
  }

  setReducedMotion(enabled: boolean): void {
    if (this.disposed) return;
    this.reducedMotion = enabled;
    if (this.spray) this.spray.density = this.nitroDensity();
    if (this.controls) this.controls.enableDamping = !enabled;
    this.areas?.setReducedMotion(enabled);
    this.host.dataset.reducedMotion = String(enabled);
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
    this.outside?.traverse(apply);
    this.host.dataset.wireframe = String(enabled);
  }

  private isLocomotion(clip: string): boolean {
    return LOCOMOTION.has(clip) || clip in CLIP_ALTERNATIVES;
  }

  /** The clip that plays for a gait: the chosen one when this model has it, else the procedural one (or walk). */
  private gaitClip(gait: Gait): string {
    if (this.actions.has(this.gait[gait])) return this.gait[gait];
    return this.actions.has(gait) ? gait : 'walk';
  }

  /** Clip rates and jump timing follow the clips in use; hooks data-walk-clip/data-run-clip/data-jump-clip. */
  private syncGait(): void {
    const controller = this.controller!;
    const walk = this.gaitClip('walk');
    const run = this.gaitClip('run');
    const jump = this.gaitClip('jump');
    controller.walkClipSpeed = CLIP_ALTERNATIVES[walk]?.speed ?? WALK_CLIP_SPEED;
    controller.runClipSpeed = CLIP_ALTERNATIVES[run]?.speed ?? RUN_CLIP_SPEED;
    if (!controller.jumping) controller.jumpSpec = CLIP_ALTERNATIVES[jump]?.jump ?? JUMP;
    for (const [key, clip] of [['walkClip', walk], ['runClip', run], ['jumpClip', jump]] as const) {
      if (this.host.dataset[key] !== clip) this.host.dataset[key] = clip;
    }
  }

  /** Which clip plays while walking, running or jumping with the keyboard: the procedural one or a matching alternative. */
  setGaitClip(gait: Gait, name: string): void {
    if (this.disposed || (name !== gait && CLIP_ALTERNATIVES[name]?.gait !== gait)) return;
    const previous = this.gaitClip(gait);
    this.gait[gait] = name;
    if (!this.controller) return;
    this.syncGait();
    const next = this.gaitClip(gait);
    if (gait !== 'jump' && this.activeClip === previous && this.driving && next !== previous) this.selectClip(next);
  }

  /** A clip picked by hand in the UI: it takes over from any seat interaction in progress. */
  chooseClip(name: string): void {
    this.throwing = false;
    this.cancelStrike();
    this.dropHeldLaptop();
    if (this.interaction && this.interaction.phase !== 'free') {
      this.interaction.reset();
      this.syncLaptop(0);
    }
    this.selectClip(name);
  }

  selectClip(name: string, loop = true): void {
    const action = this.actions.get(name);
    if (!action || !this.mixer || this.disposed || name === this.activeClip) return;
    action.setLoop(loop ? LoopRepeat : LoopOnce, Infinity);
    action.clampWhenFinished = !loop;
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
    if (this.ready && this.room) {
      if (this.interaction && this.interaction.phase !== 'free') this.driveInteraction(delta);
      else this.drive(delta);
      this.updateCircuit(delta);
      // The chair moved after the rider was placed for this frame: put the rider back on its seat.
      if (this.riding) this.placeForClip(this.activeClip);
      this.syncLaptop(delta);
      this.updateElevation(delta);
      this.updateOutside(delta);
      this.updateKeys(delta);
      this.checkSign();
    }
    if (this.ready && this.mixer && this.playing) {
      this.mixer.update(delta);
      this.updateThrow();
      this.updateStrike(delta);
      this.poseRider(delta);
      if (this.fadeRemaining > 0) {
        this.fadeRemaining -= delta * this.speed;
        if (this.fadeRemaining <= 0) this.finishFade();
      }
      this.emitAnimation();
    }
    if (this.ready && this.room) {
      this.followCharacter(delta);
      this.updateSounds(delta);
    }
    this.controls?.update();
    this.areas?.update(delta);
    this.about?.update(delta, this.reducedMotion);
    this.updateHover();
    this.reportSign();
    this.updateBubble();
    this.updateChargeMeter();
    if (this.ground && this.model) this.ground.update(this.camera, this.model.position);
    this.renderer.render(this.scene, this.camera);
    this.sampleRender(frame);
  };

  /** Draw calls and triangles of the last frame plus the average frame time, reported about twice a second. */
  private sampleRender(frame: number | undefined): void {
    if (!this.renderer || frame === undefined || frame > 250) return;
    const sample = this.sample;
    sample.frames += 1;
    sample.time += frame;
    sample.calls = this.renderer.info.render.calls;
    sample.triangles = this.renderer.info.render.triangles;
    if (sample.time < 500) return;
    const frameMs = sample.time / sample.frames;
    const stats: RenderStats = { fps: 1000 / frameMs, frameMs, pixelRatio: this.pixelRatio, drawCalls: sample.calls, triangles: sample.triangles };
    this.sample = { frames: 0, time: 0, calls: 0, triangles: 0 };
    this.host.dataset.drawCalls = String(stats.drawCalls);
    this.host.dataset.frameMs = frameMs.toFixed(1);
    this.events.render?.(stats);
  }

  private adaptResolution(frame: number): void {
    if (frame > 250) return; // a stall (tab switch, GC) is not a steady frame rate
    this.frameAverage += (frame - this.frameAverage) * 0.05;
    if (++this.framesSinceAdjust < 90) return;
    const next = nextPixelRatio(this.pixelRatio, this.frameAverage, ratioRange(this.quality, window.devicePixelRatio));
    this.framesSinceAdjust = 0;
    if (next === this.pixelRatio) return;
    this.pixelRatio = next;
    this.resize();
  }

  /** Camera angle and zoom as azimuth,polar,zoom (test hook; the target may move with the character). */
  private readonly onCameraChange = (): void => {
    if (!this.controls) return;
    const orbit = `${this.controls.getAzimuthalAngle().toFixed(3)},${this.controls.getPolarAngle().toFixed(3)},${this.camera.zoom.toFixed(3)}`;
    if (this.host.dataset.orbit !== orbit) this.host.dataset.orbit = orbit;
  };

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
    this.events.status({ kind: 'error', title: t('viewer.contextLost'), detail: t('viewer.contextLostDetail') });
  };

  private readonly onContextRestored = (): void => {
    if (this.disposed) return;
    this.contextLost = false;
    this.resetDelta();
    if (this.controls) this.controls.enabled = this.ready;
    this.renderer?.setAnimationLoop(this.animate);
    if (this.ready) this.showReady();
    else this.events.status({ kind: 'loading', title: t('viewer.loading', { label: modelVersions[this.options.modelId].label }), detail: t('viewer.contextBack', { file: modelVersions[this.options.modelId].file }) });
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
    this.controls?.removeEventListener('change', this.onCameraChange);
    this.controls?.dispose();
    this.resetDelta();
    this.mixer?.stopAllAction();
    if (this.model) this.mixer?.uncacheRoot(this.model);
    this.actions.clear();
    this.mixer = undefined;
    this.activeClip = '';
    this.events.animation(null);
    this.events.movement?.(null);
    this.events.render?.(null);
    this.areas?.dispose();
    this.floorTexts?.dispose();
    this.signpost?.dispose();
    this.about?.dispose();
    this.graffiti?.dispose();
    this.targetsView?.dispose();
    this.bubble?.dispose();
    this.chargeMeter?.dispose();
    this.clearThrown();
    this.chickRain?.dispose();
    this.ground?.dispose();
    this.shadows?.dispose();
    this.pieces?.dispose();
    this.physics = undefined;
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

/** Whether the step from `from` to `to` crosses the segment a–b. */
function crosses(from: { x: number; z: number }, to: { x: number; z: number }, a: { x: number; z: number }, b: { x: number; z: number }): boolean {
  const side = (p: { x: number; z: number }, q: { x: number; z: number }, r: { x: number; z: number }) => (q.x - p.x) * (r.z - p.z) - (q.z - p.z) * (r.x - p.x);
  const d1 = side(a, b, from);
  const d2 = side(a, b, to);
  const d3 = side(from, to, a);
  const d4 = side(from, to, b);
  return d1 * d2 < 0 && d3 * d4 < 0;
}

/** The best lap is kept in this browser (blocked storage just forgets it). */
const BEST_LAP_KEY = 'simulation-3d:best-lap';

function readBestLap(): number | undefined {
  try {
    const value = Number(window.localStorage.getItem(BEST_LAP_KEY));
    return Number.isFinite(value) && value > 0 ? value : undefined;
  } catch {
    return undefined;
  }
}

function saveBestLap(seconds: number): void {
  try {
    window.localStorage.setItem(BEST_LAP_KEY, seconds.toFixed(2));
  } catch {
    // Storage unavailable: the best lap lasts for this visit only.
  }
}
