"""Original artwork and procedural textures for the developer room diorama.

Posters, desk mat, screen and mug art are flat 2D cards rendered with Workbench;
fabric, wood and the night city are drawn with numpy. Everything is written to
assets/textures/room/ and packed into the .blend so the GLB embeds it.
"""
import math
from pathlib import Path

import bpy
import numpy as np

FONTS = Path(bpy.utils.system_resource('DATAFILES')) / 'fonts'
RNG = np.random.default_rng(7)


def srgb(r, g, b):
    return tuple((c / 255) ** 2.2 for c in (r, g, b)) + (1.0,)


# ------------------------------------------------------------------ card renderer

class Card:
    def __init__(self, name, width, height, ppu=200):
        self.name, self.width, self.height, self.ppu = name, width, height, ppu
        self.scene = bpy.data.scenes.new(f'Card_{name}')
        scene = self.scene
        scene.render.engine = 'BLENDER_WORKBENCH'
        scene.display.shading.light = 'FLAT'
        scene.display.shading.color_type = 'MATERIAL'
        scene.display.render_aa = '8'
        scene.view_settings.view_transform = 'Standard'
        scene.render.resolution_x = int(width * ppu)
        scene.render.resolution_y = int(height * ppu)
        scene.render.image_settings.file_format = 'PNG'
        scene.render.image_settings.color_mode = 'RGB'
        camera = bpy.data.objects.new(f'CardCamera_{name}', bpy.data.cameras.new(f'CardCamera_{name}'))
        camera.data.type = 'ORTHO'
        camera.data.ortho_scale = max(width, height)
        camera.location = (0, 0, 50)
        scene.collection.objects.link(camera)
        scene.camera = camera
        self.depth = 0.0
        self.fonts = {'sans': bpy.data.fonts.load(str(FONTS / 'Inter.woff2'), check_existing=True),
                      'mono': bpy.data.fonts.load(str(FONTS / 'DejaVuSansMono.woff2'), check_existing=True)}

    def _material(self, color):
        mat = bpy.data.materials.new(f'{self.name}_flat')
        mat.diffuse_color = color if len(color) == 4 else (*color, 1)
        return mat

    def _link(self, obj, color):
        self.depth += 0.01
        obj.location.z = self.depth
        obj.data.materials.append(self._material(color))
        self.scene.collection.objects.link(obj)
        return obj

    def poly(self, points, color):
        data = bpy.data.meshes.new(f'{self.name}_poly')
        data.from_pydata([(x, y, 0) for x, y in points], [], [list(range(len(points)))])
        return self._link(bpy.data.objects.new(data.name, data), color)

    def rect(self, x, y, w, h, color, angle=0.0):
        c, s = math.cos(angle), math.sin(angle)
        corners = [(-w / 2, -h / 2), (w / 2, -h / 2), (w / 2, h / 2), (-w / 2, h / 2)]
        return self.poly([(x + px * c - py * s, y + px * s + py * c) for px, py in corners], color)

    def ellipse(self, x, y, rx, ry, color, segments=48):
        return self.poly([(x + rx * math.cos(2 * math.pi * i / segments), y + ry * math.sin(2 * math.pi * i / segments))
                          for i in range(segments)], color)

    def text(self, body, x, y, size, color, font='sans', align='CENTER', bold=0.0, angle=0.0, spacing=1.0):
        # Curve offset leaves stray strokes on some glyphs; stacked copies thicken flat text cleanly.
        offsets = [(0, 0)] + ([(bold * math.cos(a), bold * math.sin(a)) for a in np.linspace(0, 2 * math.pi, 8, endpoint=False)]
                              if bold else [])
        for dx, dy in offsets:
            data = bpy.data.curves.new(f'{self.name}_text', 'FONT')
            data.body = body
            data.font = self.fonts[font]
            data.size = size
            data.align_x = align
            data.align_y = 'CENTER'
            data.space_line = spacing
            obj = bpy.data.objects.new(data.name, data)
            obj.location = (x + dx, y + dy, 0)
            obj.rotation_euler.z = angle
            self._link(obj, color)
            self.depth -= 0.01
        self.depth += 0.01

    def save(self, folder):
        path = folder / f'{self.name}.png'
        self.scene.render.filepath = str(path)
        bpy.ops.render.render(write_still=True, scene=self.scene.name)
        for obj in list(self.scene.collection.objects):
            data = obj.data
            bpy.data.objects.remove(obj)
            if data and data.users == 0:
                (bpy.data.cameras if isinstance(data, bpy.types.Camera) else
                 bpy.data.curves if isinstance(data, bpy.types.Curve) else bpy.data.meshes).remove(data)
        bpy.data.scenes.remove(self.scene)
        return path


