"""Profile silhouettes of the character as alpha masks, traced into SVG paths by scripts/silhouettes.ts.

- head.png: the web V4 head with its backwards cap, seen in profile (the loading screen draws its outline).
- <action>.png: the animated V4 doing each action of the on-screen touch buttons, with plain stand-ins for what the
  pose needs (the room chair, the bed's edge and a laptop on the lap, the office chair with its soda bottles, the
  laptop in the throwing hand).

The camera looks from the character's right side (Blender -X), so it faces right in every image and the throwing
hand is the near one. Workbench, flat black, transparent film: only the alpha matters.

Run: blender --background --factory-startup --python-exit-code 1 --python scripts/blender/render_silhouettes.py
"""
import json
import math
from pathlib import Path

import bpy
from mathutils import Matrix, Vector

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'assets' / 'renders' / 'silhouettes'
V4 = ROOT / 'public' / 'models' / 'developer-v4.glb'
RIG = ROOT / 'public' / 'models' / 'developer-v4-interactions.glb'
MANIFEST = ROOT / 'public' / 'models' / 'developer-v4-interactions.manifest.json'

# The head without the neck: a clean bust line under the chin and the beard.
HEAD_PARTS = {'Head', 'Hair', 'HairTuft', 'Beard', 'Moustache', 'Eyebrows', 'CapCrown', 'CapBrim', 'CapButton', 'CapStrap'}
HEAD_SIZE = 1024
ACTION_SIZE = 512
# Generous frame round the hips; scripts/silhouettes.ts crops each figure to its own bounds.
ACTION_FRAME = 3.4
SEAT_TOP = 0.64
FPS = 30


def clear():
    for obj in list(bpy.data.objects):
        bpy.data.objects.remove(obj, do_unlink=True)
    for block in list(bpy.data.actions):
        bpy.data.actions.remove(block)
    for mesh in list(bpy.data.meshes):
        bpy.data.meshes.remove(mesh)


def setup(size):
    scene = bpy.context.scene
    scene.render.engine = 'BLENDER_WORKBENCH'
    scene.render.resolution_x = scene.render.resolution_y = size
    scene.render.resolution_percentage = 100
    scene.render.film_transparent = True
    scene.render.image_settings.file_format = 'PNG'
    scene.render.image_settings.color_mode = 'RGBA'
    scene.render.image_settings.color_depth = '8'
    shading = scene.display.shading
    shading.light = 'FLAT'
    shading.color_type = 'SINGLE'
    shading.single_color = (0, 0, 0)
    shading.show_object_outline = False
    shading.show_cavity = False
    shading.show_shadows = False
    scene.display.render_aa = '8'
    scene.view_settings.view_transform = 'Standard'
    return scene


def camera(scene, centre, scale):
    cam = bpy.data.objects.new('Camera', bpy.data.cameras.new('Camera'))
    cam.data.type = 'ORTHO'
    cam.data.ortho_scale = scale
    cam.data.clip_end = 100
    cam.location = Vector(centre) + Vector((-20, 0, 0))
    cam.rotation_euler = Vector((1, 0, 0)).to_track_quat('-Z', 'Y').to_euler()
    scene.collection.objects.link(cam)
    scene.camera = cam


def box(name, lo, hi):
    mesh = bpy.data.meshes.new(name)
    (x0, y0, z0), (x1, y1, z1) = lo, hi
    verts = [(x, y, z) for x in (x0, x1) for y in (y0, y1) for z in (z0, z1)]
    faces = [(0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1), (2, 3, 7, 6), (0, 2, 6, 4), (1, 5, 7, 3)]
    mesh.from_pydata(verts, [], faces)
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    return obj


def cylinder(name, centre, radius, length, axis='Y', segments=16):
    mesh = bpy.data.meshes.new(name)
    verts, faces = [], []
    for end in (-0.5, 0.5):
        for k in range(segments):
            a = k / segments * math.tau
            u, v = math.cos(a) * radius, math.sin(a) * radius
            w = end * length
            verts.append({'X': (w, u, v), 'Y': (u, w, v), 'Z': (u, v, w)}[axis])
    faces.append(list(range(segments))[::-1])
    faces.append(list(range(segments, 2 * segments)))
    for k in range(segments):
        n = (k + 1) % segments
        faces.append((k, n, segments + n, segments + k))
    mesh.from_pydata(verts, [], faces)
    obj = bpy.data.objects.new(name, mesh)
    obj.location = centre
    bpy.context.scene.collection.objects.link(obj)
    return obj


def ball(centre, radius):
    bpy.ops.mesh.primitive_uv_sphere_add(radius=radius, location=centre, segments=14, ring_count=8)


