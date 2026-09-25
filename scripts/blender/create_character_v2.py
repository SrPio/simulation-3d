import argparse
import math
import re
import sys
from pathlib import Path

import bpy
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree

sys.path.insert(0, str(Path(__file__).resolve().parent))
from create_character import curve, finish, limb, material, mesh, oval, rounded_box, signed_power

ROOT = Path(__file__).resolve().parents[2]
HEAD = [(1.815, 0.05, 0.065, -0.015), (1.85, 0.125, 0.125, -0.025),
        (1.91, 0.208, 0.185, -0.025), (2.015, 0.272, 0.239, -0.008),
        (2.16, 0.318, 0.268, 0.0), (2.31, 0.327, 0.270, 0.0),
        (2.405, 0.305, 0.255, 0.006), (2.50, 0.205, 0.195, 0.012),
        (2.54, 0.03, 0.045, 0.012)]


def profile(rings, z):
    for i in range(len(rings) - 1):
        if rings[i][0] <= z <= rings[i + 1][0]:
            break
    a, b = rings[i], rings[i + 1]
    p, q = rings[max(0, i - 1)], rings[min(len(rings) - 1, i + 2)]
    t = max(0, min(1, (z - a[0]) / (b[0] - a[0])))
    values = []
    for j in range(1, len(a)):
        m0 = (b[j] - p[j]) / (b[0] - p[0]) * (b[0] - a[0])
        m1 = (q[j] - a[j]) / (q[0] - a[0]) * (b[0] - a[0])
        values.append((2*t**3 - 3*t**2 + 1)*a[j] + (t**3 - 2*t**2 + t)*m0
                      + (-2*t**3 + 3*t**2)*b[j] + (t**3 - t**2)*m1)
    return values


def surface(z, angle, offset=0):
    width, depth, cy = profile(HEAD, z)
    return ((width + offset) * signed_power(math.cos(angle), 0.87),
            cy + (depth + offset) * signed_power(math.sin(angle), 0.87), z)


def face_y(x, z):
    width, depth, cy = profile(HEAD, z)
    cosine = min(1, abs(x / width) ** (1 / 0.87))
    return cy - depth * (1 - cosine * cosine) ** (0.87 / 2)


def smooth_loft(name, rings, mat, center_x=0, exponent=0.87, folds=0):
    vertices, faces = [], []
    rows, columns = 64, 64
    for row in range(rows):
        z = rings[0][0] + (rings[-1][0] - rings[0][0]) * row / (rows - 1)
        width, depth, cy = profile(rings, z)
        for col in range(columns):
            angle = 2 * math.pi * col / columns
            wave = folds * math.sin(angle * 3 + z * 15) * (math.exp(-((z - rings[0][0] - 0.09) / 0.07)**2)
                    + 0.5 * math.exp(-((z - 0.65) / 0.1)**2))
            vertices.append((center_x + (width + wave) * signed_power(math.cos(angle), exponent),
                             cy + (depth + wave) * signed_power(math.sin(angle), exponent), z))
    for row in range(rows - 1):
        for col in range(columns):
            a, b = row * columns + col, row * columns + (col + 1) % columns
            faces.append((a, b, b + columns, a + columns))
    faces.append(tuple(reversed(range(columns))))
    faces.append(tuple((rows - 1) * columns + i for i in range(columns)))
    return mesh(name, vertices, faces, mat)


def patch(name, mat, start, end, bottom, top, offset=0.003, columns=72):
    vertices, faces = [], []
    rows = 24
    for row in range(rows):
        t = row / (rows - 1)
        for col in range(columns):
            angle = start + (end - start) * col / (columns - 1)
            z = bottom(angle) * (1 - t) + top(angle) * t
            vertices.append(surface(z, angle, offset))
    for row in range(rows - 1):
        for col in range(columns - 1):
            a = row * columns + col
            faces.append((a, a + 1, a + columns + 1, a + columns))
    obj = mesh(name, vertices, faces, mat)
    solid = obj.modifiers.new('EdgeThickness', 'SOLIDIFY')
    solid.thickness = 0.003
    return obj


def face_curve(name, points, thickness, mat, offset=0.005):
    return curve(name, [(x, face_y(x, z) - offset, z) for x, z in points], thickness, mat)


