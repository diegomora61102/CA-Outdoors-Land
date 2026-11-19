"""Turn the raw source layers into the site's data files (run monthly after sources.py).

Usage: python3 -I pipeline/build_data.py RAW_DIR OUT_DIR
Writes OUT_DIR/land.json, rec.json and fs.json.
"""
import hashlib, json, math, os, re, sys, collections as _c
import datetime, html as H, urllib.parse
D=sys.argv[1].rstrip('/')+'/'; OUT=sys.argv[2]
def load(n): return json.load(open(D+n+'.geojson'))
def save(name, obj):
  json.dump(obj, open(os.path.join(OUT, name), 'w'), separators=(',',':'))
  print('wrote', name, os.path.getsize(os.path.join(OUT, name)), 'bytes', file=sys.stderr)
def polys(g): return g['coordinates'] if g['type']=='MultiPolygon' else [g['coordinates']]
def ring_area(r):
  if len(r)<4: return 0
  lat0=sum(p[1] for p in r)/len(r);k=math.cos(math.radians(lat0));s=0
  for i in range(len(r)-1):
    x1,y1=r[i];x2,y2=r[i+1];s+=(x1*y2-x2*y1)
  return abs(s)/2*k*(111320**2)/4046.86
def acres(g): return sum(ring_area(p[0])-sum(ring_area(h) for h in p[1:]) for p in polys(g))
def rnd(g,d):
  def r(c): return [round(c[0],d),round(c[1],d)]
  ps=[[ [r(c) for c in ring] for ring in p] for p in polys(g)]
  return {'type':'MultiPolygon','coordinates':ps}
def fc(feats): return {'type':'FeatureCollection','features':feats}
def centroid(g):
  best=max(polys(g),key=lambda p:ring_area(p[0])); r=best[0]
  return [round(sum(p[0] for p in r)/len(r),3),round(sum(p[1] for p in r)/len(r),3)]
out={}
blm=load('full'); tot=0; feats=[]
for f in blm['features']:
  if not f['geometry']: continue
  tot+=acres(f['geometry']); feats.append({'type':'Feature','properties':{},'geometry':rnd(f['geometry'],5)})
out['blm']=fc(feats)
fo=load('fo'); m={}
for f in fo['features']:
  if not f['geometry']: continue
  k=f['properties']['ADMU_NAME']; e=m.setdefault(k,{'d':f['properties']['PARENT_NAME'],'ps':[]}); e['ps']+=polys(f['geometry'])
