"""Phase 2B for V4: sitting on the room's chair/bed and using the laptop.

Adds twelve clips to a copy of the V4 rig (idle/walk/run are kept):
sit_down, seated, stand_up, laptop_draw, typing and laptop_stow, each for chair and bed.
Clip origin = the standing spot in front of the seat, facing the character's forward (-Y).
The hips travel `stand_offset` meters back onto the seat; the room exports the same offset on its
seat anchors so the viewer can place the character. Laptop positions match the room anchors.
"""
import argparse
import json
import math
import sys
from pathlib import Path

import bpy
from mathutils import Matrix, Vector

sys.path.insert(0, str(Path(__file__).resolve().parent))
import rig_character_v4 as rig

STANDING = rig.pose_matrices  # idle/walk/run poses; also the standing frame the seat clips blend from

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / 'assets' / 'blender' / 'developer-v4-rig.blend'
TARGET = ROOT / 'assets' / 'blender' / 'developer-v4-interactions.blend'
MANIFEST = ROOT / 'public' / 'models' / 'developer-v4-interactions.manifest.json'
ACTIONS = {'sit_down': 45, 'seated': 90, 'stand_up': 45, 'laptop_draw': 60, 'typing': 90, 'laptop_stow': 60}
CLIPS = {f'{action}_{seat}': frames for seat in ('chair', 'bed') for action, frames in ACTIONS.items()}
LOOPING = {'seated', 'typing'}
EVENTS = {'laptop_draw': {'take': 0.25, 'open': 0.7}, 'laptop_stow': {'close': 0.3, 'store': 0.75},
          'sit_down': {'seated': 1.0}, 'stand_up': {'standing': 1.0}}
# Character-local targets (meters; forward is -Y). Hip = thigh joint height when seated.
# 'type' is the wrist over the laptop keys: V4's hand reaches ~0.29 m past the wrist, so the wrist
# stays back from the hinge and high enough for level fingertips to rest on the keys.
SEATS = {
    'chair': {'back': 0.20, 'hip': 0.72, 'ankle_y': -0.10, 'lean': 0.05, 'type_lean': 0.12,
              'reach': (0.19, -0.44, 1.17), 'type': (0.11, -0.33, 1.185), 'palm': (0.0, -1.0, -0.05)},
    'bed': {'back': 0.25, 'hip': 0.72, 'ankle_y': -0.08, 'lean': 0.06, 'type_lean': 0.16,
            'reach': (0.42, 0.33, 0.70), 'type': (0.11, 0.0, 0.99), 'palm': (0.0, -1.0, -0.1)},
}
# Resting hands lie along the top of each thigh: seated, the thigh's front-to-back depth (~0.17 m)
# points up, so the wrist sits this far above the thigh axis, a quarter of the way to the knee.
THIGH_TOP = 0.21
THIGH_FRACTION = 0.25


def smooth(value):
    value = max(0.0, min(1.0, value))
    return value * value * (3 - 2 * value)


def blend(a, b, t):
    la, ra, _ = a.decompose()
    lb, rb, _ = b.decompose()
    return Matrix.LocRotScale(la.lerp(lb, t), ra.slerp(rb, t), None)


def solve_elbow(start, end, l1, l2, pole):
    delta = end - start
    distance = min(delta.length, l1 + l2 - 1e-5)
    axis = delta.normalized()
    along = (l1 * l1 - l2 * l2 + distance * distance) / (2 * distance)
    bend = Vector(pole)
    bend = (bend - axis * bend.dot(axis)).normalized()
    return start + axis * along + bend * math.sqrt(max(0.0, l1 * l1 - along * along))


def aim(parent, head_rest, tail_rest, head, tail):
    """Rigid transform that carries a bone (already moved by `parent`) onto head->tail with minimal twist."""
    current_head = parent @ head_rest
    current_dir = parent.to_3x3() @ (tail_rest - head_rest)
    turn = current_dir.rotation_difference(tail - head).to_matrix().to_4x4()
    return Matrix.Translation(head) @ turn @ Matrix.Translation(-current_head) @ parent


