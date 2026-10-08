import '../styles.css';
import { defaultModelVersion, isModelVersionId, modelVersions, type ModelVersionId, type SceneId } from '../core/loadAssets';
import { QUALITY, isQualityId, readPreferences, savePreferences, type QualityId } from '../core/quality.ts';
import { DEFAULT_GAIT_CLIPS, type Gait } from '../character/CharacterController';
import { CharacterViewer, type AnimationState, type LightPreset, type MovementState, type RenderStats, type ViewPreset, type ViewerStatus } from '../viewer/CharacterViewer';

const sceneCopy: Record<SceneId, string> = {
  studio: 'Estudio · El personaje sobre la peana para revisar silueta, materiales y animación.',
  room: 'Habitación · Diorama isométrico del cuarto del developer con la versión elegida. La órbita se limita al lado abierto.',
};

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('No se encontró el contenedor del estudio.');

app.innerHTML = `
  <div class="studio">
    <header class="header">
      <a class="wordmark" href="./" aria-label="Inicio del estudio"><span class="brand-mark" aria-hidden="true">d.</span><span>FORM / STUDIES</span></a>
      <span class="header-edition">ESTUDIO DE PERSONAJE <span aria-hidden="true">/</span> VOL. 001</span>
      <div class="status" data-state="loading" role="status" aria-live="polite" aria-atomic="true"><span class="status-dot" aria-hidden="true"></span><span id="status-label">Cargando modelo</span></div>
    </header>
    <aside class="sidebar" aria-label="Controles del estudio">
      <div class="sidebar-intro">
        <p class="eyebrow accent">01 / PROPORCIONES</p>
        <h1>Developer <span>/ Character study</span></h1>
        <p class="intro-copy">Continuamos desde V1: rig y ciclos en el sitio.<br>El original se conserva.</p>
      </div>
      <fieldset class="control-section scene-controls" aria-describedby="scene-copy">
        <legend>Escena <span>FASE 3</span></legend>
        <div class="segmented scene-selector">
          <button type="button" data-scene="studio" aria-pressed="true">Estudio</button>
          <button type="button" data-scene="room" aria-pressed="false">Habitación</button>
        </div>
        <p id="scene-copy" class="version-copy">${sceneCopy.studio}</p>
      </fieldset>
      <fieldset class="control-section version-controls" aria-describedby="version-copy">
        <legend>Versión <span>COMPARAR</span></legend>
        <div class="segmented version-selector">
          ${Object.entries(modelVersions).map(([id, version]) => `<button type="button" data-model="${id}" aria-pressed="${id === defaultModelVersion}">${version.label}</button>`).join('')}
        </div>
        <p id="version-copy" class="version-copy">${modelVersions[defaultModelVersion].copy}</p>
      </fieldset>
      <fieldset class="control-section animation-controls" id="animation-controls" aria-describedby="animation-copy" hidden disabled>
        <legend>Animación <span>FASE 2A</span></legend>
        <p id="animation-copy" class="animation-copy">Rig y ciclos en el sitio: reposo, caminar y correr. Sin objetos ni gameplay. Sentarse y usar el portátil vendrán después.</p>
        <label for="animation-clip">Clip</label>
        <select id="animation-clip"></select>
        <label for="walk-clip" hidden>Caminata al moverse en la habitación</label>
        <select id="walk-clip" hidden></select>
        <label for="run-clip" hidden>Carrera al moverse en la habitación</label>
        <select id="run-clip" hidden></select>
        <label for="jump-clip" hidden>Salto al moverse en la habitación</label>
        <select id="jump-clip" hidden></select>
        <button type="button" id="animation-play" aria-label="Pausar animación">Pausar</button>
        <label for="animation-speed">Velocidad de animación</label>
        <select id="animation-speed">
          <option value="0.25">0,25×</option>
          <option value="0.5">0,5×</option>
          <option value="1" selected>1×</option>
        </select>
        <label for="animation-timeline">Posición de la animación</label>
        <input id="animation-timeline" type="range" min="0" max="1000" step="1" value="0" aria-describedby="animation-time">
        <output id="animation-time" for="animation-timeline">0,00 / 0,00 s</output>
      </fieldset>
      <section class="palette" aria-labelledby="palette-title">
        <h2 id="palette-title">Paleta de materiales <span>05</span></h2>
        <ul class="swatches">
          <li><span class="swatch hair" aria-hidden="true"></span><span>Cabello</span></li>
          <li><span class="swatch wine" aria-hidden="true"></span><span>Gorra</span></li>
          <li><span class="swatch black" aria-hidden="true"></span><span>Negro</span></li>
          <li><span class="swatch skin" aria-hidden="true"></span><span>Piel</span></li>
          <li><span class="swatch white" aria-hidden="true"></span><span>Blanco</span></li>
        </ul>
      </section>
      <fieldset class="control-section" id="camera-controls" disabled>
        <legend>Cámara <span>ORTOGRÁFICA</span></legend>
        <div class="camera-grid">
          <button type="button" data-view="front" aria-pressed="false">Frente</button>
          <button type="button" data-view="back" aria-pressed="false">Espalda</button>
          <button type="button" data-view="left" aria-pressed="false">Perfil izquierdo</button>
          <button type="button" data-view="right" aria-pressed="false">Perfil derecho</button>
          <button type="button" data-view="three-quarter" aria-pressed="true" class="wide"><span>3/4</span><span class="view-glyph" aria-hidden="true">↗</span></button>
        </div>
        <div class="zoom-row"><span>Acercamiento</span><div><button type="button" id="zoom-out" aria-label="Alejar personaje">−</button><button type="button" id="zoom-in" aria-label="Acercar personaje">+</button></div></div>
      </fieldset>
      <fieldset class="control-section" id="light-controls" disabled>
        <legend>Iluminación <span>ESTUDIO</span></legend>
        <div class="segmented">
          <button type="button" data-light="neutral" aria-pressed="true"><span class="light-dot neutral" aria-hidden="true"></span>Neutra</button>
          <button type="button" data-light="violet" aria-pressed="false"><span class="light-dot violet" aria-hidden="true"></span>Violeta</button>
        </div>
        <label class="wireframe-row" for="wireframe"><span>Ver alambre</span><input id="wireframe" type="checkbox" role="switch"><span class="switch-track" aria-hidden="true"></span></label>
      </fieldset>
      <fieldset class="control-section" id="quality-controls" aria-describedby="quality-copy">
        <legend>Rendimiento <span>CALIDAD</span></legend>
        <div class="segmented quality-selector">
          ${Object.entries(QUALITY).map(([id, profile]) => `<button type="button" data-quality="${id}" aria-pressed="false">${profile.label}</button>`).join('')}
        </div>
        <p id="quality-copy" class="version-copy"></p>
        <label class="wireframe-row" for="reduced-motion"><span>Reducir movimiento</span><input id="reduced-motion" type="checkbox" role="switch" aria-describedby="motion-copy"><span class="switch-track" aria-hidden="true"></span></label>
        <p id="motion-copy" class="version-copy">Sin inercia de cámara, pantalla del portátil quieta y sin transiciones de la interfaz. Las animaciones del personaje se mantienen.</p>
        <p id="render-stats" class="version-copy render-stats">— fps · — draw calls</p>
      </fieldset>
      <section class="stages" aria-labelledby="stages-title">
        <h2 id="stages-title">El proceso</h2>
        <ol>
          <li class="active" aria-current="step"><span class="stage-number">01</span><span>Personaje</span><span class="stage-tag">${modelVersions[defaultModelVersion].stage}</span></li>
          <li><span class="stage-number">02</span><span>Rig y ciclos</span><span class="stage-pending">FASE 2A</span></li>
          <li><span class="stage-number">03</span><span>Habitación</span><span class="stage-pending">Después</span></li>
        </ol>
      </section>
      <div class="review-note"><span class="note-marker" aria-hidden="true"></span><p id="review-copy">${modelVersions[defaultModelVersion].status} · Fase 2A: rig y ciclos en V1 Animada. Sentarse y portátil, después.</p></div>
    </aside>
    <main class="viewport" aria-label="Estudio de versiones del personaje">
      <div class="viewport-heading"><div><p class="eyebrow">CHARACTER / 001</p><p class="viewport-subtitle">Silueta & proporción</p></div><span class="revision-label">${modelVersions[defaultModelVersion].revision}</span></div>
      <div id="canvas-host" class="canvas-host" aria-busy="true"></div>
      <div class="viewport-overlay" id="viewer-overlay">
        <div class="overlay-card"><span class="loading-ring" id="loading-ring" aria-hidden="true"></span><h2 id="overlay-title">Cargando modelo</h2><p id="overlay-detail">Preparando el estudio y las proporciones del personaje.</p><button type="button" class="retry-button" id="retry" hidden>Volver a intentar <span aria-hidden="true">↗</span></button></div>
      </div>
      <section class="room-hud" id="room-hud" aria-label="Movimiento en la habitación" hidden>
        <p id="hud-hint" role="status" aria-live="polite"></p>
        <div class="hud-actions">
          <button type="button" id="hud-help" aria-expanded="false" aria-controls="hud-help-text">Ayuda</button>
          <button type="button" id="hud-reset">Restablecer posición</button>
        </div>
        <p id="hud-help-text" class="hud-help" hidden>W A S D o flechas: caminar. Mantén Shift: correr. Espacio: saltar (también en marcha). F: lanzar. J: puñetazo, K: patada (mantén para cargar, suelta para golpear). Cerca de la silla (por cualquiera de sus lados) o la cama, E: sentarse y levantarse. Sentado, L: abrir o cerrar el portátil. Sal por los lados abiertos: en la zona marcada frente a cada cartel, Enter (o un clic en el cartel) abre el portafolio, GitHub o LinkedIn. Empuja las letras del nombre para tirarlas. Arrastra para girar la cámara: el movimiento sigue la vista. Las teclas no actúan mientras usas un desplegable o un control deslizante.</p>
      </section>
      <div class="view-caption"><span class="caption-line" aria-hidden="true"></span><span id="view-label">Vista tres cuartos</span><span class="orbit-label">ÓRBITA 360°</span></div>
      <footer class="viewport-footer"><p><span class="interaction-icon" aria-hidden="true">↔</span> Arrastrar para girar <span class="hint-divider">/</span> Scroll para zoom</p><p id="model-stats" aria-label="Estadísticas del modelo">— mallas <span aria-hidden="true">·</span> — triángulos</p></footer>
    </main>
  </div>
`;

