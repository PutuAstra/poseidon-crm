'use strict';

const API = 'https://poseidon-api.putuastrawijaya.workers.dev/api/v1';

let STATE = {
  accessToken: null,
  refreshToken: null,
  user: null,
  candidate: null,     // DB row: first_name, last_name, status, pipeline, etc.
  activateToken: null,
  activateEmail: null,
};

// ── Utilities ─────────────────────────────────────────────────────────────────

function esc(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function fmtDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', { year:'numeric', month:'short', day:'numeric' });
}
function relTime(iso) {
  const s = Math.round((Date.now() - new Date(iso)) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return Math.floor(s/60) + 'm ago';
  if (s < 86400) return Math.floor(s/3600) + 'h ago';
  return Math.floor(s/86400) + 'd ago';
}
function fullName(c) { return [c?.first_name, c?.last_name].filter(Boolean).join(' ') || '—'; }
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
      localStorage.setItem('poseidon_portal_rt', d.refreshToken);
      return api(method, path, body, false);
    }
    doLogout(); return null;
  }
  return res;
}

// ── Auth ──────────────────────────────────────────────────────────────────────

async function doActivate() {
  const pw  = document.getElementById('activate-pw').value.trim();
  const pw2 = document.getElementById('activate-pw2').value.trim();
  const errEl = document.getElementById('activate-error');
  hide('activate-error');
  if (pw.length < 8)        { errEl.textContent = 'Password must be at least 8 characters.'; show('activate-error'); return; }
  if (pw !== pw2)           { errEl.textContent = 'Passwords do not match.'; show('activate-error'); return; }
  if (!STATE.activateToken) { errEl.textContent = 'Invalid activation link.'; show('activate-error'); return; }
  const res = await fetch(API + '/auth/candidate/set-password', {
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ token: STATE.activateToken, password: pw })
  });
  const d = await res.json();
  if (!res.ok) { errEl.textContent = d.error || 'Activation failed.'; show('activate-error'); return; }
  STATE.accessToken = d.accessToken; STATE.refreshToken = d.refreshToken;
  localStorage.setItem('poseidon_portal_rt', d.refreshToken);
  history.replaceState(null, '', location.pathname);
  await bootPortal();
}

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
  if (d.user?.role !== 'CANDIDATE') { errEl.textContent = 'This portal is for candidates only.'; show('login-error'); return; }
  STATE.accessToken = d.accessToken; STATE.refreshToken = d.refreshToken;
  localStorage.setItem('poseidon_portal_rt', d.refreshToken);
  await bootPortal();
}

async function doLogout() {
  if (STATE.accessToken) fetch(API + '/auth/logout', { method:'POST', headers:{ Authorization:`Bearer ${STATE.accessToken}` } }).catch(()=>{});
  localStorage.removeItem('poseidon_portal_rt');
  STATE = { accessToken:null, refreshToken:null, user:null, candidate:null, activateToken:null, activateEmail:null };
  hide('view-app'); show('view-login');
}

// ── Boot ──────────────────────────────────────────────────────────────────────

async function bootPortal() {
  hide('view-login'); hide('view-activate');
  const res = await api('GET', '/portal/me');
  if (!res || !res.ok) { doLogout(); return; }
  const d = await res.json();
  // /api/v1/portal/me returns the candidate row flat (spread), not nested
  // under { user, candidate } — there is no separate "user" object.
  STATE.candidate = d;
  document.getElementById('topbar-name').textContent = fullName(d) || d.email || '';
  renderStatusBanner();
  renderProfileView();
  loadDocuments();
  loadTimeline();
  hide('view-login'); hide('view-activate');
  show('view-app');
}

// ── Status Banner ─────────────────────────────────────────────────────────────

