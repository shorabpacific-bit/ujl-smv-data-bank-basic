'use strict';
// SMV Data Bank - zero-dependency server (Node.js 22.13+). Run: node server.js
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');
const PORT = 3000, DBF = path.join(__dirname, 'data', 'smv.db'), PUB = path.join(__dirname, 'public') + path.sep;
const F = ['section', 'sub_section', 'process_name', 'machine_type', 'smv', 'frequency', 'length_range', 'process_diagram', 'gsd_code', 'buyer', 'remarks', 'updated_on', 'videos', 'pdfs'];
const today = () => new Date().toISOString().slice(0, 10);
const hash = (p, s = crypto.randomBytes(16).toString('hex')) => s + ':' + crypto.scryptSync(p, s, 64).toString('hex');
const verify = (p, h) => { const [s, x] = h.split(':'); return crypto.timingSafeEqual(Buffer.from(x), Buffer.from(hash(p, s).split(':')[1])); };
const sessions = new Map(), tries = new Map();
let db;

const insert = (r, by) => db.prepare(`INSERT INTO smv(${F.join()},target,updated_by) VALUES(${F.map(() => '?').join()},?,?)`)
  .run(...F.map(k => r[k] ?? ''), +(60 / r.smv).toFixed(1), by).lastInsertRowid;
const audit = (user, action, record, detail) => db.prepare('INSERT INTO audit(user,action,record,detail) VALUES(?,?,?,?)').run(user, action, String(record ?? ''), String(detail ?? ''));

const FDIR = path.join(__dirname, 'data', 'files'), MAXF = 1e9, FT = { '.pdf': 'application/pdf', '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.webm': 'video/webm', '.ogg': 'video/ogg', '.mov': 'video/quicktime' };
const vl = s => { try { const a = JSON.parse(s || '[]'); return Array.isArray(a) ? a : []; } catch { return []; } };
const fileIds = rec => [...vl(rec.videos), ...vl(rec.pdfs)].filter(x => x && x.id).map(x => x.id);
const dropFiles = ids => ids.forEach(id => { db.prepare('DELETE FROM files WHERE id=?').run(id); fs.unlink(path.join(FDIR, id), () => { }); });
function open() {
  fs.mkdirSync(FDIR, { recursive: true });
  db = new DatabaseSync(DBF);
  db.exec(`CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY,name TEXT,email TEXT UNIQUE,pass TEXT,role TEXT DEFAULT 'user',active INTEGER DEFAULT 1,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
  CREATE TABLE IF NOT EXISTS smv(id INTEGER PRIMARY KEY,section TEXT,sub_section TEXT,process_name TEXT NOT NULL,machine_type TEXT,smv REAL NOT NULL,target REAL,frequency INTEGER DEFAULT 1,length_range TEXT,process_diagram TEXT,gsd_code TEXT,buyer TEXT,remarks TEXT,updated_on TEXT,updated_by TEXT);
  CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY,ts TEXT DEFAULT CURRENT_TIMESTAMP,user TEXT,action TEXT,record TEXT,detail TEXT);
  CREATE TABLE IF NOT EXISTS files(id TEXT PRIMARY KEY,name TEXT,type TEXT,size INTEGER,uploaded_by TEXT,ts TEXT DEFAULT CURRENT_TIMESTAMP);`);
  try { db.exec("ALTER TABLE smv ADD COLUMN videos TEXT DEFAULT '[]'"); } catch { }
  try { db.exec("ALTER TABLE smv ADD COLUMN pdfs TEXT DEFAULT '[]'"); } catch { }
  if (!db.prepare('SELECT 1 FROM users').get()) {
    const pw = process.env.ADMIN_PASSWORD || 'Admin@12345';
    db.prepare("INSERT INTO users(name,email,pass,role) VALUES('Super Admin','admin@smv.local',?,'super_admin')").run(hash(pw));
    console.log('Seeded Super Admin -> admin@smv.local /', process.env.ADMIN_PASSWORD ? '(ADMIN_PASSWORD)' : pw, '(change it after first login)');
  }
  const sf = path.join(__dirname, 'data', 'seed.json');
  if (!db.prepare('SELECT 1 FROM smv').get() && fs.existsSync(sf)) {
    db.exec('BEGIN'); for (const r of JSON.parse(fs.readFileSync(sf))) insert(r, 'seed'); db.exec('COMMIT');
    console.log('Seeded SMV records from data/seed.json');
  }
}

