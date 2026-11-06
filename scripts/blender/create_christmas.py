"""The Christmas dress-up of the room page (src/core/christmas.ts): everything only shown from 1 December to 5 January or
with ?navidad=1. Builds assets/blender/christmas.blend and public/models/christmas.glb, which the viewer loads with the
outside only while the dress-up is on. Everything is modelled here; the bowling ball's print is painted into
assets/textures/christmas/ornament.png by this script.

- `ChristmasWorld`: read with the outside like circuit.glb.
  - Loose pieces of group 'christmas' (extras `prop`, `group`, `mass`, `box` and `radius` for spheres): snowmen of three
    snowballs each (`prop` 'snowman', the balls of one snowman share a `joint` and carry `part` 0 base, 1 body, 2 head;
    the physics holds them together until a knock), and the gifts piled round the giant tree (`prop` 'gift', white: the
    viewer tints each one).
  - Fixed: decorated pines (decor `pine`), the giant Christmas tree (decor `xmastree`, a shout landmark), the gift
    countdown sign (`CountdownBoard`, decor 'countdown', `board` [w, h, bottom]: the face the viewer paints the days to
    Christmas on), garlands, wreaths, bows and
    stockings in the room and outside (plain meshes, merged with the outside), `Floor_ChristmasTree` (floor
    'xmastree') and `Zone_Christmas` (reset zone, target 'christmas').
- `ChristmasLights`: one empty per string of bulbs (`bulbs` [x, y, z, …] in the empty's own axes, three.js y up after
  export as Blender's z, `bulb` radius): the viewer draws every bulb of every string as one instanced, blinking mesh.
- `ChristmasHat`: a Santa hat modelled over the web V4 head without its cap, in the character's own frame (feet at Z=0,
  facing -Y). `ChristmasHat_Pompom` is the white bobble with its origin at the hat's tip: the viewer swings it.
- `ChristmasSleigh`: the ride that replaces the office chair, after the user's reference: a red body with a low rolled
  front, a gold rim, gold scrolls and swirls, a high back curling into a scroll, a green tufted seat, a pile of wrapped
  gifts on its back (`SleighGifts`; `SleighSack_Mouth` on its top is where the falling gifts leave from), dark red
  runners curling up just ahead of the body (short in front, so its block in the viewer matches it), and a snow
  thruster on each side pointing backwards (`SleighNozzle_<side>` at its mouth, `SleighFuel_<side>` the icy blue charge
  in its window, origin at the window's front end and turned so its local height runs backwards along the thruster:
  the viewer scales it), `SleighGrip_<side>` where the hands rest. Its origin is on the ground under the rider's hips,
  facing -Y (three.js +Z).
- `ChristmasLibrary`: meshes the viewer uses as they are: the bowling pin in red with a green ribbon
  (`Christmas_Pin`), the ball in red with little vector drawings (`Christmas_Ball`), each with the same size as the
  piece it dresses; the thrown snowball (`Snowball`), a lump of snow (`SnowChunk`) and the gifts that fall off the sleigh
  (`Gift_0..2`, white: the viewer tints each one).

Run: blender --background --factory-startup --python-exit-code 1 --python scripts/blender/create_christmas.py [-- --replace-generated] [--render]
"""
import argparse
import math
import random
import sys
from pathlib import Path

import bmesh
import bpy
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree

sys.path.insert(0, str(Path(__file__).resolve().parent))
import create_room as room
from create_outside import (BALL_RADIUS, BLOCK_YAW, BOARD_BOTTOM, BOARD_H, BOARD_W, BOXING, CROSSROADS, GROUND_Z, LAMP_HEIGHT,
                            LAMP_POLE, PARK_LAMPS, PIN_ORIGIN, PIN_PROFILE, RESET_AREA, SIGN_FIRST_X, SIGN_SPACING, SIGN_Y, at,
                            decor, piece, proto_mesh)

ROOT = Path(__file__).resolve().parents[2]
BLEND = ROOT / 'assets' / 'blender' / 'christmas.blend'
GLB = ROOT / 'public' / 'models' / 'christmas.glb'
TEXTURES = ROOT / 'assets' / 'textures' / 'christmas'
CHARACTER = ROOT / 'public' / 'models' / 'developer-v4-interactions.glb'
RENDERS = ROOT / 'assets' / 'renders' / 'christmas'

ROOM_FLOOR = -GROUND_Z            # the room floor over the outside ground
XMAS = (44.5, -4.5)               # the giant tree, on the lawn east of the about-me plaza
XMAS_TREE = {'height': 8.6, 'radius': 3.0, 'tiers': 6}
COUNTDOWN = (16.0, 2.5)          # the big countdown sign, east of the start on the way to the plaza
# Snowmen (three.js x, z, yaw): beside the room, by the crossroads, in the plaza, in the playground, in the park and by
# the giant tree. Balls: radius of the base, body and head.
SNOWMEN = [(3.4, 8.6, 0.3), (14.2, 9.4, -0.2), (38.2, 0.4, 0.5), (13.4, 27.4, 0.1), (-9.0, 18.6, -0.4), (48.2, -2.4, -0.6)]
SNOW_BALLS = [0.42, 0.31, 0.22]
SNOW_MASS = [24.0, 12.0, 5.0]
# Decorated pines: three.js x, z, height. The first stands in the room's back right corner.
PINES = [(2.35, -2.35, 1.75), (0.0, 8.4, 2.6), (6.0, 8.6, 2.6), (20.3, 9.8, 2.6), (40.0, 10.2, 2.6), (-18.4, 13.0, 2.6)]
# Gifts round the giant tree (angle round it, distance, size index, yaw) and their sizes (w, h, d).
TREE_GIFT_SIZES = [(0.55, 0.42, 0.5), (0.75, 0.55, 0.7), (0.95, 0.7, 0.85)]
TREE_GIFTS = [(0.2, 3.5, 2, 0.1), (0.75, 3.4, 0, 0.5), (1.2, 3.6, 1, -0.2), (1.9, 3.5, 0, 0.3), (2.4, 3.6, 2, -0.4),
              (3.0, 3.4, 1, 0.2), (3.7, 3.5, 0, -0.1), (4.3, 3.6, 1, 0.6), (5.0, 3.4, 2, 0.0), (5.6, 3.5, 0, -0.5),
              (0.5, 4.2, 0, 0.2), (2.1, 4.3, 0, -0.3), (4.6, 4.2, 0, 0.4)]
# The gifts that fall off the sleigh: (w, h, d).
DROP_GIFT_SIZES = [(0.26, 0.26, 0.26), (0.34, 0.22, 0.28), (0.22, 0.32, 0.22)]
SNOWBALL_RADIUS = 0.11
# The sleigh in its own frame (Blender: x across, -y ahead, z up; origin on the ground under the rider's hips).
SLEIGH = {'width': 1.16, 'side': 0.86, 'seat': 0.6}  # body width, where the hands rest, seat top
# The two snow thrusters: how far out of the middle, their front end, height of their axis, length and radius.
THRUSTER = {'out': 0.78, 'front': -0.2, 'height': 0.46, 'length': 1.05, 'radius': 0.13}


def three(x, y, z):
    """three.js world point (y over the outside ground, x, z on the ground) to a Blender location."""
    return Vector((x, -z, GROUND_Z + y))


def mesh_object(name, mesh, parent, location=(0, 0, 0)):
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    obj.parent = parent
    obj.location = location
    return obj


def lathe(bm, profile, segments, material=0):
    """Turn (height, radius) round Blender Z."""
    rings = []
    for height, radius in profile:
        if radius < 1e-6:
            rings.append([bm.verts.new((0, 0, height))])
            continue
        rings.append([bm.verts.new((math.sin(k / segments * math.tau) * radius, -math.cos(k / segments * math.tau) * radius, height))
                      for k in range(segments)])
    faces = []
    for a, b in zip(rings, rings[1:]):
        for k in range(segments):
            n = (k + 1) % segments
            if len(a) == 1:
                faces.append(bm.faces.new((a[0], b[k], b[n])))
            elif len(b) == 1:
                faces.append(bm.faces.new((a[k], b[0], a[n])))
            else:
                faces.append(bm.faces.new((a[k], b[k], b[n], a[n])))
    for face in faces:
        face.material_index = material
    bmesh.ops.recalc_face_normals(bm, faces=faces)
    return rings


def sphere(bm, centre, radius, material=0, subdivisions=2, squash=(1, 1, 1), rng=None, wobble=0.0):
    out = bmesh.ops.create_icosphere(bm, subdivisions=subdivisions, radius=radius)
    for v in out['verts']:
        d = v.co.copy()
        if rng and wobble:
            d *= 1 + rng.uniform(-wobble, wobble)
        v.co = Vector((d.x * squash[0], d.y * squash[1], d.z * squash[2])) + Vector(centre)
    for face in {f for v in out['verts'] for f in v.link_faces}:
        face.material_index = material
    return out['verts']


def box(bm, lo, hi, material=0):
    geom = bmesh.ops.create_cube(bm, size=1.0)
    for v in geom['verts']:
        v.co = Vector(((v.co.x + 0.5) * (hi[0] - lo[0]) + lo[0], (v.co.y + 0.5) * (hi[1] - lo[1]) + lo[1], (v.co.z + 0.5) * (hi[2] - lo[2]) + lo[2]))
    for face in {f for v in geom['verts'] for f in v.link_faces}:
        face.material_index = material
    return geom['verts']


