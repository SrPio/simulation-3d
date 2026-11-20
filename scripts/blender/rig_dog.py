"""Rig Canela and give her clips: retargeted from Quaternius' CC0 Shiba Inu, plus the ones that pack lacks.

Reads `assets/blender/canela.blend` (from create_dog.py), builds the `Canela` armature (its own skeleton: root,
pelvis, spine, chest, two neck bones, head, a chain of three bones down each ear, three tail bones, front legs of upper/lower/paw and hind legs
of thigh/shin/hock/paw), skins the body and the ears (so they bend) with procedural weights, hangs the rigid parts (eyes, nose, collar, tag)
from their bones, and writes `assets/blender/canela-rig.blend`, `public/models/canela.glb` and
`public/models/canela.manifest.json`.

Clips (24 fps): `idle`, `walk`, `run` (Gallop) and `jump` (Jump_ToIdle) are retargeted from the Shiba Inu of
Quaternius' «Ultimate Animated Animals» (CC0, https://poly.pizza/m/y4wdQpg767, downloaded to the git-ignored
`assets/external/quaternius-animals/ShibaInu.glb`) by world-rotation transfer from the shared standing rest pose; the
hips' bob is scaled by the size ratio and the paws are kept on the ground. `sit` and `pickup` are posed here (the pack
has no sit): the body pitched about the shoulders with leg IK. Ears and tail have no motion of their own in any clip:
the viewer swings the ears and holds the tail up at runtime.

Run after create_dog.py: --background --factory-startup --python-exit-code 1 --python scripts/blender/rig_dog.py
-- --replace-generated [--render]
"""
import argparse
import json
import math
import sys
from pathlib import Path

import bpy
import numpy as np
from mathutils import Matrix, Quaternion, Vector

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / 'assets' / 'blender' / 'canela.blend'
TARGET = ROOT / 'assets' / 'blender' / 'canela-rig.blend'
OUTPUT = ROOT / 'public' / 'models' / 'canela.glb'
MANIFEST = ROOT / 'public' / 'models' / 'canela.manifest.json'
RENDERS = ROOT / 'assets' / 'renders' / 'canela-rig'
SHIBA = ROOT / 'assets' / 'external' / 'quaternius-animals' / 'ShibaInu.glb'
FPS = 24

# name: (head, tail, parent, source bone of the Shiba Inu or None). Blender frame: metres, facing -Y, paws at Z=0.
BONES = {
    'root': ((0, 0.02, 0.40), (0, 0.02, 0.47), None, 'Body'),
    'pelvis': ((0, 0.20, 0.46), (0, 0.06, 0.46), 'root', 'Back'),
    'spine': ((0, 0.06, 0.46), (0, -0.08, 0.46), 'pelvis', 'Torso'),
    'chest': ((0, -0.08, 0.46), (0, -0.17, 0.48), 'spine', 'Torso2'),
    'neck1': ((0, -0.15, 0.52), (0, -0.20, 0.64), 'chest', 'Neck1'),
    'neck2': ((0, -0.20, 0.64), (0, -0.23, 0.72), 'neck1', 'Neck3'),
    'head': ((0, -0.23, 0.72), (0, -0.40, 0.72), 'neck2', 'Head'),
    'tail1': ((0, 0.24, 0.50), (0, 0.33, 0.565), 'pelvis', None),
    'tail2': ((0, 0.33, 0.565), (0, 0.385, 0.625), 'tail1', None),
    'tail3': ((0, 0.385, 0.625), (0, 0.408, 0.73), 'tail2', None),
}
for side, s in (('L', 1), ('R', -1)):
    BONES.update({
        f'f_upper.{side}': ((s * 0.097, -0.20, 0.40), (s * 0.097, -0.20, 0.22), 'chest', f'FrontUpperLeg.{side}'),
        f'f_lower.{side}': ((s * 0.097, -0.20, 0.22), (s * 0.097, -0.205, 0.055), f'f_upper.{side}', f'FrontLowerLeg.{side}'),
        f'f_paw.{side}': ((s * 0.097, -0.205, 0.055), (s * 0.097, -0.27, 0.02), f'f_lower.{side}', None),
        f'h_thigh.{side}': ((s * 0.10, 0.17, 0.43), (s * 0.105, 0.19, 0.30), 'pelvis', f'BackLeg.{side}'),
        f'h_shin.{side}': ((s * 0.105, 0.19, 0.30), (s * 0.108, 0.25, 0.17), f'h_thigh.{side}', f'BackUpperLeg.{side}'),
        f'h_hock.{side}': ((s * 0.108, 0.25, 0.17), (s * 0.108, 0.245, 0.055), f'h_shin.{side}', f'BackLowerLeg.{side}'),
        f'h_paw.{side}': ((s * 0.108, 0.245, 0.055), (s * 0.108, 0.18, 0.02), f'h_hock.{side}', None),
    })
