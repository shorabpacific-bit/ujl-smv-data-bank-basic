'use strict';
const $ = s => document.querySelector(s), $$ = s => document.querySelectorAll(s);
const h = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const HEAD = ['ID', 'SECTION', 'SUB SECTION', 'PROCESS NAME', 'MACHINE TYPE', 'SMV', 'TARGET', 'FREQUENCY', 'LENGTH RANGE', 'PROCESS DIAGRAM', 'GSD PROCESS CODE', 'BUYER', 'REMARKS', 'UPDATED ON'];
const KEYS = ['id', 'section', 'sub_section', 'process_name', 'machine_type', 'smv', 'target', 'frequency', 'length_range', 'process_diagram', 'gsd_code', 'buyer', 'remarks', 'updated_on'];
const COLS = [['id', 'ID', 'd-none d-md-table-cell'], ['section', 'Section', 'd-none d-lg-table-cell'], ['sub_section', 'Sub section', 'd-none d-xl-table-cell'], ['process_name', 'Process name'], ['machine_type', 'Machine'], ['smv', 'SMV'], ['target', 'Target/hr', 'd-none d-md-table-cell'], ['frequency', 'Freq', 'd-none d-xl-table-cell'], ['buyer', 'Buyer', 'd-none d-lg-table-cell'], ['updated_on', 'Updated', 'd-none d-xl-table-cell']];
const TABS = [['dash', 'Dashboard'], ['data', 'SMV Data'], ['users', 'Users', 1], ['audit', 'Audit Trail', 1], ['backup', 'Backup & Restore', 1]];
let me, view = 'dash', meta = {}, charts = [], timer, cache = [], total = 0;
const st = { q: '', section: '', machine_type: '', buyer: '', sort: 'id', dir: 'asc', page: 1, size: 25 };
const isAdmin = () => me.role === 'super_admin';
const qs = o => new URLSearchParams(Object.fromEntries(Object.entries(o).filter(([, v]) => v !== '' && v != null))).toString();
const P = () => ({ q: st.q, section: st.section, machine_type: st.machine_type, buyer: st.buyer, sort: st.sort, dir: st.dir, page: st.page, size: st.size });
const cell = (k, v) => v === '' || v == null ? '<span class="text-muted">&mdash;</span>' : k === 'smv' ? `<span class="chip">${h(v)}</span>` : k === 'section' || k === 'machine_type' ? `<span class="tag">${h(v)}</span>` : h(v);
const vids = s => { try { const a = Array.isArray(s) ? s : JSON.parse(s || '[]'); return Array.isArray(a) ? a : []; } catch { return []; } };
const vsrc = u => /^https?:\/\//i.test(u) ? u : 'videos/' + encodeURIComponent(u);
const furl = async id => window.LOCAL_API ? URL.createObjectURL(await api('/files/' + id)) : '/api/files/' + id;
const fsize = n => n > 1e6 ? (n / 1e6).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1e3)) + ' KB';
const openPdf = async f => { try { window.open(await furl(f.id), '_blank'); } catch (x) { toast(x.message, 'danger'); } };
async function vplayer(u) {
  if (typeof u === 'object') return `<video class="w-100 rounded bg-dark" style="max-height:62vh" controls src="${h(await furl(u.id))}"></video>`;
  const fr = src => `<iframe class="w-100 rounded" style="aspect-ratio:16/9;border:0" src="${src}" allow="fullscreen" allowfullscreen></iframe>`;
  let m = u.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/))([\w-]{11})/i);
  if (m) return fr('https://www.youtube-nocookie.com/embed/' + m[1]);
  if ((m = u.match(/drive\.google\.com\/file\/d\/([\w-]+)/i))) return fr(`https://drive.google.com/file/d/${m[1]}/preview`);
  if (/\.(mp4|webm|ogg|mov|m4v)(\?.*)?$/i.test(u)) return `<video class="w-100 rounded bg-dark" style="max-height:62vh" controls src="${h(vsrc(u))}"></video>`;
  return `<div class="p-4 text-center border rounded"><p class="mb-2">This link cannot play inside the app.</p><a class="btn btn-primary btn-sm" target="_blank" rel="noopener" href="${h(u)}">Open video in a new tab</a></div>`;
}
function player(r) {
  const L = vids(r.videos), P = vids(r.pdfs), m = document.createElement('div'); m.className = 'modal fade';
  m.innerHTML = `<div class="modal-dialog modal-lg modal-dialog-centered"><div class="modal-content"><div class="modal-header py-2"><h6 class="modal-title">${h(r.process_name)}</h6><button type="button" class="btn-close" data-bs-dismiss="modal"></button></div><div class="modal-body">${L.length ? `<div class="d-flex flex-wrap gap-1 mb-3">${L.map((u, i) => `<button class="btn btn-sm" data-i="${i}">Video ${i + 1}</button>`).join('')}</div><div id="vp"></div>` : ''}${P.length ? `<div class="${L.length ? 'mt-3 pt-3 border-top' : ''}"><div class="card-title">GSD analysis PDF</div><div class="d-flex flex-wrap gap-1">${P.map((f, i) => `<button class="btn btn-sm btn-outline-danger" data-pf="${i}">PDF ${i + 1}: ${h(f.name)}</button>`).join('')}</div></div>` : ''}</div></div></div>`;
  document.body.append(m); const bm = new bootstrap.Modal(m); bm.show(); m.addEventListener('hidden.bs.modal', () => m.remove());
  const play = async i => { m.querySelectorAll('[data-i]').forEach(b => b.className = `btn btn-sm ${+b.dataset.i === i ? 'btn-primary' : 'btn-outline-primary'}`); m.querySelector('#vp').innerHTML = await vplayer(L[i]); };
  m.querySelectorAll('[data-i]').forEach(b => b.onclick = () => play(+b.dataset.i)); m.querySelectorAll('[data-pf]').forEach(b => b.onclick = () => openPdf(P[+b.dataset.pf]));
  if (L.length) play(0);
}
const toast = (msg, type = 'success') => { const d = document.createElement('div'); d.className = `alert alert-${type} shadow py-2 mb-2`; d.textContent = msg; $('#toasts').append(d); setTimeout(() => d.remove(), 5000); };