def tube(bm, points, radius, material=0, sides=6, closed=False):
    """A round tube along a polyline (`radius` a number or one per point)."""
    radii = radius if isinstance(radius, (list, tuple)) else [radius] * len(points)
    rings = []
    count = len(points)
    for i, p in enumerate(points):
        a = points[max(i - 1, 0)] if not closed else points[(i - 1) % count]
        b = points[min(i + 1, count - 1)] if not closed else points[(i + 1) % count]
        tangent = (Vector(b) - Vector(a)).normalized()
        side = tangent.cross(Vector((0, 0, 1)))
        if side.length < 1e-4:
            side = tangent.cross(Vector((1, 0, 0)))
        side.normalize()
        up = side.cross(tangent).normalized()
        rings.append([bm.verts.new(Vector(p) + (side * math.cos(k / sides * math.tau) + up * math.sin(k / sides * math.tau)) * radii[i])
                      for k in range(sides)])
    pairs = list(zip(rings, rings[1:] + ([rings[0]] if closed else [])))
    for a, b in pairs:
        for k in range(sides):
            n = (k + 1) % sides
            bm.faces.new((a[k], a[n], b[n], b[k])).material_index = material
    if not closed:
        for ring, flip in ((rings[0], True), (rings[-1], False)):
            face = bm.faces.new(list(reversed(ring)) if flip else ring)
            face.material_index = material
    return rings


def swag(a, b, sag, steps=12):
    """Points of a garland hanging between a and b, sagging `sag` in the middle."""
    a, b = Vector(a), Vector(b)
    return [a.lerp(b, t) - Vector((0, 0, sag * 4 * t * (1 - t))) for t in (k / steps for k in range(steps + 1))]


def finish(name, bm, mats, smooth=None):
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return proto_mesh(name, bm, mats, smooth)


# ------------------------------------------------------------------ materials

def materials():
    m = room.material
    return {
        'red': m('XmasRed', (0.62, 0.02, 0.04), 0.45),
        'green': m('XmasGreen', (0.02, 0.32, 0.09), 0.5),
        'gold': m('XmasGold', (0.95, 0.66, 0.16), 0.3, 0.85),
        'white': m('XmasWhite', (0.92, 0.94, 0.97), 0.85),
        'fur': m('XmasFur', (0.96, 0.96, 0.98), 0.95),
        'snow': m('SnowmanSnow', (0.9, 0.93, 0.98), 0.85),
        'coal': m('SnowmanCoal', (0.03, 0.03, 0.035), 0.7),
        'carrot': m('SnowmanCarrot', (0.95, 0.38, 0.05), 0.55),
        'twig': m('SnowmanTwig', (0.24, 0.15, 0.08), 0.85),
        'scarf': m('SnowmanScarf', (0.75, 0.05, 0.07), 0.7),
        'needles': m('PineNeedles', (0.03, 0.26, 0.11), 0.8),
        'needlesLight': m('PineNeedlesLight', (0.06, 0.36, 0.15), 0.8),
        'bark': m('PineBark', (0.22, 0.13, 0.07), 0.85),
        'pot': m('PinePot', (0.5, 0.06, 0.08), 0.55),
        'baubleRed': m('BaubleRed', (0.8, 0.03, 0.05), 0.2, 0.4),
        'baubleGold': m('BaubleGold', (0.95, 0.68, 0.18), 0.2, 0.8),
        'baubleBlue': m('BaubleBlue', (0.12, 0.35, 0.9), 0.2, 0.4),
        'baubleSilver': m('BaubleSilver', (0.82, 0.84, 0.9), 0.2, 0.9),
        'star': m('XmasStar', (1.0, 0.82, 0.25), 0.3, 0.3, emission=(1.0, 0.78, 0.25), strength=3.0),
        'garland': m('GarlandNeedles', (0.03, 0.3, 0.1), 0.85),
        'ribbon': m('XmasRibbon', (0.95, 0.72, 0.2), 0.35, 0.6),
        'giftWhite': m('GiftWhite', (1.0, 1.0, 1.0), 0.55),
        'sleighRed': m('SleighRed', (0.66, 0.03, 0.05), 0.3, 0.15),
        'sleighDark': m('SleighDark', (0.18, 0.02, 0.03), 0.5),
        'seat': m('SleighSeat', (0.03, 0.34, 0.09), 0.85),
        'metal': m('ThrusterMetal', (0.55, 0.58, 0.64), 0.25, 0.9),
        'glow': m('ThrusterGlow', (0.55, 0.85, 1.0), 0.2, emission=(0.45, 0.8, 1.0), strength=4.0),
        'fuel': m('ThrusterFuel', (0.7, 0.92, 1.0), 0.1, emission=(0.4, 0.75, 1.0), strength=1.5),
        'glass': m('ThrusterGlass', (0.85, 0.95, 1.0), 0.05, alpha=0.3),
        'hat': m('SantaHatRed', (0.7, 0.02, 0.04), 0.75),
        'stocking': m('StockingRed', (0.66, 0.03, 0.05), 0.85),
        'stockingGreen': m('StockingGreen', (0.03, 0.34, 0.1), 0.85),
        'board': m('CountdownWood', (0.5, 0.03, 0.05), 0.6),
        'boardFace': m('CountdownFace', (0.05, 0.12, 0.08), 0.8),
        'plinth': m('XmasPlinth', (0.25, 0.1, 0.06), 0.8),
    }


# ------------------------------------------------------------------ the bowling pieces (same sizes as the originals)

def christmas_pin(m, segments=24):
    """The pin turned like create_outside's: red, with a green ribbon round the neck edged in gold."""
    bm = bmesh.new()
    lathe(bm, [(h - PIN_ORIGIN, r) for h, r in PIN_PROFILE], segments)
    for face in bm.faces:
        h = face.calc_center_median().z + PIN_ORIGIN
        face.material_index = 1 if 0.395 <= h <= 0.465 else 2 if 0.38 <= h <= 0.48 else 0
    # A small bow on the ribbon's front.
    for side in (-1, 1):
        sphere(bm, (side * 0.026, -0.055, 0.43 - PIN_ORIGIN), 0.022, 1, 1, squash=(1.3, 0.55, 0.8))
    sphere(bm, (0, -0.06, 0.43 - PIN_ORIGIN), 0.012, 1, 1)
    return finish('Christmas_Pin', bm, [m['red'], m['green'], m['gold']], 60)


def ornament_image():
    """The ball's print: Christmas red with small white and gold vector drawings (snowflakes, stars, holly, little trees),
    painted longitude by latitude so they keep their shape on the sphere."""
    path = TEXTURES / 'ornament.png'
    if path.exists():
        return path
    TEXTURES.mkdir(parents=True, exist_ok=True)
    w, h = 384, 192
    base = (0.66, 0.03, 0.05)
    rng = random.Random(25)
    motifs = []
    for row, lat in enumerate((-0.45, -0.15, 0.15, 0.45)):
        count = 6 if abs(lat) < 0.3 else 5
        for k in range(count):
            lon = (k + (row % 2) * 0.5) / count
            motifs.append((lon, lat, ['flake', 'star', 'holly', 'tree'][(k + row) % 4], rng.uniform(0, 1)))
    pixels = [0.0] * (w * h * 4)

    def shade(kind, x, y, turn):
        """Coverage and colour of a motif at local (x, y) in units of its size (-1…1)."""
        r = math.hypot(x, y)
        a = math.atan2(y, x) + turn
        if kind == 'flake':
            arm = abs(math.sin(3 * a))
            line = r < 0.95 and arm * r < 0.09
            tick = 0.45 < r < 0.75 and abs(math.sin(3 * a)) * r < 0.24 and abs(r - 0.6) < 0.06
            return (line or tick or r < 0.14), (0.98, 0.98, 1.0)
        if kind == 'star':
            spike = 0.5 + 0.5 * math.cos(5 * a)
            return r < 0.42 + 0.5 * spike ** 3, (1.0, 0.8, 0.25)
        if kind == 'holly':
            leaf = any(((x - cx) / 0.62) ** 2 + ((y - cy) / 0.28) ** 2 < 1 for cx, cy in ((-0.42, 0.25), (0.42, 0.25)))
            berry = any(math.hypot(x - bx, y - by) < 0.19 for bx, by in ((-0.12, -0.18), (0.14, -0.2), (0.0, 0.05)))
            if berry:
                return True, (1.0, 0.95, 0.95)
            return leaf, (0.1, 0.55, 0.25)
        tri = -0.9 < y < 0.8 and abs(x) < (0.8 - y) * 0.55
        trunk = -1.0 < y <= -0.9 and abs(x) < 0.12
        return tri or trunk, (0.2, 0.7, 0.35)

    for j in range(h):
        lat = (j + 0.5) / h - 0.5        # -0.5 bottom … 0.5 top
        stretch = max(math.cos(lat * math.pi), 0.2)
        for i in range(w):
            lon = (i + 0.5) / w
            colour = base
            for mlon, mlat, kind, turn in motifs:
                du = ((lon - mlon + 0.5) % 1.0 - 0.5) * stretch * 2 * math.pi
                dv = (lat - mlat) * math.pi
                size = 0.17
                if abs(du) > size * 1.2 or abs(dv) > size * 1.2:
                    continue
                hit, tone = shade(kind, du / size, dv / size, turn)
                if hit:
                    colour = tone
                    break
            k = (j * w + i) * 4
            pixels[k:k + 4] = [*colour, 1.0]
    image = bpy.data.images.new('ChristmasOrnament', w, h)
    image.pixels = pixels
    image.filepath_raw = str(path)
    image.file_format = 'PNG'
    image.save()
    bpy.data.images.remove(image)
    return path


