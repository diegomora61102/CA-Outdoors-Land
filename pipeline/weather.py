"""Refresh weather for every map pin and write per-area documents for the map's database.

Runs hourly from GitHub Actions. Reads pipeline/state/wx_sites.json and writes one `wx:<area>`
document per 1-degree area (plus `wx:meta`) to the Supabase `feeds` table.

Traffic design: one forecast request per NWS 2.5 km grid cell (pins share cells), one
"latest observation" request per weather station that is among a pin's nearest four, and
nothing per click: the page only reads the stored results.
"""
import json, math, os, sys, time, urllib.request, concurrent.futures as cf
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import upsert_feeds, ROOT
from datetime import datetime, timezone

UA = {'User-Agent': '(ca-public-lands-map, weather-refresh)', 'Accept': 'application/geo+json'}
LAPSE = 0.0065          # deg C per metre, standard atmosphere
DEW_LAPSE = 0.002       # deg C per metre for dewpoint
OBS_KM, OBS_DZ = 15, 250   # a station this close and this level counts as "at the site"
EST_KM, EST_N = 75, 4      # estimate from up to 4 stations within 75 km
MAX_AGE_H = 3

def get(url, tries=3):
    for i in range(tries):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=25) as r:
                return json.load(r)
        except Exception:
            if i == tries - 1: return None
            time.sleep(1.5 * (i + 1))

def km(a, b, c, d):
    p = math.pi / 180
    x = (d - b) * p * math.cos((a + c) / 2 * p); y = (c - a) * p
    return 6371 * math.hypot(x, y)

def c2f(c): return None if c is None else c * 9 / 5 + 32
def rh(t, td):
    if t is None or td is None: return None
    a, b = 17.625, 243.04
    return max(1, min(100, 100 * math.exp(a * td / (b + td)) / math.exp(a * t / (b + t))))

static = json.load(open(os.path.join(ROOT, 'pipeline', 'state', 'wx_sites.json')))
sites, stations = static['sites'], static['stations']
now = datetime.now(timezone.utc)

# ---- 1. Forecasts, one per grid cell ----
grids = sorted({tuple(s['g']) for s in sites if s.get('g')})
def fc(g):
    d = get('https://api.weather.gov/gridpoints/%s/%d,%d/forecast' % g)
    p = (d or {}).get('properties') or {}
    if not p.get('periods'): return g, None
    days = []; per = p['periods']
    i = 0
    while i < len(per) and len(days) < 7:
        a = per[i]
        if a['isDaytime']:
            b = per[i + 1] if i + 1 < len(per) and not per[i + 1]['isDaytime'] else None
            days.append({'d': a['name'][:3] if a['name'] not in ('Today', 'This Afternoon') else 'Today',
                         'hi': a['temperature'], 'lo': b['temperature'] if b else None,
                         'p': max((a.get('probabilityOfPrecipitation') or {}).get('value') or 0,
                                  ((b or {}).get('probabilityOfPrecipitation') or {}).get('value') or 0),
                         's': a['shortForecast'], 'sn': b['shortForecast'] if b else ''})
            i += 2 if b else 1
        else:  # forecast starts at night
            days.append({'d': 'Tonight', 'hi': None, 'lo': a['temperature'],
                         'p': (a.get('probabilityOfPrecipitation') or {}).get('value') or 0, 's': '', 'sn': a['shortForecast']})
            i += 1
    el = (p.get('elevation') or {}).get('value')
    return g, {'days': days, 'el': el, 'issued': p.get('updateTime') or p.get('generatedAt')}
with cf.ThreadPoolExecutor(6) as ex: F = dict(ex.map(fc, grids))
print('grids', len(grids), 'ok', sum(1 for v in F.values() if v), file=sys.stderr)

# ---- 2. Nearest stations per site, then latest observations for just those ----
st_list = [(k, v) for k, v in stations.items() if v.get('el') is not None]
for s in sites:
    near = []
    for k, v in st_list:
        if abs(v['lat'] - s['lat']) > 0.8 or abs(v['lon'] - s['lon']) > 1.0: continue
        dd = km(s['lat'], s['lon'], v['lat'], v['lon'])
        if dd <= EST_KM: near.append((dd, k))
    s['_near'] = [k for _, k in sorted(near)[:8]]   # fetch a few spares in case some are silent