def poster_frame(card, background):
    card.rect(0, 0, card.width, card.height, srgb(244, 242, 236))
    card.rect(0, 0, card.width - 0.24, card.height - 0.24, background)


def hero(card, x, base, suit, cape, skin=srgb(236, 196, 172), flip=1):
    dark = srgb(40, 30, 28)
    card.poly([(x - 0.46 * flip, base + 0.1), (x - 0.2 * flip, base + 1.6), (x + 0.2 * flip, base + 1.6), (x + 0.4 * flip, base + 0.05)], cape)
    card.rect(x - 0.11, base + 0.45, 0.15, 0.9, suit)
    card.rect(x + 0.11, base + 0.45, 0.15, 0.9, suit)
    card.rect(x - 0.11, base + 0.06, 0.19, 0.14, dark)
    card.rect(x + 0.11, base + 0.06, 0.19, 0.14, dark)
    card.poly([(x - 0.26, base + 0.85), (x + 0.26, base + 0.85), (x + 0.36, base + 1.62), (x - 0.36, base + 1.62)], suit)
    card.rect(x, base + 0.9, 0.56, 0.09, dark)
    card.rect(x - 0.44, base + 1.28, 0.15, 0.6, suit, 0.25 * flip)
    card.rect(x + 0.44, base + 1.28, 0.15, 0.6, suit, -0.25 * flip)
    card.poly([(x, base + 1.12), (x + 0.16, base + 1.34), (x, base + 1.5), (x - 0.16, base + 1.34)], srgb(250, 214, 64))
    card.ellipse(x, base + 1.92, 0.21, 0.24, skin)
    card.poly([(x - 0.22, base + 1.98), (x - 0.15, base + 2.2), (x, base + 2.24), (x + 0.15, base + 2.2), (x + 0.22, base + 1.98),
               (x, base + 2.08)], dark)
    card.rect(x, base + 1.93, 0.42, 0.07, dark)


def poster_cruzados(folder):
    card = Card('poster_cruzados', 3, 4)
    poster_frame(card, srgb(126, 186, 232))
    for i in range(14):
        a = i / 14 * 2 * math.pi
        card.poly([(0, -0.2), (3 * math.cos(a), -0.2 + 3 * math.sin(a)), (3 * math.cos(a + 0.18), -0.2 + 3 * math.sin(a + 0.18))],
                  srgb(170, 214, 244))
    card.rect(0, 1.35, 2.76, 1.02, srgb(244, 242, 236))
    card.text('CRUZADOS\nDEL CÓDIGO', 0.12, 1.37, 0.42, srgb(24, 52, 110), bold=0.012, spacing=0.9)
    card.rect(-1.1, 1.35, 0.42, 0.72, srgb(210, 225, 240))
    card.ellipse(-1.1, 1.45, 0.12, 0.14, srgb(236, 196, 172))
    hero(card, -0.55, -1.7, srgb(52, 92, 196), srgb(210, 36, 40))
    hero(card, 0.6, -1.7, srgb(88, 78, 96), srgb(150, 30, 40), flip=-1)
    return card.save(folder)