def hand_basis(side, forward, head_rest, tail_rest, wrist):
    """Absolute hand transform: fingers along `forward`, palm facing down."""
    f1 = (tail_rest - head_rest).normalized()
    n1 = Vector((0, 0, -1))
    f2 = Vector(forward).normalized()
    n2 = (n1 - f2 * n1.dot(f2)).normalized()
    m1 = Matrix((f1, n1, f1.cross(n1))).transposed()
    m2 = Matrix((f2, n2, f2.cross(n2))).transposed()
    return Matrix.Translation(wrist) @ (m2 @ m1.inverted()).to_4x4() @ Matrix.Translation(-head_rest)


def laptop_amount(action, phase):
    """0 = hands resting, 1 = hands on the keyboard, plus how far the hands are out reaching."""
    if action == 'typing':
        return 1.0, 0.0
    if action in ('laptop_draw', 'laptop_stow'):
        p = phase if action == 'laptop_draw' else 1 - phase
        reach = math.sin(math.pi * smooth(p / 0.55)) if p < 0.55 else 0.0
        return smooth((p - 0.4) / 0.5), reach
    return 0.0, 0.0


def pose(defs, clip, phase):
    action, seat = clip.rsplit('_', 1)
    cfg = SEATS[seat]
    wave = 2 * math.pi * phase
    rest = {name: rig.matrix_between(h, t, rig.bone_hinge(name)) for name, (h, t, _) in defs.items()}
    head_of = {name: h for name, (h, _, _) in defs.items()}
    standing = STANDING(defs, 'idle', 0.0)
    s = smooth(phase) if action == 'sit_down' else (1 - smooth(phase) if action == 'stand_up' else 1.0)
    work, reach = laptop_amount(action, phase)
    breathe = 0.012 * math.sin(2 * wave) if action in LOOPING else 0.0
    # Hips go back first, then down, with a forward lean that peaks mid-transition.
    offset = Vector((0, cfg['back'] * s ** 0.7, (cfg['hip'] - 1.0) * s ** 1.3))
    lean = 0.32 * math.sin(math.pi * s) * (1 if action in ('sit_down', 'stand_up') else 0) + cfg['lean'] * s
    lean += cfg['type_lean'] * work
    body = Matrix.Translation(offset) @ rig.rot_about(head_of['pelvis'], rig.rx(lean))
    chest = body @ rig.rot_about(head_of['chest'], rig.rx(breathe + 0.08 * work))
    look = 0.14 * work + 0.05 * s + 0.02 * math.sin(wave) * (action == 'typing')
    head = chest @ rig.rot_about(head_of['neck'], rig.rx(look) @ rig.rz(0.04 * math.sin(wave) * (action in LOOPING)))
    out = {'root': rest['root'], 'pelvis': body @ rest['pelvis'], 'spine': body @ rest['spine'],
           'chest': chest @ rest['chest'], 'neck': chest @ rest['neck'], 'head': head @ rest['head']}
    for side, label in ((-1, 'L'), (1, 'R')):
        # Legs: analytic knee IK from the moved hip to the planted ankle, feet flat.
        hip_rest, knee_rest, _ = defs[f'thigh_{label}']
        _, ankle_rest, _ = defs[f'shin_{label}']
        hip = body @ hip_rest
        ankle = ankle_rest.lerp(Vector((ankle_rest.x, cfg['ankle_y'], ankle_rest.z)), s)
        knee = rig.knee_position(hip, ankle, (knee_rest - hip_rest).length, (ankle_rest - knee_rest).length)
        out[f'thigh_{label}'] = rig.matrix_between(hip, knee, (1, 0, 0))
        out[f'shin_{label}'] = rig.matrix_between(knee, ankle, (1, 0, 0))
        out[f'foot_{label}'] = Matrix.Translation(ankle - ankle_rest) @ rest[f'foot_{label}']
        # Arms: two-bone IK to the seated/laptop wrist target, blended from the standing idle arms.
        clav = chest @ rig.rot_about(head_of[f'clavicle_{label}'], rig.ry(side * 0.10))
        shoulder_rest, elbow_rest, _ = defs[f'upper_arm_{label}']
        _, wrist_rest, _ = defs[f'forearm_{label}']
        hand_head, hand_tail, _ = defs[f'hand_{label}']
        shoulder = clav @ shoulder_rest
        mirror = Vector((side, 1, 1))
        along = (knee - hip).normalized()
        up = (Vector((0, 0, 1)) - along * along.z).normalized()
        rest_wrist = hip.lerp(knee, THIGH_FRACTION) + up * THIGH_TOP
        rest_wrist.x = hip.x * 1.12
        typing = Vector(cfg['type']) * mirror
        wiggle = Vector((0, 0.008 * math.sin(wave * 6 + side), 0.006 * math.sin(wave * 9 + side * 2))) if action == 'typing' else Vector()
        wrist = rest_wrist.lerp(typing + wiggle, work)
        if reach:
            target = Vector(cfg['reach']) * mirror
            wrist = wrist.lerp(target, reach * (1.0 if (seat == 'chair' or side == 1) else 0.2))
        l1, l2 = (elbow_rest - shoulder_rest).length, (wrist_rest - elbow_rest).length
        elbow = solve_elbow(shoulder, wrist, l1, l2, (side * 1.0, 0.35, -0.6))
        upper = aim(clav, shoulder_rest, elbow_rest, shoulder, elbow)
        fore = aim(upper, elbow_rest, wrist_rest, elbow, wrist)
        palm = Vector((0, along.y, along.z)).lerp(Vector(cfg['palm']), work)
        hand = hand_basis(side, palm, hand_head, hand_tail, wrist)
        seated_arm = {f'clavicle_{label}': clav @ rest[f'clavicle_{label}'], f'upper_arm_{label}': upper @ rest[f'upper_arm_{label}'],
                      f'forearm_{label}': fore @ rest[f'forearm_{label}'], f'hand_{label}': hand @ rest[f'hand_{label}']}
        for i in range(len(rig.FINGERS)):
            name = f'finger_{label}_{i}'
            tap = max(0.0, math.sin(wave * 6 + i * 1.7 + side * 1.3)) if action == 'typing' else 0.0
            curl = 0.2 + work * (0.05 + 0.15 * tap)
            seated_arm[name] = hand @ rig.rot_about(head_of[name], rig.ry(side * curl)) @ rest[name]
        seated_arm[f'thumb_{label}'] = hand @ rig.rot_about(head_of[f'thumb_{label}'], rig.rz(side * 0.3)) @ rest[f'thumb_{label}']
        for name, matrix in seated_arm.items():
            out[name] = blend(standing[name], matrix, s) if s < 1 else matrix
    return out


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--replace-generated', action='store_true')
    args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else [])
    if TARGET.exists() and not args.replace_generated:
        raise RuntimeError('V4 interactions exist. Review them before using --replace-generated.')
    bpy.ops.wm.open_mainfile(filepath=str(SOURCE))
    armature = bpy.data.objects['DeveloperRig']
    defs = {b.name: (b.head_local.copy(), b.tail_local.copy(), b.parent.name if b.parent else None) for b in armature.data.bones}
    # create_actions keys every clip in rig.CLIPS through rig.pose_matrices; the rig's idle/walk/run
    # actions already exist in the source, so only the seat clips are added.
    rig.CLIPS = CLIPS
    rig.pose_matrices = pose
    rig.create_actions(armature, defs)
    bpy.data.objects['Developer']['stage'] = '02B-v4-seat-laptop'
    armature['clips'] = ','.join(['idle', 'walk', 'run', *CLIPS])
    bpy.ops.wm.save_as_mainfile(filepath=str(TARGET), compress=True)
    base = json.loads((ROOT / 'public' / 'models' / 'developer-v4-rig.manifest.json').read_text(encoding='utf-8'))
    clips = base['clips'] + [{'name': name, 'duration': frames / rig.FPS, 'loop': name.rsplit('_', 1)[0] in LOOPING,
                              'seat': name.rsplit('_', 1)[1], 'events': EVENTS.get(name.rsplit('_', 1)[0], {})}
                             for name, frames in CLIPS.items()]
    manifest = {'source': 'developer-v4-interactions.glb', 'fps': rig.FPS, 'inPlace': True,
                'seats': {seat: {'stand_offset': cfg['back'], 'hip_height': cfg['hip']} for seat, cfg in SEATS.items()},
                'clips': clips}
    MANIFEST.write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8')
    print(f'V4 interactions: {TARGET}')


if __name__ == '__main__':
    main()