def christmas_ball(m):
    mat = room.material('ChristmasBallPrint', (1, 1, 1), 0.25, image=ornament_image())
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=28, v_segments=16, radius=BALL_RADIUS)
    layer = bm.loops.layers.uv.verify()
    for face in bm.faces:
        us = []
        for loop in face.loops:
            co = loop.vert.co if loop.vert.co.xy.length > 1e-6 else face.calc_center_median()
            us.append(math.atan2(co.x, -co.y) / math.tau + 0.5)
        if max(us) - min(us) > 0.5:
            us = [u + 1 if u < 0.5 else u for u in us]
        for loop, u in zip(face.loops, us):
            v = math.asin(max(-1.0, min(1.0, loop.vert.co.z / BALL_RADIUS))) / math.pi + 0.5
            loop[layer].uv = (u, v)
    return finish('Christmas_Ball', bm, [mat], 50)


# ------------------------------------------------------------------ snowmen, gifts, snowballs

def snowman_meshes(m):
    """The three balls of a snowman, each with its own decorations, origin at the ball's centre."""
    rng = random.Random(4)
    base, body, head = SNOW_BALLS
    meshes = []
    bm = bmesh.new()
    sphere(bm, (0, 0, 0), base, 0, 3, rng=rng, wobble=0.025)
    meshes.append(finish('Snowman_Base', bm, [m['snow']], 50))
    bm = bmesh.new()
    sphere(bm, (0, 0, 0), body, 0, 3, rng=rng, wobble=0.025)
    for k, z in enumerate((0.12, -0.02, -0.15)):
        y = -math.sqrt(max(body ** 2 - z ** 2, 0)) - 0.005
        sphere(bm, (0, y, z), 0.035, 1, 1)
    # A scarf round the top of the body and its tail hanging down the front.
    ring = [Vector((math.sin(a) * body * 0.82, -math.cos(a) * body * 0.82, body * 0.58)) for a in (k / 16 * math.tau for k in range(16))]
    tube(bm, ring, 0.06, 2, sides=8, closed=True)
    box(bm, (0.05, -body * 0.9, -0.05), (0.16, -body * 0.78, body * 0.55), 2)
    # Twig arms with a fork at the hand.
    for side in (-1, 1):
        shoulder = Vector((side * body * 0.85, 0, 0.05))
        hand = Vector((side * (body + 0.42), -0.05, 0.3))
        tube(bm, [shoulder, hand], 0.018, 3, sides=5)
        tube(bm, [shoulder.lerp(hand, 0.75), hand + Vector((side * 0.04, 0, 0.14))], 0.012, 3, sides=4)
    meshes.append(finish('Snowman_Body', bm, [m['snow'], m['coal'], m['scarf'], m['twig']], 50))
    bm = bmesh.new()
    sphere(bm, (0, 0, 0), head, 0, 3, rng=rng, wobble=0.02)
    for side in (-1, 1):
        sphere(bm, (side * 0.07, -head * 0.9, 0.06), 0.028, 1, 1)
    for k in range(5):
        a = math.radians(-60 + k * 30)
        sphere(bm, (math.sin(a) * 0.1, -head * 0.93 + abs(math.sin(a)) * 0.02, -0.07 - math.cos(a) * 0.03), 0.016, 1, 1)
    cone = bmesh.ops.create_cone(bm, cap_ends=True, segments=10, radius1=0.04, radius2=0.0, depth=0.24)
    for v in cone['verts']:
        v.co = Matrix.Rotation(math.pi / 2, 3, 'X') @ v.co + Vector((0, -head - 0.1, 0.0))
    for face in {f for v in cone['verts'] for f in v.link_faces}:
        face.material_index = 2
    # A black top hat with a red band.
    lathe(bm, [(head * 0.72, 0.0), (head * 0.72, head * 1.0), (head * 0.78, head * 1.0), (head * 0.78, head * 0.66),
               (head * 1.55, head * 0.62), (head * 1.55, 0.0)], 16, 1)
    lathe(bm, [(head * 0.8, head * 0.675), (head * 0.97, head * 0.665)], 16, 3)
    meshes.append(finish('Snowman_Head', bm, [m['snow'], m['coal'], m['carrot'], m['scarf']], 50))
    return meshes


def gift_mesh(name, size, body_mat, ribbon_mat):
    """A wrapped box (material 0, tinted by the viewer) with a ribbon both ways and a bow on top, centred on its middle."""
    w, h, d = size
    bm = bmesh.new()
    box(bm, (-w / 2, -d / 2, -h / 2), (w / 2, d / 2, h / 2), 0)
    r = min(w, d) * 0.09
    box(bm, (-r, -d / 2 - 0.004, -h / 2 - 0.004), (r, d / 2 + 0.004, h / 2 + 0.004), 1)
    box(bm, (-w / 2 - 0.004, -r, -h / 2 - 0.004), (w / 2 + 0.004, r, h / 2 + 0.004), 1)
    loop = min(w, d) * 0.2
    for side in (-1, 1):
        sphere(bm, (side * loop * 0.7, 0, h / 2 + loop * 0.35), loop * 0.55, 1, 1, squash=(1.2, 0.5, 0.7))
    sphere(bm, (0, 0, h / 2 + loop * 0.15), loop * 0.3, 1, 1)
    return finish(name, bm, [body_mat, ribbon_mat], 30)


def snowball_mesh(m):
    bm = bmesh.new()
    sphere(bm, (0, 0, 0), SNOWBALL_RADIUS, 0, 2, rng=random.Random(7), wobble=0.06)
    return finish('Snowball', bm, [m['snow']], 60)


def chunk_mesh(m):
    bm = bmesh.new()
    sphere(bm, (0, 0, 0), 1.0, 0, 1, rng=random.Random(9), wobble=0.22)
    return finish('SnowChunk', bm, [m['snow']], 60)


# ------------------------------------------------------------------ pines and the giant tree

def pine_mesh(name, height, m, baubles, pot=False, rng_seed=1, round_baubles=1):
    """A decorated pine: tiers of drooping cones, a star on top, baubles hanging off the tiers' rims (icospheres of
    `round_baubles` subdivisions, smooth shaded). Origin at its foot."""
    rng = random.Random(rng_seed)
    bm = bmesh.new()
    base = 0.0
    if pot:
        lathe(bm, [(0.0, 0.0), (0.0, height * 0.1), (height * 0.16, height * 0.13), (height * 0.16, 0.0)], 14, 4)
        base = height * 0.16
    trunk = height * 0.14
    lathe(bm, [(base, 0.0), (base, height * 0.045), (base + trunk + 0.05, height * 0.035), (base + trunk + 0.05, 0.0)], 8, 2)
    tiers = 4 if height < 3 else 6
    radius = height * 0.36
    top = height * 0.94
    start = base + trunk
    rims = []
    for k in range(tiers):
        t0 = k / tiers
        bottom = start + (top - start) * t0 * 0.92
        r = radius * (1 - t0 * 0.78)
        tier_h = (top - start) * (0.42 if k < tiers - 1 else 0.38)
        segments = 14
        profile = [(bottom - r * 0.08, 0.0), (bottom - r * 0.1, r * 0.55), (bottom, r), (bottom + tier_h * 0.18, r * 0.86),
                   (bottom + tier_h, 0.0)]
        rings = lathe(bm, profile, segments, 0)
        # The rim droops between branch tips.
        for i, v in enumerate(rings[2]):
            v.co.z -= (0.5 + 0.5 * math.cos(i / segments * math.tau * 7)) * r * 0.06
        for face in bm.faces:
            pass
        rims.append((bottom, r, tier_h))
    # Light on the upper face of each tier: a second green for the tops (the snow shader whitens them further).
    for face in bm.faces:
        if face.material_index == 0 and face.normal.z > 0.55:
            face.material_index = 1
    colours = [0, 1, 2, 3]
    tiers_bm, bm = bm, bmesh.new()
    for k, (bottom, r, tier_h) in enumerate(rims):
        count = max(3, int(r * (3.3 if height > 5 else 6)))
        for i in range(count):
            a = (i + 0.5 * (k % 2)) / count * math.tau + rng.uniform(-0.15, 0.15)
            size = height * rng.uniform(0.022, 0.03)
            # Hanging just under the rim, and a second row resting on the tier's slope.
            sphere(bm, (math.sin(a) * r * 0.93, -math.cos(a) * r * 0.93, bottom - r * 0.07 - size * 1.1), size, colours[(i + k) % 4], round_baubles)
            z = bottom + tier_h * 0.42
            out = tier_radius(rims, z) + size * 0.55
            b = a + math.pi / count
            sphere(bm, (math.sin(b) * out, -math.cos(b) * out, z), size, colours[(i + k + 2) % 4], round_baubles)
    baubles = finish(f'{name}_Baubles', bm, [m[k] for k in baubles], 180)
    bm = tiers_bm
    # The star: a flat five-pointed star facing -Y, gently thick, standing on the tip: the top tier's cone reaches past
    # `top`, so it is placed from the highest point of the tree itself, its lower points just over it and none of it
    # sunk into the needles.
    outer, inner = height * 0.085, height * 0.036
    apex = max(v.co.z for v in bm.verts)
    star_c = Vector((0, 0, apex + outer * 0.62))
    pts = [star_c + Vector((math.sin(i * math.pi / 5) * (outer if i % 2 == 0 else inner), 0, math.cos(i * math.pi / 5) * (outer if i % 2 == 0 else inner)))
           for i in range(10)]
    front = [bm.verts.new(p + Vector((0, -height * 0.012, 0))) for p in pts]
    back = [bm.verts.new(p + Vector((0, height * 0.012, 0))) for p in pts]
    cf = bm.verts.new(star_c + Vector((0, -height * 0.025, 0)))
    cb = bm.verts.new(star_c + Vector((0, height * 0.025, 0)))
    for i in range(10):
        j = (i + 1) % 10
        bm.faces.new((cf, front[j], front[i])).material_index = 3
        bm.faces.new((cb, back[i], back[j])).material_index = 3
        bm.faces.new((front[i], front[j], back[j], back[i])).material_index = 3
    mats = [m['needles'], m['needlesLight'], m['bark'], m['star'], m['pot']]
    return finish(name, bm, mats, 40), baubles, rims, top