# The ears: a chain of EAR_BONES bones each (ear, ear1, ear2) down the middle of the flap, laid out from the mesh by
# `ear_chain` before the armature is built, so each ear bends along its length (the viewer swings the chain).
EAR_BONES = 3
PAWS = ['f_paw.L', 'f_paw.R', 'h_paw.L', 'h_paw.R']
# The hips' bob and the jump's height are the Shiba's times this (Canela's legs against the Shiba's).
SCALE = 0.27
# Retargeted clips: name -> (Shiba action, first frame, last frame, loop, paws held on the ground).
RETARGET = {
    'idle': ('Idle', 0, 80, True, True),
    'walk': ('Walk', 0, 25, True, True),
    'run': ('Gallop', 0, 13, True, False),
    'jump': ('Jump_ToIdle', 0, 32, False, False),
}
# Rigid parts and the bone each hangs from.
RIGID = {'Canela_Collar': 'neck1', 'Canela_Tag': 'neck1',
         'Canela_TagName': 'neck1', 'Canela_TagRing': 'neck1', 'Canela_TagLoop': 'neck1'}
MOUTH = (0, -0.43, 0.655)  # where the ball sits, under the nose


# ------------------------------------------------------------------ skeleton

def ear_chain():
    """Add each ear's bones to BONES: joints on the flap's middle line, from where it hangs on the head to its tip."""
    for side in ('L', 'R'):
        ear = bpy.data.objects[f'Canela_Ear_{side}']
        points = np.array([ear.matrix_world @ v.co for v in ear.data.vertices])
        top, low = points[:, 2].max(), points[:, 2].min()
        joints = []
        for i in range(EAR_BONES + 1):
            z = top - (top - low) * (0.04 + 0.92 * i / EAR_BONES)
            near = points[np.abs(points[:, 2] - z) < 0.015]
            joints.append(tuple(float(c) for c in (*near[:, :2].mean(axis=0), z)))
        # The root hangs on the head: at the inner edge of the flap's top.
        inner = points[points[:, 2] > top - 0.03]
        joints[0] = (float(inner[np.argmin(np.abs(inner[:, 0])), 0]), joints[0][1], joints[0][2])
        names = [f'ear.{side}'] + [f'ear{i}.{side}' for i in range(1, EAR_BONES)]
        for i, name in enumerate(names):
            BONES[name] = (joints[i], joints[i + 1], 'head' if i == 0 else names[i - 1], None)


def ear_weights(rig):
    """Skin each ear to its chain: each vertex to the nearest bones along the flap, blended smoothly between them."""
    for side in ('L', 'R'):
        ear = bpy.data.objects[f'Canela_Ear_{side}']
        points = np.array([ear.matrix_world @ v.co for v in ear.data.vertices])
        names = [f'ear.{side}'] + [f'ear{i}.{side}' for i in range(1, EAR_BONES)]
        raw = []
        for name in names:
            head, tail, _, _ = BONES[name]
            d = segment_distance(points, head, tail)
            raw.append(1 / (d * d + 4e-4) ** 2)
        table = np.stack(raw, axis=1)
        table /= table.sum(axis=1, keepdims=True)
        for column, name in enumerate(names):
            group = ear.vertex_groups.new(name=name)
            for index in np.nonzero(table[:, column] > 1e-3)[0]:
                group.add([int(index)], float(table[index, column]), 'REPLACE')
        world = ear.matrix_world.copy()
        ear.parent = rig
        ear.matrix_world = world
        ear.modifiers.new('Armature', 'ARMATURE').object = rig