def render(scene, name):
    OUT.mkdir(parents=True, exist_ok=True)
    scene.render.filepath = str(OUT / f'{name}.png')
    bpy.ops.render.render(write_still=True)


def head():
    clear()
    scene = setup(HEAD_SIZE)
    bpy.ops.import_scene.gltf(filepath=str(V4))
    for obj in list(bpy.data.objects):
        if obj.type != 'MESH' or obj.name.split('.')[0] not in HEAD_PARTS:
            obj.hide_render = True
    shown = [obj for obj in bpy.data.objects if obj.type == 'MESH' and not obj.hide_render]
    points = [obj.matrix_world @ Vector(corner) for obj in shown for corner in obj.bound_box]
    lo = Vector((min(p.y for p in points), min(p.z for p in points)))
    hi = Vector((max(p.y for p in points), max(p.z for p in points)))
    centre = (0, (lo.x + hi.x) / 2, (lo.y + hi.y) / 2)
    camera(scene, centre, max(hi.x - lo.x, hi.y - lo.y) * 1.08)
    render(scene, 'head')


# ------------------------------------------------------------------ posing


def world(rig, name, end='head'):
    bone = rig.pose.bones[name]
    return rig.matrix_world @ (bone.head if end == 'head' else bone.tail)


def aim(rig, name, direction):
    """Turn a pose bone (in the rig's world) so it points along `direction`, keeping its head where it is."""
    bone = rig.pose.bones[name]
    to_rig = rig.matrix_world.inverted().to_3x3()
    target = (to_rig @ Vector(direction)).normalized()
    current = bone.matrix.to_3x3()
    turn = current.col[1].normalized().rotation_difference(target).to_matrix()
    matrix = (turn @ current).to_4x4()
    matrix.translation = bone.matrix.translation
    bone.matrix = matrix
    bpy.context.view_layer.update()


def turn(rig, name, axis, degrees):
    """Rotate a pose bone about a world axis through its head."""
    bone = rig.pose.bones[name]
    to_rig = rig.matrix_world.inverted().to_3x3()
    rotation = Matrix.Rotation(math.radians(degrees), 3, to_rig @ Vector(axis))
    matrix = (rotation @ bone.matrix.to_3x3()).to_4x4()
    matrix.translation = bone.matrix.translation
    bone.matrix = matrix
    bpy.context.view_layer.update()


def pose(rig, action, seconds):
    """Evaluate a clip at a time, then freeze it so later bone tweaks stay."""
    rig.animation_data.action = bpy.data.actions[action]
    if getattr(rig.animation_data, 'action_suitable_slots', None):
        rig.animation_data.action_slot = rig.animation_data.action_suitable_slots[0]
    bpy.context.scene.frame_set(round(seconds * FPS))
    bpy.context.view_layer.update()
    rig.animation_data.action = None
    bpy.context.view_layer.update()


# ------------------------------------------------------------------ stand-ins


def chair(rig):
    """The room chair under the hips: seat, back and legs."""
    y = world(rig, 'pelvis').y + 0.04
    box('Seat', (-0.24, y - 0.24, SEAT_TOP - 0.06), (0.24, y + 0.24, SEAT_TOP))
    box('Back', (-0.22, y + 0.24, SEAT_TOP - 0.06), (0.22, y + 0.3, SEAT_TOP + 0.5))
    for dy in (-0.2, 0.2):
        box(f'Leg{dy}', (-0.2, y + dy - 0.02, 0), (-0.16, y + dy + 0.02, SEAT_TOP - 0.06))


def bed_and_laptop(rig):
    """The bed's edge under the hips and an open laptop on the thighs, its screen at the knees facing the face."""
    y = world(rig, 'pelvis').y
    box('Bed', (-0.5, y - 0.22, 0.1), (0.5, y + 0.55, SEAT_TOP))
    box('BedLeg', (-0.4, y - 0.18, 0), (-0.34, y - 0.12, 0.1))
    knee = world(rig, 'shin_L')
    hip = world(rig, 'thigh_L')
    top = max(knee.z, hip.z) + 0.08
    front = knee.y - 0.02
    box('LaptopBase', (-0.17, front, top), (0.17, front + 0.28, top + 0.04))
    screen = box('LaptopScreen', (-0.17, -0.02, 0), (0.17, 0.02, 0.28))
    screen.location = (0, front, top + 0.02)
    screen.rotation_euler = (math.radians(-14), 0, 0)


