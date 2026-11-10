// Telegramga o'xshash chat serveri. Qo'shimcha kutubxona kerak emas (Node.js 18+).
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto'), os = require('os');

const PORT = process.env.PORT || 3000;
// Railway Volume bo'lsa, xabarlar va rasmlar shu doimiy diskda saqlanadi.
const DATA_DIR = process.env.DATA_DIR || process.env.RAILWAY_VOLUME_MOUNT_PATH || path.join(__dirname, 'data');
const CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const OWNER_EMAIL = (process.env.OWNER_EMAIL || '').trim().toLowerCase();
const DEV = process.env.DEV_LOGIN === '1'; // faqat kompyuterda sinash uchun!
// Internet serverida parolsiz sinov rejimiga tasodifan ruxsat berilmasin.
if (DEV && (process.env.NODE_ENV === 'production' || process.env.RAILWAY_PROJECT_ID || process.env.RENDER)) {
  console.error('XATO: DEV_LOGIN=1 internetdagi serverda taqiqlangan. DEV_LOGIN ni o\'chiring.');
  process.exit(1);
}

if (!OWNER_EMAIL) { console.error('XATO: OWNER_EMAIL (egasining Gmail manzili) ko\'rsatilmagan'); process.exit(1); }
if (!CLIENT_ID && !DEV) { console.error('XATO: GOOGLE_CLIENT_ID ko\'rsatilmagan (README.txt ga qarang)'); process.exit(1); }

fs.mkdirSync(path.join(DATA_DIR, 'uploads'), { recursive: true });
const DB_FILE = path.join(DATA_DIR, 'db.json');
let db = { users: {}, groups: {}, messages: {}, sessions: {} };
try { db = { ...db, ...JSON.parse(fs.readFileSync(DB_FILE, 'utf8')) }; } catch {}
if (!Object.keys(db.groups).length) db.groups.general = { id: 'general', name: 'Umumiy', members: [] };

let saveTimer;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const tmp = DB_FILE + '.tmp';
    fs.writeFile(tmp, JSON.stringify(db), e => { if (!e) fs.rename(tmp, DB_FILE, () => {}); });
  }, 300);
}
const uid = (n = 6) => crypto.randomBytes(n).toString('hex');
const clean = (s, n) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, n);
const approved = u => !!u && u.status === 'approved';
const conns = new Map(); // userId -> Set(res)

// ---------- Chatlar va ruxsatlar ----------
const dmId = (a, b) => 'd:' + [a, b].sort().join(':');
function canAccess(u, chat) {
  if (!approved(u)) return false;
  if (chat.startsWith('g:')) { const g = db.groups[chat.slice(2)]; return !!g && (u.isOwner || g.members.includes(u.id)); }
  if (chat.startsWith('d:')) {
    const [, a, b] = chat.split(':');
    if (u.id !== a && u.id !== b) return false;
    return approved(db.users[u.id === a ? b : a]);
  }
  return false;
}
function audience(chat) {
  if (chat.startsWith('g:')) {
    const g = db.groups[chat.slice(2)];
    return new Set([...g.members, ...Object.values(db.users).filter(x => x.isOwner).map(x => x.id)]);
  }
  const [, a, b] = chat.split(':'); return new Set([a, b]);
}

// ---------- Holat (har bir foydalanuvchiga o'ziga mos) ----------
function stateFor(u) {
  const me = { id: u.id, email: u.email, name: u.name, picture: u.picture, isOwner: !!u.isOwner, status: u.status, canWrite: u.canWrite !== false, nameSet: !!u.nameSet };
  if (!approved(u)) return { me };
  const users = Object.values(db.users)
    .filter(x => x.id !== u.id && (u.isOwner || approved(x)))
    .map(x => ({
      id: x.id, name: x.name, picture: x.picture, online: conns.has(x.id), isOwner: !!x.isOwner,
      ...(u.isOwner ? { email: x.email, status: x.status, canWrite: x.canWrite !== false } : {})
    }));
  const groups = Object.values(db.groups)
    .filter(g => u.isOwner || g.members.includes(u.id))
    .map(g => ({ id: g.id, name: g.name, count: audience('g:' + g.id).size, ...(u.isOwner ? { members: g.members } : {}) }));
  return { me, users, groups };
}
const sse = (res, ev, data) => res.write(`event: ${ev}\ndata: ${JSON.stringify(data)}\n\n`);
function pushState(id) { const u = db.users[id]; const s = conns.get(id); if (u && s) s.forEach(r => sse(r, 'state', stateFor(u))); }
const pushAll = () => { for (const id of conns.keys()) pushState(id); };