def poster_bug_hunter(folder):
    card = Card('poster_bug_hunter', 3, 4)
    poster_frame(card, srgb(200, 40, 40))
    card.ellipse(0, 0.25, 1.05, 1.05, srgb(250, 226, 120))
    card.rect(0, 1.5, 2.76, 0.62, srgb(22, 20, 26))
    card.text('BUG HUNTER', 0, 1.5, 0.4, srgb(250, 210, 40), bold=0.014)
    black = srgb(26, 22, 30)
    for side in (-1, 1):
        for i, y in enumerate((0.5, 0.15, -0.2)):
            card.rect(side * 0.55, y, 0.62, 0.07, black, side * (0.5 - 0.4 * i))
        card.rect(side * 0.18, 1.0, 0.05, 0.4, black, -side * 0.5)
    card.ellipse(0, 0.1, 0.36, 0.56, black)
    card.ellipse(0, 0.75, 0.22, 0.2, black)
    card.rect(0, 0.05, 0.02, 0.9, srgb(200, 40, 40))
    card.rect(0, -1.35, 2.2, 0.5, srgb(22, 20, 26))
    card.text('NIVEL: SENIOR', 0, -1.35, 0.24, srgb(244, 242, 236), bold=0.006)
    return card.save(folder)


def poster_merge_conflict(folder):
    card = Card('poster_merge_conflict', 3, 4)
    poster_frame(card, srgb(118, 178, 232))
    for x, y, r in ((-0.9, 0.9, 0.3), (-0.6, 0.95, 0.25), (0.8, 0.6, 0.28), (1.05, 0.62, 0.2)):
        card.ellipse(x, y, r, r * 0.7, srgb(240, 246, 252))
    for x, w, h in ((-1.1, 0.5, 1.2), (-0.55, 0.45, 1.7), (0.0, 0.5, 1.0), (0.5, 0.45, 1.5), (1.05, 0.5, 1.1)):
        card.rect(x, -1.76 + h / 2, w, h, srgb(70, 84, 120))
        for wy in np.arange(-1.6, -1.76 + h - 0.1, 0.22):
            for wx in (-0.1, 0.1):
                card.rect(x + wx, wy, 0.08, 0.1, srgb(250, 214, 90))
    card.poly([(-1.25, 0.1), (-0.3, 0.1), (-0.3, -0.05), (0.0, 0.25), (-0.3, 0.55), (-0.3, 0.4), (-1.25, 0.4)], srgb(60, 200, 110))
    card.poly([(1.25, 0.1), (0.3, 0.1), (0.3, -0.05), (0.0, 0.25), (0.3, 0.55), (0.3, 0.4), (1.25, 0.4)], srgb(240, 90, 60))
    star = [(0.62 * (1 if i % 2 == 0 else 0.5) * math.cos(i * math.pi / 8), 0.25 + 0.62 * (1 if i % 2 == 0 else 0.5) * math.sin(i * math.pi / 8))
            for i in range(16)]
    card.poly(star, srgb(252, 220, 60))
    card.text('¡BOOM!', 0, 0.25, 0.2, srgb(200, 30, 30), bold=0.01)
    card.text('MERGE\nCONFLICT', 0.02, 1.33, 0.46, srgb(190, 30, 30), bold=0.03, spacing=0.9)
    card.text('MERGE\nCONFLICT', 0, 1.35, 0.46, srgb(252, 214, 50), bold=0.012, spacing=0.9)
    return card.save(folder)


def poster_404(folder):
    card = Card('poster_404', 3, 4)
    poster_frame(card, srgb(36, 40, 82))
    card.text('404:', 0, 0.95, 1.0, srgb(236, 236, 244), bold=0.02)
    card.text('DESCANSO NO\nENCONTRADO', 0, -0.2, 0.3, srgb(236, 236, 244), bold=0.008, spacing=0.95)
    card.rect(0, -1.05, 2.2, 0.03, srgb(120, 124, 170))
    card.rect(0, -1.45, 1.5, 0.14, srgb(214, 60, 60))
    card.rect(-0.62, -1.3, 0.26, 0.2, srgb(236, 236, 244))
    card.rect(0.12, -1.33, 1.1, 0.12, srgb(150, 40, 52))
    card.rect(-0.72, -1.62, 0.07, 0.2, srgb(120, 124, 170))
    card.rect(0.72, -1.62, 0.07, 0.2, srgb(120, 124, 170))
    return card.save(folder)


