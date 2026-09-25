import argparse
import math
import sys
from pathlib import Path

import bpy
from mathutils import Matrix, Vector

sys.path.insert(0, str(Path(__file__).resolve().parent))
import rig_character_v1 as base

ROOT = Path(__file__).resolve().parents[2]
CLIPS = {f'{action}_{seat}': frames for seat in ['chair', 'bed'] for action, frames in [
    ('sit_down', 45), ('seated', 90), ('stand_up', 45), ('laptop_draw', 60), ('typing', 90), ('laptop_stow', 60)
]}


def smooth(value):
    value = max(0, min(1, value))
    return value*value*(3-2*value)


def solve_joint(start, end, length1, length2, direction):
    delta = end-start
    distance = min(delta.length, length1+length2-0.00001)
    axis = delta.normalized()
    along = (length1*length1-length2*length2+distance*distance)/(2*distance)
    bend = Vector(direction)
    bend = (bend-axis*bend.dot(axis)).normalized()
    return start+axis*along+bend*math.sqrt(max(0, length1*length1-along*along))


def matrices(definitions, clip, phase):
    seat = 'bed' if clip.endswith('_bed') else 'chair'
    action = clip.rsplit('_', 1)[0]
    rest = {name: base.matrix_between(head, tail) for name, (head, tail, _) in definitions.items()}
    seated = 1.0
    if action == 'sit_down':
        seated = smooth(phase)
    elif action == 'stand_up':
        seated = 1-smooth(phase)
    if seated <= 0.0000001:
        return rest
    hip_height = 0.70 if seat == 'bed' else 0.63
    offset = Vector((0, 0.34*seated, (hip_height-1.01)*seated))
    lean = 0.18*math.sin(seated*math.pi)
    laptop_progress = 1.0 if action == 'typing' else 0.0
    if action == 'laptop_draw':
        laptop_progress = smooth((phase-0.35)/0.5)
    elif action == 'laptop_stow':
        laptop_progress = 1-smooth((phase-0.15)/0.65)
    lean += 0.035*seated + 0.06*laptop_progress
    pivot = Vector((0, 0, 1.035))
    body = Matrix.Translation(offset) @ Matrix.Translation(pivot) @ Matrix.Rotation(lean, 4, 'X') @ Matrix.Translation(-pivot)
    output = {'root': rest['root']}
    for name in ['pelvis', 'spine', 'chest', 'neck', 'head']:
        output[name] = body @ rest[name]
    for side, label in [(-1, 'L'), (1, 'R')]:
        hip_rest, knee_rest, _ = definitions[f'thigh_{label}']
        _, ankle_rest, _ = definitions[f'shin_{label}']
        hip = body @ hip_rest
        ankle = Vector((side*0.151, 0.005-0.085*seated, 0.21))
        knee = base.knee_position(hip, ankle, (knee_rest-hip_rest).length, (ankle_rest-knee_rest).length)
        output[f'thigh_{label}'] = base.matrix_between(hip, knee)
        output[f'shin_{label}'] = base.matrix_between(knee, ankle)
        output[f'foot_{label}'] = rest[f'foot_{label}'].copy()
        output[f'foot_{label}'].translation = ankle
        shoulder_rest, elbow_rest, _ = definitions[f'upper_arm_{label}']
        _, wrist_rest, _ = definitions[f'forearm_{label}']
        shoulder = body @ shoulder_rest
        resting = Vector((side*0.30, 0.17, hip_height+0.15))
        working = Vector((side*0.11, 0.20 if seat == 'bed' else 0.06, 0.835 if seat == 'bed' else 0.858))
        wrist = (body @ wrist_rest).lerp(resting, seated)
        wrist = wrist.lerp(working, laptop_progress)
        if action in ['laptop_draw', 'laptop_stow']:
            p = phase if action == 'laptop_draw' else 1-phase
            reach = math.sin(math.pi*smooth(p/0.6)) if p < 0.6 else 0
            side_position = Vector((side*0.37, 0.28, hip_height+0.12))
            wrist = wrist.lerp(side_position, reach*(0.8 if side == 1 else 0.25))
        elbow = solve_joint(shoulder, wrist, (elbow_rest-shoulder_rest).length, (wrist_rest-elbow_rest).length, (side, 0.25, -0.2))
        output[f'clavicle_{label}'] = body @ rest[f'clavicle_{label}']
        output[f'upper_arm_{label}'] = base.matrix_between(shoulder, elbow)
        output[f'forearm_{label}'] = base.matrix_between(elbow, wrist)
        hand_transform = Matrix.Translation(wrist) @ Matrix.Rotation(-math.pi/2*seated, 4, 'X') @ Matrix.Translation(-wrist_rest)
        for name in [f'hand_{label}', f'thumb_{label}', *[f'finger_{label}_{i}' for i in range(4)]]:
            pose = hand_transform @ rest[name]
            if name.startswith('finger'):
                index = int(name[-1])
                typing = math.sin(phase*math.pi*8)*math.cos(index*1.9+(0 if side == 1 else math.pi)) if action == 'typing' else 0
                curl = laptop_progress*(0.22 + 0.09*typing)
                point = definitions[name][0]
                pose = hand_transform @ Matrix.Translation(point) @ Matrix.Rotation(curl, 4, 'X') @ Matrix.Translation(-point) @ rest[name]
            output[name] = pose
    return output


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--replace-generated-interactions', action='store_true')
    args = parser.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else [])
    target = ROOT / 'assets' / 'blender' / 'developer-v1-interactions.blend'
    if target.exists() and not args.replace_generated_interactions:
        raise RuntimeError('Interaction source exists; review before replacing generated interactions.')
    bpy.ops.wm.open_mainfile(filepath=str(ROOT / 'assets' / 'blender' / 'developer-v1-rig.blend'))
    rig = bpy.data.objects['DeveloperRig']
    definitions = {bone.name: (bone.head_local.copy(), bone.tail_local.copy(), bone.parent.name if bone.parent else None) for bone in rig.data.bones}
    base.CLIPS = CLIPS
    base.pose_matrices = matrices
    base.create_actions(rig, definitions)
    bpy.data.objects['Developer']['stage'] = '02B-seat-laptop'
    bpy.ops.wm.save_as_mainfile(filepath=str(target), compress=False)
    print(f'Independent interaction source: {target}')


if __name__ == '__main__':
    main()
