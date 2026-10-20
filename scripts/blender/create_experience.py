"""The years-of-experience monument in the about-me plaza, behind the Colombian corner's flag, near the plaza's left edge: a
square stone pedestal like the bust's with a dark projector on top whose violet ring glows. The Rubik's cube that floats
over it is built and turned by the viewer (src/scene/RubikMonument.ts), so this file holds only what stands still and
where the cube floats. Builds assets/blender/experience.blend and public/models/experience.glb, which the viewer loads
with the outside.

- `Experience` anchor (decor 'experience', blob `shadow`, `solid` box up to the cube's top) with `Collider_Experience`,
  and `Plaque_experience` on the pedestal's front (painted by the viewer: «Años de experiencia»).
- `ExperienceCube` anchor at the cube's middle with `cube` [edge, drop to the projector's top] (metres).

Run: blender --background --factory-startup --python-exit-code 1 --python scripts/blender/create_experience.py [-- --replace-generated]
"""
import argparse
import sys
from pathlib import Path

import bpy

sys.path.insert(0, str(Path(__file__).resolve().parent))
import create_room as room
from create_outside import BLOCK_YAW, EXPERIENCE, GROUND_Z, at

ROOT = Path(__file__).resolve().parents[2]
BLEND = ROOT / 'assets' / 'blender' / 'experience.blend'
GLB = ROOT / 'public' / 'models' / 'experience.glb'

PEDESTAL = (1.0, 0.95)          # width/depth, height
PROJECTOR = (0.36, 0.07)        # radius, height of the dark disc on top
RING = (0.3, 0.025)             # radius, width of the glowing ring on it
CUBE_EDGE = 1.0                 # the floating cube's edge
CUBE_CENTRE = 2.2               # height of the cube's middle over the ground (it bobs a few centimetres round it)


def build(root):
    stone = room.material('ExperiencePedestal', (0.6, 0.59, 0.62), 0.85)
    dark = room.material('ExperienceProjector', (0.05, 0.045, 0.07), 0.35, 0.6)
    glow = room.material('ExperienceGlow', (0.55, 0.35, 0.95), 0.4, emission=(0.62, 0.38, 1.0), strength=3.0)
    width, height = PEDESTAL
    top = CUBE_CENTRE + CUBE_EDGE * 0.75
    holder = room.anchor('Experience', at(EXPERIENCE), root, BLOCK_YAW, decor='experience', shadow=[width + 0.6, width + 0.6],
                         solid=[width + 0.1, top, width + 0.1])
    w = width / 2
    room.box('ExperiencePedestal', (-w, -w, 0), (w, w, height), stone, holder)
    room.box('ExperiencePedestalTop', (-w - 0.05, -w - 0.05, height - 0.06), (w + 0.05, w + 0.05, height), stone, holder)
    room.box('ExperiencePedestalFoot', (-w - 0.06, -w - 0.06, 0), (w + 0.06, w + 0.06, 0.08), stone, holder)
    radius, thick = PROJECTOR
    room.cylinder('ExperienceProjector', (0, 0, height + thick / 2), radius, thick, dark, holder, top=radius * 0.9, segments=40)
    ring, ring_width = RING
    room.cylinder('ExperienceRing', (0, 0, height + thick + 0.004), ring, 0.008, glow, holder, segments=40)
    room.cylinder('ExperienceRingHole', (0, 0, height + thick + 0.006), ring - ring_width, 0.008, dark, holder, segments=40)
    room.anchor('ExperienceCube', at(EXPERIENCE, CUBE_CENTRE), root, BLOCK_YAW, cube=[CUBE_EDGE, CUBE_CENTRE - height - thick])
    x, y, _ = at(EXPERIENCE)
    reach = w + 0.06
    room.collider('Experience', (x - reach, y - reach, GROUND_Z), (x + reach, y + reach, GROUND_Z + top), root)
    # The plaque on the pedestal's front (three.js +Z is Blender -Y).
    room.anchor('Plaque_experience', at((EXPERIENCE[0], EXPERIENCE[1] + w + 0.002), height * 0.55), root, BLOCK_YAW, plaque=[0.86, 0.22], text='experience')


def export_glb(root):
    bpy.ops.object.select_all(action='DESELECT')
    for o in [root, *root.children_recursive]:
        o.select_set(True)
    bpy.context.view_layer.objects.active = root
    bpy.ops.export_scene.gltf(filepath=str(GLB), export_format='GLB', use_selection=True, export_apply=True,
                              export_yup=True, export_extras=True, export_cameras=False, export_lights=False,
                              export_animations=False, **room.WEB_IMAGES)
    print(f'Experience GLB: {GLB} ({GLB.stat().st_size} bytes)')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--replace-generated', action='store_true')
    args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else [])
    if (BLEND.exists() or GLB.exists()) and not args.replace_generated:
        raise RuntimeError('Experience outputs exist. Review them before using --replace-generated.')
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.scene.unit_settings.system = 'METRIC'
    root = bpy.data.objects.new('ExperienceCorner', None)
    bpy.context.collection.objects.link(root)
    root['stage'] = '17-experience'
    build(root)
    BLEND.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=str(BLEND), compress=True)
    export_glb(root)


if __name__ == '__main__':
    main()
