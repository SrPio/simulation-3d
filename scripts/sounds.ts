/**
 * Picks the sound effects from the CC0 packs by Kenney (unzipped into the git-ignored assets/external/sounds/<pack>/,
 * downloaded from kenney.nl) and writes them as small mono MP3s to public/sounds/, plus src/audio/soundFiles.ts with
 * the file list per sound. Needs ffmpeg on the PATH. Run: node scripts/sounds.ts
 *
 * The sounds the packs lack (soda fizz, casters rolling, the chick's cheep, the swing of a blow) are synthesised in
 * the browser by src/audio/Sounds.ts instead.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = new URL('../', import.meta.url);
const PACKS = new URL('assets/external/sounds/', ROOT);
const OUT = new URL('public/sounds/', ROOT);
const LIST = new URL('src/audio/soundFiles.ts', ROOT);

/** Sound name → source files as pack/file (the variants played at random). */
export const SOURCES: Record<string, string[]> = {
  // Pieces knocked about, by what they are made of.
  brick: ['impact-sounds/impactMining_000', 'impact-sounds/impactMining_001', 'impact-sounds/impactMining_002', 'impact-sounds/impactMining_003'],
  wood: ['impact-sounds/impactWood_light_000', 'impact-sounds/impactWood_light_002', 'impact-sounds/impactWood_medium_001', 'impact-sounds/impactWood_medium_003'],
  woodHeavy: ['impact-sounds/impactWood_heavy_000', 'impact-sounds/impactWood_heavy_002', 'impact-sounds/impactWood_heavy_004'],
  pin: ['impact-sounds/impactPlank_medium_000', 'impact-sounds/impactPlank_medium_002', 'impact-sounds/impactPlank_medium_004'],
  ball: ['impact-sounds/impactSoft_heavy_000', 'impact-sounds/impactSoft_heavy_002'],
  cardboard: ['impact-sounds/impactSoft_medium_000', 'impact-sounds/impactSoft_medium_002', 'impact-sounds/impactSoft_medium_004'],
  plastic: ['impact-sounds/impactGeneric_light_000', 'impact-sounds/impactGeneric_light_002', 'impact-sounds/impactGeneric_light_004'],
  metal: ['impact-sounds/impactMetal_medium_000', 'impact-sounds/impactMetal_medium_002', 'impact-sounds/impactMetal_heavy_001'],
  rubber: ['impact-sounds/impactSoft_heavy_001', 'impact-sounds/impactSoft_heavy_003'],
  laptop: ['impact-sounds/impactPlate_medium_000', 'impact-sounds/impactPlate_medium_002', 'impact-sounds/impactTin_medium_001'],
  // The character.
  punch: ['impact-sounds/impactPunch_medium_000', 'impact-sounds/impactPunch_medium_002', 'impact-sounds/impactPunch_heavy_001'],
  stepWood: ['impact-sounds/footstep_wood_000', 'impact-sounds/footstep_wood_001', 'impact-sounds/footstep_wood_002', 'impact-sounds/footstep_wood_003'],
  stepGround: ['impact-sounds/footstep_concrete_000', 'impact-sounds/footstep_concrete_001', 'impact-sounds/footstep_concrete_002', 'impact-sounds/footstep_concrete_003'],
  stepGrass: ['impact-sounds/footstep_grass_000', 'impact-sounds/footstep_grass_002'],
  cloth: ['rpg-audio/cloth1', 'rpg-audio/cloth2', 'rpg-audio/cloth3'],
  // Seats and the laptop.
  creak: ['rpg-audio/creak1', 'rpg-audio/creak2', 'rpg-audio/creak3'],
  lidOpen: ['rpg-audio/bookOpen'],
  lidClose: ['rpg-audio/bookClose'],
  key: ['interface-sounds/click_001', 'interface-sounds/click_002', 'interface-sounds/click_003', 'interface-sounds/click_004', 'interface-sounds/click_005'],
  // The world.
  floorKey: ['interface-sounds/switch_002', 'interface-sounds/switch_005'],
  zone: ['interface-sounds/maximize_006'],
  open: ['interface-sounds/confirmation_002'],
  reset: ['interface-sounds/drop_002'],
  beep: ['digital-audio/pepSound1'],
  beepGo: ['digital-audio/highUp'],
  lap: ['interface-sounds/bong_001'],
  best: ['digital-audio/threeTone2'],
  bell: ['impact-sounds/impactBell_heavy_000', 'impact-sounds/impactBell_heavy_002'],
  konami: ['digital-audio/powerUp7'],
  crash: ['impact-sounds/impactPlate_heavy_000', 'impact-sounds/impactPlate_heavy_002', 'impact-sounds/impactMetal_light_001'],
  ui: ['interface-sounds/toggle_002'],
};

function main() {
  if (!existsSync(PACKS)) throw new Error('Unzip the Kenney packs into assets/external/sounds/<pack>/ first');
  mkdirSync(OUT, { recursive: true });
  for (const file of readdirSync(OUT)) rmSync(new URL(file, OUT));
  const files: Record<string, string[]> = {};
  let bytes = 0;
  for (const [name, sources] of Object.entries(SOURCES)) {
    files[name] = sources.map((source, index) => {
      const [pack, file] = source.split('/');
      const input = fileURLToPath(new URL(`${pack}/Audio/${file}.ogg`, PACKS));
      const output = `${name}-${index}.mp3`;
      // Mono with the silent lead-in trimmed, so a sound starts the moment it is played; levels stay as recorded.
      execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', input, '-ac', '1', '-ar', '44100',
        '-af', 'silenceremove=start_periods=1:start_threshold=-60dB',
        '-b:a', '64k', fileURLToPath(new URL(output, OUT))]);
      bytes += statSync(new URL(output, OUT)).size;
      return output;
    });
  }
  const lines = [
    '// Generated by scripts/sounds.ts from the CC0 packs by Kenney (kenney.nl). Do not edit.',
    '',
    '/** Files in public/sounds/ for each recorded sound, the variants played at random. */',
    'export const SOUND_FILES = {',
    ...Object.entries(files).map(([name, list]) => `  ${name}: [${list.map((file) => `'${file}'`).join(', ')}],`),
    '} as const;',
    '',
    'export type RecordedSound = keyof typeof SOUND_FILES;',
    '',
  ];
  writeFileSync(LIST, lines.join('\n'));
  console.log(`${readdirSync(OUT).length} files, ${(bytes / 1024).toFixed(0)} KB`);
}

main();
