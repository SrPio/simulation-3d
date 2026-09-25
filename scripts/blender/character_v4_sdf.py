"""Signed-distance modelling helpers for the V4 character.

Shapes are numpy functions of broadcastable X, Y, Z arrays (Blender Z-up, meters).
Fields are sampled on dense grids and polygonized with OpenVDB.
"""
import math

import bmesh
import bpy
import numpy as np
import openvdb as vdb


# ---------------------------------------------------------------- grid / mesh

class Grid:
    def __init__(self, lo, hi, voxel):
        self.voxel = float(voxel)
        self.origin = np.array(lo, dtype=np.float64)
        self.shape = tuple(int(math.ceil((h - l) / voxel)) + 1 for l, h in zip(lo, hi))

    def axes(self):
        return [(self.origin[i] + np.arange(self.shape[i]) * self.voxel).astype(np.float32) for i in range(3)]


def evaluate(fn, grid, chunk=16):
    xs, ys, zs = grid.axes()
    out = np.empty(grid.shape, np.float32)
    X, Y = xs[:, None, None], ys[None, :, None]
    for k in range(0, len(zs), chunk):
        Z = zs[None, None, k:k + chunk]
        out[:, :, k:k + chunk] = np.broadcast_to(fn(X, Y, Z), (len(xs), len(ys), Z.shape[2]))
    return out


def polygonize(values, grid, adaptivity=0.0):
    band = 3 * grid.voxel
    field = vdb.FloatGrid()
    field.background = band
    field.copyFromArray(np.clip(values, -band, band).astype(np.float32))
    points, triangles, quads = field.convertToPolygons(0.0, adaptivity)
    return grid.origin + points.astype(np.float64) * grid.voxel, triangles, quads


def exact_sdf(points, triangles, quads, grid, half_width=12):
    """Exact distance field of a polygon soup sampled on grid (meters, narrow band)."""
    index_points = ((points - grid.origin) / grid.voxel).astype(np.float32)
    level_set = vdb.FloatGrid.createLevelSetFromPolygons(
        index_points, triangles=triangles.astype(np.uint32), quads=quads.astype(np.uint32),
        transform=vdb.createLinearTransform(1.0), halfWidth=float(half_width))
    values = np.full(grid.shape, float(half_width), np.float32)
    level_set.copyToArray(values, ijk=(0, 0, 0))
    return values * grid.voxel


def trilinear(values, grid, X, Y, Z):
    coords = []
    for axis, P in enumerate((X, Y, Z)):
        f = np.clip((P - grid.origin[axis]) / grid.voxel, 0, grid.shape[axis] - 1.001).astype(np.float32)
        i = np.floor(f).astype(np.int32)
        coords.append((i, f - i))
    (i, fx), (j, fy), (k, fz) = coords
    out = 0
    for di, wx in ((0, 1 - fx), (1, fx)):
        for dj, wy in ((0, 1 - fy), (1, fy)):
            for dk, wz in ((0, 1 - fz), (1, fz)):
                out = out + values[i + di, j + dj, k + dk] * (wx * wy * wz)
    return out


def field_mesh(name, fn, lo, hi, voxel, mat, parent=None, ratio=None, adaptivity=0.0):
    grid = Grid(lo, hi, voxel)
    values = evaluate(fn, grid)
    if values.min() > 0:
        raise RuntimeError(f'{name}: empty field')
    faces = {'-x': values[0], '+x': values[-1], '-y': values[:, 0], '+y': values[:, -1],
             '-z': values[:, :, 0], '+z': values[:, :, -1]}
    touching = [side for side, face in faces.items() if face.min() <= 0]
    if touching:
        raise RuntimeError(f'{name}: surface touches its bounding box on {touching}')
    points, triangles, quads = polygonize(values, grid, adaptivity)
    obj = build_mesh(name, points, triangles, quads, mat, parent, ratio)
    return obj, (points, triangles, quads)


