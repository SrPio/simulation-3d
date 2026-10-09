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
- `Zone_<Id>`: floor zones that put a group of pieces back (`zone` 'reset', `target`, `area`); `target` 'targets'
  clears the thrown laptops and the score of the targets lane instead.
- `About`: the plaza around the signs (`Floor_About`): `Bust` (the web V4 head and shoulders in marble on a pedestal,
  the cap keeping its own materials), `Globe` (stand only, with `radius` and `centre`; the viewer draws the sphere and
  the pin on Colombia), planters, park lamps and `Plaque_<text>` anchors where the viewer
  paints plaques (`plaque` [width, height], `text`) facing the front.
- `Decor`: fixed trees, rocks and benches sharing one mesh per kind; extras `decor`, `shadow` [width, depth]
  for the blob shadow and `solid` [width, height, depth] for the box pieces bounce off, plus a `Collider_*` each.
- `Clutter`: cardboard boxes and cones the character can knock about (group 'decor'); each box (`prop` 'box') has four
  `<name>_Flap_<i>` children hinged at its rim that the viewer opens when the character comes near.
- `Targets`: `Target_<i>` anchors at the foot of each standing target (`radius`, disc `centre` height, `rings` radii and
  their `points`), facing the throw line painted by `Floor_Targets` (`line`: its distance ahead of the block centre);
  `Scoreboard` (`board` [width, height, bottom]) where the viewer paints the score.
- `Tech`: `Tech_<i>_<name>` cubes in a 4-3-2-1 pyramid (group 'tech', `tech` name) with the tools' logos from
  assets/textures/outside/tech-atlas.png (scripts/tech_atlas.ts) on their +Z and +X faces.
Everything keeps the block perspective: axis aligned, fronts facing three.js +Z, rows along +X (see BLOCK_YAW).
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
BOUNDS = [-30.0, 52.0, -46.0, FAR]
# Room platform footprint in Blender XY (create_room.build_shell): the floor is at 0 inside it.
PLATFORM = [-HALF - WALL_T, HALF + 0.1, -HALF - 0.1, HALF + WALL_T]
BOARD_W, BOARD_H, BOARD_BOTTOM, BOARD_T, BORDER, POST = 2.4, 1.5, 0.6, 0.06, 0.07, 0.08
AREA, AREA_OFFSET = (2.6, 1.8), 1.55
# Signs: a row facing the front at the back of the about-me plaza, past the room's +X side.
SIGN_Y, SIGN_FIRST_X, SIGN_SPACING = 4.39, 27.0, 3.2   # three.js z -4.39: near the back edge of the about-me plaza
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
CROSSROADS = (10.1, 12.3)      # where the footprints out of the room lead
# Lamppost in the crossroads circle: pole top, pole radius, and the arrow boards from ARROWS_TOP down by ARROW_STEP.
LAMP_HEIGHT, LAMP_POLE = 3.4, 0.065
LAMP_ARROWS_TOP, LAMP_ARROW_STEP = 2.85, 0.48
CONTROLS, CONTROLS_SIZE = (-1.7, 16.25), (5.6, 4.8)
PLAYGROUND = (21.6, 32.9)       # origin of the bowling and brick lanes (playground axes)
BRICKS_SHIFT = 2.5              # the brick stacks stand this far further along +X than the bowling lane's frame
# Footprints leaving the room's open front corner towards the camera.
FOOTPRINTS, FOOTPRINTS_SIZE = (4.45, 4.45), (3.3, 3.3)
# A few more prints here and there, where the user marked them on the canvas: each trail is its steps (three.js x, z and
# the heading the foot points along, atan2(dz, dx)), drawn by the viewer like the ones leaving the room.
PRINT_TRAILS = {
    'plaza': [(15.12, 12.63, 0.304), (15.83, 13.11, 0.264), (16.67, 13.03, 0.159), (17.47, 13.32, -0.078), (18.16, 12.84, -0.53), (18.92, 12.47, -0.97), (19.04, 11.62, -1.215)],
    'playground': [(11.12, 20.21, 1.893), (10.53, 20.9, 1.666), (10.82, 21.72, 1.395), (10.92, 22.58, 0.907), (11.71, 22.95, 0.616), (12.26, 23.61, 0.555)],
    'controls': [(4.04, 16.04, 2.829), (3.22, 16.09, 2.713), (2.56, 16.61, 2.932), (1.77, 16.37, -3.001)],
    'works': [(-6.32, 21.75, 2.259), (-7.03, 22.29, 2.123), (-7.11, 23.16, 1.758), (-7.3, 24.03, 1.212), (-6.65, 24.63, 0.897), (-6.26, 25.43, 0.758)],
    'forest': [(34.47, 21.37, -0.259), (35.33, 21.35, -0.404), (35.32, 20.5, -1.575), (35.57, 19.67, -1.582), (35.35, 18.84, -1.427), (35.87, 18.17, -0.915), (36.36, 17.49, -0.481), (37.23, 17.37, -0.47)],
}
# The crossroads is a round bed of grass with low bushes and a few flowers round the lamppost (nothing painted on it).
CROSSROADS_GREEN = 4.0
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

    # Crossroads: a 3D arrow on the lamppost towards each zone (nothing is painted on the ground there: it is a round
    # bed of grass). Another zone is one more entry here (its name is `floor.<id>` in src/core/i18n.ts).
    arrows = [('about', ABOUT), ('playground', PLAY_AREA)]
    room.anchor('Floor_Crossroads', at(CROSSROADS), root, BLOCK_YAW, floor='crossroads', size=[10.6, 7.0],
                targets=[value for _, point in arrows for value in point], labels=','.join(label for label, _ in arrows))
    room.anchor('Floor_Controls', at(CONTROLS), root, BLOCK_YAW, floor='controls', size=list(CONTROLS_SIZE))

    room.anchor('Floor_Footprints', at(FOOTPRINTS), root, BLOCK_YAW, floor='footprints', size=list(FOOTPRINTS_SIZE))
    for name, steps in PRINT_TRAILS.items():
        xs, zs = [x for x, _, _ in steps], [z for _, z, _ in steps]
        centre = ((min(xs) + max(xs)) / 2, (min(zs) + max(zs)) / 2)
        room.anchor(f'Floor_Prints_{name}', at(centre), root, BLOCK_YAW, floor='prints',
                    size=[round(max(xs) - min(xs) + 0.8, 3), round(max(zs) - min(zs) + 0.8, 3)],
                    steps=[value for step in steps for value in step])

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
        ((1.8 + BRICKS_SHIFT, -1.6), 0.0, brick_layers([(6, 0.0), (5, 0.0)] * 2 + [(6, 0.0)])),
        ((5.8 + BRICKS_SHIFT, 0.6), 0.0, brick_layers([(5, 0.0), (4, 0.0), (3, 0.0), (2, 0.0), (1, 0.0)])),
        ((2.2 + BRICKS_SHIFT, 2.6), 0.0, tower_layers(8)),
    ]
    count = 0
    for (sx, sz), turn, layout in stacks:
        for x, layer, z, yaw in layout:
            wobble = rng.uniform(-0.02, 0.02)
            piece(f'Brick_{count:02d}', bricks[rng.random() < 0.35], play(sx + x, sz + z), BRICK_H / 2 + layer * (BRICK_H + 0.001),
                  BLOCK_YAW + turn + yaw + wobble, group, prop='brick', group='bricks', mass=MASS['brick'], box=[BRICK_W, BRICK_H, BRICK_D])
            count += 1
    room.anchor('Zone_Bricks', at(play(7.6 + BRICKS_SHIFT, 3.4)), root, BLOCK_YAW, zone='reset', target='bricks', area=RESET_AREA)


