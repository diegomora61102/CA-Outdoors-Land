"""Download every source layer the map is built from (run monthly).

Usage: python3 -I pipeline/sources.py RAW_DIR
All sources are public federal map services; no keys needed.
"""
import json, os, sys, time, urllib.parse, urllib.request

UA = {'User-Agent': '(ca-outdoors-land, monthly-data-refresh)'}
BLM = 'https://gis.blm.gov/arcgis/rest/services'
FS = 'https://apps.fs.usda.gov/arcx/rest/services/EDW'
TIGER = 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb'
CA_ENV = {'geometry': '-124.5,32.5,-114.1,42.05', 'geometryType': 'esriGeometryEnvelope', 'inSR': '4326',
          'spatialRel': 'esriSpatialRelIntersects'}

def q(url, **params):
    for i in range(4):
        try:
            u = url + '?' + urllib.parse.urlencode(params)
            with urllib.request.urlopen(urllib.request.Request(u, headers=UA), timeout=180) as r:
                return json.load(r)
        except Exception as e:
            if i == 3: raise
            time.sleep(5 * (i + 1))

def layer(url, where='1=1', env=False, geom=True, offset=None, prec=5, fields='*', page=1000):
    """Query an ArcGIS layer, paging until every record is read."""
    base = {'where': where, 'outFields': fields, 'outSR': '4326', 'f': 'geojson' if geom else 'json',
            'returnGeometry': 'true' if geom else 'false', 'geometryPrecision': prec}
    if offset: base['maxAllowableOffset'] = offset
    if env: base.update(CA_ENV)
    feats, start = [], 0
    while True:
        d = q(url + '/query', resultOffset=start, resultRecordCount=page, **base)
        if 'error' in d: raise RuntimeError('%s: %s' % (url, d['error']))
        got = d.get('features') or []
        feats += got
        more = d.get('exceededTransferLimit') or (d.get('properties') or {}).get('exceededTransferLimit')
        if not got or (not more and len(got) < page): break
        start += len(got)
    return {'type': 'FeatureCollection', 'features': feats} if geom else {'features': feats}

