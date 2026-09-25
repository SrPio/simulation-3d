import argparse
import json
import math
import re
import sys
from pathlib import Path

import bpy
from mathutils import Matrix, Vector

ROOT = Path(__file__).resolve().parents[2]
CLIPS = {'idle': 90, 'walk': 30, 'run': 20}


def matrix_between(a, b):
    a, b = Vector(a), Vector(b)
    return Matrix.Translation(a) @ (b-a).to_track_quat('Y', 'Z').to_matrix().to_4x4()


def build_rig():
    root = bpy.data.objects['Developer']
    bpy.ops.object.select_all(action='DESELECT')
    objects = [obj for obj in root.children_recursive if obj.type in {'CURVE', 'MESH'}]
    for obj in objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    bpy.ops.object.convert(target='MESH')
    objects = list(bpy.context.selected_objects)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    bpy.ops.object.select_all(action='DESELECT')
    armature = bpy.data.armatures.new('DeveloperSkeleton')
    rig = bpy.data.objects.new('DeveloperRig', armature)
    bpy.context.collection.objects.link(rig)
    rig.parent = root
    rig.show_in_front = True
    bpy.context.view_layer.objects.active = rig
    rig.select_set(True)
    bpy.ops.object.mode_set(mode='EDIT')
    definitions = {}
    def bone(name, head, tail, parent=None):
        item = armature.edit_bones.new(name)
        item.head, item.tail = head, tail
        item.matrix = matrix_between(head, tail)
        item.length = (Vector(tail)-Vector(head)).length
        if parent:
            item.parent = armature.edit_bones[parent]
        definitions[name] = (Vector(head), Vector(tail), parent)
    bone('root', (0, 0, 0), (0, 0, 0.2))
    bone('pelvis', (0, 0, 1.035), (0, 0, 1.14), 'root')
    bone('spine', (0, 0, 1.14), (0, 0, 1.38), 'pelvis')
    bone('chest', (0, 0, 1.38), (0, 0.01, 1.585), 'spine')
    bone('neck', (0, 0.01, 1.585), (0, 0.01, 1.74), 'chest')
    bone('head', (0, 0.01, 1.74), (0, 0.01, 2.42), 'neck')
    for side, label in [(-1, 'L'), (1, 'R')]:
        shoulder = (side*0.28, 0.015, 1.52)
        elbow = (side*0.377, -0.005, 1.292)
        wrist = (side*0.452, -0.045, 1.07)
        palm = (side*0.474, -0.057, 0.969)
        bone(f'clavicle_{label}', (0, 0.01, 1.56), shoulder, 'chest')
        bone(f'upper_arm_{label}', shoulder, elbow, f'clavicle_{label}')
        bone(f'forearm_{label}', elbow, wrist, f'upper_arm_{label}')
        bone(f'hand_{label}', wrist, palm, f'forearm_{label}')
        for finger in range(4):
            x = side*(0.429+finger*0.026)
            bone(f'finger_{label}_{finger}', (x, -0.058, 0.981),
                 (x+side*0.006, -0.067, 0.899+abs(finger-1.5)*0.009), f'hand_{label}')
        bone(f'thumb_{label}', (side*0.415, -0.06, 1.015), (side*0.392, -0.088, 0.958), f'hand_{label}')
        bone(f'thigh_{label}', (side*0.151, 0.02, 1.01), (side*0.151, 0.005, 0.59), 'pelvis')
        bone(f'shin_{label}', (side*0.151, 0.005, 0.59), (side*0.151, 0.005, 0.21), f'thigh_{label}')
        bone(f'foot_{label}', (side*0.151, 0.005, 0.21), (side*0.151, -0.16, 0.105), f'shin_{label}')
    bpy.ops.object.mode_set(mode='OBJECT')
    for obj in objects:
        bind_mesh(obj, rig)
    rig['clips'] = 'idle,walk,run'
    rig['locomotion'] = 'in-place'
    root['stage'] = '02A-v1-rig'
    return rig, definitions


def blend(z, low, high, lower, upper):
    t = max(0, min(1, (z-low)/(high-low)))
    t = t*t*(3-2*t)
    return {lower: 1-t, upper: t}