out['fo']=fc([{'type':'Feature','properties':{'n':k,'d':v['d'],'lab':centroid({'type':'MultiPolygon','coordinates':v['ps']})},'geometry':rnd({'type':'MultiPolygon','coordinates':v['ps']},4)} for k,v in m.items()])
nl=load('nlcs'); out['nlcs']=fc([{'type':'Feature','properties':{'n':f['properties']['NCA_NAME'],'k':f['properties']['sma_code'],'a':round(acres(f['geometry']))},'geometry':rnd(f['geometry'],5)} for f in nl['features'] if f['geometry']])
def yr(ms): return datetime.datetime.fromtimestamp(ms/1000,datetime.UTC).year if ms else None
w=load('wild'); out['wild']=fc([{'type':'Feature','properties':{'n':f['properties']['NLCS_NAME'],'y':yr(f['properties']['DESIG_DATE']),'a':round(acres(f['geometry']))},'geometry':rnd(f['geometry'],5)} for f in w['features'] if f['geometry']])
s=load('wsa'); out['wsa']=fc([{'type':'Feature','properties':{'n':f['properties']['NLCS_NAME'],'a':round(acres(f['geometry']))},'geometry':rnd(f['geometry'],5)} for f in s['features'] if f['geometry']])
c=load('counties'); out['counties']=fc([{'type':'Feature','properties':{'n':f['properties']['NAME']},'geometry':rnd(f['geometry'],4)} for f in c['features']])
nb=load('neighbors'); out['neighbors']=fc([{'type':'Feature','properties':{'s':f['properties']['STATEFP']},'geometry':rnd(f['geometry'],3)} for f in nb['features']])
out['cities']=[["Los Angeles",34.05,-118.24,1],["San Francisco",37.77,-122.42,1],["San Diego",32.72,-117.16,1],["Sacramento",38.58,-121.49,1],["Fresno",36.74,-119.79,1],["San Jose",37.34,-121.89,0],["Bakersfield",35.37,-119.02,1],["Redding",40.59,-122.39,0],["Eureka",40.80,-124.16,0],["Barstow",34.90,-117.02,0],["Ridgecrest",35.62,-117.67,0],["Bishop",37.36,-118.40,0],["Susanville",40.42,-120.65,0],["Alturas",41.49,-120.54,0],["Ukiah",39.15,-123.21,0],["Palm Springs",33.83,-116.55,0],["El Centro",32.79,-115.56,0],["Needles",34.85,-114.61,0],["Hollister",36.85,-121.40,0],["Chico",39.73,-121.84,0],["Reno",39.53,-119.81,0],["Las Vegas",36.17,-115.14,0],["San Luis Obispo",35.28,-120.66,0],["Riverside",33.95,-117.40,0],["Yreka",41.74,-122.63,0],["Lone Pine",36.61,-118.06,0],["Blythe",33.61,-114.60,0],["Mammoth Lakes",37.65,-118.97,0]]
out['stats']={'blmAcres':round(tot)}
print('acres',tot, {k:len(v['features']) for k,v in out.items() if isinstance(v,dict) and 'features' in v}, set(f['properties']['k'] for f in out['nlcs']['features']), file=sys.stderr)
save('land.json', out)

# ---------- Recreation ----------
def strip_code(s):
  # Some Forest Service descriptions embed photo-slider markup: drop scripts, styles, comments and the slider block.
  s=re.sub(r'<(script|style)\b[^>]*>.*?</\1\s*>','',s,flags=re.I|re.S)
  s=re.sub(r'<!--.*?-->','',s,flags=re.S)
  s=re.sub(r'<div[^>]*id="slider\d*"[^>]*>.*?</div>','',s,flags=re.I|re.S)
  s=re.sub(r'var \$j = jQuery;.*?\}\);\s*\}\);','',s,flags=re.S)
  return s
def clean(s, n=320):
  if not s: return ''
  s=strip_code(s)
  s=re.sub(r'<(br|/p|/h\d|/li)[^>]*>',' \n',s,flags=re.I); s=re.sub(r'<[^>]+>','',s); s=H.unescape(s)
  s=re.sub(r'[ \t\r\f\v]+',' ',s); s=re.sub(r'\s*\n\s*','\n',s).strip()
  s=re.sub(r'^Overview\s*','',s)
  if len(s)>n: s=s[:n].rsplit(' ',1)[0].rstrip(',.;:')+'…'
  return s
def ll(f): c=f['geometry']['coordinates']; return [round(c[1],5),round(c[0],5)]
MONTHS=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
def season_text(start, end):
  """Forest Service open season as one phrase. Dates lose their (stale) year: 5/20/2024 -> May 20."""
  def norm(v):
    v=(v or '').strip()
    if not v or v.lower() in ('none','n/a','na'): return ''
    v=re.sub(r'<[^>]+>','',H.unescape(v)).strip().rstrip('.')
    m=re.fullmatch(r'(\d{1,2})/(\d{1,2})(?:/\d{2,4})?',v)
    if m and 1<=int(m.group(1))<=12: return '%s %d'%(MONTHS[int(m.group(1))-1],int(m.group(2)))
    m=re.fullmatch(r'(\d{4})-(\d{2})-(\d{2}).*',v)
    if m and 1<=int(m.group(2))<=12: return '%s %d'%(MONTHS[int(m.group(2))-1],int(m.group(3)))
    return v
  s,e=norm(start),norm(end)
  yr=lambda v: re.search(r'year[\s-]*round|all year',v or '',re.I)
  if yr(s) or yr(e) or (s.lower().startswith('jan') and e.lower().startswith('dec') and len(s)<=8 and len(e)<=9): return 'Year-round'
  if s and e: return '%s – %s'%(s,e)
  if s and len(s)<=20 and not re.search(r'\b(to|through|until|-)\b|open|close',s,re.I): return 'Opens %s'%s
  if e: return 'Closes %s'%e
  return s[:160]

