"""Render V4 turnarounds, close-ups and side-by-side comparisons with the reference photos."""
import argparse
import math
import sys
from pathlib import Path

import bpy
import numpy as np
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[2]
REFERENCE = ROOT / 'assets' / 'reference' / 'v4'
BODY = (0, 0, 1.33)
FACE = (0, -0.03, 2.27)
# name: (azimuth degrees measured from the front, elevation degrees, target, framing height, focal mm)
VIEWS = {
    'front': (0, 2, BODY, 2.95, 85),
    'back': (180, 2, BODY, 2.95, 85),
    'left': (90, 2, BODY, 2.95, 85),
    'right': (-90, 2, BODY, 2.95, 85),
    'three-quarter': (35, 10, BODY, 2.95, 85),
    'face-front': (0, 0, FACE, 0.86, 100),
    'face-profile': (-90, 0, FACE, 0.86, 100),
    'face-three-quarter': (-35, 6, FACE, 0.86, 100),
    'face-back': (180, 8, (0, 0.02, 2.33), 0.86, 100),
    'hands': (25, 25, (1.0, -0.02, 1.73), 0.55, 100),
    'shoes': (30, 18, (0, -0.1, 0.13), 0.75, 100),
}
# Calibrated references: view -> (file, meters per pixel, pixel x of the body axis, pixel y of the ground).
# The photos were measured on a grid; the model is built to the same scale.
CALIBRATED = {
    'front': ('full-front.jpg', 0.0015, 1000, 1900),
    'face-front': ('full-front.jpg', 0.0015, 1000, 1900),
    'left': ('side-back.jpg', 0.00161, 515, 1840),
    'back': ('side-back.jpg', 0.00161, 1317, 1840),
}
# Uncalibrated close-ups: view -> (file, crop x0, y0, x1, y1)
CROPPED = {
    'face-profile': ('head-closeup.jpg', 540, 180, 1125, 880),
    'face-three-quarter': ('head-closeup.jpg', 110, 1060, 1000, 1960),
}


def aim(obj, target):
    obj.rotation_euler = (Vector(target) - obj.location).to_track_quat('-Z', 'Y').to_euler()


def backdrop_mesh(mat):
    profile = [(-14.0, 0.0), (1.5, 0.0)]
    for i in range(1, 17):
        a = i / 16 * math.pi / 2
        profile.append((1.5 + 2.5 * math.sin(a), 2.5 - 2.5 * math.cos(a)))
    profile.append((4.0, 12.0))
    verts, faces = [], []
    for x in (-16, 16):
        for y, z in profile:
            verts.append((x, y, z))
    n = len(profile)
    for i in range(n - 1):
        faces.append((i, i + 1, n + i + 1, n + i))
    data = bpy.data.meshes.new('Backdrop')
    data.from_pydata(verts, [], faces)
    data.polygons.foreach_set('use_smooth', np.ones(len(faces), bool))
    obj = bpy.data.objects.new('Backdrop', data)
    bpy.context.collection.objects.link(obj)
    data.materials.append(mat)
    return obj


def area(name, location, power, size, color, rig):
    data = bpy.data.lights.new(name, 'AREA')
    data.energy = power
    data.shape = 'DISK'
    data.size = size
    data.color = color
    obj = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(obj)
    obj.location = location
    aim(obj, (0, 0, 1.4))
    obj.parent = rig
    return obj


def studio():
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    scene.cycles.samples = 128
    scene.cycles.use_denoising = True
    scene.cycles.device = 'CPU'
    scene.render.image_settings.file_format = 'PNG'
    scene.render.image_settings.color_mode = 'RGB'
    scene.view_settings.view_transform = 'Khronos PBR Neutral'
    world = bpy.data.worlds.new('V4World')
    world.use_nodes = True
    world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.52, 0.48, 0.45, 1)
    world.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.35
    scene.world = world
    rig = bpy.data.objects.new('StudioRig', None)
    bpy.context.collection.objects.link(rig)
    mat = bpy.data.materials.new('BackdropPaper')
    mat.use_nodes = True
    shader = mat.node_tree.nodes['Principled BSDF']
    shader.inputs['Base Color'].default_value = (0.47, 0.43, 0.395, 1)
    shader.inputs['Roughness'].default_value = 0.95
    backdrop = backdrop_mesh(mat)
    backdrop.parent = rig
    area('Key', (-3.5, -5.0, 5.5), 750, 5.0, (1.0, 0.95, 0.9), rig)
    area('Fill', (4.5, -4.0, 2.8), 300, 4.5, (0.95, 0.97, 1.0), rig)
    area('Top', (0.0, -0.5, 7.5), 220, 6.0, (1.0, 0.98, 0.95), rig)
    area('Rim', (2.5, 3.5, 4.5), 420, 3.0, (1.0, 0.96, 0.92), rig)
    data = bpy.data.cameras.new('V4Camera')
    camera = bpy.data.objects.new('V4Camera', data)
    bpy.context.collection.objects.link(camera)
    scene.camera = camera
    return rig, camera


