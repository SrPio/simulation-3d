"""Alternative V4 clips retargeted from Quaternius' Universal Animation Libraries (CC0).

Sources (CC0 1.0, models and animations by Quaternius), unzipped under assets/external/:
- UAL 1: https://opengameart.org/content/universal-animation-library (universal_animation_librarystandard.zip)
  into quaternius-ual/ual/: Walk_Loop, Jog_Fwd_Loop, Sprint_Loop, Jump_Start + Jump_Land.
- UAL 2: https://opengameart.org/content/universal-animation-library-2 (universal_animation_library_2standard.zip)
  into quaternius-ual2/ual/: OverhandThrow.
Both share the same mannequin (T-pose, facing -Y) with different bone names. Loops are in place and keep
their timing (resampled to 30 fps). One-shot clips chain source segments with crossfades and blend in from
and out to V4's own idle frame, so they start and end standing like the procedural jump. UAL's jump keeps
the hips level (a game engine lifts the root), so the clip adds a hop arc while both feet are off the floor.

Each mapped bone takes the source bone's world rotation change from its rest pose. Hips and ankles move by
the source offsets scaled to V4's leg length, the knees use the same analytic IK as the procedural clips,
the upper arm keeps off the hoodie (ARM_MIN_SPREAD), the shoes stay above the floor and the toe never tips
up. The trunk keeps part of the source lean and the fingers keep a procedural hand pose.

Adds every ALTERNATIVES clip to developer-v4-interactions.blend and its manifest; export it afterwards with
export_assets.py --variant v4-interactions --replace-generated. --render writes side and three-quarter
sheets per kind (the procedural clip first when there is one) to assets/renders/character-v4-ual/.
"""
import argparse
import json
import math
import sys
from pathlib import Path

import bpy
import numpy as np
from mathutils import Matrix, Quaternion, Vector

sys.path.insert(0, str(Path(__file__).resolve().parent))
import rig_character_v4 as rig

STANDING = rig.pose_matrices  # procedural poses; idle frame 0 is where one-shot clips start and end

ROOT = Path(__file__).resolve().parents[2]
EXTERNAL = ROOT / 'assets' / 'external'
TARGET = ROOT / 'assets' / 'blender' / 'developer-v4-interactions.blend'
MANIFEST = ROOT / 'public' / 'models' / 'developer-v4-interactions.manifest.json'
RENDERS = ROOT / 'assets' / 'renders' / 'character-v4-ual'
SOURCES = {
    'ual1': {
        'title': 'Quaternius Universal Animation Library',
        'path': EXTERNAL / 'quaternius-ual' / 'ual' / 'Animation Library[Standard]' / 'Godot' / 'AnimationLibrary_Godot_Standard.glb',
        'sides': ('L', 'R'),
        'bones': {'hips': 'DEF-hips', 'spine': 'DEF-spine.002', 'chest': 'DEF-spine.003', 'neck': 'DEF-neck', 'head': 'DEF-head',
                  'shoulder': 'DEF-shoulder.{}', 'upper_arm': 'DEF-upper_arm.{}', 'forearm': 'DEF-forearm.{}', 'hand': 'DEF-hand.{}',
                  'thigh': 'DEF-thigh.{}', 'foot': 'DEF-foot.{}'},
    },
    'ual2': {
        'title': 'Quaternius Universal Animation Library 2',
        'path': EXTERNAL / 'quaternius-ual2' / 'ual' / 'Universal Animation Library 2 [Standard]' / 'Unreal-Godot' / 'UAL2_Standard.glb',
        'sides': ('l', 'r'),
        'bones': {'hips': 'pelvis', 'spine': 'spine_02', 'chest': 'spine_03', 'neck': 'neck_01', 'head': 'Head',
                  'shoulder': 'clavicle_{}', 'upper_arm': 'upperarm_{}', 'forearm': 'lowerarm_{}', 'hand': 'hand_{}',
                  'thigh': 'thigh_{}', 'foot': 'foot_{}'},
    },
}
# Loops name one action; one-shot clips list (action, start, end) segments in source seconds, crossfaded
# by `fade`, with `pad` seconds of blending in from and out to V4's idle. 'crouch' scales how far the hips
# drop (the source's deep landing and lunge fold the hoodie and bring V4's large head down to the knees);
# 'air' gives the source times of take-off and touch-down, between which 'hop' metres of arc are added.
ALTERNATIVES = {
    'walk_ual': {'source': 'ual1', 'kind': 'walk', 'action': 'Walk_Loop'},
    'run_ual_jog': {'source': 'ual1', 'kind': 'run', 'action': 'Jog_Fwd_Loop'},
    'run_ual_sprint': {'source': 'ual1', 'kind': 'run', 'action': 'Sprint_Loop'},
    'jump_ual': {'source': 'ual1', 'kind': 'jump', 'segments': [('Jump_Start', 0.0, 0.40), ('Jump_Land', 0.0, 0.80)],
                 'fade': 0.12, 'pad': (0.12, 0.15), 'hop': 0.25, 'crouch': 0.55,
                 'air': (('Jump_Start', 0.07), ('Jump_Land', 0.09))},
    'throw_ual': {'source': 'ual2', 'kind': 'throw', 'segments': [('OverhandThrow', 0.0, 32 / 24)],
                  'fade': 0.0, 'pad': (0.20, 0.25), 'trunk': 1.25, 'crouch': 0.55, 'free_arms': True},
}
TRUNK = ('hips', 'spine', 'chest', 'neck', 'head')
TARGET_TRUNK = {'hips': 'pelvis', 'spine': 'spine', 'chest': 'chest', 'neck': 'neck', 'head': 'head'}
# Share of the source trunk rotation kept: the full forward lean folds V4's loose hoodie at the waist
# and drops the large head towards the floor. A clip's 'trunk' factor scales it (capped at 1).
TRUNK_FOLLOW = {'pelvis': 0.7, 'spine': 0.55, 'chest': 0.55, 'neck': 0.5, 'head': 0.45}
# Smallest angle between the upper arm and straight down, seen from the front (procedural: pi/2 - ARM_LOWER).
ARM_MIN_SPREAD = math.pi / 2 - rig.ARM_LOWER - 0.03
TOE_LIFT = 0.015
# Finger curl of the procedural clips: a loose hand walking, a fist running.
CURL = {'walk': 0.35, 'run': 0.55, 'jump': 0.35, 'throw': 0.45}
# The planted foot pivots fast; interpolating between the 30 fps keys sinks the sole ~1-2 cm, so keys keep this clearance.
SOLE_CLEARANCE = 0.012
JUMP_DISTANCE = rig.JUMP_DISTANCE


