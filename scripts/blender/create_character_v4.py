"""V4 character: polished reference-faithful model built from signed distance fields.

Independent from V1/V2/V3. Reference photos live in assets/reference/v4/.
Convention: meters, feet at Z=0, character faces -Y, T-pose.
"""
import argparse
import math
import sys
from pathlib import Path

import bpy
import numpy as np
from mathutils import Matrix, Vector

sys.path.insert(0, str(Path(__file__).resolve().parent))
from character_v4_sdf import (Grid, Profile, chain, ellipsoid, evaluate, exact_sdf, field_mesh, length, loft, trilinear,
                              loft_front_y, polygon_sdf_2d, polygonize, rotate, round_box, round_cone,
                              segment_distance_2d, smax, smin, smooth_curve, smoothstep)


ROOT = Path(__file__).resolve().parents[2]
TARGET = ROOT / 'assets' / 'blender' / 'developer-v4.blend'


# ------------------------------------------------------------------ head


HEAD = Profile([
    # z, half-width, front y, back y, center y
    (1.897, 0.030, -0.212, -0.178, -0.195),
    (1.910, 0.090, -0.236, -0.112, -0.170),
    (1.935, 0.140, -0.254, -0.030, -0.130),
    (1.970, 0.180, -0.267, 0.050, -0.090),
    (2.025, 0.214, -0.279, 0.118, -0.060),
    (2.090, 0.236, -0.287, 0.160, -0.046),
    (2.170, 0.247, -0.292, 0.186, -0.040),
    (2.260, 0.250, -0.296, 0.198, -0.040),
    (2.340, 0.246, -0.297, 0.200, -0.040),
    (2.420, 0.236, -0.290, 0.196, -0.040),
    (2.500, 0.210, -0.269, 0.178, -0.040),
    (2.565, 0.170, -0.226, 0.146, -0.040),
    (2.610, 0.110, -0.162, 0.096, -0.036),
    (2.634, 0.042, -0.084, 0.036, -0.030),
    (2.640, 0.006, -0.042, 0.006, -0.026),
])
N_FRONT, N_BACK = 2.4, 2.2
HEAD_CY = -0.04


def face_y(x, z, offset=0.0):
    return loft_front_y(HEAD, x, z, N_FRONT) - offset


def cranium(X, Y, Z):
    return loft(X, Y, Z, HEAD, N_FRONT, N_BACK)


def ear(X, Y, Z, side):
    Xs = X * side
    Xr, Yr = rotate(Xs, Y, -0.32, 0.250, -0.012)
    shell = ellipsoid(Xr, Yr, Z, (0.266, -0.012, 2.208), (0.024, 0.054, 0.084))
    lobe = ellipsoid(Xr, Yr, Z, (0.262, -0.016, 2.142), (0.019, 0.028, 0.030))
    shell = smin(shell, lobe, 0.012)
    concha = ellipsoid(Xr, Yr, Z, (0.289, -0.020, 2.196), (0.012, 0.029, 0.050))
    shell = smax(shell, -concha, 0.008)
    helix_groove = ellipsoid(Xr, Yr, Z, (0.287, -0.013, 2.228), (0.008, 0.037, 0.047))
    shell = smax(shell, -helix_groove, 0.006)
    antihelix = round_cone(Xr, Yr, Z, (0.284, -0.004, 2.245), (0.286, -0.012, 2.185), 0.0055, 0.0045)
    shell = smin(shell, antihelix, 0.004)
    tragus = ellipsoid(Xr, Yr, Z, (0.277, -0.056, 2.184), (0.011, 0.010, 0.016))
    return smin(shell, tragus, 0.006)


def nose(X, Y, Z):
    bulb = ellipsoid(X, Y, Z, (0, -0.317, 2.150), (0.043, 0.036, 0.035))
    bridge = round_cone(X, Y, Z, (0, -0.292, 2.228), (0, -0.320, 2.170), 0.016, 0.027)
    wings = np.minimum(ellipsoid(X, Y, Z, (0.033, -0.300, 2.137), (0.021, 0.020, 0.018)),
                       ellipsoid(X, Y, Z, (-0.033, -0.300, 2.137), (0.021, 0.020, 0.018)))
    return smin(smin(bulb, bridge, 0.02), wings, 0.012)