function element<T extends HTMLElement>(selector: string): T {
  const found = app!.querySelector<T>(selector);
  if (!found) throw new Error(`No se encontró ${selector}`);
  return found;
}

const host = element<HTMLDivElement>('#canvas-host');
const status = element<HTMLDivElement>('.status');
const statusLabel = element<HTMLSpanElement>('#status-label');
const overlay = element<HTMLDivElement>('#viewer-overlay');
const overlayTitle = element<HTMLHeadingElement>('#overlay-title');
const overlayDetail = element<HTMLParagraphElement>('#overlay-detail');
const loadingRing = element<HTMLSpanElement>('#loading-ring');
const retry = element<HTMLButtonElement>('#retry');
const cameraControls = element<HTMLFieldSetElement>('#camera-controls');
const lightControls = element<HTMLFieldSetElement>('#light-controls');
const animationControls = element<HTMLFieldSetElement>('#animation-controls');
const animationClip = element<HTMLSelectElement>('#animation-clip');
const gaitSelects = (['walk', 'run', 'jump'] as const).map((gait) => ({
  gait, select: element<HTMLSelectElement>(`#${gait}-clip`), label: element<HTMLLabelElement>(`label[for="${gait}-clip"]`),
}));
const animationPlay = element<HTMLButtonElement>('#animation-play');
const animationSpeed = element<HTMLSelectElement>('#animation-speed');
const animationTimeline = element<HTMLInputElement>('#animation-timeline');
const animationTime = element<HTMLOutputElement>('#animation-time');
const stats = element<HTMLParagraphElement>('#model-stats');
const roomHud = element<HTMLElement>('#room-hud');
const hudHint = element<HTMLParagraphElement>('#hud-hint');
const hudHelp = element<HTMLButtonElement>('#hud-help');
const hudHelpText = element<HTMLParagraphElement>('#hud-help-text');
const hudReset = element<HTMLButtonElement>('#hud-reset');
let running = false;
let movementState: MovementState | null = null;
let movementText: string | undefined;
const movementHints: Record<MovementState, string> = {
  get ready() { return `W A S D o flechas para caminar · Shift: correr ${running ? 'activado' : 'desactivado'} · Espacio para saltar · F para lanzar · J/K: puño/patada`; },
  unavailable: 'Elige V1 Animada o V4 Animada para moverte por la habitación.',
  seated: 'Está sentado: elige Reposo en Animación para volver a caminar.',
  interacting: 'E: sentarse o levantarse · L: portátil',
};

