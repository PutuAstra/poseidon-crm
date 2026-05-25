'use strict';

const API = 'https://poseidon-api.putuastrawijaya.workers.dev/api/v1';

let TOKEN    = null;
let INTERVIEW = null;
let QUESTIONS = [];

function esc(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function show(id)  { document.getElementById(id)?.classList.remove('hidden'); }
function hide(id)  { document.getElementById(id)?.classList.add('hidden'); }

// ── Load ──────────────────────────────────────────────────────────────────────

async function loadInterview() {
  TOKEN = new URLSearchParams(location.search).get('t');
  if (!TOKEN) { showError('No interview token in URL. Please use the link from your email.'); return; }

  let data;
  try {
    const res = await fetch(`${API}/interview/${encodeURIComponent(TOKEN)}`);
    data = await res.json();
    if (res.status === 409) { hide('view-loading'); show('view-already-submitted'); return; }
    if (!res.ok) { showError(data.error || 'This interview link is invalid or has expired.'); return; }
  } catch (e) {
    showError('Network error. Please check your connection and try again.');
    return;
  }

  INTERVIEW = data.interview;
  QUESTIONS = INTERVIEW.questions || [];
  const candidate = data.candidate;
  const pipeMap = { SEA_BASED:'Sea-Based', LAND_BASED:'Land-Based', J1_PROGRAM:'J1 Visa Program' };

  hide('view-loading');

  // TWO_WAY or CLIENT_FINAL — just show confirmation details
  if (INTERVIEW.type === 'TWO_WAY' || INTERVIEW.type === 'CLIENT_FINAL') {
    document.getElementById('twi-title').textContent = INTERVIEW.title;
    document.getElementById('twi-desc').textContent = INTERVIEW.description || 'You have been invited for an interview. Please check your email for meeting details.';
    if (candidate) {
      document.getElementById('twi-details').innerHTML = `
        <p style="margin:0 0 4px;font-size:.75rem;color:var(--text-muted);">Candidate</p>
        <p style="margin:0 0 12px;font-weight:600;color:var(--text);">${esc([candidate.first_name,candidate.last_name].filter(Boolean).join(' '))}</p>
        <p style="margin:0 0 4px;font-size:.75rem;color:var(--text-muted);">Pipeline</p>
        <p style="margin:0;color:var(--text);">${esc(pipeMap[candidate.pipeline]||candidate.pipeline)}</p>`;
    }
    show('view-two-way');
    return;
  }

  // ONE_WAY — render questions
  document.getElementById('iview-title').textContent = INTERVIEW.title;
  if (INTERVIEW.description) document.getElementById('iview-desc').textContent = INTERVIEW.description;
  if (candidate) {
    document.getElementById('candidate-info').textContent =
      `${[candidate.first_name,candidate.last_name].filter(Boolean).join(' ')} · ${pipeMap[candidate.pipeline]||candidate.pipeline}`;
  }
  renderQuestions();
  show('view-interview');
}

// ── Render questions ──────────────────────────────────────────────────────────

function renderQuestions() {
  const container = document.getElementById('questions-container');
  if (!QUESTIONS.length) {
    container.innerHTML = `<div class="question-card">
      <p style="color:var(--text-muted);">No questions configured for this interview. Please contact your recruiter.</p>
    </div>`;
    return;
  }
  container.innerHTML = QUESTIONS.map((q, i) => {
    const isVideo = q.type === 'video';
    return `
      <div class="question-card">
        <div class="q-number">Question ${i + 1} of ${QUESTIONS.length}${q.timeLimitSecs ? ` · ${q.timeLimitSecs}s suggested` : ''}</div>
        <div class="q-text">${esc(q.text)}</div>
        ${isVideo ? `<div class="q-hint">💡 Record a short video response on your device, then describe your answer below or paste a link to your recording.</div>` : ''}
        <textarea
          id="ans-${esc(q.id||i)}"
          class="form-input"
          rows="${isVideo ? 3 : 5}"
          placeholder="${isVideo ? 'Describe your answer or paste a video link…' : 'Type your answer here…'}"
          oninput="updateCharCount(this,'cc-${esc(q.id||i)}')"
          style="resize:vertical;"></textarea>
        <div class="char-count" id="cc-${esc(q.id||i)}">0 characters</div>
      </div>`;
  }).join('');
}

function updateCharCount(textarea, countId) {
  const el = document.getElementById(countId);
  if (el) el.textContent = textarea.value.length + ' characters';
}

// ── Submit ────────────────────────────────────────────────────────────────────

async function submitInterview() {
  const errEl = document.getElementById('submit-error');
  hide('submit-error');

  // Collect answers
  const answers = {};
  let unanswered = 0;
  QUESTIONS.forEach((q, i) => {
    const id  = q.id || i;
    const el  = document.getElementById('ans-' + id);
    const val = el ? el.value.trim() : '';
    answers[id] = val;
    if (!val) unanswered++;
  });

  if (unanswered > 0) {
    errEl.textContent = `Please answer all questions (${unanswered} unanswered).`;
    show('submit-error');
    return;
  }

  const btn = document.getElementById('btn-submit');
  btn.disabled = true;
  btn.textContent = 'Submitting…';

  try {
    const res = await fetch(`${API}/interview/${encodeURIComponent(TOKEN)}/submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ answers })
    });
    const d = await res.json();
    if (!res.ok) {
      errEl.textContent = d.error || 'Submission failed. Please try again.';
      show('submit-error');
      btn.disabled = false;
      btn.textContent = 'Submit Interview';
      return;
    }
    hide('view-interview');
    show('view-success');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } catch (e) {
    errEl.textContent = 'Network error. Please try again.';
    show('submit-error');
    btn.disabled = false;
    btn.textContent = 'Submit Interview';
  }
}

// ── Error ─────────────────────────────────────────────────────────────────────

function showError(msg) {
  document.getElementById('error-msg').textContent = msg;
  hide('view-loading');
  show('view-error');
}

// ── Init ──────────────────────────────────────────────────────────────────────

loadInterview();
