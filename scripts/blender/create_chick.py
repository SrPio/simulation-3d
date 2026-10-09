"""The Konami chick: a round yellow chick in black wayfarer sunglasses, raining down when the code is typed.

After the user's reference: a soft bell-shaped body that is head and body at once, wider and flatter at the bottom,
stubby wings on the sides, a three-feather tuft, a small orange beak and, instead of the eyes, black sunglasses
with thick frames, glossy lenses, a bridge and arms running back along the head.

Local frame (Blender): feet (the body's bottom) at Z=0, facing -Y like the character; about 0.36 m tall. The viewer
draws many copies as instanced meshes (one per material) and gives each a self-righting physics body.
"""
import argparse
import math
import sys
from pathlib import Path

import bmesh
import bpy
from mathutils import Matrix, Vector

sys.path.insert(0, str(Path(__file__).resolve().parent))
from create_room import material

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / 'assets' / 'blender' / 'chick.blend'
OUTPUT = ROOT / 'public' / 'models' / 'chick.glb'
RENDERS = ROOT / 'assets' / 'renders' / 'chick'
# Body: radius across, half height and centre height (m).
RADIUS, HALF_HEIGHT, CENTRE = 0.155, 0.2, 0.2


def link(obj, parent):
    bpy.context.collection.objects.link(obj)
    obj.parent = parent
    return obj


def smooth(obj):
    for polygon in obj.data.polygons:
        polygon.use_smooth = True


def body_shape(x, y, z):
    """Bell profile: the sides swell towards the bottom, the bottom flattens, the crown rounds off."""
    h = z  # -1 bottom … 1 top on the unit sphere
    widen = 1.0 + 0.1 * (1 - h) * 0.5 - 0.14 * max(h, 0) ** 2
    zz = h if h > -0.7 else -0.7 - (h + 0.7) * 0.5  # flatter bottom
    return x * widen, y * widen * 0.97, zz


def sphere_mesh(name, segments, rings, shape=None):
    mesh = bpy.data.meshes.new(name)
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=segments, v_segments=rings, radius=1.0)
    if shape:
        for vert in bm.verts:
            vert.co = Vector(shape(*vert.co))
    bm.to_mesh(mesh)
    bm.free()
    return mesh


def ellipsoid(name, mat, parent, size, at, rotation=(0, 0, 0), segments=16, rings=10, shape=None):
    obj = link(bpy.data.objects.new(name, sphere_mesh(name, segments, rings, shape)), parent)
    obj.data.materials.append(mat)
    obj.scale = size
    obj.location = at
    obj.rotation_euler = rotation
    smooth(obj)
    return obj


def surface(body, x, z):
    """The body's front surface (towards -Y) at height z and across x: hit point and normal in world space."""
    bpy.context.view_layer.update()
    inverse = body.matrix_world.inverted()
    origin = inverse @ Vector((x, -1.0, z))
    direction = (inverse.to_3x3() @ Vector((0, 1, 0))).normalized()
    hit, location, normal, _ = body.ray_cast(origin, direction)
    if not hit:
        raise RuntimeError(f'No body surface at x={x}, z={z}')
    world = body.matrix_world @ location
    world_normal = (body.matrix_world.to_3x3().inverted().transposed() @ normal).normalized()
    return world, world_normal


def wayfarer(side, a, b, steps=36):
    """Outline of one wayfarer lens (local x across, y up): a rounded trapezoid, its outer top corner raised."""
    points = []
    for i in range(steps):
        t = 2 * math.pi * i / steps
        c, s = math.cos(t), math.sin(t)
        x = math.copysign(abs(c) ** 0.5, c) * a
        y = math.copysign(abs(s) ** 0.5, s) * b
        x *= 1 - 0.2 * max(0.0, -y / b)              # narrower towards the bottom
        y += 0.22 * b * (x * side / a) * max(0.0, y / b)  # outer top corner higher
        y -= 0.18 * b * max(0.0, -y / b) * (x * side / a + 1) * 0.5  # bottom drops towards the outside
        points.append((x, y))
    return points


def plate(name, mat, parent, outer, inner, thickness, frame):
    """A flat ring (or a disc without `inner`) extruded `thickness` towards the plate's back, placed by `frame`."""
    mesh = bpy.data.meshes.new(name)
    bm = bmesh.new()
    front = [bm.verts.new((x, 0.0, y)) for x, y in outer]
    if inner:
        hole = [bm.verts.new((x, 0.0, y)) for x, y in inner]
        n = len(front)
        for i in range(n):
            bm.faces.new((front[i], front[(i + 1) % n], hole[(i + 1) % n], hole[i]))
    else:
        bm.faces.new(front)
    faces = list(bm.faces)
    extruded = bmesh.ops.extrude_face_region(bm, geom=faces)
    moved = [element for element in extruded['geom'] if isinstance(element, bmesh.types.BMVert)]
    bmesh.ops.translate(bm, verts=moved, vec=(0, thickness, 0))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(mesh)
    bm.free()
    obj = link(bpy.data.objects.new(name, mesh), parent)
    obj.data.materials.append(mat)
    obj.matrix_world = frame
    return obj


