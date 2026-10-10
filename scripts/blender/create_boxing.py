"""The playground's boxing corner, at the front of the bricks' part: two punching bags hanging from a steel gantry, a yellow one with the "JS" of the
JavaScript logo and a blue one with the "TS" of the TypeScript logo, in the logos' official colours and letters (the
outlines come from assets/logos/ through scripts/logo_outlines.ts). Builds assets/blender/boxing.blend and
public/models/boxing.glb, which the viewer loads with the outside (outside.glb is at its size budget).

- `PunchBag_<ID>` empties sit on the gantry's hook (the pendulum's pivot) with extras `bag` [pivot to the bag's
  centre, radius, length] and `mass`; their children (chain, swivel, bag, letters) swing with them. The viewer hangs a
  physics body from each pivot and turns the empty with it.
- The gantry is a decor `boxing` (blob shadow) with its posts as decor `post` (solid, so pieces and bags bounce off)
  and `Collider_*` boxes for the character: the posts and each bag's place at rest.
- `Floor_Boxing` (floor 'boxing'): the painted frame under the bags and the zone's name.

Everything keeps the block perspective: the gantry runs along three.js +X and the letters face +Z.

Run: blender --background --factory-startup --python-exit-code 1 --python scripts/blender/create_boxing.py [-- --replace-generated]
"""
import argparse
import json
import math
import sys
from pathlib import Path

import bmesh
import bpy
from mathutils import Matrix, Vector

sys.path.insert(0, str(Path(__file__).resolve().parent))
import create_room as room
from create_outside import BLOCK_YAW, BOXING, GROUND_Z, at, proto_mesh

ROOT = Path(__file__).resolve().parents[2]
BLEND = ROOT / 'assets' / 'blender' / 'boxing.blend'
GLB = ROOT / 'public' / 'models' / 'boxing.glb'
OUTLINES = ROOT / 'assets' / 'logos' / 'logo-outlines.json'

# A heavy bag hung as a real one: its middle between the top of the character's sternum (about 1.8 m; the stylised
# character is 2.67 m tall with its eyes at 2.24 m) and its eyes, sized to the character. The punch (1.63 m up) lands on
# its upper half; the low ball kick (0.27 m) passes under it, as under a real bag hung at eye level.
BAG = {'radius': 0.26, 'length': 1.6, 'bottom': 1.2, 'mass': 30.0}
CHAINS = 0.3                                                        # from the bag's top up to the swivel ring
HANG = 0.18                                                         # from the swivel up to the hook
PIVOT = BAG['bottom'] + BAG['length'] + CHAINS + HANG               # the hooks under the beam
GANTRY = {'half': 2.4, 'post': 0.12, 'top': PIVOT + 0.14, 'beam': 0.14}   # half length along X, post width, top height, beam depth
SWIVEL = HANG                                                       # the swivel ring this far under the hook
BAGS = [('js', -1.1), ('ts', 1.1)]                                  # along X from the gantry's middle
LETTERS = {'height': 0.26, 'bottom': 0.13, 'raise': 0.005, 'turn': 0.35}   # letters' height, bottom, relief and turn towards +X


def srgb(hex_color):
    """A #rrggbb colour as Blender's linear base colour."""
    channels = [int(hex_color[i:i + 2], 16) / 255 for i in (1, 3, 5)]
    return tuple(c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4 for c in channels)


def lathe(bm, profile, materials, segments=32):
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


def bag_mesh(name, cover, cap):
    """The bag: a long cylinder with rounded ends, its top cap and the band under it in dark leather."""
    length, k = BAG['length'], BAG['radius'] / 0.222   # the outline drawn for a 0.222 m bag, scaled to its radius
    profile = [(0.0, 0.0), (0.17 * k, 0.0), (0.205 * k, 0.02), (0.218 * k, 0.06), (0.222 * k, 0.3), (0.222 * k, 0.9), (0.218 * k, length - 0.1),
               (0.214 * k, length - 0.06), (0.2 * k, length - 0.02), (0.17 * k, length), (0.0, length)]
    bands = [0, 0, 0, 0, 0, 0, 1, 1, 1, 1]
    bm = bmesh.new()
    lathe(bm, profile, bands, 36)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return proto_mesh(name, bm, [cover, cap], smooth_angle=50)


