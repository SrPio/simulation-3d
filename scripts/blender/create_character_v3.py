import argparse
import math
import sys
from pathlib import Path

import bpy
import numpy as np
from mathutils import Vector

sys.path.insert(0, str(Path(__file__).resolve().parent))
from create_character import curve, finish, material, mesh, oval, rounded_box, signed_power

ROOT = Path(__file__).resolve().parents[2]
HEAD = [(1.874, 0.065, 0.084, -0.024), (1.899, 0.126, 0.137, -0.02),
        (1.94, 0.185, 0.183, -0.007), (2.01, 0.235, 0.215, 0.0),
        (2.105, 0.266, 0.239, 0.003), (2.23, 0.278, 0.248, 0.004),
        (2.365, 0.275, 0.247, 0.008), (2.465, 0.247, 0.225, 0.017),
        (2.535, 0.155, 0.146, 0.025), (2.56, 0.025, 0.035, 0.025)]


def smooth_profile(rings, z):
    index = len(rings) - 2
    for i in range(len(rings) - 1):
        if rings[i][0] <= z <= rings[i+1][0]:
            index = i
            break
    a, b = rings[index], rings[index+1]
    before = rings[max(0, index-1)]
    after = rings[min(len(rings)-1, index+2)]
    t = max(0, min(1, (z-a[0])/(b[0]-a[0])))
    values = []
    for channel in range(1, len(a)):
        m0 = (b[channel]-before[channel])/(b[0]-before[0])*(b[0]-a[0])
        m1 = (after[channel]-a[channel])/(after[0]-a[0])*(b[0]-a[0])
        values.append((2*t**3-3*t*t+1)*a[channel] + (t**3-2*t*t+t)*m0
                      + (-2*t**3+3*t*t)*b[channel] + (t**3-t*t)*m1)
    return values


def face_displacement(x, z):
    bridge = 0.020 * math.exp(-(x/0.023)**2 - ((z-2.166)/0.064)**2)
    tip = 0.045 * math.exp(-(x/0.043)**2 - ((z-2.114)/0.029)**2)
    wings = 0.005 * math.exp(-((abs(x)-0.036)/0.012)**2 - ((z-2.099)/0.013)**2)
    lips = 0.004 * math.exp(-(x/0.066)**4) * (math.exp(-((z-2.047)/0.009)**2) + math.exp(-((z-2.028)/0.01)**2))
    cheeks = 0.004 * math.exp(-((abs(x)-0.145)/0.065)**2 - ((z-2.10)/0.08)**2)
    return bridge + tip + wings + lips + cheeks


def head_point(z, angle, offset=0):
    width, depth, cy = smooth_profile(HEAD, z)
    x = width * signed_power(math.cos(angle), 0.74)
    y = cy + depth * signed_power(math.sin(angle), 0.74)
    if math.sin(angle) < 0:
        y -= face_displacement(x, z) * (-math.sin(angle))**5
    return (x + offset*math.cos(angle), y + offset*math.sin(angle), z)


def front_point(x, z, offset=0.002):
    width, _, _ = smooth_profile(HEAD, z)
    cosine = math.copysign(min(0.9999, abs(x/width)**(1/0.74)), x)
    point = head_point(z, -math.acos(cosine))
    return (point[0], point[1]-offset, z)


