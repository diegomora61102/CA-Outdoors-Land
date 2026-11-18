"""Monthly: photos for campgrounds and trails, plus small thumbnails for the campground list.

Sources, best first:
  1. Recreation.gov (RIDB) galleries for places with a Recreation.gov id. Needs a free RIDB API key in
     RIDB_API_KEY (ridb.recreation.gov -> sign in -> Profile). Skipped without it.
  2. Photos on the Forest Service's own campground and trail pages (no key needed).
  3. Photos embedded in BLM descriptions (already in the data).
Writes pipeline/state/photos.json {siteId: [url, ...]} and site/thumbs/<siteId>.webp (about 15 KB each).
"""
import io, json, os, re, sys, time, urllib.parse, urllib.request, concurrent.futures as cf
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import ROOT, SITE_DATA

OUT = os.path.join(ROOT, 'pipeline', 'state', 'photos.json')
THUMBS = os.path.join(ROOT, 'site', 'thumbs')
UA = {'User-Agent': 'Mozilla/5.0 (compatible; ca-outdoors-land monthly photo refresh)'}
SKIP_NAME = re.compile(r'office|station|logo|seal|flag|map|brochure|flyer|closure|order|notice|placeholder|icon|badge|qr|kiosk|sign[-_ ]?board', re.I)

def fetch(url, binary=False, headers=None, timeout=40):
    req = urllib.request.Request(url, headers={**UA, **(headers or {})})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        data = r.read()
        return data if binary else data.decode('utf8', 'replace')

def ridb(fid, key):
    for i in range(3):
        try:
            d = json.loads(fetch('https://ridb.recreation.gov/api/v1/facilities/%s/media?limit=50' % fid, headers={'apikey': key, 'Accept': 'application/json'}))
            items = [m for m in d.get('RECDATA') or [] if (m.get('MediaType') or '').lower() == 'image' and (m.get('URL') or '').startswith('https://')]
            items.sort(key=lambda m: not m.get('IsPrimary'))
            return [m['URL'] for m in items][:8]
        except urllib.error.HTTPError as e:
            if e.code in (400, 404): return []
            time.sleep(10 * (i + 1) if e.code == 429 else 2)
        except Exception:
            time.sleep(2)
    return None

def fs_page(url):
    """Photos on a new-style Forest Service page (fs.usda.gov/r05/...), as full-size image URLs."""
    try: h = fetch(url)
    except Exception: return None
    out = []
    for u in re.findall(r'(/sites/nfs/files/(?:styles/[^/]+/public/)?r05/[^"\'?\s]+\.(?:jpe?g|png|webp))', h, re.I):
        full = 'https://www.fs.usda.gov' + re.sub(r'/styles/[^/]+/public/', '/', u)
        if SKIP_NAME.search(urllib.parse.unquote(full.rsplit('/', 1)[-1])): continue
        if full not in out: out.append(full)
    return out[:8]

def thumb(sid, url):
    """Save a 320x240 WebP thumbnail of the place's first photo."""
    from PIL import Image, ImageOps
    path = os.path.join(THUMBS, sid + '.webp')
    try:
        im = Image.open(io.BytesIO(fetch(url, binary=True, timeout=60)))
        im = ImageOps.exif_transpose(im).convert('RGB')
        im = ImageOps.fit(im, (320, 240), Image.LANCZOS)
        im.save(path, 'WEBP', quality=72, method=5)
        return True
    except Exception as e:
        print('  thumbnail failed for', sid, str(e)[:80], file=sys.stderr); return False

def main():
    key = os.environ.get('RIDB_API_KEY')
    places = json.load(open(os.path.join(SITE_DATA, 'places.json')))
    old = json.load(open(OUT)) if os.path.exists(OUT) else {}
    todo = [o for arr in places.values() for o in arr]
    def gather(o):
        urls = []
        if key and o.get('fid'):
            r = ridb(o['fid'], key); urls += r if r is not None else old.get(o['id'], [])
        if '/r05/' in (o.get('url') or ''):
            r = fs_page(o['url'])
            if r is None: r = [u for u in old.get(o['id'], []) if 'fs.usda.gov' in u]   # page down this month: keep last month's
            urls += [u for u in r if u not in urls]
        urls += [u for u in o.get('img', []) if u not in urls and '/Internet/FSE_MEDIA/' not in u]
        return o['id'], urls[:8]
    with cf.ThreadPoolExecutor(4) as ex: res = dict(ex.map(gather, todo))
    # A photo on three or more places' pages is a district office or general forest picture, not this place.
    from collections import Counter
    uses = Counter(u for urls in res.values() for u in set(urls))
    res = {k: [u for u in v if uses[u] < 3] for k, v in res.items()}
    res = {k: v for k, v in res.items() if v}
    os.makedirs(THUMBS, exist_ok=True)
    keep = set()
    for sid, urls in res.items():
        path = os.path.join(THUMBS, sid + '.webp')
        if os.path.exists(path) and old.get(sid, [None])[0] == urls[0]: keep.add(sid); continue   # unchanged since last month
        for u in urls[:3]:   # first photo that downloads cleanly becomes the thumbnail
            if thumb(sid, u):
                if u != urls[0]: res[sid] = [u] + [x for x in urls if x != u]
                keep.add(sid); break
    for f in os.listdir(THUMBS):
        if f.endswith('.webp') and f[:-5] not in keep: os.remove(os.path.join(THUMBS, f))
    json.dump(res, open(OUT, 'w'), separators=(',', ':'), sort_keys=True)
    print('photos for %d of %d places, %d thumbnails%s' % (len(res), len(todo), len(keep), '' if key else ' (no RIDB key: Recreation.gov skipped)'))

if __name__ == '__main__': main()
