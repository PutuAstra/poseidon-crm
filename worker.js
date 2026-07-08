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
    try {
      const { t, exp } = JSON.parse(cached);
      if (Date.now() < exp - 60000) return t;
    } catch (e) {
      // corrupted cache entry — fall through to fetch a fresh token
      await env.KV.delete('_graph_token');
    }
  }
  const r = await fetch(`https://login.microsoftonline.com/${env.TENANT_ID}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: env.CLIENT_ID, client_secret: env.CLIENT_SECRET, scope: 'https://graph.microsoft.com/.default', grant_type: 'client_credentials' })
  });
  const text = await r.text();
  let d;
  try { d = JSON.parse(text); } catch (e) {
    throw new Error(`Graph token response not JSON (HTTP ${r.status}): ${text.slice(0, 300)}`);
  }
  if (!d.access_token) throw new Error(`Graph auth failed: ${d.error} — ${d.error_description}`);
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
        // Signal the master roll-up to refresh after any successful candidate
        // mutation (keeps the cached executive view near-real-time).
        if (req.method !== 'GET' && res.status < 300 &&
            /\/api\/v1\/candidates/.test(url.pathname)) {
          ctx.waitUntil(refreshMasterDashboard(env).catch(() => {}));
        }
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
  return json({ accessToken: await jwtSign({ sub: uid, role: u.role }, env.JWT_SECRET, 900), refreshToken: rt, user: { id: u.id, role: u.role } });
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
  // A leftover/orphaned account (e.g. from a since-deleted candidate that shared
  // this email) would otherwise surface as a raw UNIQUE-constraint 500 below.
  const existingUser = await env.DB.prepare('SELECT id FROM users WHERE email=? COLLATE NOCASE').bind(c.email).first();
  if (existingUser) return err('An account with this email already exists. Contact your recruiter for help.', 409);
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

// Manual candidate creation was removed in v8 — every candidate now arrives
// exclusively via the ZeusHire "hired" push (see /api/v1/webhooks/zeushire-hired).

R.get('/api/v1/candidates', async (req, env, ctx, p, url) => {
  const u = await auth(req, env); const re = role(u, 'SUPER_ADMIN', 'ADMIN', 'RECRUITER', 'ONBOARDING_TEAM'); if (re) return re;
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
  const u = await auth(req, env); const re = role(u, 'SUPER_ADMIN', 'ADMIN', 'RECRUITER', 'ONBOARDING_TEAM'); if (re) return re;
  const c = await env.DB.prepare('SELECT*FROM candidates WHERE id=?').bind(p.id).first();
  if (!c) return err('Not found', 404);
  if (u.role === 'RECRUITER' && c.assigned_recruiter_id !== u.id) return err('Forbidden', 403);
  const [docs, hist, seaProf, j1Prof] = await Promise.all([
    env.DB.prepare('SELECT*FROM documents WHERE candidate_id=? ORDER BY created_at DESC').bind(p.id).all(),
    env.DB.prepare('SELECT h.*,u2.first_name fn,u2.last_name ln FROM pipeline_stage_history h LEFT JOIN users u2 ON h.triggered_by_id=u2.id WHERE h.candidate_id=? ORDER BY h.created_at DESC LIMIT 30').bind(p.id).all(),
    env.DB.prepare('SELECT*FROM seafarer_profiles WHERE candidate_id=?').bind(p.id).first().catch(() => null),
    env.DB.prepare('SELECT*FROM j1_profiles WHERE candidate_id=?').bind(p.id).first().catch(() => null)
  ]);
  // Interview history is no longer Poseidon-native — it arrives read-only as a
  // JSON snapshot from ZeusHire's hired-push (see the Interview tab in admin.js).
  let zeushireSnapshot = null;
  try { zeushireSnapshot = c.zeushire_snapshot ? JSON.parse(c.zeushire_snapshot) : null; } catch { zeushireSnapshot = null; }
  return json({ ...c, zeushireSnapshot, documents: docs.results, stageHistory: hist.results, seafarerProfile: seaProf || null, j1Profile: j1Prof || null });
});

R.patch('/api/v1/candidates/:id', async (req, env, ctx, p) => {
  const u = await auth(req, env); const re = role(u, 'SUPER_ADMIN', 'ADMIN'); if (re) return re;
  const b = await req.json();
  const map = { first_name: b.firstName, last_name: b.lastName, middle_name: b.middleName, phone: b.phone, date_of_birth: b.dateOfBirth, nationality: b.nationality, gender: b.gender, marital_status: b.maritalStatus, language_proficiency: b.languageProficiency, cti_office: b.ctiOffice, employment_status: b.employmentStatus, onboarding_status: b.onboardingStatus, seafarers_status: b.seafarersStatus, origin: b.origin, rating: b.rating, position_applied: b.positionApplied, address: b.address ? JSON.stringify(b.address) : undefined, internal_notes: b.internalNotes, tags: b.tags ? JSON.stringify(b.tags) : undefined };
  const upd = Object.fromEntries(Object.entries(map).filter(([, v]) => v !== undefined));
  if (!Object.keys(upd).length) return err('No valid fields');
  upd.updated_at = new Date().toISOString();
  const sc = Object.keys(upd).map(k => `${k}=?`).join();
  await env.DB.prepare(`UPDATE candidates SET ${sc} WHERE id=?`).bind(...Object.values(upd), p.id).run();
  return json({ success: true });
});

// Generic force-override status setter. The normal flow uses /transitions/*
// (move-forward, endorse, /decision, /ready, etc.) which enforce guards.
// This endpoint bypasses all guards and is restricted to SUPER_ADMIN with an
// explicit `force: true` body flag. Writes a FORCE_OVERRIDE history entry
// recording every bypassed guard so the timeline shows the override clearly.
R.post('/api/v1/candidates/:id/stage', async (req, env, ctx, p) => {
  const u = await auth(req, env); const re = role(u, 'SUPER_ADMIN'); if (re) return re;
  const { toStatus, reason, metadata, force } = await req.json();
  if (force !== true) return err('Force-override requires { force: true } in the body — use the transition endpoints for the guarded flow', 422);
  if (!toStatus) return err('toStatus required');
  // Pure CRM (v8): candidates only ever occupy the post-hire onboarding
  // statuses — everything upstream of ONBOARDING is ZeusHire's job now.
  const VALID_STATES = ['ONBOARDING', 'READY_TO_DEPLOY', 'DEPLOYED', 'ARCHIVED'];
  if (!VALID_STATES.includes(toStatus)) return err(`Invalid state: ${toStatus}`, 422);
  const c = await env.DB.prepare('SELECT id,status,pipeline FROM candidates WHERE id=?').bind(p.id).first();
  if (!c) return err('Not found', 404);
  const now = new Date().toISOString();
  const updates = { status: toStatus, updated_at: now };
  if (toStatus === 'ARCHIVED') { updates.archive_reason = reason || 'Force override'; updates.archived_at = now; updates.archived_by_id = u.id; }
  const setClauses = Object.keys(updates).map(k => `${k}=?`).join(',');
  const histMeta = { event: 'FORCE_OVERRIDE', from: c.status, to: toStatus, by: u.id, ...(metadata || {}) };
  await env.DB.batch([
    env.DB.prepare(`UPDATE candidates SET ${setClauses} WHERE id=?`).bind(...Object.values(updates), p.id),
    env.DB.prepare('INSERT INTO pipeline_stage_history(id,candidate_id,from_status,to_status,triggered_by_id,reason,metadata)VALUES(?,?,?,?,?,?,?)')
      .bind(cuid(), p.id, c.status, toStatus, u.id, `FORCE_OVERRIDE: ${reason || '(no reason provided)'}`, JSON.stringify(histMeta))
  ]);
  return json({ success: true, fromStatus: c.status, toStatus, forced: true });
});

// ── Transitions ───────────────────────────────────────────────────────────────
// move-forward / not-moving-forward / endorse / client-approved / client-rejected
// (the pre-hire NEW_SUBMISSION → CANDIDATES → FINAL_INTERVIEW → OFFER_LETTER
// flow) were removed in v8 — ZeusHire owns that pipeline now. Only the
// post-hire archive/restore transitions remain.

R.post('/api/v1/candidates/:id/transitions/archive', async (req, env, ctx, p) => {
  const u = await auth(req, env); const re = role(u, 'SUPER_ADMIN', 'ADMIN'); if (re) return re;
  const { reason } = await req.json().catch(() => ({}));
  if (!reason) return err('reason is required to archive', 422);
  const c = await env.DB.prepare('SELECT id,status FROM candidates WHERE id=?').bind(p.id).first();
  if (!c) return err('Not found', 404);
  if (c.status === 'ARCHIVED') return err('Already archived', 409);
  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare("UPDATE candidates SET status='ARCHIVED',archive_reason=?,archived_at=?,archived_by_id=?,updated_at=? WHERE id=?").bind(reason, now, u.id, now, p.id),
    env.DB.prepare('INSERT INTO pipeline_stage_history(id,candidate_id,from_status,to_status,triggered_by_id,reason)VALUES(?,?,?,?,?,?)').bind(cuid(), p.id, c.status, 'ARCHIVED', u.id, reason)
  ]);
  return json({ success: true, fromStatus: c.status, toStatus: 'ARCHIVED' });
});

R.post('/api/v1/candidates/:id/transitions/restore', async (req, env, ctx, p) => {
  const u = await auth(req, env); const re = role(u, 'SUPER_ADMIN'); if (re) return re;
  const { restoreToStatus } = await req.json().catch(() => ({}));
  // Pure CRM (v8): only the post-hire onboarding statuses are restorable
  // (DEPLOYED intentionally excluded — re-enroll instead).
  const VALID = ['ONBOARDING', 'READY_TO_DEPLOY'];
  if (!restoreToStatus || !VALID.includes(restoreToStatus)) return err('Valid restoreToStatus required', 422);
  const c = await env.DB.prepare('SELECT id,status FROM candidates WHERE id=?').bind(p.id).first();
  if (!c) return err('Not found', 404);
  if (c.status !== 'ARCHIVED') return err('Candidate is not archived', 409);
  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare("UPDATE candidates SET status=?,archive_reason=NULL,archived_at=NULL,archived_by_id=NULL,updated_at=? WHERE id=?").bind(restoreToStatus, now, p.id),
    env.DB.prepare('INSERT INTO pipeline_stage_history(id,candidate_id,from_status,to_status,triggered_by_id,reason)VALUES(?,?,?,?,?,?)').bind(cuid(), p.id, 'ARCHIVED', restoreToStatus, u.id, 'Restored from archive')
  ]);
  return json({ success: true, toStatus: restoreToStatus });
});

// Offer letters + the e-signature webhook were removed in v8 — offer
// generation/signing is ZeusHire's job now. A candidate lands directly in
// ONBOARDING via the ZeusHire hired-push (which also calls provisionPortal()
// to unlock portal access, same as this webhook used to do on signing).

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
  const c = await env.DB.prepare('SELECT id,email,first_name,user_id,status FROM candidates WHERE id=?').bind(p.id).first();
  if (!c) return err('Candidate not found', 404);
  if (c.user_id) return err('Candidate has already activated their portal', 409);
  // Portal is only available once the candidate enters the Onboarding stage (or beyond).
  if (!['ONBOARDING','READY_TO_DEPLOY','DEPLOYED'].includes(c.status)) {
    return err('Portal can only be invited once the candidate reaches Onboarding', 422);
  }
  const result = await provisionPortal(env, p.id);
  return json({ sent: true, emailSent: result?.emailSent ?? false, activationLink: result?.link ?? null });
});

// ═════════════════════════════════════════════════════════════════════════════
// ZEUSHIRE HAND-OFF (pure-CRM v8) — the only way a candidate enters Poseidon
// ═════════════════════════════════════════════════════════════════════════════
//
// Triggered by a Super Admin clicking "Push to Poseidon" on a Hired candidate
// in ZeusHire — never automatic. multipart/form-data body:
//   payload       — JSON string, see shape below
//   document_0..N — file blobs, one per entry in payload.documents[]
//
// payload shape:
//   { zeushireCandidateId, office, placementType, pushedBy, pushedAt,
//     candidate: { firstName, lastName, fullName, email, phone, gender, dob,
//                  placeOfBirth, address, city, state, country, department,
//                  position, client },
//     documents: [{ label, filename, mimeType }, ...],
//     snapshot: { ...everything else from the ATS record, stored verbatim } }
//
// Auth: HMAC-SHA256 over the raw request body, header
// X-ZeusHire-Signature: sha256=<hex>, shared secret env.ZEUSHIRE_POSEIDON_SECRET.
// Idempotent: re-pushing the same zeushireCandidateId updates the existing
// candidate (refreshes snapshot + adds any new documents) instead of
// duplicating — a double-click or retry can't create two rows.

const PLACEMENT_TO_PIPELINE = { seabased: 'SEA_BASED', landbased: 'LAND_BASED', j1: 'J1_PROGRAM' };

async function _uploadZeushireDocument(env, accessToken, candidateId, meta, file) {
  const docId = cuid();
  const safeName = String(meta?.filename || file.name || 'document').replace(/[^a-zA-Z0-9._-]/g, '_');
  const odPath = `/POSEIDON/${candidateId}/ZEUSHIRE_IMPORT/${docId}_${safeName}`;
  const bytes = await file.arrayBuffer();
  const mimeType = meta?.mimeType || file.type || 'application/octet-stream';
  const ur = await fetch(`https://graph.microsoft.com/v1.0/users/${env.ONEDRIVE_USER}/drive/root:${odPath}:/content`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': mimeType },
    body: bytes,
  });
  if (!ur.ok) throw new Error(`OneDrive upload failed (${ur.status}) for ${safeName}`);
  const ud = await ur.json();
  await env.DB.prepare(
    `INSERT INTO documents (id, candidate_id, type, label, file_name, file_size_bytes, mime_type, onedrive_file_id, onedrive_url, onedrive_path, uploaded_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ZEUSHIRE_IMPORT')`
  ).bind(docId, candidateId, (meta?.label || safeName).toUpperCase().replace(/[^A-Z0-9]+/g, '_'), meta?.label || safeName, safeName, bytes.byteLength, mimeType, ud.id, ud.webUrl, odPath).run();
  return { id: docId, label: meta?.label || safeName };
}

