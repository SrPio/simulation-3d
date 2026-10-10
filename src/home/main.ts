import './home.css';
import './startScreen.css';
import './touch.css';
import './nitroGauge.css';
import { LANGUAGES, getLanguage, initialLanguage, isLanguage, setLanguage, t, type MessageKey } from '../core/i18n.ts';
import { QUALITY, isQualityId, readPreferences, savePreferences } from '../core/quality.ts';
import { StartScreen } from './StartScreen.ts';
import { TouchControls } from './TouchControls.ts';
import { NitroGauge } from './NitroGauge.ts';
import { GamepadInput, type PadKind } from '../input/GamepadInput.ts';
import { Sounds } from '../audio/Sounds.ts';
import { CharacterViewer, type CameraMode, type LightPreset, type MovementState, type ViewerStatus } from '../viewer/CharacterViewer';

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
      <div class="language-switch tool-segmented" role="group" data-i18n-label="language.label">
        ${LANGUAGES.map((language) => `<button type="button" data-language="${language}" lang="${language}" aria-pressed="false">${language.toUpperCase()}</button>`).join('')}
      </div>
    </header>
    <button type="button" class="menu-toggle" id="menu-toggle" aria-expanded="false" aria-controls="room-tools" data-i18n-label="menu.open">
      <span class="menu-icon" aria-hidden="true"><span></span><span></span><span></span></span>
    </button>
    <div class="zoom-controls" id="zoom-controls" role="group" data-i18n-label="zoom.label">
      <button type="button" class="zoom-button" id="zoom-in" data-i18n-label="zoom.in"><svg class="zoom-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="10" cy="10" r="6.5"/><path d="M15 15l5.5 5.5"/><path d="M7 10h6M10 7v6"/></svg></button>
      <button type="button" class="zoom-button" id="zoom-out" data-i18n-label="zoom.out"><svg class="zoom-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="10" cy="10" r="6.5"/><path d="M15 15l5.5 5.5"/><path d="M7 10h6"/></svg></button>
    </div>
    <nav class="room-tools" id="room-tools" data-i18n-label="menu.label" hidden>
      <div class="tool-group" role="group" aria-labelledby="sound-label">
        <span class="tool-label" id="sound-label" data-i18n="sound.label"></span>
        <button type="button" class="tool-toggle" id="sound-toggle" aria-pressed="true" aria-keyshortcuts="M"><span class="toggle-track" aria-hidden="true"></span><span id="sound-state"></span></button>
      </div>
      <div class="tool-group" role="group" aria-labelledby="quality-label">
        <span class="tool-label" id="quality-label" data-i18n="quality.label"></span>
        <div class="tool-segmented">
          ${Object.keys(QUALITY).map((id) => `<button type="button" data-quality="${id}" aria-pressed="false" data-i18n="quality.${id}"></button>`).join('')}
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
      <div class="tool-group" role="group" aria-labelledby="reset-label">
        <span class="tool-label" id="reset-label" data-i18n="reset.label"></span>
        <button type="button" class="tool-toggle" id="reset-position" aria-keyshortcuts="R" data-i18n="reset.button"></button>
      </div>
    </nav>
    <div class="room-overlay" id="viewer-overlay" hidden>
      <div class="room-overlay-card"><h1 id="overlay-title"></h1><p id="overlay-detail"></p><button type="button" class="room-retry" id="retry" data-i18n="overlay.retry" hidden></button></div>
    </div>
  </div>