function updateMovement(state: MovementState | null, text?: string): void {
  movementState = state;
  movementText = text;
  roomHud.hidden = !state;
  roomHud.dataset.state = state ?? 'none';
  if (state) hudHint.textContent = text ?? movementHints[state];
  hudReset.disabled = state !== 'ready' && state !== 'interacting';
}
const qualityCopy: Record<QualityId, string> = {
  auto: 'Auto · Ajusta la resolución (1–1,5×) al tiempo de cada fotograma para mantener la fluidez. Con sombras.',
  high: 'Alta · Resolución nativa hasta 2×, sin reducirla. Más nítido; pide más a la GPU.',
  low: 'Baja · Sin sombras y resolución de 0,75–1×. Para equipos modestos o batería.',
};
const qualityButtons = Array.from(app.querySelectorAll<HTMLButtonElement>('[data-quality]'));
const reducedMotion = element<HTMLInputElement>('#reduced-motion');
const renderStats = element<HTMLParagraphElement>('#render-stats');
const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
const storage = (() => { try { return window.localStorage; } catch { return undefined; } })();
const preferences = readPreferences(storage);
const decimal = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 2 });

function motionReduced(): boolean {
  return preferences.reducedMotion ?? motionQuery.matches;
}

function applyPreferences(): void {
  for (const button of qualityButtons) button.setAttribute('aria-pressed', String(button.dataset.quality === preferences.quality));
  element<HTMLParagraphElement>('#quality-copy').textContent = qualityCopy[preferences.quality];
  reducedMotion.checked = motionReduced();
  document.documentElement.dataset.reducedMotion = String(motionReduced());
}

