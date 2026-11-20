"""Profile silhouettes of Canela as alpha masks, traced into SVG paths by scripts/silhouettes.ts (`DOG_ICONS`).

Reads `assets/blender/canela-rig.blend` (from rig_dog.py) and renders `assets/renders/silhouettes/dog-<pose>.png`:
standing, walking, running, sitting, carrying the baseball in her mouth and in the air of a jump, for the illustrated
instructions of her laptop program. The camera looks from her right side, so she faces right like the character's
figures. Workbench, flat black, transparent film: only the alpha matters.

Run: blender --background --factory-startup --python-exit-code 1 --python scripts/blender/render_dog_silhouettes.py
"""
from pathlib import Path

import bpy
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / 'assets' / 'blender' / 'canela-rig.blend'
OUT = ROOT / 'assets' / 'renders' / 'silhouettes'
SIZE = 512
# pose: (clip, frame, with the baseball in her mouth). 24 fps, as rig_dog.py keys them.
POSES = {
    'stand': ('idle', 0, False),
    'walk': ('walk', 6, False),
    'run': ('run', 8, False),
    'sit': ('sit', 0, False),
    'carry': ('walk', 12, True),
    'jump': ('jump', 10, False),
}
# The baseball's radius (m): a little larger than BASEBALL in src/world/PropPhysics.ts, so it reads at icon size.
BALL = 0.075


def setup():
    scene = bpy.context.scene
    scene.render.engine = 'BLENDER_WORKBENCH'
    scene.render.resolution_x = scene.render.resolution_y = SIZE
    scene.render.resolution_percentage = 100
    scene.render.film_transparent = True
    scene.render.image_settings.file_format = 'PNG'
    scene.render.image_settings.color_mode = 'RGBA'
    scene.render.image_settings.color_depth = '8'
    shading = scene.display.shading
    shading.light = 'FLAT'
    shading.color_type = 'SINGLE'
    shading.single_color = (0, 0, 0)
    shading.show_object_outline = False
    shading.show_cavity = False
    shading.show_shadows = False
    scene.display.render_aa = '8'
    scene.view_settings.view_transform = 'Standard'
    camera = bpy.data.objects.new('Camera', bpy.data.cameras.new('Camera'))
    camera.data.type = 'ORTHO'
    camera.data.ortho_scale = 1.5
    camera.data.clip_end = 100
    # From her right (-X), looking along +X: facing -Y, she faces right in the image.
    camera.location = Vector((-20, 0, 0.45))
    camera.rotation_euler = Vector((1, 0, 0)).to_track_quat('-Z', 'Y').to_euler()
    scene.collection.objects.link(camera)
    scene.camera = camera
    return scene


def main():
    bpy.ops.wm.open_mainfile(filepath=str(SOURCE))
    scene = setup()
    for obj in list(bpy.data.objects):
        if obj.type == 'MESH' and obj.name.startswith('Plane'):
            bpy.data.objects.remove(obj, do_unlink=True)
    rig = bpy.data.objects['Canela']
    mouth = bpy.data.objects['Canela_Mouth']
    bpy.ops.mesh.primitive_uv_sphere_add(radius=BALL, segments=24, ring_count=12)
    ball = bpy.context.active_object
    OUT.mkdir(parents=True, exist_ok=True)
    for name, (clip, frame, carrying) in POSES.items():
        action = bpy.data.actions[clip]
        rig.animation_data.action = action
        rig.animation_data.action_slot = action.slots[0]
        scene.frame_set(frame)
        bpy.context.view_layer.update()
        ball.hide_render = not carrying
        ball.location = mouth.matrix_world.translation + Vector((0, -0.03, -0.01))
        scene.render.filepath = str(OUT / f'dog-{name}.png')
        bpy.ops.render.render(write_still=True)


main()
