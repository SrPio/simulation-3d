import math

import bpy
from mathutils import Vector

from create_character import curve, finish, mesh


TAU = math.tau


def _power(value, exponent):
    return math.copysign(abs(value) ** exponent, value)


def _samples(rows, steps=4):
    result = []
    for i in range(len(rows) - 1):
        a, b = rows[max(0, i - 1)], rows[i]
        c, d = rows[i + 1], rows[min(len(rows) - 1, i + 2)]
        for j in range(steps):
            t = j / steps
            result.append(tuple(0.5 * (2 * q + (-p + r) * t +
                                      (2 * p - 5 * q + 4 * r - s) * t * t +
                                      (-p + 3 * q - 3 * r + s) * t ** 3)
                                for p, q, r, s in zip(a, b, c, d)))
    return result + [tuple(rows[-1])]


def _loft(name, rows, mat, axis='Z', side=1, exponent=1, count=40, folds=0):
    vertices, faces = [], []
    sampled = _samples(rows)
    for row, (position, width, depth, center) in enumerate(sampled):
        t = row / (len(sampled) - 1)
        for i in range(count):
            angle = TAU * i / count
            wrinkle = folds * math.sin(math.pi * t) * (
                0.65 * math.cos(5 * angle + 13 * t) + 0.35 * math.sin(9 * angle - 17 * t))
            u = (width + wrinkle) * _power(math.cos(angle), exponent)
            v = (depth + wrinkle) * _power(math.sin(angle), exponent)
            vertices.append((u, center + v, position) if axis == 'Z' else
                            (side * position, u, center + v))
    for row in range(len(sampled) - 1):
        for i in range(count):
            a, b = row * count + i, row * count + (i + 1) % count
            faces.append((a, b, b + count, a + count))
    faces.extend([tuple(reversed(range(count))),
                  tuple((len(sampled) - 1) * count + i for i in range(count))])
    return mesh(name, vertices, faces, mat)


def _seam(name, points, thickness, mat, cyclic=False):
    obj = curve(name, points, thickness, mat)
    obj.data.resolution_u = 4
    obj.data.bevel_resolution = 1
    obj.data.splines[0].use_cyclic_u = cyclic
    return obj


def _apply(obj, modifier):
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.modifier_apply(modifier=modifier.name)


def _union(name, objects, voxel, ratio):
    bpy.ops.object.select_all(action='DESELECT')
    for obj in objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    bpy.ops.object.join()
    obj = objects[0]
    obj.name = name
    remesh = obj.modifiers.new('ContinuousSurface', 'REMESH')
    remesh.mode = 'VOXEL'
    remesh.voxel_size = voxel
    remesh.use_smooth_shade = True
    _apply(obj, remesh)
    smooth = obj.modifiers.new('RelaxSurface', 'SMOOTH')
    smooth.factor = 0.72
    smooth.iterations = 5
    _apply(obj, smooth)
    if name == 'HoodieBody':
        group = obj.vertex_groups.new(name='ShoulderTransition')
        for vertex in obj.data.vertices:
            x, y, z = vertex.co
            weight = max(0, 1 - abs(abs(x) - 0.265) / 0.14) * max(0, 1 - abs(z - 1.752) / 0.16)
            if weight > 0:
                group.add([vertex.index], weight, 'REPLACE')
        transition = obj.modifiers.new('ShoulderDrape', 'SMOOTH')
        transition.vertex_group = group.name
        transition.factor = 0.9
        transition.iterations = 36
        _apply(obj, transition)
        obj.vertex_groups.remove(obj.vertex_groups['ShoulderTransition'])
    decimate = obj.modifiers.new('SurfaceDensity', 'DECIMATE')
    decimate.ratio = ratio
    _apply(obj, decimate)
    for polygon in obj.data.polygons:
        polygon.use_smooth = True
    return obj


def _shell(obj, thickness=0.004):
    solid = obj.modifiers.new('FabricThickness', 'SOLIDIFY')
    solid.thickness = thickness
    solid.offset = -1
    return obj