def build_face(mats):
    skin, hair, beard = mats['Skin'], mats['Hair'], mats['Beard']
    smooth_loft('Head', HEAD, skin)
    oval('Neck', (0, 0.025, 1.815), (0.102, 0.105, 0.148), skin)
    patch('HairScalp', hair, -math.pi * 0.09, math.pi * 1.09,
          lambda a: 2.185 - 0.245 * max(0, math.sin(a)), lambda a: 2.43, 0.006)
    patch('BeardContour', beard, -math.pi + 0.075, -0.075,
          lambda a: 1.821 + 0.083 * abs(math.cos(a))**2,
          lambda a: 1.964 + 0.028 * math.exp(-(math.cos(a)/0.14)**2) + 0.29 * abs(math.cos(a))**2.8, 0.0035)
    for side, label in [(-1, 'L'), (1, 'R')]:
        x = side * 0.119
        oval(f'Ear_{label}', (side * 0.328, 0.012, 2.225), (0.052, 0.06, 0.092), skin)
        oval(f'EarInner_{label}', (side * 0.353, -0.034, 2.228), (0.026, 0.015, 0.052), mats['SkinWarm'])
        curve(f'EarFold_{label}', [(side * 0.358, -0.045, 2.26), (side * 0.342, -0.052, 2.265),
                                 (side * 0.338, -0.054, 2.225), (side * 0.354, -0.047, 2.209)], 0.007, skin)
        oval(f'Eye_{label}', (x, face_y(x, 2.246) - 0.006, 2.246), (0.023, 0.011, 0.034), mats['Eyes'])
        face_curve(f'Eyebrow_{label}', [(side*0.065, 2.322), (side*0.12, 2.328), (side*0.181, 2.318)], 0.0115, hair)
        face_curve(f'Moustache_{label}', [(side*0.004, 2.063), (side*0.034, 2.073),
                                         (side*0.074, 2.063), (side*0.105, 2.045)], 0.015, beard, 0.01)
        face_curve(f'LowerLip_{label}', [(0, 2.012), (side*0.034, 2.014), (side*0.055, 2.024)], 0.006, mats['Lips'], 0.006)
    smooth_loft('Nose', [(2.098, 0.018, 0.013, -0.274), (2.112, 0.042, 0.023, -0.283),
                        (2.137, 0.042, 0.036, -0.29), (2.158, 0.031, 0.024, -0.28),
                        (2.195, 0.02, 0.016, -0.265), (2.224, 0.014, 0.01, -0.26)], skin, exponent=1)
    face_curve('Mouth', [(-0.059, 2.027), (0, 2.023), (0.059, 2.027)], 0.0034, mats['SkinWarm'], 0.012)


def tube(name, sections, mat):
    vertices, faces = [], []
    count = 40
    for index, (cx, cy, z, rx, ry) in enumerate(sections):
        center = Vector((cx, cy, z))
        prev = Vector(sections[max(index - 1, 0)][:3])
        following = Vector(sections[min(index + 1, len(sections) - 1)][:3])
        tangent = (following - prev).normalized()
        u = Vector((1, 0, 0))
        u = (u - tangent * u.dot(tangent)).normalized()
        v = tangent.cross(u).normalized()
        for col in range(count):
            angle = col * 2 * math.pi / count
            point = center + u * (rx * math.cos(angle)) + v * (ry * math.sin(angle))
            vertices.append(tuple(point))
    for row in range(len(sections) - 1):
        for col in range(count):
            a, b = row * count + col, row * count + (col + 1) % count
            faces.append((a, b, b + count, a + count))
    faces.append(tuple(reversed(range(count))))
    faces.append(tuple((len(sections) - 1) * count + i for i in range(count)))
    return mesh(name, vertices, faces, mat, 2)


def build_hand(side, label, skin):
    pieces = [oval(f'Palm_{label}', (0, 0, -0.052), (0.068, 0.032, 0.078), skin)]
    for index, (x, length) in enumerate([(-0.045, 0.095), (-0.015, 0.123), (0.017, 0.114), (0.047, 0.085)]):
        a = (side*x, 0, -0.097)
        b = (side*(x + (index - 1.5)*0.004), -0.009, -0.097 - length)
        pieces.append(limb(f'Finger_{label}_{index}', a, b, 0.015 if index < 3 else 0.013, skin, 0.91))
    pieces.append(limb(f'Thumb_{label}', (-side*0.058, -0.002, -0.024), (-side*0.095, -0.016, -0.082), 0.023, skin))
    pieces.append(limb(f'ThumbTip_{label}', (-side*0.095, -0.016, -0.075), (-side*0.107, -0.026, -0.105), 0.018, skin))
    bpy.ops.object.select_all(action='DESELECT')
    for obj in pieces:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = pieces[0]
    bpy.ops.object.join()
    hand = bpy.context.object
    hand.name = f'Hand_{label}'
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    remesh = hand.modifiers.new('ConnectedSurface', 'REMESH')
    remesh.mode = 'VOXEL'
    remesh.voxel_size = 0.005
    remesh.use_smooth_shade = True
    bpy.ops.object.modifier_apply(modifier=remesh.name)
    smooth = hand.modifiers.new('SoftenJoints', 'SMOOTH')
    smooth.factor = 0.65
    smooth.iterations = 4
    bpy.ops.object.modifier_apply(modifier=smooth.name)
    hand.location = (side*0.60, -0.024, 1.237)
    hand.rotation_euler.y = -side*0.28
    return hand