def bind_mesh(obj, rig):
    label_match = re.search(r'_(L|R)(?:_|$)', obj.name)
    label = label_match.group(1) if label_match else None
    names = {}
    for vertex in obj.data.vertices:
        z = vertex.co.z
        if obj.name.startswith('Sleeve_'):
            weights = blend(z, 1.245, 1.34, f'forearm_{label}', f'upper_arm_{label}')
            if z > 1.515:
                weights = blend(z, 1.515, 1.625, f'upper_arm_{label}', 'chest')
        elif obj.name.startswith('Cuff_'):
            weights = {f'forearm_{label}': 1}
        elif obj.name.startswith('Palm_'):
            weights = {f'hand_{label}': 1}
        elif obj.name.startswith('Finger_'):
            weights = {f'finger_{label}_{obj.name.split("_")[-1]}': 1}
        elif obj.name.startswith('Thumb_'):
            weights = {f'thumb_{label}': 1}
        elif obj.name.startswith('TrouserLeg_'):
            weights = blend(z, 0.52, 0.66, f'shin_{label}', f'thigh_{label}')
            if z > 0.91:
                weights = blend(z, 0.91, 1.1, f'thigh_{label}', 'pelvis')
        elif obj.name.startswith(('Shoe', 'Lace')):
            weights = {f'foot_{label}': 1}
        elif obj.name in {'SweatshirtBody', 'HoodieHem', 'KangarooPocket', 'HoodBack', 'HoodOpening'}:
            weights = blend(z, 1.08, 1.25, 'pelvis', 'spine') if z < 1.25 else blend(z, 1.25, 1.52, 'spine', 'chest')
        elif obj.name == 'Neck':
            weights = blend(z, 1.60, 1.73, 'neck', 'head')
        else:
            weights = {'head': 1}
        for name, weight in weights.items():
            if weight < 0.00001:
                continue
            if name not in names:
                names[name] = obj.vertex_groups.new(name=name)
            names[name].add([vertex.index], weight, 'REPLACE')
    modifier = obj.modifiers.new('Skin', 'ARMATURE')
    modifier.object = rig
    modifier.use_deform_preserve_volume = False
    obj.parent = rig
    obj.matrix_parent_inverse = Matrix.Identity(4)


def knee_position(hip, ankle, length1, length2):
    delta = ankle-hip
    distance = min(delta.length, length1+length2-0.00001)
    axis = delta.normalized()
    along = (length1*length1-length2*length2+distance*distance)/(2*distance)
    bend = Vector((0, -1, 0))
    bend = (bend-axis*bend.dot(axis)).normalized()
    return hip+axis*along+bend*math.sqrt(max(0, length1*length1-along*along))


def pose_matrices(definitions, clip, phase):
    phase = phase % 1
    wave = phase*math.pi*2
    rest = {name: matrix_between(head, tail) for name, (head, tail, _) in definitions.items()}
    if clip == 'idle':
        output = dict(rest)
        for name in ['spine', 'chest', 'neck', 'head']:
            pivot = Vector((0, 0, 1.14))
            breathe = Matrix.Translation(pivot) @ Matrix.Rotation(0.007*math.sin(wave), 4, 'X') @ Matrix.Translation(-pivot)
            output[name] = breathe @ rest[name]
        for label in ['L', 'R']:
            for name in [f'clavicle_{label}', f'upper_arm_{label}', f'forearm_{label}', f'hand_{label}', f'thumb_{label}', *[f'finger_{label}_{i}' for i in range(4)]]:
                output[name] = breathe @ rest[name]
        return output
    running = clip == 'run'
    lift = 0.16 if running else 0.065
    stride = 0.54 if running else 0.42
    stance = 0.38 if running else 0.60
    bob = (-0.08+0.020*math.cos(2*wave)) if running else (-0.045+0.009*math.cos(2*wave))
    lean = 0.15 if running else 0.035
    pivot = Vector((0, 0, 1.035))
    body = Matrix.Translation((0, 0, bob)) @ Matrix.Translation(pivot) @ Matrix.Rotation(lean, 4, 'X') @ Matrix.Rotation(0.017*math.sin(wave), 4, 'Y') @ Matrix.Translation(-pivot)
    output = {'root': rest['root']}
    for name in ['pelvis', 'spine', 'chest', 'neck', 'head']:
        output[name] = body @ rest[name]
    for side, label, shift in [(-1, 'L', 0), (1, 'R', 0.5)]:
        t = (phase+shift) % 1
        foot_y = -stride/2+stride*t/stance if t <= stance else stride/2-stride*(t-stance)/(1-stance)
        foot_z = 0 if t <= stance else lift*math.sin(math.pi*(t-stance)/(1-stance))**1.2
        hip_rest, knee_rest, _ = definitions[f'thigh_{label}']
        _, ankle_rest, _ = definitions[f'shin_{label}']
        hip = body @ hip_rest
        ankle = Vector((side*0.151, 0.005+foot_y, 0.21+foot_z))
        knee = knee_position(hip, ankle, (knee_rest-hip_rest).length, (ankle_rest-knee_rest).length)
        output[f'thigh_{label}'] = matrix_between(hip, knee)
        output[f'shin_{label}'] = matrix_between(knee, ankle)
        foot_matrix = rest[f'foot_{label}'].copy()
        foot_matrix.translation = ankle
        output[f'foot_{label}'] = foot_matrix
        shoulder_rest, elbow_rest, _ = definitions[f'upper_arm_{label}']
        _, wrist_rest, _ = definitions[f'forearm_{label}']
        shoulder = body @ shoulder_rest
        swing = (0.60 if running else 0.28)*math.cos(wave+shift*2*math.pi)
        flex = (1.0 if running else 0.18) + 0.07*math.sin(wave+shift*2*math.pi)
        upper_rotation = body.to_3x3() @ Matrix.Rotation(swing, 3, 'X')
        lower_rotation = body.to_3x3() @ Matrix.Rotation(swing-flex, 3, 'X')
        elbow = shoulder+upper_rotation @ (elbow_rest-shoulder_rest)
        wrist = elbow+lower_rotation @ (wrist_rest-elbow_rest)
        output[f'clavicle_{label}'] = body @ rest[f'clavicle_{label}']
        output[f'upper_arm_{label}'] = matrix_between(shoulder, elbow)
        output[f'forearm_{label}'] = matrix_between(elbow, wrist)
        hand_transform = Matrix.Translation(wrist) @ lower_rotation.to_4x4() @ Matrix.Translation(-wrist_rest)
        for name in [f'hand_{label}', f'thumb_{label}', *[f'finger_{label}_{i}' for i in range(4)]]:
            output[name] = hand_transform @ rest[name]
    return output


