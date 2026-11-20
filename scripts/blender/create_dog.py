"""Canela, the pet: a lemon beagle (white and light brown only) in a red collar with a bone tag reading «Canela».

Modelled after the user's two reference renders (profile and front, `assets/reference/canela/`, not versioned): a
toy-like dog with a big round head, long hanging ears, a white blaze, muzzle, chest and legs, a brown saddle and
rump, and a brown tail with a white tip held up. Body, ears, collar and tag are signed distance fields meshed with
OpenVDB (as the V4 character); the coat is painted as vertex colours from the reference's patches.

Local frame (Blender): metres, paws at Z=0, facing -Y like the character. Measures come from the profile reference
at `SIDE` metres per pixel, so the withers stand 0.58 m high beside the 2.67 m character. Not rigged yet.
"""
import argparse
import math
import sys
from pathlib import Path

import bmesh
import bpy
import numpy as np
from mathutils import Vector

sys.path.insert(0, str(Path(__file__).resolve().parent))
from character_v4_sdf import (chain, ellipsoid, field_mesh, length, polygon_sdf_2d, rotate, round_cone,
                              smax, smin, smooth_curve, smoothstep)
from create_chick import apply_modifiers, ellipsoid as ball, link, surface

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / 'assets' / 'blender' / 'canela.blend'
OUTPUT = ROOT / 'public' / 'models' / 'canela.glb'
RENDERS = ROOT / 'assets' / 'renders' / 'canela'
REFERENCE = ROOT / 'assets' / 'reference' / 'canela'
FONT = Path('C:/Windows/Fonts/bahnschrift.ttf')
# The references' scale: metres per pixel, the pixel column of the model's origin and the pixel row of the ground.
SIDE = (0.000682, 720, 1720)
FRONT = (0.00053, 745, 1860)
# Triangle budgets.
FACES = {'body': 4500, 'ear': 700, 'collar': 700, 'tag': 300, 'nose': 450}


def srgb(r, g, b):
    return tuple(((c / 255) / 12.92 if c / 255 <= 0.04045 else ((c / 255 + 0.055) / 1.055) ** 2.4) for c in (r, g, b))


BROWN = srgb(203, 146, 92)
WHITE = srgb(244, 240, 232)
NOSE_COLOR = srgb(84, 50, 44)


def side(px, py):
    """A point of the profile reference as (Y, Z)."""
    scale, axis, floor = SIDE
    return (-(px - axis) * scale, (floor - py) * scale)


# The head in profile, traced on the user's close-up `head-side.png` (pixels; the nose is left out, it is its own
# mesh, so the muzzle's front runs behind it). The close-up is placed on the full profile reference by a similarity
# that lays its crown top and nose tip on theirs (`CLOSE_UP`: close-up pixel, profile pixel).
CLOSE_UP = (((288, 40), (1090, 428)), ((634, 276), (1430, 645)))
HEAD_TRACE = [
    # Back of the skull, crown and forehead (the top edge).
    (96, 164), (108, 140), (120, 120), (132, 104), (140, 95), (156, 80), (172, 69), (188, 60), (204, 54), (220, 49),
    (236, 46), (252, 43), (268, 41), (284, 41), (300, 41), (316, 42), (332, 44), (348, 47), (364, 51), (380, 57),
    (396, 64), (412, 74), (428, 86), (444, 104), (452, 116), (460, 133),
    # The stop and the top of the muzzle.
    (465, 147), (469, 159), (473, 171), (479, 183), (487, 195), (501, 207), (525, 219), (557, 231), (580, 240),
    # Behind the nose.
    (589, 248), (595, 264), (600, 282), (604, 300), (607, 318), (609, 332),
    # Upper lip, the crease of the mouth, the chin and under the jaw back to the throat.
    (608, 345), (605, 357), (600, 369), (591, 381), (580, 389), (574, 399), (568, 411), (545, 417), (533, 429),
    (503, 441), (489, 446), (460, 450), (430, 452), (405, 454),
]


# The head seen from the front, traced on the user's close-up `head-front.png`: (pixel row, half width in pixels)
# from the crown to the chin. The top is the dome between the ears; under the ears it is where the head meets them.
# `FRONT_UP` places it: the pixel column of the middle, the crown's row and metres per pixel (crown, eyes and nose
# on the side profile's: 0.882, 0.784 and 0.722 m).
FRONT_UP = (312.5, 36, 0.00064)
FRONT_TRACE = [(36, 0), (42, 62), (48, 80), (54, 93), (60, 103), (66, 114), (72, 124), (85, 142), (100, 155),
               (130, 163), (170, 165), (210, 163), (250, 158), (290, 150), (320, 140), (350, 126), (375, 110),
               (392, 92), (405, 80), (420, 62), (432, 38), (438, 0)]