def build_clothing(mats):
    hoodie, rib, pants = mats['Hoodie'], mats['RibKnit'], mats['Pants']
    smooth_loft('SweatshirtBody', [(1.105, 0.249, 0.16, 0.017), (1.125, 0.28, 0.177, 0.012),
                                 (1.23, 0.286, 0.196, 0.012), (1.42, 0.274, 0.186, 0.014),
                                 (1.65, 0.298, 0.174, 0.02), (1.755, 0.235, 0.135, 0.017),
                                 (1.81, 0.121, 0.106, 0.018)], hoodie, folds=0.006)
    smooth_loft('HoodieHem', [(1.091, 0.25, 0.164, 0.017), (1.101, 0.263, 0.175, 0.017),
                            (1.138, 0.272, 0.179, 0.015), (1.155, 0.277, 0.181, 0.013)], rib)
    ring_specs = [(1.686, 0.105, 0.06, 0.14), (1.71, 0.17, 0.119, 0.12),
                  (1.78, 0.211, 0.172, 0.082), (1.87, 0.178, 0.14, 0.041),
                  (1.905, 0.148, 0.112, 0.019), (1.909, 0.135, 0.096, 0.019),
                  (1.866, 0.12, 0.085, 0.034), (1.768, 0.083, 0.055, 0.09)]
    vertices, faces = [], []
    count = 64
    for z, rx, ry, cy in ring_specs:
        for i in range(count):
            angle = 2*math.pi*i/count
            vertices.append((rx*math.cos(angle), cy+ry*math.sin(angle), z))
    for row in range(len(ring_specs) - 1):
        for i in range(count):
            a, b = row*count+i, row*count+(i+1)%count
            faces.append((a, b, b+count, a+count))
    mesh('Hood', vertices, faces, hoodie, 2)
    pocket_outline = [(-0.18, 1.16), (-0.19, 1.25), (-0.112, 1.375), (0.112, 1.375), (0.19, 1.25), (0.18, 1.16)]
    outline = [(x, -0.188 - 0.018*(1-abs(x)/0.2), z) for x, z in pocket_outline]
    vertices = [(0, -0.223, 1.258), *outline]
    faces = [(0, i+1, (i+1)%len(outline)+1) for i in range(len(outline))]
    pocket = mesh('KangarooPocket', vertices, faces, hoodie, 2)
    solid = pocket.modifiers.new('FabricThickness', 'SOLIDIFY')
    solid.thickness = 0.008
    curve('PocketHem', [(-0.166, -0.2, 1.166), (0, -0.209, 1.163), (0.166, -0.2, 1.166)], 0.0025, rib)
    for side, label in [(-1, 'L'), (1, 'R')]:
        sections = [(side*0.585, -0.021, 1.262, 0.072, 0.07), (side*0.568, -0.017, 1.292, 0.083, 0.082),
                    (side*0.533, -0.011, 1.348, 0.083, 0.083), (side*0.47, -0.002, 1.443, 0.088, 0.088),
                    (side*0.431, 0.002, 1.496, 0.092, 0.094), (side*0.357, 0.013, 1.625, 0.106, 0.106),
                    (side*0.30, 0.018, 1.712, 0.108, 0.113), (side*0.264, 0.018, 1.754, 0.068, 0.088),
                    (side*0.235, 0.017, 1.772, 0.02, 0.028)]
        tube(f'Sleeve_{label}', sections, hoodie)
        tube(f'Cuff_{label}', [(side*0.605, -0.023, 1.234, 0.065, 0.065),
                             (side*0.603, -0.023, 1.24, 0.073, 0.07),
                             (side*0.574, -0.02, 1.283, 0.077, 0.075),
                             (side*0.568, -0.02, 1.29, 0.071, 0.07)], rib)
        curve(f'PocketOpening_{label}', [(side*0.116, -0.199, 1.366), (side*0.145, -0.202, 1.303),
                                       (side*0.18, -0.198, 1.254)], 0.003, rib)
        curve(f'ShoulderSeam_{label}', [(side*0.239, -0.108, 1.739), (side*0.30, -0.095, 1.704),
                                      (side*0.325, -0.07, 1.649)], 0.002, rib)
        build_hand(side, label, mats['Skin'])
        smooth_loft(f'TrouserLeg_{label}', [(0.229, 0.097, 0.10, 0.012), (0.247, 0.106, 0.11, 0.012),
                                          (0.302, 0.115, 0.126, 0.005), (0.375, 0.105, 0.121, 0.003),
                                          (0.62, 0.108, 0.128, -0.006), (0.83, 0.126, 0.146, 0.016),
                                          (1.035, 0.145, 0.157, 0.025), (1.115, 0.15, 0.157, 0.024)],
                    pants, side*0.16, folds=0.005)
        curve(f'TrouserSeam_{label}', [(side*0.268, 0.02, 0.27), (side*0.269, 0.03, 0.61),
                                     (side*0.286, 0.04, 0.83), (side*0.301, 0.045, 1.055)], 0.0017, rib)