function updateRender(state: RenderStats | null): void {
  renderStats.textContent = state
    ? `${Math.round(state.fps)} fps · ${decimal.format(state.frameMs)} ms · ${decimal.format(state.pixelRatio)}× · ${number.format(state.drawCalls)} draw calls`
    : '— fps · — draw calls';
}
const viewLabel = element<HTMLSpanElement>('#view-label');
const wireframe = element<HTMLInputElement>('#wireframe');
const viewButtons = Array.from(app.querySelectorAll<HTMLButtonElement>('[data-view]'));
const lightButtons = Array.from(app.querySelectorAll<HTMLButtonElement>('[data-light]'));
const modelButtons = Array.from(app.querySelectorAll<HTMLButtonElement>('[data-model]'));
const sceneButtons = Array.from(app.querySelectorAll<HTMLButtonElement>('[data-scene]'));
const listeners = new AbortController();
const number = new Intl.NumberFormat('es-ES');
let viewer: CharacterViewer | undefined;
let disposed = false;
let generation = 0;
let selectedModel: ModelVersionId = defaultModelVersion;
let selectedScene: SceneId = 'studio';
let selectedView: ViewPreset = 'three-quarter';
let selectedLight: LightPreset = 'neutral';
let animationState: AnimationState | null = null;
const selectedGait: Record<Gait, string> = { ...DEFAULT_GAIT_CLIPS };
const clipLabels: Record<string, string> = {
  idle: 'Reposo', walk: 'Caminar', walk_ual: 'Caminar · UAL', run: 'Correr', run_ual_jog: 'Correr · trote UAL', run_ual_sprint: 'Correr · sprint UAL', jump: 'Saltar', jump_ual: 'Saltar · UAL', throw_ual: 'Lanzar · UAL 2', punch_ual: 'Puñetazo · UAL', kick: 'Patada',
  sit_down_chair: 'Sentarse · silla', seated_chair: 'Sentado · silla', stand_up_chair: 'Levantarse · silla', typing_chair: 'Escribir · silla',
  sit_down_bed: 'Sentarse · cama', seated_bed: 'Sentado · cama', stand_up_bed: 'Levantarse · cama', typing_bed: 'Escribir · cama',
};
const clipLabel = (clip: string) => (clipLabels[clip.toLowerCase()] ? `${clipLabels[clip.toLowerCase()]} (${clip})` : clip);

