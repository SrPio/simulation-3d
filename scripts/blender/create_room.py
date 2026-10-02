"""Phase 3: isometric developer-room diorama.

Builds assets/blender/room.blend and public/models/room.glb. The GLB holds the `Room` root with
geometry, named anchors (seats, laptop spots, spawn, light positions) and simple box colliders
stored as extras. Blender lights and the isometric camera stay outside the root, so they are
kept for renders but not exported; the viewer recreates lights from the anchors.
Scale matches the characters: meters, floor top at Z=0, walls on the -X and +Y sides.
"""
import argparse
import math
import random
import sys
from pathlib import Path

import bmesh
import bpy
from mathutils import Euler, Matrix, Vector

sys.path.insert(0, str(Path(__file__).resolve().parent))
import room_textures

ROOT = Path(__file__).resolve().parents[2]
BLEND = ROOT / 'assets' / 'blender' / 'room.blend'
GLB = ROOT / 'public' / 'models' / 'room.glb'
TEXTURES = ROOT / 'assets' / 'textures' / 'room'
HALF, WALL_T, WALL_H, BASE = 2.9, 0.18, 3.5, 0.34
# Furniture, decor and anchors are laid out for a 2.2 m half-size room and move with the back
# corner (-X wall, +Y wall), so enlarging HALF opens floor space without resizing the furniture.
LAYOUT = 2.2
SHIFT = (-(HALF - LAYOUT), HALF - LAYOUT, 0.0)
# The desk and everything on it sits this far in front of its original spot (+X, away from the chair)
# so V4's hands stay on the laptop keyboard instead of reaching into the screen.
DESK_FORWARD = 0.14
WINDOW = (0.25, 1.65, 1.75, 3.0)  # x0, x1, z0, z1 on the +Y wall, in layout coordinates
LED = (1.0, 0.16, 0.86)
random.seed(11)


# ------------------------------------------------------------------ materials

def material(name, color, roughness=0.7, metallic=0.0, image=None, emission=None, strength=0.0,
             emission_from_image=False, alpha=1.0):
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = (*color, alpha)
    mat.use_nodes = True
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    shader = nodes['Principled BSDF']
    shader.inputs['Base Color'].default_value = (*color, 1)
    shader.inputs['Roughness'].default_value = roughness
    shader.inputs['Metallic'].default_value = metallic
    if image:
        texture = nodes.new('ShaderNodeTexImage')
        texture.image = bpy.data.images.load(str(image), check_existing=True)
        texture.image.pack()
        if color != (1, 1, 1):
            tint = nodes.new('ShaderNodeMix')
            tint.data_type = 'RGBA'
            tint.blend_type = 'MULTIPLY'
            tint.inputs['Factor'].default_value = 1.0
            links.new(texture.outputs['Color'], tint.inputs['A'])
            tint.inputs['B'].default_value = (*color, 1)
            links.new(tint.outputs['Result'], shader.inputs['Base Color'])
        else:
            links.new(texture.outputs['Color'], shader.inputs['Base Color'])
        if emission_from_image:
            links.new(texture.outputs['Color'], shader.inputs['Emission Color'])
    if emission:
        shader.inputs['Emission Color'].default_value = (*emission, 1)
    if strength:
        shader.inputs['Emission Strength'].default_value = strength
    if alpha < 1:
        shader.inputs['Alpha'].default_value = alpha
        mat.surface_render_method = 'BLENDED'
    return mat


