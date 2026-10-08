"""Outside the room diorama: link signs, the name letters, the crossroads and the playground.

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
- `Tagline`: "<Developer />" in the same font, smaller and lying flat on the ground in front of the name
  (glyph tops towards the name, so it reads upright from the camera); `Tag_<i>` meshes with `box` and
  `char` extras, also moved by the letter physics.
- `Keys`, `Bowling`, `Bricks`: loose pieces for the physics (the arrow keys of the intro, ten pins and a
  ball, stacked bricks). Every piece of a kind shares one mesh; extras `prop`, `group`, `mass` and the
  collision shape: `box` [width, height, depth] in three.js axes, `radius` for the ball, or `cylinders`
  [radius, height, centre height, ...] about the piece origin for a pin.
- `Floor_<Id>`: where the viewer paints on the ground (intro sentence, crossroads arrows, controls,
  playground sign, bowling lane, footprints out of the room's front corner); extras `floor` and `size` [width, depth] in the anchor's own axes, the
  `gap` left for the 3D keys, or the `targets` the crossroads arrows point at (three.js x, z pairs) with the
  comma-separated zone `labels` they are named after.
- `Lamppost`: the street lamp in the middle of the crossroads circle; extras `height`, `pole_radius` and where the
  viewer hangs one arrow board per crossroads arrow (`arrows_top`, `arrow_step`), plus `Collider_Lamppost`.
- `Zone_<Id>`: floor zones that put a group of pieces back (`zone` 'reset', `target`, `area`).
Layout positions are written in three.js ground coordinates (x, z); Blender Y is three.js -Z.
The room itself (room.glb) is not modified.
"""
import argparse
import math
import random
import sys
from pathlib import Path

import bmesh
import bpy
import json
from mathutils import Matrix, Vector

sys.path.insert(0, str(Path(__file__).resolve().parent))
import create_room as room

ROOT = Path(__file__).resolve().parents[2]
BLEND = ROOT / 'assets' / 'blender' / 'outside.blend'
GLB = ROOT / 'public' / 'models' / 'outside.glb'
TEXTURES = ROOT / 'assets' / 'textures' / 'outside'
HALF, WALL_T = room.HALF, room.WALL_T
GROUND_Z = -0.12    # outside ground, below the room floor (plank tops at 0)
FAR = 24.0          # walkable ground from the room centre, further on the +X side and in front (BOUNDS)
# Blender XY rectangle of the walkable ground: the crossroads and the playground lie towards +X and -Y.
BOUNDS = [-FAR, 44.0, -30.0, FAR]
# Room platform footprint in Blender XY (create_room.build_shell): the floor is at 0 inside it.
PLATFORM = [-HALF - WALL_T, HALF + 0.1, -HALF - 0.1, HALF + WALL_T]
BOARD_W, BOARD_H, BOARD_BOTTOM, BOARD_T, BORDER, POST = 2.4, 1.5, 0.6, 0.06, 0.07, 0.08
AREA, AREA_OFFSET = (2.6, 1.8), 1.55
# Signs: a row facing the front past the crossroads on the +X side, 5 m nearer the front than the back wall line.
SIGN_Y, SIGN_FIRST_X, SIGN_SPACING = HALF + 0.15 - 5.0, 19.0, 3.2
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


# ------------------------------------------------------------------ crossroads and playground