def imgs(h, n=6):
  """Photo URLs embedded in a description (Forest Service media, BLM Flickr), as https, skipping icons."""
  out=[]
  for m in re.finditer(r'<img[^>]+src=["\u201d]?([^"\u201d\s>]+)',h or '',re.I):
    u=H.unescape(m.group(1)).strip()
    if u.startswith('/Internet/'): u='https://www.fs.usda.gov'+u
    if u.startswith('/sites/blm.gov/'): u='https://www.blm.gov'+u
    u=re.sub(r'^http://(www\.fs\.usda\.gov|farm\d\.staticflickr\.com|live\.staticflickr\.com)',r'https://\1',u)
    if not u.startswith('https://') or re.search(r'\.(gif|svg)(\?|$)|icon|logo|spacer|arrow|pixel|button',u,re.I): continue
    if u not in out: out.append(u)
  return out[:n]
PHOTOS={}
if os.path.exists(os.path.join(os.path.dirname(os.path.abspath(__file__)),'state','photos.json')):
  PHOTOS=json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)),'state','photos.json')))

# ---------- Amenities: structured fields first, then wording in descriptions ----------
def plain(*parts):
  t=' '.join(x for x in parts if x and x!='None')
  t=strip_code(t)
  t=re.sub(r'<[^>]+>',' ',t); t=H.unescape(t); return re.sub(r'\s+',' ',t)