def _hood(mats):
    vertices, faces = [], []
    count = 64
    rows = [
        (0.020, 0.024, 0.188, 1.660, 0.003),
        (0.090, 0.086, 0.164, 1.671, 0.023),
        (0.165, 0.160, 0.108, 1.698, 0.057),
        (0.201, 0.195, 0.072, 1.752, 0.047),
        (0.192, 0.198, 0.068, 1.812, 0.051),
        (0.177, 0.191, 0.061, 1.835, 0.055),
    ]
    for row, (rx, ry, cy, z, tilt) in enumerate(rows):
        for i in range(count):
            a = TAU * i / count
            back = (math.sin(a) + 1) / 2
            front_lift = (1 - back) ** 4 * (1 - row / (len(rows) - 1)) * 0.110
            ripple = 0.004 * math.sin(5 * a + row * 0.9) * math.sin(math.pi * row / 5)
            vertices.append((rx * math.cos(a), cy + ry * math.sin(a),
                             z + tilt * math.sin(a) + front_lift + ripple))
    for row in range(len(rows) - 1):
        for i in range(count):
            a, b = row * count + i, row * count + (i + 1) % count
            faces.append((a, b, b + count, a + count))
    faces.append(tuple(reversed(range(count))))
    obj = _shell(mesh('Hood', vertices, faces, mats['Hoodie'], 1), 0.007)
    rim = [vertices[(len(rows) - 1) * count + i] for i in range(0, count, 4)]
    _seam('HoodBinding', rim, 0.0045, mats['RibKnit'], True)
    _seam('HoodCenterSeam', [(0, 0.268, 1.879), (0, 0.272, 1.809),
                            (0, 0.262, 1.723), (0, 0.226, 1.676)], 0.0014, mats['RibKnit'])
    return obj


def _pocket(mats):
    vertices, faces = [], []
    cols, rows = 20, 12
    for row in range(rows + 1):
        t = row / rows
        z = 1.153 + 0.208 * t
        half = 0.204 - 0.075 * t
        for col in range(cols + 1):
            s = -1 + 2 * col / cols
            x = s * half
            body_y = 0.006 - 0.172 * max(0, 1 - (abs(x) / 0.29) ** 2.5) ** 0.4
            bulge = 0.012 * math.sin(math.pi * t) ** 0.7 * (1 - s * s)
            vertices.append((x, body_y - 0.0035 - bulge, z))
    for row in range(rows):
        for col in range(cols):
            a = row * (cols + 1) + col
            faces.append((a, a + 1, a + cols + 2, a + cols + 1))
    obj = _shell(mesh('KangarooPocket', vertices, faces, mats['Hoodie'], 1), 0.003)
    for side, label in [(-1, 'L'), (1, 'R')]:
        points = [vertices[row * (cols + 1) + (0 if side < 0 else cols)] for row in range(2, rows + 1, 2)]
        _seam(f'PocketOpening_{label}', [(x, y - 0.002, z) for x, y, z in points], 0.0027, mats['RibKnit'])
    for row, name in [(0, 'PocketBottomStitch'), (rows, 'PocketTopStitch')]:
        points = [vertices[row * (cols + 1) + col] for col in range(0, cols + 1, 2)]
        _seam(name, [(x, y - 0.001, z) for x, y, z in points], 0.00085, mats['RibKnit'])
    return obj