MOUTH = [(-0.047, 2.069), (-0.025, 2.062), (0.0, 2.060), (0.025, 2.062), (0.047, 2.069)]


def skin_field(X, Y, Z):
    d = cranium(X, Y, Z)
    d = smin(d, nose(X, Y, Z), 0.022)
    d = smin(d, ear(X, Y, Z, 1), 0.016)
    d = smin(d, ear(X, Y, Z, -1), 0.016)
    mouth = [(x, face_y(x, z, -0.002), z) for x, z in smooth_curve(MOUTH, 6)]
    groove = chain(X, Y, Z, mouth, [0.0028] * len(mouth))
    return smax(d, -groove, 0.004)


def lips_field(X, Y, Z):
    y = face_y(0, 2.049)
    return ellipsoid(X, Y, Z, (0, y + 0.0025, 2.049), (0.042, 0.0075, 0.0085))


def neck_field(X, Y, Z):
    return round_cone(X, Y, Z, (0, 0.005, 1.76), (0, -0.03, 1.99), 0.092, 0.10)


def azimuth(X, Y):
    return np.arctan2(np.abs(X), -(Y - HEAD_CY))


BEARD_TOP = np.array([(0.00, 1.957), (0.30, 1.960), (0.57, 1.972), (0.72, 2.005), (0.88, 2.050),
                      (1.00, 2.095), (1.12, 2.150), (1.22, 2.205), (1.32, 2.255), (1.42, 2.300), (3.2, 2.300)])
HAIR_BOTTOM = np.array([(0.00, 2.440), (1.10, 2.430), (1.20, 2.360), (1.30, 2.290), (1.45, 2.235),
                        (1.60, 2.120), (1.90, 2.050), (2.30, 2.010), (3.2, 1.995)])


def relief(phi, Z, amount):
    return amount * (0.55 * np.sin(phi * 58 + 3.0 * np.sin(Z * 37 + phi * 5))
                     + 0.45 * np.sin(phi * 23 - Z * 19 + 1.7 * np.sin(phi * 9)))


def beard_field(D):
    def fn(X, Y, Z):
        phi = azimuth(X, Y)
        top = np.interp(phi, BEARD_TOP[:, 0], BEARD_TOP[:, 1]).astype(np.float32)
        main = np.maximum(Z - top, Y + 0.005)
        soul_w = np.interp(Z, [1.955, 1.975, 1.995, 2.012, 2.027, 2.036, 2.041],
                           [0.012, 0.012, 0.022, 0.030, 0.031, 0.022, 0.0]).astype(np.float32)
        soul = np.maximum(np.maximum(np.abs(X) - soul_w, Y + 0.15), np.maximum(Z - 2.038, 1.945 - Z))
        mask = smin(main, soul, 0.006)
        thick = 0.007 + 0.014 * smoothstep(2.26, 2.0, Z)
        thick = np.where(soul < main, 0.0065 + 0.0 * thick, thick)
        edge = smoothstep(0.0, 0.022, -mask)
        t = thick * (0.45 + 0.55 * edge) + relief(phi, Z, 0.0011) * edge
        dist = D(X, Y, Z)
        shell = np.maximum(dist - t, -dist - 0.006)
        return smax(shell, mask, 0.004)
    return fn


def hair_field(D):
    def fn(X, Y, Z):
        phi = azimuth(X, Y)
        bottom = np.interp(phi, HAIR_BOTTOM[:, 0], HAIR_BOTTOM[:, 1]).astype(np.float32)
        mask = bottom - Z
        edge = smoothstep(0.0, 0.015, -mask)
        t = 0.0075 * (0.5 + 0.5 * edge) + 0.0007 * np.sin(Z * 160 + 4 * np.sin(phi * 13)) * edge
        dist = D(X, Y, Z)
        shell = np.maximum(dist - t, -dist - 0.006)
        return smax(shell, mask, 0.003)
    return fn


def hair_tuft(X, Y, Z):
    base = ellipsoid(X, Y, Z, (0, -0.214, 2.535), (0.090, 0.066, 0.070))
    angle = np.arctan2(X, Z - 2.455)
    radial = length(X, Z - 2.455)
    ridges = 0.017 * (0.5 - 0.5 * np.cos(angle * 11.0)) ** 0.7 * smoothstep(0.02, 0.09, radial)
    return base + ridges


