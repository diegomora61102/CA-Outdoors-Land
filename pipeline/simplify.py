"""Lighter copies of the heaviest map layers for zoomed-out views (no extra libraries needed).

The map draws these instead of the full-detail shapes until you zoom in, which is where most of the
pan/zoom lag came from. Tolerances are in degrees: about 0.004 is 400 m, under a pixel at statewide zoom.
"""

def _rdp(pts, tol):
    """Ramer-Douglas-Peucker line simplification (iterative, keeps first and last points)."""
    n = len(pts)
    if n < 3: return pts[:]
    keep = [False] * n; keep[0] = keep[-1] = True
    stack = [(0, n - 1)]; t2 = tol * tol
    while stack:
        a, b = stack.pop()
        ax, ay = pts[a]; bx, by = pts[b]
        dx, dy = bx - ax, by - ay; dd = dx * dx + dy * dy
        best, idx = -1.0, -1
        for i in range(a + 1, b):
            px, py = pts[i]
            if dd == 0: d = (px - ax) ** 2 + (py - ay) ** 2
            else:
                t = ((px - ax) * dx + (py - ay) * dy) / dd
                t = 0 if t < 0 else 1 if t > 1 else t
                qx, qy = ax + t * dx, ay + t * dy
                d = (px - qx) ** 2 + (py - qy) ** 2
            if d > best: best, idx = d, i
        if best > t2:
            keep[idx] = True
            stack.append((a, idx)); stack.append((idx, b))
    return [p for p, k in zip(pts, keep) if k]

def _ring(r, tol):
    xs = [p[0] for p in r]; ys = [p[1] for p in r]
    if max(xs) - min(xs) < tol * 1.5 and max(ys) - min(ys) < tol * 1.5: return None   # smaller than a pixel: drop
    s = _rdp(r, tol)
    if len(s) < 4: return None
    if s[0] != s[-1]: s.append(s[0])
    return [[round(x, 4), round(y, 4)] for x, y in s]

def polygons(fc, tol):
    out = []
    for f in fc['features']:
        g = f['geometry']; ps = g['coordinates'] if g['type'] == 'MultiPolygon' else [g['coordinates']]
        keep = []
        for p in ps:
            outer = _ring(p[0], tol)
            if not outer: continue
            keep.append([outer] + [h for h in (_ring(h, tol) for h in p[1:]) if h])
        if keep: out.append({'type': 'Feature', 'properties': f['properties'], 'geometry': {'type': 'MultiPolygon', 'coordinates': keep}})
    return {'type': 'FeatureCollection', 'features': out}

def lines(fc, tol):
    out = []
    for f in fc['features']:
        g = f['geometry']; ls = g['coordinates'] if g['type'] == 'MultiLineString' else [g['coordinates']]
        keep = [[[round(x, 4), round(y, 4)] for x, y in _rdp(l, tol)] for l in ls if len(l) >= 2]
        keep = [l for l in keep if len(l) >= 2]
        if keep: out.append({'type': 'Feature', 'properties': f['properties'], 'geometry': {'type': 'MultiLineString', 'coordinates': keep}})
    return {'type': 'FeatureCollection', 'features': out}

def points(fc):
    n = 0
    for f in fc['features']:
        g = f['geometry']; c = g['coordinates']
        n += sum(len(r) for p in c for r in p) if g['type'] == 'MultiPolygon' else sum(len(l) for l in c)
    return n