def _clothing(mats):
    hoodie = mats['Hoodie']
    torso = _loft('HoodieBody', [
        (1.063, 0.269, 0.150, 0.006), (1.088, 0.284, 0.161, 0.006),
        (1.150, 0.292, 0.174, 0.006), (1.290, 0.290, 0.173, 0.006),
        (1.470, 0.294, 0.171, 0.008), (1.610, 0.295, 0.167, 0.012),
        (1.715, 0.294, 0.155, 0.014), (1.773, 0.277, 0.137, 0.014),
        (1.803, 0.242, 0.108, 0.010), (1.817, 0.109, 0.086, 0.010),
    ], hoodie, exponent=0.82, folds=0.0025)
    parts = [torso]
    for side, label in [(-1, 'L'), (1, 'R')]:
        parts.append(_loft(f'Sleeve_{label}', [
            (0.125, 0.071, 0.067, 1.744), (0.205, 0.115, 0.093, 1.734),
            (0.290, 0.128, 0.105, 1.730), (0.370, 0.121, 0.105, 1.730),
            (0.510, 0.109, 0.100, 1.730),
            (0.655, 0.098, 0.094, 1.730), (0.795, 0.094, 0.093, 1.730),
            (0.845, 0.099, 0.097, 1.730), (0.873, 0.093, 0.088, 1.730),
            (0.899, 0.087, 0.082, 1.730), (0.918, 0.080, 0.076, 1.730),
        ], hoodie, 'X', side, folds=0.003))
    torso = _union('HoodieBody', parts, 0.0055, 0.25)
    _loft('HoodieHem', [(1.055, 0.268, 0.150, 0.006), (1.062, 0.284, 0.161, 0.006),
                        (1.077, 0.286, 0.163, 0.006), (1.111, 0.285, 0.165, 0.006),
                        (1.122, 0.280, 0.161, 0.006)], mats['RibKnit'], exponent=0.82)
    for i in range(88):
        a = TAU * i / 88
        x = 0.286 * _power(math.cos(a), 0.82)
        y = 0.006 + 0.164 * _power(math.sin(a), 0.82)
        _seam(f'HemRib_{i:02}', [(x * 0.994, y, 1.066), (x, y, 1.086),
                               (x * 0.995, y, 1.110)], 0.0007, mats['RibKnit'])
    for side, label in [(-1, 'L'), (1, 'R')]:
        _loft(f'Cuff_{label}', [(0.891, 0.079, 0.074, 1.730), (0.899, 0.085, 0.079, 1.730),
                              (0.915, 0.083, 0.076, 1.730), (0.943, 0.071, 0.062, 1.730),
                              (0.955, 0.065, 0.050, 1.730), (0.958, 0.060, 0.044, 1.730)],
              mats['RibKnit'], 'X', side)
        for i in range(36):
            a = TAU * i / 36
            _seam(f'CuffRib_{label}_{i:02}', [(side * x, ry * math.cos(a), 1.730 + rz * math.sin(a))
                  for x, ry, rz in [(0.902, 0.085, 0.079), (0.924, 0.080, 0.073),
                                    (0.947, 0.070, 0.059)]], 0.00075, mats['RibKnit'])
        _seam(f'ShoulderSeam_{label}', [(side * 0.291, -0.091, 1.803),
              (side * 0.326, -0.130, 1.750), (side * 0.328, -0.111, 1.672),
              (side * 0.295, -0.048, 1.630)], 0.0012, mats['RibKnit'])
        _seam(f'HoodDrawstring_{label}', [(side * 0.093, -0.128, 1.790),
              (side * 0.102, -0.156, 1.721), (side * 0.098, -0.170, 1.627),
              (side * 0.113, -0.169, 1.594)], 0.0031, mats['RibKnit'])
        _seam(f'DrawstringTip_{label}', [(side * 0.113, -0.169, 1.596),
              (side * 0.115, -0.168, 1.579)], 0.0035, mats['Metal'])
    return torso, _hood(mats), _pocket(mats)