def front_up(px, py):
    """A point of the front close-up as (X, Z)."""
    middle, crown, scale = FRONT_UP
    return (px - middle) * scale, 0.882 - (py - crown) * scale


def front_line():
    right = [front_up(FRONT_UP[0] + half, row) for row, half in FRONT_TRACE]
    right = [tuple(p) for p in smooth_curve(right, 3)]
    return right + [(-x, z) for x, z in reversed(right[1:-1])]


def close_up(px, py):
    """A point of the head close-up as (Y, Z)."""
    (c0, s0), (c1, s1) = CLOSE_UP
    vc = (c1[0] - c0[0], c1[1] - c0[1])
    vs = (s1[0] - s0[0], s1[1] - s0[1])
    scale = math.hypot(*vs) / math.hypot(*vc)
    angle = math.atan2(vs[1], vs[0]) - math.atan2(vc[1], vc[0])
    qx, qy = px - c0[0], py - c0[1]
    return side(s0[0] + (qx * math.cos(angle) - qy * math.sin(angle)) * scale,
                s0[1] + (qx * math.sin(angle) + qy * math.cos(angle)) * scale)


def head_line():
    """The traced profile closed far behind and below, so only the face and the crown are cut."""
    line = [close_up(px, py) for px, py in smooth_curve(HEAD_TRACE, 2)]
    return line + [(line[-1][0], 0.45), (0.1, 0.45), (0.1, 1.2), (line[0][0], 1.2)]


# ------------------------------------------------------------------ shape

TAIL = smooth_curve([(0, 0.262, 0.515), (0, 0.345, 0.575), (0, 0.4, 0.645), (0, 0.408, 0.727)], 3)
TAIL_RADII = np.interp(np.linspace(0, 1, len(TAIL)), [0, 0.4, 0.8, 1], [0.043, 0.037, 0.029, 0.019])
PAWS = ((0.097, -0.23), (0.108, 0.215))
HEAD_LINE = head_line()
FRONT_LINE = front_line()
# The head after the front close-up reference: (centre, radii) of each part; `muzzle` squeezes X, so less is wider.
HEAD = {'grow': 0.03, 'taper': 4.0, 'round': 1.5, 'soft': 0.01, 'skull': (0.142, 0.132, 0.113), 'square': 2.5, 'cheek': ((0.064, -0.3, 0.7), (0.074, 0.072, 0.066)),
        'muzzle': 0.55, 'pad': ((0.042, -0.424, 0.688), (0.047, 0.037, 0.031)),
        'jaw': ((0, -0.385, 0.656), (0.047, 0.06, 0.03))}
# The nose: centre, radii, how far it tips forward, and each nostril (centre and radii in the nose's own frame).
NOSE = {'at': (0, -0.462, 0.727), 'size': (0.041, 0.027, 0.031), 'tip': 0.35, 'taper': 0.32,
        'nostril': ((0.02, -0.0235, -0.009), (0.0105, 0.014, 0.007))}  # across and along, front and hind


def rounded_box(X, Y, Z, c, r, n):
    """An ellipsoid squared off towards a box (a superellipsoid of exponent n)."""
    rho = (np.abs((X - c[0]) / r[0]) ** n + np.abs((Y - c[1]) / r[1]) ** n + np.abs((Z - c[2]) / r[2]) ** n) ** (1 / n)
    return (rho - 1) * min(r)


def head_parts(X, Y, Z):
    """Skull, cheeks, muzzle and jaw: how wide the head is, seen from the front."""
    # The head is a soft box more than a ball: a broad, rather flat crown and sides that come straight down.
    d = rounded_box(X, Y, Z, (0, -0.25, 0.765), HEAD['skull'], HEAD['square'])
    # Full cheeks: the face stays as wide at the jaw as at the eyes.
    d = smin(d, ellipsoid(np.abs(X), Y, Z, *HEAD['cheek']), 0.04)
    # A broad muzzle, nearly as wide as the face, with the upper lip's two soft pads under the nose.
    upper = round_cone(X * HEAD['muzzle'], Y, Z, (0, -0.335, 0.716), (0, -0.43, 0.708), 0.064, 0.052)
    upper = smin(upper, ellipsoid(np.abs(X), Y, Z, *HEAD['pad']), 0.026)
    d = smin(d, upper, 0.04)
    # The small lower jaw meets the lip almost without blending, which leaves the mouth as a crease.
    return smin(d, ellipsoid(X, Y, Z, *HEAD['jaw']), 0.005)


