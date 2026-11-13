import {
  AnimationMixer, Box3, CanvasTexture, Color, ConeGeometry, CylinderGeometry, DirectionalLight, DodecahedronGeometry, DoubleSide, Group,
  HemisphereLight, InstancedMesh, LoopRepeat, Matrix4, Mesh, MeshBasicMaterial, MeshStandardMaterial, Object3D, OrthographicCamera, Plane,
  PlaneGeometry, Quaternion, RepeatWrapping, SRGBColorSpace, Scene, SkinnedMesh, TorusGeometry, Vector3, type BufferGeometry, type WebGLRenderer,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { createRenderer } from '../../core/renderer.ts';
import { disposeObjects } from '../../core/loadAssets.ts';
import { QUALITY, ratioRange, type QualityId } from '../../core/quality.ts';
import { mergeSkinnedMeshes, mergeStaticMeshes } from '../../scene/mergeStatic.ts';
import { takeHalloween, wearMask } from '../../scene/halloweenDress.ts';
import { hideCap, takeChristmas } from '../../scene/christmasDress.ts';
import { BREW, SNOW_JET, SODA, SodaSpray } from '../../scene/SodaSpray.ts';
import {
  RIDER_BONES, SLEIGH_FLOOR, clipModel, hangVessel, mountRider, poseRider, takeChairRig, type ChairRig,
} from '../../character/riderSeat.ts';
import { leanStep, leanTarget, restLean } from '../../character/riderPose.ts';
import type { Sounds } from '../../audio/Sounds.ts';
import { SLED, type ObstacleKind, type SledEvent, type SledRun } from './sledRun.ts';

export type Season = 'none' | 'halloween' | 'christmas';
export type SledAssets = { character: GLTF; circuit: GLTF; halloween?: GLTF; christmas?: GLTF };
export type SledViewOptions = { season: Season; quality: QualityId; reducedMotion: boolean; sounds?: Sounds };

/** How steep the slope is (rad): everything sits in one group tilted down along +X, the way the chair goes. */
const SLOPE = 0.2;
/**
 * The camera looks ahead of the chair down the slope by this share of the picture's smaller half side, so most of the
 * picture is what is coming and the chair stays in it on a narrow screen too.
 */
const LOOK_AHEAD = 0.75;
/** The same isometric angle as the world (CharacterViewer ROOM_VIEW): the slope runs down to the bottom right. */
const VIEW = new Vector3(1, 0.95, 1).normalize();
/**
 * The picture's half height and half width (m): about `perPixel` pixels a metre in a larger window, never closer than
 * `height`, never narrower than `width` (the three lanes always fit across).
 */
const FRAME = { height: 4.4, width: 5.6, pixels: 61 };
/** The ground: `span` long down the slope from `back` behind the chair, `width` across; its pattern repeats every `tile` m. */
const GROUND = { span: 150, back: 40, width: 60, tile: 10 } as const;
/** The lanes' outer edges are this far from the middle (m). */
const TRACK_HALF = SLED.laneWidth * 1.5;
/** Trees and rocks along both sides, recycled down the slope between `from` and `from + span` (m from the chair). */
const SCENERY = { trees: 34, rocks: 16, from: -30, span: 110 } as const;
/** How far the pickup bottles are scaled up to read at this distance, and how high they float. */
const BOTTLE = { scale: 2.5, height: 0.7 } as const;

type Palette = {
  background: number; track: string; off: string; speck: string; line: string; edge: string;
  sky: number; ground: number; hemi: number; sun: number; sunIntensity: number; leaves: number; trunk: number; rock: number; glow: number; snowCaps: boolean;
};

const PALETTES: Record<Season, Palette> = {
  none: {
    background: 0x221a35, track: '#463a68', off: '#2c2346', speck: '#ffffff', line: '#c9b4ff', edge: '#8f74e8',
    sky: 0xd9ccff, ground: 0x3a2d58, hemi: 1.15, sun: 0xfff1dc, sunIntensity: 2.3, leaves: 0x2f7a55, trunk: 0x5a3b2a, rock: 0x6c6680, glow: 0xffb347, snowCaps: false,
  },
  halloween: {
    background: 0x1e1328, track: '#5a3f30', off: '#33223f', speck: '#ff9a3c', line: '#ff8a1f', edge: '#ff6a00',
    sky: 0xb7a6ff, ground: 0x3a2440, hemi: 1.25, sun: 0xc4d2ff, sunIntensity: 2.3, leaves: 0x3b2d4e, trunk: 0x3a2820, rock: 0x5e566c, glow: 0x7dff5a, snowCaps: false,
  },
  christmas: {
    background: 0xd6e0ee, track: '#f4f7fb', off: '#e3eaf4', speck: '#9fb6d6', line: '#d8202c', edge: '#e05a63',
    sky: 0xffffff, ground: 0x9fb2cc, hemi: 1.15, sun: 0xfff4e6, sunIntensity: 2.0, leaves: 0x1f5a3e, trunk: 0x5a3b2a, rock: 0x8a93a6, glow: 0x2f8be0, snowCaps: true,
  },
};

/** circuit.glb objects each obstacle is made of, and how many stand side by side across the lane. */
const OBSTACLE_PARTS: Record<ObstacleKind, { names: string[]; across?: number }> = {
  cones: { names: ['Circuit_cone', 'Circuit_cone', 'Circuit_cone'], across: 0.72 },
  drums: { names: ['Circuit_drum', 'Circuit_drum'], across: 0.85 },
  jersey: { names: ['Circuit_jersey'] },
  fence: { names: ['Circuit_metal'] },
  tyres: { names: ['Circuit_tyres', 'Circuit_tyres'], across: 0.95 },
  pipe: { names: ['Circuit_pipe'] },
  barrow: { names: ['Circuit_barrow'] },
  works: { names: ['Circuit_works', 'Circuit_chevron'], across: 0.95 },
  sacks: { names: ['Circuit_sack', 'Circuit_sack'], across: 0.95 },
};

type Flying = { object: Object3D; velocity: Vector3; spin: Vector3; age: number };

/** A seeded number in [0, 1) from an index (the scenery's places never change). */
const hash = (index: number) => {
  const x = Math.sin(index * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};

/** A distance wrapped into [from, from + span). */
const wrap = (value: number, from: number, span: number) => ((((value - from) % span) + span) % span) + from;

/**
 * The chair downhill drawn: an isometric picture of a slope going down to the bottom right, the lanes painted on it,
 * the circuit's works blocking lanes, soda bottles floating over them, trees and rocks along the sides; the character
 * on the office chair (or Halloween's cauldron, Christmas' sleigh) leaning into the lane changes and back with the
 * nitro. The world scrolls past the chair, which stays at the slope's origin.
 */
export class SledRunView {
  readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 200);
  private readonly slope = new Group();
  private readonly sun: DirectionalLight;
  private readonly palette: Palette;
  private readonly options: SledViewOptions;
  private readonly roots: Object3D[];
  private readonly ground: Mesh<PlaneGeometry, MeshStandardMaterial>;
  private readonly groundTexture: CanvasTexture;
  private readonly templates = new Map<string, Object3D>();
  private readonly obstacles = new Map<number, Object3D>();
  private readonly bottles = new Map<number, Object3D>();
  private readonly flying: Flying[] = [];
  private readonly popping: { object: Object3D; age: number }[] = [];
  private readonly bottleTemplate: Object3D;
  private readonly bottleMaterials: MeshStandardMaterial[] = [];
  private readonly scenery: { mesh: InstancedMesh; spots: { x: number; z: number; scale: number; turn: number }[] }[] = [];
  private readonly sceneryParts: { geometry: BufferGeometry; material: MeshStandardMaterial }[] = [];
  private readonly model: Object3D;
  private readonly mixer: AnimationMixer;
  private readonly rig: ChairRig;
  private readonly rider: Object3D;
  private readonly chair = new Group();
  private readonly vessel?: Object3D;
  private readonly clipHeight: number = 0;
  private readonly clipPlane = new Plane(new Vector3(0, 1, 0), 1e4);
  private readonly spray: SodaSpray;
  private readonly lean = restLean();
  private readonly posedBones = new Map<Object3D, { clip: Quaternion; posed: Quaternion }>();
  private lastSpeed = 0;
  private lastX = 1;
  private shake = 0;
  private boosting = false;
  private half: number = FRAME.height;
  private time = 0;

  constructor(assets: SledAssets, options: SledViewOptions) {
    this.options = options;
    this.palette = PALETTES[options.season];
    this.renderer = createRenderer();
    this.renderer.setPixelRatio(ratioRange(options.quality, window.devicePixelRatio || 1).max);
    this.renderer.shadowMap.enabled = QUALITY[options.quality].shadows;
    this.renderer.domElement.removeAttribute('aria-label');
    this.renderer.domElement.setAttribute('aria-hidden', 'true');
    this.renderer.domElement.className = 'sled-canvas';
    this.roots = [assets.character.scene, assets.circuit.scene, ...(assets.halloween ? [assets.halloween.scene] : []), ...(assets.christmas ? [assets.christmas.scene] : [])];
    this.scene.background = new Color(this.palette.background);
    this.slope.rotation.z = -SLOPE;
    this.scene.add(this.slope);

    const hemi = new HemisphereLight(this.palette.sky, this.palette.ground, this.palette.hemi);
    this.sun = new DirectionalLight(this.palette.sun, this.palette.sunIntensity);
    this.sun.castShadow = QUALITY[options.quality].shadows;
    const size = Math.min(QUALITY[options.quality].shadowSize, 1024);
    this.sun.shadow.mapSize.set(size, size);
    Object.assign(this.sun.shadow.camera, { left: -16, right: 16, top: 16, bottom: -16, near: 1, far: 70 });
    this.sun.shadow.bias = -0.0006;
    this.scene.add(hemi, this.sun, this.sun.target);

    this.groundTexture = this.paintGround();
    this.ground = new Mesh(new PlaneGeometry(GROUND.span, GROUND.width), new MeshStandardMaterial({ map: this.groundTexture, roughness: 0.95 }));
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.position.x = GROUND.span / 2 - GROUND.back;
    this.ground.receiveShadow = true;
    this.slope.add(this.ground);
    this.buildScenery();
    this.takeTemplates(assets.circuit.scene);

    // The chair, its rider's root and, for a season, the vessel in its place.
    const chairObject = assets.circuit.scene.getObjectByName('OfficeChair');
    const rig = chairObject ? takeChairRig(chairObject) : undefined;
    if (!chairObject || !rig) throw new Error('SLED_NO_CHAIR');
    chairObject.removeFromParent();
    chairObject.position.set(0, 0, 0);
    chairObject.rotation.set(0, 0, 0);
    this.chair.add(chairObject);
    // Facing down the slope (+X).
    this.chair.rotation.y = Math.PI / 2;
    this.slope.add(this.chair);
    this.rig = rig;
    const { rider, offset } = mountRider(rig);
    this.rider = rider;
    let bottleParts = /^ChairBottle(Liquid|Cap)?_right$/;
    let bottleRoot: Object3D = chairObject;
    let nozzle = 'ChairNozzle_right';
    const dress = assets.halloween ? takeHalloween(assets.halloween.scene) : undefined;
    const xmas = assets.christmas ? takeChristmas(assets.christmas.scene) : undefined;
    if (dress?.cauldron) {
      this.vessel = dress.cauldron;
      this.clipHeight = dress.brew.height;
      bottleRoot = dress.cauldron;
      bottleParts = /^CauldronTube(Liquid|Cork)?_right$/;
      nozzle = 'CauldronNozzle_right';
    } else if (xmas?.sleigh) {
      this.vessel = xmas.sleigh;
      this.clipHeight = SLEIGH_FLOOR;
      bottleRoot = xmas.sleigh;
      bottleParts = /^(SleighThruster|SleighFuelGlass|SleighFuel)_right$/;
      nozzle = 'SleighNozzle_right';
    }
    this.bottleTemplate = this.makeBottle(bottleRoot, bottleParts, nozzle);
    if (this.vessel) hangVessel(rig, rider, offset, this.vessel, dress?.cauldron ? 'cauldron' : 'sleigh');
    chairObject.traverse((object) => {
      if (!(object instanceof Mesh)) return;
      object.castShadow = object.castShadow || !this.vessel;
      object.receiveShadow = true;
    });

    // The character, seated: its own copy (the world's is merged and dressed for the world).
    this.model = assets.character.scene;
    mergeStaticMeshes(this.model);
    mergeSkinnedMeshes(this.model);
    if (dress?.mask) wearMask(this.model, dress.mask);
    if (xmas?.hat) {
      hideCap(this.model);
      wearMask(this.model, xmas.hat);
      xmas.hat.traverse((object) => {
        if (object instanceof Mesh) for (const material of Array.isArray(object.material) ? object.material : [object.material]) material.side = DoubleSide;
      });
    }
    this.model.traverse((object) => {
      if (!(object instanceof Mesh)) return;
      object.castShadow = true;
      object.receiveShadow = true;
      if (object instanceof SkinnedMesh) object.frustumCulled = false;
    });
    if (this.vessel) {
      this.renderer.localClippingEnabled = true;
      clipModel(this.model, this.clipPlane);
    }
    this.scene.add(this.model);
    this.mixer = new AnimationMixer(this.model);
    const clip = assets.character.animations.find((candidate) => candidate.name === 'seated_chair') ?? assets.character.animations[0];
    if (clip) this.mixer.clipAction(clip).setLoop(LoopRepeat, Infinity).play();

    this.spray = new SodaSpray(dress?.cauldron ? BREW : xmas?.sleigh ? SNOW_JET : SODA);
    this.spray.density = options.quality === 'low' || options.reducedMotion ? 0.5 : 1;
    this.scene.add(this.spray.mesh);
    for (const bottle of rig.bottles) if (bottle.liquid) bottle.liquid.scale.y = 0.05;
  }

  /** The canvas to put on the page. */
  get canvas(): HTMLCanvasElement {
    return this.renderer.domElement;
  }

  resize(width: number, height: number): void {
    if (width < 2 || height < 2) return;
    this.renderer.setSize(width, height, false);
    const aspect = width / height;
    const half = Math.max(FRAME.height, height / 2 / FRAME.pixels, FRAME.width / aspect);
    this.half = Math.min(half, half * aspect);
    Object.assign(this.camera, { left: -half * aspect, right: half * aspect, top: half, bottom: -half });
    this.camera.updateProjectionMatrix();
  }

  /** Bring the picture up to the run's state after a step of `dt` seconds (or a still frame, dt 0). */
  update(run: SledRun, dt: number, events: readonly SledEvent[]): void {
    this.time += dt;
    const sounds = this.options.sounds;
    for (const event of events) {
      if (event.type === 'crash' || event.type === 'smash') {
        this.launch(event.id, run, event.type === 'smash');
        if (event.type === 'crash') {
          this.shake = this.options.reducedMotion ? 0 : 0.45;
          sounds?.play('crash', 3.5);
        } else sounds?.play('metal', 3);
      } else if (event.type === 'bottle') {
        const bottle = this.bottles.get(event.id);
        if (bottle) {
          this.bottles.delete(event.id);
          this.popping.push({ object: bottle, age: 0 });
        }
        sounds?.play('pop', 1);
      }
    }

    // The ground and the scenery slide back up the slope.
    this.groundTexture.offset.x = run.distance / GROUND.tile;
    this.placeScenery(run.distance);
    this.placeObstacles(run, dt);
    this.placeBottles(run, dt);

    // The chair: across the lanes, turned a little into a lane change, rocking on the bumps.
    const z = (1 - run.x) * SLED.laneWidth;
    const lateral = dt > 0 ? (run.x - this.lastX) / dt : 0;
    this.lastX = run.x;
    const turn = Math.max(-0.35, Math.min(0.35, lateral * 0.09));
    this.chair.position.set(0, run.phase === 'playing' && !this.options.reducedMotion ? Math.abs(Math.sin(this.time * 17)) * 0.015 : 0, z);
    this.chair.rotation.y = Math.PI / 2 + turn;
    const rig = this.rig;
    for (const caster of rig.casters) caster.rotation.y = turn * 2;
    for (const wheel of rig.wheels) wheel.rotation.x = run.distance / 0.05;
    const accel = dt > 0 ? (run.speed - this.lastSpeed) / dt : 0;
    this.lastSpeed = run.speed;
    if (dt > 0) leanStep(this.lean, leanTarget(accel * 0.5, lateral * 0.9, run.nitro > 0), dt);
    rig.upper.rotation.set(-this.lean.pitch * 0.25, 0, this.lean.roll * 0.3);
    // Blinking while it recovers from a crash.
    const shown = run.recover <= 0 || Math.floor(this.time * 12) % 2 === 0;
    this.chair.visible = shown;
    this.model.visible = shown;
    this.scene.updateMatrixWorld(true);

    // The rider on the seat: placed where the rider's root is (not scaled with the chair), posed over the seated clip.
    for (const [bone, { clip, posed }] of this.posedBones) if (bone.quaternion.equals(posed)) bone.quaternion.copy(clip);
    this.posedBones.clear();
    this.rider.getWorldPosition(this.model.position);
    this.rider.getWorldQuaternion(this.model.quaternion);
    this.mixer.update(dt);
    this.model.updateMatrixWorld(true);
    for (const name of RIDER_BONES) {
      const bone = this.model.getObjectByName(name);
      if (bone) this.posedBones.set(bone, { clip: bone.quaternion.clone(), posed: new Quaternion() });
    }
    poseRider(this.model, rig, this.lean, 1);
    for (const [bone, entry] of this.posedBones) entry.posed.copy(bone.quaternion);
    if (this.vessel) {
      const surface = this.vessel.localToWorld(new Vector3(0, this.clipHeight, 0));
      const up = new Vector3(0, 1, 0).applyQuaternion(this.vessel.getWorldQuaternion(new Quaternion()));
      this.clipPlane.setFromNormalAndCoplanarPoint(up, surface);
    }

    this.updateNitro(run, dt);
    sounds?.loop('rolling', run.phase === 'playing' ? Math.min(1, run.speed / SLED.speed.max) * 0.8 : 0, Math.min(1, run.speed / SLED.speed.max));

    // The camera: the same isometric angle, looking ahead of the chair.
    const target = this.slope.localToWorld(new Vector3(LOOK_AHEAD * this.half, 0, z * 0.35));
    if (this.shake > 0) {
      target.x += (Math.random() - 0.5) * this.shake;
      target.y += (Math.random() - 0.5) * this.shake;
      this.shake = Math.max(0, this.shake - dt * 1.4);
    }
    this.camera.position.copy(target).addScaledVector(VIEW, 60);
    this.camera.lookAt(target);
    this.sun.position.copy(target).add(new Vector3(-7, 18, 8));
    this.sun.target.position.copy(target);
  }

  /** Compile the shaders before the first picture (a frame that compiles them would stall the race). */
  async compile(): Promise<void> {
    await this.renderer.compileAsync(this.scene, this.camera).catch(() => undefined);
  }

  render(): void {
    this.renderer.render(this.scene, this.camera);
  }

  /** Back to the start: no flying pieces or bottles, the nitro off. */
  reset(): void {
    for (const object of [...this.obstacles.values(), ...this.bottles.values(), ...this.flying.map((entry) => entry.object), ...this.popping.map((entry) => entry.object)]) object.removeFromParent();
    this.obstacles.clear();
    this.bottles.clear();
    this.flying.length = 0;
    this.popping.length = 0;
    this.shake = 0;
    this.boosting = false;
    this.options.sounds?.loop('fizz', 0, 1);
  }

  /** Quiet the loops (paused or over). */
  silence(): void {
    this.options.sounds?.loop('rolling', 0, 0);
    this.options.sounds?.loop('fizz', 0, 1);
  }

  dispose(): void {
    this.silence();
    this.reset();
    disposeObjects([...this.roots, this.slope, this.spray.mesh]);
    this.groundTexture.dispose();
    for (const material of this.bottleMaterials) material.dispose();
    this.bottleTemplate.traverse((object) => {
      if (object.name === 'BottleRing' && object instanceof Mesh) {
        object.geometry.dispose();
        (object.material as MeshBasicMaterial).dispose();
      }
    });
    for (const part of this.sceneryParts) {
      part.geometry.dispose();
      part.material.dispose();
    }
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.renderer.domElement.remove();
  }

  /** The lanes on the ground: the track between solid edges, dashed lines between the lanes, specks of grit or snow. */
  private paintGround(): CanvasTexture {
    const palette = this.palette;
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 1024;
    const context = canvas.getContext('2d')!;
    const perMetre = canvas.height / GROUND.width;
    const row = (z: number) => canvas.height / 2 + z * perMetre;
    context.fillStyle = palette.off;
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = palette.track;
    context.fillRect(0, row(-TRACK_HALF), canvas.width, TRACK_HALF * 2 * perMetre);
    // Grit or snow, the same on every tile.
    let seed = 7;
    const next = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    context.fillStyle = palette.speck;
    for (let i = 0; i < 900; i++) {
      context.globalAlpha = 0.04 + next() * 0.08;
      const size = 1 + next() * 2.5;
      context.fillRect(next() * canvas.width, next() * canvas.height, size, size);
    }
    context.globalAlpha = 1;
    context.fillStyle = palette.edge;
    for (const z of [-TRACK_HALF, TRACK_HALF]) context.fillRect(0, row(z) - 0.12 * perMetre, canvas.width, 0.24 * perMetre);
    context.fillStyle = palette.line;
    context.globalAlpha = 0.75;
    const dash = canvas.width / 4;
    for (const z of [-SLED.laneWidth / 2, SLED.laneWidth / 2]) {
      for (let x = 0; x < canvas.width; x += dash * 2) context.fillRect(x, row(z) - 0.07 * perMetre, dash, 0.14 * perMetre);
    }
    context.globalAlpha = 1;
    const texture = new CanvasTexture(canvas);
    texture.colorSpace = SRGBColorSpace;
    texture.wrapS = RepeatWrapping;
    texture.repeat.set(GROUND.span / GROUND.tile, 1);
    texture.anisotropy = 4;
    return texture;
  }

  /** Pines and rocks either side of the track, as instanced meshes (snow on the pines at Christmas). */
  private buildScenery(): void {
    const palette = this.palette;
    const tiers = [0, 1, 2].map((tier) => new ConeGeometry(1.15 - tier * 0.28, 1.3, 7).translate(0, 1.2 + tier * 0.75, 0));
    const leaves = mergeGeometries(tiers);
    tiers.forEach((geometry) => geometry.dispose());
    const parts: { geometry: BufferGeometry; color: number; count: number; kind: 'tree' | 'rock' }[] = [
      { geometry: leaves, color: palette.leaves, count: SCENERY.trees, kind: 'tree' },
      { geometry: new CylinderGeometry(0.14, 0.2, 0.9, 6).translate(0, 0.45, 0), color: palette.trunk, count: SCENERY.trees, kind: 'tree' },
      { geometry: new DodecahedronGeometry(0.7, 0).scale(1.3, 0.75, 1), color: palette.rock, count: SCENERY.rocks, kind: 'rock' },
    ];
    if (palette.snowCaps) parts.push({ geometry: new ConeGeometry(0.42, 0.55, 7).translate(0, 2.98, 0), color: 0xffffff, count: SCENERY.trees, kind: 'tree' });
    const spots = {
      tree: Array.from({ length: SCENERY.trees }, (_, i) => ({
        x: SCENERY.from + hash(i) * SCENERY.span, z: (i % 2 ? 1 : -1) * (TRACK_HALF + 1.6 + hash(i + 50) * 13), scale: 0.8 + hash(i + 90) * 0.9, turn: hash(i + 7) * 6.28,
      })),
      rock: Array.from({ length: SCENERY.rocks }, (_, i) => ({
        x: SCENERY.from + hash(i + 200) * SCENERY.span, z: (i % 2 ? -1 : 1) * (TRACK_HALF + 0.9 + hash(i + 250) * 9), scale: 0.5 + hash(i + 290) * 0.9, turn: hash(i + 300) * 6.28,
      })),
    };
    for (const part of parts) {
      const material = new MeshStandardMaterial({ color: part.color, roughness: 0.9, flatShading: true });
      const mesh = new InstancedMesh(part.geometry, material, part.count);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      this.slope.add(mesh);
      this.scenery.push({ mesh, spots: spots[part.kind] });
      this.sceneryParts.push({ geometry: part.geometry, material });
    }
  }

  private placeScenery(distance: number): void {
    const matrix = new Matrix4();
    const turn = new Quaternion();
    const up = new Vector3(0, 1, 0);
    const scale = new Vector3();
    const position = new Vector3();
    for (const { mesh, spots } of this.scenery) {
      spots.forEach((spot, i) => {
        position.set(wrap(spot.x - distance, SCENERY.from, SCENERY.span), 0, spot.z);
        turn.setFromAxisAngle(up, spot.turn);
        mesh.setMatrixAt(i, matrix.compose(position, turn, scale.setScalar(spot.scale)));
      });
      mesh.instanceMatrix.needsUpdate = true;
    }
  }

  /** The circuit's pieces as they are modelled, their feet on the ground, their longest side across the lane. */
  private takeTemplates(circuit: Object3D): void {
    circuit.updateMatrixWorld(true);
    const wanted = new Set(Object.values(OBSTACLE_PARTS).flatMap((part) => part.names));
    for (const name of wanted) {
      let source: Object3D | undefined;
      circuit.traverse((object) => {
        if (!source && object.name.startsWith(name) && !object.name.startsWith('Collider')) source = object;
      });
      if (!source) continue;
      const copy = source.clone();
      copy.position.set(0, 0, 0);
      copy.rotation.set(0, 0, 0);
      const holder = new Group();
      holder.add(copy);
      holder.updateMatrixWorld(true);
      let box = new Box3().setFromObject(holder);
      const size = box.getSize(new Vector3());
      if (size.x > size.z) copy.rotation.y = Math.PI / 2;
      holder.updateMatrixWorld(true);
      box = new Box3().setFromObject(holder);
      const centre = box.getCenter(new Vector3());
      copy.position.sub(new Vector3(centre.x, box.min.y, centre.z));
      copy.traverse((object) => {
        if (!(object instanceof Mesh)) return;
        object.castShadow = true;
        object.receiveShadow = true;
      });
      this.templates.set(name, holder);
    }
  }

  private makeObstacle(kind: ObstacleKind): Object3D {
    const part = OBSTACLE_PARTS[kind];
    const group = new Group();
    const across = part.across ?? 0;
    part.names.forEach((name, i) => {
      const template = this.templates.get(name);
      if (!template) return;
      const copy = template.clone();
      copy.position.z = (i - (part.names.length - 1) / 2) * across;
      // A little untidy, like a real building site.
      copy.rotation.y = (hash(i * 13 + kind.length) - 0.5) * 0.5;
      group.add(copy);
    });
    return group;
  }

  private placeObstacles(run: SledRun, dt: number): void {
    const alive = new Set<number>();
    for (const obstacle of run.obstacles) {
      if (obstacle.hit) continue;
      alive.add(obstacle.id);
      let object = this.obstacles.get(obstacle.id);
      if (!object) {
        object = this.makeObstacle(obstacle.kind);
        this.obstacles.set(obstacle.id, object);
        this.slope.add(object);
      }
      object.position.set(obstacle.at - run.distance, 0, (1 - obstacle.lane) * SLED.laneWidth);
    }
    for (const [id, object] of this.obstacles) {
      if (alive.has(id)) continue;
      object.removeFromParent();
      this.obstacles.delete(id);
    }
    // Knocked pieces fly off down the slope, tumbling, and are gone.
    const travelled = run.phase === 'playing' ? run.speed * dt : 0;
    for (let i = this.flying.length - 1; i >= 0; i--) {
      const entry = this.flying[i];
      entry.age += dt;
      entry.velocity.y -= 16 * dt;
      entry.object.position.addScaledVector(entry.velocity, dt);
      entry.object.position.x -= travelled;
      entry.object.rotation.x += entry.spin.x * dt;
      entry.object.rotation.y += entry.spin.y * dt;
      entry.object.rotation.z += entry.spin.z * dt;
      if (entry.age > 1.6 || entry.object.position.y < -6) {
        entry.object.removeFromParent();
        this.flying.splice(i, 1);
      }
    }
  }

  /** An obstacle that was hit flies off: up, ahead and to the side, spinning. */
  private launch(id: number, run: SledRun, smashed: boolean): void {
    const object = this.obstacles.get(id);
    if (!object) return;
    this.obstacles.delete(id);
    const side = (Math.random() - 0.5) * 8 + (object.position.z - (1 - run.x) * SLED.laneWidth) * 2;
    const velocity = new Vector3(run.speed * (smashed ? 0.9 : 0.55) + 3, (smashed ? 7 : 5) + Math.random() * 3, side);
    const spin = new Vector3((Math.random() - 0.5) * 12, (Math.random() - 0.5) * 12, (Math.random() - 0.5) * 12);
    this.flying.push({ object, velocity, spin, age: 0 });
  }

  /** The pickup: the vessel's own bottle (a soda bottle, a test tube, a thruster) standing up, larger, over a glowing ring. */
  private makeBottle(root: Object3D, parts: RegExp, nozzleName: string): Object3D {
    root.updateMatrixWorld(true);
    // In the vessel's own frame, so the slope and the chair's turn do not tilt it.
    const toRoot = root.matrixWorld.clone().invert();
    const relative = new Matrix4();
    const inner = new Group();
    root.traverse((object) => {
      if (!parts.test(object.name)) return;
      const copy = object.clone();
      relative.multiplyMatrices(toRoot, object.matrixWorld).decompose(copy.position, copy.quaternion, copy.scale);
      inner.add(copy);
    });
    const box = new Box3().setFromObject(inner);
    const centre = box.getCenter(new Vector3());
    const size = box.getSize(new Vector3());
    for (const child of inner.children) child.position.sub(centre);
    // Standing up along its longest side, the mouth (the nozzle's end) at the top.
    const axis = size.x >= size.y && size.x >= size.z ? new Vector3(1, 0, 0) : size.z >= size.y ? new Vector3(0, 0, 1) : new Vector3(0, 1, 0);
    const nozzle = root.getObjectByName(nozzleName)?.getWorldPosition(new Vector3()).applyMatrix4(toRoot).sub(centre);
    if (nozzle && nozzle.dot(axis) < 0) axis.negate();
    const holder = new Group();
    const turner = new Group();
    turner.add(inner);
    turner.quaternion.setFromUnitVectors(axis, new Vector3(0, 1, 0));
    turner.scale.setScalar(BOTTLE.scale);
    holder.add(turner);
    const ring = new Mesh(new TorusGeometry(0.55, 0.06, 8, 32), new MeshBasicMaterial({ color: this.palette.glow, transparent: true, opacity: 0.85 }));
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.04;
    ring.name = 'BottleRing';
    holder.add(ring);
    // Its own materials: the glass less clear than on the chair and everything faintly lit, so it reads from afar.
    const glow = new Color(this.palette.glow);
    inner.traverse((object) => {
      if (!(object instanceof Mesh)) return;
      object.castShadow = true;
      const material = (object.material as MeshStandardMaterial).clone();
      if (material.transparent) material.opacity = Math.max(material.opacity, 0.62);
      if (material.emissive) {
        material.emissive.copy(glow);
        material.emissiveIntensity = 0.22;
      }
      object.material = material;
      this.bottleMaterials.push(material);
    });
    return holder;
  }

  private placeBottles(run: SledRun, dt: number): void {
    const alive = new Set<number>();
    for (const bottle of run.bottles) {
      if (bottle.taken) continue;
      alive.add(bottle.id);
      let object = this.bottles.get(bottle.id);
      if (!object) {
        object = this.bottleTemplate.clone();
        this.bottles.set(bottle.id, object);
        this.slope.add(object);
      }
      const bob = this.options.reducedMotion ? 0 : Math.sin(this.time * 3 + bottle.id) * 0.12;
      object.position.set(bottle.at - run.distance, 0, (1 - bottle.lane) * SLED.laneWidth);
      const turner = object.children[0];
      turner.position.y = BOTTLE.height + bob;
      if (!this.options.reducedMotion) object.rotation.y = this.time * 1.8 + bottle.id;
    }
    for (const [id, object] of this.bottles) {
      if (alive.has(id)) continue;
      object.removeFromParent();
      this.bottles.delete(id);
    }
    // A taken bottle swells and vanishes.
    for (let i = this.popping.length - 1; i >= 0; i--) {
      const entry = this.popping[i];
      entry.age += dt;
      entry.object.scale.setScalar(1 + entry.age * 3);
      entry.object.position.x -= run.speed * dt * 0.5;
      if (entry.age > 0.22) {
        entry.object.removeFromParent();
        this.popping.splice(i, 1);
      }
    }
  }

  /** The nitro: a gush out of the bottles while it lasts, the fizz, the liquid running down with the time left. */
  private updateNitro(run: SledRun, dt: number): void {
    const on = run.nitro > 0 && run.phase === 'playing';
    const back = new Vector3(-1, 0, 0).applyQuaternion(this.slope.quaternion);
    const carried = back.clone().multiplyScalar(run.speed * 0.7);
    if (on) {
      const lit = !this.boosting;
      this.spray.emit(this.rig.bottles.map((bottle) => bottle.nozzle.getWorldPosition(new Vector3())), back, carried, dt, lit);
    }
    this.boosting = on;
    this.options.sounds?.loop('fizz', on ? 0.9 : 0, 0.4 + (run.nitro / SLED.nitro.time) * 0.6);
    for (const bottle of this.rig.bottles) if (bottle.liquid) bottle.liquid.scale.y = Math.max(0.05, run.nitro / SLED.nitro.time);
    this.spray.update(dt, -2);
  }
}