def bone(source, name, side=None):
    spec = SOURCES[source]
    pattern = spec['bones'][name]
    return pattern.format(spec['sides'][0] if side > 0 else spec['sides'][1]) if side is not None else pattern


def smooth(value):
    value = max(0.0, min(1.0, value))
    return value * value * (3 - 2 * value)


def blend_matrix(a, b, t):
    la, ra, _ = a.decompose()
    lb, rb, _ = b.decompose()
    return Matrix.LocRotScale(la.lerp(lb, t), ra.slerp(rb, t), None)


def import_source(source):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(SOURCES[source]['path']))
    armature = next(obj for obj in bpy.data.objects if obj.type == 'ARMATURE')
    for track in armature.animation_data.nla_tracks:
        track.mute = True
    return armature


def pose_at(armature, action_name, seconds):
    scene = bpy.context.scene
    animation = armature.animation_data
    action = bpy.data.actions[action_name]
    if animation.action != action:
        animation.action = action
        animation.action_slot = action.slots[0]
    frame = min(seconds * scene.render.fps / scene.render.fps_base, action.frame_range[1])
    scene.frame_set(int(frame), subframe=frame - int(frame))
    return {pb.name: armature.matrix_world @ pb.matrix for pb in armature.pose.bones}


def sample_loop(armature, spec):
    scene = bpy.context.scene
    action = bpy.data.actions[spec['action']]
    end = action.frame_range[1]
    duration = end / (scene.render.fps / scene.render.fps_base)
    frames = round(duration * rig.FPS)
    samples = []
    for i in range(frames + 1):
        samples.append(pose_at(armature, spec['action'], duration * (i % frames) / frames))
    return {'frames': frames, 'samples': samples, 'weights': [1.0] * (frames + 1)}