def _tube(name, sections, mat, side=1, count=20):
    sections = _samples(sections, 3)
    vertices, faces = [], []
    for i, section in enumerate(sections):
        center = Vector(section[:3])
        tangent = Vector(sections[min(len(sections) - 1, i + 1)][:3]) - Vector(sections[max(0, i - 1)][:3])
        tangent.normalize()
        normal = Vector((-tangent.y, tangent.x, 0)).normalized()
        up = tangent.cross(normal).normalized()
        for j in range(count):
            a = TAU * j / count
            point = center + normal * max(0.0003, section[3]) * math.cos(a) + up * max(0.0003, section[4]) * math.sin(a)
            vertices.append((side * point.x, point.y, point.z))
    for row in range(len(sections) - 1):
        for i in range(count):
            a, b = row * count + i, row * count + (i + 1) % count
            faces.append((a, b, b + count, a + count))
    faces.extend([tuple(reversed(range(count))),
                  tuple((len(sections) - 1) * count + i for i in range(count))])
    return mesh(name, vertices, faces, mat)


def _nail(name, x, y, z, length, width, mat, side=1, angle=0):
    vertices = [(side * x, y, z + 0.0018)]
    count = 20
    for radius in [0.55, 0.94, 1.0]:
        for i in range(count):
            a = TAU * i / count
            u, v = length * radius * math.cos(a), width * radius * math.sin(a)
            vertices.append((side * (x + u * math.cos(angle) - v * math.sin(angle)),
                             y + u * math.sin(angle) + v * math.cos(angle),
                             z + 0.0018 * (1 - radius * radius)))
    faces = [(0, 1 + i, 1 + (i + 1) % count) for i in range(count)]
    for row in range(2):
        for i in range(count):
            a, b = 1 + row * count + i, 1 + row * count + (i + 1) % count
            faces.append((a, b, b + count, a + count))
    return _shell(mesh(name, vertices, faces, mat), 0.0008)


def _hand(side, label, mats):
    skin = mats['Skin']
    parts = [_tube(f'Hand_{label}', [
        (0.947, 0, 1.730, 0.042, 0.030), (0.977, 0, 1.730, 0.045, 0.030),
        (1.014, -0.002, 1.730, 0.057, 0.031), (1.057, 0, 1.730, 0.058, 0.027),
        (1.087, 0.001, 1.728, 0.052, 0.022), (1.102, 0.001, 1.728, 0.033, 0.015),
    ], skin, side)]
    fingers = [(-0.044, 1.203, 0.0140), (-0.015, 1.225, 0.0142),
               (0.015, 1.215, 0.0136), (0.043, 1.188, 0.0120)]
    for index, (y, tip, radius) in enumerate(fingers):
        parts.append(_tube(f'Finger_{label}_{index}', [
            (1.068, y * 0.93, 1.729, radius * 1.05, 0.017),
            (1.101, y, 1.728, radius, 0.014),
            (tip - 0.045, y * 1.04, 1.727, radius * 0.96, 0.013),
            (tip - 0.015, y * 1.06, 1.725, radius * 0.86, 0.0118),
            (tip - 0.005, y * 1.06, 1.725, radius * 0.58, 0.008),
            (tip, y * 1.06, 1.725, 0.0015, 0.0015),
        ], skin, side))
    parts.append(_tube(f'Thumb_{label}', [
        (1.007, -0.032, 1.725, 0.027, 0.024), (1.028, -0.063, 1.724, 0.024, 0.022),
        (1.061, -0.084, 1.724, 0.019, 0.018), (1.087, -0.106, 1.725, 0.016, 0.015),
        (1.101, -0.116, 1.726, 0.010, 0.010), (1.108, -0.119, 1.726, 0.002, 0.002),
    ], skin, side))
    obj = _union(f'Hand_{label}', parts, 0.00145, 0.18)
    for index, (y, tip, radius) in enumerate(fingers):
        _nail(f'Nail_{label}_{index}', tip - 0.019, y * 1.055, 1.736,
              0.013, radius * 0.61, mats['Nails'], side)
        x = tip - 0.045
        _seam(f'KnuckleCrease_{label}_{index}', [(side * (x - 0.002), y - radius * 0.55, 1.738),
              (side * x, y, 1.740), (side * (x - 0.002), y + radius * 0.55, 1.738)],
              0.00045, mats['SkinWarm'])
    _nail(f'ThumbNail_{label}', 1.090, -0.107, 1.739, 0.0115, 0.009,
          mats['Nails'], side, -0.63)
    return obj


