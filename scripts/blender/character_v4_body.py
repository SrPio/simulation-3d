"""V4 body: hoodie, joggers, hands and canvas skate shoes (signed distance fields)."""
import math

import bpy
import numpy as np
from mathutils import Vector

from character_v4_sdf import (Profile, chain, ellipsoid, field_mesh, length, loft, polygon_sdf_2d, round_box,
                              round_cone, segment_distance_2d, smax, smin, smooth_curve, smoothstep)

# ------------------------------------------------------------------ hoodie

def with_center(rows):
    return [(z, a, yf, yb, (yf + yb) / 2) for z, a, yf, yb in rows]


TORSO = Profile(with_center([
    (1.095, 0.268, -0.212, 0.198),
    (1.115, 0.276, -0.219, 0.204),
    (1.145, 0.279, -0.224, 0.207),
    (1.165, 0.291, -0.236, 0.213),
    (1.250, 0.292, -0.240, 0.211),
    (1.400, 0.286, -0.226, 0.204),
    (1.550, 0.279, -0.205, 0.199),
    (1.680, 0.274, -0.190, 0.195),
    (1.770, 0.258, -0.176, 0.186),
    (1.830, 0.215, -0.150, 0.166),
    (1.865, 0.140, -0.110, 0.130),
    (1.880, 0.060, -0.060, 0.080),
]))
SLEEVE = [(0.14, -0.010, 1.745, 0.103), (0.30, -0.015, 1.740, 0.099), (0.55, -0.020, 1.735, 0.093),
          (0.78, -0.022, 1.732, 0.089), (0.858, -0.022, 1.731, 0.089)]
POCKET = [(-0.098, 1.458), (0.098, 1.458), (0.113, 1.400), (0.140, 1.330), (0.180, 1.265), (0.205, 1.215),
          (0.205, 1.172), (-0.205, 1.172), (-0.205, 1.215), (-0.180, 1.265), (-0.140, 1.330), (-0.113, 1.400)]
POCKET_EDGE = smooth_curve([(0.098, 1.458), (0.113, 1.400), (0.140, 1.330), (0.180, 1.265), (0.205, 1.215)], 6)


def torso(X, Y, Z):
    return loft(X, Y, Z, TORSO, 2.5, 2.4)


def sleeve(X, Y, Z, side):
    Xs = X * side
    d = chain(Xs, Y, Z, [p[:3] for p in SLEEVE], [p[3] for p in SLEEVE], 0.01)
    theta = np.arctan2(Z - 1.733, Y + 0.02)
    window = smoothstep(0.46, 0.56, Xs) * smoothstep(0.86, 0.80, Xs)
    folds = 0.0018 * np.sin((Xs - 0.5) * 2 * math.pi / 0.09 + 2.2 * np.sin(theta * 1.3 + Xs * 7)) * np.sin(theta * 2 + Xs * 17) * window
    bunch = 0.004 * np.exp(-((Xs - 0.835) / 0.018) ** 2)
    d = d + folds - bunch
    cuff = round_cone(Xs, Y, Z, (0.852, -0.022, 1.731), (0.900, -0.022, 1.730), 0.077, 0.074)
    d = smin(d, cuff, 0.004)
    d = d + 0.0025 * np.exp(-((Xs - 0.856) / 0.0035) ** 2)
    d = smax(d, Xs - 0.905, 0.006)
    opening = round_cone(Xs, Y, Z, (0.892, -0.022, 1.730), (0.95, -0.022, 1.730), 0.040, 0.040)
    return smax(d, -opening, 0.006)