`;

function element<T extends HTMLElement>(selector: string): T {
  const found = app!.querySelector<T>(selector);
  if (!found) throw new Error(`${selector} not found`);
  return found;
}

const host = element<HTMLDivElement>('#canvas-host');
const overlay = element<HTMLDivElement>('#viewer-overlay');
const overlayTitle = element<HTMLHeadingElement>('#overlay-title');
const overlayDetail = element<HTMLParagraphElement>('#overlay-detail');
const retry = element<HTMLButtonElement>('#retry');
const reset = element<HTMLButtonElement>('#reset-position');
const soundToggle = element<HTMLButtonElement>('#sound-toggle');
const soundState = element<HTMLSpanElement>('#sound-state');
const cameraFree = element<HTMLButtonElement>('#camera-free');
const reducedMotion = element<HTMLButtonElement>('#reduced-motion');
const menuToggle = element<HTMLButtonElement>('#menu-toggle');
const tools = element<HTMLElement>('#room-tools');
const zoomControls = element<HTMLDivElement>('#zoom-controls');
/** Each zoom button press changes the camera zoom by this factor (within the viewer's zoom limits). */
const ZOOM_STEP = 1.25;
const qualityButtons = Array.from(app.querySelectorAll<HTMLButtonElement>('[data-quality]'));
const languageButtons = Array.from(app.querySelectorAll<HTMLButtonElement>('[data-language]'));
const listeners = new AbortController();
/** The character starts on the room floor near its open front corner, facing +X (the way out towards the intro), so the whole room shows. */
const SPAWN = { position: { x: 2.3, z: 2.3 }, yaw: Math.PI / 2 };
/** The room page always uses the neutral light; only the studio offers the violet one. */
const LIGHT: LightPreset = 'neutral';
let lastStatus: ViewerStatus = { kind: 'loading', title: '', detail: '' };
/** Whether START was pressed: until then the keys do not move the character. */
let started = false;
/**
 * A touch screen (a coarse pointer and no fine one): on-screen controls instead of the keyboard keys and the controls
 * panel on the floor. A first touch on any other device brings the on-screen controls too.
 */
let touch = window.matchMedia('(pointer: coarse)').matches && !window.matchMedia('(any-pointer: fine)').matches;
document.documentElement.dataset.touch = String(touch);
let camera: CameraMode = 'follow';
let viewer: CharacterViewer | undefined;
let generation = 0;
let disposed = false;

// Off until switched on here or in the studio (the room page does not follow the system setting).
const motionReduced = () => preferences.reducedMotion ?? false;

/** Sound effects start with START (browsers only allow audio after a gesture); M or the menu switch mutes them. */
const sounds = new Sounds({ muted: !preferences.sound, base: import.meta.env.BASE_URL });

const touchControls = new TouchControls(app.querySelector<HTMLDivElement>('.room-page')!, host, () => viewer?.input);
const nitroGauge = new NitroGauge(app.querySelector<HTMLDivElement>('.room-page')!, host);
const gamepad = new GamepadInput(() => viewer?.input);
gamepad.inZone = () => (host.dataset.sign ?? 'none') !== 'none';
gamepad.onMenu = () => setMenu(tools.hidden !== false);
gamepad.onUse = (kind) => setInputMode('gamepad', kind);
// On the loading screen ✕/A or Start presses START.
gamepad.onButton = (button) => {
  if (start.current !== 'ready' || (button !== 'cross' && button !== 'start')) return false;
  start.press();
  return true;
};

/**
 * What the player uses now, for the hints: `data-input` (keyboard | touch | gamepad) and `data-gamepad` on the page,
 * and the key the sign zones show (ENTER, the pad's ✕ or A, nothing on a touch screen).
 */
let inputMode = '';
gamepad.start();

function setInputMode(mode: 'keyboard' | 'touch' | 'gamepad', kind?: PadKind): void {
  const key = `${mode}:${kind ?? ''}`;
  if (key === inputMode) return;
  inputMode = key;
  const root = document.documentElement;
  root.dataset.input = mode;
  if (kind) root.dataset.gamepad = kind;
  viewer?.setOpenKey(mode === 'gamepad' ? (kind === 'xbox' ? 'A' : '✕') : mode === 'touch' ? '' : 'ENTER');
}

const start = new StartScreen(app.querySelector<HTMLDivElement>('.room-page')!, {
  label: t('start.label'),
  reducedMotion: motionReduced,
  onStart: () => {
    started = true;
    if (touch) touchControls.show();
    sounds.unlock();
    applySound();
    viewer?.setInputEnabled(true);
  },
});

function applySound(): void {
  soundToggle.setAttribute('aria-pressed', String(preferences.sound));
  soundState.textContent = t(preferences.sound ? 'sound.on' : 'sound.off');
  host.dataset.sound = !sounds.unlocked ? 'locked' : preferences.sound ? 'on' : 'off';
}

function toggleSound(): void {
  preferences.sound = !preferences.sound;
  savePreferences(storage, preferences);
  sounds.setMuted(!preferences.sound);
  applySound();
  sounds.play('ui');
}

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
  start.setLabel(t('start.label'));
  touchControls.setLabels(t);
  applySound();
  updateStatus(lastStatus);
}

function updateStatus(state: ViewerStatus): void {
  lastStatus = state;
  host.dataset.state = state.kind;
  host.setAttribute('aria-busy', String(state.kind === 'loading'));
  // While loading, the start screen draws the progress; the card only reports errors.
  overlay.hidden = state.kind !== 'error';
  if (state.kind === 'error') start.hide();
  else if (start.current !== 'done') start.show();
  if (state.kind === 'ready') start.ready();
  overlayTitle.textContent = state.title;
  overlayDetail.textContent = state.detail;
  retry.hidden = state.kind !== 'error';
}

function updateMovement(state: MovementState | null): void {
  reset.disabled = state !== 'ready' && state !== 'interacting';
}

/** The options panel: closed by default for a clean view; Escape, a click outside or the button close it. */
function setMenu(open: boolean): void {
  tools.hidden = !open;
  menuToggle.setAttribute('aria-expanded', String(open));
  menuToggle.setAttribute('aria-label', t(open ? 'menu.close' : 'menu.open'));
  host.dataset.menu = open ? 'open' : 'closed';
  // The open panel covers the zoom buttons' place under the menu button.
  zoomControls.hidden = open;
}

function mount(): void {
  if (disposed) return;
  const current = ++generation;
  const live = () => !disposed && current === generation;
  viewer?.dispose();
  updateMovement(null);
  host.dataset.light = LIGHT;
  host.dataset.scene = 'room';
  host.dataset.model = 'v4rig';
  viewer = new CharacterViewer(host, {
    status: (state) => { if (live()) updateStatus(state); },
    stats: () => {},
    orbit: () => {},
    animation: () => {},
    movement: (state) => { if (live()) updateMovement(state); },
    run: (on) => { if (live()) touchControls.setRunning(on); },
  }, {
    modelId: 'v4rig', view: 'three-quarter', light: LIGHT, wireframe: false, scene: 'room',
    quality: preferences.quality, reducedMotion: motionReduced(), cameraMode: camera, spawn: SPAWN, sounds, touch,
  });
  viewer.setInputEnabled(started);
  const mode = inputMode;
  inputMode = '';
  const [kind, pad] = mode.split(':');
  setInputMode((kind || (touch ? 'touch' : 'keyboard')) as 'keyboard' | 'touch' | 'gamepad', (pad || undefined) as PadKind | undefined);
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
element<HTMLButtonElement>('#zoom-in').addEventListener('click', () => viewer?.zoom(ZOOM_STEP), { signal: listeners.signal });
element<HTMLButtonElement>('#zoom-out').addEventListener('click', () => viewer?.zoom(1 / ZOOM_STEP), { signal: listeners.signal });
menuToggle.addEventListener('click', () => setMenu(tools.hidden !== false), { signal: listeners.signal });
soundToggle.addEventListener('click', toggleSound, { signal: listeners.signal });
window.addEventListener('keydown', (event) => {
  if (event.code !== 'KeyM' || event.repeat || event.ctrlKey || event.altKey || event.metaKey) return;
  if (event.target instanceof Element && event.target.closest('input, select, textarea')) return;
  toggleSound();
}, { signal: listeners.signal });
document.addEventListener('visibilitychange', () => sounds.setHidden(document.hidden), { signal: listeners.signal });
window.addEventListener('keydown', () => setInputMode('keyboard'), { signal: listeners.signal });
window.addEventListener('pointerdown', (event) => setInputMode(event.pointerType === 'touch' ? 'touch' : 'keyboard'), { signal: listeners.signal });
window.addEventListener('touchstart', () => {
  if (touch) return;
  touch = true;
  document.documentElement.dataset.touch = 'true';
  if (started) touchControls.show();
}, { signal: listeners.signal, passive: true });
// A soft click for the page's own buttons (the sound switch plays its own once it is on).
for (const button of app.querySelectorAll<HTMLButtonElement>('.room-tools button:not(#sound-toggle), .language-switch button, .menu-toggle, .zoom-button')) {
  button.addEventListener('click', () => sounds.play('ui'), { signal: listeners.signal });
}
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
reset.addEventListener('click', () => {
  viewer?.resetPosition();
  setMenu(false);
}, { signal: listeners.signal });
// Buttons keep focus after a click; Space and arrows must still drive the character, not the button.
for (const button of app.querySelectorAll<HTMLButtonElement>('.room-tools button, .language-switch button, .menu-toggle, .zoom-button')) {
  button.addEventListener('pointerup', () => button.blur(), { signal: listeners.signal });
}

function dispose(): void {
  if (disposed) return;
  disposed = true;
  listeners.abort();
  start.dispose();
  touchControls.dispose();
  nitroGauge.dispose();
  gamepad.dispose();
  viewer?.dispose();
  sounds.dispose();
  viewer = undefined;
}

window.addEventListener('pagehide', (event) => { if (!event.persisted) dispose(); }, { signal: listeners.signal });
if (import.meta.hot) import.meta.hot.dispose(dispose);
applyPreferences();
setMenu(false);
applyTexts();
mount();