# ------------------------------------------------------------------ about me plaza, decor, targets and tech tower

# Everything here keeps the block perspective: rectangles and fronts are axis aligned (yaw 0 or a quarter turn),
# fronts face three.js +Z (Blender -Y) like the signs, and rows run along +X, so the default corner camera sees
# each front and its +X side. Only round things (tree crowns, rocks) turn freely.
V4_GLB = ROOT / 'public' / 'models' / 'developer-v4.glb'
STONE = TEXTURES / 'stone.png'
TECH_ATLAS = TEXTURES / 'tech-atlas.png'
# The about-me plaza: a park around the bust with the signs at its back (positions set on the adjustable canvas).
ABOUT, ABOUT_SIZE = (30.25, 2.5), (17.5, 16.5)
BUST = (30.2, 2.25)
GLOBE = (25.2, 2.25)
PATH_RADIUS = 2.6                                # painted ring round the bust
ABOUT_BENCHES = [(30.2, 5.85), (26.6, 5.25), (33.8, 5.25)]   # along X, facing the bust
ABOUT_TREES = [(23.0, -3.75, 0), (37.4, -3.75, 1), (23.0, 8.75, 1), (37.4, 8.75, 0)]
PLANTERS = [(26.5, 8.85), (33.9, 8.85)]
PARK_LAMPS = [(24.6, 5.45), (36.0, 5.45)]
PLANTER_SIZE = (2.4, 0.8, 0.45)                  # length along X, depth, height
PEDESTAL = (1.7, 1.0)                            # width/depth, height
BUST_CUT_Z, BUST_CUT_X, BUST_SCALE = 1.62, 0.46, 0.85 * 2.5   # 2.5 times the first statue
BUST_HEIGHT = (2.65 - 1.62) * BUST_SCALE        # from the pedestal top to the cap
BUST_FACES = {'stone': 3200, 'cap': 1000}   # outside.glb stays under its size budget (tests/outside.test.ts)
GLOBE_RADIUS, GLOBE_HEIGHT = 0.42, 1.25          # globe centre above the ground
# Targets lane: the laptop flies towards -Z from the throw line; the far target sits lower so the arc reaches it.
TARGET_LANE_X, THROW_LINE_Z = 9.0, 36.5
TARGETS = [(7.9, 3.0, 1.72), (10.1, 3.6, 1.3), (9.0, 4.2, 0.8)]   # x, distance from the line, disc centre height (on the laptop's arc)
TARGET_RINGS = [(0.4, 10), (0.26, 25), (0.12, 50)]                 # ring radius, points (outer to inner)
SCOREBOARD = (6.2, 34.3)      # left of the lane, where no target hides it from the corner camera
SCOREBOARD_SIZE = (1.5, 0.9, 1.0)                                  # board width, height, bottom
# Tech tower: a 4-3-2-1 pyramid of cubes along +X, logos on the +Z and +X faces.
TECH = (39.0, 32.0)
TECH_CUBE, TECH_GAP = 0.6, 0.02
TECH_ROWS = [['typescript', 'node', 'pnpm', 'vite'], ['three', 'github', 'playwright'], ['blender', 'gltf'], ['openvdb']]
TECH_ATLAS_COLUMNS = 5
# The playground's own floor, bordered like the about-me plaza, around its four lanes and their reset zones.
PLAY_AREA, PLAY_AREA_SIZE = (25.0, 33.0), (42.0, 16.0)
MASS.update({'crate': 2.0, 'cone': 0.5, 'tech': 0.9})
TREES = [(-15.5, 10.5, 0), (-11.5, 12.0, 1), (-16.0, 15.0, 0), (-12.5, 19.5, 1), (-15.5, 21.5, 0),   # park
         (43.2, 1.8, 1), (46.8, 3.2, 0), (43.6, 6.4, 0), (47.0, 8.0, 1), (44.4, 9.8, 0),             # forest
         (12.5, 5.5, 1)] + ABOUT_TREES