# Blocks (the intro sentence, the crossroads, the controls, the playground) keep BLOCK_YAW: their local +X runs
# along three.js +X like the name and the sign titles, so they lie in the same perspective, and their local +Z
# points towards the front (three.js yaw about +Y, the same angle as a Blender rotation about Z).
BLOCK_YAW = 0.0
INTRO = (9.0, -1.3)            # centre of the arrow keys, in the gap of the intro sentence
INTRO_SIZE, INTRO_GAP = (12.4, 3.6), 2.4
KEY_SIZE, KEY_HEIGHT, KEY_PITCH = 0.6, 0.3, 0.68
CROSSROADS = (15.75, 10.0)
# Lamppost in the crossroads circle: pole top, pole radius, and the arrow boards from ARROWS_TOP down by ARROW_STEP.
LAMP_HEIGHT, LAMP_POLE = 3.4, 0.065
LAMP_ARROWS_TOP, LAMP_ARROW_STEP = 2.85, 0.48
CONTROLS, CONTROLS_SIZE = (3.75, 15.8), (5.6, 4.8)
PLAY_SIGN, PLAY_SIGN_SIZE = (14.25, 14.8), (6.4, 1.9)
PLAYGROUND = (20.75, 21.3)
# Footprints leaving the room's open front corner towards the camera.
FOOTPRINTS, FOOTPRINTS_SIZE = (4.45, 4.45), (3.3, 3.3)
# Bowling (playground axes): the ball near the camera, the pins up the lane in a 4-3-2-1 triangle.
LANE_X, BALL_Z, HEAD_PIN_Z = -3.6, 3.6, -1.2
PIN_SPACING, PIN_ROW = 0.56, 0.485
PIN_HEIGHT = 0.7
PIN_ORIGIN = 0.3      # pin origin above its foot, near its centre of mass
# Pin outline (height, radius) from the foot to the crown; the band between PIN_BAND heights is red.
PIN_PROFILE = [(0.0, 0.0), (0.0, 0.068), (0.03, 0.088), (0.12, 0.11), (0.22, 0.116), (0.32, 0.098), (0.4, 0.066),
               (0.415, 0.06), (0.445, 0.052), (0.47, 0.05), (0.53, 0.055), (0.6, 0.064), (0.655, 0.055), (0.69, 0.032), (0.7, 0.0)]
PIN_BAND = (0.415, 0.445)
# Collision: stacked cylinders (radius, height, centre height above the foot).
PIN_CYLINDERS = [(0.085, 0.1, 0.05), (0.112, 0.26, 0.22), (0.055, 0.2, 0.45), (0.062, 0.14, 0.6)]
BALL_RADIUS = 0.24
BRICK_W, BRICK_H, BRICK_D, BRICK_GAP = 0.5, 0.24, 0.25, 0.01
MASS = {'key': 1.5, 'pin': 0.25, 'ball': 3.0, 'brick': 0.6}
RESET_AREA = [1.7, 1.7]


def frame(origin, yaw=BLOCK_YAW):
    """Local (x, z) of a turned block to three.js ground (x, z)."""
    ox, oz = origin
    c, s = math.cos(yaw), math.sin(yaw)
    return lambda x, z: (ox + x * c + z * s, oz - x * s + z * c)


def at(point, height=0.0):
    """three.js ground point (x, z) to a Blender location."""
    return (point[0], -point[1], GROUND_Z + height)


def proto_mesh(name, bm, mats, smooth_angle=None):
    """A mesh shared by every piece of one kind (modifiers would stop the GLB from sharing it)."""
    data = bpy.data.meshes.new(name)
    bm.to_mesh(data)
    bm.free()
    for mat in mats:
        data.materials.append(mat)
    if smooth_angle:
        data.shade_smooth()
        data.set_sharp_from_angle(angle=math.radians(smooth_angle))
    return data


def key_mesh(base_mat, arrow_mat):
    """Keyboard key: a rounded cap with a flat arrow on top pointing Blender +Y (three.js -Z, screen up)."""
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        v.co = Vector((v.co.x * KEY_SIZE, v.co.y * KEY_SIZE, v.co.z * KEY_HEIGHT))
    # The top a little narrower than the foot, like a keycap.
    for v in bm.verts:
        if v.co.z > 0:
            v.co.x *= 0.86
            v.co.y *= 0.86
    bmesh.ops.bevel(bm, geom=list(bm.edges), offset=0.035, segments=3, affect='EDGES', profile=0.5)
    top = KEY_HEIGHT / 2 - 0.004
    outline = [(0.0, 0.16), (-0.13, 0.02), (-0.045, 0.02), (-0.045, -0.15), (0.045, -0.15), (0.045, 0.02), (0.13, 0.02)]
    pieces = [[0, 1, 6], [2, 3, 4, 5]]
    low = [bm.verts.new((x, y, top)) for x, y in outline]
    high = [bm.verts.new((x, y, top + 0.022)) for x, y in outline]
    for face in pieces:
        bm.faces.new([high[i] for i in face]).material_index = 1
        bm.faces.new([low[i] for i in reversed(face)]).material_index = 1
    rim = [0, 1, 2, 3, 4, 5, 6]
    for a, b in zip(rim, rim[1:] + rim[:1]):
        bm.faces.new([low[a], low[b], high[b], high[a]]).material_index = 1
    return proto_mesh('Prop_Key', bm, [base_mat, arrow_mat], smooth_angle=40)