function updateAnimation(state: AnimationState | null): void {
  animationState = state;
  animationControls.hidden = !state;
  animationControls.disabled = !state || status.dataset.state !== 'ready';
  if (!state) {
    animationClip.replaceChildren();
    for (const { select, label } of gaitSelects) {
      select.replaceChildren();
      select.hidden = label.hidden = true;
    }
    animationTimeline.value = '0';
    animationSpeed.value = '1';
    animationControls.dataset.playing = 'false';
    animationTime.value = '0,00 / 0,00 s';
    animationTimeline.setAttribute('aria-valuetext', animationTime.value);
    return;
  }
  const order = ['idle', 'walk', 'walk_ual', 'run', 'run_ual_jog', 'run_ual_sprint', 'jump', 'jump_ual', 'throw_ual', 'punch_ual', 'kick', ...['chair', 'bed'].flatMap((seat) => ['sit_down', 'seated', 'typing', 'stand_up'].map((action) => `${action}_${seat}`))];
  const rank = (clip: string) => (order.includes(clip) ? order.indexOf(clip) : order.length);
  const clips = [...state.clips].sort((a, b) => rank(a) - rank(b));
  if (clips.length !== animationClip.options.length || clips.some((clip, index) => animationClip.options[index]?.value !== clip)) {
    animationClip.replaceChildren(...clips.map((clip) => new Option(clipLabel(clip), clip)));
    // Alternative walk/run clips (V4 Animada): pick which ones play while moving with the keyboard.
    for (const { gait, select, label } of gaitSelects) {
      const options = clips.filter((clip) => clip === gait || clip.startsWith(`${gait}_`));
      select.replaceChildren(...options.map((clip) => new Option(clipLabel(clip), clip)));
      select.hidden = label.hidden = options.length < 2;
      select.value = options.includes(selectedGait[gait]) ? selectedGait[gait] : gait;
    }
  }
  animationClip.value = state.clip;
  animationPlay.textContent = state.playing ? 'Pausar' : 'Reproducir';
  animationPlay.setAttribute('aria-label', state.playing ? 'Pausar animación' : 'Reproducir animación');
  animationControls.dataset.playing = String(state.playing);
  animationSpeed.value = String(state.speed);
  animationTimeline.value = String(state.duration > 0 ? Math.round(state.time / state.duration * 1000) : 0);
  const time = `${state.time.toFixed(2).replace('.', ',')} / ${state.duration.toFixed(2).replace('.', ',')} s`;
  animationTime.value = time;
  animationTimeline.setAttribute('aria-valuetext', time);
}