def hood(X, Y, Z):
    pts, radii = [], []
    for i in range(49):
        t = i / 48 * 2 * math.pi
        front = max(math.cos(t), 0)
        pts.append((0.158 * math.sin(t), 0.018 - 0.152 * math.cos(t),
                    1.858 - 0.045 * math.cos(t) - 0.028 * front * math.exp(-(math.sin(t) / 0.35) ** 2)))
        radii.append(0.034 + 0.024 * (1 - math.cos(t)) / 2)
    ring = chain(X, Y, Z, pts, radii, 0.01)
    Yf = 0.2 + (Y - 0.2) * 1.6
    shoulders = ellipsoid(X, Yf, Z, (0, 0.2, 1.80), (0.165, 0.075, 0.075))
    flap = chain(X, Yf, Z, [(0, 0.19, 1.86), (0, 0.205, 1.74), (0, 0.21, 1.645)], [0.085, 0.07, 0.022], 0.02)
    d = smin(smin(ring, shoulders, 0.04), flap, 0.035)
    return d + 0.002 * np.exp(-(X / 0.004) ** 2) * (Y > 0.15) * (Z > 1.63)


def pocket(X, Y, Z, dt):
    inside = polygon_sdf_2d(X, Z, POCKET)
    thick = 0.006 + 0.005 * smoothstep(0.0, 0.05, -inside)
    patch = smax(np.abs(dt - thick / 2) - thick / 2, inside, 0.004)
    patch = np.maximum(patch, Y + 0.05)
    edge = segment_distance_2d(np.abs(X), Z, POCKET_EDGE)
    slot = np.maximum(np.maximum(edge - 0.014, np.abs(dt - 0.003) - 0.006), inside + 0.001)
    return patch, np.maximum(slot, Y + 0.05)


def hoodie_field(X, Y, Z):
    dt = torso(X, Y, Z)
    d = dt + 0.003 * np.exp(-((Z - 1.152) / 0.004) ** 2)
    d = smin(d, sleeve(X, Y, Z, 1), 0.045)
    d = smin(d, sleeve(X, Y, Z, -1), 0.045)
    d = smin(d, hood(X, Y, Z), 0.02)
    patch, slot = pocket(X, Y, Z, dt)
    d = smin(d, patch, 0.003)
    d = smax(d, -slot, 0.003)
    neck = round_cone(X, Y, Z, (0, 0.0, 1.78), (0, -0.03, 2.0), 0.074, 0.08)
    return smax(d, -neck, 0.012)


# ------------------------------------------------------------------ pants

PELVIS = Profile(with_center([(0.94, 0.255, -0.170, 0.165), (0.98, 0.268, -0.185, 0.178),
                              (1.10, 0.274, -0.190, 0.180), (1.22, 0.270, -0.188, 0.178)]))
LEG = Profile([  # z, half-width, front y, back y, center y, center x
    (0.195, 0.100, -0.110, 0.128, 0.009, 0.165), (0.215, 0.110, -0.120, 0.138, 0.009, 0.165),
    (0.260, 0.110, -0.120, 0.137, 0.009, 0.165), (0.340, 0.107, -0.119, 0.134, 0.008, 0.164),
    (0.450, 0.107, -0.127, 0.138, 0.006, 0.163), (0.600, 0.109, -0.138, 0.146, 0.004, 0.161),
    (0.750, 0.113, -0.155, 0.159, 0.002, 0.158), (0.900, 0.121, -0.171, 0.170, 0.000, 0.150),
    (1.020, 0.132, -0.186, 0.180, -0.003, 0.137), (1.100, 0.140, -0.190, 0.180, -0.005, 0.130),
])


def leg(X, Y, Z, side):
    zc = np.clip(Z, LEG.lo, LEG.hi)
    a, yf, yb, cy, cx = (LEG(zc, i) for i in range(1, 6))
    depth = np.where(Y < cy, cy - yf, yb - cy)
    u, v = np.abs(X * side - cx) / a, np.abs(Y - cy) / depth
    d = ((u ** 2.1 + v ** 2.1) ** (1 / 2.1) - 1) * np.minimum(a, depth)
    d = np.maximum(d, np.maximum(LEG.lo - Z, Z - LEG.hi))
    theta = np.arctan2(Y - cy, X * side - cx)
    ankle = 0.0026 * np.sin(Z * 2 * math.pi / 0.06 + 2.4 * np.sin(theta * 1.5 + side)) * np.sin(theta * 3 + Z * 40) * smoothstep(0.2, 0.24, Z) * smoothstep(0.37, 0.3, Z)
    return d + ankle