R.post('/api/v1/webhooks/zeushire-hired', async (req, env) => {
  const secret = env.ZEUSHIRE_POSEIDON_SECRET;
  if (!secret) return err('Webhook secret not configured', 503);

  const sigHeader = req.headers.get('x-zeushire-signature') || '';
  const m = /^sha256=([a-f0-9]+)$/i.exec(sigHeader);
  if (!m) return err('Missing or malformed signature', 401);
  const raw = await req.clone().arrayBuffer();
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const macBuf = await crypto.subtle.sign('HMAC', key, raw);
  const expected = Array.from(new Uint8Array(macBuf)).map(b => b.toString(16).padStart(2, '0')).join('');
  const given = m[1].toLowerCase();
  if (expected.length !== given.length) return err('Invalid signature', 401);
  let diff = 0; for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ given.charCodeAt(i);
  if (diff !== 0) return err('Invalid signature', 401);

  let form;
  try { form = await req.formData(); } catch { return err('Expected multipart/form-data', 400); }
  let payload;
  try { payload = JSON.parse(form.get('payload')); } catch { return err('payload field must be valid JSON', 400); }

  const { zeushireCandidateId, placementType, candidate, documents, snapshot, pushedBy, pushedAt } = payload || {};
  if (!zeushireCandidateId) return err('zeushireCandidateId required', 400);
  if (!candidate?.email || !candidate?.firstName || !candidate?.lastName) return err('candidate.firstName, lastName, email required', 400);
  const pipeline = PLACEMENT_TO_PIPELINE[placementType];
  if (!pipeline) return err('Invalid or missing placementType', 400);

  const now = new Date().toISOString();
  const addressJson = JSON.stringify({ city: candidate.city || '', province: candidate.state || '', country: candidate.country || '' });
  const snapshotJson = JSON.stringify({ ...snapshot, department: candidate.department, position: candidate.position, client: candidate.client, placeOfBirth: candidate.placeOfBirth });

  const existing = await env.DB.prepare('SELECT id FROM candidates WHERE zeushire_candidate_id=?').bind(zeushireCandidateId).first();
  let candidateId;
  if (existing) {
    candidateId = existing.id;
    await env.DB.prepare(
      `UPDATE candidates SET first_name=?, last_name=?, email=?, phone=?, date_of_birth=?, nationality=?, address=?,
              zeushire_snapshot=?, zeushire_pushed_by=?, zeushire_pushed_at=?, updated_at=?
        WHERE id=?`
    ).bind(candidate.firstName, candidate.lastName, candidate.email, candidate.phone || null, candidate.dob || null,
      candidate.country || null, addressJson, snapshotJson, pushedBy || null, pushedAt ? new Date(pushedAt).toISOString() : now, now, candidateId).run();
  } else {
    candidateId = cuid();
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO candidates (id, first_name, last_name, email, phone, date_of_birth, nationality, address,
                pipeline, status, zeushire_candidate_id, zeushire_snapshot, zeushire_pushed_by, zeushire_pushed_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'ONBOARDING', ?, ?, ?, ?, ?, ?)`
      ).bind(candidateId, candidate.firstName, candidate.lastName, candidate.email, candidate.phone || null, candidate.dob || null,
        candidate.country || null, addressJson, pipeline, zeushireCandidateId, snapshotJson, pushedBy || null,
        pushedAt ? new Date(pushedAt).toISOString() : now, now, now),
      env.DB.prepare(
        `INSERT INTO pipeline_stage_history (id, candidate_id, from_status, to_status, triggered_by_id, reason, metadata)
         VALUES (?, ?, NULL, 'ONBOARDING', NULL, 'Pushed from ZeusHire (Hired)', ?)`
      ).bind(cuid(), candidateId, JSON.stringify({ zeushireCandidateId, pushedBy: pushedBy || null })),
    ]);
  }

  // Upload documents (best-effort per-file — one bad file shouldn't fail the whole push).
  const docsMeta = Array.isArray(documents) ? documents : [];
  let uploaded = 0;
  if (docsMeta.length) {
    const accessToken = await graphToken(env);
    for (let i = 0; i < docsMeta.length; i++) {
      const file = form.get(`document_${i}`);
      if (!file || typeof file === 'string') continue;
      try { await _uploadZeushireDocument(env, accessToken, candidateId, docsMeta[i], file); uploaded++; }
      catch (e) { console.error('ZeusHire document upload failed:', docsMeta[i]?.filename, e?.message); }
    }
  }

  // Portal access unlocks at ONBOARDING — same as it used to on offer-letter
  // signing. Best-effort; failure to email must not fail the push.
  if (!existing) { try { await provisionPortal(env, candidateId); } catch (e) { console.error('Portal provision failed:', e?.message); } }

  return json({ ok: true, candidateId, updated: !!existing, documentsUploaded: uploaded }, existing ? 200 : 201);
});

// Public application form, submissions review/conversion, and the form
// builder were removed in v8 — application intake is entirely ZeusHire's job.

// Interview CRUD, candidate-interview invites/scoring, and the booking-slot
// system were removed in v8 — interview scheduling is entirely ZeusHire's
// job. A candidate's interview history now arrives read-only in
// candidates.zeushire_snapshot (see the Interview tab in admin.js).

// The ZeusHire one-way/two-way interview dispatch, the old completion
// webhook, and the Marlins English Test were removed in v8 — interviewing
// and screening are entirely ZeusHire's job now (Marlins results, if any,
// arrive read-only in candidates.zeushire_snapshot).

// Pipelines that use the deployment-style onboarding flow (documents →
// ready-to-deploy → deployed). Sea-Based and Land-Based share this; J1 tracks
// onboarding via j1_profiles instead.
const DEPLOYMENT_PIPELINES = ['SEA_BASED', 'LAND_BASED'];

// ── Onboarding: verify-docs-and-mark-ready ────────────────────────────────────
//
// Default required document types per pipeline. The actual list is fetched
// from program_settings(<pipeline>, onboarding_required_docs) — a comma-separated
// override. Falls back to these constants when no setting is configured.
const SEA_BASED_REQUIRED_DOC_TYPES_DEFAULT  = ['PASSPORT', 'SEAMAN_BOOK', 'STCW_BASIC', 'MEDICAL_CERT', 'YELLOW_FEVER', 'C1D_VISA'];
const LAND_BASED_REQUIRED_DOC_TYPES_DEFAULT = ['PASSPORT', 'WORK_VISA', 'MEDICAL_CERT', 'BG_CHECK', 'EMPLOYMENT_CONTRACT'];

async function _resolveRequiredDocs(env, pipeline) {
  const row = await env.DB.prepare(
    "SELECT setting_value FROM program_settings WHERE pipeline=? AND setting_key='onboarding_required_docs'"
  ).bind(pipeline).first();
  if (row?.setting_value) {
    const list = row.setting_value.split(',').map(s => s.trim().toUpperCase().replace(/-/g, '_')).filter(Boolean);
    if (list.length) return list;
  }
  if (pipeline === 'SEA_BASED')  return SEA_BASED_REQUIRED_DOC_TYPES_DEFAULT;
  if (pipeline === 'LAND_BASED') return LAND_BASED_REQUIRED_DOC_TYPES_DEFAULT;
  return [];
}

R.post('/api/v1/sea/onboarding/:candidateId/ready', async (req, env, ctx, p) => {
  const u = await auth(req, env); const re = role(u, 'SUPER_ADMIN', 'ADMIN', 'RECRUITER', 'ONBOARDING_TEAM'); if (re) return re;

  const c = await env.DB.prepare('SELECT id,status,pipeline,archived_at FROM candidates WHERE id=?').bind(p.candidateId).first();
  if (!c) return err('Candidate not found', 404);
  if (c.archived_at) return err('Candidate is archived', 422);
  if (!DEPLOYMENT_PIPELINES.includes(c.pipeline)) return err('This step is only for Sea-Based / Land-Based pipelines', 422);
  if (c.status !== 'ONBOARDING') return err(`Candidate must be in ONBOARDING (is ${c.status})`, 422);

  const required = await _resolveRequiredDocs(env, c.pipeline);

  // Inspect documents (type normalized to UPPER_SNAKE via migration_v6 backfill).
  const { results: docs } = await env.DB.prepare(
    `SELECT UPPER(REPLACE(type,'-','_')) AS type, expiration_date
       FROM documents WHERE candidate_id=?`
  ).bind(p.candidateId).all();

  const today = new Date().toISOString().slice(0, 10);
  const haveByType = new Map();
  for (const d of (docs || [])) {
    if (!haveByType.has(d.type)) haveByType.set(d.type, []);
    haveByType.get(d.type).push(d);
  }
  const missing = [];
  const expired = [];
  for (const t of required) {
    const set = haveByType.get(t);
    if (!set || !set.length) { missing.push(t); continue; }
    // any unexpired (or no expiry) instance is fine
    const ok = set.some(d => !d.expiration_date || d.expiration_date > today);
    if (!ok) expired.push(t);
  }
  if (missing.length || expired.length) {
    return json({ error: 'Required documents missing or expired', missing, expired, required }, 422);
  }

  const now = new Date().toISOString();
  const result = await env.DB.batch([
    env.DB.prepare(
      "UPDATE candidates SET status='READY_TO_DEPLOY', updated_at=? WHERE id=? AND status='ONBOARDING'"
    ).bind(now, p.candidateId),
    env.DB.prepare(
      `INSERT INTO pipeline_stage_history (id,candidate_id,from_status,to_status,triggered_by_id,reason,metadata)
       VALUES (?,?, 'ONBOARDING','READY_TO_DEPLOY', ?, 'Documents verified — ready to deploy', json(?))`
    ).bind(cuid(), p.candidateId, u.id, JSON.stringify({ verified_types: required })),
  ]);
  if (!result[0]?.meta || result[0].meta.changes !== 1) {
    return err('Candidate state changed concurrently', 409);
  }
  return json({ success: true, toStatus: 'READY_TO_DEPLOY', verifiedTypes: required });
});


// ── Deployments ledger (Sea-Based active sea-duty log) ────────────────────────
//
// The master profile STAYS in the candidates table; deployments rows are an
// append-only ledger. Partial UNIQUE index uq_deploy_one_active enforces at
// most one ACTIVE deployment per candidate at the DB layer.

R.post('/api/v1/sea/deployments', async (req, env) => {
  const u = await auth(req, env); const re = role(u, 'SUPER_ADMIN', 'ADMIN'); if (re) return re;
  const b = await req.json().catch(() => ({}));
  const { candidateId, vesselName, signOnDate, contractDurationMonths, signOnPort, position, notes } = b;
  if (!candidateId || !vesselName || !signOnDate || !contractDurationMonths) {
    return err('candidateId, vesselName, signOnDate, contractDurationMonths required');
  }
  const months = parseInt(contractDurationMonths, 10);
  if (isNaN(months) || months < 1 || months > 24) return err('contractDurationMonths must be 1–24', 422);

  const c = await env.DB.prepare(
    `SELECT c.id, c.first_name, c.last_name, c.status, c.pipeline,
            c.endorsed_client_id, cl.name AS client_name,
            (SELECT id FROM deployments WHERE candidate_id = c.id AND status = 'ACTIVE' LIMIT 1) AS active_deployment_id
       FROM candidates c
       LEFT JOIN clients cl ON cl.id = c.endorsed_client_id
      WHERE c.id = ?`
  ).bind(candidateId).first();
  if (!c) return err('Candidate not found', 404);
  if (!DEPLOYMENT_PIPELINES.includes(c.pipeline)) return err('Not a Sea-Based / Land-Based candidate', 422);
  if (c.status !== 'READY_TO_DEPLOY') return err(`Candidate must be READY_TO_DEPLOY (is ${c.status})`, 422);
  if (!c.endorsed_client_id) return err('No active client on candidate — re-endorse first', 422);
  if (c.active_deployment_id) return json({ error: 'Candidate already has an ACTIVE deployment', deploymentId: c.active_deployment_id }, 409);

  const deploymentId = cuid();
  const fullName     = [c.first_name, c.last_name].filter(Boolean).join(' ');
  const meta         = JSON.stringify({ deployment_id: deploymentId, vessel: vesselName, sign_on_date: signOnDate, duration_months: months });

  const results = await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO deployments
         (id, candidate_id, candidate_full_name, client_id, client_name,
          vessel_name, sign_on_date, contract_duration_months,
          sign_on_port, position, status, notes, created_by_id)
       VALUES (?,?,?,?,?,?,?,?,?,?, 'ACTIVE', ?, ?)`
    ).bind(deploymentId, candidateId, fullName,
           c.endorsed_client_id, c.client_name,
           vesselName, signOnDate, months,
           signOnPort || null, position || null, notes || null, u.id),
    env.DB.prepare(
      "UPDATE candidates SET status='DEPLOYED', updated_at=datetime('now') WHERE id=? AND status='READY_TO_DEPLOY'"
    ).bind(candidateId),
    env.DB.prepare(
      `INSERT INTO pipeline_stage_history (id,candidate_id,from_status,to_status,triggered_by_id,reason,metadata)
       VALUES (?, ?, 'READY_TO_DEPLOY','DEPLOYED', ?, 'Deployment created', json(?))`
    ).bind(cuid(), candidateId, u.id, meta),
  ]);

  // Compensation: if CAS missed, mark the deployment CANCELLED (the partial
  // unique index already blocked any second concurrent ACTIVE row anyway).
  const candResult = results[1];
  if (!candResult?.meta || candResult.meta.changes !== 1) {
    await env.DB.prepare(
      "UPDATE deployments SET status='CANCELLED', sign_off_reason='Concurrent state change', updated_at=datetime('now') WHERE id=?"
    ).bind(deploymentId).run();
    return err('Candidate state changed during deployment creation', 409);
  }

  return json({ success: true, deploymentId, toStatus: 'DEPLOYED' }, 201);
});