def bar(name, mat, parent, start, end, width, depth):
    """A rounded-off bar between two points (the bridge and the arms)."""
    direction = end - start
    mesh = bpy.data.meshes.new(name)
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bm.to_mesh(mesh)
    bm.free()
    obj = link(bpy.data.objects.new(name, mesh), parent)
    obj.data.materials.append(mat)
    obj.location = (start + end) / 2
    obj.rotation_mode = 'QUATERNION'
    obj.rotation_quaternion = Vector((1, 0, 0)).rotation_difference(direction.normalized())
    obj.scale = (direction.length, width, depth)
    bevel = obj.modifiers.new('Bevel', 'BEVEL')
    bevel.width = min(width, depth) * 0.35
    bevel.segments = 2
    bevel.affect = 'EDGES'
    return obj


def build():
    root = bpy.data.objects.new('Chick', None)
    bpy.context.collection.objects.link(root)
    root['height'] = CENTRE + HALF_HEIGHT * 0.98
    root['radius'] = RADIUS * 1.08
    yellow = material('ChickFeathers', (0.93, 0.66, 0.0), 0.6)
    orange = material('ChickBeak', (0.92, 0.22, 0.01), 0.45)
    frame_black = material('ChickFrames', (0.012, 0.012, 0.014), 0.32)
    lens_black = material('ChickLenses', (0.004, 0.004, 0.006), 0.06, 0.4)

    body = ellipsoid('ChickBody', yellow, root, (RADIUS, RADIUS, HALF_HEIGHT), (0, 0, CENTRE), segments=28, rings=18, shape=body_shape)
    # Stubby wings low on the sides, leaning out a little at the bottom.
    for side in (-1, 1):
        ellipsoid(f'ChickWing_{"L" if side < 0 else "R"}', yellow, root, (0.036, 0.075, 0.095),
                  (side * (RADIUS * 1.06), 0.0, CENTRE - 0.04), (0.12, side * -0.28, side * 0.06), 16, 12)
    # A three-feather tuft on the crown, fanned out.
    top = CENTRE + HALF_HEIGHT * 0.96
    for k, (lean, height) in enumerate(((-0.55, 0.034), (0.0, 0.046), (0.55, 0.036))):
        feather = ellipsoid(f'ChickTuft_{k}', yellow, root, (0.011, 0.014, height), (math.sin(lean) * 0.016, 0.01, top + height * 0.7), (0, lean, 0), 10, 8)
        feather.location.z -= 0.004

    # Beak: two flattened cones pointing forward, the upper one longer.
    beak_point, beak_normal = surface(body, 0.0, CENTRE + 0.005)
    for name, size, drop in (('ChickBeakTop', (0.04, 0.034, 0.017), 0.002), ('ChickBeakBottom', (0.03, 0.022, 0.011), -0.008)):
        mesh = bpy.data.meshes.new(name)
        bm = bmesh.new()
        bmesh.ops.create_cone(bm, cap_ends=True, segments=14, radius1=1.0, radius2=0.08, depth=1.0)
        bm.to_mesh(mesh)
        bm.free()
        beak = link(bpy.data.objects.new(name, mesh), root)
        beak.data.materials.append(orange)
        # Cone along -Y (forward), base sunk into the body.
        beak.rotation_euler = (math.pi / 2, 0, 0)
        beak.scale = size[0], size[2], size[1]
        beak.location = beak_point + beak_normal * 0.006 + Vector((0, 0, drop))
        smooth(beak)

    # Sunglasses: two wayfarer frames on the face, glossy lenses set in them, a bridge and arms back along the head.
    lens_a, lens_b, rim = 0.036, 0.027, 0.008
    eye_z, eye_x = CENTRE + 0.06, 0.05
    arms = []
    for side in (-1, 1):
        point, normal = surface(body, side * eye_x, eye_z)
        # Plate axes: across the face (x), up (z), out of the face (-y in plate space is towards the viewer).
        out = normal
        up = (Vector((0, 0, 1)) - out * out.z).normalized()
        across = up.cross(out).normalized()
        centre = point + out * 0.012
        basis = Matrix((across, -out, up)).transposed()
        frame = Matrix.Translation(centre) @ basis.to_4x4()
        outline = wayfarer(side, lens_a + rim, lens_b + rim)
        hole = wayfarer(side, lens_a, lens_b)
        plate(f'ChickFrame_{side}', frame_black, root, outline, hole, 0.012, frame @ Matrix.Translation((0, -0.004, 0)))
        plate(f'ChickLens_{side}', lens_black, root, hole, None, 0.006, frame @ Matrix.Translation((0, 0.001, 0)))
        # The outer top corner, where the arm starts.
        corner = max(outline, key=lambda p: p[0] * side + p[1] * 0.6)
        arms.append(frame @ Vector((corner[0], 0.004, corner[1] - 0.006)))
        if side == -1:
            bridge_left = frame @ Vector((lens_a + rim * 0.4, -0.002, lens_b * 0.45))
        else:
            bridge_right = frame @ Vector((-(lens_a + rim * 0.4), -0.002, lens_b * 0.45))
    bar('ChickBridge', frame_black, root, bridge_left, bridge_right, 0.012, 0.01)
    for side, start in zip((-1, 1), arms):
        # Along the side of the head to just inside it, a little behind the middle.
        bpy.context.view_layer.update()
        inverse = body.matrix_world.inverted()
        hit, location, _, _ = body.ray_cast(inverse @ Vector((side * 1.0, 0.06, start.z)), (inverse.to_3x3() @ Vector((-side, 0, 0))).normalized())
        end = (body.matrix_world @ location) - Vector((side * 0.004, 0, 0)) if hit else Vector((side * RADIUS * 0.85, 0.06, start.z))
        bar(f'ChickArm_{side}', frame_black, root, start, end, 0.012, 0.008)
    return root