def build_mesh(name, points, triangles, quads, mat, parent=None, ratio=None):
    faces = [*quads.tolist(), *triangles.tolist()]
    data = bpy.data.meshes.new(name)
    data.from_pydata(points.tolist(), [], faces)
    data.update()
    bm = bmesh.new()
    bm.from_mesh(data)
    if bm.calc_volume(signed=True) < 0:
        bmesh.ops.reverse_faces(bm, faces=list(bm.faces))
    bm.to_mesh(data)
    bm.free()
    obj = bpy.data.objects.new(name, data)
    bpy.context.collection.objects.link(obj)
    if ratio and ratio > 1:
        ratio = ratio / max(len(data.polygons), 1)
    if ratio and ratio < 1:
        mod = obj.modifiers.new('Reduce', 'DECIMATE')
        mod.ratio = ratio
        mod.use_collapse_triangulate = False
        depsgraph = bpy.context.evaluated_depsgraph_get()
        reduced = bpy.data.meshes.new_from_object(obj.evaluated_get(depsgraph))
        obj.modifiers.clear()
        old = obj.data
        obj.data = reduced
        bpy.data.meshes.remove(old)
        reduced.name = name
    obj.data.polygons.foreach_set('use_smooth', np.ones(len(obj.data.polygons), bool))
    obj.data.update()
    if mat:
        obj.data.materials.append(mat)
    if parent:
        obj.parent = parent
    return obj


# ---------------------------------------------------------------- primitives

def length(*c):
    return np.sqrt(sum(v * v for v in c))


def smin(a, b, k):
    if k <= 0:
        return np.minimum(a, b)
    h = np.clip(0.5 + 0.5 * (b - a) / k, 0, 1)
    return b * (1 - h) + a * h - k * h * (1 - h)


def smax(a, b, k):
    return -smin(-a, -b, k)


def smoothstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)


def ellipsoid(X, Y, Z, c, r):
    px, py, pz = (X - c[0]) / r[0], (Y - c[1]) / r[1], (Z - c[2]) / r[2]
    k0 = length(px, py, pz)
    k1 = length(px / r[0], py / r[1], pz / r[2])
    return k0 * (k0 - 1) / np.maximum(k1, 1e-9)


def round_cone(X, Y, Z, a, b, r1, r2):
    a = np.asarray(a, np.float64)
    b = np.asarray(b, np.float64)
    ba = b - a
    l2 = float(ba @ ba)
    rr = r1 - r2
    a2 = l2 - rr * rr
    il2 = 1.0 / l2
    pax, pay, paz = X - a[0], Y - a[1], Z - a[2]
    y = pax * ba[0] + pay * ba[1] + paz * ba[2]
    z = y - l2
    qx, qy, qz = pax * l2 - ba[0] * y, pay * l2 - ba[1] * y, paz * l2 - ba[2] * y
    x2 = qx * qx + qy * qy + qz * qz
    y2 = y * y * l2
    z2 = z * z * l2
    k = math.copysign(1, rr) * rr * rr * x2
    d_mid = (np.sqrt(np.maximum(x2 * a2 * il2, 0)) + y * rr) * il2 - r1
    d_end = np.sqrt(x2 + z2) * il2 - r2
    d_start = np.sqrt(x2 + y2) * il2 - r1
    return np.where(np.sign(z) * a2 * z2 > k, d_end, np.where(np.sign(y) * a2 * y2 < k, d_start, d_mid))


def chain(X, Y, Z, points, radii, k=0.0):
    d = None
    for i in range(len(points) - 1):
        seg = round_cone(X, Y, Z, points[i], points[i + 1], radii[i], radii[i + 1])
        d = seg if d is None else smin(d, seg, k)
    return d