CODE = [
    ('const dev = await cafe();', 'purple'), ('if (!dev.rested) {', 'purple'), ('  git.commit("fix: todo");', 'green'),
    ('  git.push();', 'green'), ('}', 'purple'), ('// TODO: dormir', 'grey'), ('pnpm run dev', 'orange'),
    ('export function ship() {', 'purple'), ('  return deploy(main);', 'blue'), ('}', 'purple'), ('npm i sleep  // 404', 'grey'),
]
PALETTE = {'purple': srgb(190, 150, 250), 'green': srgb(120, 220, 150), 'grey': srgb(120, 116, 140),
           'orange': srgb(250, 170, 90), 'blue': srgb(120, 180, 250)}


def desk_mat(folder):
    card = Card('desk_mat', 4, 2.4, ppu=256)
    card.rect(0, 0, 4, 2.4, srgb(28, 24, 40))
    card.rect(0, 0, 3.88, 2.28, srgb(34, 30, 50))
    for i, (line, color) in enumerate(CODE[:8]):
        card.text(line, -1.75, 0.95 - i * 0.26, 0.13, PALETTE[color], font='mono', align='LEFT')
    return card.save(folder)


def laptop_screen(folder):
    card = Card('laptop_screen', 3.2, 2, ppu=200)
    card.rect(0, 0, 3.2, 2, srgb(22, 20, 34))
    card.rect(-1.35, 0, 0.5, 2, srgb(30, 28, 46))
    card.rect(0, 0.92, 3.2, 0.16, srgb(40, 36, 60))
    for i in range(6):
        card.rect(-1.35, 0.7 - i * 0.2, 0.36, 0.06, srgb(80, 74, 110))
    for i, (line, color) in enumerate(CODE):
        card.text(line, -1.0, 0.72 - i * 0.15, 0.085, PALETTE[color], font='mono', align='LEFT')
    return card.save(folder)


def mug_art(folder):
    card = Card('mug_art', 4, 1.6, ppu=200)
    card.rect(0, 0, 4, 1.6, srgb(240, 238, 234))
    card.text('Git\npush', 0, 0, 0.42, srgb(40, 36, 44), bold=0.006, spacing=0.9)
    return card.save(folder)


# ------------------------------------------------------------------ procedural

def save_array(name, pixels, folder):
    h, w = pixels.shape[:2]
    rgba = np.concatenate([pixels, np.ones((h, w, 1), np.float32)], axis=2) if pixels.shape[2] == 3 else pixels
    image = bpy.data.images.new(name, w, h, alpha=False)
    image.pixels.foreach_set(np.ascontiguousarray(rgba[::-1], np.float32).ravel())
    path = folder / f'{name}.png'
    image.filepath_raw = str(path)
    image.file_format = 'PNG'
    image.save()
    bpy.data.images.remove(image)
    return path


def stamp_line(img, a, b, width, color):
    n = int(max(abs(b[0] - a[0]), abs(b[1] - a[1]))) + 1
    h, w = img.shape[:2]
    for t in np.linspace(0, 1, n):
        x, y = int(a[0] + (b[0] - a[0]) * t), int(a[1] + (b[1] - a[1]) * t)
        img[max(0, y - width):min(h, y + width + 1), max(0, x - width):min(w, x + width + 1)] = color


def stamp_disc(img, c, r, color, hole=None):
    h, w = img.shape[:2]
    yy, xx = np.ogrid[:h, :w]
    d = (xx - c[0]) ** 2 + (yy - c[1]) ** 2
    img[d <= r * r] = color
    if hole is not None:
        img[d <= (r * 0.45) ** 2] = hole


