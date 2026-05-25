// ─────────────────────────────────────────────────────────────────────────────
// POSEIDON CRM — Cloudflare Worker
// v1.0.0
// Paste into: dash.cloudflare.com → Workers & Pages → poseidon-api → Edit Code
// ─────────────────────────────────────────────────────────────────────────────
// Required Worker Secrets: TENANT_ID, CLIENT_ID, CLIENT_SECRET,
//                          ONEDRIVE_USER, EMAIL_SENDER, JWT_SECRET, ADMIN_KEY
// D1 Binding:  DB  → poseidon-db
// KV Binding:  KV  → POSEIDON_KV
// ─────────────────────────────────────────────────────────────────────────────

// ── Utilities ──────────────────────────────────────────────────────────────

function cuid() {
  return 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

function err(msg, status = 400) {
  return json({ error: msg }, status);
}

const ORIGINS = ['https://putuastra.github.io', 'http://localhost:3000', 'http://127.0.0.1:5500'];

function cors(origin) {
  const o = ORIGINS.includes(origin) ? origin : ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': o,
    'Access-Control-Allow-Methods': 'GET,POST,PATCH,PUT,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Max-Age': '86400'
  };
}

// ── JWT (HS256 via WebCrypto) ────────────────────────────────────────────────

function b64url(buf) {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function b64urlStr(str) {
  return btoa(unescape(encodeURIComponent(str)))
    .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

async function jwtSign(payload, secret, ttl = 900) {
  const enc = new TextEncoder();
  const now = Math.floor(Date.now() / 1000);
  const header = b64urlStr(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64urlStr(JSON.stringify({ ...payload, iat: now, exp: now + ttl }));
  const msg = `${header}.${body}`;
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = b64url(await crypto.subtle.sign('HMAC', key, enc.encode(msg)));
  return `${msg}.${sig}`;
}

async function jwtVerify(token, secret) {
  try {
    const [h, p, s] = token.split('.');
    if (!h || !p || !s) return null;
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
    const sig = Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
    const ok = await crypto.subtle.verify('HMAC', key, sig, enc.encode(`${h}.${p}`));
    if (!ok) return null;
    const claims = JSON.parse(atob(p.replace(/-/g, '+').replace(/_/g, '/')));
    if (claims.exp < Math.floor(Date.now() / 1000)) return null;
    return claims;
  } catch { return null; }
}

// ── Password (SHA-256 + salt) ────────────────────────────────────────────────

async function pwHash(pw) {
  const salt = crypto.randomUUID().replace(/-/g, '');
  const enc = new TextEncoder();
  const h = await crypto.subtle.digest('SHA-256', enc.encode(salt + pw));
  return salt + ':' + Array.from(new Uint8Array(h)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function pwVerify(pw, stored) {
  const [salt, hash] = stored.split(':');
  const enc = new TextEncoder();
  const h = await crypto.subtle.digest('SHA-256', enc.encode(salt + pw));
  const computed = Array.from(new Uint8Array(h)).map(b => b.toString(16).padStart(2, '0')).join('');
  return computed === hash;
}

// ── Tokens ───────────────────────────────────────────────────────────────────

function genToken() {
  const b = new Uint8Array(48);
  crypto.getRandomValues(b);
  return Array.from(b).map(x => x.toString(16).padStart(2, '0')).join('');
}

async function hashTok(t) {
  const h = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(t));
  return Array.from(new Uint8Array(h)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// ── Auth middleware ───────────────────────────────────────────────────────────

async function auth(req, env) {
  const hdr = req.headers.get('Authorization');
  if (!hdr?.startsWith('Bearer ')) return null;
  const claims = await jwtVerify(hdr.slice(7), env.JWT_SECRET);
  if (!claims) return null;
  return env.DB.prepare('SELECT id,email,role,first_name,last_name,is_active FROM users WHERE id=?')
    .bind(claims.sub).first().then(u => (u?.is_active ? u : null));
}

function role(user, ...roles) {
  if (!user) return err('Unauthorized', 401);
  if (!roles.includes(user.role)) return err('Forbidden', 403);
  return null;
}

// ── Microsoft Graph ──────────────────────────────────────────────────────────

async function graphToken(env) {
  const cached = await env.KV.get('_graph_token');
  if (cached) {
    const { t, exp } = JSON.parse(cached);
    if (Date.now() < exp - 60000) return t;
  }
  const r = await fetch(`https://login.microsoftonline.com/${env.TENANT_ID}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: env.CLIENT_ID, client_secret: env.CLIENT_SECRET, scope: 'https://graph.microsoft.com/.default', grant_type: 'client_credentials' })
  });
  const d = await r.json();
  if (!d.access_token) throw new Error('Graph auth failed');
  await env.KV.put('_graph_token', JSON.stringify({ t: d.access_token, exp: Date.now() + d.expires_in * 1000 }), { expirationTtl: d.expires_in - 120 });
  return d.access_token;
}

async function graph(env, method, path, body = null) {
  const t = await graphToken(env);
  const opts = { method, headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  const r = await fetch(`https://graph.microsoft.com/v1.0${path}`, opts);
  if (r.status === 204) return null;
  const d = await r.json();
  if (!r.ok) throw new Error(d.error?.message || `Graph ${method} ${path} failed`);
  return d;
}

async function sendMail(env, to, subject, html) {
  return graph(env, 'POST', `/users/${env.EMAIL_SENDER}/sendMail`, {
    message: { subject, body: { contentType: 'HTML', content: html }, toRecipients: [{ emailAddress: { address: to } }] },
    saveToSentItems: true
  });
}

// ── Router ────────────────────────────────────────────────────────────────────

class Router {
  constructor() { this.routes = []; }
  add(m, p, h) { this.routes.push({ m, p: new URLPattern({ pathname: p }), h }); }
  get(p, h) { this.add('GET', p, h); }
  post(p, h) { this.add('POST', p, h); }
  patch(p, h) { this.add('PATCH', p, h); }
  put(p, h) { this.add('PUT', p, h); }
  delete(p, h) { this.add('DELETE', p, h); }

  async handle(req, env, ctx) {
    const url = new URL(req.url);
    const origin = req.headers.get('Origin') || '';
    const ch = cors(origin);

    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: ch });

    for (const route of this.routes) {
      if (route.m !== req.method) continue;
      const m = route.p.exec({ pathname: url.pathname });
      if (!m) continue;
      try {
        const res = await route.h(req, env, ctx, m.pathname.groups, url);
        const h2 = new Headers(res.headers);
        Object.entries(ch).forEach(([k, v]) => h2.set(k, v));
        return new Response(res.body, { status: res.status, headers: h2 });
      } catch (e) {
        console.error(e);
        const r = err('Internal server error', 500);
        const h2 = new Headers(r.headers);
        Object.entries(ch).forEach(([k, v]) => h2.set(k, v));
        return new Response(r.body, { status: 500, headers: h2 });
      }
    }

    const r = err('Not found', 404);
    const h2 = new Headers(r.headers);
    Object.entries(ch).forEach(([k, v]) => h2.set(k, v));
    return new Response(r.body, { status: 404, headers: h2 });
  }
}

const R = new Router();

// ═════════════════════════════════════════════════════════════════════════════
// AUTH
// ═════════════════════════════════════════════════════════════════════════════

R.post('/api/v1/setup/bootstrap', async (req, env) => {
  const exists = await env.DB.prepare("SELECT id FROM users WHERE role='SUPER_ADMIN' LIMIT 1").first();
  if (exists) return err('Already bootstrapped', 409);
  const { adminKey, email, firstName, lastName, password } = await req.json();
  if (adminKey !== env.ADMIN_KEY) return err('Invalid admin key', 401);
  if (!email || !password || !firstName || !lastName) return err('All fields required');
  const id = cuid();
  await env.DB.prepare("INSERT INTO users(id,email,password_hash,role,first_name,last_name)VALUES(?,?,?,'SUPER_ADMIN',?,?)")
    .bind(id, email, await pwHash(password), firstName, lastName).run();
  return json({ success: true, userId: id }, 201);
});

R.post('/api/v1/auth/login', async (req, env) => {
  const { email, password } = await req.json();
  if (!email || !password) return err('Email and password required');
  const u = await env.DB.prepare('SELECT*FROM users WHERE email=? COLLATE NOCASE').bind(email).first();
  if (!u || !u.is_active || !u.password_hash) return err('Invalid credentials', 401);
  if (!await pwVerify(password, u.password_hash)) return err('Invalid credentials', 401);
  const at = await jwtSign({ sub: u.id, role: u.role }, env.JWT_SECRET, 900);
  const rt = genToken();
  await env.KV.put(`refresh:${await hashTok(rt)}`, JSON.stringify({ uid: u.id }), { expirationTtl: 604800 });
  await env.DB.prepare("UPDATE users SET last_login_at=datetime('now'),updated_at=datetime('now')WHERE id=?").bind(u.id).run();
  return json({ accessToken: at, refreshToken: rt, user: { id: u.id, email: u.email, role: u.role, firstName: u.first_name, lastName: u.last_name } });
});

R.post('/api/v1/auth/refresh', async (req, env) => {
  const { refreshToken } = await req.json();
  if (!refreshToken) return err('Refresh token required', 401);
  const stored = await env.KV.get(`refresh:${await hashTok(refreshToken)}`);
  if (!stored) return err('Invalid token', 401);
  const { uid } = JSON.parse(stored);
  const u = await env.DB.prepare('SELECT id,role,is_active FROM users WHERE id=?').bind(uid).first();
  if (!u?.is_active) return err('User not found', 401);
  await env.KV.delete(`refresh:${await hashTok(refreshToken)}`);
  const rt = genToken();
  await env.KV.put(`refresh:${await hashTok(rt)}`, JSON.stringify({ uid }), { expirationTtl: 604800 });
  return json({ accessToken: await jwtSign({ sub: uid, role: u.role }, env.JWT_SECRET, 900), refreshToken: rt });
});

R.post('/api/v1/auth/logout', async (req, env) => {
  const { refreshToken } = await req.json().catch(() => ({}));
  if (refreshToken) await env.KV.delete(`refresh:${await hashTok(refreshToken)}`);
  return json({ success: true });
});

R.post('/api/v1/auth/candidate/activate', async (req, env) => {
  const { token } = await req.json();
  if (!token) return err('Token required');
  const stored = await env.KV.get(`activation:${await hashTok(token)}`);
  if (!stored) return err('Invalid or expired link', 401);
  const { candidateId, expiresAt } = JSON.parse(stored);
  if (new Date(expiresAt) < new Date()) return err('Link expired', 401);
  const c = await env.DB.prepare('SELECT id,email,first_name,last_name FROM candidates WHERE id=?').bind(candidateId).first();
  if (!c) return err('Candidate not found', 404);
  return json({ valid: true, email: c.email, firstName: c.first_name, lastName: c.last_name, candidateId });
});

R.post('/api/v1/auth/candidate/set-password', async (req, env) => {
  const { token, password } = await req.json();
  if (!token || !password) return err('Token and password required');
  if (password.length < 8) return err('Password must be at least 8 characters');
  const hash = await hashTok(token);
  const stored = await env.KV.get(`activation:${hash}`);
  if (!stored) return err('Invalid or expired link', 401);
  const { candidateId, expiresAt } = JSON.parse(stored);
  if (new Date(expiresAt) < new Date()) return err('Link expired', 401);
  const c = await env.DB.prepare('SELECT id,email,user_id FROM candidates WHERE id=?').bind(candidateId).first();
  if (!c) return err('Candidate not found', 404);
  if (c.user_id) return err('Account already activated', 409);
  const uid = cuid();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO users(id,email,password_hash,role,first_name,last_name)SELECT ?,email,?,'CANDIDATE',first_name,last_name FROM candidates WHERE id=?")
      .bind(uid, await pwHash(password), candidateId),
    env.DB.prepare("UPDATE candidates SET user_id=?,portal_activated_at=datetime('now'),updated_at=datetime('now')WHERE id=?")
      .bind(uid, candidateId)
  ]);
  await env.KV.delete(`activation:${hash}`);
  const rt = genToken();
  await env.KV.put(`refresh:${await hashTok(rt)}`, JSON.stringify({ uid }), { expirationTtl: 604800 });
  return json({ accessToken: await jwtSign({ sub: uid, role: 'CANDIDATE' }, env.JWT_SECRET, 900), refreshToken: rt });
});

R.post('/api/v1/auth/forgot-password', async (req, env) => {
  const { email } = await req.json();
  if (!email) return err('Email required');
  const u = await env.DB.prepare('SELECT id,first_name,email,role FROM users WHERE email=? COLLATE NOCASE AND is_active=1').bind(email).first();
  // Always return success to prevent user enumeration
  if (u) {
    const raw = genToken();
    const h = await hashTok(raw);
    await env.KV.put(`pwreset:${h}`, JSON.stringify({ uid: u.id, expiresAt: new Date(Date.now() + 3600000).toISOString() }), { expirationTtl: 3600 });
    const base = 'https://putuastra.github.io/poseidon-crm';
    const link = u.role === 'CANDIDATE'
      ? `${base}/portal.html?reset=${raw}`
      : `${base}/reset.html?t=${raw}`;
    await sendMail(env, u.email, 'POSEIDON — Password Reset',
      `<div style="font-family:sans-serif;max-width:580px;margin:auto;padding:32px"><h2 style="color:#1a56db">Password Reset</h2><p>Hi ${u.first_name},</p><p>Click below to reset your password. This link expires in 1 hour.</p><p style="margin:28px 0"><a href="${link}" style="background:#1a56db;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:bold">Reset Password</a></p><p style="color:#6b7280;font-size:13px">If you didn't request this, ignore this email.<br>CTI Group — POSEIDON</p></div>`
    );
  }
  return json({ success: true });
});

R.post('/api/v1/auth/reset-password', async (req, env) => {
  const { token, password } = await req.json();
  if (!token || !password) return err('Token and password required');
  if (password.length < 8) return err('Password must be at least 8 characters');
  const h = await hashTok(token);
  const stored = await env.KV.get(`pwreset:${h}`);
  if (!stored) return err('Invalid or expired reset link', 401);
  const { uid, expiresAt } = JSON.parse(stored);
  if (new Date(expiresAt) < new Date()) return err('Reset link expired', 401);
  await env.DB.prepare("UPDATE users SET password_hash=?,updated_at=datetime('now')WHERE id=?")
    .bind(await pwHash(password), uid).run();
  await env.KV.delete(`pwreset:${h}`);
  return json({ success: true });
});

// ═════════════════════════════════════════════════════════════════════════════
// CANDIDATES
// ═════════════════════════════════════════════════════════════════════════════

R.post('/api/v1/candidates', async (req, env) => {
  const u = await auth(req, env); const re = role(u, 'SUPER_ADMIN', 'ADMIN', 'RECRUITER'); if (re) return re;
  const { firstName, lastName, email, phone, pipeline, positionApplied, nationality, internalNotes } = await req.json();
  if (!firstName || !lastName || !email || !pipeline) return err('firstName, lastName, email, pipeline required');
  const VALID_PIPELINES = ['SEA_BASED', 'LAND_BASED', 'J1_PROGRAM'];
  if (!VALID_PIPELINES.includes(pipeline)) return err('Invalid pipeline');
  const existing = await env.DB.prepare('SELECT id FROM candidates WHERE email=? COLLATE NOCASE').bind(email).first();
  if (existing) return err('A candidate with this email already exists', 409);
  const id = cuid();
  await env.DB.batch([
    env.DB.prepare('INSERT INTO candidates(id,first_name,last_name,email,phone,pipeline,status,assigned_recruiter_id,internal_notes)VALUES(?,?,?,?,?,?,\'NEW_SUBMISSION\',?,?)')
      .bind(id, firstName, lastName, email, phone || null, pipeline, u.id, internalNotes || null),
    env.DB.prepare("INSERT INTO pipeline_stage_history(id,candidate_id,from_status,to_status,triggered_by_id,reason)VALUES(?,?,NULL,'NEW_SUBMISSION',?,'Manually created')")
      .bind(cuid(), id, u.id)
  ]);
  if (positionApplied) await env.DB.prepare("UPDATE candidates SET position_applied=? WHERE id=?").bind(positionApplied, id).run();
  return json({ candidateId: id }, 201);
});

R.get('/api/v1/candidates', async (req, env, ctx, p, url) => {
  const u = await auth(req, env); const re = role(u, 'SUPER_ADMIN', 'ADMIN', 'RECRUITER'); if (re) return re;
  const pipeline = url.searchParams.get('pipeline');
  const status = url.searchParams.get('status');
  const search = url.searchParams.get('search');
  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1'));
  const limit = Math.min(100, parseInt(url.searchParams.get('limit') || '50'));
  const offset = (page - 1) * limit;
  const where = []; const binds = [];
  if (u.role === 'RECRUITER') { where.push('c.assigned_recruiter_id=?'); binds.push(u.id); }
  if (pipeline) { where.push('c.pipeline=?'); binds.push(pipeline); }
  if (status) { where.push('c.status=?'); binds.push(status); }
  if (search) { where.push('(c.first_name LIKE? OR c.last_name LIKE? OR c.email LIKE?)'); binds.push(`%${search}%`, `%${search}%`, `%${search}%`); }
  const wc = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const [rows, tot] = await Promise.all([
    env.DB.prepare(`SELECT c.*,u.first_name recruiter_fn,u.last_name recruiter_ln FROM candidates c LEFT JOIN users u ON c.assigned_recruiter_id=u.id ${wc} ORDER BY c.created_at DESC LIMIT? OFFSET?`).bind(...binds, limit, offset).all(),
    env.DB.prepare(`SELECT COUNT(*)cnt FROM candidates c ${wc}`).bind(...binds).first()
  ]);
  return json({ candidates: rows.results, total: tot.cnt, page, limit });
});

R.get('/api/v1/candidates/compliance-filter', async (req, env, ctx, p, url) => {
  const u = await auth(req, env); const re = role(u, 'SUPER_ADMIN', 'ADMIN'); if (re) return re;
  const docTypes = url.searchParams.getAll('documentType');
  const expiresBefore = url.searchParams.get('expiresBefore');
  const expiredOnly = url.searchParams.get('expiredOnly') === 'true';
  const pipelines = url.searchParams.getAll('pipeline');
  const statuses = url.searchParams.getAll('status');
  const where = ['d.expiration_date IS NOT NULL']; const binds = [];
  if (expiredOnly) { where.push("d.expiration_date < datetime('now')"); }
  else if (expiresBefore) { where.push('d.expiration_date<=?'); binds.push(expiresBefore); }
  if (docTypes.length) { where.push(`d.type IN(${docTypes.map(() => '?').join()})`); binds.push(...docTypes); }
  if (pipelines.length) { where.push(`c.pipeline IN(${pipelines.map(() => '?').join()})`); binds.push(...pipelines); }
  if (statuses.length) { where.push(`c.status IN(${statuses.map(() => '?').join()})`); binds.push(...statuses); }
  const { results } = await env.DB.prepare(
    `SELECT c.id,c.first_name,c.last_name,c.email,c.pipeline,c.status,d.id doc_id,d.type doc_type,d.label,d.document_number,d.expiration_date,d.issuance_date,d.is_verified FROM candidates c JOIN documents d ON d.candidate_id=c.id WHERE ${where.join(' AND ')} ORDER BY d.expiration_date ASC LIMIT 500`
  ).bind(...binds).all();
  return json({ results, total: results.length });
});

R.get('/api/v1/candidates/:id', async (req, env, ctx, p) => {
  const u = await auth(req, env); const re = role(u, 'SUPER_ADMIN', 'ADMIN', 'RECRUITER'); if (re) return re;
  const c = await env.DB.prepare('SELECT*FROM candidates WHERE id=?').bind(p.id).first();
  if (!c) return err('Not found', 404);
  if (u.role === 'RECRUITER' && c.assigned_recruiter_id !== u.id) return err('Forbidden', 403);
  const [ci, ce, docs, hist] = await Promise.all([
    env.DB.prepare('SELECT ci.*,i.title,i.type FROM candidate_interviews ci JOIN interviews i ON ci.interview_id=i.id WHERE ci.candidate_id=? ORDER BY ci.invited_at DESC').bind(p.id).all(),
    env.DB.prepare('SELECT ce.*,cl.name client_name,cl.type client_type FROM client_endorsements ce JOIN clients cl ON ce.client_id=cl.id WHERE ce.candidate_id=?').bind(p.id).all(),
    env.DB.prepare('SELECT*FROM documents WHERE candidate_id=? ORDER BY created_at DESC').bind(p.id).all(),
    env.DB.prepare('SELECT h.*,u2.first_name fn,u2.last_name ln FROM pipeline_stage_history h LEFT JOIN users u2 ON h.triggered_by_id=u2.id WHERE h.candidate_id=? ORDER BY h.created_at DESC LIMIT 30').bind(p.id).all()
  ]);
  return json({ ...c, interviews: ci.results, endorsements: ce.results, documents: docs.results, stageHistory: hist.results });
});

R.patch('/api/v1/candidates/:id', async (req, env, ctx, p) => {
  const u = await auth(req, env); const re = role(u, 'SUPER_ADMIN', 'ADMIN'); if (re) return re;
  const b = await req.json();
  const map = { first_name: b.firstName, last_name: b.lastName, middle_name: b.middleName, phone: b.phone, date_of_birth: b.dateOfBirth, nationality: b.nationality, address: b.address ? JSON.stringify(b.address) : undefined, internal_notes: b.internalNotes, tags: b.tags ? JSON.stringify(b.tags) : undefined };
  const upd = Object.fromEntries(Object.entries(map).filter(([, v]) => v !== undefined));
  if (!Object.keys(upd).length) return err('No valid fields');
  upd.updated_at = new Date().toISOString();
  const sc = Object.keys(upd).map(k => `${k}=?`).join();
  await env.DB.prepare(`UPDATE candidates SET ${sc} WHERE id=?`).bind(...Object.values(upd), p.id).run();
  return json({ success: true });
});

R.post('/api/v1/candidates/:id/stage', async (req, env, ctx, p) => {
  const u = await auth(req, env); const re = role(u, 'SUPER_ADMIN', 'ADMIN', 'RECRUITER'); if (re) return re;
  const { toStatus, reason, metadata } = await req.json();
  if (!toStatus) return err('toStatus required');
  const c = await env.DB.prepare('SELECT id,status FROM candidates WHERE id=?').bind(p.id).first();
  if (!c) return err('Not found', 404);
  const ALLOWED = {
    NEW_SUBMISSION: ['SCREENING', 'ARCHIVED', 'WITHDRAWN'],
    SCREENING: ['DUPLICATE_FLAGGED', 'OWI_INVITED', 'TWI_SCHEDULED', 'ARCHIVED', 'WITHDRAWN'],
    DUPLICATE_FLAGGED: ['SCREENING', 'ARCHIVED', 'WITHDRAWN'],
    OWI_INVITED: ['OWI_SUBMITTED', 'ARCHIVED', 'WITHDRAWN'],
    OWI_SUBMITTED: ['TWI_SCHEDULED', 'ARCHIVED', 'WITHDRAWN'],
    TWI_SCHEDULED: ['TWI_COMPLETED', 'ARCHIVED', 'WITHDRAWN'],
    TWI_COMPLETED: ['BOOKING_INVITED', 'PRE_QUAL_APPROVED', 'ARCHIVED', 'WITHDRAWN'],
    BOOKING_INVITED: ['BOOKING_CONFIRMED', 'ARCHIVED', 'WITHDRAWN'],
    BOOKING_CONFIRMED: ['BOOKING_COMPLETED', 'ARCHIVED', 'WITHDRAWN'],
    BOOKING_COMPLETED: ['PRE_QUAL_APPROVED', 'PRE_QUAL_REJECTED', 'WITHDRAWN'],
    PRE_QUAL_APPROVED: ['ENDORSED', 'ARCHIVED', 'WITHDRAWN'],
    PRE_QUAL_REJECTED: ['ARCHIVED', 'WITHDRAWN', 'SCREENING'],
    ENDORSED: ['CLIENT_APPROVED', 'ARCHIVED', 'WITHDRAWN'],
    CLIENT_APPROVED: ['ONBOARDING', 'WITHDRAWN'],
    ONBOARDING: ['DOCUMENT_REVIEW', 'COMPLIANCE_HOLD', 'WITHDRAWN'],
    DOCUMENT_REVIEW: ['COMPLIANCE_HOLD', 'DEPLOYED', 'WITHDRAWN'],
    COMPLIANCE_HOLD: ['DOCUMENT_REVIEW', 'WITHDRAWN'],
    DEPLOYED: ['WITHDRAWN'],
    WITHDRAWN: [], ARCHIVED: []
  };
  if (!ALLOWED[c.status]?.includes(toStatus)) return err(`Invalid transition: ${c.status} → ${toStatus}`, 422);
  await env.DB.batch([
    env.DB.prepare("UPDATE candidates SET status=?,updated_at=datetime('now')WHERE id=?").bind(toStatus, p.id),
    env.DB.prepare('INSERT INTO pipeline_stage_history(id,candidate_id,from_status,to_status,triggered_by_id,reason,metadata)VALUES(?,?,?,?,?,?,?)')
      .bind(cuid(), p.id, c.status, toStatus, u.id, reason || null, metadata ? JSON.stringify(metadata) : null)
  ]);
  if (toStatus === 'CLIENT_APPROVED') await provisionPortal(env, p.id);
  return json({ success: true, fromStatus: c.status, toStatus });
});

R.post('/api/v1/candidates/:id/assign-recruiter', async (req, env, ctx, p) => {
  const u = await auth(req, env); const re = role(u, 'SUPER_ADMIN', 'ADMIN'); if (re) return re;
  const { recruiterId } = await req.json();
  const r2 = await env.DB.prepare("SELECT id FROM users WHERE id=? AND role='RECRUITER' AND is_active=1").bind(recruiterId).first();
  if (!r2) return err('Recruiter not found', 404);
  await env.DB.prepare("UPDATE candidates SET assigned_recruiter_id=?,updated_at=datetime('now')WHERE id=?").bind(recruiterId, p.id).run();
  return json({ success: true });
});

R.post('/api/v1/candidates/:id/portal-invite', async (req, env, ctx, p) => {
  const u = await auth(req, env); const re = role(u, 'SUPER_ADMIN', 'ADMIN', 'RECRUITER'); if (re) return re;
  const c = await env.DB.prepare('SELECT id,email,first_name,user_id FROM candidates WHERE id=?').bind(p.id).first();
  if (!c) return err('Candidate not found', 404);
  if (c.user_id) return err('Candidate has already activated their portal', 409);
  await provisionPortal(env, p.id);
  return json({ sent: true });
});

// ═════════════════════════════════════════════════════════════════════════════
// PUBLIC FORM & SUBMISSIONS
// ═════════════════════════════════════════════════════════════════════════════

R.get('/api/v1/public/forms/:pipeline', async (req, env, ctx, p) => {
  const form = await env.DB.prepare("SELECT*FROM submission_forms WHERE(pipeline=? OR pipeline IS NULL)AND is_active=1 AND is_default=1 ORDER BY pipeline DESC LIMIT 1").bind(p.pipeline).first();
  if (!form) return err('No active form', 404);
  const { results: fields } = await env.DB.prepare('SELECT*FROM form_fields WHERE form_id=? AND is_active=1 ORDER BY sort_order').bind(form.id).all();
  return json({ ...form, fields });
});

R.post('/api/v1/public/submissions', async (req, env) => {
  const b = await req.json();
  const { formId, pipeline, data } = b;
  if (!formId || !pipeline || !data) return err('formId, pipeline, data required');
  if (!['SEA_BASED', 'LAND_BASED', 'J1_PROGRAM'].includes(pipeline)) return err('Invalid pipeline');
  const form = await env.DB.prepare('SELECT id FROM submission_forms WHERE id=? AND is_active=1').bind(formId).first();
  if (!form) return err('Form not found', 404);
  const id = cuid();
  await env.DB.prepare('INSERT INTO submissions(id,form_id,pipeline,data,ip_address,user_agent)VALUES(?,?,?,?,?,?)')
    .bind(id, formId, pipeline, JSON.stringify(data), req.headers.get('CF-Connecting-IP'), req.headers.get('User-Agent')).run();
  return json({ submissionId: id, message: 'Application received successfully' }, 201);
});

R.get('/api/v1/submissions', async (req, env, ctx, p, url) => {
  const u = await auth(req, env); const re = role(u, 'SUPER_ADMIN', 'ADMIN', 'RECRUITER'); if (re) return re;
  const pipeline = url.searchParams.get('pipeline');
  const reviewed = url.searchParams.get('reviewed');
  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1'));
  const limit = Math.min(100, parseInt(url.searchParams.get('limit') || '50'));
  const where = []; const binds = [];
  if (pipeline) { where.push('s.pipeline=?'); binds.push(pipeline); }
  if (reviewed === 'false') where.push('s.reviewed_at IS NULL');
  const wc = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const { results } = await env.DB.prepare(`SELECT s.*,f.name form_name FROM submissions s JOIN submission_forms f ON s.form_id=f.id ${wc} ORDER BY s.created_at DESC LIMIT? OFFSET?`).bind(...binds, limit, (page - 1) * limit).all();
  const tot = await env.DB.prepare(`SELECT COUNT(*)cnt FROM submissions s ${wc}`).bind(...binds).first();
  return json({ submissions: results, total: tot.cnt, page, limit });
});

R.get('/api/v1/submissions/:id', async (req, env, ctx, p) => {
  const u = await auth(req, env); const re = role(u, 'SUPER_ADMIN', 'ADMIN', 'RECRUITER'); if (re) return re;
  const s = await env.DB.prepare('SELECT s.*,f.name form_name FROM submissions s JOIN submission_forms f ON s.form_id=f.id WHERE s.id=?').bind(p.id).first();
  if (!s) return err('Not found', 404);
  return json(s);
});

R.post('/api/v1/submissions/:id/convert', async (req, env, ctx, p) => {
  const u = await auth(req, env); const re = role(u, 'SUPER_ADMIN', 'ADMIN', 'RECRUITER'); if (re) return re;
  const sub = await env.DB.prepare('SELECT*FROM submissions WHERE id=?').bind(p.id).first();
  if (!sub) return err('Not found', 404);
  const b = await req.json().catch(() => ({}));
  const d = JSON.parse(sub.data || '{}');
  const cid = cuid();
  await env.DB.batch([
    env.DB.prepare("INSERT INTO candidates(id,first_name,last_name,email,phone,pipeline,status,submission_id,assigned_recruiter_id)VALUES(?,?,?,?,?,'"+sub.pipeline+"','NEW_SUBMISSION',?,?)")
      .bind(cid, d.firstName || d.first_name || 'Unknown', d.lastName || d.last_name || '', d.email || '', d.phone || null, p.id, b.assignRecruiterId || null),
    env.DB.prepare("UPDATE submissions SET reviewed_by_id=?,reviewed_at=datetime('now')WHERE id=?").bind(u.id, p.id),
    env.DB.prepare("INSERT INTO pipeline_stage_history(id,candidate_id,from_status,to_status,triggered_by_id,reason)VALUES(?,?,NULL,'NEW_SUBMISSION',?,'Converted from submission')").bind(cuid(), cid, u.id)
  ]);
  return json({ candidateId: cid }, 201);
});

R.post('/api/v1/submissions/:id/flag-duplicate', async (req, env, ctx, p) => {
  const u = await auth(req, env); const re = role(u, 'SUPER_ADMIN', 'ADMIN', 'RECRUITER'); if (re) return re;
  const { duplicateOfCandidateId } = await req.json();
  await env.DB.prepare("UPDATE submissions SET is_duplicate=1,duplicate_of_candidate_id=?,reviewed_by_id=?,reviewed_at=datetime('now')WHERE id=?").bind(duplicateOfCandidateId || null, u.id, p.id).run();
  return json({ success: true });
});

// ═════════════════════════════════════════════════════════════════════════════
// FORM BUILDER
// ═════════════════════════════════════════════════════════════════════════════

R.get('/api/v1/forms', async (req, env) => {
  const u = await auth(req, env); const re = role(u, 'SUPER_ADMIN', 'ADMIN'); if (re) return re;
  const { results } = await env.DB.prepare('SELECT*FROM submission_forms ORDER BY created_at DESC').all();
  return json({ forms: results });
});

R.post('/api/v1/forms', async (req, env) => {
  const u = await auth(req, env); const re = role(u, 'SUPER_ADMIN', 'ADMIN'); if (re) return re;
  const { name, description, pipeline, isActive, isDefault, fields = [] } = await req.json();
  if (!name) return err('Name required');
  const fid = cuid();
  await env.DB.prepare('INSERT INTO submission_forms(id,name,description,pipeline,is_active,is_default)VALUES(?,?,?,?,?,?)')
    .bind(fid, name, description || null, pipeline || null, isActive ? 1 : 0, isDefault ? 1 : 0).run();
  for (let i = 0; i < fields.length; i++) {
    const f = fields[i];
    await env.DB.prepare('INSERT INTO form_fields(id,form_id,label,field_key,field_type,placeholder,help_text,is_required,options,file_types,max_file_size_mb,sort_order)VALUES(?,?,?,?,?,?,?,?,?,?,?,?)')
      .bind(cuid(), fid, f.label, f.fieldKey, f.fieldType, f.placeholder || null, f.helpText || null, f.isRequired ? 1 : 0, f.options ? JSON.stringify(f.options) : null, f.fileTypes ? JSON.stringify(f.fileTypes) : null, f.maxFileSizeMb || null, f.sortOrder ?? i).run();
  }
  return json({ formId: fid }, 201);
});

R.get('/api/v1/forms/:id', async (req, env, ctx, p) => {
  const u = await auth(req, env); const re = role(u, 'SUPER_ADMIN', 'ADMIN'); if (re) return re;
  const form = await env.DB.prepare('SELECT*FROM submission_forms WHERE id=?').bind(p.id).first();
  if (!form) return err('Not found', 404);
  const { results: fields } = await env.DB.prepare('SELECT*FROM form_fields WHERE form_id=? AND is_active=1 ORDER BY sort_order').bind(p.id).all();
  return json({ ...form, fields });
});

R.patch('/api/v1/forms/:id', async (req, env, ctx, p) => {
  const u = await auth(req, env); const re = role(u, 'SUPER_ADMIN', 'ADMIN'); if (re) return re;
  const b = await req.json();
  const upd = {}; if (b.name) upd.name = b.name; if (b.description !== undefined) upd.description = b.description;
  if (b.isActive !== undefined) upd.is_active = b.isActive ? 1 : 0;
  if (b.isDefault !== undefined) upd.is_default = b.isDefault ? 1 : 0;
  if (!Object.keys(upd).length) return err('No valid fields');
  upd.updated_at = new Date().toISOString();
  await env.DB.prepare(`UPDATE submission_forms SET ${Object.keys(upd).map(k => `${k}=?`).join()} WHERE id=?`).bind(...Object.values(upd), p.id).run();
  return json({ success: true });
});

R.post('/api/v1/forms/:id/fields', async (req, env, ctx, p) => {
  const u = await auth(req, env); const re = role(u, 'SUPER_ADMIN', 'ADMIN'); if (re) return re;
  const f = await req.json();
  if (!f.label || !f.fieldKey || !f.fieldType) return err('label, fieldKey, fieldType required');
  const fid = cuid();
  await env.DB.prepare('INSERT INTO form_fields(id,form_id,label,field_key,field_type,placeholder,help_text,is_required,options,file_types,sort_order)VALUES(?,?,?,?,?,?,?,?,?,?,?)')
    .bind(fid, p.id, f.label, f.fieldKey, f.fieldType, f.placeholder || null, f.helpText || null, f.isRequired ? 1 : 0, f.options ? JSON.stringify(f.options) : null, f.fileTypes ? JSON.stringify(f.fileTypes) : null, f.sortOrder || 0).run();
  return json({ fieldId: fid }, 201);
});

R.patch('/api/v1/forms/:formId/fields/:fieldId', async (req, env, ctx, p) => {
  const u = await auth(req, env); const re = role(u, 'SUPER_ADMIN', 'ADMIN'); if (re) return re;
  const b = await req.json();
  const map = { label: b.label, placeholder: b.placeholder, help_text: b.helpText, is_required: b.isRequired !== undefined ? (b.isRequired ? 1 : 0) : undefined, sort_order: b.sortOrder, is_active: b.isActive !== undefined ? (b.isActive ? 1 : 0) : undefined };
  const upd = Object.fromEntries(Object.entries(map).filter(([, v]) => v !== undefined));
  if (!Object.keys(upd).length) return err('No valid fields');
  await env.DB.prepare(`UPDATE form_fields SET ${Object.keys(upd).map(k => `${k}=?`).join()} WHERE id=? AND form_id=?`).bind(...Object.values(upd), p.fieldId, p.formId).run();
  return json({ success: true });
});

R.delete('/api/v1/forms/:formId/fields/:fieldId', async (req, env, ctx, p) => {
  const u = await auth(req, env); const re = role(u, 'SUPER_ADMIN', 'ADMIN'); if (re) return re;
  await env.DB.prepare('DELETE FROM form_fields WHERE id=? AND form_id=?').bind(p.fieldId, p.formId).run();
  return json({ success: true });
});

// ═════════════════════════════════════════════════════════════════════════════
// INTERVIEWS & BOOKING
// ═════════════════════════════════════════════════════════════════════════════

R.get('/api/v1/interviews', async (req, env) => {
  const u = await auth(req, env); const re = role(u, 'SUPER_ADMIN', 'ADMIN', 'RECRUITER'); if (re) return re;
  const { results } = await env.DB.prepare('SELECT i.*,u2.first_name fn,u2.last_name ln FROM interviews i JOIN users u2 ON i.created_by_id=u2.id WHERE i.is_active=1 ORDER BY i.created_at DESC').all();
  return json({ interviews: results });
});

R.post('/api/v1/interviews', async (req, env) => {
  const u = await auth(req, env); const re = role(u, 'SUPER_ADMIN', 'ADMIN', 'RECRUITER'); if (re) return re;
  const { type, title, description, questions, bookingConfig } = await req.json();
  if (!type || !title) return err('type and title required');
  const id = cuid();
  await env.DB.prepare('INSERT INTO interviews(id,type,title,description,created_by_id,questions,booking_config)VALUES(?,?,?,?,?,?,?)')
    .bind(id, type, title, description || null, u.id, questions ? JSON.stringify(questions) : null, bookingConfig ? JSON.stringify(bookingConfig) : null).run();
  return json({ interviewId: id }, 201);
});

R.get('/api/v1/interviews/:id', async (req, env, ctx, p) => {
  const u = await auth(req, env); const re = role(u, 'SUPER_ADMIN', 'ADMIN', 'RECRUITER'); if (re) return re;
  const i = await env.DB.prepare('SELECT*FROM interviews WHERE id=?').bind(p.id).first();
  if (!i) return err('Not found', 404);
  return json(i);
});

R.patch('/api/v1/interviews/:id', async (req, env, ctx, p) => {
  const u = await auth(req, env); const re = role(u, 'SUPER_ADMIN', 'ADMIN', 'RECRUITER'); if (re) return re;
  const b = await req.json();
  const map = { title: b.title, description: b.description !== undefined ? b.description : undefined, questions: b.questions !== undefined ? JSON.stringify(b.questions) : undefined, is_active: b.isActive !== undefined ? (b.isActive ? 1 : 0) : undefined };
  const upd = Object.fromEntries(Object.entries(map).filter(([, v]) => v !== undefined));
  if (!Object.keys(upd).length) return err('No valid fields');
  upd.updated_at = new Date().toISOString();
  await env.DB.prepare(`UPDATE interviews SET ${Object.keys(upd).map(k => `${k}=?`).join()} WHERE id=?`).bind(...Object.values(upd), p.id).run();
  return json({ success: true });
});

R.post('/api/v1/candidates/:id/interviews/invite', async (req, env, ctx, p) => {
  const u = await auth(req, env); const re = role(u, 'SUPER_ADMIN', 'ADMIN', 'RECRUITER'); if (re) return re;
  const { interviewId, expiresInHours = 72 } = await req.json();
  const [c, iview] = await Promise.all([
    env.DB.prepare('SELECT id,email,first_name FROM candidates WHERE id=?').bind(p.id).first(),
    env.DB.prepare('SELECT id,type,title FROM interviews WHERE id=? AND is_active=1').bind(interviewId).first()
  ]);
  if (!c) return err('Candidate not found', 404);
  if (!iview) return err('Interview not found', 404);
  const ciId = cuid();
  const expiresAt = new Date(Date.now() + expiresInHours * 3600000).toISOString();
  await env.DB.prepare("INSERT INTO candidate_interviews(id,candidate_id,interview_id,status,expires_at)VALUES(?,?,?,'INVITED',?)").bind(ciId, p.id, interviewId, expiresAt).run();
  const raw = genToken();
  const kvKey = iview.type === 'BOOKING' ? `booking:${await hashTok(raw)}` : `interview:${await hashTok(raw)}`;
  await env.KV.put(kvKey, JSON.stringify({ candidateId: p.id, candidateInterviewId: ciId, interviewId, expiresAt }), { expirationTtl: expiresInHours * 3600 });
  const base = 'https://putuastra.github.io/poseidon-crm';
  const link = iview.type === 'BOOKING' ? `${base}/booking.html?t=${raw}` : `${base}/interview.html?t=${raw}`;
  await sendMail(env, c.email, `POSEIDON — ${iview.title}`,
    `<div style="font-family:sans-serif;max-width:580px;margin:auto;padding:20px"><h2 style="color:#1a56db">Interview Invitation</h2><p>Dear ${c.first_name},</p><p>You have been invited to: <strong>${iview.title}</strong></p><p style="margin:24px 0"><a href="${link}" style="background:#1a56db;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;font-weight:bold">Open Now</a></p><p style="color:#6b7280;font-size:13px">Expires in ${expiresInHours} hours. — CTI Group POSEIDON</p></div>`
  );
  return json({ candidateInterviewId: ciId, link });
});

R.get('/api/v1/candidates/:id/interviews', async (req, env, ctx, p) => {
  const u = await auth(req, env); const re = role(u, 'SUPER_ADMIN', 'ADMIN', 'RECRUITER'); if (re) return re;
  const { results } = await env.DB.prepare('SELECT ci.*,i.title,i.type FROM candidate_interviews ci JOIN interviews i ON ci.interview_id=i.id WHERE ci.candidate_id=? ORDER BY ci.invited_at DESC').bind(p.id).all();
  return json({ interviews: results });
});

R.patch('/api/v1/candidates/:id/interviews/:ciId', async (req, env, ctx, p) => {
  const u = await auth(req, env); const re = role(u, 'SUPER_ADMIN', 'ADMIN', 'RECRUITER'); if (re) return re;
  const b = await req.json();
  const map = { score: b.score, passed: b.passed !== undefined ? (b.passed ? 1 : 0) : undefined, recruiter_notes: b.recruiterNotes, meeting_url: b.meetingUrl, status: b.status, scheduled_at: b.scheduledAt, completed_at: b.completedAt };
  const upd = Object.fromEntries(Object.entries(map).filter(([, v]) => v !== undefined));
  if (!Object.keys(upd).length) return err('No valid fields');
  upd.updated_at = new Date().toISOString();
  await env.DB.prepare(`UPDATE candidate_interviews SET ${Object.keys(upd).map(k => `${k}=?`).join()} WHERE id=? AND candidate_id=?`).bind(...Object.values(upd), p.ciId, p.id).run();
  return json({ success: true });
});

// Booking public routes
R.get('/api/v1/booking/:token', async (req, env, ctx, p) => {
  const h = await hashTok(p.token);
  const stored = await env.KV.get(`booking:${h}`);
  if (!stored) return err('Invalid or expired booking link', 401);
  const { expiresAt, interviewId, candidateId } = JSON.parse(stored);
  if (new Date(expiresAt) < new Date()) return err('Link expired', 401);
  const [iview, slots, candidate] = await Promise.all([
    env.DB.prepare('SELECT id,title,description,booking_config FROM interviews WHERE id=?').bind(interviewId).first(),
    env.DB.prepare("SELECT id,start_time,end_time FROM booking_slots WHERE interview_id=? AND is_booked=0 AND is_blocked=0 AND start_time>datetime('now') ORDER BY start_time ASC LIMIT 60").bind(interviewId).all(),
    candidateId ? env.DB.prepare('SELECT first_name,last_name,email,pipeline FROM candidates WHERE id=?').bind(candidateId).first() : Promise.resolve(null)
  ]);
  return json({ interview: iview, availableSlots: slots.results, candidate });
});

R.post('/api/v1/booking/:token/confirm', async (req, env, ctx, p) => {
  const { slotId } = await req.json();
  if (!slotId) return err('slotId required');
  const h = await hashTok(p.token);
  const stored = await env.KV.get(`booking:${h}`);
  if (!stored) return err('Invalid link', 401);
  const { expiresAt, candidateInterviewId, candidateId, interviewId } = JSON.parse(stored);
  if (new Date(expiresAt) < new Date()) return err('Link expired', 401);
  const slot = await env.DB.prepare('SELECT*FROM booking_slots WHERE id=? AND is_booked=0 AND is_blocked=0').bind(slotId).first();
  if (!slot) return err('Slot no longer available', 409);
  await env.DB.batch([
    env.DB.prepare('UPDATE booking_slots SET is_booked=1 WHERE id=?').bind(slotId),
    env.DB.prepare("UPDATE candidate_interviews SET status='BOOKING_CONFIRMED',booking_slot_id=?,scheduled_at=?,updated_at=datetime('now')WHERE id=?").bind(slotId, slot.start_time, candidateInterviewId),
    env.DB.prepare("UPDATE candidates SET status='BOOKING_CONFIRMED',updated_at=datetime('now')WHERE id=?").bind(candidateId),
    env.DB.prepare("INSERT INTO pipeline_stage_history(id,candidate_id,from_status,to_status,reason)VALUES(?,?,'BOOKING_INVITED','BOOKING_CONFIRMED','Candidate booked a slot')").bind(cuid(), candidateId),
    env.DB.prepare("UPDATE booking_slots SET is_blocked=1,block_reason='Global calendar conflict' WHERE interview_id!=? AND is_booked=0 AND start_time<? AND end_time>?").bind(interviewId, slot.end_time, slot.start_time)
  ]);
  await env.KV.delete(`booking:${h}`);
  return json({ success: true, scheduledAt: slot.start_time });
});

R.get('/api/v1/interviews/:id/slots', async (req, env, ctx, p, url) => {
  const u = await auth(req, env); const re = role(u, 'SUPER_ADMIN', 'ADMIN', 'RECRUITER'); if (re) return re;
  const from = url.searchParams.get('from') || new Date().toISOString();
  const to = url.searchParams.get('to') || new Date(Date.now() + 30 * 86400000).toISOString();
  const { results } = await env.DB.prepare('SELECT bs.*,ci.candidate_id FROM booking_slots bs LEFT JOIN candidate_interviews ci ON ci.booking_slot_id=bs.id WHERE bs.interview_id=? AND bs.start_time>=? AND bs.start_time<=? ORDER BY bs.start_time').bind(p.id, from, to).all();
  return json({ slots: results });
});

R.post('/api/v1/interviews/:id/slots/bulk', async (req, env, ctx, p) => {
  const u = await auth(req, env); const re = role(u, 'SUPER_ADMIN', 'ADMIN', 'RECRUITER'); if (re) return re;
  const { slots } = await req.json();
  if (!Array.isArray(slots) || !slots.length) return err('slots array required');
  await env.DB.batch(slots.map(s => env.DB.prepare('INSERT OR IGNORE INTO booking_slots(id,interview_id,start_time,end_time)VALUES(?,?,?,?)').bind(cuid(), p.id, s.startTime, s.endTime)));
  return json({ created: slots.length });
});

R.delete('/api/v1/interviews/:id/slots/:slotId', async (req, env, ctx, p) => {
  const u = await auth(req, env); const re = role(u, 'SUPER_ADMIN', 'ADMIN', 'RECRUITER'); if (re) return re;
  await env.DB.prepare('DELETE FROM booking_slots WHERE id=? AND interview_id=? AND is_booked=0').bind(p.slotId, p.id).run();
  return json({ success: true });
});

// ═════════════════════════════════════════════════════════════════════════════
// CLIENTS & ENDORSEMENTS
// ═════════════════════════════════════════════════════════════════════════════

R.get('/api/v1/clients', async (req, env, ctx, p, url) => {
  const u = await auth(req, env); const re = role(u, 'SUPER_ADMIN', 'ADMIN', 'RECRUITER'); if (re) return re;
  const type = url.searchParams.get('type');
  const where = []; const binds = [];
  if (type) { where.push('type=?'); binds.push(type); }
  const wc = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const { results } = await env.DB.prepare(`SELECT*FROM clients ${wc} ORDER BY name`).bind(...binds).all();
  return json({ clients: results });
});

R.post('/api/v1/clients', async (req, env) => {
  const u = await auth(req, env); const re = role(u, 'SUPER_ADMIN', 'ADMIN'); if (re) return re;
  const { name, type, country, website, logoUrl, contactEmail, contactPhone, notes } = await req.json();
  if (!name || !type) return err('name and type required');
  const id = cuid();
  await env.DB.prepare('INSERT INTO clients(id,name,type,country,website,logo_url,contact_email,contact_phone,notes)VALUES(?,?,?,?,?,?,?,?,?)')
    .bind(id, name, type, country || null, website || null, logoUrl || null, contactEmail || null, contactPhone || null, notes || null).run();
  return json({ clientId: id }, 201);
});

R.get('/api/v1/clients/:id', async (req, env, ctx, p) => {
  const u = await auth(req, env); const re = role(u, 'SUPER_ADMIN', 'ADMIN', 'RECRUITER'); if (re) return re;
  const c = await env.DB.prepare('SELECT*FROM clients WHERE id=?').bind(p.id).first();
  if (!c) return err('Not found', 404);
  const { results: contacts } = await env.DB.prepare('SELECT cc.*,u.first_name,u.last_name,u.email FROM client_contacts cc JOIN users u ON cc.user_id=u.id WHERE cc.client_id=?').bind(p.id).all();
  return json({ ...c, contacts });
});

R.patch('/api/v1/clients/:id', async (req, env, ctx, p) => {
  const u = await auth(req, env); const re = role(u, 'SUPER_ADMIN', 'ADMIN'); if (re) return re;
  const b = await req.json();
  const map = { name: b.name, type: b.type, country: b.country, website: b.website, logo_url: b.logoUrl, contact_email: b.contactEmail, contact_phone: b.contactPhone, notes: b.notes, is_active: b.isActive !== undefined ? (b.isActive ? 1 : 0) : undefined };
  const upd = Object.fromEntries(Object.entries(map).filter(([, v]) => v !== undefined));
  if (!Object.keys(upd).length) return err('No valid fields');
  upd.updated_at = new Date().toISOString();
  await env.DB.prepare(`UPDATE clients SET ${Object.keys(upd).map(k => `${k}=?`).join()} WHERE id=?`).bind(...Object.values(upd), p.id).run();
  return json({ success: true });
});

R.post('/api/v1/clients/:id/contacts', async (req, env, ctx, p) => {
  const u = await auth(req, env); const re = role(u, 'SUPER_ADMIN', 'ADMIN'); if (re) return re;
  const { userId } = await req.json();
  if (!userId) return err('userId required');
  const user = await env.DB.prepare("SELECT id,role FROM users WHERE id=? AND is_active=1").bind(userId).first();
  if (!user) return err('User not found', 404);
  if (user.role !== 'CLIENT_CONTACT') return err('User must have CLIENT_CONTACT role');
  try {
    await env.DB.prepare('INSERT INTO client_contacts(id,client_id,user_id)VALUES(?,?,?)').bind(cuid(), p.id, userId).run();
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) return err('This user is already linked to a client', 409);
    throw e;
  }
  return json({ success: true }, 201);
});

R.delete('/api/v1/clients/:id/contacts/:userId', async (req, env, ctx, p) => {
  const u = await auth(req, env); const re = role(u, 'SUPER_ADMIN', 'ADMIN'); if (re) return re;
  await env.DB.prepare('DELETE FROM client_contacts WHERE client_id=? AND user_id=?').bind(p.id, p.userId).run();
  return json({ success: true });
});

R.post('/api/v1/candidates/:id/endorse', async (req, env, ctx, p) => {
  const u = await auth(req, env); const re = role(u, 'SUPER_ADMIN', 'ADMIN', 'RECRUITER'); if (re) return re;
  const { clientIds } = await req.json();
  if (!Array.isArray(clientIds) || !clientIds.length) return err('clientIds array required');
  const c = await env.DB.prepare('SELECT id,status FROM candidates WHERE id=?').bind(p.id).first();
  if (!c) return err('Not found', 404);
  if (c.status !== 'PRE_QUAL_APPROVED') return err('Candidate must be PRE_QUAL_APPROVED', 422);
  for (const cid of clientIds) {
    const ex = await env.DB.prepare('SELECT id FROM client_endorsements WHERE candidate_id=? AND client_id=?').bind(p.id, cid).first();
    if (!ex) await env.DB.prepare('INSERT INTO client_endorsements(id,candidate_id,client_id)VALUES(?,?,?)').bind(cuid(), p.id, cid).run();
  }
  await env.DB.batch([
    env.DB.prepare("UPDATE candidates SET status='ENDORSED',updated_at=datetime('now')WHERE id=?").bind(p.id),
    env.DB.prepare("INSERT INTO pipeline_stage_history(id,candidate_id,from_status,to_status,triggered_by_id,reason)VALUES(?,?,'PRE_QUAL_APPROVED','ENDORSED',?,?)").bind(cuid(), p.id, u.id, `Endorsed to ${clientIds.length} client(s)`)
  ]);
  return json({ success: true, endorsedTo: clientIds.length });
});

R.get('/api/v1/candidates/:id/endorsements', async (req, env, ctx, p) => {
  const u = await auth(req, env); const re = role(u, 'SUPER_ADMIN', 'ADMIN', 'RECRUITER'); if (re) return re;
  const { results } = await env.DB.prepare('SELECT ce.*,cl.name client_name,cl.type client_type FROM client_endorsements ce JOIN clients cl ON ce.client_id=cl.id WHERE ce.candidate_id=?').bind(p.id).all();
  return json({ endorsements: results });
});

R.patch('/api/v1/endorsements/:id', async (req, env, ctx, p) => {
  const u = await auth(req, env); const re = role(u, 'SUPER_ADMIN', 'ADMIN', 'CLIENT_CONTACT'); if (re) return re;
  const { status, decisionNotes, scheduledAt, interviewUrl } = await req.json();
  const VALID = ['PENDING', 'SCHEDULED', 'COMPLETED', 'REJECTED', 'APPROVED', 'WITHDRAWN'];
  if (status && !VALID.includes(status)) return err('Invalid status');
  const e = await env.DB.prepare('SELECT*FROM client_endorsements WHERE id=?').bind(p.id).first();
  if (!e) return err('Not found', 404);
  if (u.role === 'CLIENT_CONTACT') {
    const cc = await env.DB.prepare('SELECT client_id FROM client_contacts WHERE user_id=?').bind(u.id).first();
    if (!cc || cc.client_id !== e.client_id) return err('Forbidden', 403);
  }
  const upd = {}; if (status) { upd.status = status; upd.decided_at = new Date().toISOString(); }
  if (decisionNotes) upd.decision_notes = decisionNotes; if (scheduledAt) upd.scheduled_at = scheduledAt; if (interviewUrl) upd.interview_url = interviewUrl;
  upd.updated_at = new Date().toISOString();
  await env.DB.prepare(`UPDATE client_endorsements SET ${Object.keys(upd).map(k => `${k}=?`).join()} WHERE id=?`).bind(...Object.values(upd), p.id).run();
  if (status === 'APPROVED') {
    const cand = await env.DB.prepare('SELECT status FROM candidates WHERE id=?').bind(e.candidate_id).first();
    if (cand?.status === 'ENDORSED') {
      await env.DB.batch([
        env.DB.prepare("UPDATE candidates SET status='CLIENT_APPROVED',updated_at=datetime('now')WHERE id=?").bind(e.candidate_id),
        env.DB.prepare("INSERT INTO pipeline_stage_history(id,candidate_id,from_status,to_status,triggered_by_id,reason)VALUES(?,?,'ENDORSED','CLIENT_APPROVED',?,?)").bind(cuid(), e.candidate_id, u.id, 'Client approved')
      ]);
      await provisionPortal(env, e.candidate_id);
    }
  }
  return json({ success: true });
});

R.get('/api/v1/clients/:id/endorsements', async (req, env, ctx, p, url) => {
  const u = await auth(req, env); const re = role(u, 'SUPER_ADMIN', 'ADMIN', 'CLIENT_CONTACT'); if (re) return re;
  if (u.role === 'CLIENT_CONTACT') {
    const cc = await env.DB.prepare('SELECT client_id FROM client_contacts WHERE user_id=?').bind(u.id).first();
    if (!cc || cc.client_id !== p.id) return err('Forbidden', 403);
  }
  const { results } = await env.DB.prepare('SELECT ce.*,c.first_name,c.last_name,c.email,c.pipeline FROM client_endorsements ce JOIN candidates c ON ce.candidate_id=c.id WHERE ce.client_id=? ORDER BY ce.endorsed_at DESC').bind(p.id).all();
  return json({ endorsements: results });
});

// ═════════════════════════════════════════════════════════════════════════════
// DOCUMENTS & ONEDRIVE
// ═════════════════════════════════════════════════════════════════════════════

R.get('/api/v1/candidates/:id/documents', async (req, env, ctx, p) => {
  const u = await auth(req, env);
  if (!u) return err('Unauthorized', 401);
  if (u.role === 'CANDIDATE') {
    const c = await env.DB.prepare('SELECT id FROM candidates WHERE user_id=?').bind(u.id).first();
    if (!c || c.id !== p.id) return err('Forbidden', 403);
  } else { const re = role(u, 'SUPER_ADMIN', 'ADMIN', 'RECRUITER'); if (re) return re; }
  const { results } = await env.DB.prepare('SELECT*FROM documents WHERE candidate_id=? ORDER BY created_at DESC').bind(p.id).all();
  return json({ documents: results });
});

R.post('/api/v1/candidates/:id/documents/upload-session', async (req, env, ctx, p) => {
  const u = await auth(req, env);
  if (!u) return err('Unauthorized', 401);
  let cid = p.id;
  if (u.role === 'CANDIDATE') {
    const c = await env.DB.prepare('SELECT id FROM candidates WHERE user_id=?').bind(u.id).first();
    if (!c || c.id !== p.id) return err('Forbidden', 403);
    cid = c.id;
  }
  const { type, label, fileName, fileSizeBytes, mimeType } = await req.json();
  if (!type || !label || !fileName) return err('type, label, fileName required');
  if (fileSizeBytes > 20 * 1024 * 1024) return err('Max file size 20MB');
  const ALLOWED_MIME = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'];
  if (mimeType && !ALLOWED_MIME.includes(mimeType)) return err('File type not allowed');
  const docId = cuid();
  const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
  const odPath = `/POSEIDON/${cid}/${type}/${docId}_${safeName}`;
  const gt = await graphToken(env);
  const sr = await fetch(`https://graph.microsoft.com/v1.0/users/${env.ONEDRIVE_USER}/drive/root:${odPath}:/createUploadSession`, {
    method: 'POST', headers: { Authorization: `Bearer ${gt}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ item: { '@microsoft.graph.conflictBehavior': 'rename', name: safeName } })
  });
  if (!sr.ok) return err('Failed to create upload session', 500);
  const sd = await sr.json();
  await env.DB.prepare('INSERT INTO documents(id,candidate_id,type,label,file_name,file_size_bytes,mime_type,onedrive_path,uploaded_by)VALUES(?,?,?,?,?,?,?,?,?)')
    .bind(docId, cid, type, label, fileName, fileSizeBytes || null, mimeType || null, odPath, u.role === 'CANDIDATE' ? 'CANDIDATE' : 'ADMIN').run();
  return json({ sessionId: docId, uploadUrl: sd.uploadUrl, expiresAt: sd.expirationDateTime });
});

R.post('/api/v1/candidates/:id/documents/:docId/confirm-upload', async (req, env, ctx, p) => {
  const u = await auth(req, env);
  if (!u) return err('Unauthorized', 401);
  const { oneDriveFileId } = await req.json();
  if (!oneDriveFileId) return err('oneDriveFileId required');
  const gt = await graphToken(env);
  const fr = await fetch(`https://graph.microsoft.com/v1.0/users/${env.ONEDRIVE_USER}/drive/items/${oneDriveFileId}`, { headers: { Authorization: `Bearer ${gt}` } });
  if (!fr.ok) return err('File not found in OneDrive', 400);
  const fd = await fr.json();
  await env.DB.prepare("UPDATE documents SET onedrive_file_id=?,onedrive_url=?,updated_at=datetime('now')WHERE id=? AND candidate_id=?")
    .bind(oneDriveFileId, fd.webUrl, p.docId, p.id).run();
  return json({ success: true, oneDriveUrl: fd.webUrl });
});

R.patch('/api/v1/candidates/:id/documents/:docId', async (req, env, ctx, p) => {
  const u = await auth(req, env); const re = role(u, 'SUPER_ADMIN', 'ADMIN'); if (re) return re;
  const b = await req.json();
  const map = { label: b.label, document_number: b.documentNumber, issuance_date: b.issuanceDate, expiration_date: b.expirationDate, notes: b.notes };
  const upd = Object.fromEntries(Object.entries(map).filter(([, v]) => v !== undefined));
  if (!Object.keys(upd).length) return err('No valid fields');
  upd.updated_at = new Date().toISOString();
  await env.DB.prepare(`UPDATE documents SET ${Object.keys(upd).map(k => `${k}=?`).join()} WHERE id=? AND candidate_id=?`).bind(...Object.values(upd), p.docId, p.id).run();
  return json({ success: true });
});

R.post('/api/v1/candidates/:id/documents/:docId/verify', async (req, env, ctx, p) => {
  const u = await auth(req, env); const re = role(u, 'SUPER_ADMIN', 'ADMIN'); if (re) return re;
  await env.DB.prepare("UPDATE documents SET is_verified=1,verified_at=datetime('now'),verified_by_id=?,updated_at=datetime('now')WHERE id=? AND candidate_id=?").bind(u.id, p.docId, p.id).run();
  return json({ success: true });
});

R.get('/api/v1/candidates/:id/documents/:docId/download-url', async (req, env, ctx, p) => {
  const u = await auth(req, env);
  if (!u) return err('Unauthorized', 401);
  const doc = await env.DB.prepare('SELECT*FROM documents WHERE id=? AND candidate_id=?').bind(p.docId, p.id).first();
  if (!doc || !doc.onedrive_file_id) return err('Document not found', 404);
  const gt = await graphToken(env);
  const fr = await fetch(`https://graph.microsoft.com/v1.0/users/${env.ONEDRIVE_USER}/drive/items/${doc.onedrive_file_id}`, { headers: { Authorization: `Bearer ${gt}` } });
  if (!fr.ok) return err('File not found', 404);
  const fd = await fr.json();
  return json({ downloadUrl: fd['@microsoft.graph.downloadUrl'] || fd.webUrl, fileName: doc.file_name, expiresIn: 3600 });
});

// ═════════════════════════════════════════════════════════════════════════════
// CANDIDATE PORTAL
// ═════════════════════════════════════════════════════════════════════════════

R.get('/api/v1/portal/me', async (req, env) => {
  const u = await auth(req, env); const re = role(u, 'CANDIDATE'); if (re) return re;
  const c = await env.DB.prepare('SELECT*FROM candidates WHERE user_id=?').bind(u.id).first();
  if (!c) return err('Profile not found', 404);
  const [docs, hist] = await Promise.all([
    env.DB.prepare('SELECT id,type,label,document_number,issuance_date,expiration_date,file_name,is_verified,created_at FROM documents WHERE candidate_id=? ORDER BY created_at DESC').bind(c.id).all(),
    env.DB.prepare('SELECT from_status,to_status,created_at FROM pipeline_stage_history WHERE candidate_id=? ORDER BY created_at ASC').bind(c.id).all()
  ]);
  return json({ ...c, documents: docs.results, stageHistory: hist.results });
});

R.patch('/api/v1/portal/me', async (req, env) => {
  const u = await auth(req, env); const re = role(u, 'CANDIDATE'); if (re) return re;
  const c = await env.DB.prepare('SELECT id FROM candidates WHERE user_id=?').bind(u.id).first();
  if (!c) return err('Not found', 404);
  const b = await req.json();
  const map = {
    first_name: b.first_name, last_name: b.last_name, phone: b.phone,
    nationality: b.nationality, date_of_birth: b.date_of_birth,
    address: b.address, years_experience: b.years_experience
  };
  const upd = Object.fromEntries(Object.entries(map).filter(([, v]) => v !== undefined && v !== null));
  if (!Object.keys(upd).length) return err('No valid fields');
  upd.updated_at = new Date().toISOString();
  await env.DB.prepare(`UPDATE candidates SET ${Object.keys(upd).map(k => `${k}=?`).join()} WHERE id=?`).bind(...Object.values(upd), c.id).run();
  const updated = await env.DB.prepare('SELECT*FROM candidates WHERE id=?').bind(c.id).first();
  return json({ candidate: updated });
});

// ═════════════════════════════════════════════════════════════════════════════
// J1 TRAINING PLAN
// ═════════════════════════════════════════════════════════════════════════════

R.get('/api/v1/candidates/:id/j1-plan', async (req, env, ctx, p) => {
  const u = await auth(req, env); const re = role(u, 'SUPER_ADMIN', 'ADMIN', 'RECRUITER'); if (re) return re;
  const plan = await env.DB.prepare('SELECT*FROM j1_training_plans WHERE candidate_id=?').bind(p.id).first();
  return json(plan || {});
});

R.put('/api/v1/candidates/:id/j1-plan', async (req, env, ctx, p) => {
  const u = await auth(req, env); const re = role(u, 'SUPER_ADMIN', 'ADMIN', 'RECRUITER'); if (re) return re;
  const b = await req.json();
  const ex = await env.DB.prepare('SELECT id FROM j1_training_plans WHERE candidate_id=?').bind(p.id).first();
  const cols = { ds2019_number: b.ds2019Number, sevis_id: b.sevisId, program_start: b.programStart, program_end: b.programEnd, host_organization: b.hostOrganization, supervisor_name: b.supervisorName, supervisor_email: b.supervisorEmail, supervisor_phone: b.supervisorPhone, occupational_category: b.occupationalCategory, training_phases: b.trainingPhases ? JSON.stringify(b.trainingPhases) : undefined, dos_submitted_at: b.dosSubmittedAt, dos_approved_at: b.dosApprovedAt };
  const upd = Object.fromEntries(Object.entries(cols).filter(([, v]) => v !== undefined));
  if (ex) {
    upd.updated_at = new Date().toISOString();
    await env.DB.prepare(`UPDATE j1_training_plans SET ${Object.keys(upd).map(k => `${k}=?`).join()} WHERE candidate_id=?`).bind(...Object.values(upd), p.id).run();
  } else {
    const id = cuid(); const keys = ['id', 'candidate_id', ...Object.keys(upd)];
    await env.DB.prepare(`INSERT INTO j1_training_plans(${keys.join()})VALUES(${keys.map(() => '?').join()})`).bind(id, p.id, ...Object.values(upd)).run();
  }
  return json({ success: true });
});

// ═════════════════════════════════════════════════════════════════════════════
// USERS (Admin)
// ═════════════════════════════════════════════════════════════════════════════

R.get('/api/v1/users', async (req, env) => {
  const u = await auth(req, env); const re = role(u, 'SUPER_ADMIN', 'ADMIN'); if (re) return re;
  const { results } = await env.DB.prepare("SELECT id,email,role,first_name,last_name,is_active,last_login_at,created_at FROM users WHERE role!='CANDIDATE' ORDER BY created_at DESC").all();
  return json({ users: results });
});

R.post('/api/v1/users', async (req, env) => {
  const u = await auth(req, env); const re = role(u, 'SUPER_ADMIN', 'ADMIN'); if (re) return re;
  const { email, firstName, lastName, role: newRole, password } = await req.json();
  if (!email || !firstName || !lastName || !newRole) return err('All fields required');
  const VALID_ROLES = ['ADMIN', 'RECRUITER', 'CLIENT_CONTACT'];
  if (!VALID_ROLES.includes(newRole)) return err('Invalid role');
  const id = cuid();
  let pwh = null; let tempPw = null;
  if (password) { pwh = await pwHash(password); }
  else { tempPw = genToken().slice(0, 16); pwh = await pwHash(tempPw); }
  await env.DB.prepare('INSERT INTO users(id,email,password_hash,role,first_name,last_name)VALUES(?,?,?,?,?,?)').bind(id, email, pwh, newRole, firstName, lastName).run();
  return json({ userId: id, tempPassword: tempPw }, 201);
});

R.patch('/api/v1/users/:id', async (req, env, ctx, p) => {
  const u = await auth(req, env); const re = role(u, 'SUPER_ADMIN', 'ADMIN'); if (re) return re;
  const b = await req.json();
  const map = { first_name: b.firstName, last_name: b.lastName, is_active: b.isActive !== undefined ? (b.isActive ? 1 : 0) : undefined };
  const upd = Object.fromEntries(Object.entries(map).filter(([, v]) => v !== undefined));
  if (b.password) upd.password_hash = await pwHash(b.password);
  if (!Object.keys(upd).length) return err('No valid fields');
  upd.updated_at = new Date().toISOString();
  await env.DB.prepare(`UPDATE users SET ${Object.keys(upd).map(k => `${k}=?`).join()} WHERE id=?`).bind(...Object.values(upd), p.id).run();
  return json({ success: true });
});

// ═════════════════════════════════════════════════════════════════════════════
// ONE-WAY INTERVIEW (public token)
// ═════════════════════════════════════════════════════════════════════════════

R.get('/api/v1/interview/:token', async (req, env, ctx, p) => {
  const h = await hashTok(p.token);
  const stored = await env.KV.get(`interview:${h}`);
  if (!stored) return err('Invalid or expired link', 401);
  const { expiresAt, interviewId, candidateId, candidateInterviewId } = JSON.parse(stored);
  if (new Date(expiresAt) < new Date()) return err('Link expired', 401);
  const [iview, ci, candidate] = await Promise.all([
    env.DB.prepare('SELECT id,title,description,type,questions FROM interviews WHERE id=?').bind(interviewId).first(),
    env.DB.prepare('SELECT status FROM candidate_interviews WHERE id=?').bind(candidateInterviewId).first(),
    candidateId ? env.DB.prepare('SELECT first_name,last_name,pipeline FROM candidates WHERE id=?').bind(candidateId).first() : Promise.resolve(null)
  ]);
  if (!iview) return err('Interview not found', 404);
  if (ci?.status === 'SUBMITTED' || ci?.status === 'COMPLETED') return err('Already submitted', 409);
  return json({ interview: { ...iview, questions: iview.questions ? JSON.parse(iview.questions) : [] }, candidate, expiresAt });
});

R.post('/api/v1/interview/:token/submit', async (req, env, ctx, p) => {
  const h = await hashTok(p.token);
  const stored = await env.KV.get(`interview:${h}`);
  if (!stored) return err('Invalid or expired link', 401);
  const { expiresAt, candidateId, candidateInterviewId } = JSON.parse(stored);
  if (new Date(expiresAt) < new Date()) return err('Link expired', 401);
  const { answers } = await req.json();
  if (!answers || typeof answers !== 'object') return err('answers required');
  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare("UPDATE candidate_interviews SET status='SUBMITTED',submitted_at=?,answers=?,updated_at=? WHERE id=?")
      .bind(now, JSON.stringify(answers), now, candidateInterviewId),
    env.DB.prepare("UPDATE candidates SET status='OWI_SUBMITTED',updated_at=? WHERE id=? AND status='OWI_INVITED'")
      .bind(now, candidateId),
    env.DB.prepare("INSERT INTO pipeline_stage_history(id,candidate_id,from_status,to_status,reason)VALUES(?,?,'OWI_INVITED','OWI_SUBMITTED','Interview submitted by candidate')")
      .bind(cuid(), candidateId)
  ]);
  await env.KV.delete(`interview:${h}`);
  return json({ success: true });
});

// ═════════════════════════════════════════════════════════════════════════════
// CLIENT PORTAL
// ═════════════════════════════════════════════════════════════════════════════

R.get('/api/v1/portal/client', async (req, env, ctx, p, url) => {
  const u = await auth(req, env); const re = role(u, 'CLIENT_CONTACT'); if (re) return re;
  const cc = await env.DB.prepare('SELECT cc.*,cl.name client_name,cl.type client_type,cl.country,cl.logo_url FROM client_contacts cc JOIN clients cl ON cc.client_id=cl.id WHERE cc.user_id=?').bind(u.id).first();
  if (!cc) return err('Client contact record not found', 404);
  const status = url.searchParams.get('status');
  let q = 'SELECT ce.*,c.first_name,c.last_name,c.email,c.pipeline,c.nationality,c.date_of_birth FROM client_endorsements ce JOIN candidates c ON ce.candidate_id=c.id WHERE ce.client_id=?';
  const binds = [cc.client_id];
  if (status) { q += ' AND ce.status=?'; binds.push(status); }
  q += ' ORDER BY ce.endorsed_at DESC';
  const { results } = await env.DB.prepare(q).bind(...binds).all();
  return json({ client: { id: cc.client_id, name: cc.client_name, type: cc.client_type, country: cc.country, logo_url: cc.logo_url }, user: { id: u.id, email: u.email, firstName: u.firstName, lastName: u.lastName }, endorsements: results });
});

// ═════════════════════════════════════════════════════════════════════════════
// DASHBOARD STATS
// ═════════════════════════════════════════════════════════════════════════════

R.get('/api/v1/stats', async (req, env) => {
  const u = await auth(req, env); const re = role(u, 'SUPER_ADMIN', 'ADMIN', 'RECRUITER'); if (re) return re;
  const recruiterFilter = u.role === 'RECRUITER' ? 'AND assigned_recruiter_id=?' : '';
  const rb = u.role === 'RECRUITER' ? [u.id] : [];
  const [total, byPipeline, byStatus, recent, deployed] = await Promise.all([
    env.DB.prepare(`SELECT COUNT(*) cnt FROM candidates WHERE 1=1 ${recruiterFilter}`).bind(...rb).first(),
    env.DB.prepare(`SELECT pipeline,COUNT(*)cnt FROM candidates WHERE 1=1 ${recruiterFilter} GROUP BY pipeline`).bind(...rb).all(),
    env.DB.prepare(`SELECT status,COUNT(*)cnt FROM candidates WHERE 1=1 ${recruiterFilter} GROUP BY status ORDER BY cnt DESC LIMIT 10`).bind(...rb).all(),
    env.DB.prepare(`SELECT COUNT(*)cnt FROM candidates WHERE created_at>=datetime('now','-30 days') ${recruiterFilter}`).bind(...rb).first(),
    env.DB.prepare(`SELECT COUNT(*)cnt FROM candidates WHERE status='DEPLOYED' ${recruiterFilter}`).bind(...rb).first()
  ]);
  const pending = await env.DB.prepare("SELECT COUNT(*)cnt FROM submissions WHERE reviewed_at IS NULL").first();
  return json({
    total: total.cnt,
    deployed: deployed.cnt,
    recentSubmissions: recent.cnt,
    pendingSubmissions: pending.cnt,
    byPipeline: Object.fromEntries((byPipeline.results || []).map(r => [r.pipeline, r.cnt])),
    byStatus: byStatus.results || []
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// CANDIDATE HISTORY (portal-accessible)
// ═════════════════════════════════════════════════════════════════════════════

R.get('/api/v1/candidates/:id/history', async (req, env, ctx, p) => {
  const u = await auth(req, env);
  if (!u) return err('Unauthorized', 401);
  if (u.role === 'CANDIDATE') {
    const c = await env.DB.prepare('SELECT id FROM candidates WHERE user_id=?').bind(u.id).first();
    if (!c || c.id !== p.id) return err('Forbidden', 403);
  } else { const re = role(u, 'SUPER_ADMIN', 'ADMIN', 'RECRUITER'); if (re) return re; }
  const { results } = await env.DB.prepare(
    'SELECT h.*,u2.first_name fn,u2.last_name ln FROM pipeline_stage_history h LEFT JOIN users u2 ON h.triggered_by_id=u2.id WHERE h.candidate_id=? ORDER BY h.created_at DESC LIMIT 50'
  ).bind(p.id).all();
  return json({ history: results });
});

// ═════════════════════════════════════════════════════════════════════════════
// NOTIFICATIONS
// ═════════════════════════════════════════════════════════════════════════════

R.get('/api/v1/notifications', async (req, env, ctx, p, url) => {
  const u = await auth(req, env); if (!u) return err('Unauthorized', 401);
  const unreadOnly = url.searchParams.get('unread') === '1';
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '50'), 100);
  const q = unreadOnly
    ? 'SELECT*FROM notifications WHERE user_id=? AND is_read=0 ORDER BY created_at DESC LIMIT ?'
    : 'SELECT*FROM notifications WHERE user_id=? ORDER BY created_at DESC LIMIT ?';
  const { results } = await env.DB.prepare(q).bind(u.id, limit).all();
  const unreadCount = await env.DB.prepare('SELECT COUNT(*) cnt FROM notifications WHERE user_id=? AND is_read=0').bind(u.id).first();
  return json({ notifications: results, unreadCount: unreadCount?.cnt || 0 });
});

R.patch('/api/v1/notifications/:id/read', async (req, env, ctx, p) => {
  const u = await auth(req, env); if (!u) return err('Unauthorized', 401);
  await env.DB.prepare("UPDATE notifications SET is_read=1 WHERE id=? AND user_id=?").bind(p.id, u.id).run();
  return json({ success: true });
});

R.post('/api/v1/notifications/mark-all-read', async (req, env) => {
  const u = await auth(req, env); if (!u) return err('Unauthorized', 401);
  await env.DB.prepare("UPDATE notifications SET is_read=1 WHERE user_id=? AND is_read=0").bind(u.id).run();
  return json({ success: true });
});

// ═════════════════════════════════════════════════════════════════════════════
// REPORTS / EXPORT
// ═════════════════════════════════════════════════════════════════════════════

R.get('/api/v1/reports/candidates.csv', async (req, env, ctx, p, url) => {
  const u = await auth(req, env); const re = role(u, 'SUPER_ADMIN', 'ADMIN', 'RECRUITER'); if (re) return re;
  const pipeline = url.searchParams.get('pipeline');
  const status   = url.searchParams.get('status');
  let q = 'SELECT c.*,u2.first_name rn,u2.last_name rl FROM candidates c LEFT JOIN users u2 ON c.assigned_recruiter_id=u2.id WHERE 1=1';
  const binds = [];
  if (pipeline) { q += ' AND c.pipeline=?'; binds.push(pipeline); }
  if (status)   { q += ' AND c.status=?';   binds.push(status); }
  q += ' ORDER BY c.created_at DESC LIMIT 2000';
  const { results } = await env.DB.prepare(q).bind(...binds).all();
  const cols = ['id','first_name','last_name','email','phone','pipeline','status','nationality','date_of_birth','created_at'];
  const header = cols.join(',');
  const csvEsc = v => { const s = String(v ?? ''); return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g,'""')}"` : s; };
  const rows = results.map(r => cols.map(c => csvEsc(r[c])).join(','));
  const csv = [header, ...rows].join('\r\n');
  return new Response(csv, { status: 200, headers: { 'Content-Type': 'text/csv', 'Content-Disposition': 'attachment; filename="candidates.csv"' } });
});

// ═════════════════════════════════════════════════════════════════════════════
// INTERNAL
// ═════════════════════════════════════════════════════════════════════════════

async function provisionPortal(env, candidateId) {
  const c = await env.DB.prepare('SELECT id,email,first_name,user_id FROM candidates WHERE id=?').bind(candidateId).first();
  if (!c || c.user_id) return;
  const raw = genToken();
  const h = await hashTok(raw);
  const exp = new Date(Date.now() + 72 * 3600000).toISOString();
  await env.KV.put(`activation:${h}`, JSON.stringify({ candidateId, expiresAt: exp }), { expirationTtl: 72 * 3600 });
  const link = `https://putuastra.github.io/poseidon-crm/portal.html?activate=${raw}`;
  await sendMail(env, c.email, 'POSEIDON — Activate Your Candidate Portal',
    `<div style="font-family:sans-serif;max-width:580px;margin:auto;padding:32px"><img src="https://putuastra.github.io/poseidon-crm/logo.png" height="40" alt="CTI POSEIDON"><h2 style="color:#1a56db;margin-top:24px">Congratulations, ${c.first_name}!</h2><p>You have been approved. Your personal candidate portal is now ready.</p><p style="margin:28px 0;text-align:center"><a href="${link}" style="background:#1a56db;color:#fff;padding:14px 32px;border-radius:8px;text-decoration:none;font-size:15px;font-weight:600;display:inline-block">Activate My Portal</a></p><p style="color:#6b7280;font-size:13px">This link expires in 72 hours. Do not share it.<br>CTI Group Worldwide Services, Inc. — POSEIDON</p></div>`
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// ENTRY POINT
// ═════════════════════════════════════════════════════════════════════════════

export default {
  async fetch(request, env, ctx) {
    return R.handle(request, env, ctx);
  }
};