def build_armature():
    data = bpy.data.armatures.new('Canela')
    rig = bpy.data.objects.new('Canela', data)
    bpy.context.collection.objects.link(rig)
    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.mode_set(mode='EDIT')
    for name, (head, tail, parent, _) in BONES.items():
        bone = data.edit_bones.new(name)
        bone.head, bone.tail = head, tail
        bone.roll = 0
        if parent:
            bone.parent = data.edit_bones[parent]
    bpy.ops.object.mode_set(mode='OBJECT')
    for bone in rig.pose.bones:
        bone.rotation_mode = 'QUATERNION'
    return rig


def segment_distance(points, a, b):
    a, b = np.array(a), np.array(b)
    ab = b - a
    t = np.clip(((points - a) @ ab) / (ab @ ab), 0, 1)
    return np.linalg.norm(points - (a + t[:, None] * ab), axis=1)


def smooth01(x):
    x = np.clip(x, 0, 1)
    return x * x * (3 - 2 * x)


# How far round each leg's bones its skin reaches (m): all the leg's within `inner`, none past `outer`, and how far
# above the leg's top joint it fades into the body (`top`, `band`). Outside that the body bones carry the skin, so the
# belly, chest and flanks bend with the trunk instead of being dragged by the legs (they tore when she sat).
# Up in the trunk (above `split`, where the leg leaves the body) a leg never reaches in past `inside` from the middle
# line, so the belly and the brisket between the legs stay the trunk's.
LEG_REACH = {'f': {'inner': 0.05, 'outer': 0.09, 'top': 0.03, 'band': 0.07, 'split': 0.3, 'inside': 0.045},
             'h': {'inner': 0.065, 'outer': 0.11, 'top': 0.04, 'band': 0.08, 'split': 0.32, 'inside': 0.06}}
# Within a leg the bones share the skin more softly than the trunk's, so a bent knee or hock rounds off instead of
# pinching into a sliver.
LEG_SOFT = 3e-4


def inverse_square(points, names, power=2, soft=1e-4):
    """Each bone's share by inverse distance to its segment (to 2 × `power`), normalised among `names`; a lower power
    and a larger `soft` spread a joint's bend over more of the skin."""
    raw = {}
    for name in names:
        head_, tail_, _, _ = BONES[name]
        d = segment_distance(points, head_, tail_)
        raw[name] = 1 / (d * d + soft) ** power
    total = sum(raw.values()) + 1e-12
    return {name: w / total for name, w in raw.items()}