def tier_radius(rims, z):
    """How far the pine's tiers reach out at height z (the widest tier there)."""
    best = 0.0
    for bottom, r, tier_h in rims:
        rise = z - bottom
        if rise < 0 or rise > tier_h:
            continue
        knee = tier_h * 0.18
        best = max(best, r - r * 0.14 * rise / knee if rise <= knee else r * 0.86 * (1 - (rise - knee) / (tier_h - knee)))
    return best


def bulbs_spiral(rims, top, turns, count, out=0.05, lift=0.0):
    """Points spiralling down the pine's tiers, `out` off their surface, from near the top to the lowest rim (Blender,
    round the tree's axis)."""
    bottom = rims[0][0] + rims[0][2] * 0.1
    points = []
    for i in range(count):
        t = i / (count - 1)
        z = top * 0.9 - (top * 0.9 - bottom) * t ** 0.85
        r = tier_radius(rims, z) + out
        a = t * turns * math.tau
        points.append(Vector((math.sin(a) * r, -math.cos(a) * r, z + lift)))
    return points


def light_string(name, points, parent, origin=(0, 0, 0), bulb=0.04):
    """One string of bulbs: an empty at `origin` (Blender) with the bulbs in its own axes as three.js x, y, z."""
    origin = Vector(origin)
    flat = []
    for p in points:
        d = Vector(p) - origin
        flat += [round(d.x, 4), round(d.z, 4), round(-d.y, 4)]
    return room.anchor(name, origin, parent, 0.0, bulbs=flat, bulb=bulb)


def giant_tree(m, parent, lights):
    """The giant Christmas tree in the middle of its zone: tiers, a big glowing star, baubles, a gold garland spiralling
    down and hundreds of bulbs."""
    height = XMAS_TREE['height']
    mesh, baubles, rims, top = pine_mesh('Decor_XmasTree', height, m, ['baubleRed', 'baubleGold', 'baubleBlue', 'baubleSilver'], rng_seed=31,
                                         round_baubles=2)
    tree = decor('XmasTree', mesh, XMAS, BLOCK_YAW, parent, 'xmastree', (6.4, 6.4), (3.2, height, 3.2))
    mesh_object('XmasTree_Baubles', baubles, tree)
    # A gold garland spiralling down.
    bm = bmesh.new()
    path = bulbs_spiral(rims, top, 3.2, 90, out=0.03)
    tube(bm, path, 0.035, 0, sides=5)
    mesh_object('XmasTree_Garland', finish('XmasTree_Garland', bm, [m['gold']], 40), tree)
    centre = Vector(at(XMAS))
    light_string('Lights_XmasTree', [centre + p for p in bulbs_spiral(rims, top, 5.5, 240, out=0.07)], lights, centre, 0.06)
    return tree


def countdown_sign(m, parent, lights):
    """The big sign counting the days to Christmas: a red wooden frame on two posts with a dark green face (the viewer
    paints the count on it, `board` [w, h, bottom]), a gold bow on top and bulbs round the frame. Faces three.js +Z."""
    bw, bh, bottom = 3.6, 1.9, 1.0
    frame = 0.1
    bm = bmesh.new()
    for side in (-1, 1):
        box(bm, (side * (bw / 2 + frame / 2) - 0.07, -0.07, 0), (side * (bw / 2 + frame / 2) + 0.07, 0.07, bottom + bh + 0.18), 0)
    box(bm, (-bw / 2 - frame, -0.06, bottom - frame), (bw / 2 + frame, 0.06, bottom + bh + frame), 0)
    box(bm, (-bw / 2, -0.07, bottom), (bw / 2, -0.06, bottom + bh), 1)
    bow(bm, (0, -0.09, bottom + bh + frame + 0.1), 0.16, 2)
    decor('CountdownBoard', finish('Decor_CountdownBoard', bm, [m['board'], m['boardFace'], m['gold']], 180), COUNTDOWN, BLOCK_YAW, parent,
          'countdown', (bw + 0.6, 0.7), (bw + 0.3, bottom + bh, 0.2))
    board = bpy.data.objects['CountdownBoard']
    board['board'] = [bw - 0.02, bh - 0.02, bottom + 0.01]
    # Bulbs along the frame's top and down its sides, just in front of it.
    centre = Vector(at(COUNTDOWN))
    edge_x, top = bw / 2 + frame * 0.5, bottom + bh + frame * 0.5
    points = [Vector((edge_x * (2 * k / 22 - 1), -0.09, top)) for k in range(23)]
    for side in (-1, 1):
        points += [Vector((side * edge_x, -0.09, top - (top - bottom + frame * 0.5) * k / 9)) for k in range(1, 10)]
    light_string('Lights_Countdown', [centre + p for p in points], lights, centre, 0.045)


# ------------------------------------------------------------------ garlands, wreaths, bows, stockings

def garland(bm, points, rng, material=0, size=0.07, every=None):
    """Fluffy needle garland along a polyline: overlapping small green puffs (plain icosahedra, few triangles)."""
    every = every or size * 1.25
    previous = None
    for p in points:
        p = Vector(p)
        if previous is not None:
            step = (p - previous).length
            n = max(1, int(step / every))
            for k in range(n):
                q = previous.lerp(p, (k + 1) / n) + Vector((rng.uniform(-1, 1), rng.uniform(-1, 1), rng.uniform(-1, 1))) * size * 0.25
                sphere(bm, q, size * rng.uniform(0.85, 1.2), material, 0, rng=rng, wobble=0.2)
        previous = p


def wreath(bm, centre, radius, normal_axis, rng, green=0, berry=1, bow=2):
    """A round wreath standing in the plane across `normal_axis` ('y' faces -Y, 'x' faces +X) with red berries and a bow."""
    centre = Vector(centre)

    def place(u, v, out=0.0):
        if normal_axis == 'y':
            return centre + Vector((u, -out, v))
        return centre + Vector((out, u, v))
    for k in range(26):
        a = k / 26 * math.tau
        sphere(bm, place(math.cos(a) * radius, math.sin(a) * radius), radius * 0.28, green, 0, rng=rng, wobble=0.2)
    for k in range(7):
        a = rng.uniform(0, math.tau)
        sphere(bm, place(math.cos(a) * radius * 1.05, math.sin(a) * radius * 1.05, radius * 0.2), radius * 0.07, berry, 1)
    for side in (-1, 1):
        sphere(bm, place(side * radius * 0.25, -radius * 0.95, radius * 0.25), radius * 0.2, bow, 1, squash=(1.4, 0.6, 0.9))
        tube(bm, [place(side * radius * 0.08, -radius, radius * 0.28), place(side * radius * 0.28, -radius * 1.5, radius * 0.25)], radius * 0.05, bow, sides=4)
    sphere(bm, place(0, -radius * 0.95, radius * 0.3), radius * 0.1, bow, 1)


def stocking(bm, top, facing, material=0, cuff=1, size=0.3):
    """A Christmas stocking hanging from `top` (Blender), its toe pointing +X; flat-ish, facing -Y or +X."""
    top = Vector(top)
    def place(x, z, y=0.0):
        if facing == 'y':
            return top + Vector((x, y, z))
        return top + Vector((y, x, z))
    leg = [place(0, -size * 0.2), place(0, -size * 0.75), place(size * 0.08, -size * 0.95), place(size * 0.32, -size * 1.02)]
    tube(bm, leg, [size * 0.17, size * 0.17, size * 0.16, size * 0.13], material, sides=8)
    tube(bm, [place(0, -size * 0.02), place(0, -size * 0.24)], size * 0.2, cuff, sides=8)


def bow(bm, centre, size, material=0, axis='y'):
    centre = Vector(centre)
    for side in (-1, 1):
        offset = Vector((side * size * 0.6, 0, 0)) if axis == 'y' else Vector((0, side * size * 0.6, 0))
        sphere(bm, centre + offset, size * 0.55, material, 1, squash=(1.3, 0.55, 0.9) if axis == 'y' else (0.55, 1.3, 0.9))
        tail = Vector((side * size * 0.5, 0, -size * 1.2)) if axis == 'y' else Vector((0, side * size * 0.5, -size * 1.2))
        tube(bm, [centre, centre + tail], size * 0.12, material, sides=4)
    sphere(bm, centre, size * 0.28, material, 1)


