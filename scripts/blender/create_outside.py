"""Ground outside the room diorama with two floor plates (portfolio and GitHub).

Builds assets/blender/outside.blend and public/models/outside.glb. The GLB holds the `Outside` root:
a dark grey ground around the two open sides of the room (+X and -Y in Blender, +X and +Z in three.js),
flush with the room floor and leaving the room footprint free, and two thin plates textured with
screenshots of the sites (assets/textures/outside/, from scripts/capture_sites.ts). Each plate root
carries `link`, `label` and `size` extras; the root carries the walkable `bounds`.
The room itself (room.glb) is not modified.
"""
import argparse
import math
import sys
from pathlib import Path

import bpy

sys.path.insert(0, str(Path(__file__).resolve().parent))
import create_room as room

ROOT = Path(__file__).resolve().parents[2]
BLEND = ROOT / 'assets' / 'blender' / 'outside.blend'
GLB = ROOT / 'public' / 'models' / 'outside.glb'
TEXTURES = ROOT / 'assets' / 'textures' / 'outside'
HALF, WALL_T = room.HALF, room.WALL_T
EDGE = HALF + 0.1   # where the room platform ends on its open sides
FAR = 8.5           # ground extent from the room centre on the open sides
GROUND_Z = -0.004   # flush with the room floor (plank tops at 0)
PLATE_W, PLATE_H, PLATE_T, BORDER = 2.4, 1.5, 0.012, 0.07
# Blender (x, y); rotated 45 deg so the screenshots read upright from the isometric corner camera.
PLATES = {
    'Portfolio': {'link': 'https://andres-jaramillo.is-a.dev/', 'label': 'Ver portafolio', 'at': (0.6, -4.7), 'image': 'portfolio.png'},
    'GitHub': {'link': 'https://github.com/SrPio', 'label': 'Ver GitHub', 'at': (4.7, -0.6), 'image': 'github.png'},
}


def build(root):
    ground = room.material('OutsideGround', (0.05, 0.052, 0.058), 0.95)
    frame = room.material('PlateFrame', (0.018, 0.018, 0.022), 0.45, 0.6)
    glow = room.material('PlateGlow', (0.55, 0.35, 1.0), 0.4, emission=(0.55, 0.35, 1.0), strength=3.0)
    # Two strips (front and right of the room) so the ground never shows through the plank gaps.
    room.box('Ground_Front', (-HALF - WALL_T, -FAR, GROUND_Z - 0.06), (FAR, -EDGE, GROUND_Z), ground, root)
    room.box('Ground_Side', (EDGE, -EDGE, GROUND_Z - 0.06), (FAR, HALF + WALL_T, GROUND_Z), ground, root)
    for name, plate in PLATES.items():
        holder = room.anchor(f'Plate_{name}', (*plate['at'], 0), root, math.radians(45),
                             link=plate['link'], label=plate['label'], size=[PLATE_W, PLATE_H])
        w, h = PLATE_W / 2, PLATE_H / 2
        room.box(f'PlateFrame_{name}', (-w, -h, GROUND_Z), (w, h, PLATE_T), frame, holder, bevel=0.004)
        image = room.material(f'PlateImage_{name}', (1, 1, 1), 0.6, image=TEXTURES / plate['image'],
                              emission_from_image=True, strength=0.35)
        iw, ih = w - BORDER, h - BORDER
        room.box(f'PlateImage_{name}', (-iw, -ih, PLATE_T), (iw, ih, PLATE_T + 0.001), image, holder,
                 uv=room.planar_uv(0, 1, (-iw, -ih), (iw, ih)))
        s = 0.012
        for side, lo, hi in (('N', (-w, h - s), (w, h)), ('S', (-w, -h), (w, -h + s)),
                             ('E', (w - s, -h), (w, h)), ('W', (-w, -h), (-w + s, h))):
            room.box(f'PlateGlow_{name}_{side}', (*lo, PLATE_T), (*hi, PLATE_T + 0.002), glow, holder)
    # Walkable area in Blender XY: the ground plus the room floor (walls keep their own colliders).
    root['bounds'] = [-HALF - WALL_T, FAR, -FAR, HALF + WALL_T]


def export_glb(root):
    bpy.ops.object.select_all(action='DESELECT')
    for obj in [root, *root.children_recursive]:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = root
    bpy.ops.export_scene.gltf(filepath=str(GLB), export_format='GLB', use_selection=True, export_apply=True,
                              export_yup=True, export_extras=True, export_cameras=False, export_lights=False,
                              export_animations=False, **room.WEB_IMAGES)
    print(f'Outside GLB: {GLB} ({GLB.stat().st_size} bytes)')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--replace-generated', action='store_true')
    args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else [])
    if (BLEND.exists() or GLB.exists()) and not args.replace_generated:
        raise RuntimeError('Outside outputs exist. Review them before using --replace-generated.')
    for plate in PLATES.values():
        if not (TEXTURES / plate['image']).exists():
            raise RuntimeError(f'Missing {TEXTURES / plate["image"]}: run node scripts/capture_sites.ts first.')
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.scene.unit_settings.system = 'METRIC'
    root = bpy.data.objects.new('Outside', None)
    bpy.context.collection.objects.link(root)
    root['stage'] = '07-outside-plates'
    build(root)
    BLEND.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=str(BLEND), compress=True)
    export_glb(root)


if __name__ == '__main__':
    main()
