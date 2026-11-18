"""Daily: current open/closed status for every Forest Service campground and hike on the map.

Writes the `status` feed: {updated, s: {siteId: 'open' | 'closed' | 'temporarily closed'}}.
BLM does not publish open/closed status, so BLM sites have none.
"""
import json, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import require_supabase_in_ci, upsert_feeds, pins, now_iso
from sources import layer, FS

def fs_status():
    d = layer(FS + '/EDW_RecreationOpportunities_01/MapServer/0', where="forestorgcode LIKE '05%'",
              fields='recareaid,openstatus', geom=False, page=2000)
    return {str(f['attributes']['recareaid']): (f['attributes']['openstatus'] or '').lower() for f in d['features']}

def main():
    require_supabase_in_ci()
    by_rid = fs_status()
    s = {}
    for p in pins():
        st = by_rid.get(p['rid'] or '')
        if st in ('open', 'closed', 'temporarily closed'): s[p['id']] = st
    if len(s) < 200: raise SystemExit('Only %d statuses came back; keeping yesterday\'s instead of overwriting.' % len(s))
    upsert_feeds([{'key': 'status', 'data': {'updated': now_iso(), 's': s}}], out_dir=sys.argv[1] if len(sys.argv) > 1 else None)
    print('status for %d sites: %s' % (len(s), {k: list(s.values()).count(k) for k in set(s.values())}))

if __name__ == '__main__': main()
