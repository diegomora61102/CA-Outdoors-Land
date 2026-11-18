"""Keep pipeline/state/wx_sites.json in step with the map's pins (run after a data rebuild).

For each new pin, looks up its NWS forecast grid cell once; refreshes the observation-station list.
"""
import json, os, sys, concurrent.futures as cf
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import get, pins, ROOT

STATE = os.path.join(ROOT, 'pipeline', 'state', 'wx_sites.json')

def main():
    st = json.load(open(STATE)) if os.path.exists(STATE) else {'sites': [], 'stations': {}}
    old = {s['id']: s for s in st['sites']}
    cur = pins(); keep, new = [], []
    for p in cur:
        s = old.get(p['id'])
        if s and s.get('g'): keep.append(s)
        else: new.append({'id': p['id'], 'n': p['n'], 'lat': p['lat'], 'lon': p['lon']})
    def pt(s):
        d = get('https://api.weather.gov/points/%.4f,%.4f' % (s['lat'], s['lon']))
        p = (d or {}).get('properties') or {}
        if p.get('gridId'): s['g'] = [p['gridId'], p['gridX'], p['gridY']]
        return s
    with cf.ThreadPoolExecutor(6) as ex: new = list(ex.map(pt, new))
    if not st['stations'] or '--stations' in sys.argv:
        stations = {}
        for state in ('CA', 'NV', 'OR', 'AZ'):
            url = 'https://api.weather.gov/stations?state=%s&limit=500' % state
            while url:
                d = get(url) or {}; fs = d.get('features') or []
                for f in fs:
                    p = f['properties']; c = f['geometry']['coordinates']
                    stations[p['stationIdentifier']] = {'n': p['name'], 'lat': c[1], 'lon': c[0], 'el': (p.get('elevation') or {}).get('value')}
                url = (d.get('pagination') or {}).get('next') if fs else None
        if len(stations) > 1000: st['stations'] = stations
    st['sites'] = keep + new
    os.makedirs(os.path.dirname(STATE), exist_ok=True)
    json.dump(st, open(STATE, 'w'), separators=(',', ':'))
    print('sites %d (new %d, dropped %d), stations %d' % (len(st['sites']), len(new), len(old) - len(keep), len(st['stations'])))

if __name__ == '__main__': main()