// Canonical statuses. The candidate portal is only accessible once a candidate
// reaches ONBOARDING — earlier statuses won't be displayed here, but they're
// kept in the label map so historical timeline rows render correctly.
const STAGE_LABELS = {
  NEW_SUBMISSION:'Application Received',
  CANDIDATES:'Under Review',
  FINAL_INTERVIEW:'Final Interview',
  OFFER_LETTER:'Offer Letter',
  ONBOARDING:'Onboarding',
  READY_TO_DEPLOY:'Ready to Go',
  DEPLOYED:'Deployed',
  ARCHIVED:'Archived',
  // Legacy labels — still rendered if older history rows exist:
  SCREENING:'Screening', OWI_INVITED:'Pre-screen Invited', OWI_SUBMITTED:'Pre-screen Submitted',
  TWI_SCHEDULED:'Interview Scheduled', TWI_COMPLETED:'Interview Completed',
  BOOKING_INVITED:'Booking Invited', BOOKING_CONFIRMED:'Booking Confirmed',
  PRE_QUAL_APPROVED:'Pre-qualified', ENDORSED:'Endorsed to Client',
  CLIENT_APPROVED:'Client Approved', CLIENT_REJECTED:'Client Rejected',
  DOCUMENT_REVIEW:'Document Review', ON_HOLD:'On Hold',
};

const STAGE_FLOW = [
  'NEW_SUBMISSION','CANDIDATES','FINAL_INTERVIEW','OFFER_LETTER',
  'ONBOARDING','READY_TO_DEPLOY','DEPLOYED'
];

const NEXT_STEP_HINTS = {
  NEW_SUBMISSION:'Your application is being reviewed. We will contact you soon.',
  CANDIDATES:'Our recruiters are reviewing your profile.',
  FINAL_INTERVIEW:'You are being considered by one or more partner clients. We will reach out once they decide.',
  OFFER_LETTER:'Your offer is being prepared. Please complete any required tests and sign the contract when sent.',
  ONBOARDING:'Please upload all required documents in the Documents tab so we can finalize your placement.',
  READY_TO_DEPLOY:'Your documents are verified. We are finalizing your vessel assignment and sign-on date.',
  DEPLOYED:'Congratulations! You are currently deployed. Have a safe contract.',
  ARCHIVED:'Your application has been archived. Reach out if you have questions.',
};

function renderStatusBanner() {
  const c = STATE.candidate;
  if (!c) return;
  document.getElementById('banner-status').textContent = STAGE_LABELS[c.status] || c.status;
  const pel = document.getElementById('banner-pipeline');
  const pipeMap = { SEA_BASED:'Sea-Based', LAND_BASED:'Land-Based', J1_PROGRAM:'J1 Visa' };
  const badgeClass = { SEA_BASED:'badge-sea', LAND_BASED:'badge-land', J1_PROGRAM:'badge-j1' };
  pel.className = `badge ${badgeClass[c.pipeline] || ''}`;
  pel.textContent = pipeMap[c.pipeline] || c.pipeline;
  const hint = NEXT_STEP_HINTS[c.status] || '';
  document.getElementById('banner-next-step').innerHTML = hint
    ? `<strong style="color:var(--text);display:block;margin-bottom:4px;">Next Step</strong>${esc(hint)}`
    : '';
  const curIdx = STAGE_FLOW.indexOf(c.status);
  document.getElementById('status-stepper').innerHTML = STAGE_FLOW.map((s, i) => `
    <div class="step ${i < curIdx ? 'done' : i === curIdx ? 'active' : ''}">
      <div class="step-dot"></div>
      <div class="step-label">${esc(STAGE_LABELS[s] || s)}</div>
    </div>
  `).join('');
  show('status-banner');
}

// ── Profile ───────────────────────────────────────────────────────────────────