def refine_shoes(mats):
    bpy.context.view_layer.update()
    for side, label in [(-1, 'L'), (1, 'R')]:
        x = side*0.173
        upper = bpy.data.objects[f'ShoeUpper_{label}']
        tree = BVHTree.FromObject(upper, bpy.context.evaluated_depsgraph_get())
        inverse = upper.matrix_world.inverted()
        def contact(px, py, offset=0.006):
            hit, normal, _, _ = tree.ray_cast(inverse @ Vector((px, py, 0.8)), Vector((0, 0, -1)))
            if hit is None:
                raise RuntimeError(f'Missing shoe surface at {px}, {py}')
            point = upper.matrix_world @ hit
            point.z += offset
            return tuple(point)
        for row in range(6):
            y = -0.177 + row*0.027
            for direction in [-1, 1]:
                coords = [(x-direction*0.042, y-0.01), (x, y), (x+direction*0.042, y+0.01)]
                curve(f'Lace_{label}_{row}_{direction}', [contact(px, py, 0.008 if direction == 1 else 0.004) for px, py in coords], 0.0048, mats['Sole'])
            for edge in [-1, 1]:
                point = contact(x+edge*0.052, y, 0.005)
                bpy.ops.mesh.primitive_torus_add(major_segments=16, minor_segments=8, location=point, major_radius=0.007, minor_radius=0.002)
                finish(bpy.context.object, f'Eyelet_{label}_{row}_{edge}', mats['EyeletMetal'])
        curve(f'ShoeToeSeam_{label}', [contact(x+dx, -0.211+abs(dx)*0.22, 0.003) for dx in [-0.077, -0.04, 0, 0.04, 0.077]], 0.0018, mats['ShoeSeam'])
        rounded_box(f'HeelLabel_{label}', (x, 0.147, 0.041), (0.058, 0.004, 0.022), 0.002, mats['CapBurgundy'])
        rounded_box(f'HeelLabelInset_{label}', (x, 0.150, 0.043), (0.038, 0.002, 0.005), 0.001, mats['Sole'])


def build_copy():
    source = ROOT / 'assets' / 'blender' / 'developer.blend'
    bpy.ops.wm.open_mainfile(filepath=str(source))
    root = bpy.data.objects['Developer']
    root['stage'] = '01B-model-sheet-v2'
    root['source_version'] = 'developer-v1'
    cap_prefixes = ('Backward', 'Cap', 'HairTuft')
    shoe_prefixes = ('ShoeSole', 'ShoeUpper', 'ShoeStripe')
    for obj in list(root.children_recursive):
        if obj.name.startswith(cap_prefixes):
            transform = Matrix.Translation((0, 0, 1.82)) @ Matrix.Diagonal((0.83, 0.87, 0.86, 1)) @ Matrix.Translation((0, 0, -1.685))
            obj.matrix_world = transform @ obj.matrix_world
        elif obj.name.startswith(shoe_prefixes):
            side = -1 if re.search(r'_L(?:_|$)', obj.name) else 1
            obj.location.x += side*0.02
        else:
            bpy.data.objects.remove(obj, do_unlink=True)
    mats = {mat.name: mat for mat in bpy.data.materials}
    mats['Beard'] = material('Beard', (0.035, 0.025, 0.021), 0.9)
    mats['Lips'] = material('Lips', (0.43, 0.215, 0.145), 0.7)
    mats['EyeletMetal'] = material('EyeletMetal', (0.09, 0.092, 0.098), 0.44, 0.55)
    mats['ShoeSeam'] = material('ShoeSeam', (0.034, 0.036, 0.041), 0.95)
    mats['Hoodie'].node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.01, 0.011, 0.014, 1)
    mats['Pants'].node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.013, 0.014, 0.018, 1)
    mats['Skin'].node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.56, 0.342, 0.215, 1)
    build_face(mats)
    build_clothing(mats)
    refine_shoes(mats)
    bpy.context.view_layer.update()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--replace-generated-v2', action='store_true')
    args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else [])
    destination = ROOT / 'assets' / 'blender' / 'developer-v2.blend'
    if destination.exists() and not args.replace_generated_v2:
        raise RuntimeError('V2 already exists. Review it before using --replace-generated-v2.')
    build_copy()
    bpy.ops.wm.save_as_mainfile(filepath=str(destination), compress=False)
    print(f'Independent V2 source: {destination}')


if __name__ == '__main__':
    main()
