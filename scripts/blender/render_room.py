"""Isometric review renders of the room diorama, optionally with the rigged V4 character."""
import argparse
import math
import sys
from pathlib import Path

import bpy
import numpy as np

ROOT = Path(__file__).resolve().parents[2]
REFERENCE = ROOT / 'assets' / 'reference' / 'room' / 'room-reference.jpg'
CHARACTER = ROOT / 'assets' / 'blender' / 'developer-v4-interactions.blend'
LAPTOP = ROOT / 'assets' / 'blender' / 'laptop.blend'
# shot: (clip, frame, anchor the character stands at, laptop anchor). Seat anchors carry the
# stand_offset used by the clips; the single laptop sits on the desk unless it is on the lap.
SHOTS = {
    'diorama-empty': (None, 0, None, 'Anchor_DeskLaptop'),
    'diorama': ('idle', 20, 'Spawn', 'Anchor_DeskLaptop'),
    'diorama-typing': ('typing_chair', 30, 'Anchor_ChairSeat', 'Anchor_DeskLaptop'),
    'diorama-bed': ('typing_bed', 30, 'Anchor_BedSeat', 'Anchor_BedLaptop'),
}


def stand_point(anchor_name):
    anchor = bpy.data.objects[anchor_name]
    heading = anchor.matrix_world.to_euler().z
    location = anchor.matrix_world.translation.copy()
    offset = anchor.get('stand_offset', 0.0)
    location.x += math.sin(heading) * offset  # the character faces -Y at heading 0
    location.y -= math.cos(heading) * offset
    location.z = 0.0
    return location, heading


def add_character(anchor_name, clip, frame):
    if 'Developer' not in bpy.data.objects:
        with bpy.data.libraries.load(str(CHARACTER), link=False) as (source, target):
            target.objects = list(source.objects)
            target.actions = list(source.actions)
        for obj in target.objects:
            if obj is not None and obj.type not in {'CAMERA', 'LIGHT'}:
                bpy.context.scene.collection.objects.link(obj)
    root = bpy.data.objects['Developer']
    root.location, root.rotation_euler.z = stand_point(anchor_name)
    rig = bpy.data.objects['DeveloperRig']
    action = bpy.data.actions[clip]
    rig.animation_data.action = action
    rig.animation_data.action_slot = action.slots[0]
    bpy.context.scene.frame_set(frame)


def place_laptop(anchor_name):
    if 'Laptop' not in bpy.data.objects:
        with bpy.data.libraries.load(str(LAPTOP), link=False) as (source, target):
            target.objects = list(source.objects)
        for obj in target.objects:
            bpy.context.scene.collection.objects.link(obj)
    bpy.data.objects['Laptop'].matrix_world = bpy.data.objects[anchor_name].matrix_world.copy()


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
    shots = list(SHOTS)
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
        clip, frame, anchor_name, laptop_anchor = SHOTS[shot]
        place_laptop(laptop_anchor)
        if clip:
            add_character(anchor_name, clip, frame)
        path = output / f'{shot}.png'
        scene.render.filepath = str(path)
        bpy.ops.render.render(write_still=True)
        if REFERENCE.exists():  # the private reference photo is not versioned
            side_by_side(path, output / f'compare-{shot}.png')
        print(f'Rendered {shot}')


if __name__ == '__main__':
    main()