// ---------- Kirish ----------
function cookies(req) {
  const o = {};
  (req.headers.cookie || '').split(';').forEach(p => { const i = p.indexOf('='); if (i > 0) o[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim()); });
  return o;
}
const authUser = req => { const id = db.sessions[cookies(req).sid]; return id ? db.users[id] : null; };

async function verifyGoogle(credential) {
  const r = await fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(credential));
  if (!r.ok) throw new Error('Google tokeni noto\'g\'ri');
  const d = await r.json();
  if (d.aud !== CLIENT_ID) throw new Error('Token boshqa ilova uchun');
  if (String(d.email_verified) !== 'true') throw new Error('Email tasdiqlanmagan');
  return { email: String(d.email).toLowerCase(), name: d.name || String(d.email).split('@')[0], picture: d.picture || '' };
}

function login(info, req, res) {
  let u = Object.values(db.users).find(x => x.email === info.email);
  if (!u) {
    u = { id: uid(6), email: info.email, name: clean(info.name, 30) || 'Foydalanuvchi', picture: info.picture || '', status: 'pending', canWrite: true, isOwner: false, nameSet: false, createdAt: Date.now() };
    db.users[u.id] = u;
  }
  if (info.picture) u.picture = info.picture;
  if (u.email === OWNER_EMAIL) { u.isOwner = true; u.status = 'approved'; }
  const sid = uid(24); db.sessions[sid] = u.id; save();
  const secure = (process.env.NODE_ENV === 'production' || req.headers['x-forwarded-proto'] === 'https') ? '; Secure' : '';
  res.setHeader('Set-Cookie', `sid=${sid}; HttpOnly; Path=/; SameSite=Lax; Max-Age=2592000${secure}`);
  pushAll();
  return json(res, 200, { ok: true });
}

// ---------- Yordamchilar ----------
function json(res, code, obj) { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); }
function readBody(req, limit = 20000) {
  return new Promise((resolve, reject) => {
    let b = '', n = 0;
    req.on('data', c => { n += c.length; if (n > limit) { reject(Object.assign(new Error('Juda katta'), { status: 413 })); req.destroy(); } else b += c; });
    req.on('end', () => { try { resolve(JSON.parse(b || '{}')); } catch { reject(new Error('Noto\'g\'ri so\'rov')); } });
  });
}
const rate = new Map();
function tooFast(id) { const now = Date.now(), a = (rate.get(id) || []).filter(t => now - t < 10000); a.push(now); rate.set(id, a); return a.length > 20; }
const MIME = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif' };

