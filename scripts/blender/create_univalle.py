"""The Universidad del Valle logo in the about-me plaza, on the bust's other side from the Colombian corner: the flat
logo extruded (a red disc, the white U and V standing a little out of both faces), upright on a stone base with its
front towards three.js +Z like everything in the plaza, and a plaque on the base's front. The outline was traced from
the image the user supplied (scripts/logo_outlines.ts → assets/logos/logo-outlines.json). Builds
assets/blender/univalle.blend and public/models/univalle.glb, which the viewer loads with the outside.

- `Univalle` anchor (decor 'univalle', blob `shadow`, `solid` box) with `Collider_Univalle`, and `Plaque_univalle` on
  the base's front (painted by the viewer: «Universidad del Valle»).

Run: blender --background --factory-startup --python-exit-code 1 --python scripts/blender/create_univalle.py [-- --replace-generated]
"""
import argparse
import json
import math
import sys
from pathlib import Path

import bpy
from mathutils import Matrix

sys.path.insert(0, str(Path(__file__).resolve().parent))
import create_room as room
from create_outside import BLOCK_YAW, GROUND_Z, UNIVALLE, at

ROOT = Path(__file__).resolve().parents[2]
BLEND = ROOT / 'assets' / 'blender' / 'univalle.blend'
GLB = ROOT / 'public' / 'models' / 'univalle.glb'
OUTLINES = ROOT / 'assets' / 'logos' / 'logo-outlines.json'

RADIUS = 0.8                    # the disc's radius (m)
DEPTH = 0.12                    # the red disc's thickness
RELIEF = 0.02                   # the white U and V stand this far out of each face (past the disc's 1 cm bevel)
BASE = (2.0, 0.7, 0.42)         # width along X, depth, height of the stone base
SINK = 0.06                     # the disc's foot sits this far into the base's slot


def srgb(hex_color):
    """A #rrggbb colour as Blender's linear base colour."""
    channels = [int(hex_color[i:i + 2], 16) / 255 for i in (1, 3, 5)]
    return tuple(c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4 for c in channels)


def extruded(name, rings, depth, mat, bevel=0.0):
    """Flat outlines (metres, x right, y up) filled and extruded `depth` through, standing up with the front facing
    Blender -Y (three.js +Z)."""
    curve = bpy.data.curves.new(name, 'CURVE')
    curve.dimensions = '2D'
    curve.fill_mode = 'BOTH'
    curve.extrude = depth / 2
    curve.bevel_depth = bevel
    curve.bevel_resolution = 0
    curve.materials.append(mat)
    for ring in rings:
        spline = curve.splines.new('POLY')
        spline.points.add(len(ring) - 1)
        for point, (x, y) in zip(spline.points, ring):
            point.co = (x, y, 0, 1)
        spline.use_cyclic_u = True
    obj = bpy.data.objects.new(name, curve)
    bpy.context.collection.objects.link(obj)
    bpy.ops.object.select_all(action='DESELECT')
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.convert(target='MESH')
    obj.data.transform(Matrix.Rotation(math.pi / 2, 4, 'X'))
    obj.data.name = name
    return obj


def build(root):
    logo = json.loads(OUTLINES.read_text(encoding='utf8'))['univalle']
    red = room.material('UnivalleRed', srgb(logo['color']), 0.4)
    white = room.material('UnivalleWhite', srgb(logo['ink']), 0.45)
    stone = room.material('UnivalleBase', (0.6, 0.59, 0.62), 0.85)
    width, depth, height = BASE
    holder = room.anchor('Univalle', at(UNIVALLE), root, BLOCK_YAW, decor='univalle', shadow=[width + 0.4, depth + 0.5],
                         solid=[width, height + 2 * RADIUS - SINK, depth])
    room.box('UnivalleBase', (-width / 2, -depth / 2, 0), (width / 2, depth / 2, height), stone, holder, bevel=0.02)
    room.box('UnivalleBaseFoot', (-width / 2 - 0.06, -depth / 2 - 0.06, 0), (width / 2 + 0.06, depth / 2 + 0.06, 0.08), stone, holder)
    # The logo's units: a 300 box round the disc, y down; metres from the disc's centre, y up.
    scale = RADIUS / logo['radius']
    to_metres = lambda ring: [((x - logo['radius']) * scale, (logo['radius'] - y) * scale) for x, y in ring]
    disc = [[(math.cos(k / 64 * math.tau) * RADIUS, math.sin(k / 64 * math.tau) * RADIUS) for k in range(64)]]
    centre_z = height - SINK + RADIUS
    parts = [
        extruded('Univalle_Disc', disc, DEPTH, red, bevel=0.01),
        extruded('Univalle_U', [to_metres(ring) for polygon in logo['u'] for ring in polygon], DEPTH + 2 * RELIEF, white),
        extruded('Univalle_V', [to_metres(ring) for ring in logo['v']], DEPTH + 2 * RELIEF, white),
    ]
    for part in parts:
        part.parent = holder
        part.location = (0, 0, centre_z)
    x, y, _ = at(UNIVALLE)
    room.collider('Univalle', (x - width / 2 - 0.06, y - depth / 2 - 0.06, GROUND_Z), (x + width / 2 + 0.06, y + depth / 2 + 0.06, GROUND_Z + centre_z + RADIUS), root)
    # The plaque on the base's front edge (three.js +Z is Blender -Y).
    room.anchor('Plaque_univalle', at((UNIVALLE[0], UNIVALLE[1] + depth / 2 + 0.002), height / 2), root, BLOCK_YAW, plaque=[1.1, 0.2], text='univalle')


def export_glb(root):
    bpy.ops.object.select_all(action='DESELECT')
    for o in [root, *root.children_recursive]:
        o.select_set(True)
    bpy.context.view_layer.objects.active = root
    bpy.ops.export_scene.gltf(filepath=str(GLB), export_format='GLB', use_selection=True, export_apply=True,
                              export_yup=True, export_extras=True, export_cameras=False, export_lights=False,
                              export_animations=False, **room.WEB_IMAGES)
    print(f'Univalle GLB: {GLB} ({GLB.stat().st_size} bytes)')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--replace-generated', action='store_true')
    args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else [])
    if (BLEND.exists() or GLB.exists()) and not args.replace_generated:
        raise RuntimeError('Univalle outputs exist. Review them before using --replace-generated.')
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.scene.unit_settings.system = 'METRIC'
    root = bpy.data.objects.new('UnivalleCorner', None)
    bpy.context.collection.objects.link(root)
    root['stage'] = '16-univalle'
    build(root)
    BLEND.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=str(BLEND), compress=True)
    export_glb(root)


if __name__ == '__main__':
    main()