function renderProfileView() {
  const c = STATE.candidate || {};
  document.getElementById('profile-view').innerHTML = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px 24px;">
      ${[
        ['Full Name',         fullName(c)],
        ['Email',             c.email],
        ['Phone',             c.phone],
        ['Nationality',       c.nationality],
        ['Date of Birth',     fmtDate(c.date_of_birth)],
        ['Home Address',      c.address],
        ['Position Applied',  c.position_applied],
        ['Years Experience',  c.years_experience != null ? c.years_experience + ' yr(s)' : null],
      ].map(([label, val]) => `
        <div>
          <p style="margin:0 0 2px;font-size:.75rem;color:var(--text-muted);text-transform:uppercase;">${esc(label)}</p>
          <p style="margin:0;color:var(--text);font-size:.9rem;">${val ? esc(val) : '<span style="color:var(--text-muted)">—</span>'}</p>
        </div>
      `).join('')}
    </div>
  `;
  document.getElementById('profile-edit').innerHTML = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px 24px;">
      <div class="form-group" style="margin:0;"><label class="form-label">First Name</label><input type="text" id="pe-first_name" class="form-input" value="${esc(c.first_name)}"></div>
      <div class="form-group" style="margin:0;"><label class="form-label">Last Name</label><input type="text" id="pe-last_name" class="form-input" value="${esc(c.last_name)}"></div>
      <div class="form-group" style="margin:0;"><label class="form-label">Phone</label><input type="tel" id="pe-phone" class="form-input" value="${esc(c.phone)}"></div>
      <div class="form-group" style="margin:0;"><label class="form-label">Nationality</label><input type="text" id="pe-nationality" class="form-input" value="${esc(c.nationality)}"></div>
      <div class="form-group" style="margin:0;"><label class="form-label">Date of Birth</label><input type="date" id="pe-date_of_birth" class="form-input" value="${esc(c.date_of_birth ? c.date_of_birth.slice(0,10) : '')}"></div>
      <div class="form-group" style="margin:0;"><label class="form-label">Years Experience</label><input type="number" id="pe-years_experience" class="form-input" value="${esc(c.years_experience)}" min="0"></div>
      <div class="form-group" style="margin:0;grid-column:span 2;"><label class="form-label">Home Address</label><input type="text" id="pe-address" class="form-input" value="${esc(c.address)}"></div>
    </div>
  `;
}

function startEditProfile() {
  hide('profile-view'); show('profile-edit');
  hide('btn-edit-profile'); show('btn-save-profile'); show('btn-cancel-profile');
}
function cancelEditProfile() {
  show('profile-view'); hide('profile-edit');
  show('btn-edit-profile'); hide('btn-save-profile'); hide('btn-cancel-profile');
}

async function saveProfile() {
  const fields = ['first_name','last_name','phone','nationality','date_of_birth','years_experience','address'];
  const body = {};
  fields.forEach(f => {
    const el = document.getElementById('pe-' + f);
    if (el) body[f] = el.value.trim() || undefined;
  });
  if (body.years_experience) body.years_experience = parseInt(body.years_experience) || undefined;
  const res = await api('PATCH', '/portal/me', body);
  if (!res || !res.ok) { const d = await res?.json(); toast(d?.error || 'Save failed', 'error'); return; }
  const d = await res.json();
  STATE.candidate = d.candidate;
  document.getElementById('topbar-name').textContent = fullName(STATE.candidate);
  renderProfileView();
  cancelEditProfile();
  toast('Profile updated.');
}

// ── Documents ─────────────────────────────────────────────────────────────────

const DOC_TYPE_LABELS = {
  PASSPORT:'Passport', SEAMAN_BOOK:'Seaman Book', MEDICAL:'Medical Certificate',
  TRAINING_CERT:'Training Certificate', VISA:'Visa', CONTRACT:'Contract',
  DS2019:'DS-2019 (J1)', OTHER:'Other'
};

async function loadDocuments() {
  const id = STATE.candidate?.id;
  if (!id) return;
  const res = await api('GET', `/candidates/${id}/documents`);
  if (!res || !res.ok) return;
  const { documents } = await res.json();
  renderDocuments(documents || []);
}

