"""Separate rigged V4 copy with in-place idle, walk and run clips.

The V4 source is modelled in a T-pose, so every clip lowers the arms through the clavicle and shoulder.
Weights are procedural smooth fields tuned to the V4 garment layout.
"""
import argparse
import json
import math
import re
import sys
from pathlib import Path

import bpy
import numpy as np
from mathutils import Matrix, Vector


ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / 'assets' / 'blender' / 'developer-v4.blend'
TARGET = ROOT / 'assets' / 'blender' / 'developer-v4-rig.blend'
MANIFEST = ROOT / 'public' / 'models' / 'developer-v4-rig.manifest.json'
CLIPS = {'idle': 90, 'walk': 30, 'run': 20}
FPS = 30
WALK_STRIDE, RUN_STRIDE, RUN_STANCE = 0.42, 0.54, 0.38
FINGERS = [(-0.052, 0.140), (-0.018, 0.155), (0.015, 0.146), (0.045, 0.120)]
WEB_FACES, WEB_MIN_RATIO = 3500, 0.10
HEAD_PARTS = ('Head', 'Lips', 'Eye_', 'Eyebrows', 'Moustache', 'Beard', 'Hair', 'Cap')


def matrix_between(a, b, hinge=None):
    """Bone matrix from head to tail. Near-vertical bones need an explicit hinge (bone X axis):
    tracking against world Z is degenerate for them and makes the roll spin as the bone swings."""
    a, b = Vector(a), Vector(b)
    y = (b - a).normalized()
    if hinge is None:
        rotation = y.to_track_quat('Y', 'Z').to_matrix()
    else:
        z = Vector(hinge).cross(y).normalized()
        rotation = Matrix((y.cross(z), y, z)).transposed()
    return Matrix.Translation(a) @ rotation.to_4x4()


def bone_hinge(name):
    return (1, 0, 0) if name.startswith(('thigh_', 'shin_')) else None


def rot_about(pivot, rotation):
    pivot = Vector(pivot)
    return Matrix.Translation(pivot) @ rotation.to_4x4() @ Matrix.Translation(-pivot)


def rx(angle):
    return Matrix.Rotation(angle, 3, 'X')


def ry(angle):
    return Matrix.Rotation(angle, 3, 'Y')


def rz(angle):
    return Matrix.Rotation(angle, 3, 'Z')


# ------------------------------------------------------------------ skeleton


def skeleton():
    bones = {
        'root': ((0, 0, 0), (0, 0, 0.2), None),
        'pelvis': ((0, 0, 1.00), (0, 0, 1.12), 'root'),
        'spine': ((0, 0, 1.12), (0, 0, 1.40), 'pelvis'),
        'chest': ((0, 0, 1.40), (0, 0, 1.80), 'spine'),
        'neck': ((0, 0, 1.80), (0, -0.02, 1.93), 'chest'),
        'head': ((0, -0.02, 1.93), (0, -0.02, 2.60), 'neck'),
    }
    for side, label in ((-1, 'L'), (1, 'R')):
        s = side
        bones[f'clavicle_{label}'] = ((s * 0.03, 0, 1.745), (s * 0.20, -0.01, 1.745), 'chest')
        bones[f'upper_arm_{label}'] = ((s * 0.20, -0.01, 1.745), (s * 0.53, -0.02, 1.735), f'clavicle_{label}')
        bones[f'forearm_{label}'] = ((s * 0.53, -0.02, 1.735), (s * 0.88, -0.022, 1.731), f'upper_arm_{label}')
        bones[f'hand_{label}'] = ((s * 0.88, -0.022, 1.731), (s * 1.035, -0.012, 1.729), f'forearm_{label}')
        for i, (y, length) in enumerate(FINGERS):
            bones[f'finger_{label}_{i}'] = ((s * 1.035, y, 1.729), (s * (1.035 + length), y * 1.04, 1.716), f'hand_{label}')
        bones[f'thumb_{label}'] = ((s * 0.945, -0.052, 1.724), (s * 1.04, -0.103, 1.713), f'hand_{label}')
        bones[f'thigh_{label}'] = ((s * 0.150, 0.0, 1.00), (s * 0.161, 0.004, 0.60), 'pelvis')
        bones[f'shin_{label}'] = ((s * 0.161, 0.004, 0.60), (s * 0.165, 0.01, 0.19), f'thigh_{label}')
        bones[f'foot_{label}'] = ((s * 0.165, 0.01, 0.19), (s * 0.20, -0.32, 0.07), f'shin_{label}')
    return {name: (Vector(h), Vector(t), p) for name, (h, t, p) in bones.items()}