def head(X, Y, Z):
    """The head, its outline seen from the side cut to the traced profile `HEAD_LINE`.

    The parts are grown in Y and Z (not in X) so they fill the outline everywhere, then cut by it; the cut sinks a
    little towards the sides so the crown and the muzzle stay round instead of flat.
    """
    parts = head_parts(X, Y, Z)
    # Grown in every direction (less towards the very back), then cut by both traced outlines: the side profile, which
    # sinks a little towards the sides, and the front one, which narrows a little (in width only) towards the back
    # and the nose.
    grown = head_parts(X, Y, Z) - HEAD['grow'] + np.maximum(Y + 0.17, 0)
    side_cut = polygon_sdf_2d(Y, Z, HEAD_LINE) + HEAD['round'] * X * X
    front_cut = polygon_sdf_2d(X * (1 + HEAD['taper'] * (Y + 0.27) ** 2), Z, FRONT_LINE)
    return smax(smax(np.minimum(parts, grown), side_cut, HEAD['soft']), front_cut, HEAD['soft'])


def trunk(X, Y, Z):
    """Torso, neck, head and muzzle."""
    d = round_cone(X, Y, Z, (0, -0.15, 0.42), (0, 0.17, 0.44), 0.155, 0.135)
    d = smin(d, round_cone(X, Y, Z, (0, -0.13, 0.5), (0, -0.215, 0.7), 0.125, 0.098), 0.05)
    return smin(d, head(X, Y, Z), 0.025)


def legs(A, Y, Z):
    front = round_cone(A, Y, Z, (0.097, -0.2, 0.34), (0.097, -0.2, 0.07), 0.056, 0.045)
    front = smin(front, ellipsoid(A, Y, Z, (PAWS[0][0], PAWS[0][1], 0.032), (0.057, 0.066, 0.045)), 0.02)
    thigh = ellipsoid(A, Y, Z, (0.1, 0.2, 0.38), (0.07, 0.1, 0.13))
    lower = chain(A, Y, Z, [(0.105, 0.19, 0.3), (0.108, 0.25, 0.17), (0.108, 0.245, 0.06)], [0.055, 0.037, 0.034], 0.02)
    hind = smin(smin(thigh, lower, 0.03), ellipsoid(A, Y, Z, (PAWS[1][0], PAWS[1][1], 0.03), (0.048, 0.064, 0.042)), 0.02)
    return np.minimum(front, hind)


def carve(d, groove, depth, k=0.002):
    """Cut `groove` out of the surface of `d`, no deeper than `depth`."""
    return smax(d, -smax(groove, -(d + depth), k), k)


def body_field(X, Y, Z):
    A = np.abs(X)
    d = smin(trunk(X, Y, Z), legs(A, Y, Z), 0.03)
    d = smin(d, chain(X, Y, Z, TAIL, TAIL_RADII, 0.0), 0.03)
    # The groove from the nose down to the mouth.
    philtrum = np.maximum(A - 0.0028, np.maximum(np.maximum(Z - 0.705, 0.672 - Z), Y + 0.42))
    d = carve(d, philtrum, 0.006)
    # Toes: three grooves down the front of every paw.
    for across, along in PAWS:
        offset = np.minimum(np.minimum(np.abs(A - across), np.abs(A - across - 0.025)), np.abs(A - across + 0.025))
        groove = np.maximum(offset - 0.003, np.maximum(Z - 0.055, Y - (along - 0.035)))
        d = carve(d, np.maximum(groove, (along - 0.09) - Y), 0.006)
    return smax(d, -Z, 0.006)  # flat soles


# The ear seen from the side, traced on the head close-up (pixels): from the root on the back of the crown, round the
# front edge and the rounded tip, and up the back edge.
EAR_TRACE = [(150, 92), (195, 72), (255, 68), (310, 84), (350, 120), (374, 175), (386, 245), (388, 320), (380, 390),
             (362, 440), (330, 470), (290, 478), (248, 462), (205, 420), (165, 360), (130, 290), (110, 220), (115, 150)]
# The flap's middle surface: `x` out from the middle at the root on the crown, `side` more once it has come down
# over the side of the skull (`settle` metres), then leaning out by `flare` per metre down. Below the root it turns
# its back edge out by `yaw` per metre back from its front edge, so from the front it shows broad over the cheek.
# It swells out by `bulge` halfway down and is 2 × `half` thick, its edges rounded by `round`.
EAR = {'x': 0.096, 'side': 0.03, 'settle': 0.12, 'flare': -0.05, 'yaw': 0.35, 'bulge': 0.03, 'top': 0.86, 'half': 0.012,
       'round': 0.0095}


def ear_field(s):
    outline = [close_up(px, py) for px, py in smooth_curve(EAR_TRACE + EAR_TRACE[:1], 3)[:-1]]
    top = max(z for _, z in outline)
    drop = top - min(z for _, z in outline)
    front = min(y for y, _ in outline)

    def field(X, Y, Z):
        down = np.clip(top - Z, 0, drop)
        settled = smoothstep(0, EAR['settle'], down)
        middle = (EAR['x'] + EAR['side'] * settled + EAR['flare'] * down + EAR['yaw'] * (Y - front) * settled
                  + EAR['bulge'] * np.sin(math.pi * down / drop) ** 0.8)
        r = EAR['round']
        q1 = polygon_sdf_2d(Y, Z, outline) + r
        q2 = np.abs(X * s - middle) - (EAR['half'] - r)
        flap = length(np.maximum(q1, 0), np.maximum(q2, 0)) + np.minimum(np.maximum(q1, q2), 0) - r
        # Its top is rounded off just under the crown, so from the front the ears start beside the dome.
        return smax(flap, Z - EAR['top'], 0.02)
    return field