def materials(tex):
    wood_tones = [(0.36, 0.24, 0.23), (0.31, 0.21, 0.21), (0.40, 0.27, 0.25), (0.28, 0.19, 0.19)]
    return {
        'floor': [material(f'FloorWood_{i}', c, 0.62, image=tex['wood']) for i, c in enumerate(wood_tones)],
        'desk_wood': material('DeskWood', (0.42, 0.28, 0.21), 0.55, image=tex['wood']),
        'night_wood': material('NightstandWood', (0.50, 0.33, 0.24), 0.6, image=tex['wood']),
        'platform': material('PlatformBase', (0.055, 0.045, 0.075), 0.8),
        'wall': material('WallPaint', (0.085, 0.052, 0.15), 0.85),
        'wall_cap': material('WallCap', (0.12, 0.085, 0.19), 0.8),
        'baseboard': material('Baseboard', (0.06, 0.045, 0.09), 0.7),
        'bed_frame': material('BedFrame', (0.075, 0.07, 0.085), 0.65),
        'sheet': material('Sheet', (0.62, 0.58, 0.70), 0.85),
        'duvet': material('DuvetCircuit', (1, 1, 1), 0.9, image=tex['circuit']),
        'led': material('LedStrip', LED, 0.4, emission=LED, strength=7),
        'lamp_shade': material('LampShade', (0.95, 0.72, 0.45), 0.8, emission=(1.0, 0.62, 0.3), strength=1.6),
        'lamp_metal': material('LampMetal', (0.12, 0.1, 0.14), 0.35, 0.8),
        'frame_white': material('FrameWhite', (0.86, 0.85, 0.88), 0.45),
        'frame_black': material('FrameBlack', (0.03, 0.03, 0.035), 0.5),
        'glass': material('WindowGlass', (0.35, 0.4, 0.6), 0.05, alpha=0.18),
        'city': material('NightCity', (1, 1, 1), 1.0, image=tex['night_city'], emission_from_image=True, strength=1.4),
        'desk_mat': material('DeskMat', (1, 1, 1), 0.9, image=tex['desk_mat']),
        'aluminium': material('LaptopAluminium', (0.62, 0.62, 0.66), 0.3, 0.9),
        'laptop_keys': material('LaptopKeys', (0.1, 0.1, 0.12), 0.6),
        'screen': material('LaptopScreen', (1, 1, 1), 0.2, image=tex['laptop_screen'], emission_from_image=True, strength=2.2),
        'key_grey': material('KeycapGrey', (0.55, 0.55, 0.58), 0.55),
        'key_white': material('KeycapWhite', (0.85, 0.85, 0.86), 0.55),
        'key_red': material('KeycapRed', (0.7, 0.08, 0.1), 0.55),
        'keyboard_case': material('KeyboardCase', (0.07, 0.07, 0.09), 0.5),
        'mouse': material('Mouse', (0.9, 0.9, 0.92), 0.4),
        'mug': material('Mug', (1, 1, 1), 0.35, image=tex['mug_art']),
        'mug_plain': material('MugWhite', (0.94, 0.93, 0.91), 0.35),
        'coffee': material('Coffee', (0.12, 0.05, 0.03), 0.15),
        'chair': material('ChairPlastic', (0.07, 0.065, 0.085), 0.55),
        'chair_metal': material('ChairMetal', (0.25, 0.24, 0.28), 0.35, 0.85),
        'posters': {name: material(f'Poster_{name}', (1, 1, 1), 0.6, image=tex[f'poster_{name}'])
                    for name in ('cruzados', 'bug_hunter', 'merge_conflict', '404')},
        'books': [material(f'Book_{i}', c, 0.7) for i, c in enumerate(
            [(0.55, 0.08, 0.1), (0.9, 0.7, 0.1), (0.1, 0.2, 0.5), (0.08, 0.08, 0.1), (0.25, 0.45, 0.3), (0.6, 0.35, 0.1)])],
    }


# ------------------------------------------------------------------ geometry helpers

def finish(name, bm, mat, parent, bevel=0.0, segments=2, smooth=False, uv=None):
    data = bpy.data.meshes.new(name)
    bm.to_mesh(data)
    bm.free()
    obj = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(obj)
    obj.parent = parent
    if isinstance(mat, list):
        for m in mat:
            data.materials.append(m)
    elif mat:
        data.materials.append(mat)
    if uv:
        uv(obj)
    if bevel:
        mod = obj.modifiers.new('Soften', 'BEVEL')
        mod.width = bevel
        mod.segments = segments
        mod.limit_method = 'ANGLE'
        mod.harden_normals = True
        smooth = True
    if smooth:
        data.shade_smooth()
    return obj