// ---------- Yo'nalishlar ----------
async function handle(req, res) {
  const url = new URL(req.url, 'http://x'), p = url.pathname, m = req.method;

  if (m === 'GET' && p === '/health') return json(res, 200, { ok: true });
  if (m === 'GET' && p === '/') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); return res.end(fs.readFileSync(path.join(__dirname, 'index.html'))); }
  if (m === 'GET' && p === '/config') return json(res, 200, { clientId: CLIENT_ID, dev: DEV });

  if (m === 'POST' && p === '/auth/google') {
    const { credential } = await readBody(req);
    return login(await verifyGoogle(String(credential || '')), req, res);
  }
  if (m === 'POST' && p === '/auth/dev') {
    if (!DEV) return json(res, 404, { error: 'Yo\'q' });
    const b = await readBody(req), email = clean(b.email, 80).toLowerCase();
    if (!/^\S+@\S+$/.test(email)) throw new Error('Email noto\'g\'ri');
    return login({ email, name: clean(b.name, 30) || email.split('@')[0], picture: '' }, req, res);
  }

  const u = authUser(req);
  if (m === 'GET' && p === '/me') return json(res, 200, u ? stateFor(u) : { me: null });
  if (!u) return json(res, 401, { error: 'Avval kiring' });

  if (m === 'POST' && p === '/auth/logout') { delete db.sessions[cookies(req).sid]; save(); return json(res, 200, { ok: true }); }

  if (m === 'GET' && p === '/events') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    if (!conns.has(u.id)) conns.set(u.id, new Set());
    conns.get(u.id).add(res);
    sse(res, 'state', stateFor(u));
    pushAll();
    const ping = setInterval(() => res.write(': ping\n\n'), 20000);
    req.on('close', () => {
      clearInterval(ping);
      const s = conns.get(u.id); if (s) { s.delete(res); if (!s.size) conns.delete(u.id); }
      pushAll();
    });
    return;
  }

  if (m === 'GET' && p.startsWith('/uploads/')) {
    const f = p.slice(9);
    if (!approved(u) || !/^[a-f0-9]{24}\.(jpg|png|webp|gif)$/.test(f)) { res.writeHead(404); return res.end(); }
    const file = path.join(DATA_DIR, 'uploads', f);
    if (!fs.existsSync(file)) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': MIME[f.split('.')[1]], 'Cache-Control': 'private, max-age=31536000, immutable', 'X-Content-Type-Options': 'nosniff' });
    return fs.createReadStream(file).pipe(res);
  }

  if (m === 'GET' && p === '/history') {
    const chat = url.searchParams.get('chat') || '';
    if (!canAccess(u, chat)) return json(res, 403, { error: 'Ruxsat yo\'q' });
    return json(res, 200, { messages: (db.messages[chat] || []).slice(-100) });
  }

  if (m === 'POST' && p === '/name') {
    const name = clean((await readBody(req)).name, 30);
    if (!name) throw new Error('Ism kiriting');
    u.name = name; u.nameSet = true; save(); pushAll();
    return json(res, 200, { ok: true });
  }

  if (m === 'POST' && p === '/send') {
    const b = await readBody(req, 9e6);
    if (!approved(u)) return json(res, 403, { error: 'Egasi hali tasdiqlamagan' });
    if (!u.isOwner && u.canWrite === false) return json(res, 403, { error: 'Sizga yozish ruxsati berilmagan' });
    const chat = String(b.chat || '');
    if (!canAccess(u, chat)) return json(res, 403, { error: 'Bu chatga ruxsat yo\'q' });
    if (tooFast(u.id)) return json(res, 429, { error: 'Juda tez yozyapsiz' });
    const text = String(b.text || '').trim().slice(0, 4000);
    let image = null;
    if (b.image) {
      const mt = /^data:image\/(jpeg|png|webp|gif);base64,/.exec(String(b.image));
      if (!mt) throw new Error('Rasm formati noto\'g\'ri');
      const buf = Buffer.from(String(b.image).slice(mt[0].length), 'base64');
      if (buf.length > 6e6) throw new Error('Rasm 6 MB dan katta');
      const ext = mt[1] === 'jpeg' ? 'jpg' : mt[1], name = uid(12) + '.' + ext;
      fs.writeFileSync(path.join(DATA_DIR, 'uploads', name), buf);
      image = '/uploads/' + name;
    }
    if (!text && !image) throw new Error('Bo\'sh xabar');
    const msg = { id: uid(6), from: u.id, fromName: u.name, text, image, time: Date.now() };
    (db.messages[chat] = db.messages[chat] || []).push(msg);
    if (db.messages[chat].length > 500) db.messages[chat].splice(0, db.messages[chat].length - 500);
    save();
    for (const id of audience(chat)) conns.get(id)?.forEach(r => sse(r, 'message', { chat, msg }));
    return json(res, 200, { ok: true });
  }

  if (m === 'POST' && p === '/admin') {
    if (!u.isOwner) return json(res, 403, { error: 'Faqat egasi' });
    const b = await readBody(req), t = db.users[b.userId], g = db.groups[b.groupId];
    switch (b.action) {
      case 'approve': if (t) { t.status = 'approved'; const gen = db.groups.general; if (gen && !t.isOwner && !gen.members.includes(t.id)) gen.members.push(t.id); } break;
      case 'block': if (t && !t.isOwner) t.status = 'blocked'; break;
      case 'unblock': if (t) t.status = 'approved'; break;
      case 'setWrite': if (t) t.canWrite = !!b.value; break;
      case 'createGroup': { const name = clean(b.name, 40); if (!name) throw new Error('Guruh nomini kiriting'); const id = uid(4); db.groups[id] = { id, name, members: [] }; break; }
      case 'renameGroup': if (g) { const name = clean(b.name, 40); if (name) g.name = name; } break;
      case 'deleteGroup': if (g) { delete db.groups[g.id]; delete db.messages['g:' + g.id]; } break;
      case 'setMembers': if (g && Array.isArray(b.members)) g.members = b.members.filter(id => approved(db.users[id]) && !db.users[id].isOwner); break;
      default: throw new Error('Noma\'lum amal');
    }
    save(); pushAll();
    return json(res, 200, { ok: true });
  }

  res.writeHead(404); res.end();
}

http.createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  try { await handle(req, res); }
  catch (e) { if (!res.headersSent) json(res, e.status || 400, { error: e.message || 'Xato' }); else res.end(); }
}).listen(PORT, '0.0.0.0', () => {
  console.log(`Chat serveri ${PORT}-portda ishga tushdi. Ochiq HTTPS manzilini Railway -> Networking -> Domains bo'limidan oling.`);
  console.log(`Ma'lumotlar papkasi: ${DATA_DIR} (egasi: ${OWNER_EMAIL}${DEV ? ', DEV_LOGIN yoqilgan!' : ''})`);
  for (const l of Object.values(os.networkInterfaces())) for (const i of l) if (i.family === 'IPv4' && !i.internal) console.log(`  tarmoqda: http://${i.address}:${PORT}`);
});