def office_chair(rig):
    """The office chair under the hips: base on casters, lift, seat, back, arm, and a soda bottle spraying back."""
    y = world(rig, 'pelvis').y + 0.04
    s = 1.3
    for dy in (-0.4, 0.4):
        box(f'BaseArm{dy}', (-0.03, y + min(0, dy), 0.07), (0.03, y + max(0, dy), 0.11))
        cylinder(f'Wheel{dy}', (0, y + dy, 0.05), 0.05, 0.05, axis='X')
    box('Lift', (-0.03, y - 0.03, 0.1), (0.03, y + 0.03, SEAT_TOP - 0.08))
    box('Seat', (-0.26 * s, y - 0.25 * s, SEAT_TOP - 0.09), (0.26 * s, y + 0.25 * s, SEAT_TOP))
    box('Back', (-0.23 * s, y + 0.29 * s, SEAT_TOP + 0.06), (0.23 * s, y + 0.37 * s, SEAT_TOP + 0.62 * s))
    box('BackSpine', (-0.03, y + 0.2, SEAT_TOP - 0.06), (0.03, y + 0.42, SEAT_TOP + 0.1))
    box('ArmPad', (-0.42, y - 0.18, SEAT_TOP + 0.23), (-0.34, y + 0.18, SEAT_TOP + 0.27))
    box('ArmPost', (-0.4, y + 0.0, SEAT_TOP - 0.05), (-0.36, y + 0.05, SEAT_TOP + 0.24))
    # The bottle along the seat's side, its neck past the backrest (+Y), foam bursting out behind it.
    z = SEAT_TOP + 0.1
    cylinder('Bottle', (-0.5, y + 0.3, z), 0.075, 0.34)
    cylinder('Shoulder', (-0.5, y + 0.5, z), 0.05, 0.08)
    cylinder('BottleNeck', (-0.5, y + 0.58, z), 0.028, 0.1)
    for dy, dz, r in ((0.7, 0.0, 0.045), (0.79, 0.03, 0.06), (0.9, -0.02, 0.075), (1.03, 0.04, 0.09), (1.18, -0.01, 0.1)):
        ball((-0.5, y + dy, z + dz), r)


def laptop_in_hand(rig):
    """A closed laptop held in the throwing hand."""
    hand = world(rig, 'hand_L', 'tail')
    box('Laptop', (hand.x - 0.02, hand.y - 0.17, hand.z - 0.12), (hand.x + 0.02, hand.y + 0.05, hand.z + 0.14))


def actions():
    manifest = json.loads(MANIFEST.read_text(encoding='utf-8'))
    clips = {clip['name']: clip for clip in manifest['clips']}
    jump = clips['jump_ual']
    shots = {
        'jump': ('jump_ual', (jump['air'][0] + jump['air'][1]) / 2),
        'run': ('run_ual_sprint', 0.12),
        'punch': ('punch_ual', clips['punch_ual']['strike']['hit']),
        'kick': ('kick', clips['kick']['strike']['hit']),
        # The throwing hand furthest back (in the exported clip's own timing), the laptop in it.
        'throw': ('throw_ual', 0.7),
        'sit': ('seated_chair', 0.5),
        'laptop': ('typing_bed', 0.5),
        'open': ('idle', 0.0),
        'nitro': ('seated_chair', 0.5),
    }
    for name, (action, seconds) in shots.items():
        clear()
        scene = setup(ACTION_SIZE)
        bpy.ops.import_scene.gltf(filepath=str(RIG))
        rig = next(obj for obj in bpy.data.objects if obj.type == 'ARMATURE')
        if rig.animation_data is None:
            rig.animation_data_create()
        # The importer pushes every clip to the NLA; only the chosen one should pose the rig.
        for track in list(rig.animation_data.nla_tracks):
            rig.animation_data.nla_tracks.remove(track)
        pose(rig, action, seconds)
        if name == 'open':
            # Reaching out to a sign: the near arm straight forward and a little up, the palm pushing.
            aim(rig, 'upper_arm_L', (0, -1, 0.25))
            aim(rig, 'forearm_L', (0, -1, 0.35))
            aim(rig, 'hand_L', (0, -0.5, 1))
        elif name == 'sit':
            chair(rig)
        elif name == 'laptop':
            bed_and_laptop(rig)
        elif name == 'nitro':
            # Pressed back into the seat by the push, arms on the armrests.
            turn(rig, 'spine', (1, 0, 0), -16)
            turn(rig, 'neck', (1, 0, 0), -12)
            office_chair(rig)
        elif name == 'throw':
            laptop_in_hand(rig)
        pelvis = world(rig, 'pelvis')
        camera(scene, (0, pelvis.y, 1.25), ACTION_FRAME)
        render(scene, name)


def main():
    head()
    actions()


main()