function updateStatus(state: ViewerStatus): void {
  status.dataset.state = state.kind;
  statusLabel.textContent = state.title;
  host.setAttribute('aria-busy', String(state.kind === 'loading'));
  overlay.hidden = state.kind === 'ready';
  overlayTitle.textContent = state.title;
  overlayDetail.textContent = state.detail;
  loadingRing.hidden = state.kind !== 'loading';
  retry.hidden = state.kind !== 'error';
  cameraControls.disabled = lightControls.disabled = state.kind !== 'ready';
  animationControls.disabled = !animationState || state.kind !== 'ready';
}

function setViewSelection(preset: ViewPreset | null): void {
  const labels: Record<ViewPreset, string> = {
    front: 'Vista frontal', left: 'Perfil izquierdo', right: 'Perfil derecho', back: 'Vista posterior', 'three-quarter': 'Vista tres cuartos',
  };
  for (const button of viewButtons) button.setAttribute('aria-pressed', String(button.dataset.view === preset));
  viewLabel.textContent = preset ? labels[preset] : 'Vista libre';
}

function mount(): void {
  if (disposed) return;
  const currentGeneration = ++generation;
  const current = () => !disposed && currentGeneration === generation;
  viewer?.dispose();
  viewer = undefined;
  updateMovement(null);
  const version = modelVersions[selectedModel];
  for (const button of modelButtons) button.setAttribute('aria-pressed', String(button.dataset.model === selectedModel));
  element<HTMLParagraphElement>('#version-copy').textContent = version.copy;
  element<HTMLSpanElement>('.revision-label').textContent = version.revision;
  element<HTMLSpanElement>('.stage-tag').textContent = version.stage;
  element<HTMLParagraphElement>('#review-copy').textContent = `${version.status} · Fase 2A: rig y ciclos en V1 Animada. Sentarse y portátil, después.`;
  host.dataset.model = selectedModel;
  host.dataset.scene = selectedScene;
  for (const button of sceneButtons) button.setAttribute('aria-pressed', String(button.dataset.scene === selectedScene));
  element<HTMLParagraphElement>('#scene-copy').textContent = sceneCopy[selectedScene];
  element<HTMLSpanElement>('.orbit-label').textContent = selectedScene === 'room' ? 'ÓRBITA LIMITADA' : 'ÓRBITA 360°';
  // In the diorama the back and right presets would look through the walls.
  for (const button of viewButtons) button.disabled = selectedScene === 'room' && ['back', 'right'].includes(button.dataset.view ?? '');
  if (selectedScene === 'room' && ['back', 'right'].includes(selectedView)) selectedView = 'three-quarter';
  setViewSelection(selectedView);
  for (const button of lightButtons) button.setAttribute('aria-pressed', String(button.dataset.light === selectedLight));
  host.dataset.light = selectedLight;
  viewer = new CharacterViewer(host, {
    status: (state) => { if (current()) updateStatus(state); },
    stats: (counts) => {
      if (!current()) return;
      stats.textContent = counts ? `${number.format(counts.meshes)} mallas · ${number.format(counts.triangles)} triángulos` : '— mallas · — triángulos';
    },
    orbit: () => { if (current()) setViewSelection(null); },
    animation: (state) => { if (current()) updateAnimation(state); },
    movement: (state, text) => { if (current()) updateMovement(state, text); },
    run: (on) => {
      if (!current()) return;
      running = on;
      updateMovement(movementState, movementText);
    },
    render: (state) => { if (current()) updateRender(state); },
  }, {
    modelId: selectedModel, view: selectedView, light: selectedLight, wireframe: wireframe.checked, scene: selectedScene,
    quality: preferences.quality, reducedMotion: motionReduced(),
  });
  for (const gait of ['walk', 'run', 'jump'] as const) viewer.setGaitClip(gait, selectedGait[gait]);
}