async function api(u, o = {}) {
  const r = await fetch('/api' + u, { method: o.method || 'GET', headers: { 'X-Requested-With': 'smv', ...(o.json ? { 'Content-Type': 'application/json' } : {}) }, body: o.json ? JSON.stringify(o.json) : o.body });
  if (!r.ok) { const e = await r.json().catch(() => ({})); if (r.status === 401 && me) showAuth(); throw new Error(e.error || r.statusText); }
  return (r.headers.get('content-type') || '').includes('json') ? r.json() : r.blob();
}

function showAuth() {
  me = null; clearInterval(timer);
  $('#app').innerHTML = `<div class="auth"><section class="auth-hero"><div class="logo mb-3" style="width:48px;height:48px;font-size:.95rem;border-radius:13px">SMV</div><h1>SMV Data Bank</h1><p class="lead mb-4">One central place for every Standard Minute Value in your garment factory.</p>
  <ul class="list-unstyled mb-0"><li>&#10003;&ensp;Search, filter and update SMVs in seconds</li><li>&#10003;&ensp;Live dashboard with buyer and machine summaries</li><li>&#10003;&ensp;Excel / CSV import and export</li><li>&#10003;&ensp;User roles, audit trail and backup</li></ul></section>
  <section class="auth-form"><div class="card" style="width:100%;max-width:400px"><div class="card-body p-4"><h5 class="mb-1">Welcome back</h5><p class="text-muted small mb-3">Log in or create an account to continue</p>
  <ul class="nav nav-pills mb-3"><li class="nav-item"><button class="nav-link active" data-bs-toggle="pill" data-bs-target="#li">Login</button></li><li class="nav-item"><button class="nav-link" data-bs-toggle="pill" data-bs-target="#su">Sign up</button></li></ul>
  <div class="tab-content">
  <form id="li" class="tab-pane fade show active"><input class="form-control mb-2" name="email" type="email" placeholder="Email" required><input class="form-control mb-3" name="password" type="password" placeholder="Password" required><button class="btn btn-primary w-100">Login</button></form>
  <form id="su" class="tab-pane fade"><input class="form-control mb-2" name="name" placeholder="Full name" required><input class="form-control mb-2" name="email" type="email" placeholder="Email" required><input class="form-control mb-3" name="password" type="password" minlength="8" placeholder="Password (8+ characters)" required><button class="btn btn-success w-100">Create account</button></form>
  </div></div></div></section></div>`;
  const val = f => Object.fromEntries(new FormData(f));
  $('#li').onsubmit = async e => { e.preventDefault(); try { me = await api('/login', { method: 'POST', json: val(e.target) }); boot(); } catch (x) { toast(x.message, 'danger'); } };
  $('#su').onsubmit = async e => { e.preventDefault(); try { await api('/register', { method: 'POST', json: val(e.target) }); toast('Account created - you can log in now'); e.target.reset(); bootstrap.Tab.getOrCreateInstance($('[data-bs-target="#li"]')).show(); } catch (x) { toast(x.message, 'danger'); } };
}