def round_box(X, Y, Z, c, half, r):
    qx = np.abs(X - c[0]) - half[0] + r
    qy = np.abs(Y - c[1]) - half[1] + r
    qz = np.abs(Z - c[2]) - half[2] + r
    outside = length(np.maximum(qx, 0), np.maximum(qy, 0), np.maximum(qz, 0))
    return outside + np.minimum(np.maximum(qx, np.maximum(qy, qz)), 0) - r


def rotate(A, B, angle, ca=0.0, cb=0.0):
    c, s = math.cos(angle), math.sin(angle)
    a, b = A - ca, B - cb
    return ca + a * c - b * s, cb + a * s + b * c


def segment_distance_2d(PX, PY, poly, closed=False):
    pts = list(poly) + ([poly[0]] if closed else [])
    best = None
    for (ax, ay), (bx, by) in zip(pts, pts[1:]):
        dx, dy = bx - ax, by - ay
        l2 = dx * dx + dy * dy
        t = np.clip(((PX - ax) * dx + (PY - ay) * dy) / l2, 0, 1)
        d = length(PX - ax - t * dx, PY - ay - t * dy)
        best = d if best is None else np.minimum(best, d)
    return best


def polygon_sdf_2d(PX, PY, poly):
    d = segment_distance_2d(PX, PY, poly, closed=True)
    inside = np.zeros(np.broadcast(PX, PY).shape, bool)
    for (ax, ay), (bx, by) in zip(poly, poly[1:] + poly[:1]):
        cond = (ay > PY) != (by > PY)
        xcross = ax + (PY - ay) * (bx - ax) / ((by - ay) if by != ay else 1e-12)
        inside ^= cond & (PX < xcross)
    return np.where(inside, -d, d)


def smooth_curve(points, samples=24):
    """Catmull-Rom resampling of a list of tuples (any dimension)."""
    pts = [np.asarray(p, np.float64) for p in points]
    ext = [2 * pts[0] - pts[1], *pts, 2 * pts[-1] - pts[-2]]
    out = []
    for i in range(1, len(ext) - 2):
        p0, p1, p2, p3 = ext[i - 1], ext[i], ext[i + 1], ext[i + 2]
        for s in range(samples):
            t = s / samples
            out.append(0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t
                              + (-p0 + 3 * p1 - 3 * p2 + p3) * t ** 3))
    out.append(pts[-1])
    return [tuple(p) for p in out]


class Profile:
    """Smoothly interpolated table keyed by its first column."""

    def __init__(self, rows, samples=512):
        rows = np.asarray(rows, np.float64)
        dense = np.asarray(smooth_curve([tuple(r) for r in rows], max(4, samples // len(rows))))
        order = np.argsort(dense[:, 0])
        self.table = dense[order]
        self.lo, self.hi = rows[0, 0], rows[-1, 0]

    def __call__(self, t, column):
        return np.interp(t, self.table[:, 0], self.table[:, column]).astype(np.float32)


def loft(X, Y, Z, profile, n_front=2.2, n_back=2.2, cx=0.0):
    """Superelliptic loft keyed on Z; profile columns: z, half-width, front y, back y, center y."""
    zc = np.clip(Z, profile.lo, profile.hi)
    a = np.maximum(profile(zc, 1), 1e-4)
    yf, yb, cy = profile(zc, 2), profile(zc, 3), profile(zc, 4)
    front = Y < cy
    depth = np.maximum(np.where(front, cy - yf, yb - cy), 1e-4)
    n = np.where(front, n_front, n_back)
    u = np.abs(X - cx) / a
    v = np.abs(Y - cy) / depth
    rho = (u ** n + v ** n) ** (1 / n)
    d = (rho - 1) * np.minimum(a, depth)
    return np.maximum(d, np.maximum(profile.lo - Z, Z - profile.hi))


def loft_front_y(profile, x, z, n_front=2.2):
    a = float(profile(z, 1))
    yf, cy = float(profile(z, 2)), float(profile(z, 4))
    u = min(abs(x) / a, 0.999)
    return cy - (cy - yf) * (1 - u ** n_front) ** (1 / n_front)