def has(t,pat): return re.search(pat,t,re.I) is not None
def amen(text, water=None, rest=None, packout=None, toilet_near=False, primitive=False, notice_src=''):
  t=text; a={}
  # Water
  w=(water or '').lower()
  if w and w not in ('none',):
    if w.startswith('yes') or 'potable' in w: a['water']=['yes','Drinking water'+(' from faucets' if 'faucet' in w else ' from a hand pump' if 'pump' in w else '')]
    elif 'treat' in w or 'filter' in w: a['water']=['treat','Treat or filter water from nearby streams or lakes']
    elif 'nearby' in w: a['water']=['near','No water here; drinking water at nearby campgrounds']
    elif w.startswith('no'): a['water']=['no','No water: bring your own']
  says_no=has(t,r'\bno (drinking |potable )?water|water is not available|bring (your own|plenty of|enough|adequate|all) (drinking )?water|no water (is )?available|water (has been |is )?(turned off|shut off|unavailable)')
  if a.get('water',[''])[0]=='yes' and says_no:
    a['water']=['check','Records disagree: listed as having water, but notes say no water. Bring your own.']
  if 'water' not in a:
    if has(t,r'\bno (drinking |potable )?water|water is not available|bring (your own|plenty of|enough|adequate|all) (drinking )?water|no water (is )?available|pack in (your own )?water'): a['water']=['no','No water: bring your own']
    elif has(t,r'(treat|filter|purify|boil)\w* (the |all )?(creek |stream |lake |river )?water|water (must|should) be (treated|filtered|boiled)'): a['water']=['treat','Treat or filter water from natural sources']
    elif has(t,r'drinking water (is )?(available|provided)|potable water|water (spigot|faucet|hydrant)s?|piped water|water is available'): a['water']=['yes','Drinking water available']
  if 'water' not in a: a['water']=['unk','Not listed: plan to bring your own']
  # Toilets
  r=(rest or '').lower()
  if r and r!='none':
    if 'flush' in r: a['toilet']=['yes','Flush toilets']
    elif 'vault' in r: a['toilet']=['yes','Vault toilets']
    elif 'portable' in r: a['toilet']=['yes','Portable toilets']
    elif 'nearby' in r: a['toilet']=['near','Restrooms nearby']
    elif r.startswith('no'): a['toilet']=['no','No restrooms']
  if 'toilet' not in a:
    if has(t,r'flush (toilet|restroom)s?'): a['toilet']=['yes','Flush toilets']
    elif has(t,r'vault (toilet|restroom)s?|pit toilets?'): a['toilet']=['yes','Vault toilets']
    elif has(t,r'(portable|chemical) toilets?|porta[- ]?pott'): a['toilet']=['yes','Portable toilets']
    elif has(t,r'no (restrooms?|toilets?|facilities)|there are no (restrooms|toilets|facilities)'): a['toilet']=['no','No restrooms']
    elif has(t,r'\b(restrooms?|toilets?)\b'): a['toilet']=['yes','Restrooms']
    elif toilet_near: a['toilet']=['yes','Toilet (mapped at this site)']
  if 'toilet' not in a: a['toilet']=['unk','Not listed']
  # Trash
  if packout=='Y' or has(t,r'pack(ed)?[- ]?(it )?in,? ?(and )?pack(ed)?[- ]?(it )?out|pack out (all |your )?(trash|garbage)|no (trash|garbage)( service| collection| cans)?'): a['trash']=['no','Pack it in, pack it out: no trash service']
  elif has(t,r'dumpsters?|trash (cans|service|receptacles|collection|bins)|garbage (cans|service|collection|bins)'): a['trash']=['yes','Trash cans or dumpster']
  elif packout=='N': a['trash']=['yes','Trash service likely (not listed as pack-out)']
  else: a['trash']=['unk','Not listed: pack out your trash']
  # Campfires
  if has(t,r'no (camp)?fires|(camp)?fires are (not (permitted|allowed)|prohibited)|fires? (is|are) prohibited|no open fires'): a['fire']=['no','No campfires']
  elif has(t,r'fire[- ](rings?|pits?|grates?)|campfire[- ](rings?|pits?)'): a['fire']=['yes','Fire rings at sites']
  elif has(t,r'\b(grills?|barbecues?|bbq)\b'): a['fire']=['yes','Grills (check whether wood fires are allowed)']
  else: a['fire']=['unk','Not listed']
  a['permit']=1 if primitive else 0
  ex=[]
  def pos(pat):
    for m in re.finditer(pat,t,re.I):
      before=t[max(0,m.start()-25):m.start()].lower()
      if not re.search(r'\b(no|not|without|lack of|there are no)\s+(\w+\s+){0,2}$',before): return True
    return False
  for pat,lab in [(r'picnic tables?','Picnic tables'),(r'bear[- ](proof |resistant )?(box|boxes|locker|lockers)|food (storage )?lockers?','Bear boxes'),(r'camp(ground)? hosts?','Camp host'),
                  (r'dump stations?','Dump station'),(r'(hot|coin[- ]operated|coin[- ]op|pay|solar) showers?|showers? (are |is )?(available|provided)|shower (house|building|facilit)','Showers'),
                  (r'(full|electric(al)?|water and sewer|rv) hook[- ]?ups?|hook[- ]?ups? (are )?available','Hookups'),(r'corrals?|hitching (rails?|posts?)|horse (camp|trailer parking)','Horse facilities'),
                  (r'boat (ramp|launch)','Boat ramp'),(r'wheelchair[- ]accessible|ADA[- ]accessible|accessible (camp)?sites?|accessible (toilet|restroom|vault)s?','Accessible sites'),
                  (r'no cell( phone)? (service|coverage|reception)|limited cell','Little or no cell service'),(r'(dogs?|pets?) (must be )?(kept )?on (a )?leash|leashed (dogs|pets)','Pets on leash')]:
    if (lab=='Little or no cell service' and has(t,pat)) or (lab!='Little or no cell service' and pos(pat)): ex.append(lab)
  a['ex']=ex
  m=re.search(r'[^.]*\b(closed until further notice|remain(s|ed)? closed|currently (closed|inaccessible)|inaccessible due|temporarily closed|damaged)[^.]*\.?',notice_src,re.I)
  if m: a['note']=m.group(0).strip()[:220]
  return a
