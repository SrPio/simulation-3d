"""The Colombian corner of the about-me plaza, where the globe stood: a sombrero vueltiao, a cup of coffee, a map pin
and the flag of Colombia side by side on a low stone base (none on top of another), a row along three.js +X with their
fronts towards +Z (the perspective rule). Builds assets/blender/colombia.blend and public/models/colombia.glb, which the
viewer loads with the outside (its own file: outside.glb is at its size budget).

- `Colombia` anchor (decor 'colombia', blob `shadow`, `solid` box) with `Collider_Colombia`, and `Plaque_colombia` on
  the base's front (painted by the viewer).
- The hat is modelled here (lathed, woven bands in cream and black), not downloaded.
- `ColombiaFlag_Cloth`: the flag's cloth, a grid whose origin is on the pole; the viewer waves it in a shader.

Run: blender --background --factory-startup --python-exit-code 1 --python scripts/blender/create_colombia.py [-- --replace-generated]
"""
import argparse
import math
import sys
from pathlib import Path

import bmesh
import bpy
from mathutils import Matrix, Vector

sys.path.insert(0, str(Path(__file__).resolve().parent))
import create_room as room
from create_outside import BLOCK_YAW, COLOMBIA, GROUND_Z, at, proto_mesh

ROOT = Path(__file__).resolve().parents[2]
BLEND = ROOT / 'assets' / 'blender' / 'colombia.blend'
GLB = ROOT / 'public' / 'models' / 'colombia.glb'

BASE = (1.85, 0.8, 0.18)            # half length along X, half depth, height of the oval stone base
# Along X from the base's middle (three.js x offsets): flag pole, hat, cup, pin.
SLOTS = {'flag': -1.35, 'hat': -0.5, 'cup': 0.42, 'pin': 1.32}
FLAG = {'pole': 2.5, 'width': 1.05, 'height': 0.7, 'cols': 14, 'rows': 6}


def bm_cylinder(bm, centre, radius, depth, segments=24):
    """A closed cylinder along Blender Y."""
    geom = bmesh.ops.create_cone(bm, cap_ends=True, segments=segments, radius1=radius, radius2=radius, depth=depth)
    for v in geom['verts']:
        v.co = Matrix.Rotation(math.pi / 2, 3, 'X') @ v.co + Vector(centre)


def lathe(bm, profile, materials, segments=40):
    """Turn a (radius, height) profile round Z; band i (between points i and i+1) takes material materials[i]."""
    rings = []
    for r, z in profile:
        if r < 1e-6:
            rings.append([bm.verts.new((0, 0, z))])
        else:
            rings.append([bm.verts.new((math.cos(k / segments * math.tau) * r, math.sin(k / segments * math.tau) * r, z)) for k in range(segments)])
    for i in range(len(rings) - 1):
        a, b = rings[i], rings[i + 1]
        for k in range(segments):
            n = (k + 1) % segments
            if len(a) == 1:
                face = (a[0], b[n], b[k])
            elif len(b) == 1:
                face = (a[k], a[n], b[0])
            else:
                face = (a[k], a[n], b[n], b[k])
            bm.faces.new(face).material_index = materials[i]


def mesh(name, build, mats, smooth=None):
    bm = bmesh.new()
    build(bm)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return proto_mesh(name, bm, mats, smooth_angle=smooth)


def place(name, data, x, parent, height=0.0):
    obj = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(obj)
    obj.parent = parent
    obj.location = (x, 0, height)
    return obj


