"""Isometric review renders of the room diorama, optionally with the rigged V4 character."""
import argparse
import math
import sys
from pathlib import Path

import bpy
import numpy as np

ROOT = Path(__file__).resolve().parents[2]
REFERENCE = ROOT / 'assets' / 'reference' / 'room' / 'room-reference.jpg'
CHARACTER = ROOT / 'assets' / 'blender' / 'developer-v4-rig.blend'


def add_character(location, heading, clip='idle', frame=20):
    with bpy.data.libraries.load(str(CHARACTER), link=False) as (source, target):
        target.objects = list(source.objects)
        target.actions = list(source.actions)
    for obj in target.objects:
        if obj is not None and obj.type != 'CAMERA' and obj.type != 'LIGHT':
            bpy.context.scene.collection.objects.link(obj)
    root = bpy.data.objects['Developer']
    root.location = location
    root.rotation_euler.z = heading
    rig = bpy.data.objects['DeveloperRig']
    action = bpy.data.actions[clip]
    rig.animation_data.action = action
    rig.animation_data.action_slot = action.slots[0]
    bpy.context.scene.frame_set(frame)


def load(path):
    img = bpy.data.images.load(str(path))
    w, h = img.size
    return np.array(img.pixels[:], np.float32).reshape(h, w, 4)[::-1]


def side_by_side(render_path, out_path):
    ren = load(render_path)
    ref = load(REFERENCE)
    size = ren.shape[0]
    idx = (np.arange(size) * ref.shape[0] / size).astype(int)
    ref = ref[idx][:, (np.arange(size) * ref.shape[1] / size).astype(int)]
    sheet = np.concatenate([ref, np.ones((size, 16, 4), np.float32), ren], axis=1)
    out = bpy.data.images.new(out_path.stem, sheet.shape[1], sheet.shape[0])
    out.pixels.foreach_set(np.ascontiguousarray(sheet[::-1]).ravel())
    out.filepath_raw = str(out_path)
    out.file_format = 'PNG'
    out.save()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--source', default=str(ROOT / 'assets' / 'blender' / 'room.blend'))
    parser.add_argument('--output', default=str(ROOT / 'assets' / 'renders' / 'room'))
    parser.add_argument('--samples', type=int, default=160)
    parser.add_argument('--size', type=int, default=1200)
    parser.add_argument('--replace-generated', action='store_true')
    args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else [])
    output = Path(args.output).resolve()
    shots = ['diorama-empty', 'diorama']
    if any((output / f'{s}.png').exists() for s in shots) and not args.replace_generated:
        raise RuntimeError('Room renders exist. Review them before using --replace-generated.')
    output.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.open_mainfile(filepath=str(Path(args.source).resolve()))
    scene = bpy.context.scene
    scene.cycles.samples = args.samples
    scene.cycles.use_denoising = True
    scene.render.resolution_x = scene.render.resolution_y = args.size
    scene.render.image_settings.file_format = 'PNG'
    scene.render.image_settings.color_mode = 'RGB'
    scene.view_settings.view_transform = 'AgX'
    scene.view_settings.look = 'AgX - Medium High Contrast'
    for shot in shots:
        if shot == 'diorama':
            add_character((0.75, -0.55, 0.0), math.radians(45))
        path = output / f'{shot}.png'
        scene.render.filepath = str(path)
        bpy.ops.render.render(write_still=True)
        if REFERENCE.exists():  # the private reference photo is not versioned
            side_by_side(path, output / f'compare-{shot}.png')
        print(f'Rendered {shot}')


if __name__ == '__main__':
    main()