# The tag's chain: radii of the ring and the loop, and half the plate's height.
TAG = {'ring': 0.011, 'loop': 0.007, 'half': 0.023}
# The collar: a band round the neck, lower at the throat, as on the profile reference.
COLLAR = {'back': side(850, 742), 'front': side(1190, 922), 'half': 0.019, 'lift': 0.0115}


def collar_field(X, Y, Z):
    (by, bz), (fy, fz) = COLLAR['back'], COLLAR['front']
    along = np.array((fy - by, fz - bz))
    along /= np.linalg.norm(along)
    normal = (-along[1], along[0])
    cy, cz = (by + fy) / 2, (bz + fz) / 2
    slab = np.abs((Y - cy) * normal[0] + (Z - cz) * normal[1]) - COLLAR['half']
    base = trunk(X, Y, Z)
    band = smax(base - COLLAR['lift'], -(base + 0.006), 0.003)
    near = length(X, Y - cy, Z - cz) - 0.24
    return smax(smax(band, slab, 0.005), near, 0.0)


def nose_frame(X, Y, Z):
    cx, cy, cz = NOSE['at']
    y, z = rotate(Y, Z, NOSE['tip'], cy, cz)
    return X - cx, y - cy, z - cz


def nostril_field(X, Y, Z):
    x, y, z = nose_frame(X, Y, Z)
    return ellipsoid(np.abs(x), y, z, *NOSE['nostril'])


def nose_field(X, Y, Z):
    """A rounded triangle, wider above, with the two nostrils sunk into its front."""
    x, y, z = nose_frame(X, Y, Z)
    narrow = 1 + NOSE['taper'] * np.clip(-z / NOSE['size'][2], -1, 1)
    return smax(ellipsoid(x * narrow, y, z, (0, 0, 0), NOSE['size']), -nostril_field(X, Y, Z), 0.003)


def tag_field(X, Y, Z):
    """A dog-bone plate standing in the XZ plane, centred on the origin."""
    bar = length(np.maximum(np.abs(X) - 0.03, 0), np.maximum(np.abs(Z) - 0.0105, 0)) - 0.002
    knobs = length(np.abs(X) - 0.033, np.abs(Z) - 0.0105) - 0.0125
    flat = smin(bar, knobs, 0.004) + 0.001
    q = np.abs(Y) - 0.0018
    return length(np.maximum(flat, 0), np.maximum(q, 0)) + np.minimum(np.maximum(flat, q), 0) - 0.001


# ------------------------------------------------------------------ coat

def polygon(points):
    return [side(px, py) for px, py in points]


# Brown patches on the profile reference (pixels): the saddle from the withers to the loin, and the rump.
SADDLE = polygon([(1042, 700), (1042, 1195), (1012, 1232), (978, 1262), (940, 1345), (900, 1420), (780, 1420),
                  (700, 1302), (640, 1262), (600, 1215), (560, 1150), (505, 1100), (472, 1055), (470, 700)])
RUMP = polygon([(408, 760), (408, 1040), (386, 1150), (352, 1250), (326, 1322), (240, 1322), (150, 760)])


# The white of the muzzle seen from the side, traced on the head close-up (pixels): everything in front of a line
# from the stop, ahead of and below the eye, down to the throat.
MUZZLE_WHITE = [close_up(px, py) for px, py in
                [(466, 140), (472, 200), (464, 240), (442, 280), (420, 315), (330, 328), (200, 342), (100, 400), (100, 520),
                 (800, 520), (800, 140)]]


def step(value, edge=0.006):
    return smoothstep(-edge, edge, value)


