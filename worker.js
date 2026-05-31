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
        // Signal the master roll-up to refresh after any successful candidate/
        // submission mutation (keeps the cached executive view near-real-time).
        if (req.method !== 'GET' && res.status < 300 &&
            /\/api\/v1\/(candidates|submissions)/.test(url.pathname)) {
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
  const { firstName, lastName, email, phone, pipeline, positionApplied, nationality, gender, ctiOffice, employmentStatus, origin, internalNotes } = await req.json();
  if (!firstName || !lastName || !email || !pipeline) return err('firstName, lastName, email, pipeline required');
  const VALID_PIPELINES = ['SEA_BASED', 'LAND_BASED', 'J1_PROGRAM'];
  if (!VALID_PIPELINES.includes(pipeline)) return err('Invalid pipeline');
  const existing = await env.DB.prepare('SELECT id FROM candidates WHERE email=? COLLATE NOCASE').bind(email).first();
  if (existing) return err('A candidate with this email already exists', 409);
  const id = cuid();
  await env.DB.batch([
    env.DB.prepare('INSERT INTO candidates(id,first_name,last_name,email,phone,pipeline,status,position_applied,nationality,gender,cti_office,employment_status,origin,assigned_recruiter_id,internal_notes)VALUES(?,?,?,?,?,?,\'NEW_SUBMISSION\',?,?,?,?,?,?,?,?)')
      .bind(id, firstName, lastName, email, phone || null, pipeline, positionApplied || null, nationality || null, gender || null, ctiOffice || null, employmentStatus || 'New', origin || 'Applied', u.id, internalNotes || null),
    env.DB.prepare("INSERT INTO pipeline_stage_history(id,candidate_id,from_status,to_status,triggered_by_id,reason)VALUES(?,?,NULL,'NEW_SUBMISSION',?,'Manually created')")
      .bind(cuid(), id, u.id)
  ]);
  return json({ candidateId: id }, 201);
});

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
  const [ci, ce, docs, hist, seaProf, j1Prof] = await Promise.all([
    env.DB.prepare('SELECT ci.*,i.title,i.type FROM candidate_interviews ci JOIN interviews i ON ci.interview_id=i.id WHERE ci.candidate_id=? ORDER BY ci.invited_at DESC').bind(p.id).all(),
    env.DB.prepare('SELECT ce.*,cl.name client_name,cl.type client_type FROM client_endorsements ce JOIN clients cl ON ce.client_id=cl.id WHERE ce.candidate_id=?').bind(p.id).all(),
    env.DB.prepare('SELECT*FROM documents WHERE candidate_id=? ORDER BY created_at DESC').bind(p.id).all(),
    env.DB.prepare('SELECT h.*,u2.first_name fn,u2.last_name ln FROM pipeline_stage_history h LEFT JOIN users u2 ON h.triggered_by_id=u2.id WHERE h.candidate_id=? ORDER BY h.created_at DESC LIMIT 30').bind(p.id).all(),
    env.DB.prepare('SELECT*FROM seafarer_profiles WHERE candidate_id=?').bind(p.id).first().catch(() => null),
    env.DB.prepare('SELECT*FROM j1_profiles WHERE candidate_id=?').bind(p.id).first().catch(() => null)
  ]);
  return json({ ...c, interviews: ci.results, endorsements: ce.results, documents: docs.results, stageHistory: hist.results, seafarerProfile: seaProf || null, j1Profile: j1Prof || null });
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
  const VALID_STATES = [
    'NEW_SUBMISSION','CANDIDATES','FINAL_INTERVIEW','OFFER_LETTER','ONBOARDING',
    'READY_TO_DEPLOY','DEPLOYED','ARCHIVED',
    // J1 Program statuses (v7 Phase 1 — guarded transitions land in Phase 2)
    'ELIGIBILITY_REVIEW','CONSULTATION_CALL',
    'J1_STAGE_1','J1_STAGE_2','J1_STAGE_3','J1_STAGE_4','J1_VISA'
  ];
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

R.post('/api/v1/candidates/:id/transitions/move-forward', async (req, env, ctx, p) => {
  const u = await auth(req, env); const re = role(u, 'SUPER_ADMIN', 'ADMIN', 'RECRUITER'); if (re) return re;
  const c = await env.DB.prepare('SELECT id,status,pipeline,assigned_recruiter_id FROM candidates WHERE id=?').bind(p.id).first();
  if (!c) return err('Not found', 404);
  if (c.status !== 'NEW_SUBMISSION') return err(`Guard failed: expected NEW_SUBMISSION, got ${c.status}`, 422);
  // Sea-Based AND Land-Based both require a completed one-way interview before Move Forward.
  if (['SEA_BASED', 'LAND_BASED'].includes(c.pipeline)) {
    const ow = await env.DB.prepare("SELECT id FROM candidate_interviews WHERE candidate_id=? AND type='ONE_WAY' AND status='COMPLETED' LIMIT 1").bind(p.id).first();
    if (!ow) return err('A completed one-way interview is required before moving this candidate forward', 422);
  }
  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare("UPDATE candidates SET status='CANDIDATES',updated_at=? WHERE id=?").bind(now, p.id),
    env.DB.prepare('INSERT INTO pipeline_stage_history(id,candidate_id,from_status,to_status,triggered_by_id,reason)VALUES(?,?,?,?,?,?)').bind(cuid(), p.id, 'NEW_SUBMISSION', 'CANDIDATES', u.id, 'Moved forward from intake')
  ]);
  return json({ success: true, toStatus: 'CANDIDATES' });
});

R.post('/api/v1/candidates/:id/transitions/not-moving-forward', async (req, env, ctx, p) => {
  const u = await auth(req, env); const re = role(u, 'SUPER_ADMIN', 'ADMIN', 'RECRUITER'); if (re) return re;
  const { reason } = await req.json().catch(() => ({}));
  const c = await env.DB.prepare('SELECT id,status FROM candidates WHERE id=?').bind(p.id).first();
  if (!c) return err('Not found', 404);
  if (c.status !== 'NEW_SUBMISSION') return err(`Guard failed: expected NEW_SUBMISSION, got ${c.status}`, 422);
  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare("UPDATE candidates SET status='ARCHIVED',archive_reason=?,archived_at=?,archived_by_id=?,updated_at=? WHERE id=?").bind(reason||'Not moving forward', now, u.id, now, p.id),
    env.DB.prepare('INSERT INTO pipeline_stage_history(id,candidate_id,from_status,to_status,triggered_by_id,reason)VALUES(?,?,?,?,?,?)').bind(cuid(), p.id, 'NEW_SUBMISSION', 'ARCHIVED', u.id, reason||'Not moving forward')
  ]);
  return json({ success: true, toStatus: 'ARCHIVED' });
});

