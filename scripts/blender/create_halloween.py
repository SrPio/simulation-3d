"""The Halloween dress-up of the room page (src/core/halloween.ts): everything only shown from 1 October to 5 November or
with ?halloween=1. Builds assets/blender/halloween.blend and public/models/halloween.glb, which the viewer loads with
the outside only while the dress-up is on. The textures come from assets/textures/halloween/ (atlas.png and the glow
of the carved faces, glow.png; scripts/halloween_atlas.ts).

- `HalloweenWorld`: read with the outside like circuit.glb.
  - Loose pieces of group 'halloween' (extras `prop`, `group`, `mass`, the collision shape `box`/`cylinders`): carved and
    plain pumpkins of three sizes, big spiders and gravestones with developers' epitaphs (a small graveyard by the park).
  - Fixed: the graveyard's low iron fence (decor `graveyard`, blob `shadow`, `solid`, `Collider_*`) and cobwebs (plain
    meshes, merged with the outside): in the room's back corner, under a sign, in the corners of the punching bags' gantry
    and on the graveyard fence.
- `HalloweenMask`: Jason Voorhees' hockey mask, modelled over the web V4 head in the character's own frame (feet at Z=0,
  facing -Y; public/models/developer-v4-interactions.glb is read for the face's shape): a shell a couple of centimetres
  off the face, eye holes, breathing holes, three red chevrons, rivets and the black strap round the back of the head
  under the cap. The viewer hangs it on the `head` bone.
- `HalloweenCauldron`: the ride that replaces the office chair: a black iron cauldron with a glowing green brew, its
  origin on the ground under the middle, facing -Y (three.js +Z). `CauldronGrip_<side>` on the rim where the rider's
  hands rest; two test tubes strapped to the sides (`CauldronTube_<side>`, the brew `CauldronTubeLiquid_<side>` with its
  origin at the tube's bottom so the viewer scales it along the tube, `CauldronTubeCork_<side>`, `CauldronNozzle_<side>`
  at the mouth). `brew` [height of the brew's surface, rim radius] on the root.
- `HalloweenLibrary`: meshes the viewer uses as they are: the bowling pin as a pumpkin (`Halloween_Pin`), the ball as
  an eye (`Halloween_Ball`), three dark bricks (`Halloween_Brick<i>`), each with the same size as the piece it dresses;
  the pumpkin thrown instead of the laptop (`ThrownPumpkin`), a piece of its shell (`PumpkinShard`), three candies
  (`Candy_Wrapped`, `Candy_Lollipop`, `Candy_Gummy`, white: the viewer colours each one), a bat and a little ghost.

Run: blender --background --factory-startup --python-exit-code 1 --python scripts/blender/create_halloween.py [-- --replace-generated] [--render]
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
from create_outside import (BALL_RADIUS, BLOCK_YAW, BRICK_D, BRICK_H, BRICK_W, GROUND_Z, PIN_ORIGIN, PIN_PROFILE, at, bm_box,
                            decor, piece, proto_mesh)

ROOT = Path(__file__).resolve().parents[2]
BLEND = ROOT / 'assets' / 'blender' / 'halloween.blend'
GLB = ROOT / 'public' / 'models' / 'halloween.glb'
TEXTURES = ROOT / 'assets' / 'textures' / 'halloween'
CHARACTER = ROOT / 'public' / 'models' / 'developer-v4-interactions.glb'
RENDERS = ROOT / 'assets' / 'renders' / 'halloween'

# The atlas (scripts/halloween_atlas.ts): cells in rows of ATLAS_COLUMNS.
CELLS = ['pin', 'eye', 'stone0', 'stone1', 'stone2', 'jack', 'pumpkin', 'grave0', 'grave1', 'grave2', 'grave3', 'grave4', 'ember']
ATLAS_COLUMNS, ATLAS_ROWS = 4, 4
INSET = 0.012    # keeps the UVs off the cell edges (texture filtering would pick up the neighbour)

# Pumpkins: radius across, height (squat) and mass; the carved ones glow.
PUMPKINS = {'small': (0.27, 0.46, 4.0), 'medium': (0.4, 0.66, 8.0), 'large': (0.52, 0.84, 14.0)}
SPIDER = {'span': 0.95, 'height': 0.36, 'mass': 2.0}
GRAVE = {'width': 0.64, 'height': 0.96, 'depth': 0.16, 'mass': 40.0}
GRAVEYARD = (-8.0, 11.0)          # the graves' middle, between the park and the controls panel, off the paths
THROWN_RADIUS = 0.17              # the pumpkin in the hand (about the laptop's reach)
# Brew: the rim's height and radius; the green surface just under the rim, which hides the rider's legs.
CAULDRON = {'rim': 1.02, 'radius': 0.55, 'belly': 0.63, 'brew': 0.95, 'legs': 0.12}
# Test tubes lying along the cauldron's sides like the chair's soda bottles: closed end ahead (Blender -Y), mouth behind.
TUBE = {'length': 0.58, 'radius': 0.062, 'x': 0.75, 'front': -0.27, 'height': 0.56}

# (three.js x, z, size, carved, yaw): round the room's front, on the intro, round the crossroads green, the plaza,
# the playground, the boxing corner, the graveyard and the work site.
PUMPKIN_SPOTS = [
    (3.7, 3.2, 'medium', True, 0.2), (4.4, 2.3, 'small', False, -0.3), (2.6, 4.3, 'small', True, 0.4),
    (6.2, -3.4, 'large', True, 0.1), (12.0, -3.6, 'small', False, 0.5),
    (6.0, 12.8, 'medium', True, 0.3), (14.6, 12.6, 'small', True, -0.2), (10.2, 16.8, 'large', False, 0.6),
    (28.0, 4.8, 'small', True, 0.1), (32.4, 4.8, 'small', True, -0.1), (24.0, 6.6, 'large', True, 0.2), (36.4, 7.0, 'medium', False, -0.4),
    (16.4, 37.0, 'medium', True, 0.2), (26.0, 41.4, 'small', True, 0.0), (30.2, 41.6, 'large', True, -0.2),
    (-6.2, 13.6, 'medium', True, 0.3), (-10.0, 13.5, 'small', True, -0.2), (-3.0, 32.4, 'large', True, 0.2),
]
SPIDER_SPOTS = [(1.6, 4.6, 0.6), (8.4, 12.9, -0.4), (-9.0, 9.4, 2.4), (25.4, 3.6, 0.3), (19.4, 35.2, -2.0), (-1.6, 30.6, 1.2)]
# The graves in two rows (x along the row, z), each with its own epitaph cell.
GRAVE_SPOTS = [(-9.4, 10.2, 0), (-8.0, 10.2, 1), (-6.6, 10.2, 2), (-8.7, 11.8, 3), (-7.3, 11.8, 4)]


def three(x, y, z):
    """three.js world point (y up, x, z on the ground; y over the outside ground) to a Blender location."""
    return Vector((x, -z, GROUND_Z + y))


# ------------------------------------------------------------------ materials

def atlas_material(name, glow=False, roughness=0.6):
    """The atlas as base colour, and for carved faces the glow image as emission (lit from inside)."""
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    shader = nodes['Principled BSDF']
    shader.inputs['Roughness'].default_value = roughness
    texture = nodes.new('ShaderNodeTexImage')
    texture.image = bpy.data.images.load(str(TEXTURES / 'atlas.png'), check_existing=True)
    texture.image.pack()
    links.new(texture.outputs['Color'], shader.inputs['Base Color'])
    if glow:
        light = nodes.new('ShaderNodeTexImage')
        light.image = bpy.data.images.load(str(TEXTURES / 'glow.png'), check_existing=True)
        light.image.pack()
        links.new(light.outputs['Color'], shader.inputs['Emission Color'])
        shader.inputs['Emission Strength'].default_value = 1.0
    return mat


def cell_uv(cell, u, v):
    """Local (u, v) in 0…1 of an atlas cell to the atlas' UV (Blender's v grows upwards; row 0 is the image's top)."""
    index = CELLS.index(cell)
    column, row = index % ATLAS_COLUMNS, index // ATLAS_COLUMNS
    u = INSET + (1 - 2 * INSET) * min(max(u, 0.0), 1.0)
    v = INSET + (1 - 2 * INSET) * min(max(v, 0.0), 1.0)
    return ((column + u) / ATLAS_COLUMNS, 1 - (row + 1 - v) / ATLAS_ROWS)


def around(co):
    """Longitude round Blender Z as 0…1 with the front (-Y) at 0.5."""
    return math.atan2(co.x, -co.y) / math.tau + 0.5


