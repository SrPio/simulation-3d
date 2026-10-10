"""The car circuit's things: an office chair to ride, wooden ramps, building-site obstacles and fences that break.

Builds assets/blender/circuit.blend and public/models/circuit.glb (the `Circuit` root). The viewer loads it next to
outside.glb and reads it the same way (src/scene/outsideData.ts), so the extras follow create_outside.py:
- `CircuitPieces`: loose pieces of group 'circuit' (pallets, bricks, cones, drums, pipes, the wheelbarrow, the metal
  fences, signs, loose tyres and the wooden fences' legs and planks). A wooden fence's legs and planks share a `joint`
  extra: the physics holds the planks to the legs until a hard knock breaks them loose.
- `CircuitDecor`: fixed things (`decor`, `shadow`, `solid`): concrete barriers, sandbags, tyre walls, tape posts, the
  arches (open in the middle: two `Collider_*` legs), the traffic light (`TrafficLight_Lens_<i>` lit by the viewer), the
  lap board (`board` like the scoreboard) and the ramps (`ramp` [length, width, height], `profile` up | bump: the
  ground rises along the ramp's local +Z, three.js axes).
- `Tapes`: safety tapes, `Tape_<i>` anchors (`tape` [length]) with their two posts; the viewer draws the tape itself
  (a ribbon on a rope that falls apart when something fast goes through).
- `OfficeChair`: the chair the character rides: `ChairBase` with `ChairCaster_<i>` (swivel, `ChairWheel_<i>` inside),
  and `ChairUpper` pivoting on the gas lift top (seat, back and arms; `ChairArmrest_<side>` on top of each arm pad,
  `armrest` 'right' or 'left' for the rider's side; `ChairBottle_<side>` soda bottles strapped under the arms with their
  mouths backwards: shell, `ChairBottleLiquid_<side>` (its origin at the bottom, scaled along local Y with the fuel),
  `ChairBottleCap_<side>` and the `ChairNozzle_<side>` anchor at the mouth; `OfficeChair_Seat` where the hips go, the same
  height above the ground as the room chair's seat so its clips fit).
- `Floor_StartLine`/`Floor_FinishLine` (floor `checker`) and `Floor_ChairHint` (floor `chairhint`: an arrow towards the
  chair and "How did that get here?"), `Zone_Circuit` (reset zone, target 'circuit').
- The end wall: `Wall_Brick_<i>` loose bricks of group 'wall' (a wall across the end of the road and a stepped one beside it)
  (no reset zone: Restablecer puts them back).
Everything is placed by its index along create_outside.CIRCUIT, a side offset and an advance, turned to the road's
heading rounded to a quarter turn (the perspective rule: axis aligned, fronts facing three.js +Z where it matters).
"""
import argparse
import math
import random
import sys
from pathlib import Path

import bmesh
import bpy
from mathutils import Matrix, Vector

sys.path.insert(0, str(Path(__file__).resolve().parent))
import create_room as room
import create_outside as out
from create_outside import CIRCUIT, CIRCUIT_WIDTH, GROUND_Z, at, bm_box, proto_mesh, piece, decor

ROOT = Path(__file__).resolve().parents[2]
BLEND = ROOT / 'assets' / 'blender' / 'circuit.blend'
GLB = ROOT / 'public' / 'models' / 'circuit.glb'
HALF = CIRCUIT_WIDTH / 2
N = len(CIRCUIT) - 1
QUARTER = math.pi / 2

# Office chair (Blender axes, forward -Y = three.js +Z): seat top at the room chair's 0.64 m.
SEAT_TOP, LIFT_TOP, CASTER_RADIUS, WHEEL_RADIUS = 0.64, 0.42, 0.33, 0.05
SEAT_STAND_OFFSET = 0.20
# The chair is drawn this much larger than life around its seat (the seat stays at the room chair's height).
CHAIR_SCALE = 1.3
MASS = {'pallet': 6.0, 'brick': 0.6, 'cone': 0.5, 'drum': 3.0, 'pipe': 40.0, 'barrow': 8.0, 'metal': 9.0, 'sign': 2.5,
        'tyre': 4.0, 'leg': 2.0, 'plank': 1.2}
# Ramps (length along the road, width, height) and the plank bumps.
RAMP = (3.0, 2.2, 0.5)
JUMP = (2.6, 2.6, 0.9)
BUMP = (0.3, 4.4, 0.07)
# Past the end of the road (it ends heading -Z at about z 33): a brick wall across it and a stepped one beside it, where
# the user drew them; three.js ground x, z of their middles.
END_WALL, END_WALL_BRICKS, END_WALL_LAYERS = (-3.95, 29.0), 12, 7   # centred on the road's last point
STEP_WALL, STEP_WALL_ROWS = (-9.6, 31.0), (5, 4, 3, 2, 1)


# ------------------------------------------------------------------ placing along the road

def heading(i):
    a, b = CIRCUIT[max(0, i - 1)], CIRCUIT[min(N, i + 1)]
    return math.atan2(b[1] - a[1], b[0] - a[0])


def turn(i):
    d = heading(min(N - 1, i + 3)) - heading(max(1, i - 3))
    return (d + math.pi) % math.tau - math.pi


def outer(i):
    """Side sign (+1 left of travel, -1 right) of the outside of the bend at i."""
    return -1 if turn(i) > 0 else 1


def road(i, side=0.0, along=0.0):
    """three.js ground point `side` metres left of the middle line (+z when heading +x) and `along` ahead at index i."""
    h = heading(i)
    x, z = CIRCUIT[i]
    return (x + math.cos(h) * along - math.sin(h) * side, z + math.sin(h) * along + math.cos(h) * side)


def yaw_along(i, extra=0.0):
    """Blender yaw that turns local three.js +Z along the road, rounded to a quarter turn."""
    raw = QUARTER - heading(i) + extra
    return round(raw / QUARTER) * QUARTER


# ------------------------------------------------------------------ small mesh helpers

def faces_of(geom):
    return {f for v in geom['verts'] for f in v.link_faces}


def set_mat(geom, index):
    for face in faces_of(geom):
        face.material_index = index


def bm_cylinder(bm, center, radius, depth, segments=8, material=0, axis='Z', top=None):
    geom = bmesh.ops.create_cone(bm, cap_ends=True, segments=segments, radius1=radius, radius2=radius if top is None else top, depth=depth)
    rot = {'Z': Matrix.Identity(3), 'X': Matrix.Rotation(QUARTER, 3, 'Y'), 'Y': Matrix.Rotation(QUARTER, 3, 'X')}[axis]
    for v in geom['verts']:
        v.co = rot @ v.co + Vector(center)
    set_mat(geom, material)
    return geom