ROCKS = [(-11.0, 16.5, 0.9), (46.0, 10.6, 0.75)]
BENCHES = [(point, 0.0) for point in ABOUT_BENCHES] + [((-13.5, 14.0), 0.0),
           ((3.9, 12.3), math.pi / 2)]   # the last one at the crossroads' left side, off the paths to the zones
CRATES = [(-10.5, 20.5, 0.0), (-10.0, 21.2, 0.0), (-7.0, 28.0, 0.0), (-6.48, 28.0, 0.0), (-6.74, 28.0, 1.0), (-4.5, 29.5, 0.0)]
CONES = [(-7.5, 31.0), (-6.3, 31.4), (-5.1, 31.0), (-3.9, 31.4), (15.5, 4.0), (16.6, 4.6)]
CONE_ORIGIN = 0.15
CONE_CYLINDERS = [(0.18, 0.04, 0.02), (0.13, 0.2, 0.14), (0.085, 0.2, 0.34), (0.045, 0.1, 0.49)]


def bm_box(bm, lo, hi, material=0):
    """Add an axis-aligned box to a bmesh."""
    geom = bmesh.ops.create_cube(bm, size=1.0)
    for v in geom['verts']:
        v.co = Vector(((v.co.x + 0.5) * (hi[0] - lo[0]) + lo[0], (v.co.y + 0.5) * (hi[1] - lo[1]) + lo[1],
                       (v.co.z + 0.5) * (hi[2] - lo[2]) + lo[2]))
    for face in {f for v in geom['verts'] for f in v.link_faces}:
        face.material_index = material
    return geom


def tree_mesh(name, variant, trunk_mat, leaf_mat):
    """Low-poly tree: a six-sided trunk and two or three faceted crown blobs (about 200 triangles)."""
    bm = bmesh.new()
    trunk = bmesh.ops.create_cone(bm, cap_ends=True, segments=6, radius1=0.13, radius2=0.09, depth=1.2)
    for v in trunk['verts']:
        v.co.z += 0.6
    rng = random.Random(10 + variant)
    blobs = [(0.0, 0.0, 1.75, 0.85), (0.25, -0.1, 2.35, 0.6)] if variant == 0 else \
            [(0.0, 0.0, 1.6, 0.7), (-0.3, 0.15, 2.05, 0.6), (0.2, 0.0, 2.5, 0.45)]
    for x, y, z, r in blobs:
        crown = bmesh.ops.create_icosphere(bm, subdivisions=1, radius=r)
        for v in crown['verts']:
            v.co = Vector((v.co.x * rng.uniform(0.9, 1.1) + x, v.co.y * rng.uniform(0.9, 1.1) + y, v.co.z * 0.85 + z))
        for face in {f for v in crown['verts'] for f in v.link_faces}:
            face.material_index = 1
    return proto_mesh(name, bm, [trunk_mat, leaf_mat])


def rock_mesh(name, seed, mat):
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=1, radius=0.5)
    rng = random.Random(seed)
    for v in bm.verts:
        v.co = Vector((v.co.x * rng.uniform(0.85, 1.15) * 1.2, v.co.y * rng.uniform(0.85, 1.15), max(v.co.z, -0.1) * 0.7 + 0.07))
    return proto_mesh(name, bm, [mat])


def bench_mesh(wood, iron):
    """Backless park bench, its length along Blender X (three.js X)."""
    bm = bmesh.new()
    bm_box(bm, (-0.7, -0.2, 0.42), (0.7, 0.2, 0.48), 0)
    for x in (-0.55, 0.55):
        bm_box(bm, (x - 0.04, -0.18, 0.0), (x + 0.04, 0.18, 0.42), 1)
    return proto_mesh('Decor_Bench', bm, [wood, iron])


BOX_SIZE, BOX_WALL, FLAP_T = 0.5, 0.012, 0.008


def box_body_mesh(card, inside, tape):
    """Open cardboard box: outer walls and bottom, darker inner walls, the rim between them and a tape band down the
    front and back where the flaps would be sealed. Origin at the box centre; the flaps are separate (box_flap_mesh)."""
    h, w = BOX_SIZE / 2, BOX_SIZE / 2 - BOX_WALL
    bm = bmesh.new()
    outer = [bm.verts.new(co) for co in ((-h, -h, -h), (h, -h, -h), (h, h, -h), (-h, h, -h), (-h, -h, h), (h, -h, h), (h, h, h), (-h, h, h))]
    inner = [bm.verts.new(co) for co in ((-w, -w, -h + BOX_WALL), (w, -w, -h + BOX_WALL), (w, w, -h + BOX_WALL), (-w, w, -h + BOX_WALL),
                                          (-w, -w, h), (w, -w, h), (w, w, h), (-w, w, h))]
    faces = []
    faces.append((bm.faces.new([outer[i] for i in (3, 2, 1, 0)]), 0))
    for a, b in ((0, 1), (1, 2), (2, 3), (3, 0)):
        faces.append((bm.faces.new((outer[a], outer[b], outer[b + 4], outer[a + 4])), 0))
        faces.append((bm.faces.new((inner[b], inner[a], inner[a + 4], inner[b + 4])), 1))
        faces.append((bm.faces.new((outer[a + 4], outer[b + 4], inner[b + 4], inner[a + 4])), 0))
    faces.append((bm.faces.new([inner[i] for i in (0, 1, 2, 3)]), 1))
    for face, index in faces:
        face.material_index = index
    # Tape: a band over the front (Blender -Y, three.js +Z) and back walls, standing a hair proud of them.
    for side in (-1, 1):
        y = side * (h + 0.001)
        bm_box(bm, (-0.045, y - 0.0005, -0.1), (0.045, y + 0.0005, h), 2)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return proto_mesh('Prop_Box', bm, [card, inside, tape])