sites=[]
for f in load('ridb')['features']:
  p=f['properties']; acts=[a.strip().title() for a in (p['ActivityNames'] or '').split(',') if a.strip()]
  au=[a.upper() for a in acts]
  hk='HIKING' in au; cp='CAMPING' in au or 'Horse Camping'.upper() in au
  if not (hk or cp) or not f['geometry']: continue
  fee=clean(p['RecAreaFeeDescription'],1000)
  nm=p['RecAreaName'].strip()
  if re.search(r'\btrail|loop\b|byway',nm,re.I): pk='Trail'
  elif re.search(r'campground|\bcamp\b|campsite',nm,re.I) and not re.search(r'patton|historic',nm,re.I): pk='Camp'
  elif re.search(r'spring|overlook|mine\b|arch|petroglyph|falls|lighthouse|cave|site\b|road\b|historic',nm,re.I): pk='Spot'
  else: pk='Area'
  sites.append({'img':imgs(p['RecAreaDescription']),'pk':pk,'am':amen(plain(p['RecAreaDescription'],p['RecAreaFeeDescription'],p['StayLimit'])),'n':p['RecAreaName'].strip(),'ll':ll(f),'t':('both' if hk and cp else 'hike' if hk else 'camp'),'acts':acts,'d':clean(p['RecAreaDescription']),'fee':'' if fee.upper() in ('N/A','NA','') else fee,'stay':clean(p['StayLimit'],100),'url':p['BLMRecURL'] or '','res':p['RecAreaReservationURL'] or '','ph':p['RecAreaPhone'] or ''})
camps=[]
for f in load('ridbcamp')['features']:
  p=f['properties']
  if not f['geometry']: continue
  fee=clean(p['FacilityUseFeeDescription'],1000)
  camps.append({'img':imgs(p['FacilityDescription']),'fid':(re.search(r'/(\d+)/?\d*$',p['BLMFacURL'] or '') or [None,None])[1],'am':amen(plain(p['FacilityDescription'],p['FacilityUseFeeDescription'],p['StayLimit']),notice_src=plain(p['FacilityDescription'])[:600]),'n':p['FacilityName'].strip(),'ll':ll(f),'k':p['FacilityTypeDescription'] or 'Campground','d':clean(p['FacilityDescription']),'fee':fee,'stay':clean(p['StayLimit'],100),'url':p['BLMFacURL'] or '','res':p['FacilityReservationURL'] or '','ph':p['FacilityPhone'] or '','src':'ridb'})
def near(a,b): return abs(a[0]-b[0])<0.006 and abs(a[1]-b[1])<0.007
th=[];info=[]
toilets=[ll(f) for f in load('blmamen')['features'] if f['properties']['FET_SUBTYPE']=='Toilet' and f['geometry']]
for f in load('recpts')['features']:
  p=f['properties']; st=p['FET_SUBTYPE']; x=ll(f); nm=(p['FET_NAME'] or '').strip()
  if st=='Trail Head': th.append({'n':nm or 'Trailhead','ll':x})
  elif st in ('Visitor Center','BLM Ranger Station/Field Office/Contact Station'): info.append({'n':nm or st,'ll':x,'k':'Visitor center' if st=='Visitor Center' else 'Ranger / contact station'})
  else:
    if any(near(x,c['ll']) for c in camps): continue
    k='Campground' if st=='Campground' else st.replace('Campsite - ','').replace(' - ',' · ')
    tn=any(abs(q[0]-x[0])<0.003 and abs(q[1]-x[1])<0.0035 for q in toilets)
    camps.append({'am':amen(plain(p['DESCRIPTION'],nm),toilet_near=tn,primitive='Primitive' in st),'n':nm or 'Campground','ll':x,'k':k,'d':clean(p['DESCRIPTION']),'src':'gis'})