def body_weights(points):
    """Weights per bone for the body's vertices: the trunk's bones everywhere, each leg only near its own bones (fading
    smoothly into the trunk), tail and neck only where they belong; the head rigid."""
    x, y, z = points[:, 0], points[:, 1], points[:, 2]
    # The trunk: pelvis, spine and chest, with the neck in front and the tail behind faded in softly.
    trunk = ['pelvis', 'spine', 'chest', 'neck1', 'neck2', 'tail1', 'tail2', 'tail3']
    share = inverse_square(points, trunk)
    neck = smooth01((-0.06 - y) / 0.05) * smooth01((z - 0.44) / 0.05)
    tail = smooth01((y - 0.22) / 0.03) * smooth01((z - 0.45) / 0.03) * smooth01((0.09 - np.abs(x)) / 0.02)
    for name in trunk:
        if name.startswith('neck'):
            share[name] = share[name] * neck
        elif name.startswith('tail'):
            share[name] = share[name] * tail
    total = sum(share.values()) + 1e-12
    weights = {name: w / total for name, w in share.items()}
    # Each leg takes the skin round its bones, blended over a band, and hands the rest back to the trunk.
    legs = {}
    for side, s in (('L', 1), ('R', -1)):
        for kind, chain in (('f', ['f_upper', 'f_lower', 'f_paw']), ('h', ['h_thigh', 'h_shin', 'h_hock', 'h_paw'])):
            names = [f'{bone}.{side}' for bone in chain]
            reach = LEG_REACH[kind]
            d = np.min([segment_distance(points, *BONES[name][:2]) for name in names], axis=0)
            top = BONES[names[0]][0][2]
            near = smooth01((reach['outer'] - d) / (reach['outer'] - reach['inner']))
            near *= smooth01((top + reach['top'] - z) / reach['band'])
            below = smooth01((reach['split'] - z) / 0.05)
            near *= np.maximum(below, smooth01((x * s - reach['inside']) / 0.035))
            legs[(side, kind)] = (near, inverse_square(points, names, power=2, soft=LEG_SOFT))
    # Where two legs reach the same skin (they never quite do), the nearer wins.
    leg_total = np.clip(sum(near for near, _ in legs.values()), 0, 1)
    scale = leg_total / (sum(near for near, _ in legs.values()) + 1e-12)
    weights = {name: w * (1 - leg_total) for name, w in weights.items()}
    for near, shares in legs.values():
        for name, w in shares.items():
            weights[name] = near * scale * w
    # The head moves as one: everything above the neck and in front of it, blended over a short band.
    head = smooth01((z - 0.6) / 0.08) * smooth01((-0.11 - y) / 0.06)
    head = np.maximum(head, smooth01((-0.3 - y) / 0.03) * (z > 0.55))
    weights = {name: w * (1 - head) for name, w in weights.items()}
    weights['head'] = head
    # Keep the four strongest per vertex.
    names = list(weights)
    table = np.stack([weights[n] for n in names], axis=1)
    order = np.argsort(-table, axis=1)
    keep = np.zeros_like(table, bool)
    np.put_along_axis(keep, order[:, :4], True, axis=1)
    table = np.where(keep, table, 0)
    table /= table.sum(axis=1, keepdims=True)
    return names, table


def skin(rig):
    body = bpy.data.objects['Canela_Body']
    points = np.array([v.co for v in body.data.vertices])
    names, table = body_weights(points)
    for column, name in enumerate(names):
        group = body.vertex_groups.new(name=name)
        for index in np.nonzero(table[:, column] > 1e-3)[0]:
            group.add([int(index)], float(table[index, column]), 'REPLACE')
    world = body.matrix_world.copy()
    body.parent = rig
    body.matrix_world = world
    body.modifiers.new('Armature', 'ARMATURE').object = rig


def hang(rig):
    for obj in list(bpy.data.objects):
        if obj.type != 'MESH' or obj.name == 'Canela_Body' or obj.name.startswith('Canela_Ear') or not obj.name.startswith('Canela'):
            continue
        bone = RIGID.get(obj.name, 'head')
        world = obj.matrix_world.copy()
        obj.parent = rig
        obj.parent_type = 'BONE'
        obj.parent_bone = bone
        bpy.context.view_layer.update()
        obj.matrix_world = world
    mouth = bpy.data.objects.new('Canela_Mouth', None)
    bpy.context.collection.objects.link(mouth)
    mouth.parent = rig
    mouth.parent_type = 'BONE'
    mouth.parent_bone = 'head'
    bpy.context.view_layer.update()
    mouth.matrix_world = Matrix.Translation(MOUTH)


# ------------------------------------------------------------------ poses

def rest(rig):
    return {bone.name: bone.matrix_local.copy() for bone in rig.data.bones}


def follow(rest_m, name, parent_pose):
    """A bone carried by its parent without a motion of its own."""
    parent = BONES[name][2]
    return parent_pose @ rest_m[parent].inverted() @ rest_m[name]


def tip(matrix, name):
    head, tail = Vector(BONES[name][0]), Vector(BONES[name][1])
    return matrix @ Vector((0, (tail - head).length, 0))


def ground(pose, hold):
    """Lift or lower the whole pose so the lowest paw tip touches the ground (`hold`), or only out of it."""
    low = min(tip(pose[name], name).z for name in PAWS) - 0.02
    shift = -low if hold else max(0.0, -low)
    move = Matrix.Translation((0, 0, shift))
    return {name: move @ m for name, m in pose.items()}