def bm_beam(bm, a, b, thickness, material=0):
    """A square beam from a to b."""
    a, b = Vector(a), Vector(b)
    geom = bmesh.ops.create_cube(bm, size=1.0)
    length = (b - a).length
    basis = (b - a).to_track_quat('Z', 'Y').to_matrix().to_4x4()
    transform = Matrix.Translation((a + b) / 2) @ basis @ Matrix.Diagonal((thickness, thickness, length, 1))
    for v in geom['verts']:
        v.co = transform @ v.co
    set_mat(geom, material)
    return geom


def bm_tube(bm, r_out, r_in, length, segments=12, material=0):
    """Hollow tube along Z, centred on the origin."""
    rings = []
    for z in (-length / 2, length / 2):
        for r in (r_out, r_in):
            rings.append([bm.verts.new((math.cos(k / segments * math.tau) * r, math.sin(k / segments * math.tau) * r, z)) for k in range(segments)])
    lo_out, lo_in, hi_out, hi_in = rings
    for k in range(segments):
        n = (k + 1) % segments
        for quad in ((lo_out[k], lo_out[n], hi_out[n], hi_out[k]), (lo_in[n], lo_in[k], hi_in[k], hi_in[n]),
                     (hi_out[k], hi_out[n], hi_in[n], hi_in[k]), (lo_in[k], lo_in[n], lo_out[n], lo_out[k])):
            bm.faces.new(quad).material_index = material


def bm_torus(bm, major, minor, segments=12, sides=6, material=0, z=0.0):
    rings = []
    for k in range(segments):
        a = k / segments * math.tau
        rings.append([bm.verts.new(((major + minor * math.cos(s / sides * math.tau)) * math.cos(a),
                                    (major + minor * math.cos(s / sides * math.tau)) * math.sin(a),
                                    z + minor * math.sin(s / sides * math.tau))) for s in range(sides)])
    for k in range(segments):
        for s in range(sides):
            a, b = rings[k], rings[(k + 1) % segments]
            bm.faces.new((a[s], b[s], b[(s + 1) % sides], a[(s + 1) % sides])).material_index = material


def bm_prism(bm, outline, x0, x1, material=0):
    """An outline in the YZ plane extruded along X from x0 to x1."""
    lo = [bm.verts.new((x0, y, z)) for y, z in outline]
    hi = [bm.verts.new((x1, y, z)) for y, z in outline]
    bm.faces.new(list(reversed(lo))).material_index = material
    bm.faces.new(hi).material_index = material
    for k in range(len(outline)):
        n = (k + 1) % len(outline)
        bm.faces.new((lo[k], lo[n], hi[n], hi[k])).material_index = material


def mesh(name, build, mats, smooth=None):
    bm = bmesh.new()
    build(bm)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return proto_mesh(name, bm, mats, smooth_angle=smooth)


def obj(name, data, parent, location=(0, 0, 0), yaw=0.0, **extras):
    o = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(o)
    o.parent = parent
    o.location = location
    o.rotation_euler.z = yaw
    for key, value in extras.items():
        o[key] = value
    return o


# ------------------------------------------------------------------ materials

def palette():
    m = room.material
    return {
        'wood': m('CircuitWood', (0.58, 0.39, 0.22), 0.8),
        'wood_dark': m('CircuitWoodDark', (0.36, 0.23, 0.13), 0.85),
        'concrete': m('Concrete', (0.56, 0.55, 0.58), 0.95),
        'concrete_dark': m('ConcreteDark', (0.38, 0.37, 0.4), 0.95),
        'orange': m('SiteOrange', (0.95, 0.42, 0.12), 0.6),
        'white': m('SiteWhite', (0.92, 0.92, 0.92), 0.5),
        'red': m('SiteRed', (0.78, 0.1, 0.1), 0.6),
        'yellow': m('SiteYellow', (0.96, 0.78, 0.12), 0.55),
        'black': m('SiteBlack', (0.03, 0.03, 0.035), 0.6),
        'steel': m('Steel', (0.6, 0.6, 0.66), 0.35, 0.8),
        'sand': m('Sand', (0.78, 0.66, 0.43), 0.95),
        'burlap': m('Burlap', (0.42, 0.3, 0.16), 0.95),
        'tie': m('BurlapTie', (0.25, 0.16, 0.08), 0.9),
        'rubber': m('Rubber', (0.04, 0.04, 0.045), 0.9),
        'green': m('BarrowGreen', (0.1, 0.45, 0.25), 0.55),
        'brick': m('CircuitBrick', (0.72, 0.3, 0.2), 0.85),
        'fabric': m('ChairFabric', (0.16, 0.13, 0.24), 0.9),
        'plastic': m('ChairPlastic', (0.05, 0.05, 0.06), 0.5),
        'chrome': m('ChairChrome', (0.75, 0.75, 0.8), 0.25, 0.9),
        'board': m('LapBoardFace', (0.03, 0.025, 0.05), 0.5),
        'pet': m('BottlePET', (0.86, 0.93, 0.9), 0.12, alpha=0.32),
        'cola': m('Cola', (0.11, 0.035, 0.015), 0.18),
        'lens': [m(f'Lens_{k}', c, 0.3) for k, c in enumerate(((0.25, 0.03, 0.03), (0.25, 0.2, 0.02), (0.02, 0.2, 0.06)))],
    }


# ------------------------------------------------------------------ the office chair