def box_flap_mesh(card):
    """One flap, hinged at its origin along Blender X and reaching inwards along +Y (three.js -Z) when closed."""
    bm = bmesh.new()
    bm_box(bm, (-BOX_SIZE / 2 + 0.006, 0.0, 0.0), (BOX_SIZE / 2 - 0.006, BOX_SIZE / 2 - 0.004, FLAP_T), 0)
    return proto_mesh('Prop_BoxFlap', bm, [card])


def cardboard_box(name, body, flap, point, height, parent):
    """A box piece with its four flaps as children at the rim, closed: the long pair over the short pair. The viewer
    opens them (about each child's local X) when the character comes close."""
    obj = piece(name, body, point, height, BLOCK_YAW, parent, prop='box', group='decor', mass=MASS['crate'], box=[BOX_SIZE] * 3)
    h = BOX_SIZE / 2
    for index, (x, y, turn, lift) in enumerate(((0, -h, 0.0, FLAP_T), (0, h, math.pi, FLAP_T), (h, 0, math.pi / 2, 0.0), (-h, 0, -math.pi / 2, 0.0))):
        child = bpy.data.objects.new(f'{name}_Flap_{index}', flap)
        bpy.context.collection.objects.link(child)
        child.parent = obj
        child.location = (x, y, h + lift)
        child.rotation_euler.z = turn
    return obj


def cone_mesh(orange, white):
    bm = bmesh.new()
    bm_box(bm, (-0.18, -0.18, -CONE_ORIGIN), (0.18, 0.18, 0.04 - CONE_ORIGIN), 0)
    radius = lambda z: 0.14 - 0.11 * (z - 0.04) / 0.5
    # Orange body with a white reflective band: three stacked frustums.
    for lo, hi, mat in ((0.04, 0.24, 0), (0.24, 0.34, 1), (0.34, 0.54, 0)):
        part = bmesh.ops.create_cone(bm, cap_ends=True, segments=12, radius1=radius(lo), radius2=radius(hi), depth=hi - lo)
        for v in part['verts']:
            v.co.z += (lo + hi) / 2 - CONE_ORIGIN
        for face in {f for v in part['verts'] for f in v.link_faces}:
            face.material_index = mat
    return proto_mesh('Prop_Cone', bm, [orange, white], smooth_angle=50)


def decor(name, mesh, point, yaw, parent, kind, shadow, solid=None, height=0.0):
    """A fixed decor object: its blob shadow [width, depth] and, for solid ones, the box [w, h, d] pieces bounce off."""
    extras = {'decor': kind, 'shadow': list(shadow)}
    if solid:
        extras['solid'] = list(solid)
    obj = piece(name, mesh, point, height, yaw, parent, **extras)
    if solid:
        x, y, _ = at(point)
        w, d = (solid[0], solid[2]) if abs(math.sin(yaw)) < 0.5 else (solid[2], solid[0])
        room.collider(name, (x - w / 2, y - d / 2, GROUND_Z), (x + w / 2, y + d / 2, GROUND_Z + solid[1]), parent)
    return obj


def stone_image():
    """Generated grey stone: soft blotches with fine speckles and a few darker grains (assets/textures/outside/stone.png)."""
    if STONE.exists():
        return STONE
    size = 128   # small: its noise barely compresses (outside.glb size budget)
    image = bpy.data.images.new('StoneTexture', size, size)
    rng = random.Random(11)
    waves = [(rng.randint(1, 5), rng.randint(1, 5), rng.uniform(0, 6.3), rng.uniform(0.3, 1.0)) for _ in range(7)]
    pixels = []
    for j in range(size):
        for i in range(size):
            u, v = i / size, j / size
            blotch = sum(a * math.sin(2 * math.pi * (fx * u + fy * v) + p) for fx, fy, p, a in waves) / 7
            grain = rng.random()
            shade = 0.5 + 0.05 * blotch + 0.07 * (grain - 0.5) - (0.12 if grain > 0.97 else 0.0)
            pixels.extend((shade, shade, shade * 1.02, 1.0))
    image.pixels = pixels
    image.filepath_raw = str(STONE)
    image.file_format = 'PNG'
    image.save()
    return STONE


def ico(name, center, scale, mat, parent):
    """A small faceted blob (bush, flower): a once-subdivided icosphere, far lighter than a UV sphere."""
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=1, radius=1.0)
    for v in bm.verts:
        v.co = Vector((v.co.x * scale[0] + center[0], v.co.y * scale[1] + center[1], v.co.z * scale[2] + center[2]))
    return room.finish(name, bm, mat, parent)


def decimate(obj, faces):
    if len(obj.data.polygons) <= faces:
        return
    mod = obj.modifiers.new('Reduce', 'DECIMATE')
    mod.ratio = faces / len(obj.data.polygons)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.modifier_apply(modifier=mod.name)


def join(objects, name):
    bpy.ops.object.select_all(action='DESELECT')
    for obj in objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    if len(objects) > 1:
        bpy.ops.object.join()
    obj = bpy.context.view_layer.objects.active
    obj.name = obj.data.name = name
    return obj


