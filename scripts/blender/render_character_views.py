import argparse
import math
import sys
from pathlib import Path

import bpy
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[2]
VIEWS = {
    'front': (0, -6, 1.65),
    'back': (0, 6, 1.65),
    'left': (-6, 0, 1.65),
    'right': (6, 0, 1.65),
    'three-quarter': (4, -6, 3.2),
    'violet': (4, -6, 3.2),
}
DETAIL_VIEWS = {
    'face-front': ((0, -6, 2.265), (0, 0, 2.265), 1.04),
    'face-three-quarter': ((4, -6, 2.9), (0, 0, 2.265), 1.08),
    'face-profile': ((6, 0, 2.265), (0, 0, 2.265), 1.04),
    'hands': ((2.6, -3, 4), (1.04, 0, 1.73), 0.65),
    'shoes': ((2.5, -4, 2), (0, -0.065, 0.15), 0.95),
}


def aim(obj, target):
    obj.rotation_euler = (Vector(target) - obj.location).to_track_quat('-Z', 'Y').to_euler()


def area(name, location, power, color, size):
    data = bpy.data.lights.new(name, 'AREA')
    data.energy = power
    data.color = color
    data.shape = 'DISK'
    data.size = size
    obj = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(obj)
    obj.location = location
    aim(obj, (0, 0, 1.3))
    return obj


def studio():
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    scene.cycles.samples = 40
    scene.cycles.use_denoising = True
    scene.render.resolution_x = 900
    scene.render.resolution_y = 1050
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = 'PNG'
    scene.render.image_settings.color_mode = 'RGBA'
    scene.view_settings.view_transform = 'AgX'
    scene.view_settings.look = 'AgX - Medium High Contrast'
    scene.render.film_transparent = False
    world = bpy.data.worlds.new('StudioWorld')
    world.use_nodes = True
    scene.world = world
    world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.45, 0.43, 0.4, 1)
    world.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.25
    floor_mat = bpy.data.materials.new('StudioFloorMaterial')
    floor_mat.use_nodes = True
    shader = floor_mat.node_tree.nodes['Principled BSDF']
    shader.inputs['Base Color'].default_value = (0.29, 0.27, 0.245, 1)
    shader.inputs['Roughness'].default_value = 0.83
    bpy.ops.mesh.primitive_plane_add(size=200, location=(0, 0, -0.13))
    floor = bpy.context.object
    floor.name = 'StudioFloor'
    floor.data.materials.append(floor_mat)
    base_mat = bpy.data.materials.new('PresentationBaseMaterial')
    base_mat.use_nodes = True
    base_mat.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.19, 0.19, 0.19, 1)
    base_mat.node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value = 0.7
    bpy.ops.mesh.primitive_cylinder_add(vertices=96, radius=0.84, depth=0.115, location=(0, 0, -0.07))
    base = bpy.context.object
    base.name = 'PresentationBase'
    base.data.materials.append(base_mat)
    bevel = base.modifiers.new('SoftEdges', 'BEVEL')
    bevel.width = 0.022
    bevel.segments = 4
    base.modifiers.new('WeightedNormals', 'WEIGHTED_NORMAL')
    for face in base.data.polygons:
        face.use_smooth = True
    camera_data = bpy.data.cameras.new('StudioCamera')
    camera = bpy.data.objects.new('StudioCamera', camera_data)
    bpy.context.collection.objects.link(camera)
    camera_data.type = 'ORTHO'
    camera_data.ortho_scale = 3.38
    scene.camera = camera
    key = area('StudioKey', (-3, -4, 5.5), 650, (1, 0.87, 0.74), 4)
    fill = area('StudioFill', (3, -2, 3), 270, (0.80, 0.87, 1), 3)
    rim = area('StudioRim', (1.5, 3, 4), 750, (1, 0.91, 0.80), 3)
    return camera, key, fill, rim, shader


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--views', nargs='+', choices=[*VIEWS, *DETAIL_VIEWS], default=list(VIEWS))
    parser.add_argument('--replace-generated', action='store_true')
    parser.add_argument('--variant', choices=['v1', 'v2', 'v3'], default='v1')
    parser.add_argument('--head-study', action='store_true')
    args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else [])
    output = ROOT / 'assets' / 'renders' / ('character' if args.variant == 'v1' else f'character-{args.variant}')
    source = ROOT / 'assets' / 'blender' / ('developer.blend' if args.variant == 'v1' else f'developer-{args.variant}.blend')
    if args.head_study:
        source = ROOT / 'test-results' / 'head-v3.blend'
        output = ROOT / 'test-results' / 'head-v3'
    for name in args.views:
        if (output / f'{name}.png').exists() and not args.replace_generated:
            raise RuntimeError(f'Render {name} already exists. Use --replace-generated after review.')
    bpy.ops.wm.open_mainfile(filepath=str(source))
    camera, key, fill, rim, floor_shader = studio()
    output.mkdir(parents=True, exist_ok=True)
    for name in args.views:
        violet = name == 'violet'
        key.data.color = (0.72, 0.49, 1) if violet else (1, 0.87, 0.74)
        key.data.energy = 420 if violet else 650
        fill.data.color = (0.42, 0.46, 1) if violet else (0.80, 0.87, 1)
        fill.data.energy = 170 if violet else 270
        rim.data.color = (0.72, 0.055, 1) if violet else (1, 0.91, 0.80)
        rim.data.energy = 1000 if violet else 750
        floor_shader.inputs['Base Color'].default_value = (0.026, 0.016, 0.046, 1) if violet else (0.29, 0.27, 0.245, 1)
        bpy.context.scene.world.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.08 if violet else 0.25
        if name in DETAIL_VIEWS:
            position, target, span = DETAIL_VIEWS[name]
            camera.location = position
            camera.data.ortho_scale = span
            bpy.context.scene.render.resolution_x = 1000
            bpy.context.scene.render.resolution_y = 1000
        else:
            camera.location = VIEWS[name]
            target = (0, 0, 1.29)
            camera.data.ortho_scale = 3.38
            bpy.context.scene.render.resolution_x = 1100 if args.variant == 'v3' else 900
            bpy.context.scene.render.resolution_y = 1100 if args.variant == 'v3' else 1050
            if args.variant == 'v3' and name in ['front', 'back', 'left', 'right']:
                camera.location.z = 1.29
        aim(camera, target)
        bpy.context.scene.render.filepath = str(output / f'{name}.png')
        bpy.ops.render.render(write_still=True)
        print(f'Rendered {name}')


if __name__ == '__main__':
    main()