const VOK = u => /^https?:\/\/[^\s"'<>]{4,490}$/i.test(u) || /^[\w\-. ()]{1,120}\.(mp4|webm|ogg|mov|m4v)$/i.test(u);
const FID = /^[a-f0-9]{32}$/;
const vlist = (raw, textOk) => { if (Array.isArray(raw)) raw = JSON.stringify(raw); const a = JSON.parse(raw || '[]'); if (!Array.isArray(a) || a.length > 20) throw 0;
  return JSON.stringify(a.map(x => { if (typeof x === 'string' && textOk && VOK(x.trim())) return x.trim(); if (x && typeof x === 'object' && FID.test(x.id) && typeof x.name === 'string' && x.name.length <= 120) return { id: x.id, name: x.name }; throw 0; })); };
function clean(b) {
  const r = {}, e = [];
  for (const k of F) r[k] = typeof b[k] === 'string' ? b[k].trim() : (b[k] ?? '');
  if (!r.process_name) e.push('Process name is required');
  r.smv = Number(r.smv); if (!(r.smv > 0 && r.smv < 1000)) e.push('SMV must be a number above 0 and below 1000');
  r.frequency = r.frequency === '' ? 1 : Number(r.frequency); if (!Number.isInteger(r.frequency) || r.frequency < 1) e.push('Frequency must be a whole number of 1 or more');
  if (r.updated_on && !/^\d{4}-\d{2}-\d{2}$/.test(r.updated_on)) e.push('Updated on must be YYYY-MM-DD');
  try { r.videos = vlist(r.videos, true); } catch { e.push('Each video must be an http(s) link, a file name ending in .mp4/.webm/.ogg/.mov/.m4v, or an uploaded file'); r.videos = '[]'; }
  try { r.pdfs = vlist(r.pdfs, false); } catch { e.push('Invalid GSD PDF list'); r.pdfs = '[]'; }
  for (const k of F) if (k !== 'videos' && k !== 'pdfs' && typeof r[k] === 'string' && r[k].length > 500) e.push(k + ' is too long');
  return { r, e };
}

const json = (res, code, o) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
const body = (req, max = 50e6) => new Promise((ok, no) => {
  const b = []; let n = 0;
  req.on('data', c => { n += c.length; if (n > max) { no(new Error('Request too large')); req.destroy(); } else b.push(c); });
  req.on('end', () => ok(Buffer.concat(b))); req.on('error', no);
});
const jbody = async (req, max) => JSON.parse((await body(req, max)).toString() || '{}');

function sendFile(req, res, f, type, extra = {}) {
  const size = fs.statSync(f).size, m = /bytes=(\d*)-(\d*)/.exec(req.headers.range || '');
  if (m && (m[1] || m[2])) {
    const s = m[1] ? +m[1] : size - +m[2], e = m[1] && m[2] ? Math.min(+m[2], size - 1) : size - 1;
    if (s > e || s >= size) { res.writeHead(416, { 'Content-Range': `bytes */${size}` }); return res.end(); }
    res.writeHead(206, { ...extra, 'Content-Type': type, 'Content-Range': `bytes ${s}-${e}/${size}`, 'Accept-Ranges': 'bytes', 'Content-Length': e - s + 1 }); return fs.createReadStream(f, { start: s, end: e }).pipe(res);
  }
  res.writeHead(200, { ...extra, 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Content-Length': size }); fs.createReadStream(f).pipe(res);
}
function serve(req, p, res) {
  const f = path.join(PUB, p === '/' ? 'index.html' : p);
  if (!f.startsWith(PUB) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('Not found'); }
  sendFile(req, res, f, { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.webm': 'video/webm', '.ogg': 'video/ogg', '.mov': 'video/quicktime', '.txt': 'text/plain' }[path.extname(f).toLowerCase()] || 'application/octet-stream');
}

open();
http.createServer(async (req, res) => {
  try {
    const u = new URL(req.url, 'http://x'), p = u.pathname, m = req.method;
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; frame-src https://www.youtube-nocookie.com https://drive.google.com; media-src 'self' https:;");
    if (!p.startsWith('/api/')) return serve(req, p, res);
    if (m !== 'GET' && req.headers['x-requested-with'] !== 'smv') return json(res, 403, { error: 'Bad request' });
    let mm;
    if (m === 'POST' && p === '/api/register') {
      const b = await jbody(req, 1e5), name = String(b.name || '').trim(), email = String(b.email || '').trim().toLowerCase(), pw = String(b.password || '');
      if (!name || !/^\S+@\S+\.\S+$/.test(email) || pw.length < 8) return json(res, 400, { error: 'Name, a valid email and a password of 8+ characters are required' });
      try { audit(email, 'REGISTER', db.prepare('INSERT INTO users(name,email,pass) VALUES(?,?,?)').run(name, email, hash(pw)).lastInsertRowid, name); }
      catch { return json(res, 409, { error: 'This email is already registered' }); }
      return json(res, 201, { ok: true });
    }
    if (m === 'POST' && p === '/api/login') {
      const b = await jbody(req, 1e5), email = String(b.email || '').trim().toLowerCase(), key = req.socket.remoteAddress + email, t = tries.get(key) || { n: 0, until: 0 };
      if (t.until > Date.now()) return json(res, 429, { error: 'Too many failed attempts. Try again in 10 minutes.' });
      const x = db.prepare('SELECT * FROM users WHERE email=?').get(email);
      if (!x || !x.active || !verify(String(b.password || ''), x.pass)) { if (++t.n >= 5) { t.until = Date.now() + 6e5; t.n = 0; } tries.set(key, t); return json(res, 401, { error: 'Invalid email or password' }); }
      tries.delete(key); const sid = crypto.randomBytes(32).toString('hex'); sessions.set(sid, { uid: x.id, exp: Date.now() + 8 * 36e5 });
      res.setHeader('Set-Cookie', `sid=${sid}; HttpOnly; SameSite=Lax; Path=/; Max-Age=28800`); audit(email, 'LOGIN', x.id);
      return json(res, 200, { id: x.id, name: x.name, email, role: x.role, token: sid });
    }
    const bearer = (req.headers.authorization || '').match(/^Bearer\s+([0-9a-f]+)/i)?.[1];
    const sid = bearer || (req.headers.cookie || '').match(/(?:^|;\s*)sid=([0-9a-f]+)/)?.[1], s = sessions.get(sid);
    if (m === 'POST' && p === '/api/logout') { sessions.delete(sid); res.setHeader('Set-Cookie', 'sid=; Max-Age=0; Path=/'); return json(res, 200, { ok: true }); }
    const me = s && s.exp > Date.now() ? db.prepare('SELECT id,name,email,role,active FROM users WHERE id=?').get(s.uid) : null;
    if (!me || !me.active) return json(res, 401, { error: 'Please log in' });
    const admin = me.role === 'super_admin', deny = () => (json(res, 403, { error: 'Super Admin access required' }), true);

    if (p === '/api/me') return json(res, 200, me);
    if (m === 'POST' && p === '/api/files') {
      const name = (u.searchParams.get('name') || '').replace(/[\\/\0]/g, '_').slice(0, 120), type = FT[path.extname(name).toLowerCase()];
      if (!name || !type) return json(res, 400, { error: 'Allowed files: PDF, MP4, WebM, OGG, MOV, M4V' });
      const id = crypto.randomBytes(16).toString('hex'), tmp = path.join(FDIR, id + '.part'), w = fs.createWriteStream(tmp); let n = 0, werr = null; w.on('error', er => { werr = er; });
      try {
        for await (const c of req) { if (werr) throw werr; n += c.length; if (n > MAXF) throw new Error('big'); if (!w.write(c)) await new Promise(r => { w.once('drain', r); w.once('error', r); }); }
        if (werr) throw werr; if (!n) throw new Error('empty'); await new Promise((ok, no) => { w.once('error', no); w.end(ok); });
      } catch (err) { w.destroy(); fs.unlink(tmp, () => { }); return json(res, err.message === 'big' ? 413 : 400, { error: err.message === 'big' ? 'File is larger than 1 GB' : 'Upload failed (empty file?)' }); }
      fs.renameSync(tmp, path.join(FDIR, id)); db.prepare('INSERT INTO files(id,name,type,size,uploaded_by) VALUES(?,?,?,?,?)').run(id, name, type, n, me.email); audit(me.email, 'UPLOAD', id, name);
      return json(res, 201, { id, name, type, size: n });
    }
    if (m === 'GET' && (mm = p.match(/^\/api\/files\/([a-f0-9]{32})$/))) {
      const f = db.prepare('SELECT * FROM files WHERE id=?').get(mm[1]), fp = path.join(FDIR, mm[1]); if (!f || !fs.existsSync(fp)) return json(res, 404, { error: 'File not found' });
      res.removeHeader('Content-Security-Policy'); return sendFile(req, res, fp, f.type, { 'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(f.name)}` });
    }
    if (m === 'GET' && p === '/api/meta') {
      const o = {}; for (const k of ['section', 'sub_section', 'machine_type', 'buyer']) o[k] = db.prepare(`SELECT DISTINCT ${k} v FROM smv WHERE ${k}<>'' ORDER BY 1`).all().map(x => x.v);
      return json(res, 200, o);
    }
    if (m === 'GET' && p === '/api/smv') {
      const q = u.searchParams, w = [], a = [];
      if (q.get('q')) { const l = '%' + q.get('q') + '%'; w.push('(process_name LIKE ? OR gsd_code LIKE ? OR remarks LIKE ? OR CAST(id AS TEXT)=?)'); a.push(l, l, l, q.get('q')); }
      for (const k of ['section', 'sub_section', 'machine_type', 'buyer']) if (q.get(k)) { w.push(k + '=?'); a.push(q.get(k)); }
      if (q.get('min')) { w.push('smv>=?'); a.push(+q.get('min')); } if (q.get('max')) { w.push('smv<=?'); a.push(+q.get('max')); }
      const W = w.length ? ' WHERE ' + w.join(' AND ') : '';
      const sort = ['id', 'section', 'sub_section', 'process_name', 'machine_type', 'smv', 'target', 'frequency', 'buyer', 'updated_on'].includes(q.get('sort')) ? q.get('sort') : 'id';
      const size = q.get('size') === 'all' ? -1 : Math.min(+q.get('size') || 25, 200), pg = Math.max(+q.get('page') || 1, 1);
      return json(res, 200, {
        total: db.prepare('SELECT COUNT(*) c FROM smv' + W).get(...a).c,
        rows: db.prepare(`SELECT * FROM smv${W} ORDER BY ${sort} ${q.get('dir') === 'desc' ? 'DESC' : 'ASC'},id LIMIT ? OFFSET ?`).all(...a, size, size < 0 ? 0 : (pg - 1) * size)
      });
    }
    if (m === 'POST' && p === '/api/smv') {
      const { r, e } = clean(await jbody(req)); if (e.length) return json(res, 422, { error: e.join('; ') });
      r.updated_on = r.updated_on || today(); const id = insert(r, me.email); audit(me.email, 'CREATE', id, r.process_name); return json(res, 201, { id });
    }
    if ((mm = p.match(/^\/api\/smv\/(\d+)$/))) {
      const id = +mm[1], old = db.prepare('SELECT * FROM smv WHERE id=?').get(id); if (!old) return json(res, 404, { error: 'Record not found' });
      if (m === 'PUT') {
        const { r, e } = clean(await jbody(req)); if (e.length) return json(res, 422, { error: e.join('; ') }); r.updated_on = today();
        db.prepare(`UPDATE smv SET ${F.map(k => k + '=?').join()},target=?,updated_by=? WHERE id=?`).run(...F.map(k => r[k]), +(60 / r.smv).toFixed(1), me.email, id);
        dropFiles(fileIds(old).filter(x => !fileIds(r).includes(x))); audit(me.email, 'UPDATE', id, F.filter(k => k !== 'updated_on' && String(old[k] ?? '') !== String(r[k])).map(k => `${k}: ${old[k] ?? ''} -> ${r[k]}`).join('; ') || 'no change'); return json(res, 200, { ok: true });
      }
      if (m === 'DELETE') { if (!admin) return deny(); db.prepare('DELETE FROM smv WHERE id=?').run(id); dropFiles(fileIds(old)); audit(me.email, 'DELETE', id, `${old.process_name} | ${old.machine_type} | SMV ${old.smv}`); return json(res, 200, { ok: true }); }
    }
    if (m === 'POST' && p === '/api/smv/import') {
      if (!admin) return deny(); const { rows, mode } = await jbody(req); if (!Array.isArray(rows)) return json(res, 400, { error: 'No rows supplied' });
      let ok = 0, gone = []; const bad = [];
      db.exec('BEGIN');
      try { if (mode === 'replace') { gone = db.prepare('SELECT videos,pdfs FROM smv').all().flatMap(fileIds); db.exec('DELETE FROM smv'); } rows.forEach((x, i) => { const { r, e } = clean(x); if (e.length) bad.push(`Row ${i + 1}: ${e.join(', ')}`); else { r.updated_on = r.updated_on || today(); insert(r, me.email); ok++; } }); if (mode === 'replace' && bad.length) { db.exec('ROLLBACK'); return json(res, 422, { error: 'Nothing was changed. Fix these rows first: ' + bad.slice(0, 5).join(' | ') }); } db.exec('COMMIT'); }
      catch (err) { db.exec('ROLLBACK'); throw err; }
      dropFiles(gone); audit(me.email, 'IMPORT', ok, `${mode || 'append'}; ${bad.length} rejected`); return json(res, 200, { imported: ok, rejected: bad.length, errors: bad.slice(0, 15) });
    }
    if (m === 'GET' && p === '/api/dashboard') {
      const g = q => db.prepare(q).all();
      return json(res, 200, {
        kpi: g('SELECT COUNT(*) total,ROUND(AVG(smv),3) avg,ROUND(MIN(smv),3) min,ROUND(MAX(smv),3) max,COUNT(DISTINCT machine_type) machines,COUNT(DISTINCT buyer) buyers FROM smv')[0],
        bySection: g('SELECT section k,COUNT(*) n,ROUND(AVG(smv),3) avg FROM smv GROUP BY section ORDER BY n DESC'),
        byMachine: g('SELECT machine_type k,COUNT(*) n,ROUND(AVG(smv),3) avg FROM smv GROUP BY machine_type ORDER BY n DESC LIMIT 10'),
        byBuyer: g('SELECT buyer k,COUNT(*) n,ROUND(AVG(smv),3) avg FROM smv GROUP BY buyer ORDER BY n DESC'),
        top: g('SELECT id,process_name,machine_type,smv FROM smv ORDER BY smv DESC LIMIT 5')
      });
    }
    if (p === '/api/users' && m === 'GET') return admin ? json(res, 200, db.prepare('SELECT id,name,email,role,active,created_at FROM users ORDER BY id').all()) : deny();
    if ((mm = p.match(/^\/api\/users\/(\d+)$/))) {
      if (!admin) return deny(); const id = +mm[1], x = db.prepare('SELECT email FROM users WHERE id=?').get(id);
      if (!x) return json(res, 404, { error: 'User not found' }); if (id === me.id) return json(res, 400, { error: 'You cannot modify your own account here' });
      if (m === 'PUT') {
        const b = await jbody(req, 1e5);
        if (b.password !== undefined && String(b.password).length < 8) return json(res, 400, { error: 'Password must be 8+ characters' });
        if (b.role) db.prepare('UPDATE users SET role=? WHERE id=?').run(b.role === 'super_admin' ? 'super_admin' : 'user', id);
        if (b.active !== undefined) db.prepare('UPDATE users SET active=? WHERE id=?').run(b.active ? 1 : 0, id);
        if (b.password) db.prepare('UPDATE users SET pass=? WHERE id=?').run(hash(String(b.password)), id);
        audit(me.email, 'USER_UPDATE', id, x.email + ' ' + JSON.stringify({ ...b, password: b.password ? '***' : undefined })); return json(res, 200, { ok: true });
      }
      if (m === 'DELETE') { db.prepare('DELETE FROM users WHERE id=?').run(id); audit(me.email, 'USER_DELETE', id, x.email); return json(res, 200, { ok: true }); }
    }
    if (m === 'GET' && p === '/api/audit') return admin ? json(res, 200, db.prepare('SELECT * FROM audit ORDER BY id DESC LIMIT 500').all()) : deny();
    if (m === 'GET' && p === '/api/backup') {
      if (!admin) return deny(); const f = path.join(__dirname, 'data', '_bk' + Date.now() + '.db');
      db.exec(`VACUUM INTO '${f.replace(/'/g, "''")}'`); const b = fs.readFileSync(f); fs.unlinkSync(f); audit(me.email, 'BACKUP', '', '');
      res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Disposition': `attachment; filename="smv-backup-${today()}.db"` }); return res.end(b);
    }
    if (m === 'POST' && p === '/api/restore') {
      if (!admin) return deny(); const b = await body(req, 200e6), t = DBF + '.new';
      if (b.subarray(0, 15).toString() !== 'SQLite format 3') return json(res, 400, { error: 'Not a valid SQLite backup file' });
      fs.writeFileSync(t, b);
      try { const c = new DatabaseSync(t); c.prepare('SELECT COUNT(*) FROM smv').get(); c.prepare('SELECT COUNT(*) FROM users').get(); c.prepare('SELECT COUNT(*) FROM audit').get(); c.close(); }
      catch { fs.unlinkSync(t); return json(res, 400, { error: 'File is not an SMV Data Bank backup' }); }
      const who = me.email; db.close(); fs.copyFileSync(DBF, DBF + '.pre-restore'); fs.renameSync(t, DBF); open(); audit(who, 'RESTORE', '', ''); return json(res, 200, { ok: true });
    }
    json(res, 404, { error: 'Not found' });
  } catch (err) {
    console.error(err); if (!res.headersSent) json(res, err instanceof SyntaxError ? 400 : 500, { error: err instanceof SyntaxError ? 'Invalid request data' : 'Server error' });
  }
}).listen(PORT, '0.0.0.0', () => { console.log(`SMV Data Bank running at http://0.0.0.0:${PORT}`); });