def box(name, lo, hi, mat, parent, bevel=0.0, segments=2, uv=None):
    bm = bmesh.new()
    bm.loops.layers.uv.new('UVMap')
    bmesh.ops.create_cube(bm, size=1.0, calc_uvs=True)
    lo, hi = Vector(lo), Vector(hi)
    for v in bm.verts:
        v.co = Vector(((v.co.x + 0.5) * (hi.x - lo.x) + lo.x, (v.co.y + 0.5) * (hi.y - lo.y) + lo.y,
                       (v.co.z + 0.5) * (hi.z - lo.z) + lo.z))
    return finish(name, bm, mat, parent, bevel, segments, uv=uv)


def cylinder(name, center, radius, depth, mat, parent, top=None, segments=32, bevel=0.0, axis='Z'):
    bm = bmesh.new()
    bm.loops.layers.uv.new('UVMap')
    bmesh.ops.create_cone(bm, cap_ends=True, segments=segments, radius1=radius, radius2=radius if top is None else top,
                          depth=depth, calc_uvs=True)
    rot = {'Z': Matrix.Identity(3), 'X': Matrix.Rotation(math.pi / 2, 3, 'Y'), 'Y': Matrix.Rotation(math.pi / 2, 3, 'X')}[axis]
    for v in bm.verts:
        v.co = rot @ v.co + Vector(center)
    return finish(name, bm, mat, parent, bevel, smooth=True)


def blob(name, center, scale, mat, parent, rotation=(0, 0, 0), uv=None):
    bm = bmesh.new()
    bm.loops.layers.uv.new('UVMap')
    bmesh.ops.create_uvsphere(bm, u_segments=32, v_segments=16, radius=1.0, calc_uvs=True)
    m = Euler(rotation).to_matrix()
    for v in bm.verts:
        v.co = m @ Vector((v.co.x * scale[0], v.co.y * scale[1], v.co.z * scale[2])) + Vector(center)
    return finish(name, bm, mat, parent, smooth=True, uv=uv)


def project_uv(scale, offset=(0.0, 0.0)):
    """World-space box projection so tiling textures keep a constant texel size."""
    def apply(obj):
        data = obj.data
        layer = data.uv_layers[0] if data.uv_layers else data.uv_layers.new()
        for poly in data.polygons:
            n = poly.normal
            axes = (0, 1) if abs(n.z) >= max(abs(n.x), abs(n.y)) else ((1, 2) if abs(n.x) > abs(n.y) else (0, 2))
            for li in poly.loop_indices:
                co = data.vertices[data.loops[li].vertex_index].co
                layer.data[li].uv = (co[axes[0]] / scale + offset[0], co[axes[1]] / scale + offset[1])
    return apply


def planar_uv(u_axis, v_axis, lo, hi, flip_u=False):
    """Map one texture exactly across a rectangle (posters, desk mat, screen)."""
    def apply(obj):
        data = obj.data
        layer = data.uv_layers[0]
        for poly in data.polygons:
            for li in poly.loop_indices:
                co = data.vertices[data.loops[li].vertex_index].co
                u = (co[u_axis] - lo[0]) / (hi[0] - lo[0])
                layer.data[li].uv = (1 - u if flip_u else u, (co[v_axis] - lo[1]) / (hi[1] - lo[1]))
    return apply


def anchor(name, location, parent, rotation_z=0.0, **extras):
    obj = bpy.data.objects.new(name, None)
    obj.empty_display_type = 'ARROWS'
    obj.empty_display_size = 0.25
    obj.location = location
    obj.rotation_euler.z = rotation_z
    obj.parent = parent
    for key, value in extras.items():
        obj[key] = value
    bpy.context.collection.objects.link(obj)
    return obj


def collider(name, lo, hi, parent):
    lo, hi = Vector(lo), Vector(hi)
    return anchor(f'Collider_{name}', (lo + hi) / 2, parent, collider='box', size=list(hi - lo))


# ------------------------------------------------------------------ room parts