def brow_field(X, Y, Z):
    d = None
    for side in (1, -1):
        pts = [(0.050, 2.302), (0.075, 2.313), (0.110, 2.318), (0.145, 2.314), (0.172, 2.303)]
        radii = [0.0105, 0.0122, 0.0122, 0.0105, 0.0075]
        path = smooth_curve(pts, 6)
        rad = np.interp(np.linspace(0, 1, len(path)), np.linspace(0, 1, len(radii)), radii)
        pts3 = [(side * x, face_y(x, z, 0.001), z) for x, z in path]
        Ys = (Y - face_y(0.11, 2.31)) / 0.75 + face_y(0.11, 2.31)
        seg = chain(X, Ys, Z, [(p[0], (p[1] - face_y(0.11, 2.31)) / 0.75 + face_y(0.11, 2.31), p[2]) for p in pts3],
                    list(rad), 0.0)
        d = seg if d is None else np.minimum(d, seg)
    return d


def mustache_field(X, Y, Z):
    d = None
    for side in (1, -1):
        pts = [(0.0, 2.105), (0.022, 2.111), (0.052, 2.110), (0.082, 2.097), (0.103, 2.074),
               (0.114, 2.050), (0.116, 2.033), (0.113, 2.024)]
        radii = [0.0128, 0.0145, 0.015, 0.014, 0.0125, 0.0108, 0.0092, 0.0078]
        path = smooth_curve(pts, 6)
        rad = np.interp(np.linspace(0, 1, len(path)), np.linspace(0, 1, len(radii)), radii)
        pts3 = [(side * x, face_y(x, z, 0.003 + (0.004 if abs(x) < 0.04 else 0.0)), z) for x, z in path]
        seg = chain(X, Y, Z, pts3, list(rad), 0.004)
        d = seg if d is None else smin(d, seg, 0.006)
    return d - 0.0007 * np.sin(X * 380 + Z * 90)


# ------------------------------------------------------------------ cap


CAP_O = np.array([0.0, -0.003, 2.343])
CAP_TILT = math.radians(15)
CAP_A, CAP_BF, CAP_BB, CAP_C = 0.279, 0.314, 0.310, 0.322
CAP_N, CAP_P, CAP_T = 2.2, 2.35, 0.0085


def cap_local(X, Y, Z):
    c, s = math.cos(CAP_TILT), math.sin(CAP_TILT)
    y, z = Y - CAP_O[1], Z - CAP_O[2]
    return X - CAP_O[0], y * c - z * s, y * s + z * c


def cap_world(xl, yl, zl):
    c, s = math.cos(CAP_TILT), math.sin(CAP_TILT)
    return (xl + CAP_O[0], CAP_O[1] + yl * c + zl * s, CAP_O[2] - yl * s + zl * c)


def crown_rho(xl, yl, zl):
    b = np.where(yl < 0, CAP_BF, CAP_BB)
    h = (np.abs(xl) / CAP_A) ** CAP_N + (np.abs(yl) / b) ** CAP_N
    return (h ** (CAP_P / CAP_N) + (np.maximum(zl, 0) / CAP_C) ** CAP_P) ** (1 / CAP_P)


def crown_outer(xl, yl, zl):
    return (crown_rho(xl, yl, zl) - 1) * 0.29


def crown_point(direction, offset=0.0):
    v = np.asarray(direction, np.float64)
    v = v / np.linalg.norm(v)
    r = 1.0 / float(crown_rho(np.array(v[0]), np.array(v[1]), np.array(v[2])))
    r += offset
    return cap_world(*(v * r))


def opening_2d(xl, zl):
    arch = (length(xl / 0.112, (np.maximum(zl, 0.085) - 0.085) / 0.132) - 1) * 0.112
    return np.maximum(arch, -0.01 - zl)


SEAMS = [k * math.pi / 3 for k in range(6)]


def seam_distance(xl, yl):
    psi = np.arctan2(xl, yl)
    best = None
    for s in SEAMS:
        dist = np.abs(xl * math.cos(s) - yl * math.sin(s))
        dist = np.where(np.cos(psi - s) > 0, dist, 1.0)
        best = dist if best is None else np.minimum(best, dist)
    return best


