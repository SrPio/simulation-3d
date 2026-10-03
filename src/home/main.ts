import './home.css';
import { QUALITY, isQualityId, readPreferences, savePreferences } from '../core/quality.ts';
import { CharacterViewer, type CameraMode, type LightPreset, type MovementState, type SignLink, type ViewerStatus } from '../viewer/CharacterViewer';

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('No se encontró el contenedor de la habitación.');

app.innerHTML = `
  <div class="room-page">
    <div id="canvas-host" class="room-canvas" aria-busy="true" aria-label="Habitación del developer en 3D" role="img"></div>
    <header class="room-bar">
      <a class="room-brand" href="./" aria-label="Developer Room, inicio"><span class="room-mark" aria-hidden="true">d.</span><span>DEVELOPER ROOM</span></a>
      <div class="room-status" role="status" aria-live="polite" aria-atomic="true" data-state="loading"><span class="room-dot" aria-hidden="true"></span><span id="status-label">Cargando</span></div>
    </header>
    <nav class="room-tools" aria-label="Opciones de la escena">
      <div class="tool-group" role="group" aria-labelledby="quality-label">
        <span class="tool-label" id="quality-label">Calidad</span>
        <div class="tool-segmented">
          ${Object.entries(QUALITY).map(([id, profile]) => `<button type="button" data-quality="${id}" aria-pressed="false">${profile.label}</button>`).join('')}
        </div>
      </div>
      <div class="tool-group" role="group" aria-labelledby="light-label">
        <span class="tool-label" id="light-label">Luz</span>
        <div class="tool-segmented">
          <button type="button" data-light="neutral" aria-pressed="true"><span class="tool-dot neutral" aria-hidden="true"></span>Neutra</button>
          <button type="button" data-light="violet" aria-pressed="false"><span class="tool-dot violet" aria-hidden="true"></span>Violeta</button>
        </div>
      </div>
      <div class="tool-group" role="group" aria-labelledby="camera-label">
        <span class="tool-label" id="camera-label">Cámara</span>
        <button type="button" class="tool-toggle" id="camera-free" aria-pressed="false" aria-describedby="camera-copy"><span class="toggle-track" aria-hidden="true"></span>Libre</button>
        <span id="camera-copy" class="sr-only">Desactivada: vista isométrica fija que sigue al personaje. Activada: arrastra para girar y usa la rueda para acercar.</span>
      </div>
    </nav>
    <section class="room-hud" aria-label="Controles del personaje">
      <p id="hud-hint" role="status" aria-live="polite">W A S D o flechas para caminar · Shift para correr · Espacio para saltar</p>
      <a id="sign-link" class="sign-link" href="#" target="_blank" rel="noopener noreferrer" hidden></a>
      <div class="hud-actions">
        <button type="button" id="hud-help" aria-expanded="false" aria-controls="hud-help-text">Ayuda</button>
        <button type="button" id="hud-reset">Restablecer posición</button>
      </div>
      <p id="hud-help-text" class="hud-help" hidden>W A S D o flechas: caminar. Mantén Shift: correr. Espacio: saltar hacia adelante. Cerca de la silla o la cama, E: sentarse y levantarse. Sentado, L: abrir o cerrar el portátil. Sal por los lados abiertos de la habitación: entra en la zona marcada frente a un cartel y pulsa Enter (o haz clic en el cartel) para abrir su enlace. Empuja las letras del nombre para tirarlas.</p>
    </section>
    <div class="room-overlay" id="viewer-overlay">
      <div class="room-overlay-card"><span class="room-ring" id="loading-ring" aria-hidden="true"></span><h1 id="overlay-title">Cargando la habitación</h1><p id="overlay-detail">Preparando el personaje, la habitación y el exterior.</p><button type="button" class="room-retry" id="retry" hidden>Volver a intentar</button></div>
    </div>
  </div>
`;

function element<T extends HTMLElement>(selector: string): T {
  const found = app!.querySelector<T>(selector);
  if (!found) throw new Error(`No se encontró ${selector}`);
  return found;
}