def retarget(rig, shiba, action, first, last, hold):
    rest_m = rest(rig)
    scene = bpy.context.scene
    shiba.animation_data.action = action
    shiba.animation_data.action_slot = action.slots[0]
    source_rest = {b.name: (shiba.matrix_world @ b.matrix_local).decompose() for b in shiba.data.bones}
    frames = []
    for frame in range(first, last + 1):
        scene.frame_set(frame)
        pose = {}
        for name, (head, _, parent, source) in BONES.items():
            if source:
                location, rotation, _ = (shiba.matrix_world @ shiba.pose.bones[source].matrix).decompose()
                rest_loc, rest_rot, _ = source_rest[source]
                delta = rotation @ rest_rot.inverted()
                _, own, _ = rest_m[name].decompose()
                turned = (delta @ own).to_matrix().to_4x4()
                if parent is None:
                    shift = (location - rest_loc) * SCALE
                    at = Vector(head) + Vector((0, shift.y, shift.z))
                else:
                    at = follow(rest_m, name, pose[parent]).translation
                pose[name] = Matrix.Translation(at) @ turned
            else:
                pose[name] = follow(rest_m, name, pose[parent])
        frames.append(ground(pose, hold))
    return frames


def two_bone(start, end, l1, l2, pole):
    """Middle joint of a two-bone chain from `start` reaching for `end`, bending towards `pole`."""
    reach = end - start
    d = min(reach.length, (l1 + l2) * 0.999)
    direction = reach.normalized()
    a = (l1 * l1 + d * d - l2 * l2) / (2 * d)
    h = math.sqrt(max(l1 * l1 - a * a, 0))
    bend = (pole - direction * pole.dot(direction)).normalized()
    return start + direction * a + bend * h, start + direction * d


def aimed(rest_m, name, start, end):
    """The bone's rest orientation turned the shortest way to point from `start` to `end`."""
    head, tail = Vector(BONES[name][0]), Vector(BONES[name][1])
    _, own, _ = rest_m[name].decompose()
    turn = (tail - head).normalized().rotation_difference((end - start).normalized())
    return Matrix.Translation(start) @ (turn @ own).to_matrix().to_4x4()


def length(name):
    return (Vector(BONES[name][1]) - Vector(BONES[name][0])).length


def posed(rig, pitch=0.0, pivot=(0, -0.2, 0.40), drop=0.0, bend=None, hind_paw=None, hock_flat=False, splay=0.0, knee_out=0.0):
    """A still pose: the body turned by `pitch` about X round `pivot` and lowered by `drop`, the bones in `bend`
    (name -> radians about X) turned with what hangs from them, and the legs reaching their paws by IK: the front
    paws stay where they stand, the hind ones go to `hind_paw` (y) and `splay` (m) further out, their hocks lying flat
    when `hock_flat`, the knees turned out by `knee_out` (so a folded thigh lies beside the belly, not into it)."""
    rest_m = rest(rig)
    body = Matrix.Translation((0, 0, -drop)) @ Matrix.Translation(pivot) @ Matrix.Rotation(pitch, 4, 'X') @ Matrix.Translation(-Vector(pivot))
    pose = {}
    for name, (_, _, parent, _) in BONES.items():
        pose[name] = body @ rest_m[name] if parent is None else follow(rest_m, name, pose[parent])
        if bend and name in bend:
            at = pose[name].translation.copy()
            pose[name] = Matrix.Translation(at) @ Matrix.Rotation(bend[name], 4, 'X') @ Matrix.Translation(-at) @ pose[name]
    for side, s in (('L', 1), ('R', -1)):
        # Front: shoulder to wrist with the elbow behind, the paw keeping its rest place and attitude.
        upper, lower, paw = f'f_upper.{side}', f'f_lower.{side}', f'f_paw.{side}'
        shoulder = pose[upper].translation.copy()
        wrist = Vector(BONES[paw][0])
        elbow, wrist = two_bone(shoulder, wrist, length(upper), length(lower), Vector((0, 1, 0)))
        pose[upper] = aimed(rest_m, upper, shoulder, elbow)
        pose[lower] = aimed(rest_m, lower, elbow, wrist)
        pose[paw] = Matrix.Translation(wrist) @ rest_m[paw].decompose()[1].to_matrix().to_4x4()
        # Hind: hip to hock with the knee forward, then the hock down (or flat) to the paw.
        thigh, shin, hock, hpaw = f'h_thigh.{side}', f'h_shin.{side}', f'h_hock.{side}', f'h_paw.{side}'
        hip = pose[thigh].translation.copy()
        ankle = Vector(BONES[hpaw][0])
        if hind_paw is not None:
            ankle = Vector((ankle.x + s * splay, hind_paw, ankle.z))
        heel = ankle + (Vector((0, length(hock) * 0.97, 0.03)) if hock_flat else Vector((0, 0.005, length(hock))))
        knee, heel = two_bone(hip, heel, length(thigh), length(shin), Vector((s * knee_out, -1, 0.3)))
        pose[thigh] = aimed(rest_m, thigh, hip, knee)
        pose[shin] = aimed(rest_m, shin, knee, heel)
        pose[hock] = aimed(rest_m, hock, heel, ankle)
        pose[hpaw] = Matrix.Translation(ankle) @ rest_m[hpaw].decompose()[1].to_matrix().to_4x4()
    for name, (_, _, parent, _) in BONES.items():
        if name.startswith(('tail', 'ear')):
            pose[name] = follow(rest_m, name, pose[parent])
    return pose