def build_bust(holder, stone_mat):
    """Head and shoulders of the web V4 model in grey stone on a pedestal; the cap keeps its own materials."""
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=str(V4_GLB))
    imported = [obj for obj in bpy.data.objects if obj not in before]
    stone_parts = {'Head', 'Neck', 'Hair', 'HairTuft', 'Beard', 'Moustache', 'Eyebrows', 'Eye_L', 'Eye_R', 'Hoodie'}
    cap_parts = {'CapCrown', 'CapBrim', 'CapButton', 'CapStrap'}
    keep = []
    for obj in imported:
        if obj.type == 'MESH' and obj.name.split('.')[0] in stone_parts | cap_parts:
            obj.data = obj.data.copy()
            obj.data.transform(obj.matrix_world)
            obj.parent = None
            obj.matrix_world = Matrix.Identity(4)
            keep.append(obj)
    for obj in imported:
        if obj not in keep:
            bpy.data.objects.remove(obj, do_unlink=True)
    stone = [obj for obj in keep if obj.name.split('.')[0] in stone_parts]
    cap = [obj for obj in keep if obj.name.split('.')[0] in cap_parts]
    total = sum(len(obj.data.polygons) for obj in stone)
    for obj in stone:
        obj.data.materials.clear()
        obj.data.materials.append(stone_mat)
        if obj.name.startswith('Hoodie'):
            bm = bmesh.new()
            bm.from_mesh(obj.data)
            for co, no in (((0, 0, BUST_CUT_Z), (0, 0, -1)), ((BUST_CUT_X, 0, 0), (1, 0, 0)), ((-BUST_CUT_X, 0, 0), (-1, 0, 0))):
                cut = bmesh.ops.bisect_plane(bm, geom=list(bm.verts) + list(bm.edges) + list(bm.faces), plane_co=co, plane_no=no, clear_outer=True)
                edges = [e for e in cut['geom_cut'] if isinstance(e, bmesh.types.BMEdge)]
                bmesh.ops.holes_fill(bm, edges=edges, sides=0)
            bm.to_mesh(obj.data)
            bm.free()
        decimate(obj, max(60, int(len(obj.data.polygons) * BUST_FACES['stone'] / total)))
    cap_total = sum(len(obj.data.polygons) for obj in cap)
    for obj in cap:
        decimate(obj, max(40, int(len(obj.data.polygons) * BUST_FACES['cap'] / cap_total)))
    bust = join(stone, 'BustStone')
    # One projection from the front: every vertex keeps a single UV, so the export splits no vertices at seams.
    layer = bust.data.uv_layers[0] if bust.data.uv_layers else bust.data.uv_layers.new()
    for loop in bust.data.loops:
        co = bust.data.vertices[loop.vertex_index].co
        layer.data[loop.index].uv = (co.x / 0.3, co.z / 0.3 + co.y * 0.8)   # before the 2.5x scale
    while len(bust.data.uv_layers) > 1:
        bust.data.uv_layers.remove(bust.data.uv_layers[1])
    caps = join(cap, 'BustCap')
    # The cap's materials are plain colours: without UVs the export splits no vertices.
    while caps.data.uv_layers:
        caps.data.uv_layers.remove(caps.data.uv_layers[0])
    for obj in (bust, caps):
        obj.data.transform(Matrix.Translation((0, 0, -BUST_CUT_Z)))
        obj.data.transform(Matrix.Scale(BUST_SCALE, 4))
        obj.data.shade_smooth()   # no sharp edges: split normals would duplicate vertices
        obj.parent = holder
        obj.location = (0, 0, PEDESTAL[1])
    return bust, caps