const host = element<HTMLDivElement>('#canvas-host');
const status = element<HTMLDivElement>('.room-status');
const statusLabel = element<HTMLSpanElement>('#status-label');
const overlay = element<HTMLDivElement>('#viewer-overlay');
const overlayTitle = element<HTMLHeadingElement>('#overlay-title');
const overlayDetail = element<HTMLParagraphElement>('#overlay-detail');
const loadingRing = element<HTMLSpanElement>('#loading-ring');
const retry = element<HTMLButtonElement>('#retry');
const hint = element<HTMLParagraphElement>('#hud-hint');
const help = element<HTMLButtonElement>('#hud-help');
const helpText = element<HTMLParagraphElement>('#hud-help-text');
const reset = element<HTMLButtonElement>('#hud-reset');
const signLink = element<HTMLAnchorElement>('#sign-link');
const cameraFree = element<HTMLButtonElement>('#camera-free');
const qualityButtons = Array.from(app.querySelectorAll<HTMLButtonElement>('[data-quality]'));
const lightButtons = Array.from(app.querySelectorAll<HTMLButtonElement>('[data-light]'));
const storage = (() => { try { return window.localStorage; } catch { return undefined; } })();
// Quality and reduced motion are shared with the studio; light and camera start from their defaults on every visit.
const preferences = readPreferences(storage);
const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
const listeners = new AbortController();
const defaultHint = 'W A S D o flechas para caminar · Shift para correr · Espacio para saltar';
let light: LightPreset = 'neutral';
let camera: CameraMode = 'follow';
let viewer: CharacterViewer | undefined;
let generation = 0;
let disposed = false;

const motionReduced = () => preferences.reducedMotion ?? motionQuery.matches;

function applyPreferences(): void {
  for (const button of qualityButtons) button.setAttribute('aria-pressed', String(button.dataset.quality === preferences.quality));
  document.documentElement.dataset.reducedMotion = String(motionReduced());
}

function updateStatus(state: ViewerStatus): void {
  status.dataset.state = state.kind;
  statusLabel.textContent = state.kind === 'ready' ? 'Listo' : state.title;
  host.setAttribute('aria-busy', String(state.kind === 'loading'));
  overlay.hidden = state.kind === 'ready';
  overlayTitle.textContent = state.kind === 'loading' ? 'Cargando la habitación' : state.title;
  overlayDetail.textContent = state.kind === 'loading' ? 'Preparando el personaje, la habitación y el exterior.' : state.detail;
  loadingRing.hidden = state.kind !== 'loading';
  retry.hidden = state.kind !== 'error';
}

function updateMovement(state: MovementState | null, text?: string): void {
  hint.textContent = text ?? defaultHint;
  reset.disabled = state !== 'ready' && state !== 'interacting';
}

function updateSign(sign: SignLink | null): void {
  signLink.hidden = !sign;
  if (!sign) return;
  signLink.href = sign.link;
  signLink.textContent = `${sign.label} ↗`;
  signLink.dataset.sign = sign.id;
}

function mount(): void {
  if (disposed) return;
  const current = ++generation;
  const live = () => !disposed && current === generation;
  viewer?.dispose();
  updateSign(null);
  host.dataset.light = light;
  host.dataset.scene = 'room';
  host.dataset.model = 'v4rig';
  viewer = new CharacterViewer(host, {
    status: (state) => { if (live()) updateStatus(state); },
    stats: () => {},
    orbit: () => {},
    animation: () => {},
    movement: (state, text) => { if (live()) updateMovement(state, text); },
    sign: (sign) => { if (live()) updateSign(sign); },
  }, {
    modelId: 'v4rig', view: 'three-quarter', light, wireframe: false, scene: 'room',
    quality: preferences.quality, reducedMotion: motionReduced(), cameraMode: camera,
  });
}

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
for (const button of lightButtons) {
  button.addEventListener('click', () => {
    light = button.dataset.light as LightPreset;
    viewer?.setLight(light);
    for (const option of lightButtons) option.setAttribute('aria-pressed', String(option === button));
  }, { signal: listeners.signal });
}
cameraFree.addEventListener('click', () => {
  camera = camera === 'follow' ? 'free' : 'follow';
  cameraFree.setAttribute('aria-pressed', String(camera === 'free'));
  viewer?.setCameraMode(camera);
}, { signal: listeners.signal });
motionQuery.addEventListener('change', () => {
  if (preferences.reducedMotion !== null) return;
  applyPreferences();
  viewer?.setReducedMotion(motionReduced());
}, { signal: listeners.signal });
retry.addEventListener('click', mount, { signal: listeners.signal });
reset.addEventListener('click', () => viewer?.resetPosition(), { signal: listeners.signal });
help.addEventListener('click', () => {
  helpText.hidden = !helpText.hidden;
  help.setAttribute('aria-expanded', String(!helpText.hidden));
}, { signal: listeners.signal });
// Buttons keep focus after a click; Space and arrows must still drive the character, not the button.
for (const button of app.querySelectorAll<HTMLButtonElement>('.room-tools button, .hud-actions button')) {
  button.addEventListener('pointerup', () => button.blur(), { signal: listeners.signal });
}

function dispose(): void {
  if (disposed) return;
  disposed = true;
  listeners.abort();
  viewer?.dispose();
  viewer = undefined;
}

window.addEventListener('pagehide', (event) => { if (!event.persisted) dispose(); }, { signal: listeners.signal });
if (import.meta.hot) import.meta.hot.dispose(dispose);
applyPreferences();
mount();
