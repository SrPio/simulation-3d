"""Outside the room diorama: three link signs and the name letters.

Builds assets/blender/outside.blend and public/models/outside.glb. The GLB holds the `Outside` root.
There is no ground mesh: the viewer draws the endless ground itself at `ground_y` (a little below
the room floor, so the room reads as a raised platform) and uses the walkable `bounds`.
- `Sign_<Name>`: a standing board on two posts with a screenshot of the site (assets/textures/outside/).
  They stand in a row continuing the room's back (+Y) wall past its open side and face the same way
  as that wall's window (-Y, three.js +Z). Extras: `link`, `label`, `board` [width, height, bottom] and the
  floor zone in front of it, `area` [width, depth] at `area_offset` metres towards the camera.
- `Collider_*`: boxes the character cannot enter (the signs and the hidden ground behind the room walls).
- `Letters`: one mesh per letter of the name, origin at its centre, with a `box` [width, height, depth] extra
  in three.js axes for the physics body. The outlines (Bahnschrift SemiBold SemiCondensed) come from
  assets/name/name-glyphs.json (scripts/name_glyphs.ts). The name runs along +X in front of the room's
  open -Y side, to its left as seen from the corner camera, facing -Y like the signs.
- `Tagline`: "<developer />" in the same font, smaller and lying flat on the ground in front of the name
  (glyph tops towards the name, so it reads upright from the camera); `Tag_<i>` meshes with `box` and
  `char` extras, also moved by the letter physics.
The room itself (room.glb) is not modified.
"""
import argparse
import math
import sys
from pathlib import Path

import bpy
import json
from mathutils import Matrix

sys.path.insert(0, str(Path(__file__).resolve().parent))
import create_room as room

ROOT = Path(__file__).resolve().parents[2]
BLEND = ROOT / 'assets' / 'blender' / 'outside.blend'
GLB = ROOT / 'public' / 'models' / 'outside.glb'
TEXTURES = ROOT / 'assets' / 'textures' / 'outside'
HALF, WALL_T = room.HALF, room.WALL_T
GROUND_Z = -0.12    # outside ground, below the room floor (plank tops at 0)
FAR = 24.0          # walkable ground from the room centre
# Room platform footprint in Blender XY (create_room.build_shell): the floor is at 0 inside it.
PLATFORM = [-HALF - WALL_T, HALF + 0.1, -HALF - 0.1, HALF + WALL_T]
BOARD_W, BOARD_H, BOARD_BOTTOM, BOARD_T, BORDER, POST = 2.4, 1.5, 0.6, 0.06, 0.07, 0.08
AREA, AREA_OFFSET = (2.6, 1.8), 1.55
# Signs: along the line of the back wall (Y just inside its outer face), from past the room's +X side.
SIGN_Y, SIGN_FIRST_X, SIGN_SPACING = HALF + 0.15, 5.3, 3.2
SIGNS = {
    'Portfolio': {'link': 'https://andres-jaramillo.is-a.dev/', 'label': 'Ver portafolio', 'title': 'PORTAFOLIO', 'slot': 0, 'image': 'portfolio.png'},
    'GitHub': {'link': 'https://github.com/SrPio', 'label': 'Ver GitHub', 'title': 'GITHUB', 'slot': 1, 'image': 'github.png'},
    'LinkedIn': {'link': 'https://www.linkedin.com/in/andres-fernando-jaramillo-avila/', 'label': 'Ver LinkedIn', 'title': 'LINKEDIN', 'slot': 2, 'image': 'linkedin.png'},
}
GLYPHS = ROOT / 'assets' / 'name' / 'name-glyphs.json'
# Name: a line parallel to the room's open -Y side, ending a little left of the room's -X edge.
NAME_Y, NAME_END_X = -4.9, -1.2
CAP_HEIGHT = 0.58
LETTER_DEPTH = 0.2
TRACKING = 0.03      # extra space between letters (m)
WORD_SPACE = 0.15    # extra space at the word gap (m)
# Tagline: flat on the ground in front of the name, starting under its first letter.
TAG_Y, TAG_START_X = -6.0, -7.3   # baseline line and left end
TAG_CAP, TAG_THICKNESS, TAG_TRACKING = 0.45, 0.08, 0.06