function renderDocuments(docs) {
  const list  = document.getElementById('docs-list');
  const empty = document.getElementById('docs-empty');
  if (!docs.length) { list.innerHTML = ''; show('docs-empty'); return; }
  hide('docs-empty');
  list.innerHTML = `
    <table class="data-table" style="width:100%;">
      <thead><tr><th>Name</th><th>Type</th><th>Expiry</th><th>Status</th><th>Uploaded</th><th></th></tr></thead>
      <tbody>
        ${docs.map(d => `
          <tr>
            <td style="font-weight:500;color:var(--text);">${esc(d.label || d.file_name)}</td>
            <td><span class="badge" style="background:var(--navy-mid);color:var(--text-muted);">${esc(DOC_TYPE_LABELS[d.type]||d.type)}</span></td>
            <td>${d.expiration_date ? fmtDate(d.expiration_date) : '—'}</td>
            <td>${docStatusBadge(d.is_verified)}</td>
            <td style="color:var(--text-muted);font-size:.8rem;">${relTime(d.created_at)}</td>
            <td><button class="btn btn-ghost btn-sm" onclick="downloadDoc('${esc(d.id)}')">Download</button></td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}

function docStatusBadge(isVerified) {
  return isVerified
    ? '<span class="badge badge-active">Verified</span>'
    : '<span class="badge badge-hold">Pending Review</span>';
}

async function downloadDoc(docId) {
  const id = STATE.candidate?.id;
  const res = await api('GET', `/candidates/${id}/documents/${docId}/download-url`);
  if (!res || !res.ok) { toast('Could not get download link', 'error'); return; }
  const d = await res.json();
  window.open(d.downloadUrl || d.url, '_blank');
}

// ── Upload Modal ──────────────────────────────────────────────────────────────

let selectedFile = null;

function openUploadModal() {
  selectedFile = null;
  document.getElementById('up-name').value    = '';
  document.getElementById('up-expiry').value  = '';
  document.getElementById('up-file').value    = '';
  document.getElementById('upload-zone-text').textContent = 'Click to choose file or drag & drop';
  hide('up-progress-wrap'); hide('up-error');
  document.getElementById('up-bar').style.width = '0%';
  document.getElementById('up-pct').textContent  = '0%';
  show('modal-overlay'); show('upload-modal');
}
function closeUploadModal() { hide('modal-overlay'); hide('upload-modal'); selectedFile = null; }
function onFileSelected(input) {
  selectedFile = input.files[0] || null;
  if (selectedFile) document.getElementById('upload-zone-text').textContent = selectedFile.name;
}

