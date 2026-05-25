'use strict';

const API = 'https://poseidon-api.putuastrawijaya.workers.dev/api/v1';

let STATE = {
  accessToken: null,
  refreshToken: null,
  user: null,
  client: null,
  endorsements: [],
  activeFilter: '',
  currentEndorsement: null,
};

// ── Utilities ─────────────────────────────────────────────────────────────────

function esc(s) { return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function fmtDate(iso) { return iso ? new Date(iso).toLocaleDateString('en-US', { year:'numeric', month:'short', day:'numeric' }) : '—'; }
function relTime(iso) {
  if (!iso) return '—';
  const s = Math.round((Date.now() - new Date(iso)) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return Math.floor(s/60) + 'm ago';
  if (s < 86400) return Math.floor(s/3600) + 'h ago';
  return Math.floor(s/86400) + 'd ago';
}
function toast(msg, type='success') {
  const t = document.createElement('div');
  t.className = `toast toast-${type}`;
  t.textContent = msg;
  document.getElementById('toast-container').appendChild(t);
  setTimeout(() => t.classList.add('show'), 10);
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, 3500);
}
function show(id)  { document.getElementById(id)?.classList.remove('hidden'); }
function hide(id)  { document.getElementById(id)?.classList.add('hidden'); }

const PIPELINE_LABEL = { SEA_BASED:'Sea-Based', LAND_BASED:'Land-Based', J1_PROGRAM:'J1 Visa' };
const PIPELINE_BADGE = { SEA_BASED:'badge-sea', LAND_BASED:'badge-land', J1_PROGRAM:'badge-j1' };

function endorsementStatusBadge(s) {
  const map = { PENDING:'badge-hold', SCHEDULED:'badge-active', APPROVED:'badge-approved', REJECTED:'badge-rejected', WITHDRAWN:'badge-new' };
  return `<span class="badge ${map[s]||'badge-new'}">${esc(s)}</span>`;
}

// ── API ───────────────────────────────────────────────────────────────────────

async function api(method, path, body, retry = true) {
  const headers = { 'Content-Type': 'application/json' };
  if (STATE.accessToken) headers['Authorization'] = `Bearer ${STATE.accessToken}`;
  const opts = { method, headers };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(API + path, opts);
  if (res.status === 401 && retry && STATE.refreshToken) {
    const r = await fetch(API + '/auth/refresh', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ refreshToken: STATE.refreshToken })
    });
    if (r.ok) {
      const d = await r.json();
      STATE.accessToken = d.accessToken; STATE.refreshToken = d.refreshToken;
      localStorage.setItem('poseidon_client_rt', d.refreshToken);
      return api(method, path, body, false);
    }
    doLogout(); return null;
  }
  return res;
}

// ── Auth ──────────────────────────────────────────────────────────────────────

async function doLogin() {
  const email = document.getElementById('login-email').value.trim();
  const pw    = document.getElementById('login-pw').value;
  const errEl = document.getElementById('login-error');
  hide('login-error');
  const res = await fetch(API + '/auth/login', {
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ email, password: pw })
  });
  const d = await res.json();
  if (!res.ok) { errEl.textContent = d.error || 'Login failed.'; show('login-error'); return; }
  if (d.user?.role !== 'CLIENT_CONTACT') { errEl.textContent = 'This portal is for client contacts only.'; show('login-error'); return; }
  STATE.accessToken = d.accessToken; STATE.refreshToken = d.refreshToken;
  localStorage.setItem('poseidon_client_rt', d.refreshToken);
  await bootPortal();
}

function doLogout() {
  if (STATE.accessToken) fetch(API + '/auth/logout', { method:'POST', headers:{ Authorization:`Bearer ${STATE.accessToken}` } }).catch(()=>{});
  localStorage.removeItem('poseidon_client_rt');
  STATE = { accessToken:null, refreshToken:null, user:null, client:null, endorsements:[], activeFilter:'', currentEndorsement:null };
  hide('view-app'); show('view-login');
}