def build_chair(m, root):
    """Five-star base on casters, gas lift, padded seat, curved back and arms. Forward is Blender -Y (three.js +Z)."""
    i = 1
    x, z = road(i)
    chair = room.anchor('OfficeChair', at((x, z)), root, yaw_along(i), chair='office')
    # Base: hub, five arms, the gas lift's sleeve.
    def base(bm):
        bm_cylinder(bm, (0, 0, 0.12), 0.06, 0.07, 10, 0)
        for k in range(5):
            a = k / 5 * math.tau + math.pi / 2
            tip = Vector((math.cos(a) * (CASTER_RADIUS - 0.02), math.sin(a) * (CASTER_RADIUS - 0.02), 0.1))
            bm_beam(bm, (0, 0, 0.13), tip, 0.045, 0)
        bm_cylinder(bm, (0, 0, 0.22), 0.035, 0.16, 10, 0)
        bm_cylinder(bm, (0, 0, 0.36), 0.022, 0.14, 10, 1)
    base_mesh = mesh('Chair_Base', base, [m['plastic'], m['chrome']], 40)
    base_mesh.transform(Matrix.Diagonal((CHAIR_SCALE, CHAIR_SCALE, 1.0, 1.0)))
    base_obj = obj('ChairBase', base_mesh, chair)
    fork = mesh('Chair_Fork', lambda bm: (bm_box(bm, (-0.025, -0.012, 0.055), (0.025, 0.035, 0.1), 0),), [m['plastic']])
    wheel = mesh('Chair_Wheel', lambda bm: (bm_cylinder(bm, (0, 0, 0), WHEEL_RADIUS, 0.04, 10, 0, 'X'),), [m['rubber']], 40)
    for k in range(5):
        a = k / 5 * math.tau + math.pi / 2
        caster = obj(f'ChairCaster_{k}', fork, base_obj, (math.cos(a) * CASTER_RADIUS * CHAIR_SCALE, math.sin(a) * CASTER_RADIUS * CHAIR_SCALE, 0.0))
        # The wheel trails behind the swivel (+Y here: the casters turn to trail their wheels behind the motion).
        obj(f'ChairWheel_{k}', wheel, caster, (0.0, 0.03, WHEEL_RADIUS))
    # Upper part: everything above the gas lift, pivoting on its top.
    def upper(bm):
        lift = LIFT_TOP
        bm_box(bm, (-0.12, -0.12, 0.0), (0.12, 0.12, 0.06), 1)                       # mechanism under the seat
        seat = bm_box(bm, (-0.26, -0.25, SEAT_TOP - 0.09 - lift), (0.26, 0.25, SEAT_TOP - lift), 0)
        bmesh.ops.bevel(bm, geom=[e for e in bm.edges if all(v in seat['verts'] for v in e.verts)], offset=0.025, segments=2, affect='EDGES')
        # Back: a spine from under the seat and one padded slab curving back above the lumbar.
        bm_beam(bm, (0, 0.1, 0.03), (0, 0.3, 0.06), 0.05, 1)
        bm_beam(bm, (0, 0.3, 0.06), (0, 0.31, 0.32), 0.05, 1)
        profile = ((0.27, 0.29), (0.42, 0.27), (0.62, 0.29), (0.8, 0.33), (0.93, 0.37))   # (height, front face y)
        rows = [[bm.verts.new((x, y + dy, z)) for x, dy in ((-0.23, 0), (0.23, 0), (0.23, 0.07), (-0.23, 0.07))] for z, y in profile]
        for a, b in zip(rows, rows[1:]):
            for k in range(4):
                n = (k + 1) % 4
                bm.faces.new((a[k], a[n], b[n], b[k])).material_index = 0
        bm.faces.new(list(reversed(rows[0]))).material_index = 0
        bm.faces.new(rows[-1]).material_index = 0
        # Arms: a post and a pad each side.
        for side in (-1, 1):
            bm_beam(bm, (side * 0.2, 0.05, SEAT_TOP - 0.1 - lift), (side * 0.29, 0.02, SEAT_TOP + 0.18 - lift), 0.03, 1)
            bm_box(bm, (side * 0.29 - 0.04, -0.14, SEAT_TOP + 0.18 - lift), (side * 0.29 + 0.04, 0.14, SEAT_TOP + 0.21 - lift), 1)
    upper_mesh = mesh('Chair_Upper', upper, [m['fabric'], m['plastic']], 35)
    # Larger about the seat's top: the seat keeps its height, the cushion, back and arms grow round it.
    seat_top = Vector((0, 0, SEAT_TOP - LIFT_TOP))
    upper_mesh.transform(Matrix.Translation(seat_top) @ Matrix.Diagonal((CHAIR_SCALE, CHAIR_SCALE, CHAIR_SCALE, 1.0)) @ Matrix.Translation(-seat_top))
    upper_obj = obj('ChairUpper', upper_mesh, chair, (0, 0, LIFT_TOP))
    # Where the hips go: the seat's top centre, facing forward (Blender -Y), like the room chair's seat anchor.
    room.anchor('OfficeChair_Seat', (0, 0.02 * CHAIR_SCALE, SEAT_TOP - LIFT_TOP), upper_obj, 0.0, seat='office', stand_offset=SEAT_STAND_OFFSET)
    # The arm pads' tops, where the rider's hands rest (Blender -X is the rider's right: the rider faces -Y).
    for side, name in ((-1, 'right'), (1, 'left')):
        room.anchor(f'ChairArmrest_{name}', (side * 0.29 * CHAIR_SCALE, 0, SEAT_TOP - LIFT_TOP + 0.21 * CHAIR_SCALE), upper_obj, 0.0, armrest=name)
    build_bottles(m, upper_obj)
    return chair


# A contour soda bottle, lying with its mouth backwards: half its outline traced from the user's silhouette, as
# (height from the base, radius), both as fractions of its length, and turned round its axis. LENGTH is its size on the chair.
BOTTLE_PROFILE = [
    (0.0, 0.0), (0.02, 0.114), (0.07, 0.147), (0.22, 0.121), (0.32, 0.13), (0.44, 0.143), (0.54, 0.143),
    (0.62, 0.129), (0.7, 0.111), (0.78, 0.08), (0.86, 0.063), (0.92, 0.06), (0.935, 0.07), (1.0, 0.046), (1.0, 0.0),
]
BOTTLE = {'length': 0.46, 'x': 0.45, 'z': 0.31, 'base': -0.2, 'fill': 0.62}


def bm_lathe_y(bm, profile, segments=12, material=0):
    """Turn a (height, radius) profile round Blender Y: height along +Y from 0."""
    rings = []
    for h, r in profile:
        if r < 1e-6:
            rings.append([bm.verts.new((0, h, 0))])
        else:
            rings.append([bm.verts.new((math.cos(k / segments * math.tau) * r, h, math.sin(k / segments * math.tau) * r)) for k in range(segments)])
    for a, b in zip(rings, rings[1:]):
        for k in range(segments):
            n = (k + 1) % segments
            if len(a) == 1:
                face = (a[0], b[n], b[k])
            elif len(b) == 1:
                face = (a[k], a[n], b[0])
            else:
                face = (a[k], a[n], b[n], b[k])
            bm.faces.new(face).material_index = material