def frame(camera, rig, view):
    azimuth, elevation, target, height, focal = VIEWS[view]
    camera.data.lens = focal
    camera.data.sensor_fit = 'VERTICAL'
    camera.data.sensor_height = 24
    distance = height / 2 / math.tan(math.atan(12 / focal))
    az, el = math.radians(azimuth), math.radians(elevation)
    offset = Vector((math.sin(az) * math.cos(el), -math.cos(az) * math.cos(el), math.sin(el))) * distance
    camera.location = Vector(target) + offset
    camera.data.clip_end = distance + 30
    aim(camera, target)
    rig.rotation_euler = (0, 0, az)


def load_pixels(path):
    img = bpy.data.images.load(str(path))
    w, h = img.size
    return np.array(img.pixels[:], np.float32).reshape(h, w, 4)[::-1]


def save_pixels(pixels, path):
    out = bpy.data.images.new(path.stem, pixels.shape[1], pixels.shape[0])
    out.pixels.foreach_set(np.ascontiguousarray(pixels[::-1]).ravel())
    out.filepath_raw = str(path)
    out.file_format = 'PNG'
    out.save()


def compare(view, render_path, output):
    source = CALIBRATED.get(view) or CROPPED.get(view)
    if not source or not (REFERENCE / source[0]).exists():  # the private reference photos are not versioned
        return
    ren = load_pixels(render_path)
    size = ren.shape[0]
    if view in CALIBRATED:
        name, mpp, axis_x, ground_y = CALIBRATED[view]
        ref = load_pixels(REFERENCE / name)
        azimuth, _, target, height, _ = VIEWS[view]
        az = math.radians(azimuth)
        horizontal = target[0] * math.cos(az) + target[1] * math.sin(az)
        step = height / size
        h = horizontal + (np.arange(size) - size / 2 + 0.5) * step
        z = target[2] - (np.arange(size) - size / 2 + 0.5) * step
        cols = np.rint(axis_x + h / mpp).astype(int)
        rows = np.rint(ground_y - z / mpp).astype(int)
        valid = (cols[None, :] >= 0) & (cols[None, :] < ref.shape[1]) & (rows[:, None] >= 0) & (rows[:, None] < ref.shape[0])
        aligned = ref[np.clip(rows, 0, ref.shape[0] - 1)][:, np.clip(cols, 0, ref.shape[1] - 1)]
        aligned[~valid] = (0.2, 0.2, 0.2, 1)
        overlay = aligned * 0.5 + ren * 0.5
        overlay[..., 3] = 1
        gap = np.ones((size, 12, 4), np.float32)
        save_pixels(np.concatenate([aligned, gap, ren, gap, overlay], axis=1), output / f'compare-{view}.png')
    elif view in CROPPED:
        name, x0, y0, x1, y1 = CROPPED[view]
        ref = load_pixels(REFERENCE / name)[y0:y1, x0:x1]
        rows = (np.arange(size) * ref.shape[0] / size).astype(int)
        cols = (np.arange(int(ref.shape[1] * size / ref.shape[0])) * ref.shape[0] / size).astype(int)
        gap = np.ones((size, 12, 4), np.float32)
        save_pixels(np.concatenate([ref[rows][:, cols], gap, ren], axis=1), output / f'compare-{view}.png')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--source', default=str(ROOT / 'assets' / 'blender' / 'developer-v4.blend'))
    parser.add_argument('--output', default=str(ROOT / 'assets' / 'renders' / 'character-v4'))
    parser.add_argument('--views', nargs='+', choices=list(VIEWS), default=list(VIEWS))
    parser.add_argument('--samples', type=int, default=128)
    parser.add_argument('--size', type=int, default=1100)
    parser.add_argument('--replace-generated', action='store_true')
    args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else [])
    output = Path(args.output).resolve()
    for view in args.views:
        if (output / f'{view}.png').exists() and not args.replace_generated:
            raise RuntimeError(f'{view}.png exists. Review it before using --replace-generated.')
    bpy.ops.wm.open_mainfile(filepath=str(Path(args.source).resolve()))
    rig, camera = studio()
    scene = bpy.context.scene
    scene.cycles.samples = args.samples
    output.mkdir(parents=True, exist_ok=True)
    for view in args.views:
        frame(camera, rig, view)
        scene.render.resolution_x = scene.render.resolution_y = args.size
        path = output / f'{view}.png'
        scene.render.filepath = str(path)
        bpy.ops.render.render(write_still=True)
        compare(view, path, output)
        print(f'Rendered {view}')


if __name__ == '__main__':
    main()