def pin_mesh(body_mat, band_mat, segments=18):
    """Bowling pin turned from PIN_PROFILE, origin PIN_ORIGIN above the foot."""
    bm = bmesh.new()
    rings = []
    for height, radius in PIN_PROFILE:
        if radius == 0:
            rings.append([bm.verts.new((0, 0, height - PIN_ORIGIN))])
            continue
        rings.append([bm.verts.new((radius * math.cos(2 * math.pi * i / segments), radius * math.sin(2 * math.pi * i / segments),
                                    height - PIN_ORIGIN)) for i in range(segments)])
    for k in range(len(rings) - 1):
        a, b = rings[k], rings[k + 1]
        lo, hi = PIN_PROFILE[k][0], PIN_PROFILE[k + 1][0]
        band = 1 if PIN_BAND[0] <= lo and hi <= PIN_BAND[1] and hi > lo else 0
        for i in range(segments):
            j = (i + 1) % segments
            if len(a) == 1:
                face = bm.faces.new((a[0], b[i], b[j]))
            elif len(b) == 1:
                face = bm.faces.new((a[i], b[0], a[j]))
            else:
                face = bm.faces.new((a[i], b[i], b[j], a[j]))
            face.material_index = band
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return proto_mesh('Prop_Pin', bm, [body_mat, band_mat], smooth_angle=60)


def ball_mesh(ball_mat, hole_mat):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=24, v_segments=14, radius=BALL_RADIUS)
    # Three finger holes as dark discs set into the surface.
    for direction in (Vector((0.0, -0.35, 1.0)), Vector((-0.2, 0.0, 1.0)), Vector((0.2, 0.0, 1.0))):
        direction.normalize()
        disc = bmesh.ops.create_circle(bm, cap_ends=True, segments=10, radius=0.028 if direction.y else 0.024)
        rotation = direction.to_track_quat('Z', 'Y').to_matrix()
        for v in disc['verts']:
            v.co = rotation @ v.co + direction * (BALL_RADIUS + 0.0015)
        for face in {f for v in disc['verts'] for f in v.link_faces}:
            face.material_index = 1
    return proto_mesh('Prop_Ball', bm, [ball_mat, hole_mat], smooth_angle=50)


def brick_mesh(name, mat):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts:
        v.co = Vector((v.co.x * BRICK_W, v.co.y * BRICK_D, v.co.z * BRICK_H))   # three.js width, depth, height
    bmesh.ops.bevel(bm, geom=list(bm.edges), offset=0.012, segments=2, affect='EDGES', profile=0.5)
    return proto_mesh(name, bm, [mat], smooth_angle=40)


def piece(name, mesh, point, height, yaw, parent, **extras):
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    obj.parent = parent
    obj.location = at(point, height)
    obj.rotation_euler.z = yaw
    for key, value in extras.items():
        obj[key] = value
    return obj


def brick_layers(rows):
    """Bricks of a stack in its own axes (x along the wall, layer, z across, yaw): one tuple per brick."""
    pitch = BRICK_W + BRICK_GAP
    bricks = []
    for layer, (count, shift) in enumerate(rows):
        for i in range(count):
            bricks.append(((i - (count - 1) / 2) * pitch + shift, layer, 0.0, 0.0))
    return bricks


def tower_layers(layers):
    """A square column: two bricks side by side per layer, turned a quarter between layers."""
    bricks = []
    half = BRICK_D / 2 + BRICK_GAP / 2
    for layer in range(layers):
        for side in (-1, 1):
            if layer % 2 == 0:
                bricks.append((0.0, layer, side * half, 0.0))
            else:
                bricks.append((side * half, layer, 0.0, math.pi / 2))
    return bricks


