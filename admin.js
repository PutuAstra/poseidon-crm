// POSEIDON CRM — Admin Panel JS
// v1.0.0 — 2025-05-25

const API = 'https://poseidon-api.putuastrawijaya.workers.dev/api/v1';

let STATE = {
  accessToken: null,
  refreshToken: null,
  user: null,
  currentView: null,
  candidatePage: 1,
  submissionPage: 1,
  activePipeline: '',
  currentCandidate: null,
  clients: [],
  recruiters: []
};

// ── API helper ────────────────────────────────────────────────────────────────

async function api(method, path, body = null, retry = true) {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json', ...(STATE.accessToken ? { Authorization: `Bearer ${STATE.accessToken}` } : {}) }
  };
  if (body) opts.body = JSON.stringify(body);
  let res = await fetch(API + path, opts);
  if (res.status === 401 && retry && STATE.refreshToken) {
    const refreshed = await refreshTokens();
    if (refreshed) {
      opts.headers.Authorization = `Bearer ${STATE.accessToken}`;
      res = await fetch(API + path, opts);
    } else { doLogout(); return null; }
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

async function refreshTokens() {
  try {
    const res = await fetch(API + '/auth/refresh', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refreshToken: STATE.refreshToken }) });
    if (!res.ok) return false;
    const d = await res.json();
    STATE.accessToken = d.accessToken;
    STATE.refreshToken = d.refreshToken;
    localStorage.setItem('poseidon_rt', d.refreshToken);
    return true;
  } catch { return false; }
}

// ── Toast ─────────────────────────────────────────────────────────────────────

function toast(msg, type = 'info') {
  const c = document.getElementById('toast-container');
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.innerHTML = `<span>${msg}</span>`;
  c.appendChild(t);
  setTimeout(() => t.style.opacity = '0', 2800);
  setTimeout(() => t.remove(), 3200);
}

// ── Auth ──────────────────────────────────────────────────────────────────────

async function doLogin() {
  const email = document.getElementById('login-email').value.trim();
  const pw = document.getElementById('login-password').value;
  const errEl = document.getElementById('login-error');
  const btn = document.getElementById('login-btn');
  errEl.classList.add('hidden');
  if (!email || !pw) { errEl.textContent = 'Please enter your email and password.'; errEl.classList.remove('hidden'); return; }
  btn.textContent = 'Signing in…'; btn.disabled = true;
  try {
    const d = await api('POST', '/auth/login', { email, password: pw }, false);
    STATE.accessToken = d.accessToken;
    STATE.refreshToken = d.refreshToken;
    STATE.user = d.user;
    localStorage.setItem('poseidon_rt', d.refreshToken);
    bootApp();
  } catch (e) {
    errEl.textContent = e.message;
    errEl.classList.remove('hidden');
  } finally { btn.textContent = 'Sign In'; btn.disabled = false; }
}

function doLogout() {
  api('POST', '/auth/logout', { refreshToken: STATE.refreshToken }, false).catch(() => {});
  STATE = { accessToken: null, refreshToken: null, user: null, currentView: null, candidatePage: 1, submissionPage: 1, activePipeline: '', currentCandidate: null, clients: [], recruiters: [] };
  localStorage.removeItem('poseidon_rt');
  document.getElementById('view-app').classList.add('hidden');
  document.getElementById('view-login').style.display = '';
}

function bootApp() {
  document.getElementById('view-login').style.display = 'none';
  document.getElementById('view-app').classList.remove('hidden');
  const u = STATE.user;
  document.getElementById('user-name').textContent = `${u.firstName} ${u.lastName}`;
  document.getElementById('user-role').textContent = u.role.replace('_', ' ');
  document.getElementById('user-avatar').textContent = (u.firstName[0] + u.lastName[0]).toUpperCase();
  if (!['SUPER_ADMIN', 'ADMIN'].includes(u.role)) {
    document.getElementById('admin-only-section').style.display = 'none';
    document.getElementById('nav-users').style.display = 'none';
  }
  loadClientsList();
  loadRecruitersList();
  showView('dashboard');
  pollSubmissionBadge();
  pollNotifications();
}

// ── View router ───────────────────────────────────────────────────────────────

const VIEW_META = {
  dashboard:   { title: 'Dashboard',          action: null },
  submissions: { title: 'New Submissions',     action: { label: '+ Convert to Candidate', fn: null } },
  candidates:  { title: 'Candidates',          action: { label: '+ Add Candidate', fn: openAddCandidateModal } },
  interviews:  { title: 'Interview Templates', action: { label: '+ New Interview', fn: openNewInterviewModal } },
  clients:     { title: 'Clients',             action: { label: '+ Add Client', fn: openAddClientModal } },
  compliance:  { title: 'Document Compliance Filter', action: null },
  forms:       { title: 'Form Builder',        action: { label: '+ New Form', fn: openNewFormModal } },
  users:       { title: 'Users',               action: { label: '+ Add User', fn: openAddUserModal } }
};