def build_bottles(m, upper):
    """Two contour cola bottles strapped under the arms, lying along the seat with their mouths backwards (Blender +Y):
    the nitro. The clear glass, the dark cola inside up to the shoulders (its origin at the base, scaled along Y by the
    viewer as it empties), a cap that pops off and an anchor at the mouth where the spray comes out. Shared meshes;
    positions are in ChairUpper's space."""
    length, base = BOTTLE['length'], BOTTLE['base']
    glass = [(h * length, r * length) for h, r in BOTTLE_PROFILE]
    # The cola: a simpler outline a little inside the glass, up to where the shoulders narrow.
    cola = [(h * length, r * length * 0.9) for h, r in ((0.0, 0.0), (0.03, 0.12), (0.08, 0.145), (0.5, 0.14), (BOTTLE['fill'], 0.128), (BOTTLE['fill'], 0.0))]
    shell_mesh = mesh('Chair_Bottle', lambda bm: bm_lathe_y(bm, glass, 10), [m['pet']], 50)
    liquid_mesh = mesh('Chair_BottleLiquid', lambda bm: bm_lathe_y(bm, cola, 8), [m['cola']], 50)
    lip = 0.07 * length
    cap_mesh = mesh('Chair_BottleCap', lambda bm: bm_cylinder(bm, (0, 0, 0), lip, 0.022, 8, 0, 'Y'), [m['red']], 40)
    strap_mesh = mesh('Chair_BottleStrap', lambda bm: (bm_box(bm, (-0.08, -0.015, -0.012), (0.08, 0.015, 0.012), 0),), [m['plastic']])
    for side, name in ((-1, 'right'), (1, 'left')):
        x, z = side * BOTTLE['x'], BOTTLE['z']
        obj(f'ChairBottle_{name}', shell_mesh, upper, (x, base, z), bottle=name)
        obj(f'ChairBottleLiquid_{name}', liquid_mesh, upper, (x, base, z), liquid=name)
        obj(f'ChairBottleCap_{name}', cap_mesh, upper, (x, base + length + 0.008, z), cap=name)
        room.anchor(f'ChairNozzle_{name}', (x, base + length + 0.025, z), upper, 0.0, nozzle=name)
        # Straps round the belly to the arm post, front and back.
        for y in (0.08, 0.24):
            obj(f'ChairBottleStrap_{name}_{"F" if y < 0.2 else "B"}', strap_mesh, upper, (side * (BOTTLE['x'] - 0.07), base + y, z))


# ------------------------------------------------------------------ sandbags

# One sack (half length along X, half width, half height) and how much a sack of the top row sags into the gap
# between the two it rests on. Two shared meshes, placed as children of each sandbag wall (the GLB keeps one copy).
SACK = (0.25, 0.16, 0.12)
SACK_SAG = 0.03


def sack_mesh(name, mats, sag):
    """A filled burlap sack: a plump pillow body (squarish in plan, lens-shaped across, pinched to a seam round its
    middle), thinner towards its ends, the +X end gathered and tied into a little tuft (material 1), a flattened
    underside where it rests and, for the top row, a sag in the middle. Smooth shaded, about 200 triangles."""
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=18, v_segments=10, radius=1.0)
    signed = lambda value, exponent: math.copysign(abs(value) ** exponent, value)
    a, b, h = SACK
    for v in bm.verts:
        lat = math.atan2(v.co.z, math.hypot(v.co.x, v.co.y))
        lon = math.atan2(v.co.y, v.co.x)
        x = signed(math.cos(lat), 0.9) * signed(math.cos(lon), 0.4)
        y = signed(math.cos(lat), 0.9) * signed(math.sin(lon), 0.55)
        z = signed(math.sin(lat), 1.1)
        z *= 1 - 0.4 * abs(x) ** 4          # the filling slumps towards the ends
        y *= 1 - 0.12 * abs(x) ** 6
        if x > 0.72:                         # gathered and tied at +X
            t = (x - 0.72) / 0.28
            y *= 1 - 0.75 * t
            z *= 1 - 0.7 * t
            x += 0.22 * t * t
        co = Vector((x * a, y * b, z * h))
        if co.z < -0.6 * h:                  # flattened where it rests
            co.z = -0.6 * h + (co.z + 0.6 * h) * 0.25
        co.z -= sag * (1 - min(1.0, abs(x)) ** 2)
        v.co = co
    for face in bm.faces:
        face.smooth = True
        face.material_index = 1 if all(v.co.x > a * 0.97 for v in face.verts) else 0
    return proto_mesh(name, bm, mats)


def sandbag_wall(wall, meshes, seed=0):
    """Five sacks side by side along the wall's X with four on top over the gaps, each turned a little, the end ones
    with their tied ends outwards; children of the decor object `wall`."""
    rng = random.Random(seed)
    h = SACK[2]
    # A bottom sack's flattened underside is 0.7 h below its centre; a top sack's slimmer ends rest on the middles of
    # the two below it (their tops h above their centres), its sagging middle dipping into the gap between them.
    rows = ((5, 0.7 * h, 'sack'), (4, 0.7 * h + h + 0.6 * h + 0.004, 'sack_top'))
    k = 0
    for count, z, kind in rows:
        for i in range(count):
            x = (i - (count - 1) / 2) * 0.5 + rng.uniform(-0.02, 0.02)
            # The end sacks show their tied ends outwards; the others alternate (tucked against a neighbour).
            outwards = 0.0 if i == count - 1 else (math.pi if i == 0 or (i + k) % 2 else 0.0)
            bag = obj(f'{wall.name}_Bag{k}', meshes[kind], wall, (x, rng.uniform(-0.025, 0.025), z), outwards + rng.uniform(-0.08, 0.08))
            bag.rotation_euler.x = rng.uniform(-0.03, 0.03)
            k += 1


# ------------------------------------------------------------------ the pieces and fixed things