def build_playground(root):
    rng = random.Random(4)
    key_mat = room.material('KeyCap', (0.86, 0.83, 0.94), 0.45)
    arrow_mat = room.material('KeyArrow', (0.36, 0.24, 0.58), 0.5)
    pin_mat = room.material('PinBody', (0.93, 0.91, 0.94), 0.3)
    band_mat = room.material('PinBand', (0.78, 0.12, 0.2), 0.35)
    ball_mat = room.material('Ball', (0.32, 0.15, 0.6), 0.2)
    hole_mat = room.material('BallHole', (0.03, 0.02, 0.04), 0.8)
    bricks = [brick_mesh('Prop_Brick', room.material('Brick', (0.64, 0.28, 0.2), 0.8)),
              brick_mesh('Prop_BrickDark', room.material('BrickDark', (0.5, 0.21, 0.17), 0.85))]

    # Intro: the arrow keys in an inverted T, inside the gap of the sentence painted around them.
    intro = frame(INTRO)
    room.anchor('Floor_Intro', at(INTRO), root, BLOCK_YAW, floor='intro', size=list(INTRO_SIZE), gap=INTRO_GAP)
    keys = room.anchor('Keys', (0, 0, 0), root)
    key = key_mesh(key_mat, arrow_mat)
    for name, (x, z), turn in (('Up', (0, -0.5), 0.0), ('Left', (-1, 0.5), math.pi / 2), ('Down', (0, 0.5), math.pi),
                               ('Right', (1, 0.5), -math.pi / 2)):
        piece(f'Key_{name}', key, intro(x * KEY_PITCH, z * KEY_PITCH), KEY_HEIGHT / 2, BLOCK_YAW + turn, keys,
              prop='key', group='keys', mass=MASS['key'], box=[KEY_SIZE, KEY_HEIGHT, KEY_SIZE])

    # Crossroads: a painted arrow and a 3D arrow on the lamppost towards each zone. Another zone is one more
    # entry here (its name is `floor.<id>` in src/core/i18n.ts); the controls panel gets no arrow.
    arrows = [('links', (SIGN_FIRST_X + SIGN_SPACING, -(SIGN_Y - AREA_OFFSET))), ('playground', PLAY_SIGN)]
    room.anchor('Floor_Crossroads', at(CROSSROADS), root, BLOCK_YAW, floor='crossroads', size=[10.6, 7.0],
                targets=[value for _, point in arrows for value in point], labels=','.join(label for label, _ in arrows))
    room.anchor('Floor_Controls', at(CONTROLS), root, BLOCK_YAW, floor='controls', size=list(CONTROLS_SIZE))
    room.anchor('Floor_Playground', at(PLAY_SIGN), root, BLOCK_YAW, floor='playground', size=list(PLAY_SIGN_SIZE),
                targets=list(PLAYGROUND))

    room.anchor('Floor_Footprints', at(FOOTPRINTS), root, BLOCK_YAW, floor='footprints', size=list(FOOTPRINTS_SIZE))

    play = frame(PLAYGROUND)
    room.anchor('Floor_Bowling', at(play(LANE_X, (BALL_Z + HEAD_PIN_Z) / 2 - 0.4)), root, BLOCK_YAW, floor='bowling',
                size=[1.9, BALL_Z - HEAD_PIN_Z + 2.6])
    bowling = room.anchor('Bowling', (0, 0, 0), root)
    pin = pin_mesh(pin_mat, band_mat)
    cylinders = [round(value, 4) for radius, height, centre in PIN_CYLINDERS for value in (radius, height, centre - PIN_ORIGIN)]
    index = 0
    for row in range(4):
        for i in range(row + 1):
            x = LANE_X + (i - row / 2) * PIN_SPACING
            piece(f'Pin_{index:02d}', pin, play(x, HEAD_PIN_Z - row * PIN_ROW), PIN_ORIGIN, BLOCK_YAW + rng.uniform(-0.3, 0.3), bowling,
                  prop='pin', group='bowling', mass=MASS['pin'], cylinders=cylinders, box=[0.23, PIN_HEIGHT, 0.23])
            index += 1
    piece('Ball', ball_mesh(ball_mat, hole_mat), play(LANE_X, BALL_Z), BALL_RADIUS, BLOCK_YAW, bowling,
          prop='ball', group='bowling', mass=MASS['ball'], radius=BALL_RADIUS, box=[2 * BALL_RADIUS] * 3)
    room.anchor('Zone_Bowling', at(play(LANE_X - 2.4, BALL_Z)), root, BLOCK_YAW, zone='reset', target='bowling', area=RESET_AREA)

    # Bricks: a running-bond wall, a stepped pyramid and a square tower.
    group = room.anchor('Bricks', (0, 0, 0), root)
    stacks = [
        ((1.8, -1.6), 0.0, brick_layers([(6, 0.0), (5, 0.0)] * 2 + [(6, 0.0)])),
        ((5.8, 0.6), 0.0, brick_layers([(5, 0.0), (4, 0.0), (3, 0.0), (2, 0.0), (1, 0.0)])),
        ((2.2, 2.6), 0.0, tower_layers(8)),
    ]
    count = 0
    for (sx, sz), turn, layout in stacks:
        for x, layer, z, yaw in layout:
            wobble = rng.uniform(-0.02, 0.02)
            piece(f'Brick_{count:02d}', bricks[rng.random() < 0.35], play(sx + x, sz + z), BRICK_H / 2 + layer * (BRICK_H + 0.001),
                  BLOCK_YAW + turn + yaw + wobble, group, prop='brick', group='bricks', mass=MASS['brick'], box=[BRICK_W, BRICK_H, BRICK_D])
            count += 1
    room.anchor('Zone_Bricks', at(play(7.6, 3.4)), root, BLOCK_YAW, zone='reset', target='bricks', area=RESET_AREA)