def build_shell(m, root):
    box('Platform', (-HALF - WALL_T, -HALF - 0.1, -BASE), (HALF + 0.1, HALF + WALL_T, -0.06), m['platform'], root, bevel=0.02)
    z0 = -0.06
    row, y = 0, -HALF - 0.1
    while y < HALF:
        width = min(0.29, HALF - y)
        x = -HALF - random.uniform(0, 1.0)
        while x < HALF + 0.1:
            length = random.uniform(1.1, 2.3)
            x0, x1 = max(x, -HALF), min(x + length, HALF + 0.1)
            if x1 - x0 > 0.15:
                offset = (random.random(), random.random())
                box(f'FloorPlank_{row:02d}_{x0:+.2f}', (x0 + 0.003, y + 0.003, z0), (x1 - 0.003, y + width - 0.003, random.uniform(-0.002, 0.002)),
                    random.choice(m['floor']), root, bevel=0.006, uv=project_uv(1.6, offset))
            x += length
        y += width
        row += 1
    box('Wall_Left', (-HALF - WALL_T, -HALF - 0.1, -BASE), (-HALF, HALF + WALL_T, WALL_H), m['wall'], root)
    x0, x1, zw0, zw1 = WINDOW
    x0, x1 = x0 + SHIFT[0], x1 + SHIFT[0]
    for name, lo, hi in (('Low', (-HALF - WALL_T, HALF, -BASE), (HALF + 0.1, HALF + WALL_T, zw0)),
                         ('High', (-HALF - WALL_T, HALF, zw1), (HALF + 0.1, HALF + WALL_T, WALL_H)),
                         ('Left', (-HALF - WALL_T, HALF, zw0), (x0, HALF + WALL_T, zw1)),
                         ('Right', (x1, HALF, zw0), (HALF + 0.1, HALF + WALL_T, zw1))):
        box(f'Wall_Back{name}', lo, hi, m['wall'], root)
    box('WallCap_Left', (-HALF - WALL_T - 0.005, -HALF - 0.105, WALL_H), (-HALF + 0.005, HALF + WALL_T + 0.005, WALL_H + 0.03), m['wall_cap'], root)
    box('WallCap_Back', (-HALF + 0.005, HALF - 0.005, WALL_H), (HALF + 0.105, HALF + WALL_T + 0.005, WALL_H + 0.03), m['wall_cap'], root)
    box('Baseboard_Left', (-HALF, -HALF - 0.1, 0), (-HALF + 0.025, HALF, 0.12), m['baseboard'], root)
    box('Baseboard_Back', (-HALF, HALF - 0.025, 0), (HALF + 0.1, HALF, 0.12), m['baseboard'], root)
    collider('WallLeft', (-HALF - WALL_T, -HALF, 0), (-HALF, HALF + WALL_T, WALL_H), root)
    collider('WallBack', (-HALF - WALL_T, HALF, 0), (HALF, HALF + WALL_T, WALL_H), root)


def build_bed(m, root):
    x0, x1, y0, y1 = -0.72, 2.12, 1.0, 2.17
    box('BedFrame', (x0, y0, 0.12), (x1, y1, 0.32), m['bed_frame'], root, bevel=0.015)
    for i, (x, y) in enumerate(((x0 + 0.1, y0 + 0.1), (x1 - 0.1, y0 + 0.1), (x0 + 0.1, y1 - 0.1), (x1 - 0.1, y1 - 0.1))):
        box(f'BedLeg_{i}', (x - 0.04, y - 0.04, 0), (x + 0.04, y + 0.04, 0.12), m['bed_frame'], root)
    inset, t = 0.05, 0.012
    for name, lo, hi in (('Front', (x0 + inset, y0 + inset, 0.1), (x1 - inset, y0 + inset + t, 0.12)),
                         ('Foot', (x1 - inset - t, y0 + inset, 0.1), (x1 - inset, y1 - inset, 0.12)),
                         ('Head', (x0 + inset, y0 + inset, 0.1), (x0 + inset + t, y1 - inset, 0.12))):
        box(f'BedLed_{name}', lo, hi, m['led'], root)
    box('BedLed_Wall', (x0 + 0.1, y1 - 0.004, 0.33), (x1 - 0.05, y1 + 0.01, 0.345), m['led'], root)
    box('Mattress', (x0 + 0.04, y0 + 0.04, 0.32), (x1 - 0.04, y1 - 0.04, 0.56), m['sheet'], root, bevel=0.05, segments=3)
    box('Duvet', (-0.02, y0 - 0.02, 0.30), (x1 + 0.02, y1 + 0.01, 0.63), m['duvet'], root, bevel=0.07, segments=4,
        uv=project_uv(2.3))
    box('DuvetFold', (-0.05, y0 - 0.025, 0.5), (0.28, y1 + 0.015, 0.655), m['duvet'], root, bevel=0.06, segments=4,
        uv=project_uv(2.3, (0.3, 0.1)))
    blob('Pillow_Back', (-0.43, 1.84, 0.66), (0.26, 0.36, 0.1), m['duvet'], root, (0.0, -0.25, 0.1), uv=project_uv(1.6))
    blob('Pillow_Front', (-0.35, 1.34, 0.68), (0.25, 0.34, 0.1), m['duvet'], root, (0.15, -0.35, -0.15), uv=project_uv(1.6, (0.4, 0.2)))