def coat(x, y, z):
    """How brown the coat is at a point of the body: 0 white … 1 brown."""
    a = np.abs(x)
    # On the shoulders the saddle comes further forward than on the flanks, round to the edge of the bib.
    forward = np.clip(0.155 - a, 0, 0.065) * step(-0.15 - y) * step(z - 0.36)
    saddle = step(-polygon_sdf_2d(y + forward, z, SADDLE))
    rump = step(-polygon_sdf_2d(y, z, RUMP)) * step(0.625 - z + 0.012 * np.sin(x * 90) + 0.008 * np.sin(y * 140))
    # Head and neck are brown but for the blaze, the muzzle and jaw, and the bib under the throat.
    upper = step(z - 0.555) * step(0.03 - y)
    # The white runs narrow between the eyes and spreads below them over the muzzle; the eye patches come down
    # beside it to the corners of the jaw.
    blaze_width = np.interp(z, [0.6, 0.662, 0.69, 0.72, 0.75, 0.78, 0.81, 0.9], [0.2, 0.2, 0.118, 0.092, 0.052, 0.037, 0.032, 0.03])
    blaze = step(blaze_width - a) * step(-0.262 - y)
    muzzle_width = np.interp(z, [0.6, 0.705, 0.73, 0.755, 0.775], [0.25, 0.2, 0.1, 0.07, 0.035])
    # In front of the eyes the whole muzzle is white; beside and below them only its middle, the cheeks are brown.
    muzzle = step(-polygon_sdf_2d(y, z, MUZZLE_WHITE)) * np.maximum(step(muzzle_width - a), step(-0.395 - y, 0.012))
    bib_width = np.interp(z, [0.4, 0.5, 0.6, 0.675], [0.2, 0.125, 0.075, 0.05])
    bib = step(bib_width - a) * step(-0.2 - y) * step(0.68 - z)
    chest_width = np.interp(z, [0.3, 0.36, 0.5, 0.56], [0.2, 0.112, 0.102, 0.085])
    chest = step(chest_width - a) * step(-0.2 - y) * step(0.57 - z)
    white = np.maximum(np.maximum(blaze, muzzle), bib)
    return np.clip(np.maximum(np.maximum(saddle * (1 - chest), rump), upper * (1 - white)), 0, 1)


def refine(obj, passes=2):
    """More vertices where the coat changes colour, so the patches keep a clean soft edge on a light mesh."""
    for _ in range(passes):
        bm = bmesh.new()
        bm.from_mesh(obj.data)
        bmesh.ops.triangulate(bm, faces=bm.faces)
        points = np.array([v.co for v in bm.verts], np.float32)
        brown = coat(points[:, 0], points[:, 1], points[:, 2])
        edges = [e for e in bm.edges
                 if abs(brown[e.verts[0].index] - brown[e.verts[1].index]) > 0.15 and e.calc_length() > 0.005]
        bmesh.ops.subdivide_edges(bm, edges=edges, cuts=1)
        bmesh.ops.triangulate(bm, faces=bm.faces)
        bm.to_mesh(obj.data)
        bm.free()
    obj.data.polygons.foreach_set('use_smooth', np.ones(len(obj.data.polygons), bool))
    obj.data.update()


def paint(obj):
    refine(obj)
    points = np.empty(len(obj.data.vertices) * 3, np.float32)
    obj.data.vertices.foreach_get('co', points)
    points = points.reshape(-1, 3)
    brown = coat(points[:, 0], points[:, 1], points[:, 2])[:, None]
    colors = np.ones((len(points), 4), np.float32)
    colors[:, :3] = np.array(WHITE) * (1 - brown) + np.array(BROWN) * brown
    layer = obj.data.color_attributes.new('Color', 'FLOAT_COLOR', 'POINT')
    layer.data.foreach_set('color', colors.ravel())
    obj.data.color_attributes.active_color = layer
    obj.data.color_attributes.render_color_index = 0


# ------------------------------------------------------------------ build

def material(name, color, roughness, metallic=0.0, vertex=False):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    shader = mat.node_tree.nodes['Principled BSDF']
    shader.inputs['Base Color'].default_value = (*color, 1)
    shader.inputs['Roughness'].default_value = roughness
    shader.inputs['Metallic'].default_value = metallic
    if vertex:
        node = mat.node_tree.nodes.new('ShaderNodeVertexColor')
        node.layer_name = 'Color'
        mat.node_tree.links.new(node.outputs['Color'], shader.inputs['Base Color'])
    return mat


def name_text(mat, parent, at, width, depth=0.0005):
    """The name standing out of the tag's front face (the tag faces -Y)."""
    curve = bpy.data.curves.new('CanelaName', 'FONT')
    curve.body = 'Canela'
    curve.align_x = 'CENTER'
    curve.align_y = 'CENTER'
    curve.extrude = 0.02
    curve.resolution_u = 2
    if FONT.exists():
        curve.font = bpy.data.fonts.load(str(FONT))
    text = bpy.data.objects.new('CanelaNameCurve', curve)
    bpy.context.collection.objects.link(text)
    bpy.context.view_layer.update()
    mesh = bpy.data.meshes.new_from_object(text.evaluated_get(bpy.context.evaluated_depsgraph_get()))
    bpy.data.objects.remove(text)
    xs = [v.co.x for v in mesh.vertices]
    ys = [v.co.y for v in mesh.vertices]
    scale = width / (max(xs) - min(xs))
    middle = ((max(xs) + min(xs)) / 2, (max(ys) + min(ys)) / 2)
    for v in mesh.vertices:
        v.co = Vector(((v.co.x - middle[0]) * scale, -depth if v.co.z > 0 else depth, (v.co.y - middle[1]) * scale))
    mesh.name = 'Canela_TagName'
    obj = link(bpy.data.objects.new('Canela_TagName', mesh), parent)
    obj.data.materials.append(mat)
    obj.location = at
    return obj


