"""Outside the room diorama: three link signs and the name letters.

Builds assets/blender/outside.blend and public/models/outside.glb. The GLB holds the `Outside` root.
There is no ground mesh: the viewer draws the endless ground itself at `ground_y` (a little below
the room floor, so the room reads as a raised platform) and uses the walkable `bounds`.
- `Sign_<Name>`: a standing board on two posts with a screenshot of the site (assets/textures/outside/),
  facing the isometric corner camera. Extras: `link`, `label`, `board` [width, height, bottom] and the
  floor zone in front of it, `area` [width, depth] at `area_offset` metres towards the camera.
- `Collider_*`: boxes the character cannot enter (the signs and the hidden ground behind the room walls).
- `Letters`: one mesh per letter of NAME, origin at its centre, with a `box` [width, height, depth] extra
  in three.js axes for the physics body.
The room itself (room.glb) is not modified.
"""
import argparse
import math
import sys
from pathlib import Path

import bpy
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
# Screen axes of the isometric corner camera on the Blender ground: towards the camera and screen-right.
TOWARDS = (math.sqrt(0.5), -math.sqrt(0.5))
RIGHT = (math.sqrt(0.5), math.sqrt(0.5))
YAW = math.radians(45)  # local -Y (the board front) turned towards the camera
SIGN_DISTANCE, SIGN_SPACING = 10.0, 3.8
SIGNS = {
    'Portfolio': {'link': 'https://andres-jaramillo.is-a.dev/', 'label': 'Ver portafolio', 'slot': -1, 'image': 'portfolio.png'},
    'GitHub': {'link': 'https://github.com/SrPio', 'label': 'Ver GitHub', 'slot': 0, 'image': 'github.png'},
    'LinkedIn': {'link': 'https://www.linkedin.com/in/andres-fernando-jaramillo-avila/', 'label': 'Ver LinkedIn', 'slot': 1, 'image': 'linkedin.png'},
}
NAME = 'ANDRES JARAMILLO'
NAME_DISTANCE = 6.2
LETTER_SIZE = 0.82   # font size; caps come out about 0.6 m tall
LETTER_DEPTH = 0.2


def ground_point(distance, offset):
    return (TOWARDS[0] * distance + RIGHT[0] * offset, TOWARDS[1] * distance + RIGHT[1] * offset)


def build_sign(name, sign, frame, glow, root):
    holder = room.anchor(f'Sign_{name}', (*ground_point(SIGN_DISTANCE, sign['slot'] * SIGN_SPACING), GROUND_Z), root, YAW,
                         link=sign['link'], label=sign['label'], board=[BOARD_W, BOARD_H, BOARD_BOTTOM],
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
    collider = room.anchor(f'Collider_Sign_{name}', holder.location, root, YAW, collider='box',
                           size=[BOARD_W + 2 * POST, 0.16, top])
    return holder, collider


def build_letters(root):
    letters = room.anchor('Letters', (*ground_point(NAME_DISTANCE, 0), GROUND_Z), root, YAW)
    mat = room.material('Letter', (0.84, 0.8, 0.94), 0.5)
    curve = bpy.data.curves.new('NameText', 'FONT')
    curve.body = NAME
    curve.size = LETTER_SIZE
    curve.extrude = LETTER_DEPTH / 2
    curve.bevel_depth = 0.012
    curve.bevel_resolution = 1
    curve.resolution_u = 4
    curve.align_x = 'CENTER'
    curve.space_character = 1.12
    curve.space_word = 2.2
    curve.materials.append(mat)
    text = bpy.data.objects.new('NameText', curve)
    bpy.context.collection.objects.link(text)
    bpy.ops.object.select_all(action='DESELECT')
    bpy.context.view_layer.objects.active = text
    text.select_set(True)
    bpy.ops.object.convert(target='MESH')
    # Stand the text up: glyphs read along +X, caps point +Z and the front faces -Y (the camera side).
    text.data.transform(Matrix.Rotation(math.pi / 2, 4, 'X'))
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.mesh.remove_doubles(threshold=0.0005)
    bpy.ops.mesh.separate(type='LOOSE')
    bpy.ops.object.mode_set(mode='OBJECT')
    parts = [obj for obj in bpy.context.selected_objects if obj.type == 'MESH']
    bpy.ops.object.origin_set(type='ORIGIN_GEOMETRY', center='BOUNDS')
    parts.sort(key=lambda obj: obj.location.x)
    chars = NAME.replace(' ', '')
    if len(parts) != len(chars):
        raise RuntimeError(f'Expected {len(chars)} letters, got {len(parts)} pieces')
    cap = min(obj.dimensions.z for obj in parts)
    for index, (obj, char) in enumerate(zip(parts, chars)):
        obj.name = obj.data.name = f'Letter_{index:02d}_{char}'
        if obj.dimensions.z > cap * 1.06:
            # The font's J descends below the baseline: squash it to cap height so the name stays level.
            obj.data.transform(Matrix.Diagonal((1, 1, cap / obj.dimensions.z, 1)))
            obj.data.update()
        dx, dy, dz = (max(v.co[i] for v in obj.data.vertices) - min(v.co[i] for v in obj.data.vertices) for i in range(3))
        obj['box'] = [round(dx, 4), round(dz, 4), round(dy, 4)]   # three.js: width, height, depth
        obj.parent = letters
        obj.location.z = dz / 2   # every glyph stands on the ground, the J too
        obj.data.shade_smooth()
        obj.data.set_sharp_from_angle(angle=math.radians(35))
    return letters


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
    for sign in SIGNS.values():
        if not (TEXTURES / sign['image']).exists():
            raise RuntimeError(f'Missing {TEXTURES / sign["image"]}: run node scripts/capture_sites.ts first.')
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.scene.unit_settings.system = 'METRIC'
    root = bpy.data.objects.new('Outside', None)
    bpy.context.collection.objects.link(root)
    root['stage'] = '08-outside-signs'
    build(root)
    BLEND.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=str(BLEND), compress=True)
    export_glb(root)


if __name__ == '__main__':
    main()