def build_lamppost(root, iron, glow):
    """Street lamp: a stepped base, a thin pole with collars and a lantern with a glowing glass."""
    lamp = room.anchor('Lamppost', at(CROSSROADS), root, BLOCK_YAW, height=LAMP_HEIGHT, pole_radius=LAMP_POLE,
                       arrows_top=LAMP_ARROWS_TOP, arrow_step=LAMP_ARROW_STEP)
    glass = room.material('LampGlass', (1.0, 0.88, 0.7), 0.3, emission=(1.0, 0.82, 0.6), strength=4.0)
    h = LAMP_HEIGHT
    room.cylinder('LampBase', (0, 0, 0.08), 0.24, 0.16, iron, lamp, top=0.2, segments=16)
    room.cylinder('LampPlinth', (0, 0, 0.32), 0.12, 0.32, iron, lamp, top=LAMP_POLE + 0.015, segments=16)
    room.cylinder('LampPole', (0, 0, (0.48 + h) / 2), LAMP_POLE, h - 0.48, iron, lamp, segments=16)
    for index, z in enumerate((1.15, h - 0.08)):
        room.cylinder(f'LampCollar_{index}', (0, 0, z), LAMP_POLE + 0.03, 0.06, iron, lamp, segments=16)
    room.cylinder('LampSeat', (0, 0, h + 0.02), 0.08, 0.04, iron, lamp, top=0.13, segments=16)
    room.cylinder('LampRing', (0, 0, h + 0.055), 0.125, 0.03, glow, lamp, segments=16)
    room.cylinder('LampGlass', (0, 0, h + 0.24), 0.11, 0.36, glass, lamp, top=0.15, segments=16)
    room.cylinder('LampCap', (0, 0, h + 0.48), 0.21, 0.13, iron, lamp, top=0.05, segments=16)
    room.cylinder('LampFinial', (0, 0, h + 0.58), 0.022, 0.08, iron, lamp, segments=8)
    x, y, _ = at(CROSSROADS)
    room.collider('Lamppost', (x - 0.25, y - 0.25, GROUND_Z), (x + 0.25, y + 0.25, GROUND_Z + h), root)
    return lamp


def build(root):
    frame = room.material('SignFrame', (0.02, 0.018, 0.026), 0.45, 0.5)
    glow = room.material('SignGlow', (0.55, 0.35, 1.0), 0.4, emission=(0.55, 0.35, 1.0), strength=3.0)
    for name, sign in SIGNS.items():
        build_sign(name, sign, frame, glow, root)
    build_lamppost(root, frame, glow)
    # The ground behind the two room walls cannot be seen from the corner camera: keep the character out of it.
    room.collider('BehindLeft', (-FAR, -HALF - WALL_T, GROUND_Z), (-HALF - WALL_T, FAR, 1), root)
    room.collider('BehindBack', (-FAR, HALF + WALL_T, GROUND_Z), (HALF + WALL_T, FAR, 1), root)
    build_letters(root)
    build_playground(root)
    root['bounds'] = BOUNDS
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
    root['stage'] = '11-crossroads-lamppost'
    build(root)
    BLEND.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=str(BLEND), compress=True)
    export_glb(root)


if __name__ == '__main__':
    main()