R.post('/api/v1/sea/deployments/:id/close', async (req, env, ctx, p) => {
  const u = await auth(req, env); const re = role(u, 'SUPER_ADMIN', 'ADMIN'); if (re) return re;
  const b = await req.json().catch(() => ({}));
  const { status, signOffDate, signOffReason } = b;
  if (!['COMPLETED', 'TERMINATED', 'CANCELLED'].includes(status)) {
    return err("status must be 'COMPLETED', 'TERMINATED', or 'CANCELLED'", 422);
  }
  if (!signOffDate) return err('signOffDate required');

  const d = await env.DB.prepare('SELECT id, candidate_id, status FROM deployments WHERE id=?').bind(p.id).first();
  if (!d) return err('Deployment not found', 404);
  if (d.status !== 'ACTIVE') return err(`Deployment is not ACTIVE (is ${d.status})`, 409);

  const now = new Date().toISOString();
  const results = await env.DB.batch([
    env.DB.prepare(
      `UPDATE deployments
          SET status=?, sign_off_date=?, sign_off_reason=?, closed_by_id=?, updated_at=?
        WHERE id=? AND status='ACTIVE'`
    ).bind(status, signOffDate, signOffReason || null, u.id, now, p.id),
    env.DB.prepare(
      "UPDATE candidates SET status='ONBOARDING', updated_at=? WHERE id=? AND status='DEPLOYED'"
    ).bind(now, d.candidate_id),
    env.DB.prepare(
      `INSERT INTO pipeline_stage_history (id,candidate_id,from_status,to_status,triggered_by_id,reason,metadata)
       VALUES (?, ?, 'DEPLOYED','ONBOARDING', ?, 'Deployment closed — candidate available for re-deployment', json(?))`
    ).bind(cuid(), d.candidate_id, u.id, JSON.stringify({ deployment_id: p.id, close_status: status }))
  ]);
  if (!results[0]?.meta || results[0].meta.changes !== 1) {
    return err('Deployment state changed concurrently', 409);
  }
  return json({ success: true, deploymentStatus: status, candidateStatus: 'ONBOARDING' });
});