function showView(name) {
  document.querySelectorAll('.pane').forEach(p => p.classList.add('hidden'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.getElementById(`pane-${name}`)?.classList.remove('hidden');
  document.querySelector(`[data-view="${name}"]`)?.classList.add('active');
  const meta = VIEW_META[name];
  document.getElementById('page-title').textContent = meta?.title || name;
  const btn = document.getElementById('topbar-action');
  if (meta?.action) { btn.style.display = ''; btn.textContent = meta.action.label; btn.onclick = meta.action.fn || null; }
  else { btn.style.display = 'none'; }
  STATE.currentView = name;
  if (name === 'dashboard')   loadDashboard();
  if (name === 'submissions') loadSubmissions();
  if (name === 'candidates')  loadCandidates();
  if (name === 'interviews')  loadInterviews();
  if (name === 'clients')     loadClients();
  if (name === 'forms')       loadForms();
  if (name === 'users')       loadUsers();
}

// ── Debounce ──────────────────────────────────────────────────────────────────

function debounce(fn, ms) {
  let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

// ── Dashboard ─────────────────────────────────────────────────────────────────

async function loadDashboard() {
  try {
    const [stats, subData] = await Promise.all([
      api('GET', '/stats'),
      api('GET', '/submissions?reviewed=false&limit=6')
    ]);
    const bp = stats.byPipeline || {};
    const statCards = [
      { label: 'Total Candidates',    value: stats.total,              cls: 'blue'   },
      { label: 'Deployed',            value: stats.deployed,           cls: 'green'  },
      { label: 'New (30 days)',        value: stats.recentSubmissions,  cls: 'amber'  },
      { label: 'Pending Submissions', value: stats.pendingSubmissions,  cls: 'amber'  },
      { label: '🚢 Sea-Based',        value: bp.SEA_BASED  || 0,       cls: 'blue'   },
      { label: '🏢 Land-Based',       value: bp.LAND_BASED || 0,       cls: 'green'  },
      { label: '🎓 J1 Program',       value: bp.J1_PROGRAM || 0,       cls: 'purple' },
    ];
    document.getElementById('dash-stats').innerHTML = statCards.map(s => `
      <div class="stat-card ${s.cls}">
        <div class="stat-value">${s.value ?? '—'}</div>
        <div class="stat-label">${s.label}</div>
      </div>`).join('');

    // Funnel from byStatus
    const funnel = stats.byStatus || [];
    const funnelHtml = funnel.length ? `
      <div class="card" style="margin-bottom:20px;">
        <div class="card-header"><span class="card-title">Pipeline Funnel</span></div>
        <div style="padding:0 20px 16px;">
          ${funnel.map(row => {
            const pct = stats.total ? Math.round((row.cnt / stats.total) * 100) : 0;
            return `
              <div style="display:flex;align-items:center;gap:12px;padding:6px 0;border-bottom:1px solid var(--border);">
                <div style="width:140px;font-size:.78rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:.03em;flex-shrink:0;">${statusLabel(row.status)}</div>
                <div style="flex:1;background:var(--navy-mid);border-radius:4px;overflow:hidden;height:8px;">
                  <div style="height:100%;background:var(--blue);width:${pct}%;border-radius:4px;transition:width .4s;"></div>
                </div>
                <div style="width:40px;text-align:right;font-size:.82rem;font-weight:600;color:var(--text);">${row.cnt}</div>
              </div>`;
          }).join('')}
        </div>
      </div>` : '';

    const rows = subData.submissions || [];
    const recentHtml = rows.length ? `
      <div class="card">
        <div class="card-header">
          <span class="card-title">Pending Submissions</span>
          <button class="btn btn-ghost btn-sm" onclick="showView('submissions')">View All</button>
        </div>
        <div class="table-wrap"><table>
          <thead><tr><th>Applicant</th><th>Pipeline</th><th>Submitted</th></tr></thead>
          <tbody>${rows.map(s => {
            const d = tryParse(s.data);
            const name = `${d.firstName || d.first_name || '?'} ${d.lastName || d.last_name || ''}`.trim();
            return `<tr style="cursor:pointer;" onclick="showView('submissions')"><td>${esc(name)}</td><td>${pipelineBadge(s.pipeline)}</td><td>${relTime(s.created_at)}</td></tr>`;
          }).join('')}</tbody>
        </table></div>
      </div>` : `<div class="card" style="padding:32px;text-align:center;color:var(--text-muted);">No pending submissions</div>`;

    document.getElementById('dash-recent-submissions').innerHTML = funnelHtml + recentHtml;
  } catch (e) { toast(e.message, 'error'); }
}

async function pollSubmissionBadge() {
  try {
    const d = await api('GET', '/submissions?reviewed=false&limit=1');
    const badge = document.getElementById('badge-submissions');
    if (d && d.total > 0) { badge.textContent = d.total > 99 ? '99+' : d.total; badge.style.display = ''; }
    else badge.style.display = 'none';
  } catch {}
  setTimeout(pollSubmissionBadge, 30000);
}

// ── Submissions ───────────────────────────────────────────────────────────────

async function loadSubmissions() {
  const pipeline = document.getElementById('sub-pipeline').value;
  const reviewed = document.getElementById('sub-reviewed').value;
  const page = STATE.submissionPage;
  const params = new URLSearchParams({ page, limit: 20 });
  if (pipeline) params.set('pipeline', pipeline);
  if (reviewed !== '') params.set('reviewed', reviewed);
  try {
    const d = await api('GET', `/submissions?${params}`);
    const tbody = document.getElementById('submissions-tbody');
    tbody.innerHTML = (d.submissions || []).map(s => {
      const data = tryParse(s.data);
      const name = `${data.firstName || data.first_name || '?'} ${data.lastName || data.last_name || ''}`.trim();
      const email = data.email || '—';
      return `<tr>
        <td><div class="candidate-name">${esc(name)}</div><div class="candidate-email">${esc(email)}</div></td>
        <td>${pipelineBadge(s.pipeline)}</td>
        <td>${relTime(s.created_at)}</td>
        <td>${s.is_duplicate ? '<span class="badge badge-rejected">Duplicate</span>' : '<span class="badge badge-new">New</span>'}</td>
        <td style="display:flex;gap:6px">
          <button class="btn btn-primary btn-sm" onclick="convertSubmission('${s.id}','${name}','${email}')">Convert</button>
          <button class="btn btn-ghost btn-sm" onclick="viewSubmission('${s.id}')">View</button>
        </td>
      </tr>`;
    }).join('') || '<tr><td colspan="5" class="table-empty">No submissions found</td></tr>';
    renderPagination('sub-pagination', d.total, 20, page, p => { STATE.submissionPage = p; loadSubmissions(); });
  } catch (e) { toast(e.message, 'error'); }
}

async function viewSubmission(id) {
  try {
    const s = await api('GET', `/submissions/${id}`);
    const data = tryParse(s.data);
    openModal('Submission Details', `
      <div class="info-grid">
        ${Object.entries(data).map(([k, v]) => `<div class="info-item"><label>${esc(k)}</label><span>${esc(String(v || '—'))}</span></div>`).join('')}
      </div>
      <div style="display:flex;gap:8px;margin-top:8px">
        <button class="btn btn-primary" onclick="convertSubmission('${s.id}','','')">Convert to Candidate</button>
        <button class="btn btn-danger btn-sm" onclick="flagDuplicate('${s.id}')">Flag Duplicate</button>
      </div>`);
  } catch (e) { toast(e.message, 'error'); }
}

async function convertSubmission(id, name, email) {
  const confirm = await showConfirm(`Convert submission from <strong>${esc(name)}</strong> to a Candidate record?`);
  if (!confirm) return;
  try {
    const d = await api('POST', `/submissions/${id}/convert`, {});
    closeModal();
    toast(`Candidate record created`, 'success');
    loadSubmissions(); loadDashboard();
    if (d.candidateId) openCandidateDetail(d.candidateId);
  } catch (e) { toast(e.message, 'error'); }
}

async function flagDuplicate(id) {
  await api('POST', `/submissions/${id}/flag-duplicate`, {});
  closeModal(); toast('Flagged as duplicate', 'info'); loadSubmissions();
}

// ── Candidates ────────────────────────────────────────────────────────────────

function setActivePipeline(p) {
  STATE.activePipeline = p; STATE.candidatePage = 1;
  document.querySelectorAll('#pipeline-tabs button').forEach(b => {
    b.className = '';
    if (b.dataset.pipeline === p) {
      if (p === '') b.className = 'active-all';
      else if (p === 'SEA_BASED') b.className = 'active-sea';
      else if (p === 'LAND_BASED') b.className = 'active-land';
      else if (p === 'J1_PROGRAM') b.className = 'active-j1';
    }
  });
  loadCandidates();
}

async function loadCandidates() {
  const search = document.getElementById('cand-search').value.trim();
  const status = document.getElementById('cand-status').value;
  const page = STATE.candidatePage;
  const params = new URLSearchParams({ page, limit: 25 });
  if (STATE.activePipeline) params.set('pipeline', STATE.activePipeline);
  if (status) params.set('status', status);
  if (search) params.set('search', search);
  try {
    const d = await api('GET', `/candidates?${params}`);
    const tbody = document.getElementById('candidates-tbody');
    tbody.innerHTML = (d.candidates || []).map(c => `
      <tr onclick="openCandidateDetail('${c.id}')">
        <td>
          <div class="candidate-name">${esc(c.first_name)} ${esc(c.last_name)}</div>
          <div class="candidate-email">${esc(c.email)}</div>
        </td>
        <td>${pipelineBadge(c.pipeline)}</td>
        <td>${statusBadge(c.status)}</td>
        <td class="text-muted">${c.recruiter_fn ? `${esc(c.recruiter_fn)} ${esc(c.recruiter_ln)}` : '—'}</td>
        <td class="text-muted text-sm">${relTime(c.updated_at)}</td>
      </tr>`).join('') || '<tr><td colspan="5" class="table-empty">No candidates found</td></tr>';
    renderPagination('cand-pagination', d.total, 25, page, p => { STATE.candidatePage = p; loadCandidates(); });
  } catch (e) { toast(e.message, 'error'); }
}

async function openCandidateDetail(id) {
  try {
    const c = await api('GET', `/candidates/${id}`);
    STATE.currentCandidate = c;
    document.getElementById('dp-name').textContent = `${c.first_name} ${c.last_name}`;
    document.getElementById('dp-email').textContent = c.email;
    document.getElementById('dp-avatar').textContent = (c.first_name[0] + c.last_name[0]).toUpperCase();
    // Show J1 Plan tab only for J1_PROGRAM pipeline
    const j1TabBtn = document.getElementById('tab-j1plan');
    if (j1TabBtn) j1TabBtn.style.display = c.pipeline === 'J1_PROGRAM' ? '' : 'none';
    renderDetailOverview(c);
    renderDetailInterviews(c);
    renderDetailDocuments(c);
    renderDetailEndorsements(c);
    renderDetailHistory(c);
    document.getElementById('dp-tab-j1plan').innerHTML = '<p style="color:var(--text-muted);padding:24px 0;">Loading J1 plan…</p>';
    document.querySelectorAll('.detail-body .tab').forEach((t, i) => { t.classList.toggle('active', i === 0); });
    document.querySelectorAll('[id^="dp-tab-"]').forEach((t, i) => { t.classList.toggle('hidden', i !== 0); });
    document.getElementById('detail-panel').classList.add('open');
  } catch (e) { toast(e.message, 'error'); }
}

function closeDetail() { document.getElementById('detail-panel').classList.remove('open'); }

function renderDetailOverview(c) {
  const el = document.getElementById('dp-tab-overview');
  el.innerHTML = `
    <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:16px">
      ${pipelineBadge(c.pipeline)} ${statusBadge(c.status)}
      <div style="margin-left:auto;display:flex;gap:6px;">
        ${!c.portal_activated_at ? `<button class="btn btn-ghost btn-sm" style="color:var(--blue)" onclick="sendPortalInvite('${esc(c.id)}')">Send Portal Invite</button>` : ''}
        <button class="btn btn-ghost btn-sm" onclick="openEditCandidateModal('${esc(c.id)}')">Edit Info</button>
      </div>
    </div>
    <div class="info-grid" style="margin-bottom:16px">
      <div class="info-item"><label>Phone</label><span>${esc(c.phone || '—')}</span></div>
      <div class="info-item"><label>Nationality</label><span>${esc(c.nationality || '—')}</span></div>
      <div class="info-item"><label>Date of Birth</label><span>${esc(c.date_of_birth || '—')}</span></div>
      <div class="info-item"><label>Portal</label><span>${c.portal_activated_at ? '<span style="color:var(--success)">Active</span>' : '<span style="color:var(--text-muted)">Not activated</span>'}</span></div>
      <div class="info-item"><label>Recruiter</label><span>${c.recruiter_fn ? `${esc(c.recruiter_fn)} ${esc(c.recruiter_ln)}` : '—'}</span></div>
      <div class="info-item"><label>Created</label><span>${relTime(c.created_at)}</span></div>
    </div>
    <div style="margin-bottom:12px">
      <label style="margin-bottom:8px">Move Stage</label>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        ${nextStages(c.status).map(s => `<button class="btn btn-sm btn-ghost" onclick="advanceStage('${c.id}','${s}')">${statusLabel(s)}</button>`).join('')}
      </div>
    </div>
    ${['PRE_QUAL_APPROVED', 'ENDORSED'].includes(c.status) ? `
    <div style="margin-bottom:12px">
      <button class="btn btn-primary btn-sm" onclick="openEndorseModal('${c.id}')">Endorse to Client</button>
    </div>` : ''}
    <div>
      <label style="margin-bottom:6px">Assign Recruiter</label>
      <div style="display:flex;gap:8px">
        <select id="assign-recruiter-sel" style="flex:1">
          <option value="">— Select Recruiter —</option>
          ${STATE.recruiters.map(r => `<option value="${r.id}" ${r.id === c.assigned_recruiter_id ? 'selected' : ''}>${esc(r.first_name)} ${esc(r.last_name)}</option>`).join('')}
        </select>
        <button class="btn btn-secondary btn-sm" onclick="assignRecruiter('${c.id}')">Assign</button>
      </div>
    </div>
    ${c.internal_notes ? `<div class="mt-4"><label>Internal Notes</label><p class="text-sm text-muted" style="margin-top:4px">${esc(c.internal_notes)}</p></div>` : ''}`;
}

async function advanceStage(candidateId, toStatus) {
  try {
    await api('POST', `/candidates/${candidateId}/stage`, { toStatus });
    toast(`Status → ${statusLabel(toStatus)}`, 'success');
    openCandidateDetail(candidateId);
    loadCandidates();
  } catch (e) { toast(e.message, 'error'); }
}

async function assignRecruiter(candidateId) {
  const rid = document.getElementById('assign-recruiter-sel').value;
  if (!rid) return;
  try {
    await api('POST', `/candidates/${candidateId}/assign-recruiter`, { recruiterId: rid });
    toast('Recruiter assigned', 'success');
    openCandidateDetail(candidateId);
  } catch (e) { toast(e.message, 'error'); }
}

function renderDetailInterviews(c) {
  const el = document.getElementById('dp-tab-interviews');
  const interviews = c.interviews || [];
  el.innerHTML = `
    <div style="display:flex;gap:8px;margin-bottom:16px">
      <button class="btn btn-primary btn-sm" onclick="openSendInterviewModal('${c.id}')">Send Interview</button>
    </div>` +
    (interviews.length ? interviews.map(i => `
      <div class="card" style="margin-bottom:10px">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <div>
            <div style="font-weight:600">${esc(i.title)}</div>
            <div class="text-sm text-muted">${esc(i.type)} · ${relTime(i.invited_at)}</div>
          </div>
          <span class="badge ${i.status === 'SUBMITTED' || i.status === 'COMPLETED' ? 'badge-approved' : 'badge-active'}">${esc(i.status)}</span>
        </div>
        ${i.score != null ? `<div style="margin-top:8px;font-size:.85rem;">Score: <strong>${i.score}/100</strong> · ${i.passed ? '<span style="color:var(--success)">Passed</span>' : '<span style="color:var(--danger)">Failed</span>'}</div>` : ''}
        ${i.recruiter_notes ? `<div style="margin-top:4px;font-size:.82rem;color:var(--text-muted);">${esc(i.recruiter_notes)}</div>` : ''}
        ${(i.status === 'SUBMITTED' || i.status === 'COMPLETED') ? `
          <div style="display:flex;gap:6px;margin-top:10px">
            ${i.type === 'ONE_WAY' ? `<button class="btn btn-ghost btn-sm" onclick="viewInterviewResponses('${esc(c.id)}','${esc(i.id)}','${esc(i.interview_id)}')">View Responses</button>` : ''}
            <button class="btn btn-ghost btn-sm" onclick="openScoreInterviewModal('${esc(c.id)}','${esc(i.id)}',${i.score||'null'},${i.passed!=null?i.passed:'null'})">Score</button>
          </div>` : ''}
      </div>`).join('') : '<div class="empty" style="padding:32px"><p>No interviews yet</p></div>');
}

async function viewInterviewResponses(candidateId, candidateInterviewId, interviewId) {
  try {
    const [c, template] = await Promise.all([
      Promise.resolve(STATE.currentCandidate),
      api('GET', `/interviews/${interviewId}`)
    ]);
    const ci = (c?.interviews || []).find(i => i.id === candidateInterviewId);
    let responses = [];
    try { responses = JSON.parse(ci?.responses || '[]'); } catch {}
    let questions = [];
    try { questions = JSON.parse(template?.questions || '[]'); } catch {}
    const respMap = {};
    responses.forEach(r => { respMap[r.questionId] = r.responseText || r.text || ''; });
    openModal('Interview Responses', `
      <div style="margin-bottom:8px;font-size:.85rem;color:var(--text-muted);">
        ${esc(template?.title)} · Submitted ${relTime(ci?.completed_at || ci?.updated_at)}
      </div>
      ${questions.length ? questions.map((q, idx) => `
        <div style="margin-bottom:16px;padding:12px;background:var(--navy-mid);border-radius:8px;">
          <div style="font-size:.75rem;font-weight:700;text-transform:uppercase;color:var(--text-muted);margin-bottom:4px;">Q${idx+1}</div>
          <div style="font-weight:500;margin-bottom:8px;">${esc(q.text)}</div>
          <div style="font-size:.85rem;color:var(--text);white-space:pre-wrap;border-left:2px solid var(--blue);padding-left:10px;">${esc(respMap[q.id||idx] || '(No answer)')}</div>
        </div>`).join('') : '<p style="color:var(--text-muted)">No questions found in this template.</p>'}
      <div class="modal-footer">
        <button class="btn btn-ghost" onclick="closeModal()">Close</button>
        <button class="btn btn-primary" onclick="closeModal();openScoreInterviewModal('${esc(candidateId)}','${esc(candidateInterviewId)}',null,null)">Score This Interview</button>
      </div>`, 'modal-lg');
  } catch (e) { toast(e.message, 'error'); }
}

function openScoreInterviewModal(candidateId, candidateInterviewId, currentScore, currentPassed) {
  openModal('Score Interview', `
    <div class="form-group">
      <label>Score (0–100)</label>
      <input type="number" id="sc-score" min="0" max="100" value="${currentScore ?? ''}" placeholder="e.g. 75">
    </div>
    <div class="form-group">
      <label>Result</label>
      <select id="sc-passed">
        <option value="">— Not set —</option>
        <option value="1" ${currentPassed === 1 ? 'selected' : ''}>Pass</option>
        <option value="0" ${currentPassed === 0 ? 'selected' : ''}>Fail</option>
      </select>
    </div>
    <div class="form-group">
      <label>Recruiter Notes</label>
      <textarea id="sc-notes" rows="3" style="width:100%;background:var(--input-bg);border:1px solid var(--border);color:var(--text);border-radius:6px;padding:8px;font-size:13px;resize:vertical;" placeholder="Internal notes visible only to recruiters"></textarea>
    </div>
    <div class="modal-footer">
      <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="saveInterviewScore('${esc(candidateId)}','${esc(candidateInterviewId)}')">Save Score</button>
    </div>`);
}

async function saveInterviewScore(candidateId, candidateInterviewId) {
  const score   = document.getElementById('sc-score').value;
  const passed  = document.getElementById('sc-passed').value;
  const notes   = document.getElementById('sc-notes').value.trim();
  const body = {};
  if (score !== '') body.score = parseInt(score);
  if (passed !== '') body.passed = passed === '1';
  if (notes) body.recruiterNotes = notes;
  if (!Object.keys(body).length) { closeModal(); return; }
  try {
    await api('PATCH', `/candidates/${candidateId}/interviews/${candidateInterviewId}`, body);
    closeModal(); toast('Score saved', 'success');
    openCandidateDetail(candidateId);
  } catch (e) { toast(e.message, 'error'); }
}

function renderDetailDocuments(c) {
  const el = document.getElementById('dp-tab-documents');
  const docs = c.documents || [];
  el.innerHTML = `
    <div style="display:flex;gap:8px;margin-bottom:16px">
      <button class="btn btn-primary btn-sm" onclick="openUploadDocModal('${c.id}')">Upload Document</button>
    </div>` +
    (docs.length ? docs.map(d => `
      <div class="doc-row">
        <div class="doc-icon">📄</div>
        <div class="doc-info">
          <div class="doc-name">${esc(d.label)}</div>
          <div class="doc-meta">
            ${d.document_number ? `#${esc(d.document_number)} · ` : ''}
            ${d.expiration_date ? `Exp: <span class="${expiryClass(d.expiration_date)}">${fmtDate(d.expiration_date)}</span>` : 'No expiry'}
          </div>
        </div>
        <div style="display:flex;gap:6px;align-items:center">
          ${d.is_verified ? '<span class="badge badge-approved">✓ Verified</span>' : `<button class="btn btn-ghost btn-sm" onclick="verifyDoc('${c.id}','${d.id}')">Verify</button>`}
          ${d.onedrive_file_id ? `<button class="btn btn-secondary btn-sm" onclick="downloadDoc('${c.id}','${d.id}')">↓</button>` : '<span class="text-muted text-xs">No file</span>'}
          <button class="btn btn-ghost btn-sm" onclick="openEditDocModal('${c.id}','${d.id}')">Edit</button>
        </div>
      </div>`).join('') : '<div class="empty" style="padding:32px"><p>No documents yet</p></div>');
}

function renderDetailEndorsements(c) {
  const el = document.getElementById('dp-tab-endorsements');
  const end = c.endorsements || [];
  el.innerHTML = `
    ${c.status === 'PRE_QUAL_APPROVED' ? `<div style="margin-bottom:16px"><button class="btn btn-primary btn-sm" onclick="openEndorseModal('${c.id}')">Endorse to Client</button></div>` : ''}` +
    (end.length ? end.map(e => `
      <div class="card" style="margin-bottom:10px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
          <div style="font-weight:600">${esc(e.client_name)}</div>
          <span class="badge ${e.status === 'APPROVED' ? 'badge-approved' : e.status === 'REJECTED' ? 'badge-rejected' : 'badge-active'}">${esc(e.status)}</span>
        </div>
        <div class="text-sm text-muted">Endorsed ${relTime(e.endorsed_at)}</div>
        ${e.scheduled_at ? `<div class="text-sm">Interview: ${fmtDate(e.scheduled_at)}</div>` : ''}
        <div style="display:flex;gap:6px;margin-top:8px">
          <button class="btn btn-sm btn-ghost" onclick="updateEndorsement('${e.id}','APPROVED')">Approve</button>
          <button class="btn btn-sm btn-danger" onclick="updateEndorsement('${e.id}','REJECTED')">Reject</button>
        </div>
      </div>`).join('') : '<div class="empty" style="padding:32px"><p>Not endorsed to any client yet</p></div>');
}

function renderDetailHistory(c) {
  const el = document.getElementById('dp-tab-history');
  const hist = (c.stageHistory || []).slice().reverse();
  el.innerHTML = hist.length ? `<div class="timeline">${hist.map(h => `
    <div class="timeline-item">
      <div class="timeline-dot"></div>
      <div class="timeline-label">${h.from_status ? `${statusLabel(h.from_status)} → ` : ''}${statusLabel(h.to_status)}</div>
      <div class="timeline-meta">${h.fn ? `${esc(h.fn)} ${esc(h.ln)} · ` : ''}${relTime(h.created_at)}</div>
      ${h.reason ? `<div class="text-sm text-muted" style="margin-top:2px">${esc(h.reason)}</div>` : ''}
    </div>`).join('')}</div>` :
    '<div class="empty" style="padding:32px"><p>No history yet</p></div>';
}

function switchDetailTab(name, el) {
  document.querySelectorAll('.detail-body .tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('[id^="dp-tab-"]').forEach(t => t.classList.add('hidden'));
  el.classList.add('active');
  document.getElementById(`dp-tab-${name}`).classList.remove('hidden');
  if (name === 'j1plan' && STATE.currentCandidate) loadJ1Plan(STATE.currentCandidate.id);
}

// ── Interviews ────────────────────────────────────────────────────────────────

async function loadInterviews() {
  try {
    const d = await api('GET', '/interviews');
    const tbody = document.getElementById('interviews-tbody');
    tbody.innerHTML = (d.interviews || []).map(i => `
      <tr>
        <td style="font-weight:500">${esc(i.title)}</td>
        <td><span class="badge badge-active">${esc(i.type)}</span></td>
        <td class="text-muted">${i.fn ? esc(i.fn) + ' ' + esc(i.ln) : '—'}</td>
        <td class="text-muted text-sm">${relTime(i.created_at)}</td>
        <td style="white-space:nowrap">
          <button class="btn btn-ghost btn-sm" onclick="openEditInterviewModal('${i.id}')">Edit</button>
          ${i.type === 'BOOKING' ? `<button class="btn btn-ghost btn-sm" onclick="viewInterviewSlots('${i.id}')">Manage Slots</button>` : ''}
        </td>
      </tr>`).join('') || '<tr><td colspan="5" class="table-empty">No interview templates</td></tr>';
  } catch (e) { toast(e.message, 'error'); }
}

function openNewInterviewModal() {
  openModal('New Interview Template', `
    <div class="form-group"><label>Title</label><input type="text" id="ni-title" placeholder="Pre-Qualifying OWI — Sea-Based"></div>
    <div class="form-group"><label>Type</label>
      <select id="ni-type">
        <option value="ONE_WAY">One-Way Interview</option>
        <option value="TWO_WAY">Two-Way Interview</option>
        <option value="BOOKING">Booking Interview</option>
      </select>
    </div>
    <div class="form-group"><label>Description</label><textarea id="ni-desc" placeholder="Optional description"></textarea></div>
    <div class="modal-footer">
      <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="createInterview()">Create</button>
    </div>`);
}

async function createInterview() {
  const title = document.getElementById('ni-title').value.trim();
  const type = document.getElementById('ni-type').value;
  const description = document.getElementById('ni-desc').value.trim();
  if (!title) { toast('Title required', 'error'); return; }
  try {
    await api('POST', '/interviews', { title, type, description });
    closeModal(); toast('Interview template created', 'success'); loadInterviews();
  } catch (e) { toast(e.message, 'error'); }
}

function openEditInterviewModal(interviewId) {
  api('GET', `/interviews/${interviewId}`).then(i => {
    let qs = [];
    try { qs = JSON.parse(i.questions || '[]'); } catch {}
    openModal('Edit Interview Template', `
      <div class="form-group"><label>Title</label><input type="text" id="ei-title" value="${esc(i.title)}"></div>
      <div class="form-group"><label>Description</label><textarea id="ei-desc" rows="2" style="width:100%;background:var(--input-bg);border:1px solid var(--border);color:var(--text);border-radius:6px;padding:8px;font-size:13px;resize:vertical;">${esc(i.description||'')}</textarea></div>
      ${i.type === 'ONE_WAY' || i.type === 'TWO_WAY' ? `
        <div style="margin-top:16px">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
            <label style="margin:0;font-size:.75rem;text-transform:uppercase;font-weight:700;color:var(--text-muted);">Questions</label>
            <button class="btn btn-ghost btn-sm" onclick="addInterviewQuestion()">+ Add Question</button>
          </div>
          <div id="questions-editor">
            ${qs.map((q, idx) => `
              <div class="q-edit-row" data-qid="${esc(q.id||('q'+(idx+1)))}" style="display:flex;gap:8px;margin-bottom:8px;align-items:flex-start">
                <span style="color:var(--text-muted);font-size:.78rem;padding-top:8px;min-width:20px;">${idx+1}.</span>
                <input type="text" class="q-text-input form-input" value="${esc(q.text||'')}" placeholder="Enter question" style="flex:1;">
                <button class="btn btn-ghost btn-sm" style="color:var(--danger);flex-shrink:0;margin-top:2px" onclick="this.closest('.q-edit-row').remove()">✕</button>
              </div>`).join('') || '<p style="font-size:.82rem;color:var(--text-muted)">No questions yet. Add one below.</p>'}
          </div>
        </div>` : ''}
      <div class="modal-footer">
        <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
        <button class="btn btn-primary" onclick="saveInterviewEdit('${esc(i.id)}','${esc(i.type)}')">Save</button>
      </div>`, 'modal-lg');
  }).catch(e => toast(e.message, 'error'));
}

function addInterviewQuestion() {
  const editor = document.getElementById('questions-editor');
  if (!editor) return;
  const idx = editor.querySelectorAll('.q-edit-row').length + 1;
  const div = document.createElement('div');
  div.className = 'q-edit-row';
  div.dataset.qid = `q${idx}_${Date.now()}`;
  div.style.cssText = 'display:flex;gap:8px;margin-bottom:8px;align-items:flex-start';
  div.innerHTML = `
    <span style="color:var(--text-muted);font-size:.78rem;padding-top:8px;min-width:20px;">${idx}.</span>
    <input type="text" class="q-text-input form-input" placeholder="Enter question" style="flex:1;">
    <button class="btn btn-ghost btn-sm" style="color:var(--danger);flex-shrink:0;margin-top:2px" onclick="this.closest('.q-edit-row').remove()">✕</button>`;
  editor.appendChild(div);
  div.querySelector('input').focus();
}

async function saveInterviewEdit(interviewId, type) {
  const title = document.getElementById('ei-title').value.trim();
  const description = document.getElementById('ei-desc').value.trim();
  if (!title) { toast('Title is required', 'error'); return; }
  const body = { title, description };
  if (type === 'ONE_WAY' || type === 'TWO_WAY') {
    const rows = document.querySelectorAll('#questions-editor .q-edit-row');
    body.questions = [...rows].map(row => ({
      id: row.dataset.qid,
      text: row.querySelector('.q-text-input').value.trim(),
      type: 'text'
    })).filter(q => q.text);
  }
  try {
    await api('PATCH', `/interviews/${interviewId}`, body);
    closeModal(); toast('Interview template saved', 'success'); loadInterviews();
  } catch (e) { toast(e.message, 'error'); }
}

function openSendInterviewModal(candidateId) {
  openModal('Send Interview Invitation', `
    <div class="form-group"><label>Interview Template</label>
      <select id="si-interview" style="width:100%">
        <option value="">Loading…</option>
      </select>
    </div>
    <div class="form-group"><label>Expires In (hours)</label><input type="number" id="si-expires" value="72" min="1"></div>
    <div class="modal-footer">
      <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="sendInterview('${candidateId}')">Send Invitation</button>
    </div>`);
  api('GET', '/interviews').then(d => {
    const sel = document.getElementById('si-interview');
    if (sel) sel.innerHTML = (d.interviews || []).map(i => `<option value="${i.id}">[${i.type}] ${esc(i.title)}</option>`).join('');
  });
}

async function sendInterview(candidateId) {
  const interviewId = document.getElementById('si-interview').value;
  const expiresInHours = parseInt(document.getElementById('si-expires').value);
  if (!interviewId) { toast('Select an interview', 'error'); return; }
  try {
    const d = await api('POST', `/candidates/${candidateId}/interviews/invite`, { interviewId, expiresInHours });
    closeModal(); toast('Invitation sent', 'success');
    openCandidateDetail(candidateId);
  } catch (e) { toast(e.message, 'error'); }
}

async function viewInterviewSlots(interviewId) {
  const d = await api('GET', `/interviews/${interviewId}/slots`);
  const slots = d.slots || [];
  openModal('Booking Slots', `
    <div style="margin-bottom:12px">
      <button class="btn btn-primary btn-sm" onclick="openAddSlotsModal('${interviewId}')">+ Add Slots</button>
    </div>
    <div class="table-wrap"><table>
      <thead><tr><th>Start</th><th>End</th><th>Status</th><th></th></tr></thead>
      <tbody>${slots.length ? slots.map(s => `
        <tr>
          <td>${fmtDateTime(s.start_time)}</td>
          <td>${fmtDateTime(s.end_time)}</td>
          <td>${s.is_booked ? '<span class="badge badge-approved">Booked</span>' : s.is_blocked ? '<span class="badge badge-hold">Blocked</span>' : '<span class="badge badge-new">Available</span>'}</td>
          <td>${!s.is_booked ? `<button class="btn btn-ghost btn-sm" style="color:var(--danger);padding:2px 6px;" onclick="deleteSlot('${esc(interviewId)}','${esc(s.id)}')">Delete</button>` : ''}</td>
        </tr>`).join('') :
        '<tr><td colspan="4" class="table-empty">No slots defined</td></tr>'}
      </tbody>
    </table></div>`, 'modal-lg');
}

function openAddSlotsModal(interviewId) {
  openModal('Add Booking Slots', `
    <p class="text-muted text-sm" style="margin-bottom:12px">Add individual slots as ISO datetime strings (e.g. 2026-06-01T09:00:00).</p>
    <div id="slots-list">
      <div class="form-row slot-entry" style="margin-bottom:8px">
        <div><label>Start Time</label><input type="datetime-local" class="slot-start"></div>
        <div><label>End Time</label><input type="datetime-local" class="slot-end"></div>
      </div>
    </div>
    <button class="btn btn-ghost btn-sm" onclick="addSlotRow()">+ Add Row</button>
    <div class="modal-footer">
      <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="submitSlots('${interviewId}')">Save Slots</button>
    </div>`);
}

function addSlotRow() {
  const list = document.getElementById('slots-list');
  const div = document.createElement('div');
  div.className = 'form-row slot-entry'; div.style.marginBottom = '8px';
  div.innerHTML = `<div><label>Start Time</label><input type="datetime-local" class="slot-start"></div><div><label>End Time</label><input type="datetime-local" class="slot-end"></div>`;
  list.appendChild(div);
}

async function submitSlots(interviewId) {
  const starts = [...document.querySelectorAll('.slot-start')].map(i => i.value);
  const ends = [...document.querySelectorAll('.slot-end')].map(i => i.value);
  const slots = starts.map((s, i) => ({ startTime: new Date(s).toISOString(), endTime: new Date(ends[i]).toISOString() })).filter(s => s.startTime && s.endTime);
  if (!slots.length) { toast('No valid slots', 'error'); return; }
  try {
    await api('POST', `/interviews/${interviewId}/slots/bulk`, { slots });
    closeModal(); toast(`${slots.length} slot(s) added`, 'success'); viewInterviewSlots(interviewId);
  } catch (e) { toast(e.message, 'error'); }
}

// ── Clients ───────────────────────────────────────────────────────────────────

async function loadClients() {
  try {
    const d = await api('GET', '/clients');
    const tbody = document.getElementById('clients-tbody');
    tbody.innerHTML = (d.clients || []).map(c => `
      <tr onclick="openClientDetail('${c.id}')">
        <td style="font-weight:600">${esc(c.name)}</td>
        <td><span class="badge badge-active">${esc(c.type.replace('_', ' '))}</span></td>
        <td class="text-muted">${esc(c.country || '—')}</td>
        <td class="text-muted">${esc(c.contact_email || '—')}</td>
        <td>${c.is_active ? '<span class="badge badge-approved">Active</span>' : '<span class="badge badge-new">Inactive</span>'}</td>
      </tr>`).join('') || '<tr><td colspan="5" class="table-empty">No clients</td></tr>';
  } catch (e) { toast(e.message, 'error'); }
}

async function loadClientsList() {
  try { const d = await api('GET', '/clients'); STATE.clients = d.clients || []; } catch {}
}

async function loadRecruitersList() {
  try {
    const d = await api('GET', '/users');
    STATE.recruiters = (d.users || []).filter(u => u.role === 'RECRUITER');
  } catch {}
}

function openAddClientModal() {
  openModal('Add Client', `
    <div class="form-row">
      <div class="form-group"><label>Client Name</label><input type="text" id="ac-name" placeholder="Royal Caribbean"></div>
      <div class="form-group"><label>Type</label>
        <select id="ac-type">
          <option value="CRUISE_LINE">Cruise Line</option>
          <option value="LAND_BASED">Land-Based</option>
          <option value="J1_SPONSOR">J1 Sponsor</option>
        </select>
      </div>
    </div>
    <div class="form-row">
      <div class="form-group"><label>Country</label><input type="text" id="ac-country" placeholder="United States"></div>
      <div class="form-group"><label>Contact Email</label><input type="email" id="ac-email"></div>
    </div>
    <div class="form-group"><label>Notes</label><textarea id="ac-notes"></textarea></div>
    <div class="modal-footer">
      <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="createClient()">Add Client</button>
    </div>`);
}

async function createClient() {
  const name = document.getElementById('ac-name').value.trim();
  const type = document.getElementById('ac-type').value;
  if (!name) { toast('Name required', 'error'); return; }
  try {
    await api('POST', '/clients', { name, type, country: document.getElementById('ac-country').value, contactEmail: document.getElementById('ac-email').value, notes: document.getElementById('ac-notes').value });
    closeModal(); toast('Client added', 'success'); loadClients(); loadClientsList();
  } catch (e) { toast(e.message, 'error'); }
}

async function openClientDetail(id) {
  const [c, endr] = await Promise.all([api('GET', `/clients/${id}`), api('GET', `/clients/${id}/endorsements`)]);
  const contacts = c.contacts || [];
  openModal(c.name, `
    <div class="info-grid" style="margin-bottom:20px">
      <div class="info-item"><label>Type</label><span>${esc(c.type.replace('_', ' '))}</span></div>
      <div class="info-item"><label>Country</label><span>${esc(c.country || '—')}</span></div>
      <div class="info-item"><label>Contact Email</label><span>${esc(c.contact_email || '—')}</span></div>
      <div class="info-item"><label>Status</label><span>${c.is_active ? '<span class="badge badge-approved">Active</span>' : '<span class="badge badge-new">Inactive</span>'}</span></div>
    </div>

    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
      <div class="card-title" style="margin:0">Portal Contacts (${contacts.length})</div>
      <button class="btn btn-ghost btn-sm" onclick="openAddContactToClientModal('${esc(id)}')">+ Add Contact</button>
    </div>
    <div style="margin-bottom:20px">
      ${contacts.length ? contacts.map(ct => `
        <div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--border)">
          <div style="flex:1">
            <div style="font-weight:500;font-size:.88rem;">${esc(ct.first_name)} ${esc(ct.last_name)}</div>
            <div style="font-size:.78rem;color:var(--text-muted);">${esc(ct.email)}</div>
          </div>
          <button class="btn btn-ghost btn-sm" style="color:var(--danger)" onclick="removeContactFromClient('${esc(id)}','${esc(ct.user_id)}')">Remove</button>
        </div>`).join('') : '<div class="text-muted text-sm" style="padding:8px 0">No portal contacts linked. Add a CLIENT_CONTACT user to give access to the client portal.</div>'}
    </div>

    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
      <div class="card-title" style="margin:0">Endorsements (${endr.endorsements?.length || 0})</div>
    </div>
    ${(endr.endorsements || []).map(e => `
      <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--border)">
        <div>
          <div style="font-weight:500">${esc(e.first_name)} ${esc(e.last_name)}</div>
          <div style="font-size:.78rem;color:var(--text-muted)">${esc(e.pipeline)} · ${esc(e.status)}</div>
        </div>
        ${e.status === 'PENDING' || e.status === 'SCHEDULED' ? `
        <div style="display:flex;gap:6px">
          <button class="btn btn-sm btn-primary" onclick="updateEndorsement('${e.id}','APPROVED')">Approve</button>
          <button class="btn btn-ghost btn-sm" style="color:var(--danger)" onclick="updateEndorsement('${e.id}','REJECTED')">Reject</button>
        </div>` : `<span class="badge ${e.status === 'APPROVED' ? 'badge-approved' : 'badge-rejected'}">${esc(e.status)}</span>`}
      </div>`).join('') || '<div class="text-muted text-sm" style="padding:12px 0">No endorsements yet</div>'}
    `, 'modal-lg');
}

function openAddContactToClientModal(clientId) {
  // Fetch all CLIENT_CONTACT users so admin can pick one to link
  openModal('Link Portal Contact', `
    <p style="font-size:.85rem;color:var(--text-muted);margin:0 0 12px">Select a user with the <strong>Client Contact</strong> role to link to this client. They will be able to log in to the client portal.</p>
    <div class="form-group">
      <label>Client Contact User</label>
      <select id="link-user-sel" style="width:100%"><option value="">Loading users…</option></select>
    </div>
    <div class="modal-footer">
      <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="addContactToClient('${esc(clientId)}')">Link Contact</button>
    </div>`);
  api('GET', '/users').then(d => {
    const sel = document.getElementById('link-user-sel');
    if (!sel) return;
    const contacts = (d.users || []).filter(u => u.role === 'CLIENT_CONTACT');
    sel.innerHTML = contacts.length
      ? `<option value="">— Select a user —</option>` + contacts.map(u => `<option value="${u.id}">${esc(u.first_name)} ${esc(u.last_name)} (${esc(u.email)})</option>`).join('')
      : `<option value="">No CLIENT_CONTACT users found — create one in Users first</option>`;
  });
}

async function addContactToClient(clientId) {
  const userId = document.getElementById('link-user-sel').value;
  if (!userId) { toast('Select a user', 'error'); return; }
  try {
    await api('POST', `/clients/${clientId}/contacts`, { userId });
    closeModal(); toast('Contact linked to client', 'success');
    openClientDetail(clientId);
  } catch (e) { toast(e.message, 'error'); }
}

async function removeContactFromClient(clientId, userId) {
  const ok = await showConfirm('Remove this contact? They will lose access to the client portal.');
  if (!ok) return;
  try {
    await api('DELETE', `/clients/${clientId}/contacts/${userId}`);
    toast('Contact removed', 'success');
    openClientDetail(clientId);
  } catch (e) { toast(e.message, 'error'); }
}

// ── Endorsements ──────────────────────────────────────────────────────────────

function openEndorseModal(candidateId) {
  openModal('Endorse to Client(s)', `
    <p class="text-muted text-sm" style="margin-bottom:12px">Select one or more clients for this candidate's final interview.</p>
    <div style="display:flex;flex-direction:column;gap:8px" id="endorse-client-list">
      ${STATE.clients.filter(c => c.is_active).map(c => `
        <label style="display:flex;align-items:center;gap:10px;cursor:pointer;padding:8px;border:1px solid var(--border);border-radius:6px">
          <input type="checkbox" value="${c.id}">
          <div>
            <div style="font-weight:500">${esc(c.name)}</div>
            <div class="text-xs text-muted">${esc(c.type)} · ${esc(c.country || '—')}</div>
          </div>
        </label>`).join('') || '<div class="text-muted">No active clients</div>'}
    </div>
    <div class="modal-footer">
      <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="submitEndorse('${candidateId}')">Endorse</button>
    </div>`);
}

async function submitEndorse(candidateId) {
  const clientIds = [...document.querySelectorAll('#endorse-client-list input:checked')].map(i => i.value);
  if (!clientIds.length) { toast('Select at least one client', 'error'); return; }
  try {
    await api('POST', `/candidates/${candidateId}/endorse`, { clientIds });
    closeModal(); toast(`Endorsed to ${clientIds.length} client(s)`, 'success');
    openCandidateDetail(candidateId);
  } catch (e) { toast(e.message, 'error'); }
}

async function updateEndorsement(id, status) {
  try {
    await api('PATCH', `/endorsements/${id}`, { status });
    toast(`Endorsement → ${status}`, status === 'APPROVED' ? 'success' : 'info');
    if (STATE.currentCandidate) openCandidateDetail(STATE.currentCandidate.id);
    closeModal();
  } catch (e) { toast(e.message, 'error'); }
}

// ── Documents ────────────────────────────────────────────────────────────────

function openUploadDocModal(candidateId) {
  openModal('Upload Document', `
    <div class="form-row">
      <div class="form-group"><label>Document Type</label>
        <select id="ud-type">
          <option value="PASSPORT">Passport</option>
          <option value="VISA_J1">J1 Visa</option>
          <option value="VISA_B1B2">B1/B2 Visa</option>
          <option value="SEAMANS_BOOK">Seaman's Book</option>
          <option value="MEDICAL_CERTIFICATE">Medical Certificate</option>
          <option value="STCW_CERTIFICATE">STCW Certificate</option>
          <option value="DS_2019">DS-2019</option>
          <option value="NBI_CLEARANCE">NBI Clearance</option>
          <option value="OTHER">Other</option>
        </select>
      </div>
      <div class="form-group"><label>Label</label><input type="text" id="ud-label" placeholder="e.g. Philippine Passport"></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label>Document Number</label><input type="text" id="ud-number" placeholder="P1234567"></div>
      <div class="form-group"><label>Issuance Date</label><input type="date" id="ud-issued"></div>
    </div>
    <div class="form-group"><label>Expiration Date</label><input type="date" id="ud-expires"></div>
    <div class="form-group">
      <label>File (PDF / JPG / PNG)</label>
      <div class="upload-zone" id="ud-drop" onclick="document.getElementById('ud-file').click()">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
        <p id="ud-file-name">Click or drag file here</p>
      </div>
      <input type="file" id="ud-file" accept=".pdf,.jpg,.jpeg,.png" style="display:none" onchange="onDocFileSelected(this)">
    </div>
    <div class="modal-footer">
      <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" id="ud-submit" onclick="uploadDoc('${candidateId}')">Upload</button>
    </div>`);
}

function onDocFileSelected(input) {
  if (input.files[0]) document.getElementById('ud-file-name').textContent = input.files[0].name;
}

async function uploadDoc(candidateId) {
  const type = document.getElementById('ud-type').value;
  const label = document.getElementById('ud-label').value.trim() || document.getElementById('ud-type').selectedOptions[0].text;
  const documentNumber = document.getElementById('ud-number').value.trim();
  const issuanceDate = document.getElementById('ud-issued').value;
  const expirationDate = document.getElementById('ud-expires').value;
  const file = document.getElementById('ud-file').files[0];
  const btn = document.getElementById('ud-submit');
  btn.textContent = 'Uploading…'; btn.disabled = true;
  try {
    const session = await api('POST', `/candidates/${candidateId}/documents/upload-session`, {
      type, label, fileName: file ? file.name : `${type}.pdf`,
      fileSizeBytes: file ? file.size : 0, mimeType: file ? file.type : 'application/pdf'
    });
    let oneDriveFileId = null;
    if (file && session.uploadUrl) {
      const uploadRes = await fetch(session.uploadUrl, { method: 'PUT', body: file, headers: { 'Content-Type': file.type, 'Content-Length': file.size, 'Content-Range': `bytes 0-${file.size - 1}/${file.size}` } });
      const uploadData = await uploadRes.json();
      oneDriveFileId = uploadData.id;
    }
    if (oneDriveFileId) {
      await api('POST', `/candidates/${candidateId}/documents/${session.sessionId}/confirm-upload`, { oneDriveFileId });
    }
    if (documentNumber || issuanceDate || expirationDate) {
      await api('PATCH', `/candidates/${candidateId}/documents/${session.sessionId}`, { documentNumber, issuanceDate: issuanceDate || undefined, expirationDate: expirationDate || undefined });
    }
    closeModal(); toast('Document uploaded', 'success'); openCandidateDetail(candidateId);
  } catch (e) { toast(e.message, 'error'); } finally { btn.textContent = 'Upload'; btn.disabled = false; }
}

async function verifyDoc(candidateId, docId) {
  try {
    await api('POST', `/candidates/${candidateId}/documents/${docId}/verify`);
    toast('Document verified', 'success'); openCandidateDetail(candidateId);
  } catch (e) { toast(e.message, 'error'); }
}

async function downloadDoc(candidateId, docId) {
  try {
    const d = await api('GET', `/candidates/${candidateId}/documents/${docId}/download-url`);
    window.open(d.downloadUrl, '_blank');
  } catch (e) { toast(e.message, 'error'); }
}

function openEditDocModal(candidateId, docId) {
  const doc = STATE.currentCandidate?.documents?.find(d => d.id === docId);
  if (!doc) return;
  openModal('Edit Document Metadata', `
    <div class="form-group"><label>Label</label><input type="text" id="ed-label" value="${esc(doc.label)}"></div>
    <div class="form-group"><label>Document Number</label><input type="text" id="ed-number" value="${esc(doc.document_number || '')}"></div>
    <div class="form-row">
      <div class="form-group"><label>Issuance Date</label><input type="date" id="ed-issued" value="${doc.issuance_date || ''}"></div>
      <div class="form-group"><label>Expiration Date</label><input type="date" id="ed-expires" value="${doc.expiration_date || ''}"></div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="saveDocMeta('${candidateId}','${docId}')">Save</button>
    </div>`);
}

async function saveDocMeta(candidateId, docId) {
  try {
    await api('PATCH', `/candidates/${candidateId}/documents/${docId}`, {
      label: document.getElementById('ed-label').value,
      documentNumber: document.getElementById('ed-number').value,
      issuanceDate: document.getElementById('ed-issued').value || undefined,
      expirationDate: document.getElementById('ed-expires').value || undefined
    });
    closeModal(); toast('Document updated', 'success'); openCandidateDetail(candidateId);
  } catch (e) { toast(e.message, 'error'); }
}

// ── Compliance filter ─────────────────────────────────────────────────────────

async function runComplianceFilter() {
  const sel = document.getElementById('comp-doc-types');
  const types = [...sel.options].filter(o => o.selected).map(o => o.value);
  const expiresBefore = document.getElementById('comp-expires-before').value;
  const pipeline = document.getElementById('comp-pipeline').value;
  const status = document.getElementById('comp-status').value;
  const expiredOnly = document.getElementById('comp-expired-only').checked;
  const params = new URLSearchParams();
  types.forEach(t => params.append('documentType', t));
  if (expiresBefore) params.set('expiresBefore', expiresBefore);
  if (pipeline) params.set('pipeline', pipeline);
  if (status) params.set('status', status);
  if (expiredOnly) params.set('expiredOnly', 'true');
  try {
    const d = await api('GET', `/candidates/compliance-filter?${params}`);
    const results = d.results || [];
    document.getElementById('compliance-results').innerHTML = results.length ? `
      <div class="card-title" style="margin-bottom:12px">${results.length} result(s)</div>
      <div class="table-wrap"><table>
        <thead><tr><th>Candidate</th><th>Pipeline</th><th>Status</th><th>Document</th><th>Expires</th><th>Verified</th></tr></thead>
        <tbody>${results.map(r => `
          <tr onclick="openCandidateDetail('${r.id}')">
            <td><div class="candidate-name">${esc(r.first_name)} ${esc(r.last_name)}</div><div class="candidate-email">${esc(r.email)}</div></td>
            <td>${pipelineBadge(r.pipeline)}</td>
            <td>${statusBadge(r.status)}</td>
            <td>${esc(r.label)}</td>
            <td class="${expiryClass(r.expiration_date)} compliance-days">${fmtDate(r.expiration_date)} (${daysUntil(r.expiration_date)}d)</td>
            <td>${r.is_verified ? '<span class="badge badge-approved">✓</span>' : '<span class="badge badge-new">No</span>'}</td>
          </tr>`).join('')}
        </tbody>
      </table></div>` : `<div class="alert alert-success">✓ No compliance issues found for this filter.</div>`;
  } catch (e) { toast(e.message, 'error'); }
}

// ── Form builder ──────────────────────────────────────────────────────────────

async function loadForms() {
  try {
    const d = await api('GET', '/forms');
    const el = document.getElementById('forms-list');
    el.innerHTML = (d.forms || []).map(f => `
      <div class="card" style="margin-bottom:12px">
        <div class="card-header">
          <div>
            <span class="card-title">${esc(f.name)}</span>
            ${f.pipeline ? ` · ${pipelineBadge(f.pipeline)}` : ' · <span class="badge badge-new">All Pipelines</span>'}
          </div>
          <div style="display:flex;gap:6px">
            <span class="${f.is_active ? 'badge badge-approved' : 'badge badge-new'}">${f.is_active ? 'Active' : 'Inactive'}</span>
            <button class="btn btn-ghost btn-sm" onclick="openEditFormModal('${f.id}')">Edit</button>
            <button class="btn btn-ghost btn-sm" onclick="toggleFormActive('${f.id}', ${!f.is_active})">${f.is_active ? 'Deactivate' : 'Activate'}</button>
          </div>
        </div>
      </div>`).join('') || '<div class="empty"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/></svg><h3>No forms yet</h3><p>Create your first application form</p></div>';
  } catch (e) { toast(e.message, 'error'); }
}

function openNewFormModal() {
  openModal('New Submission Form', `
    <div class="form-group"><label>Form Name</label><input type="text" id="nf-name" placeholder="Sea-Based Application 2026"></div>
    <div class="form-group"><label>Pipeline</label>
      <select id="nf-pipeline"><option value="">All Pipelines</option><option value="SEA_BASED">Sea-Based</option><option value="LAND_BASED">Land-Based</option><option value="J1_PROGRAM">J1 Program</option></select>
    </div>
    <label style="display:flex;align-items:center;gap:8px;margin-bottom:16px;cursor:pointer">
      <input type="checkbox" id="nf-active" checked> Set as active default form for pipeline
    </label>
    <div class="modal-footer">
      <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="createForm()">Create Form</button>
    </div>`);
}

async function createForm() {
  const name = document.getElementById('nf-name').value.trim();
  if (!name) { toast('Name required', 'error'); return; }
  try {
    const d = await api('POST', '/forms', { name, pipeline: document.getElementById('nf-pipeline').value || null, isActive: document.getElementById('nf-active').checked, isDefault: document.getElementById('nf-active').checked });
    closeModal(); toast('Form created', 'success'); loadForms();
  } catch (e) { toast(e.message, 'error'); }
}

async function toggleFormActive(id, isActive) {
  try { await api('PATCH', `/forms/${id}`, { isActive }); toast('Form updated', 'success'); loadForms(); }
  catch (e) { toast(e.message, 'error'); }
}

async function openEditFormModal(id) {
  const d = await api('GET', `/forms/${id}`);
  openModal(`Edit Form: ${esc(d.name)}`, `
    <div class="form-group"><label>Form Name</label><input type="text" id="ef-name" value="${esc(d.name)}"></div>
    <div class="card-title" style="margin:16px 0 10px">Fields (${d.fields?.length || 0})</div>
    <div id="ef-fields">${(d.fields || []).map(f => `
      <div style="display:flex;align-items:center;gap:8px;padding:8px;border:1px solid var(--border);border-radius:6px;margin-bottom:6px">
        <span style="flex:1;font-size:13px"><strong>${esc(f.label)}</strong> <span class="text-muted">(${f.field_type}${f.is_required ? ', required' : ''})</span></span>
        <button class="btn btn-ghost btn-sm" onclick="deleteField('${id}','${f.id}')">✕</button>
      </div>`).join('')}</div>
    <div style="display:flex;gap:8px;margin-top:12px">
      <button class="btn btn-ghost btn-sm" onclick="openAddFieldModal('${id}')">+ Add Field</button>
    </div>
    <div class="modal-footer">
      <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="saveFormName('${id}')">Save</button>
    </div>`, 'modal-lg');
}

function openAddFieldModal(formId) {
  openModal('Add Field', `
    <div class="form-group"><label>Label</label><input type="text" id="af-label" placeholder="Full Name"></div>
    <div class="form-group"><label>Field Key (machine name)</label><input type="text" id="af-key" placeholder="full_name"></div>
    <div class="form-group"><label>Type</label>
      <select id="af-type"><option value="text">Text</option><option value="email">Email</option><option value="phone">Phone</option><option value="date">Date</option><option value="select">Select</option><option value="textarea">Textarea</option><option value="file">File Upload</option><option value="checkbox">Checkbox</option></select>
    </div>
    <label style="display:flex;align-items:center;gap:8px;margin-bottom:16px"><input type="checkbox" id="af-required"> Required</label>
    <div class="modal-footer">
      <button class="btn btn-ghost" onclick="openEditFormModal('${formId}')">← Back</button>
      <button class="btn btn-primary" onclick="addField('${formId}')">Add Field</button>
    </div>`);
}

async function addField(formId) {
  try {
    await api('POST', `/forms/${formId}/fields`, { label: document.getElementById('af-label').value, fieldKey: document.getElementById('af-key').value, fieldType: document.getElementById('af-type').value, isRequired: document.getElementById('af-required').checked, sortOrder: 99 });
    toast('Field added', 'success'); openEditFormModal(formId);
  } catch (e) { toast(e.message, 'error'); }
}

async function deleteField(formId, fieldId) {
  await api('DELETE', `/forms/${formId}/fields/${fieldId}`); toast('Field removed', 'info'); openEditFormModal(formId);
}

async function saveFormName(id) {
  try { await api('PATCH', `/forms/${id}`, { name: document.getElementById('ef-name').value }); closeModal(); toast('Form saved', 'success'); loadForms(); }
  catch (e) { toast(e.message, 'error'); }
}

// ── Users ────────────────────────────────────────────────────────────────────

async function loadUsers() {
  try {
    const d = await api('GET', '/users');
    const tbody = document.getElementById('users-tbody');
    tbody.innerHTML = (d.users || []).map(u => `
      <tr>
        <td style="font-weight:500">${esc(u.first_name)} ${esc(u.last_name)}</td>
        <td class="text-muted">${esc(u.email)}</td>
        <td><span class="badge badge-active">${esc(u.role.replace(/_/g, ' '))}</span></td>
        <td>${u.is_active ? '<span class="badge badge-approved">Active</span>' : '<span class="badge badge-new">Inactive</span>'}</td>
        <td class="text-muted text-sm">${u.last_login_at ? relTime(u.last_login_at) : 'Never'}</td>
        <td style="white-space:nowrap">
          <button class="btn btn-ghost btn-sm" onclick="resetUserPassword('${esc(u.id)}')">Reset PW</button>
          <button class="btn btn-ghost btn-sm" style="color:${u.is_active ? 'var(--warning)' : 'var(--success)'}" onclick="toggleUserActive('${esc(u.id)}',${u.is_active ? 0 : 1})">${u.is_active ? 'Deactivate' : 'Activate'}</button>
        </td>
      </tr>`).join('') || '<tr><td colspan="6" class="table-empty">No users</td></tr>';
  } catch (e) { toast(e.message, 'error'); }
}

function openAddUserModal() {
  openModal('Add User', `
    <div class="form-row">
      <div class="form-group"><label>First Name</label><input type="text" id="au-fn"></div>
      <div class="form-group"><label>Last Name</label><input type="text" id="au-ln"></div>
    </div>
    <div class="form-group"><label>Email</label><input type="email" id="au-email"></div>
    <div class="form-group"><label>Role</label>
      <select id="au-role"><option value="RECRUITER">Recruiter</option><option value="ADMIN">Admin</option><option value="CLIENT_CONTACT">Client Contact</option></select>
    </div>
    <div class="form-group"><label>Temporary Password</label><input type="text" id="au-pw" placeholder="Leave blank to auto-generate"></div>
    <div class="modal-footer">
      <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="createUser()">Create User</button>
    </div>`);
}

async function createUser() {
  const firstName = document.getElementById('au-fn').value.trim();
  const lastName = document.getElementById('au-ln').value.trim();
  const email = document.getElementById('au-email').value.trim();
  const role2 = document.getElementById('au-role').value;
  const password = document.getElementById('au-pw').value;
  if (!firstName || !lastName || !email) { toast('All fields required', 'error'); return; }
  try {
    const d = await api('POST', '/users', { firstName, lastName, email, role: role2, password: password || undefined });
    closeModal(); toast(`User created${d.tempPassword ? ` · Temp password: ${d.tempPassword}` : ''}`, 'success'); loadUsers();
  } catch (e) { toast(e.message, 'error'); }
}

// ── Add candidate ─────────────────────────────────────────────────────────────

function openAddCandidateModal() {
  openModal('Add Candidate Manually', `
    <div class="form-row">
      <div class="form-group"><label>First Name <span style="color:var(--danger)">*</span></label><input type="text" id="nc-fn" placeholder="First name"></div>
      <div class="form-group"><label>Last Name <span style="color:var(--danger)">*</span></label><input type="text" id="nc-ln" placeholder="Last name"></div>
    </div>
    <div class="form-group"><label>Email Address <span style="color:var(--danger)">*</span></label><input type="email" id="nc-email" placeholder="candidate@email.com"></div>
    <div class="form-row">
      <div class="form-group"><label>Phone</label><input type="tel" id="nc-phone" placeholder="+1 555 000 0000"></div>
      <div class="form-group"><label>Nationality</label><input type="text" id="nc-nationality" placeholder="e.g. Filipino"></div>
    </div>
    <div class="form-group"><label>Position Applied</label><input type="text" id="nc-position" placeholder="e.g. Waiter / Hotel Staff / J1 Intern"></div>
    <div class="form-group"><label>Pipeline <span style="color:var(--danger)">*</span></label>
      <select id="nc-pipeline"><option value="SEA_BASED">Sea-Based</option><option value="LAND_BASED">Land-Based</option><option value="J1_PROGRAM">J1 Program</option></select>
    </div>
    <div class="modal-footer">
      <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="createCandidateManual()">Create</button>
    </div>`);
}

async function createCandidateManual() {
  const firstName      = document.getElementById('nc-fn').value.trim();
  const lastName       = document.getElementById('nc-ln').value.trim();
  const email          = document.getElementById('nc-email').value.trim();
  const phone          = document.getElementById('nc-phone').value.trim();
  const nationality    = document.getElementById('nc-nationality').value.trim();
  const positionApplied = document.getElementById('nc-position').value.trim();
  const pipeline       = document.getElementById('nc-pipeline').value;
  if (!firstName || !lastName || !email) { toast('First name, last name, and email are required', 'error'); return; }
  try {
    const d = await api('POST', '/candidates', { firstName, lastName, email, phone: phone || undefined, nationality: nationality || undefined, positionApplied: positionApplied || undefined, pipeline });
    closeModal(); toast('Candidate created', 'success'); loadCandidates(); openCandidateDetail(d.candidateId);
  } catch (e) { toast(e.message, 'error'); }
}

// ── Modal helpers ─────────────────────────────────────────────────────────────

function openModal(title, html, extraClass = '') {
  const c = document.getElementById('modal-container');
  c.innerHTML = `
    <div class="modal-overlay" onclick="maybeCloseModal(event)">
      <div class="modal ${extraClass}">
        <div class="modal-header">
          <span class="modal-title">${title}</span>
          <button class="modal-close" onclick="closeModal()">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        ${html}
      </div>
    </div>`;
}

function closeModal() { document.getElementById('modal-container').innerHTML = ''; }
function maybeCloseModal(e) { if (e.target.classList.contains('modal-overlay')) closeModal(); }

function showConfirm(msg) {
  return new Promise(resolve => {
    openModal('Confirm', `<p style="margin-bottom:20px">${msg}</p>
      <div class="modal-footer">
        <button class="btn btn-ghost" onclick="closeModal(); window._confirmResolve(false)">Cancel</button>
        <button class="btn btn-primary" onclick="closeModal(); window._confirmResolve(true)">Confirm</button>
      </div>`);
    window._confirmResolve = resolve;
  });
}

// ── Pagination ────────────────────────────────────────────────────────────────

function renderPagination(containerId, total, pageSize, current, onPage) {
  const pages = Math.ceil(total / pageSize);
  const el = document.getElementById(containerId);
  if (pages <= 1) { el.innerHTML = ''; return; }
  el.innerHTML = `
    <button onclick="(${onPage})(${current - 1})" ${current <= 1 ? 'disabled' : ''}>← Prev</button>
    <span class="page-info">${current} / ${pages} &nbsp;(${total} total)</span>
    <button onclick="(${onPage})(${current + 1})" ${current >= pages ? 'disabled' : ''}>Next →</button>`;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function esc(s) { return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function tryParse(s) { try { return typeof s === 'string' ? JSON.parse(s) : s; } catch { return {}; } }
function relTime(iso) {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return `${Math.floor(diff/60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff/3600000)}h ago`;
  return `${Math.floor(diff/86400000)}d ago`;
}
function fmtDate(iso) { return iso ? new Date(iso).toLocaleDateString('en-US', { year:'numeric', month:'short', day:'numeric' }) : '—'; }
function fmtDateTime(iso) { return iso ? new Date(iso).toLocaleString('en-US', { month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' }) : '—'; }
function daysUntil(iso) { if (!iso) return ''; return Math.ceil((new Date(iso).getTime() - Date.now()) / 86400000); }
function expiryClass(iso) {
  if (!iso) return '';
  const d = daysUntil(iso);
  if (d < 0) return 'expiry-dead';
  if (d < 60) return 'expiry-warn';
  return 'expiry-ok';
}

function pipelineBadge(p) {
  const map = { SEA_BASED: ['badge-sea','🚢 Sea-Based'], LAND_BASED: ['badge-land','🏨 Land-Based'], J1_PROGRAM: ['badge-j1','🎓 J1 Program'] };
  const [cls, label] = map[p] || ['badge-new', p];
  return `<span class="badge ${cls}">${label}</span>`;
}

function statusBadge(s) {
  const map = {
    NEW_SUBMISSION:'badge-new', SCREENING:'badge-active', DUPLICATE_FLAGGED:'badge-hold',
    OWI_INVITED:'badge-active', OWI_SUBMITTED:'badge-active', TWI_SCHEDULED:'badge-active',
    TWI_COMPLETED:'badge-active', BOOKING_INVITED:'badge-active', BOOKING_CONFIRMED:'badge-active',
    BOOKING_COMPLETED:'badge-active', PRE_QUAL_APPROVED:'badge-approved',
    PRE_QUAL_REJECTED:'badge-rejected', ENDORSED:'badge-active', CLIENT_APPROVED:'badge-approved',
    ONBOARDING:'badge-active', DOCUMENT_REVIEW:'badge-hold', COMPLIANCE_HOLD:'badge-hold',
    DEPLOYED:'badge-deployed', WITHDRAWN:'badge-rejected', ARCHIVED:'badge-new'
  };
  return `<span class="badge ${map[s]||'badge-new'}">${statusLabel(s)}</span>`;
}

function statusLabel(s) {
  return s.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
}

function nextStages(current) {
  const map = {
    NEW_SUBMISSION:['SCREENING','ARCHIVED'],
    SCREENING:['OWI_INVITED','TWI_SCHEDULED','DUPLICATE_FLAGGED','ARCHIVED'],
    DUPLICATE_FLAGGED:['SCREENING','ARCHIVED'],
    OWI_INVITED:['OWI_SUBMITTED','ARCHIVED'],
    OWI_SUBMITTED:['TWI_SCHEDULED','ARCHIVED'],
    TWI_SCHEDULED:['TWI_COMPLETED','ARCHIVED'],
    TWI_COMPLETED:['BOOKING_INVITED','PRE_QUAL_APPROVED','ARCHIVED'],
    BOOKING_INVITED:['BOOKING_CONFIRMED','ARCHIVED'],
    BOOKING_CONFIRMED:['BOOKING_COMPLETED'],
    BOOKING_COMPLETED:['PRE_QUAL_APPROVED','PRE_QUAL_REJECTED'],
    PRE_QUAL_APPROVED:['ENDORSED','ARCHIVED'],
    PRE_QUAL_REJECTED:['SCREENING','ARCHIVED'],
    ENDORSED:['CLIENT_APPROVED','ARCHIVED'],
    CLIENT_APPROVED:['ONBOARDING'],
    ONBOARDING:['DOCUMENT_REVIEW','COMPLIANCE_HOLD'],
    DOCUMENT_REVIEW:['DEPLOYED','COMPLIANCE_HOLD'],
    COMPLIANCE_HOLD:['DOCUMENT_REVIEW'],
  };
  return map[current] || [];
}

// ── Notifications ─────────────────────────────────────────────────────────────

let _notifOpen = false;

async function pollNotifications() {
  try {
    const d = await api('GET', '/notifications?unread=1&limit=20');
    const badge = document.getElementById('notif-badge');
    const count = d?.unreadCount || 0;
    if (count > 0) { badge.textContent = count > 99 ? '99+' : count; badge.style.display = ''; }
    else badge.style.display = 'none';
    if (_notifOpen) renderNotifications(d?.notifications || []);
  } catch {}
  setTimeout(pollNotifications, 60000);
}

function toggleNotifDrawer() {
  const drawer = document.getElementById('notif-drawer');
  _notifOpen = !_notifOpen;
  drawer.style.display = _notifOpen ? 'block' : 'none';
  if (_notifOpen) {
    api('GET', '/notifications?limit=30').then(d => renderNotifications(d?.notifications || [])).catch(() => {});
    document.addEventListener('click', closeNotifOnClickOutside, { once: true });
  }
}

function closeNotifOnClickOutside(e) {
  const drawer = document.getElementById('notif-drawer');
  const btn    = document.getElementById('btn-notif');
  if (!drawer.contains(e.target) && !btn.contains(e.target)) {
    drawer.style.display = 'none';
    _notifOpen = false;
  } else if (_notifOpen) {
    document.addEventListener('click', closeNotifOnClickOutside, { once: true });
  }
}

function renderNotifications(notifs) {
  const list = document.getElementById('notif-list');
  if (!notifs.length) {
    list.innerHTML = '<p style="padding:16px;text-align:center;color:var(--text-muted);font-size:.85rem;">No notifications</p>';
    return;
  }
  list.innerHTML = notifs.map(n => `
    <div style="padding:12px 16px;border-bottom:1px solid var(--border);cursor:pointer;opacity:${n.is_read ? '.6' : '1'};transition:background .1s;"
      onmouseenter="this.style.background='var(--navy-mid)'" onmouseleave="this.style.background=''"
      onclick="markNotifRead('${esc(n.id)}',this)">
      <div style="display:flex;align-items:flex-start;gap:8px;">
        ${!n.is_read ? '<div style="width:6px;height:6px;border-radius:50%;background:var(--blue);flex-shrink:0;margin-top:5px;"></div>' : '<div style="width:6px;flex-shrink:0;"></div>'}
        <div style="flex:1;min-width:0;">
          <div style="font-size:.85rem;color:var(--text);font-weight:${n.is_read ? '400' : '500'};">${esc(n.subject || n.type)}</div>
          <div style="font-size:.78rem;color:var(--text-muted);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(n.body)}</div>
          <div style="font-size:.73rem;color:var(--text-muted);margin-top:3px;">${relTime(n.created_at)}</div>
        </div>
      </div>
    </div>
  `).join('');
}

async function markNotifRead(id, rowEl) {
  rowEl.style.opacity = '.6';
  await api('PATCH', `/notifications/${id}/read`).catch(() => {});
  pollNotifications();
}

async function markAllNotifsRead() {
  await api('POST', '/notifications/mark-all-read').catch(() => {});
  pollNotifications();
  api('GET', '/notifications?limit=30').then(d => renderNotifications(d?.notifications || [])).catch(() => {});
}

// ── J1 Training Plan ──────────────────────────────────────────────────────────

async function loadJ1Plan(candidateId) {
  const el = document.getElementById('dp-tab-j1plan');
  try {
    const plan = await api('GET', `/candidates/${candidateId}/j1-plan`);
    el.innerHTML = `
      <div style="margin-bottom:16px;display:flex;justify-content:space-between;align-items:center;">
        <h4 style="margin:0;font-size:.9rem;">J1 Training Plan</h4>
        <button class="btn btn-primary btn-sm" onclick="openSaveJ1PlanModal('${esc(candidateId)}')">Edit Plan</button>
      </div>
      <div class="info-grid">
        <div class="info-item"><label>DS-2019 Number</label><span>${esc(plan.ds2019_number || '—')}</span></div>
        <div class="info-item"><label>SEVIS ID</label><span>${esc(plan.sevis_id || '—')}</span></div>
        <div class="info-item"><label>Program Start</label><span>${esc(plan.program_start || '—')}</span></div>
        <div class="info-item"><label>Program End</label><span>${esc(plan.program_end || '—')}</span></div>
        <div class="info-item"><label>Host Organization</label><span>${esc(plan.host_organization || '—')}</span></div>
        <div class="info-item"><label>Occupational Category</label><span>${esc(plan.occupational_category || '—')}</span></div>
        <div class="info-item"><label>Supervisor</label><span>${esc(plan.supervisor_name || '—')}</span></div>
        <div class="info-item"><label>Supervisor Email</label><span>${esc(plan.supervisor_email || '—')}</span></div>
        <div class="info-item"><label>DOS Submitted</label><span>${esc(plan.dos_submitted_at || '—')}</span></div>
        <div class="info-item"><label>DOS Approved</label><span>${esc(plan.dos_approved_at || '—')}</span></div>
      </div>
      ${plan.training_phases ? `
        <div style="margin-top:16px;">
          <label style="font-size:.75rem;text-transform:uppercase;color:var(--text-muted);">Training Phases</label>
          <div style="margin-top:8px;display:flex;flex-direction:column;gap:8px;">
            ${(JSON.parse(plan.training_phases)||[]).map(ph => `
              <div style="background:var(--navy-mid);border-radius:6px;padding:10px 14px;">
                <div style="font-weight:600;font-size:.85rem;">${esc(ph.name||ph.title||'Phase')}</div>
                ${ph.duration ? `<div style="font-size:.78rem;color:var(--text-muted);">Duration: ${esc(ph.duration)}</div>` : ''}
                ${ph.description ? `<div style="font-size:.78rem;color:var(--text-muted);margin-top:2px;">${esc(ph.description)}</div>` : ''}
              </div>`).join('')}
          </div>
        </div>` : ''}`;
  } catch (e) {
    el.innerHTML = `<p style="color:var(--text-muted);padding:24px 0;">No J1 plan yet. <button class="btn btn-primary btn-sm" onclick="openSaveJ1PlanModal('${esc(candidateId)}')">Create Plan</button></p>`;
  }
}

function openSaveJ1PlanModal(candidateId) {
  const plan = {}; // could pre-fill from current panel state
  openModal('Edit J1 Training Plan', `
    <div class="form-row">
      <div class="form-group"><label>DS-2019 Number</label><input type="text" id="j1-ds2019" value="${esc(plan.ds2019_number||'')}"></div>
      <div class="form-group"><label>SEVIS ID</label><input type="text" id="j1-sevis" value="${esc(plan.sevis_id||'')}"></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label>Program Start</label><input type="date" id="j1-start" value="${esc(plan.program_start||'')}"></div>
      <div class="form-group"><label>Program End</label><input type="date" id="j1-end" value="${esc(plan.program_end||'')}"></div>
    </div>
    <div class="form-group"><label>Host Organization</label><input type="text" id="j1-host" value="${esc(plan.host_organization||'')}"></div>
    <div class="form-row">
      <div class="form-group"><label>Supervisor Name</label><input type="text" id="j1-sup-name" value="${esc(plan.supervisor_name||'')}"></div>
      <div class="form-group"><label>Supervisor Email</label><input type="email" id="j1-sup-email" value="${esc(plan.supervisor_email||'')}"></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label>Occupational Category</label><input type="text" id="j1-occ" value="${esc(plan.occupational_category||'')}"></div>
      <div class="form-group"><label>Supervisor Phone</label><input type="tel" id="j1-sup-phone" value="${esc(plan.supervisor_phone||'')}"></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label>DOS Submitted</label><input type="date" id="j1-dos-sub" value="${esc(plan.dos_submitted_at||'')}"></div>
      <div class="form-group"><label>DOS Approved</label><input type="date" id="j1-dos-app" value="${esc(plan.dos_approved_at||'')}"></div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="saveJ1Plan('${esc(candidateId)}')">Save</button>
    </div>`);
}

async function saveJ1Plan(candidateId) {
  const body = {
    ds2019Number:       document.getElementById('j1-ds2019').value.trim() || undefined,
    sevisId:            document.getElementById('j1-sevis').value.trim() || undefined,
    programStart:       document.getElementById('j1-start').value || undefined,
    programEnd:         document.getElementById('j1-end').value || undefined,
    hostOrganization:   document.getElementById('j1-host').value.trim() || undefined,
    supervisorName:     document.getElementById('j1-sup-name').value.trim() || undefined,
    supervisorEmail:    document.getElementById('j1-sup-email').value.trim() || undefined,
    supervisorPhone:    document.getElementById('j1-sup-phone').value.trim() || undefined,
    occupationalCategory: document.getElementById('j1-occ').value.trim() || undefined,
    dosSubmittedAt:     document.getElementById('j1-dos-sub').value || undefined,
    dosApprovedAt:      document.getElementById('j1-dos-app').value || undefined,
  };
  try {
    await api('PUT', `/candidates/${candidateId}/j1-plan`, body);
    closeModal();
    toast('J1 plan saved', 'success');
    loadJ1Plan(candidateId);
  } catch (e) { toast(e.message, 'error'); }
}

// ── CSV Export ────────────────────────────────────────────────────────────────

async function exportCandidatesCSV() {
  const pipeline = document.getElementById('cand-status')?.closest('.pane')?.querySelector('#cand-status')?.value
    || STATE.activePipeline || '';
  const status   = document.getElementById('cand-status')?.value || '';
  const params   = new URLSearchParams();
  if (pipeline) params.set('pipeline', pipeline);
  if (status)   params.set('status', status);
  const url = `${API}/reports/candidates.csv?${params}`;
  const headers = STATE.accessToken ? { Authorization: `Bearer ${STATE.accessToken}` } : {};
  try {
    const res = await fetch(url, { headers });
    if (!res.ok) { toast('Export failed', 'error'); return; }
    const blob = await res.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `candidates_${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
    toast('CSV exported', 'success');
  } catch (e) { toast(e.message, 'error'); }
}

// ── Keyboard shortcuts ────────────────────────────────────────────────────────

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') { closeDetail(); closeModal(); }
});

document.getElementById('login-password').addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });
document.getElementById('login-email').addEventListener('keydown', e => { if (e.key === 'Enter') document.getElementById('login-password').focus(); });

// ── Boot ──────────────────────────────────────────────────────────────────────

(async function init() {
  const rt = localStorage.getItem('poseidon_rt');
  if (rt) {
    STATE.refreshToken = rt;
    const ok = await refreshTokens();
    if (ok) {
      const me = await api('GET', '/portal/me', null, false).catch(() => null);
      if (!me) {
        const claims = parseJWT(STATE.accessToken);
        STATE.user = { id: claims?.sub, role: claims?.role, firstName: '?', lastName: '' };
        const u = await api('GET', '/users', null, false).catch(() => null);
        if (u) { const me2 = u.users?.find(x => x.id === claims?.sub); if (me2) STATE.user = { ...claims, firstName: me2.first_name, lastName: me2.last_name, email: me2.email }; }
      } else {
        const claims = parseJWT(STATE.accessToken);
        STATE.user = { id: claims?.sub, role: claims?.role, firstName: me.first_name, lastName: me.last_name, email: me.email };
      }
      if (STATE.user?.role && STATE.user.role !== 'CANDIDATE') { bootApp(); return; }
    }
    localStorage.removeItem('poseidon_rt');
  }
})();

function parseJWT(token) {
  try { const p = token.split('.')[1]; return JSON.parse(atob(p.replace(/-/g,'+').replace(/_/g,'/'))); } catch { return null; }
}

// ── Portal Invite ─────────────────────────────────────────────────────────────

async function sendPortalInvite(candidateId) {
  try {
    await api('POST', `/candidates/${candidateId}/portal-invite`);
    toast('Portal activation email sent', 'success');
    openCandidateDetail(candidateId);
  } catch (e) { toast(e.message, 'error'); }
}

// ── Delete Booking Slot ───────────────────────────────────────────────────────

async function deleteSlot(interviewId, slotId) {
  const ok = await showConfirm('Delete this slot? This cannot be undone.');
  if (!ok) return;
  try {
    await api('DELETE', `/interviews/${interviewId}/slots/${slotId}`);
    toast('Slot deleted', 'success');
    viewInterviewSlots(interviewId);
  } catch (e) { toast(e.message, 'error'); }
}

// ── User Management ───────────────────────────────────────────────────────────

async function toggleUserActive(userId, isActive) {
  try {
    await api('PATCH', `/users/${userId}`, { isActive: isActive === 1 });
    toast(isActive ? 'User activated' : 'User deactivated', isActive ? 'success' : 'info');
    loadUsers();
  } catch (e) { toast(e.message, 'error'); }
}

function resetUserPassword(userId) {
  openModal('Reset User Password', `
    <div class="form-group">
      <label>New Password</label>
      <input type="password" id="rp-pw" placeholder="At least 8 characters" autofocus>
    </div>
    <div class="modal-footer">
      <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="saveUserPassword('${esc(userId)}')">Set Password</button>
    </div>`);
}

async function saveUserPassword(userId) {
  const pw = document.getElementById('rp-pw').value;
  if (!pw || pw.length < 8) { toast('Password must be at least 8 characters', 'error'); return; }
  try {
    await api('PATCH', `/users/${userId}`, { password: pw });
    closeModal(); toast('Password updated', 'success');
  } catch (e) { toast(e.message, 'error'); }
}

// ── Edit Candidate Info ────────────────────────────────────────────────────────

function openEditCandidateModal(candidateId) {
  const c = STATE.currentCandidate;
  if (!c || c.id !== candidateId) return;
  openModal('Edit Candidate Info', `
    <div class="form-row">
      <div class="form-group"><label>First Name</label><input type="text" id="ec-fn" value="${esc(c.first_name||'')}"></div>
      <div class="form-group"><label>Last Name</label><input type="text" id="ec-ln" value="${esc(c.last_name||'')}"></div>
    </div>
    <div class="form-group"><label>Middle Name</label><input type="text" id="ec-mn" value="${esc(c.middle_name||'')}"></div>
    <div class="form-row">
      <div class="form-group"><label>Phone</label><input type="tel" id="ec-phone" value="${esc(c.phone||'')}"></div>
      <div class="form-group"><label>Nationality</label><input type="text" id="ec-nat" value="${esc(c.nationality||'')}"></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label>Date of Birth</label><input type="date" id="ec-dob" value="${esc(c.date_of_birth||'')}"></div>
      <div class="form-group"><label>Years Experience</label><input type="number" id="ec-exp" min="0" value="${esc(c.years_experience||'')}"></div>
    </div>
    <div class="form-group"><label>Internal Notes</label><textarea id="ec-notes" rows="3" style="width:100%;background:var(--input-bg);border:1px solid var(--border);color:var(--text);border-radius:6px;padding:8px;font-size:13px;resize:vertical;">${esc(c.internal_notes||'')}</textarea></div>
    <div class="modal-footer">
      <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="saveEditCandidate('${esc(candidateId)}')">Save Changes</button>
    </div>`);
}

async function saveEditCandidate(candidateId) {
  const body = {
    firstName:    document.getElementById('ec-fn').value.trim()    || undefined,
    lastName:     document.getElementById('ec-ln').value.trim()    || undefined,
    middleName:   document.getElementById('ec-mn').value.trim()    || undefined,
    phone:        document.getElementById('ec-phone').value.trim() || undefined,
    nationality:  document.getElementById('ec-nat').value.trim()   || undefined,
    dateOfBirth:  document.getElementById('ec-dob').value          || undefined,
    internalNotes: document.getElementById('ec-notes').value.trim() || undefined,
  };
  // Remove undefined keys
  Object.keys(body).forEach(k => body[k] === undefined && delete body[k]);
  if (!Object.keys(body).length) { closeModal(); return; }
  try {
    await api('PATCH', `/candidates/${candidateId}`, body);
    closeModal(); toast('Candidate info updated', 'success');
    openCandidateDetail(candidateId);
  } catch (e) { toast(e.message, 'error'); }
}

// ── Forgot Password ────────────────────────────────────────────────────────────

function openForgotPasswordModal() {
  openModal('Forgot Password', `
    <p style="font-size:.88rem;color:var(--text-muted);margin:0 0 16px;">Enter your email address and we'll send you a password reset link.</p>
    <div class="form-group"><label>Email Address</label><input type="email" id="fp-email" placeholder="your@ctigroup.com" autofocus></div>
    <div id="fp-msg" class="alert hidden" style="margin-bottom:12px;"></div>
    <div class="modal-footer">
      <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" id="fp-btn" onclick="sendForgotPassword()">Send Reset Link</button>
    </div>`);
}

async function sendForgotPassword() {
  const email = document.getElementById('fp-email').value.trim();
  const msgEl = document.getElementById('fp-msg');
  const btn   = document.getElementById('fp-btn');
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
