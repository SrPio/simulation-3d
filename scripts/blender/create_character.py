import argparse
import math
import sys
from pathlib import Path

import bmesh
import bpy
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[2]
HEAD_RINGS = [
    (1.685, 0.10, 0.13, 0.01),
    (1.72, 0.21, 0.21, -0.015),
    (1.80, 0.30, 0.26, -0.01),
    (1.93, 0.365, 0.30, 0.0),
    (2.10, 0.395, 0.315, 0.0),
    (2.26, 0.385, 0.305, 0.005),
    (2.37, 0.32, 0.27, 0.01),
    (2.425, 0.22, 0.21, 0.015),
    (2.45, 0.07, 0.09, 0.015),
]


def material(name, color, roughness=0.65, metallic=0.0):
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = (*color, 1)
    mat.use_nodes = True
    shader = mat.node_tree.nodes.get('Principled BSDF')
    shader.inputs['Base Color'].default_value = (*color, 1)
    shader.inputs['Roughness'].default_value = roughness
    shader.inputs['Metallic'].default_value = metallic
    return mat


def finish(obj, name, mat, subdivision=0):
    obj.name = name
    if mat:
        obj.data.materials.append(mat)
    if obj.type == 'MESH':
        for face in obj.data.polygons:
            face.use_smooth = True
    if subdivision:
        mod = obj.modifiers.new('Surface', 'SUBSURF')
        mod.levels = subdivision
        mod.render_levels = subdivision
    obj.parent = bpy.data.objects.get('Developer')
    return obj


def mesh(name, vertices, faces, mat, subdivision=0):
    data = bpy.data.meshes.new(name)
    data.from_pydata(vertices, [], faces)
    data.update()
    bm = bmesh.new()
    bm.from_mesh(data)
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    bm.to_mesh(data)
    bm.free()
    obj = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(obj)
    return finish(obj, name, mat, subdivision)


def oval(name, position, scale, mat, rotation=None):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=32, ring_count=20, location=position)
    obj = bpy.context.object
    obj.scale = scale
    if rotation:
        obj.rotation_euler = rotation
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    return finish(obj, name, mat)


def rounded_box(name, position, size, radius, mat):
    bpy.ops.mesh.primitive_cube_add(size=1, location=position)
    obj = bpy.context.object
    obj.dimensions = size
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    bevel = obj.modifiers.new('SoftEdges', 'BEVEL')
    bevel.width = radius
    bevel.segments = 5
    obj.modifiers.new('WeightedNormals', 'WEIGHTED_NORMAL')
    return finish(obj, name, mat)


def curve(name, points, thickness, mat):
    data = bpy.data.curves.new(name, 'CURVE')
    data.dimensions = '3D'
    data.resolution_u = 12
    data.bevel_depth = thickness
    data.bevel_resolution = 3
    data.use_fill_caps = True
    spline = data.splines.new('BEZIER')
    spline.bezier_points.add(len(points) - 1)
    for item, point in zip(spline.bezier_points, points):
        item.co = point
        item.handle_left_type = 'AUTO'
        item.handle_right_type = 'AUTO'
    obj = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(obj)
    return finish(obj, name, mat)


def signed_power(value, exponent):
    return math.copysign(abs(value) ** exponent, value)


def loft(name, rings, mat, center_x=0, exponent=1, subdivision=1):
    count = 48
    vertices = []
    for z, width, depth, center_y in rings:
        for index in range(count):
            angle = 2 * math.pi * index / count
            vertices.append((center_x + width * signed_power(math.cos(angle), exponent),
                             center_y + depth * signed_power(math.sin(angle), exponent), z))
    faces = []
    for row in range(len(rings) - 1):
        for index in range(count):
            a = row * count + index
            b = row * count + (index + 1) % count
            faces.append((a, b, b + count, a + count))
    faces.append(tuple(reversed(range(count))))
    faces.append(tuple((len(rings) - 1) * count + index for index in range(count)))
    return mesh(name, vertices, faces, mat, subdivision)


def limb(name, a, b, radius, mat, depth_ratio=1.0):
    midpoint = (Vector(a) + Vector(b)) / 2
    distance = (Vector(b) - Vector(a)).length
    obj = oval(name, midpoint, (radius, radius * depth_ratio, distance / 2 + radius * 0.45), mat)
    obj.rotation_euler = (Vector(b) - Vector(a)).to_track_quat('Z', 'Y').to_euler()
    return obj