def pants_field(X, Y, Z):
    d = loft(X, Y, Z, PELVIS, 2.4, 2.4)
    d = smin(d, leg(X, Y, Z, 1), 0.03)
    d = smin(d, leg(X, Y, Z, -1), 0.03)
    return d + 0.0035 * np.exp(-((Z - 0.205) / 0.004) ** 2)


def ankle_field(X, Y, Z):
    return np.minimum(round_cone(X, Y, Z, (0.172, 0.03, 0.12), (0.166, 0.012, 0.30), 0.048, 0.052),
                      round_cone(X, Y, Z, (-0.172, 0.03, 0.12), (-0.166, 0.012, 0.30), 0.048, 0.052))


# ------------------------------------------------------------------ hands

FINGERS = [(-0.052, 0.140, 0.0172), (-0.018, 0.155, 0.0180), (0.015, 0.146, 0.0172), (0.045, 0.120, 0.0152)]


def hand_field(side):
    def fn(X, Y, Z):
        Xs = X * side
        palm = round_box(Xs, Y, Z, (0.985, -0.004, 1.729), (0.068, 0.066, 0.019), 0.017)
        palm = smin(palm, ellipsoid(Xs, Y, Z, (0.975, -0.008, 1.731), (0.07, 0.062, 0.025)), 0.01)
        wrist = round_cone(Xs, Y, Z, (0.86, -0.02, 1.731), (0.93, -0.012, 1.730), 0.043, 0.041)
        d = smin(palm, wrist, 0.02)
        fingers = None
        for y, length_, r in FINGERS:
            base = (1.035, y, 1.729)
            mid = (1.035 + length_ * 0.55, y * 1.02, 1.725)
            tip = (1.035 + length_, y * 1.04, 1.716)
            f = chain(Xs, Y, Z, [base, mid, tip], [r, r * 0.96, r * 0.88], 0.004)
            fingers = f if fingers is None else smin(fingers, f, 0.0035)
        d = smin(d, fingers, 0.012)
        thumb = chain(Xs, Y, Z, [(0.945, -0.052, 1.724), (0.995, -0.088, 1.718), (1.04, -0.103, 1.713)],
                      [0.024, 0.020, 0.0165], 0.006)
        d = smin(d, thumb, 0.014)
        knuckles = 0.0015 * np.exp(-((Xs - 1.035) / 0.01) ** 2) * (Z > 1.735)
        return d - knuckles
    return fn


# ------------------------------------------------------------------ shoes

TOE_OUT = math.radians(7)
SHOE_X, SHOE_Y, SHOE_LEN = 0.19, -0.12, 0.53
UPPER = Profile([  # v from toe, half-width, top height
    (0.000, 0.035, 0.080, 0, 0), (0.020, 0.078, 0.104, 0, 0), (0.060, 0.108, 0.122, 0, 0),
    (0.120, 0.122, 0.132, 0, 0), (0.190, 0.127, 0.148, 0, 0), (0.260, 0.126, 0.178, 0, 0),
    (0.330, 0.121, 0.212, 0, 0), (0.380, 0.115, 0.232, 0, 0), (0.430, 0.110, 0.228, 0, 0),
    (0.480, 0.102, 0.218, 0, 0), (0.515, 0.085, 0.205, 0, 0), (0.530, 0.040, 0.190, 0, 0),
])
STRIPE = smooth_curve([(0.15, 0.082), (0.21, 0.100), (0.265, 0.127), (0.300, 0.146), (0.316, 0.128),
                       (0.340, 0.117), (0.400, 0.138), (0.460, 0.168), (0.510, 0.190)], 8)
Z0 = 0.064