def build_armature(root, definitions):
    armature = bpy.data.armatures.new('DeveloperSkeleton')
    rig = bpy.data.objects.new('DeveloperRig', armature)
    bpy.context.collection.objects.link(rig)
    rig.parent = root
    rig.show_in_front = True
    bpy.context.view_layer.objects.active = rig
    rig.select_set(True)
    bpy.ops.object.mode_set(mode='EDIT')
    for name, (head, tail, parent) in definitions.items():
        bone = armature.edit_bones.new(name)
        bone.head, bone.tail = head, tail
        bone.matrix = matrix_between(head, tail, bone_hinge(name))
        bone.length = (tail - head).length
        if parent:
            bone.parent = armature.edit_bones[parent]
    bpy.ops.object.mode_set(mode='OBJECT')
    return rig


# ------------------------------------------------------------------ weights


def ss(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)


def hoodie_weights(x, y, z):
    ax = np.abs(x)
    right = (x > 0).astype(np.float64)
    torso = {'pelvis': 1 - ss(1.10, 1.26, z), 'spine': ss(1.10, 1.26, z) * (1 - ss(1.34, 1.56, z)), 'chest': ss(1.34, 1.56, z)}
    arm = ss(0.16, 0.32, ax) * np.maximum(ss(1.60, 1.69, z), ss(0.30, 0.37, ax))
    limb = {'clavicle': 1 - ss(0.22, 0.36, ax), 'upper_arm': ss(0.22, 0.36, ax) * (1 - ss(0.50, 0.60, ax)),
            'forearm': ss(0.50, 0.60, ax)}
    out = {name: w * (1 - arm) for name, w in torso.items()}
    for name, w in limb.items():
        out[f'{name}_R'] = w * arm * right
        out[f'{name}_L'] = w * arm * (1 - right)
    return out


def pants_weights(x, y, z):
    right = ss(-0.04, 0.04, x)
    leg = 1 - ss(0.92, 1.06, z)
    shin = 1 - ss(0.50, 0.70, z)
    return {'pelvis': 1 - leg, 'thigh_R': leg * (1 - shin) * right, 'thigh_L': leg * (1 - shin) * (1 - right),
            'shin_R': leg * shin * right, 'shin_L': leg * shin * (1 - right)}


def ankle_weights(x, y, z):
    label = np.where(x > 0, 1.0, 0.0)
    foot = 1 - ss(0.16, 0.24, z)
    return {'foot_R': foot * label, 'foot_L': foot * (1 - label), 'shin_R': (1 - foot) * label, 'shin_L': (1 - foot) * (1 - label)}


def neck_weights(x, y, z):
    head = ss(1.90, 1.98, z)
    chest = 1 - ss(1.76, 1.84, z)
    return {'chest': chest, 'neck': (1 - chest) * (1 - head), 'head': head}


def hand_weights(label):
    def fn(x, y, z):
        ax = np.abs(x)
        fore = 1 - ss(0.86, 0.92, ax)
        finger = ss(1.03, 1.075, ax)
        thumb = ss(-0.066, -0.080, y) * ss(0.935, 0.96, ax) * (1 - finger)
        nearest = np.argmin(np.stack([np.abs(y - fy) for fy, _ in FINGERS]), axis=0)
        out = {f'forearm_{label}': fore, f'hand_{label}': (1 - fore) * (1 - finger) * (1 - thumb),
               f'thumb_{label}': (1 - fore) * thumb}
        for i in range(len(FINGERS)):
            out[f'finger_{label}_{i}'] = (1 - fore) * finger * (nearest == i)
        return out
    return fn


def weight_rule(name):
    label = (re.search(r'_(L|R)(?:_|$)', name) or [None, None])[1]
    if name.startswith(HEAD_PARTS):
        return lambda x, y, z: {'head': np.ones_like(z)}
    if name == 'Hoodie':
        return hoodie_weights
    if name == 'Pants':
        return pants_weights
    if name == 'Ankles':
        return ankle_weights
    if name == 'Neck':
        return neck_weights
    if name.startswith('Hand_'):
        return hand_weights(label)
    if name.startswith('Shoe'):
        return lambda x, y, z: {f'foot_{label}': np.ones_like(z)}
    raise RuntimeError(f'No weight rule for {name}')