foot=[]
for f in load('recpoly')['features']:
  p=f['properties']
  if p['FET_SUBTYPE'] in ('Campground','SRMA') and f['geometry']:
    foot.append({'type':'Feature','properties':{'n':p['FET_NAME'],'k':p['FET_SUBTYPE']},'geometry':rnd(f['geometry'],5)})
trails=[]; miles=0
for f in load('trails')['features']:
  if not f['geometry']: continue
  p=f['properties']; g=f['geometry']; miles+=p['GIS_MILES'] or 0
  lines=g['coordinates'] if g['type']=='MultiLineString' else [g['coordinates']]
  trails.append({'type':'Feature','properties':{'n':p['ROUTE_PRMRY_NM'] or p['ROUTE_SCNDRY_SPCL_DSGNTN_NM'] or '','m':p['PLAN_ALLOW_MODE_TRNSPRT'],'mi':round(p['GIS_MILES'] or 0,2)},'geometry':{'type':'MultiLineString','coordinates':[[[round(c[0],5),round(c[1],5)] for c in l] for l in lines]}})
# ---------- Forest Service campgrounds, NPS, USFS land, highways ----------
infra={x['site_cn']:x for x in (f['attributes'] for f in json.load(open(D+'fsinfra.json'))['features'])}
infra2=infra
fsc=[]; seen=set()
for f in load('fscamp')['features']:
  p=f['properties']; g=f['geometry']
  if not g: continue
  key=(p['recareaname'],round(g['coordinates'][0],3),round(g['coordinates'][1],3))
  if key in seen: continue
  seen.add(key)
  inf=infra.get(p['infra_cn']) or {}
  res=inf.get('rec1stop_url') or (f"https://www.recreation.gov/camping/campgrounds/{inf['nrrs_id']}" if inf.get('nrrs_id') else '')
  ri=clean(p['reservation_info'],700)
  if ri.strip().rstrip('.').lower() in ('none','n/a','na',''): ri=''
  if not res and re.search(r'recreation\.gov|877-444-6777|NRRS|reserv',(p['reservation_info'] or ''),re.I) and not re.search(r'not accepted|first come',(p['reservation_info'] or ''),re.I):
    res='https://www.recreation.gov/search?q='+urllib.parse.quote(p['recareaname'])
  def nz(v,n=140):
    v=clean(v,n); return '' if v in ('None','none') else v
  i2=infra2.get(p['infra_cn']) or {}
  txt=plain(p['recareadescription'],p['restrictions'],p['reservation_info'],p['accessibility'],p['feedescription'],i2.get('important_info'),i2.get('restrictions'),i2.get('site_contact_notes'))
  am=amen(txt,water=i2.get('water_availability') or inf.get('water_availability'),rest=i2.get('restroom_availability') or inf.get('restroom_availability'),packout=i2.get('pack_in_out'),
          primitive=p['markeractivity'] in ('Dispersed Camping',) or str(i2.get('development_scale') or '') in ('0','1'),notice_src=plain(i2.get('important_info'),i2.get('restrictions'),p['restrictions']))
  fsc.append({'img':imgs(p['recareadescription']),'fid':str(inf['nrrs_id']) if inf.get('nrrs_id') else None,'rid':str(p['recareaid']),'am':am,'n':p['recareaname'].strip(),'ll':ll(f),'k':p['markeractivity'],'forest':p['forestname'],'d':nz(p['recareadescription'],300),'fee':nz(p['feedescription'],1000),'season':season_text(p['open_season_start'],p['open_season_end']),'ri':ri,'restr':nz(p['restrictions'],700),'st':p['openstatus'] if p['openstatus'] not in ('none','unknown','unreachable') else '','url':inf.get('usda_portal_url') or p['recareaurl'] or '','res':res,'water':inf.get('water_availability') or '','cap':int(inf.get('total_capacity') or 0)})