def _pants(mats):
    vertices, faces = [], []
    count = 32
    rows = [(0.225, 0.100, 0.102, 0.013), (0.237, 0.108, 0.109, 0.013),
            (0.271, 0.112, 0.116, 0.010), (0.320, 0.108, 0.119, 0.007),
            (0.430, 0.112, 0.123, 0.005), (0.570, 0.113, 0.127, -0.003),
            (0.710, 0.119, 0.133, 0.007), (0.830, 0.126, 0.139, 0.011),
            (0.890, 0.126, 0.141, 0.011)]
    tops = []
    for side in [-1, 1]:
        start = len(vertices)
        for row, (z, rx, ry, cy) in enumerate(rows):
            for i in range(count):
                a = TAU * i / count
                fold = 0.0023 * math.sin(5 * a + row * 1.7) * math.sin(math.pi * row / 8)
                lift = 0.079 * math.sin(a) ** 2 if row == len(rows) - 1 else 0
                vertices.append((side * 0.160 + (rx + fold) * _power(math.cos(a), 0.91),
                                 cy + (ry + fold) * _power(math.sin(a), 0.91), z + lift))
        for row in range(len(rows) - 1):
            for i in range(count):
                a, b = start + row * count + i, start + row * count + (i + 1) % count
                faces.append((a, b, b + count, a + count))
        faces.append(tuple(reversed([start + i for i in range(count)])))
        tops.append(start + (len(rows) - 1) * count)
    left = [tops[0] + i % count for i in range(24, 41)]
    right = [tops[1] + i for i in range(24, 7, -1)]
    middle = []
    for a, b in zip(left, right):
        p, q = Vector(vertices[a]), Vector(vertices[b])
        v = (p + q) / 2
        v.z -= 0.012 * (1 - min(1, abs(v.y - 0.011) / 0.141))
        middle.append(len(vertices))
        vertices.append(tuple(v))
    for i in range(16):
        faces.append((left[i], middle[i], middle[i + 1], left[i + 1]))
        faces.append((middle[i], right[i], right[i + 1], middle[i + 1]))
    boundary = ([tops[0] + i for i in range(8, 25)] + [middle[0]] +
                [tops[1] + i % count for i in range(24, 41)] + [middle[-1]])
    previous = boundary
    for z, rx, ry, cy in [(1.000, 0.287, 0.151, 0.014), (1.052, 0.285, 0.155, 0.016),
                           (1.104, 0.278, 0.152, 0.018), (1.118, 0.275, 0.150, 0.018)]:
        ring = []
        for index in boundary:
            x, y, _ = vertices[index]
            a = math.atan2((y - 0.011) / 0.141, x / 0.286)
            ring.append(len(vertices))
            vertices.append((rx * _power(math.cos(a), 0.85), cy + ry * _power(math.sin(a), 0.85), z))
        for i in range(len(ring)):
            j = (i + 1) % len(ring)
            faces.append((previous[i], previous[j], ring[j], ring[i]))
        previous = ring
    faces.append(tuple(previous))
    obj = mesh('Pants', vertices, faces, mats['Pants'], 2)
    for side, label in [(-1, 'L'), (1, 'R')]:
        _seam(f'PantsOuterSeam_{label}', [(side * 0.270, 0.018, 0.251),
              (side * 0.272, 0.012, 0.445), (side * 0.276, 0.010, 0.640),
              (side * 0.285, 0.018, 0.838), (side * 0.285, 0.020, 1.061)],
              0.0010, mats['RibKnit'])
        _seam(f'PantsHemStitch_{label}', [(side * 0.160 + 0.110 * math.cos(TAU * i / 16),
              0.013 + 0.111 * math.sin(TAU * i / 16), 0.245) for i in range(16)],
              0.00085, mats['RibKnit'], True)
    return obj


