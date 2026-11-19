(async function () {
  const CFG = window.APP_CONFIG || {};
  const SHOW_PHOTOS = !!CFG.showPhotos;
  const loading = document.getElementById('loading');
  let D, RC, FS, LOD_LO;
  try {
    [D, RC, FS, LOD_LO] = await Promise.all(['land', 'rec', 'fs', 'lod_lo'].map(n => fetch('data/' + n + '.json').then(r => { if (!r.ok) throw new Error(n); return r.json(); })));
  } catch (e) { loading.textContent = 'The map data couldn\'t load. Check your connection, then reload the page.'; return; }
  loading.hidden = true;
  const css = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();

  const map = L.map('map', { preferCanvas: true, zoomControl: false, minZoom: 5, maxZoom: 15, zoomSnap: 0.25, attributionControl: true, worldCopyJump: false });
  L.control.zoom({ position: 'topright' }).addTo(map);
  map.attributionControl.setPrefix(false).addAttribution('Data: <a href="https://gis.blm.gov/arcgis/rest/services/lands" target="_blank" rel="noopener">BLM</a>, USFS, NWS, NIFC, US Census · Basemaps: USGS');
  map.createPane('base').style.zIndex = 300;
  map.createPane('agency').style.zIndex = 395;
  map.createPane('blm').style.zIndex = 400;
  map.createPane('roads').style.zIndex = 425;
  map.createPane('water').style.zIndex = 405;
  map.createPane('desig').style.zIndex = 410;
  map.createPane('lines').style.zIndex = 420;
  map.createPane('trails').style.zIndex = 430;
  map.createPane('labels').style.zIndex = 450;
  map.createPane('relief').style.zIndex = 302;
  map.getPane('relief').style.pointerEvents = 'none';
  map.createPane('fire').style.zIndex = 415;
  map.createPane('rec').style.zIndex = 620;
  map.getPane('labels').style.pointerEvents = 'none';

  const narrow = () => window.matchMedia('(max-width: 720px)').matches;
  const fitCA = () => {
    const pad = { paddingTopLeft: [10, 10], paddingBottomRight: [10, 10] };
    map.fitBounds([[32.5, -124.45], [42.05, -114.1]], pad);
  };
  fitCA();

  // ---------- Basemaps (USGS National Map, public domain) ----------
  const usgs = (svc, o) => L.tileLayer(`https://basemap.nationalmap.gov/arcgis/rest/services/${svc}/MapServer/tile/{z}/{y}/{x}`, Object.assign({ maxNativeZoom: 16, maxZoom: 15 }, o));
  const bases = { relief: usgs('USGSShadedReliefOnly', { pane: 'relief', className: 'relief-tiles' }), topo: usgs('USGSTopo', {}), imagery: usgs('USGSImageryTopo', {}) };
  let base = 'relief', landFill = 1;
  function setBase(name) {
    Object.values(bases).forEach(l => l.remove());
    base = bases[name] || name === 'plain' ? name : 'relief';
    if (bases[base]) bases[base].addTo(map);
    landFill = (base === 'topo' || base === 'imagery') ? 0 : 1;
    document.body.dataset.base = base;
    document.querySelectorAll('[data-base]').forEach(b => b.setAttribute('aria-pressed', b.dataset.base === base));
    try { localStorage.setItem('base', base); } catch (e) {}
    if (typeof applyStyles === 'function') applyStyles();
  }

  // ---------- Layers ----------
  const rd = {}; ['base', 'agency', 'blm', 'water', 'desig', 'lines', 'roads', 'trails'].forEach(p => rd[p] = L.canvas({ pane: p, padding: 0.5 }));
  const opt = (p, extra) => Object.assign({ pane: p, renderer: rd[p], interactive: false }, extra || {});
  const layers = {};
  layers.neighbor = L.geoJSON(D.neighbors, opt('base'));
  layers.county = L.geoJSON(D.counties, opt('base'));
  // Heaviest layers come in three versions: statewide (zoom < 8), regional (8-10) and full detail (10+).
  const LODS = { lo: LOD_LO, mid: null };
  let midLoading = false;
  const hwSort = (fc, noState) => ({ type: 'FeatureCollection', features: fc.features.slice().sort((a, b) => ({ st: 0, us: 1, fwy: 2 })[a.properties.c] - ({ st: 0, us: 1, fwy: 2 })[b.properties.c]).filter(f => !noState || f.properties.c !== 'st') });
  const lodDefs = {   // hwyCase must come before hwy so the white casing draws underneath
    blm: { pane: 'blm', extra: { smoothFactor: 0.6 }, data: lv => lv === 'full' ? D.blm : LODS[lv].blm },
    usfs: { pane: 'agency', extra: { smoothFactor: 0.8 }, data: lv => lv === 'full' ? FS.usfs : LODS[lv].usfs },
    lakes: { pane: 'water', data: lv => lv === 'full' ? FS.lakes : LODS[lv].lakes },
    hwyCase: { pane: 'roads', data: lv => hwSort(lv === 'full' ? FS.hwy : LODS[lv].hwy, true) },
    hwy: { pane: 'roads', data: lv => hwSort(lv === 'full' ? FS.hwy : LODS[lv].hwy, false) }
  };
  const lodCache = {}, lodCur = {};
  Object.keys(lodDefs).forEach(k => { layers[k] = L.featureGroup(); });
  function syncLod() {
    const z = map.getZoom();
    let lv = z < 8 ? 'lo' : z < 10 ? 'mid' : 'full';
    if (lv === 'mid' && !LODS.mid) {
      lv = 'lo';
      if (!midLoading) { midLoading = true; fetch('data/lod_mid.json').then(r => r.json()).then(d => { LODS.mid = d; syncLod(); }).catch(() => { midLoading = false; }); }
    }
    let changed = false;
    Object.entries(lodDefs).forEach(([k, def]) => {
      if (lodCur[k] === lv) return;
      const id = k + '|' + lv;
      if (!lodCache[id]) lodCache[id] = L.geoJSON(def.data(lv), opt(def.pane, def.extra));
      layers[k].clearLayers(); layers[k].addLayer(lodCache[id]); lodCur[k] = lv; changed = true;
    });
    if (changed && typeof applyStyles === 'function' && layers.tr) applyStyles();
  }
  syncLod();
  map.on('zoomend', syncLod);
  layers.nlcs = L.geoJSON(D.nlcs, opt('desig'));
  layers.wild = L.geoJSON(D.wild, opt('desig'));
  layers.wsa = L.geoJSON(D.wsa, opt('desig'));
  layers.fo = L.geoJSON(D.fo, opt('lines'));

  const lakeLabels = L.layerGroup();
  FS.lakeLabels.forEach(([n, lat, lon, km2]) => L.marker([lat, lon], { pane: 'labels', interactive: false, keyboard: false,
    icon: L.divIcon({ className: '', html: `<span class="lakelabel${km2 >= 40 ? ' big' : ''}">${n}</span>`, iconSize: null, iconAnchor: [0, 0] }) }).addTo(lakeLabels));
  layers.nps = L.geoJSON(FS.nps, opt('agency'));
  const hwOrder = { st: 0, us: 1, fwy: 2 };

  layers.foot = L.geoJSON(RC.foot, opt('lines'));
  layers.tr = L.geoJSON(RC.trails, Object.assign(opt('trails'), { interactive: true, bubblingMouseEvents: false }));
  layers.tr.eachLayer(l => l.on('click', (e) => {
    const p = l.feature.properties;
    const mode = { HIK_ONLY: 'Hiking only', EQU_HIK_ONLY: 'Hiking & horses', NON_MOTO_SHARED: 'Shared non-motorized (hike, bike, horse)', BIKE_HIK_ONLY: 'Hiking & biking' }[p.m] || 'Non-motorized';
    L.popup({ maxWidth: 300 }).setLatLng(e.latlng).setContent(`<div class="pp"><span class="kindtag">Hiking trail</span><h3>${esc(p.n || 'Unnamed trail segment')}</h3><dl><dt>Use</dt><dd>${mode}</dd><dt>Segment</dt><dd>${p.mi} mi</dd></dl><div class="coords">${e.latlng.lat.toFixed(5)}°, ${e.latlng.lng.toFixed(5)}°</div></div>`).openOn(map);
  }));

  // Labels
  const cityLayer = L.layerGroup();
  D.cities.forEach(([name, lat, lon, big]) => {
    L.marker([lat, lon], { pane: 'labels', interactive: false, keyboard: false,
      icon: L.divIcon({ className: '', html: `<span class="city${big ? ' big' : ''}">${name}</span>`, iconSize: null, iconAnchor: [3, 6] }) }).addTo(cityLayer);
  });
  const foLabels = L.layerGroup();
  D.fo.features.forEach(f => {
    const c = f.properties.lab; if (!c) return;
    L.marker([c[1], c[0]], { pane: 'labels', interactive: false, keyboard: false,
      icon: L.divIcon({ className: '', html: `<span class="folabel">${f.properties.n.replace(' Field Office', '')}</span>`, iconSize: null, iconAnchor: [30, 5] }) }).addTo(foLabels);
  });

  let blmOpacity = 0.75;
  function applyStyles() {
    layers.neighbor.setStyle({ color: css('--county'), weight: 0.8, fillColor: css('--neighbor'), fillOpacity: landFill });
    layers.county.setStyle({ color: css('--county'), weight: 0.8, fillColor: css('--land'), fillOpacity: landFill });
    layers.blm.setStyle({ color: css('--blm-edge'), weight: 0.5, opacity: Math.min(1, blmOpacity + 0.1), fillColor: css('--blm'), fillOpacity: blmOpacity });
    layers.nlcs.setStyle({ color: css('--nlcs'), weight: 2, fillColor: css('--nlcs'), fillOpacity: 0.08 });
    layers.wild.setStyle({ color: css('--wild'), weight: 1.4, fillColor: css('--wild'), fillOpacity: 0.28 });
    layers.wsa.setStyle({ color: css('--wsa'), weight: 1.4, dashArray: '4 3', fillColor: css('--wsa'), fillOpacity: 0.12 });
    layers.fo.setStyle({ color: css('--fo'), weight: 1.6, dashArray: '7 5', fill: false });
    layers.foot.setStyle({ color: css('--camp'), weight: 1.5, fillColor: css('--camp'), fillOpacity: 0.15 });
    layers.lakes.setStyle({ color: css('--lake-edge'), weight: 0.7, fillColor: css('--lake'), fillOpacity: 1 });
    layers.usfs.setStyle({ color: css('--usfs-edge'), weight: 0.5, fillColor: css('--usfs'), fillOpacity: 0.85 });
    layers.nps.setStyle({ color: css('--nps-edge'), weight: 1.2, fillColor: css('--nps'), fillOpacity: 0.85 });
    layers.hwyCase.setStyle({ color: css('--hwy-case'), weight: 4.5, opacity: 0.9 });
    layers.hwy.eachLayer(g => g.eachLayer(l => { const c = l.feature.properties.c; l.setStyle(c === 'fwy' ? { color: css('--hwy-fwy'), weight: 2.4 } : c === 'us' ? { color: css('--hwy-us'), weight: 1.9 } : { color: css('--hwy-st'), weight: 1.1, opacity: map.getZoom() >= 7.5 ? 0.9 : 0 }); }));
    layers.tr.setStyle({ color: css('--trail'), weight: 2.6, dashArray: '1 4', lineCap: 'round' });
  }
  applyStyles();
  new MutationObserver(applyStyles).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyStyles);

  layers.neighbor.addTo(map);
  const toggles = {
    tr: [layers.tr], lake: [layers.lakes, lakeLabels], usfs: [layers.usfs], nps: [layers.nps], hwy: [layers.hwyCase, layers.hwy], blm: [layers.blm], nlcs: [layers.nlcs], wild: [layers.wild], wsa: [layers.wsa], fo: [layers.fo, foLabels], county: [layers.county, cityLayer]
  };
  // The land fill lives on the county layer; keep it visible even if lines are off
  function setLayer(key, on) {
    if (key === 'county') {
      layers.county.addTo(map);
      layers.county.setStyle({ weight: on ? 0.8 : 0 });
      on ? cityLayer.addTo(map) : cityLayer.remove();
      return;
    }
    toggles[key].forEach(l => on ? l.addTo(map) : l.remove());
  }
  Object.keys(toggles).forEach(k => {
    const el = document.getElementById('lyr-' + k);
    setLayer(k, el.checked);
    el.addEventListener('change', () => setLayer(k, el.checked));
  });

  // ---------- Recreation pins ----------
  const svgPin = {
    ra: (t) => {
      const body = t === 'both'
        ? `<path d="M9 2A7 7 0 0 0 9 16Z" style="fill:var(--hike)"/><path d="M9 2A7 7 0 0 1 9 16Z" style="fill:var(--camp)"/>`
        : `<circle cx="9" cy="9" r="7" style="fill:var(${t === 'hike' ? '--hike' : '--camp'})"/>`;
      return `<svg class="pin" width="18" height="18" viewBox="0 0 18 18">${body}<circle cx="9" cy="9" r="7" stroke-width="2" style="fill:none;stroke:var(--pin-ring)"/></svg>`;
    },
    cg: () => `<svg class="pin" width="18" height="16" viewBox="0 0 18 16"><path d="M9 1.5 16.5 14.5H1.5Z" stroke-width="1.6" stroke-linejoin="round" style="fill:var(--camp);stroke:var(--pin-ring)"/><path d="M9 8.5 11.5 14.5H6.5Z" style="fill:var(--pin-ring)"/></svg>`,
    fc: () => `<svg class="pin" width="18" height="16" viewBox="0 0 18 16"><path d="M9 1.5 16.5 14.5H1.5Z" stroke-width="1.6" stroke-linejoin="round" style="fill:var(--fscamp);stroke:var(--pin-ring)"/><path d="M9 8.5 11.5 14.5H6.5Z" style="fill:var(--pin-ring)"/></svg>`,
    fh: () => `<svg class="pin" width="14" height="14" viewBox="0 0 14 14"><path d="M7 1 13 7 7 13 1 7Z" stroke-width="1.6" style="fill:var(--fscamp);stroke:var(--pin-ring)"/></svg>`,
    th: () => `<svg class="pin" width="14" height="14" viewBox="0 0 14 14"><path d="M7 1 13 7 7 13 1 7Z" stroke-width="1.6" style="fill:var(--hike);stroke:var(--pin-ring)"/></svg>`,
    vc: () => `<svg class="pin" width="16" height="16" viewBox="0 0 16 16"><rect x="1" y="1" width="14" height="14" rx="2.5" stroke-width="1.6" style="fill:var(--info);stroke:var(--pin-ring)"/><rect x="7" y="7" width="2" height="5" style="fill:var(--pin-ring)"/><circle cx="8" cy="4.6" r="1.2" style="fill:var(--pin-ring)"/></svg>`
  };
  const sizes = { fh: [14, 14], ra: [18, 18], fc: [18, 16], cg: [18, 16], th: [14, 14], vc: [16, 16] };
  let amOpen = false, nearOpen = false;
  const campIndex = new Map();
  const nearKm = (a, b) => { const x = (b[1] - a[1]) * 111.32 * Math.cos((a[0] + b[0]) * Math.PI / 360), y = (b[0] - a[0]) * 110.57; return Math.hypot(x, y); };
  function nearbyCamps(ll, maxKm, n) {
    const out = [];
    campIndex.forEach((v) => { const d = nearKm(ll, v.o.ll); if (d <= maxKm && d > 0.05) out.push({ ...v, d }); });
    return out.sort((a, b) => a.d - b.d).slice(0, n);
  }
  const campLabel = { cg: 'BLM', fc: 'National Forest', nc: 'National Park' };
  const nearBlock = (o) => {
    const list = nearbyCamps(o.ll, 25, 5);
    const sum = list.length ? `${list.length === 5 ? '5+' : list.length} within 15 mi · closest ${(list[0].d / 1.609).toFixed(1)} mi` : 'None mapped within 15 mi';
    const items = list.map(v => `<li><button type="button" data-near="${v.o.id}"><span class="tri" style="border-bottom-color:var(${v.k === 'fc' ? '--fscamp' : v.k === 'nc' ? '--nps-edge' : '--camp'})"></span><span>${esc(v.o.n)}<span class="nk">${campLabel[v.k]}${v.o.am && v.o.am.water ? ' · ' + esc(amShort.water[v.o.am.water[0]] || 'water not listed') : ''}</span></span><span class="nd">${(v.d / 1.609).toFixed(1)} mi</span></button></li>`).join('');
    return `<div class="am"><details class="fold nrd"${nearOpen ? ' open' : ''}><summary aria-label="Nearby campgrounds"><span class="sl">Campgrounds</span><span class="st"></span><span class="sx">${sum}</span><span class="chev" aria-hidden="true"></span></summary><div class="wx-in">${list.length ? `<ul class="near-list">${items}</ul>` : '<p class="am-fine">No campgrounds are mapped within 15 miles. Dispersed camping is usually allowed on the surrounding public land.</p>'}<p class="am-fine">Straight-line distance; the drive is often longer.</p></div></details></div>`;
  };
  const dispersedNote = `<div class="disp"><b>Dispersed camping</b>No campsites or facilities: pick a spot that's already been used, at least 200 ft from water. Bring all your water, pack out all trash, and stay no more than 14 days. Campfires and camp stoves need a free <a href="https://www.readyforwildfire.org/permits/campfire-permit/" target="_blank" rel="noopener">California campfire permit ↗</a>.</div>`;
  const isDispersed = (o) => (o.t === 'camp' || o.t === 'both') && nearbyCamps(o.ll, 8, 1).length === 0;
  const amShort = {
    water: { yes: 'Water', no: 'No water', treat: 'Treat water', near: 'Water nearby', check: 'Water unclear', unk: '' },
    toilet: { yes: 'Toilets', no: 'No toilets', near: 'Toilets nearby', unk: '' },
    trash: { yes: 'Trash', no: 'Pack out', unk: '' },
    fire: { yes: 'Fire rings', no: 'No fires', unk: '' }
  };
  const amenBlock = (o, agency) => {
    const a = o.am; if (!a) return '';
    const bits = ['water', 'toilet', 'trash', 'fire'].map(k => amShort[k][a[k][0]]).filter(Boolean);
    const sum = (a.note ? '<span class="warn">Notice</span> · ' : '') + (bits.length ? esc(bits.join(' · ')) : 'Few details on record');
    const row = (lab, v) => `<dt>${lab}</dt><span class="am-dot ${v[0]}"></span><dd class="${v[0] === 'unk' ? 'unk' : ''}">${esc(v[1])}</dd>`;
    const fireNote = a.fire[0] === 'no' ? '' : 'Fire rules change with the season and fire danger, and bans are common in summer and fall. Check current restrictions on the campground page before lighting a fire.';
    const permit = a.permit ? ' Outside developed campgrounds, California requires a free <a href="https://www.readyforwildfire.org/permits/campfire-permit/" target="_blank" rel="noopener">campfire permit ↗</a> for campfires and camp stoves.' : '';
    const src = agency === 'fs' ? 'From Forest Service records and the site description.' : 'From BLM records and the site description. BLM lists few amenities, so "Not listed" is common.';
    return `<div class="am"><details class="fold amd"${amOpen ? ' open' : ''}><summary aria-label="Amenities"><span class="sl">Amenities</span><span class="st"></span><span class="sx">${sum}</span><span class="chev" aria-hidden="true"></span></summary><div class="wx-in">`
      + (a.note ? `<div class="am-note">${esc(a.note)}</div>` : '')
      + `<dl class="am-rows">${row('Water', a.water)}${row('Toilets', a.toilet)}${row('Trash', a.trash)}${row('Campfires', a.fire)}</dl>`
      + (a.ex && a.ex.length ? `<div class="am-ex">${a.ex.map(x => `<span>${esc(x)}</span>`).join('')}</div>` : '')
      + ((fireNote || permit) ? `<p class="am-fine">${fireNote}${permit}</p>` : '')
      + `<p class="am-fine">${src}</p></div></details></div>`;
  };
  const wxSlot = (o) => { if (!o.id) return ''; const key = `t${Math.floor(o.ll[0])}_${Math.floor(o.ll[1])}`; return `<div class="wx" data-wx="${o.id}" data-tile="${key}">${wxBody(key, o.id)}</div>`; };
  const coords = (ll) => `<div class="coords">${ll[0].toFixed(5)}°, ${ll[1].toFixed(5)}°</div>`;
  const rgSearch = (n) => 'https://www.recreation.gov/search?q=' + encodeURIComponent(n);
  const links = (o, camp) => {
    const a = [];
    if (camp) {
      a.push(`<a href="${esc(o.url || rgSearch(o.n))}" target="_blank" rel="noopener">Campground info ↗</a>`);
      a.push(o.res ? `<a class="res" href="${esc(o.res)}" target="_blank" rel="noopener">Reserve on Recreation.gov ↗</a>`
                   : `<a href="${esc(rgSearch(o.n))}" target="_blank" rel="noopener">Check Recreation.gov ↗</a>`);
    } else {
      if (o.url) a.push(`<a href="${esc(o.url)}" target="_blank" rel="noopener">BLM page ↗</a>`);
      if (o.res) a.push(`<a href="${esc(o.res)}" target="_blank" rel="noopener">Reserve ↗</a>`);
    }
    a.push(`<a href="https://www.google.com/maps/dir/?api=1&destination=${o.ll[0]},${o.ll[1]}" target="_blank" rel="noopener">Directions ↗</a>`);
    return `<div class="links">${a.join('')}</div>`;
  };
  const dl = (o) => { let r = ''; if (o.stay) r += `<dt>Stay limit</dt><dd>${esc(o.stay)}</dd>`; if (o.ph) r += `<dt>Phone</dt><dd>${esc(o.ph)}</dd>`; return r ? `<dl>${r}</dl>` : ''; };
  const favs = new Map();   // site id -> saved row (filled after sign-in)
  // ---------- Live status + alerts in popups ----------
  let STATUS = null, ALERTS = null;
  const fmtWhen = (iso) => { try { return new Date(iso).toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit' }); } catch (e) { return ''; } };
  function live(o) {
    let h = '';
    const st = STATUS && STATUS.s[o.id];
    const al = ALERTS && ALERTS.sites[o.id];
    if (al && al.c) h += `<div class="alert sev-hi"><b>Temporarily closed</b>The Forest Service has marked this site temporarily closed. Check the info page before you go.</div>`;
    if (al && al.f) al.f.forEach(([i, mi]) => { const f = ALERTS.fires[i]; if (f) h += `<div class="alert sev-hi"><b>${mi === 0 ? 'Inside an active wildfire' : `Active wildfire ${mi} mi away`}</b>${esc(f.n)}, ${f.ac ? Number(f.ac).toLocaleString('en-US') + ' acres' : 'size unknown'}${f.pc != null ? `, ${f.pc}% contained` : ''}. Expect closures and smoke.</div>`; });
    if (al && al.a) al.a.forEach(id => { const a = ALERTS.nws[id]; if (a) h += `<div class="alert ${a.sev === 'Extreme' || a.sev === 'Severe' ? 'sev-hi' : 'sev-md'}"><b>${esc(a.e)}</b>${a.ends ? 'Until ' + esc(fmtWhen(a.ends)) + '. ' : ''}<a href="${esc(a.url)}" target="_blank" rel="noopener">Details ↗</a></div>`; });
    if (st) h += `<div class="status-line">Status: <span class="${st === 'open' ? 'st-open' : 'st-closed'}">${esc(st[0].toUpperCase() + st.slice(1))}</span> <span>· Forest Service, checked ${esc(fmtWhen(STATUS.updated))}</span></div>`;
    else if (o.st && !STATUS) h += `<div class="status-line">Status: <span class="${o.st === 'open' ? 'st-open' : 'st-closed'}">${esc(o.st[0].toUpperCase() + o.st.slice(1))}</span> <span>· as of the last data update</span></div>`;
    return h;
  }
  let canSave = false;   // true once Supabase accounts are configured
  const shareSvg = '<svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1.5v9M4.5 5 8 1.5 11.5 5M3 9v4.5h10V9" style="fill:none;stroke:currentColor;stroke-width:1.6;stroke-linecap:round;stroke-linejoin:round"/></svg>';
  const iconBtns = (o) => `<span class="name-icons">${canSave ? `<button type="button" class="ico star${favs.has(o.id) ? ' on' : ''}" data-fav="${o.id}" aria-pressed="${favs.has(o.id)}" aria-label="${favs.has(o.id) ? 'Remove from my places' : 'Save to my places'}" title="${favs.has(o.id) ? 'Saved (click to remove)' : 'Save to my places'}">${favs.has(o.id) ? '★' : '☆'}</button>` : ''}<button type="button" class="ico" data-share="${o.id}" aria-label="Share a link to ${esc(o.n)}" title="Share link">${shareSvg}</button></span>`;
  const titleRow = (o) => !o.id ? `<h3>${esc(o.n)}</h3>` : `${SHOW_PHOTOS && o.img && o.img.length ? `<a class="pp-photo" href="place.html?id=${o.id}"><img src="${esc(o.th ? 'thumbs/' + o.id + '.webp' : o.img[0])}" alt="Photo of ${esc(o.n)}" loading="lazy" onerror="this.parentNode.remove()"></a>` : ''}<div class="title-row" data-site="${o.id}"><h3><a href="place.html?id=${o.id}" title="Open the full page for ${esc(o.n)}">${esc(o.n)}</a></h3>${iconBtns(o)}</div>`;

  const pops = {
    ra: (o) => {
      const disp = isDispersed(o);
      const kindName = { Area: 'Area', Spot: 'Single site', Trail: 'Trail', Camp: 'Camp' }[o.pk] || 'Area';
      const act = o.t === 'both' ? (disp ? 'hiking & dispersed camping' : 'hiking & camping') : o.t === 'hike' ? 'hiking' : (disp ? 'dispersed camping' : 'camping');
      const chips = o.acts.map(a => a === 'Camping' && disp ? 'Dispersed Camping' : a);
      return `<div class="pp"><span class="kindtag">BLM recreation ${kindName.toLowerCase()} · ${act}</span>${titleRow(o)}${o.id ? live(o) : ''}<div class="acts">${chips.map(a => `<span class="${/Hiking|Camping/.test(a) ? 'on' : ''}">${esc(a)}</span>`).join('')}</div>${o.d ? `<p class="desc">${esc(o.d)}</p>` : ''}${disp ? dispersedNote : ''}${dl(o)}${links(o)}${coords(o.ll)}${amenBlock(o, 'blm')}${wxSlot(o)}</div>`;
    },
    cg: (o) => `<div class="pp"><span class="kindtag">BLM · ${esc(o.k)}</span>${titleRow(o)}${o.id ? live(o) : ''}${o.d ? `<p class="desc">${esc(o.d)}</p>` : ''}${dl(o)}${links(o, true)}${coords(o.ll)}${amenBlock(o, 'blm')}${wxSlot(o)}</div>`,
    fc: (o) => {
      let r = `<dt>Forest</dt><dd>${esc(o.forest)}</dd>`;
      if (o.season) r += `<dt>Open season</dt><dd>${esc(o.season)}</dd>`;
      if (o.cap) r += `<dt>Capacity</dt><dd>${o.cap} people</dd>`;
      return `<div class="pp"><span class="kindtag">National Forest · ${esc(o.k)}</span>${titleRow(o)}${o.id ? live(o) : ''}${o.d ? `<p class="desc">${esc(o.d)}</p>` : ''}<dl>${r}</dl>${o.ri ? `<div class="resnote">${esc(o.ri)}</div>` : ''}${links(o, true)}${coords(o.ll)}${amenBlock(o, 'fs')}${wxSlot(o)}</div>`;
    },
    th: (o) => `<div class="pp"><span class="kindtag">BLM trailhead</span>${titleRow(o)}${o.id ? live(o) : ''}${links(o)}${coords(o.ll)}${wxSlot(o)}</div>`,
    fh: (o) => {
      let r = `<dt>Forest</dt><dd>${esc(o.forest)}</dd>`;
      if (o.season) r += `<dt>Open season</dt><dd>${esc(o.season)}</dd>`;
      if (o.restr) r += `<dt>Rules</dt><dd>${esc(o.restr)}</dd>`;
      const lk = [];
      if (o.url) lk.push(`<a href="${esc(o.url)}" target="_blank" rel="noopener">Trail info ↗</a>`);
      lk.push(`<a href="https://www.google.com/maps/dir/?api=1&destination=${o.ll[0]},${o.ll[1]}" target="_blank" rel="noopener">Directions ↗</a>`);
      return `<div class="pp"><span class="kindtag">National Forest · ${esc(o.k)}</span>${titleRow(o)}${o.id ? live(o) : ''}${o.d ? `<p class="desc">${esc(o.d)}</p>` : ''}<dl>${r}</dl><div class="links">${lk.join('')}</div>${coords(o.ll)}${amenBlock(o, 'fs')}${wxSlot(o)}</div>`;
    },
    vc: (o) => `<div class="pp"><span class="kindtag">${esc(o.k)}</span>${titleRow(o)}${o.id ? live(o) : ''}${links(o)}${coords(o.ll)}</div>`
  };
  // Pins are drawn on one canvas (triangles, diamonds, circles) instead of ~1,700 separate page elements.
  const ShapeMarker = L.CircleMarker.extend({
    _updatePath() {
      const r = this._renderer; if (!r._drawing || this._empty()) return;
      const p = this._point, z = this._radius, ctx = r._ctx, sh = this.options.shape, o = this.options;
      ctx.beginPath();
      if (sh === 'tri') { ctx.moveTo(p.x, p.y - z); ctx.lineTo(p.x + z * 1.08, p.y + z * 0.82); ctx.lineTo(p.x - z * 1.08, p.y + z * 0.82); ctx.closePath(); }
      else if (sh === 'dia') { ctx.moveTo(p.x, p.y - z); ctx.lineTo(p.x + z, p.y); ctx.lineTo(p.x, p.y + z); ctx.lineTo(p.x - z, p.y); ctx.closePath(); }
      else if (sh === 'sq') { ctx.rect(p.x - z * 0.85, p.y - z * 0.85, z * 1.7, z * 1.7); }
      else if (sh === 'split') {   // half hiking colour, half camping colour
        ctx.globalAlpha = 1;
        ctx.arc(p.x, p.y, z, Math.PI / 2, Math.PI * 1.5); ctx.closePath(); ctx.fillStyle = o.fillColor; ctx.fill();
        ctx.beginPath(); ctx.arc(p.x, p.y, z, -Math.PI / 2, Math.PI / 2); ctx.closePath(); ctx.fillStyle = o.fillColor2; ctx.fill();
        ctx.beginPath(); ctx.arc(p.x, p.y, z, 0, Math.PI * 2); ctx.lineWidth = o.weight; ctx.strokeStyle = o.color; ctx.stroke(); return;
      } else ctx.arc(p.x, p.y, z, 0, Math.PI * 2);
      r._fillStroke(ctx, this);
    }
  });
  const pinRenderer = L.canvas({ pane: 'rec', padding: 0.5, tolerance: 4 });
  const pinSpec = { ra: ['circle', 7], cg: ['tri', 7.5], fc: ['tri', 7.5], th: ['dia', 6], fh: ['dia', 6], vc: ['sq', 6] };
  let pinScale = 1;
  function pinStyle(k, o) {
    const ring = css('--pin-ring');
    const fill = k === 'ra' ? (o.t === 'camp' ? css('--camp') : css('--hike')) : k === 'cg' ? css('--camp') : k === 'fc' || k === 'fh' ? css('--fscamp') : k === 'th' ? css('--hike') : css('--info');
    return { color: ring, weight: 1.6, opacity: 1, fillColor: fill, fillColor2: css('--camp'), fillOpacity: 1, shape: k === 'ra' && o.t === 'both' ? 'split' : pinSpec[k][0] };
  }
  // Order matters on a canvas: later groups draw on top, so campgrounds go first and recreation areas last.
  const recSets = { fc: FS.fsc, cg: RC.camps, fh: FS.fsh, th: RC.th, vc: RC.info, ra: RC.sites };
  const allPins = [];
  Object.entries(recSets).forEach(([k, arr]) => {
    const g = L.layerGroup();
    arr.forEach(o => {
      o.marker = new ShapeMarker(o.ll, Object.assign({ renderer: pinRenderer, pane: 'rec', radius: pinSpec[k][1] * pinScale, bubblingMouseEvents: false }, pinStyle(k, o)))
        .bindPopup(() => pops[k](o), { maxWidth: Math.min(400, window.innerWidth - 48), minWidth: Math.min(360, window.innerWidth - 48), maxHeight: Math.max(320, Math.min(640, window.innerHeight - 140)), offset: [0, -4] })
        .bindTooltip(o.n, { direction: 'top', offset: [0, -8], opacity: 0.95 }).addTo(g);
      o.marker._k = k; allPins.push(o.marker);
    });
    layers[k] = g; toggles[k] = k === 'cg' ? [g, layers.foot] : [g];
    const el = document.getElementById('lyr-' + k); setLayer(k, el.checked); el.addEventListener('change', () => setLayer(k, el.checked));
  });
  // Smaller pins when zoomed out; recolour on theme changes
  function sizePins() {
    const sc = map.getZoom() < 7.5 ? 0.65 : 1;
    if (sc === pinScale) return; pinScale = sc;
    allPins.forEach(m => { if (!m._hl) m.setRadius(pinSpec[m._k][1] * sc); });
  }
  map.on('zoomend', sizePins); sizePins();
  const recolorPins = () => Object.entries(recSets).forEach(([k, arr]) => arr.forEach(o => o.marker.setStyle(pinStyle(k, o))));
  new MutationObserver(recolorPins).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', recolorPins);
  const pinIndex = new Map();
  Object.entries(recSets).forEach(([k, arr]) => { if (k !== 'vc') arr.forEach(o => o.id && pinIndex.set(o.id, { o, k })); });
  document.getElementById('cnt-ra').textContent = RC.sites.length;
  RC.camps.forEach(o => campIndex.set(o.id, { o, k: 'cg' })); FS.fsc.forEach(o => campIndex.set(o.id, { o, k: 'fc' }));
  document.getElementById('cnt-cg').textContent = RC.camps.length;
  document.getElementById('cnt-fh').textContent = FS.fsh.length;
  document.getElementById('cnt-lake').textContent = FS.lakes.features.filter(f => f.properties.n).length + ' named';
  document.getElementById('cnt-fc').textContent = FS.fsc.length;
  document.getElementById('cnt-nps').textContent = FS.nps.features.length;
  document.getElementById('cnt-usfs').textContent = FS.forests.features.length + ' forests';
  document.getElementById('cnt-th').textContent = RC.th.length;
  document.getElementById('cnt-vc').textContent = RC.info.length;
  document.getElementById('cnt-tr').textContent = RC.trailMiles + ' mi';

  // ---------- Weather (read from the map's database; a refresh job fills it from NWS) ----------
  // ---------- Live feeds (weather, status, alerts) from Supabase; scheduled jobs keep them current ----------
  // New-style Supabase keys (sb_publishable_...) go only in the apikey header; legacy anon JWTs also as a Bearer token.
  const sbHeaders = () => { const k = CFG.supabaseAnonKey || ''; return /^eyJ/.test(k) ? { apikey: k, Authorization: 'Bearer ' + k } : { apikey: k }; };
  const feedCache = new Map();
  function feed(key) {
    if (!feedCache.has(key)) {
      const p = !CFG.supabaseUrl ? Promise.resolve(undefined) : Promise.race([
        fetch(`${CFG.supabaseUrl}/rest/v1/feeds?key=eq.${encodeURIComponent(key)}&select=data`, { headers: sbHeaders() })
          .then(r => r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status))).then(rows => rows[0] ? rows[0].data : null),
        new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 10000))]);
      p.catch(() => feedCache.delete(key));
      feedCache.set(key, p);
    }
    return feedCache.get(key);
  }
  const loadTile = (key) => feed('wx:' + key).then(d => d === undefined ? { none: true } : d === null ? { missing: true } : d);
  const icon = (txt) => {
    const t = (txt || '').toLowerCase();
    const cloud = '<path d="M5 13h8.5a3 3 0 0 0 .3-6 4 4 0 0 0-7.6 1.2A2.4 2.4 0 0 0 5 13Z" style="fill:var(--ink-2)"/>';
    let extra = '', body = cloud;
    if (/thunder|storm/.test(t)) extra = '<path d="M9 13l-1.5 3h2l-1 3" style="fill:none;stroke:var(--hwy-us);stroke-width:1.3"/>';
    else if (/snow|flurr|sleet|blizzard/.test(t)) extra = '<circle cx="7" cy="15.5" r="1" style="fill:var(--camp)"/><circle cx="10.5" cy="16.5" r="1" style="fill:var(--camp)"/><circle cx="13" cy="15" r="1" style="fill:var(--camp)"/>';
    else if (/rain|shower|drizzle/.test(t)) extra = '<path d="M7 14.5l-1 2.5M10.5 14.5l-1 2.5M14 14.5l-1 2.5" style="stroke:var(--camp);stroke-width:1.3;stroke-linecap:round"/>';
    else if (/fog|haze|smoke/.test(t)) { body = '<path d="M3 8h12M4.5 11h10M3 14h12" style="stroke:var(--ink-2);stroke-width:1.4;stroke-linecap:round"/>'; }
    else if (/partly|mostly sunny|mostly clear|few clouds/.test(t)) body = '<circle cx="7" cy="7" r="3.2" style="fill:var(--blm-edge)"/>' + cloud;
    else if (/sunny|clear|fair/.test(t)) body = '<circle cx="9" cy="9" r="4" style="fill:var(--blm-edge)"/>';
    return `<svg width="18" height="18" viewBox="0 0 18 19" aria-hidden="true">${body}${extra}</svg>`;
  };
  const ft = (m) => Math.round(m * 3.281).toLocaleString('en-US');
  const ago = (h) => h < 1 ? Math.max(1, Math.round(h * 60)) + ' min ago' : Math.round(h) + ' h ago';
  function renderWx(rec, updated) {
    if (!rec) return '<div class="wx-load">No weather for this spot in the latest update.</div>';
    let html = '';
    const c = rec.cur;
    if (c) {
      const meta = [c.w != null ? `Wind ${c.w} mph${c.wd ? ' ' + c.wd : ''}${c.gu ? `, gusts ${c.gu}` : ''}` : '', c.rh != null ? `Humidity ${Math.round(c.rh)}%` : ''].filter(Boolean).join(' · ');
      html += `<div class="wx-now"><div class="wx-t">${c.t}°</div><div><div class="wx-x">${esc(c.x || 'Current conditions')}</div><div class="wx-meta">${meta}</div></div></div>`;
      let src;
      if (c.src === 'obs') src = `<span class="wx-tag obs">Station</span><span>Observed at ${esc(titleCase(c.stn))}, ${c.km} km away, ${ago(c.age)}</span>`;
      else if (c.src === 'est') {
        const dz = c.dz ? `, adjusted for this spot being ${ft(Math.abs(c.dz))} ft ${c.dz > 0 ? 'higher' : 'lower'}` : '';
        src = `<span class="wx-tag est">Estimate</span><span>No station right here. Blended from ${c.n} stations about ${c.km} km away${dz}.</span>`;
      } else src = `<span class="wx-tag model">Model</span><span>No recent station reports nearby. NWS hourly forecast for this exact spot.</span>`;
      html += `<div class="wx-src">${src}</div>`;
    }
    const f = rec.fc;
    if (f && f.days && f.days.length) {
      const his = f.days.flatMap(d => [d.hi, d.lo]).filter(v => v != null);
      const mn = Math.min(...his), mx = Math.max(...his), span = Math.max(1, mx - mn);
      html += `<div class="wx-h"><span>7-day forecast</span><span>${rec.el != null ? ft(rec.el) + ' ft · ' : ''}${f.src === 'nws' ? 'NWS' : 'Estimated'}</span></div><div class="wx-days">`;
      f.days.forEach(d => {
        const lo = d.lo ?? d.hi, hi = d.hi ?? d.lo;
        const l = (lo - mn) / span * 100, w = Math.max(4, (hi - lo) / span * 100);
        const sky = d.s || d.sn;
        html += `<div class="wx-day" title="${esc(sky)}${d.sn && d.s ? ' / night: ' + esc(d.sn) : ''}"><span class="dn">${esc(d.d)}</span>${icon(sky)}<span class="lo">${d.lo ?? ''}${d.lo != null ? '°' : ''}</span><span class="wx-bar"><i style="left:${l}%;width:${w}%"></i></span><span>${d.hi ?? ''}${d.hi != null ? '°' : ''}</span><span class="pp${d.p >= 10 ? '' : ' dry'}">${d.snow ? '<span class="snow">snow</span>' : d.p + '%'}</span></div>`;
      });
      html += '</div>';
      if (f.src === 'est') html += `<div class="wx-src"><span class="wx-tag est">Estimate</span><span>Built from forecasts for ${f.n} nearby sites, corrected for elevation.</span></div>`;
    }
    if (updated) {
      const h = (Date.now() - Date.parse(updated)) / 3.6e6;
      const when = new Date(updated).toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit' });
      html += `<div class="wx-foot${h > 6 ? ' stale' : ''}">Weather updated ${when}${h > 6 ? `, ${Math.round(h)} hours ago, so it may be out of date` : ''}.</div>`;
    }
    return html;
  }
  const titleCase = (s) => String(s || '').toLowerCase().replace(/\b([a-z])/g, m => m.toUpperCase());
  const done = new Map();   // tile key -> loaded document or an error marker
  function wxBody(key, id) {
    const doc = done.get(key);
    if (!doc) return '<div class="wx-load">Loading weather…</div>';
    if (doc.err) { done.delete(key); return '<div class="wx-load">Weather couldn\'t be reached right now. Close and reopen this popup to try again.</div>'; }
    if (doc.none) return '<div class="wx-load">Weather isn\'t connected on this copy of the site yet.</div>';
    if (doc.missing) return '<div class="wx-load">No weather has been loaded for this area yet.</div>';
    const rec = (doc.sites || {})[id];
    if (!rec) return '<div class="wx-load">No weather for this spot in the latest update.</div>';
    const c = rec.cur, d0 = rec.fc && rec.fc.days && rec.fc.days[0];
    const sumT = c ? `${c.t}°` : d0 && d0.hi != null ? `${d0.hi}°` : '';
    const sumX = c ? (c.x || '') : d0 ? d0.s : '';
    const hiLo = d0 ? ` · ${d0.hi != null ? 'H ' + d0.hi + '°' : ''}${d0.lo != null ? ' L ' + d0.lo + '°' : ''}` : '';
    return `<details class="fold wxd"${wxOpen ? ' open' : ''}><summary aria-label="Weather and 7-day forecast"><span class="sl">Weather</span><span class="st">${sumT}</span><span class="sx">${esc(sumX)}${hiLo}</span><span class="chev" aria-hidden="true"></span></summary><div class="wx-in">${renderWx(rec, doc.updated)}</div></details>`;
  }
  let wxOpen = false;   // remembers the last choice for the rest of the visit
  document.getElementById('map').addEventListener('toggle', (ev) => {
    const d = ev.target; if (!d.classList || !d.classList.contains('fold')) return;
    if (d.classList.contains('wxd')) wxOpen = d.open; else if (d.classList.contains('nrd')) nearOpen = d.open; else amOpen = d.open; const pop = map._popup; if (pop && pop.isOpen()) { pop._updateLayout(); pop._updatePosition(); if (d.open) pop._adjustPan(); }
  }, true);
  map.on('popupopen', (e) => {
    const el = e.popup.getElement(); const slot = el && el.querySelector('.wx[data-tile]');
    if (!slot || done.has(slot.dataset.tile)) return;
    const key = slot.dataset.tile;
    loadTile(key).then(doc => done.set(key, doc), () => done.set(key, { err: true }))
      .then(() => { if (e.popup.isOpen()) e.popup.update(); });
  });

  const fmt = (n) => Math.round(n).toLocaleString('en-US');
  const fmtAc = (a) => a >= 1e6 ? (a / 1e6).toFixed(2) + 'M ac' : a >= 1e4 ? Math.round(a / 1e3) + 'k ac' : fmt(a) + ' ac';
    document.getElementById('cnt-nlcs').textContent = D.nlcs.features.length;
  document.getElementById('cnt-wild').textContent = D.wild.features.length;
  document.getElementById('cnt-wsa').textContent = D.wsa.features.length;
  document.getElementById('cnt-fo').textContent = D.fo.features.length;

  const op = document.getElementById('opacity'), opv = document.getElementById('opacityVal');
  op.addEventListener('input', () => { blmOpacity = +op.value; opv.textContent = Math.round(blmOpacity * 100) + '%'; layers.blm.setStyle({ fillOpacity: blmOpacity, opacity: Math.min(1, blmOpacity + 0.1) }); });

  // ---------- Spatial index for click lookup ----------
  function prepare(fc) {
    const out = [];
    fc.features.forEach((f, i) => {
      const g = f.geometry; if (!g) return;
      const polys = g.type === 'MultiPolygon' ? g.coordinates : [g.coordinates];
      polys.forEach(p => {
        let x0 = 180, y0 = 90, x1 = -180, y1 = -90;
        for (const [x, y] of p[0]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
        out.push({ f, p, bb: [x0, y0, x1, y1] });
      });
    });
    return out;
  }
  function inRing(x, y, r) {
    let c = false;
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const xi = r[i][0], yi = r[i][1], xj = r[j][0], yj = r[j][1];
      if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c;
    }
    return c;
  }
  function hit(idx, x, y) {
    for (const it of idx) {
      const b = it.bb; if (x < b[0] || x > b[2] || y < b[1] || y > b[3]) continue;
      if (inRing(x, y, it.p[0])) {
        let hole = false;
        for (let k = 1; k < it.p.length; k++) if (inRing(x, y, it.p[k])) { hole = true; break; }
        if (!hole) return it.f;
      }
    }
    return null;
  }
  const IDX = {}; let idxReady = false;
  function buildIdx() { if (idxReady) return; ['blm', 'nlcs', 'wild', 'wsa', 'fo', 'counties', 'neighbors'].forEach(k => IDX[k] = prepare(D[k])); ['nps', 'usfs', 'forests', 'lakes'].forEach(k => IDX[k] = prepare(FS[k])); idxReady = true; }
  setTimeout(buildIdx, 300);

  const kindName = { BLM_NM: 'National Monument', BLM_NCA: 'National Conservation Area', BLM_NA: 'Outstanding Natural Area', BLM_FR: 'Forest Reserve', BLM_NSA: 'National Scenic Area' };
  const esc = (s) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // Clicking empty map (or pressing Esc) clears the selected place; it doesn't drop a point.
  map.on('click', () => map.closePopup());
  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape' && !document.querySelector('dialog[open]') && map._popup && map._popup.isOpen()) map.closePopup();
  });

  const syncZoom = () => document.getElementById('map').classList.toggle('far', map.getZoom() < (narrow() ? 7 : 6.25));
  let lastFar = null;
  const syncLake = () => { const m = document.getElementById('map'), z = map.getZoom(); m.classList.toggle('z7', z >= 7); m.classList.toggle('z9', z >= 9); };
  map.on('zoomend', syncLake); syncLake();
  map.on('zoomend', () => { syncZoom(); const far = map.getZoom() < 7.5; document.getElementById('map').classList.toggle('wide', far); if (far !== lastFar) { lastFar = far; applyStyles(); } }); syncZoom(); document.getElementById('map').classList.toggle('wide', map.getZoom() < 7.5);

  const ro = document.getElementById('readout');
  map.on('mousemove', (e) => { ro.textContent = `${e.latlng.lat.toFixed(4)}° N  ${Math.abs(e.latlng.lng).toFixed(4)}° W  ·  z${map.getZoom().toFixed(1)}`; });

  // ---------- Designated area list ----------
  const units = [];
  D.nlcs.features.forEach(f => units.push({ f, n: f.properties.n, k: kindName[f.properties.k] || (/National Monument/.test(f.properties.n) ? 'National Monument' : 'Conservation area'), c: '--nlcs', layer: 'nlcs', a: f.properties.a }));
  D.wild.features.forEach(f => units.push({ f, n: f.properties.n, k: 'Wilderness' + (f.properties.y ? ' · ' + f.properties.y : ''), c: '--wild', layer: 'wild', a: f.properties.a }));
  D.wsa.features.forEach(f => units.push({ f, n: f.properties.n, k: 'Wilderness study area', c: '--wsa', layer: 'wsa', a: f.properties.a }));
  RC.sites.forEach(o => units.push({ o, n: o.n, k: 'Recreation area · ' + (o.t === 'both' ? 'hike & camp' : o.t === 'hike' ? 'hiking' : 'camping'), c: o.t === 'camp' ? '--camp' : '--hike', layer: 'ra', a: -1 }));
  RC.camps.forEach(o => units.push({ o, n: o.n, k: 'BLM · ' + o.k, c: '--camp', layer: 'cg', a: -1 }));
  FS.lakes.features.forEach(f => { if (f.properties.n) units.push({ f, n: f.properties.n, k: f.properties.r ? 'Reservoir' : 'Lake', c: '--lake-edge', layer: 'lake', a: f.properties.a }); });
  FS.fsh.forEach(o => units.push({ o, n: o.n, k: o.k + ' · ' + o.forest, c: '--fscamp', layer: 'fh', a: -1 }));
  document.getElementById('map').addEventListener('click', (ev) => {
    const b = ev.target.closest && ev.target.closest('[data-near]'); if (!b) return;
    ev.stopPropagation(); const v = campIndex.get(b.dataset.near); if (!v) return;
    zoomTo({ o: v.o, layer: v.k });
  }, true);
  FS.fsc.forEach(o => units.push({ o, n: o.n, k: o.forest, c: '--fscamp', layer: 'fc', a: -1 }));
  FS.nps.features.forEach(f => units.push({ f, n: f.properties.n, k: 'National Park Service', c: '--nps-edge', layer: 'nps', a: f.properties.a }));
  FS.forests.features.forEach(f => units.push({ f, n: f.properties.n, k: 'National Forest', c: '--usfs-edge', layer: 'usfs', a: f.properties.a }));
  RC.th.forEach(o => units.push({ o, n: o.n, k: 'Trailhead', c: '--hike', layer: 'th', a: -1 }));
  const ul = document.getElementById('units'), search = document.getElementById('search');
  let hl = null;
  function render() {
    const q = search.value.trim().toLowerCase();
    const list = (q ? units.filter(u => u.n.toLowerCase().includes(q)) : units.filter(u => u.layer === 'nlcs'))
      .sort((a, b) => (b.a - a.a) || a.n.localeCompare(b.n)).slice(0, q ? 50 : 20);
    ul.innerHTML = list.length ? '' : `<li class="empty">No designated area matches “${esc(search.value)}”.</li>`;
    list.forEach(u => {
      const li = document.createElement('li');
      li.innerHTML = `<button type="button"><span class="dot" style="background:var(${u.c})"></span><span>${esc(u.n)}<span class="kind">${esc(u.k)}</span></span><span class="ac">${u.a > 0 ? fmtAc(u.a) : ''}</span></button>`;
      li.firstChild.addEventListener('click', () => zoomTo(u));
      ul.appendChild(li);
    });
  }
  function zoomTo(u) {
    const el = document.getElementById('lyr-' + u.layer);
    if (!el.checked) { el.checked = true; setLayer(u.layer, true); }
    if (hl) { hl.remove(); hl = null; }
    if (u.o) {
      if (narrow()) setSheet(false);
      map.flyTo(u.o.ll, Math.max(map.getZoom(), 12), { duration: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 0.8 });
      map.once('moveend', () => u.o.marker.openPopup());
      return;
    }
    hl = L.geoJSON(u.f, { pane: 'lines', interactive: false, renderer: rd.lines, style: { color: css('--ink'), weight: 2.5, fill: false } }).addTo(map);
    const pad = { paddingTopLeft: [30, 30], paddingBottomRight: [30, 30], maxZoom: 12 };
    map.flyToBounds(hl.getBounds(), Object.assign({ duration: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 0.8 }, pad));
    if (narrow()) setSheet(false);
  }
  search.addEventListener('input', render);
  render();

  // ---------- Left-column tabs ----------
  const mapSection = document.getElementById('map-section');
  const tabs = { camps: 't-camps', mine: 't-mine' };
  // Floating map filters (layer switches, basemap, search): open on wide screens, tucked away on phones
  const mf = document.getElementById('mapFilters'), mfBtn = document.getElementById('mfToggle');
  function setFilters(open) { mf.classList.toggle('closed', !open); mfBtn.setAttribute('aria-expanded', open); mfBtn.textContent = open ? 'Hide' : 'Show'; }
  mfBtn.addEventListener('click', () => setFilters(mf.classList.contains('closed')));
  setFilters(!narrow());
  function selectTab(name) {
    Object.entries(tabs).forEach(([k, id]) => {
      const on = k === name; document.getElementById(id).setAttribute('aria-selected', on);
      document.getElementById('tab-' + k).hidden = !on;
    });
  }
  Object.entries(tabs).forEach(([k, id]) => document.getElementById(id).addEventListener('click', () => selectTab(k)));
  // On phones the lists sit under the map: bring the map back into view when something is picked.
  function setSheet(open) { if (!open && narrow()) mapSection.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
  new ResizeObserver(() => map.invalidateSize()).observe(mapSection);

  // ---------- Basemap picker ----------
  document.querySelectorAll('[data-base]').forEach(b => b.addEventListener('click', () => setBase(b.dataset.base)));
  let savedBase = 'relief'; try { savedBase = localStorage.getItem('base') || 'relief'; } catch (e) {}
  setBase(savedBase);

  // ---------- Toasts ----------
  const toast = (m) => window.Account.toast(m);

  // ---------- Share links: ?site=<id> opens that place ----------
  const siteUrl = (id) => location.origin + location.pathname + '?site=' + encodeURIComponent(id);
  async function shareLink(url, title) {
    if (navigator.share && narrow()) { try { await navigator.share({ title, url }); return; } catch (e) { if (e && e.name === 'AbortError') return; } }
    try { await navigator.clipboard.writeText(url); toast('Link copied'); } catch (e) { window.prompt('Copy this link:', url); }
  }
  function openSite(id) {
    const v = pinIndex.get(id); if (!v) { toast('That place is no longer on the map.'); return; }
    zoomTo({ o: v.o, layer: v.k });
  }

  // ---------- Favorites (sign-in lives in account.js, shared with the campground pages) ----------
  const Account = window.Account, sb = Account.sb;
  const mineList = document.getElementById('mineList');
  if (sb) canSave = true;
  function refreshOpenPopup() { const p = map._popup; if (p && p.isOpen()) p.update(); }
  function renderMine() {
    const user = Account.user;
    document.getElementById('mineSignedOut').hidden = !!user;
    document.querySelector('#mine .share-row').hidden = !user;
    const rows = [...favs.values()].sort((a, b) => a.name.localeCompare(b.name));
    document.getElementById('mineCount').textContent = rows.length;
    document.getElementById('mineCountHdr').textContent = rows.length;
    mineList.innerHTML = !user ? '' : rows.length ? '' : '<li class="empty">Tap ☆ Save on any campground, trailhead or area to keep it here.</li>';
    if (!user) return;
    rows.forEach(r => {
      const li = document.createElement('li');
      li.innerHTML = `<button type="button" class="go"><span class="dot" style="background:var(--fscamp)"></span><span>${esc(r.name)}<span class="kind">${esc(r.kind_label || '')}</span></span></button><button type="button" class="rm" aria-label="Remove ${esc(r.name)}">Remove</button>`;
      li.querySelector('.go').addEventListener('click', () => openSite(r.site_id));
      li.querySelector('.rm').addEventListener('click', () => toggleFav(r.site_id));
      mineList.appendChild(li);
    });
    document.getElementById('shareList').disabled = !rows.length;
  }
  async function loadFavs() {
    favs.clear();
    if (Account.user) { const { data, error } = await sb.from('favorites').select('*'); if (!error) data.forEach(r => favs.set(r.site_id, r)); }
    renderMine(); refreshOpenPopup(); renderList();
  }
  const kindLabels = { ra: 'BLM recreation area', cg: 'BLM campground', th: 'BLM trailhead', fc: 'National Forest campground', fh: 'National Forest trail' };
  async function toggleFav(id) {
    if (!sb) return;
    if (!Account.user) { Account.openAuth('Sign in to save places to your list.'); return; }
    const v = pinIndex.get(id); if (!v) return;
    if (favs.has(id)) {
      const { error } = await sb.from('favorites').delete().eq('site_id', id);
      if (error) { toast('Couldn\'t remove it. Try again.'); return; }
      favs.delete(id); toast('Removed from your places');
    } else {
      const row = { site_id: id, kind: v.k, kind_label: kindLabels[v.k], name: v.o.n, lat: v.o.ll[0], lon: v.o.ll[1] };
      const { data, error } = await sb.from('favorites').insert(row).select().single();
      if (error) { toast('Couldn\'t save it. Try again.'); return; }
      favs.set(id, data); toast('Saved to your places');
    }
    renderMine(); refreshOpenPopup(); renderList();
  }
  document.getElementById('mineBtn').addEventListener('click', () => { selectTab('mine'); document.getElementById('left').scrollIntoView({ behavior: 'smooth', block: 'start' }); });
  Account.onChange(loadFavs);
  Account.ready.then(loadFavs);
  // Share my whole list: saves a snapshot anyone with the link can open (?list=<id>)
  document.getElementById('shareList').addEventListener('click', async () => {
    const items = [...favs.values()].map(r => ({ id: r.site_id, n: r.name, k: r.kind_label }));
    const name = (document.getElementById('listName').value || '').trim() || 'My California places';
    const { data, error } = await sb.from('shared_lists').insert({ name, items }).select('id').single();
    if (error) { toast('Couldn\'t create the link. Try again.'); return; }
    shareLink(location.origin + location.pathname + '?list=' + data.id, name);
  });
  // Clicks inside popups (Leaflet stops them reaching the map, so listen in the capture phase)
  document.getElementById('map').addEventListener('click', (ev) => {
    const f = ev.target.closest && ev.target.closest('[data-fav]');
    if (f) { ev.stopPropagation(); toggleFav(f.dataset.fav); return; }
    const s = ev.target.closest && ev.target.closest('[data-share]');
    if (s) { ev.stopPropagation(); const v = pinIndex.get(s.dataset.share); shareLink(siteUrl(s.dataset.share), v ? v.o.n : 'California place'); }
  }, true);

  // ---------- Live status + alerts: load, then draw active wildfires ----------
  const fireLayer = L.layerGroup();
  toggles.fire = [fireLayer];
  Promise.allSettled([feed('status'), feed('alerts')]).then(([s, a]) => {
    if (s.status === 'fulfilled' && s.value) STATUS = s.value;
    if (a.status === 'fulfilled' && a.value) {
      ALERTS = a.value;
      ALERTS.fires.forEach(f => L.geoJSON(f.geom, { pane: 'fire', interactive: false, renderer: L.canvas({ pane: 'fire' }), style: { color: css('--fire'), weight: 2, fillColor: css('--fire'), fillOpacity: .35 } }).addTo(fireLayer));
      const sites = Object.values(ALERTS.sites);
      const nClosed = sites.filter(x => x.c).length, nFire = sites.filter(x => x.f).length, nWx = sites.filter(x => x.a).length;
      const parts = [];
      if (nClosed) parts.push(`${nClosed} temporarily closed`);
      if (nFire) parts.push(`${nFire} near an active wildfire`);
      if (nWx) parts.push(`${nWx} under a weather alert`);
      const el = document.getElementById('alertSum');
      sumHtml = parts.length ? `<b>Right now:</b> ${parts.join(' · ')}. Open a place for details. <span class="upd">Checked ${esc(fmtWhen(ALERTS.updated))}</span>` : `No closures, wildfires or weather alerts at mapped sites. <span class="upd">Checked ${esc(fmtWhen(ALERTS.updated))}</span>`;
      el.innerHTML = sumHtml; el.hidden = false;
      document.getElementById('cnt-fire').textContent = ALERTS.fires.length;
    }
    const fe = document.getElementById('lyr-fire'); setLayer('fire', fe.checked); fe.addEventListener('change', () => setLayer('fire', fe.checked));
    refreshOpenPopup(); renderList(); renderRight();
  });

  // ---------- Campgrounds in view (left list) ----------
  const listEl = document.getElementById('campList'), countEl = document.getElementById('campCount'), moreBtn = document.getElementById('campMore');
  const fOpen = document.getElementById('f-open'), fWater = document.getElementById('f-water'), fRes = document.getElementById('f-res'), fPhoto = document.getElementById('f-photo'), fRated = document.getElementById('f-rated');
  const sortSel = document.getElementById('campSort');
  try { const s = localStorage.getItem('campSort'); if (s && sortSel.querySelector(`option[value="${s}"]`)) sortSel.value = s; } catch (e) {}
  // Ratings from the site's own reviews: {siteId: {avg, n}}
  const RATINGS = new Map();
  if (CFG.supabaseUrl) fetch(`${CFG.supabaseUrl}/rest/v1/reviews?select=site_id,rating`, { headers: sbHeaders() })
    .then(r => r.ok ? r.json() : []).then(rows => {
      const acc = {}; rows.forEach(r => { const a = acc[r.site_id] || (acc[r.site_id] = [0, 0]); a[0] += r.rating; a[1]++; });
      Object.entries(acc).forEach(([id, [sum, n]]) => RATINGS.set(id, { avg: sum / n, n }));
      renderList();
    }).catch(() => {});
  // The selected place is pinned to the top of the list until it's closed
  let pinnedId = null;
  let listLimit = 40;
  if (!SHOW_PHOTOS) { fPhoto.checked = false; fPhoto.closest('label').hidden = true; }
  const statusOf = (o) => (STATUS && STATUS.s[o.id]) || o.st || '';
  const agencyOf = (v) => v.k === 'fc' || v.k === 'fh' ? v.o.forest : v.k === 'nc' ? (v.o.park || 'National Park') : 'Bureau of Land Management';
  const kindOf = { cg: 'Campground', fc: 'Campground', ra: 'Recreation area', th: 'Trailhead', fh: 'Trail', nc: 'Campground' };
  function campsInView() {
    const b = map.getBounds(), c = map.getCenter(), out = [];
    campIndex.forEach(v => {
      const box = document.getElementById('lyr-' + v.k); if (box && !box.checked) return;
      if (!b.contains(v.o.ll)) return;
      if (fOpen.checked && statusOf(v.o) !== 'open') return;
      if (fWater.checked && !(v.o.am && v.o.am.water[0] === 'yes')) return;
      if (fRes.checked && !v.o.res) return;
      if (fPhoto.checked && !(v.o.th || (v.o.img && v.o.img.length))) return;
      if (fRated.checked && !((RATINGS.get(v.o.id) || {}).avg >= 4)) return;
      if (v.o.id === pinnedId) return;
      out.push({ ...v, d: nearKm([c.lat, c.lng], v.o.ll) });
    });
    const byName = (a, b) => a.o.n.localeCompare(b.o.n, 'en', { sensitivity: 'base' });
    const rt = (v) => RATINGS.get(v.o.id) || { avg: 0, n: 0 };
    const openRank = (v) => { const st = statusOf(v.o), al = ALERTS && ALERTS.sites[v.o.id]; return al && al.c ? 3 : st === 'open' ? 0 : st ? 2 : 1; };
    const sorts = {
      az: byName, za: (a, b) => byName(b, a),
      rating: (a, b) => (rt(b).avg - rt(a).avg) || (rt(b).n - rt(a).n) || byName(a, b),
      reviews: (a, b) => (rt(b).n - rt(a).n) || (rt(b).avg - rt(a).avg) || byName(a, b),
      open: (a, b) => (openRank(a) - openRank(b)) || byName(a, b),
      near: (a, b) => a.d - b.d
    };
    return out.sort(sorts[sortSel.value] || byName);
  }
  const phSvg = '<svg width="34" height="28" viewBox="0 0 18 16" aria-hidden="true"><path d="M9 1.5 16.5 14.5H1.5Z" style="fill:none;stroke:currentColor;stroke-width:1.2;stroke-linejoin:round"/><path d="M9 8.5 11.5 14.5H6.5Z" style="fill:currentColor"/></svg>';
  function card(v, pinned) {
    const o = v.o, st = statusOf(o), al = ALERTS && ALERTS.sites[o.id];
    const tags = [], r = RATINGS.get(o.id);
    if (al && al.c) tags.push('<span class="tag bad">Temporarily closed</span>');
    else if (st) tags.push(`<span class="tag ${st === 'open' ? 'ok' : 'bad'}">${esc(st[0].toUpperCase() + st.slice(1))}</span>`);
    if (al && al.f) tags.push('<span class="tag bad">Wildfire nearby</span>');
    if (al && al.a) tags.push(`<span class="tag warn">${al.a.length} weather alert${al.a.length > 1 ? 's' : ''}</span>`);
    if (o.am) { const w = amShort.water[o.am.water[0]]; if (w) tags.push(`<span class="tag ${o.am.water[0] === 'yes' ? 'ok' : ''}">${esc(w)}</span>`); const t = amShort.toilet[o.am.toilet[0]]; if (t) tags.push(`<span class="tag">${esc(t)}</span>`); }
    if (o.res) tags.push('<span class="tag">Reservable</span>');
    if (favs.has(o.id)) tags.push('<span class="tag ok">★ Saved</span>');
    const src = o.th ? `thumbs/${o.id}.webp` : o.img && o.img.length ? o.img[0] : '';
    const img = src ? `<img src="${esc(src)}" alt=""" loading="lazy" onerror="this.outerHTML='<span class=&quot;ph&quot;>${phSvg.replace(/"/g, '&quot;')}No photo</span>'">` : `<span class="ph">${phSvg}No photo yet</span>`;
    return `<li class="camp-card${SHOW_PHOTOS ? '' : ' nophoto'}${pinned ? ' pinned' : ''}" data-id="${o.id}" tabindex="-1">${SHOW_PHOTOS ? `<div class="thumb">${img}</div>` : ''}<div><div class="title-row"><h3><a href="place.html?id=${o.id}">${esc(o.n)}</a></h3>${iconBtns(o)}</div><div class="cc-sub">${pinned ? '<span class="pin-k">Selected</span> · ' : ''}${v.k !== 'fc' && v.k !== 'cg' ? esc(kindOf[v.k]) + ' · ' : ''}${esc(agencyOf(v))}${r ? ` · <span class="rate" aria-label="Rated ${r.avg.toFixed(1)} out of 5 from ${r.n} review${r.n > 1 ? 's' : ''}">★ ${r.avg.toFixed(1)} <small>(${r.n})</small></span>` : ''}</div><div class="cc-tags">${tags.join('')}</div><div class="cc-act"><button type="button" data-show="${o.id}">Show on map</button></div></div></li>`;
  }
  function renderList() {
    if (!listEl) return;
    const all = campsInView();
    const z = map.getZoom();
    countEl.innerHTML = all.length ? `<b>${all.length.toLocaleString('en-US')}</b> campground${all.length === 1 ? '' : 's'} in view${z < 8 ? ' · zoom in to narrow the list' : ''}` : '<b>0</b> campgrounds in view';
    const pv = pinnedId && pinIndex.get(pinnedId);
    const top = pv ? card(pv, true) : '';
    listEl.innerHTML = top + (all.length ? all.slice(0, listLimit).map(v => card(v)).join('') : (pv ? '' : '<li class="empty-list">No campgrounds match in this part of the map. Zoom out, move the map, or clear a filter.</li>'));
    moreBtn.hidden = all.length <= listLimit;
    moreBtn.textContent = `Show ${Math.min(40, all.length - listLimit)} more`;
  }
  let listT; const listSoon = () => { clearTimeout(listT); listT = setTimeout(() => { listLimit = 40; renderList(); }, 150); };
  map.on('moveend', listSoon);
  [fOpen, fWater, fRes, fPhoto, fRated].forEach(el => el.addEventListener('change', listSoon));
  sortSel.addEventListener('change', () => { try { localStorage.setItem('campSort', sortSel.value); } catch (e) {} listLimit = 40; renderList(); });
  map.on('popupopen', (e) => {
    const t = e.popup.getElement() && e.popup.getElement().querySelector('.title-row[data-site]');
    pinnedId = t ? t.dataset.site : null; renderList();
    if (pinnedId) document.getElementById('tab-camps').scrollTop = 0;
  });
  map.on('popupclose', () => { if (pinnedId) { pinnedId = null; renderList(); } });
  ['lyr-cg', 'lyr-fc'].forEach(id => document.getElementById(id).addEventListener('change', listSoon));
  moreBtn.addEventListener('click', () => { listLimit += 40; renderList(); });
  listEl.addEventListener('click', (ev) => {
    if (ev.target.closest('a')) return;
    const f = ev.target.closest('[data-fav]'); if (f) { toggleFav(f.dataset.fav); return; }
    const sh = ev.target.closest('[data-share]'); if (sh) { const v = pinIndex.get(sh.dataset.share); shareLink(siteUrl(sh.dataset.share), v ? v.o.n : 'California place'); return; }
    const li = ev.target.closest('[data-id]'); if (!li) return;
    const v = campIndex.get(li.dataset.id); if (v) zoomTo({ o: v.o, layer: v.k });
  });
  const hlMarker = (id, on) => {
    const v = campIndex.get(id), m = v && v.o.marker; if (!m) return;
    m._hl = on; m.setRadius(pinSpec[m._k][1] * pinScale * (on ? 1.8 : 1)); m.setStyle({ weight: on ? 2.6 : 1.6, color: on ? css('--ink') : css('--pin-ring') });
    if (on) m.bringToFront();
  };
  listEl.addEventListener('mouseover', (ev) => { const li = ev.target.closest('[data-id]'); if (li) hlMarker(li.dataset.id, true); });
  listEl.addEventListener('mouseout', (ev) => { const li = ev.target.closest('[data-id]'); if (li && !li.contains(ev.relatedTarget)) hlMarker(li.dataset.id, false); });
  renderList();

  // ---------- Weather alerts by county + active wildfires (right column) ----------
  let aFilter = 'all', sumHtml = '', selected = null;
  // ---------- Selected place: the right column narrows to that place and its county ----------
  const alertLi = (a) => `<li><span class="sv ${sevClass(a.sev)}"></span><span><b>${esc(a.e)}</b><span class="when">${a.ends ? 'Until ' + esc(fmtWhen(a.ends)) : 'In effect'} · <a href="${esc(a.url)}" target="_blank" rel="noopener">Details ↗</a></span></span></li>`;
  function renderSelected(id) {
    const v = pinIndex.get(id); if (!v) return;
    buildIdx();
    const cty = hit(IDX.counties, v.o.ll[1], v.o.ll[0]), cname = cty ? cty.properties.n : null;
    const sum = document.getElementById('alertSum'), box = document.getElementById('countyAlerts'), seg = document.querySelector('.seg.small');
    seg.hidden = true;
    sum.hidden = false;
    sum.className = 'alert-sum sel';
    sum.innerHTML = `<span class="sel-k">Selected</span><b>${esc(v.o.n)}</b>${cname ? `<span class="upd">${esc(cname)} County</span>` : ''}<button type="button" class="btn alt sel-all" id="showAllAlerts">Show all counties</button>`;
    document.getElementById('showAllAlerts').onclick = () => map.closePopup();
    if (!ALERTS) { box.innerHTML = '<p class="muted">Weather alerts aren\'t available right now.</p>'; return; }
    const al = ALERTS.sites[id] || {}, here = new Map(), seen = new Set();
    let siteHtml = '';
    if (al.c) siteHtml += '<li><span class="sv hi"></span><span><b>Temporarily closed</b><span class="when">Forest Service closure</span></span></li>';
    (al.f || []).forEach(([i, mi]) => { const f = ALERTS.fires[i]; if (f) siteHtml += `<li><span class="sv hi"></span><span><b>${esc(f.n)}</b><span class="when">${mi === 0 ? 'Site is inside the fire area' : mi + ' mi away'}${f.pc != null ? ' · ' + f.pc + '% contained' : ''}</span></span></li>`; });
    (al.a || []).forEach(aid => { const a = ALERTS.nws[aid]; if (a && !here.has(a.e)) here.set(a.e, a); });
    here.forEach(a => { seen.add(a.e); siteHtml += alertLi(a); });
    const c = (ALERTS.counties || []).find(x => x.n === cname);
    const more = new Map();
    if (c) c.a.forEach(aid => { const a = ALERTS.nws[aid]; if (a && !seen.has(a.e) && !more.has(a.e)) more.set(a.e, a); });
    box.innerHTML = `<div class="county"><button type="button" tabindex="-1" disabled>At this ${v.k === 'fh' || v.k === 'th' ? 'trail' : v.k === 'ra' ? 'area' : 'campground'}</button><ul>${siteHtml || '<li class="muted">No alerts here right now.</li>'}</ul></div>`
      + (cname ? `<div class="county"><button type="button" data-county="${esc(cname)}">Elsewhere in ${esc(cname)} County <small>show county</small></button><ul>${more.size ? [...more.values()].map(alertLi).join('') : '<li class="muted">No other alerts in the county.</li>'}</ul></div>` : '');
    const ul = document.getElementById('fireList');
    const near = (al.f || []).map(([i, mi]) => [ALERTS.fires[i], mi, i]).filter(t => t[0]);
    ul.innerHTML = near.length ? near.map(([f, mi, i]) => `<li><button type="button" data-fire="${i}"><b>${esc(f.n)}</b>${mi === 0 ? 'At this site' : mi + ' mi away'}${f.ac ? ' · ' + Number(f.ac).toLocaleString('en-US') + ' acres' : ''}</button></li>`).join('') : '<li class="muted">No active wildfires within 10 miles.</li>';
  }
  function renderRight() {
    if (selected) return renderSelected(selected);
    const sum = document.getElementById('alertSum'); sum.className = 'alert-sum';
    sum.innerHTML = sumHtml; sum.hidden = !sumHtml;
    document.querySelector('.seg.small').hidden = false;
    renderCounties(); renderFires();
  }
  map.on('popupopen', (e) => {
    // Keep the popup clear of the floating filter panel when it's open
    const open = !mf.classList.contains('closed');
    e.popup.options.autoPanPaddingTopLeft = L.point(open ? mf.offsetWidth + 24 : 12, open && narrow() ? mf.offsetHeight + 24 : 12);
    e.popup.options.autoPanPaddingBottomRight = L.point(60, 12);   // keep clear of the zoom buttons
    if (e.popup._adjustPan) e.popup._adjustPan();
    const t = e.popup.getElement() && e.popup.getElement().querySelector('.title-row[data-site]');
    selected = t ? t.dataset.site : null; renderRight();
  });
  map.on('popupclose', () => { if (selected) { selected = null; renderRight(); } });
  const sevClass = (s) => s === 'Extreme' || s === 'Severe' ? 'hi' : s === 'Minor' || s === 'Unknown' ? 'lo' : '';
  function renderCounties() {
    const box = document.getElementById('countyAlerts');
    if (!ALERTS || !ALERTS.counties) { box.innerHTML = '<p class="muted">Weather alerts aren\'t available right now.</p>'; return; }
    const html = ALERTS.counties.map(c => {
      const seen = new Map();   // one line per kind of alert; several zones in a county often share it
      c.a.forEach(id => { const a = ALERTS.nws[id]; if (!a || (aFilter === 'warn' && !/Warning/.test(a.e))) return; const k = a.e; const prev = seen.get(k); if (!prev || (a.ends || '') > (prev.ends || '')) seen.set(k, a); });
      if (!seen.size) return '';
      const items = [...seen.values()].map(a => `<li><span class="sv ${sevClass(a.sev)}"></span><span><b>${esc(a.e)}</b><span class="when">${a.ends ? 'Until ' + esc(fmtWhen(a.ends)) : 'In effect'} · <a href="${esc(a.url)}" target="_blank" rel="noopener">Details ↗</a></span></span></li>`).join('');
      return `<div class="county"><button type="button" data-county="${esc(c.n)}">${esc(c.n)} County <small>${seen.size} alert${seen.size > 1 ? 's' : ''} · show on map</small></button><ul>${items}</ul></div>`;
    }).join('');
    box.innerHTML = html || `<p class="muted">No ${aFilter === 'warn' ? 'warnings' : 'weather alerts'} in California right now.</p>`;
  }
  document.getElementById('countyAlerts').addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-county]'); if (!b) return;
    const f = D.counties.features.find(x => x.properties.n === b.dataset.county);
    if (f) { zoomTo({ f, layer: 'county' }); setSheet(false); }
  });
  document.querySelectorAll('[data-afilter]').forEach(b => b.addEventListener('click', () => {
    aFilter = b.dataset.afilter; document.querySelectorAll('[data-afilter]').forEach(x => x.setAttribute('aria-pressed', x === b)); renderCounties();
  }));
  function renderFires() {
    const ul = document.getElementById('fireList');
    if (!ALERTS) { ul.innerHTML = '<li class="muted">Wildfire data isn\'t available right now.</li>'; return; }
    if (!ALERTS.fires.length) { ul.innerHTML = '<li class="muted">No active wildfires in or near California.</li>'; return; }
    ul.innerHTML = ALERTS.fires.map((f, i) => `<li><button type="button" data-fire="${i}"><b>${esc(f.n)}</b>${f.ac ? Number(f.ac).toLocaleString('en-US') + ' acres' : 'Size unknown'}${f.pc != null ? ` · ${f.pc}% contained` : ''}</button></li>`).join('');
  }
  document.getElementById('fireList').addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-fire]'); if (!b) return;
    const f = ALERTS.fires[+b.dataset.fire]; if (f) { zoomTo({ f: { type: 'Feature', geometry: f.geom, properties: {} }, layer: 'fire' }); setSheet(false); }
  });

  // ---------- Deep links ----------
  const params = new URLSearchParams(location.search);
  if (params.get('site')) openSite(params.get('site'));
  if (params.get('list') && CFG.supabaseUrl) {
    fetch(`${CFG.supabaseUrl}/rest/v1/shared_lists?id=eq.${encodeURIComponent(params.get('list'))}&select=name,items`, { headers: sbHeaders() })
      .then(r => r.json()).then(rows => {
        const L0 = rows && rows[0]; const box = document.getElementById('sharedList');
        if (!L0) { toast('That shared list wasn\'t found.'); return; }
        document.getElementById('sharedName').textContent = L0.name;
        const ul = document.getElementById('sharedItems'); ul.innerHTML = '';
        L0.items.forEach(it => { const li = document.createElement('li'); li.innerHTML = `<button type="button" class="go"><span class="dot" style="background:var(--camp)"></span><span>${esc(it.n)}<span class="kind">${esc(it.k || '')}</span></span></button>`; li.firstChild.addEventListener('click', () => openSite(it.id)); ul.appendChild(li); });
        box.hidden = false; selectTab('mine');
      }).catch(() => toast('That shared list couldn\'t load.'));
  }
})();