"""Shared helpers for the scheduled jobs: polite HTTP, geometry tests, and Supabase writes."""
import json, math, os, sys, time, urllib.parse, urllib.request
from datetime import datetime, timezone

UA = {'User-Agent': '(ca-outdoors-land, scheduled-refresh)', 'Accept': 'application/geo+json, application/json'}
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SITE_DATA = os.path.join(ROOT, 'site', 'data')

def get(url, tries=3, timeout=30):
    for i in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=timeout) as r:
                return json.load(r)
        except Exception:
            if i == tries - 1: return None
            time.sleep(1.5 * (i + 1))

def require_supabase_in_ci():
    """On GitHub Actions, stop early (successfully) until the Supabase secrets are added, so scheduled
    runs don't spend Actions minutes on results that have nowhere to go."""
    if os.environ.get('GITHUB_ACTIONS') == 'true' and not (os.environ.get('SUPABASE_URL') and os.environ.get('SUPABASE_SERVICE_ROLE_KEY')):
        print('Supabase secrets (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY) are not set yet; skipping this run. See README, step 2.')
        raise SystemExit(0)

def now_iso(): return datetime.now(timezone.utc).isoformat(timespec='seconds')

def km(a, b, c, d):
    p = math.pi / 180
    return 6371 * math.hypot((d - b) * p * math.cos((a + c) / 2 * p), (c - a) * p)

def polys(g):
    if not g: return []
    if g['type'] == 'Polygon': return [g['coordinates']]
    if g['type'] == 'MultiPolygon': return g['coordinates']
    if g['type'] == 'GeometryCollection': return [p for x in g['geometries'] for p in polys(x)]
    return []

def in_ring(x, y, r):
    c = False
    for i in range(len(r)):
        x1, y1 = r[i][0], r[i][1]; x2, y2 = r[i - 1][0], r[i - 1][1]
        if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1) + x1: c = not c
    return c

def in_geom(lon, lat, g):
    for p in polys(g):
        if p and in_ring(lon, lat, p[0]) and not any(in_ring(lon, lat, h) for h in p[1:]): return True
    return False

def bbox(g):
    xs = [c[0] for p in polys(g) for c in p[0]]; ys = [c[1] for p in polys(g) for c in p[0]]
    return (min(xs), min(ys), max(xs), max(ys)) if xs else None

def pins():
    """Every map pin that gets weather/status/alerts: [{id, n, lat, lon, kind, rid?}]"""
    rec = json.load(open(os.path.join(SITE_DATA, 'rec.json'))); fs = json.load(open(os.path.join(SITE_DATA, 'fs.json')))
    out = []
    for kind, arr in (('ra', rec['sites']), ('cg', rec['camps']), ('th', rec['th']), ('fc', fs['fsc']), ('fh', fs['fsh'])):
        for o in arr: out.append({'id': o['id'], 'n': o['n'], 'lat': o['ll'][0], 'lon': o['ll'][1], 'kind': kind, 'rid': o.get('rid')})
    return out

def upsert_feeds(rows, out_dir=None):
    """Write [{'key', 'data'}] to the Supabase `feeds` table (or to out_dir as JSON when testing locally)."""
    url = os.environ.get('SUPABASE_URL'); key = os.environ.get('SUPABASE_SERVICE_ROLE_KEY')
    if not (url and key):
        out_dir = out_dir or os.path.join(ROOT, 'out')
        os.makedirs(out_dir, exist_ok=True)
        for r in rows: json.dump(r['data'], open(os.path.join(out_dir, r['key'].replace(':', '_') + '.json'), 'w'), separators=(',', ':'))
        print('No Supabase credentials: wrote %d feeds to %s' % (len(rows), out_dir), file=sys.stderr); return
    stamp = now_iso(); batch, size = [], 0
    def send(b):
        body = json.dumps([{'key': r['key'], 'data': r['data'], 'updated_at': stamp} for r in b]).encode()
        req = urllib.request.Request(url.rstrip('/') + '/rest/v1/feeds', data=body, method='POST', headers={
            'apikey': key, 'Content-Type': 'application/json', 'Prefer': 'resolution=merge-duplicates,return=minimal',
            **({'Authorization': 'Bearer ' + key} if key.startswith('eyJ') else {})})   # new sb_secret_ keys: apikey header only
        for i in range(3):
            try:
                urllib.request.urlopen(req, timeout=60).read(); return
            except Exception as e:
                if i == 2: raise
                time.sleep(3)
    for r in rows:
        n = len(json.dumps(r['data']))
        if batch and size + n > 900_000: send(batch); batch, size = [], 0
        batch.append(r); size += n
    if batch: send(batch)
    print('Upserted %d feeds' % len(rows), file=sys.stderr)