def build_about(root, frame_mat, glow):
    """The plaza around the signs: a bust on a pedestal, a globe, a glass case with two diplomas and two benches."""
    room.anchor('Floor_About', at(ABOUT), root, BLOCK_YAW, floor='about', size=list(ABOUT_SIZE), targets=list(BUST), gap=PATH_RADIUS)
    stone = room.material('Pedestal', (0.6, 0.59, 0.62), 0.85)
    statue = room.material('Stone', (1, 1, 1), 0.9, image=stone_image())
    group = room.anchor('About', (0, 0, 0), root)
    # Bust on its pedestal; the plaque on the pedestal front is painted by the viewer (Plaque_bust).
    holder = room.anchor('Bust', at(BUST), group, BLOCK_YAW, decor='bust', shadow=[2.2, 2.2],
                         solid=[PEDESTAL[0], PEDESTAL[1] + BUST_HEIGHT, PEDESTAL[0]])
    w = PEDESTAL[0] / 2
    room.box('BustPedestal', (-w, -w, 0), (w, w, PEDESTAL[1]), stone, holder)
    room.box('BustPedestalTop', (-w - 0.05, -w - 0.05, PEDESTAL[1] - 0.06), (w + 0.05, w + 0.05, PEDESTAL[1]), stone, holder)
    room.box('BustPedestalFoot', (-w - 0.06, -w - 0.06, 0), (w + 0.06, w + 0.06, 0.08), stone, holder)
    build_bust(holder, statue)
    x, y, _ = at(BUST)
    room.collider('Bust', (x - w - 0.06, y - w - 0.06, GROUND_Z), (x + w + 0.06, y + w + 0.06, GROUND_Z + PEDESTAL[1] + BUST_HEIGHT), group)
    room.anchor('Plaque_bust', at((BUST[0], BUST[1] + w + 0.002), 0.5), group, BLOCK_YAW, plaque=[1.1, 0.56], text='bust')
    # Globe: the stand here, the sphere and the pin on Colombia drawn by the viewer (it paints the continents).
    globe = room.anchor('Globe', at(GLOBE), group, BLOCK_YAW, radius=GLOBE_RADIUS, centre=GLOBE_HEIGHT,
                        decor='globe', shadow=[1.0, 1.0], solid=[0.6, GLOBE_HEIGHT + GLOBE_RADIUS, 0.6])
    room.cylinder('GlobeFoot', (0, 0, 0.04), 0.3, 0.08, frame_mat, globe, segments=20)
    room.cylinder('GlobeStem', (0, 0, (GLOBE_HEIGHT - GLOBE_RADIUS) / 2 + 0.04), 0.035, GLOBE_HEIGHT - GLOBE_RADIUS, frame_mat, globe, segments=10)
    room.cylinder('GlobeMeridian', (0, 0, GLOBE_HEIGHT), GLOBE_RADIUS + 0.05, 0.03, glow, globe, segments=32, axis='Y')
    room.anchor('Plaque_globe', at((GLOBE[0], GLOBE[1] + 0.302), 0.12), group, BLOCK_YAW, plaque=[0.56, 0.16], text='globe')
    x, y, _ = at(GLOBE)
    room.collider('Globe', (x - 0.3, y - 0.3, GROUND_Z), (x + 0.3, y + 0.3, GROUND_Z + GLOBE_HEIGHT + GLOBE_RADIUS), group)
    # Planters with low bushes and flowers, and two park lamps, like a small park round the bust.
    soil = room.material('Soil', (0.24, 0.17, 0.12), 0.95)
    leaves = room.material('Bush', (0.07, 0.27, 0.13), 0.85)
    bloom = room.material('Flower', (0.95, 0.55, 0.75), 0.6)
    l, d, h = PLANTER_SIZE
    for index, point in enumerate(PLANTERS):
        bed = room.anchor(f'Planter_{index}', at(point), group, BLOCK_YAW, decor='planter', shadow=[l + 0.4, d + 0.4], solid=[l, h, d])
        room.box(f'Planter_{index}_Box', (-l / 2, -d / 2, 0), (l / 2, d / 2, h), stone, bed)
        room.box(f'Planter_{index}_Soil', (-l / 2 + 0.06, -d / 2 + 0.06, h - 0.04), (l / 2 - 0.06, d / 2 - 0.06, h - 0.01), soil, bed)
        for k in range(4):
            ico(f'Planter_{index}_Bush{k}', ((k - 1.5) * 0.52, 0, h + 0.12), (0.26, 0.24, 0.2), leaves, bed)
            ico(f'Planter_{index}_Flower{k}', ((k - 1.5) * 0.52 + 0.12, -0.12, h + 0.3), (0.06, 0.06, 0.06), bloom, bed)
        x, y, _ = at(point)
        room.collider(f'Planter_{index}', (x - l / 2, y - d / 2, GROUND_Z), (x + l / 2, y + d / 2, GROUND_Z + h), group)
    lamp_glow = room.material('ParkLampGlass', (1.0, 0.9, 0.72), 0.3, emission=(1.0, 0.82, 0.6), strength=3.5)
    for index, point in enumerate(PARK_LAMPS):
        post = room.anchor(f'ParkLamp_{index}', at(point), group, BLOCK_YAW, decor='lamp', shadow=[0.6, 0.6], solid=[0.2, 2.6, 0.2])
        room.cylinder(f'ParkLamp_{index}_Foot', (0, 0, 0.06), 0.14, 0.12, frame_mat, post, segments=12)
        room.cylinder(f'ParkLamp_{index}_Pole', (0, 0, 1.25), 0.04, 2.3, frame_mat, post, segments=10)
        room.cylinder(f'ParkLamp_{index}_Glass', (0, 0, 2.5), 0.13, 0.28, lamp_glow, post, top=0.16, segments=12)
        room.cylinder(f'ParkLamp_{index}_Cap', (0, 0, 2.67), 0.2, 0.07, frame_mat, post, top=0.04, segments=12)
        x, y, _ = at(point)
        room.collider(f'ParkLamp_{index}', (x - 0.12, y - 0.12, GROUND_Z), (x + 0.12, y + 0.12, GROUND_Z + 2.7), group)


def build_decor(root, frame_mat):
    """Park, forest and benches (fixed), and cardboard boxes and cones the character can knock about."""
    group = room.anchor('Decor', (0, 0, 0), root)
    trunk = room.material('Trunk', (0.33, 0.22, 0.16), 0.85)
    leaves = room.material('Leaves', (0.06, 0.24, 0.12), 0.85)
    trees = [tree_mesh(f'Decor_Tree{variant}', variant, trunk, leaves) for variant in (0, 1)]
    rng = random.Random(21)
    for index, (x, z, variant) in enumerate(TREES):
        decor(f'Tree_{index:02d}', trees[variant], (x, z), rng.uniform(0, math.tau), group, 'tree', (1.9, 1.9), (0.36, 1.2, 0.36))
    rock = room.material('Rock', (0.42, 0.41, 0.47), 0.9)
    for index, (x, z, size) in enumerate(ROCKS):
        obj = decor(f'Rock_{index}', rock_mesh(f'Decor_Rock{index}', index, rock), (x, z), rng.uniform(0, math.tau), group, 'rock',
                    (1.3 * size, 1.1 * size), (1.0 * size, 0.5 * size, 0.85 * size))
        obj.scale = (size, size, size)
    wood = room.material('BenchWood', (0.55, 0.37, 0.24), 0.75)
    bench = bench_mesh(wood, frame_mat)
    for index, (point, yaw) in enumerate(BENCHES):
        decor(f'Bench_{index}', bench, point, yaw, group, 'bench', (1.6, 0.6), (1.4, 0.5, 0.4))
    # Loose: crates and cones, pushed, punched and kicked like the bricks.
    loose = room.anchor('Clutter', (0, 0, 0), root)
    card = room.material('Cardboard', (0.66, 0.49, 0.31), 0.85)
    body = box_body_mesh(card, room.material('CardboardInside', (0.42, 0.3, 0.19), 0.9), room.material('Tape', (0.86, 0.74, 0.52), 0.45))
    flap = box_flap_mesh(card)
    for index, (x, z, layer) in enumerate(CRATES):
        cardboard_box(f'Crate_{index}', body, flap, (x, z), BOX_SIZE / 2 + layer * (BOX_SIZE + 2 * FLAP_T + 0.002), loose)   # resting on the closed flaps below
    cone = cone_mesh(room.material('Cone', (0.95, 0.42, 0.12), 0.6), room.material('ConeBand', (0.95, 0.95, 0.95), 0.5))
    cylinders = [round(value, 4) for radius, height, centre in CONE_CYLINDERS for value in (radius, height, centre - CONE_ORIGIN)]
    for index, (x, z) in enumerate(CONES):
        piece(f'Cone_{index}', cone, (x, z), CONE_ORIGIN, BLOCK_YAW, loose, prop='cone', group='decor', mass=MASS['cone'],
              cylinders=cylinders, box=[0.36, 0.54, 0.36])


