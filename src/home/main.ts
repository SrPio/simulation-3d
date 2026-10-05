import './home.css';
import { LANGUAGES, getLanguage, initialLanguage, isLanguage, setLanguage, t, type MessageKey } from '../core/i18n.ts';
import { QUALITY, isQualityId, readPreferences, savePreferences } from '../core/quality.ts';
import { CharacterViewer, type CameraMode, type LightPreset, type MovementState, type SignLink, type ViewerStatus } from '../viewer/CharacterViewer';

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('#app not found');

const storage = (() => { try { return window.localStorage; } catch { return undefined; } })();
// Quality and reduced motion are shared with the studio; light and camera start from their defaults on every visit.
const preferences = readPreferences(storage);
setLanguage(initialLanguage(preferences.language, navigator.languages?.length ? navigator.languages : [navigator.language]));

// Texts carry data-i18n (content), data-i18n-label (aria-label) or data-i18n-title (title); applyTexts fills them in.
app.innerHTML = `
  <div class="room-page">
    <div id="canvas-host" class="room-canvas" aria-busy="true" data-i18n-label="room.label" role="img"></div>
    <header class="room-bar">
      <a class="room-brand" href="./" data-i18n-label="brand.label"><span class="room-mark" aria-hidden="true">d.</span><span>DEVELOPER ROOM</span></a>
      <div class="room-status" role="status" aria-live="polite" aria-atomic="true" data-state="loading"><span class="room-dot" aria-hidden="true"></span><span id="status-label"></span></div>
      <div class="language-switch tool-segmented" role="group" data-i18n-label="language.label">
        ${LANGUAGES.map((language) => `<button type="button" data-language="${language}" lang="${language}" aria-pressed="false">${language.toUpperCase()}</button>`).join('')}
      </div>
    </header>
    <button type="button" class="menu-toggle" id="menu-toggle" aria-expanded="false" aria-controls="room-tools" data-i18n-label="menu.open">
      <span class="menu-icon" aria-hidden="true"><span></span><span></span><span></span></span>
    </button>
    <nav class="room-tools" id="room-tools" data-i18n-label="menu.label" hidden>
      <div class="tool-group" role="group" aria-labelledby="quality-label">
        <span class="tool-label" id="quality-label" data-i18n="quality.label"></span>
        <div class="tool-segmented">
          ${Object.keys(QUALITY).map((id) => `<button type="button" data-quality="${id}" aria-pressed="false" data-i18n="quality.${id}"></button>`).join('')}
        </div>
      </div>
      <div class="tool-group" role="group" aria-labelledby="light-label">
        <span class="tool-label" id="light-label" data-i18n="light.label"></span>
        <div class="tool-segmented">
          <button type="button" data-light="neutral" aria-pressed="true"><span class="tool-dot neutral" aria-hidden="true"></span><span data-i18n="light.neutral"></span></button>
          <button type="button" data-light="violet" aria-pressed="false"><span class="tool-dot violet" aria-hidden="true"></span><span data-i18n="light.violet"></span></button>
        </div>
      </div>
      <div class="tool-group" role="group" aria-labelledby="camera-label">
        <span class="tool-label" id="camera-label" data-i18n="camera.label"></span>
        <button type="button" class="tool-toggle" id="camera-free" aria-pressed="false" aria-describedby="camera-copy"><span class="toggle-track" aria-hidden="true"></span><span data-i18n="camera.free"></span></button>
        <span id="camera-copy" class="sr-only" data-i18n="camera.copy"></span>
      </div>
      <div class="tool-group" role="group" aria-labelledby="motion-label">
        <span class="tool-label" id="motion-label" data-i18n="motion.label"></span>
        <button type="button" class="tool-toggle" id="reduced-motion" aria-pressed="false" aria-describedby="motion-copy"><span class="toggle-track" aria-hidden="true"></span><span data-i18n="motion.reduced"></span></button>
        <span id="motion-copy" class="sr-only" data-i18n="motion.copy"></span>
      </div>
    </nav>
    <section class="room-hud" data-i18n-label="hud.label">
      <p id="hud-hint" role="status" aria-live="polite"></p>
      <a id="sign-link" class="sign-link" href="#" target="_blank" rel="noopener noreferrer" hidden></a>
      <div class="hud-actions">
        <button type="button" id="hud-help" aria-expanded="false" aria-controls="hud-help-text" data-i18n="hud.help"></button>
        <button type="button" id="hud-reset" data-i18n="hud.reset"></button>
      </div>
      <p id="hud-help-text" class="hud-help" data-i18n="hud.helpText" hidden></p>
    </section>
    <div class="room-overlay" id="viewer-overlay">
      <div class="room-overlay-card"><span class="room-ring" id="loading-ring" aria-hidden="true"></span><h1 id="overlay-title"></h1><p id="overlay-detail"></p><button type="button" class="room-retry" id="retry" data-i18n="overlay.retry" hidden></button></div>
    </div>
  </div>
`;

