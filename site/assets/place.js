// Campground / place page: photos, status and alerts, details, amenities, weather, map, nearby, reviews.
(async function () {
  const CFG = window.APP_CONFIG || {};
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const css = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  const fmtWhen = (iso) => { try { return new Date(iso).toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit' }); } catch (e) { return ''; } };
  const nearKm = (a, b) => { const x = (b[1] - a[1]) * 111.32 * Math.cos((a[0] + b[0]) * Math.PI / 360), y = (b[0] - a[0]) * 110.57; return Math.hypot(x, y); };
  const sbHeaders = () => { const k = CFG.supabaseAnonKey || ''; return /^eyJ/.test(k) ? { apikey: k, Authorization: 'Bearer ' + k } : { apikey: k }; };
  function feed(key) {
    if (!CFG.supabaseUrl) return Promise.resolve(null);
    return fetch(`${CFG.supabaseUrl}/rest/v1/feeds?key=eq.${encodeURIComponent(key)}&select=data`, { headers: sbHeaders() })
      .then(r => r.ok ? r.json() : null).then(rows => rows && rows[0] ? rows[0].data : null).catch(() => null);
  }
  const amShort = {
    water: { yes: 'Water', no: 'No water', treat: 'Treat water', near: 'Water nearby', check: 'Water unclear', unk: '' },
    toilet: { yes: 'Toilets', no: 'No toilets', near: 'Toilets nearby', unk: '' },
    trash: { yes: 'Trash', no: 'Pack out', unk: '' },
    fire: { yes: 'Fire rings', no: 'No fires', unk: '' }
  };

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

  const id = new URLSearchParams(location.search).get('id');
  const kindName = { fc: 'National Forest campground', cg: 'BLM campground', ra: 'BLM recreation area', fh: 'National Forest trail', th: 'BLM trailhead', nc: 'National Park campground' };
  let P, o, kind;
  try { P = await fetch('data/places.json').then(r => r.json()); } catch (e) { $('placeLoading').textContent = 'This page couldn\'t load. Check your connection and reload.'; return; }
  for (const [k, arr] of Object.entries(P)) { const f = arr.find(x => x.id === id); if (f) { o = f; kind = k; break; } }
  if (!o) { $('placeLoading').innerHTML = 'That place isn\'t on the map anymore. <a href="./">Go to the map</a>.'; return; }
  document.title = o.n + ' · CA Outdoors Land';
  const mapLink = './?site=' + encodeURIComponent(o.id);
  $('crumb').href = mapLink; $('backMap').href = mapLink;
  $('placeLoading').hidden = true; $('placeBody').hidden = false;

  // Header
  $('pKind').textContent = kindName[kind] + (o.k && !/Camping$/.test(o.k) && kind !== 'ra' ? ' · ' + o.k : '');
  $('pName').textContent = o.n;
  $('pSub').textContent = [o.forest || (kind === 'cg' || kind === 'ra' || kind === 'th' ? 'Bureau of Land Management' : ''), o.season ? 'Open season: ' + o.season : ''].filter(Boolean).join(' · ');
  const rgSearch = 'https://www.recreation.gov/search?q=' + encodeURIComponent(o.n);
  const acts = [];
  if (o.res) acts.push(`<a class="main" href="${esc(o.res)}" target="_blank" rel="noopener">Reserve on Recreation.gov ↗</a>`);
  else if (kind === 'fc' || kind === 'cg') acts.push(`<a href="${esc(rgSearch)}" target="_blank" rel="noopener">Check Recreation.gov ↗</a>`);
  if (o.url) acts.push(`<a href="${esc(o.url)}" target="_blank" rel="noopener">Official page ↗</a>`);
  acts.push(`<a href="https://www.google.com/maps/dir/?api=1&destination=${o.ll[0]},${o.ll[1]}" target="_blank" rel="noopener">Directions ↗</a>`);
  acts.push(`<a href="${mapLink}">Show on map</a>`);
  $('pActions').innerHTML = acts.join('');

  // Gallery + lightbox
  const photos = CFG.showPhotos ? (o.img || []) : [];
  window.__photoGone = (img) => {   // a photo that fails to load is removed; with none left, say so
    const b = img.closest('button'); if (b) b.remove();
    const g = document.getElementById('gallery');
    if (!g.querySelector('button')) { g.className = 'gallery none'; g.textContent = 'Photos for this place couldn\'t load right now.'; }
  };
  const g = $('gallery');
  if (!CFG.showPhotos) { g.hidden = true; }
  else if (!photos.length) { g.className = 'gallery none'; g.innerHTML = 'No photos of this place yet.' + (kind === 'fc' && o.fid ? ' Recreation.gov photos are added in the monthly update.' : ''); }
  else {
    g.className = 'gallery n' + Math.min(photos.length, 5);
    g.innerHTML = photos.slice(0, 5).map((u, i) => `<button type="button" data-i="${i}" aria-label="Open photo ${i + 1} of ${photos.length}"><img src="${esc(u)}" alt="${i ? '' : 'Photo of ' + esc(o.n)}" loading="${i ? 'lazy' : 'eager'}" onerror="window.__photoGone(this)">${i === 4 && photos.length > 5 ? `<span class="more-ph">+${photos.length - 5} more</span>` : ''}</button>`).join('');
    let lb, cur = 0;
    const show = () => { lb.querySelector('img').src = photos[cur]; lb.querySelector('.n').textContent = `${cur + 1} / ${photos.length}`; };
    const close = () => { lb.remove(); lb = null; document.removeEventListener('keydown', key); };
    const key = (e) => { if (e.key === 'Escape') close(); if (e.key === 'ArrowRight') { cur = (cur + 1) % photos.length; show(); } if (e.key === 'ArrowLeft') { cur = (cur - 1 + photos.length) % photos.length; show(); } };
    g.addEventListener('click', (e) => {
      const b = e.target.closest('[data-i]'); if (!b) return; cur = +b.dataset.i;
      lb = document.createElement('div'); lb.className = 'lightbox'; lb.setAttribute('role', 'dialog'); lb.setAttribute('aria-label', 'Photos');
      lb.innerHTML = `<img alt="Photo of ${esc(o.n)}"><div class="lb-bar"><button type="button" class="p">← Prev</button><span class="n"></span><button type="button" class="nx">Next →</button><button type="button" class="c">Close</button></div>`;
      lb.querySelector('.p').onclick = () => { cur = (cur - 1 + photos.length) % photos.length; show(); };
      lb.querySelector('.nx').onclick = () => { cur = (cur + 1) % photos.length; show(); };
      lb.querySelector('.c').onclick = close; lb.addEventListener('click', ev => { if (ev.target === lb) close(); });
      document.body.appendChild(lb); document.addEventListener('keydown', key); show(); lb.querySelector('.c').focus();
    });
  }

  // About + facts
  let facts = '';
  const fact = (k, v) => { if (v) facts += `<dt>${k}</dt><dd>${esc(v)}</dd>`; };
  fact('Forest', o.forest); fact('Open season', o.season); fact('Fees', o.fee); fact('Stay limit', o.stay); fact('Capacity', o.cap ? o.cap + ' people' : '');
  fact('Reservations', o.ri); fact('Rules', o.restr); fact('Phone', o.ph);
  $('pAbout').innerHTML = `<h2>About</h2>${o.d ? `<p class="desc-full">${esc(o.d)}</p>` : '<p class="muted">No description from the managing agency.</p>'}${facts ? `<dl class="facts">${facts}</dl>` : ''}`;

  // Amenities
  if (o.am) {
    const a = o.am, row = (lab, v) => `<dt>${lab}</dt><span class="am-dot ${v[0]}"></span><dd class="${v[0] === 'unk' ? 'unk' : ''}">${esc(v[1])}</dd>`;
    $('pAmen').innerHTML += (a.note ? `<div class="am-note">${esc(a.note)}</div>` : '') + `<dl class="amen-rows">${row('Water', a.water)}${row('Toilets', a.toilet)}${row('Trash', a.trash)}${row('Campfires', a.fire)}</dl>`
      + (a.ex && a.ex.length ? `<div class="am-ex">${a.ex.map(x => `<span>${esc(x)}</span>`).join('')}</div>` : '')
      + `<p class="am-fine">Fire rules change with the season and fire danger. Check current restrictions with the managing agency before lighting a fire.${a.permit ? ' Outside developed campgrounds, California requires a free <a href="https://www.readyforwildfire.org/permits/campfire-permit/" target="_blank" rel="noopener">campfire permit ↗</a>.' : ''}</p>`;
  } else $('pAmen').hidden = true;

  // Map
  const mm = L.map('miniMap', { zoomControl: true, scrollWheelZoom: false, attributionControl: true }).setView(o.ll, 12);
  L.tileLayer('https://basemap.nationalmap.gov/arcgis/rest/services/USGSTopo/MapServer/tile/{z}/{y}/{x}', { maxNativeZoom: 16, maxZoom: 16, attribution: 'USGS' }).addTo(mm);
  L.circleMarker(o.ll, { radius: 8, color: '#fff', weight: 2, fillColor: css('--fscamp'), fillOpacity: 1 }).addTo(mm);
  $('pCoords').textContent = `${o.ll[0].toFixed(5)}°, ${o.ll[1].toFixed(5)}°`;

  // Nearby campgrounds
  const camps = [...(P.fc || []).map(x => ['fc', x]), ...(P.cg || []).map(x => ['cg', x])].filter(([, x]) => x.id !== o.id)
    .map(([k, x]) => [k, x, nearKm(o.ll, x.ll)]).filter(t => t[2] <= 40).sort((a, b) => a[2] - b[2]).slice(0, 6);
  $('nearList').innerHTML = camps.length ? camps.map(([k, x, d]) => `<li><a href="place.html?id=${x.id}"><span>${esc(x.n)}<small>${k === 'fc' ? esc(x.forest) : 'BLM'}${x.am ? ' · ' + esc(amShort.water[x.am.water[0]] || 'water not listed') : ''}</small></span><span class="d">${(d / 1.609).toFixed(1)} mi</span></a></li>`).join('') : '<li class="muted">No campgrounds mapped within 25 miles.</li>';

  // Live status, alerts, weather
  const tile = `t${Math.floor(o.ll[0])}_${Math.floor(o.ll[1])}`;
  const [status, alerts, wx] = await Promise.all([feed('status'), feed('alerts'), feed('wx:' + tile)]);
  let h = '';
  const al = alerts && alerts.sites && alerts.sites[o.id];
  if (al && al.c) h += `<div class="alert sev-hi"><b>Temporarily closed</b>The Forest Service has marked this site temporarily closed. Check the official page before you go.</div>`;
  if (al && al.f) al.f.forEach(([i, mi]) => { const f = alerts.fires[i]; if (f) h += `<div class="alert sev-hi"><b>${mi === 0 ? 'Inside an active wildfire' : `Active wildfire ${mi} mi away`}</b>${esc(f.n)}${f.ac ? ', ' + Number(f.ac).toLocaleString('en-US') + ' acres' : ''}${f.pc != null ? `, ${f.pc}% contained` : ''}.</div>`; });
  if (al && al.a) al.a.forEach(aid => { const a = alerts.nws[aid]; if (a) h += `<div class="alert ${a.sev === 'Extreme' || a.sev === 'Severe' ? 'sev-hi' : 'sev-md'}"><b>${esc(a.e)}</b>${a.ends ? 'Until ' + esc(fmtWhen(a.ends)) + '. ' : ''}<a href="${esc(a.url)}" target="_blank" rel="noopener">Details ↗</a></div>`; });
  const st = (status && status.s[o.id]) || o.st;
  if (st) h += `<div class="status-line">Status: <span class="${st === 'open' ? 'st-open' : 'st-closed'}">${esc(st[0].toUpperCase() + st.slice(1))}</span> <span>· ${status ? 'Forest Service, checked ' + esc(fmtWhen(status.updated)) : 'as of the last data update'}</span></div>`;
  $('pAlerts').innerHTML = h;
  const rec = wx && wx.sites && wx.sites[o.id];
  $('wxBox').innerHTML = rec ? `<div class="wx-in">${renderWx(rec, wx.updated)}</div>` : '<p class="muted">Weather isn\'t available for this place right now.</p>';

  // Save + share
  const Account = window.Account, sb = Account.sb;
  const saveBtn = $('saveBtn');
  if (!sb) saveBtn.hidden = true;
  let saved = false;
  async function refreshSaved() {
    saved = false;
    if (sb && Account.user) { const { data } = await sb.from('favorites').select('site_id').eq('site_id', o.id); saved = !!(data && data.length); }
    saveBtn.textContent = saved ? '★' : '☆'; saveBtn.classList.toggle('on', saved); saveBtn.setAttribute('aria-pressed', saved);
    saveBtn.title = saved ? 'Saved (click to remove)' : 'Save to my places'; saveBtn.setAttribute('aria-label', saved ? 'Remove from my places' : 'Save to my places');
  }
  saveBtn.addEventListener('click', async () => {
    if (!Account.user) return Account.openAuth('Sign in to save places to your list.');
    if (saved) { const { error } = await sb.from('favorites').delete().eq('site_id', o.id); if (!error) Account.toast('Removed from your places'); }
    else { const { error } = await sb.from('favorites').insert({ site_id: o.id, kind, kind_label: kindName[kind], name: o.n, lat: o.ll[0], lon: o.ll[1] }); if (!error) Account.toast('Saved to your places'); else Account.toast('Couldn\'t save it. Try again.'); }
    refreshSaved();
  });
  $('shareBtn').addEventListener('click', async () => {
    const url = location.origin + location.pathname + '?id=' + encodeURIComponent(o.id);
    if (navigator.share && matchMedia('(max-width: 760px)').matches) { try { await navigator.share({ title: o.n, url }); return; } catch (e) { if (e && e.name === 'AbortError') return; } }
    try { await navigator.clipboard.writeText(url); Account.toast('Link copied'); } catch (e) { window.prompt('Copy this link:', url); }
  });

  // Reviews
  const stars = (n) => '★★★★★'.slice(0, n) + '☆☆☆☆☆'.slice(0, 5 - n);
  let reviews = [];
  async function loadReviews() {
    if (!CFG.supabaseUrl) { $('revSummary').innerHTML = '<p class="muted">Reviews aren\'t connected on this copy of the site.</p>'; return; }
    try {
      reviews = await fetch(`${CFG.supabaseUrl}/rest/v1/reviews?site_id=eq.${encodeURIComponent(o.id)}&select=id,user_id,author,rating,body,visited,created_at&order=created_at.desc`, { headers: sbHeaders() }).then(r => r.ok ? r.json() : Promise.reject(r.status));
    } catch (e) { $('revSummary').innerHTML = '<p class="muted">Reviews couldn\'t load right now.</p>'; return; }
    const n = reviews.length, avg = n ? reviews.reduce((s, r) => s + r.rating, 0) / n : 0;
    $('revSummary').innerHTML = n ? `<div class="rev-sum"><span class="avg">${avg.toFixed(1)}</span><span class="stars" aria-label="${avg.toFixed(1)} out of 5">${stars(Math.round(avg))}</span><span class="muted">${n} review${n > 1 ? 's' : ''}</span></div>` : '<p class="muted">No reviews yet. Be the first to share what it\'s like.</p>';
    const me = Account.user && Account.user.id;
    $('revList').innerHTML = reviews.map(r => `<li><span class="who">${esc(r.author)}</span> <span class="stars" aria-label="${r.rating} out of 5">${stars(r.rating)}</span><div class="meta">${r.visited ? 'Visited ' + esc(r.visited) + ' · ' : ''}${new Date(r.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}${r.user_id === me ? `<button type="button" class="del" data-del="${r.id}">Delete my review</button>` : ''}</div><p>${esc(r.body)}</p></li>`).join('');
    renderForm();
  }
  function renderForm() {
    const box = $('revForm');
    if (!sb) { box.innerHTML = ''; return; }
    if (!Account.user) { box.innerHTML = '<p><button type="button" class="btn alt" id="revSignIn">Sign in to write a review</button></p>'; $('revSignIn').onclick = () => Account.openAuth('Sign in to write a review.'); return; }
    const mine = reviews.find(r => r.user_id === Account.user.id);
    box.innerHTML = `<form class="rev-form" id="rf"><b>${mine ? 'Update your review' : 'Write a review'}</b>
      <fieldset class="star-pick" id="rfStars"><legend class="muted">Your rating</legend>${[1, 2, 3, 4, 5].map(n => `<label><input type="radio" name="rating" value="${n}" ${mine && mine.rating === n ? 'checked' : ''} required><span>★</span></label>`).join('')}</fieldset>
      <label for="rfName">Name shown with your review</label><input id="rfName" maxlength="60" required value="${esc(mine ? mine.author : (Account.username || ''))}" placeholder="e.g. Sam R.">
      <label for="rfVisited">When you visited (optional)</label><input id="rfVisited" maxlength="40" value="${esc(mine ? mine.visited || '' : '')}" placeholder="e.g. August 2026">
      <label for="rfBody">Your review</label><textarea id="rfBody" maxlength="2000" required placeholder="Site quality, shade, noise, road conditions, bugs, tips…">${esc(mine ? mine.body : '')}</textarea>
      <button type="submit" class="btn">${mine ? 'Update review' : 'Post review'}</button></form>`;
    const paint = () => { const v = +(box.querySelector('input[name=rating]:checked') || {}).value || 0; box.querySelectorAll('.star-pick label').forEach((l, i) => l.classList.toggle('on', i < v)); };
    box.querySelectorAll('input[name=rating]').forEach(r => r.addEventListener('change', paint)); paint();
    $('rf').addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const row = { site_id: o.id, rating: +box.querySelector('input[name=rating]:checked').value, author: $('rfName').value.trim(), visited: $('rfVisited').value.trim() || null, body: $('rfBody').value.trim() };
      const { error } = mine ? await sb.from('reviews').update(row).eq('id', mine.id) : await sb.from('reviews').insert(row);
      if (error) { Account.toast('Couldn\'t post your review: ' + error.message); return; }
      Account.toast(mine ? 'Review updated' : 'Thanks for your review'); loadReviews();
    });
  }
  $('revList').addEventListener('click', async (ev) => {
    const b = ev.target.closest('[data-del]'); if (!b) return;
    const { error } = await sb.from('reviews').delete().eq('id', b.dataset.del);
    if (!error) { Account.toast('Review deleted'); loadReviews(); }
  });
  Account.onChange(() => { refreshSaved(); loadReviews(); });
  Account.ready.then(() => { refreshSaved(); loadReviews(); });
})();