document.addEventListener('DOMContentLoaded', () => {
  const zone = document.getElementById('upload-zone');
  if (!zone) return;
  zone.addEventListener('dragover',  e => { e.preventDefault(); zone.classList.add('drag-over'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
  zone.addEventListener('drop', e => {
    e.preventDefault(); zone.classList.remove('drag-over');
    const f = e.dataTransfer?.files[0];
    if (f) { selectedFile = f; document.getElementById('upload-zone-text').textContent = f.name; }
  });
});

async function doUpload() {
  const type   = document.getElementById('up-type').value;
  const label  = document.getElementById('up-name').value.trim();
  const expiry = document.getElementById('up-expiry').value || null;
  const errEl  = document.getElementById('up-error');
  hide('up-error');
  if (!label)        { errEl.textContent = 'Please enter a document name.'; show('up-error'); return; }
  if (!selectedFile) { errEl.textContent = 'Please select a file.'; show('up-error'); return; }
  if (selectedFile.size > 25 * 1024 * 1024) { errEl.textContent = 'File exceeds 25 MB.'; show('up-error'); return; }
  document.getElementById('btn-upload').disabled = true;
  show('up-progress-wrap');

  // Step 1: create upload session
  const sessRes = await api('POST', `/candidates/${STATE.candidate.id}/documents/upload-session`, {
    type,
    label,
    expiration_date: expiry || undefined,
    fileName: selectedFile.name,
    fileSizeBytes: selectedFile.size,
    mimeType: selectedFile.type || 'application/octet-stream'
  });
  if (!sessRes || !sessRes.ok) {
    const d = await sessRes?.json();
    errEl.textContent = d?.error || 'Failed to start upload session.';
    show('up-error'); document.getElementById('btn-upload').disabled = false; return;
  }
  const { sessionId, uploadUrl } = await sessRes.json();

  // Step 2: PUT directly to OneDrive (chunked)
  const CHUNK = 4 * 1024 * 1024;
  let offset = 0; const total = selectedFile.size;
  let oneDriveFileId = null;

  while (offset < total) {
    const end   = Math.min(offset + CHUNK, total);
    const chunk = selectedFile.slice(offset, end);
    const putRes = await fetch(uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Length': String(end - offset), 'Content-Range': `bytes ${offset}-${end-1}/${total}` },
      body: chunk
    });
    if (putRes.status === 201 || putRes.status === 200) {
      // Last chunk — response contains the file object
      const fileData = await putRes.json();
      oneDriveFileId = fileData.id;
    } else if (putRes.status !== 202) {
      errEl.textContent = 'Upload failed at offset ' + offset + ' (status ' + putRes.status + ')';
      show('up-error'); document.getElementById('btn-upload').disabled = false; return;
    }
    offset = end;
    const pct = Math.round((offset / total) * 100);
    document.getElementById('up-bar').style.width = pct + '%';
    document.getElementById('up-pct').textContent  = pct + '%';
  }

  // Step 3: confirm upload
  const confRes = await api('POST', `/candidates/${STATE.candidate.id}/documents/${sessionId}/confirm-upload`,
    oneDriveFileId ? { oneDriveFileId } : {}
  );
  if (!confRes || !confRes.ok) {
    errEl.textContent = 'Upload confirmation failed. Please contact support.';
    show('up-error'); document.getElementById('btn-upload').disabled = false; return;
  }
  document.getElementById('btn-upload').disabled = false;
  closeUploadModal();
  toast('Document uploaded successfully.');
  loadDocuments();
}

// ── Timeline ──────────────────────────────────────────────────────────────────

async function loadTimeline() {
  const id = STATE.candidate?.id;
  if (!id) return;
  const res = await api('GET', `/candidates/${id}/history`);
  if (!res || !res.ok) return;
  const { history } = await res.json();
  const list  = document.getElementById('timeline-list');
  const empty = document.getElementById('timeline-empty');
  if (!history?.length) { list.innerHTML = ''; show('timeline-empty'); return; }
  hide('timeline-empty');
  list.innerHTML = `<div class="timeline">
    ${history.map(h => `
      <div class="timeline-item">
        <div class="timeline-dot"></div>
        <div class="timeline-content">
          <div style="font-weight:500;color:var(--text);font-size:.9rem;">${esc(STAGE_LABELS[h.to_status] || h.to_status || '')}</div>
          ${h.reason ? `<div style="color:var(--text-muted);font-size:.82rem;margin-top:2px;">${esc(h.reason)}</div>` : ''}
          <div style="color:var(--text-muted);font-size:.75rem;margin-top:4px;">${fmtDate(h.created_at)} &middot; ${relTime(h.created_at)}</div>
        </div>
      </div>
    `).join('')}
  </div>`;
}

// ── Tab switching ─────────────────────────────────────────────────────────────

function switchTab(btn, name) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(p => p.classList.add('hidden'));
  btn.classList.add('active');
  show('tab-' + name);
}

// ── Init ──────────────────────────────────────────────────────────────────────

// ── Forgot / Reset Password ───────────────────────────────────────────────────

function showForgotView() {
  hide('view-login'); hide('view-forgot'); hide('view-reset');
  document.getElementById('forgot-msg')?.classList.add('hidden');
  document.getElementById('forgot-email').value = '';
  show('view-forgot');
}

function showLoginView() {
  hide('view-forgot'); hide('view-reset');
  show('view-login');
}

async function sendForgotPassword() {
  const email = document.getElementById('forgot-email').value.trim();
  const msgEl = document.getElementById('forgot-msg');
  const btn   = document.getElementById('forgot-btn');
  msgEl.classList.add('hidden');
  if (!email) { msgEl.textContent = 'Email is required.'; msgEl.className = 'alert alert-danger'; msgEl.classList.remove('hidden'); return; }
  btn.disabled = true; btn.textContent = 'Sending…';
  try {
    await fetch(API + '/auth/forgot-password', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email })
    });
    msgEl.textContent = 'If that email is registered, a reset link has been sent. Check your inbox.';
    msgEl.className = 'alert alert-success';
    msgEl.classList.remove('hidden');
    btn.style.display = 'none';
  } catch (e) {
    msgEl.textContent = 'Network error. Please try again.';
    msgEl.className = 'alert alert-danger';
    msgEl.classList.remove('hidden');
    btn.disabled = false; btn.textContent = 'Send Reset Link';
  }
}

