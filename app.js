(() => {
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const SQFT = 10.7639;
const TYPES = ['Granite', 'Quartzite', 'Marble', 'Dolomite', 'Limestone', 'Soapstone', 'Travertine', 'Onyx', 'Other'];
const FIN = ['Polished', 'Honed', 'Leathered', 'Brushed', 'Flamed', 'Other'];
const THK = ['2 cm', '3 cm', '1.2 cm', 'Other'];
const CUR = ['USD', 'EUR', 'BRL'];
const PM = { m2: 'per m²', sqft: 'per sq ft', bundle: 'per bundle', slab: 'per slab' };
const ST = { considering: 'Considering', shortlist: 'Shortlist', buy: 'Buy', pass: 'Pass', purchased: 'Purchased' };
const DEF = ['Fissures', 'Cracks', 'Pits', 'Resin heavy', 'Mesh back', 'Color variation', 'Off-size', 'Chips', 'Rust spots', 'Uneven polish', 'Bowed'];
const DAILY = { id: '', name: 'Day-to-day', cur: 'USD', rate: 1, dim: 'in', pmode: 'sqft' };

let bundles = [], trips = [], cur = '*', edit = null, photoBusy = 0, cmp = new Set(), editingTrip = null, cfCb = null;
const edAdded = new Set();          // photos added in the open editor and not saved yet
let queue = [];                     // Drive jobs waiting: {id, kind:'photo'|'sheet', bundleId, photoId, at, tries, err}
const syncMeta = new Map();         // bundleId -> {id:'b:'+bundleId, folder, photos:{photoId: driveFileId}}
const meta = { sync: { id: 'sync' }, sheets: { id: 'sheets', byDay: {} } };
let syncing = false, syncProg = '', lastErr = '';
const urls = new Map();             // photoId -> object URL

const newId = p => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const toast = (m, act, fn) => {
  const t = $('toast'), a = $('toastAct');
  $('toastMsg').textContent = m; t.style.display = 'flex';
  a.style.display = act ? '' : 'none'; a.textContent = act || ''; a.onclick = fn || null;
  clearTimeout(toast.t); if (!act) toast.t = setTimeout(() => t.style.display = 'none', 3600);
};
const tripOf = id => trips.find(t => t.id === id) || DAILY;
const num = v => { const n = parseFloat(String(v ?? '').replace(',', '.')); return isFinite(n) ? n : 0; };
const usd = n => n ? '$' + Math.round(n).toLocaleString('en-US') : '—';
const usd2 = n => n ? '$' + n.toFixed(2) : '—';
const fmt = n => n ? Math.round(n).toLocaleString('en-US') : '—';
const opts = (sel, arr, lab) => { sel.innerHTML = arr.map(v => `<option value="${esc(v)}">${esc(lab ? lab[v] : v)}</option>`).join(''); };
const today = () => new Date().toLocaleDateString('en-CA');
const ago = t => { if (!t) return 'never'; const m = Math.round((Date.now() - t) / 60e3); return m < 1 ? 'just now' : m < 60 ? m + ' min ago' : m < 1440 ? Math.round(m / 60) + ' h ago' : new Date(t).toLocaleDateString(); };

/* ---------- photos on the device ---------- */
async function phUrl(id) {
  if (urls.has(id)) return urls.get(id);
  const r = await DB.get('photos', id).catch(() => null);
  if (!r?.blob) return '';
  const u = URL.createObjectURL(r.blob); urls.set(id, u); return u;
}
const imgTag = (id, extra = '') => `<img data-ph="${esc(id)}"${urls.has(id) ? ` src="${urls.get(id)}"` : ''} ${extra}>`;
function hydrate(root) { root.querySelectorAll('img[data-ph]:not([src])').forEach(async im => { const u = await phUrl(im.dataset.ph); if (u) im.src = u; }); }
async function bigPhoto(id) { const u = await phUrl(id); if (u) { $('lbImg').src = u; $('lb').classList.add('on'); } }

/* ---------- numbers ---------- */
/* ---------- exchange rates ----------
   meta.fx = {rates: {EUR: 1.099, BRL: 0.1684}, date, source, at} — USD value of 1 unit, from the
   European Central Bank's daily reference rates (Frankfurter), with open.er-api.com as a fallback. */
const FX_MAX_AGE = 3 * 3600e3;
const fxRate = c => c === 'USD' ? 1 : num(meta.fx?.rates?.[c]);
const autoRate = t => t.cur !== 'USD' && t.auto !== false;   // trips update automatically unless you typed a rate
const fmtRate = r => r ? String(+(+r).toPrecision(4)) : '';
const fxWhen = () => meta.fx?.date ? new Date(meta.fx.date + 'T12:00:00').toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : '';
async function fetchRates() {
  const want = CUR.filter(c => c !== 'USD');
  const invert = src => Object.fromEntries(want.filter(c => src?.[c] > 0).map(c => [c, +(1 / src[c]).toFixed(6)]));
  try {
    const r = await fetch(`https://api.frankfurter.dev/v1/latest?base=USD&symbols=${want.join(',')}`);
    if (r.ok) { const d = await r.json(); const rates = invert(d.rates); if (Object.keys(rates).length) return { rates, date: d.date, source: 'European Central Bank' }; }
  } catch {}
  const r = await fetch('https://open.er-api.com/v6/latest/USD');
  const d = await r.json();
  if (d.result !== 'success') throw new Error('No exchange rates available');
  return { rates: invert(d.rates), date: new Date(d.time_last_update_unix * 1000).toISOString().slice(0, 10), source: 'ExchangeRate-API' };
}
async function refreshRates(force) {
  if (refreshRates.busy || !navigator.onLine) return;
  if (!force && meta.fx?.at && Date.now() - meta.fx.at < FX_MAX_AGE) return;
  refreshRates.busy = true;
  try {
    const old = meta.fx?.rates || {}, fx = await fetchRates();
    meta.fx = { id: 'fx', ...fx, at: Date.now() }; await DB.put('meta', meta.fx);
    const moved = new Set(Object.keys(fx.rates).filter(c => fx.rates[c] !== old[c]));
    const affected = new Set();
    for (const t of trips) if (autoRate(t) && fx.rates[t.cur] && fx.rates[t.cur] !== t.rate) {
      t.rate = fx.rates[t.cur]; await DB.put('trips', t); affected.add(t.id);
    }
    // Bundles priced in a currency other than their trip's use the live rate directly.
    for (const b of bundles) if (b.cur !== 'USD' && b.cur !== tripOf(b.tripId).cur && moved.has(b.cur)) affected.add(b.tripId || '');
    if (affected.size && bundles.some(b => affected.has(b.tripId || ''))) {
      for (const tid of affected) await enqueueTripSheet(tid);
      await enqueueSnapshot(); setSync(); kick();
    }
    render(); if ($('tp').classList.contains('on')) { tpRender(); tFxNote(); } if (edit) edCalc();
  } catch {} finally { refreshRates.busy = false; }
}

function calc(b) {
  const t = tripOf(b.tripId);
  const rate = b.cur === 'USD' ? 1 : b.cur === t.cur ? (num(t.rate) || fxRate(t.cur)) : fxRate(b.cur);
  const L = num(b.len), W = num(b.wid), n = num(b.slabs);
  const slabM2 = b.dim === 'in' ? L * W / 1550.0031 : L * W / 10000;
  const m2 = slabM2 * n, sqft = m2 * SQFT, p = num(b.price);
  let local = 0;
  if (b.pmode === 'm2') local = p * m2; else if (b.pmode === 'sqft') local = p * sqft; else if (b.pmode === 'bundle') local = p; else if (b.pmode === 'slab') local = p * n;
  const total = local * rate;
  return { m2, sqft, local, total, psf: sqft ? total / sqft : 0, rate, rateKnown: !!rate };
}
const stars = q => q ? '★'.repeat(q) + '☆'.repeat(5 - q) : '';

function visible() {
  const q = $('q').value.trim().toLowerCase(), fs = $('fStatus').value;
  const r = bundles.filter(b => (cur === '*' || (b.tripId || '') === cur) && (!fs || b.status === fs) && (!q || [b.material, b.supplier, b.bundle, b.block, b.location, b.type, b.notes].join(' ').toLowerCase().includes(q)));
  const s = $('sort').value, c = new Map(r.map(b => [b.id, calc(b)]));
  const by = {
    new: (a, b) => (b.updated || 0) - (a.updated || 0), quality: (a, b) => (b.quality || 0) - (a.quality || 0),
    cheap: (a, b) => (c.get(a.id).psf || 1e9) - (c.get(b.id).psf || 1e9), total: (a, b) => c.get(b.id).total - c.get(a.id).total, area: (a, b) => c.get(b.id).sqft - c.get(a.id).sqft,
  };
  return r.sort(by[s]);
}

const queuedPhotos = () => new Set(queue.filter(j => j.kind === 'photo').map(j => j.photoId));
function driveNote(b, qp) {
  const ph = b.photos || [];
  if (!ph.length || !Drive.configured()) return '';
  const n = ph.filter(p => qp.has(p)).length;
  if (n) return ` · ${n} not in Drive yet`;
  const sm = syncMeta.get(b.id);
  return ph.every(p => sm?.photos?.[p]) ? ' · Drive ✓' : '';
}

function render() {
  const all = [{ id: '*', name: 'All' }, DAILY, ...trips];
  $('trips').innerHTML = all.map(t => `<button class="chip" data-trip="${esc(t.id)}" aria-pressed="${cur === t.id}">${esc(t.name)}</button>`).join('');
  const v = visible(), qp = queuedPhotos();
  const pick = v.filter(b => b.status === 'buy' || b.status === 'shortlist');
  const buy = v.filter(b => b.status === 'buy').map(calc);
  $('stats').innerHTML = `<div><b>${v.length}</b><span>bundles shown</span></div><div><b>${pick.length}</b><span>shortlist + buy</span></div>
    <div><b>${fmt(buy.reduce((a, c) => a + c.sqft, 0))}</b><span>sq ft marked buy</span></div><div><b>${usd(buy.reduce((a, c) => a + c.total, 0))}</b><span>USD marked buy</span></div>`;
  $('grid').innerHTML = v.map(b => {
    const c = calc(b), ph = (b.photos || [])[0], n = (b.photos || []).length;
    return `<article class="card" data-id="${esc(b.id)}" tabindex="0">
    <div class="ph">${ph ? imgTag(ph, 'alt="" loading="lazy"') : 'No photo yet'}</div>
    <button class="cmp" data-cmp="${esc(b.id)}" aria-pressed="${cmp.has(b.id)}" aria-label="Add to compare">${cmp.has(b.id) ? '✓' : '⇆'}</button>
    <div class="tagstrip"><span>${esc(b.bundle ? 'Bundle ' + b.bundle : 'No bundle #')}</span><span>${esc(b.slabs || '?')} slabs</span></div>
    <div class="bd"><div style="display:flex;justify-content:space-between;gap:8px;align-items:start"><h3>${esc(b.material || 'Unnamed')}</h3><span class="pill s-${esc(b.status)}">${esc(ST[b.status] || '')}</span></div>
    <div class="meta">${esc([b.type, b.thick, b.finish].filter(Boolean).join(' · '))}</div>
    <div class="meta">${esc([b.supplier, b.location].filter(Boolean).join(' — '))}</div>
    <div class="nums"><span><b>${fmt(c.sqft)}</b> sq ft</span><span><b>${usd2(c.psf)}</b>/sq ft</span><span><b>${usd(c.total)}</b></span></div>
    <div style="display:flex;justify-content:space-between;gap:8px"><span class="stars" aria-label="Quality ${b.quality || 0} of 5">${stars(b.quality)}</span><span class="meta">${n} photo${n === 1 ? '' : 's'}${(b.defects || []).length ? ' · ' + b.defects.length + ' flags' : ''}${driveNote(b, qp)}</span></div></div></article>`;
  }).join('');
  hydrate($('grid'));
  const e = $('empty'); e.style.display = v.length ? 'none' : 'block';
  e.innerHTML = bundles.length ? 'No bundles match these filters.' : 'No bundles yet. Tap <b>+ Bundle</b> at the yard, snap the photos, and fill in what you see. Everything saves on this phone, with or without signal.';
  $('cmpBar').style.display = cmp.size ? 'flex' : 'none'; $('cmpGo').textContent = `Compare ${cmp.size} bundle${cmp.size === 1 ? '' : 's'}`;
}

/* ---------- editor ---------- */
function seg(el, map, key) { el.innerHTML = Object.entries(map).map(([k, l]) => `<button type="button" data-v="${esc(k)}" aria-pressed="${String(edit[key]) === k}">${esc(l)}</button>`).join(''); }
function edRender() {
  seg($('u_dim'), { cm: 'cm', in: 'inches' }, 'dim');
  seg($('u_q'), { 1: '1 Poor', 2: '2', 3: '3 OK', 4: '4', 5: '5 A-grade' }, 'quality');
  seg($('u_st'), ST, 'status');
  $('u_def').innerHTML = DEF.map(d => `<button type="button" data-d="${esc(d)}" aria-pressed="${(edit.defects || []).includes(d)}">${esc(d)}</button>`).join('');
  $('phs').innerHTML = (edit.photos || []).map((p, i) => `<figure>${imgTag(p, `data-big="${esc(p)}" alt="Photo ${i + 1}"`)}
    <div class="x">${i ? `<button type="button" data-cover="${i}">Cover</button>` : '<span></span>'}<button type="button" data-rm="${i}">Remove</button></div></figure>`).join('') +
    `<div class="addph" id="addph" role="button" tabindex="0">${photoBusy ? 'Saving ' + photoBusy + '…' : '+ Add photos'}</div>`;
  hydrate($('phs'));
  edCalc();
}
// Live conversions shown under the size and price inputs: cm → inches, m² → sq ft, foreign currency → USD.
const f1 = n => (+n.toFixed(1)).toLocaleString('en-US');
const money = n => '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
function convHints(c) {
  const L = num(edit.len), W = num(edit.wid), p = num(edit.price);
  let size = '';
  if (edit.dim === 'cm' && (L || W)) {
    size = L && W ? `<b>${f1(L / 2.54)} × ${f1(W / 2.54)} in</b> per slab · ${(L * W / 1e4).toFixed(2)} m² = <b>${f1(L * W / 1e4 * SQFT)} sq ft</b> each`
      : `<b>${f1((L || W) / 2.54)} in</b>`;
  }
  let price = '';
  if (p && (edit.cur !== 'USD' || edit.pmode === 'm2')) {
    if (!c.rate) price = `Set a ${esc(edit.cur)}→USD rate on the trip to see this in USD.`;
    else {
      const usdEach = p * c.rate, inUsd = edit.cur !== 'USD';
      price = edit.pmode === 'm2'
        ? (inUsd ? `<b>${money(usdEach)} per m²</b> · ` : '') + `<b>${money(usdEach / SQFT)} per sq ft</b>`
        : `<b>${money(usdEach)} ${esc(PM[edit.pmode] || '')}</b>`;
      if (inUsd) price = '≈ ' + price + ` <span class="note">at ${fmtRate(c.rate)}</span>`;
    }
  }
  $('convSize').innerHTML = size; $('convSize').hidden = !size;
  $('convPrice').innerHTML = price; $('convPrice').hidden = !price;
}
function edCalc() {
  readForm(); const c = calc(edit), t = tripOf(edit.tripId);
  convHints(c);
  $('calc').innerHTML = `<div><b>${c.m2 ? c.m2.toFixed(2) : '—'}</b><span>m² total</span></div><div><b>${fmt(c.sqft)}</b><span>sq ft total</span></div>
   <div><b>${usd2(c.psf)}</b><span>USD per sq ft</span></div><div><b>${c.local ? Math.round(c.local).toLocaleString('en-US') + ' ' + esc(edit.cur) : '—'}</b><span>bundle cost</span></div>
   <div><b>${usd(c.total)}</b><span>bundle in USD</span></div><div><b>${esc(edit.cur === 'USD' ? '—' : fmtRate(c.rate) || 'set rate')}</b><span>${esc(edit.cur)}→USD rate${edit.cur !== 'USD' && (edit.cur !== t.cur || autoRate(t)) && meta.fx ? ' · live ' + esc(fxWhen()) : ''}</span></div>`;
}
const F = ['material', 'type', 'supplier', 'location', 'bundle', 'block', 'finish', 'thick', 'len', 'wid', 'slabs', 'price', 'cur', 'pmode', 'notes', 'tripId'];
const fid = k => k === 'tripId' ? 'f_trip' : 'f_' + k;
function readForm() { for (const k of F) edit[k] = $(fid(k)).value; }
// New bundles go to the trip whose chip you're viewing; on "All", to the most recently added trip.
const newestTrip = () => trips.reduce((a, t) => (!a || (t.created || 0) >= (a.created || 0) ? t : a), null) || DAILY;
function openEd(b) {
  const t = cur === '*' ? newestTrip() : tripOf(cur);
  edit = b ? structuredClone(b) : { id: null, tripId: t.id, cur: t.cur, dim: t.dim, pmode: t.pmode, status: 'considering', quality: 0, defects: [], photos: [], type: 'Quartzite', finish: 'Polished', thick: '3 cm' };
  edAdded.clear();
  $('edT').textContent = b ? 'Edit bundle' : 'New bundle'; $('edDel').style.display = b ? '' : 'none';
  $('f_trip').innerHTML = [DAILY, ...trips].map(t => `<option value="${esc(t.id)}">${esc(t.name)}</option>`).join('');
  for (const k of F) $(fid(k)).value = edit[k] ?? '';
  edRender(); $('ed').classList.add('on'); $('ed').firstElementChild.scrollTop = 0;
}
async function closeEd(saved) {
  stopDictation();
  $('ed').classList.remove('on');
  if (!saved) for (const p of edAdded) await dropPhoto(p);
  edAdded.clear(); edit = null;
}
async function save() {
  if (photoBusy) return toast('Wait for photos to finish saving.');
  readForm();
  const id = edit.id || newId('b'), old = bundles.find(b => b.id === id);
  const body = { ...edit, id, updated: Date.now(), created: edit.created || Date.now() };
  $('edSave').disabled = true;
  try {
    await DB.put('bundles', body);
    bundles = old ? bundles.map(b => b.id === id ? body : b) : [...bundles, body];
    for (const p of old?.photos || []) if (!body.photos.includes(p)) await dropPhoto(p);
    await enqueuePhotos(body); await enqueueTripSheet(body.tripId);
    if (old && (old.tripId || '') !== (body.tripId || '')) await enqueueTripSheet(old.tripId);   // moved out of a trip
    await enqueueSnapshot();
    await closeEd(true); toast('Saved on this device'); askPersist(); render(); setSync(); kick();
  } catch (e) {
    toast(e?.name === 'QuotaExceededError' ? 'This device is out of storage space. Delete old bundles or photos, then save again.' : 'Save failed: ' + (e?.message || e) + '. Your entry is still open.');
  } finally { $('edSave').disabled = false; }
}
async function shrink(file) {
  try {
    const bmp = await createImageBitmap(file); const k = Math.min(1, 1800 / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas'); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    return await new Promise(r => c.toBlob(b => r(b || file), 'image/jpeg', .82));
  } catch { return file; }
}
async function addPhotos(files) {
  for (const f of files) {
    photoBusy++; edRender();
    try {
      const blob = await shrink(f), id = newId('p');
      await DB.put('photos', { id, blob, created: Date.now() });
      edAdded.add(id);
      if (edit) edit.photos = [...(edit.photos || []), id];
    } catch (e) { toast(e?.name === 'QuotaExceededError' ? 'This device is out of storage space for photos.' : 'A photo could not be saved. Try adding it again.'); }
    finally { photoBusy--; if (edit) edRender(); }
  }
}

/* ---------- trips ---------- */
function tpRender() {
  $('tpList').innerHTML = trips.length ? trips.map(t => `<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;border-bottom:1px solid var(--line);padding:10px 0">
   <div><b>${esc(t.name)}</b><div class="note">${esc(t.cur)}${t.cur === 'USD' ? '' : ` · 1 ${esc(t.cur)} = $${esc(fmtRate(t.rate) || '?')} · ${autoRate(t) ? 'auto-updated' + (meta.fx ? ' ' + esc(fxWhen()) : '') : 'fixed rate'}`} · ${esc(t.dim)} · ${esc(PM[t.pmode] || '')}</div></div>
   <button data-et="${esc(t.id)}">Edit</button></div>`).join('') : '<p class="note">No trips yet. "Day-to-day" (USD, inches, per sq ft) is always there.</p>';
}
// Trip form: the rate box follows the live rate while "auto" is ticked; typing a rate unticks it.
function tFxNote() {
  const c = $('t_cur').value, usdTrip = c === 'USD', live = fxRate(c), auto = $('t_auto').checked;
  $('t_autoRow').style.display = usdTrip ? 'none' : '';
  $('t_rate').disabled = usdTrip;
  if (usdTrip) { $('t_rate').value = 1; return; }
  if (auto && live) $('t_rate').value = fmtRate(live);
  $('t_fx').textContent = live
    ? `Today's rate: 1 ${c} = $${fmtRate(live)} (${meta.fx.source}, ${fxWhen()}).` + (auto ? ' Updates on its own when the app is online.' : ' Your rate stays fixed.')
    : navigator.onLine ? 'Getting today’s rate…' : 'Offline: enter a rate for now. It updates when you’re back online.';
  if (!live) refreshRates(true).then(() => { if (fxRate(c) && $('t_cur').value === c) tFxNote(); });
}
function tForm(t) {
  editingTrip = t?.id || null; $('t_name').value = t?.name || ''; $('t_cur').value = t?.cur || 'EUR'; $('t_rate').value = fmtRate(t?.rate);
  $('t_dim').value = t?.dim || 'cm'; $('t_pmode').value = t?.pmode || 'm2'; $('t_auto').checked = t ? t.auto !== false : true;
  tFxNote();
}
async function saveTrip() {
  const name = $('t_name').value.trim(); if (!name) return toast('Give the trip a name.');
  const c = $('t_cur').value, auto = c !== 'USD' && $('t_auto').checked;
  const rate = c === 'USD' ? 1 : (auto && fxRate(c)) || num($('t_rate').value);
  if (!rate) return toast(navigator.onLine ? 'Enter the exchange rate to USD.' : 'Offline: enter the exchange rate for now. It updates when you’re back online.');
  const id = editingTrip || newId('t'), old = trips.find(t => t.id === id);
  const t = { id, name, cur: c, rate, auto, dim: $('t_dim').value, pmode: $('t_pmode').value, created: old?.created || Date.now() };
  try {
    await DB.put('trips', t);
    trips = (old ? trips.map(x => x.id === id ? t : x) : [...trips, t]).sort((a, b) => (a.created || 0) - (b.created || 0));
    await enqueueTripSheet(id); await enqueueSnapshot(); tForm(); tpRender(); render(); setSync(); kick(); toast('Trip saved');
  } catch (e) { toast('Trip save failed: ' + (e?.message || e)); }
}

/* ---------- compare / csv ---------- */
function compare() {
  const list = bundles.filter(b => cmp.has(b.id)), cs = list.map(calc);
  const row = (l, f) => `<tr><th>${l}</th>${list.map((b, i) => `<td>${f(b, cs[i])}</td>`).join('')}</tr>`;
  $('cpBody').innerHTML = `<table><tbody>${row('Photo', b => b.photos?.[0] ? imgTag(b.photos[0], `alt="" data-big="${esc(b.photos[0])}"`) : '—')}
   ${row('Material', b => `<b>${esc(b.material)}</b>`)}${row('Supplier', b => esc(b.supplier))}${row('Bundle #', b => esc(b.bundle))}
   ${row('Type · finish', b => esc([b.type, b.thick, b.finish].filter(Boolean).join(' · ')))}
   ${row('Slabs × size', b => esc(`${b.slabs || '?'} × ${b.len || '?'}×${b.wid || '?'} ${b.dim}`))}${row('Sq ft', (b, c) => fmt(c.sqft))}
   ${row('USD / sq ft', (b, c) => usd2(c.psf))}${row('Bundle USD', (b, c) => usd(c.total))}${row('Quality', b => `<span class="stars">${stars(b.quality)}</span>`)}
   ${row('Flags', b => esc((b.defects || []).join(', ')) || '—')}${row('Notes', b => esc(b.notes) || '—')}${row('Decision', b => `<span class="pill s-${esc(b.status)}">${esc(ST[b.status])}</span>`)}</tbody></table>`;
  hydrate($('cpBody'));
  $('cp').classList.add('on');
}
function csvText(list) {
  const h = ['Trip', 'Material', 'Type', 'Supplier', 'Location', 'Bundle', 'Block', 'Finish', 'Thickness', 'Slabs', 'Length', 'Width', 'Unit', 'Sq ft', 'Price', 'Currency', 'Price per', 'Bundle USD', 'USD per sq ft', 'Quality', 'Defects', 'Status', 'Notes', 'Photos in Drive', 'Photo count', 'Updated'];
  const q = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const rows = list.map(b => {
    const c = calc(b), f = syncMeta.get(b.id)?.folder;
    return [tripOf(b.tripId).name, b.material, b.type, b.supplier, b.location, b.bundle, b.block, b.finish, b.thick, b.slabs, b.len, b.wid, b.dim, c.sqft.toFixed(1), b.price, b.cur, PM[b.pmode], c.total.toFixed(2), c.psf.toFixed(2), b.quality, (b.defects || []).join('; '), ST[b.status], b.notes, f ? 'https://drive.google.com/drive/folders/' + f : '', (b.photos || []).length, b.updated ? new Date(b.updated).toISOString().slice(0, 16).replace('T', ' ') : ''].map(q).join(',');
  });
  return { text: [h.map(q).join(','), ...rows].join('\n'), n: rows.length };
}
async function csv() {
  const { text, n } = csvText(visible());
  try { await navigator.clipboard.writeText(text); toast('Copied ' + n + ' rows. Paste into Excel or Sheets.'); } catch { toast('Copy was blocked by the browser.'); }
}

/* ---------- Drive sync queue ---------- */
async function enqueuePhotos(b) {
  const sm = syncMeta.get(b.id), have = new Set(queue.map(j => j.id));
  for (const p of b.photos || []) {
    if (sm?.photos?.[p] || have.has('p:' + p)) continue;
    const j = { id: 'p:' + p, kind: 'photo', bundleId: b.id, photoId: p, at: Date.now(), tries: 0 };
    await DB.put('queue', j); queue.push(j);
  }
}
// Sheet jobs: one per trip ("sheet:<tripKey>") plus one for the all-trips daily copy ("snapshot").
// Re-queuing replaces the waiting job, so a burst of edits still means one upload.
const tripKey = tid => tid || 'daily';
async function putJob(j) { await DB.put('queue', j); queue = queue.filter(x => x.id !== j.id).concat(j); }
const enqueueTripSheet = tid => putJob({ id: 'sheet:' + tripKey(tid), kind: 'tripSheet', trip: tripKey(tid), at: Date.now(), tries: 0 });
const enqueueSnapshot = () => putJob({ id: 'snapshot', kind: 'snapshot', at: Date.now(), tries: 0 });
async function dropJob(id) { await DB.del('queue', id); queue = queue.filter(j => j.id !== id); }
async function dropPhoto(p) {
  await DB.del('photos', p).catch(() => {}); await dropJob('p:' + p);
  const u = urls.get(p); if (u) { URL.revokeObjectURL(u); urls.delete(p); }
}
async function putSyncMeta(bid, sm) { sm.id = 'b:' + bid; syncMeta.set(bid, sm); await DB.put('meta', sm); }
let syncTimer = null;
const kick = (ms = 1500) => { clearTimeout(syncTimer); syncTimer = setTimeout(runSync, ms); };
const bundleFolderName = b => `${b.bundle || 'No bundle #'} — ${b.material || 'Unnamed'} — ${b.id.slice(-4)}`;
const fileSlug = s => String(s).replace(/[^\w.-]+/g, '_').slice(0, 40) || 'bundle';

async function syncPhoto(j, ctx) {
  const b = bundles.find(x => x.id === j.bundleId), rec = await DB.get('photos', j.photoId);
  if (!b || !rec?.blob || !(b.photos || []).includes(j.photoId)) return;   // stale job: photo or bundle gone
  const sm = structuredClone(syncMeta.get(b.id) || { folder: null, photos: {} });
  if (sm.folder && !ctx.checked.has(sm.folder)) {
    if (await Drive.alive(sm.folder)) ctx.checked.add(sm.folder);
    else {   // folder was deleted in Drive: start this bundle over
      sm.folder = null; sm.photos = {};
      await putSyncMeta(b.id, sm); await enqueuePhotos(b);
    }
  }
  if (!sm.folder) {
    const tk = b.tripId || 'daily';
    if (!ctx.trip.has(tk)) ctx.trip.set(tk, await Drive.ensureFolder(tripOf(b.tripId).name, ctx.photos));
    sm.folder = await Drive.ensureFolder(bundleFolderName(b), ctx.trip.get(tk));
    ctx.checked.add(sm.folder);
    await putSyncMeta(b.id, sm);
  }
  const i = b.photos.indexOf(j.photoId) + 1;
  const r = await Drive.upload({ name: `${fileSlug(b.bundle)}_${i}_${j.photoId.slice(-6)}.jpg`, parents: [sm.folder] }, rec.blob);
  sm.photos[j.photoId] = r.id;
  await putSyncMeta(b.id, sm);
}
const sheetUrl = r => r.webViewLink || `https://docs.google.com/spreadsheets/d/${r.id}/edit`;
// Remember sheets the app wrote but couldn't re-lock, so the Drive panel can say so.
function noteLock(r, name) {
  const sh = meta.sheets; sh.unlocked ||= {};
  if (r.lockError) sh.unlocked[r.id] = { name, err: r.lockError }; else delete sh.unlocked[r.id];
}
const byCreated = (a, b) => (a.created || 0) - (b.created || 0);
const csvBlob = list => new Blob([csvText(list).text], { type: 'text/csv' });
const tripSheetName = key => `Bundle Book — ${tripOf(key === 'daily' ? '' : key).name}`;

// One Google Sheet per trip, in Bundle Book › Sheets. Each keeps the same file (and link) for good;
// its content is replaced in place and its name follows the trip's name. The file is tagged with the
// trip's id (appProperties), so a renamed trip, or a new phone, still finds the same sheet.
async function syncTripSheet(j, ctx) {
  const key = j.trip, tid = key === 'daily' ? '' : key, sh = meta.sheets;
  if (tid && !trips.some(t => t.id === tid)) return;   // trip no longer exists
  const list = bundles.filter(b => (b.tripId || '') === tid).sort(byCreated);
  let ent = sh.trips[key];
  if (!tid && !list.length && !ent) return;             // no empty Day-to-day sheet until it has bundles
  if (!ent?.id) { const id = await Drive.findByProp('bbTrip', key, ctx.sheets); if (id) ent = { id }; }
  const name = tripSheetName(key), blob = csvBlob(list);
  const r = ent?.id && await Drive.alive(ent.id)
    ? await Drive.writeLocked({ name }, blob, ent.id)
    : await Drive.writeLocked({ name, parents: [ctx.sheets], mimeType: Drive.SHEET, appProperties: { bbTrip: key } }, blob);
  sh.trips[key] = { id: r.id, url: sheetUrl(r) };
  noteLock(r, name);
  await DB.put('meta', sh);
}

// Dated copy of every bundle across all trips, in Bundle Book › Sheets › Daily copies.
// One per day, rewritten through the day; earlier days are left alone.
async function syncSnapshot(ctx) {
  const day = today(), name = `All trips — ${day}`, sh = meta.sheets;
  const list = [...bundles].sort((a, b) => tripOf(a.tripId).name.localeCompare(tripOf(b.tripId).name) || byCreated(a, b));
  const blob = csvBlob(list);
  let r = null; const ent = sh.byDay[day];
  if (ent?.id && await Drive.alive(ent.id)) {
    try { r = await Drive.writeLocked({ name }, blob, ent.id); } catch (e) { if (e.code !== 'http') throw e; }
  }
  if (!r) {
    ctx.daily ||= await Drive.ensureFolder('Daily copies', ctx.sheets);
    r = await Drive.writeLocked({ name, parents: [ctx.daily], mimeType: Drive.SHEET }, blob);
  }
  noteLock(r, name);
  sh.byDay[day] = { id: r.id, url: sheetUrl(r) };
  sh.last = { day, ...sh.byDay[day] };
  await DB.put('meta', sh);
}
async function runSync() {
  if (syncing || !queue.length || !Drive.configured() || !navigator.onLine || !Drive.token()) { setSync(); return; }
  syncing = true; lastErr = ''; setSync();
  const rank = { photo: 0, tripSheet: 1, snapshot: 2 };   // photos first, so sheets can link their folders
  const jobs = [...queue].sort((a, b) => (rank[a.kind] ?? 3) - (rank[b.kind] ?? 3) || a.at - b.at);
  try {
    const root = await Drive.ensureFolder('Bundle Book');
    const ctx = { root, photos: await Drive.ensureFolder('Photos', root), sheets: await Drive.ensureFolder('Sheets', root), trip: new Map(), checked: new Set() };
    meta.sync.root = root;
    let i = 0;
    for (const j0 of jobs) {
      const j = queue.find(x => x.id === j0.id && x.at === j0.at); if (!j) continue;   // removed or replaced meanwhile
      syncProg = `${++i}/${jobs.length}`; setSync();
      try {
        if (j.kind === 'photo') await syncPhoto(j, ctx);
        else if (j.kind === 'tripSheet') await syncTripSheet(j, ctx);
        else if (j.kind === 'snapshot') await syncSnapshot(ctx);
        if (queue.find(x => x.id === j.id)?.at === j.at) await dropJob(j.id);   // keep a newer sheet job queued during the run
      } catch (e) {
        if (e.code === 'auth' || e.code === 'offline') throw e;
        j.tries = (j.tries || 0) + 1; j.err = e.message; await DB.put('queue', j); lastErr = e.message;
      }
      if (j.kind === 'photo' && i % 3 === 0) render();
    }
    meta.sync.last = Date.now(); await DB.put('meta', meta.sync);
  } catch (e) {
    lastErr = e.code === 'auth' ? '' : (e.message || String(e));
  } finally {
    syncing = false; syncProg = ''; render(); setSync();
    if (queue.some(j => !j.tries) && navigator.onLine && Drive.token()) kick(800);
  }
}

const waitCounts = () => {
  const ph = queue.filter(j => j.kind === 'photo').length, sh = queue.filter(j => j.kind === 'tripSheet').length, snap = queue.some(j => j.kind === 'snapshot');
  const parts = [ph ? `${ph} photo${ph === 1 ? '' : 's'}` : '', sh ? `${sh} trip sheet${sh === 1 ? '' : 's'}` : (snap ? 'the daily copy' : '')].filter(Boolean);
  return { n: ph + sh + (snap && !sh ? 1 : 0), text: parts.join(' and ') };
};
const jobLabel = j => j.kind === 'photo' ? 'Photo for ' + (bundles.find(b => b.id === j.bundleId)?.material || 'a bundle')
  : j.kind === 'tripSheet' ? 'Sheet for ' + tripOf(j.trip === 'daily' ? '' : j.trip).name : 'Daily copy';

function setSync() {
  const { n, text: waiting } = waitCounts();
  let s, lbl, dot;
  if (!Drive.configured()) { s = 'Saved on this device. Drive sync is off until the Google client ID is set.'; lbl = 'Drive'; dot = ''; }
  else if (syncing) { s = `Sending to Google Drive… ${syncProg}`; lbl = 'Syncing…'; dot = 'wait'; }
  else if (!n && !meta.sync.last) { s = bundles.length ? 'Saved on this device.' : 'Everything you add saves on this device first.'; lbl = 'Drive'; dot = ''; }
  else if (!n) { s = 'Saved on this device and in Google Drive' + (meta.sync.last ? ' · synced ' + ago(meta.sync.last) : '') + '.'; lbl = 'Drive'; dot = 'ok'; }
  else if (!navigator.onLine) { s = `Offline. Saved on this device; ${waiting} will go to Drive when you're back online.`; lbl = `${n} waiting`; dot = 'wait'; }
  else if (!Drive.token()) { s = `Saved on this device. Connect Google Drive to send ${waiting}.`; lbl = 'Connect Drive'; dot = 'bad'; }
  else { s = `${waiting[0].toUpperCase() + waiting.slice(1)} waiting for Drive.` + (lastErr ? ' Last try failed: ' + lastErr : ''); lbl = `${n} waiting`; dot = lastErr ? 'bad' : 'wait'; }
  $('status').textContent = s; $('driveLbl').textContent = lbl; $('driveDot').className = 'dot ' + dot;
  if ($('dv').classList.contains('on')) dvRender();
}

/* ---------- Drive panel ---------- */
async function dvRender() {
  const conf = Drive.configured(), tok = !!Drive.token(), on = navigator.onLine;
  const fails = queue.filter(j => j.tries && j.err);
  const wait = waitCounts().text;
  const last = meta.sheets.last, root = meta.sync.root;
  const sheetRows = [DAILY, ...trips].map(t => ({ t, ent: meta.sheets.trips[tripKey(t.id)] })).filter(x => x.ent || x.t.id);
  let est = '';
  try {
    const e = await navigator.storage?.estimate?.(), p = await navigator.storage?.persisted?.();
    if (e) est = `${(e.usage / 1048576).toFixed(1)} MB used${e.quota ? ' of ' + Math.round(e.quota / 1048576).toLocaleString() + ' MB available' : ''}${p === undefined ? '' : p ? ' · protected from clean-up' : ' · the browser may clear it if space runs low'}`;
  } catch {}
  $('dvBody').innerHTML = `
   <p class="sub">${esc($('status').textContent)}</p>
   ${conf ? '' : `<p class="note" style="margin-top:12px">To turn on Drive sync, put your OAuth client ID in <code>config.js</code> and add this address as an authorized redirect URI in Google Cloud: <code>${esc(Drive.redirectUri())}</code></p>`}
   <div class="acts" style="margin-top:14px">
     ${conf ? `<button class="pri" id="dvGo" ${on ? '' : 'disabled'}>${tok ? 'Sync now' : (Drive.email() ? 'Reconnect Google' : 'Connect Google Drive')}</button>` : ''}
     ${tok ? '<button id="dvOut">Disconnect</button>' : ''}
   </div>
   <dl class="kv">
     <dt>Account</dt><dd>${tok || Drive.email() ? esc(Drive.email() || 'Connected') + (tok ? '' : ' (sign-in expired)') : 'Not connected'}</dd>
     <dt>Waiting</dt><dd>${esc(wait || 'Nothing')}</dd>
     <dt>Last sync</dt><dd>${ago(meta.sync.last)}</dd>
     <dt>Drive folder</dt><dd>${root ? `<a href="https://drive.google.com/drive/folders/${esc(root)}" target="_blank" rel="noopener">Bundle Book</a> › Photos / Sheets` : 'Bundle Book › Photos / Sheets (made on first sync)'}</dd>
     <dt>Today's copy</dt><dd>${last ? `<a href="${esc(last.url)}" target="_blank" rel="noopener">All trips — ${esc(last.day)}</a>` : 'None yet'}</dd>
     <dt>On this device</dt><dd>${esc(est || 'Unknown')}</dd>
   </dl>
   <h3>Trip sheets</h3>
   ${sheetRows.length ? sheetRows.map(({ t, ent }) => `<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;border-bottom:1px solid var(--line);padding:8px 0">
     <div>${ent ? `<a href="${esc(ent.url)}" target="_blank" rel="noopener">${esc(t.name)}</a>` : `<b>${esc(t.name)}</b> <span class="note">· made on next sync</span>`}</div>
     ${ent ? `<button data-copy="${esc(ent.url)}" style="min-height:34px">Copy link</button>` : ''}</div>`).join('') : '<p class="note">Each trip gets its own sheet as soon as you create it. Day-to-day gets one when it has a bundle.</p>'}
   ${fails.length ? `<h3 style="margin-top:16px">Couldn't send</h3><ul class="note">${fails.map(j => `<li>${esc(jobLabel(j))}: ${esc(j.err)} (${j.tries} tr${j.tries === 1 ? 'y' : 'ies'})</li>`).join('')}</ul>` : ''}
   ${Object.keys(meta.sheets.unlocked || {}).length ? `<h3 style="margin-top:16px">Not locked</h3><ul class="note">${Object.values(meta.sheets.unlocked).map(u => `<li>${esc(u.name)}: Drive refused the lock (${esc(u.err)}). The next sync tries again.</li>`).join('')}</ul>` : ''}
   <p class="note" style="margin-top:16px">Each trip has its own Google Sheet in Bundle Book › Sheets, replaced with that trip's bundles on every sync. The sheets are locked, so they open view-only and changes are made here in the app. A sheet's link never changes, even if you rename the trip, so you can pull it into your own spreadsheet with <code>=IMPORTRANGE("link", "A1:Z")</code>. A dated copy of all trips is kept in Sheets › Daily copies. Photos go to Photos › trip › bundle. Deleting a bundle here doesn't delete its copies in Drive.</p>
   <p class="note">Google sign-in lasts about an hour. After that, anything new waits here until you tap Reconnect.</p>`;
  const go = $('dvGo'); if (go) go.onclick = () => tok ? runSync() : Drive.connect();
  $('dvBody').querySelectorAll('[data-copy]').forEach(b => b.onclick = async () => { try { await navigator.clipboard.writeText(b.dataset.copy); toast('Sheet link copied'); } catch { toast('Copy was blocked by the browser.'); } });
  const out = $('dvOut'); if (out) out.onclick = () => { Drive.disconnect(); setSync(); toast('Disconnected from Google Drive'); };
}

/* ---------- dictation (Web Speech API; usually needs a connection) ---------- */
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
let rec = null, listening = false;
const micLabel = () => { $('mic').textContent = listening ? '■ Stop dictating' : '🎙 Dictate'; };
function stopDictation() { if (rec && listening) try { rec.stop(); } catch {} }
if (SR) $('mic').style.display = '';
$('mic').onclick = () => {
  if (listening) return stopDictation();
  rec = new SR(); rec.lang = navigator.language || 'en-US'; rec.continuous = true; rec.interimResults = false;
  rec.onresult = e => {
    for (let i = e.resultIndex; i < e.results.length; i++) if (e.results[i].isFinal) {
      const n = $('f_notes'), t = e.results[i][0].transcript.trim();
      if (t) n.value = (n.value ? n.value.trimEnd() + ' ' : '') + t;
    }
  };
  rec.onstart = () => { listening = true; micLabel(); };
  rec.onend = () => { listening = false; micLabel(); };
  rec.onerror = e => toast(e.error === 'not-allowed' ? 'Microphone access was denied.' : e.error === 'network' ? 'Dictation needs a connection on this phone.' : e.error === 'no-speech' ? 'Didn’t hear anything.' : 'Dictation stopped (' + e.error + ').');
  try { rec.start(); } catch {}
};

/* ---------- storage persistence ---------- */
let persistAsked = false;
async function askPersist() {
  if (persistAsked || !navigator.storage?.persist) return; persistAsked = true;
  try { if (!(await navigator.storage.persisted())) await navigator.storage.persist(); } catch {}
}

/* ---------- events ---------- */
const confirmDel = (t, m, cb) => { $('cfT').textContent = t; $('cfM').textContent = m; cfCb = cb; $('cf').classList.add('on'); };
opts($('f_type'), TYPES); opts($('f_finish'), FIN); opts($('f_thick'), THK); opts($('f_cur'), CUR); opts($('t_cur'), CUR);
opts($('f_pmode'), Object.keys(PM), PM); opts($('t_pmode'), Object.keys(PM), PM);
$('fStatus').innerHTML += Object.entries(ST).map(([k, l]) => `<option value="${k}">${l}</option>`).join('');
['q', 'fStatus', 'sort'].forEach(i => $(i).addEventListener('input', render));
$('trips').addEventListener('click', e => { const b = e.target.closest('[data-trip]'); if (b) { cur = b.dataset.trip; render(); } });
$('grid').addEventListener('click', e => {
  const c = e.target.closest('[data-cmp]');
  if (c) { e.stopPropagation(); const id = c.dataset.cmp; cmp.has(id) ? cmp.delete(id) : (cmp.size < 4 ? cmp.add(id) : toast('Compare up to 4 at a time.')); render(); return; }
  const a = e.target.closest('.card'); if (a) openEd(bundles.find(b => b.id === a.dataset.id));
});
$('grid').addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.classList.contains('card')) openEd(bundles.find(b => b.id === e.target.dataset.id)); });
$('newBtn').onclick = () => openEd(null); $('edClose').onclick = () => closeEd(false); $('edSave').onclick = save;
$('ed').addEventListener('input', e => { if (edit && e.target.matches('input,select')) edCalc(); });
$('u_dim').onclick = e => { const b = e.target.closest('[data-v]'); if (b) { readForm(); edit.dim = b.dataset.v; edRender(); } };
$('u_q').onclick = e => { const b = e.target.closest('[data-v]'); if (b) { readForm(); edit.quality = +b.dataset.v; edRender(); } };
$('u_st').onclick = e => { const b = e.target.closest('[data-v]'); if (b) { readForm(); edit.status = b.dataset.v; edRender(); } };
$('u_def').onclick = e => { const b = e.target.closest('[data-d]'); if (!b) return; readForm(); const d = b.dataset.d, s = new Set(edit.defects || []); s.has(d) ? s.delete(d) : s.add(d); edit.defects = [...s]; edRender(); };
$('phs').onclick = e => {
  const t = e.target;
  if (t.closest('#addph')) { if (!photoBusy) $('file').click(); return; }
  if (t.dataset.rm) { readForm(); edit.photos.splice(+t.dataset.rm, 1); edRender(); return; }
  if (t.dataset.cover) { readForm(); const i = +t.dataset.cover, [p] = edit.photos.splice(i, 1); edit.photos.unshift(p); edRender(); return; }
  if (t.dataset.big) bigPhoto(t.dataset.big);
};
$('phs').addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.id === 'addph') $('file').click(); });
$('file').onchange = e => { readForm(); addPhotos([...e.target.files]); e.target.value = ''; };
$('lbX').onclick = $('lb').onclick = e => { if (e.target !== $('lbImg')) $('lb').classList.remove('on'); };
$('edDel').onclick = () => confirmDel('Delete this bundle?', 'Its notes and photos are removed from this device. Copies already in Google Drive stay there.', async () => {
  try {
    const b = bundles.find(x => x.id === edit.id);
    await DB.del('bundles', b.id);
    for (const p of new Set([...(b.photos || []), ...edAdded])) await dropPhoto(p);
    for (const j of queue.filter(j => j.bundleId === b.id)) await dropJob(j.id);
    await DB.del('meta', 'b:' + b.id); syncMeta.delete(b.id);
    bundles = bundles.filter(x => x.id !== b.id); cmp.delete(b.id);
    await enqueueTripSheet(b.tripId); await enqueueSnapshot(); await closeEd(true); render(); setSync(); kick(); toast('Deleted');
  } catch (e) { toast('Delete failed: ' + (e?.message || e)); }
});
$('cfNo').onclick = () => $('cf').classList.remove('on'); $('cfYes').onclick = () => { $('cf').classList.remove('on'); cfCb && cfCb(); };
$('tripBtn').onclick = () => { tpRender(); tForm(); $('tp').classList.add('on'); }; $('tpClose').onclick = () => $('tp').classList.remove('on');
$('tpList').onclick = e => { const b = e.target.closest('[data-et]'); if (b) tForm(trips.find(t => t.id === b.dataset.et)); };
$('tSave').onclick = saveTrip; $('tNew').onclick = () => tForm();
$('t_cur').onchange = tFxNote;
$('t_auto').onchange = tFxNote;
$('t_rate').addEventListener('input', () => { if ($('t_auto').checked) { $('t_auto').checked = false; tFxNote(); } });
$('cmpGo').onclick = compare; $('cmpClear').onclick = () => { cmp.clear(); render(); }; $('cpClose').onclick = () => $('cp').classList.remove('on');
$('cpBody').onclick = e => { if (e.target.dataset.big) bigPhoto(e.target.dataset.big); };
$('csvBtn').onclick = csv;
$('driveBtn').onclick = () => { $('dv').classList.add('on'); dvRender(); }; $('dvClose').onclick = () => $('dv').classList.remove('on');
document.addEventListener('keydown', e => {
  if (e.key !== 'Escape') return;
  for (const s of ['lb', 'cf', 'cp', 'dv', 'tp', 'ed']) if ($(s).classList.contains('on')) { s === 'ed' ? closeEd(false) : $(s).classList.remove('on'); break; }
});
addEventListener('online', () => { setSync(); kick(500); refreshRates(); });
addEventListener('offline', setSync);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { setSync(); kick(500); refreshRates(); } });
setInterval(() => { if (document.visibilityState === 'visible' && queue.length) runSync(); else setSync(); }, 5 * 60e3);

/* ---------- install + updates ---------- */
let installEvt = null;
addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvt = e; $('instBtn').style.display = ''; });
$('instBtn').onclick = async () => { if (!installEvt) return; installEvt.prompt(); await installEvt.userChoice.catch(() => {}); installEvt = null; $('instBtn').style.display = 'none'; };
addEventListener('appinstalled', () => { $('instBtn').style.display = 'none'; });
if ('serviceWorker' in navigator) {
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (reloading) location.reload(); });
  navigator.serviceWorker.register('sw.js').then(reg => {
    const offer = w => toast('A new version of Bundle Book is ready.', 'Reload', () => { reloading = true; w.postMessage('skipWaiting'); });
    if (reg.waiting && navigator.serviceWorker.controller) offer(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      w?.addEventListener('statechange', () => { if (w.state === 'installed' && navigator.serviceWorker.controller) offer(w); });
    });
  }).catch(() => {});
}

/* ---------- boot ---------- */
(async () => {
  const back = Drive.handleRedirect();
  try {
    let all;
    [bundles, trips, queue, all] = await Promise.all([DB.all('bundles'), DB.all('trips'), DB.all('queue'), DB.all('meta')]);
    trips.sort((a, b) => (a.created || 0) - (b.created || 0));
    for (const m of all) { if (m.id.startsWith('b:')) syncMeta.set(m.id.slice(2), m); else meta[m.id] = m; }
    meta.sheets.byDay ||= {}; meta.sheets.trips ||= {};
    // Older versions queued one 'sheet' job; replace it with the per-trip jobs below.
    if (queue.some(j => j.kind === 'sheet')) { await dropJob('sheet'); await enqueueSnapshot(); }
    // Every trip gets its own sheet: queue one for any trip (or a non-empty Day-to-day) that doesn't have one yet.
    const want = [...trips.map(t => t.id), ...(bundles.some(b => !b.tripId) ? [''] : [])];
    for (const tid of want) if (!meta.sheets.trips[tripKey(tid)] && !queue.some(j => j.id === 'sheet:' + tripKey(tid))) await enqueueTripSheet(tid);
    // Sheets made before locking existed: rewrite them once so they get locked.
    if (!meta.sheets.lockV) {
      for (const key of Object.keys(meta.sheets.trips)) await enqueueTripSheet(key === 'daily' ? '' : key);
      if (meta.sheets.byDay[today()]) await enqueueSnapshot();
      meta.sheets.lockV = 1; await DB.put('meta', meta.sheets);
    }
  } catch (e) {
    $('status').textContent = 'This browser won’t let Bundle Book store data (' + (e?.message || e) + '). Private browsing can cause this.';
    return;
  }
  render(); setSync(); refreshRates();
  if (back?.ok) { toast('Google Drive connected'); Drive.whoami().catch(() => {}).finally(() => kick(200)); }
  else if (back?.error) toast(back.error === 'access_denied' ? 'Google sign-in was cancelled.' : 'Google sign-in failed (' + back.error + ').');
  else kick(1000);
})();
})();