fsh=[]; seen=set()
hk={'Trailhead':'Trailhead','Day Hiking':'Day hike','Backpacking':'Backpacking area','Viewing Scenery':'Scenic area'}
for f in load('fshike')['features']:
  p=f['properties']; g=f['geometry']
  if not g: continue
  key=(p['recareaname'],round(g['coordinates'][0],3),round(g['coordinates'][1],3))
  if key in seen: continue
  seen.add(key)
  i2=infra2.get(p['infra_cn']) or {}
  txt=plain(p['recareadescription'],p['restrictions'],p['accessibility'],p['feedescription'],i2.get('important_info'),i2.get('restrictions'))
  am=amen(txt,water=i2.get('water_availability'),rest=i2.get('restroom_availability'),packout=i2.get('pack_in_out'),primitive=True,notice_src=plain(i2.get('important_info'),i2.get('restrictions'),p['restrictions']))
  def nz2(v,n=200):
    v=clean(v,n); return '' if v.strip().rstrip('.').lower() in ('none','n/a','') else v
  o={'img':imgs(p['recareadescription']),'rid':str(p['recareaid']),'n':p['recareaname'].strip(),'ll':ll(f),'k':hk.get(p['markeractivity'],'Hiking'),'forest':p['forestname'],'d':nz2(p['recareadescription'],300),
     'fee':nz2(p['feedescription'],1000),'season':season_text(p['open_season_start'],p['open_season_end']),'restr':nz2(p['restrictions'],700),'url':i2.get('usda_portal_url') or p['recareaurl'] or '','am':am}
  o['id']='h'+hashlib.sha1((o['n']+'%.5f,%.5f'%tuple(o['ll'])).encode()).hexdigest()[:8]
  fsh.append(o)
npsm=_c.OrderedDict()
for f in load('nps')['features']:
  p=f['properties']; n=p['NAME'].replace('Natl Pk','National Park').replace('Natl Mnmt','National Monument').replace('Natl Rec Area','National Recreation Area').replace('Natl Hist Site','National Historic Site').replace('Natl Hist Pk','National Historical Park').replace('Natl Prsv','National Preserve').replace('Natl Shr','National Seashore')
  npsm.setdefault(n,[]).extend(polys(f['geometry']))
npsfc=fc([{'type':'Feature','properties':{'n':n,'a':round(acres({'type':'MultiPolygon','coordinates':ps}))},'geometry':rnd({'type':'MultiPolygon','coordinates':ps},5)} for n,ps in npsm.items()])
usfs=fc([{'type':'Feature','properties':{},'geometry':rnd(f['geometry'],5)} for f in load('usfs')['features'] if f['geometry']])
forests=fc([{'type':'Feature','properties':{'n':f['properties']['forestname'],'a':round(f['properties']['gis_acres'] or 0)},'geometry':rnd(f['geometry'],4)} for f in load('forests')['features'] if f['geometry']])
hw=_c.OrderedDict()
def hcls(lname,p):
  r=p.get('RTTYP')
  if lname=='hwy4': return 'st'
  if lname=='hwy3': return 'fwy' if r=='I' else 'us'
  return 'us' if r=='U' else 'fwy'
for ln in ['hwy4','hwy3','hwy1']:
  for f in load(ln)['features']:
    g=f['geometry']
    if not g: continue
    p=f['properties']; c=hcls(ln,p); nm=(p['NAME'] or '').replace('I- ','I-').strip()
    lines=g['coordinates'] if g['type']=='MultiLineString' else [g['coordinates']]
    hw.setdefault((c,nm),[]).extend([[[round(x,4),round(y,4)] for x,y in l] for l in lines])
hwfc=fc([{'type':'Feature','properties':{'c':c,'n':n},'geometry':{'type':'MultiLineString','coordinates':ls}} for (c,n),ls in hw.items()])
def _sid(kind,o): return kind+hashlib.sha1((o['n']+'%.5f,%.5f'%tuple(o['ll'])).encode()).hexdigest()[:8]
for kind,arr in (('r',sites),('c',camps),('t',th),('f',fsc)):
  for o in arr: o['id']=_sid(kind,o)