# Sitting pitches the body about a point low in the chest, by the elbows, so the brisket rises in front of the legs
# instead of swinging forward through them (pitched about the shoulders the skin tore between the front legs).
SIT = {'pitch': -0.66, 'pivot': (0, -0.2, 0.28), 'drop': 0.0, 'hind_paw': 0.12, 'hock_flat': True,
       'bend': {'neck1': 0.34, 'head': 0.24}}
PICKUP = {'pitch': 0.2, 'pivot': (0, 0.2, 0.43), 'drop': 0.09, 'bend': {'neck1': 0.62, 'neck2': 0.3, 'head': 0.2}}


def blend(a, b, t):
    """Every bone's matrix part way from pose `a` to pose `b`."""
    out = {}
    for name in a:
        la, ra, _ = a[name].decompose()
        lb, rb, _ = b[name].decompose()
        out[name] = Matrix.Translation(la.lerp(lb, t)) @ ra.slerp(rb, t).to_matrix().to_4x4()
    return out


def ease(t):
    return t * t * (3 - 2 * t)


def made_clips(rig):
    stand = posed(rig)
    sit = posed(rig, **SIT)
    low = posed(rig, **PICKUP)
    clips = {}
    # Sitting breathes: the chest and head rise a little.
    frames = []
    for f in range(48):
        breath = 0.5 - 0.5 * math.cos(2 * math.pi * f / 48)
        frames.append(posed(rig, **{**SIT, 'pitch': SIT['pitch'] - 0.015 * breath}))
    frames.append(frames[0])
    clips['sit'] = frames
    # Picking up (and putting down): down to the ground, a moment there, back up.
    down, hold, up = 8, 4, 9
    frames = [blend(stand, low, ease(f / down)) for f in range(down)]
    frames += [low] * hold
    frames += [blend(low, stand, ease(f / up)) for f in range(up + 1)]
    clips['pickup'] = frames
    return clips, {'sit': sit, 'pickup': (down + hold * 0.5) / FPS}


# ------------------------------------------------------------------ actions