R.get('/api/v1/sea/deployments', async (req, env, ctx, p, url) => {
  const u = await auth(req, env);
  const re = role(u, 'SUPER_ADMIN', 'ADMIN', 'RECRUITER', 'ONBOARDING_TEAM', 'CLIENT_CONTACT'); if (re) return re;
  const status = url.searchParams.get('status');
  const search = url.searchParams.get('search');
  const pipeline = url.searchParams.get('pipeline');
  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1'));
  const limit = Math.min(100, parseInt(url.searchParams.get('limit') || '50'));
  const offset = (page - 1) * limit;
  const where = []; const binds = [];
  if (status) { where.push('d.status=?'); binds.push(status); }
  if (pipeline) { where.push('c.pipeline=?'); binds.push(pipeline); }
  if (search) { where.push('(d.candidate_full_name LIKE ? OR d.vessel_name LIKE ? OR d.client_name LIKE ?)'); binds.push(`%${search}%`, `%${search}%`, `%${search}%`); }
  if (u.role === 'RECRUITER') { where.push('c.assigned_recruiter_id=?'); binds.push(u.id); }
  if (u.role === 'CLIENT_CONTACT') {
    const cc = await env.DB.prepare('SELECT client_id FROM client_contacts WHERE user_id=?').bind(u.id).first();
    if (!cc) return err('Forbidden', 403);
    where.push('d.client_id=?'); binds.push(cc.client_id);
  }
  const wc = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const [rows, tot] = await Promise.all([
    env.DB.prepare(
      `SELECT d.*
         FROM deployments d
         LEFT JOIN candidates c ON c.id = d.candidate_id
         ${wc}
         ORDER BY d.sign_on_date DESC
         LIMIT ? OFFSET ?`
    ).bind(...binds, limit, offset).all(),
    env.DB.prepare(`SELECT COUNT(*) cnt FROM deployments d LEFT JOIN candidates c ON c.id=d.candidate_id ${wc}`).bind(...binds).first()
  ]);
  return json({ deployments: rows.results || [], total: tot?.cnt || 0, page, limit });
});


R.get('/api/v1/candidates/:id/deployments', async (req, env, ctx, p) => {
  const u = await auth(req, env);
  const re = role(u, 'SUPER_ADMIN', 'ADMIN', 'RECRUITER', 'ONBOARDING_TEAM'); if (re) return re;
  const { results } = await env.DB.prepare(
    'SELECT * FROM deployments WHERE candidate_id=? ORDER BY sign_on_date DESC'
  ).bind(p.id).all();
  return json({ deployments: results || [] });
});