def build():
    root = bpy.data.objects.new('Canela', None)
    bpy.context.collection.objects.link(root)
    fur = material('CanelaFur', WHITE, 0.78, vertex=True)
    ear_fur = material('CanelaEar', BROWN, 0.78)
    nose_mat = material('CanelaNose', NOSE_COLOR, 0.42, vertex=True)
    eye_mat = material('CanelaEye', srgb(38, 22, 15), 0.12)
    rim_mat = material('CanelaEyeRim', srgb(120, 72, 42), 0.5)
    glint_mat = material('CanelaGlint', (1, 1, 1), 0.2)
    red = material('CanelaCollar', srgb(176, 40, 38), 0.55)
    steel = material('CanelaTag', srgb(196, 192, 186), 0.38, 0.9)
    ink = material('CanelaTagName', srgb(52, 48, 46), 0.6, 0.4)

    body, _ = field_mesh('Canela_Body', body_field, (-0.24, -0.52, -0.03), (0.24, 0.47, 0.92), 0.005, fur, root, FACES['body'])
    paint(body)
    for s, label in ((-1, 'L'), (1, 'R')):
        lo = (min(s * 0.03, s * 0.31), -0.42, 0.5)
        hi = (max(s * 0.03, s * 0.31), -0.08, 0.9)
        field_mesh(f'Canela_Ear_{label}', ear_field(s), lo, hi, 0.004, ear_fur, root, FACES['ear'])
    collar, _ = field_mesh('Canela_Collar', collar_field, (-0.2, -0.42, 0.44), (0.2, 0.03, 0.78), 0.003, red, root, FACES['collar'])

    # Nose on the muzzle's tip; the nostrils are hollows in it, darker inside.
    (nx, ny, nz), reach = NOSE['at'], max(NOSE['size']) + 0.012
    nose, _ = field_mesh('Canela_Nose', nose_field, (nx - reach, ny - reach, nz - reach), (nx + reach, ny + reach, nz + reach),
                         0.0015, nose_mat, root, FACES['nose'])
    points = np.array([v.co for v in nose.data.vertices], np.float32)
    inside = smoothstep(0.004, 0.0, nostril_field(points[:, 0], points[:, 1], points[:, 2]))[:, None]
    shades = np.ones((len(points), 4), np.float32)
    shades[:, :3] = np.array(NOSE_COLOR) * (1 - inside) + np.array(NOSE_COLOR) * 0.18 * inside
    layer = nose.data.color_attributes.new('Color', 'FLOAT_COLOR', 'POINT')
    layer.data.foreach_set('color', shades.ravel())

    # Eyes: glossy dark domes sunk into the head, a lighter rim round them and a glint.
    for s in (-1, 1):
        point, normal = surface(body, s * 0.06, 0.783)
        bpy.ops.mesh.primitive_torus_add(major_radius=0.0232, minor_radius=0.0032, major_segments=24, minor_segments=6)
        rim = bpy.context.object
        rim.name = f'Canela_EyeRim_{s}'
        rim.parent = root
        rim.location = point - normal * 0.0035
        rim.rotation_mode = 'QUATERNION'
        rim.rotation_quaternion = Vector((0, 0, 1)).rotation_difference(normal)
        rim.data.materials.append(rim_mat)
        for face in rim.data.polygons:
            face.use_smooth = True
        ball(f'Canela_Eye_{s}', eye_mat, root, (0.0275,) * 3, point - normal * 0.015, segments=20, rings=12)
        glint = point - normal * 0.015 + (normal + Vector((s * 0.35, 0, 0.5))).normalized() * 0.0255
        ball(f'Canela_Glint_{s}', glint_mat, root, (0.0042,) * 3, glint, segments=10, rings=6)

    # The tag hangs as a chain with no gaps: a ring through the collar's lower edge, a loop linked through the ring
    # and passing through the top of the bone plate.
    hang = None
    for k in range(40):  # down the collar's face to its lower edge
        try:
            hang, _ = surface(collar, 0.0, COLLAR['front'][1] + 0.004 - k * 0.0015)
        except RuntimeError:
            break
    ring_centre = hang + Vector((0, 0.001, -TAG['ring'] + 0.0075))
    loop_centre = ring_centre + Vector((0, 0, -TAG['ring'] - TAG['loop'] + 0.0045))
    for name, centre, turn, major in (('Canela_TagRing', ring_centre, (math.pi / 2, 0, math.pi / 2), TAG['ring']),
                                      ('Canela_TagLoop', loop_centre, (math.pi / 2, 0, 0), TAG['loop'])):
        bpy.ops.mesh.primitive_torus_add(major_radius=major, minor_radius=0.0017, major_segments=16, minor_segments=6)
        ring = bpy.context.object
        ring.name = name
        ring.parent = root
        ring.location = centre
        ring.rotation_euler = turn
        ring.data.materials.append(steel)
        for face in ring.data.polygons:
            face.use_smooth = True
    tag_centre = loop_centre + Vector((0, -0.0005, -TAG['loop'] + 0.0055 - TAG['half']))
    tag, _ = field_mesh('Canela_Tag', tag_field, (-0.05, -0.006, -0.028), (0.05, 0.006, 0.028), 0.0008, steel, root, FACES['tag'])
    tag.location = tag_centre
    name_text(ink, root, tag_centre + Vector((0, -0.0028, 0)), 0.05)
    return root