def key(rig, name, frames, loop):
    rest_m = rest(rig)
    animation = rig.animation_data_create()
    action = bpy.data.actions.new(name)
    slot = action.slots.new(id_type='OBJECT', name=rig.name)
    bag = action.layers.new('Pose').strips.new(type='KEYFRAME').channelbag(slot, ensure=True)
    previous = {}
    # Ears and tail are moved by the viewer alone (it swings the ears and holds the tail up), so they get no keys.
    keyed = [bone for bone in BONES if not bone.startswith(('ear', 'tail'))]
    values = {bone: {'location': [], 'rotation_quaternion': []} for bone in keyed}
    for pose in frames:
        for bone in keyed:
            parent = BONES[bone][2]
            if parent:
                basis = rest_m[bone].inverted() @ rest_m[parent] @ pose[parent].inverted() @ pose[bone]
            else:
                basis = rest_m[bone].inverted() @ pose[bone]
            location, rotation, _ = basis.decompose()
            if bone in previous and previous[bone].dot(rotation) < 0:
                rotation.negate()
            previous[bone] = rotation.copy()
            values[bone]['location'].append(tuple(location))
            values[bone]['rotation_quaternion'].append(tuple(rotation))
    for bone, channels in values.items():
        for channel, samples in channels.items():
            for index in range(len(samples[0])):
                curve = bag.fcurves.new(data_path=f'pose.bones["{bone}"].{channel}', index=index)
                curve.keyframe_points.add(len(samples))
                curve.keyframe_points.foreach_set('co', [c for f, s in enumerate(samples) for c in (f, s[index])])
                for point in curve.keyframe_points:
                    point.interpolation = 'LINEAR'
    animation.action = action
    animation.action_slot = slot
    track = animation.nla_tracks.new()
    track.name = name
    track.strips.new(name, 0, action).action_slot = slot
    track.mute = True
    action.use_fake_user = True
    return action


def ground_speed(frames):
    """How fast the ground goes under a planted paw (m/s): the clip's own walking speed."""
    speeds = []
    for name in PAWS:
        tips = [tip(pose[name], name) for pose in frames]
        for a, b in zip(tips, tips[1:]):
            if a.z < 0.035 and b.z < 0.035 and b.y > a.y:
                speeds.append((b.y - a.y) * FPS)
    return float(np.median(speeds)) if speeds else 0.0


def airborne(frames):
    """First and last frame with every paw off the ground, and the highest lift of the hips."""
    up = [f for f, pose in enumerate(frames) if min(tip(pose[n], n).z for n in PAWS) > 0.045]
    lift = max(pose['root'].translation.z for pose in frames) - frames[0]['root'].translation.z
    return (up[0], up[-1]) if up else (0, 0), lift


# ------------------------------------------------------------------ main

def import_shiba():
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=str(SHIBA))
    made = [o for o in bpy.data.objects if o not in before]
    shiba = next(o for o in made if o.type == 'ARMATURE')
    shiba.animation_data_create()
    return shiba, made