for (const button of viewButtons) {
  button.addEventListener('click', () => {
    const preset = button.dataset.view as ViewPreset;
    selectedView = preset;
    viewer?.setView(preset);
    setViewSelection(preset);
  }, { signal: listeners.signal });
}
for (const button of lightButtons) {
  button.addEventListener('click', () => {
    selectedLight = button.dataset.light as LightPreset;
    viewer?.setLight(selectedLight);
    for (const option of lightButtons) option.setAttribute('aria-pressed', String(option === button));
  }, { signal: listeners.signal });
}
for (const button of modelButtons) {
  button.addEventListener('click', () => {
    const modelId = button.dataset.model ?? '';
    if (!isModelVersionId(modelId) || modelId === selectedModel) return;
    selectedModel = modelId;
    mount();
  }, { signal: listeners.signal });
}
for (const button of sceneButtons) {
  button.addEventListener('click', () => {
    const scene = button.dataset.scene as SceneId;
    if (scene === selectedScene || !['studio', 'room'].includes(scene)) return;
    selectedScene = scene;
    if (scene === 'room') selectedLight = 'violet';
    mount();
  }, { signal: listeners.signal });
}
animationClip.addEventListener('change', () => viewer?.chooseClip(animationClip.value), { signal: listeners.signal });
for (const { gait, select } of gaitSelects) {
  select.addEventListener('change', () => {
    selectedGait[gait] = select.value;
    viewer?.setGaitClip(gait, select.value);
  }, { signal: listeners.signal });
}
animationPlay.addEventListener('click', () => { if (animationState) viewer?.setPlaying(!animationState.playing); }, { signal: listeners.signal });
animationSpeed.addEventListener('change', () => viewer?.setAnimationSpeed(Number(animationSpeed.value)), { signal: listeners.signal });
animationTimeline.addEventListener('input', () => viewer?.scrub(Number(animationTimeline.value)), { signal: listeners.signal });
wireframe.addEventListener('change', () => viewer?.setWireframe(wireframe.checked), { signal: listeners.signal });
element<HTMLButtonElement>('#zoom-in').addEventListener('click', () => viewer?.zoom(1.15), { signal: listeners.signal });
element<HTMLButtonElement>('#zoom-out').addEventListener('click', () => viewer?.zoom(1 / 1.15), { signal: listeners.signal });
for (const button of qualityButtons) {
  button.addEventListener('click', () => {
    const quality = button.dataset.quality;
    if (!isQualityId(quality) || quality === preferences.quality) return;
    preferences.quality = quality;
    savePreferences(storage, preferences);
    applyPreferences();
    viewer?.setQuality(quality);
  }, { signal: listeners.signal });
}
reducedMotion.addEventListener('change', () => {
  preferences.reducedMotion = reducedMotion.checked;
  savePreferences(storage, preferences);
  applyPreferences();
  viewer?.setReducedMotion(reducedMotion.checked);
}, { signal: listeners.signal });
// Without a stored choice the switch follows the system setting, also when it changes.
motionQuery.addEventListener('change', () => {
  if (preferences.reducedMotion !== null) return;
  applyPreferences();
  viewer?.setReducedMotion(motionReduced());
}, { signal: listeners.signal });
retry.addEventListener('click', mount, { signal: listeners.signal });
hudReset.addEventListener('click', () => viewer?.resetPosition(), { signal: listeners.signal });
hudHelp.addEventListener('click', () => {
  hudHelpText.hidden = !hudHelpText.hidden;
  hudHelp.setAttribute('aria-expanded', String(!hudHelpText.hidden));
}, { signal: listeners.signal });

function dispose(): void {
  if (disposed) return;
  disposed = true;
  listeners.abort();
  viewer?.dispose();
  viewer = undefined;
}

window.addEventListener('pagehide', (event) => {
  if (!event.persisted) dispose();
}, { signal: listeners.signal });
if (import.meta.hot) import.meta.hot.dispose(dispose);
applyPreferences();
mount();