// Multi-client endorse. Accepts `{ clientIds: [..] }` (preferred) or `{ clientId }`
// for backward compatibility. Candidate enters FINAL_INTERVIEW with
// endorsed_client_id = NULL — only the winning client (set by /endorsements/:id/decision
// APPROVED) populates that pointer.
R.post('/api/v1/candidates/:id/transitions/endorse', async (req, env, ctx, p) => {
  const u = await auth(req, env); const re = role(u, 'SUPER_ADMIN', 'ADMIN', 'RECRUITER'); if (re) return re;
  const b = await req.json().catch(() => ({}));
  const rawIds = Array.isArray(b.clientIds) ? b.clientIds : (b.clientId ? [b.clientId] : []);
  const clientIds = [...new Set(rawIds.map(s => String(s).trim()).filter(Boolean))];
  if (!clientIds.length) return err('clientIds required');
  if (clientIds.length > 10) return err('At most 10 clients per endorsement', 422);

  const c = await env.DB.prepare('SELECT id,status,pipeline FROM candidates WHERE id=?').bind(p.id).first();
  if (!c) return err('Candidate not found', 404);
  if (c.status !== 'CANDIDATES') return err(`Guard failed: expected CANDIDATES, got ${c.status}`, 422);

  // Sea-Based AND Land-Based both require a passed two-way interview before endorsement.
  if (['SEA_BASED', 'LAND_BASED'].includes(c.pipeline)) {
    const tw = await env.DB.prepare(
      `SELECT status, passed FROM candidate_interviews
        WHERE candidate_id=? AND type='TWO_WAY'
        ORDER BY COALESCE(completed_at, scheduled_at, invited_at) DESC LIMIT 1`
    ).bind(p.id).first();
    if (!tw || tw.status !== 'COMPLETED' || tw.passed !== 1) {
      return err('A passed two-way interview is required before endorsing this candidate', 422);
    }
  }

  const placeholders = clientIds.map(() => '?').join(',');
  const { results: clients } = await env.DB.prepare(
    `SELECT id, name FROM clients WHERE is_active=1 AND id IN (${placeholders})`
  ).bind(...clientIds).all();
  if (clients.length !== clientIds.length) return err('One or more clients not found or inactive', 404);

  const now = new Date().toISOString();
  const meta = JSON.stringify({ clientIds, clientNames: clients.map(cl => cl.name) });

  // Upsert N endorsements; reset candidate's cached endorsed_client_* (multi-client model
  // means no single winning client until one decides APPROVED).
  const stmts = [];
  for (const cl of clients) {
    const ex = await env.DB.prepare('SELECT id FROM client_endorsements WHERE candidate_id=? AND client_id=?').bind(p.id, cl.id).first();
    if (ex) {
      stmts.push(env.DB.prepare(
        "UPDATE client_endorsements SET status='PENDING', endorsed_by_id=?, endorsed_at=?, decided_at=NULL, decision_notes=NULL, updated_at=? WHERE id=?"
      ).bind(u.id, now, now, ex.id));
    } else {
      stmts.push(env.DB.prepare(
        "INSERT INTO client_endorsements(id, candidate_id, client_id, status, endorsed_by_id, endorsed_at, updated_at) VALUES (?,?,?,'PENDING',?,?,?)"
      ).bind(cuid(), p.id, cl.id, u.id, now, now));
    }
  }
  // CAS guard: only flip the candidate if still in CANDIDATES (prevents racing endorsements).
  stmts.push(env.DB.prepare(
    "UPDATE candidates SET status='FINAL_INTERVIEW', endorsed_client_id=NULL, endorsed_client_name=NULL, updated_at=? WHERE id=? AND status='CANDIDATES'"
  ).bind(now, p.id));
  stmts.push(env.DB.prepare(
    "INSERT INTO pipeline_stage_history(id,candidate_id,from_status,to_status,triggered_by_id,reason,metadata) VALUES (?,?,?,?,?,?,?)"
  ).bind(cuid(), p.id, 'CANDIDATES', 'FINAL_INTERVIEW', u.id, `Endorsed to ${clients.map(cl => cl.name).join(', ')}`, meta));

  const results = await env.DB.batch(stmts);
  // The candidate UPDATE is the second-to-last statement
  const candResult = results[results.length - 2];
  if (!candResult || candResult.meta.changes !== 1) {
    return err('Candidate state changed during endorsement', 409);
  }

  return json({
    success: true,
    toStatus: 'FINAL_INTERVIEW',
    clientNames: clients.map(cl => cl.name),
    clientIds: clients.map(cl => cl.id)
  });
});

R.post('/api/v1/candidates/:id/transitions/client-approved', async (req, env, ctx, p) => {
  const u = await auth(req, env); const re = role(u, 'SUPER_ADMIN', 'ADMIN', 'CLIENT_CONTACT'); if (re) return re;
  const { notes } = await req.json().catch(() => ({}));
  const c = await env.DB.prepare('SELECT id,status,endorsed_client_id FROM candidates WHERE id=?').bind(p.id).first();
  if (!c) return err('Not found', 404);
  if (c.status !== 'FINAL_INTERVIEW') return err(`Guard failed: expected FINAL_INTERVIEW, got ${c.status}`, 422);
  if (u.role === 'CLIENT_CONTACT') {
    // Forward-compatible scope: a CLIENT_CONTACT user may approve only if their
    // client has an active endorsement on this candidate. Avoids relying on
    // candidates.endorsed_client_id which is intended to be NULL during
    // FINAL_INTERVIEW once multi-client endorsement lands.
    const cc = await env.DB.prepare('SELECT client_id FROM client_contacts WHERE user_id=?').bind(u.id).first();
    if (!cc) return err('Forbidden', 403);
    const endo = await env.DB.prepare("SELECT id FROM client_endorsements WHERE candidate_id=? AND client_id=? AND status IN ('PENDING','SCHEDULED','APPROVED')").bind(p.id, cc.client_id).first();
    if (!endo) return err('Forbidden', 403);
  }
  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare("UPDATE candidates SET status='OFFER_LETTER',updated_at=? WHERE id=?").bind(now, p.id),
    env.DB.prepare("UPDATE client_endorsements SET status='APPROVED',decided_at=?,decision_notes=?,updated_at=? WHERE candidate_id=? AND client_id=?").bind(now, notes||null, now, p.id, c.endorsed_client_id||''),
    env.DB.prepare('INSERT INTO pipeline_stage_history(id,candidate_id,from_status,to_status,triggered_by_id,reason)VALUES(?,?,?,?,?,?)').bind(cuid(), p.id, 'FINAL_INTERVIEW', 'OFFER_LETTER', u.id, notes||'Client approved')
  ]);
  return json({ success: true, toStatus: 'OFFER_LETTER' });
});

R.post('/api/v1/candidates/:id/transitions/client-rejected', async (req, env, ctx, p) => {
  const u = await auth(req, env); const re = role(u, 'SUPER_ADMIN', 'ADMIN', 'CLIENT_CONTACT'); if (re) return re;
  const { reason } = await req.json().catch(() => ({}));
  const c = await env.DB.prepare('SELECT id,status,endorsed_client_id FROM candidates WHERE id=?').bind(p.id).first();
  if (!c) return err('Not found', 404);
  if (c.status !== 'FINAL_INTERVIEW') return err(`Guard failed: expected FINAL_INTERVIEW, got ${c.status}`, 422);
  if (u.role === 'CLIENT_CONTACT') {
    // Forward-compatible scope (see client-approved handler above for rationale).
    const cc = await env.DB.prepare('SELECT client_id FROM client_contacts WHERE user_id=?').bind(u.id).first();
    if (!cc) return err('Forbidden', 403);
    const endo = await env.DB.prepare("SELECT id FROM client_endorsements WHERE candidate_id=? AND client_id=? AND status IN ('PENDING','SCHEDULED','APPROVED')").bind(p.id, cc.client_id).first();
    if (!endo) return err('Forbidden', 403);
  }
  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare("UPDATE candidates SET status='ARCHIVED',archive_reason=?,archived_at=?,archived_by_id=?,updated_at=? WHERE id=?").bind(reason||'Client rejected', now, u.id, now, p.id),
    env.DB.prepare("UPDATE client_endorsements SET status='REJECTED',decided_at=?,decision_notes=?,updated_at=? WHERE candidate_id=? AND client_id=?").bind(now, reason||null, now, p.id, c.endorsed_client_id||''),
    env.DB.prepare('INSERT INTO pipeline_stage_history(id,candidate_id,from_status,to_status,triggered_by_id,reason)VALUES(?,?,?,?,?,?)').bind(cuid(), p.id, 'FINAL_INTERVIEW', 'ARCHIVED', u.id, reason||'Client rejected')
  ]);
  return json({ success: true, toStatus: 'ARCHIVED' });
});

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
  const VALID = [
    'NEW_SUBMISSION','CANDIDATES','FINAL_INTERVIEW','OFFER_LETTER','ONBOARDING',
    // J1 Program restorable states (DEPLOYED intentionally excluded — re-enroll instead)
    'ELIGIBILITY_REVIEW','CONSULTATION_CALL',
    'J1_STAGE_1','J1_STAGE_2','J1_STAGE_3','J1_STAGE_4','J1_VISA'
  ];
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