def render(rig, clips):
    scene = bpy.context.scene
    engines = [e.identifier for e in bpy.types.RenderSettings.bl_rna.properties['engine'].enum_items]
    scene.render.engine = 'BLENDER_EEVEE_NEXT' if 'BLENDER_EEVEE_NEXT' in engines else 'BLENDER_EEVEE'
    scene.render.resolution_x, scene.render.resolution_y = 700, 560
    scene.view_settings.view_transform = 'Standard'
    world = bpy.data.worlds.new('Review')
    world.use_nodes = True
    world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.86, 0.8, 0.7, 1)
    scene.world = world
    bpy.ops.mesh.primitive_plane_add(size=20)
    for name, energy, rotation in (('Key', 2.6, (0.75, 0.15, -0.9)), ('Fill', 0.8, (1.0, -0.2, 2.2))):
        light = bpy.data.objects.new(name, bpy.data.lights.new(name, 'SUN'))
        light.data.energy = energy
        light.rotation_euler = rotation
        scene.collection.objects.link(light)
    camera = bpy.data.objects.new('Camera', bpy.data.cameras.new('Camera'))
    camera.data.lens = 70
    scene.collection.objects.link(camera)
    scene.camera = camera
    RENDERS.mkdir(parents=True, exist_ok=True)
    shots = [('idle', 0), ('walk', 0), ('walk', 6), ('walk', 12), ('run', 0), ('run', 4), ('run', 8), ('jump', 14),
             ('sit', 0), ('pickup', 10)]
    for view, azimuth in (('side', -math.pi / 2), ('three-quarter', -0.75)):
        target = Vector((0, 0, 0.36))
        camera.location = target + Vector((math.sin(azimuth), -math.cos(azimuth), 0.28)).normalized() * 3.0
        camera.rotation_euler = (target - camera.location).to_track_quat('-Z', 'Y').to_euler()
        for clip, frame in shots:
            rig.animation_data.action = clips[clip]
            rig.animation_data.action_slot = clips[clip].slots[0]
            scene.frame_set(frame)
            scene.render.filepath = str(RENDERS / f'{clip}-{frame}-{view}.png')
            bpy.ops.render.render(write_still=True)
    rig.animation_data.action = None


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--replace-generated', action='store_true')
    parser.add_argument('--render', action='store_true')
    args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else [])
    if TARGET.exists() and not args.replace_generated:
        raise RuntimeError('canela-rig.blend exists. Review it before using --replace-generated.')
    if not SHIBA.exists():
        raise RuntimeError(f'Missing {SHIBA}: download the CC0 Shiba Inu from https://poly.pizza/m/y4wdQpg767')
    bpy.ops.wm.open_mainfile(filepath=str(SOURCE))
    scene = bpy.context.scene
    scene.render.fps = FPS
    old = bpy.data.objects.get('Canela')
    extras = {key: old[key] for key in old.keys() if not key.startswith('_')}
    for child in list(old.children):
        world = child.matrix_world.copy()
        child.parent = None
        child.matrix_world = world
    bpy.data.objects.remove(old)
    ear_chain()
    rig = build_armature()
    for key_, value in extras.items():
        rig[key_] = value
    skin(rig)
    ear_weights(rig)
    hang(rig)

    shiba, imported = import_shiba()
    actions = {}
    manifest = {'fps': FPS, 'clips': {}}
    retargeted = {}
    for name, (source, first, last, loop, hold) in RETARGET.items():
        frames = retarget(rig, shiba, bpy.data.actions[f'AnimalArmature|{source}'], first, last, hold)
        retargeted[name] = frames
        actions[name] = key(rig, name, frames, loop)
        manifest['clips'][name] = {'duration': (len(frames) - 1) / FPS, 'loop': loop}
    for obj in imported:
        bpy.data.objects.remove(obj, do_unlink=True)
    for action in list(bpy.data.actions):
        if action.name.startswith('AnimalArmature') or action.name in {a for a, *_ in RETARGET.values()} or not action.users and not action.use_fake_user:
            if action not in actions.values():
                bpy.data.actions.remove(action)
    made, marks = made_clips(rig)
    for name, frames in made.items():
        loop = name == 'sit'
        actions[name] = key(rig, name, frames, loop)
        manifest['clips'][name] = {'duration': (len(frames) - 1) / FPS, 'loop': loop}
    manifest['clips']['walk']['speed'] = ground_speed(retargeted['walk'])
    manifest['clips']['run']['speed'] = ground_speed(retargeted['run'])
    (lift_off, touch_down), lift = airborne(retargeted['jump'])
    manifest['clips']['jump'].update({'takeoff': lift_off / FPS, 'landing': touch_down / FPS, 'lift': lift})
    manifest['clips']['pickup']['grab'] = marks['pickup']
    manifest['height'] = rig.get('height', 0.88)
    manifest['withers'] = rig.get('withers', 0.575)
    rig.animation_data.action = None
    for bone in rig.pose.bones:
        bone.matrix_basis = Matrix.Identity(4)

    TARGET.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=str(TARGET), compress=True)
    bpy.ops.object.select_all(action='DESELECT')
    for obj in [rig, *rig.children_recursive]:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = rig
    bpy.ops.export_scene.gltf(filepath=str(OUTPUT), export_format='GLB', use_selection=True, export_apply=True,
                              export_yup=True, export_extras=True, export_animations=True,
                              export_animation_mode='ACTIONS', export_force_sampling=True, export_cameras=False,
                              export_lights=False)
    MANIFEST.write_text(json.dumps(manifest, indent=2) + '\n')
    print(f'Canela rig: {OUTPUT} ({OUTPUT.stat().st_size} bytes)')
    print(json.dumps(manifest))
    if args.render:
        render(rig, actions)


if __name__ == '__main__':
    main()