def build_meshes(m):
    meshes = {}

    def ramp(bm, length, width, height, legs=True):
        # Planks along the width, the slope rising towards Blender -Y (three.js +Z), side boards and trestles.
        planks = 6
        for k in range(planks):
            y0 = length / 2 - k * length / planks
            y1 = y0 - length / planks + 0.02
            p = bm_box(bm, (-width / 2, y1, -0.04), (width / 2, y0, 0.0), 0)
            for v in p['verts']:
                v.co.z += height * (length / 2 - v.co.y) / length
        for side in (-1, 1):
            xs = side * (width / 2 + 0.02)
            bm_prism(bm, [(length / 2, 0.0), (-length / 2, 0.0), (-length / 2, height - 0.04)], xs - 0.02, xs + 0.02, 1)
        if legs:
            for side in (-1, 1):
                bm_beam(bm, (side * (width / 2 - 0.15), -length / 2 + 0.1, 0), (side * (width / 2 - 0.15), -length / 2 + 0.1, height - 0.05), 0.08, 1)
            bm_beam(bm, (-width / 2 + 0.15, -length / 2 + 0.1, height * 0.5), (width / 2 - 0.15, -length / 2 + 0.1, height * 0.5), 0.06, 1)
    meshes['ramp'] = mesh('Circuit_Ramp', lambda bm: ramp(bm, *RAMP), [m['wood'], m['wood_dark']])
    meshes['jump'] = mesh('Circuit_Jump', lambda bm: ramp(bm, *JUMP), [m['wood'], m['wood_dark']])
    meshes['bump'] = mesh('Circuit_Bump', lambda bm: bm_prism(bm, [(BUMP[0] / 2, 0), (-BUMP[0] / 2, 0), (-0.05, BUMP[2]), (0.05, BUMP[2])], -BUMP[1] / 2, BUMP[1] / 2, 0), [m['wood']])
    meshes['jersey'] = mesh('Circuit_Jersey', lambda bm: bm_prism(bm, [(0.3, 0), (0.3, 0.08), (0.12, 0.3), (0.08, 0.8), (-0.08, 0.8), (-0.12, 0.3), (-0.3, 0.08), (-0.3, 0)], -1.0, 1.0, 0), [m['concrete']])

    meshes['sack'] = sack_mesh('Circuit_Sandbag', [m['burlap'], m['tie']], sag=0.0)
    meshes['sack_top'] = sack_mesh('Circuit_SandbagTop', [m['burlap'], m['tie']], sag=SACK_SAG)

    def pallet(bm):
        for k in range(5):
            x = -0.5 + 0.1 + k * 0.2
            bm_box(bm, (x - 0.07, -0.6, 0.11), (x + 0.07, 0.6, 0.135), 0)
        for x in (-0.42, 0, 0.42):
            bm_box(bm, (x - 0.05, -0.6, 0.025), (x + 0.05, 0.6, 0.11), 1)
        for y in (-0.5, 0, 0.5):
            bm_box(bm, (-0.5, y - 0.05, 0.0), (0.5, y + 0.05, 0.025), 0)
        for v in bm.verts:
            v.co.z -= 0.0675
    meshes['pallet'] = mesh('Prop_Pallet', pallet, [m['wood'], m['wood_dark']])

    def brick(bm):
        bm_box(bm, (-out.BRICK_W / 2, -out.BRICK_D / 2, -out.BRICK_H / 2), (out.BRICK_W / 2, out.BRICK_D / 2, out.BRICK_H / 2), 0)
    meshes['brick'] = mesh('Prop_CircuitBrick', brick, [m['brick']])
    meshes['cone'] = out.cone_mesh(m['orange'], m['white'])

    def pipe(bm):
        bm_tube(bm, 0.45, 0.36, 1.2, 12, 0)
    meshes['pipe'] = mesh('Prop_Pipe', pipe, [m['concrete_dark']])

    def drum(bm):
        bm_cylinder(bm, (0, 0, 0), 0.3, 0.88, 10, 0)
        for zc in (-0.15, 0.2):
            bm_cylinder(bm, (0, 0, zc), 0.305, 0.08, 10, 1)
    meshes['drum'] = mesh('Prop_Drum', drum, [m['orange'], m['white']], 50)

    def barrow(bm):
        tray = bm_box(bm, (-0.3, -0.45, 0.25), (0.3, 0.25, 0.55), 0)
        for v in tray['verts']:
            if v.co.z < 0.3:
                v.co.x *= 0.65
                v.co.y = v.co.y * 0.7 - 0.05
        mound = bmesh.ops.create_icosphere(bm, subdivisions=1, radius=1.0)
        for v in mound['verts']:
            v.co = Vector((v.co.x * 0.26, v.co.y * 0.33 - 0.1, max(v.co.z, 0) * 0.1 + 0.53))
        set_mat(mound, 2)
        bm_cylinder(bm, (0, -0.58, 0.16), 0.16, 0.08, 10, 3, 'X')
        for side in (-1, 1):
            bm_beam(bm, (side * 0.12, -0.58, 0.16), (side * 0.25, 0.75, 0.48), 0.035, 1)
            bm_beam(bm, (side * 0.2, 0.25, 0.3), (side * 0.2, 0.25, 0.0), 0.035, 1)
        for v in bm.verts:
            v.co.z -= 0.3
    meshes['barrow'] = mesh('Prop_Barrow', barrow, [m['green'], m['steel'], m['sand'], m['rubber']])

    def metal_fence(bm):
        w, h = 2.2, 1.0
        for a, b in (((-w / 2, 0, 0.15), (-w / 2, 0, h)), ((w / 2, 0, 0.15), (w / 2, 0, h)), ((-w / 2, 0, h), (w / 2, 0, h)), ((-w / 2, 0, 0.2), (w / 2, 0, 0.2))):
            bm_beam(bm, a, b, 0.04, 0)
        for k in range(1, 8):
            x = -w / 2 + k * w / 8
            bm_beam(bm, (x, 0, 0.2), (x, 0, h), 0.012, 0)
        for zc in (0.47, 0.73):
            bm_beam(bm, (-w / 2, 0, zc), (w / 2, 0, zc), 0.012, 0)
        for x in (-w / 2, w / 2):
            bm_box(bm, (x - 0.1, -0.25, 0.0), (x + 0.1, 0.25, 0.15), 1)
        for v in bm.verts:
            v.co.z -= h / 2
    meshes['metal'] = mesh('Prop_MetalFence', metal_fence, [m['steel'], m['concrete']])

    def chevron(bm):
        bm_box(bm, (-0.2, -0.2, 0.0), (0.2, 0.2, 0.08), 2)
        bm_cylinder(bm, (0, 0.03, 0.5), 0.025, 0.85, 6, 2)
        bm_box(bm, (-0.3, -0.02, 0.85), (0.3, 0.01, 1.25), 0)
        for k in (-0.1, 0.1):
            bm_beam(bm, (k - 0.07, -0.03, 0.95), (k + 0.07, -0.03, 1.05), 0.045, 1)
            bm_beam(bm, (k + 0.07, -0.03, 1.05), (k - 0.07, -0.03, 1.15), 0.045, 1)
        for v in bm.verts:
            v.co.z -= 0.625
    meshes['chevron'] = mesh('Prop_Chevron', chevron, [m['yellow'], m['black'], m['concrete']])

    def works(bm):
        bm_box(bm, (-0.2, -0.2, 0.0), (0.2, 0.2, 0.08), 2)
        bm_cylinder(bm, (0, 0.03, 0.5), 0.025, 0.85, 6, 2)
        tri = [(-0.38, 0.8), (0.38, 0.8), (0.0, 1.46)]
        lo = [bm.verts.new((x, -0.02, z)) for x, z in tri]
        hi = [bm.verts.new((x, 0.01, z)) for x, z in tri]
        bm.faces.new(lo).material_index = 0
        bm.faces.new(list(reversed(hi))).material_index = 0
        for k in range(3):
            n = (k + 1) % 3
            bm.faces.new((lo[n], lo[k], hi[k], hi[n])).material_index = 1
        bm_box(bm, (-0.03, -0.03, 0.95), (0.03, -0.02, 1.2), 1)
        bm_box(bm, (-0.03, -0.03, 0.88), (0.03, -0.02, 0.92), 1)
        for v in bm.verts:
            v.co.z -= 0.73
    meshes['works'] = mesh('Prop_WorksSign', works, [m['yellow'], m['black'], m['concrete']])

    meshes['tyre'] = mesh('Prop_Tyre', lambda bm: bm_torus(bm, 0.3, 0.12, 12, 6, 0), [m['rubber']], 50)

    def tyre_row(bm):
        for k in range(4):
            bm_torus(bm, 0.3, 0.12, 12, 6, 0, 0.12)
            for v in bm.verts[-72:]:
                v.co.x += (k - 1.5) * 0.66
    meshes['tyres'] = mesh('Circuit_TyreRow', tyre_row, [m['rubber']], 50)

    def fence_leg(bm):
        for side in (-1, 1):
            bm_beam(bm, (0, side * 0.32, 0.0), (0, side * 0.04, 1.0), 0.05, 0)
        bm_beam(bm, (0, -0.25, 0.25), (0, 0.25, 0.25), 0.035, 0)
        for v in bm.verts:
            v.co.z -= 0.5
    meshes['leg'] = mesh('Prop_FenceLeg', fence_leg, [m['wood_dark']])

    def fence_plank(bm):
        stripes = 6
        for k in range(stripes):
            x0 = -1.0 + k * 2.0 / stripes
            bm_box(bm, (x0, -0.015, -0.075), (x0 + 2.0 / stripes, 0.015, 0.075), k % 2)
    meshes['plank'] = mesh('Prop_FencePlank', fence_plank, [m['red'], m['white']])

    def tape_post(bm):
        bm_cylinder(bm, (0, 0, 0.03), 0.16, 0.06, 8, 1)
        bm_cylinder(bm, (0, 0, 0.5), 0.03, 0.9, 6, 0)
        bm_cylinder(bm, (0, 0, 0.92), 0.035, 0.1, 6, 2)
    meshes['post'] = mesh('Circuit_TapePost', tape_post, [m['white'], m['black'], m['red']])
    return meshes