def set_uvs(bm, uv_of, wrap=False):
    """UVs per face corner from `uv_of(face, loop) -> (cell, u, v)`; with `wrap` (u round a turned mesh) faces crossing
    the back seam keep their u together."""
    layer = bm.loops.layers.uv.verify()
    for face in bm.faces:
        values = [uv_of(face, loop) for loop in face.loops]
        us = [u for _, u, _ in values]
        if wrap and max(us) - min(us) > 0.5:
            values = [(cell, u + 1 if u < 0.5 else u, v) for cell, u, v in values]
            # The seam sits at the cell's edge: wrap past it by squeezing into the cell's last column instead.
            values = [(cell, min(u, 1.0), v) for cell, u, v in values]
        for loop, (cell, u, v) in zip(face.loops, values):
            loop[layer].uv = cell_uv(cell, u, v)


def lathe(bm, profile, segments, ribs=0, rib_depth=0.0):
    """Turn (height, radius) round Blender Z; ribs dent the radius between `ribs` lobes like a pumpkin's grooves."""
    rings = []
    for height, radius in profile:
        if radius < 1e-6:
            rings.append([bm.verts.new((0, 0, height))])
            continue
        ring = []
        for k in range(segments):
            angle = k / segments * math.tau
            r = radius * (1 - rib_depth * (1 - abs(math.cos(angle * ribs / 2))) ** 2) if ribs else radius
            ring.append(bm.verts.new((math.sin(angle) * r, -math.cos(angle) * r, height)))
        rings.append(ring)
    for a, b in zip(rings, rings[1:]):
        for k in range(segments):
            n = (k + 1) % segments
            if len(a) == 1:
                bm.faces.new((a[0], b[k], b[n]))
            elif len(b) == 1:
                bm.faces.new((a[k], b[0], a[n]))
            else:
                bm.faces.new((a[k], b[k], b[n], a[n]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return rings


def mesh_object(name, mesh, parent, location=(0, 0, 0)):
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    obj.parent = parent
    obj.location = location
    return obj


def finish_mesh(name, bm, mats, smooth_angle=None):
    return proto_mesh(name, bm, mats, smooth_angle)


# ------------------------------------------------------------------ the dressed pieces (same sizes as the originals)

def pin_mesh(mat, segments=24):
    """The bowling pin turned like create_outside's, mapped round its height onto the pumpkin pin cell."""
    bm = bmesh.new()
    height = PIN_PROFILE[-1][0]
    lathe(bm, [(h - PIN_ORIGIN, r) for h, r in PIN_PROFILE], segments)
    set_uvs(bm, lambda face, loop: ('pin', around(loop.vert.co) if loop.vert.co.xy.length > 1e-6 else around(face.calc_center_median()),
                                     (loop.vert.co.z + PIN_ORIGIN) / height), wrap=True)
    return finish_mesh('Halloween_Pin', bm, [mat], 60)


def ball_mesh(mat):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=24, v_segments=14, radius=BALL_RADIUS)

    def uv(face, loop):
        co = loop.vert.co
        u = around(co) if co.xy.length > 1e-6 else around(face.calc_center_median())
        return 'eye', u, math.asin(max(-1.0, min(1.0, co.z / BALL_RADIUS))) / math.pi + 0.5
    set_uvs(bm, uv, wrap=True)
    return finish_mesh('Halloween_Ball', bm, [mat], 50)


def box_uv(cell, size):
    """Each face of a box over the whole cell, by the two axes across its normal."""
    def uv(face, loop):
        n = face.normal
        co = loop.vert.co
        axis = max(range(3), key=lambda i: abs(n[i]))
        a, b = [i for i in range(3) if i != axis]
        return cell, co[a] / size[a] + 0.5, co[b] / size[b] + 0.5
    return uv


def brick_mesh(index, mat):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    size = (BRICK_W, BRICK_D, BRICK_H)
    for v in bm.verts:
        v.co = Vector((v.co.x * size[0], v.co.y * size[1], v.co.z * size[2]))
    bmesh.ops.bevel(bm, geom=list(bm.edges), offset=0.012, segments=2, affect='EDGES', profile=0.5)
    bm.normal_update()
    set_uvs(bm, box_uv(f'stone{index}', size))
    return finish_mesh(f'Halloween_Brick{index}', bm, [mat], 40)


# ------------------------------------------------------------------ pumpkins, spiders, graves

def pumpkin_profile(radius, height, rings=11):
    """A squat pumpkin, dimpled at the top and the bottom: (height from the middle, radius)."""
    profile = [(-height / 2 + 0.04 * height, 0.0)]
    for k in range(1, rings):
        t = k / rings
        angle = -math.pi / 2 + t * math.pi
        r = radius * math.cos(angle) ** 0.75
        z = height / 2 * math.sin(angle)
        # The dimples: the ends pull in towards the stalk and the foot.
        z -= height * 0.06 * math.exp(-((t - 1) / 0.12) ** 2)
        z += height * 0.04 * math.exp(-(t / 0.12) ** 2)
        profile.append((z, r))
    profile.append((height / 2 - 0.08 * height, 0.0))
    return profile


# The carved face (the atlas' jack face): two triangle eyes, a nose and a toothed grin, in units of its half width (x)
# and half height (y, up), centred a little above the pumpkin's middle.
JACK_FACE = [
    [(-0.78, 0.18), (-0.28, 0.22), (-0.5, 0.72)],
    [(0.28, 0.22), (0.78, 0.18), (0.5, 0.72)],
    [(-0.12, -0.08), (0.12, -0.08), (0.0, 0.14)],
    [(-0.82, -0.22), (-0.6, -0.62), (-0.4, -0.55), (-0.3, -0.72), (-0.1, -0.62), (0.0, -0.76), (0.1, -0.62), (0.3, -0.72),
     (0.4, -0.55), (0.6, -0.62), (0.82, -0.22), (0.55, -0.3), (0.45, -0.22), (0.35, -0.34), (0.15, -0.3), (0.05, -0.42),
     (-0.05, -0.42), (-0.15, -0.3), (-0.35, -0.34), (-0.45, -0.22), (-0.55, -0.3)],
]


def carve(data, radius, height, ember_index):
    """
    Cut the jack-o'-lantern face into a pumpkin mesh: each hole a pocket going well into it, its walls and back in the
    ember (the candle-lit inside, which glows), so the face has real depth instead of being painted on.
    """
    obj = bpy.data.objects.new('CarveTarget', data)
    bpy.context.collection.objects.link(obj)
    sx, sy, centre = radius * 0.52, height * 0.36, height * 0.06
    cutters = []
    for index, outline in enumerate(JACK_FACE):
        cutter = prism(f'Carve_{index}', [(x * sx, centre + y * sy) for x, y in outline], -radius * 1.5, -radius * 0.45)
        bm = bmesh.new()
        bm.from_mesh(cutter.data)
        bmesh.ops.triangulate(bm, faces=[f for f in bm.faces if len(f.verts) > 4])
        bm.to_mesh(cutter.data)
        bm.free()
        cutters.append(cutter)
    bpy.ops.object.select_all(action='DESELECT')
    for cutter in cutters:
        cutter.select_set(True)
    bpy.context.view_layer.objects.active = cutters[0]
    bpy.ops.object.join()
    cutter = cutters[0]
    cutter.data.materials.append(data.materials[ember_index])
    modifier = obj.modifiers.new('Carve', 'BOOLEAN')
    modifier.operation = 'DIFFERENCE'
    modifier.object = cutter
    modifier.solver = 'EXACT'
    modifier.material_mode = 'TRANSFER'
    apply_all(obj)
    bpy.data.objects.remove(cutter, do_unlink=True)
    bpy.data.objects.remove(obj, do_unlink=True)
    # The pockets' faces: the ember, all of them on the cell's middle.
    ember = data.materials[ember_index]
    layer = data.uv_layers[0]
    u, v = cell_uv('ember', 0.5, 0.5)
    for polygon in data.polygons:
        if data.materials[polygon.material_index] == ember:
            polygon.material_index = ember_index
            for loop in polygon.loop_indices:
                layer.data[loop].uv = (u, v)
    data.shade_smooth()
    data.set_sharp_from_angle(angle=math.radians(50))


def pumpkin_mesh(name, radius, height, skin, stalk, ember=None, segments=30):
    """A ribbed pumpkin, its origin at its middle; with `ember` its face is carved into it (see carve)."""
    bm = bmesh.new()
    lathe(bm, pumpkin_profile(radius, height), segments, ribs=10, rib_depth=0.09)
    set_uvs(bm, lambda face, loop: ('pumpkin', around(loop.vert.co) if loop.vert.co.xy.length > 1e-6 else around(face.calc_center_median()),
                                     (loop.vert.co.z + height / 2) / height), wrap=True)
    data = finish_mesh(name, bm, [skin, stalk] + ([ember] if ember else []), 50)
    if ember:
        carve(data, radius, height, 2)
    # The stalk: a short tapering, bent stem in its own material.
    bm = bmesh.new()
    bm.from_mesh(data)
    stem = []
    for k in range(5):
        t = k / 4
        stem.append((height / 2 - 0.1 * height + t * 0.22 * height, radius * (0.11 - 0.05 * t), t * t * 0.06 * radius))
    rings = []
    for z, r, lean in stem:
        rings.append([bm.verts.new((math.cos(a) * r + lean, math.sin(a) * r, z)) for a in (i / 7 * math.tau for i in range(7))])
    for a, b in zip(rings, rings[1:]):
        for i in range(7):
            j = (i + 1) % 7
            bm.faces.new((a[i], a[j], b[j], b[i])).material_index = 1
    bm.faces.new(rings[-1]).material_index = 1
    bm.to_mesh(data)
    bm.free()
    return data


def spider_mesh(body, mark, eye):
    """A big hairy-legged spider standing on its eight bent legs, facing -Y, its box centred on the origin."""
    bm = bmesh.new()
    half = SPIDER['height'] / 2
    floor = -half

    def blob(centre, radii, material, segments=10, rings=7):
        out = bmesh.ops.create_uvsphere(bm, u_segments=segments, v_segments=rings, radius=1.0)
        for v in out['verts']:
            v.co = Vector((v.co.x * radii[0], v.co.y * radii[1], v.co.z * radii[2])) + Vector(centre)
        for face in {f for v in out['verts'] for f in v.link_faces}:
            face.material_index = material

    def leg(points, radius):
        for a, b in zip(points, points[1:]):
            a, b = Vector(a), Vector(b)
            out = bmesh.ops.create_cone(bm, cap_ends=True, segments=6, radius1=radius, radius2=radius * 0.8, depth=(b - a).length)
            turn = (b - a).to_track_quat('Z', 'Y').to_matrix()
            for v in out['verts']:
                v.co = turn @ v.co + (a + b) / 2
            radius *= 0.8
    belly_z = floor + 0.2
    blob((0, 0.14, belly_z + 0.05), (0.15, 0.2, 0.13), 0)              # abdomen, behind
    blob((0, -0.1, belly_z), (0.1, 0.11, 0.08), 0)                     # head and thorax, in front
    blob((0, 0.2, belly_z + 0.17), (0.05, 0.08, 0.012), 1, 10, 6)      # the red hourglass on its back
    for x in (-0.035, 0.035):
        blob((x, -0.2, belly_z + 0.03), (0.022, 0.018, 0.022), 2, 8, 6)    # eyes
    for side in (-1, 1):
        for k, angle in enumerate((-0.9, -0.3, 0.3, 0.9)):
            dx, dy = math.cos(angle), math.sin(angle) * 0.9
            root = (side * 0.08, -0.08 + k * 0.05, belly_z)
            knee = (side * (0.08 + dx * 0.24), -0.08 + k * 0.05 + dy * 0.24, belly_z + 0.14)
            foot = (side * (0.08 + dx * SPIDER['span'] / 2 * 0.95), -0.08 + k * 0.05 + dy * SPIDER['span'] / 2, floor + 0.01)
            leg([root, knee, foot], 0.018)
    return finish_mesh('Prop_Spider', bm, [body, mark, eye], 45)


def grave_mesh(index, mat):
    """A gravestone: a slab with a round top, its front (-Y) carrying its epitaph cell, its box centred on the origin."""
    width, height, depth = GRAVE['width'], GRAVE['height'], GRAVE['depth']
    w = width / 2
    straight = height - w
    outline = [(-w, 0.0), (w, 0.0)]
    for k in range(11):
        angle = k / 10 * math.pi
        outline.append((math.cos(angle) * w, straight + math.sin(angle) * w))
    bm = bmesh.new()
    front = [bm.verts.new((x, -depth / 2, z - height / 2)) for x, z in outline]
    back = [bm.verts.new((x, depth / 2, z - height / 2)) for x, z in outline]
    bm.faces.new(front)
    bm.faces.new(list(reversed(back)))
    n = len(outline)
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((front[i], back[i], back[j], front[j]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.normal_update()
    cell = f'grave{index}'

    def uv(face, loop):
        co = loop.vert.co
        # The front: every corner on the front plane (normals can point either way before export).
        if all(abs(corner.vert.co.y + depth / 2) < 1e-4 for corner in face.loops):
            return cell, (co.x + w) / width, (co.z + height / 2) / height
        # Sides and back: a plain corner of the stone, without letters.
        return cell, 0.04 + 0.12 * ((co.x + co.y) / width + 0.5), 0.04 + 0.12 * ((co.z + height / 2) / height)
    set_uvs(bm, uv)
    return finish_mesh(f'Prop_Grave{index}', bm, [mat], 35)


def fence_mesh(iron, length, height=0.7):
    """A low wrought-iron fence along X: two rails and spiked bars, its feet at Z=0."""
    bm = bmesh.new()
    for z in (0.12, height - 0.12):
        bm_box(bm, (-length / 2, -0.015, z - 0.015), (length / 2, 0.015, z + 0.015), 0)
    count = int(length / 0.22)
    for k in range(count + 1):
        x = -length / 2 + k * length / count
        bm_box(bm, (x - 0.012, -0.012, 0), (x + 0.012, 0.012, height), 0)
        spike = bmesh.ops.create_cone(bm, cap_ends=True, segments=4, radius1=0.028, radius2=0.0, depth=0.08)
        for v in spike['verts']:
            v.co += Vector((x, 0, height + 0.04))
    for x in (-length / 2, length / 2):
        bm_box(bm, (x - 0.04, -0.04, 0), (x + 0.04, 0.04, height + 0.12), 0)
    return finish_mesh('Decor_GraveFence', bm, [iron], 30)


# ------------------------------------------------------------------ cobwebs

def web(name, hub, anchors, silk, parent, rings=6, width=0.012, seed=1):
    """A cobweb: threads from the hub to each anchor (three.js points) and a sagging spiral across them, as thin
    ribbons in the web's plane. Open fans keep the first and last threads unjoined."""
    rng = random.Random(seed)
    hub = three(*hub)
    anchors = [three(*a) for a in anchors]
    normal = (anchors[0] - hub).cross(anchors[-1] - hub)
    if normal.length < 1e-6:
        normal = (anchors[0] - hub).cross(anchors[1] - hub)
    normal.normalize()
    bm = bmesh.new()

    def ribbon(a, b):
        along = b - a
        if along.length < 1e-4:
            return
        side = along.cross(normal).normalized() * width / 2
        verts = [bm.verts.new(p) for p in (a - side, b - side, b + side, a + side)]
        bm.faces.new(verts)
    for anchor in anchors:
        ribbon(hub, anchor)
    for k in range(1, rings + 1):
        t = k / (rings + 1) * (0.95 + rng.uniform(-0.04, 0.04))
        points = [hub + (anchor - hub) * t for anchor in anchors]
        for a, b in zip(points, points[1:]):
            # Each strand sags a little towards the ground between its threads.
            middle = (a + b) / 2 - Vector((0, 0, 1)) * (a - b).length * 0.12
            ribbon(a, middle)
            ribbon(middle, b)
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    mesh.materials.append(silk)
    return mesh_object(name, mesh, parent)


# ------------------------------------------------------------------ the hockey mask

def head_trees():
    """
    BVHs of the character's meshes in their bind pose (the web V4 as the viewer shows it): everything, for the mask's
    face, and without the cap, for the strap, which runs under the backwards brim instead of over it.
    """
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=str(CHARACTER))
    imported = [o for o in bpy.data.objects if o not in before]
    trees = []
    for keep in (lambda name: True, lambda name: not name.startswith('Cap')):
        vertices, polygons = [], []
        for obj in imported:
            if obj.type != 'MESH' or not keep(obj.data.name):
                continue
            offset = len(vertices)
            vertices.extend(obj.matrix_world @ v.co for v in obj.data.vertices)
            polygons.extend([offset + i for i in p.vertices] for p in obj.data.polygons)
        trees.append(BVHTree.FromPolygons(vertices, polygons))
    for obj in imported:
        bpy.data.objects.remove(obj, do_unlink=True)
    return trees


# The mask's outline seen from the front (Blender x, z): an egg over the whole head, from under the chin to the top of
# the cap, widest at the cheekbones. Everything on it is laid out after the user's reference (a flat drawing of the
# classic mask, MASK_IMAGE: its outline in pixels), so the drawing's pixels map straight onto the mask.
MASK = {'top': 2.67, 'bottom': 1.9, 'width': 0.25, 'chin': 0.3, 'gap': 0.02, 'thickness': 0.007, 'step': 0.02}
MASK['centre'] = (MASK['top'] + MASK['bottom']) / 2
MASK['half_height'] = (MASK['top'] - MASK['bottom']) / 2
MASK_IMAGE = {'left': 175.0, 'right': 580.0, 'top': 115.0, 'bottom': 665.0}


def drawn(px, py):
    """A point of the reference drawing (pixels) on the mask (Blender x, z)."""
    i = MASK_IMAGE
    x = (px - (i['left'] + i['right']) / 2) / ((i['right'] - i['left']) / 2) * MASK['width']
    z = MASK['top'] - (py - i['top']) / (i['bottom'] - i['top']) * (MASK['top'] - MASK['bottom'])
    return x, z


def mirrored(points):
    """The same marks on the other side (the drawing's x mirrored about its middle)."""
    middle = MASK_IMAGE['left'] + MASK_IMAGE['right']
    return [(middle - px, py) for px, py in points]


# The breathing holes as black dots (pixel centres in the drawing): two columns of three over the brow and two between
# them, three round each temple, two on each cheek, two on each side of the mouth and the three pairs down the chin.
MASK_DOT_RADIUS = 12.0
MASK_DOTS = [
    (285, 178), (285, 218), (285, 262), (455, 178), (455, 218), (455, 262), (340, 272), (400, 272),
    (222, 240), (200, 278), (220, 300), (517, 240), (540, 278), (518, 300),
    (202, 405), (232, 430), (537, 405), (508, 430),
    (296, 515), (266, 538), (442, 515), (474, 538),
    (340, 497), (398, 497), (340, 548), (398, 548), (340, 600), (398, 600),
]
# The eyes: solid black ovals (centre and half sizes in pixels) in a light grey rim.
MASK_EYES = [((288, 355), (45, 37)), ((452, 355), (45, 37))]
# The grey nose ridge between and under the eyes, a triangle pointing up.
MASK_NOSE = [(325, 462), (412, 462), (368, 368)]
# Red marks: the brow's wide V (its upper and lower edges, left to right) and a curved slash down each cheek.
MASK_BROW = ([(292, 296), (335, 299), (370, 314), (405, 299), (448, 296)], [(305, 306), (338, 311), (370, 332), (402, 311), (437, 306)])
MASK_SLASH = ([(268, 410), (255, 445), (250, 495)], [(285, 410), (272, 448), (264, 497)])
# The strap's tabs: on the mask's sides and its top (centre and half sizes in pixels).
MASK_TABS = [((175, 343), (17, 26)), ((580, 343), (17, 26)), ((377, 108), (26, 15))]
STRAP = {'front': 2.33, 'back': 2.2, 'width': 0.034, 'thickness': 0.0035, 'off': 0.005}


def mask_half_width(z):
    m = MASK
    below = min(max((m['centre'] - z) / m['half_height'], 0.0), 1.0)
    above = min(max((z - m['centre']) / m['half_height'], 0.0), 1.0)
    return m['width'] * (1 - m['chin'] * below ** 1.6) * (1 - 0.18 * above ** 2.5)


def mask_outline(steps=96):
    points = []
    for k in range(steps):
        t = k / steps * math.tau
        s, c = math.sin(t), math.cos(t)
        z = MASK['centre'] + MASK['half_height'] * math.copysign(abs(s) ** 0.85, s)
        x = mask_half_width(z) * math.copysign(abs(c) ** 0.75, c)
        points.append((x, z))
    return points


def blur(grid, radius):
    """Gaussian blur of a grid of rows (edges clamped), `radius` in cells."""
    weights = [math.exp(-(k / radius) ** 2 / 2) for k in range(-3 * int(math.ceil(radius)), 3 * int(math.ceil(radius)) + 1)]
    half = len(weights) // 2
    total = sum(weights)
    rows, columns = len(grid), len(grid[0])
    across = [[sum(w * row[min(max(i + k - half, 0), columns - 1)] for k, w in enumerate(weights)) / total for i in range(columns)] for row in grid]
    return [[sum(w * across[min(max(j + k - half, 0), rows - 1)][i] for k, w in enumerate(weights)) / total for i in range(columns)]
            for j in range(rows)]


def dilate(grid, radius):
    """Each cell takes the largest value within `radius` cells (a square)."""
    rows, columns = len(grid), len(grid[0])
    return [[max(grid[jj][ii] for jj in range(max(0, j - radius), min(rows, j + radius + 1))
                 for ii in range(max(0, i - radius), min(columns, i + radius + 1))) for i in range(columns)] for j in range(rows)]


def mask_field(tree):
    """
    Front surface depth y over a grid (x, z): a smooth moulded shell, at least MASK['gap'] in front of the face (and the
    nose, beard and cheeks) everywhere. Past the head's sides the rows slope back. The shell follows the face only
    loosely: a wide blur of the face, pushed forward wherever it would come closer than the gap, the push itself blurred.
    """
    step = MASK['step']
    xs = [-0.26 + i * step for i in range(int(0.52 / step) + 1)]
    zs = [MASK['bottom'] - 0.04 + j * step for j in range(int((MASK['top'] - MASK['bottom'] + 0.1) / step) + 1)]
    target = [[None] * len(xs) for _ in zs]
    for j, z in enumerate(zs):
        for i, x in enumerate(xs):
            hit = tree.ray_cast(Vector((x, -1.0, z)), Vector((0, 1, 0)), 2.0)
            if hit[0] is not None:
                target[j][i] = hit[0].y - MASK['gap']
    # Off the head: continue the row's nearest known depth, sloping back as fast as it goes sideways.
    for row in target:
        known = [i for i, value in enumerate(row) if value is not None]
        for i in range(len(row)):
            if row[i] is None:
                nearest = min(known, key=lambda k: abs(k - i)) if known else None
                row[i] = row[nearest] + abs(i - nearest) * step * 1.5 if nearest is not None else -0.1
    field = blur(target, 3.5)
    for _ in range(3):
        closer = [[max(0.0, f - t) for f, t in zip(fr, tr)] for fr, tr in zip(field, target)]
        push = blur(dilate(closer, 4), 2.5)
        field = [[f - p * 1.3 for f, p in zip(fr, pr)] for fr, pr in zip(field, push)]
    # Whatever is still too close is pushed out exactly (a hair at most after the passes above).
    return xs, zs, [[min(f, t) for f, t in zip(fr, tr)] for fr, tr in zip(field, target)]


def sample(xs, zs, field, x, z):
    step = MASK['step']
    fi = min(max((x - xs[0]) / step, 0.0), len(xs) - 1.001)
    fj = min(max((z - zs[0]) / step, 0.0), len(zs) - 1.001)
    i, j = int(fi), int(fj)
    a, b = fi - i, fj - j
    return (field[j][i] * (1 - a) * (1 - b) + field[j][i + 1] * a * (1 - b) + field[j + 1][i] * (1 - a) * b + field[j + 1][i + 1] * a * b)


def prism(name, outline, y0, y1):
    """An outline (x, z) extruded along Y: a cutter for the booleans."""
    bm = bmesh.new()
    front = [bm.verts.new((x, y0, z)) for x, z in outline]
    back = [bm.verts.new((x, y1, z)) for x, z in outline]
    bm.faces.new(front)
    bm.faces.new(list(reversed(back)))
    n = len(outline)
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((front[i], back[i], back[j], front[j]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    return obj


def apply_all(obj):
    bpy.context.view_layer.objects.active = obj
    for modifier in list(obj.modifiers):
        bpy.ops.object.modifier_apply(modifier=modifier.name)


def build_mask(parent, trees):
    tree, bare = trees
    plastic = room.material('MaskPlastic', (0.86, 0.84, 0.8), 0.55)
    red = room.material('MaskRed', (0.66, 0.05, 0.04), 0.5)
    strap_mat = room.material('MaskStrap', (0.2, 0.19, 0.18), 0.85)   # grey elastic: it shows against the dark hair
    black = room.material('MaskBlack', (0.025, 0.025, 0.028), 0.45)
    shade = room.material('MaskShade', (0.6, 0.59, 0.58), 0.55)
    xs, zs, field = mask_field(tree)
    # The shell: the field as a grid, given its thickness towards the face and cut to the outline (no holes: the eyes
    # and the breathing holes are painted black on it, so the face never shows through).
    bm = bmesh.new()
    grid = [[bm.verts.new((x, field[j][i], z)) for i, x in enumerate(xs)] for j, z in enumerate(zs)]
    for j in range(len(zs) - 1):
        for i in range(len(xs) - 1):
            bm.faces.new((grid[j][i], grid[j][i + 1], grid[j + 1][i + 1], grid[j + 1][i]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    for face in bm.faces:
        if face.normal.y > 0:
            face.normal_flip()
    mesh = bpy.data.meshes.new('HalloweenMask')
    bm.to_mesh(mesh)
    bm.free()
    mesh.materials.append(plastic)
    shell = mesh_object('HalloweenMask', mesh, parent)
    solid = shell.modifiers.new('Thickness', 'SOLIDIFY')
    solid.thickness = MASK['thickness']
    # Towards the face (the normals point out of the front): the front stays on the field, where the marks sit.
    solid.offset = -1.0
    outline = prism('MaskOutline', mask_outline(), -1.0, 1.0)
    keep = shell.modifiers.new('Outline', 'BOOLEAN')
    keep.operation = 'INTERSECT'
    keep.object = outline
    keep.solver = 'EXACT'
    apply_all(shell)
    bpy.data.objects.remove(outline, do_unlink=True)
    shell.data.shade_smooth()
    shell.data.set_sharp_from_angle(angle=math.radians(50))
    # The boolean may leave empty slots behind: the materials in a known order.
    shell.data.materials.clear()
    for mat in (plastic, red, strap_mat, black, shade):
        shell.data.materials.append(mat)
    for polygon in shell.data.polygons:
        polygon.material_index = 0
    # The marks, the tabs and the strap go into the same object as more materials: one node to hang on the head.
    bm = bmesh.new()
    bm.from_mesh(shell.data)

    def on_mask(x, z, lift):
        return Vector((x, sample(xs, zs, field, x, z) - lift, z))

    def fan(points, material, lift, rings=4):
        """
        A convex mark lying on the mask's front, `lift` in front of it, with a thin edge back to the surface. It is built
        in rings round its middle, every point set on the curved front: a flat polygon would sink into the shell.
        """
        cx = sum(x for x, _ in points) / len(points)
        cz = sum(z for _, z in points) / len(points)
        middle = bm.verts.new(on_mask(cx, cz, lift))
        layers = [[bm.verts.new(on_mask(cx + (x - cx) * k / rings, cz + (z - cz) * k / rings, lift)) for x, z in points] for k in range(1, rings + 1)]
        n = len(points)
        for i in range(n):
            j = (i + 1) % n
            bm.faces.new((middle, layers[0][j], layers[0][i])).material_index = material
            for inner, outer in zip(layers, layers[1:]):
                bm.faces.new((inner[i], inner[j], outer[j], outer[i])).material_index = material
        low = [bm.verts.new(on_mask(x, z, -0.0006)) for x, z in points]
        rim = layers[-1]
        for i in range(n):
            j = (i + 1) % n
            bm.faces.new((rim[j], rim[i], low[i], low[j])).material_index = material

    def strip(upper, lower, material, lift, across=3, along=4):
        """A band between two edges of the same number of points (the brow's V, a cheek slash), subdivided onto the curve."""
        rows = []
        for a in range(across + 1):
            t = a / across
            row = []
            for k in range(len(upper) - 1):
                for b in range(along if k < len(upper) - 2 else along + 1):
                    u = b / along
                    x = (upper[k][0] * (1 - u) + upper[k + 1][0] * u) * (1 - t) + (lower[k][0] * (1 - u) + lower[k + 1][0] * u) * t
                    z = (upper[k][1] * (1 - u) + upper[k + 1][1] * u) * (1 - t) + (lower[k][1] * (1 - u) + lower[k + 1][1] * u) * t
                    row.append(bm.verts.new(on_mask(x, z, lift)))
            rows.append(row)
        for top, bottom in zip(rows, rows[1:]):
            for k in range(len(top) - 1):
                bm.faces.new((top[k + 1], top[k], bottom[k], bottom[k + 1])).material_index = material
        rim = rows[0] + [row[-1] for row in rows[1:-1]] + list(reversed(rows[-1])) + [row[0] for row in reversed(rows[1:-1])]
        low = [bm.verts.new(on_mask(v.co.x, v.co.z, -0.0006)) for v in rim]
        for i in range(len(rim)):
            j = (i + 1) % len(rim)
            bm.faces.new((rim[i], rim[j], low[j], low[i])).material_index = material

    def oval(cx, cz, rx, rz, material, lift, steps=16):
        fan([(cx + math.cos(k / steps * math.tau) * rx, cz + math.sin(k / steps * math.tau) * rz) for k in range(steps)], material, lift,
            rings=4 if rx > 0.03 else 2)

    pixel = MASK['width'] / ((MASK_IMAGE['right'] - MASK_IMAGE['left']) / 2)
    pixel_z = (MASK['top'] - MASK['bottom']) / (MASK_IMAGE['bottom'] - MASK_IMAGE['top'])
    for px, py in MASK_DOTS:
        oval(*drawn(px, py), MASK_DOT_RADIUS * pixel, MASK_DOT_RADIUS * pixel_z, 3, 0.0015, 10)
    for (px, py), (hx, hy) in MASK_EYES:
        # A light grey rim, and the eye itself solid black over it.
        oval(*drawn(px, py), (hx + 6) * pixel, (hy + 6) * pixel_z, 4, 0.0015, 20)
        oval(*drawn(px, py), hx * pixel, hy * pixel_z, 3, 0.0028, 20)
    # The nose ridge is the most curved part: more rings and a little more lift.
    fan([drawn(px, py) for px, py in MASK_NOSE], 4, 0.006, rings=7)
    strip([drawn(*p) for p in MASK_BROW[0]], [drawn(*p) for p in MASK_BROW[1]], 1, 0.0015)
    for side in (MASK_SLASH, (mirrored(MASK_SLASH[0]), mirrored(MASK_SLASH[1]))):
        strip([drawn(*p) for p in side[0]], [drawn(*p) for p in side[1]], 1, 0.0015)
    # The strap's tabs: black blocks on the edge, standing a little proud of the mask.
    for (px, py), (hx, hy) in MASK_TABS:
        x, z = drawn(px, py)
        dx, dz = hx * pixel, hy * pixel_z
        x0 = max(min(x, MASK['width'] - 0.01), -MASK['width'] + 0.01)
        y = sample(xs, zs, field, x0, min(z, MASK['top'] - 0.02))
        out = bmesh.ops.create_cube(bm, size=1.0)
        for v in out['verts']:
            v.co = Vector((x + v.co.x * 2 * dx, y + 0.004 + v.co.y * 0.016, z + v.co.z * 2 * dz))
        for face in {f for v in out['verts'] for f in v.link_faces}:
            face.material_index = 3
    # The strap: from one side tab round the back of the head, under the cap's brim, to the other.
    sides = []
    for x in (-MASK['width'] + 0.01, MASK['width'] - 0.01):
        sides.append(Vector((x, sample(xs, zs, field, x, STRAP['front']) + 0.01, STRAP['front'])))
    centre_y = -0.04
    start = math.atan2(sides[1].x, sides[1].y - centre_y)
    steps = 40
    edges = []
    # From the left side (angle `start`, near the front) through the back (angle 0) to the right side (-start).
    angles = [start - 2 * start * k / steps for k in range(steps + 1)]
    for angle in angles:
        # Lower at the back (under the cap's back edge), level with the tabs at the front.
        level = STRAP['back'] + (STRAP['front'] - STRAP['back']) * (1 - math.cos(angle)) / 2
        out = Vector((math.sin(angle), math.cos(angle), 0))
        pair = []
        for dz in (-STRAP['width'] / 2, STRAP['width'] / 2):
            z = level + dz
            origin = Vector((0, centre_y, z)) + out * 0.6
            hit = bare.ray_cast(origin, -out, 0.6)
            surface = hit[0] if hit[0] is not None else Vector((0, centre_y, z)) + out * 0.25
            pair.append(surface + out * STRAP['off'])
        edges.append(pair)
    # Both ends reach the tabs on the mask's sides.
    for index, side in ((0, sides[1]), (-1, sides[0])):
        edges[index] = [side + Vector((0, 0.004, -STRAP['width'] / 2)), side + Vector((0, 0.004, STRAP['width'] / 2))]
    outer = [[bm.verts.new(p) for p in pair] for pair in edges]
    inner = [[bm.verts.new(p - Vector((math.sin(angle), math.cos(angle), 0)) * STRAP['thickness']) for p in pair] for angle, pair in zip(angles, edges)]
    for k in range(steps):
        bm.faces.new((outer[k][0], outer[k + 1][0], outer[k + 1][1], outer[k][1])).material_index = 2
        bm.faces.new((inner[k][1], inner[k + 1][1], inner[k + 1][0], inner[k][0])).material_index = 2
        bm.faces.new((outer[k][1], outer[k + 1][1], inner[k + 1][1], inner[k][1])).material_index = 2
        bm.faces.new((inner[k][0], inner[k + 1][0], outer[k + 1][0], outer[k][0])).material_index = 2
    bm.to_mesh(shell.data)
    bm.free()
    return shell


# ------------------------------------------------------------------ the cauldron

def build_cauldron(root):
    iron = room.material('CauldronIron', (0.035, 0.032, 0.04), 0.45, 0.6)
    brew = room.material('CauldronBrew', (0.12, 0.7, 0.08), 0.25, emission=(0.2, 0.85, 0.1), strength=0.7)
    bubble = room.material('CauldronBubble', (0.45, 0.95, 0.3), 0.2, emission=(0.4, 0.95, 0.25), strength=0.9)
    glass = room.material('TubeGlass', (0.85, 0.95, 0.9), 0.05, alpha=0.32)
    cork = room.material('TubeCork', (0.55, 0.38, 0.22), 0.85)
    clamp = room.material('TubeClamp', (0.45, 0.42, 0.4), 0.35, 0.8)
    c = CAULDRON
    holder = room.anchor('HalloweenCauldron', (0, 0, 0), root, 0.0, brew=[c['brew'], c['radius']])
    # The pot: lathed with a thick wall, the lip rolled outwards, on three stubby legs.
    profile = [(c['legs'] + 0.0, 0.0), (c['legs'] + 0.01, 0.32), (c['legs'] + 0.08, 0.56), (0.4, c['belly']), (0.62, c['belly'] * 0.98),
               (0.85, c['radius'] + 0.05), (c['rim'] - 0.04, c['radius'] + 0.01), (c['rim'], c['radius'] + 0.06), (c['rim'] + 0.04, c['radius'] + 0.05),
               (c['rim'] + 0.045, c['radius'] - 0.02), (c['rim'] - 0.06, c['radius'] - 0.04), (c['brew'] - 0.05, c['radius'] - 0.06), (c['brew'] - 0.05, 0.0)]
    bm = bmesh.new()
    lathe(bm, profile, 40)
    for k in range(3):
        angle = k / 3 * math.tau + math.pi / 6
        foot = bmesh.ops.create_cone(bm, cap_ends=True, segments=8, radius1=0.08, radius2=0.12, depth=c['legs'] + 0.08)
        for v in foot['verts']:
            v.co += Vector((math.sin(angle) * 0.42, -math.cos(angle) * 0.42, (c['legs'] + 0.08) / 2))
    pot = mesh_object('Cauldron_Pot', finish_mesh('Cauldron_Pot', bm, [iron], 40), holder)
    # Two ring handles on the sides: loops of thick wire standing across X.
    bm = bmesh.new()
    for side in (-1, 1):
        middle = Vector((side * (c['radius'] + 0.12), 0, 0.82))
        rings = []
        for k in range(16):
            angle = k / 16 * math.tau
            outward = Vector((0, math.cos(angle), math.sin(angle)))
            centre = middle + outward * 0.13
            rings.append([bm.verts.new(centre + outward * 0.022 * math.cos(a) + Vector((0.022 * math.sin(a), 0, 0)))
                          for a in (i / 6 * math.tau for i in range(6))])
        for a, b in zip(rings, rings[1:] + rings[:1]):
            for i in range(6):
                j = (i + 1) % 6
                bm.faces.new((a[i], a[j], b[j], b[i]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    mesh_object('Cauldron_Handles', finish_mesh('Cauldron_Handles', bm, [iron], 50), holder)
    # The brew: a glowing disc just under the rim, with bubbles on it.
    bm = bmesh.new()
    bmesh.ops.create_circle(bm, cap_ends=True, segments=40, radius=c['radius'] - 0.035)
    for v in bm.verts:
        v.co.z = c['brew']
    rng = random.Random(13)
    for k in range(9):
        angle, distance = rng.uniform(0, math.tau), rng.uniform(0.1, c['radius'] - 0.15)
        size = rng.uniform(0.03, 0.07)
        out = bmesh.ops.create_uvsphere(bm, u_segments=10, v_segments=5, radius=size)
        for v in out['verts']:
            v.co = Vector((v.co.x, v.co.y, max(v.co.z, 0.0) * 0.8)) + Vector((math.sin(angle) * distance, math.cos(angle) * distance, c['brew']))
        for face in {f for v in out['verts'] for f in v.link_faces}:
            face.material_index = 1
    mesh_object('Cauldron_Brew', finish_mesh('Cauldron_Brew', bm, [brew, bubble], 60), holder)
    # Where the hands rest: on the rim, ahead of the rider and out to its sides (Blender -X is the rider's right).
    for side, name in ((-1, 'right'), (1, 'left')):
        # The rider sits behind the middle (RIDER_BACK in the viewer): the hands rest on the rim a little ahead of the hips.
        room.anchor(f'CauldronGrip_{name}', (side * (c['radius'] - 0.07), -0.04, c['rim'] + 0.04), holder, 0.0, grip=name)
    # Test tubes strapped to the sides, lying along them with their mouths backwards, like the chair's soda bottles: the nitro.
    t = TUBE
    tube_profile = [(0.0, 0.0), (0.012, t['radius'] * 0.7), (0.04, t['radius']), (t['length'] - 0.02, t['radius']), (t['length'], t['radius'] * 1.18),
                    (t['length'] + 0.012, t['radius'] * 1.18), (t['length'] + 0.012, t['radius'] * 0.92), (0.03, t['radius'] * 0.92), (0.03, 0.0)]
    liquid_profile = [(0.0, 0.0), (0.014, t['radius'] * 0.62), (0.042, t['radius'] * 0.86), (t['length'] * 0.78, t['radius'] * 0.86), (t['length'] * 0.78, 0.0)]
    along_y = Matrix.Rotation(-math.pi / 2, 4, 'X')   # turned from Blender Z (the lathe's axis) to +Y
    def lying(profile, segments, lift=0.0):
        bm = bmesh.new()
        lathe(bm, profile, segments)
        bmesh.ops.transform(bm, matrix=Matrix.Translation((0, 0, lift)) @ along_y, verts=bm.verts)
        return bm
    tube_mesh = finish_mesh('Cauldron_Tube', lying(tube_profile, 16), [glass], 50)
    # The brew inside: its origin at the bottom of the tube's inside, so the viewer scales it down to the bottom (along
    # its local Z here, three.js Y) as it empties, like the cola in the bottles.
    liquid_mesh = finish_mesh('Cauldron_TubeLiquid', lying(liquid_profile, 12, t['radius'] * 0.86), [brew], 50)
    cork_mesh = finish_mesh('Cauldron_TubeCork', lying([(0.0, 0.0), (0.0, t['radius'] * 0.88), (0.06, t['radius'] * 0.98), (0.06, 0.0)], 12), [cork], 40)
    def clamp_mesh(side, name):
        """Two rings round the tube and a bracket from them in to the pot (towards -X on the left side, +X on the right)."""
        bm = bmesh.new()
        for y in (0.14, 0.44):
            ring = bmesh.ops.create_cone(bm, cap_ends=False, segments=16, radius1=t['radius'] + 0.012, radius2=t['radius'] + 0.012, depth=0.035)
            for v in ring['verts']:
                v.co = along_y.to_3x3() @ v.co + Vector((0, y, 0))
        bm_box(bm, (min(0.0, -side * 0.12), 0.12, -0.012), (max(0.0, -side * 0.12), 0.46, 0.012), 0)
        return finish_mesh(name, bm, [clamp], 30)
    for side, name in ((-1, 'right'), (1, 'left')):
        x, y, z = side * t['x'], t['front'], t['height']
        mesh_object(f'CauldronTube_{name}', tube_mesh, holder, (x, y, z))
        mesh_object(f'CauldronTubeLiquid_{name}', liquid_mesh, holder, (x, y, z - t['radius'] * 0.86))
        mesh_object(f'CauldronTubeClamp_{name}', clamp_mesh(side, f'Cauldron_TubeClamp_{name}'), holder, (x, y, z))
        mesh_object(f'CauldronTubeCork_{name}', cork_mesh, holder, (x, y + t['length'] - 0.03, z))
        room.anchor(f'CauldronNozzle_{name}', (x, y + t['length'] + 0.04, z), holder, 0.0, nozzle=name)
    return holder


# ------------------------------------------------------------------ runtime pieces

def thrown_pumpkin(skin, stalk, ember, parent):
    mesh = pumpkin_mesh('ThrownPumpkin', THROWN_RADIUS, THROWN_RADIUS * 1.7, skin, stalk, ember, segments=24)
    return mesh_object('ThrownPumpkin', mesh, parent)


def shard_mesh(skin):
    """A curved bit of shell: a patch of the pumpkin's skin (orange outside) with its pale inside."""
    bm = bmesh.new()
    rows = []
    for j in range(3):
        rows.append([bm.verts.new((math.sin(a) * 0.16, -math.cos(a) * 0.16, -0.05 + j * 0.05)) for a in (-0.4 + i * 0.2 for i in range(5))])
    for a, b in zip(rows, rows[1:]):
        for i in range(4):
            bm.faces.new((a[i], a[i + 1], b[i + 1], b[i]))
    out = bmesh.ops.extrude_face_region(bm, geom=list(bm.faces))
    moved = [e for e in out['geom'] if isinstance(e, bmesh.types.BMVert)]
    for v in moved:
        v.co *= 0.88
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    set_uvs(bm, lambda face, loop: ('pumpkin', 0.5 + loop.vert.co.x, 0.5 + loop.vert.co.z * 2))
    return finish_mesh('PumpkinShard', bm, [skin], 40)


def candy_meshes(white, stick):
    """Three candies, about 8 cm, in a white material the viewer tints per candy (one stick stays white)."""
    meshes = {}
    bm = bmesh.new()
    body = bmesh.ops.create_uvsphere(bm, u_segments=12, v_segments=8, radius=1.0)
    for v in body['verts']:
        v.co = Vector((v.co.x * 0.045, v.co.y * 0.03, v.co.z * 0.03))
    for side in (-1, 1):
        twist = bmesh.ops.create_cone(bm, cap_ends=True, segments=8, radius1=0.006, radius2=0.03, depth=0.04)
        for v in twist['verts']:
            v.co = Matrix.Rotation(side * math.pi / 2, 3, 'Y') @ v.co + Vector((side * 0.06, 0, 0))
    meshes['Candy_Wrapped'] = finish_mesh('Candy_Wrapped', bm, [white], 50)
    bm = bmesh.new()
    disc = bmesh.ops.create_cone(bm, cap_ends=True, segments=16, radius1=0.05, radius2=0.05, depth=0.018)
    for v in disc['verts']:
        v.co = Matrix.Rotation(math.pi / 2, 3, 'X') @ v.co + Vector((0, 0, 0.03))
    rod = bmesh.ops.create_cone(bm, cap_ends=True, segments=6, radius1=0.006, radius2=0.006, depth=0.11)
    for v in rod['verts']:
        v.co.z -= 0.045
    for face in {f for v in rod['verts'] for f in v.link_faces}:
        face.material_index = 1
    meshes['Candy_Lollipop'] = finish_mesh('Candy_Lollipop', bm, [white, stick], 50)
    bm = bmesh.new()
    for centre, radius in (((0, 0, 0.0), 0.03), ((0, 0, 0.042), 0.022), ((-0.018, 0, 0.06), 0.009), ((0.018, 0, 0.06), 0.009),
                           ((-0.03, 0, 0.01), 0.012), ((0.03, 0, 0.01), 0.012), ((-0.02, 0, -0.03), 0.013), ((0.02, 0, -0.03), 0.013)):
        out = bmesh.ops.create_uvsphere(bm, u_segments=8, v_segments=6, radius=radius)
        for v in out['verts']:
            v.co = Vector((v.co.x, v.co.y * 0.7, v.co.z)) + Vector(centre)
    meshes['Candy_Gummy'] = finish_mesh('Candy_Gummy', bm, [white], 60)
    return meshes


def bat_mesh(black):
    """A bat with its wings spread along X (the viewer flaps them by how far each vertex is from the body)."""
    bm = bmesh.new()
    body = bmesh.ops.create_uvsphere(bm, u_segments=8, v_segments=6, radius=1.0)
    for v in body['verts']:
        v.co = Vector((v.co.x * 0.06, v.co.y * 0.1, v.co.z * 0.06))
    for side in (-1, 1):
        ears = bmesh.ops.create_cone(bm, cap_ends=True, segments=4, radius1=0.018, radius2=0.0, depth=0.05)
        for v in ears['verts']:
            v.co += Vector((side * 0.025, -0.07, 0.06))
        # The wing: scalloped, from the body out to its tip, flat.
        outline = [(0.04, -0.04), (0.2, -0.1), (0.36, -0.06), (0.46, 0.02), (0.38, 0.06), (0.3, 0.03), (0.24, 0.1), (0.16, 0.06), (0.1, 0.12), (0.04, 0.06)]
        verts = [bm.verts.new((side * x, y, 0.0)) for x, y in outline]
        face = bm.faces.new(verts if side > 0 else list(reversed(verts)))
        out = bmesh.ops.extrude_face_region(bm, geom=[face])
        moved = [e for e in out['geom'] if isinstance(e, bmesh.types.BMVert)]
        bmesh.ops.translate(bm, verts=moved, vec=(0, 0, 0.008))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return finish_mesh('Bat', bm, [black], 30)


def ghost_mesh(sheet, eye):
    """A little sheet ghost, about 0.9 m tall, its origin at its middle, facing -Y, with a wavy hem."""
    bm = bmesh.new()
    profile = [(0.45, 0.0), (0.42, 0.12), (0.34, 0.22), (0.18, 0.27), (0.0, 0.28), (-0.2, 0.3), (-0.4, 0.34)]
    rings = []
    segments = 24
    for z, r in profile:
        if r < 1e-6:
            rings.append([bm.verts.new((0, 0, z))])
            continue
        rings.append([bm.verts.new((math.sin(k / segments * math.tau) * r, -math.cos(k / segments * math.tau) * r,
                                    z + (0.035 * math.sin(k / segments * math.tau * 5) if z < -0.35 else 0.0))) for k in range(segments)])
    for a, b in zip(rings, rings[1:]):
        for k in range(segments):
            n = (k + 1) % segments
            if len(a) == 1:
                bm.faces.new((a[0], b[k], b[n]))
            else:
                bm.faces.new((a[k], b[k], b[n], a[n]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    for side in (-1, 1):
        out = bmesh.ops.create_uvsphere(bm, u_segments=8, v_segments=6, radius=1.0)
        for v in out['verts']:
            v.co = Vector((v.co.x * 0.04, v.co.y * 0.015, v.co.z * 0.065)) + Vector((side * 0.085, -0.265, 0.2))
        for face in {f for v in out['verts'] for f in v.link_faces}:
            face.material_index = 1
    out = bmesh.ops.create_uvsphere(bm, u_segments=8, v_segments=6, radius=1.0)
    for v in out['verts']:
        v.co = Vector((v.co.x * 0.035, v.co.y * 0.015, v.co.z * 0.05)) + Vector((0, -0.272, 0.06))
    for face in {f for v in out['verts'] for f in v.link_faces}:
        face.material_index = 1
    return finish_mesh('Ghost', bm, [sheet, eye], 50)


# ------------------------------------------------------------------ build

def build(root, trees):
    world = room.anchor('HalloweenWorld', (0, 0, 0), root)
    library = room.anchor('HalloweenLibrary', (0, 0, 0), root)
    skin_plain = atlas_material('PumpkinSkin', roughness=0.55)
    skin_glow = atlas_material('PumpkinCarved', glow=True, roughness=0.55)
    ember = atlas_material('PumpkinEmber', glow=True, roughness=0.8)
    stalk = room.material('PumpkinStalk', (0.24, 0.2, 0.08), 0.8)
    stone = atlas_material('HalloweenStone', roughness=0.85)
    eye = atlas_material('HalloweenEye', glow=True, roughness=0.25)
    pin_skin = atlas_material('PumpkinPin', glow=True, roughness=0.5)
    spider_body = room.material('SpiderBody', (0.03, 0.025, 0.035), 0.7)
    spider_mark = room.material('SpiderMark', (0.75, 0.05, 0.04), 0.4, emission=(0.6, 0.02, 0.02), strength=0.5)
    spider_eye = room.material('SpiderEye', (0.9, 0.1, 0.05), 0.2, emission=(1.0, 0.1, 0.05), strength=1.5)
    iron = room.material('GraveIron', (0.06, 0.055, 0.07), 0.5, 0.6)
    silk = room.material('CobwebSilk', (0.9, 0.9, 0.95), 0.6, emission=(0.35, 0.35, 0.4), strength=0.4, alpha=0.75)

    # Loose pieces.
    loose = room.anchor('HalloweenPieces', (0, 0, 0), world)
    pumpkins = {}
    for size, (radius, height, mass) in PUMPKINS.items():
        for carved in (True, False) if size != 'small' else (True,):
            pumpkins[size, carved] = pumpkin_mesh(f'Prop_Pumpkin_{size}{"_carved" if carved else ""}', radius, height,
                                                  skin_glow, stalk, ember if carved else None)
    for index, (x, z, size, carved, yaw) in enumerate(PUMPKIN_SPOTS):
        carved = carved or size == 'small'   # small ones are all lanterns (one mesh less)
        radius, height, mass = PUMPKINS[size]
        piece(f'Pumpkin_{index:02d}', pumpkins[size, carved], (x, z), height / 2, BLOCK_YAW + yaw, loose, prop='pumpkin', group='halloween',
              mass=mass, cylinders=[round(radius * 0.92, 4), round(height * 0.92, 4), 0.0], box=[2 * radius, height, 2 * radius])
    spider = spider_mesh(spider_body, spider_mark, spider_eye)
    for index, (x, z, yaw) in enumerate(SPIDER_SPOTS):
        piece(f'Spider_{index}', spider, (x, z), SPIDER['height'] / 2, yaw, loose, prop='spider', group='halloween', mass=SPIDER['mass'],
              box=[SPIDER['span'], SPIDER['height'], SPIDER['span'] * 0.85])
    for index, (x, z, cell) in enumerate(GRAVE_SPOTS):
        piece(f'Grave_{index}', grave_mesh(cell, stone), (x, z), GRAVE['height'] / 2, BLOCK_YAW, loose, prop='grave', group='halloween',
              mass=GRAVE['mass'], box=[GRAVE['width'], GRAVE['height'], GRAVE['depth']])

    # The graveyard's low fence: along the front (towards the camera) with a gap for the gate, and down its right side.
    fixed = room.anchor('HalloweenDecor', (0, 0, 0), world)
    gx, gz = GRAVEYARD
    front = fence_mesh(iron, 1.8)
    side = fence_mesh(iron, 2.6)
    decor('GraveFence_FrontL', front, (gx - 1.55, gz + 1.75), BLOCK_YAW, fixed, 'graveyard', (1.9, 0.3), (1.8, 0.82, 0.12))
    decor('GraveFence_FrontR', front, (gx + 1.55, gz + 1.75), BLOCK_YAW, fixed, 'graveyard', (1.9, 0.3), (1.8, 0.82, 0.12))
    decor('GraveFence_Side', side, (gx + 2.45, gz + 0.45), BLOCK_YAW + math.pi / 2, fixed, 'graveyard', (0.3, 2.7), (2.6, 0.82, 0.12))

    # Cobwebs (three.js points: x, height over the outside ground, z).
    webs = room.anchor('HalloweenWebs', (0, 0, 0), world)
    floor = -GROUND_Z   # the room floor over the outside ground
    web('Cobweb_Room', (-2.45, floor + 2.85, -2.45), [(-2.0, floor + 2.2, -2.9), (-2.0, floor + 2.75, -2.9), (-2.0, floor + 3.45, -2.9),
                                                         (-2.9, floor + 3.45, -2.0), (-2.9, floor + 2.75, -2.0), (-2.9, floor + 2.2, -2.0)], silk, webs, seed=2)
    web('Cobweb_Sign', (26.45, 0.28, -4.33), [(25.83, 0.04, -4.33), (25.83, 0.36, -4.33), (25.83, 0.6, -4.33), (26.25, 0.6, -4.33),
                                              (26.75, 0.6, -4.33), (27.05, 0.6, -4.33)], silk, webs, rings=5, seed=3)
    beam = 3.28
    web('Cobweb_GantryL', (26.05, 2.92, 38.6), [(25.66, 2.25, 38.6), (25.66, 2.75, 38.6), (25.66, beam, 38.6), (26.15, beam, 38.6),
                                                 (26.75, beam, 38.6)], silk, webs, seed=4)
    web('Cobweb_GantryR', (29.95, 2.92, 38.6), [(29.25, beam, 38.6), (29.85, beam, 38.6), (30.34, beam, 38.6), (30.34, 2.75, 38.6),
                                                 (30.34, 2.25, 38.6)], silk, webs, seed=5)
    web('Cobweb_Fence', (gx + 2.2, 0.55, gz + 1.73), [(gx + 0.66, 0.82, gz + 1.73), (gx + 1.4, 0.82, gz + 1.73), (gx + 2.45, 0.82, gz + 1.73),
                                                       (gx + 2.45, 0.3, gz + 1.73)], silk, webs, rings=4, seed=6)

    build_mask(root, trees)
    build_cauldron(root)

    # The library: the dressed pieces and what the viewer creates while playing.
    mesh_object('Halloween_Pin', pin_mesh(pin_skin), library)
    mesh_object('Halloween_Ball', ball_mesh(eye), library)
    for index in range(3):
        mesh_object(f'Halloween_Brick{index}', brick_mesh(index, stone), library)
    thrown_pumpkin(skin_glow, stalk, ember, library)
    mesh_object('PumpkinShard', shard_mesh(skin_plain), library)
    candy_white = room.material('CandyWhite', (1.0, 1.0, 1.0), 0.3)
    candy_stick = room.material('CandyStick', (0.95, 0.93, 0.88), 0.6)
    for name, data in candy_meshes(candy_white, candy_stick).items():
        mesh_object(name, data, library)
    mesh_object('Bat', bat_mesh(room.material('BatBlack', (0.02, 0.015, 0.025), 0.7)), library)
    mesh_object('Ghost', ghost_mesh(room.material('GhostSheet', (0.95, 0.95, 1.0), 0.6, emission=(0.6, 0.62, 0.7), strength=0.6),
                                    room.material('GhostEye', (0.02, 0.02, 0.03), 0.6)), library)


def export_glb(root):
    bpy.ops.object.select_all(action='DESELECT')
    for o in [root, *root.children_recursive]:
        o.select_set(True)
    bpy.context.view_layer.objects.active = root
    bpy.ops.export_scene.gltf(filepath=str(GLB), export_format='GLB', use_selection=True, export_apply=True,
                              export_yup=True, export_extras=True, export_cameras=False, export_lights=False,
                              export_animations=False, **room.WEB_IMAGES)
    print(f'Halloween GLB: {GLB} ({GLB.stat().st_size} bytes)')


def render_views(root):
    """Review renders: the mask on the V4 head (front, side, back) and the cauldron."""
    RENDERS.mkdir(parents=True, exist_ok=True)
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=str(CHARACTER))
    character = [o for o in bpy.data.objects if o not in before]
    scene = bpy.context.scene
    scene.render.engine = 'BLENDER_EEVEE'
    scene.render.resolution_x = scene.render.resolution_y = 900
    scene.render.film_transparent = False
    world = bpy.data.worlds.new('Review')
    world.use_nodes = True
    world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.08, 0.06, 0.12, 1)
    world.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.8
    scene.world = world
    sun = bpy.data.objects.new('Sun', bpy.data.lights.new('Sun', 'SUN'))
    sun.data.energy = 3.5
    sun.rotation_euler = (math.radians(50), 0, math.radians(-30))
    scene.collection.objects.link(sun)
    back = bpy.data.objects.new('Back', bpy.data.lights.new('Back', 'SUN'))
    back.data.energy = 2.5
    back.rotation_euler = (math.radians(-60), 0, math.radians(20))
    scene.collection.objects.link(back)
    camera = bpy.data.objects.new('Camera', bpy.data.cameras.new('Camera'))
    camera.data.lens = 85
    scene.collection.objects.link(camera)
    scene.camera = camera
    cauldron = bpy.data.objects['HalloweenCauldron']
    cauldron.location.x = 3.0
    shots = {
        'mask-front': ((0, -2.2, 2.2), (0, 0, 2.18)),
        'mask-three-quarter': ((1.4, -1.7, 2.3), (0, 0, 2.18)),
        'mask-side': ((2.2, 0, 2.22), (0, 0, 2.2)),
        'mask-back': ((0.9, 2.0, 2.4), (0, 0, 2.2)),
        'cauldron': ((5.2, -3.2, 2.6), (3.0, 0, 0.6)),
    }
    for name, (eye, target) in shots.items():
        camera.location = eye
        direction = Vector(target) - Vector(eye)
        camera.rotation_euler = direction.to_track_quat('-Z', 'Y').to_euler()
        camera.data.lens = 50 if name == 'cauldron' else 85
        scene.render.filepath = str(RENDERS / f'{name}.png')
        bpy.ops.render.render(write_still=True)
    cauldron.location.x = 0.0
    for obj in character + [sun, back, camera]:
        bpy.data.objects.remove(obj, do_unlink=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--replace-generated', action='store_true')
    parser.add_argument('--render', action='store_true')
    args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else [])
    if (BLEND.exists() or GLB.exists()) and not args.replace_generated:
        raise RuntimeError('Halloween outputs exist. Review them before using --replace-generated.')
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.scene.unit_settings.system = 'METRIC'
    trees = head_trees()
    root = bpy.data.objects.new('Halloween', None)
    bpy.context.collection.objects.link(root)
    root['stage'] = '18-halloween'
    build(root, trees)
    BLEND.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=str(BLEND), compress=True)
    export_glb(root)
    if args.render:
        render_views(root)


if __name__ == '__main__':
    main()