# ------------------------------------------------------------------ review renders

def load_pixels(path):
    image = bpy.data.images.load(str(path))
    width, height = image.size
    pixels = np.empty(width * height * 4, np.float32)
    image.pixels.foreach_get(pixels)
    bpy.data.images.remove(image)
    return pixels.reshape(height, width, 4)[::-1]


def save_pixels(pixels, path):
    height, width, _ = pixels.shape
    image = bpy.data.images.new('out', width, height, alpha=True)
    image.pixels.foreach_set(np.ascontiguousarray(pixels[::-1], np.float32).ravel())
    image.filepath_raw = str(path)
    image.file_format = 'PNG'
    image.save()
    bpy.data.images.remove(image)


def compare(view, path):
    """The reference, the render and both overlaid, side by side (the calibrated views are orthographic)."""
    source = REFERENCE / f'{view}.jpg'
    if not source.exists():  # the reference images are not versioned
        return
    shot = load_pixels(path)
    reference = load_pixels(source)
    rows = (np.arange(shot.shape[0]) * reference.shape[0] / shot.shape[0]).astype(int)
    cols = (np.arange(shot.shape[1]) * reference.shape[1] / shot.shape[1]).astype(int)
    reference = reference[rows][:, cols]
    reference[..., 3] = 1
    overlay = reference * 0.5 + shot * 0.5
    gap = np.ones((shot.shape[0], 10, 4), np.float32)
    save_pixels(np.concatenate([reference, gap, shot, gap, overlay], axis=1), RENDERS / f'compare-{view}.png')


def compare_head(path):
    source = REFERENCE / 'head-side.png'
    if not source.exists():
        return
    shot = load_pixels(path)
    reference = load_pixels(source)
    height, width, _ = reference.shape
    scale, axis, ground = SIDE
    px = np.arange(width)[None, :].repeat(height, 0).astype(np.float64)
    py = np.arange(height)[:, None].repeat(width, 1).astype(np.float64)
    y, z = close_up(px, py)
    # The side render looks along +X with -Y to the right; its frame is the profile reference's.
    cols = np.clip(((-y / scale + axis) * shot.shape[1] / 1493).astype(int), 0, shot.shape[1] - 1)
    rows = np.clip(((ground - z / scale) * shot.shape[0] / 2000).astype(int), 0, shot.shape[0] - 1)
    model = shot[rows, cols]
    reference[..., 3] = 1
    gap = np.ones((height, 8, 4), np.float32)
    save_pixels(np.concatenate([reference, gap, model, gap, reference * 0.5 + model * 0.5], axis=1), RENDERS / 'compare-head-side.png')


def compare_head_front(path):
    source = REFERENCE / 'head-front.png'
    if not source.exists():
        return
    shot = load_pixels(path)
    reference = load_pixels(source)
    height, width, _ = reference.shape
    scale, axis, ground = FRONT
    px = np.arange(width)[None, :].repeat(height, 0).astype(np.float64)
    py = np.arange(height)[:, None].repeat(width, 1).astype(np.float64)
    x, z = front_up(px, py)
    cols = np.clip(((x / scale + axis) * shot.shape[1] / 1493).astype(int), 0, shot.shape[1] - 1)
    rows = np.clip(((ground - z / scale) * shot.shape[0] / 2000).astype(int), 0, shot.shape[0] - 1)
    model = shot[rows, cols]
    reference[..., 3] = 1
    gap = np.ones((height, 8, 4), np.float32)
    save_pixels(np.concatenate([reference, gap, model, gap, reference * 0.5 + model * 0.5], axis=1), RENDERS / 'compare-head-front.png')


