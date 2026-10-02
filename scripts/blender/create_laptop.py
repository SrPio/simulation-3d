"""The single interactive laptop (phase 5), with the same dimensions the V4 typing clips were fitted to.

Local frame (Blender): the user sits on the +Y side, the hinge is on the -Y edge, base bottom at Z=0
and centred on X/Y, so the room's Anchor_DeskLaptop / Anchor_BedLaptop place it directly.
`LaptopHinge` rotates about X: 0 = closed, `hinge_open_radians` = open towards the user.
"""
import argparse
import math
import sys
from pathlib import Path

import bpy

sys.path.insert(0, str(Path(__file__).resolve().parent))
from create_room import TEXTURES, WEB_IMAGES, box, material, planar_uv

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / 'assets' / 'blender' / 'laptop.blend'
OUTPUT = ROOT / 'public' / 'models' / 'laptop.glb'
WIDTH, DEPTH, BASE, LID, LID_T = 0.48, 0.32, 0.022, 0.31, 0.012
OPEN = math.radians(106)


def build():
    root = bpy.data.objects.new('Laptop', None)
    bpy.context.collection.objects.link(root)
    root['hinge_open_radians'] = OPEN
    root['width'], root['depth'] = WIDTH, DEPTH
    metal = material('LaptopAluminium', (0.62, 0.62, 0.66), 0.3, 0.9)
    keys = material('LaptopKeys', (0.1, 0.1, 0.12), 0.6)
    pad = material('LaptopTrackpad', (0.45, 0.45, 0.5), 0.35, 0.6)
    screen = material('LaptopScreen', (1, 1, 1), 0.2, image=TEXTURES / 'laptop_screen.png', emission_from_image=True, strength=2.2)
    w, d = WIDTH / 2, DEPTH / 2
    box('LaptopBase', (-w, -d, 0), (w, d, BASE), metal, root, bevel=0.006)
    # Keys from 2 cm behind the hinge edge to 13 cm before the user edge, as on the desk laptop.
    box('Keyboard', (-w + 0.04, -d + 0.02, BASE), (w - 0.04, d - 0.13, BASE + 0.002), keys, root)
    box('Trackpad', (-0.07, d - 0.11, BASE), (0.07, d - 0.03, BASE + 0.001), pad, root, bevel=0.002)
    hinge = bpy.data.objects.new('LaptopHinge', None)
    bpy.context.collection.objects.link(hinge)
    hinge.parent = root
    hinge.location = (0, -d, BASE)
    # Closed, the lid lies on the base towards the user; the display faces down onto the keys.
    box('LaptopLid', (-w, 0, 0), (w, LID, LID_T), metal, hinge, bevel=0.004)
    box('Display', (-w + 0.02, 0.02, -0.0015), (w - 0.02, LID - 0.02, 0), screen, hinge,
        uv=planar_uv(0, 1, (-w + 0.02, 0.02), (w - 0.02, LID - 0.02)))
    hinge.rotation_euler.x = OPEN
    return root


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--replace-generated', action='store_true')
    args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else [])
    if (SOURCE.exists() or OUTPUT.exists()) and not args.replace_generated:
        raise RuntimeError('Laptop exists. Review it before using --replace-generated.')
    bpy.ops.wm.read_factory_settings(use_empty=True)
    root = build()
    SOURCE.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=str(SOURCE), compress=True)
    bpy.ops.object.select_all(action='DESELECT')
    for obj in [root, *root.children_recursive]:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = root
    bpy.ops.export_scene.gltf(filepath=str(OUTPUT), export_format='GLB', use_selection=True, export_apply=True,
                              export_yup=True, export_extras=True, export_animations=False, export_cameras=False,
                              export_lights=False, **WEB_IMAGES)
    print(f'Laptop: {SOURCE}, {OUTPUT} ({OUTPUT.stat().st_size} bytes)')


if __name__ == '__main__':
    main()