def build_sign(name, sign, frame, glow, root):
    holder = room.anchor(f'Sign_{name}', (SIGN_FIRST_X + sign['slot'] * SIGN_SPACING, SIGN_Y, GROUND_Z), root, 0.0,
                         link=sign['link'], label=sign['label'], title=sign['title'], board=[BOARD_W, BOARD_H, BOARD_BOTTOM],
                         area=list(AREA), area_offset=AREA_OFFSET)
    w, t = BOARD_W / 2, BOARD_T / 2
    top = BOARD_BOTTOM + BOARD_H
    for side in (-1, 1):
        x0, x1 = sorted((side * (w - 0.02), side * (w + POST)))
        room.box(f'SignPost_{name}_{"L" if side < 0 else "R"}', (x0, -POST / 2 + 0.01, 0), (x1, POST / 2 + 0.01, top + 0.08), frame, holder, bevel=0.01)
    room.box(f'SignBoard_{name}', (-w, -t, BOARD_BOTTOM), (w, t, top), frame, holder, bevel=0.012)
    image = room.material(f'SignImage_{name}', (1, 1, 1), 0.6, image=TEXTURES / sign['image'], emission_from_image=True, strength=0.35)
    iw, z0, z1 = w - BORDER, BOARD_BOTTOM + BORDER, top - BORDER
    room.box(f'SignImage_{name}', (-iw, -t - 0.002, z0), (iw, -t - 0.001, z1), image, holder,
             uv=room.planar_uv(0, 2, (-iw, z0), (iw, z1)))
    s = 0.014
    for side, lo, hi in (('N', (-w, top - s), (w, top)), ('S', (-w, BOARD_BOTTOM), (w, BOARD_BOTTOM + s)),
                         ('E', (w - s, BOARD_BOTTOM), (w, top)), ('W', (-w, BOARD_BOTTOM), (-w + s, top))):
        room.box(f'SignGlow_{name}_{side}', (lo[0], -t - 0.004, lo[1]), (hi[0], -t - 0.002, hi[1]), glow, holder)
    # The character walks around the posts and under nothing: one rotated box along the board.
    collider = room.anchor(f'Collider_Sign_{name}', holder.location, root, 0.0, collider='box',
                           size=[BOARD_W + 2 * POST, 0.16, top])
    return holder, collider


def letter_object(name, polygons, scale, offset, mat, depth=LETTER_DEPTH, standing=True):
    """One extruded letter from its outline polygons (outer ring then holes): standing up and facing -Y,
    or lying flat with its top towards +Y."""
    curve = bpy.data.curves.new(name, 'CURVE')
    curve.dimensions = '2D'
    curve.fill_mode = 'BOTH'
    curve.extrude = depth / 2
    curve.bevel_depth = min(0.01, depth / 6)
    curve.bevel_resolution = 0   # a single chamfer: rounder edges would multiply the triangles
    curve.materials.append(mat)
    for polygon in polygons:
        for ring in polygon:
            spline = curve.splines.new('POLY')
            spline.points.add(len(ring) - 1)
            for point, (x, y) in zip(spline.points, ring):
                point.co = (x * scale + offset, y * scale, 0, 1)
            spline.use_cyclic_u = True
    obj = bpy.data.objects.new(name, curve)
    bpy.context.collection.objects.link(obj)
    bpy.ops.object.select_all(action='DESELECT')
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.convert(target='MESH')
    if standing:
        # Stand the letter up: it reads along +X, caps point +Z and the front faces -Y.
        obj.data.transform(Matrix.Rotation(math.pi / 2, 4, 'X'))
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.mesh.remove_doubles(threshold=0.0005)
    bpy.ops.object.mode_set(mode='OBJECT')
    bpy.ops.object.origin_set(type='ORIGIN_GEOMETRY', center='BOUNDS')
    return obj


