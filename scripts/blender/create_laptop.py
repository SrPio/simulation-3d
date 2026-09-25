import argparse
import sys
from pathlib import Path

import bpy

sys.path.insert(0, str(Path(__file__).resolve().parent))
from create_character import material, rounded_box

ROOT = Path(__file__).resolve().parents[2]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--replace-generated-laptop', action='store_true')
    args = parser.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else [])
    source = ROOT / 'assets' / 'blender' / 'laptop.blend'
    output = ROOT / 'public' / 'models' / 'laptop.glb'
    if (source.exists() or output.exists()) and not args.replace_generated_laptop:
        raise RuntimeError('Laptop already exists; review before replacing generated output.')
    bpy.ops.wm.read_factory_settings(use_empty=True)
    root = bpy.data.objects.new('Laptop', None)
    bpy.context.collection.objects.link(root)
    metal = material('LaptopMetal', (0.075, 0.083, 0.105), 0.38, 0.7)
    keys = material('Keys', (0.014, 0.015, 0.021), 0.66)
    screen = material('Screen', (0.008, 0.012, 0.024), 0.45)
    accents = [material('Code'+str(i), color, 0.7) for i, color in enumerate([(0.34, 0.12, 0.68), (0.10, 0.48, 0.54), (0.64, 0.35, 0.13)])]
    for mat in accents:
        shader = mat.node_tree.nodes['Principled BSDF']
        shader.inputs['Emission Color'].default_value = mat.diffuse_color
        shader.inputs['Emission Strength'].default_value = 0.7
    def box(name, position, size, radius, mat, parent=root):
        obj = rounded_box(name, position, size, radius, mat)
        obj.parent = parent
        return obj
    box('LaptopBase', (0, 0, 0.010), (0.42, 0.28, 0.02), 0.009, metal)
    box('KeyboardWell', (0, -0.035, 0.020), (0.367, 0.167, 0.003), 0.003, keys)
    key_objects = []
    for row in range(5):
        for col in range(14):
            key_objects.append(box(f'Key_{row}_{col}', (-0.166+col*0.0255, -0.095+row*0.028, 0.023), (0.022, 0.023, 0.004), 0.002, metal))
    key_objects.append(box('Spacebar', (0, 0.048, 0.023), (0.14, 0.018, 0.004), 0.002, metal))
    bpy.ops.object.select_all(action='DESELECT')
    for obj in key_objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = key_objects[0]
    bpy.ops.object.convert(target='MESH')
    bpy.ops.object.join()
    bpy.context.object.name = 'Keyboard'
    box('Trackpad', (0, 0.096, 0.021), (0.113, 0.041, 0.002), 0.003, keys)
    for x in [-0.189, 0.189]:
        for row in range(12):
            box(f'Speaker_{x}_{row}', (x, -0.10+row*0.012, 0.021), (0.008, 0.004, 0.001), 0.0005, keys)
    hinge = bpy.data.objects.new('LaptopHinge', None)
    bpy.context.collection.objects.link(hinge)
    hinge.parent = root
    hinge.location = (0, -0.135, 0.028)
    box('LaptopLid', (0, 0.135, 0), (0.42, 0.28, 0.012), 0.007, metal, hinge)
    box('Display', (0, 0.138, -0.007), (0.375, 0.232, 0.002), 0.002, screen, hinge)
    for row in range(11):
        y = 0.045+row*0.017
        box(f'LineNumber_{row}', (-0.169, y, -0.0088), (0.01, 0.003, 0.001), 0.0003, accents[0], hinge)
        cursor = -0.145 + (row%3)*0.009
        for token in range(3):
            width = 0.027 + ((row+token*3)%5)*0.012
            box(f'Code_{row}_{token}', (cursor+width/2, y, -0.0088), (width, 0.004, 0.001), 0.0004, accents[(row+token)%3], hinge)
            cursor += width+0.008
    box('Camera', (0, 0.018, -0.008), (0.009, 0.006, 0.001), 0.002, keys, hinge)
    root['hinge_open_radians'] = 1.88
    bpy.ops.wm.save_as_mainfile(filepath=str(source), compress=False)
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.export_scene.gltf(filepath=str(output), export_format='GLB', use_selection=True, export_apply=True,
                              export_animations=False, export_extras=True, export_yup=True)
    print(f'Independent laptop: {source}, {output}')


if __name__ == '__main__':
    main()