_SHOE_PROFILE = [(-0.292, 0.003, 0.083), (-0.282, 0.059, 0.128),
                 (-0.253, 0.094, 0.148), (-0.209, 0.111, 0.156),
                 (-0.151, 0.113, 0.173), (-0.099, 0.110, 0.205),
                 (-0.049, 0.105, 0.231), (0.010, 0.104, 0.239),
                 (0.072, 0.102, 0.229), (0.111, 0.087, 0.207),
                 (0.131, 0.047, 0.165), (0.136, 0.002, 0.087)]


def _shoe_profile(y):
    samples = _samples(_SHOE_PROFILE, 6)
    for a, b in zip(samples, samples[1:]):
        if a[0] <= y <= b[0]:
            t = (y - a[0]) / (b[0] - a[0])
            return a[1] * (1 - t) + b[1] * t, a[2] * (1 - t) + b[2] * t
    return _SHOE_PROFILE[0 if y < _SHOE_PROFILE[0][0] else -1][1:]


def _shoe_top(x, y):
    width, height = _shoe_profile(y)
    return 0.060 + (height - 0.060) * math.sqrt(max(0, 1 - (x / width) ** 2))


def _shoe_side(y, z):
    width, height = _shoe_profile(y)
    return width * math.sqrt(max(0, 1 - ((z - 0.060) / (height - 0.060)) ** 2))


def _shoe_back(dx, z):
    lower, upper = 0.070, 0.136
    for _ in range(18):
        y = (lower + upper) / 2
        if _shoe_top(dx, y) > z:
            lower = y
        else:
            upper = y
    return (lower + upper) / 2


def _sole(name, x, mat, rows):
    vertices, faces = [], []
    count = 64
    for z, rx, ry in rows:
        for i in range(count):
            a = TAU * i / count
            fore = (1 - math.sin(a)) / 2
            vertices.append((x + rx * (0.88 + 0.12 * fore) * _power(math.cos(a), 0.74),
                             -0.080 + ry * _power(math.sin(a), 0.78), z))
    for row in range(len(rows) - 1):
        for i in range(count):
            a, b = row * count + i, row * count + (i + 1) % count
            faces.append((a, b, b + count, a + count))
    faces.extend([tuple(reversed(range(count))),
                  tuple((len(rows) - 1) * count + i for i in range(count))])
    return mesh(name, vertices, faces, mat)


def _waffle(x, label, mats):
    vertices, faces = [], []
    for row in range(14):
        y = -0.266 + row * 0.027
        for col in range(7):
            dx = (col - 3) * 0.026 + (row % 2) * 0.013
            if (abs(dx) / 0.098) ** 3 + (abs(y + 0.080) / 0.194) ** 3 > 0.78:
                continue
            base = len(vertices)
            for z, radius in [(0.006, 0.017), (0.000, 0.017), (0.000, 0.011), (0.006, 0.011)]:
                for a in [0, math.pi / 2, math.pi, 3 * math.pi / 2]:
                    vertices.append((x + dx + radius * math.cos(a), y + radius * math.sin(a), z))
            for ring in range(3):
                for i in range(4):
                    a, b = base + ring * 4 + i, base + ring * 4 + (i + 1) % 4
                    faces.append((a, b, b + 4, a + 4))
            for i in range(4):
                j = (i + 1) % 4
                faces.append((base + 12 + i, base + 12 + j, base + j, base + i))
    return mesh(f'WaffleOutsole_{label}', vertices, faces, mats['SoleLine'])


