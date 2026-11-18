"""Hourly: emergency closures and hazards near every map pin.

1. Forest Service sites newly marked "temporarily closed" (how emergency closures show up in their data).
2. Active wildfire perimeters (NIFC/WFIGS) within 10 miles of a site.
3. Active NWS warnings, watches and advisories covering a site (red flag, winter storm, flood, wind, heat...).

Writes the `alerts` feed:
  {updated, nws: {alertId: {e, h, sev, ends, url}}, fires: [{n, ac, pc, geom}],
   sites: {siteId: {a: [alertId...], f: [[fireIndex, miles]], c: 'temporarily closed'}}}
"""
import json, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import get, upsert_feeds, pins, now_iso, km, in_geom, bbox, polys
from sources import layer, FS

WFIGS = 'https://services3.arcgis.com/T4QMspbfLg3qTGWY/arcgis/rest/services/WFIGS_Interagency_Perimeters_Current/FeatureServer/0'
SKIP = ('Small Craft', 'Gale', 'Marine', 'Hazardous Seas', 'Hurricane Force', 'Storm Warning', 'Low Water', 'Brisk Wind',
        'Rip Current', 'Lake Wind', 'Test')
FIRE_MI = 10

def main():
    P = pins(); sites = {}
    def add(pid, key, val):
        e = sites.setdefault(pid, {})
        if key == 'c': e['c'] = val
        else: e.setdefault(key, []).append(val)

    # 1. Forest Service emergency closures
    d = layer(FS + '/EDW_RecreationOpportunities_01/MapServer/0', where="forestorgcode LIKE '05%' AND openstatus='temporarily closed'",
              fields='recareaid', geom=False, page=2000)
    closed = {str(f['attributes']['recareaid']) for f in d['features']}
    for p in P:
        if p['rid'] and p['rid'] in closed: add(p['id'], 'c', 'temporarily closed')

    # 2. Active wildfires
    fires = []
    try:
        fd = layer(WFIGS, where="attr_POOState IN ('US-CA','US-NV','US-OR','US-AZ') AND (attr_PercentContained IS NULL OR attr_PercentContained < 100)",
                   fields='poly_IncidentName,attr_IncidentSize,poly_GISAcres,attr_PercentContained', offset=0.002, prec=4)
    except Exception as e:
        print('wildfire service unavailable:', e, file=sys.stderr); fd = {'features': []}
    for f in fd['features']:
        g = f['geometry']; bb = bbox(g)
        if not bb: continue
        a = f['properties']; i = len(fires)
        fires.append({'n': (a.get('poly_IncidentName') or 'Unnamed').strip().title() + ' Fire', 'ac': round(a.get('attr_IncidentSize') or a.get('poly_GISAcres') or 0),
                      'pc': a.get('attr_PercentContained'), 'geom': g})
        verts = [c for p in polys(g) for c in p[0]]
        pad = FIRE_MI / 55
        for p in P:
            if not (bb[0] - pad <= p['lon'] <= bb[2] + pad and bb[1] - pad <= p['lat'] <= bb[3] + pad): continue
            if in_geom(p['lon'], p['lat'], g): d_km = 0
            else: d_km = min(km(p['lat'], p['lon'], c[1], c[0]) for c in verts)
            if d_km <= FIRE_MI * 1.609: add(p['id'], 'f', [i, round(d_km / 1.609, 1)])

    # 3. NWS alerts
    nws = {}; zcache = {}
    ad = get('https://api.weather.gov/alerts/active?area=CA') or {}
    for f in ad.get('features') or []:
        a = f['properties']; ev = a.get('event') or ''
        if any(k in ev for k in SKIP) or a.get('status') != 'Actual': continue
        geoms = [f['geometry']] if f.get('geometry') else []
        if not geoms:
            for z in a.get('affectedZones') or []:
                if z not in zcache: zcache[z] = (get(z) or {}).get('geometry')
                if zcache[z]: geoms.append(zcache[z])
        if not geoms: continue
        aid = a['id'].rsplit('/', 1)[-1][-24:]
        nws[aid] = {'e': ev, 'h': (a.get('headline') or '')[:200], 'sev': a.get('severity'), 'ends': a.get('ends') or a.get('expires'),
                    'url': 'https://alerts.weather.gov/search?id=' + a['id'].rsplit('/', 1)[-1]}
        boxes = [(g, bbox(g)) for g in geoms]
        hit_any = False
        for p in P:
            for g, bb in boxes:
                if bb and bb[0] <= p['lon'] <= bb[2] and bb[1] <= p['lat'] <= bb[3] and in_geom(p['lon'], p['lat'], g):
                    add(p['id'], 'a', aid); hit_any = True; break
        if not hit_any: del nws[aid]

    out = {'updated': now_iso(), 'nws': nws, 'fires': fires, 'sites': sites}
    upsert_feeds([{'key': 'alerts', 'data': out}], out_dir=sys.argv[1] if len(sys.argv) > 1 else None)
    print('closures %d, fires %d (sites near fire %d), nws alerts %d covering %d sites' % (
        len(closed), len(fires), sum(1 for s in sites.values() if 'f' in s), len(nws), sum(1 for s in sites.values() if 'a' in s)))

if __name__ == '__main__': main()