def build_nightstand(m, root):
    box('Nightstand', (-1.55, 1.5, 0), (-0.8, LAYOUT - 0.03, 0.70), m['night_wood'], root, bevel=0.012, uv=project_uv(1.2))
    box('NightstandTop', (-1.58, 1.47, 0.70), (-0.77, LAYOUT - 0.01, 0.75), m['night_wood'], root, bevel=0.012, uv=project_uv(1.2, (0.3, 0.2)))
    box('NightstandShelfGap', (-1.5, 1.49, 0.3), (-0.85, 1.52, 0.34), m['frame_black'], root)
    cylinder('LampBase', (-1.33, 1.93, 0.765), 0.11, 0.03, m['lamp_metal'], root, bevel=0.005)
    cylinder('LampStem', (-1.33, 1.93, 0.88), 0.015, 0.21, m['lamp_metal'], root)
    cylinder('LampShade', (-1.33, 1.93, 1.07), 0.15, 0.2, m['lamp_shade'], root, top=0.105)
    x = -1.1
    for i in range(7):
        thickness = random.uniform(0.035, 0.055)
        height = random.uniform(0.26, 0.34)
        box(f'Book_{i}', (x, 1.72, 0.75), (x + thickness, 2.08, 0.75 + height), m['books'][i % len(m['books'])], root, bevel=0.004)
        x += thickness + 0.004


def build_desk(m, root):
    x0, x1, y0, y1, top = -1.0, -0.12, -2.0, -0.05, 1.05
    box('DeskTop', (x0, y0, top - 0.06), (x1, y1, top), m['desk_wood'], root, bevel=0.01, uv=project_uv(1.8))
    for i, (x, y) in enumerate(((x0 + 0.06, y0 + 0.06), (x1 - 0.06, y0 + 0.06), (x0 + 0.06, y1 - 0.06), (x1 - 0.06, y1 - 0.06))):
        box(f'DeskLeg_{i}', (x - 0.035, y - 0.035, 0), (x + 0.035, y + 0.035, top - 0.06), m['desk_wood'], root, bevel=0.006,
            uv=project_uv(1.8, (i * 0.2, 0)))
    mat_lo, mat_hi = (-0.95, -1.62, top), (-0.2, -0.3, top + 0.006)
    box('DeskMat', mat_lo, mat_hi, m['desk_mat'], root, uv=planar_uv(1, 0, (mat_lo[1], mat_lo[0]), (mat_hi[1], mat_hi[0]), flip_u=True))
    # The laptop is its own asset (public/models/laptop.glb) placed on Anchor_DeskLaptop, so there is only
    # ever one laptop: on the desk, carried or on the lap.
    # Mechanical keyboard on the front corner of the mat.
    kx0, kx1, ky0, ky1 = -0.72, -0.55, -1.6, -1.25
    box('KeyboardCase', (kx0, ky0, top + 0.006), (kx1, ky1, top + 0.03), m['keyboard_case'], root, bevel=0.006)
    rows, cols = 4, 11
    for r in range(rows):
        for c in range(cols):
            kx = kx0 + 0.02 + r * (kx1 - kx0 - 0.04) / rows
            ky = ky0 + 0.012 + c * (ky1 - ky0 - 0.024) / cols
            mat = m['key_red'] if (r, c) in ((0, 0), (3, 10), (1, 10)) else (m['key_white'] if r in (1, 2) else m['key_grey'])
            box(f'Key_{r}_{c}', (kx, ky, top + 0.03), (kx + 0.03, ky + 0.024, top + 0.045), mat, root, bevel=0.003)
    blob('Mouse', (-0.74, -0.48, top + 0.018), (0.045, 0.03, 0.02), m['mouse'], root)
    cylinder('Mug', (-0.8, -1.82, top + 0.07), 0.058, 0.13, m['mug'], root, segments=40)
    cylinder('MugCoffee', (-0.8, -1.82, top + 0.126), 0.051, 0.01, m['coffee'], root, segments=40)
    bpy.ops.mesh.primitive_torus_add(major_radius=0.035, minor_radius=0.011, location=(-0.8, -1.76, top + 0.075),
                                     rotation=(math.pi / 2, 0, 0))
    handle = bpy.context.object
    handle.name = 'MugHandle'
    handle.data.materials.append(m['mug_plain'])
    handle.data.shade_smooth()
    handle.parent = root