def shoe_axes(side):
    fwd = np.array([side * math.sin(TOE_OUT), -math.cos(TOE_OUT)])
    lat = np.array([side * math.cos(TOE_OUT), math.sin(TOE_OUT)])
    return np.array([side * SHOE_X, SHOE_Y]), fwd, lat


def shoe_local(X, Y, side):
    m, fwd, lat = shoe_axes(side)
    qx, qy = X - m[0], Y - m[1]
    return qx * lat[0] + qy * lat[1], SHOE_LEN / 2 - (qx * fwd[0] + qy * fwd[1])


def shoe_world(u, v, z, side):
    m, fwd, lat = shoe_axes(side)
    p = m + fwd * (SHOE_LEN / 2 - v) + lat * u
    return (float(p[0]), float(p[1]), z)


def upper_height(u, v):
    a, h = float(UPPER(v, 1)), float(UPPER(v, 2))
    t = min(abs(u) / a, 0.999)
    return Z0 + (h - Z0) * (1 - t ** 2.4) ** (1 / 2.4)


def upper_base(u, v, Z):
    vc = np.clip(v, 0, SHOE_LEN)
    a, h = UPPER(vc, 1), UPPER(vc, 2)
    hh = h - Z0
    rho = ((np.abs(u) / a) ** 2.4 + (np.maximum(Z - Z0, 0) / hh) ** 2.4) ** (1 / 2.4)
    d = (rho - 1) * np.minimum(a, hh)
    d = np.maximum(d, np.maximum(-v, v - SHOE_LEN))
    return np.maximum(d, 0.052 - Z)


def upper_field(side):
    def fn(X, Y, Z):
        u, v = shoe_local(X, Y, side)
        d = upper_base(u, v, Z)
        collar = np.maximum((length(u / 0.072, (v - 0.438) / 0.086) - 1) * 0.072, 0.15 - Z)
        d = smax(d, -collar, 0.02)
        tongue = ellipsoid(u, v, Z, (0, 0.325, 0.200), (0.056, 0.072, 0.026))
        d = smin(d, tongue, 0.012)
        toe_seam = np.abs(np.sqrt(np.maximum(0, (u / 0.1) ** 2 + ((v - 0.14) / 0.14) ** 2)) - 1)
        d = d + 0.0012 * np.exp(-(toe_seam / 0.02) ** 2) * (v < 0.14) * (Z > 0.08)
        return d
    return fn


def stripe_field(side):
    def fn(X, Y, Z):
        u, v = shoe_local(X, Y, side)
        base = upper_base(u, v, Z)
        a = UPPER(np.clip(v, 0, SHOE_LEN), 1)
        band = segment_distance_2d(v, Z, STRIPE) - 0.0095
        return np.maximum(np.maximum(np.abs(base - 0.0015) - 0.0022, band), 0.55 * a - np.abs(u))
    return fn


def footprint(u, v):
    vc = np.clip(v, 0, SHOE_LEN)
    a = UPPER(vc, 1) + 0.009
    d = (np.abs(u) / a - 1) * a
    return smax(smax(d, -0.009 - v, 0.035), v - SHOE_LEN - 0.009, 0.03)


def sole_field(side):
    def fn(X, Y, Z):
        u, v = shoe_local(X, Y, side)
        fp = footprint(u, v)
        r = 0.011
        qx, qz = fp + r, np.abs(Z - 0.036) - 0.036 + r
        d = length(np.maximum(qx, 0), np.maximum(qz, 0)) + np.minimum(np.maximum(qx, qz), 0) - r
        tread = 0.0012 * (np.sin(v * 2 * math.pi / 0.012) > 0) * np.exp(-(Z / 0.01) ** 2)
        return d + tread
    return fn


def sole_line_field(side):
    def fn(X, Y, Z):
        u, v = shoe_local(X, Y, side)
        fp = footprint(u, v)
        d = np.maximum(np.abs(fp - 0.0008) - 0.0026, np.abs(Z - 0.061) - 0.0028)
        tab = round_box(u, v, Z, (0, SHOE_LEN + 0.0095, 0.034), (0.024, 0.004, 0.012), 0.002)
        return np.minimum(d, tab)
    return fn