// ── Offer Letters ─────────────────────────────────────────────────────────────

R.get('/api/v1/candidates/:id/offer-letters', async (req, env, ctx, p) => {
  const u = await auth(req, env); const re = role(u, 'SUPER_ADMIN', 'ADMIN', 'RECRUITER', 'ONBOARDING_TEAM'); if (re) return re;
  const { results } = await env.DB.prepare('SELECT ol.*,u.first_name gen_fn,u.last_name gen_ln FROM offer_letters ol JOIN users u ON ol.generated_by_id=u.id WHERE ol.candidate_id=? ORDER BY ol.created_at DESC').bind(p.id).all();
  return json({ offerLetters: results });
});

R.post('/api/v1/candidates/:id/offer-letters', async (req, env, ctx, p) => {
  const u = await auth(req, env); const re = role(u, 'SUPER_ADMIN', 'ADMIN'); if (re) return re;
  const { documentUrl, notes, signingPlatform } = await req.json().catch(() => ({}));
  const c = await env.DB.prepare('SELECT id,status FROM candidates WHERE id=?').bind(p.id).first();
  if (!c) return err('Not found', 404);
  if (!['FINAL_INTERVIEW','OFFER_LETTER'].includes(c.status)) return err(`Guard failed: candidate must be in FINAL_INTERVIEW or OFFER_LETTER stage`, 422);
  const now = new Date().toISOString();
  const id = cuid();
  await env.DB.prepare('INSERT INTO offer_letters(id,candidate_id,generated_by_id,document_url,notes,signing_platform,generated_at,created_at,updated_at)VALUES(?,?,?,?,?,?,?,?,?)')
    .bind(id, p.id, u.id, documentUrl||null, notes||null, signingPlatform||'MANUAL', now, now, now).run();
  return json({ id, success: true }, 201);
});

R.patch('/api/v1/offer-letters/:id', async (req, env, ctx, p) => {
  const u = await auth(req, env); const re = role(u, 'SUPER_ADMIN', 'ADMIN'); if (re) return re;
  const b = await req.json().catch(() => ({}));
  const map = {
    document_url: b.documentUrl,
    notes: b.notes,
    signing_session_id: b.signingSessionId,
    signing_url: b.signingUrl,
    signing_expires_at: b.signingExpiresAt,
    sent_for_signing_at: b.sentForSigningAt,
  };
  const upd = Object.fromEntries(Object.entries(map).filter(([, v]) => v !== undefined));
  if (!Object.keys(upd).length) return err('No valid fields');
  upd.updated_at = new Date().toISOString();
  await env.DB.prepare(`UPDATE offer_letters SET ${Object.keys(upd).map(k=>`${k}=?`).join()} WHERE id=?`).bind(...Object.values(upd), p.id).run();
  return json({ success: true });
});

R.post('/api/v1/offer-letters/:id/send', async (req, env, ctx, p) => {
  const u = await auth(req, env); const re = role(u, 'SUPER_ADMIN', 'ADMIN'); if (re) return re;
  const ol = await env.DB.prepare('SELECT*FROM offer_letters WHERE id=?').bind(p.id).first();
  if (!ol) return err('Offer letter not found', 404);
  if (!ol.document_url) return err('Guard failed: document_url must be set before sending', 422);
  // Preflight: include pipeline + the SEA_BASED Marlins gate.
  const c = await env.DB.prepare(
    `SELECT c.id, c.status, c.pipeline, sp.marlins_passed_at
       FROM candidates c
       LEFT JOIN seafarer_profiles sp ON sp.candidate_id = c.id
      WHERE c.id = ?`
  ).bind(ol.candidate_id).first();
  if (!c) return err('Candidate not found', 404);
  if (c.pipeline === 'SEA_BASED' && !c.marlins_passed_at) {
    return err('Marlins English Test must be passed before sending the offer for a Sea-Based candidate', 422);
  }
  const now = new Date().toISOString();
  const batchOps = [
    env.DB.prepare("UPDATE offer_letters SET sent_for_signing_at=?,updated_at=? WHERE id=?").bind(now, now, p.id)
  ];
  if (c.status === 'FINAL_INTERVIEW') {
    batchOps.push(
      env.DB.prepare("UPDATE candidates SET status='OFFER_LETTER',updated_at=? WHERE id=?").bind(now, c.id),
      env.DB.prepare('INSERT INTO pipeline_stage_history(id,candidate_id,from_status,to_status,triggered_by_id,reason)VALUES(?,?,?,?,?,?)').bind(cuid(), c.id, 'FINAL_INTERVIEW', 'OFFER_LETTER', u.id, 'Offer letter sent for signing')
    );
  }
  await env.DB.batch(batchOps);
  return json({ success: true });
});

// ── Signature Webhook ─────────────────────────────────────────────────────────