def sample_sequence(armature, spec):
    """Segments laid end to end with crossfades, padded with blends from and to the idle pose."""
    fade = spec['fade']
    pad_in, pad_out = spec['pad']
    starts, offset = [], pad_in
    for _, start, end in spec['segments']:
        starts.append(offset)
        offset += end - start - fade
    total = offset + fade + pad_out
    frames = round(total * rig.FPS)
    samples, weights = [], []
    segments = spec['segments']
    for i in range(frames + 1):
        t = total * i / frames
        # Clamp into the first/last segment while padding.
        local = [(k, t - starts[k]) for k in range(len(segments)) if 0 <= t - starts[k] <= segments[k][2] - segments[k][1]]
        if not local:
            local = [(0, 0.0)] if t < starts[0] else [(len(segments) - 1, segments[-1][2] - segments[-1][1])]
        poses = [(k, pose_at(armature, segments[k][0], segments[k][1] + u)) for k, u in local[:2]]
        sample = poses[0][1]
        if len(poses) == 2:
            mix = smooth((t - starts[poses[1][0]]) / fade)
            sample = {name: blend_matrix(matrix, poses[1][1][name], mix) for name, matrix in sample.items()}
        samples.append(sample)
        weights.append(smooth(t / pad_in) if t < pad_in else smooth((total - t) / pad_out) if t > total - pad_out else 1.0)
    clip = {'frames': frames, 'samples': samples, 'weights': weights}
    if 'air' in spec:
        names = [segment[0] for segment in segments]
        clip['air'] = tuple(round((starts[names.index(action)] + t - segments[names.index(action)][1]) / total * frames)
                            for action, t in spec['air'])
    return clip


def sample_sources():
    """Rest matrices per source and sampled world matrices of every alternative clip."""
    rests, clips = {}, {}
    for source in SOURCES:
        wanted = {clip: spec for clip, spec in ALTERNATIVES.items() if spec['source'] == source}
        if not wanted:
            continue
        armature = import_source(source)
        rests[source] = {b.name: armature.matrix_world @ b.matrix_local for b in armature.data.bones}
        for clip, spec in wanted.items():
            data = sample_loop(armature, spec) if 'action' in spec else sample_sequence(armature, spec)
            clips[clip] = {**spec, **data}
    return rests, clips


def ground_speed(clip, scale):
    """In-place loops: the planted foot slides back at the ground speed."""
    speeds = []
    for side in (-1, 1):
        name = bone(clip['source'], 'foot', side)
        floor = min(sample[name].translation.z for sample in clip['samples'])
        for a, b in zip(clip['samples'], clip['samples'][1:]):
            if a[name].translation.z < floor + 0.05 and b[name].translation.z < floor + 0.05:
                speeds.append((b[name].translation.y - a[name].translation.y) * rig.FPS)
    return scale * sum(speeds) / len(speeds)


def shoe_points(armature):
    points = {}
    to_rig = armature.matrix_world.inverted()
    for obj in armature.children:
        if obj.type == 'MESH' and obj.name.startswith('Shoe'):
            label = 'R' if '_R' in obj.name else 'L'
            matrix = to_rig @ obj.matrix_world
            points.setdefault(label, []).extend(matrix @ v.co for v in obj.data.vertices)
    return points