def build_arch(m, root, name, i):
    """Scaffold arch over the road: two towers and a checkered banner on top."""
    width = CIRCUIT_WIDTH + 0.9
    top = 3.3
    def build(bm):
        for side in (-1, 1):
            cx = side * (width / 2)
            # A scaffold tower: base plates, four standards, ledgers round it at three heights and a brace on each face.
            for dx in (-0.25, 0.25):
                for dy in (-0.25, 0.25):
                    bm_box(bm, (cx + dx - 0.09, dy - 0.09, 0.0), (cx + dx + 0.09, dy + 0.09, 0.03), 3)
                    bm_beam(bm, (cx + dx, dy, 0.03), (cx + dx, dy, top), 0.055, 0)
            for z in (0.18, 1.7, top - 0.06):
                for dy in (-0.25, 0.25):
                    bm_beam(bm, (cx - 0.25, dy, z), (cx + 0.25, dy, z), 0.04, 0)
                for dx in (-0.25, 0.25):
                    bm_beam(bm, (cx + dx, -0.25, z), (cx + dx, 0.25, z), 0.04, 0)
            for dy in (-0.25, 0.25):
                bm_beam(bm, (cx - 0.25, dy, 0.18), (cx + 0.25, dy, 1.7), 0.03, 0)
                bm_beam(bm, (cx + 0.25, dy, 1.7), (cx - 0.25, dy, top - 0.06), 0.03, 0)
            for dx in (-0.25, 0.25):
                bm_beam(bm, (cx + dx, -0.25, 0.18), (cx + dx, 0.25, 1.7), 0.03, 0)
                bm_beam(bm, (cx + dx, 0.25, 1.7), (cx + dx, -0.25, top - 0.06), 0.03, 0)
        # The top beam rests on both towers, reaching over their outer sides; the banner hangs from it.
        bm_box(bm, (-width / 2 - 0.35, -0.3, top), (width / 2 + 0.35, 0.3, top + 0.14), 0)
        for x in (-width / 2 + 0.3, width / 2 - 0.3):
            bm_beam(bm, (x, 0, top), (x, 0, top - 0.7), 0.04, 0)
        cols, rows = 12, 2
        for c in range(cols):
            for r in range(rows):
                x0 = -width / 2 + 0.3 + c * (width - 0.6) / cols
                bm_box(bm, (x0, -0.02, top - 0.7 + r * 0.34), (x0 + (width - 0.6) / cols, 0.02, top - 0.7 + (r + 1) * 0.34), 1 + (c + r) % 2)
    if 'arch' not in MESHES:
        MESHES['arch'] = mesh('Circuit_Arch', build, [m['steel'], m['white'], m['black'], m['concrete_dark']])
    data = MESHES['arch']
    x, z = road(i)
    yaw = yaw_along(i)
    arch = decor(name, data, (x, z), yaw, root, 'arch', (width + 0.6, 0.8))
    # Its legs block the character; the road between them stays open.
    for side in (-1, 1):
        lx, lz = road(i, side * width / 2)
        bx, by, _ = at((lx, lz))
        room.collider(f'{name}_{"L" if side < 0 else "R"}', (bx - 0.3, by - 0.3, GROUND_Z), (bx + 0.3, by + 0.3, GROUND_Z + 3.4), root)
    return arch


MESHES = {}