function element<T extends HTMLElement>(selector: string): T {
  const found = app!.querySelector<T>(selector);
  if (!found) throw new Error(`${selector} not found`);
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
const reducedMotion = element<HTMLButtonElement>('#reduced-motion');
const menuToggle = element<HTMLButtonElement>('#menu-toggle');
const tools = element<HTMLElement>('#room-tools');
const qualityButtons = Array.from(app.querySelectorAll<HTMLButtonElement>('[data-quality]'));
const lightButtons = Array.from(app.querySelectorAll<HTMLButtonElement>('[data-light]'));
const languageButtons = Array.from(app.querySelectorAll<HTMLButtonElement>('[data-language]'));
const listeners = new AbortController();
/** The character starts on the room floor near its open front corner, facing +X (the way out towards the intro), so the whole room shows. */
const SPAWN = { position: { x: 2.3, z: 2.3 }, yaw: Math.PI / 2 };
const readyHint = (running: boolean) => t('hud.hint', { run: t(running ? 'hud.runOn' : 'hud.runOff') });
let running = false;
let movementState: MovementState | null = null;
let movementText: string | undefined;
let lastStatus: ViewerStatus = { kind: 'loading', title: '', detail: '' };
let currentSign: SignLink | null = null;
let light: LightPreset = 'neutral';
let camera: CameraMode = 'follow';
let viewer: CharacterViewer | undefined;
let generation = 0;
let disposed = false;

// Off until switched on here or in the studio (the room page does not follow the system setting).
const motionReduced = () => preferences.reducedMotion ?? false;

function applyPreferences(): void {
  for (const button of qualityButtons) button.setAttribute('aria-pressed', String(button.dataset.quality === preferences.quality));
  document.documentElement.dataset.reducedMotion = String(motionReduced());
  reducedMotion.setAttribute('aria-pressed', String(motionReduced()));
}

/** Every text of the page in the current language. */
function applyTexts(): void {
  const language = getLanguage();
  document.documentElement.lang = language;
  document.title = t('page.title');
  document.querySelector('meta[name="description"]')?.setAttribute('content', t('page.description'));
  for (const node of app!.querySelectorAll<HTMLElement>('[data-i18n]')) node.textContent = t(node.dataset.i18n as MessageKey);
  for (const node of app!.querySelectorAll<HTMLElement>('[data-i18n-label]')) node.setAttribute('aria-label', t(node.dataset.i18nLabel as MessageKey));
  for (const button of languageButtons) button.setAttribute('aria-pressed', String(button.dataset.language === language));
  menuToggle.setAttribute('aria-label', t(tools.hidden ? 'menu.open' : 'menu.close'));
  updateStatus(lastStatus);
  updateMovement(movementState, movementText);
  updateSign(currentSign);
}

function updateStatus(state: ViewerStatus): void {
  lastStatus = state;
  status.dataset.state = state.kind;
  statusLabel.textContent = state.kind === 'ready' ? t('status.ready') : state.kind === 'loading' ? t('status.loading') : state.title;
  host.setAttribute('aria-busy', String(state.kind === 'loading'));
  overlay.hidden = state.kind === 'ready';
  overlayTitle.textContent = state.kind === 'loading' ? t('overlay.loading') : state.title;
  overlayDetail.textContent = state.kind === 'loading' ? t('overlay.detail') : state.detail;
  loadingRing.hidden = state.kind !== 'loading';
  retry.hidden = state.kind !== 'error';
}

function updateMovement(state: MovementState | null, text?: string): void {
  movementState = state;
  movementText = text;
  hint.textContent = text ?? readyHint(running);
  reset.disabled = state !== 'ready' && state !== 'interacting';
}

function updateSign(sign: SignLink | null): void {
  currentSign = sign;
  signLink.hidden = !sign;
  if (!sign) return;
  signLink.href = sign.link;
  signLink.textContent = `${sign.label} ↗`;
  signLink.dataset.sign = sign.id;
}

/** The options panel: closed by default for a clean view; Escape, a click outside or the button close it. */
function setMenu(open: boolean): void {
  tools.hidden = !open;
  menuToggle.setAttribute('aria-expanded', String(open));
  menuToggle.setAttribute('aria-label', t(open ? 'menu.close' : 'menu.open'));
  host.dataset.menu = open ? 'open' : 'closed';
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
    run: (on) => {
      if (!live()) return;
      running = on;
      updateMovement(movementState, movementText);
    },
    sign: (sign) => { if (live()) updateSign(sign); },
  }, {
    modelId: 'v4rig', view: 'three-quarter', light, wireframe: false, scene: 'room',
    quality: preferences.quality, reducedMotion: motionReduced(), cameraMode: camera, spawn: SPAWN,
  });
}

for (const button of languageButtons) {
  button.addEventListener('click', () => {
    const language = button.dataset.language;
    if (!isLanguage(language) || language === getLanguage()) return;
    preferences.language = language;
    savePreferences(storage, preferences);
    setLanguage(language);
    applyTexts();
  }, { signal: listeners.signal });
}
menuToggle.addEventListener('click', () => setMenu(tools.hidden !== false), { signal: listeners.signal });
window.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape' || tools.hidden) return;
  setMenu(false);
  menuToggle.focus();
}, { signal: listeners.signal });
document.addEventListener('pointerdown', (event) => {
  if (tools.hidden || !(event.target instanceof Node) || tools.contains(event.target) || menuToggle.contains(event.target)) return;
  setMenu(false);
}, { signal: listeners.signal });
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
reducedMotion.addEventListener('click', () => {
  preferences.reducedMotion = !motionReduced();
  savePreferences(storage, preferences);
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
for (const button of app.querySelectorAll<HTMLButtonElement>('.room-tools button, .hud-actions button, .language-switch button, .menu-toggle')) {
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
setMenu(false);
applyTexts();
mount();