def ob(k):
    d = get('https://api.weather.gov/stations/%s/observations/latest' % k)
    p = (d or {}).get('properties') or {}
    t = (p.get('temperature') or {}).get('value')
    ts = p.get('timestamp')
    if t is None or not ts: return k, None
    age = (now - datetime.fromisoformat(ts)).total_seconds() / 3600
    if age > MAX_AGE_H or age < -1: return k, None
    v = lambda f: (p.get(f) or {}).get('value')
    ws = v('windSpeed')  # km/h
    return k, {'t': t, 'td': v('dewpoint'), 'w': ws, 'wd': v('windDirection'), 'g': v('windGust'),
               'x': (p.get('textDescription') or '').strip(), 'age': round(age, 2)}
# Pass 1: each pin's 3 nearest stations. Pass 2: reach further only for pins still short of 2 readings.
O = {}
for depth in (3, 8):
    need = sorted({k for s in sites
                   if sum(1 for k in s['_near'] if O.get(k)) < 2
                   for k in s['_near'][:depth]} - set(O))
    with cf.ThreadPoolExecutor(8) as ex: O.update(ex.map(ob, need))
print('stations fetched', len(O), 'usable', sum(1 for v in O.values() if v), file=sys.stderr)
need = sorted(O)

def compass(deg):
    if deg is None: return ''
    return ['N','NE','E','SE','S','SW','W','NW'][int((deg + 22.5) // 45) % 8]

# ---- 3. Per-site current conditions + 7-day forecast ----
site_el = {}
for s in sites:
    f = F.get(tuple(s['g'])) if s.get('g') else None
    site_el[s['id']] = f['el'] if f and f['el'] is not None else None

def current(s):
    el = site_el[s['id']]
    cands = []
    for k in s['_near']:
        o = O.get(k)
        if not o: continue
        st = stations[k]; cands.append((km(s['lat'], s['lon'], st['lat'], st['lon']), k, st, o))
    if not cands: return None
    d0, k0, st0, o0 = cands[0]
    s['_cands'] = cands
    if d0 <= OBS_KM and (el is None or abs(st0['el'] - el) <= OBS_DZ):
        return {'src': 'obs', 'stn': st0['n'], 'km': round(d0, 1), 'age': o0['age'],
                't': round(c2f(o0['t'])), 'rh': round(rh(o0['t'], o0['td'])) if o0['td'] is not None else None,
                'w': round(o0['w'] / 1.609) if o0['w'] is not None else None, 'wd': compass(o0['wd']),
                'gu': round(o0['g'] / 1.609) if o0['g'] else None, 'x': o0['x']}
    use = cands[:EST_N]
    if len(use) < 2 and not (d0 <= 30 and (el is None or abs(st0['el'] - el) <= 300)):
        return None   # one distant or much lower station is not enough: fall back to the NWS hourly model
    W = [1 / max(d, 1) ** 2 for d, *_ in use]; sw = sum(W)
    def adj(st, val, rate): return val + (st['el'] - el) * rate if el is not None else val
    t = sum(w * adj(st, o['t'], LAPSE) for w, (d, k, st, o) in zip(W, use)) / sw
    tdp = [(w, adj(st, o['td'], DEW_LAPSE)) for w, (d, k, st, o) in zip(W, use) if o['td'] is not None]
    td = min(t, sum(w * x for w, x in tdp) / sum(w for w, _ in tdp)) if tdp else None
    wn = [(w, o['w']) for w, (d, k, st, o) in zip(W, use) if o['w'] is not None]
    wind = sum(w * x for w, x in wn) / sum(w for w, _ in wn) if wn else None
    mean_st_el = sum(w * st['el'] for w, (d, k, st, o) in zip(W, use)) / sw
    dz = (el - mean_st_el) if el is not None else 0
    # Exposed high terrain is usually windier than the valley stations around it.
    if wind is not None and dz > 300: wind *= min(1.5, 1 + dz / 2000)
    x = next((o['x'] for d, k, st, o in use if o['x']), '')
    return {'src': 'est', 'n': len(use), 'km': round(sum(d for d, *_ in use) / len(use)), 'dz': round(dz),
            'near': use[0][2]['n'], 't': round(c2f(t)), 'rh': round(rh(t, td)) if td is not None else None,
            'w': round(wind / 1.609) if wind is not None else None, 'x': x,
            'age': round(max(o['age'] for *_, o in use), 2)}

by_id = {s['id']: s for s in sites}
def forecast(s):
    f = F.get(tuple(s['g'])) if s.get('g') else None
    if f: return {'src': 'nws', 'days': f['days'], 'issued': f['issued']}
    # Fallback: borrow from the nearest pins that have an NWS forecast, corrected for elevation.
    el = site_el[s['id']]
    nb = sorted(((km(s['lat'], s['lon'], o['lat'], o['lon']), o) for o in sites
                 if o['id'] != s['id'] and o.get('g') and F.get(tuple(o['g']))), key=lambda x: x[0])[:3]
    nb = [(d, o) for d, o in nb if d <= 40]
    if not nb: return None
    W = [1 / max(d, 1) ** 2 for d, _ in nb]; sw = sum(W)
    base = F[tuple(nb[0][1]['g'])]['days']; days = []
    for i, day in enumerate(base):
        def blend(key):
            vals = []
            for w, (d, o) in zip(W, nb):
                fd = F[tuple(o['g'])]; dd = fd['days'][i] if i < len(fd['days']) else None
                if not dd or dd[key] is None: continue
                v = dd[key]
                if key in ('hi', 'lo') and el is not None and fd['el'] is not None:
                    v += (fd['el'] - el) * LAPSE * 9 / 5
                vals.append((w, v))
            return round(sum(w * v for w, v in vals) / sum(w for w, _ in vals)) if vals else None
        nd = dict(day); nd['hi'], nd['lo'], nd['p'] = blend('hi'), blend('lo'), blend('p') or 0
        if nd['lo'] is not None and nd['lo'] <= 33 and nd['p'] >= 30 and 'now' not in (nd['s'] + nd['sn']).lower():
            nd['snow'] = 1
        days.append(nd)
    return {'src': 'est', 'n': len(nb), 'km': round(sum(d for d, _ in nb) / len(nb)), 'days': days}

CUR = {s['id']: current(s) for s in sites}
# NWS hourly forecast for the grid cell: sky wording for estimates, and the reading itself where stations fall short.
hg = sorted({tuple(s['g']) for s in sites if s.get('g') and (CUR[s['id']] is None or not CUR[s['id']].get('x'))})
def hourly(g):
    d = get('https://api.weather.gov/gridpoints/%s/%d,%d/forecast/hourly' % g)
    per = ((d or {}).get('properties') or {}).get('periods') or []
    for q in per:
        end = datetime.fromisoformat(q['endTime'])
        if end > now:
            dp = (q.get('dewpoint') or {}).get('value'); t = (q['temperature'] - 32) * 5 / 9
            ws = q.get('windSpeed') or ''
            return g, {'t': q['temperature'], 'x': q['shortForecast'],
                       'rh': (q.get('relativeHumidity') or {}).get('value'),
                       'w': int(ws.split()[0]) if ws[:1].isdigit() else None, 'wd': q.get('windDirection') or ''}
    return g, None
with cf.ThreadPoolExecutor(6) as ex: H = dict(ex.map(hourly, hg))
print('hourly grids', len(hg), 'ok', sum(1 for v in H.values() if v), file=sys.stderr)
for s in sites:
    c = CUR[s['id']]; h = H.get(tuple(s['g'])) if s.get('g') else None
    if c is None and h:
        CUR[s['id']] = {'src': 'model', 't': h['t'], 'rh': h['rh'], 'w': h['w'], 'wd': h['wd'], 'x': h['x']}
    elif c is not None and not c.get('x') and h:
        c['x'] = h['x']

tiles = {}
for s in sites:
    rec = {'el': site_el[s['id']], 'cur': CUR[s['id']], 'fc': forecast(s)}
    key = 't%d_%d' % (math.floor(s['lat']), math.floor(s['lon']))
    tiles.setdefault(key, {})[s['id']] = rec

stamp = now.isoformat(timespec='seconds')
summary = {'updated': stamp, 'sites': len(sites), 'grids': len(grids), 'gridsOk': sum(1 for v in F.values() if v),
           'stations': len(need), 'stationsOk': sum(1 for v in O.values() if v),
           'curObs': sum(1 for t in tiles.values() for r in t.values() if r['cur'] and r['cur']['src'] == 'obs'),
           'curEst': sum(1 for t in tiles.values() for r in t.values() if r['cur'] and r['cur']['src'] == 'est'),
           'curModel': sum(1 for t in tiles.values() for r in t.values() if r['cur'] and r['cur']['src'] == 'model'),
           'fcEst': sum(1 for t in tiles.values() for r in t.values() if r['fc'] and r['fc']['src'] == 'est')}
print(json.dumps(summary), file=sys.stderr)
if summary['gridsOk'] < 0.5 * max(1, summary['grids']):
    raise SystemExit('NWS returned too few forecasts this hour; keeping the previous weather instead of overwriting it.')
rows = [{'key': 'wx:' + k, 'data': {'updated': stamp, 'sites': v}} for k, v in tiles.items()]
rows.append({'key': 'wx:meta', 'data': summary})
upsert_feeds(rows, out_dir=sys.argv[1] if len(sys.argv) > 1 else None)
