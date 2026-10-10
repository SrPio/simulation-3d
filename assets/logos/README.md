# Logos of the tech tower

Official logos of the tools this project is built with, downloaded unaltered on 2026-10-08 for the cubes of the
tech tower outside (`scripts/tech_atlas.ts` → `assets/textures/outside/tech-atlas.png`). They only name the tools;
each mark belongs to its owner and keeps its owner's terms.

| File | Source |
|---|---|
| typescript.svg | https://raw.githubusercontent.com/microsoft/TypeScript-Website/v2/packages/typescriptlang-org/static/branding/ts-logo-512.svg |
| node.svg | https://nodejs.org/static/logos/nodejsHex.svg (OpenJS Foundation trademark policy) |
| pnpm.svg | https://raw.githubusercontent.com/pnpm/pnpm.io/main/static/img/pnpm-no-name-with-frame.svg |
| vite.svg | https://raw.githubusercontent.com/vitejs/vite/main/docs/public/logo.svg |
| three.svg | https://raw.githubusercontent.com/mrdoob/three.js/dev/files/icon.svg |
| github.svg | https://raw.githubusercontent.com/primer/octicons/main/icons/mark-github-24.svg |
| playwright.svg | https://playwright.dev/img/playwright-logo.svg |
| blender.png | `square/blender_icon_512x512.png` from https://download.blender.org/branding/blender_logo_kit.zip (unaltered, refers to Blender only) |
| gltf.svg | https://raw.githubusercontent.com/KhronosGroup/glTF/main/specification/figures/glTF_RGB_June16.svg |
| javascript.svg | https://raw.githubusercontent.com/voodootikigod/logo.js/master/js.svg (MIT, notice inside the file); its "JS" is on the yellow punching bag |
| openvdb.svg | https://raw.githubusercontent.com/AcademySoftwareFoundation/artwork/main/projects/openvdb/icon/color/openvdb-icon-color.svg |

## Punching bags and the Universidad del Valle logo

`node scripts/logo_outlines.ts` writes `logo-outlines.json`: the "JS" of javascript.svg and the "TS" of
typescript.svg flattened into outlines (used unaltered, only simplified to about a millimetre at the bags' size) for
`scripts/blender/create_boxing.py`, and the Universidad del Valle logo for `scripts/blender/create_univalle.py`. The
Univalle logo has no file here: its shapes (red disc, white U and V with the red fillet between them) were measured on
the image the user supplied on 2026-10-10 and are written as numbers in `UNIVALLE` in that script.