def cap_crown_field(X, Y, Z):
    xl, yl, zl = cap_local(X, Y, Z)
    outer = crown_outer(xl, yl, zl)
    top = zl / CAP_C
    groove = 0.0024 * np.exp(-(seam_distance(xl, yl) / 0.0034) ** 2) * smoothstep(0.03, 0.12, zl) * (top < 0.985)
    outer = outer + groove
    shell = np.abs(outer + CAP_T / 2) - CAP_T / 2
    shell = smax(shell, -zl, 0.002)
    front = smoothstep(-0.12, -0.2, yl)
    hole = opening_2d(xl, zl)
    shell = np.where(front > 0, smax(shell, -hole * front - (1 - front) * 1.0, 0.003), shell)
    binding = np.maximum(np.abs(hole) - 0.0065, np.abs(outer + 0.003) - 0.0075)
    binding = np.maximum(binding, np.maximum(0.03 - zl, yl + 0.16))
    return smin(shell, binding, 0.002)


def cap_strap_field(X, Y, Z):
    xl, yl, zl = cap_local(X, Y, Z)
    outer = crown_outer(xl, yl, zl)
    band = np.maximum(np.abs(outer - 0.0015) - 0.0042, np.maximum(np.abs(xl) - 0.14, np.abs(zl - 0.030) - 0.026))
    band = np.maximum(band, yl + 0.14)
    rect = round_box(xl, np.zeros_like(yl), zl, (0.038, 0, 0.030), (0.069, 1, 0.019), 0.011)
    tab = np.maximum(np.abs(outer - 0.0072) - 0.0034, rect)
    tab = np.maximum(tab, yl + 0.14)
    return smin(band, tab, 0.002)


BRIM_PIVOT = 0.285
BRIM_ANGLE = math.radians(33)


def cap_brim_field(X, Y, Z):
    xl, yl, zl = cap_local(X, Y, Z)
    c, s = math.cos(BRIM_ANGLE), math.sin(BRIM_ANGLE)
    q = yl - BRIM_PIVOT
    along = q * c - zl * s
    w = q * s + zl * c
    w = w + 0.55 * xl * xl
    reach, inner, width = 0.185, 0.30, 0.268
    e = (length(xl / width, (along + inner) / (reach + inner)) - 1) * width
    r, t = 0.005, 0.0078
    qx, qy = e + r, np.abs(w) - t + r
    slab = length(np.maximum(qx, 0), np.maximum(qy, 0)) + np.minimum(np.maximum(qx, qy), 0) - r
    solid = np.maximum(crown_outer(xl, yl, zl), -zl)
    slab = np.maximum(np.maximum(slab, -solid), -0.2 - along)
    for inset in (0.012, 0.026, 0.040, 0.054):
        slab = slab + 0.0007 * np.exp(-((e + inset) / 0.0014) ** 2) * (w > 0)
    return slab


def cap_button_field(X, Y, Z):
    xl, yl, zl = cap_local(X, Y, Z)
    return ellipsoid(xl, yl, zl, (0, 0, CAP_C - 0.004), (0.021, 0.021, 0.013))


# ------------------------------------------------------------------ materials


def srgb(r, g, b):
    def lin(c):
        c /= 255
        return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
    return (lin(r), lin(g), lin(b))


