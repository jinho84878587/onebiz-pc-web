const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { URL } = require('url');

const PORT = Number(process.env.PORT || 10000);
const HOST = process.env.HOST || '0.0.0.0';
const DEVICE_KEY = process.env.ONEBIZ_DEVICE_KEY || process.env.ONEBIZ_SYNC_KEY || '';
const TOKEN_SECRET = process.env.ONEBIZ_TOKEN_SECRET || 'dev-only-change-this-secret';
const DATA_FILE = process.env.ONEBIZ_DATA_FILE || path.join(__dirname, 'data', 'onebiz-cloud.json');
const PUBLIC_DIR = path.join(__dirname, 'public');
const MAX_BODY = 6 * 1024 * 1024;

function ensureDataFile() {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify({ tenants: {} }, null, 2), 'utf8');
  }
}

function readDb() {
  ensureDataFile();
  try {
    const parsed = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    if (!parsed.tenants || typeof parsed.tenants !== 'object') parsed.tenants = {};
    return parsed;
  } catch {
    return { tenants: {} };
  }
}

function writeDb(db) {
  ensureDataFile();
  const tmp = `${DATA_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2), 'utf8');
  fs.renameSync(tmp, DATA_FILE);
}

function sendJson(res, status, body) {
  const json = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(json),
    'Cache-Control': 'no-store'
  });
  res.end(json);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new Error('요청 데이터가 너무 큽니다.'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(new Error('JSON 형식이 올바르지 않습니다.'));
      }
    });
    req.on('error', reject);
  });
}

function validMemberId(value) {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{4,64}$/.test(value);
}
function validPin(value) {
  return typeof value === 'string' && /^\d{6}$/.test(value);
}

function hashPin(pin, salt) {
  return crypto.scryptSync(pin, salt, 64).toString('hex');
}
function setPin(tenant, pin) {
  const salt = crypto.randomBytes(16).toString('hex');
  tenant.pinSalt = salt;
  tenant.pinHash = hashPin(pin, salt);
}
function checkPin(tenant, pin) {
  if (!tenant || !tenant.pinSalt || !tenant.pinHash) return false;
  const actual = Buffer.from(hashPin(pin, tenant.pinSalt), 'hex');
  const expected = Buffer.from(tenant.pinHash, 'hex');
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

function b64url(input) {
  return Buffer.from(input).toString('base64url');
}
function issueToken(memberId) {
  const payload = { memberId, exp: Date.now() + 12 * 60 * 60 * 1000 };
  const encoded = b64url(JSON.stringify(payload));
  const sig = crypto.createHmac('sha256', TOKEN_SECRET).update(encoded).digest('base64url');
  return `${encoded}.${sig}`;
}
function verifyToken(token) {
  if (!token || !token.includes('.')) return null;
  const [encoded, sig] = token.split('.', 2);
  const expected = crypto.createHmac('sha256', TOKEN_SECRET).update(encoded).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
    if (!payload.memberId || !payload.exp || payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

function requireDeviceKey(req, res) {
  if (!DEVICE_KEY) {
    sendJson(res, 503, { ok: false, error: '서버의 ONEBIZ_DEVICE_KEY가 설정되지 않았습니다.' });
    return false;
  }
  const key = req.headers['x-onebiz-key'] || '';
  if (key !== DEVICE_KEY) {
    sendJson(res, 401, { ok: false, error: '기기 인증키가 올바르지 않습니다.' });
    return false;
  }
  return true;
}

function requireSession(req, res) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  const payload = verifyToken(token);
  if (!payload) {
    sendJson(res, 401, { ok: false, error: '로그인이 만료되었습니다.' });
    return null;
  }
  return payload;
}

function cleanSnapshot(body) {
  const profile = body && typeof body.profile === 'object' && body.profile ? body.profile : {};
  const data = body && typeof body.data === 'object' && body.data ? body.data : {};
  const employees = Array.isArray(body?.employees) ? body.employees : [];
  if (!Array.isArray(data.customers)) data.customers = [];
  if (!Array.isArray(data.quotes)) data.quotes = [];
  if (!Array.isArray(data.contracts)) data.contracts = [];
  return { profile, data, employees };
}

function snapshotFor(memberId, tenant) {
  return {
    ok: true,
    memberId,
    profile: tenant.profile || {},
    data: tenant.data || { customers: [], quotes: [], contracts: [] },
    employees: tenant.employees || [],
    updatedAt: tenant.updatedAt || null,
    appVersion: tenant.appVersion || ''
  };
}

function mimeType(file) {
  const ext = path.extname(file).toLowerCase();
  return ({
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.ico': 'image/x-icon'
  })[ext] || 'application/octet-stream';
}

function serveStatic(req, res, pathname) {
  const rel = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const normalized = path.normalize(rel).replace(/^\.\.(\/|\\|$)+/, '');
  const full = path.join(PUBLIC_DIR, normalized);
  if (!full.startsWith(PUBLIC_DIR)) return false;
  if (!fs.existsSync(full) || !fs.statSync(full).isFile()) return false;
  const data = fs.readFileSync(full);
  res.writeHead(200, {
    'Content-Type': mimeType(full),
    'Content-Length': data.length,
    'Cache-Control': full.endsWith('index.html') ? 'no-cache' : 'public, max-age=300'
  });
  res.end(data);
  return true;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = url.pathname;

  try {
    if (req.method === 'GET' && pathname === '/health') {
      return sendJson(res, 200, { ok: true, service: 'ONEBIZ Cloud', version: '1.0.0', time: new Date().toISOString() });
    }

    if (pathname === '/api/v1/device/sync' && req.method === 'POST') {
      if (!requireDeviceKey(req, res)) return;
      const body = await readJson(req);
      const memberId = String(body.memberId || '').trim();
      const pin = String(body.pin || '').trim();
      if (!validMemberId(memberId) || !validPin(pin)) {
        return sendJson(res, 400, { ok: false, error: 'memberId 또는 6자리 연결 PIN을 확인해 주세요.' });
      }
      const db = readDb();
      const tenant = db.tenants[memberId] || {};
      setPin(tenant, pin);
      const snap = cleanSnapshot(body);
      tenant.profile = snap.profile;
      tenant.data = snap.data;
      tenant.employees = snap.employees;
      tenant.appVersion = String(body.appVersion || '');
      tenant.updatedAt = new Date().toISOString();
      tenant.createdAt = tenant.createdAt || tenant.updatedAt;
      db.tenants[memberId] = tenant;
      writeDb(db);
      return sendJson(res, 200, { ok: true, memberId, updatedAt: tenant.updatedAt });
    }

    if (pathname === '/api/v1/device/snapshot' && req.method === 'GET') {
      if (!requireDeviceKey(req, res)) return;
      const memberId = String(url.searchParams.get('memberId') || '').trim();
      if (!validMemberId(memberId)) return sendJson(res, 400, { ok: false, error: 'memberId를 확인해 주세요.' });
      const db = readDb();
      const tenant = db.tenants[memberId];
      if (!tenant) return sendJson(res, 404, { ok: false, error: '아직 PC 웹에 동기화된 데이터가 없습니다.' });
      return sendJson(res, 200, snapshotFor(memberId, tenant));
    }

    if (pathname === '/api/v1/session' && req.method === 'POST') {
      const body = await readJson(req);
      const memberId = String(body.memberId || '').trim();
      const pin = String(body.pin || '').trim();
      if (!validMemberId(memberId) || !validPin(pin)) {
        return sendJson(res, 400, { ok: false, error: '회원 ID와 6자리 PIN을 확인해 주세요.' });
      }
      const db = readDb();
      const tenant = db.tenants[memberId];
      if (!checkPin(tenant, pin)) {
        return sendJson(res, 401, { ok: false, error: '회원 ID 또는 연결 PIN이 올바르지 않습니다.' });
      }
      return sendJson(res, 200, { ok: true, token: issueToken(memberId), memberId, updatedAt: tenant.updatedAt || null });
    }

    if (pathname === '/api/v1/snapshot' && req.method === 'GET') {
      const session = requireSession(req, res);
      if (!session) return;
      const db = readDb();
      const tenant = db.tenants[session.memberId];
      if (!tenant) return sendJson(res, 404, { ok: false, error: '동기화 데이터를 찾을 수 없습니다.' });
      return sendJson(res, 200, snapshotFor(session.memberId, tenant));
    }

    if (pathname === '/api/v1/snapshot' && req.method === 'PUT') {
      const session = requireSession(req, res);
      if (!session) return;
      const body = await readJson(req);
      const db = readDb();
      const tenant = db.tenants[session.memberId];
      if (!tenant) return sendJson(res, 404, { ok: false, error: '동기화 데이터를 찾을 수 없습니다.' });
      const snap = cleanSnapshot(body);
      tenant.profile = snap.profile;
      tenant.data = snap.data;
      tenant.employees = snap.employees;
      tenant.updatedAt = new Date().toISOString();
      db.tenants[session.memberId] = tenant;
      writeDb(db);
      return sendJson(res, 200, { ok: true, updatedAt: tenant.updatedAt });
    }

    if (req.method === 'GET' && !pathname.startsWith('/api/')) {
      if (serveStatic(req, res, pathname)) return;
      if (serveStatic(req, res, '/index.html')) return;
    }

    sendJson(res, 404, { ok: false, error: '요청한 경로를 찾을 수 없습니다.' });
  } catch (err) {
    console.error(err);
    if (!res.headersSent) sendJson(res, 500, { ok: false, error: err.message || '서버 오류가 발생했습니다.' });
    else res.end();
  }
});

server.listen(PORT, HOST, () => {
  console.log(`ONEBIZ Cloud listening on http://${HOST}:${PORT}`);
  if (!DEVICE_KEY) console.warn('WARNING: ONEBIZ_DEVICE_KEY is not set. Android device sync is disabled.');
});