// ── Boot ──────────────────────────────────────────────────────────────────────

async function bootPortal() {
  const res = await api('GET', '/portal/client');
  if (!res || !res.ok) { doLogout(); return; }
  const d = await res.json();
  STATE.user   = d.user;
  STATE.client = d.client;
  STATE.endorsements = d.endorsements || [];

  document.getElementById('client-name-chip').textContent = d.client?.name || '';
  document.getElementById('topbar-user').textContent = [d.user?.firstName, d.user?.lastName].filter(Boolean).join(' ') || d.user?.email || '';

  renderStats();
  renderTable();
  hide('view-login');
  show('view-app');
}

// ── Stats ─────────────────────────────────────────────────────────────────────

function renderStats() {
  const all = STATE.endorsements;
  const counts = { PENDING:0, SCHEDULED:0, APPROVED:0, REJECTED:0 };
  all.forEach(e => { if (counts[e.status] !== undefined) counts[e.status]++; });
  document.getElementById('client-stats').innerHTML = [
    { label:'Total Endorsed',  value: all.length,          cls:'blue'   },
    { label:'Pending Review',  value: counts.PENDING,      cls:'amber'  },
    { label:'Approved',        value: counts.APPROVED,     cls:'green'  },
    { label:'Rejected',        value: counts.REJECTED,     cls:'red'    },
  ].map(s => `
    <div class="stat-card ${s.cls}">
      <div class="stat-value">${s.value}</div>
      <div class="stat-label">${s.label}</div>
    </div>`).join('');
}

// ── Table ─────────────────────────────────────────────────────────────────────

function setFilter(status, btn) {
  STATE.activeFilter = status;
  document.querySelectorAll('.filter-pill').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  renderTable();
}

function renderTable() {
  const rows = STATE.activeFilter
    ? STATE.endorsements.filter(e => e.status === STATE.activeFilter)
    : STATE.endorsements;
  const tbody = document.getElementById('endorsements-tbody');
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="table-empty">No candidates in this category</td></tr>';
    return;
  }
  tbody.innerHTML = rows.map(e => `
    <tr class="candidate-row" onclick="openDetail('${esc(e.id)}')">
      <td>
        <div style="font-weight:500;color:var(--text);">${esc(e.first_name)} ${esc(e.last_name)}</div>
        <div style="font-size:.75rem;color:var(--text-muted);">${esc(e.email)}</div>
      </td>
      <td><span class="badge ${PIPELINE_BADGE[e.pipeline]||'badge-new'}">${esc(PIPELINE_LABEL[e.pipeline]||e.pipeline)}</span></td>
      <td style="color:var(--text-muted);">${esc(e.nationality||'—')}</td>
      <td style="color:var(--text-muted);font-size:.8rem;">${relTime(e.endorsed_at)}</td>
      <td>${endorsementStatusBadge(e.status)}</td>
      <td><button class="btn btn-ghost btn-sm">View →</button></td>
    </tr>`).join('');
}

// ── Detail Panel ──────────────────────────────────────────────────────────────