def ring_meshes(mats):
    """One disc per target ring facing Blender -Y (three.js +Z), shared by the three targets."""
    meshes = []
    for index, ((radius, _), mat) in enumerate(zip(TARGET_RINGS, mats)):
        bm = bmesh.new()
        disc = bmesh.ops.create_cone(bm, cap_ends=True, segments=28, radius1=radius, radius2=radius, depth=0.05)
        for v in disc['verts']:
            v.co = Matrix.Rotation(math.pi / 2, 3, 'X') @ v.co + Vector((0, -0.025 - index * 0.006, 0))
        meshes.append(proto_mesh(f'Target_Ring{index}', bm, [mat], smooth_angle=40))
    return meshes


def target_disc(name, rings, parent, centre):
    """Concentric rings, the inner ones standing a little proud of the outer."""
    for index, mesh in enumerate(rings):
        obj = bpy.data.objects.new(f'{name}_Ring{index}', mesh)
        bpy.context.collection.objects.link(obj)
        obj.parent = parent
        obj.location = (0, 0, centre)


def build_targets(root, frame_mat):
    """Three standing targets past a throw line, a scoreboard and the lane painted on the ground."""
    lane_z = THROW_LINE_Z - 1.6
    room.anchor('Floor_Targets', at((TARGET_LANE_X, lane_z)), root, BLOCK_YAW, floor='targets', size=[3.6, 6.4],
                line=THROW_LINE_Z - lane_z)
    group = room.anchor('Targets', (0, 0, 0), root)
    wood = room.material('TargetPost', (0.45, 0.32, 0.22), 0.8)
    colors = [room.material('TargetWhite', (0.94, 0.93, 0.96), 0.5), room.material('TargetRed', (0.82, 0.16, 0.22), 0.45),
              room.material('TargetGold', (1.0, 0.74, 0.22), 0.35, emission=(1.0, 0.6, 0.15), strength=0.4)]
    rings = ring_meshes(colors)
    for index, (x, distance, centre) in enumerate(TARGETS):
        radius = TARGET_RINGS[0][0]
        holder = room.anchor(f'Target_{index}', at((x, THROW_LINE_Z - distance)), group, BLOCK_YAW, target=index,
                             radius=radius, centre=centre, rings=[r for r, _ in TARGET_RINGS], points=[p for _, p in TARGET_RINGS])
        room.box(f'Target_{index}_Post', (-0.05, 0.0, 0.0), (0.05, 0.1, centre), wood, holder)
        room.box(f'Target_{index}_Foot', (-0.35, -0.05, 0.0), (0.35, 0.2, 0.06), wood, holder)
        target_disc(f'Target_{index}', rings, holder, centre)
        px, py, _ = at((x, THROW_LINE_Z - distance))
        room.collider(f'Target_{index}', (px - radius, py - 0.06, GROUND_Z), (px + radius, py + 0.22, GROUND_Z + centre + radius), root)
    w, h, bottom = SCOREBOARD_SIZE
    board = room.anchor('Scoreboard', at(SCOREBOARD), root, BLOCK_YAW, board=[w, h, bottom], decor='scoreboard', shadow=[1.8, 0.5],
                        solid=[w + 0.16, bottom + h, 0.12])
    for side in (-1, 1):
        room.box(f'ScorePost_{side}', (side * w / 2 - 0.04, -0.04, 0), (side * w / 2 + 0.04, 0.04, bottom + h + 0.05), frame_mat, board)
    room.box('ScoreBoard', (-w / 2, -0.03, bottom), (w / 2, 0.03, bottom + h), frame_mat, board)
    x, y, _ = at(SCOREBOARD)
    room.collider('Scoreboard', (x - w / 2 - 0.08, y - 0.06, GROUND_Z), (x + w / 2 + 0.08, y + 0.06, GROUND_Z + bottom + h), root)
    room.anchor('Zone_Targets', at((TARGET_LANE_X - 3.0, THROW_LINE_Z)), root, BLOCK_YAW, zone='reset', target='targets', area=RESET_AREA)