R.post('/api/v1/webhooks/signature-confirmed', async (req, env) => {
  const sigHeader = req.headers.get('X-Poseidon-Sig');
  const bodyText = await req.text();
  let body;
  try { body = JSON.parse(bodyText); } catch { return err('Invalid JSON', 400); }
  if (env.SIGNING_WEBHOOK_SECRET && sigHeader) {
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey('raw', enc.encode(env.SIGNING_WEBHOOK_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const expectedBuf = await crypto.subtle.sign('HMAC', key, enc.encode(bodyText));
    const expected = Array.from(new Uint8Array(expectedBuf)).map(b => b.toString(16).padStart(2, '0')).join('');
    if (sigHeader !== expected) return err('Invalid webhook signature', 401);
  }
  const { signingSessionId, candidateId, signedBlob } = body;
  if (!signingSessionId && !candidateId) return err('signingSessionId or candidateId required', 400);
  let ol;
  if (signingSessionId) {
    ol = await env.DB.prepare('SELECT*FROM offer_letters WHERE signing_session_id=?').bind(signingSessionId).first();
  } else {
    ol = await env.DB.prepare('SELECT*FROM offer_letters WHERE candidate_id=? ORDER BY created_at DESC LIMIT 1').bind(candidateId).first();
  }
  if (!ol) return err('Offer letter not found', 404);
  const c = await env.DB.prepare('SELECT id,status FROM candidates WHERE id=?').bind(ol.candidate_id).first();
  if (!c) return err('Candidate not found', 404);
  if (!['OFFER_LETTER','FINAL_INTERVIEW'].includes(c.status)) return json({ ignored: true, reason: 'Candidate not in signable state' });
  const now = new Date().toISOString();
  await env.DB.batch([
    env.DB.prepare("UPDATE offer_letters SET signed_at=?,signed_blob=?,webhook_verified=1,webhook_received_at=?,updated_at=? WHERE id=?").bind(now, signedBlob||'confirmed', now, now, ol.id),
    env.DB.prepare("UPDATE candidates SET status='ONBOARDING',updated_at=? WHERE id=?").bind(now, ol.candidate_id),
    env.DB.prepare('INSERT INTO pipeline_stage_history(id,candidate_id,from_status,to_status,triggered_by_id,reason,metadata)VALUES(?,?,?,?,?,?,?)').bind(cuid(), ol.candidate_id, c.status, 'ONBOARDING', null, 'Offer letter signed — auto-advanced to Onboarding', JSON.stringify({ offerId: ol.id, signingSessionId: signingSessionId||null }))
  ]);
  // Portal access is unlocked at ONBOARDING (and only here). Best-effort — failure to
  // send the activation email must not roll back the status advance.
  try { await provisionPortal(env, ol.candidate_id); } catch (e) { console.error('Portal provision failed:', e?.message); }
  return json({ success: true, candidateId: ol.candidate_id, toStatus: 'ONBOARDING' });
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
  // Generate human-readable reference: CTI-YYYYMM-NNNNN
  const now = new Date();
  const ym = now.getFullYear().toString() + String(now.getMonth() + 1).padStart(2, '0');
  const countRow = await env.DB.prepare('SELECT COUNT(*) as n FROM submissions').first();
  const seq = String((countRow?.n ?? 0) + 1).padStart(5, '0');
  const referenceId = `CTI-${ym}-${seq}`;
  await env.DB.prepare('INSERT INTO submissions(id,form_id,pipeline,data,ip_address,user_agent)VALUES(?,?,?,?,?,?)')
    .bind(id, formId, pipeline, JSON.stringify({ ...data, referenceId }), req.headers.get('CF-Connecting-IP'), req.headers.get('User-Agent')).run();
  return json({ submissionId: id, referenceId, message: 'Application received successfully' }, 201);
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
  // LEFT JOIN so external-provider rows (ZeusHire ONE_WAY/TWO_WAY) with NULL interview_id
  // are included. ci.type holds the session type for external rows; fall back to i.type.
  const { results } = await env.DB.prepare(
    `SELECT ci.*,
            COALESCE(i.title, ci.external_provider || ' ' || COALESCE(ci.type, 'Interview')) AS title,
            COALESCE(i.type,  ci.type) AS type
       FROM candidate_interviews ci
       LEFT JOIN interviews i ON ci.interview_id = i.id
      WHERE ci.candidate_id = ?
      ORDER BY ci.invited_at DESC`
  ).bind(p.id).all();
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
// SEA-BASED — ZEUSHIRE INTERVIEW INTEGRATION (one-way + two-way)
// ═════════════════════════════════════════════════════════════════════════════

// Pipelines that use the deployment-style flow (one-way → two-way → endorse →
// offer → onboarding → ready → deployed). Sea-Based and Land-Based share this.
const DEPLOYMENT_PIPELINES = ['SEA_BASED', 'LAND_BASED'];

async function _resolveZeushireInterviewId(env, override, key, envFallback, pipeline = 'SEA_BASED') {
  if (override) return override;
  const row = await env.DB.prepare(
    "SELECT setting_value FROM program_settings WHERE pipeline=? AND setting_key=?"
  ).bind(pipeline, key).first();
  return row?.setting_value || envFallback || null;
}

R.post('/api/v1/sea/interviews/one-way', async (req, env) => {
  const u = await auth(req, env); const re = role(u, 'SUPER_ADMIN', 'ADMIN', 'RECRUITER'); if (re) return re;
  const b = await req.json().catch(() => ({}));
  const { candidateId, expiresInHours = 168 } = b;
  if (!candidateId) return err('candidateId required');
  if (!env.ZEUSHIRE_API_URL || !env.ZEUSHIRE_API_KEY) return err('ZeusHire integration not configured (set ZEUSHIRE_API_URL + ZEUSHIRE_API_KEY)', 503);

  const c = await env.DB.prepare('SELECT id,first_name,last_name,email,pipeline,status,archived_at FROM candidates WHERE id=?').bind(candidateId).first();
  if (!c) return err('Candidate not found', 404);
  if (c.archived_at) return err('Candidate is archived', 422);
  if (!DEPLOYMENT_PIPELINES.includes(c.pipeline)) return err('One-way interviews are only for Sea-Based / Land-Based pipelines', 422);
  if (c.status !== 'NEW_SUBMISSION') return err(`Candidate must be in NEW_SUBMISSION (is ${c.status})`, 422);
  if (!c.first_name || !c.last_name || !c.email) return err('Candidate must have first/last name and email', 422);

  const zhInterviewId = await _resolveZeushireInterviewId(env, b.zeushireInterviewId, 'zeushire_one_way_interview_id', env.ZEUSHIRE_DEFAULT_ONE_WAY_INTERVIEW, c.pipeline);
  if (!zhInterviewId) return err(`No ZeusHire one-way interview configured. Set one in the ${c.pipeline === 'SEA_BASED' ? 'Sea-Based' : 'Land-Based'} Local Settings.`, 422);

  // 1) Create the session in ZeusHire (token bound to identity)
  const zhUrl = `${env.ZEUSHIRE_API_URL.replace(/\/$/, '')}/api/interview/${encodeURIComponent(zhInterviewId)}/sessions`;
  let zhRes;
  try {
    zhRes = await fetch(zhUrl, {
      method: 'POST',
      headers: { 'X-Admin-Key': env.ZEUSHIRE_API_KEY, 'content-type': 'application/json' },
      body: JSON.stringify({
        candidateFirstName: c.first_name,
        candidateLastName:  c.last_name,
        candidateEmail:     c.email,
        expiresInHours
      })
    });
  } catch (e) {
    return err(`ZeusHire request failed: ${e.message || 'network error'}`, 502);
  }
  if (!zhRes.ok) {
    const text = await zhRes.text().catch(() => '');
    return err(`ZeusHire returned ${zhRes.status}: ${text.slice(0, 200)}`, 502);
  }
  let zhData;
  try { zhData = await zhRes.json(); } catch { return err('ZeusHire returned non-JSON', 502); }
  const sessionId = zhData.sessionId || zhData.id;
  const token     = zhData.token || zhData.sessionToken;
  const takeUrl   = zhData.takeUrl || zhData.url || (token ? `${env.ZEUSHIRE_TAKE_BASE_URL || 'https://zeushire.app'}/take/${token}` : null);
  if (!sessionId) return err('ZeusHire response missing sessionId', 502);

  // 2) Persist locally — candidate_interviews row + KV token map for webhook recovery
  const ciId      = cuid();
  const expiresAt = new Date(Date.now() + expiresInHours * 3600000).toISOString();
  const tokenHash = token ? await hashTok(token) : null;
  const meta      = JSON.stringify({ event: 'one_way_invited', sessionId, zeushireInterviewId: zhInterviewId });

  try {
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO candidate_interviews
           (id, candidate_id, interview_id, type, status, invited_at, expires_at,
            external_provider, external_session_id, external_token_hash)
         VALUES (?, ?, NULL, 'ONE_WAY', 'INVITED', datetime('now'), ?, 'ZEUSHIRE', ?, ?)`
      ).bind(ciId, candidateId, expiresAt, sessionId, tokenHash),
      env.DB.prepare(
        `INSERT INTO pipeline_stage_history
           (id, candidate_id, from_status, to_status, triggered_by_id, reason, metadata)
         VALUES (?, ?, 'NEW_SUBMISSION', 'NEW_SUBMISSION', ?, 'One-way interview dispatched', json(?))`
      ).bind(cuid(), candidateId, u.id, meta),
    ]);
  } catch (e) {
    // Best-effort compensation: try to invalidate the ZeusHire session we just created.
    try {
      await fetch(`${env.ZEUSHIRE_API_URL.replace(/\/$/, '')}/api/sessions/${encodeURIComponent(sessionId)}`, {
        method: 'DELETE',
        headers: { 'X-Admin-Key': env.ZEUSHIRE_API_KEY }
      });
    } catch {}
    return err(`Failed to record interview: ${e.message}`, 500);
  }

  // 3) KV: tokenHash → row pointer (webhook fallback path if external_session_id is missed)
  if (tokenHash) {
    try {
      await env.KV.put(
        `zh:ow:${tokenHash}`,
        JSON.stringify({ candidateId, candidateInterviewId: ciId, sessionId }),
        { expirationTtl: expiresInHours * 3600 }
      );
    } catch {}
  }

  return json({ ok: true, candidateInterviewId: ciId, sessionId, takeUrl }, 201);
});


// ── Webhook: ZeusHire completion (HMAC-verified, idempotent) ───────────────────
//
// Expected payload: { event:'one_way.completed'|'two_way.completed', sessionId,
//                     tokenHash?, score?, passed?, completedAt?, recordingUrl? }
// Signature header: X-ZeusHire-Signature: sha256=<hex-hmac-sha256 of raw body>
// Configure env.ZEUSHIRE_WEBHOOK_SECRET in Cloudflare Worker secrets.
R.post('/api/v1/webhooks/zeushire', async (req, env) => {
  const secret = env.ZEUSHIRE_WEBHOOK_SECRET;
  if (!secret) return err('Webhook secret not configured', 503);

  const sigHeader = req.headers.get('x-zeushire-signature') || req.headers.get('x-signature') || '';
  const m = /^sha256=([a-f0-9]+)$/i.exec(sigHeader);
  if (!m) return err('Missing or malformed signature', 401);
  const raw = await req.text();
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const macBuf = await crypto.subtle.sign('HMAC', key, enc.encode(raw));
  const expected = Array.from(new Uint8Array(macBuf)).map(b => b.toString(16).padStart(2, '0')).join('');
  const given = m[1].toLowerCase();
  // constant-time compare
  if (expected.length !== given.length) return err('Invalid signature', 401);
  let diff = 0; for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ given.charCodeAt(i);
  if (diff !== 0) return err('Invalid signature', 401);

  let body;
  try { body = JSON.parse(raw); } catch { return err('Invalid JSON', 400); }
  const { event, sessionId, tokenHash } = body || {};
  if (!event || !sessionId) return err('event and sessionId required', 400);

  const score        = body.score ?? null;
  const passedNum    = body.passed === undefined || body.passed === null ? null : (body.passed ? 1 : 0);
  const completedAt  = body.completedAt || new Date().toISOString();
  const recordingUrl = body.recordingUrl ?? null;

  // Resolve the candidate_interviews row by external_session_id; fall back to KV by tokenHash.
  let ci = await env.DB.prepare(
    `SELECT ci.id, ci.candidate_id, ci.type, ci.status, c.archived_at
       FROM candidate_interviews ci JOIN candidates c ON c.id = ci.candidate_id
      WHERE ci.external_session_id = ?`
  ).bind(sessionId).first();

  // Orphan-recovery path: row never persisted (POSEIDON crashed between ZeusHire create and DB insert)
  if (!ci && event === 'one_way.completed' && tokenHash) {
    const stored = await env.KV.get(`zh:ow:${tokenHash}`, { type: 'json' });
    if (stored?.candidateId) {
      const c = await env.DB.prepare('SELECT id, archived_at FROM candidates WHERE id=?').bind(stored.candidateId).first();
      if (c && !c.archived_at) {
        const recoveredId = stored.candidateInterviewId || cuid();
        await env.DB.prepare(
          `INSERT INTO candidate_interviews
             (id, candidate_id, interview_id, type, status, invited_at, completed_at,
              external_provider, external_session_id, external_token_hash, score, passed, recording_url)
           VALUES (?, ?, NULL, 'ONE_WAY', 'COMPLETED', datetime('now'), ?, 'ZEUSHIRE', ?, ?, ?, ?, ?)`
        ).bind(recoveredId, stored.candidateId, completedAt, sessionId, tokenHash, score, passedNum, recordingUrl).run();
        try { await env.KV.delete(`zh:ow:${tokenHash}`); } catch {}
        return json({ ok: true, recovered: true });
      }
    }
  }

  if (!ci) return json({ ok: true, dropped: 'unknown_session' });
  if (ci.archived_at) return json({ ok: true, dropped: 'candidate_archived' });
  if (ci.status === 'COMPLETED') return json({ ok: true, already: true });

  const histMeta = JSON.stringify({ event, type: ci.type, score, passed: passedNum, session_id: sessionId });

  await env.DB.batch([
    env.DB.prepare(
      `UPDATE candidate_interviews
          SET status='COMPLETED', score=?, passed=?, completed_at=?, recording_url=?, updated_at=datetime('now')
        WHERE id=?`
    ).bind(score, passedNum, completedAt, recordingUrl, ci.id),
    env.DB.prepare(
      `INSERT INTO pipeline_stage_history (id, candidate_id, from_status, to_status, triggered_by_id, reason, metadata)
       SELECT ?, ?, status, status, NULL, 'ZeusHire interview completed', json(?)
         FROM candidates WHERE id = ?`
    ).bind(cuid(), ci.candidate_id, histMeta, ci.candidate_id),
  ]);

  if (tokenHash) { try { await env.KV.delete(`zh:ow:${tokenHash}`); } catch {} }
  return json({ ok: true });
});


// ── Sea-Based two-way (live panel) ZeusHire interview ─────────────────────────
R.post('/api/v1/sea/interviews/two-way', async (req, env) => {
  const u = await auth(req, env); const re = role(u, 'SUPER_ADMIN', 'ADMIN', 'RECRUITER'); if (re) return re;
  const b = await req.json().catch(() => ({}));
  const { candidateId, scheduledAt, durationMinutes = 45, position, autoMeeting = true } = b;
  if (!candidateId || !scheduledAt) return err('candidateId and scheduledAt required');
  if (!env.ZEUSHIRE_API_URL || !env.ZEUSHIRE_API_KEY) return err('ZeusHire integration not configured', 503);
  if (new Date(scheduledAt).getTime() <= Date.now()) return err('scheduledAt must be in the future', 422);

  const c = await env.DB.prepare('SELECT id,first_name,last_name,email,pipeline,status,archived_at FROM candidates WHERE id=?').bind(candidateId).first();
  if (!c) return err('Candidate not found', 404);
  if (c.archived_at) return err('Candidate is archived', 422);
  if (!DEPLOYMENT_PIPELINES.includes(c.pipeline)) return err('Two-way interviews are only for Sea-Based / Land-Based pipelines', 422);
  if (c.status !== 'CANDIDATES') return err(`Candidate must be in CANDIDATES (is ${c.status})`, 422);
  if (!c.first_name || !c.last_name || !c.email) return err('Candidate must have first/last name and email', 422);

  const zhInterviewId = await _resolveZeushireInterviewId(env, b.zeushireInterviewId, 'zeushire_two_way_interview_id', env.ZEUSHIRE_DEFAULT_TWO_WAY_INTERVIEW, c.pipeline);
  if (!zhInterviewId) return err(`No ZeusHire two-way interview configured. Set one in the ${c.pipeline === 'SEA_BASED' ? 'Sea-Based' : 'Land-Based'} Local Settings.`, 422);

  const zhUrl = `${env.ZEUSHIRE_API_URL.replace(/\/$/, '')}/api/interview/${encodeURIComponent(zhInterviewId)}/tw-sessions`;
  let zhRes;
  try {
    zhRes = await fetch(zhUrl, {
      method: 'POST',
      headers: { 'X-Admin-Key': env.ZEUSHIRE_API_KEY, 'content-type': 'application/json' },
      body: JSON.stringify({
        candidateFirstName: c.first_name,
        candidateLastName:  c.last_name,
        candidateEmail:     c.email,
        scheduledAt,
        durationMinutes,
        position: position || null,
        autoMeeting
      })
    });
  } catch (e) { return err(`ZeusHire request failed: ${e.message || 'network error'}`, 502); }
  if (!zhRes.ok) {
    const text = await zhRes.text().catch(() => '');
    return err(`ZeusHire returned ${zhRes.status}: ${text.slice(0, 200)}`, 502);
  }
  let zhData;
  try { zhData = await zhRes.json(); } catch { return err('ZeusHire returned non-JSON', 502); }
  const sessionId   = zhData.sessionId || zhData.id;
  const meetingUrl  = zhData.meetingUrl || zhData.meetingLink || zhData.url || null;
  if (!sessionId) return err('ZeusHire response missing sessionId', 502);

  const ciId = cuid();
  const meta = JSON.stringify({ event: 'two_way_invited', sessionId, scheduledAt, durationMinutes });

  try {
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO candidate_interviews
           (id, candidate_id, interview_id, type, status, invited_at, scheduled_at, meeting_url,
            external_provider, external_session_id)
         VALUES (?, ?, NULL, 'TWO_WAY', 'SCHEDULED', datetime('now'), ?, ?, 'ZEUSHIRE', ?)`
      ).bind(ciId, candidateId, scheduledAt, meetingUrl, sessionId),
      env.DB.prepare(
        `INSERT INTO pipeline_stage_history
           (id, candidate_id, from_status, to_status, triggered_by_id, reason, metadata)
         VALUES (?, ?, 'CANDIDATES', 'CANDIDATES', ?, 'Two-way interview scheduled', json(?))`
      ).bind(cuid(), candidateId, u.id, meta),
    ]);
  } catch (e) {
    try {
      await fetch(`${env.ZEUSHIRE_API_URL.replace(/\/$/, '')}/api/tw-sessions/${encodeURIComponent(sessionId)}`, {
        method: 'DELETE', headers: { 'X-Admin-Key': env.ZEUSHIRE_API_KEY }
      });
    } catch {}
    return err(`Failed to record interview: ${e.message}`, 500);
  }

  return json({ ok: true, candidateInterviewId: ciId, sessionId, meetingUrl }, 201);
});


// ── Marlins English Test (gates offer-letter send for SEA_BASED) ──────────────
//
// Stores each attempt in marlins_tests; flips seafarer_profiles.marlins_passed_at
// on the first PASS. The offer-send endpoint (§/api/v1/offer-letters/:id/send)
// reads marlins_passed_at to gate Sea-Based contract dispatch.

function _marlinsThreshold(env) {
  const t = parseFloat(env.MARLINS_PASS_THRESHOLD || '70');
  return isNaN(t) ? 70 : t;
}

R.post('/api/v1/sea/marlins', async (req, env) => {
  const u = await auth(req, env); const re = role(u, 'SUPER_ADMIN', 'ADMIN', 'RECRUITER'); if (re) return re;
  const b = await req.json().catch(() => ({}));
  const { candidateId, durationSeconds, code, takenAt } = b;
  const scoreNum = parseFloat(b.score);
  if (!candidateId || isNaN(scoreNum)) return err('candidateId and numeric score required');
  if (scoreNum < 0 || scoreNum > 100) return err('score must be between 0 and 100', 422);

  const c = await env.DB.prepare('SELECT id,first_name,last_name,pipeline,status,archived_at FROM candidates WHERE id=?').bind(candidateId).first();
  if (!c) return err('Candidate not found', 404);
  if (c.archived_at) return err('Candidate is archived', 422);
  if (c.pipeline !== 'SEA_BASED') return err('Marlins tests are only recorded for Sea-Based candidates', 422);
  if (c.status !== 'OFFER_LETTER') return err(`Candidate must be in OFFER_LETTER stage (is ${c.status})`, 422);

  const threshold = _marlinsThreshold(env);
  const passed    = scoreNum >= threshold;
  const result    = passed ? 'PASS' : 'FAIL';
  const now       = new Date().toISOString();
  const takenAtFinal = takenAt || now;
  const fullName  = [c.first_name, c.last_name].filter(Boolean).join(' ');

  // Make sure a seafarer_profiles row exists so the UPDATE below moves a row.
  await env.DB.prepare(
    "INSERT INTO seafarer_profiles (id, candidate_id, marlins_attempts) VALUES (?, ?, 0) ON CONFLICT(candidate_id) DO NOTHING"
  ).bind(cuid(), candidateId).run();

  const meta = JSON.stringify({ event: 'marlins_attempt', result, score: scoreNum, threshold });

  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO marlins_tests
         (id, candidate_id, score, duration_seconds, code, result, taken_at, recorded_by_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(cuid(), candidateId, scoreNum, durationSeconds || null, code || null, result, takenAtFinal, u.id),
    env.DB.prepare(
      `UPDATE seafarer_profiles
          SET marlins_attempts = COALESCE(marlins_attempts, 0) + 1,
              marlins_passed_at = CASE
                WHEN ? = 1 AND marlins_passed_at IS NULL THEN ?
                ELSE marlins_passed_at
              END,
              updated_at = ?
        WHERE candidate_id = ?`
    ).bind(passed ? 1 : 0, now, now, candidateId),
    env.DB.prepare(
      `INSERT INTO pipeline_stage_history
         (id, candidate_id, from_status, to_status, triggered_by_id, reason, metadata)
       VALUES (?, ?, 'OFFER_LETTER', 'OFFER_LETTER', ?, ?, json(?))`
    ).bind(cuid(), candidateId, u.id, `Marlins ${result} (${scoreNum})`, meta),
  ]);

  // Return the canonical post-attempt state so the UI can refresh without a re-fetch.
  const sp = await env.DB.prepare('SELECT marlins_attempts, marlins_passed_at FROM seafarer_profiles WHERE candidate_id=?').bind(candidateId).first();

  // Fail-cap policy: after N consecutive failures, auto-archive the candidate.
  // Configurable via env.MARLINS_MAX_ATTEMPTS or program_settings.SEA_BASED.marlins_max_attempts.
  // Default 3. Set to 0/empty to disable the cap (unlimited retakes).
  let autoArchived = false;
  if (!passed && !sp?.marlins_passed_at) {
    const capSetting = await env.DB.prepare(
      "SELECT setting_value FROM program_settings WHERE pipeline='SEA_BASED' AND setting_key='marlins_max_attempts'"
    ).first();
    const capRaw = (capSetting?.setting_value ?? env.MARLINS_MAX_ATTEMPTS ?? '3').toString().trim();
    const cap = parseInt(capRaw, 10);
    if (!isNaN(cap) && cap > 0 && (sp?.marlins_attempts || 0) >= cap) {
      const archReason = `Marlins failed (${sp.marlins_attempts} attempts, max ${cap})`;
      await env.DB.batch([
        env.DB.prepare(
          "UPDATE candidates SET status='ARCHIVED', archive_reason=?, archive_sub_stage=?, archived_at=?, archived_by_id=?, updated_at=? WHERE id=? AND status='OFFER_LETTER'"
        ).bind(archReason, 'Offer Letter - Marlins Failed', now, u.id, now, candidateId),
        env.DB.prepare(
          `INSERT INTO pipeline_stage_history (id, candidate_id, from_status, to_status, triggered_by_id, reason, metadata)
           VALUES (?, ?, 'OFFER_LETTER','ARCHIVED', ?, ?, json(?))`
        ).bind(cuid(), candidateId, u.id, archReason, JSON.stringify({ event: 'marlins_fail_cap', attempts: sp.marlins_attempts, cap }))
      ]);
      autoArchived = true;
    }
  }

  return json({
    success: true,
    candidate: { id: candidateId, name: fullName },
    result, score: scoreNum, threshold,
    attempt: sp?.marlins_attempts || 1,
    marlinsPassedAt: sp?.marlins_passed_at || null,
    unlocked: passed,
    autoArchived
  }, 201);
});