def bind(obj, rig):
    co = np.empty(len(obj.data.vertices) * 3)
    obj.data.vertices.foreach_get('co', co)
    x, y, z = co.reshape(-1, 3).T
    weights = {k: np.broadcast_to(v, z.shape).astype(np.float64) for k, v in weight_rule(obj.name)(x, y, z).items()}
    names = list(weights)
    stack = np.stack([weights[n] for n in names], axis=1)
    stack[stack < 1e-4] = 0
    if stack.shape[1] > 4:  # glTF skinning keeps four influences; keep the strongest ones.
        cutoff = -np.sort(-stack, axis=1)[:, 3:4]
        stack[stack < cutoff] = 0
    total = stack.sum(axis=1, keepdims=True)
    if (total <= 0).any():
        raise RuntimeError(f'{obj.name}: unweighted vertices')
    stack /= total
    quantized = np.round(stack * 1024) / 1024
    for column, name in enumerate(names):
        group = obj.vertex_groups.new(name=name)
        values = quantized[:, column]
        for value in np.unique(values[values > 0]):
            group.add(np.nonzero(values == value)[0].tolist(), float(value), 'REPLACE')
    modifier = obj.modifiers.new('Skin', 'ARMATURE')
    modifier.object = rig
    obj.parent = rig
    obj.matrix_parent_inverse = Matrix.Identity(4)


def prepare_meshes(root):
    bpy.ops.object.select_all(action='DESELECT')
    objects = [obj for obj in root.children_recursive if obj.type in {'CURVE', 'MESH'}]
    for obj in objects:
        if obj.type == 'CURVE':
            # Laces and stitching read the same at web distance with far fewer segments.
            obj.data.resolution_u = min(obj.data.resolution_u, 4)
            obj.data.bevel_resolution = min(obj.data.bevel_resolution, 1)
        obj.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    bpy.ops.object.convert(target='MESH')
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    objects = list(bpy.context.selected_objects)
    depsgraph = bpy.context.evaluated_depsgraph_get()
    for obj in objects:
        # Web-weight copy for the real-time scene (the static V4 blend keeps the sculpt-dense meshes).
        # Smooth SDF surfaces keep their shading with ~10% of the faces; the budget is per part.
        if len(obj.data.polygons) > WEB_FACES:
            mod = obj.modifiers.new('Reduce', 'DECIMATE')
            mod.ratio = max(WEB_MIN_RATIO, WEB_FACES / len(obj.data.polygons))
            depsgraph = bpy.context.evaluated_depsgraph_get()
            reduced = bpy.data.meshes.new_from_object(obj.evaluated_get(depsgraph))
            obj.modifiers.clear()
            old = obj.data
            obj.data = reduced
            reduced.name = obj.name
            if old.users == 0:
                bpy.data.meshes.remove(old)
    bpy.ops.object.select_all(action='DESELECT')
    return objects


# ------------------------------------------------------------------ poses


def knee_position(hip, ankle, length1, length2):
    delta = ankle - hip
    distance = min(delta.length, length1 + length2 - 1e-5)
    axis = delta.normalized()
    along = (length1 * length1 - length2 * length2 + distance * distance) / (2 * distance)
    bend = Vector((0, -1, 0))
    bend = (bend - axis * bend.dot(axis)).normalized()
    return hip + axis * along + bend * math.sqrt(max(0, length1 * length1 - along * along))