def material(name, color, roughness, metallic=0.0, sheen=0.0, subsurface=0.0, coat=0.0, bump=None):
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = (*color, 1)
    mat.use_nodes = True
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    shader = nodes['Principled BSDF']
    shader.inputs['Base Color'].default_value = (*color, 1)
    shader.inputs['Roughness'].default_value = roughness
    shader.inputs['Metallic'].default_value = metallic
    if sheen:
        shader.inputs['Sheen Weight'].default_value = sheen
        shader.inputs['Sheen Roughness'].default_value = 0.45
    if subsurface:
        shader.inputs['Subsurface Weight'].default_value = subsurface
        shader.inputs['Subsurface Radius'].default_value = (0.9, 0.45, 0.3)
        shader.inputs['Subsurface Scale'].default_value = 0.012
    if coat:
        shader.inputs['Coat Weight'].default_value = coat
        shader.inputs['Coat Roughness'].default_value = 0.08
    if bump:
        kind, scale, strength, distance = bump[:4]
        coords = nodes.new('ShaderNodeTexCoord')
        vector = coords.outputs['Object']
        if kind == 'streak':
            mapping = nodes.new('ShaderNodeMapping')
            mapping.inputs['Scale'].default_value = bump[4]
            links.new(vector, mapping.inputs['Vector'])
            vector = mapping.outputs['Vector']
            tex = nodes.new('ShaderNodeTexNoise')
            tex.inputs['Scale'].default_value = scale
            tex.inputs['Detail'].default_value = 8
            tex.inputs['Roughness'].default_value = 0.7
            tex.inputs['Distortion'].default_value = 0.4
        elif kind == 'noise':
            tex = nodes.new('ShaderNodeTexNoise')
            tex.inputs['Scale'].default_value = scale
            tex.inputs['Detail'].default_value = 6
            tex.inputs['Roughness'].default_value = 0.6
        elif kind == 'weave':
            tex = nodes.new('ShaderNodeTexBrick')
            tex.inputs['Scale'].default_value = scale
            tex.inputs['Mortar Size'].default_value = 0.08
            tex.inputs['Color1'].default_value = (1, 1, 1, 1)
            tex.inputs['Color2'].default_value = (0.7, 0.7, 0.7, 1)
            tex.inputs['Mortar'].default_value = (0, 0, 0, 1)
        else:
            tex = nodes.new('ShaderNodeTexWave')
            tex.wave_type = 'BANDS'
            tex.bands_direction = 'Z'
            tex.inputs['Scale'].default_value = scale
            tex.inputs['Distortion'].default_value = 6
            tex.inputs['Detail'].default_value = 4
        links.new(vector, tex.inputs['Vector'])
        bump_node = nodes.new('ShaderNodeBump')
        bump_node.inputs['Strength'].default_value = strength
        bump_node.inputs['Distance'].default_value = distance
        links.new(tex.outputs['Fac'] if 'Fac' in tex.outputs else tex.outputs[0], bump_node.inputs['Height'])
        links.new(bump_node.outputs['Normal'], shader.inputs['Normal'])
    return mat


def materials():
    return {
        'Skin': material('Skin', srgb(234, 194, 170), 0.5, subsurface=0.06, bump=('noise', 180, 0.04, 0.001)),
        'Lips': material('Lips', srgb(226, 176, 156), 0.45, subsurface=0.05),
        'Eyes': material('Eyes', srgb(26, 20, 20), 0.18, coat=0.6),
        'Brows': material('Brows', srgb(46, 34, 31), 0.6, bump=('streak', 70, 0.35, 0.001, (1.0, 6.0, 6.0))),
        'Hair': material('Hair', srgb(40, 31, 29), 0.52, sheen=0.25, bump=('streak', 55, 0.4, 0.0015, (8.0, 1.0, 8.0))),
        'Beard': material('Beard', srgb(62, 47, 40), 0.6, sheen=0.3, bump=('streak', 60, 0.45, 0.0015, (7.0, 7.0, 1.0))),
        'CapFabric': material('CapFabric', srgb(104, 27, 48), 0.78, sheen=0.4, bump=('weave', 260, 0.18, 0.0008)),
        'CapThread': material('CapThread', srgb(92, 24, 42), 0.72),
        'CapEyelet': material('CapEyelet', srgb(60, 18, 30), 0.7),
        'Hoodie': material('Hoodie', srgb(34, 32, 33), 0.86, sheen=0.55, bump=('noise', 320, 0.12, 0.0008)),
        'Pants': material('Pants', srgb(26, 24, 25), 0.84, sheen=0.5, bump=('noise', 300, 0.1, 0.0008)),
        'ShoeCanvas': material('ShoeCanvas', srgb(30, 29, 31), 0.72, sheen=0.25, bump=('weave', 360, 0.12, 0.0006)),
        'ShoeWhite': material('ShoeWhite', srgb(236, 232, 228), 0.5),
        'SoleRubber': material('SoleRubber', srgb(240, 236, 232), 0.55, bump=('noise', 90, 0.05, 0.001)),
        'SoleLine': material('SoleLine', srgb(22, 22, 24), 0.6),
        'Laces': material('Laces', srgb(242, 240, 238), 0.7, bump=('wave', 400, 0.3, 0.0005)),
    }


