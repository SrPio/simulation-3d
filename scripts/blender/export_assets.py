import argparse
import sys
from pathlib import Path

import bpy

ROOT = Path(__file__).resolve().parents[2]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--replace-generated', action='store_true')
    parser.add_argument('--variant', choices=['v1', 'v2', 'v3', 'v4', 'v1-rig', 'v4-rig', 'v1-interactions', 'v4-interactions'], default='v1')
    args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else [])
    model = 'developer' if args.variant == 'v1' else f'developer-{args.variant}'
    source = ROOT / 'assets' / 'blender' / f'{model}.blend'
    destination = ROOT / 'public' / 'models' / f'{model}.glb'
    if destination.exists() and not args.replace_generated:
        raise RuntimeError('Export already exists. Review changes before using --replace-generated.')
    bpy.ops.wm.open_mainfile(filepath=str(source))
    root = bpy.data.objects.get('Developer')
    if root is None:
        raise RuntimeError('Missing Developer root')
    objects = [root, *root.children_recursive]
    bpy.ops.object.select_all(action='DESELECT')
    for obj in objects:
        if obj.type == 'CURVE':
            obj.select_set(True)
    curves = list(bpy.context.selected_objects)
    if curves:
        bpy.context.view_layer.objects.active = curves[0]
        bpy.ops.object.convert(target='MESH')
    if args.variant == 'v4':
        # The V4 source is sculpt-dense; the web copy keeps smooth silhouettes at a fraction of the size.
        for obj in root.children_recursive:
            if obj.type == 'MESH' and len(obj.data.polygons) > 6000:
                mod = obj.modifiers.new('WebReduce', 'DECIMATE')
                mod.ratio = max(0.22, 6000 / len(obj.data.polygons))
    if args.variant.startswith('v4'):
        # Cycles sheen is subtle, but three.js renders exported sheen as a grey haze on the black fabrics.
        for mat in bpy.data.materials:
            shader = mat.node_tree.nodes.get('Principled BSDF') if mat.node_tree else None
            if shader:
                shader.inputs['Sheen Weight'].default_value = 0
    bpy.ops.object.select_all(action='DESELECT')
    for obj in [root, *root.children_recursive]:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = root
    destination.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=str(destination), export_format='GLB',
                              use_selection=True, export_apply=True, export_yup=True,
                              export_animations=args.variant in {'v1-rig', 'v4-rig', 'v1-interactions', 'v4-interactions'}, export_extras=True,
                              export_animation_mode='ACTIONS', export_force_sampling=True,
                              export_cameras=False, export_lights=False)
    print(f'Character GLB: {destination} ({destination.stat().st_size} bytes)')


if __name__ == '__main__':
    main()