def pose_matrices(defs, clip, phase):
    phase %= 1
    wave = phase * 2 * math.pi
    rest = {name: matrix_between(h, t, bone_hinge(name)) for name, (h, t, _) in defs.items()}
    head_of = {name: h for name, (h, _, _) in defs.items()}
    out = {'root': rest['root']}
    idle = clip == 'idle'
    running = clip == 'run'
    if idle:
        body = Matrix.Translation((0.006 * math.sin(wave), 0, 0.002 * math.sin(2 * wave)))
        chest = body @ rot_about(head_of['chest'], rx(0.012 * math.sin(2 * wave)))
        head = chest @ rot_about(head_of['neck'], rz(0.035 * math.sin(wave)) @ rx(0.015 * math.sin(2 * wave + 0.6)))
        twist = 0.0
    else:
        bob = (-0.06 + 0.02 * math.cos(2 * wave)) if running else (-0.026 + 0.008 * math.cos(2 * wave))
        lean = 0.15 if running else 0.035
        body = Matrix.Translation((0, 0, bob)) @ rot_about(head_of['pelvis'], rx(lean) @ ry(0.017 * math.sin(wave)))
        twist = (0.10 if running else 0.05) * math.cos(wave)
        chest = body @ rot_about(head_of['spine'], rz(-twist))
        head = chest @ rot_about(head_of['neck'], rz(twist * 0.8) @ rx(-lean * 0.6))
    out['pelvis'] = body @ rest['pelvis']
    out['spine'] = body @ rest['spine']
    out['chest'] = chest @ rest['chest']
    out['neck'] = chest @ rest['neck']
    out['head'] = head @ rest['head']
    for side, label, shift in ((-1, 'L', 0.0), (1, 'R', 0.5)):
        # Arms: lower from the T-pose, then swing opposite to the legs.
        if idle:
            lower, swing, flex, curl = 1.06 + 0.012 * math.sin(2 * wave), 0.03 * math.sin(wave + side), 0.16, 0.30
        else:
            lower = 1.10
            swing = (0.60 if running else 0.30) * math.cos(wave + shift * 2 * math.pi)
            flex = (1.15 if running else 0.22) + 0.08 * math.sin(wave + shift * 2 * math.pi)
            curl = 0.55 if running else 0.35
        clav = chest @ rot_about(head_of[f'clavicle_{label}'], ry(side * 0.10))
        upper = clav @ rot_about(head_of[f'upper_arm_{label}'], rx(swing) @ ry(side * (lower - 0.10)))
        fore = upper @ rot_about(head_of[f'forearm_{label}'], rz(-side * flex))
        hand = fore @ rot_about(head_of[f'hand_{label}'], rz(-side * 0.08))
        out[f'clavicle_{label}'] = clav @ rest[f'clavicle_{label}']
        out[f'upper_arm_{label}'] = upper @ rest[f'upper_arm_{label}']
        out[f'forearm_{label}'] = fore @ rest[f'forearm_{label}']
        out[f'hand_{label}'] = hand @ rest[f'hand_{label}']
        for i in range(len(FINGERS)):
            name = f'finger_{label}_{i}'
            out[name] = hand @ rot_about(head_of[name], ry(side * curl * (0.85 + 0.1 * i))) @ rest[name]
        out[f'thumb_{label}'] = hand @ rot_about(head_of[f'thumb_{label}'], rz(side * 0.25)) @ rest[f'thumb_{label}']
        # Legs: in-place foot path with analytic knee IK.
        hip_rest, knee_rest, _ = defs[f'thigh_{label}']
        _, ankle_rest, _ = defs[f'shin_{label}']
        l1, l2 = (knee_rest - hip_rest).length, (ankle_rest - knee_rest).length
        hip = body @ hip_rest
        if idle:
            ankle, pitch = ankle_rest.copy(), 0.0
        else:
            stride = RUN_STRIDE if running else WALK_STRIDE
            stance = RUN_STANCE if running else 0.60
            lift = 0.16 if running else 0.065
            t = (phase + shift) % 1
            if t <= stance:
                foot_y, foot_z, pitch = -stride / 2 + stride * t / stance, 0.0, 0.0
            else:
                u = (t - stance) / (1 - stance)
                foot_y = stride / 2 - stride * u
                foot_z = lift * math.sin(math.pi * u) ** 1.2
                # Relaxed toe-down while the foot is in the air, proportional to its height so the toe
                # (about 0.3 m ahead of the ankle) never dips below the floor; level again at landing.
                pitch = (1.2 if running else 1.5) * foot_z
            ankle = Vector((ankle_rest.x, ankle_rest.y + foot_y, ankle_rest.z + foot_z))
        knee = knee_position(hip, ankle, l1, l2)
        out[f'thigh_{label}'] = matrix_between(hip, knee, (1, 0, 0))
        out[f'shin_{label}'] = matrix_between(knee, ankle, (1, 0, 0))
        out[f'foot_{label}'] = Matrix.Translation(ankle) @ rx(pitch).to_4x4() @ Matrix.Translation(-ankle_rest) @ rest[f'foot_{label}']
    return out