def build_letters(root):
    glyphs = json.loads(GLYPHS.read_text(encoding='utf8'))
    scale = CAP_HEIGHT / glyphs['capHeight']
    mat = room.material('Letter', (0.84, 0.8, 0.94), 0.5)
    build_tagline(root, glyphs, mat)
    pen, placed = 0.0, []
    for glyph in glyphs['letters']:
        if glyph['polygons']:
            placed.append((glyph['char'], glyph['polygons'], pen))
            pen += glyph['advance'] * scale + TRACKING
        else:
            pen += glyph['advance'] * scale + WORD_SPACE
    width = pen - TRACKING
    letters = room.anchor('Letters', (NAME_END_X - width / 2, NAME_Y, GROUND_Z), root, 0.0)
    for index, (char, polygons, x) in enumerate(placed):
        obj = letter_object(f'Letter_{index:02d}_{char}', polygons, scale, x - width / 2, mat)
        obj.data.name = obj.name
        dx, dy, dz = (max(v.co[i] for v in obj.data.vertices) - min(v.co[i] for v in obj.data.vertices) for i in range(3))
        obj['box'] = [round(dx, 4), round(dz, 4), round(dy, 4)]   # three.js: width, height, depth
        location = obj.location.copy()
        obj.parent = letters
        obj.location = (location.x, location.y, dz / 2)   # every glyph stands on the ground
        obj.data.shade_smooth()
        obj.data.set_sharp_from_angle(angle=math.radians(35))
    return letters


def build_tagline(root, glyphs, mat):
    tag = glyphs['tag']
    scale = TAG_CAP / glyphs['capHeight']
    group = room.anchor('Tagline', (TAG_START_X, TAG_Y, GROUND_Z), root, 0.0)
    pen, index = 0.0, 0
    for glyph in tag['letters']:
        if not glyph['polygons']:
            pen += glyph['advance'] * scale + WORD_SPACE
            continue
        obj = letter_object(f'Tag_{index:02d}', glyph['polygons'], scale, pen, mat, TAG_THICKNESS, standing=False)
        obj.data.name = obj.name
        dx, dy, dz = (max(v.co[i] for v in obj.data.vertices) - min(v.co[i] for v in obj.data.vertices) for i in range(3))
        obj['box'] = [round(dx, 4), round(dz, 4), round(dy, 4)]   # three.js: width, height (thickness), depth
        obj['char'] = glyph['char']
        location = obj.location.copy()
        obj.parent = group
        # Glyph Y becomes ground Y (the baseline stays on TAG_Y); the slab rests on the ground.
        obj.location = (location.x, location.y, dz / 2)
        obj.data.shade_smooth()
        obj.data.set_sharp_from_angle(angle=math.radians(35))
        pen += glyph['advance'] * scale + TAG_TRACKING
        index += 1
    return group


def build(root):
    frame = room.material('SignFrame', (0.02, 0.018, 0.026), 0.45, 0.5)
    glow = room.material('SignGlow', (0.55, 0.35, 1.0), 0.4, emission=(0.55, 0.35, 1.0), strength=3.0)
    for name, sign in SIGNS.items():
        build_sign(name, sign, frame, glow, root)
    # The ground behind the two room walls cannot be seen from the corner camera: keep the character out of it.
    room.collider('BehindLeft', (-FAR, -HALF - WALL_T, GROUND_Z), (-HALF - WALL_T, FAR, 1), root)
    room.collider('BehindBack', (-FAR, HALF + WALL_T, GROUND_Z), (HALF + WALL_T, FAR, 1), root)
    build_letters(root)
    root['bounds'] = [-FAR, FAR, -FAR, FAR]
    root['ground_y'] = GROUND_Z
    root['platform'] = PLATFORM


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
    if not GLYPHS.exists():
        raise RuntimeError(f'Missing {GLYPHS}: run node scripts/name_glyphs.ts first.')
    for sign in SIGNS.values():
        if not (TEXTURES / sign['image']).exists():
            raise RuntimeError(f'Missing {TEXTURES / sign["image"]}: run node scripts/capture_sites.ts first.')
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.scene.unit_settings.system = 'METRIC'
    root = bpy.data.objects.new('Outside', None)
    bpy.context.collection.objects.link(root)
    root['stage'] = '09-outside-signs-row'
    build(root)
    BLEND.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=str(BLEND), compress=True)
    export_glb(root)


if __name__ == '__main__':
    main()