R.get('/api/v1/candidates/:id/marlins', async (req, env, ctx, p) => {
  const u = await auth(req, env);
  const re = role(u, 'SUPER_ADMIN', 'ADMIN', 'RECRUITER', 'ONBOARDING_TEAM'); if (re) return re;
  const [profile, tests] = await Promise.all([
    env.DB.prepare('SELECT marlins_attempts, marlins_passed_at FROM seafarer_profiles WHERE candidate_id=?').bind(p.id).first(),
    env.DB.prepare('SELECT id, score, result, duration_seconds, code, taken_at FROM marlins_tests WHERE candidate_id=? ORDER BY taken_at DESC LIMIT 20').bind(p.id).all(),
  ]);
  return json({
    attempts:        profile?.marlins_attempts || 0,
    marlinsPassedAt: profile?.marlins_passed_at || null,
    threshold:       _marlinsThreshold(env),
    history:         tests.results || []
  });
});


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


// ── Client decision on an endorsement (multi-client model) ────────────────────
// Replaces the per-candidate /transitions/client-approved and /client-rejected
// pattern: every decision is now scoped to a specific endorsement row.
R.post('/api/v1/endorsements/:id/decision', async (req, env, ctx, p) => {
  const u = await auth(req, env); const re = role(u, 'SUPER_ADMIN', 'ADMIN', 'CLIENT_CONTACT'); if (re) return re;
  const { decision, notes } = await req.json().catch(() => ({}));
  if (!['APPROVED', 'REJECTED'].includes(decision)) return err("decision must be 'APPROVED' or 'REJECTED'", 422);

  const e = await env.DB.prepare(
    `SELECT e.id, e.candidate_id, e.client_id, e.status AS endorsement_status,
            cl.name AS client_name, c.status AS candidate_status, c.archived_at
       FROM client_endorsements e
       JOIN candidates c ON c.id = e.candidate_id
       LEFT JOIN clients cl ON cl.id = e.client_id
      WHERE e.id = ?`
  ).bind(p.id).first();
  if (!e) return err('Endorsement not found', 404);
  if (e.archived_at) return err('Candidate is archived', 422);
  if (e.candidate_status !== 'FINAL_INTERVIEW') return err(`Candidate must be in FINAL_INTERVIEW (is ${e.candidate_status})`, 422);
  if (['APPROVED', 'REJECTED', 'WITHDRAWN'].includes(e.endorsement_status)) {
    return err(`Endorsement already ${e.endorsement_status}`, 409);
  }

  if (u.role === 'CLIENT_CONTACT') {
    const cc = await env.DB.prepare('SELECT client_id FROM client_contacts WHERE user_id=?').bind(u.id).first();
    if (!cc || cc.client_id !== e.client_id) return err('Forbidden', 403);
  }

  const now = new Date().toISOString();

  if (decision === 'REJECTED') {
    // Mark this endorsement REJECTED; if no other active endorsements remain,
    // fall the candidate back to CANDIDATES.
    const updRes = await env.DB.prepare(
      `UPDATE client_endorsements
          SET status='REJECTED', decided_at=?, decision_notes=?, updated_at=?
        WHERE id=? AND status NOT IN ('APPROVED','REJECTED','WITHDRAWN')`
    ).bind(now, notes || null, now, p.id).run();
    if (!updRes.meta || updRes.meta.changes !== 1) return err('Endorsement state changed concurrently', 409);

    const active = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM client_endorsements WHERE candidate_id=? AND status IN ('PENDING','SCHEDULED')"
    ).bind(e.candidate_id).first();

    const stmts = [
      env.DB.prepare(
        `INSERT INTO pipeline_stage_history (id, candidate_id, from_status, to_status, triggered_by_id, reason, metadata)
         VALUES (?, ?, 'FINAL_INTERVIEW', ?, ?, ?, json(?))`
      ).bind(
        cuid(), e.candidate_id,
        active.n > 0 ? 'FINAL_INTERVIEW' : 'CANDIDATES',
        u.id,
        active.n > 0 ? `${e.client_name || 'Client'} rejected; other endorsements still active` : 'All endorsements declined; returned to Candidates',
        JSON.stringify({ endorsement_id: p.id, client_id: e.client_id, remaining_active: active.n })
      )
    ];
    if (active.n === 0) {
      stmts.unshift(env.DB.prepare(
        "UPDATE candidates SET status='CANDIDATES', updated_at=? WHERE id=? AND status='FINAL_INTERVIEW'"
      ).bind(now, e.candidate_id));
    }
    await env.DB.batch(stmts);

    return json({ success: true, decision: 'REJECTED', candidateStatus: active.n > 0 ? 'FINAL_INTERVIEW' : 'CANDIDATES', activeEndorsements: active.n });
  }

  // APPROVED — race-guard against another client already approving.
  const winner = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM client_endorsements WHERE candidate_id=? AND status='APPROVED'"
  ).bind(e.candidate_id).first();
  if (winner.n > 0) return err('Candidate already approved by another client', 409);

  const meta = JSON.stringify({ endorsement_id: p.id, client_id: e.client_id, client_name: e.client_name });
  const results = await env.DB.batch([
    env.DB.prepare(
      `UPDATE client_endorsements
          SET status='APPROVED', decided_at=?, decision_notes=?, updated_at=?
        WHERE id=? AND status NOT IN ('APPROVED','REJECTED','WITHDRAWN')`
    ).bind(now, notes || null, now, p.id),
    env.DB.prepare(
      `UPDATE client_endorsements
          SET status='WITHDRAWN', decided_at=?, decision_notes='Auto-withdrawn: candidate approved by another client', updated_at=?
        WHERE candidate_id=? AND id != ? AND status IN ('PENDING','SCHEDULED')`
    ).bind(now, now, e.candidate_id, p.id),
    env.DB.prepare(
      `UPDATE candidates
          SET status='OFFER_LETTER', endorsed_client_id=?, endorsed_client_name=?, updated_at=?
        WHERE id=? AND status='FINAL_INTERVIEW'`
    ).bind(e.client_id, e.client_name, now, e.candidate_id),
    env.DB.prepare(
      `INSERT INTO pipeline_stage_history (id, candidate_id, from_status, to_status, triggered_by_id, reason, metadata)
       VALUES (?, ?, 'FINAL_INTERVIEW', 'OFFER_LETTER', ?, ?, json(?))`
    ).bind(cuid(), e.candidate_id, u.id, `${e.client_name || 'Client'} approved`, meta)
  ]);

  // Compensation if the candidate UPDATE didn't move exactly one row.
  const candResult = results[2];
  if (!candResult || candResult.meta.changes !== 1) {
    await env.DB.prepare(
      "UPDATE client_endorsements SET status='PENDING', decided_at=NULL, updated_at=? WHERE id=?"
    ).bind(now, p.id).run();
    return err('Candidate state changed during decision', 409);
  }

  return json({ success: true, decision: 'APPROVED', candidateStatus: 'OFFER_LETTER', clientName: e.client_name });
});