def head_surface(z, angle, offset=0):
    lower, upper = HEAD_RINGS[0], HEAD_RINGS[-1]
    for a, b in zip(HEAD_RINGS, HEAD_RINGS[1:]):
        if a[0] <= z <= b[0]:
            lower, upper = a, b
            break
    weight = max(0, min(1, (z - lower[0]) / (upper[0] - lower[0])))
    values = [lower[i] + (upper[i] - lower[i]) * weight for i in range(1, 4)]
    width, depth, center_y = values
    return ((width + offset) * signed_power(math.cos(angle), 0.84),
            center_y + (depth + offset) * signed_power(math.sin(angle), 0.84), z)


def build_beard(hair):
    vertices, faces = [], []
    count, rows = 96, 8
    for row in range(rows):
        t = row / (rows - 1)
        for index in range(count):
            angle = 2 * math.pi * index / count
            front = math.sin(angle) < 0
            side = abs(math.cos(angle))
            top = 1.805 + 0.375 * side ** 1.8 if front else 2.20
            bottom = 1.705 + 0.035 * side
            z = bottom + (top - bottom) * t
            vertices.append(head_surface(z, angle, 0.012))
    for row in range(rows - 1):
        for index in range(count):
            a = row * count + index
            b = row * count + (index + 1) % count
            faces.append((a, b, b + count, a + count))
    obj = mesh('BeardContour', vertices, faces, hair, 1)
    solid = obj.modifiers.new('BeardVolume', 'SOLIDIFY')
    solid.thickness = 0.007


def build_cap(burgundy, seam, hair):
    for index, (x, y, z, sx, sy, sz, tilt) in enumerate([
        (-0.17, -0.255, 2.365, 0.085, 0.083, 0.10, -0.3),
        (-0.075, -0.278, 2.385, 0.079, 0.075, 0.115, -0.2),
        (0.03, -0.275, 2.385, 0.083, 0.08, 0.12, 0.15),
        (0.125, -0.25, 2.37, 0.078, 0.075, 0.11, 0.4),
    ]):
        oval(f'HairTuft_{index}', (x, y, z), (sx, sy, sz), hair, (0, tilt, 0))
    vertices, faces = [], []
    rows, columns = 18, 96
    for row in range(rows):
        phi = 0.018 + (math.pi / 2 - 0.018) * row / (rows - 1)
        for column in range(columns):
            theta = math.pi * 2 * column / columns
            vertices.append((0.421 * math.sin(phi) * math.cos(theta),
                             0.012 + 0.347 * math.sin(phi) * math.sin(theta),
                             2.315 + 0.325 * math.cos(phi)))
    for row in range(rows - 1):
        for column in range(columns):
            theta = math.pi * 2 * (column + 0.5) / columns
            opening = abs(theta - 1.5 * math.pi) < 0.47 and row >= 10
            if opening:
                continue
            a = row * columns + column
            b = row * columns + (column + 1) % columns
            faces.append((a, b, b + columns, a + columns))
    cap = mesh('BackwardCap', vertices, faces, burgundy)
    solid = cap.modifiers.new('FabricThickness', 'SOLIDIFY')
    solid.thickness = 0.015
    for segment in range(6):
        theta = segment * math.pi / 3
        points = []
        for index in range(13):
            phi = 0.075 + 1.46 * index / 12
            points.append((0.423 * math.sin(phi) * math.cos(theta),
                           0.012 + 0.350 * math.sin(phi) * math.sin(theta),
                           2.315 + 0.327 * math.cos(phi)))
        curve(f'CapPanel_{segment}', points, 0.0022, seam)
    oval('CapButton', (0, 0.012, 2.643), (0.027, 0.026, 0.012), burgundy)
    curve('CapAdjustmentStrap', [(-0.195, -0.302, 2.32), (0, -0.348, 2.321), (0.195, -0.302, 2.32)], 0.023, burgundy)
    rounded_box('CapBuckle', (0.145, -0.324, 2.319), (0.043, 0.017, 0.046), 0.008, seam)
    vertices, faces = [], []
    for row in range(5):
        t = row / 4
        for index in range(33):
            angle = math.pi * index / 32
            x = 0.405 * math.cos(angle)
            y = 0.025 + (0.28 + 0.28 * t) * math.sin(angle)
            z = 2.314 - 0.045 * t + 0.014 * math.cos(angle) ** 2
            vertices.append((x, y, z))
    for row in range(4):
        for index in range(32):
            a = row * 33 + index
            faces.append((a, a + 1, a + 34, a + 33))
    brim = mesh('BackwardVisor', vertices, faces, burgundy, 1)
    solid = brim.modifiers.new('VisorThickness', 'SOLIDIFY')
    solid.thickness = 0.018