def create_actions(rig, defs):
    animation = rig.animation_data_create()
    rest = {bone.name: bone.matrix_local.copy() for bone in rig.data.bones}
    for clip, frames in CLIPS.items():
        action = bpy.data.actions.new(clip)
        slot = action.slots.new(id_type='OBJECT', name=rig.name)
        bag = action.layers.new('Pose').strips.new(type='KEYFRAME').channelbag(slot, ensure=True)
        values = {bone: {'location': [], 'rotation_quaternion': []} for bone in defs}
        previous = {}
        for frame in range(frames + 1):
            pose = pose_matrices(defs, clip, frame / frames)
            for name, (_, _, parent) in defs.items():
                if parent:
                    basis = rest[name].inverted() @ rest[parent] @ pose[parent].inverted() @ pose[name]
                else:
                    basis = rest[name].inverted() @ pose[name]
                location, rotation, _ = basis.decompose()
                if name in previous and previous[name].dot(rotation) < 0:
                    rotation.negate()
                previous[name] = rotation.copy()
                values[name]['location'].append(tuple(location))
                values[name]['rotation_quaternion'].append(tuple(rotation))
        for name, channels in values.items():
            rig.pose.bones[name].rotation_mode = 'QUATERNION'
            for channel, samples in channels.items():
                for index in range(len(samples[0])):
                    fcurve = bag.fcurves.new(data_path=f'pose.bones["{name}"].{channel}', index=index)
                    fcurve.keyframe_points.add(frames + 1)
                    fcurve.keyframe_points.foreach_set('co', [c for f, s in enumerate(samples) for c in (f, s[index])])
                    for key in fcurve.keyframe_points:
                        key.interpolation = 'LINEAR'
        animation.action = action
        animation.action_slot = slot
        track = animation.nla_tracks.new()
        track.name = clip
        track.strips.new(clip, 0, action).action_slot = slot
        track.mute = True
        action.use_fake_user = True
    animation.action = None
    for bone in rig.pose.bones:
        bone.matrix_basis = Matrix.Identity(4)
    bpy.context.scene.frame_set(0)


def render_reviews(rig, destination):
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    from render_character_v4 import frame, studio
    rig_empty, camera = studio()
    scene = bpy.context.scene
    scene.cycles.samples = 64
    scene.render.resolution_x = scene.render.resolution_y = 1000
    destination.mkdir(parents=True, exist_ok=True)
    for clip in CLIPS:
        action = bpy.data.actions[clip]
        rig.animation_data.action = action
        rig.animation_data.action_slot = action.slots[0]
        for view, fraction in (('three-quarter', 0.15), ('left', 0.15)):
            frame(camera, rig_empty, view)
            scene.frame_set(round(CLIPS[clip] * (0.25 if clip == 'idle' else fraction)))
            scene.render.filepath = str(destination / f'{clip}-{view}.png')
            bpy.ops.render.render(write_still=True)
    rig.animation_data.action = None


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--replace-generated', action='store_true')
    parser.add_argument('--render', action='store_true')
    args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else [])
    if TARGET.exists() and not args.replace_generated:
        raise RuntimeError('V4 rig exists. Review it before using --replace-generated.')
    bpy.ops.wm.open_mainfile(filepath=str(SOURCE))
    root = bpy.data.objects['Developer']
    objects = prepare_meshes(root)
    defs = skeleton()
    rig = build_armature(root, defs)
    for obj in objects:
        bind(obj, rig)
    rig['clips'] = 'idle,walk,run'
    rig['locomotion'] = 'in-place'
    root['stage'] = '04B-v4-rig'
    bpy.context.scene.render.fps = FPS
    create_actions(rig, defs)
    bpy.ops.wm.save_as_mainfile(filepath=str(TARGET), compress=True)
    speeds = {'idle': 0, 'walk': WALK_STRIDE / (0.60 * CLIPS['walk'] / FPS), 'run': RUN_STRIDE / (RUN_STANCE * CLIPS['run'] / FPS)}
    manifest = {'source': 'developer-v4-rig.glb', 'fps': FPS, 'inPlace': True, 'clips': [
        {'name': name, 'duration': frames / FPS, 'loop': True, 'speed': speeds[name]} for name, frames in CLIPS.items()]}
    MANIFEST.write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8')
    print(f'V4 rig: {TARGET}')
    if args.render:
        render_reviews(rig, ROOT / 'assets' / 'renders' / 'character-v4-rig')


if __name__ == '__main__':
    main()
