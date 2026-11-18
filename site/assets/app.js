(async function () {
  const CFG = window.APP_CONFIG || {};
  const loading = document.getElementById('loading');
  let D, RC, FS;
  try {
    [D, RC, FS] = await Promise.all(['land', 'rec', 'fs'].map(n => fetch('data/' + n + '.json').then(r => { if (!r.ok) throw new Error(n); return r.json(); })));
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
    const pad = narrow() ? { paddingTopLeft: [10, 10], paddingBottomRight: [10, 180] } : { paddingTopLeft: [370, 20], paddingBottomRight: [20, 20] };
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
  layers.blm = L.geoJSON(D.blm, opt('blm', { smoothFactor: 0.6 }));
  layers.nlcs = L.geoJSON(D.nlcs, opt('desig'));
  layers.wild = L.geoJSON(D.wild, opt('desig'));
  layers.wsa = L.geoJSON(D.wsa, opt('desig'));
  layers.fo = L.geoJSON(D.fo, opt('lines'));
  layers.usfs = L.geoJSON(FS.usfs, opt('agency', { smoothFactor: 0.8 }));
  layers.lakes = L.geoJSON(FS.lakes, opt('water'));
  const lakeLabels = L.layerGroup();
  FS.lakeLabels.forEach(([n, lat, lon, km2]) => L.marker([lat, lon], { pane: 'labels', interactive: false, keyboard: false,
    icon: L.divIcon({ className: '', html: `<span class="lakelabel${km2 >= 40 ? ' big' : ''}">${n}</span>`, iconSize: null, iconAnchor: [0, 0] }) }).addTo(lakeLabels));
  layers.nps = L.geoJSON(FS.nps, opt('agency'));
  const hwOrder = { st: 0, us: 1, fwy: 2 };
  const hwFeats = FS.hwy.features.slice().sort((a, b) => hwOrder[a.properties.c] - hwOrder[b.properties.c]);
  layers.hwyCase = L.geoJSON({ type: 'FeatureCollection', features: hwFeats.filter(f => f.properties.c !== 'st') }, opt('roads'));
  layers.hwy = L.geoJSON({ type: 'FeatureCollection', features: hwFeats }, opt('roads'));
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
    layers.hwy.eachLayer(l => { const c = l.feature.properties.c; l.setStyle(c === 'fwy' ? { color: css('--hwy-fwy'), weight: 2.4 } : c === 'us' ? { color: css('--hwy-us'), weight: 1.9 } : { color: css('--hwy-st'), weight: 1.1, opacity: map.getZoom() >= 7.5 ? 0.9 : 0 }); });
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
  const dl = (o) => { let r = ''; if (o.fee) r += `<dt>Fees</dt><dd>${esc(o.fee)}</dd>`; if (o.stay) r += `<dt>Stay limit</dt><dd>${esc(o.stay)}</dd>`; if (o.ph) r += `<dt>Phone</dt><dd>${esc(o.ph)}</dd>`; return r ? `<dl>${r}</dl>` : ''; };
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
  const actions = (o) => `<div class="pp-actions">${canSave ? `<button type="button" class="act fav${favs.has(o.id) ? ' on' : ''}" data-fav="${o.id}" aria-pressed="${favs.has(o.id)}">${favs.has(o.id) ? '★ Saved' : '☆ Save'}</button>` : ''}<button type="button" class="act" data-share="${o.id}">Share</button></div>`;

  const pops = {
    ra: (o) => {
      const disp = isDispersed(o);
      const kindName = { Area: 'Area', Spot: 'Single site', Trail: 'Trail', Camp: 'Camp' }[o.pk] || 'Area';
      const act = o.t === 'both' ? (disp ? 'hiking & dispersed camping' : 'hiking & camping') : o.t === 'hike' ? 'hiking' : (disp ? 'dispersed camping' : 'camping');
      const chips = o.acts.map(a => a === 'Camping' && disp ? 'Dispersed Camping' : a);
      return `<div class="pp"><span class="kindtag">BLM recreation ${kindName.toLowerCase()} · ${act}</span><h3>${esc(o.n)}</h3>${o.id ? live(o) + actions(o) : ''}<div class="acts">${chips.map(a => `<span class="${/Hiking|Camping/.test(a) ? 'on' : ''}">${esc(a)}</span>`).join('')}</div>${o.d ? `<p class="desc">${esc(o.d)}</p>` : ''}${disp ? dispersedNote : ''}${dl(o)}${links(o)}${coords(o.ll)}${amenBlock(o, 'blm')}${nearBlock(o)}${wxSlot(o)}</div>`;
    },
    cg: (o) => `<div class="pp"><span class="kindtag">BLM · ${esc(o.k)}</span><h3>${esc(o.n)}</h3>${o.id ? live(o) + actions(o) : ''}${o.d ? `<p class="desc">${esc(o.d)}</p>` : ''}${dl(o)}${links(o, true)}${coords(o.ll)}${amenBlock(o, 'blm')}${nearBlock(o)}${wxSlot(o)}</div>`,
    fc: (o) => {
      let r = `<dt>Forest</dt><dd>${esc(o.forest)}</dd>`;
      if (o.season) r += `<dt>Season</dt><dd>${esc(o.season)}</dd>`;
      if (o.fee) r += `<dt>Fees</dt><dd>${esc(o.fee)}</dd>`;
      if (o.cap) r += `<dt>Capacity</dt><dd>${o.cap} people</dd>`;
      return `<div class="pp"><span class="kindtag">National Forest · ${esc(o.k)}</span><h3>${esc(o.n)}</h3>${o.id ? live(o) + actions(o) : ''}${o.d ? `<p class="desc">${esc(o.d)}</p>` : ''}<dl>${r}</dl>${o.ri ? `<div class="resnote">${esc(o.ri)}</div>` : ''}${links(o, true)}${coords(o.ll)}${amenBlock(o, 'fs')}${nearBlock(o)}${wxSlot(o)}</div>`;
    },
    th: (o) => `<div class="pp"><span class="kindtag">BLM trailhead</span><h3>${esc(o.n)}</h3>${o.id ? live(o) + actions(o) : ''}${links(o)}${coords(o.ll)}${nearBlock(o)}${wxSlot(o)}</div>`,
    fh: (o) => {
      let r = `<dt>Forest</dt><dd>${esc(o.forest)}</dd>`;
      if (o.season) r += `<dt>Season</dt><dd>${esc(o.season)}</dd>`;
      if (o.fee) r += `<dt>Fees</dt><dd>${esc(o.fee)}</dd>`;
      if (o.restr) r += `<dt>Rules</dt><dd>${esc(o.restr)}</dd>`;
      const lk = [];
      if (o.url) lk.push(`<a href="${esc(o.url)}" target="_blank" rel="noopener">Trail info ↗</a>`);
      lk.push(`<a href="https://www.google.com/maps/dir/?api=1&destination=${o.ll[0]},${o.ll[1]}" target="_blank" rel="noopener">Directions ↗</a>`);
      return `<div class="pp"><span class="kindtag">National Forest · ${esc(o.k)}</span><h3>${esc(o.n)}</h3>${o.id ? live(o) + actions(o) : ''}${o.d ? `<p class="desc">${esc(o.d)}</p>` : ''}<dl>${r}</dl><div class="links">${lk.join('')}</div>${coords(o.ll)}${amenBlock(o, 'fs')}${nearBlock(o)}${wxSlot(o)}</div>`;
    },
    vc: (o) => `<div class="pp"><span class="kindtag">${esc(o.k)}</span><h3>${esc(o.n)}</h3>${o.id ? live(o) + actions(o) : ''}${links(o)}${coords(o.ll)}</div>`
  };
  const recSets = { ra: RC.sites, fh: FS.fsh, fc: FS.fsc, cg: RC.camps, th: RC.th, vc: RC.info };
  Object.entries(recSets).forEach(([k, arr]) => {
    const g = L.layerGroup();
    arr.forEach(o => {
      const [w, h] = sizes[k];
      o.marker = L.marker(o.ll, { pane: 'rec', title: o.n, alt: o.n, riseOnHover: true, icon: L.divIcon({ className: '', html: svgPin[k](o.t), iconSize: [w, h], iconAnchor: [w / 2, h / 2], popupAnchor: [0, -h / 2] }) })
        .bindPopup(() => pops[k](o), { maxWidth: Math.min(400, window.innerWidth - 48), minWidth: Math.min(360, window.innerWidth - 48), maxHeight: Math.max(320, Math.min(640, window.innerHeight - 140)) }).addTo(g);
    });
    layers[k] = g; toggles[k] = k === 'cg' ? [g, layers.foot] : [g];
    if (k === 'fc' || k === 'cg') g.eachLayer(m => m.setZIndexOffset(-200));
    const el = document.getElementById('lyr-' + k); setLayer(k, el.checked); el.addEventListener('change', () => setLayer(k, el.checked));
  });
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

  map.on('click', (e) => {
    buildIdx();
    const x = e.latlng.lng, y = e.latlng.lat;
    const blm = hit(IDX.blm, x, y);
    const npsU = blm ? null : hit(IDX.nps, x, y);
    const fsL = blm || npsU ? null : hit(IDX.usfs, x, y);
    const forest = hit(IDX.forests, x, y);
    const fo = hit(IDX.fo, x, y);
    const county = hit(IDX.counties, x, y);
    const nlcs = hit(IDX.nlcs, x, y), wild = hit(IDX.wild, x, y), wsa = hit(IDX.wsa, x, y);
    const st = county ? 'California' : (hit(IDX.neighbors, x, y) ? { '32': 'Nevada', '41': 'Oregon', '04': 'Arizona' }[hit(IDX.neighbors, x, y).properties.s] : null);
    let rows = '';
    const lake = hit(IDX.lakes, x, y);
    if (lake && lake.properties.n) rows += `<dt>Water</dt><dd>${esc(lake.properties.n)}${lake.properties.r ? ' (reservoir)' : ''}</dd>`;
    if (npsU) rows += `<dt>Park unit</dt><dd>${esc(npsU.properties.n)}</dd>`;
    if (forest && (fsL || !blm)) rows += `<dt>Forest</dt><dd>${esc(forest.properties.n)}${fsL ? '' : ' <span style="color:var(--ink-2)">(inside boundary)</span>'}</dd>`;
    if (fo && blm) rows += `<dt>Field office</dt><dd>${esc(fo.properties.n)}<br><span style="color:var(--ink-2)">${esc(fo.properties.d || '')}</span></dd>`;
    if (nlcs) rows += `<dt>Designation</dt><dd>${esc(nlcs.properties.n)}</dd>`;
    if (wild) rows += `<dt>Wilderness</dt><dd>${esc(wild.properties.n)}${wild.properties.y ? ` <span style="color:var(--ink-2)">(${wild.properties.y})</span>` : ''}</dd>`;
    if (wsa) rows += `<dt>Study area</dt><dd>${esc(wsa.properties.n)}</dd>`;
    if (county) rows += `<dt>County</dt><dd>${esc(county.properties.n)} County</dd>`;
    else if (st) rows += `<dt>State</dt><dd>${st}</dd>`;
    const status = blm
      ? `<div class="pp-status"><span class="sw blm"></span>BLM public land</div>`
      : npsU ? `<div class="pp-status"><span class="sw nps"></span>National Park Service land</div>`
      : fsL ? `<div class="pp-status"><span class="sw usfs"></span>National Forest land</div>`
      : `<div class="pp-status"><span class="sw off"></span>Not BLM, Forest or Park land</div>`;
    const html = `<div class="pp">${status}${rows ? `<dl>${rows}</dl>` : ''}<div class="coords">${y.toFixed(5)}°, ${x.toFixed(5)}°</div></div>`;
    L.popup({ maxWidth: 300 }).setLatLng(e.latlng).setContent(html).openOn(map);
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
    const pad = narrow() ? { paddingTopLeft: [20, 20], paddingBottomRight: [20, 260], maxZoom: 12 } : { paddingTopLeft: [380, 40], paddingBottomRight: [40, 40], maxZoom: 12 };
    map.flyToBounds(hl.getBounds(), Object.assign({ duration: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 0.8 }, pad));
    if (narrow()) setSheet(false);
  }
  search.addEventListener('input', render);
  render();

  // ---------- Mobile sheet ----------
  const panel = document.getElementById('panel'), tg = document.getElementById('sheetToggle');
  function setSheet(open) { panel.classList.toggle('collapsed', !open); tg.setAttribute('aria-expanded', open); tg.textContent = open ? 'Hide' : 'Layers'; }
  tg.addEventListener('click', () => setSheet(panel.classList.contains('collapsed')));
  if (narrow()) setSheet(false);

  // ---------- Basemap picker ----------
  document.querySelectorAll('[data-base]').forEach(b => b.addEventListener('click', () => setBase(b.dataset.base)));
  let savedBase = 'relief'; try { savedBase = localStorage.getItem('base') || 'relief'; } catch (e) {}
  setBase(savedBase);

  // ---------- Toasts ----------
  const toastEl = document.getElementById('toast'); let toastT;
  function toast(msg) { toastEl.textContent = msg; toastEl.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => { toastEl.hidden = true; }, 3200); }

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

  // ---------- Accounts and favorites (Supabase) ----------
  const sb = (window.supabase && CFG.supabaseUrl) ? window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseAnonKey) : null;
  let user = null;
  const acctBtn = document.getElementById('acctBtn'), dlg = document.getElementById('authDlg');
  const mine = document.getElementById('mine'), mineList = document.getElementById('mineList');
  if (!sb) acctBtn.hidden = true; else canSave = true;
  function refreshOpenPopup() { const p = map._popup; if (p && p.isOpen()) p.update(); }
  function renderMine() {
    mine.hidden = !user;
    acctBtn.textContent = user ? 'Signed in' : 'Sign in';
    acctBtn.title = user ? (user.email || '') + ' (click to sign out)' : 'Sign in to save places';
    if (!user) return;
    const rows = [...favs.values()].sort((a, b) => a.name.localeCompare(b.name));
    document.getElementById('mineCount').textContent = rows.length;
    mineList.innerHTML = rows.length ? '' : '<li class="empty">Tap ☆ Save on any campground, trailhead or area to keep it here.</li>';
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
    if (user) { const { data, error } = await sb.from('favorites').select('*'); if (!error) data.forEach(r => favs.set(r.site_id, r)); }
    renderMine(); refreshOpenPopup();
  }
  const kindLabels = { ra: 'BLM recreation area', cg: 'BLM campground', th: 'BLM trailhead', fc: 'National Forest campground', fh: 'National Forest trail' };
  async function toggleFav(id) {
    if (!sb) return;
    if (!user) { openAuth('Sign in to save places to your list.'); return; }
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
    renderMine(); refreshOpenPopup();
  }
  function openAuth(msg) {
    document.getElementById('authMsg').textContent = msg || 'Get a sign-in link by email. No password needed.';
    document.getElementById('authSent').hidden = true; document.getElementById('authForm').hidden = false;
    document.getElementById('googleBtn').hidden = !CFG.googleSignIn;
    dlg.showModal();
  }
  acctBtn.addEventListener('click', async () => {
    if (!user) return openAuth();
    await sb.auth.signOut(); toast('Signed out');
  });
  document.getElementById('authClose').addEventListener('click', () => dlg.close());
  document.getElementById('authForm').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const email = document.getElementById('authEmail').value.trim();
    const btn = document.getElementById('authSend'); btn.disabled = true; btn.textContent = 'Sending…';
    const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: location.origin + location.pathname + location.search } });
    btn.disabled = false; btn.textContent = 'Email me a sign-in link';
    if (error) { document.getElementById('authMsg').textContent = 'That didn\'t work: ' + error.message; return; }
    document.getElementById('authForm').hidden = true; document.getElementById('authSent').hidden = false;
  });
  document.getElementById('googleBtn').addEventListener('click', () => sb.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: location.origin + location.pathname + location.search } }));
  if (sb) {
    sb.auth.onAuthStateChange((_ev, session) => { const u = session ? session.user : null; if ((u && u.id) !== (user && user.id)) { user = u; loadFavs(); if (u && dlg.open) dlg.close(); } });
    const { data } = await sb.auth.getSession(); user = data.session ? data.session.user : null; loadFavs();
  }
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
      el.innerHTML = parts.length ? `<b>Right now:</b> ${parts.join(' · ')}. Open a place for details. <span class="upd">Checked ${esc(fmtWhen(ALERTS.updated))}</span>` : `No closures, wildfires or weather alerts at mapped sites. <span class="upd">Checked ${esc(fmtWhen(ALERTS.updated))}</span>`;
      el.hidden = false;
      document.getElementById('cnt-fire').textContent = ALERTS.fires.length;
    }
    const fe = document.getElementById('lyr-fire'); setLayer('fire', fe.checked); fe.addEventListener('change', () => setLayer('fire', fe.checked));
    refreshOpenPopup();
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
        box.hidden = false; if (narrow()) setSheet(true);
      }).catch(() => toast('That shared list couldn\'t load.'));
  }
})();