def letters_mesh(name, key, ink):
    """The logo's letters standing out of the bag's front: filled outlines extruded LETTERS['raise'], cut into thin
    upright strips and wrapped round the bag so they follow its curve."""
    logo = json.loads(OUTLINES.read_text(encoding='utf8'))[key]
    points = [p for ring in logo['rings'] for p in ring]
    xs, ys = [p[0] for p in points], [p[1] for p in points]
    scale = LETTERS['height'] / (max(ys) - min(ys))
    mid = (min(xs) + max(xs)) / 2
    curve = bpy.data.curves.new(name, 'CURVE')
    curve.dimensions = '2D'
    curve.fill_mode = 'BOTH'
    curve.extrude = LETTERS['raise'] / 2
    curve.materials.append(ink)
    for ring in logo['rings']:
        spline = curve.splines.new('POLY')
        spline.points.add(len(ring) - 1)
        for point, (x, y) in zip(spline.points, ring):
            # SVG y points down: flip it, the letters' bottom at 0.
            point.co = ((x - mid) * scale, (max(ys) - y) * scale, 0, 1)
        spline.use_cyclic_u = True
    obj = bpy.data.objects.new(name, curve)
    bpy.context.collection.objects.link(obj)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.ops.object.convert(target='MESH')
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=0.0002)
    # Upright cuts every 2 cm, so the wrapped faces bend with the bag instead of cutting into it.
    width = (max(xs) - min(xs)) * scale
    for k in range(1, int(width / 0.02) + 1):
        x = -width / 2 + k * 0.02
        bmesh.ops.bisect_plane(bm, geom=list(bm.verts) + list(bm.edges) + list(bm.faces), plane_co=(x, 0, 0), plane_no=(1, 0, 0))
    bmesh.ops.triangulate(bm, faces=bm.faces)
    radius = BAG['radius'] + 0.0005
    for v in bm.verts:
        u, h, depth = v.co.x, v.co.y, v.co.z + LETTERS['raise'] / 2
        angle = u / radius + LETTERS['turn']
        r = radius + depth
        # The front of the bag faces three.js +Z (Blender -Y); angles grow towards +X.
        v.co = Vector((math.sin(angle) * r, -math.cos(angle) * r, LETTERS['bottom'] + h))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(obj.data)
    bm.free()
    # Smooth across the curved faces, sharp at the letters' edges: the export then shares the vertices of each face.
    obj.data.shade_smooth()
    obj.data.set_sharp_from_angle(angle=math.radians(40))
    obj.data.name = name
    return obj


def link_rod(name, a, b, radius, mat, parent):
    """A chain run between two points (a thin rod), part of the swinging bag."""
    a, b = Vector(a), Vector(b)
    rod = room.cylinder(name, (0, 0, 0), radius, (b - a).length, mat, parent, segments=6)
    rod.location = (a + b) / 2
    rod.rotation_mode = 'QUATERNION'
    rod.rotation_quaternion = Vector((0, 0, 1)).rotation_difference(b - a)
    return rod


def build_bag(key, x, root, steel, cap):
    logo = json.loads(OUTLINES.read_text(encoding='utf8'))[key]
    cover = room.material(f'Bag_{key.upper()}', srgb(logo['color']), 0.55)
    ink = room.material(f'BagLetters_{key.upper()}', srgb(logo['ink']), 0.5)
    drop = PIVOT - BAG['bottom'] - BAG['length']     # from the hook down to the bag's top
    centre = PIVOT - BAG['bottom'] - BAG['length'] / 2
    pivot = room.anchor(f'PunchBag_{key.upper()}', at((BOXING[0] + x, BOXING[1]), PIVOT), root, BLOCK_YAW,
                        bag=[round(centre, 4), BAG['radius'], BAG['length']], mass=BAG['mass'])
    bottom = -(PIVOT - BAG['bottom'])
    body = bpy.data.objects.new(f'PunchBag_{key.upper()}_Body', bag_mesh(f'PunchBag_{key.upper()}_Body', cover, cap))
    bpy.context.collection.objects.link(body)
    body.parent = pivot
    body.location = (0, 0, bottom)
    letters = letters_mesh(f'PunchBag_{key.upper()}_Letters', key, ink)
    letters.parent = pivot
    letters.location = (0, 0, bottom)
    # Four chains from the top's rim to the swivel, one from the swivel up to the hook.
    for k in range(4):
        angle = math.pi / 4 + k * math.pi / 2
        rim = (math.cos(angle) * BAG['radius'] * 0.7, math.sin(angle) * BAG['radius'] * 0.7, -drop + 0.005)
        link_rod(f'PunchBag_{key.upper()}_Chain{k}', rim, (0, 0, -SWIVEL), 0.007, steel, pivot)
    room.cylinder(f'PunchBag_{key.upper()}_Swivel', (0, 0, -SWIVEL), 0.035, 0.07, steel, pivot, segments=10)
    link_rod(f'PunchBag_{key.upper()}_Hang', (0, 0, -SWIVEL + 0.03), (0, 0, -0.03), 0.009, steel, pivot)
    room.cylinder(f'PunchBag_{key.upper()}_Hook', (0, 0, -0.02), 0.025, 0.04, steel, pivot, segments=8)
    # The character stops at the bag's place at rest (it still pushes a swinging bag away).
    cx, cy, _ = at((BOXING[0] + x, BOXING[1]))
    r = BAG['radius'] + 0.04
    room.collider(f'PunchBag_{key.upper()}', (cx - r, cy - r, GROUND_Z + BAG['bottom']), (cx + r, cy + r, GROUND_Z + BAG['bottom'] + BAG['length']), root)