def surface_mesh(name, rows, columns, fn, mat, wrap=False, caps=False, uv_scale=None):
    vertices = [fn(row/(rows-1), col/(columns-1 if not wrap else columns)) for row in range(rows) for col in range(columns)]
    faces = []
    for row in range(rows-1):
        for col in range(columns if wrap else columns-1):
            a = row*columns+col
            b = row*columns+(col+1)%columns
            faces.append((a, b, b+columns, a+columns))
    if caps:
        faces.extend([tuple(reversed(range(columns))), tuple((rows-1)*columns+i for i in range(columns))])
    obj = mesh(name, vertices, faces, mat)
    if uv_scale:
        layer = obj.data.uv_layers.new(name='SurfaceUV')
        for polygon in obj.data.polygons:
            for loop in polygon.loop_indices:
                index = obj.data.loops[loop].vertex_index
                layer.data[loop].uv = ((index%columns)/(columns-1)*uv_scale[0], (index//columns)/(rows-1)*uv_scale[1])
    return obj


def build_skin(mats):
    surface_mesh('Head', 161, 192, lambda v, u: head_point(HEAD[0][0]+(HEAD[-1][0]-HEAD[0][0])*v, u*2*math.pi), mats['Skin'], wrap=True, caps=True)
    oval('Neck', (0, 0.024, 1.839), (0.10, 0.102, 0.143), mats['Skin'])
    for side, label in [(-1, 'L'), (1, 'R')]:
        oval(f'Ear_{label}', (side*0.282, -0.006, 2.193), (0.043, 0.049, 0.081), mats['Skin'])
        oval(f'EarConcha_{label}', (side*0.303, -0.041, 2.195), (0.022, 0.009, 0.048), mats['SkinWarm'])
        curve(f'EarHelix_{label}', [(side*0.303, -0.05, 2.252), (side*0.323, -0.04, 2.229),
                                  (side*0.323, -0.041, 2.193), (side*0.309, -0.047, 2.155),
                                  (side*0.296, -0.05, 2.156)], 0.0065, mats['Skin'])
        curve(f'EarAntihelix_{label}', [(side*0.305, -0.052, 2.226), (side*0.294, -0.055, 2.213),
                                      (side*0.30, -0.056, 2.186)], 0.005, mats['Skin'])
        oval(f'EarTragus_{label}', (side*0.283, -0.053, 2.18), (0.011, 0.009, 0.016), mats['Skin'])
        x, z = side*0.103, 2.225
        oval(f'Eye_{label}', front_point(x, z, 0.007), (0.023, 0.013, 0.034), mats['Eyes'])
        sculpt_ribbon(f'Eyebrow_{label}', [(side*0.048, 2.294, 0.001), (side*0.072, 2.302, 0.011),
                                         (side*0.121, 2.303, 0.012), (side*0.167, 2.292, 0.001)], mats['Hair'], 0.0035)
    curve('MouthLine', [front_point(-0.061, 2.047, 0.003), front_point(-0.025, 2.04, 0.004),
                        front_point(0.026, 2.04, 0.004), front_point(0.06, 2.047, 0.003)], 0.0026, mats['LipCrease'])
    curve('LowerLip', [front_point(-0.044, 2.034), front_point(0, 2.03, 0.004), front_point(0.044, 2.034)], 0.003, mats['Lips'])


def sculpt_ribbon(name, controls, mat, depth=0.008):
    controls = [(i/(len(controls)-1), *point) for i, point in enumerate(controls)]
    vertices, faces = [], []
    rows, columns = 49, 16
    for row in range(rows):
        x, z, radius = smooth_profile(controls, row/(rows-1))
        y = front_point(x, z, 0.003)[1]
        for col in range(columns):
            angle = col*2*math.pi/columns
            vertices.append((x, y-depth*math.cos(angle), z+radius*math.sin(angle)))
    for row in range(rows-1):
        for col in range(columns):
            a, b = row*columns+col, row*columns+(col+1)%columns
            faces.append((a, b, b+columns, a+columns))
    faces.extend([tuple(reversed(range(columns))), tuple((rows-1)*columns+i for i in range(columns))])
    return mesh(name, vertices, faces, mat)


def build_hair(mats):
    def scalp(v, u):
        angle = -0.16 + (math.pi+0.32)*u
        bottom = 2.305 - 0.322 * max(0, math.sin(angle))**0.8
        z = bottom + (2.465-bottom)*v
        grooves = 0.0015 * math.sin(angle*48 + v*2 + 0.5*math.sin(angle*7)) * math.sin(math.pi*v)**0.6
        return head_point(z, angle, 0.008+grooves)
    hair = surface_mesh('HairScalp', 49, 129, scalp, mats['Hair'])
    solid = hair.modifiers.new('HairThickness', 'SOLIDIFY')
    solid.thickness = 0.004
    def beard(v, u):
        angle = -math.pi-0.075 + (math.pi+0.15)*u
        side = abs(math.cos(angle))
        bottom = 1.875 + 0.085*side**2
        top = 1.955 + 0.295*side**3.3 + 0.058*math.exp(-(math.cos(angle)/0.095)**4)
        z = bottom+(top-bottom)*v
        relief = 0.0011*math.sin(65*angle+v*2.7+0.5*math.sin(angle*11))*math.sin(math.pi*v)
        return head_point(z, angle, 0.005+relief)
    beard_obj = surface_mesh('BeardContour', 49, 145, beard, mats['Beard'])
    solid = beard_obj.modifiers.new('BeardThickness', 'SOLIDIFY')
    solid.thickness = 0.004
    for side, label in [(-1, 'L'), (1, 'R')]:
        sculpt_ribbon(f'Moustache_{label}', [(side*0.002, 2.079, 0.008), (side*0.029, 2.084, 0.016),
                                           (side*0.069, 2.073, 0.02), (side*0.098, 2.05, 0.014),
                                           (side*0.106, 2.017, 0.002)], mats['Beard'], 0.01)
    def forelock(v, u):
        x = (u-0.5)*0.23
        top = 2.517 + 0.011*math.cos(u*8*math.pi)
        z = 2.373 + (top-2.373)*v
        lobes = sum(math.exp(-((x-center-0.007*math.sin(v*math.pi))/0.024)**2) for center in [-0.082, -0.027, 0.03, 0.082])
        y = -0.245 + 0.04*(x/0.12)**2 + 0.028*((v-0.5)*2)**2 - 0.016*lobes*math.sin(math.pi*v)**0.6
        return (x, y, z)
    lock = surface_mesh('Forelock', 49, 97, forelock, mats['Hair'])
    solid = lock.modifiers.new('HairVolume', 'SOLIDIFY')
    solid.thickness = 0.032


def weave(mat):
    size = 256
    y, x = np.mgrid[0:size, 0:size].astype(np.float32)/size
    warp = np.sin(x*64*math.pi)
    weft = np.sin(y*64*math.pi)
    normals = np.stack((0.20*warp*(0.6+0.4*np.cos(y*32*math.pi)),
                        0.20*weft*(0.6+0.4*np.cos(x*32*math.pi)), np.ones_like(x)), axis=-1)
    normals /= np.linalg.norm(normals, axis=-1, keepdims=True)
    pixels = np.concatenate((normals*0.5+0.5, np.ones((size, size, 1), dtype=np.float32)), axis=-1)
    image = bpy.data.images.new('CapWeaveNormal', width=size, height=size, alpha=True)
    image.colorspace_settings.name = 'Non-Color'
    image.pixels.foreach_set(pixels.astype(np.float32).ravel())
    image.update()
    image.pack()
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    texture = nodes.new('ShaderNodeTexImage')
    texture.image = image
    texture.extension = 'REPEAT'
    normal = nodes.new('ShaderNodeNormalMap')
    normal.space = 'TANGENT'
    normal.inputs['Strength'].default_value = 0.32
    links.new(texture.outputs['Color'], normal.inputs['Color'])
    links.new(normal.outputs['Normal'], nodes['Principled BSDF'].inputs['Normal'])


def cap_point(phi, theta, offset=0):
    return ((0.311+offset)*math.sin(phi)*math.cos(theta),
            0.012+(0.265+offset)*math.sin(phi)*math.sin(theta),
            2.376+0.282*math.cos(phi)-0.038*math.cos(theta)**2*math.sin(phi)**2)


def stitch_paths(name, paths, mat, thickness=0.0008):
    data = bpy.data.curves.new(name, 'CURVE')
    data.dimensions = '3D'
    data.bevel_depth = thickness
    data.bevel_resolution = 2
    for points in paths:
        for a, b in zip(points[::2], points[1::2]):
            spline = data.splines.new('POLY')
            spline.points.add(1)
            spline.points[0].co = (*a, 1)
            spline.points[1].co = (*b, 1)
    obj = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(obj)
    return finish(obj, name, mat)


def build_cap(mats):
    vertices, faces = [], []
    rows, columns = 41, 145
    for row in range(rows):
        phi = 0.012+(math.pi/2-0.012)*row/(rows-1)
        for col in range(columns):
            theta = col*2*math.pi/(columns-1)
            vertices.append(cap_point(phi, theta))
    for row in range(rows-1):
        phi = 0.012+(math.pi/2-0.012)*(row+0.5)/(rows-1)
        for col in range(columns-1):
            theta = (col+0.5)*2*math.pi/(columns-1)
            distance = abs(theta-1.5*math.pi)
            if distance < 0.46 and phi > 0.98+0.58*(distance/0.46)**2:
                continue
            a = row*columns+col
            faces.append((a, a+1, a+columns+1, a+columns))
    cap = mesh('BackwardCap', vertices, faces, mats['CapBurgundy'])
    layer = cap.data.uv_layers.new(name='FabricUV')
    for face in cap.data.polygons:
        for loop in face.loop_indices:
            index = cap.data.loops[loop].vertex_index
            layer.data[loop].uv = ((index%columns)/(columns-1)*24, (index//columns)/(rows-1)*12)
    solid = cap.modifiers.new('FabricThickness', 'SOLIDIFY')
    solid.thickness = 0.009
    paths = []
    for panel in range(6):
        theta = panel*math.pi/3
        seam = [cap_point(0.13+i/90*1.43, theta, 0.001) for i in range(91)]
        curve(f'CapPanel_{panel}', seam[::6], 0.0014, mats['CapSeam'])
        for shift in [-0.013, 0.013]:
            paths.append([cap_point(0.14+i/90*1.41, theta+shift, 0.0016) for i in range(91)])
    stitch_paths('CapDoubleStitch', paths, mats['CapThread'])
    opening = []
    for index in range(49):
        d = -0.46+0.92*index/48
        opening.append(cap_point(0.98+0.58*(abs(d)/0.46)**2, 1.5*math.pi+d, 0.002))
    curve('CapOpeningBinding', opening, 0.004, mats['CapSeam'])
    strap = surface_mesh('CapAdjustmentStrap', 5, 41,
                         lambda v, u: ((u-0.5)*0.255, -0.261+0.017*((u-0.5)*2)**2, 2.374+v*0.044), mats['CapBurgundy'], uv_scale=(10, 2))
    solid = strap.modifiers.new('StrapThickness', 'SOLIDIFY')
    solid.thickness = 0.01
    rounded_box('CapBuckle', (0.092, -0.258, 2.395), (0.032, 0.012, 0.048), 0.005, mats['Metal'])
    rounded_box('CapStrapEnd', (0.031, -0.267, 2.395), (0.108, 0.009, 0.038), 0.004, mats['CapSeam'])
    oval('CapTopButton', (0, 0.012, 2.661), (0.019, 0.019, 0.008), mats['CapSeam'])
    def brim(v, u):
        theta = u*math.pi
        return (0.31*math.cos(theta), 0.012+(0.251+0.183*v)*math.sin(theta),
                2.367-0.025*v+0.008*math.cos(theta)**2)
    visor = surface_mesh('BackwardVisor', 13, 73, brim, mats['CapBurgundy'], uv_scale=(20, 8))
    solid = visor.modifiers.new('VisorThickness', 'SOLIDIFY')
    solid.thickness = 0.012
    curve('VisorEdge', [brim(1, i/72) for i in range(73)], 0.0025, mats['CapSeam'])
    stitch_paths('VisorStitching', [[(x, y, z+0.001) for x, y, z in [brim(t, i/120) for i in range(121)]] for t in [0.77, 0.9]], mats['CapThread'])
    for index, theta in enumerate([0.42, 1.22, 1.96, 2.75, 3.4, 5.98]):
        position = Vector(cap_point(0.70, theta, 0.002))
        normal = Vector((math.sin(0.7)*math.cos(theta), math.sin(0.7)*math.sin(theta), math.cos(0.7)))
        bpy.ops.mesh.primitive_torus_add(major_segments=20, minor_segments=8, major_radius=0.005, minor_radius=0.0015, location=position)
        obj = bpy.context.object
        obj.rotation_euler = normal.to_track_quat('Z', 'Y').to_euler()
        finish(obj, f'CapEyelet_{index}', mats['CapSeam'])
        dot = oval(f'CapEyeletInset_{index}', position-normal*0.001, (0.0037, 0.0037, 0.001), mats['Hair'])
        dot.rotation_euler = obj.rotation_euler
    weave(mats['CapBurgundy'])


def materials():
    specs = {
        'Skin': ((0.61, 0.39, 0.26), 0.64, 0), 'SkinWarm': ((0.46, 0.246, 0.158), 0.74, 0),
        'Nails': ((0.64, 0.417, 0.303), 0.52, 0), 'Eyes': ((0.008, 0.006, 0.005), 0.36, 0),
        'Hair': ((0.019, 0.014, 0.012), 0.62, 0), 'Beard': ((0.026, 0.018, 0.014), 0.76, 0),
        'Lips': ((0.52, 0.29, 0.201), 0.7, 0), 'LipCrease': ((0.185, 0.081, 0.045), 0.8, 0),
        'Hoodie': ((0.009, 0.0095, 0.011), 0.93, 0), 'RibKnit': ((0.007, 0.0073, 0.0085), 0.96, 0),
        'Pants': ((0.010, 0.0105, 0.012), 0.94, 0), 'ShoeCanvas': ((0.012, 0.0125, 0.015), 0.88, 0),
        'Sole': ((0.76, 0.742, 0.705), 0.8, 0), 'SoleLine': ((0.018, 0.019, 0.022), 0.9, 0),
        'Stitch': ((0.026, 0.027, 0.03), 0.93, 0), 'Metal': ((0.071, 0.065, 0.065), 0.52, 0.55),
        'CapBurgundy': ((0.060, 0.010, 0.025), 0.88, 0), 'CapSeam': ((0.044, 0.007, 0.017), 0.89, 0),
        'CapThread': ((0.081, 0.021, 0.035), 0.95, 0),
    }
    return {name: material(name, *settings) for name, settings in specs.items()}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--replace-generated-v3', action='store_true')
    parser.add_argument('--head-only', action='store_true')
    args = parser.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else [])
    target = ROOT / ('test-results/head-v3.blend' if args.head_only else 'assets/blender/developer-v3.blend')
    if target.exists() and not args.replace_generated_v3:
        raise RuntimeError('V3 output exists. Review before using --replace-generated-v3.')
    bpy.ops.wm.read_factory_settings(use_empty=True)
    root = bpy.data.objects.new('Developer', None)
    bpy.context.collection.objects.link(root)
    root['stage'] = '03-reference-detail'
    root['pose'] = 'T-pose'
    root['height_units'] = 'meters'
    mats = materials()
    build_skin(mats)
    build_hair(mats)
    build_cap(mats)
    if not args.head_only:
        from character_v3_body import build_body
        build_body(mats)
    scene = bpy.context.scene
    scene.unit_settings.system = 'METRIC'
    scene.unit_settings.scale_length = 1
    scene.render.engine = 'CYCLES'
    scene.cycles.samples = 64
    scene.view_settings.view_transform = 'AgX'
    target.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=str(target), compress=False)
    print(f'Independent V3 source: {target}')


if __name__ == '__main__':
    main()