def build_chair(m, root):
    cx, cy, seat = -1.40, -1.0, 0.64
    box('ChairSeat', (cx - 0.25, cy - 0.25, seat - 0.05), (cx + 0.25, cy + 0.25, seat), m['chair'], root, bevel=0.02, segments=3)
    back = box('ChairBack', (cx - 0.3, cy - 0.23, seat + 0.08), (cx - 0.26, cy + 0.23, seat + 0.62), m['chair'], root, bevel=0.015, segments=3)
    pivot = Vector((cx - 0.28, cy, seat))
    back.data.transform(Matrix.Translation(pivot) @ Matrix.Rotation(math.radians(-8), 4, 'Y') @ Matrix.Translation(-pivot))
    for i, (dx, dy) in enumerate(((-1, -1), (1, -1), (-1, 1), (1, 1))):
        top = Vector((cx + dx * 0.2, cy + dy * 0.2, seat - 0.05))
        foot = Vector((cx + dx * 0.25, cy + dy * 0.25, 0.0))
        mid = (top + foot) / 2
        leg = cylinder(f'ChairLeg_{i}', (0, 0, 0), 0.016, (top - foot).length, m['chair_metal'], root, segments=12)
        leg.matrix_world = Matrix.Translation(mid) @ (top - foot).to_track_quat('Z', 'Y').to_matrix().to_4x4()
    for i, dy in enumerate((-0.18, 0.18)):
        cylinder(f'ChairBackPost_{i}', (cx - 0.3, cy + dy, seat + 0.1), 0.014, 0.2, m['chair_metal'], root, segments=12)


def build_wall_decor(m, root):
    layout = (('cruzados', -1.45, 2.95), ('bug_hunter', -0.55, 2.95), ('merge_conflict', -1.45, 1.85), ('404', -0.55, 1.85))
    w, h = 0.78, 1.04
    for name, y, z in layout:
        frame = m['frame_white'] if name in ('cruzados', 'merge_conflict') else m['frame_black']
        box(f'PosterFrame_{name}', (-LAYOUT, y - w / 2, z - h / 2), (-LAYOUT + 0.035, y + w / 2, z + h / 2), frame, root, bevel=0.004)
        lo, hi = (y - w / 2 + 0.03, z - h / 2 + 0.03), (y + w / 2 - 0.03, z + h / 2 - 0.03)
        box(f'Poster_{name}', (-LAYOUT + 0.035, lo[0], lo[1]), (-LAYOUT + 0.037, hi[0], hi[1]), m['posters'][name], root,
            uv=planar_uv(1, 2, lo, hi))
    x0, x1, z0, z1 = WINDOW
    f = 0.07
    for name, lo, hi in (('Bottom', (x0, LAYOUT - 0.04, z0), (x1, LAYOUT + WALL_T, z0 + f)),
                         ('Top', (x0, LAYOUT - 0.04, z1 - f), (x1, LAYOUT + WALL_T, z1)),
                         ('Left', (x0, LAYOUT - 0.04, z0), (x0 + f, LAYOUT + WALL_T, z1)),
                         ('Right', (x1 - f, LAYOUT - 0.04, z0), (x1, LAYOUT + WALL_T, z1)),
                         ('Mullion', ((x0 + x1) / 2 - 0.025, LAYOUT - 0.02, z0), ((x0 + x1) / 2 + 0.025, LAYOUT + 0.06, z1)),
                         ('Transom', (x0, LAYOUT - 0.02, z1 - 0.38), (x1, LAYOUT + 0.06, z1 - 0.34))):
        box(f'WindowFrame_{name}', lo, hi, m['frame_white'], root, bevel=0.006)
    box('WindowSill', (x0 - 0.08, LAYOUT - 0.1, z0 - 0.05), (x1 + 0.08, LAYOUT + 0.02, z0 + 0.005), m['frame_white'], root, bevel=0.008)
    box('WindowHandle', ((x0 + x1) / 2 + 0.04, LAYOUT - 0.05, z0 + 0.45), ((x0 + x1) / 2 + 0.06, LAYOUT - 0.02, z0 + 0.6), m['frame_white'], root, bevel=0.005)
    box('WindowGlass', (x0 + f, LAYOUT + 0.03, z0 + f), (x1 - f, LAYOUT + 0.035, z1 - f), m['glass'], root)
    box('NightCity', (x0 - 0.25, LAYOUT + 0.32, z0 - 0.25), (x1 + 0.25, LAYOUT + 0.33, z1 + 0.12), m['city'], root,
        uv=planar_uv(0, 2, (x0 - 0.25, z0 - 0.25), (x1 + 0.25, z1 + 0.12)))