def render():
    scene = bpy.context.scene
    engines = [e.identifier for e in bpy.types.RenderSettings.bl_rna.properties['engine'].enum_items]
    scene.render.engine = 'BLENDER_EEVEE_NEXT' if 'BLENDER_EEVEE_NEXT' in engines else 'BLENDER_EEVEE'
    scene.render.film_transparent = False
    scene.view_settings.view_transform = 'Standard'
    beige = srgb(219, 199, 170)
    world = bpy.data.worlds.new('CanelaWorld')
    world.use_nodes = True
    nodes, links = world.node_tree.nodes, world.node_tree.links
    mix = nodes.new('ShaderNodeMix')
    mix.data_type = 'RGBA'
    mix.inputs['A'].default_value = (0.5, 0.5, 0.5, 1)  # what lights the model
    mix.inputs['B'].default_value = (*beige, 1)          # what the camera sees
    links.new(nodes.new('ShaderNodeLightPath').outputs['Is Camera Ray'], mix.inputs['Factor'])
    links.new(mix.outputs['Result'], nodes['Background'].inputs['Color'])
    scene.world = world
    bpy.ops.mesh.primitive_plane_add(size=30)
    floor = bpy.context.object
    floor.name = 'ReviewFloor'
    floor.data.materials.append(material('ReviewFloor', beige, 0.9))
    for name, energy, rotation in (('Key', 1.9, (0.75, 0.15, -0.9)), ('Fill', 0.5, (1.0, -0.2, 2.2))):
        light = bpy.data.objects.new(name, bpy.data.lights.new(name, 'SUN'))
        light.data.energy = energy
        light.data.angle = 0.35
        light.rotation_euler = rotation
        scene.collection.objects.link(light)
    camera = bpy.data.objects.new('Camera', bpy.data.cameras.new('Camera'))
    scene.collection.objects.link(camera)
    scene.camera = camera
    RENDERS.mkdir(parents=True, exist_ok=True)

    def shoot(name, location, target, width, height):
        camera.location = location
        camera.rotation_euler = (Vector(target) - Vector(location)).to_track_quat('-Z', 'Y').to_euler()
        scene.render.resolution_x, scene.render.resolution_y = width, height
        scene.render.filepath = str(RENDERS / f'{name}.png')
        bpy.ops.render.render(write_still=True)
        return RENDERS / f'{name}.png'

    # Orthographic views framed exactly as the references, for the overlays.
    camera.data.type = 'ORTHO'
    for view, (scale, axis, ground), across in (('side', SIDE, (0, -1, 0)), ('front', FRONT, (1, 0, 0))):
        camera.data.ortho_scale = 2000 * scale
        centre = Vector(across) * ((746.5 - axis) * scale) + Vector((0, 0, (ground - 1000) * scale))
        away = Vector((-6, 0, 0)) if view == 'side' else Vector((0, -6, 0))
        size = (1493, 2000)
        path = shoot(view, centre + away, centre, *size)
        compare(view, path)
        (compare_head if view == 'side' else compare_head_front)(path)
    camera.data.type = 'PERSP'
    camera.data.lens = 85
    for name, azimuth, elevation in (('three-quarter', -0.7, 0.22), ('back', 2.5, 0.25), ('face', -0.35, 0.08),
                                     ('head', 0.0, 0.16), ('tag', -0.25, 0.05)):
        close = name in ('face', 'head', 'tag')
        distance = 0.9 if name == 'tag' else 2.0 if close else 3.6
        aim = Vector((0, -0.34, 0.5)) if name == 'tag' else Vector((0, -0.3, 0.72)) if close else Vector((0, -0.03, 0.44))
        offset = Vector((math.sin(azimuth) * math.cos(elevation), -math.cos(azimuth) * math.cos(elevation), math.sin(elevation)))
        shoot(name, aim + offset * distance, aim, 900, 1100)
    bpy.data.objects.remove(floor)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--replace-generated', action='store_true')
    parser.add_argument('--render', action='store_true')
    args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else [])
    if (SOURCE.exists() or OUTPUT.exists()) and not args.replace_generated:
        raise RuntimeError('Canela exists. Review it before using --replace-generated.')
    bpy.ops.wm.read_factory_settings(use_empty=True)
    root = build()
    apply_modifiers(root)
    bpy.context.view_layer.update()
    meshes = [obj for obj in root.children_recursive if obj.type == 'MESH']
    top = max((obj.matrix_world @ v.co).z for obj in meshes for v in obj.data.vertices)
    root['height'] = top
    root['withers'] = 0.575
    triangles = sum(len(p.vertices) - 2 for obj in meshes for p in obj.data.polygons)
    SOURCE.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=str(SOURCE), compress=True)
    bpy.ops.object.select_all(action='DESELECT')
    for obj in [root, *root.children_recursive]:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = root
    bpy.ops.export_scene.gltf(filepath=str(OUTPUT), export_format='GLB', use_selection=True, export_apply=True,
                              export_yup=True, export_extras=True, export_animations=False, export_cameras=False,
                              export_lights=False)
    for obj in meshes:
        print(f'  {obj.name}: {sum(len(p.vertices) - 2 for p in obj.data.polygons)}')
    print(f'Canela: {triangles} triangles, {top:.3f} m tall, {OUTPUT.stat().st_size} bytes')
    if args.render:
        render()


if __name__ == '__main__':
    main()