def room_decor(m, parent, lights):
    """The room: a garland with lights under both wall caps, a wreath right of the window, lights round the window frame,
    stockings hanging from the sill and a potted pine in the back right corner (one of PINES)."""
    rng = random.Random(41)
    floor = ROOM_FLOOR
    top = floor + 3.32
    bm = bmesh.new()
    # Along the left wall (three.js x = -2.88, z from the front to the back corner) and the back wall (z = -2.88).
    left = [three(-2.86, top, z) for z in (2.9, 1.45, 0.0, -1.45, -2.86)]
    back = [three(x, top, -2.86) for x in (-2.86, -1.45, 0.0, 1.45, 2.95)]
    loops = []
    for row in (left, back):
        for a, b in zip(row, row[1:]):
            loops += swag(a, b, 0.22, 10)[:-1]
        loops.append(row[-1])
    garland(bm, loops, rng, 0, 0.065)
    for p in left[1:-1] + back[1:-1]:
        bow(bm, p + Vector((0.05 if p in left else 0, -0.05 if p in back else 0, 0.02)), 0.07, 2, 'x' if p in left else 'y')
    # Wreath right of the window.
    wreath(bm, three(1.95, floor + 2.5, -2.86), 0.3, 'y', rng, 0, 1, 2)
    # Stockings from the sill (the window's sill runs x -0.53…1.03 at 1.70 m, sticking out to z -2.8).
    for k, x in enumerate((-0.3, 0.25, 0.8)):
        stocking(bm, three(x, floor + 1.7, -2.76), 'y', 3 if k != 1 else 4, 5, 0.3)
    mesh_object('Room_Christmas', finish('Room_Christmas', bm, [m['garland'], m['baubleRed'], m['red'], m['stocking'], m['stockingGreen'], m['fur']], 180), parent)
    # Bulbs along the garland and round the window frame.
    light_string('Lights_RoomGarland', [p + Vector((0, 0, -0.05)) for p in loops[::2]], lights, three(0, floor, 0), 0.035)
    x0, x1, z0, z1 = -0.45, 0.95, floor + 1.75, floor + 3.0
    frame = [three(x0 - 0.04, z0 + 0.05, -2.84)]
    frame += [three(x0 - 0.04, z, -2.84) for z in (z0 + 0.3, z0 + 0.6, z0 + 0.9, z0 + 1.2)]
    frame += [three(x, z1 + 0.04, -2.84) for x in (x0, x0 + 0.35, x0 + 0.7, x0 + 1.05, x1)]
    frame += [three(x1 + 0.04, z, -2.84) for z in (z0 + 1.2, z0 + 0.9, z0 + 0.6, z0 + 0.3, z0 + 0.05)]
    light_string('Lights_RoomWindow', frame, lights, three(0, floor, 0), 0.035)


def outside_decor(m, parent, lights):
    """Outside: garlands with lights along the signs' tops and the boxing gantry's beam, lights spiralling up the
    crossroads lamppost with two stockings and a bow, bows on the park lamps."""
    rng = random.Random(43)
    bm = bmesh.new()
    top = BOARD_BOTTOM + BOARD_H
    for slot in range(3):
        x = SIGN_FIRST_X + slot * SIGN_SPACING
        z = -SIGN_Y + 0.05       # the board's front face (three.js z)
        points = []
        for a, b in ((x - BOARD_W / 2, x), (x, x + BOARD_W / 2)):
            points += swag(three(a, top + 0.02, z), three(b, top + 0.02, z), 0.18, 8)[:-1]
        points.append(three(x + BOARD_W / 2, top + 0.02, z))
        garland(bm, points, rng, 0, 0.06)
        bow(bm, three(x, top + 0.04, z + 0.04), 0.08, 1)
        light_string(f'Lights_Sign{slot}', [p + Vector((0, -0.04, -0.06)) for p in points[1::2]], lights, three(x, 0, z), 0.035)
    # The boxing gantry's beam (three.js z = BOXING z, front face 0.07 towards the camera).
    gx, gz = BOXING
    beam = 3.27
    points = []
    for k in range(4):
        a, b = gx - 2.45 + k * 1.225, gx - 2.45 + (k + 1) * 1.225
        points += swag(three(a, beam, gz + 0.09), three(b, beam, gz + 0.09), 0.25, 8)[:-1]
    points.append(three(gx + 2.45, beam, gz + 0.09))
    garland(bm, points, rng, 0, 0.07)
    light_string('Lights_Boxing', [p + Vector((0, -0.05, -0.07)) for p in points[1::2]], lights, three(gx, 0, gz), 0.04)
    for k in range(5):
        bow(bm, three(gx - 2.45 + k * 1.225, beam + 0.02, gz + 0.12), 0.09, 1)
    # The crossroads lamppost: bulbs spiralling up the pole, two stockings and a bow.
    cx, cz = CROSSROADS
    spiral = []
    for i in range(60):
        t = i / 59
        a = t * 9 * math.tau
        spiral.append(three(cx + math.sin(a) * (LAMP_POLE + 0.03), 0.55 + t * (LAMP_HEIGHT - 0.85), cz + math.cos(a) * (LAMP_POLE + 0.03)))
    light_string('Lights_Lamppost', spiral, lights, three(cx, 0, cz), 0.032)
    stocking(bm, three(cx - 0.1, 1.75, cz + 0.08), 'y', 2, 3, 0.36)
    stocking(bm, three(cx + 0.1, 1.55, cz + 0.08), 'y', 4, 3, 0.32)
    bow(bm, three(cx, 2.05, cz + 0.08), 0.1, 1)
    for point in PARK_LAMPS:
        bow(bm, three(point[0], 2.2, point[1] + 0.06), 0.09, 1)
        stocking(bm, three(point[0] + 0.05, 1.9, point[1] + 0.05), 'y', 2, 3, 0.28)
    mesh_object('Outside_Christmas', finish('Outside_Christmas', bm, [m['garland'], m['red'], m['stocking'], m['fur'], m['stockingGreen']], 180), parent)


# ------------------------------------------------------------------ the hat

def head_tree():
    """A BVH of the character's head in its bind pose without the cap (the web V4 as the viewer shows it)."""
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=str(CHARACTER))
    imported = [o for o in bpy.data.objects if o not in before]
    vertices, polygons = [], []
    for obj in imported:
        # The cap (its fabric, stitching and eyelets: every material named Cap*) comes off for the hat.
        if obj.type != 'MESH' or obj.data.name.startswith('Cap') or any(slot.material and slot.material.name.startswith('Cap') for slot in obj.material_slots):
            continue
        offset = len(vertices)
        vertices.extend(obj.matrix_world @ v.co for v in obj.data.vertices)
        polygons.extend([offset + i for i in p.vertices] for p in obj.data.polygons)
    for obj in imported:
        bpy.data.objects.remove(obj, do_unlink=True)
    high = [v for v in vertices if v.z > 2.3]
    centre = sum(high, Vector()) / len(high)
    return BVHTree.FromPolygons(vertices, polygons), Vector((0.0, centre.y, 0.0)), max(v.z for v in high)


HAT_CLEAR = 0.045
# The Santa hat, after the user's reference: a tall, puffy fur cuff (`cuff` high, `thick` out from the head), a wide red
# dome rising from it and leaning back (`lean` rad, up to `straight` of the way), an arc of radius `bend` turning it
# over backwards through `sweep` rad, and the tail hanging straight down `drop` m behind the head to the bobble.
HAT = {'brim': 2.38, 'tilt': 0.045, 'gap': 0.012, 'cuff': 0.1, 'thick': 0.055, 'rise': 0.02, 'straight': 0.36, 'lean': 0.75,
       'bend': 0.22, 'sweep': 2.95, 'arc': 0.74, 'drop': 0.2, 'flare': 0.6, 'pompom': 0.075}