# ------------------------------------------------------------------ build


def eye_objects(mats, root):
    for side, label in ((1, 'R'), (-1, 'L')):
        x, z = 0.105, 2.236
        y = face_y(x, z)
        dx = 0.004
        slope = (face_y(x + dx, z) - face_y(x - dx, z)) / (2 * dx)
        yaw = math.atan(slope) * side
        bpy.ops.mesh.primitive_uv_sphere_add(segments=48, ring_count=32, location=(side * x, y + 0.0045, z))
        eye = bpy.context.object
        eye.name = f'Eye_{label}'
        eye.scale = (0.0235, 0.0115, 0.0355)
        eye.rotation_euler = (0, 0, yaw)
        bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)
        eye.data.polygons.foreach_set('use_smooth', np.ones(len(eye.data.polygons), bool))
        eye.data.materials.append(mats['Eyes'])
        eye.parent = root


def build_head(mats, root):
    field_mesh('Head', skin_field, (-0.33, -0.39, 1.87), (0.33, 0.24, 2.66), 0.002, mats['Skin'], root, 70000)
    field_mesh('Lips', lips_field, (-0.055, -0.32, 2.03), (0.055, -0.25, 2.07), 0.001, mats['Lips'], root, 2500)
    field_mesh('Neck', neck_field, (-0.12, -0.15, 1.64), (0.12, 0.12, 2.1), 0.003, mats['Skin'], root, 6000)
    eye_objects(mats, root)
    field_mesh('Eyebrows', brow_field, (-0.2, -0.33, 2.27), (0.2, -0.24, 2.35), 0.001, mats['Brows'], root, 8000)
    field_mesh('Moustache', mustache_field, (-0.14, -0.35, 1.995), (0.14, -0.24, 2.14), 0.001, mats['Beard'], root, 10000)
    # Exact distance of the bare cranium (no ears/nose) drives the beard and hair shells.
    grid = Grid((-0.30, -0.34, 1.84), (0.30, 0.24, 2.68), 0.0016)
    base = evaluate(cranium, grid)
    cp, ct, cq = polygonize(base, grid)
    exact = exact_sdf(cp, ct, cq, grid, 16)
    sample = lambda X, Y, Z: trilinear(exact, grid, X, Y, Z)
    field_mesh('Beard', beard_field(sample), (-0.29, -0.33, 1.855), (0.29, 0.05, 2.33), 0.0016, mats['Beard'], root, 45000)
    field_mesh('Hair', hair_field(sample), (-0.29, -0.33, 1.96), (0.29, 0.235, 2.675), 0.0016, mats['Hair'], root, 35000)
    field_mesh('HairTuft', hair_tuft, (-0.11, -0.3, 2.44), (0.11, -0.13, 2.63), 0.0015, mats['Hair'], root, 8000)


def stitch_curve(name, paths, mat, root, radius=0.0007, dash=0.006, gap=0.004):
    data = bpy.data.curves.new(name, 'CURVE')
    data.dimensions = '3D'
    data.bevel_depth = radius
    data.bevel_resolution = 2
    for path in paths:
        pts = [Vector(p) for p in path]
        dist = [0.0]
        for a, b in zip(pts, pts[1:]):
            dist.append(dist[-1] + (b - a).length)
        t = 0.0
        while t + dash < dist[-1]:
            seg = []
            for target in (t, t + dash * 0.5, t + dash):
                i = max(0, min(len(dist) - 2, int(np.searchsorted(dist, target) - 1)))
                f = (target - dist[i]) / max(dist[i + 1] - dist[i], 1e-9)
                seg.append(pts[i].lerp(pts[i + 1], f))
            spline = data.splines.new('POLY')
            spline.points.add(len(seg) - 1)
            for sp, p in zip(spline.points, seg):
                sp.co = (*p, 1)
            t += dash + gap
    obj = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(obj)
    obj.data.materials.append(mat)
    obj.parent = root
    return obj