def tech_cube_mesh(name, cell, atlas_mat):
    """One tower cube with its logo cell of the atlas on the +Z and +X faces (three.js), plain brand colour elsewhere."""
    bm = bmesh.new()
    uv = bm.loops.layers.uv.new('UVMap')
    bmesh.ops.create_cube(bm, size=TECH_CUBE)
    bmesh.ops.bevel(bm, geom=list(bm.edges), offset=0.02, segments=1, affect='EDGES')
    rows = math.ceil(sum(len(row) for row in TECH_ROWS) / TECH_ATLAS_COLUMNS)
    cu, cv = 1 / TECH_ATLAS_COLUMNS, 1 / rows
    u0, v0 = (cell % TECH_ATLAS_COLUMNS) * cu, 1 - (cell // TECH_ATLAS_COLUMNS + 1) * cv
    h = TECH_CUBE / 2
    for face in bm.faces:
        n = face.normal
        for loop in face.loops:
            co = loop.vert.co
            if n.y < -0.9:      # three.js +Z: the front
                loop[uv].uv = (u0 + cu * (co.x + h) / TECH_CUBE, v0 + cv * (co.z + h) / TECH_CUBE)
            elif n.x > 0.9:     # three.js +X: the right side
                loop[uv].uv = (u0 + cu * (co.y + h) / TECH_CUBE, v0 + cv * (co.z + h) / TECH_CUBE)
            else:               # a corner of the cell: only its background colour
                loop[uv].uv = (u0 + cu * 0.03, v0 + cv * 0.03)
    return proto_mesh(name, bm, [atlas_mat], smooth_angle=40)


def build_tech(root):
    """Tower of cubes with the logos of the tools this project is made with, knocked down like the bricks."""
    room.anchor('Floor_Tech', at((TECH[0], TECH[1] + 1.4)), root, BLOCK_YAW, floor='tech', size=[4.2, 3.6])
    atlas = room.material('TechAtlas', (1, 1, 1), 0.55, image=TECH_ATLAS)
    group = room.anchor('Tech', (0, 0, 0), root)
    pitch = TECH_CUBE + TECH_GAP
    cell = 0
    for layer, row in enumerate(TECH_ROWS):
        for i, name in enumerate(row):
            x = TECH[0] + (i - (len(row) - 1) / 2) * pitch
            piece(f'Tech_{cell:02d}_{name}', tech_cube_mesh(f'Prop_Tech_{name}', cell, atlas), (x, TECH[1]),
                  TECH_CUBE / 2 + layer * (TECH_CUBE + 0.001), BLOCK_YAW, group, prop='tech', group='tech', mass=MASS['tech'],
                  box=[TECH_CUBE] * 3, tech=name)
            cell += 1
    room.anchor('Zone_Tech', at((TECH[0], TECH[1] + 4.2)), root, BLOCK_YAW, zone='reset', target='tech', area=RESET_AREA)


def build_crossroads_green(root):
    """A round bed of grass at the crossroads, a hand high, with low bushes and a few flowers round the lamppost."""
    grass = room.material('CrossroadsGrass', (0.05, 0.2, 0.09), 0.95)
    edge = room.material('CrossroadsEdge', (0.04, 0.15, 0.07), 0.95)
    bush = room.material('CrossroadsBush', (0.07, 0.27, 0.13), 0.85)
    bloom = room.material('CrossroadsFlower', (0.95, 0.55, 0.75), 0.6)
    green = room.anchor('CrossroadsGreen', at(CROSSROADS), root, BLOCK_YAW)
    room.cylinder('CrossroadsGreen_Edge', (0, 0, 0.03), CROSSROADS_GREEN, 0.06, edge, green, segments=40)
    room.cylinder('CrossroadsGreen_Grass', (0, 0, 0.07), CROSSROADS_GREEN - 0.15, 0.04, grass, green, segments=40)
    # One shared bush and one shared flower mesh, placed and scaled per plant (the GLB keeps one copy of each).
    shapes = {}
    for name, mat in (('Bush', bush), ('Flower', bloom)):
        bm = bmesh.new()
        bmesh.ops.create_icosphere(bm, subdivisions=1, radius=1.0)
        shapes[name] = proto_mesh(f'Crossroads{name}', bm, [mat])
    rng = random.Random(31)
    for k in range(9):
        angle = k / 9 * math.tau + rng.uniform(-0.2, 0.2)
        r = rng.uniform(1.2, CROSSROADS_GREEN - 0.6)
        x, y = math.cos(angle) * r, math.sin(angle) * r
        size = rng.uniform(0.28, 0.42)
        plants = [('Bush', (x, y, 0.09 + size * 0.6), (size, size, size * 0.8))]
        if k % 2 == 0:
            plants.append(('Flower', (x + 0.15, y - 0.1, 0.09 + size * 1.3), (0.06, 0.06, 0.06)))
        for kind, location, scale in plants:
            obj = bpy.data.objects.new(f'CrossroadsGreen_{kind}{k}', shapes[kind])
            bpy.context.collection.objects.link(obj)
            obj.parent = green
            obj.location = location
            obj.scale = scale


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
    build_crossroads_green(root)
    # The character may walk behind the room: the viewer opens a window in the walls around it there.
    build_letters(root)
    build_playground(root)
    build_about(root, frame, glow)
    build_decor(root, frame)
    build_targets(root, frame)
    build_tech(root)
    room.anchor('Floor_PlayArea', at(PLAY_AREA), root, BLOCK_YAW, floor='playarea', size=list(PLAY_AREA_SIZE))
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
    if not TECH_ATLAS.exists():
        raise RuntimeError(f'Missing {TECH_ATLAS}: run node scripts/tech_atlas.ts first.')
    if not V4_GLB.exists():
        raise RuntimeError(f'Missing {V4_GLB}: export the V4 model first (export_assets.py --variant v4).')
    for sign in SIGNS.values():
        if not (TEXTURES / sign['image']).exists():
            raise RuntimeError(f'Missing {TEXTURES / sign["image"]}: run node scripts/capture_sites.ts first.')
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.scene.unit_settings.system = 'METRIC'
    root = bpy.data.objects.new('Outside', None)
    bpy.context.collection.objects.link(root)
    root['stage'] = '12-about-playground-decor'
    build(root)
    BLEND.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=str(BLEND), compress=True)
    export_glb(root)


if __name__ == '__main__':
    main()