def build_hat(root, m, tree, centre, crown):
    """The Santa hat: a fur brim fitted round the head at the brow, a red cone rising over the hair and flopping back
    and down, and the white bobble at the tip (`ChristmasHat_Pompom`, its origin at the tip)."""
    h = HAT
    holder = room.anchor('ChristmasHat', (0, 0, 0), root)
    segments = 32

    def surface(angle, z):
        """Distance from the head's axis to its surface at this angle and height (ray from outside inwards)."""
        direction = Vector((math.sin(angle), -math.cos(angle), 0.0))
        start = Vector((centre.x, centre.y, z)) + direction * 0.6
        hit = tree.ray_cast(start, -direction, 0.6)
        return 0.6 - hit[3] if hit[0] is not None else 0.12

    def brim_z(angle):
        # Higher at the back than over the brow (the hat sits back on the head; angle 0 is the face, -Y).
        return h['brim'] - h['tilt'] * math.cos(angle)
    contour = []
    for k in range(segments):
        a = k / segments * math.tau
        contour.append((a, surface(a, brim_z(a)) + h['gap']))
    bm = bmesh.new()
    # Made before any vertex: adding a layer later would cut the references to the vertices made so far.
    layer = bm.verts.layers.float.new('_ring')
    # The cuff: a tall, puffy band of fur hugging the contour, its cross-section a rounded slab (a superellipse) from the
    # head outwards and from the brim up.
    sides = 16
    cuff_rings = []
    for a, r in contour:
        out = Vector((math.sin(a), -math.cos(a), 0.0))
        base = Vector((centre.x, centre.y, brim_z(a))) + out * (r + h['thick'] * 0.45)
        ring_verts = []
        for j in range(sides):
            phi = j / sides * math.tau
            c, sn = math.cos(phi), math.sin(phi)
            x = math.copysign(abs(c) ** 0.6, c) * h['thick'] * 0.55
            z = math.copysign(abs(sn) ** 0.6, sn) * h['cuff'] * 0.5
            ring_verts.append(bm.verts.new(base + out * x + Vector((0, 0, h['cuff'] * 0.5 + z))))
        cuff_rings.append(ring_verts)
    # The cuff as an upright elliptic band round the head's axis (three.js axes: x across, z ahead, y up), for the
    # viewer to keep the swinging tail out of: its middle, its reach to the sides, ahead and behind, and its bottom and top.
    cuff_points = [v.co.copy() for ring_verts in cuff_rings for v in ring_verts]
    cuff_band = [round(centre.x, 4), round(-centre.y, 4),
                 round(max(abs(p.x - centre.x) for p in cuff_points), 4),
                 round(max(centre.y - p.y for p in cuff_points), 4),
                 round(max(p.y - centre.y for p in cuff_points), 4),
                 round(min(p.z for p in cuff_points), 4), round(max(p.z for p in cuff_points), 4)]
    for k in range(segments):
        a_ring, b_ring = cuff_rings[k], cuff_rings[(k + 1) % segments]
        for j in range(sides):
            n = (j + 1) % sides
            bm.faces.new((a_ring[j], b_ring[j], b_ring[n], a_ring[n])).material_index = 1
    # The red part: rings from the top of the cuff up over the crown leaning back, then along an arc that turns it over
    # backwards, then straight down behind the head to the tip. The arc only starts where the dome has narrowed below its
    # radius (HAT 'bend'), so the rings never fold into each other on the inside of the bend (that left a crease down
    # the front). Each ring lies square to the centre line.
    p0 = Vector((centre.x, centre.y, h['brim'] + h['cuff'] * 0.75))
    straight_top = crown + h['rise']
    bend, sweep, start, arc_end = h['bend'], h['sweep'], h['straight'], h['arc']
    lean_angle = h['lean']
    lean = math.tan(lean_angle)
    rise = straight_top - p0.z
    top = Vector((centre.x, centre.y + rise * lean / 2, straight_top))

    def arc_point(theta, u):
        return top + Vector((0.05 * u * u, bend * (math.cos(lean_angle) - math.cos(theta)), bend * (math.sin(theta) - math.sin(lean_angle))))
    rings = []
    centres = []
    steps = 40
    for i in range(steps + 1):
        t = i / steps
        if t <= start:
            u = t / start
            # Upright at the cuff (the rings lie flat on it), leaning `lean` at the top of the dome.
            point = Vector((centre.x, centre.y + rise * lean * u * u / 2, p0.z + rise * u))
            tangent = Vector((0, lean * u, 1)).normalized()
        elif t <= arc_end:
            u = (t - start) / (arc_end - start)
            theta = lean_angle + (sweep - lean_angle) * u
            point = arc_point(theta, u)
            tangent = Vector((0.1 * u, math.sin(theta), math.cos(theta))).normalized()
        else:
            u = (t - arc_end) / (1 - arc_end)
            # Hanging down, it swings out backwards more and more (`flare`), clear of the cuff's back.
            start_tangent = Vector((0.1, math.sin(sweep), math.cos(sweep))).normalized()
            tangent = (start_tangent + Vector((0, h['flare'] * u, 0))).normalized()
            point = arc_point(sweep, 1) + start_tangent * h['drop'] * u + Vector((0, h['flare'] * h['drop'] * u * u / 2, 0))
        centres.append(point)
        right = Vector((1, 0, 0))
        right = (right - tangent * right.dot(tangent)).normalized()
        ahead = tangent.cross(right).normalized()
        # Near the cuff the ring keeps the head's shape; higher up it becomes round. Wide and domed over the head, thinning
        # through the bend and down the tail.
        shape = max(0.0, 1 - t * 3.0)
        if t <= start:
            scale = 1 - 0.3 * (t / start) + 0.1 * math.sin(math.pi * t / start)
        elif t <= arc_end:
            scale = 0.7 - 0.42 * (t - start) / (arc_end - start)
        else:
            scale = 0.28 - 0.1 * (t - arc_end) / (1 - arc_end)
        verts = []
        for a, r in contour:
            radius = (r * shape + (1 - shape) * 0.19) * scale + 0.01
            offset = right * math.sin(a) * radius - ahead * math.cos(a) * radius
            verts.append(bm.verts.new(point + offset + Vector((0, 0, (brim_z(a) - h['brim']) * shape))))
        rings.append(verts)
    p1, p2 = centres[-2], centres[-1]
    for a_ring, b_ring in zip(rings, rings[1:]):
        for k in range(segments):
            n = (k + 1) % segments
            bm.faces.new((a_ring[k], a_ring[n], b_ring[n], b_ring[k])).material_index = 0
    # Nothing of the head may poke through: every vertex of the cone is kept at least HAT_CLEAR outside the head (hair
    # included) along the line from a point inside the head through it. Smoothing the creases this leaves pulls some
    # back in, so push and smooth in turns and push last: the smoothing used to let the black hair show through.
    inside = Vector((centre.x, centre.y, crown - 0.13))

    def push_out(verts):
        for v in verts:
            d = v.co - inside
            length = d.length
            if length < 1e-4:
                continue
            d /= length
            hit = tree.ray_cast(inside + d * 0.7, -d, 0.7)
            if hit[0] is None:
                continue
            needed = (hit[0] - inside).length + HAT_CLEAR
            if length < needed:
                v.co = inside + d * needed
    cone = [v for ring_verts in rings[1:] for v in ring_verts]
    upper = [v for ring_verts in rings[2:] for v in ring_verts]
    for _ in range(3):
        push_out(cone)
        bmesh.ops.smooth_vert(bm, verts=upper, factor=0.5, use_axis_x=True, use_axis_y=True, use_axis_z=True)
    push_out(cone)
    # The push moves single vertices out of line with their neighbours (a dimple down the front): fill such dents by
    # moving a vertex towards its neighbours' middle only when that takes it further out, never back into the head.
    for _ in range(6):
        moves = []
        for v in upper:
            around = [e.other_vert(v).co for e in v.link_edges]
            middle = sum(around, Vector()) / len(around)
            if (middle - inside).length > (v.co - inside).length:
                moves.append((v, v.co.lerp(middle, 0.6)))
        for v, co in moves:
            v.co = co
    # The tail's spine for the viewer (src/character/hatTail.ts): each ring's middle and radius as it ended up, from
    # where the hat lifts off the top of the head (`tail_free`) to the tip, and the back and top of the head as a ball
    # the tail rests on.
    spine = [sum((v.co for v in ring_verts), Vector()) / len(ring_verts) for ring_verts in rings]
    radii = [sum((v.co - c).length for v in ring_verts) / len(ring_verts) for c, ring_verts in zip(spine, rings)]
    p1, p2 = spine[-2], spine[-1]
    head_reach = 0.0
    for k in range(24):
        for lift in (0.0, 0.4, 0.8, 1.2):
            a = k / 24 * math.tau
            if math.cos(a) > 0.2:
                continue  # the face and nose: the tail only ever rests on the back and top of the head
            d = Vector((math.sin(a) * math.cos(lift), -math.cos(a) * math.cos(lift), math.sin(lift)))
            hit = tree.ray_cast(inside + d * 0.7, -d, 0.7)
            if hit[0] is not None:
                head_reach = max(head_reach, (hit[0] - inside).length)
    tip = bm.verts.new(p2 + (p2 - p1).normalized() * 0.01)
    for k in range(segments):
        bm.faces.new((rings[-1][k], rings[-1][(k + 1) % segments], tip)).material_index = 0
    bottom = bm.faces.new(list(reversed(rings[0])))
    bottom.material_index = 0
    # Which ring of the spine each vertex belongs to (the cuff -1), exported as the custom attribute _ring, so the
    # viewer moves exactly the tail's own vertices with it.
    for v in bm.verts:
        v[layer] = -1.0
    for index, ring_verts in enumerate(rings):
        for v in ring_verts:
            v[layer] = float(index)
    tip[layer] = float(len(rings) - 1)
    cap = mesh_object('ChristmasHat_Cap', finish('ChristmasHat_Cap', bm, [m['hat'], m['fur']], 50), holder)
    # three.js axes: (x, z, -y).
    cap['spine'] = [round(value, 4) for c in spine for value in (c.x, c.z, -c.y)]
    cap['radii'] = [round(r, 4) for r in radii]
    cap['tail_free'] = int(round(h['straight'] * steps)) + 1
    cap['head'] = [round(inside.x, 4), round(inside.z, 4), round(-inside.y, 4), round(head_reach, 4)]
    cap['cuff'] = cuff_band
    # The bobble: its origin at the tip, the ball hanging just under it (the viewer swings it like a pendulum).
    bm = bmesh.new()
    sphere(bm, (0, 0, -h['pompom'] * 0.85), h['pompom'], 0, 2, rng=random.Random(3), wobble=0.12)
    pompom = mesh_object('ChristmasHat_Pompom', finish('ChristmasHat_Pompom', bm, [m['fur']], 70), holder, p2)
    pompom['pompom'] = h['pompom']
    return holder


# ------------------------------------------------------------------ the sleigh

def chaikin(points, rounds=2, closed=True):
    """Corner cutting: a polyline rounded `rounds` times (closed or open, the ends kept when open)."""
    for _ in range(rounds):
        out = []
        count = len(points) if closed else len(points) - 1
        if not closed:
            out.append(points[0])
        for i in range(count):
            a = Vector(points[i])
            b = Vector(points[(i + 1) % len(points)])
            out += [a.lerp(b, 0.25), a.lerp(b, 0.75)]
        if not closed:
            out.append(points[-1])
        points = [tuple(v) for v in out]
    return points


def spiral(cy, cz, r0, r1, a0, turns, steps=18):
    """A flat spiral in the side's plane (Blender y, z) from radius r0 at angle a0 (0 = +y, turning towards +z) inwards to r1."""
    return [(cy + math.cos(a0 + k / steps * turns * math.tau) * (r0 + (r1 - r0) * k / steps),
             cz + math.sin(a0 + k / steps * turns * math.tau) * (r0 + (r1 - r0) * k / steps)) for k in range(steps + 1)]


def sleigh_side_profile():
    """The sleigh's side panel seen from the side (Blender y, z; ahead is -y), after the user's reference: a low rounded
    front, the top edge dipping where the rider's hands rest, then sweeping up into a tall back that ends in a scroll,
    a rounded bottom. Rounded by corner cutting."""
    return chaikin([(-0.86, 0.3), (-0.97, 0.42), (-1.0, 0.68), (-0.95, 0.84), (-0.83, 0.89), (-0.55, 0.86), (-0.3, 0.82),
                    (-0.05, 0.85), (0.18, 0.98), (0.36, 1.18), (0.5, 1.36), (0.62, 1.46), (0.74, 1.47), (0.81, 1.39),
                    (0.77, 1.16), (0.69, 0.92), (0.7, 0.62), (0.76, 0.46), (0.71, 0.32), (0.5, 0.28), (-0.6, 0.28)], 1)