def build_anchors(root):
    anchor('Spawn', (0.9, -0.9, 0), root, math.radians(45))
    anchor('Anchor_ChairSeat', (-1.40, -1.0, 0.64), root, math.radians(90), seat='chair', stand_offset=0.20)
    anchor('Anchor_ChairApproach', (-1.20, 0.25, 0), root, math.radians(180), seat='chair')
    anchor('Anchor_BedSeat', (0.7, 1.05, 0.63), root, 0.0, seat='bed', stand_offset=0.25)
    anchor('Anchor_BedApproach', (0.7, 0.35, 0), root, 0.0, seat='bed')
    anchor('Anchor_DeskLaptop', (-0.82 + DESK_FORWARD, -1.0, 1.056), root, math.radians(90), laptop='desk')
    anchor('Anchor_BedLaptop', (0.7, 0.70, 0.90), root, 0.0, laptop='bed')
    lights = (('Lamp', (-1.33, 1.93, 1.02), (1.0, 0.62, 0.32), 5.0),
              ('BedGlow', (0.7, 0.85, 0.06), LED, 9.0),
              ('WallGlow', (0.7, 2.05, 0.45), LED, 7.0),
              ('Screen', (-0.94 + DESK_FORWARD, -1.0, 1.3), (0.55, 0.6, 1.0), 1.2),
              ('Window', (0.95, 1.9, 2.4), (0.4, 0.5, 1.0), 1.0))
    for name, location, color, intensity in lights:
        anchor(f'Light_{name}', location, root, light='point', color=list(color), intensity=intensity)
    collider('Bed', (-0.72, 1.0, 0), (2.12, 2.17, 0.66), root)
    collider('Nightstand', (-1.58, 1.47, 0), (-0.77, LAYOUT, 0.75), root)
    collider('Desk', (-1.0 + DESK_FORWARD, -2.0, 0), (-0.12 + DESK_FORWARD, -0.05, 1.05), root)
    collider('Chair', (-1.70, -1.25, 0), (-1.15, -0.75, 1.28), root)