// ── Grouped Final-Interview listing (UI consumes this to render by client) ────
// Returns { groups: [{ client:{id,name}, endorsements:[{...,candidate:{...}}] }] }
// Only clients with ≥1 active endorsement (PENDING/SCHEDULED) appear.
R.get('/api/v1/endorsements/final-interview-grouped', async (req, env, ctx, p, url) => {
  const u = await auth(req, env);
  const re = role(u, 'SUPER_ADMIN', 'ADMIN', 'RECRUITER', 'CLIENT_CONTACT'); if (re) return re;

  const pipeline = url.searchParams.get('pipeline');
  const params = []; const where = ["c.status='FINAL_INTERVIEW'", "e.status IN ('PENDING','SCHEDULED')"];
  if (pipeline) { where.push('c.pipeline=?'); params.push(pipeline); }

  // CLIENT_CONTACT can only see endorsements for their client.
  let scopedClientId = null;
  if (u.role === 'CLIENT_CONTACT') {
    const cc = await env.DB.prepare('SELECT client_id FROM client_contacts WHERE user_id=?').bind(u.id).first();
    if (!cc) return err('Forbidden', 403);
    scopedClientId = cc.client_id;
    where.push('e.client_id=?'); params.push(scopedClientId);
  } else if (u.role === 'RECRUITER') {
    where.push('c.assigned_recruiter_id=?'); params.push(u.id);
  }

  const { results } = await env.DB.prepare(
    `SELECT e.id AS endorsement_id, e.client_id, e.status AS endorsement_status,
            e.endorsed_at, e.scheduled_at, e.decided_at, e.decision_notes, e.interview_url,
            cl.name AS client_name,
            c.id AS candidate_id, c.first_name, c.last_name, c.email, c.pipeline,
            c.assigned_recruiter_id, c.updated_at AS candidate_updated_at
       FROM client_endorsements e
       JOIN candidates c ON c.id = e.candidate_id
       LEFT JOIN clients cl ON cl.id = e.client_id
      WHERE ${where.join(' AND ')}
      ORDER BY cl.name ASC, e.endorsed_at DESC`
  ).bind(...params).all();

  const byClient = new Map();
  for (const r of (results || [])) {
    if (!byClient.has(r.client_id)) {
      byClient.set(r.client_id, { client: { id: r.client_id, name: r.client_name }, endorsements: [] });
    }
    byClient.get(r.client_id).endorsements.push({
      id: r.endorsement_id,
      status: r.endorsement_status,
      endorsedAt: r.endorsed_at,
      scheduledAt: r.scheduled_at,
      decidedAt: r.decided_at,
      decisionNotes: r.decision_notes,
      interviewUrl: r.interview_url,
      candidate: {
        id: r.candidate_id,
        firstName: r.first_name, lastName: r.last_name, email: r.email,
        pipeline: r.pipeline, updatedAt: r.candidate_updated_at,
        assignedRecruiterId: r.assigned_recruiter_id
      }
    });
  }
  return json({ groups: [...byClient.values()] });
});