def cushion(bm, lo, hi, material, round_off=0.035):
    """A puffy upholstered block: a box with its edges well rounded."""
    verts = box(bm, lo, hi, material)
    edges = list({e for v in verts for e in v.link_edges})
    made = bmesh.ops.bevel(bm, geom=edges, offset=round_off, segments=1, affect='EDGES', profile=0.7)
    for face in made['faces']:
        face.material_index = material


def gift_into(bm, centre, size, yaw, body, ribbon):
    """A wrapped box with a ribbon both ways and a bow on top into `bm` (materials by index), sitting on `centre`."""
    w, d, h = size
    made = []
    made += box(bm, (-w / 2, -d / 2, 0), (w / 2, d / 2, h), body)
    r = min(w, d) * 0.08
    made += box(bm, (-r, -d / 2 - 0.004, -0.004), (r, d / 2 + 0.004, h + 0.004), ribbon)
    made += box(bm, (-w / 2 - 0.004, -r, -0.004), (w / 2 + 0.004, r, h + 0.004), ribbon)
    loop = min(w, d) * 0.2
    for side in (-1, 1):
        made += sphere(bm, (side * loop * 0.7, 0, h + loop * 0.35), loop * 0.55, ribbon, 1, squash=(1.2, 0.5, 0.7))
    made += sphere(bm, (0, 0, h + loop * 0.15), loop * 0.3, ribbon, 1)
    turn = Matrix.Rotation(yaw, 3, 'Z')
    for v in made:
        v.co = turn @ v.co + Vector(centre)


def build_sleigh(root, m):
    s = SLEIGH
    holder = room.anchor('ChristmasSleigh', (0, 0, 0), root)
    bm = bmesh.new()
    profile = sleigh_side_profile()
    half = s['width'] / 2
    # Materials: 0 red, 1 dark red (runners, floor), 2 gold, 3 green upholstery.
    for side in (-1, 1):
        x0, x1 = side * half - 0.03, side * half + 0.03
        outer = [bm.verts.new((x1 if side > 0 else x0, y, z)) for y, z in profile]
        inner = [bm.verts.new((x0 if side > 0 else x1, y, z)) for y, z in profile]
        bm.faces.new(outer).material_index = 0
        bm.faces.new(list(reversed(inner))).material_index = 0
        for i in range(len(profile)):
            j = (i + 1) % len(profile)
            bm.faces.new((outer[i], outer[j], inner[j], inner[i])).material_index = 0
        # A gold rim all round the panel's outer edge, and gold scrolls at its back top and its front.
        out_x = side * (half + 0.032)
        tube(bm, [Vector((out_x, y, z)) for y, z in profile], 0.02, 2, sides=5, closed=True)
        for curl in (spiral(0.73, 1.33, 0.13, 0.03, math.pi * 0.5, 1.35), spiral(-0.9, 0.76, 0.1, 0.025, math.pi * 0.6, -1.25)):
            tube(bm, [Vector((side * half, y, z)) for y, z in curl], 0.03, 2, sides=6)
        # Gold swirls on the outer face: one along the front, one sweeping up the back (above the thruster).
        for swirl in (
            [(-0.36, 0.66), (-0.5, 0.7), (-0.62, 0.66)] + spiral(-0.7, 0.66, 0.08, 0.02, 0.0, 1.1, 12),
            [(-0.36, 0.66), (-0.22, 0.7)] + spiral(-0.17, 0.66, 0.05, 0.015, math.pi, -1.0, 10),
            [(0.05, 0.78), (0.25, 0.86), (0.42, 1.02)] + spiral(0.5, 1.1, 0.09, 0.02, math.pi * 1.25, 1.1, 12),
        ):
            tube(bm, [Vector((side * (half + 0.034), y, z)) for y, z in swirl], 0.012, 2, sides=4)
    # Floor, the front panel with a rolled top edge, and the solid back the gifts ride on.
    box(bm, (-half, -0.92, 0.28), (half, 0.72, 0.34), 1)
    box(bm, (-half, -0.98, 0.32), (half, -0.9, 0.82), 0)
    roll = Matrix.Rotation(math.pi / 2, 4, 'Y')
    made = lathe(bm, [(0.0, 0.0), (0.0, 0.075), (half * 2, 0.075), (half * 2, 0.0)], 14, 0)
    bmesh.ops.transform(bm, matrix=Matrix.Translation((-half, -0.9, 0.84)) @ roll, verts=[v for ring in made for v in ring])
    for side in (-1, 1):
        sphere(bm, (side * half, -0.9, 0.84), 0.07, 2, 1)
    box(bm, (-half, 0.44, 0.32), (half, 0.7, 1.0), 0)
    # The seat: a red base and a green tufted cushion, and a tufted backrest of puffy cells.
    box(bm, (-half + 0.03, -0.3, 0.32), (half - 0.03, 0.3, s['seat'] - 0.12), 0)
    cols = 3
    for c in range(cols):
        x0 = -half + 0.04 + c * (2 * half - 0.08) / cols
        x1 = x0 + (2 * half - 0.08) / cols
        cushion(bm, (x0, -0.31, s['seat'] - 0.13), (x1, 0.3, s['seat']), 3)
        for z0, z1 in ((s['seat'], s['seat'] + 0.27), (s['seat'] + 0.27, s['seat'] + 0.54)):
            cushion(bm, (x0, 0.3, z0), (x1, 0.44, z1), 3)
    # Runners: dark red, curling up in front of the body (not far: the sleigh is short in front) and a little behind,
    # on three struts a side.
    for side in (-1, 1):
        x = side * (half - 0.1)
        run = chaikin([(0.9, 0.13), (0.84, 0.05), (0.7, 0.035), (-0.8, 0.035), (-0.95, 0.07), (-1.05, 0.18), (-1.08, 0.3),
                       (-1.03, 0.4), (-0.95, 0.42), (-0.9, 0.36), (-0.93, 0.3), (-0.98, 0.31)], 1, closed=False)
        tube(bm, [Vector((x, y, z)) for y, z in run], 0.034, 1, sides=8)
        for y in (-0.62, -0.05, 0.5):
            tube(bm, [Vector((x, y, 0.06)), Vector((x, y, 0.29))], 0.024, 1, sides=6)
    mesh_object('Sleigh_Body', finish('Sleigh_Body', bm, [m['sleighRed'], m['sleighDark'], m['gold'], m['seat']], 62), holder)
    # A pile of wrapped gifts on the back, as in the reference (the falling gifts leave from its top).
    bm = bmesh.new()
    for centre, size, yaw, body, ribbon in (
        ((-0.25, 0.58, 1.0), (0.36, 0.3, 0.3), 0.1, 0, 1), ((0.18, 0.57, 1.0), (0.4, 0.3, 0.34), -0.08, 1, 2),
        ((-0.06, 0.6, 1.3), (0.3, 0.26, 0.28), 0.25, 0, 1), ((0.3, 0.6, 1.34), (0.24, 0.24, 0.24), -0.3, 2, 0),
        ((-0.33, 0.6, 1.3), (0.22, 0.22, 0.22), 0.4, 1, 0),
    ):
        gift_into(bm, centre, size, yaw, body, ribbon)
    mesh_object('SleighGifts', finish('SleighGifts', bm, [m['red'], m['green'], m['gold']], 30), holder)
    room.anchor('SleighSack_Mouth', (0, 0.62, 1.66), holder, 0.0, sack=1)
    # A thruster on each side, outside the side panels and pointing backwards (Blender +Y): a rounded nose, the tank
    # with a glass window along its top showing the icy charge, a collar, the throat and a flared bell glowing inside.
    length = THRUSTER['length']
    radius = THRUSTER['radius']
    profile = [(0.0, 0.0), (0.03, radius * 0.5), (0.09, radius * 0.86), (0.17, radius), (0.68, radius), (0.7, radius * 1.12),
               (0.75, radius * 1.12), (0.77, radius * 0.92), (0.83, radius * 0.62), (0.92, radius * 0.86), (1.0, radius * 1.08),
               (1.0, radius * 0.92), (0.94, radius * 0.7), (0.94, 0.0)]
    along = Matrix.Rotation(-math.pi / 2, 4, 'X')
    fuel = None
    for side, name in ((-1, 'right'), (1, 'left')):
        t_c = Vector((side * THRUSTER['out'], THRUSTER['front'], THRUSTER['height']))
        bm = bmesh.new()
        lathe(bm, [(z * length, r) for z, r in profile], 20, 0)
        bmesh.ops.transform(bm, matrix=Matrix.Translation(t_c) @ along, verts=bm.verts)
        for face in bm.faces:
            c = face.calc_center_median()
            if c.y > t_c.y + length * 0.9 and math.hypot(c.x - t_c.x, c.z - t_c.z) < radius * 0.95:
                face.material_index = 1
        # Two struts holding it to the sleigh's side.
        for y in (t_c.y + length * 0.25, t_c.y + length * 0.6):
            tube(bm, [Vector((side * (half + 0.03), y, t_c.z)), Vector((t_c.x - side * radius * 0.8, y, t_c.z))], 0.025, 2, sides=6)
        mesh_object(f'SleighThruster_{name}', finish(f'SleighThruster_{name}', bm, [m['metal'], m['glow'], m['gold']], 40), holder)
        # The window on its top and the charge inside it, both along the thruster; the charge's origin is the window's
        # front end, turned so its local height runs backwards (the viewer scales it with the fuel).
        window = Vector((t_c.x, t_c.y + length * 0.2, t_c.z + radius * 0.92))
        bm = bmesh.new()
        lathe(bm, [(0.0, 0.0), (0.0, 0.034), (0.46 * length, 0.034), (0.46 * length, 0.0)], 12, 0)
        glass = mesh_object(f'SleighFuelGlass_{name}', finish(f'SleighFuelGlass_{name}', bm, [m['glass']], 40), holder, window)
        glass.rotation_euler = (-math.pi / 2, 0, 0)
        bm = bmesh.new()
        lathe(bm, [(0.0, 0.0), (0.0, 0.025), (0.44 * length, 0.025), (0.44 * length, 0.0)], 10, 0)
        charge = mesh_object(f'SleighFuel_{name}', finish(f'SleighFuel_{name}', bm, [m['fuel']], 40), holder, window + Vector((0, 0.01 * length, 0)))
        charge.rotation_euler = (-math.pi / 2, 0, 0)
        fuel = fuel or charge
        room.anchor(f'SleighNozzle_{name}', t_c + Vector((0, length + 0.03, 0.0)), holder, 0.0, nozzle=name)
    # Where the hands rest: on the sides' top edges, a little ahead of the hips.
    for side, name in ((-1, 'right'), (1, 'left')):
        room.anchor(f'SleighGrip_{name}', (side * (half - 0.02), -0.32, s['side'] - 0.02), holder, 0.0, grip=name)
    return holder, fuel