def make_pose(defs, src_rest, clip, scale, shoes):
    rest = {name: rig.matrix_between(h, t, rig.bone_hinge(name)) for name, (h, t, _) in defs.items()}
    head_of = {name: h for name, (h, _, _) in defs.items()}
    source = clip['source']
    curl = CURL[clip['kind']]
    trunk_scale = clip.get('trunk', 1.0)
    idle = STANDING(defs, 'idle', 0.0)
    hop = None
    crouch = clip.get('crouch', 1.0)
    if 'hop' in clip:
        first, last = clip['air']
        hop = lambda i: clip['hop'] * math.sin(math.pi * (i - first) / (last - first)) if first < i < last else 0.0

    def pose(defs_, name_, phase):
        index = round(phase * clip['frames'])
        sample = clip['samples'][index]
        lift = Vector((0, 0, hop(index) if hop else 0.0))
        out = {'root': rest['root']}

        def turn(src, follow=1.0):
            rotation = sample[src].to_quaternion() @ src_rest[src].to_quaternion().inverted()
            return Quaternion().slerp(rotation, min(1.0, follow)).to_matrix().to_4x4()

        def place(name, src, parent=None, head=None, extra=None):
            head = parent @ head_of[name] if head is None else head
            follow = TRUNK_FOLLOW[name] * trunk_scale if name in TRUNK_FOLLOW else 1.0
            transform = Matrix.Translation(head) @ turn(src, follow) @ Matrix.Translation(-head_of[name])
            if extra is not None:
                transform = extra @ transform
            out[name] = transform @ rest[name]
            return transform

        hips = bone(source, 'hips')
        drop = scale * (sample[hips].translation - src_rest[hips].translation)
        if drop.z < 0:
            drop.z *= crouch
        body = place('pelvis', hips, head=head_of['pelvis'] + drop + lift)
        spine = place('spine', bone(source, 'spine'), body)
        chest = place('chest', bone(source, 'chest'), spine)
        neck = place('neck', bone(source, 'neck'), chest)
        place('head', bone(source, 'head'), neck)
        for side, label in ((-1, 'L'), (1, 'R')):
            clavicle = place(f'clavicle_{label}', bone(source, 'shoulder', side), chest)
            upper = place(f'upper_arm_{label}', bone(source, 'upper_arm', side), clavicle)
            shoulder_rest, elbow_rest, _ = defs[f'upper_arm_{label}']
            arm = (upper.to_3x3() @ (elbow_rest - shoulder_rest)).normalized()
            spread = math.atan2(side * arm.x, -arm.z)
            # Throwing arms swing across the body; only push them out while they hang down by the hoodie.
            reach = max(0.0, -arm.z) ** 2 if clip.get('free_arms') else 1.0
            if spread < ARM_MIN_SPREAD and reach > 0:
                shoulder = upper @ shoulder_rest
                upper = place(f'upper_arm_{label}', bone(source, 'upper_arm', side), clavicle,
                              extra=rig.rot_about(shoulder, rig.ry(-side * (ARM_MIN_SPREAD - spread) * reach)))
            fore = place(f'forearm_{label}', bone(source, 'forearm', side), upper)
            hand = place(f'hand_{label}', bone(source, 'hand', side), fore)
            for i in range(len(rig.FINGERS)):
                name = f'finger_{label}_{i}'
                out[name] = hand @ rig.rot_about(head_of[name], rig.ry(side * curl * (0.85 + 0.1 * i))) @ rest[name]
            out[f'thumb_{label}'] = hand @ rig.rot_about(head_of[f'thumb_{label}'], rig.rz(side * 0.25)) @ rest[f'thumb_{label}']
            # Legs: scaled ankle path, foot turned like the source, then knee IK.
            hip_rest, knee_rest, _ = defs[f'thigh_{label}']
            _, ankle_rest, _ = defs[f'shin_{label}']
            foot_head, foot_tail, _ = defs[f'foot_{label}']
            src_foot = bone(source, 'foot', side)
            ankle = ankle_rest + scale * (sample[src_foot].translation - src_rest[src_foot].translation) + lift
            foot_turn = turn(src_foot)
            along = (foot_turn.to_3x3() @ (foot_tail - foot_head)).normalized()
            rest_along = (foot_tail - foot_head).normalized()
            if along.z - rest_along.z > TOE_LIFT:
                axis = along.cross(Vector((0, 0, 1))).normalized()
                angle = math.asin(along.z) - math.asin(rest_along.z + TOE_LIFT)
                foot_turn = Matrix.Rotation(-angle, 4, axis) @ foot_turn
            foot = Matrix.Translation(ankle) @ foot_turn @ Matrix.Translation(-ankle_rest)
            lowest = min((foot @ point).z for point in shoes[label])
            if lowest < SOLE_CLEARANCE:
                ankle.z += SOLE_CLEARANCE - lowest
                foot = Matrix.Translation((0, 0, SOLE_CLEARANCE - lowest)) @ foot
            hip = body @ hip_rest
            knee = rig.knee_position(hip, ankle, (knee_rest - hip_rest).length, (ankle_rest - knee_rest).length)
            out[f'thigh_{label}'] = rig.matrix_between(hip, knee, (1, 0, 0))
            out[f'shin_{label}'] = rig.matrix_between(knee, ankle, (1, 0, 0))
            out[f'foot_{label}'] = foot @ rest[f'foot_{label}']
        weight = clip['weights'][index]
        if weight < 1:
            out = {name: blend_matrix(idle[name], matrix, weight) for name, matrix in out.items()}
        return out

    return pose


def remove_previous(armature):
    animation = armature.animation_data
    for track in list(animation.nla_tracks):
        if track.name in ALTERNATIVES:
            animation.nla_tracks.remove(track)
    for clip in ALTERNATIVES:
        if clip in bpy.data.actions:
            bpy.data.actions.remove(bpy.data.actions[clip])