def _shoe(side, label, mats):
    x = side * 0.170
    sole = _sole(f'Sneaker_{label}', x, mats['Sole'], [
        (0.006, 0.113, 0.211), (0.010, 0.121, 0.219), (0.017, 0.122, 0.220),
        (0.048, 0.122, 0.220), (0.058, 0.118, 0.216), (0.063, 0.112, 0.211)])
    _sole(f'SoleFoxingLine_{label}', x, mats['SoleLine'], [
        (0.044, 0.1224, 0.2204), (0.046, 0.1226, 0.2206), (0.049, 0.1218, 0.2200)])
    _waffle(x, label, mats)
    vertices, faces = [], []
    samples = _samples(_SHOE_PROFILE, 5)
    count = 33
    for y, width, height in samples:
        for i in range(count):
            a = math.pi * i / (count - 1)
            vertices.append((x + width * math.cos(a), y, 0.060 + (height - 0.060) * math.sin(a)))
    for row in range(len(samples) - 1):
        for i in range(count - 1):
            a = row * count + i
            faces.append((a, a + 1, a + count + 1, a + count))
    for row in range(len(samples) - 1):
        a = row * count
        faces.append((a, a + count, a + 2 * count - 1, a + count - 1))
    faces.extend([tuple(reversed(range(count))),
                  tuple((len(samples) - 1) * count + i for i in range(count))])
    mesh(f'ShoeCanvas_{label}', vertices, faces, mats['ShoeCanvas'])
    tongue_vertices, tongue_faces = [], []
    for row in range(15):
        y = -0.202 + row / 14 * 0.169
        width = 0.041 + 0.006 * row / 14
        for col in range(9):
            dx = width * (-1 + col / 4)
            tongue_vertices.append((x + dx, y, _shoe_top(dx, y) + 0.004))
    for row in range(14):
        for col in range(8):
            a = row * 9 + col
            tongue_faces.append((a, a + 1, a + 10, a + 9))
    _shell(mesh(f'ShoeTongue_{label}', tongue_vertices, tongue_faces, mats['ShoeCanvas'], 1), 0.004)
    for edge in [-1, 1]:
        points = [(x + edge * 0.057, y, _shoe_top(0.057, y) + 0.003) for y in [-0.198, -0.162, -0.125, -0.086, -0.044]]
        _seam(f'EyestayStitch_{label}_{edge}', points, 0.0010, mats['Stitch'])
        path = [(y, z) for y, z in [(0.109, 0.107), (0.067, 0.122),
                (0.018, 0.113), (-0.039, 0.111), (-0.100, 0.137),
                (-0.151, 0.116), (-0.210, 0.094)]]
        stripe_vertices, stripe_faces = [], []
        for y, z in _samples(path, 6):
            for dz in [-0.0065, 0.0065]:
                stripe_vertices.append((x + edge * (_shoe_side(y, z + dz) + 0.0022), y, z + dz))
        for i in range(len(stripe_vertices) // 2 - 1):
            a = i * 2
            stripe_faces.append((a, a + 1, a + 3, a + 2))
        _shell(mesh(f'ShoeWaveStripe_{label}_{edge}', stripe_vertices, stripe_faces, mats['Sole']), 0.0015)
        for offset in [-0.014, 0.014]:
            points = [(x + edge * (_shoe_side(y, z + offset) + 0.0014), y, z + offset)
                      for y, z in path]
            _seam(f'ShoeQuarterStitch_{label}_{edge}_{offset}', points, 0.0007, mats['Stitch'])
    for row in range(6):
        y = -0.179 + row * 0.023
        for direction in [-1, 1]:
            points = []
            for dx, dy in [(-0.047 * direction, -0.009), (0, 0), (0.047 * direction, 0.009)]:
                py = y + dy
                points.append((x + dx, py, _shoe_top(dx, py) + (0.011 if direction > 0 else 0.007)))
            _seam(f'Lace_{label}_{row}_{direction}', points, 0.0036, mats['Sole'])
        for edge in [-1, 1]:
            dx = edge * 0.050
            z = _shoe_top(dx, y) + 0.004
            epsilon = 0.0003
            normal = Vector(( -(_shoe_top(dx + epsilon, y) - _shoe_top(dx - epsilon, y)) / (2 * epsilon),
                              -(_shoe_top(dx, y + epsilon) - _shoe_top(dx, y - epsilon)) / (2 * epsilon), 1)).normalized()
            bpy.ops.mesh.primitive_torus_add(major_segments=16, minor_segments=6,
                location=(x + dx, y, z), major_radius=0.0050, minor_radius=0.00135)
            obj = bpy.context.object
            obj.rotation_euler = normal.to_track_quat('Z', 'Y').to_euler()
            finish(obj, f'Eyelet_{label}_{row}_{edge}', mats['Metal'])
    _seam(f'ToeStitch_{label}', [(x + dx, -0.222 + abs(dx) * 0.23,
          _shoe_top(dx, -0.222 + abs(dx) * 0.23) + 0.0015)
          for dx in [-0.092, -0.075, -0.045, 0, 0.045, 0.075, 0.092]], 0.0011, mats['Stitch'])
    collar_vertices, collar_faces, collar_rim = [], [], []
    for row in range(4):
        t = row / 3
        for i in range(64):
            a = TAU * i / 64
            dx, y = 0.096 * math.cos(a), 0.028 + 0.102 * math.sin(a)
            top = 0.222 - 0.009 * math.sin(a)
            bottom = _shoe_top(dx, y)
            collar_vertices.append((x + dx * (1 + 0.025 * math.sin(math.pi * t)), y,
                                    bottom * (1 - t) + top * t))
            if row == 3 and i % 4 == 0:
                collar_rim.append(collar_vertices[-1])
    for row in range(3):
        for i in range(64):
            a, b = row * 64 + i, row * 64 + (i + 1) % 64
            collar_faces.append((a, b, b + 64, a + 64))
    _shell(mesh(f'ShoeCollarFacing_{label}', collar_vertices, collar_faces, mats['ShoeCanvas']), 0.003)
    _seam(f'ShoeCollar_{label}', collar_rim, 0.004, mats['ShoeCanvas'], True)
    heel_vertices, heel_faces = [], []
    for row in range(8):
        z = 0.070 + row / 7 * 0.116
        for col in range(9):
            dx = -0.037 + col / 8 * 0.074
            y = _shoe_back(dx, z)
            heel_vertices.append((x + dx, y + 0.002, z))
    for row in range(7):
        for col in range(8):
            a = row * 9 + col
            heel_faces.append((a, a + 1, a + 10, a + 9))
    _shell(mesh(f'HeelCounter_{label}', heel_vertices, heel_faces, mats['ShoeCanvas'], 1), 0.003)
    for edge in [-1, 1]:
        _seam(f'HeelStitch_{label}_{edge}', [(x + edge * 0.034, _shoe_back(0.034, z) + 0.003, z)
              for z in [0.080, 0.105, 0.130, 0.155, 0.176]], 0.0008, mats['Stitch'])
    return sole


def build_body(mats):
    required = {'Skin', 'SkinWarm', 'Nails', 'Hoodie', 'RibKnit', 'Pants',
                'ShoeCanvas', 'Sole', 'SoleLine', 'Stitch', 'Metal'}
    missing = required.difference(mats)
    if missing:
        raise ValueError(f'Missing body materials: {", ".join(sorted(missing))}')
    if bpy.data.objects.get('Developer') is None:
        raise ValueError('Create the Developer root before build_body(mats)')
    names = ['HoodieBody', 'Hood', 'KangarooPocket', 'Pants', 'Hand_L', 'Hand_R',
             'Sneaker_L', 'Sneaker_R']
    if any(bpy.data.objects.get(name) is not None for name in names):
        raise ValueError('Body objects already exist in this scene')
    torso, hood, pocket = _clothing(mats)
    result = {'HoodieBody': torso, 'Hood': hood, 'KangarooPocket': pocket, 'Pants': _pants(mats)}
    for side, label in [(-1, 'L'), (1, 'R')]:
        result[f'Hand_{label}'] = _hand(side, label, mats)
        result[f'Sneaker_{label}'] = _shoe(side, label, mats)
    bpy.context.view_layer.update()
    return result