CAMP = "('Campground Camping','Group Camping','RV Camping','Horse Camping','Cabin Rentals','Dispersed Camping','OHV Camping')"
HIKE = "('Trailhead','Day Hiking','Backpacking','Viewing Scenery')"
SOURCES = {
    # Land ownership (BLM Surface Management Agency)
    'full': (BLM + '/lands/BLM_Natl_SMA_LimitedScale/MapServer/22', dict(where="ADMIN_ST='CA'", fields='OBJECTID')),
    'usfs': (BLM + '/lands/BLM_Natl_SMA_LimitedScale/MapServer/24', dict(where="ADMIN_ST='CA'", fields='OBJECTID', offset=0.0005)),
    'fo': (BLM + '/admin_boundaries/BLM_Natl_AdminUnit_Generalized/FeatureServer/3', dict(where="ADMIN_ST='CA'", fields='ADMU_NAME,PARENT_NAME,ADM_UNIT_CD', offset=0.002, prec=4)),
    'nlcs': (BLM + '/lands/BLM_Natl_NLCS_Generalized/FeatureServer/0', dict(where="STATE_ADMN='CA'", fields='NCA_NAME,Label,sma_code,WEBLINK', offset=0.0005)),
    'wild': (BLM + '/lands/BLM_Natl_NLCS_Generalized/FeatureServer/1', dict(where="ADMIN_ST='CA'", fields='NLCS_NAME,DESIG_DATE,WEBLINK', offset=0.0005)),
    'wsa': (BLM + '/lands/BLM_Natl_NLCS_Generalized/FeatureServer/2', dict(where="ADMIN_ST='CA'", fields='NLCS_NAME,WEBLINK', offset=0.0005)),
    'counties': (BLM + '/admin_boundaries/BOC_Natl_CountyBoundaries/MapServer/0', dict(where="STATEFP='06'", fields='NAME,INTPTLAT,INTPTLON', offset=0.003, prec=4)),
    'neighbors': (BLM + '/admin_boundaries/BOC_Natl_CountyBoundaries/MapServer/0', dict(where="STATEFP IN ('41','32','04')", fields='STATEFP', offset=0.01, prec=3)),
    # BLM recreation
    'recpoly': (BLM + '/recreation/BLM_Natl_Recs_poly/MapServer/0', dict(where="ADMIN_ST='CA'", fields='FET_SUBTYPE,FET_NAME,GIS_ACRES', offset=0.0003)),
    'recpts': (BLM + '/recreation/BLM_Natl_Recreation/MapServer/3', dict(where="ADMIN_ST='CA' AND (FET_SUBTYPE LIKE 'Camp%' OR FET_SUBTYPE IN ('Trail Head','Visitor Center','BLM Ranger Station/Field Office/Contact Station'))", fields='FET_SUBTYPE,FET_NAME,DESCRIPTION,WEB_LINK,UNIT_NAME')),
    'blmamen': (BLM + '/recreation/BLM_Natl_Recreation/MapServer/3', dict(where="ADMIN_ST='CA' AND FET_SUBTYPE IN ('Toilet','Potable Water','Picnic Area')", fields='FET_SUBTYPE,FET_NAME')),
    'ridb': (BLM + '/recreation/BLM_Natl_Recreation/MapServer/1', dict(where="State='CA'", fields='RecAreaName,BLMRecURL,RecAreaReservationURL,RecAreaFeeDescription,RecAreaDescription,StayLimit,RecAreaDirections,RecAreaPhone,ActivityNames')),
    'ridbcamp': (BLM + '/recreation/BLM_Natl_Recreation/MapServer/2', dict(where="State='CA'")),
    'trails': (BLM + '/recreation/BLM_Natl_Recreation/MapServer/7', dict(where="ADMIN_ST='CA' AND PLAN_ALLOW_MODE_TRNSPRT IN ('HIK_ONLY','EQU_HIK_ONLY','NON_MOTO_SHARED','BIKE_HIK_ONLY')", fields='ROUTE_PRMRY_NM,ROUTE_SCNDRY_SPCL_DSGNTN_NM,PLAN_ALLOW_MODE_TRNSPRT,GIS_MILES', offset=0.0001)),
    # Forest Service recreation (Region 5 = California)
    'fscamp': (FS + '/EDW_RecreationOpportunities_01/MapServer/0', dict(where="forestorgcode LIKE '05%' AND markeractivity IN " + CAMP)),
    'fshike': (FS + '/EDW_RecreationOpportunities_01/MapServer/0', dict(where="forestorgcode LIKE '05%' AND markeractivity IN " + HIKE)),
    'fsinfra': (FS + '/EDW_RecInfraRecreationSites_02/MapServer/0', dict(where="region='05' AND site_type IN ('CAMPGROUND','GROUP CAMPGROUND','HORSE CAMP','CAMPING AREA','LOOKOUT/CABIN','TRAILHEAD')", geom=False,
               fields='site_cn,site_name,site_type,nrrs_id,rec1stop_url,usda_portal_url,water_availability,restroom_availability,pack_in_out,important_info,restrictions,site_contact_notes,total_capacity,development_scale')),
    'forests': (FS + '/EDW_ForestSystemBoundaries_01/MapServer/1', dict(where="forestorgcode LIKE '05%'", fields='forestname,forestorgcode,gis_acres', offset=0.003, prec=4)),
    # Census: park units, highways, lakes
    'nps': (TIGER + '/Special_Land_Use_Areas/MapServer/0', dict(env=True, fields='NAME,BASENAME,MTFCC,INTPTLAT,INTPTLON', offset=0.0005)),
    'hwy1': (TIGER + '/Transportation/MapServer/1', dict(env=True, fields='NAME,RTTYP,MTFCC', offset=0.002, prec=4)),
    'hwy3': (TIGER + '/Transportation/MapServer/3', dict(env=True, fields='NAME,RTTYP,MTFCC', offset=0.002, prec=4)),
    'hwy4': (TIGER + '/Transportation/MapServer/4', dict(env=True, where="RTTYP='S'", fields='NAME,RTTYP', offset=0.002, prec=4)),
    'lakes': (TIGER + '/Hydro/MapServer/1', dict(env=True, where="MTFCC IN ('H2030','H2040','H2041') AND AREAWATER > 300000", fields='NAME,MTFCC,AREAWATER,INTPTLAT,INTPTLON', offset=0.0008, prec=4)),
}

if __name__ == '__main__':
    out = sys.argv[1]; os.makedirs(out, exist_ok=True)
    only = set(sys.argv[2:])
    for name, (url, kw) in SOURCES.items():
        if only and name not in only: continue
        d = layer(url, **kw)
        n = len(d['features'])
        if n == 0: raise SystemExit('No features for %s; refusing to overwrite with empty data.' % name)
        json.dump(d, open(os.path.join(out, name + ('.json' if kw.get('geom') is False else '.geojson')), 'w'), separators=(',', ':'))
        print('%-10s %6d features' % (name, n), flush=True)
