"""Review renders of the circuit's models (assets/renders/circuit/): one of each kind in a grid, and the office chair.

Run after create_circuit.py: blender --background --factory-startup --python scripts/blender/render_circuit.py
"""
import math
from pathlib import Path

import bpy
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[2]
BLEND = ROOT / 'assets' / 'blender' / 'circuit.blend'
OUT = ROOT / 'assets' / 'renders' / 'circuit'


def setup_scene(name):
    scene = bpy.data.scenes.new(name)
    scene.render.engine = 'BLENDER_EEVEE_NEXT' if 'BLENDER_EEVEE_NEXT' in {e.identifier for e in bpy.types.RenderSettings.bl_rna.properties['engine'].enum_items} else 'BLENDER_EEVEE'
    scene.render.resolution_x, scene.render.resolution_y = 1600, 1000
    scene.render.film_transparent = False
    world = bpy.data.worlds.new(name)
    world.use_nodes = True
    world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.09, 0.07, 0.16, 1)
    world.node_tree.nodes['Background'].inputs['Strength'].default_value = 1.2
    scene.world = world
    sun = bpy.data.objects.new('Sun', bpy.data.lights.new('Sun', 'SUN'))
    sun.data.energy = 3.5
    sun.rotation_euler = (math.radians(50), 0, math.radians(35))
    scene.collection.objects.link(sun)
    floor = bpy.data.objects.new('Floor', bpy.data.meshes.new('Floor'))
    floor.data.from_pydata([(-60, -60, 0), (60, -60, 0), (60, 60, 0), (-60, 60, 0)], [], [(0, 1, 2, 3)])
    mat = bpy.data.materials.new('FloorMat')
    mat.diffuse_color = (0.12, 0.1, 0.2, 1)
    mat.use_nodes = True
    mat.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.12, 0.1, 0.2, 1)
    floor.data.materials.append(mat)
    scene.collection.objects.link(floor)
    return scene


def camera(scene, target, distance, scale):
    cam = bpy.data.objects.new('Camera', bpy.data.cameras.new('Camera'))
    cam.data.type = 'ORTHO'
    cam.data.ortho_scale = scale
    direction = Vector((1, -1, 0.95)).normalized()
    cam.location = Vector(target) + direction * distance
    cam.rotation_euler = (-direction).to_track_quat('-Z', 'Y').to_euler()
    scene.collection.objects.link(cam)
    scene.camera = cam


def copy_tree(source, scene, location, rotation_z=0.0):
    """Copy an object and its children into the scene at a location (keeping their local layout)."""
    def clone(obj, parent):
        new = obj.copy()
        scene.collection.objects.link(new)
        new.parent = parent
        if parent is None:
            new.location = location
            new.rotation_euler = (obj.rotation_euler.x, obj.rotation_euler.y, rotation_z)
        for child in obj.children:
            clone(child, new)
        return new
    return clone(source, None)


def main():
    bpy.ops.wm.open_mainfile(filepath=str(BLEND))
    OUT.mkdir(parents=True, exist_ok=True)
    objects = bpy.data.objects
    # One example of each kind of thing (first object using each mesh, by name prefix).
    picks, seen = [], set()
    for obj in sorted(objects, key=lambda o: o.name):
        parent = obj.parent.name if obj.parent else ''
        # A decor empty made of shared child meshes (a sandbag wall) counts by its first child's mesh.
        data = obj.data if obj.type == 'MESH' else (obj.children[0].data if obj.type == 'EMPTY' and obj.children and obj.children[0].type == 'MESH' else None)
        if data is None or parent not in ('CircuitPieces', 'CircuitDecor') or data.name in seen:
            continue
        seen.add(data.name)
        picks.append(obj)
    picks += [objects['Tape_0']]
    scene = setup_scene('Catalog')
    columns = 6
    for k, obj in enumerate(picks):
        x, y = (k % columns) * 4.5, -(k // columns) * 4.5
        z = obj.location.z - (-0.12)
        copy_tree(obj, scene, (x, y, z), 0.0)
    rows = (len(picks) + columns - 1) // columns
    camera(scene, ((columns - 1) * 2.25, -(rows - 1) * 2.25, 0.5), 60, 30)
    bpy.context.window.scene = scene if bpy.context.window else scene
    scene.render.filepath = str(OUT / 'catalog.png')
    bpy.ops.render.render(write_still=True, scene=scene.name)
    chair_scene = setup_scene('Chair')
    copy_tree(objects['OfficeChair'], chair_scene, (0, 0, 0), 0.0)
    camera(chair_scene, (0, 0, 0.55), 10, 2.0)
    chair_scene.render.resolution_x, chair_scene.render.resolution_y = 1000, 1000
    chair_scene.render.filepath = str(OUT / 'chair.png')
    bpy.ops.render.render(write_still=True, scene=chair_scene.name)
    print('rendered', [o.name for o in picks])


if __name__ == '__main__':
    main()
