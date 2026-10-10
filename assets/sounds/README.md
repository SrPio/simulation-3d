# Sound effects

The recorded sounds in `public/sounds/` come from the CC0 packs by Kenney (www.kenney.nl), downloaded from the official asset pages, except the floor keys' keystroke and the brick knocks (below):

| Pack | Page | License |
|---|---|---|
| Impact Sounds 1.0 | https://kenney.nl/assets/impact-sounds | CC0 1.0 |
| Interface Sounds | https://kenney.nl/assets/interface-sounds | CC0 1.0 |
| RPG Audio | https://kenney.nl/assets/rpg-audio | CC0 1.0 |
| Digital Audio | https://kenney.nl/assets/digital-audio | CC0 1.0 |

The packs, the keystroke take and the brick knocks are kept in the git-ignored `assets/external/sounds/<pack>/`. `node scripts/sounds.ts` picks the files listed in its `SOURCES` table, converts them with ffmpeg to mono 64 kbps MP3 with the silent lead-in trimmed, and writes `src/audio/soundFiles.ts`.

The swing of a blow, the chick's cheep, the bottle pop, the casters rolling and the soda fizz are not recordings: `src/audio/Sounds.ts` synthesises them with the Web Audio API.

## Floor keys (`floorKey-0.mp3`)

The four arrow keys on the floor play one keystroke cut from "Mechanical keyboard sound" by bluszcz
(https://opengameart.org/node/60025, `keyboard01_0.ogg`, its first press), licensed CC-BY 3.0
(https://creativecommons.org/licenses/by/3.0/).

## Brick knocks (`brick-0.mp3` … `brick-7.mp3`)

Used for the bricks, the end wall and the name letters. They are distributed under the MIT License; its notice:

```
MIT License

Copyright (c) 2019 Bruno SIMON

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```