inCA=lambda o: o['ll'][1] < -113.5
sites[:]=[o for o in sites if inCA(o)]; camps[:]=[o for o in camps if inCA(o)]; th[:]=[o for o in th if inCA(o)]
out2={'sites':sites,'camps':camps,'th':th,'info':info,'foot':fc(foot),'trails':fc(trails),'trailMiles':round(miles)}
# Recreation.gov photos (pipeline/photos.py) come first: they show the campground itself.
THUMBS=os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),'site','thumbs')
for arr in (sites, camps, fsc, fsh, th):
  for o in arr:
    own=[u for u in o.get('img',[]) if '/Internet/FSE_MEDIA/' not in u]   # old Forest Service photo links no longer work
    extra=PHOTOS.get(o.get('id'),[])
    o['img']=(extra+[u for u in own if u not in extra])[:8]
    if os.path.exists(os.path.join(THUMBS,o.get('id','')+'.webp')): o['th']=1
    if not o.get('img'): o.pop('img',None)
    if not o.get('fid'): o.pop('fid',None)
save('rec.json', out2)
def lname(n):
  n=re.sub(r'\bLk\b','Lake',n); n=re.sub(r'\bRes\b','Reservoir',n); n=re.sub(r'\bCrk\b','Creek',n); return n.strip()
lk=_c.OrderedDict(); lab={}
for i,f in enumerate(load('lakes')['features']):
  p=f['properties']; g=f['geometry']
  if not g: continue
  n=lname(p['NAME'] or ''); key=n or ('_%d'%i)
  e=lk.setdefault(key,{'n':n,'r':p['MTFCC']!='H2030','ps':[],'a':0}); e['ps']+=polys(g); e['a']+=p['AREAWATER'] or 0
  if n and (n not in lab or (p['AREAWATER'] or 0)>lab[n][2]): lab[n]=(round(float(p['INTPTLAT']),4),round(float(p['INTPTLON']),4),p['AREAWATER'] or 0)
lakes=fc([{'type':'Feature','properties':{'n':e['n'],'r':1 if e['r'] else 0,'a':round(e['a']/4046.86)},'geometry':rnd({'type':'MultiPolygon','coordinates':e['ps']},4)} for e in lk.values()])
def _inring(x,y,r):
  c=False
  for i in range(len(r)):
    x1,y1=r[i]; x2,y2=r[i-1]
    if (y1>y)!=(y2>y) and x<(x2-x1)*(y-y1)/(y2-y1)+x1: c=not c
  return c
_ca=[p_[0] for f_ in load('counties')['features'] for p_ in polys(f_['geometry'])]
def in_ca(lat,lon): return any(_inring(lon,lat,r) for r in _ca)
lakelabels=[[n,v[0],v[1],round(lk[n]['a']/1e6,1)] for n,v in lab.items() if lk[n]['a']>=4e6 and not re.search(r'\bRiv\b|River',n) and in_ca(v[0],v[1])]
out3={'fsh':fsh,'lakes':lakes,'lakeLabels':lakelabels,'fsc':fsc,'nps':npsfc,'usfs':usfs,'forests':forests,'hwy':hwfc}
save('fs.json', out3)
# Lighter copies of the heaviest layers for zoomed-out views (see simplify.py)
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import simplify
# Statewide view (zoom < 8): one pixel is about 1 km, so 0.008 degrees is invisible. Regional (8-10): 0.002.
for level,tol in (('lo',0.008),('mid',0.002)):
  L={'blm':simplify.polygons(out['blm'],tol),'usfs':simplify.polygons(out3['usfs'],tol),
     'lakes':simplify.polygons(out3['lakes'],tol),'hwy':simplify.lines(out3['hwy'],tol)}
  print('lod',level,{k:simplify.points(v) for k,v in L.items()},file=sys.stderr)
  save('lod_%s.json'%level, L)
# Small file of just the places, for the campground pages
save('places.json', {'ra':sites,'cg':camps,'th':th,'fc':fsc,'fh':fsh})
