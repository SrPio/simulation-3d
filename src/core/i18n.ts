export type Language = 'es' | 'en';
export const LANGUAGES: readonly Language[] = ['es', 'en'];

const es = {
  'page.title': 'Developer Room',
  'page.description': 'Developer Room: el cuarto isométrico de un developer con su personaje en 3D.',
  'room.label': 'Habitación del developer en 3D',
  'brand.label': 'Developer Room, inicio',
  'language.label': 'Idioma',
  'menu.open': 'Abrir opciones',
  'menu.close': 'Cerrar opciones',
  'menu.label': 'Opciones de la escena',
  'status.loading': 'Cargando',
  'status.ready': 'Listo',
  'quality.label': 'Calidad',
  'quality.auto': 'Auto',
  'quality.high': 'Alta',
  'quality.low': 'Baja',
  'light.label': 'Luz',
  'light.neutral': 'Neutra',
  'light.violet': 'Violeta',
  'camera.label': 'Cámara',
  'camera.free': 'Libre',
  'camera.copy': 'Desactivada: vista isométrica fija que sigue al personaje. Activada: arrastra para girar y usa la rueda para acercar.',
  'motion.label': 'Movimiento',
  'motion.reduced': 'Reducido',
  'motion.copy': 'Activado: cámara sin inercia, zonas del suelo y pantalla del portátil quietas, sin transiciones de la interfaz. Las animaciones del personaje se mantienen.',
  'hud.label': 'Controles del personaje',
  'hud.hint': 'W A S D o flechas para caminar · Shift: correr {run} · Espacio para saltar · F para lanzar',
  'hud.runOn': 'activado',
  'hud.runOff': 'desactivado',
  'hud.help': 'Ayuda',
  'hud.reset': 'Restablecer posición',
  'hud.helpText': 'W A S D o flechas: caminar. Shift: activar o desactivar correr. Espacio: saltar hacia adelante. F: lanzar el portátil. Cerca de la silla o la cama, E: sentarse y levantarse. Sentado, L: abrir o cerrar el portátil. Fuera de la habitación, sigue las flechas del cruce: entra en la zona marcada frente a un cartel y pulsa Enter (o haz clic en el cartel) para abrir su enlace. Empuja las letras, los bolos y los ladrillos.',
  'overlay.loading': 'Cargando la habitación',
  'overlay.detail': 'Preparando el personaje, la habitación y el exterior.',
  'overlay.retry': 'Volver a intentar',
  'viewer.loading': 'Cargando {label}',
  'viewer.preparing': 'Preparando {file}. {copy}',
  'viewer.webgl': 'WebGL 2 no está disponible',
  'viewer.webglDetail': 'Activa la aceleración gráfica o abre esta página en un navegador compatible. Después, vuelve a intentarlo.',
  'viewer.start': 'No se pudo iniciar el visor',
  'viewer.startDetail': 'No se pudo crear el contexto gráfico. Puedes volver a intentarlo.',
  'viewer.room': 'No se pudo cargar la habitación',
  'viewer.roomMissing': 'Falta el archivo {files}. Genera la habitación y vuelve a intentarlo, o vuelve al estudio.',
  'viewer.roomInvalid': 'El archivo {files} no está disponible o no es un GLB válido. Vuelve a intentarlo, o vuelve al estudio.',
  'viewer.model': 'No se pudo cargar {label}',
  'viewer.modelMissing': 'Falta el archivo {file}. Añade el modelo y vuelve a intentarlo, o selecciona otra versión.',
  'viewer.modelInvalid': 'El archivo {file} no está disponible o no es un GLB válido. Comprueba el modelo y vuelve a intentarlo, o selecciona otra versión.',
  'viewer.contextLost': 'Se ha interrumpido el contexto gráfico',
  'viewer.contextLostDetail': 'Esperando a que se restablezca la GPU. También puedes reiniciar el visor con Volver a intentar.',
  'viewer.contextBack': 'Contexto recuperado. Preparando {file}.',
  'seat.chair': 'la silla',
  'seat.bed': 'la cama',
  'prompt.sit': 'E: sentarse en {seat}',
  'prompt.going': 'Yendo a {seat}…',
  'prompt.standing': 'Levantándose…',
  'prompt.seated': 'Sentado en {seat} · L: abrir el portátil · E: levantarse',
  'prompt.typing': 'Programando · L: cerrar el portátil · E: cerrarlo y levantarse',
  'prompt.sitting': 'Sentándose…',
  'prompt.opening': 'Abriendo el portátil…',
  'prompt.closing': 'Cerrando el portátil…',
  'refuse.near': 'Acércate a la silla o a la cama para sentarte.',
  'refuse.wait': 'Espera a que termine el movimiento.',
  'refuse.exit': 'La salida está bloqueada.',
  'refuse.sit': 'Siéntate para usar el portátil.',
  'refuse.blocked': 'El camino al asiento está bloqueado.',
  'bubble.sit': 'Sentarse',
  'sign.portfolio.title': 'PORTAFOLIO',
  'sign.portfolio.label': 'Ver portafolio',
  'sign.github.title': 'GITHUB',
  'sign.github.label': 'Ver GitHub',
  'sign.linkedin.title': 'LINKEDIN',
  'sign.linkedin.label': 'Ver LinkedIn',
  'zone.title': 'REINICIAR',
  'zone.bowling': 'Reiniciar bolos',
  'zone.bricks': 'Reiniciar ladrillos',
  'floor.introBefore': 'USA LAS',
  'floor.introAfter': 'TECLAS',
  'floor.introNext': 'PARA MOVERTE',
  'floor.links': 'ENLACES',
  'floor.controls': 'CONTROLES',
  'floor.playground': 'ZONA DE JUEGOS',
  'floor.bowling': 'BOLOS',
  'controls.move': 'Moverse',
  'controls.run': 'Correr / caminar',
  'controls.jump': 'Saltar',
  'controls.sit': 'Sentarse y levantarse',
  'controls.laptop': 'Abrir el portátil',
  'controls.throw': 'Lanzar el portátil',
  'controls.open': 'Abrir enlace / reiniciar',
  'key.space': 'ESPACIO',
  'word.or': 'u',
} as const;