def build(root):
    m = palette()
    meshes = build_meshes(m)
    pieces = room.anchor('CircuitPieces', (0, 0, 0), root)
    fixed = room.anchor('CircuitDecor', (0, 0, 0), root)
    count = {}

    def loose(kind, data, point, height, yaw, mass, box, **shape):
        count[kind] = count.get(kind, 0) + 1
        return piece(f'Circuit_{kind}_{count[kind]:02d}', data, point, height, yaw, pieces, prop=kind, group='circuit', mass=mass, box=box, **shape)

    def fixed_thing(kind, data, point, yaw, shadow, solid=None, **extras):
        count[kind] = count.get(kind, 0) + 1
        o = decor(f'Circuit_{kind}_{count[kind]:02d}', data, point, yaw, fixed, kind, shadow, solid)
        for key, value in extras.items():
            o[key] = value
        return o

    # Start and finish.
    build_arch(m, fixed, 'Arch_Start', 4)
    build_arch(m, fixed, 'Arch_Finish', N - 3)
    for name, i in (('Floor_StartLine', 4), ('Floor_FinishLine', N - 3)):
        room.anchor(name, at(road(i)), root, yaw_along(i), floor='checker', size=[CIRCUIT_WIDTH, 0.8])
    build_chair(m, root)
    # The arrow's block runs from behind the chair to past it, so the lines round the chair fit too.
    cx, cz = road(1)
    hint = (cx - 2.05, cz + 1.15)
    room.anchor('Floor_ChairHint', at(hint), root, 0.0, floor='chairhint', size=[8.0, 6.1], targets=list(road(1)))
    # Back from the start arch's leg, which stood over it.
    zx, zz = road(2, -(HALF + 1.6))
    zone = (zx - 3.4, zz - 0.8)
    room.anchor('Zone_Circuit', at(zone), root, 0.0, zone='reset', target='circuit', area=list(out.RESET_AREA))

    # Traffic light and lap board by the start.
    def light(bm):
        bm_box(bm, (-0.2, -0.2, 0.0), (0.2, 0.2, 0.08), 0)
        bm_cylinder(bm, (0, 0, 1.2), 0.05, 2.3, 8, 0)
        bm_box(bm, (-0.16, -0.12, 2.0), (0.16, 0.1, 2.85), 1)
    lx, lz = road(6, HALF + 0.9)
    traffic = fixed_thing('light', mesh('Circuit_TrafficLight', light, [m['steel'], m['black']]), (lx, lz), 0.0, (0.6, 0.6), (0.4, 2.9, 0.4))
    traffic.name = 'TrafficLight'
    lens = mesh('Circuit_Lens', lambda bm: (bm_cylinder(bm, (0, 0, 0), 0.075, 0.04, 10, 0, 'Y'),), [m['lens'][0]])
    for k in range(3):
        data = lens.copy()
        data.materials[0] = m['lens'][k]
        obj(f'TrafficLight_Lens_{k}', data, traffic, (0, -0.13, 2.7 - k * 0.27))

    def lap_board(bm):
        for x in (-0.75, 0.75):
            bm_beam(bm, (x, 0, 0), (x, 0, 1.0), 0.07, 1)
        bm_box(bm, (-0.85, -0.04, 1.0), (0.85, 0.04, 1.95), 0)
    bx, bz = road(8, -(HALF + 1.4))
    board = fixed_thing('lapboard', mesh('Circuit_LapBoard', lap_board, [m['board'], m['steel']]), (bx, bz), 0.0, (1.9, 0.5), (1.8, 2.0, 0.2))
    board.name = 'LapBoard'
    board['board'] = [1.7, 0.95, 1.0]

    # Wooden ramps, the double jump and the plank bumps: fixed, the ground rises along them.
    for i in (20, 128):
        fixed_thing('ramp', meshes['ramp'], road(i), yaw_along(i), (RAMP[1] + 0.3, RAMP[0]), None, ramp=list(RAMP), profile='up')
    up, down = road(58, 0, -2.0), road(58, 0, 2.0)
    fixed_thing('ramp', meshes['jump'], up, yaw_along(58), (JUMP[1] + 0.3, JUMP[0]), None, ramp=list(JUMP), profile='up')
    fixed_thing('ramp', meshes['jump'], down, yaw_along(58, math.pi), (JUMP[1] + 0.3, JUMP[0]), None, ramp=list(JUMP), profile='up')
    for along in (-1.95, -0.65, 0.65, 1.95):
        fixed_thing('ramp', meshes['bump'], road(118, 0, along), yaw_along(118), (0.1, 0.1), None, ramp=list(BUMP), profile='bump')

    # Building-site obstacles.
    for k, i in enumerate(range(76, 88, 2)):
        fixed_thing('jersey', meshes['jersey'], road(i, 1.3 if k % 2 else -1.3), yaw_along(i, QUARTER), (2.2, 0.8), (2.0, 0.8, 0.6))
    for i in (92, 106):
        wall = fixed_thing('sandbags', None, road(i, outer(i) * (HALF + 0.6)), yaw_along(i, QUARTER), (2.8, 0.8), (2.6, 0.4, 0.45))
        sandbag_wall(wall, meshes, seed=i)
    for i, side, layers in ((46, -1, 3), (50, 1, 2), (140, -1, 2), (144, -1, 3)):
        point = road(i, side * (HALF + 0.8))
        for layer in range(layers):
            loose('pallet', meshes['pallet'], point, 0.0675 + layer * 0.14, yaw_along(i, QUARTER), MASS['pallet'], [1.0, 0.135, 1.2])
    for i, side in ((124, 1.9), (70, -1.8)):
        cx, cz = road(i, side)
        yaw = yaw_along(i, QUARTER)
        for layer, row in enumerate((3, 2, 1)):
            for b in range(row):
                dx = (b - (row - 1) / 2) * (out.BRICK_W + 0.01)
                px, pz = cx + math.cos(yaw) * dx, cz - math.sin(yaw) * dx
                loose('brick', meshes['brick'], (px, pz), out.BRICK_H / 2 + layer * (out.BRICK_H + 0.002), yaw, MASS['brick'], [out.BRICK_W, out.BRICK_H, out.BRICK_D])
    for i in (25, 133):
        p = loose('pipe', meshes['pipe'], road(i, outer(i) * (HALF + 0.9)), 0.45, yaw_along(i), MASS['pipe'], [0.9, 0.9, 1.2],
                  cylinders=[0.45, 1.2, 0.0])
        p.rotation_euler = (QUARTER, 0.0, yaw_along(i))
    for k, i in enumerate(range(100, 106)):
        loose('drum', meshes['drum'], road(i, 1.6 if k % 2 else -1.6), 0.44, 0.0, MASS['drum'], [0.6, 0.88, 0.6], cylinders=[0.3, 0.88, 0.0])
    loose('barrow', meshes['barrow'], road(147, -(HALF + 0.9)), 0.3, yaw_along(147), MASS['barrow'], [0.6, 0.6, 1.4])

    # Fences: wooden ones break into planks, metal ones fall over whole.
    for f, (i, side) in enumerate(((30, -1.2), (33, 1.2), (36, -1.2), (121, 1.2), (123, -1.2), (150, 0.0))):
        yaw = yaw_along(i)   # across the road
        cx, cz = road(i, side)
        joint = f'WoodFence_{f}'
        for end in (-1, 1):
            dx = end * 0.95
            # The A-frame spreads across the fence (its own Blender Y), so the fence stands on it.
            loose('leg', meshes['leg'], (cx + math.cos(yaw) * dx, cz - math.sin(yaw) * dx), 0.5, yaw, MASS['leg'], [0.1, 1.0, 0.64], joint=joint)
        for k, height in enumerate((0.45, 0.68, 0.91)):
            loose('plank', meshes['plank'], (cx, cz), height, yaw, MASS['plank'], [2.0, 0.15, 0.03], joint=joint)
    for i, side in ((62, 1.0), (64, -1.0), (95, 1.0), (97, -1.0)):
        loose('metal', meshes['metal'], road(i, side), 0.5, yaw_along(i), MASS['metal'], [2.3, 1.0, 0.5])

    # Safety tapes across the road between two posts.
    tapes = room.anchor('Tapes', (0, 0, 0), root)
    length = CIRCUIT_WIDTH + 0.6
    for t, i in enumerate((54, 68, 108, 136)):
        yaw = yaw_along(i)   # across the road
        cx, cz = road(i)
        tape = room.anchor(f'Tape_{t}', at((cx, cz)), tapes, yaw, tape=[length])
        for end, suffix in ((-1, 'L'), (1, 'R')):
            obj(f'Tape_{t}_Post{suffix}', meshes['post'], tape, (end * length / 2, 0, 0))

    # Edges and signs.
    for k, i in enumerate(range(9, 16)):
        loose('cone', meshes['cone'], road(i, 1.7 if k % 2 else -1.7), out.CONE_ORIGIN, 0.0, MASS['cone'], [0.36, 0.54, 0.36],
              cylinders=[round(v, 4) for r, h, c in out.CONE_CYLINDERS for v in (r, h, c - out.CONE_ORIGIN)])
    for i in (88, 89, 90, 94, 126, 127):
        loose('cone', meshes['cone'], road(i, -(HALF - 0.3)), out.CONE_ORIGIN, 0.0, MASS['cone'], [0.36, 0.54, 0.36],
              cylinders=[round(v, 4) for r, h, c in out.CONE_CYLINDERS for v in (r, h, c - out.CONE_ORIGIN)])
    for i in (22, 40, 104, 138):
        side = outer(i) * (HALF + 0.9)
        point = road(i, side)
        yaw = yaw_along(i, QUARTER)
        fixed_thing('tyres', meshes['tyres'], point, yaw, (2.8, 0.8), (2.6, 0.24, 0.6))
        for k in range(3):
            dx = (k - 1) * 0.66
            loose('tyre', meshes['tyre'], (point[0] + math.cos(yaw) * dx, point[1] - math.sin(yaw) * dx), 0.36, yaw, MASS['tyre'], [0.84, 0.24, 0.84],
                  cylinders=[0.42, 0.24, 0.0])
    for i in (27, 38, 43, 66, 99, 130):
        loose('chevron', meshes['chevron'], road(i, outer(i) * (HALF + 1.5)), 0.625, 0.0, MASS['sign'], [0.6, 1.25, 0.4])
    loose('works', meshes['works'], road(149, -(HALF + 1.0)), 0.73, 0.0, MASS['sign'], [0.76, 1.46, 0.4])
    build_end_wall(m, meshes, pieces, root)
    root['counts'] = ','.join(f'{k}:{v}' for k, v in sorted(count.items()))