// ═════════════════════════════════════════════════════════════════════════════
// CLIENTS & ENDORSEMENTS
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

R.post('/api/v1/candidates/:id/endorse', async (req, env, ctx, p) => {
  const u = await auth(req, env); const re = role(u, 'SUPER_ADMIN', 'ADMIN', 'RECRUITER'); if (re) return re;
  const { clientIds } = await req.json();
  if (!Array.isArray(clientIds) || !clientIds.length) return err('clientIds array required');
  const c = await env.DB.prepare('SELECT id,status FROM candidates WHERE id=?').bind(p.id).first();
  if (!c) return err('Not found', 404);
  if (c.status !== 'CANDIDATES') return err('Candidate must be in CANDIDATES state', 422);
  for (const cid of clientIds) {
    const ex = await env.DB.prepare('SELECT id FROM client_endorsements WHERE candidate_id=? AND client_id=?').bind(p.id, cid).first();
    if (!ex) await env.DB.prepare('INSERT INTO client_endorsements(id,candidate_id,client_id)VALUES(?,?,?)').bind(cuid(), p.id, cid).run();
  }
  await env.DB.batch([
    env.DB.prepare("UPDATE candidates SET status='FINAL_INTERVIEW',updated_at=datetime('now')WHERE id=?").bind(p.id),
    env.DB.prepare("INSERT INTO pipeline_stage_history(id,candidate_id,from_status,to_status,triggered_by_id,reason)VALUES(?,?,'CANDIDATES','FINAL_INTERVIEW',?,?)").bind(cuid(), p.id, u.id, `Endorsed to ${clientIds.length} client(s)`)
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
  // NOTE: legacy ENDORSED → CLIENT_APPROVED branch removed.
  // Candidate-level approval flow now lives in /api/v1/candidates/:id/transitions/client-approved.
  // Portal provisioning is gated to the ONBOARDING transition (signature-confirmed webhook
  // and the /portal-invite endpoint) — never from the endorsement decision itself.
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
// WORKSPACE + MASTER DASHBOARDS  (data-isolation + global roll-up)
// ═════════════════════════════════════════════════════════════════════════════

const TYPE_TO_PIPELINE = { J1: 'J1_PROGRAM', SEA: 'SEA_BASED', LAND: 'LAND_BASED' };

// Status buckets — inclusive of BOTH the generic 6-state machine and the
// per-pipeline stage ids, so funnel counts are correct whichever a row uses.
const FUNNEL = {
  evaluations: {
    J1_PROGRAM: ['CONSULTATION_CALL', 'J1_STAGE_1', 'J1_STAGE_2', 'J1_STAGE_3', 'J1_STAGE_4', 'CANDIDATES'],
    SEA_BASED:  ['CANDIDATES'],
    LAND_BASED: ['CANDIDATES'],
  },
  finalInterview: {
    J1_PROGRAM: ['FINAL_INTERVIEW'],
    SEA_BASED:  ['FINAL_INTERVIEW'],
    LAND_BASED: ['FINAL_INTERVIEW'],
  },
  placed: {
    J1_PROGRAM: ['J1_VISA'],
    SEA_BASED:  ['C1D_VISA'],
    LAND_BASED: ['LB_VISA'],
  },
};
// Offer-letter statuses (between final interview and onboarding) — same across pipelines
const OFFER_STATUSES = ['OFFER_LETTER'];

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
  const sum = ids => (ids || []).reduce((n, s) => n + (byStatus[s] || 0), 0);
  const entered = Object.entries(byStatus).reduce((n, [s, c]) => s === 'ARCHIVED' ? n : n + c, 0);
  const onboarding = byStatus['ONBOARDING'] || 0;
  const placedVisa = sum(FUNNEL.placed[pipeline]);
  const placements = onboarding + placedVisa;   // "placement" = reached onboarding or beyond

  return json({
    pipeline,
    funnel: byStatus,
    macroFunnel: {
      newInputs:      byStatus['NEW_SUBMISSION'] || 0,
      liveEvaluation: sum(FUNNEL.evaluations[pipeline]),
      finalInterview: sum(FUNNEL.finalInterview[pipeline]),
      offerLetter:    sum(OFFER_STATUSES),
      onboarding,
      placed:         placedVisa,
    },
    placements,
    conversionRate: entered ? +(placements / entered * 100).toFixed(1) : 0,
    intakeLast30Days: intake30.cnt,
    compliance: { expired: compliance?.expired || 0, expiringSoon: compliance?.expiringSoon || 0 },
  });
});

// ── Master dashboard (KV-cached global roll-up; stale-while-revalidate) ─────────
const MASTER_KEY = 'master_dashboard';
const MASTER_TTL_MS = 15 * 60 * 1000;

async function computeMasterDashboard(env) {
  const [byPipeline, byStatusPipe, recruiterLoad, pending] = await Promise.all([
    env.DB.prepare(`SELECT pipeline, COUNT(*) cnt FROM candidates GROUP BY pipeline`).all(),
    env.DB.prepare(`SELECT pipeline, status, COUNT(*) cnt FROM candidates GROUP BY pipeline, status`).all(),
    env.DB.prepare(
      `SELECT c.assigned_recruiter_id rid, u.first_name fn, u.last_name ln, COUNT(*) load
       FROM candidates c JOIN users u ON c.assigned_recruiter_id=u.id
       WHERE c.status NOT IN ('ARCHIVED','J1_VISA','C1D_VISA','LB_VISA')
       GROUP BY c.assigned_recruiter_id ORDER BY load DESC`
    ).all(),
    env.DB.prepare(`SELECT COUNT(*) cnt FROM submissions WHERE reviewed_at IS NULL`).first(),
  ]);

  const macro = { newInputs: 0, liveEvaluation: 0, finalInterview: 0, offerLetter: 0, onboarding: 0, placed: 0 };
  for (const r of (byStatusPipe.results || [])) {
    if (r.status === 'NEW_SUBMISSION') macro.newInputs += r.cnt;
    if (r.status === 'ONBOARDING')     macro.onboarding += r.cnt;
    if (OFFER_STATUSES.includes(r.status))                     macro.offerLetter += r.cnt;
    if (FUNNEL.evaluations[r.pipeline]?.includes(r.status))    macro.liveEvaluation += r.cnt;
    if (FUNNEL.finalInterview[r.pipeline]?.includes(r.status)) macro.finalInterview += r.cnt;
    if (FUNNEL.placed[r.pipeline]?.includes(r.status))         macro.placed += r.cnt;
  }

  return {
    computedAt: Date.now(),
    byPipeline: Object.fromEntries((byPipeline.results || []).map(r => [r.pipeline, r.cnt])),
    globalFunnel: macro,
    totalPlacements: macro.onboarding + macro.placed,   // reached onboarding or beyond
    pendingSubmissions: pending.cnt,
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