export type MessageKey = keyof typeof es;

const en: Record<MessageKey, string> = {
  'page.title': 'Developer Room',
  'page.description': "Developer Room: a developer's isometric room with a 3D character.",
  'room.label': "The developer's 3D room",
  'brand.label': 'Developer Room, home',
  'language.label': 'Language',
  'menu.open': 'Open options',
  'menu.close': 'Close options',
  'menu.label': 'Scene options',
  'status.loading': 'Loading',
  'status.ready': 'Ready',
  'quality.label': 'Quality',
  'quality.auto': 'Auto',
  'quality.high': 'High',
  'quality.low': 'Low',
  'light.label': 'Light',
  'light.neutral': 'Neutral',
  'light.violet': 'Violet',
  'camera.label': 'Camera',
  'camera.free': 'Free',
  'camera.copy': 'Off: fixed isometric view that follows the character. On: drag to orbit and use the wheel to zoom.',
  'motion.label': 'Motion',
  'motion.reduced': 'Reduced',
  'motion.copy': 'On: no camera inertia, still floor zones and laptop screen, no interface transitions. Character animations stay.',
  'hud.label': 'Character controls',
  'hud.hint': 'W A S D or arrows to walk · Shift: running {run} · Space to jump · F to throw',
  'hud.runOn': 'on',
  'hud.runOff': 'off',
  'hud.help': 'Help',
  'hud.reset': 'Reset position',
  'hud.helpText': 'W A S D or arrows: walk. Shift: turn running on or off. Space: jump forward. F: throw the laptop. Near the chair or the bed, E: sit down and stand up. Seated, L: open or close the laptop. Outside the room, follow the arrows at the crossroads: step into the marked zone in front of a sign and press Enter (or click the sign) to open its link. Push the letters, the pins and the bricks around.',
  'overlay.loading': 'Loading the room',
  'overlay.detail': 'Getting the character, the room and the outside ready.',
  'overlay.retry': 'Try again',
  'viewer.loading': 'Loading {label}',
  'viewer.preparing': 'Getting {file} ready. {copy}',
  'viewer.webgl': 'WebGL 2 is not available',
  'viewer.webglDetail': 'Turn on hardware acceleration or open this page in a supported browser, then try again.',
  'viewer.start': 'The viewer could not start',
  'viewer.startDetail': 'The graphics context could not be created. You can try again.',
  'viewer.room': 'The room could not be loaded',
  'viewer.roomMissing': 'The file {files} is missing. Build the room and try again, or go back to the studio.',
  'viewer.roomInvalid': 'The file {files} is not available or is not a valid GLB. Try again, or go back to the studio.',
  'viewer.model': '{label} could not be loaded',
  'viewer.modelMissing': 'The file {file} is missing. Add the model and try again, or pick another version.',
  'viewer.modelInvalid': 'The file {file} is not available or is not a valid GLB. Check the model and try again, or pick another version.',
  'viewer.contextLost': 'The graphics context was interrupted',
  'viewer.contextLostDetail': 'Waiting for the GPU to come back. You can also restart the viewer with Try again.',
  'viewer.contextBack': 'Context restored. Getting {file} ready.',
  'seat.chair': 'the chair',
  'seat.bed': 'the bed',
  'prompt.sit': 'E: sit on {seat}',
  'prompt.going': 'Going to {seat}…',
  'prompt.standing': 'Standing up…',
  'prompt.seated': 'Sitting on {seat} · L: open the laptop · E: stand up',
  'prompt.typing': 'Coding · L: close the laptop · E: close it and stand up',
  'prompt.sitting': 'Sitting down…',
  'prompt.opening': 'Opening the laptop…',
  'prompt.closing': 'Closing the laptop…',
  'refuse.near': 'Get closer to the chair or the bed to sit down.',
  'refuse.wait': 'Wait until the movement ends.',
  'refuse.exit': 'The way out is blocked.',
  'refuse.sit': 'Sit down to use the laptop.',
  'refuse.blocked': 'The way to the seat is blocked.',
  'bubble.sit': 'Sit down',
  'sign.portfolio.title': 'PORTFOLIO',
  'sign.portfolio.label': 'View portfolio',
  'sign.github.title': 'GITHUB',
  'sign.github.label': 'View GitHub',
  'sign.linkedin.title': 'LINKEDIN',
  'sign.linkedin.label': 'View LinkedIn',
  'zone.title': 'RESET',
  'zone.bowling': 'Reset the pins',
  'zone.bricks': 'Reset the bricks',
  'floor.introBefore': 'USE YOUR',
  'floor.introAfter': 'KEYS',
  'floor.introNext': 'TO MOVE AROUND',
  'floor.links': 'LINKS',
  'floor.controls': 'CONTROLS',
  'floor.playground': 'PLAYGROUND',
  'floor.bowling': 'BOWLING',
  'controls.move': 'Move',
  'controls.run': 'Run / walk',
  'controls.jump': 'Jump',
  'controls.sit': 'Sit down and stand up',
  'controls.laptop': 'Open the laptop',
  'controls.throw': 'Throw the laptop',
  'controls.open': 'Open link / reset',
  'key.space': 'SPACE',
  'word.or': 'or',
};

export const MESSAGES: Readonly<Record<Language, Readonly<Record<MessageKey, string>>>> = { es, en };

let current: Language = 'es';
const listeners = new Set<(language: Language) => void>();

export function isLanguage(value: unknown): value is Language {
  return value === 'es' || value === 'en';
}

/** A stored choice wins; otherwise Spanish for Spanish browsers and English for everyone else. */
export function initialLanguage(stored: unknown, browser: readonly string[]): Language {
  if (isLanguage(stored)) return stored;
  return browser[0]?.toLowerCase().startsWith('es') ? 'es' : 'en';
}

export function getLanguage(): Language {
  return current;
}

/** Switch every text that goes through t(); listeners redraw what they painted. The studio stays in Spanish. */
export function setLanguage(language: Language): void {
  if (language === current) return;
  current = language;
  for (const listener of listeners) listener(language);
}

/** Called on every language change until the returned function is called. */
export function onLanguage(listener: (language: Language) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The text for a key in the current language, with {name} placeholders filled in. */
export function t(key: MessageKey, values: Record<string, string> = {}, language: Language = current): string {
  return MESSAGES[language][key].replace(/\{(\w+)\}/g, (match, name: string) => values[name] ?? match);
}