def hat_mesh(cream, black):
    """Sombrero vueltiao: a wide flat brim with a slight lift at its edge and a low rounded crown, both woven in
    concentric cream and black bands, the crown's top a black ring round a cream centre."""
    brim = [(0.64, 0.035), (0.6, 0.028), (0.56, 0.024), (0.52, 0.022), (0.48, 0.021), (0.44, 0.021), (0.4, 0.021), (0.36, 0.021), (0.3, 0.022)]
    crown = [(0.29, 0.07), (0.285, 0.13), (0.278, 0.19), (0.27, 0.25), (0.26, 0.31), (0.245, 0.35), (0.215, 0.38)]
    top = [(0.15, 0.392), (0.08, 0.398), (0.0, 0.4)]
    profile = [(0.0, 0.0), (0.62, 0.0)] + brim + crown + top
    bands = [0, 0]
    bands += [1 if i % 2 else 0 for i in range(len(brim) - 1)]   # brim: alternating cream and black rings
    bands += [0]                                                  # brim to crown
    bands += [1 if i % 2 == 0 else 0 for i in range(len(crown) - 1)]
    bands += [0, 1, 0]                                            # top: black ring, cream middle
    bands += [0]
    return mesh('Colombia_Hat', lambda bm: lathe(bm, profile, bands, 48), [cream, black], 40)


def cup_mesh(ceramic, coffee, band):
    """A big coffee cup: wall and rim in ceramic with a coloured band, the coffee just below the rim, and a handle on +X."""
    profile = [(0.0, 0.0), (0.2, 0.0), (0.23, 0.04), (0.25, 0.22), (0.255, 0.3), (0.26, 0.5), (0.26, 0.58), (0.23, 0.58), (0.225, 0.52), (0.0, 0.52)]
    bands = [0, 0, 0, 1, 0, 0, 0, 0, 2]

    def build(bm):
        lathe(bm, profile, bands, 36)
        # Handle: a tube along a half circle on the +X side.
        steps, sides, tube = 10, 8, 0.035
        rings = []
        for s in range(steps + 1):
            a = -math.pi / 2 + s / steps * math.pi
            cx, cz = 0.24 + 0.14 * math.cos(a), 0.3 + 0.14 * math.sin(a)
            nx, nz = math.cos(a), math.sin(a)
            rings.append([bm.verts.new((cx + nx * tube * math.cos(k / sides * math.tau), tube * math.sin(k / sides * math.tau), cz + nz * tube * math.cos(k / sides * math.tau))) for k in range(sides)])
        for s in range(steps):
            for k in range(sides):
                n = (k + 1) % sides
                bm.faces.new((rings[s][k], rings[s][n], rings[s + 1][n], rings[s + 1][k])).material_index = 0
    return mesh('Colombia_Cup', build, [ceramic, band, coffee], 40)


def pin_mesh(red):
    """A map pin standing on its point: a cone up to a round head, tangent where they meet."""
    head_z, radius = 0.85, 0.3
    tilt = math.asin(radius / head_z)
    profile = [(0.0, 0.0)]
    for k in range(12):   # the top is the closing point below
        a = -tilt + k / 12 * (math.pi / 2 + tilt)
        profile.append((radius * math.cos(a), head_z + radius * math.sin(a)))
    profile.append((0.0, head_z + radius))
    return mesh('Colombia_Pin', lambda bm: lathe(bm, profile, [0] * (len(profile) - 1), 32), [red], 50)


def flag_cloth(yellow, blue, red):
    """The cloth: a grid hanging from the pole towards -X, top half yellow, then blue and red quarters."""
    w, h, cols, rows = FLAG['width'], FLAG['height'], FLAG['cols'], FLAG['rows']
    top = FLAG['pole'] - 0.08

    def build(bm):
        grid = [[bm.verts.new((-w * c / cols, 0, top - h * r / rows)) for c in range(cols + 1)] for r in range(rows + 1)]
        for r in range(rows):
            stripe = 0 if r < rows / 2 else 1 if r < rows * 3 / 4 else 2
            for c in range(cols):
                bm.faces.new((grid[r][c], grid[r + 1][c], grid[r + 1][c + 1], grid[r][c + 1])).material_index = stripe
    return mesh('Colombia_FlagCloth', build, [yellow, blue, red])