function openDetail(endorsementId) {
  const e = STATE.endorsements.find(x => x.id === endorsementId);
  if (!e) return;
  STATE.currentEndorsement = e;

  const name = [e.first_name, e.last_name].filter(Boolean).join(' ');
  document.getElementById('dp-name').textContent  = name;
  document.getElementById('dp-email').textContent = e.email || '';
  document.getElementById('dp-avatar').textContent = (e.first_name?.[0]||'?') + (e.last_name?.[0]||'');

  document.getElementById('dp-status-row').innerHTML = `
    <span class="badge ${PIPELINE_BADGE[e.pipeline]||'badge-new'}">${esc(PIPELINE_LABEL[e.pipeline]||e.pipeline)}</span>
    ${endorsementStatusBadge(e.status)}
    <span style="font-size:.78rem;color:var(--text-muted);margin-left:4px;">Endorsed ${relTime(e.endorsed_at)}</span>`;

  document.getElementById('dp-info').innerHTML = `
    <div class="info-item"><label>Nationality</label><span>${esc(e.nationality||'—')}</span></div>
    <div class="info-item"><label>Date of Birth</label><span>${fmtDate(e.date_of_birth)}</span></div>
    <div class="info-item"><label>Status</label><span>${esc(e.status)}</span></div>
    <div class="info-item"><label>Decided</label><span>${e.decided_at ? fmtDate(e.decided_at) : '—'}</span></div>
    ${e.decision_notes ? `<div class="info-item" style="grid-column:span 2;"><label>Decision Notes</label><span>${esc(e.decision_notes)}</span></div>` : ''}`;

  // Documents: link to admin for now
  document.getElementById('dp-documents').innerHTML = `
    <p style="font-size:.78rem;color:var(--text-muted);margin:0;">
      Document review is handled by the CTI Group recruitment team.
      Contact your recruiter to request specific documents.
    </p>`;

  // Decision box
  hide('dp-decision-box');
  hide('dp-decided');
  if (e.status === 'PENDING' || e.status === 'SCHEDULED') {
    document.getElementById('decision-notes').value = '';
    show('dp-decision-box');
  } else if (e.status === 'APPROVED' || e.status === 'REJECTED') {
    document.getElementById('dp-decided').innerHTML = `
      <div style="background:${e.status==='APPROVED'?'rgba(34,197,94,.08)':'rgba(239,68,68,.08)'};border:1px solid ${e.status==='APPROVED'?'rgba(34,197,94,.2)':'rgba(239,68,68,.2)'};border-radius:8px;padding:14px 16px;">
        <p style="margin:0 0 4px;font-size:.8rem;font-weight:600;color:${e.status==='APPROVED'?'var(--success)':'var(--danger)'};">${e.status==='APPROVED'?'✓ Approved':'✗ Rejected'}</p>
        ${e.decision_notes ? `<p style="margin:0;font-size:.82rem;color:var(--text-muted);">${esc(e.decision_notes)}</p>` : ''}
        <p style="margin:${e.decision_notes?'6px':'0'} 0 0;font-size:.74rem;color:var(--text-muted);">${fmtDate(e.decided_at)}</p>
      </div>`;
    show('dp-decided');
  }

  document.getElementById('detail-panel').classList.add('open');
}

function closeDetail() {
  document.getElementById('detail-panel').classList.remove('open');
  STATE.currentEndorsement = null;
}

async function makeDecision(status) {
  const e = STATE.currentEndorsement;
  if (!e) return;
  const notes = document.getElementById('decision-notes').value.trim();
  const res = await api('PATCH', `/endorsements/${e.id}`, { status, decisionNotes: notes });
  if (!res || !res.ok) { const d = await res?.json(); toast(d?.error || 'Decision failed', 'error'); return; }
  toast(status === 'APPROVED' ? 'Candidate approved ✓' : 'Candidate rejected');
  // Reload
  const reload = await api('GET', '/portal/client');
  if (reload?.ok) {
    const d = await reload.json();
    STATE.endorsements = d.endorsements || [];
    renderStats();
    renderTable();
    closeDetail();
  }
}

// ── Init ──────────────────────────────────────────────────────────────────────

async function init() {
  const savedRt = localStorage.getItem('poseidon_client_rt');
  if (savedRt) {
    STATE.refreshToken = savedRt;
    const r = await fetch(API + '/auth/refresh', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ refreshToken: savedRt })
    });
    if (r.ok) {
      const d = await r.json();
      if (d.user?.role === 'CLIENT_CONTACT') {
        STATE.accessToken = d.accessToken; STATE.refreshToken = d.refreshToken;
        localStorage.setItem('poseidon_client_rt', d.refreshToken);
        await bootPortal();
        return;
      }
    }
    localStorage.removeItem('poseidon_client_rt');
  }
  show('view-login');
}

document.addEventListener('keydown', e => { if (e.key === 'Escape') closeDetail(); });

init();