# ------------------------------------------------------------------ build

def build(root, head):
    m = materials()
    world = room.anchor('ChristmasWorld', (0, 0, 0), root)
    library = room.anchor('ChristmasLibrary', (0, 0, 0), root)
    lights = room.anchor('ChristmasLights', (0, 0, 0), root)
    loose = room.anchor('ChristmasPieces', (0, 0, 0), world)
    fixed = room.anchor('ChristmasDecor', (0, 0, 0), world)

    # Snowmen: three balls each, stacked, sharing a joint.
    base, body, head_r = SNOW_BALLS
    meshes = snowman_meshes(m)
    heights = [base, 2 * base + body * 0.82, 2 * base + body * 1.64 + head_r * 0.82]
    for index, (x, z, yaw) in enumerate(SNOWMEN):
        for part, (mesh, radius, mass, height) in enumerate(zip(meshes, SNOW_BALLS, SNOW_MASS, heights)):
            piece(f'Snowman_{index}_{part}', mesh, (x, z), height, BLOCK_YAW + yaw, loose, prop='snowman', group='christmas', mass=mass,
                  radius=radius, box=[2 * radius, 2 * radius, 2 * radius], joint=f'snowman_{index}', part=part)

    # Gifts round the giant tree (white: tinted by the viewer).
    tree_gifts = [gift_mesh(f'Gift_Tree{k}', size, m['giftWhite'], m['ribbon']) for k, size in enumerate(TREE_GIFT_SIZES)]
    for index, (angle, distance, size, yaw) in enumerate(TREE_GIFTS):
        w, h, d = TREE_GIFT_SIZES[size]
        point = (XMAS[0] + math.sin(angle) * distance * 0.78, XMAS[1] + math.cos(angle) * distance * 0.78)
        piece(f'TreeGift_{index:02d}', tree_gifts[size], point, h / 2, BLOCK_YAW + yaw, loose, prop='gift', group='christmas',
              mass=2.0 + 3.0 * size, box=[w, h, d])

    # Decorated pines (the first in the room, on its floor, in a pot).
    variants = {}
    for index, (x, z, height) in enumerate(PINES):
        in_room = index == 0
        if (height, in_room) not in variants:
            variants[height, in_room] = pine_mesh(f'Decor_Pine{len(variants)}', height, m, ['baubleRed', 'baubleGold', 'baubleBlue', 'baubleSilver'],
                                                  pot=in_room, rng_seed=len(variants) + 3)
        mesh, baubles, rims, top = variants[height, in_room]
        radius = rims[0][1]
        pine = decor(f'Pine_{index}', mesh, (x, z), BLOCK_YAW, fixed, 'pine', (radius * 2.1, radius * 2.1), (radius * 1.2, height, radius * 1.2),
                     height=ROOM_FLOOR if in_room else 0.0)
        mesh_object(f'Pine_{index}_Baubles', baubles, pine)
        centre = Vector(at((x, z), ROOM_FLOOR if in_room else 0.0))
        light_string(f'Lights_Pine{index}', [centre + p for p in bulbs_spiral(rims, top, 3.0, 26 if in_room else 40, out=0.04)], lights, centre, 0.035)

    giant_tree(m, fixed, lights)
    # The tree's zone: its painted ring and name and the reset zone.
    room.anchor('Floor_ChristmasTree', at((XMAS[0], XMAS[1] + 0.6)), world, BLOCK_YAW, floor='xmastree', size=[11.0, 10.6])
    room.anchor('Zone_Christmas', at((41.4, -8.6)), world, BLOCK_YAW, zone='reset', target='christmas', area=list(RESET_AREA))
    countdown_sign(m, fixed, lights)

    room_decor(m, fixed, lights)
    outside_decor(m, fixed, lights)

    tree, centre, crown = head
    build_hat(root, m, tree, centre, crown)
    build_sleigh(root, m)

    # The library.
    mesh_object('Christmas_Pin', christmas_pin(m), library)
    mesh_object('Christmas_Ball', christmas_ball(m), library)
    mesh_object('Snowball', snowball_mesh(m), library)
    mesh_object('SnowChunk', chunk_mesh(m), library)
    for k, size in enumerate(DROP_GIFT_SIZES):
        mesh_object(f'Gift_{k}', gift_mesh(f'Gift_{k}', size, m['giftWhite'], m['ribbon']), library)


def export_glb(root):
    bpy.ops.object.select_all(action='DESELECT')
    for o in [root, *root.children_recursive]:
        o.select_set(True)
    bpy.context.view_layer.objects.active = root
    bpy.ops.export_scene.gltf(filepath=str(GLB), export_format='GLB', use_selection=True, export_apply=True,
                              export_yup=True, export_extras=True, export_attributes=True, export_cameras=False, export_lights=False,
                              export_animations=False, **room.WEB_IMAGES)
    print(f'Christmas GLB: {GLB} ({GLB.stat().st_size} bytes)')


def render_views(root):
    """Review renders: the hat on the V4 head, the sleigh, a snowman, a pine and the giant tree."""
    RENDERS.mkdir(parents=True, exist_ok=True)
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=str(CHARACTER))
    character = [o for o in bpy.data.objects if o not in before]
    for obj in character:
        if obj.type == 'MESH' and any(slot.material and slot.material.name.startswith('Cap') for slot in obj.material_slots):
            obj.hide_render = True
    scene = bpy.context.scene
    scene.render.engine = 'BLENDER_EEVEE'
    scene.render.resolution_x = scene.render.resolution_y = 800
    world = bpy.data.worlds.new('Review')
    world.use_nodes = True
    world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.2, 0.24, 0.34, 1)
    world.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.9
    scene.world = world
    sun = bpy.data.objects.new('Sun', bpy.data.lights.new('Sun', 'SUN'))
    sun.data.energy = 3.5
    sun.rotation_euler = (math.radians(50), 0, math.radians(-30))
    scene.collection.objects.link(sun)
    camera = bpy.data.objects.new('Camera', bpy.data.cameras.new('Camera'))
    scene.collection.objects.link(camera)
    scene.camera = camera
    sleigh = bpy.data.objects['ChristmasSleigh']
    sleigh.location.x = 4.0
    snowman = Vector(at(SNOWMEN[0][:2]))
    pine = Vector(at(PINES[2][:2]))
    tree = Vector(at(XMAS))
    shots = {
        'hat-front': ((0, -2.4, 2.35), (0, 0, 2.4), 85),
        'hat-three-quarter': ((1.6, -1.8, 2.5), (0, 0, 2.42), 85),
        'hat-side': ((2.4, 0, 2.45), (0, 0, 2.42), 85),
        'hat-back': ((1.0, 2.2, 2.6), (0, 0.1, 2.42), 85),
        'sleigh': ((7.6, -3.6, 2.4), (4.0, 0, 0.5), 45),
        'snowman': (tuple(snowman + Vector((2.4, -3.2, 1.6))), tuple(snowman + Vector((0, 0, 0.9))), 50),
        'pine': (tuple(pine + Vector((3.2, -4.0, 2.0))), tuple(pine + Vector((0, 0, 1.2))), 50),
        'xmastree': (tuple(tree + Vector((10.0, -12.0, 6.0))), tuple(tree + Vector((0, 0, 3.6))), 40),
    }
    for name, (eye, target, lens) in shots.items():
        camera.location = eye
        camera.rotation_euler = (Vector(target) - Vector(eye)).to_track_quat('-Z', 'Y').to_euler()
        camera.data.lens = lens
        scene.render.filepath = str(RENDERS / f'{name}.png')
        bpy.ops.render.render(write_still=True)
    sleigh.location.x = 0.0
    for obj in character + [sun, camera]:
        bpy.data.objects.remove(obj, do_unlink=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--replace-generated', action='store_true')
    parser.add_argument('--render', action='store_true')
    args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else [])
    if (BLEND.exists() or GLB.exists()) and not args.replace_generated:
        raise RuntimeError('Christmas outputs exist. Review them before using --replace-generated.')
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.scene.unit_settings.system = 'METRIC'
    head = head_tree()
    root = bpy.data.objects.new('Christmas', None)
    bpy.context.collection.objects.link(root)
    root['stage'] = '19-christmas'
    build(root, head)
    BLEND.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=str(BLEND), compress=True)
    export_glb(root)
    if args.render:
        render_views(root)


if __name__ == '__main__':
    main()