def curve_object(name, splines, radius, mat, root, cyclic=False):
    data = bpy.data.curves.new(name, 'CURVE')
    data.dimensions = '3D'
    data.bevel_depth = radius
    data.bevel_resolution = 3
    data.use_fill_caps = True
    data.resolution_u = 10
    for points in splines:
        spline = data.splines.new('BEZIER')
        spline.bezier_points.add(len(points) - 1)
        for bp, p in zip(spline.bezier_points, points):
            bp.co = p
            bp.handle_left_type = bp.handle_right_type = 'AUTO'
        spline.use_cyclic_u = cyclic
    obj = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(obj)
    data.materials.append(mat)
    obj.parent = root
    return obj


def laces(side, mat, root):
    label = 'R' if side > 0 else 'L'
    strands = []
    for i in range(5):
        v = 0.212 + i * 0.033
        pts = []
        for k in range(7):
            f = k / 6
            u = -0.046 + 0.092 * f
            vv = v - 0.011 + 0.022 * f
            pts.append(shoe_world(u, vv, upper_height(u, vv) + 0.0045, side))
        strands.append(pts)
        strands.append([shoe_world(-p_u, vv, upper_height(-p_u, vv) + 0.0065, side)
                        for p_u, vv in [(-0.046 + 0.092 * k / 6, v - 0.011 + 0.022 * k / 6) for k in range(7)]])
    curve_object(f'ShoeLaces_{label}', strands, 0.0042, mat, root)
    top = upper_height(0, 0.36) + 0.012
    loops = []
    for s in (-1, 1):
        loops.append([shoe_world(0, 0.358, top - 0.004, side), shoe_world(s * 0.02, 0.34, top + 0.006, side),
                      shoe_world(s * 0.04, 0.35, top + 0.004, side), shoe_world(s * 0.028, 0.372, top, side),
                      shoe_world(0.0, 0.362, top - 0.002, side)])
        loops.append([shoe_world(0, 0.36, top - 0.004, side), shoe_world(s * 0.018, 0.33, top - 0.012, side),
                      shoe_world(s * 0.03, 0.305, top - 0.03, side)])
    curve_object(f'ShoeBow_{label}', loops, 0.0038, mat, root)


# ------------------------------------------------------------------ build

def build_body(mats, root):
    field_mesh('Hoodie', hoodie_field, (-0.93, -0.33, 1.07), (0.93, 0.31, 1.98), 0.003, mats['Hoodie'], root, 110000)
    field_mesh('Pants', pants_field, (-0.30, -0.25, 0.17), (0.30, 0.24, 1.25), 0.003, mats['Pants'], root, 50000)
    field_mesh('Ankles', ankle_field, (-0.24, -0.05, 0.06), (0.24, 0.09, 0.36), 0.003, mats['Skin'], root, 4000)
    for side, label in ((1, 'R'), (-1, 'L')):
        lo_x, hi_x = sorted((side * 0.80, side * 1.25))
        field_mesh(f'Hand_{label}', hand_field(side), (lo_x, -0.15, 1.66), (hi_x, 0.09, 1.79), 0.0012, mats['Skin'], root, 14000)
        cx = side * SHOE_X
        box = ((cx - 0.21, -0.44, -0.01), (cx + 0.21, 0.21, 0.29))
        field_mesh(f'ShoeUpper_{label}', upper_field(side), *box, 0.0018, mats['ShoeCanvas'], root, 26000)
        field_mesh(f'ShoeStripe_{label}', stripe_field(side), *box, 0.0012, mats['ShoeWhite'], root, 8000)
        field_mesh(f'ShoeSole_{label}', sole_field(side), *box, 0.0018, mats['SoleRubber'], root, 14000)
        field_mesh(f'ShoeSoleLine_{label}', sole_line_field(side), *box, 0.0012, mats['SoleLine'], root, 6000)
        laces(side, mats['Laces'], root)