def build_end_wall(m, meshes, parent, root):
    """Past the end of the road: a running-bond brick wall across it (STOP is sprayed on it, src/scene/graffitiData.ts)
    and a small stepped wall beside it along the road, both loose bricks of group 'wall' that can be knocked down
    (Restablecer puts them back; there is no reset zone)."""
    dark = mesh('Prop_CircuitBrickDark', lambda bm: bm_box(bm, (-out.BRICK_W / 2, -out.BRICK_D / 2, -out.BRICK_H / 2),
                                                          (out.BRICK_W / 2, out.BRICK_D / 2, out.BRICK_H / 2), 0),
                [room.material('CircuitBrickDark', (0.55, 0.22, 0.16), 0.9)])
    rng = random.Random(7)
    pitch = out.BRICK_W + 0.01
    count = 0

    def brick(point, layer, yaw):
        nonlocal count
        piece(f'Wall_Brick_{count:03d}', dark if rng.random() < 0.3 else meshes['brick'], point,
              out.BRICK_H / 2 + layer * (out.BRICK_H + 0.002), yaw + rng.uniform(-0.015, 0.015), parent,
              prop='brick', group='wall', mass=MASS['brick'], box=[out.BRICK_W, out.BRICK_H, out.BRICK_D])
        count += 1

    # Across the road (along +X, its face towards the camera), every other layer one brick shorter and half a brick in.
    x0, z0 = END_WALL
    for layer in range(END_WALL_LAYERS):
        row = END_WALL_BRICKS - layer % 2
        for b in range(row):
            brick((x0 + (b - (row - 1) / 2) * pitch, z0), layer, 0.0)
    # Beside it, along the road (+Z, its face towards +X): a stepped pyramid.
    x0, z0 = STEP_WALL
    for layer, row in enumerate(STEP_WALL_ROWS):
        for b in range(row):
            brick((x0, z0 + (b - (row - 1) / 2) * pitch), layer, QUARTER)


def export_glb(root):
    bpy.ops.object.select_all(action='DESELECT')
    for o in [root, *root.children_recursive]:
        o.select_set(True)
    bpy.context.view_layer.objects.active = root
    bpy.ops.export_scene.gltf(filepath=str(GLB), export_format='GLB', use_selection=True, export_apply=True,
                              export_yup=True, export_extras=True, export_cameras=False, export_lights=False,
                              export_animations=False, **room.WEB_IMAGES)
    print(f'Circuit GLB: {GLB} ({GLB.stat().st_size} bytes)')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--replace-generated', action='store_true')
    args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else [])
    if (BLEND.exists() or GLB.exists()) and not args.replace_generated:
        raise RuntimeError('Circuit outputs exist. Review them before using --replace-generated.')
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.scene.unit_settings.system = 'METRIC'
    root = bpy.data.objects.new('Circuit', None)
    bpy.context.collection.objects.link(root)
    root['stage'] = '13-circuit'
    build(root)
    BLEND.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=str(BLEND), compress=True)
    export_glb(root)


if __name__ == '__main__':
    main()