async function doResetPassword() {
  const pw   = document.getElementById('reset-pw').value;
  const pw2  = document.getElementById('reset-pw2').value;
  const msgEl = document.getElementById('reset-msg');
  const btn   = document.getElementById('reset-btn');
  msgEl.classList.add('hidden');
  if (!pw)           { msgEl.textContent = 'Password is required.';                    msgEl.className = 'alert alert-danger'; msgEl.classList.remove('hidden'); return; }
  if (pw.length < 8) { msgEl.textContent = 'Password must be at least 8 characters.'; msgEl.className = 'alert alert-danger'; msgEl.classList.remove('hidden'); return; }
  if (pw !== pw2)    { msgEl.textContent = 'Passwords do not match.';                  msgEl.className = 'alert alert-danger'; msgEl.classList.remove('hidden'); return; }
  btn.disabled = true; btn.textContent = 'Updating…';
  try {
    const res = await fetch(API + '/auth/reset-password', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: STATE._resetToken, password: pw })
    });
    const d = await res.json();
    if (!res.ok) {
      msgEl.textContent = d.error || 'Reset failed. The link may have expired.';
      msgEl.className = 'alert alert-danger';
      msgEl.classList.remove('hidden');
      btn.disabled = false; btn.textContent = 'Set New Password';
      return;
    }
    hide('view-reset');
    show('view-login');
    const errEl = document.getElementById('login-error');
    errEl.textContent = 'Password updated successfully. Sign in with your new password.';
    errEl.className = 'alert alert-success';
    show('login-error');
  } catch (e) {
    msgEl.textContent = 'Network error. Please try again.';
    msgEl.className = 'alert alert-danger';
    msgEl.classList.remove('hidden');
    btn.disabled = false; btn.textContent = 'Set New Password';
  }
}

// ── Init ──────────────────────────────────────────────────────────────────────

async function init() {
  const params = new URLSearchParams(location.search);
  const activateToken = params.get('activate');

  const resetToken = params.get('reset');
  if (resetToken) {
    STATE._resetToken = resetToken;
    show('view-reset');
    return;
  }

  if (activateToken) {
    STATE.activateToken = activateToken;
    const res = await fetch(API + '/auth/candidate/activate', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ token: activateToken })
    });
    if (res.ok) {
      const d = await res.json();
      STATE.activateEmail = d.email;
      document.getElementById('activate-email-text').textContent = d.email;
      show('activate-email-display');
      show('view-activate');
      return;
    }
    show('view-login');
    const errEl = document.getElementById('login-error');
    errEl.textContent = 'Activation link is invalid or expired. Sign in if you already have an account.';
    show('login-error');
    return;
  }

  const savedRt = localStorage.getItem('poseidon_portal_rt');
  if (savedRt) {
    STATE.refreshToken = savedRt;
    const r = await fetch(API + '/auth/refresh', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ refreshToken: savedRt })
    });
    if (r.ok) {
      const d = await r.json();
      if (d.user?.role === 'CANDIDATE') {
        STATE.accessToken  = d.accessToken;
        STATE.refreshToken = d.refreshToken;
        localStorage.setItem('poseidon_portal_rt', d.refreshToken);
        await bootPortal();
        return;
      }
    }
    localStorage.removeItem('poseidon_portal_rt');
  }
  show('view-login');
}

init();