def circuit(folder, size=1024):
    bg, trace = np.array([0.12, 0.09, 0.19]), np.array([0.40, 0.34, 0.52])
    img = np.ones((size, size, 3), np.float32) * bg
    step = 32
    for _ in range(90):
        x, y = RNG.integers(1, size // step) * step, RNG.integers(1, size // step) * step
        direction = RNG.choice([(1, 0), (-1, 0), (0, 1), (0, -1)])
        start = (x, y)
        for _ in range(RNG.integers(2, 6)):
            length = RNG.integers(2, 7) * step
            if RNG.random() < 0.5:
                direction = (direction[0] or RNG.choice([-1, 1]), direction[1] or RNG.choice([-1, 1]))
            end = (int(np.clip(x + direction[0] * length, 8, size - 8)), int(np.clip(y + direction[1] * length, 8, size - 8)))
            stamp_line(img, (x, y), end, 2, trace)
            x, y = end
            if abs(direction[0]) + abs(direction[1]) == 2:
                direction = (direction[0], 0) if RNG.random() < 0.5 else (0, direction[1])
        stamp_disc(img, start, 7, trace, bg)
        stamp_disc(img, (x, y), 7, trace, bg)
    c = size // 2
    img[c - 90:c + 90, c - 90:c + 90] = trace * 0.8
    img[c - 76:c + 76, c - 76:c + 76] = bg * 1.2
    for i in range(-70, 71, 20):
        for side in (-1, 1):
            stamp_line(img, (c + i, c + side * 90), (c + i, c + side * 130), 2, trace)
            stamp_line(img, (c + side * 90, c + i), (c + side * 130, c + i), 2, trace)
    return save_array('circuit', img, folder)


def wood(folder, w=1024, h=256):
    noise = RNG.normal(size=(h, w))
    for axis, k in ((1, 64), (0, 3)):
        kernel = np.ones(k) / k
        noise = np.apply_along_axis(lambda r: np.convolve(r, kernel, mode='same'), axis, noise)
    y = np.arange(h)[:, None] / h
    grain = np.sin((y * 38 + noise * 6.0) * math.pi) * 0.5 + 0.5
    tone = 0.82 + 0.18 * grain ** 3 + 0.06 * noise / (np.abs(noise).max() + 1e-6)
    img = np.stack([tone * 1.0, tone * 0.80, tone * 0.68], axis=2).astype(np.float32)
    return save_array('wood', np.clip(img, 0, 1), folder)


def night_city(folder, w=1024, h=512):
    y = np.linspace(0, 1, h)[:, None, None]
    img = (np.array([0.02, 0.03, 0.09]) * (1 - y) + np.array([0.08, 0.08, 0.2]) * y) * np.ones((h, w, 3))
    img = img[::-1].astype(np.float32)
    for _ in range(90):
        img[RNG.integers(0, h // 2), RNG.integers(0, w)] = 0.9
    x = 0
    while x < w:
        bw, bh = int(RNG.integers(70, 160)), int(RNG.integers(140, 420))
        shade = RNG.uniform(0.03, 0.07)
        img[h - bh:, x:x + bw] = (shade, shade, shade * 2.2)
        for wy in range(h - bh + 18, h - 10, 34):
            for wx in range(x + 12, x + bw - 16, 26):
                if RNG.random() < 0.38:
                    img[wy:wy + 14, wx:wx + 12] = (0.95, 0.78, 0.38)
        x += bw + int(RNG.integers(4, 18))
    return save_array('night_city', img, folder)


def build_all(folder):
    folder.mkdir(parents=True, exist_ok=True)
    makers = [poster_cruzados, poster_bug_hunter, poster_merge_conflict, poster_404, desk_mat, laptop_screen, mug_art,
              circuit, wood, night_city]
    return {path.stem: path for path in (make(folder) for make in makers)}