def build_cap(mats, root):
    field_mesh('CapCrown', cap_crown_field, (-0.30, -0.36, 2.26), (0.30, 0.34, 2.68), 0.0016, mats['CapFabric'], root, 55000)
    field_mesh('CapStrap', cap_strap_field, (-0.16, -0.36, 2.37), (0.16, -0.20, 2.5), 0.0012, mats['CapFabric'], root, 9000)
    field_mesh('CapBrim', cap_brim_field, (-0.30, 0.0, 2.05), (0.30, 0.58, 2.5), 0.0015, mats['CapFabric'], root, 18000)
    field_mesh('CapButton', cap_button_field, (-0.03, 0.0, 2.62), (0.03, 0.11, 2.69), 0.0008, mats['CapFabric'], root, 2000)
    paths = []
    for s in SEAMS:
        for shift in (-0.011, 0.011):
            path = []
            for i in range(80):
                elev = 0.08 + i / 79 * 1.33
                ring = math.cos(elev)
                d = (math.sin(s) * ring, math.cos(s) * ring, math.sin(elev) * CAP_C / 0.3)
                p = np.array(crown_point(d, 0.0005))
                xl, yl, zl = cap_local(*p)
                if s == math.pi and zl < 0.24:
                    continue
                perp = np.array([math.cos(s), -math.sin(s), 0.0])
                path.append(tuple(np.array(cap_world(xl + perp[0] * shift, yl + perp[1] * shift, zl)) + 0))
            clean = []
            for p in path:
                xl, yl, zl = cap_local(*p)
                clean.append(crown_point((xl, yl, zl), 0.0008))
            if clean:
                paths.append(clean)
    stitch_curve('CapStitching', paths, mats['CapThread'], root)
    for k in range(6):
        s = SEAMS[k] + math.pi / 6
        d = (math.sin(s) * math.cos(0.9), math.cos(s) * math.cos(0.9), math.sin(0.9) * CAP_C / 0.3)
        p = Vector(crown_point(d, 0.0))
        q = Vector(crown_point(d, 0.01))
        normal = (q - p).normalized()
        bpy.ops.mesh.primitive_torus_add(major_segments=24, minor_segments=8, major_radius=0.0052,
                                         minor_radius=0.0017, location=p + normal * 0.0006)
        ring = bpy.context.object
        ring.name = f'CapEyelet_{k}'
        ring.rotation_euler = normal.to_track_quat('Z', 'Y').to_euler()
        ring.data.materials.append(mats['CapThread'])
        ring.parent = root
        bpy.ops.mesh.primitive_cylinder_add(vertices=20, radius=0.0036, depth=0.002, location=p + normal * 0.0002)
        hole = bpy.context.object
        hole.name = f'CapEyeletHole_{k}'
        hole.rotation_euler = ring.rotation_euler
        hole.data.materials.append(mats['CapEyelet'])
        hole.parent = root


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--replace-generated', action='store_true')
    parser.add_argument('--parts', nargs='+', default=['head', 'cap', 'body'])
    parser.add_argument('--output')
    args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else [])
    target = Path(args.output) if args.output else TARGET
    if target.exists() and not args.replace_generated:
        raise RuntimeError(f'{target} exists. Review it before using --replace-generated.')
    bpy.ops.wm.read_factory_settings(use_empty=True)
    root = bpy.data.objects.new('Developer', None)
    bpy.context.collection.objects.link(root)
    root['stage'] = '04-polished-reference'
    root['pose'] = 'T-pose'
    root['height_units'] = 'meters'
    mats = materials()
    if 'head' in args.parts:
        build_head(mats, root)
    if 'cap' in args.parts:
        build_cap(mats, root)
    if 'body' in args.parts:
        from character_v4_body import build_body
        build_body(mats, root)
    scene = bpy.context.scene
    scene.unit_settings.system = 'METRIC'
    scene.unit_settings.scale_length = 1
    scene.render.engine = 'CYCLES'
    scene.cycles.samples = 96
    scene.view_settings.view_transform = 'AgX'
    target.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=str(target), compress=True)
    faces = sum(len(o.data.polygons) for o in root.children if o.type == 'MESH')
    print(f'V4 source: {target} ({len(root.children)} objects, {faces} faces)')


if __name__ == '__main__':
    main()