def sleeve(side, label, mat):
    rings = [(1.065, 0.46, -0.047, 0.078), (1.105, 0.449, -0.041, 0.093),
             (1.22, 0.414, -0.024, 0.101), (1.30, 0.384, -0.005, 0.109),
             (1.42, 0.348, 0.015, 0.119), (1.52, 0.305, 0.015, 0.126),
             (1.585, 0.278, 0.015, 0.072), (1.61, 0.264, 0.015, 0.024)]
    vertices, faces = [], []
    count = 32
    for z, x, y, radius in rings:
        for index in range(count):
            angle = 2 * math.pi * index / count
            vertices.append((side * x + radius * math.cos(angle), y + radius * 0.97 * math.sin(angle), z))
    for row in range(len(rings) - 1):
        for index in range(count):
            a = row * count + index
            b = row * count + (index + 1) % count
            faces.append((a, b, b + count, a + count))
    faces.append(tuple(reversed(range(count))))
    faces.append(tuple((len(rings) - 1) * count + index for index in range(count)))
    return mesh(f'Sleeve_{label}', vertices, faces, mat, 2)


def build_character():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.scene.unit_settings.system = 'METRIC'
    bpy.context.scene.unit_settings.scale_length = 1
    root = bpy.data.objects.new('Developer', None)
    bpy.context.collection.objects.link(root)
    root['stage'] = '01A-proportions'
    root['height_units'] = 'meters'
    skin = material('Skin', (0.58, 0.365, 0.225), 0.58)
    skin_shadow = material('SkinWarm', (0.39, 0.19, 0.115), 0.62)
    hair = material('Hair', (0.022, 0.017, 0.014), 0.6)
    eye = material('Eyes', (0.009, 0.007, 0.006), 0.22)
    hoodie = material('Hoodie', (0.018, 0.02, 0.024), 0.86)
    rib = material('RibKnit', (0.012, 0.014, 0.018), 0.92)
    pants = material('Pants', (0.023, 0.026, 0.033), 0.84)
    cap = material('CapBurgundy', (0.066, 0.008, 0.023), 0.8)
    cap_seam = material('CapSeams', (0.038, 0.005, 0.013), 0.84)
    shoe = material('ShoeCanvas', (0.012, 0.013, 0.017), 0.8)
    sole = material('Sole', (0.79, 0.775, 0.73), 0.7)
    rubber = material('SoleLine', (0.032, 0.035, 0.039), 0.77)

    loft('Head', HEAD_RINGS, skin, exponent=0.84, subdivision=2)
    oval('Neck', (0, 0.015, 1.684), (0.135, 0.125, 0.15), skin)
    build_beard(hair)
    for side, label in [(-1, 'L'), (1, 'R')]:
        oval(f'Ear_{label}', (side * 0.397, 0.018, 2.13), (0.077, 0.085, 0.12), skin, (0, side * 0.1, 0))
        oval(f'EarInner_{label}', (side * 0.438, -0.029, 2.138), (0.029, 0.038, 0.065), skin_shadow)
        oval(f'Eye_{label}', (side * 0.146, -0.311, 2.166), (0.037, 0.026, 0.059), eye)
        curve(f'Eyebrow_{label}', [(side * 0.079, -0.316, 2.267), (side * 0.153, -0.313, 2.277), (side * 0.223, -0.296, 2.259)], 0.016, hair)
        curve(f'Moustache_{label}', [(side * 0.015, -0.318, 1.965), (side * 0.072, -0.315, 1.974), (side * 0.125, -0.304, 1.947), (side * 0.141, -0.294, 1.919)], 0.014, hair)
    oval('NoseBridge', (0, -0.307, 2.089), (0.045, 0.045, 0.105), skin)
    oval('NoseTip', (0, -0.36, 2.035), (0.062, 0.059, 0.041), skin)
    oval('Muzzle', (0, -0.293, 1.919), (0.101, 0.017, 0.035), skin)
    curve('Mouth', [(-0.068, -0.311, 1.923), (0, -0.316, 1.916), (0.066, -0.31, 1.923)], 0.0045, skin_shadow)
    oval('ChinPatch', (0, -0.259, 1.833), (0.038, 0.018, 0.055), hair)
    build_cap(cap, cap_seam, hair)

    loft('SweatshirtBody', [(1.025, 0.25, 0.165, 0.022), (1.065, 0.28, 0.184, 0.018),
                           (1.17, 0.28, 0.195, 0.012), (1.39, 0.30, 0.19, 0.007),
                           (1.52, 0.32, 0.18, 0.015), (1.60, 0.275, 0.15, 0.015),
                           (1.65, 0.14, 0.116, 0.015)], hoodie, exponent=0.84, subdivision=2)
    loft('HoodieHem', [(1.023, 0.25, 0.169, 0.023), (1.035, 0.269, 0.18, 0.023),
                      (1.09, 0.275, 0.184, 0.02), (1.101, 0.271, 0.181, 0.02)], rib)
    oval('HoodBack', (0, 0.119, 1.595), (0.21, 0.15, 0.147), hoodie)
    curve('HoodOpening', [(-0.128, -0.064, 1.665), (-0.16, -0.13, 1.605),
                          (0, -0.165, 1.562), (0.16, -0.13, 1.605), (0.128, -0.064, 1.665)], 0.033, rib)
    rounded_box('KangarooPocket', (0, -0.177, 1.184), (0.337, 0.047, 0.183), 0.055, hoodie)
    for side, label in [(-1, 'L'), (1, 'R')]:
        sleeve(side, label, hoodie)
        limb(f'Cuff_{label}', (side * 0.444, -0.041, 1.11), (side * 0.458, -0.047, 1.064), 0.084, rib)
        oval(f'Palm_{label}', (side * 0.47, -0.051, 0.995), (0.075, 0.053, 0.09), skin, (0, side * 0.12, 0))
        for finger in range(4):
            x = side * (0.429 + finger * 0.026)
            bottom = 0.899 + abs(finger - 1.5) * 0.009
            limb(f'Finger_{label}_{finger}', (x, -0.058, 0.981), (x + side * 0.006, -0.067, bottom), 0.0145, skin, 0.88)
        limb(f'Thumb_{label}', (side * 0.415, -0.06, 1.015), (side * 0.392, -0.088, 0.958), 0.024, skin)
        loft(f'TrouserLeg_{label}', [(0.207, 0.106, 0.111, 0.005), (0.24, 0.116, 0.124, 0.005),
                                  (0.36, 0.121, 0.131, 0.012), (0.59, 0.115, 0.137, -0.012),
                                  (0.77, 0.132, 0.151, 0.012), (0.94, 0.143, 0.159, 0.02),
                                  (1.08, 0.143, 0.157, 0.025)], pants, side * 0.151, exponent=0.85, subdivision=2)
        x = side * 0.153
        loft(f'ShoeSole_{label}', [(0.003, 0.116, 0.212, -0.075), (0.012, 0.124, 0.222, -0.075),
                                  (0.064, 0.125, 0.223, -0.075), (0.081, 0.119, 0.215, -0.075)], sole, x, exponent=0.72)
        loft(f'ShoeSoleTrim_{label}', [(0.065, 0.125, 0.224, -0.075), (0.07, 0.125, 0.224, -0.075),
                                      (0.076, 0.122, 0.22, -0.075)], rubber, x, exponent=0.72)
        loft(f'ShoeUpper_{label}', [(0.076, 0.113, 0.208, -0.075), (0.11, 0.118, 0.213, -0.07),
                                   (0.15, 0.114, 0.20, -0.056), (0.205, 0.096, 0.151, -0.027),
                                   (0.253, 0.074, 0.105, 0.013), (0.266, 0.064, 0.091, 0.02)], shoe, x, exponent=0.78)
        oval(f'ShoeTongue_{label}', (x, -0.055, 0.214), (0.057, 0.105, 0.013), shoe, (0.35, 0, 0))
        for lace in range(5):
            y = -0.158 + lace * 0.028
            z = 0.181 + lace * 0.012
            curve(f'Lace_{label}_{lace}', [(x - 0.042, y - 0.007, z - 0.005), (x, y, z + 0.006), (x + 0.042, y + 0.007, z - 0.005)], 0.005, sole)
        for outer in [-1, 1]:
            curve(f'ShoeStripe_{label}_{outer}', [(x + outer * 0.105, -0.18, 0.126),
                                                 (x + outer * 0.117, -0.115, 0.151),
                                                 (x + outer * 0.116, -0.04, 0.136),
                                                 (x + outer * 0.094, 0.07, 0.17)], 0.008, sole)
    return root


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--replace-generated', action='store_true')
    args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else [])
    destination = ROOT / 'assets' / 'blender' / 'developer.blend'
    if destination.exists() and not args.replace_generated:
        raise RuntimeError('Source already exists. Review changes before using --replace-generated.')
    build_character()
    destination.parent.mkdir(parents=True, exist_ok=True)
    bpy.context.scene.render.engine = 'CYCLES'
    bpy.context.scene.cycles.samples = 48
    bpy.context.scene.view_settings.view_transform = 'AgX'
    bpy.ops.wm.save_as_mainfile(filepath=str(destination), compress=False)
    print(f'Character source: {destination}')


if __name__ == '__main__':
    main()
