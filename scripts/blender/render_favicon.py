"""The site icon: the web V4 head with its backwards cap, seen from the room page's isometric camera.

The room page starts with the character facing three.js +X under the camera at ROOM_VIEW (1, 0.95, 1), so on
screen it looks right and down. Imported back into Blender the character faces -Y; the same view relative to the
character is a camera along (-1, -1, 0.95). EEVEE with a transparent film, framed tightly on the head, then scaled
down for the icon sizes.

Writes public/favicon.png (64 px), public/favicon-32.png and public/apple-touch-icon.png (180 px, on the page's
dark violet so iOS does not fill the transparency with black).

Run: blender --background --factory-startup --python-exit-code 1 --python scripts/blender/render_favicon.py
"""
from pathlib import Path

import bpy
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[2]
V4 = ROOT / 'public' / 'models' / 'developer-v4.glb'
OUT = ROOT / 'public'
WORK = ROOT / 'assets' / 'renders' / 'favicon'

HEAD_PARTS = {'Head', 'Hair', 'HairTuft', 'Beard', 'Moustache', 'Eyebrows', 'Eye_L', 'Eye_R', 'Lips',
              'CapCrown', 'CapBrim', 'CapButton', 'CapStrap', 'CapStitching'} | {f'CapEyelet_{i}' for i in range(6)} | {
    f'CapEyeletHole_{i}' for i in range(6)}
VIEW = Vector((-1, -1, 0.95)).normalized()
SIZE = 512
MARGIN = 1.02
ICONS = (('favicon.png', 64, None), ('favicon-32.png', 32, None), ('apple-touch-icon.png', 180, (0.11, 0.09, 0.14)))


def clear():
    for obj in list(bpy.data.objects):
        bpy.data.objects.remove(obj, do_unlink=True)


def setup():
    scene = bpy.context.scene
    scene.render.engine = 'BLENDER_EEVEE'
    scene.render.resolution_x = scene.render.resolution_y = SIZE
    scene.render.resolution_percentage = 100
    scene.render.film_transparent = True
    scene.render.image_settings.file_format = 'PNG'
    scene.render.image_settings.color_mode = 'RGBA'
    scene.view_settings.view_transform = 'Standard'
    world = bpy.data.worlds.new('World')
    world.use_nodes = True
    world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.55, 0.52, 0.6, 1)
    world.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.9
    scene.world = world
    return scene


def light(name, direction, energy):
    sun = bpy.data.objects.new(name, bpy.data.lights.new(name, 'SUN'))
    sun.data.energy = energy
    sun.rotation_euler = (-Vector(direction)).to_track_quat('-Z', 'Y').to_euler()
    bpy.context.scene.collection.objects.link(sun)


def head_meshes():
    names = set()
    for obj in bpy.data.objects:
        if obj.type != 'MESH':
            continue
        names.add(obj.name.split('.')[0])
    keep = []
    for obj in bpy.data.objects:
        if obj.type == 'MESH' and obj.name.split('.')[0] in HEAD_PARTS:
            keep.append(obj)
        elif obj.type == 'MESH':
            obj.hide_render = True
    print('favicon: meshes', sorted(names), 'kept', sorted(o.name for o in keep))
    return keep


def camera(scene, shown):
    rotation = VIEW.to_track_quat('Z', 'Y')
    right = rotation @ Vector((1, 0, 0))
    up = rotation @ Vector((0, 1, 0))
    points = [obj.matrix_world @ v.co for obj in shown for v in obj.data.vertices]
    us = [p.dot(right) for p in points]
    vs = [p.dot(up) for p in points]
    ds = [p.dot(VIEW) for p in points]
    centre = right * (min(us) + max(us)) / 2 + up * (min(vs) + max(vs)) / 2 + VIEW * (max(ds) + 5)
    cam = bpy.data.objects.new('Camera', bpy.data.cameras.new('Camera'))
    cam.data.type = 'ORTHO'
    cam.data.ortho_scale = max(max(us) - min(us), max(vs) - min(vs)) * MARGIN
    cam.data.clip_end = 100
    cam.location = centre
    cam.rotation_euler = rotation.to_euler()
    scene.collection.objects.link(cam)
    scene.camera = cam


def icons(source):
    for name, size, background in ICONS:
        image = bpy.data.images.load(str(source))
        image.scale(size, size)
        if background:
            pixels = list(image.pixels)
            for i in range(0, len(pixels), 4):
                a = pixels[i + 3]
                for c in range(3):
                    pixels[i + c] = pixels[i + c] * a + background[c] * (1 - a)
                pixels[i + 3] = 1
            image.pixels = pixels
        image.filepath_raw = str(OUT / name)
        image.file_format = 'PNG'
        image.save()
        bpy.data.images.remove(image)


def main():
    clear()
    scene = setup()
    bpy.ops.import_scene.gltf(filepath=str(V4))
    shown = head_meshes()
    camera(scene, shown)
    light('Key', (-0.6, -1, 1.2), 3.2)
    light('Rim', (1, 0.6, 0.5), 1.4)
    WORK.mkdir(parents=True, exist_ok=True)
    source = WORK / 'head-isometric.png'
    scene.render.filepath = str(source)
    bpy.ops.render.render(write_still=True)
    icons(source)


main()