def build(root):
    m = room.material
    stone = m('ColombiaBase', (0.6, 0.59, 0.62), 0.85)
    cream = m('VueltiaoCream', (0.86, 0.79, 0.62), 0.9)
    black = m('VueltiaoBlack', (0.06, 0.05, 0.05), 0.85)
    ceramic = m('CupCeramic', (0.95, 0.94, 0.92), 0.35)
    coffee = m('Coffee', (0.2, 0.1, 0.04), 0.2)
    accent = m('CupBand', (0.55, 0.36, 0.8), 0.5)
    pin_red = m('PinRed', (0.86, 0.17, 0.14), 0.45)
    white = m('PinWhite', (0.97, 0.96, 0.95), 0.5)
    metal = m('FlagPole', (0.7, 0.7, 0.74), 0.35, 0.8)
    gold = m('FlagFinial', (0.95, 0.72, 0.2), 0.35, 0.8)
    yellow = m('FlagYellow', (0.99, 0.75, 0.0), 0.7)
    blue = m('FlagBlue', (0.0, 0.13, 0.48), 0.7)
    red = m('FlagRed', (0.75, 0.02, 0.08), 0.7)
    length, depth, height = BASE
    corner = room.anchor('Colombia', at(COLOMBIA), root, BLOCK_YAW, decor='colombia', shadow=[length * 2 + 0.3, depth * 2 + 0.3],
                         solid=[length * 2, 1.2, depth * 2])
    base = room.cylinder('ColombiaBase', (0, 0, height / 2), 1.0, height, stone, corner, segments=40, bevel=0.02)
    base.scale = (length, depth, 1.0)
    top = height
    place('Colombia_Hat', hat_mesh(cream, black), SLOTS['hat'], corner, top)
    place('Colombia_Cup', cup_mesh(ceramic, coffee, accent), SLOTS['cup'], corner, top)
    place('Colombia_Pin', pin_mesh(pin_red), SLOTS['pin'], corner, top)
    # The pin's white dot faces the default corner view (between three.js +Z and +X): the pin is round, so it may turn.
    dot = mesh('Colombia_PinDot', lambda bm: bm_cylinder(bm, (0, -0.3, 0.85), 0.13, 0.05), [white])
    place('Colombia_PinDot', dot, SLOTS['pin'], corner, top).rotation_euler.z = math.pi / 4
    pole_x = SLOTS['flag']
    room.cylinder('ColombiaFlag_Pole', (pole_x, 0, top + FLAG['pole'] / 2), 0.03, FLAG['pole'], metal, corner, segments=12)
    room.cylinder('ColombiaFlag_Foot', (pole_x, 0, top + 0.04), 0.12, 0.08, metal, corner, segments=16)
    room.blob('ColombiaFlag_Finial', (pole_x, 0, top + FLAG['pole'] + 0.04), (0.06, 0.06, 0.06), gold, corner)
    place('ColombiaFlag_Cloth', flag_cloth(yellow, blue, red), pole_x - 0.03, corner, top)
    x, y, _ = at(COLOMBIA)
    room.collider('Colombia', (x - length, y - depth, GROUND_Z), (x + length, y + depth, GROUND_Z + 1.2), root)
    # The plaque on the base's front edge (three.js +Z is Blender -Y).
    room.anchor('Plaque_colombia', at((COLOMBIA[0], COLOMBIA[1] + depth + 0.002), height / 2), root, BLOCK_YAW, plaque=[0.62, 0.14], text='colombia')


def export_glb(root):
    bpy.ops.object.select_all(action='DESELECT')
    for o in [root, *root.children_recursive]:
        o.select_set(True)
    bpy.context.view_layer.objects.active = root
    bpy.ops.export_scene.gltf(filepath=str(GLB), export_format='GLB', use_selection=True, export_apply=True,
                              export_yup=True, export_extras=True, export_cameras=False, export_lights=False,
                              export_animations=False, **room.WEB_IMAGES)
    print(f'Colombia GLB: {GLB} ({GLB.stat().st_size} bytes)')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--replace-generated', action='store_true')
    args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else [])
    if (BLEND.exists() or GLB.exists()) and not args.replace_generated:
        raise RuntimeError('Colombia outputs exist. Review them before using --replace-generated.')
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.scene.unit_settings.system = 'METRIC'
    root = bpy.data.objects.new('ColombiaCorner', None)
    bpy.context.collection.objects.link(root)
    root['stage'] = '14-colombia'
    build(root)
    BLEND.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=str(BLEND), compress=True)
    export_glb(root)


if __name__ == '__main__':
    main()