def build_lighting():
    """Blender-only lights mirroring the anchors (renders); not part of the exported Room root."""
    collection = bpy.data.collections.new('RoomLighting')
    bpy.context.scene.collection.children.link(collection)

    def light(name, kind, location, color, power, size=0.2, rotation=(0, 0, 0)):
        data = bpy.data.lights.new(name, kind)
        data.color = color
        data.energy = power
        if kind == 'AREA':
            data.shape = 'RECTANGLE'
            data.size, data.size_y = size if isinstance(size, tuple) else (size, size)
        else:
            data.shadow_soft_size = size
        obj = bpy.data.objects.new(name, data)
        obj.location = Vector(location) + (Vector(SHIFT) if name != 'Key' else Vector())
        obj.rotation_euler = rotation
        collection.objects.link(obj)

    light('Key', 'AREA', (4.5, -4.5, 7.0), (0.55, 0.45, 1.0), 320, 6.0, (math.radians(45), 0, math.radians(45)))
    light('Lamp', 'POINT', (-1.33, 1.93, 1.02), (1.0, 0.6, 0.3), 90, 0.1)
    light('UnderBed', 'AREA', (0.7, 1.58, 0.1), LED, 700, (2.8, 1.1), (math.pi, 0, 0))
    light('BedFrontSpill', 'AREA', (0.7, 0.9, 0.12), LED, 420, (2.6, 0.2), (math.radians(150), 0, 0))
    light('WallWash', 'AREA', (0.7, 2.05, 0.4), LED, 520, (2.8, 0.3), (math.radians(-80), 0, 0))
    light('Screen', 'AREA', (-0.70 + DESK_FORWARD, -1.0, 1.25), (0.55, 0.6, 1.0), 12, (0.3, 0.45), (0, math.radians(-90), 0))
    light('Moon', 'AREA', (0.95, 2.6, 2.4), (0.45, 0.55, 1.0), 40, (1.3, 1.2), (math.radians(90), 0, 0))
    light('PosterWash', 'AREA', (-0.8, -1.0, 3.3), (1.0, 0.9, 0.95), 70, (0.6, 2.2), (0, math.radians(40), 0))


def iso_camera():
    data = bpy.data.cameras.new('IsoCamera')
    data.type = 'ORTHO'
    data.ortho_scale = 7.4 * (HALF + 0.35) / (LAYOUT + 0.35)
    camera = bpy.data.objects.new('IsoCamera', data)
    bpy.context.scene.collection.objects.link(camera)
    target = Vector((0.0, 0.05, 1.1))
    camera.location = target + Vector((1, -1, 1.02)).normalized() * 20
    camera.rotation_euler = (target - camera.location).to_track_quat('-Z', 'Y').to_euler()
    data.clip_end = 60
    bpy.context.scene.camera = camera


# Lossy WebP (EXT_texture_webp) instead of PNG: the room textures go from 2.8 MB to a fraction, with no
# visible change at the diorama scale. Source PNGs stay in assets/textures/room/.
WEB_IMAGES = dict(export_image_format='WEBP', export_image_quality=85)


def export_glb(root):
    bpy.ops.object.select_all(action='DESELECT')
    for obj in [root, *root.children_recursive]:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = root
    GLB.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=str(GLB), export_format='GLB', use_selection=True, export_apply=True,
                              export_yup=True, export_extras=True, export_cameras=False, export_lights=False,
                              export_animations=False, **WEB_IMAGES)
    print(f'Room GLB: {GLB} ({GLB.stat().st_size} bytes)')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--replace-generated', action='store_true')
    args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else [])
    if (BLEND.exists() or GLB.exists()) and not args.replace_generated:
        raise RuntimeError('Room outputs exist. Review them before using --replace-generated.')
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.unit_settings.system = 'METRIC'
    tex = room_textures.build_all(TEXTURES)
    m = materials(tex)
    root = bpy.data.objects.new('Room', None)
    bpy.context.collection.objects.link(root)
    root['stage'] = '03-room-diorama'
    root['half_size'] = HALF
    root['wall_height'] = WALL_H
    build_shell(m, root)
    shell = set(root.children)
    build_bed(m, root)
    build_nightstand(m, root)
    before_desk = set(root.children)
    build_desk(m, root)
    for obj in set(root.children) - before_desk:
        obj.location.x += DESK_FORWARD
    build_chair(m, root)
    build_wall_decor(m, root)
    build_anchors(root)
    for obj in set(root.children) - shell:
        obj.location += Vector(SHIFT)
    build_lighting()
    iso_camera()
    world = bpy.data.worlds.new('RoomWorld')
    world.color = (0.02, 0.015, 0.035)
    world.use_nodes = True
    world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.02, 0.015, 0.035, 1)
    scene.world = world
    scene.render.engine = 'CYCLES'
    scene.cycles.samples = 128
    scene.view_settings.view_transform = 'AgX'
    BLEND.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=str(BLEND), compress=True)
    export_glb(root)
    meshes = [o for o in root.children_recursive if o.type == 'MESH']
    print(f'Room source: {BLEND} ({len(meshes)} meshes, {sum(len(o.data.polygons) for o in meshes)} faces)')


if __name__ == '__main__':
    main()