def apply_modifiers(root):
    bpy.context.view_layer.update()
    for obj in root.children_recursive:
        if obj.type != 'MESH' or not obj.modifiers:
            continue
        bpy.ops.object.select_all(action='DESELECT')
        obj.select_set(True)
        bpy.context.view_layer.objects.active = obj
        for modifier in list(obj.modifiers):
            bpy.ops.object.modifier_apply(modifier=modifier.name)


def ground(root):
    """Stand the chick on Z=0: its flattened bottom ends a few centimetres above the body's sphere."""
    bpy.context.view_layer.update()
    lowest = min((obj.matrix_world @ v.co).z for obj in root.children_recursive if obj.type == 'MESH' for v in obj.data.vertices)
    for child in root.children:
        child.location.z -= lowest
    root['height'] = root['height'] - lowest


def render(root):
    """Review renders: front and three-quarter views on a light grey backdrop."""
    scene = bpy.context.scene
    scene.render.engine = 'BLENDER_EEVEE_NEXT' if 'BLENDER_EEVEE_NEXT' in [e.identifier for e in bpy.types.RenderSettings.bl_rna.properties['engine'].enum_items] else 'BLENDER_EEVEE'
    scene.render.resolution_x = scene.render.resolution_y = 900
    scene.render.film_transparent = False
    scene.view_settings.view_transform = 'Standard'
    world = bpy.data.worlds.new('ChickWorld')
    world.use_nodes = True
    world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.82, 0.82, 0.84, 1)
    world.node_tree.nodes['Background'].inputs['Strength'].default_value = 1.0
    scene.world = world
    for name, energy, rotation in (('Key', 4.0, (0.8, 0.2, -0.6)), ('Fill', 1.6, (1.0, -0.3, 2.4))):
        light = bpy.data.objects.new(name, bpy.data.lights.new(name, 'SUN'))
        light.data.energy = energy
        light.rotation_euler = rotation
        scene.collection.objects.link(light)
    camera = bpy.data.objects.new('Camera', bpy.data.cameras.new('Camera'))
    camera.data.lens = 85
    scene.collection.objects.link(camera)
    scene.camera = camera
    RENDERS.mkdir(parents=True, exist_ok=True)
    target = Vector((0, 0, 0.19))
    for name, azimuth, elevation in (('front', 0.0, 0.12), ('three-quarter', -0.65, 0.3), ('side', -1.57, 0.1)):
        distance = 1.5
        camera.location = target + Vector((math.sin(azimuth) * math.cos(elevation), -math.cos(azimuth) * math.cos(elevation), math.sin(elevation))) * distance
        camera.rotation_euler = (target - camera.location).to_track_quat('-Z', 'Y').to_euler()
        scene.render.filepath = str(RENDERS / f'{name}.png')
        bpy.ops.render.render(write_still=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--replace-generated', action='store_true')
    parser.add_argument('--render', action='store_true')
    args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else [])
    if (SOURCE.exists() or OUTPUT.exists()) and not args.replace_generated:
        raise RuntimeError('Chick exists. Review it before using --replace-generated.')
    bpy.ops.wm.read_factory_settings(use_empty=True)
    root = build()
    apply_modifiers(root)
    ground(root)
    SOURCE.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=str(SOURCE), compress=True)
    bpy.ops.object.select_all(action='DESELECT')
    for obj in [root, *root.children_recursive]:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = root
    bpy.ops.export_scene.gltf(filepath=str(OUTPUT), export_format='GLB', use_selection=True, export_apply=True,
                              export_yup=True, export_extras=True, export_animations=False, export_cameras=False,
                              export_lights=False)
    print(f'Chick: {SOURCE}, {OUTPUT} ({OUTPUT.stat().st_size} bytes)')
    if args.render:
        render(root)


if __name__ == '__main__':
    main()