async function boot() {
  $('#app').innerHTML = `<nav class="navbar navbar-expand-md navbar-dark topbar"><div class="container-fluid" style="max-width:1500px"><a class="brand me-3"><span class="logo">SMV</span>SMV Data Bank</a>
  <button class="navbar-toggler" data-bs-toggle="collapse" data-bs-target="#nv"><span class="navbar-toggler-icon"></span></button>
  <div id="nv" class="collapse navbar-collapse"><div class="navbar-nav me-auto">${TABS.filter(t => !t[2] || isAdmin()).map(t => `<a href="#" class="nav-link" data-v="${t[0]}">${t[1]}</a>`).join('')}</div>
  <div class="d-flex align-items-center gap-2 mt-2 mt-md-0"><span class="avatar">${h((me.name.trim()[0] || '?').toUpperCase())}</span><span class="who">${h(me.name)}<br><small>${isAdmin() ? 'Super Admin' : 'Standard User'}</small></span><button class="btn btn-sm btn-light ms-2" id="out">Logout</button></div></div></div></nav><main class="container-fluid py-3 px-md-4" style="max-width:1500px" id="view"></main>`;
  $$('[data-v]').forEach(a => a.onclick = e => { e.preventDefault(); go(a.dataset.v); });
  $('#out').onclick = async () => { await api('/logout', { method: 'POST' }).catch(() => { }); showAuth(); };
  meta = await api('/meta').catch(() => ({}));
  clearInterval(timer); timer = setInterval(() => { if (!$('.modal.show') && ['dash', 'data'].includes(view)) go(view, true); }, 15000); // live refresh
  go('dash');
}
function go(v, quiet) {
  view = v; $$('[data-v]').forEach(a => a.classList.toggle('active', a.dataset.v === v)); bootstrap.Collapse.getInstance($('#nv'))?.hide();
  ({ dash, data: dataView, users, audit, backup })[v](quiet).catch(x => toast(x.message, 'danger'));
}