def create_actions(rig, definitions):
    animation = rig.animation_data_create()
    rest = {bone.name: bone.matrix_local.copy() for bone in rig.data.bones}
    for name, frame_count in CLIPS.items():
        action = bpy.data.actions.new(name)
        slot = action.slots.new(id_type='OBJECT', name=rig.name)
        bag = action.layers.new('Pose').strips.new(type='KEYFRAME').channelbag(slot, ensure=True)
        values = {bone: {'location': [], 'rotation_quaternion': []} for bone in definitions}
        previous = {}
        for frame in range(frame_count+1):
            pose = pose_matrices(definitions, name, frame/frame_count)
            for bone_name, (_, _, parent) in definitions.items():
                basis = rest[bone_name].inverted() @ rest[parent] @ pose[parent].inverted() @ pose[bone_name] if parent else rest[bone_name].inverted() @ pose[bone_name]
                location, rotation, _ = basis.decompose()
                if bone_name in previous and previous[bone_name].dot(rotation) < 0:
                    rotation.negate()
                previous[bone_name] = rotation.copy()
                values[bone_name]['location'].append(tuple(location))
                values[bone_name]['rotation_quaternion'].append(tuple(rotation))
        for bone_name, channels in values.items():
            rig.pose.bones[bone_name].rotation_mode = 'QUATERNION'
            for channel, samples in channels.items():
                for index in range(len(samples[0])):
                    fcurve = bag.fcurves.new(data_path=f'pose.bones["{bone_name}"].{channel}', index=index)
                    fcurve.keyframe_points.add(frame_count+1)
                    fcurve.keyframe_points.foreach_set('co', [component for frame, sample in enumerate(samples) for component in (frame, sample[index])])
                    for key in fcurve.keyframe_points:
                        key.interpolation = 'LINEAR'
        animation.action = action
        animation.action_slot = slot
        track = animation.nla_tracks.new()
        track.name = name
        strip = track.strips.new(name, 0, action)
        strip.action_slot = slot
        track.mute = True
        action.use_fake_user = True
    animation.action = None
    for bone in rig.pose.bones:
        bone.matrix_basis = Matrix.Identity(4)
    bpy.context.scene.frame_set(0)
    bpy.context.view_layer.update()


def render_reviews(rig, destination):
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    from render_character_views import studio, aim
    camera, _, _, _, _ = studio()
    camera.location = (4, -6, 3.2)
    aim(camera, (0, 0, 1.29))
    destination.mkdir(parents=True, exist_ok=True)
    for clip in CLIPS:
        action = bpy.data.actions[clip]
        rig.animation_data.action = action
        rig.animation_data.action_slot = action.slots[0]
        bpy.context.scene.frame_set(0 if clip == 'idle' else round(CLIPS[clip]*0.15))
        bpy.context.scene.render.filepath = str(destination / f'{clip}.png')
        bpy.ops.render.render(write_still=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--replace-generated-rig', action='store_true')
    parser.add_argument('--render', action='store_true')
    args = parser.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else [])
    target = ROOT / 'assets' / 'blender' / 'developer-v1-rig.blend'
    if target.exists() and not args.replace_generated_rig:
        raise RuntimeError('Rig output already exists. Review before using --replace-generated-rig.')
    bpy.ops.wm.open_mainfile(filepath=str(ROOT / 'assets' / 'blender' / 'developer.blend'))
    rig, definitions = build_rig()
    bpy.context.scene.render.fps = 30
    create_actions(rig, definitions)
    bpy.ops.wm.save_as_mainfile(filepath=str(target), compress=False)
    manifest = {'source': 'developer-v1-rig.glb', 'fps': 30, 'inPlace': True, 'clips': [
        {'name': name, 'duration': frames/30, 'loop': True,
         'speed': 0 if name == 'idle' else (0.7 if name == 'walk' else 0.54/(0.38*(20/30)))} for name, frames in CLIPS.items()
    ]}
    path = ROOT / 'public' / 'models' / 'developer-v1-rig.manifest.json'
    path.write_text(json.dumps(manifest, indent=2)+'\n', encoding='utf-8')
    print(f'Rig saved: {target}')
    if args.render:
        render_reviews(rig, ROOT / 'assets' / 'renders' / 'character-v1-rig')


if __name__ == '__main__':
    main()