// Client endorsement decisions and the grouped final-interview listing were
// removed in v8 along with the rest of the pre-hire pipeline — client
// approval of a candidate is ZeusHire's job now.

// ═════════════════════════════════════════════════════════════════════════════
// CLIENTS
// ═════════════════════════════════════════════════════════════════════════════

R.get('/api/v1/clients', async (req, env, ctx, p, url) => {
  const u = await auth(req, env); const re = role(u, 'SUPER_ADMIN', 'ADMIN', 'RECRUITER', 'ONBOARDING_TEAM'); if (re) return re;
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
  const u = await auth(req, env); const re = role(u, 'SUPER_ADMIN', 'ADMIN', 'RECRUITER', 'ONBOARDING_TEAM'); if (re) return re;
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

// Candidate endorsement (single-candidate variant), endorsement CRUD, and
// per-client endorsement listing were removed in v8 along with the rest of
// the endorsement workflow.

// ═════════════════════════════════════════════════════════════════════════════
// DOCUMENTS & ONEDRIVE
// ═════════════════════════════════════════════════════════════════════════════

R.get('/api/v1/candidates/:id/documents', async (req, env, ctx, p) => {
  const u = await auth(req, env);
  if (!u) return err('Unauthorized', 401);
  if (u.role === 'CANDIDATE') {
    const c = await env.DB.prepare('SELECT id FROM candidates WHERE user_id=?').bind(u.id).first();
    if (!c || c.id !== p.id) return err('Forbidden', 403);
  } else { const re = role(u, 'SUPER_ADMIN', 'ADMIN', 'RECRUITER', 'ONBOARDING_TEAM'); if (re) return re; }
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

// Portal access gate: candidate must be in Onboarding or beyond.
// (Active portal_user records are only created at the ONBOARDING transition, but a
//  SUPER_ADMIN restore could legally move a candidate back to an earlier stage —
//  this gate ensures portal data isn't reachable in that case.)
const PORTAL_ALLOWED_STATUSES = ['ONBOARDING', 'READY_TO_DEPLOY', 'DEPLOYED'];

R.get('/api/v1/portal/me', async (req, env) => {
  const u = await auth(req, env); const re = role(u, 'CANDIDATE'); if (re) return re;
  const c = await env.DB.prepare('SELECT*FROM candidates WHERE user_id=?').bind(u.id).first();
  if (!c) return err('Profile not found', 404);
  if (!PORTAL_ALLOWED_STATUSES.includes(c.status)) {
    return err('Portal is not yet available for your profile', 403);
  }
  const [docs, hist] = await Promise.all([
    env.DB.prepare('SELECT id,type,label,document_number,issuance_date,expiration_date,file_name,is_verified,created_at FROM documents WHERE candidate_id=? ORDER BY created_at DESC').bind(c.id).all(),
    env.DB.prepare('SELECT from_status,to_status,created_at FROM pipeline_stage_history WHERE candidate_id=? ORDER BY created_at ASC').bind(c.id).all()
  ]);
  return json({ ...c, documents: docs.results, stageHistory: hist.results });
});

R.patch('/api/v1/portal/me', async (req, env) => {
  const u = await auth(req, env); const re = role(u, 'CANDIDATE'); if (re) return re;
  const c = await env.DB.prepare('SELECT id,status FROM candidates WHERE user_id=?').bind(u.id).first();
  if (!c) return err('Not found', 404);
  if (!PORTAL_ALLOWED_STATUSES.includes(c.status)) {
    return err('Portal is not yet available for your profile', 403);
  }
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
  const u = await auth(req, env); const re = role(u, 'SUPER_ADMIN', 'ADMIN', 'RECRUITER', 'ONBOARDING_TEAM'); if (re) return re;
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
// SEAFARER PROFILES
// ═════════════════════════════════════════════════════════════════════════════

R.get('/api/v1/candidates/:id/seafarer-profile', async (req, env, ctx, p) => {
  const u = await auth(req, env); const re = role(u, 'SUPER_ADMIN', 'ADMIN', 'RECRUITER', 'ONBOARDING_TEAM'); if (re) return re;
  const profile = await env.DB.prepare('SELECT*FROM seafarer_profiles WHERE candidate_id=?').bind(p.id).first();
  return json(profile || {});
});

R.put('/api/v1/candidates/:id/seafarer-profile', async (req, env, ctx, p) => {
  const u = await auth(req, env); const re = role(u, 'SUPER_ADMIN', 'ADMIN', 'RECRUITER', 'ONBOARDING_TEAM'); if (re) return re;
  const b = await req.json();
  const cols = {
    // Onboarding
    department:                b.department,
    position_hired:            b.positionHired,
    cruise_line:               b.cruiseLine,
    joining_ship:              b.joiningShip,
    sign_on_date:              b.signOnDate,
    sign_off_date:             b.signOffDate,
    sign_on_port:              b.signOnPort,
    gateway_airport:           b.gatewayAirport,
    rescheduled_sign_on_date:  b.rescheduledSignOnDate,
    rescheduled_reasons:       b.rescheduledReasons,
    // Contract changes
    change_joining_port_1:     b.changeJoiningPort1,
    change_joining_ship_1:     b.changeJoiningShip1,
    change_sign_on_date_1:     b.changeSignOnDate1,
    change_sign_off_date_1:    b.changeSignOffDate1,
    change_joining_port_2:     b.changeJoiningPort2,
    change_joining_ship_2:     b.changeJoiningShip2,
    change_sign_on_date_2:     b.changeSignOnDate2,
    change_sign_off_date_2:    b.changeSignOffDate2,
    cruise_line_2:             b.cruiseLine2,
    department_2:              b.department2,
    position_hired_2:          b.positionHired2,
    // Marlins
    marlins_code:              b.marlinsCode,
    marlins_score:             b.marlinsScore !== undefined ? Number(b.marlinsScore) : undefined,
    marlins_test_duration:     b.marlinsTestDuration,
    marlins_test_result:       b.marlinsTestResult,
    // Emergency contact
    emergency_contact_name:    b.emergencyContactName,
    emergency_contact_number:  b.emergencyContactNumber,
    emergency_relationship:    b.emergencyRelationship,
    emergency_contact_city:    b.emergencyContactCity,
    emergency_contact_address: b.emergencyContactAddress,
    // Address
    address_street:            b.addressStreet,
    address_postal_code:       b.addressPostalCode,
    address_city:              b.addressCity,
    address_province:          b.addressProvince,
    address_country:           b.addressCountry,
    // Personal
    salutation:                b.salutation,
    date_of_birth:             b.dateOfBirth,
    place_of_birth:            b.placeOfBirth,
    height:                    b.height !== undefined ? Number(b.height) : undefined,
    weight:                    b.weight !== undefined ? Number(b.weight) : undefined,
    eye_color:                 b.eyeColor,
    hair_color:                b.hairColor,
    // Employment
    current_job_title:         b.currentJobTitle,
    skill_set:                 b.skillSet,
    hired_date:                b.hiredDate,
    hired_date_2:              b.hiredDate2,
    sign_off_reason:           b.signOffReason,
    sign_off_report_date:      b.signOffReportDate,
    rotation_ready_date:       b.rotationReadyDate,
    resignation_date:          b.resignationDate,
    resignation_reasons:       b.resignationReasons,
    placement_sector:          b.placementSector,
    project:                   b.project,
    contract_number:           b.contractNumber,
    // Banking
    bank_name:                 b.bankName,
    bank_account_number:       b.bankAccountNumber,
    // Compliance
    compliance_notes:           b.complianceNotes,
    completed_vaccination:      b.completedVaccination,
    date_mmr1_completed:        b.dateMmr1Completed,
    crew_compliance_audit_call: b.crewComplianceAuditCall,
    mistral_status:             b.mistralStatus,
    oktb_status:                b.oktbStatus,
    // Admin
    go_video_link:              b.goVideoLink,
    temporary_id:               b.temporaryId,
    crew_id_2:                  b.crewId2,
    additional_info:            b.additionalInfo,
    comment_result:             b.commentResult,
    previous_office:            b.previousOffice,
    code_generated_date:        b.codeGeneratedDate,
    code_given_date:            b.codeGivenDate,
    multiple_active_applications: b.multipleActiveApplications,
    // Financials
    medical_cost:               b.medicalCost !== undefined ? Number(b.medicalCost) : undefined,
    meal_allowance_cost:        b.mealAllowanceCost !== undefined ? Number(b.mealAllowanceCost) : undefined,
    rt_pcr_cost:                b.rtPcrCost !== undefined ? Number(b.rtPcrCost) : undefined,
    vaccination_cost:           b.vaccinationCost !== undefined ? Number(b.vaccinationCost) : undefined,
    reimbursement_date:         b.reimbursementDate,
  };
  const upd = Object.fromEntries(Object.entries(cols).filter(([, v]) => v !== undefined));
  const ex = await env.DB.prepare('SELECT id FROM seafarer_profiles WHERE candidate_id=?').bind(p.id).first();
  if (ex) {
    upd.updated_at = new Date().toISOString();
    if (Object.keys(upd).length) await env.DB.prepare(`UPDATE seafarer_profiles SET ${Object.keys(upd).map(k => `${k}=?`).join()} WHERE candidate_id=?`).bind(...Object.values(upd), p.id).run();
  } else {
    const id = cuid(); const keys = ['id', 'candidate_id', ...Object.keys(upd)];
    await env.DB.prepare(`INSERT INTO seafarer_profiles(${keys.join()})VALUES(${keys.map(() => '?').join()})`).bind(id, p.id, ...Object.values(upd)).run();
  }
  return json({ success: true });
});

// ═════════════════════════════════════════════════════════════════════════════
// J1 PROFILES
// ═════════════════════════════════════════════════════════════════════════════

R.get('/api/v1/candidates/:id/j1-profile', async (req, env, ctx, p) => {
  const u = await auth(req, env); const re = role(u, 'SUPER_ADMIN', 'ADMIN', 'RECRUITER', 'ONBOARDING_TEAM'); if (re) return re;
  const profile = await env.DB.prepare('SELECT*FROM j1_profiles WHERE candidate_id=?').bind(p.id).first();
  return json(profile || {});
});

R.put('/api/v1/candidates/:id/j1-profile', async (req, env, ctx, p) => {
  const u = await auth(req, env); const re = role(u, 'SUPER_ADMIN', 'ADMIN', 'RECRUITER', 'ONBOARDING_TEAM'); if (re) return re;
  const b = await req.json();
  const cols = {
    j1_application_status:          b.j1ApplicationStatus,
    j1_program_sources:             b.j1ProgramSources,
    cti_usa_review:                 b.ctiUsaReview,
    eligible_programs:              b.eligiblePrograms !== undefined ? (Array.isArray(b.eligiblePrograms) ? JSON.stringify(b.eligiblePrograms) : b.eligiblePrograms) : undefined,
    consultation_call_date:         b.consultationCallDate,
    consultation_call_by:           b.consultationCallBy,
    consultation_call_notes:        b.consultationCallNotes,
    consultation_call_status:       b.consultationCallStatus,
    english_assessment:             b.englishAssessment,
    participant_rating:             b.participantRating,
    attendance:                     b.attendance,
    hosting_company:                b.hostingCompany,
    selected_job:                   b.selectedJob,
    occupational_fields:            b.occupationalFields,
    ticket_pricing:                 b.ticketPricing !== undefined ? Number(b.ticketPricing) : undefined,
    program_start_date:             b.programStartDate,
    program_end_date:               b.programEndDate,
    processing_sponsor:             b.processingSponsor,
    // Legacy *_investment columns were dropped in migration_v7b. Stage payments now
    // live in the j1_payments append-only ledger (Phase 2). Bodies still sending these
    // values are silently dropped so older clients don't 4xx — the canonical totals
    // come from GET /api/v1/candidates/:id/j1/payments/rollup once Phase 2 ships.
    housing_landlord:               b.housingLandlord,
    housing_address:                b.housingAddress,
    program_sponsor_invoice_status: b.programSponsorInvoiceStatus,
    application_withdrawal_reason:  b.applicationWithdrawalReason,
    withdrawal_date:                b.withdrawalDate,
    archive_reason:                 b.archiveReason
  };
  const upd = Object.fromEntries(Object.entries(cols).filter(([, v]) => v !== undefined));
  const ex = await env.DB.prepare('SELECT id FROM j1_profiles WHERE candidate_id=?').bind(p.id).first();
  if (ex) {
    upd.updated_at = new Date().toISOString();
    if (Object.keys(upd).length) await env.DB.prepare(`UPDATE j1_profiles SET ${Object.keys(upd).map(k => `${k}=?`).join()} WHERE candidate_id=?`).bind(...Object.values(upd), p.id).run();
  } else {
    const id = cuid(); const keys = ['id', 'candidate_id', ...Object.keys(upd)];
    await env.DB.prepare(`INSERT INTO j1_profiles(${keys.join()})VALUES(${keys.map(() => '?').join()})`).bind(id, p.id, ...Object.values(upd)).run();
  }
  return json({ success: true });
});

// ═════════════════════════════════════════════════════════════════════════════
// SETTINGS
// ═════════════════════════════════════════════════════════════════════════════

R.get('/api/v1/settings/seafarer-fields', async (req, env) => {
  const u = await auth(req, env); const re = role(u, 'SUPER_ADMIN', 'ADMIN', 'RECRUITER', 'ONBOARDING_TEAM'); if (re) return re;
  const config = await env.KV.get('seafarer_field_config', { type: 'json' });
  return json(config || {});
});

R.put('/api/v1/settings/seafarer-fields', async (req, env) => {
  const u = await auth(req, env); const re = role(u, 'SUPER_ADMIN', 'ADMIN'); if (re) return re;
  const b = await req.json();
  await env.KV.put('seafarer_field_config', JSON.stringify(b));
  return json({ success: true });
});

// ═════════════════════════════════════════════════════════════════════════════
// SEAFARER CERTIFICATES
// ═════════════════════════════════════════════════════════════════════════════

R.get('/api/v1/candidates/:id/certificates', async (req, env, ctx, p) => {
  const u = await auth(req, env); const re = role(u, 'SUPER_ADMIN', 'ADMIN', 'RECRUITER', 'ONBOARDING_TEAM'); if (re) return re;
  const { results } = await env.DB.prepare('SELECT*FROM seafarer_certificates WHERE candidate_id=? ORDER BY cert_type').bind(p.id).all();
  return json(results || []);
});

R.post('/api/v1/candidates/:id/certificates', async (req, env, ctx, p) => {
  const u = await auth(req, env); const re = role(u, 'SUPER_ADMIN', 'ADMIN', 'RECRUITER', 'ONBOARDING_TEAM'); if (re) return re;
  const b = await req.json();
  if (!b.certType) return err('certType required');
  const id = cuid();
  await env.DB.prepare(
    'INSERT INTO seafarer_certificates(id,candidate_id,cert_type,cert_name,cert_number,cert_status,issued_date,expiry_date,appointment_date,issued_nation,issued_place,extra_number,cost,notes)VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)'
  ).bind(id,p.id,b.certType,b.certName||null,b.certNumber||null,b.certStatus||null,b.issuedDate||null,b.expiryDate||null,b.appointmentDate||null,b.issuedNation||null,b.issuedPlace||null,b.extraNumber||null,b.cost!=null?Number(b.cost):null,b.notes||null).run();
  return json({ success: true, id });
});

R.patch('/api/v1/candidates/:id/certificates/:certId', async (req, env, ctx, p) => {
  const u = await auth(req, env); const re = role(u, 'SUPER_ADMIN', 'ADMIN', 'RECRUITER', 'ONBOARDING_TEAM'); if (re) return re;
  const b = await req.json();
  const cols2 = { cert_name:b.certName, cert_number:b.certNumber, cert_status:b.certStatus, issued_date:b.issuedDate, expiry_date:b.expiryDate, appointment_date:b.appointmentDate, issued_nation:b.issuedNation, issued_place:b.issuedPlace, extra_number:b.extraNumber, cost:b.cost!==undefined?(b.cost!==null?Number(b.cost):null):undefined, notes:b.notes };
  const upd2 = Object.fromEntries(Object.entries(cols2).filter(([,v])=>v!==undefined));
  if (!Object.keys(upd2).length) return err('No fields');
  upd2.updated_at = new Date().toISOString();
  await env.DB.prepare(`UPDATE seafarer_certificates SET ${Object.keys(upd2).map(k=>`${k}=?`).join()} WHERE id=? AND candidate_id=?`).bind(...Object.values(upd2),p.certId,p.id).run();
  return json({ success: true });
});

R.delete('/api/v1/candidates/:id/certificates/:certId', async (req, env, ctx, p) => {
  const u = await auth(req, env); const re = role(u, 'SUPER_ADMIN', 'ADMIN', 'RECRUITER', 'ONBOARDING_TEAM'); if (re) return re;
  await env.DB.prepare('DELETE FROM seafarer_certificates WHERE id=? AND candidate_id=?').bind(p.certId,p.id).run();
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
  const VALID_ROLES = ['ADMIN', 'RECRUITER', 'CLIENT_CONTACT', 'ONBOARDING_TEAM'];
  if (!VALID_ROLES.includes(newRole)) return err('Invalid role');
  const id = cuid();
  let pwh = null; let tempPw = null;
  if (password) { pwh = await pwHash(password); }
  else { tempPw = genToken().slice(0, 16); pwh = await pwHash(tempPw); }
  try {
    await env.DB.prepare('INSERT INTO users(id,email,password_hash,role,first_name,last_name)VALUES(?,?,?,?,?,?)').bind(id, email, pwh, newRole, firstName, lastName).run();
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) return err('A user with that email already exists', 409);
    throw e;
  }
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
// STAGE FIELD CONFIGS
// ═════════════════════════════════════════════════════════════════════════════

R.get('/api/v1/stage-fields', async (req, env) => {
  const u = await auth(req, env); if (!u) return err('Unauthorized', 401);
  const url = new URL(req.url);
  const pipeline = url.searchParams.get('pipeline');
  const stage    = url.searchParams.get('stage');
  if (!pipeline) return err('pipeline required');
  let q = 'SELECT * FROM stage_field_configs WHERE pipeline=?';
  const binds = [pipeline];
  if (stage) { q += ' AND stage=?'; binds.push(stage); }
  q += ' ORDER BY stage, sort_order';
  const rows = await env.DB.prepare(q).bind(...binds).all();
  return json({ fields: rows.results || [] });
});

R.post('/api/v1/stage-fields', async (req, env) => {
  const u = await auth(req, env); const re = role(u, 'SUPER_ADMIN', 'ADMIN'); if (re) return re;
  const b = await req.json();
  if (!b.pipeline || !b.stage || !b.fieldKey || !b.fieldLabel || !b.fieldType) return err('pipeline, stage, fieldKey, fieldLabel, fieldType required');
  const id = cuid();
  try {
    await env.DB.prepare(
      'INSERT INTO stage_field_configs(id,pipeline,stage,field_key,field_label,field_type,is_required,is_visible,options,placeholder,help_text,sort_order) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)'
    ).bind(id, b.pipeline, b.stage, b.fieldKey, b.fieldLabel, b.fieldType,
      b.isRequired ? 1 : 0, 1,
      b.options ? JSON.stringify(b.options) : null,
      b.placeholder || null, b.helpText || null, b.sortOrder ?? 0
    ).run();
  } catch(e) {
    if (String(e.message).includes('UNIQUE')) return err('A field with that key already exists for this stage', 409);
    throw e;
  }
  return json({ id }, 201);
});

R.patch('/api/v1/stage-fields/:id', async (req, env, ctx, p) => {
  const u = await auth(req, env); const re = role(u, 'SUPER_ADMIN', 'ADMIN'); if (re) return re;
  const b = await req.json();
  const map = {
    field_label:  b.fieldLabel,
    field_type:   b.fieldType,
    is_required:  b.isRequired !== undefined ? (b.isRequired ? 1 : 0) : undefined,
    is_visible:   b.isVisible  !== undefined ? (b.isVisible  ? 1 : 0) : undefined,
    options:      b.options !== undefined ? JSON.stringify(b.options) : undefined,
    placeholder:  b.placeholder,
    help_text:    b.helpText,
    sort_order:   b.sortOrder,
  };
  const upd = Object.fromEntries(Object.entries(map).filter(([,v]) => v !== undefined));
  if (!Object.keys(upd).length) return err('No fields to update');
  upd.updated_at = new Date().toISOString();
  await env.DB.prepare(`UPDATE stage_field_configs SET ${Object.keys(upd).map(k=>`${k}=?`).join(',')} WHERE id=?`)
    .bind(...Object.values(upd), p.id).run();
  return json({ success: true });
});

R.delete('/api/v1/stage-fields/:id', async (req, env, ctx, p) => {
  const u = await auth(req, env); const re = role(u, 'SUPER_ADMIN', 'ADMIN'); if (re) return re;
  await env.DB.prepare('DELETE FROM stage_field_configs WHERE id=?').bind(p.id).run();
  return json({ success: true });
});

// ═════════════════════════════════════════════════════════════════════════════
// PROGRAM LOCAL SETTINGS
// ═════════════════════════════════════════════════════════════════════════════

R.get('/api/v1/program-settings/:pipeline', async (req, env, ctx, p) => {
  const u = await auth(req, env); if (!u) return err('Unauthorized', 401);
  const VALID = ['J1_PROGRAM','SEA_BASED','LAND_BASED'];
  if (!VALID.includes(p.pipeline)) return err('Invalid pipeline');
  const rows = await env.DB.prepare('SELECT setting_key, setting_value FROM program_settings WHERE pipeline=?').bind(p.pipeline).all();
  const settings = Object.fromEntries((rows.results || []).map(r => [r.setting_key, r.setting_value]));
  return json({ settings });
});

R.patch('/api/v1/program-settings/:pipeline', async (req, env, ctx, p) => {
  const u = await auth(req, env); const re = role(u, 'SUPER_ADMIN', 'ADMIN'); if (re) return re;
  const VALID = ['J1_PROGRAM','SEA_BASED','LAND_BASED'];
  if (!VALID.includes(p.pipeline)) return err('Invalid pipeline');
  const b = await req.json();
  const now = new Date().toISOString();
  const stmts = Object.entries(b).map(([k, v]) =>
    env.DB.prepare('INSERT INTO program_settings(pipeline,setting_key,setting_value,updated_by_id,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(pipeline,setting_key) DO UPDATE SET setting_value=excluded.setting_value, updated_by_id=excluded.updated_by_id, updated_at=excluded.updated_at')
      .bind(p.pipeline, k, String(v), u.id, now)
  );
  if (stmts.length) await env.DB.batch(stmts);
  return json({ success: true });
});

// The public one-way interview taking endpoints and the CLIENT_CONTACT
// portal (which only ever showed client_endorsements) were removed in v8 —
// interview taking is ZeusHire's job, and client-side endorsement review no
// longer applies now that Poseidon starts at ONBOARDING.

// ═════════════════════════════════════════════════════════════════════════════
// DASHBOARD STATS
// ═════════════════════════════════════════════════════════════════════════════

R.get('/api/v1/stats', async (req, env) => {
  const u = await auth(req, env); const re = role(u, 'SUPER_ADMIN', 'ADMIN', 'RECRUITER', 'ONBOARDING_TEAM'); if (re) return re;
  const recruiterFilter = u.role === 'RECRUITER' ? 'AND assigned_recruiter_id=?' : '';
  const rb = u.role === 'RECRUITER' ? [u.id] : [];
  const [total, byPipeline, byStatus, recent, deployed] = await Promise.all([
    env.DB.prepare(`SELECT COUNT(*) cnt FROM candidates WHERE 1=1 ${recruiterFilter}`).bind(...rb).first(),
    env.DB.prepare(`SELECT pipeline,COUNT(*)cnt FROM candidates WHERE 1=1 ${recruiterFilter} GROUP BY pipeline`).bind(...rb).all(),
    env.DB.prepare(`SELECT status,COUNT(*)cnt FROM candidates WHERE 1=1 ${recruiterFilter} GROUP BY status ORDER BY cnt DESC LIMIT 10`).bind(...rb).all(),
    env.DB.prepare(`SELECT COUNT(*)cnt FROM candidates WHERE created_at>=datetime('now','-30 days') ${recruiterFilter}`).bind(...rb).first(),
    env.DB.prepare(`SELECT COUNT(*)cnt FROM candidates WHERE status='ONBOARDING' ${recruiterFilter}`).bind(...rb).first()
  ]);
  return json({
    total: total.cnt,
    deployed: deployed.cnt,
    pushedLast30Days: recent.cnt,
    byPipeline: Object.fromEntries((byPipeline.results || []).map(r => [r.pipeline, r.cnt])),
    byStatus: byStatus.results || []
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// WORKSPACE + MASTER DASHBOARDS  (data-isolation + global roll-up)
// ═════════════════════════════════════════════════════════════════════════════

const TYPE_TO_PIPELINE = { J1: 'J1_PROGRAM', SEA: 'SEA_BASED', LAND: 'LAND_BASED' };

// ── Per-workspace dashboard (strictly scoped by pipeline; recruiters see own rows)
R.get('/api/v1/workspaces/:type/dashboard', async (req, env, ctx, p) => {
  const u = await auth(req, env);
  const re = role(u, 'SUPER_ADMIN', 'ADMIN', 'RECRUITER', 'ONBOARDING_TEAM'); if (re) return re;

  const pipeline = TYPE_TO_PIPELINE[(p.type || '').toUpperCase()];
  if (!pipeline) return err('Unknown workspace', 404);

  const isRecruiter = u.role === 'RECRUITER';
  // mandatory candidate-table scope
  const cScope = ['pipeline=?']; const cBinds = [pipeline];
  if (isRecruiter) { cScope.push('assigned_recruiter_id=?'); cBinds.push(u.id); }
  const cWhere = `WHERE ${cScope.join(' AND ')}`;
  // documents-join scope (aliased; inherits the pipeline scope through the join)
  const dScope = ['c.pipeline=?', 'd.expiration_date IS NOT NULL']; const dBinds = [pipeline];
  if (isRecruiter) { dScope.push('c.assigned_recruiter_id=?'); dBinds.push(u.id); }
  const dWhere = `WHERE ${dScope.join(' AND ')}`;

  const [funnel, intake30, compliance] = await Promise.all([
    env.DB.prepare(`SELECT status, COUNT(*) cnt FROM candidates ${cWhere} GROUP BY status`).bind(...cBinds).all(),
    env.DB.prepare(`SELECT COUNT(*) cnt FROM candidates ${cWhere} AND created_at>=datetime('now','-30 days')`).bind(...cBinds).first(),
    env.DB.prepare(
      `SELECT
         SUM(CASE WHEN d.expiration_date < datetime('now') THEN 1 ELSE 0 END) expired,
         SUM(CASE WHEN d.expiration_date >= datetime('now')
                   AND d.expiration_date <= datetime('now','+30 days') THEN 1 ELSE 0 END) expiringSoon
       FROM documents d JOIN candidates c ON d.candidate_id=c.id ${dWhere}`
    ).bind(...dBinds).first(),
  ]);

  const byStatus = Object.fromEntries((funnel.results || []).map(r => [r.status, r.cnt]));
  const total = Object.values(byStatus).reduce((n, c) => n + c, 0);
  const deployed = byStatus['DEPLOYED'] || 0;

  return json({
    pipeline,
    funnel: byStatus,
    total,
    deployed,
    deployRate: total ? +(deployed / total * 100).toFixed(1) : 0,
    pushedLast30Days: intake30.cnt,
    compliance: { expired: compliance?.expired || 0, expiringSoon: compliance?.expiringSoon || 0 },
  });
});

// ── Master dashboard (KV-cached global roll-up; stale-while-revalidate) ─────────
const MASTER_KEY = 'master_dashboard';
const MASTER_TTL_MS = 15 * 60 * 1000;

async function computeMasterDashboard(env) {
  const [byPipeline, byStatusPipe, recruiterLoad] = await Promise.all([
    env.DB.prepare(`SELECT pipeline, COUNT(*) cnt FROM candidates GROUP BY pipeline`).all(),
    env.DB.prepare(`SELECT pipeline, status, COUNT(*) cnt FROM candidates GROUP BY pipeline, status`).all(),
    env.DB.prepare(
      `SELECT c.assigned_recruiter_id rid, u.first_name fn, u.last_name ln, COUNT(*) load
       FROM candidates c JOIN users u ON c.assigned_recruiter_id=u.id
       WHERE c.status NOT IN ('ARCHIVED')
       GROUP BY c.assigned_recruiter_id ORDER BY load DESC`
    ).all(),
  ]);

  const macro = { onboarding: 0, readyToDeploy: 0, deployed: 0, archived: 0 };
  for (const r of (byStatusPipe.results || [])) {
    if (r.status === 'ONBOARDING')      macro.onboarding += r.cnt;
    if (r.status === 'READY_TO_DEPLOY') macro.readyToDeploy += r.cnt;
    if (r.status === 'DEPLOYED')        macro.deployed += r.cnt;
    if (r.status === 'ARCHIVED')        macro.archived += r.cnt;
  }

  return {
    computedAt: Date.now(),
    byPipeline: Object.fromEntries((byPipeline.results || []).map(r => [r.pipeline, r.cnt])),
    globalFunnel: macro,
    totalPlacements: macro.deployed,
    recruiterLoad: recruiterLoad.results || [],
  };
}

async function refreshMasterDashboard(env) {
  const data = await computeMasterDashboard(env);
  await env.KV.put(MASTER_KEY, JSON.stringify(data));
  return data;
}

R.get('/api/v1/master/dashboard', async (req, env, ctx) => {
  const u = await auth(req, env);
  const re = role(u, 'SUPER_ADMIN', 'ADMIN'); if (re) return re;   // executive-only
  const cached = await env.KV.get(MASTER_KEY, { type: 'json' });
  if (cached) {
    const stale = Date.now() - cached.computedAt > MASTER_TTL_MS;
    if (stale) ctx.waitUntil(refreshMasterDashboard(env).catch(() => {}));
    return json({ ...cached, stale });
  }
  return json(await refreshMasterDashboard(env));   // cold start
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
  } else { const re = role(u, 'SUPER_ADMIN', 'ADMIN', 'RECRUITER', 'ONBOARDING_TEAM'); if (re) return re; }
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
  const u = await auth(req, env); const re = role(u, 'SUPER_ADMIN', 'ADMIN', 'RECRUITER', 'ONBOARDING_TEAM'); if (re) return re;
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
  if (!c || c.user_id) return { link: null, emailSent: false };
  const raw = genToken();
  const h = await hashTok(raw);
  const exp = new Date(Date.now() + 72 * 3600000).toISOString();
  await env.KV.put(`activation:${h}`, JSON.stringify({ candidateId, expiresAt: exp }), { expirationTtl: 72 * 3600 });
  const link = `https://putuastra.github.io/poseidon-crm/portal.html?activate=${raw}`;
  let emailSent = false;
  try {
    await sendMail(env, c.email, 'POSEIDON — Activate Your Candidate Portal',
      `<div style="font-family:sans-serif;max-width:580px;margin:auto;padding:32px"><img src="https://putuastra.github.io/poseidon-crm/logo-poseidon.png" height="40" alt="CTI POSEIDON"><h2 style="color:#1a56db;margin-top:24px">Congratulations, ${c.first_name}!</h2><p>You have been approved. Your personal candidate portal is now ready.</p><p style="margin:28px 0;text-align:center"><a href="${link}" style="background:#1a56db;color:#fff;padding:14px 32px;border-radius:8px;text-decoration:none;font-size:15px;font-weight:600;display:inline-block">Activate My Portal</a></p><p style="color:#6b7280;font-size:13px">This link expires in 72 hours. Do not share it.<br>CTI Group Worldwide Services, Inc. — POSEIDON</p></div>`
    );
    emailSent = true;
  } catch (e) {
    console.error('Portal email failed:', e?.message);
  }
  return { link, emailSent };
}

// ═════════════════════════════════════════════════════════════════════════════
// ENTRY POINT
// ═════════════════════════════════════════════════════════════════════════════

export default {
  async fetch(request, env, ctx) {
    return R.handle(request, env, ctx);
  },
  // Cron Trigger (configure in Dashboard → Worker → Settings → Triggers, e.g. */15 * * * *)
  async scheduled(event, env, ctx) {
    ctx.waitUntil(refreshMasterDashboard(env));
  }
};