async function dash() {
  const d = await api('/dashboard'), k = d.kpi, lbl = x => x || 'Not specified', COL = ['#2563eb', '#10b981', '#f59e0b', '#8b5cf6', '#ef4444', '#64748b'];
  const kpi = (t, v, c) => `<div class="col-6 col-md-4 col-xl-2"><div class="kpi" style="--c:${c}"><div class="l">${t}</div><div class="v">${h(v ?? '-')}</div></div></div>`;
  const tbl = (hd, rows) => `<table class="table table-sm table-hover"><thead><tr>${hd.map(x => `<th>${x}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${r.map(c => `<td>${h(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
  const card = (t, body, cls) => `<div class="${cls}"><div class="card h-100"><div class="card-body p-3"><div class="card-title">${t}</div>${body}</div></div></div>`;
  $('#view').innerHTML = `<div class="mb-3"><h5 class="mb-0">Dashboard</h5><small class="text-muted">SMV overview &middot; refreshes automatically</small></div>
  <div class="row g-2 g-md-3 mb-3">${kpi('SMV records', k.total, '#2563eb')}${kpi('Average SMV', k.avg, '#10b981')}${kpi('Lowest SMV', k.min, '#06b6d4')}${kpi('Highest SMV', k.max, '#f59e0b')}${kpi('Machine types', k.machines, '#8b5cf6')}${kpi('Buyers', k.buyers, '#64748b')}</div>
  <div class="row g-2 g-md-3">${card('Records by section', '<div class="chart-box"><canvas id="c1"></canvas></div>', 'col-md-6 col-xl-3')}${card('Avg SMV by machine type', '<div class="chart-box"><canvas id="c2"></canvas></div>', 'col-md-6 col-xl-5')}${card('Buyer summary', `<div class="scroll-sm">${tbl(['Buyer', 'Records', 'Avg SMV'], d.byBuyer.map(b => [lbl(b.k), b.n, b.avg]))}</div>`, 'col-xl-4')}
  ${card('Top 5 highest SMV processes', tbl(['ID', 'Process', 'Machine', 'SMV'], d.top.map(t => [t.id, t.process_name, t.machine_type, t.smv])), 'col-12')}</div>`;
  charts.forEach(c => c.destroy());
  const tick = { color: '#64748b', font: { size: 11 } }, grid = { color: '#eef2f7' };
  charts = [new Chart($('#c1'), { type: 'doughnut', data: { labels: d.bySection.map(x => lbl(x.k)), datasets: [{ data: d.bySection.map(x => x.n), backgroundColor: COL, borderWidth: 2 }] }, options: { maintainAspectRatio: false, cutout: '62%', plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, boxHeight: 10, usePointStyle: true, font: { size: 11 } } } } } }),
  new Chart($('#c2'), { type: 'bar', data: { labels: d.byMachine.map(x => lbl(x.k)), datasets: [{ label: 'Avg SMV', data: d.byMachine.map(x => x.avg), backgroundColor: '#2563eb', borderRadius: 4, maxBarThickness: 14 }] }, options: { indexAxis: 'y', maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { ticks: tick, grid }, y: { ticks: tick, grid: { display: false } } } } })];
}

async function dataView(quiet) {
  if (!quiet || !$('#rows')) {
    const opt = (k, label) => `<select class="form-select form-select-sm" data-f="${k}"><option value="">${label}</option>${(meta[k] || []).map(v => `<option${st[k] === v ? ' selected' : ''}>${h(v)}</option>`).join('')}</select>`;
    $('#view').innerHTML = `<div class="card shadow-sm"><div class="card-body">
    <div class="row g-2 mb-3"><div class="col-12 col-md-4"><input id="q" class="form-control form-control-sm" placeholder="Search process, GSD code, remarks, ID..." value="${h(st.q)}"></div>
    <div class="col-6 col-md-2">${opt('section', 'All sections')}</div><div class="col-6 col-md-2">${opt('machine_type', 'All machines')}</div><div class="col-6 col-md-2">${opt('buyer', 'All buyers')}</div>
    <div class="col-6 col-md-2"><button class="btn btn-sm btn-outline-secondary w-100" id="clr">Clear filters</button></div></div>
    <div class="d-flex flex-wrap gap-2 mb-3"><button class="btn btn-sm btn-primary" id="add">+ Add SMV</button>
    ${isAdmin() ? '<button class="btn btn-sm btn-outline-primary" id="imp">Import Excel/CSV</button><input type="file" id="file" accept=".xlsx,.xls,.csv" hidden>' : ''}
    <button class="btn btn-sm btn-outline-success" id="xx">Export Excel</button><button class="btn btn-sm btn-outline-success" id="xc">Export CSV</button>
    <select id="size" class="form-select form-select-sm ms-auto" style="width:auto">${[10, 25, 50, 100].map(n => `<option${st.size === n ? ' selected' : ''}>${n}</option>`).join('')}</select></div>
    <div class="table-responsive"><table class="table table-sm table-hover align-middle"><thead class="table-light"><tr>${COLS.map(c => `<th data-s="${c[0]}" class="${c[2] || ''}" style="cursor:pointer;white-space:nowrap"></th>`).join('')}<th></th></tr></thead><tbody id="rows"></tbody></table></div>
    <div class="d-flex justify-content-between align-items-center"><small id="info" class="text-muted"></small><div class="btn-group btn-group-sm"><button class="btn btn-outline-secondary" id="pv">Prev</button><button class="btn btn-outline-secondary" id="nx">Next</button></div></div></div></div>`;
    let t; $('#q').oninput = e => { clearTimeout(t); t = setTimeout(() => { st.q = e.target.value.trim(); st.page = 1; load(); }, 300); };
    $$('[data-f]').forEach(s => s.onchange = () => { st[s.dataset.f] = s.value; st.page = 1; load(); });
    $('#clr').onclick = () => { Object.assign(st, { q: '', section: '', machine_type: '', buyer: '', page: 1 }); dataView(); };
    $('#size').onchange = e => { st.size = +e.target.value; st.page = 1; load(); };
    $$('th[data-s]').forEach(th => th.onclick = () => { st.dir = st.sort === th.dataset.s && st.dir === 'asc' ? 'desc' : 'asc'; st.sort = th.dataset.s; load(); });
    $('#pv').onclick = () => { if (st.page > 1) { st.page--; load(); } };
    $('#nx').onclick = () => { if (st.page * st.size < total) { st.page++; load(); } };
    $('#add').onclick = () => form(); $('#xx').onclick = () => exportFile('xlsx'); $('#xc').onclick = () => exportFile('csv');
    if (isAdmin()) { $('#imp').onclick = () => $('#file').click(); $('#file').onchange = importFile; }
  }
  await load();
}

async function load() {
  const d = await api('/smv?' + qs(P())); cache = d.rows; total = d.total;
  if (!cache.length && st.page > 1) { st.page--; return load(); }
  $$('th[data-s]').forEach(th => { const c = COLS.find(x => x[0] === th.dataset.s); th.textContent = c[1] + (st.sort === c[0] ? (st.dir === 'asc' ? ' \u25B2' : ' \u25BC') : ''); });
  $('#rows').innerHTML = cache.map(r => `<tr>${COLS.map(c => `<td class="${c[2] || ''}">${cell(c[0], r[c[0]])}</td>`).join('')}<td class="text-nowrap text-end">${vids(r.videos).length ? `<button class="btn btn-sm btn-outline-secondary" data-pv="${r.id}">&#9654; ${vids(r.videos).length}</button> ` : ''}${vids(r.pdfs).length ? `<button class="btn btn-sm btn-outline-secondary" data-pd="${r.id}">PDF</button> ` : ''}<button class="btn btn-sm btn-outline-primary" data-e="${r.id}">Edit</button>${isAdmin() ? ` <button class="btn btn-sm btn-outline-danger" data-x="${r.id}">Delete</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="11" class="text-center text-muted py-4">No records found</td></tr>';
  $('#info').textContent = total ? `Showing ${(st.page - 1) * st.size + 1}-${Math.min(st.page * st.size, total)} of ${total}` : '0 records';
  $$('[data-e]').forEach(b => b.onclick = () => form(cache.find(r => r.id == b.dataset.e)));
  $$('[data-pv]').forEach(b => b.onclick = () => player(cache.find(r => r.id == b.dataset.pv)));
  $$('[data-pd]').forEach(b => b.onclick = () => { const r = cache.find(x => x.id == b.dataset.pd), P = vids(r.pdfs); P.length === 1 ? openPdf(P[0]) : player(r); });
  $$('[data-x]').forEach(b => b.onclick = async () => {
    if (!confirm('Delete record #' + b.dataset.x + '? This is recorded in the audit trail.')) return;
    try { await api('/smv/' + b.dataset.x, { method: 'DELETE' }); toast('Record deleted'); meta = await api('/meta'); load(); } catch (x) { toast(x.message, 'danger'); }
  });
}

function form(r = {}) {
  const f = (k, label, extra = '', list) => `<div class="col-md-6"><label class="form-label small mb-1">${label}</label><input class="form-control form-control-sm" name="${k}" value="${h(r[k])}" ${extra}${list ? ` list="dl-${k}"` : ''}>${list ? `<datalist id="dl-${k}">${(meta[k] || []).map(v => `<option value="${h(v)}">`).join('')}</datalist>` : ''}</div>`;
  const m = document.createElement('div'); m.className = 'modal fade';
  m.innerHTML = `<div class="modal-dialog modal-lg modal-dialog-scrollable"><form class="modal-content"><div class="modal-header"><h5 class="modal-title">${r.id ? 'Edit SMV #' + r.id : 'Add SMV record'}</h5><button type="button" class="btn-close" data-bs-dismiss="modal"></button></div>
  <div class="modal-body"><div class="row g-2">${f('section', 'Section', '', 1)}${f('sub_section', 'Sub section', '', 1)}${f('process_name', 'Process name *', 'required')}${f('machine_type', 'Machine type', '', 1)}
  ${f('smv', 'SMV (minutes) *', 'type="number" step="0.001" min="0.001" max="999" required')}<div class="col-md-6"><label class="form-label small mb-1">Target / hour (60 &divide; SMV)</label><input id="tg" class="form-control form-control-sm" readonly></div>
  ${f('frequency', 'Frequency', 'type="number" step="1" min="1"')}${f('length_range', 'Length range')}${f('gsd_code', 'GSD process code')}${f('buyer', 'Buyer', '', 1)}
  <div class="col-12"><label class="form-label small mb-1">Process diagram (link or note)</label><input class="form-control form-control-sm" name="process_diagram" value="${h(r.process_diagram)}"></div>
  <div class="col-12"><label class="form-label small mb-1">Remarks</label><textarea class="form-control form-control-sm" name="remarks" rows="2">${h(r.remarks)}</textarea></div>
  <div class="col-12"><label class="form-label small mb-1">Videos <span class="text-muted">(upload from your PC, or paste a link)</span></label><div id="vl"></div><div class="d-flex flex-wrap gap-1 mt-1"><button type="button" class="btn btn-sm btn-outline-primary" id="vu">Upload video from PC</button><button type="button" class="btn btn-sm btn-outline-secondary" id="va">+ Add video link</button></div><input type="file" id="vf" accept=".mp4,.m4v,.webm,.ogg,.mov,video/*" multiple hidden></div>
  <div class="col-12"><label class="form-label small mb-1">GSD analysis PDF <span class="text-muted">(upload from your PC)</span></label><div id="dl"></div><button type="button" class="btn btn-sm btn-outline-primary mt-1" id="du">Upload PDF from PC</button><input type="file" id="df" accept=".pdf,application/pdf" multiple hidden></div></div><div class="text-danger small mt-2" id="err"></div></div>
  <div class="modal-footer"><button type="button" class="btn btn-secondary btn-sm" data-bs-dismiss="modal">Cancel</button><button class="btn btn-primary btn-sm">Save</button></div></form></div>`;
  document.body.append(m); const bm = new bootstrap.Modal(m); bm.show(); m.addEventListener('hidden.bs.modal', () => m.remove());
  const sv = m.querySelector('[name=smv]'), tg = () => m.querySelector('#tg').value = +sv.value > 0 ? (60 / sv.value).toFixed(1) : ''; sv.oninput = tg; tg();
  const V = vids(r.videos), D = vids(r.pdfs), vl = m.querySelector('#vl'), dl = m.querySelector('#dl');
  const chip = (x, i, k, label) => `<div class="input-group input-group-sm mb-1"><span class="input-group-text" style="min-width:74px">${label}</span>${typeof x === 'string' ? `<input class="form-control" data-vi="${i}" value="${h(x)}" placeholder="https://youtu.be/...  or  file-name.mp4">` : `<span class="form-control text-truncate">${h(x.name)} <small class="text-muted">${x.file ? fsize(x.file.size) : ''}</small></span>`}<button type="button" class="btn btn-outline-danger" data-${k}d="${i}">&times;</button></div>`;
  const rv = () => {
    vl.innerHTML = V.map((x, i) => chip(x, i, 'v', 'Video ' + (i + 1))).join('') || '<div class="text-muted small mb-1">No videos yet</div>';
    dl.innerHTML = D.map((x, i) => chip(x, i, 'd', 'PDF ' + (i + 1))).join('') || '<div class="text-muted small mb-1">No PDF yet</div>';
    vl.querySelectorAll('[data-vi]').forEach(x => x.oninput = () => V[+x.dataset.vi] = x.value);
    vl.querySelectorAll('[data-vd]').forEach(x => x.onclick = () => { V.splice(+x.dataset.vd, 1); rv(); });
    dl.querySelectorAll('[data-dd]').forEach(x => x.onclick = () => { D.splice(+x.dataset.dd, 1); rv(); });
  };
  const pick = (id, list) => m.querySelector(id).onchange = e => { for (const f of e.target.files) { if (f.size > 1e9) toast(`${f.name} is larger than 1 GB`, 'danger'); else list.push({ file: f, name: f.name }); } e.target.value = ''; rv(); };
  m.querySelector('#vu').onclick = () => m.querySelector('#vf').click(); m.querySelector('#du').onclick = () => m.querySelector('#df').click(); pick('#vf', V); pick('#df', D);
  m.querySelector('#va').onclick = () => { V.push(''); rv(); [...vl.querySelectorAll('[data-vi]')].pop()?.focus(); }; rv();
  m.querySelector('form').onsubmit = async e => {
    e.preventDefault(); const btn = m.querySelector('.modal-footer .btn-primary'), t = btn.textContent; btn.disabled = true;
    const up = async list => { for (let i = 0; i < list.length; i++) if (list[i].file) { btn.textContent = 'Uploading ' + list[i].name.slice(0, 18) + '...'; const u = await api('/files?name=' + encodeURIComponent(list[i].name), { method: 'POST', body: list[i].file }); list[i] = { id: u.id, name: u.name }; } return list.map(x => typeof x === 'string' ? x.trim() : x).filter(Boolean); };
    try {
      const videos = JSON.stringify(await up(V)), pdfs = JSON.stringify(await up(D));
      await api(r.id ? '/smv/' + r.id : '/smv', { method: r.id ? 'PUT' : 'POST', json: { ...Object.fromEntries(new FormData(e.target)), videos, pdfs } });
      bm.hide(); toast('Record saved'); meta = await api('/meta'); load();
    } catch (x) { m.querySelector('#err').textContent = x.message; btn.disabled = false; btn.textContent = t; }
  };
}

async function exportFile(t) {
  const d = await api('/smv?' + qs({ ...P(), page: 1, size: 'all' })), wb = XLSX.utils.book_new();
  const mx = Math.max(0, ...d.rows.map(r => vids(r.videos).length)), pad = v => Array.from({ length: mx }, (_, i) => v[i] || '');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([[...HEAD, ...pad([]).map((_, i) => 'VIDEO ' + (i + 1))], ...d.rows.map(r => [...KEYS.map(k => r[k] ?? ''), ...pad(vids(r.videos).map(x => typeof x === 'string' ? x : x.name))])]), 'DATA BANK');
  XLSX.writeFile(wb, `SMV_DATA_BANK_${new Date().toISOString().slice(0, 10)}.${t}`, { bookType: t });
}

async function importFile(e) {
  const f = e.target.files[0]; e.target.value = ''; if (!f) return;
  const wb = XLSX.read(await f.arrayBuffer(), { cellDates: true }), a = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '' });
  const hi = a.findIndex(r => r.some(c => String(c).trim().toUpperCase() === 'PROCESS NAME')); if (hi < 0) return toast('Header row with "PROCESS NAME" not found', 'danger');
  const idx = {}; a[hi].forEach((c, i) => { const k = KEYS[HEAD.indexOf(String(c).trim().toUpperCase())]; if (k && k !== 'id' && k !== 'target') idx[k] = i; });
  const vc = []; a[hi].forEach((c, i) => { if (/^VIDEO\s*\d+$/i.test(String(c).trim())) vc.push(i); });
  let sec = '', sub = '';
  const rows = a.slice(hi + 1).filter(r => r[idx.process_name] !== '' && !isNaN(parseFloat(r[idx.smv]))).map(r => {
    const o = {}; for (const k in idx) o[k] = r[idx[k]] instanceof Date ? r[idx[k]].toISOString().slice(0, 10) : r[idx[k]];
    if (o.section) { sec = o.section; sub = o.sub_section || ''; } else if (o.sub_section) sub = o.sub_section; // fill-down like the Excel sheet
    return { ...o, section: sec, sub_section: sub, videos: JSON.stringify(vc.map(i => String(r[i]).trim()).filter(Boolean)) };
  });
  if (!rows.length) return toast('No valid rows found in the file', 'danger');
  const mode = (prompt(`Import ${rows.length} rows.\nType APPEND to add them, or REPLACE to delete all existing records first:`, 'APPEND') || '').toUpperCase();
  if (!['APPEND', 'REPLACE'].includes(mode)) return;
  try { const r = await api('/smv/import', { method: 'POST', json: { rows, mode: mode.toLowerCase() } }); toast(`Imported ${r.imported}, rejected ${r.rejected}${r.errors[0] ? ' - ' + r.errors[0] : ''}`, r.rejected ? 'warning' : 'success'); meta = await api('/meta'); dataView(); }
  catch (x) { toast(x.message, 'danger'); }
}

async function users() {
  const d = await api('/users');
  $('#view').innerHTML = `<div class="card shadow-sm"><div class="card-body"><h6>User management</h6><div class="table-responsive"><table class="table table-sm align-middle"><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th>Created</th><th></th></tr></thead><tbody>${d.map(u => `<tr><td>${h(u.name)}</td><td>${h(u.email)}</td><td>${u.id === me.id ? 'Super Admin (you)' : `<select class="form-select form-select-sm w-auto" data-r="${u.id}"><option value="user"${u.role === 'user' ? ' selected' : ''}>Standard User</option><option value="super_admin"${u.role === 'super_admin' ? ' selected' : ''}>Super Admin</option></select>`}</td><td><span class="badge text-bg-${u.active ? 'success' : 'secondary'}">${u.active ? 'Active' : 'Disabled'}</span></td><td>${h(u.created_at)}</td><td class="text-nowrap">${u.id === me.id ? '' : `<button class="btn btn-sm btn-outline-secondary" data-a="${u.id}" data-on="${u.active}">${u.active ? 'Disable' : 'Enable'}</button> <button class="btn btn-sm btn-outline-warning" data-p="${u.id}">Reset password</button> <button class="btn btn-sm btn-outline-danger" data-d="${u.id}">Delete</button>`}</td></tr>`).join('')}</tbody></table></div></div></div>`;
  const act = async (id, o, msg) => { try { await api('/users/' + id, o); toast(msg); users(); } catch (x) { toast(x.message, 'danger'); } };
  $$('[data-r]').forEach(s => s.onchange = () => act(s.dataset.r, { method: 'PUT', json: { role: s.value } }, 'Role updated'));
  $$('[data-a]').forEach(b => b.onclick = () => act(b.dataset.a, { method: 'PUT', json: { active: b.dataset.on !== '1' } }, 'Status updated'));
  $$('[data-p]').forEach(b => b.onclick = () => { const p = prompt('New password (8+ characters):'); if (p) act(b.dataset.p, { method: 'PUT', json: { password: p } }, 'Password reset'); });
  $$('[data-d]').forEach(b => b.onclick = () => confirm('Delete this user?') && act(b.dataset.d, { method: 'DELETE' }, 'User deleted'));
}

async function audit() {
  const d = await api('/audit'), c = { CREATE: 'success', UPDATE: 'primary', DELETE: 'danger', LOGIN: 'secondary', IMPORT: 'info', RESTORE: 'warning', BACKUP: 'info' };
  $('#view').innerHTML = `<div class="card shadow-sm"><div class="card-body"><h6>Audit trail (latest 500 events, UTC)</h6><div class="table-responsive"><table class="table table-sm"><thead><tr><th>Time</th><th>User</th><th>Action</th><th>Record</th><th>Details</th></tr></thead><tbody>${d.map(a => `<tr><td class="text-nowrap">${h(a.ts)}</td><td>${h(a.user)}</td><td><span class="badge text-bg-${c[a.action] || 'dark'}">${h(a.action)}</span></td><td>${h(a.record)}</td><td class="small">${h(a.detail)}</td></tr>`).join('')}</tbody></table></div></div></div>`;
}

async function backup() {
  $('#view').innerHTML = `<div class="row g-3"><div class="col-md-6"><div class="card shadow-sm"><div class="card-body"><h6>Backup</h6><p class="small text-muted">Downloads a full copy of the database: SMV records, users and audit trail.</p><button class="btn btn-primary btn-sm" id="bk">Download backup</button></div></div></div>
  <div class="col-md-6"><div class="card shadow-sm border-warning"><div class="card-body"><h6>Restore</h6><p class="small text-muted">Replaces ALL current data with the chosen backup. The previous database is kept as data/smv.db.pre-restore.</p><input type="file" id="rf" accept=".db" class="form-control form-control-sm mb-2"><button class="btn btn-warning btn-sm" id="rs">Restore backup</button></div></div></div></div>`;
  $('#bk').onclick = async () => { try { const a = document.createElement('a'); a.href = URL.createObjectURL(await api('/backup')); a.download = `smv-backup-${new Date().toISOString().slice(0, 10)}.db`; a.click(); } catch (x) { toast(x.message, 'danger'); } };
  $('#rs').onclick = async () => {
    const f = $('#rf').files[0]; if (!f) return toast('Choose a backup file first', 'warning'); if (!confirm('Replace ALL current data with this backup?')) return;
    try { await api('/restore', { method: 'POST', body: f }); toast('Database restored - please log in again'); showAuth(); } catch (x) { toast(x.message, 'danger'); }
  };
}

api('/me').then(u => { me = u; boot(); }).catch(showAuth);
