# Sound effects

Every recorded sound in `public/sounds/` comes from the CC0 packs by Kenney (www.kenney.nl), downloaded from the official asset pages:

| Pack | Page | License |
|---|---|---|
| Impact Sounds 1.0 | https://kenney.nl/assets/impact-sounds | CC0 1.0 |
| Interface Sounds | https://kenney.nl/assets/interface-sounds | CC0 1.0 |
| RPG Audio | https://kenney.nl/assets/rpg-audio | CC0 1.0 |
| Digital Audio | https://kenney.nl/assets/digital-audio | CC0 1.0 |

The packs are unzipped into the git-ignored `assets/external/sounds/<pack>/`. `node scripts/sounds.ts` picks the files listed in its `SOURCES` table, converts them with ffmpeg to mono 64 kbps MP3 with the silent lead-in trimmed, and writes `src/audio/soundFiles.ts`.

The swing of a blow, the chick's cheep, the bottle pop, the casters rolling and the soda fizz are not recordings: `src/audio/Sounds.ts` synthesises them with the Web Audio API.