def build(root):
    steel = room.material('GantrySteel', (0.07, 0.07, 0.085), 0.45, 0.7)
    frame = room.material('GantryPaint', (0.16, 0.07, 0.3), 0.5, 0.3)
    cap = room.material('BagCap', (0.035, 0.03, 0.04), 0.6)
    half, post, top, beam = GANTRY['half'], GANTRY['post'], GANTRY['top'], GANTRY['beam']
    gantry = room.anchor('Boxing', at(BOXING), root, BLOCK_YAW, decor='boxing', shadow=[half * 2 + 0.6, 0.9])
    room.box('Boxing_Beam', (-half - post / 2, -beam / 2, top - beam), (half + post / 2, beam / 2, top), frame, gantry, bevel=0.01)
    for side in (-1, 1):
        x = side * half
        room.box(f'Boxing_Post{side + 1}', (x - post / 2, -post / 2, 0), (x + post / 2, post / 2, top - beam), frame, gantry, bevel=0.01)
        room.box(f'Boxing_Foot{side + 1}', (x - 0.09, -0.45, 0), (x + 0.09, 0.45, 0.06), steel, gantry, bevel=0.01)
        # A brace from each foot's ends up to the post.
        for end in (-1, 1):
            a, b = Vector((x, end * 0.42, 0.06)), Vector((x, 0, 0.9))
            brace = room.box(f'Boxing_Brace{side + 1}{end + 1}', (-0.03, -0.03, 0), (0.03, 0.03, (b - a).length), steel, gantry)
            brace.location = a
            brace.rotation_mode = 'QUATERNION'
            brace.rotation_quaternion = Vector((0, 0, 1)).rotation_difference(b - a)
        room.anchor(f'BoxingPost_{side + 1}', at((BOXING[0] + x, BOXING[1])), root, BLOCK_YAW, decor='post', shadow=[0.5, 1.0],
                    solid=[post, top, post])
        cx, cy, _ = at((BOXING[0] + x, BOXING[1]))
        room.collider(f'BoxingPost_{side + 1}', (cx - 0.1, cy - 0.46, GROUND_Z), (cx + 0.1, cy + 0.46, GROUND_Z + top), root)
    for key, x in BAGS:
        build_bag(key, x, root, steel, cap)
    room.anchor('Floor_Boxing', at((BOXING[0], BOXING[1] + 0.8)), root, BLOCK_YAW, floor='boxing', size=[half * 2 + 1.4, 3.0])


def export_glb(root):
    bpy.ops.object.select_all(action='DESELECT')
    for o in [root, *root.children_recursive]:
        o.select_set(True)
    bpy.context.view_layer.objects.active = root
    bpy.ops.export_scene.gltf(filepath=str(GLB), export_format='GLB', use_selection=True, export_apply=True,
                              export_yup=True, export_extras=True, export_cameras=False, export_lights=False,
                              export_animations=False, **room.WEB_IMAGES)
    print(f'Boxing GLB: {GLB} ({GLB.stat().st_size} bytes)')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--replace-generated', action='store_true')
    args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else [])
    if (BLEND.exists() or GLB.exists()) and not args.replace_generated:
        raise RuntimeError('Boxing outputs exist. Review them before using --replace-generated.')
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.scene.unit_settings.system = 'METRIC'
    root = bpy.data.objects.new('BoxingCorner', None)
    bpy.context.collection.objects.link(root)
    root['stage'] = '15-boxing'
    build(root)
    BLEND.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=str(BLEND), compress=True)
    export_glb(root)


if __name__ == '__main__':
    main()