def render_sheets(armature):
    from render_character_v4 import frame, load_pixels, save_pixels, studio
    for track in armature.animation_data.nla_tracks:
        track.mute = True
    empty, camera = studio()
    scene = bpy.context.scene
    scene.cycles.samples = 12
    scene.render.resolution_x, scene.render.resolution_y = 300, 420
    RENDERS.mkdir(parents=True, exist_ok=True)
    for kind in CURL:
        names = [name for name, spec in ALTERNATIVES.items() if spec['kind'] == kind]
        clips = ([kind] if kind in bpy.data.actions else []) + names
        count = 6 if kind in ('walk', 'run') else 8
        for view in ('left', 'three-quarter'):
            rows = []
            for clip in clips:
                action = bpy.data.actions[clip]
                armature.animation_data.action = action
                armature.animation_data.action_slot = action.slots[0]
                end = int(action.frame_range[1])
                row = []
                for k in range(count):
                    frame(camera, empty, view)
                    scene.frame_set(round(end * k / count) if kind in ('walk', 'run') else round(end * (k + 0.5) / count))
                    path = Path(bpy.app.tempdir) / f'{clip}-{k}.png'
                    scene.render.filepath = str(path)
                    bpy.ops.render.render(write_still=True)
                    row.append(load_pixels(path))
                rows.append(np.concatenate(row, axis=1))
            save_pixels(np.concatenate(rows, axis=0), RENDERS / f'{kind}-{view}.png')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--replace-generated', action='store_true')
    parser.add_argument('--render', action='store_true')
    args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else [])
    if not args.replace_generated:
        raise RuntimeError('This adds clips to the existing V4 interactions blend; rerun with --replace-generated.')
    for spec in SOURCES.values():
        if not spec['path'].exists():
            raise RuntimeError(f'Missing {spec["path"]}: unzip the library there first (see the module docstring).')
    rests, clips = sample_sources()
    bpy.ops.wm.open_mainfile(filepath=str(TARGET))
    armature = bpy.data.objects['DeveloperRig']
    defs = {b.name: (b.head_local.copy(), b.tail_local.copy(), b.parent.name if b.parent else None) for b in armature.data.bones}
    shoes = shoe_points(armature)
    remove_previous(armature)
    entries = []
    for clip, data in clips.items():
        src_rest = rests[data['source']]
        # Scale source offsets by leg length (hip joint to ankle).
        src_leg = (src_rest[bone(data['source'], 'thigh', 1)].translation - src_rest[bone(data['source'], 'foot', 1)].translation).length
        scale = (defs['thigh_R'][0] - defs['shin_R'][1]).length / src_leg
        rig.CLIPS = {clip: data['frames']}
        rig.pose_matrices = make_pose(defs, src_rest, data, scale, shoes)
        rig.create_actions(armature, defs)
        actions = data.get('action') or ' + '.join(segment[0] for segment in data['segments'])
        entry = {'name': clip, 'duration': data['frames'] / rig.FPS, 'loop': 'action' in data,
                 'source': f'{SOURCES[data["source"]]["title"]} · {actions} (CC0)'}
        if data['kind'] in ('walk', 'run'):
            entry['speed'] = ground_speed(data, scale)
        if data['kind'] == 'jump':
            first, last = data['air']
            entry.update({'speed': 0, 'distance': JUMP_DISTANCE, 'air': [first / data['frames'], last / data['frames']]})
        entries.append(entry)
        print(f'{clip}: {data["frames"]} frames, {json.dumps({k: v for k, v in entry.items() if k in ("speed", "air")})}')
    clip_names = [name for name in armature.get('clips', '').split(',') if name and name not in ALTERNATIVES]
    armature['clips'] = ','.join([*clip_names, *ALTERNATIVES])
    bpy.ops.wm.save_as_mainfile(filepath=str(TARGET), compress=True)
    manifest = json.loads(MANIFEST.read_text(encoding='utf-8'))
    manifest['clips'] = [clip for clip in manifest['clips'] if clip['name'] not in ALTERNATIVES] + entries
    MANIFEST.write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8')
    print(f'V4 UAL clips: {TARGET}')
    if args.render:
        render_sheets(armature)


if __name__ == '__main__':
    main()
