'use strict';

const API = 'https://poseidon-api.putuastrawijaya.workers.dev/api/v1';

let selectedPipeline = null;
let dynamicFields    = [];
let activeFormId     = null;

// ── Utilities ─────────────────────────────────────────────────────────────────

function esc(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function toast(msg, type='success') {
  const c = document.getElementById('toast-container');
  const t = document.createElement('div');
  t.className = `toast toast-${type}`;
  t.textContent = msg;
  c.appendChild(t);
  setTimeout(() => t.classList.add('show'), 10);
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, 3500);
}

function show(id)  { document.getElementById(id)?.classList.remove('hidden'); }
function hide(id)  { document.getElementById(id)?.classList.add('hidden'); }

// ── Pipeline Selection ────────────────────────────────────────────────────────

function selectPipeline(pipeline, card) {
  selectedPipeline = pipeline;
  document.querySelectorAll('.pipeline-card').forEach(c => c.classList.remove('selected'));
  card.classList.add('selected');
  loadDynamicFields(pipeline);
}

async function loadDynamicFields(pipeline) {
  try {
    const res = await fetch(`${API}/public/forms/${pipeline}`);
    if (!res.ok) { activeFormId = null; return; }
    const d = await res.json();
    activeFormId = d.id || null;
    dynamicFields = d.fields || [];
    renderDynamicFields(d.fields || []);
  } catch (e) {
    activeFormId = null;
    dynamicFields = [];
    document.getElementById('dynamic-fields-wrap').style.display = 'none';
  }
}

function renderDynamicFields(fields) {
  const wrap = document.getElementById('dynamic-fields-wrap');
  const container = document.getElementById('dynamic-fields');
  if (!fields.length) { wrap.style.display = 'none'; return; }

  container.innerHTML = fields.map(f => {
    const req = f.is_required ? '<span class="required-star">*</span>' : '';
    const opts = f.options ? JSON.parse(f.options) : [];

    switch (f.field_type.toUpperCase()) {
      case 'TEXT':
      case 'EMAIL':
      case 'PHONE':
        return `<div class="form-group">
          <label class="form-label">${esc(f.label)}${req}</label>
          ${f.description ? `<p style="font-size:.78rem;color:var(--text-muted);margin:0 0 6px;">${esc(f.description)}</p>` : ''}
          <input type="text" id="dyn-${esc(f.id)}" class="form-input" placeholder="${esc(f.placeholder||'')}">
        </div>`;

      case 'TEXTAREA':
        return `<div class="form-group">
          <label class="form-label">${esc(f.label)}${req}</label>
          ${f.description ? `<p style="font-size:.78rem;color:var(--text-muted);margin:0 0 6px;">${esc(f.description)}</p>` : ''}
          <textarea id="dyn-${esc(f.id)}" class="form-input" rows="3" placeholder="${esc(f.placeholder||'')}" style="resize:vertical;"></textarea>
        </div>`;

      case 'NUMBER':
        return `<div class="form-group">
          <label class="form-label">${esc(f.label)}${req}</label>
          <input type="number" id="dyn-${esc(f.id)}" class="form-input" placeholder="${esc(f.placeholder||'')}">
        </div>`;

      case 'DATE':
        return `<div class="form-group">
          <label class="form-label">${esc(f.label)}${req}</label>
          <input type="date" id="dyn-${esc(f.id)}" class="form-input">
        </div>`;

      case 'SELECT':
        return `<div class="form-group">
          <label class="form-label">${esc(f.label)}${req}</label>
          <select id="dyn-${esc(f.id)}" class="form-input">
            <option value="">— Select —</option>
            ${opts.map(o => `<option value="${esc(o)}">${esc(o)}</option>`).join('')}
          </select>
        </div>`;

      case 'RADIO':
        return `<div class="form-group">
          <label class="form-label">${esc(f.label)}${req}</label>
          <div style="display:flex;flex-direction:column;gap:8px;margin-top:4px;">
            ${opts.map((o,i) => `
              <label style="display:flex;align-items:center;gap:8px;font-size:.88rem;color:var(--text);cursor:pointer;">
                <input type="radio" name="dyn-${esc(f.id)}" value="${esc(o)}" id="dyn-${esc(f.id)}-${i}" style="accent-color:var(--blue);">
                ${esc(o)}
              </label>
            `).join('')}
          </div>
        </div>`;

      case 'CHECKBOX':
        return `<div class="form-group">
          <div style="display:flex;gap:10px;align-items:flex-start;">
            <input type="checkbox" id="dyn-${esc(f.id)}" style="margin-top:3px;accent-color:var(--blue);width:16px;height:16px;flex-shrink:0;">
            <label for="dyn-${esc(f.id)}" style="font-size:.88rem;color:var(--text);cursor:pointer;">${esc(f.label)}${req}</label>
          </div>
        </div>`;

      default:
        return '';
    }
  }).join('');

  wrap.style.display = 'block';
}

function collectDynamicValues() {
  const values = {};
  for (const f of dynamicFields) {
    if (f.field_type === 'RADIO') {
      const checked = document.querySelector(`input[name="dyn-${f.id}"]:checked`);
      values[f.id] = checked ? checked.value : null;
    } else if (f.field_type === 'CHECKBOX') {
      const el = document.getElementById('dyn-' + f.id);
      values[f.id] = el ? el.checked : false;
    } else {
      const el = document.getElementById('dyn-' + f.id);
      values[f.id] = el ? (el.value.trim() || null) : null;
    }
  }
  return values;
}

// ── Submit ────────────────────────────────────────────────────────────────────

async function submitForm() {
  const errEl = document.getElementById('form-error');
  hide('form-error');

  const fullName   = document.getElementById('f-name').value.trim();
  const dob        = document.getElementById('f-dob').value;
  const nationality= document.getElementById('f-nationality').value.trim();
  const email      = document.getElementById('f-email').value.trim();
  const phone      = document.getElementById('f-phone').value.trim();
  const position   = document.getElementById('f-position').value.trim();
  const consent    = document.getElementById('f-consent').checked;

  // Validation
  if (!selectedPipeline)   { errEl.textContent = 'Please select a pipeline.';            show('form-error'); return; }
  if (!fullName)           { errEl.textContent = 'Full name is required.';               show('form-error'); return; }
  if (!dob)                { errEl.textContent = 'Date of birth is required.';           show('form-error'); return; }
  if (!nationality)        { errEl.textContent = 'Nationality is required.';             show('form-error'); return; }
  if (!email || !email.includes('@')) { errEl.textContent = 'Valid email is required.'; show('form-error'); return; }
  if (!phone)              { errEl.textContent = 'Phone number is required.';            show('form-error'); return; }
  if (!position)           { errEl.textContent = 'Position applied for is required.';    show('form-error'); return; }
  if (!consent)            { errEl.textContent = 'Please accept the declaration to continue.'; show('form-error'); return; }

  // Required dynamic fields
  for (const f of dynamicFields) {
    if (!f.is_required) continue;
    const el = document.getElementById('dyn-' + f.id);
    if (f.field_type === 'RADIO') {
      const checked = document.querySelector(`input[name="dyn-${f.id}"]:checked`);
      if (!checked) { errEl.textContent = `"${f.label}" is required.`; show('form-error'); return; }
    } else if (f.field_type === 'CHECKBOX') {
      if (!el?.checked) { errEl.textContent = `"${f.label}" must be checked.`; show('form-error'); return; }
    } else if (!el?.value.trim()) {
      errEl.textContent = `"${f.label}" is required.`; show('form-error'); return;
    }
  }

  const btn = document.getElementById('btn-submit');
  btn.disabled = true;
  btn.textContent = 'Submitting…';

  const formData = {
    full_name: fullName,
    date_of_birth: dob,
    nationality,
    email,
    phone,
    gender:           document.getElementById('f-gender').value || null,
    address:          document.getElementById('f-address').value.trim() || null,
    position_applied: position,
    years_experience: parseInt(document.getElementById('f-exp').value) || null,
    previous_employer:document.getElementById('f-employer').value.trim() || null,
    skills:           document.getElementById('f-skills').value.trim() || null,
    emergency_contact_name: document.getElementById('f-ec-name').value.trim() || null,
    emergency_contact_relationship: document.getElementById('f-ec-rel').value.trim() || null,
    emergency_contact_phone: document.getElementById('f-ec-phone').value.trim() || null,
    dynamic_fields: collectDynamicValues(),
  };

  const payload = {
    formId:   activeFormId,
    pipeline: selectedPipeline,
    data:     formData,
  };

  try {
    const res = await fetch(`${API}/public/submissions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await res.json();

    if (!res.ok) {
      errEl.textContent = data.error || 'Submission failed. Please try again.';
      show('form-error');
      btn.disabled = false;
      btn.textContent = 'Submit Application';
      return;
    }

    // Show success
    document.getElementById('ref-number').textContent = data.referenceId || data.submissionId || '—';
    hide('view-form');
    show('view-success');
    window.scrollTo({ top: 0, behavior: 'smooth' });

  } catch (e) {
    errEl.textContent = 'Network error. Please check your connection and try again.';
    show('form-error');
    btn.disabled = false;
    btn.textContent = 'Submit Application';
  }
}

// ── Reset ─────────────────────────────────────────────────────────────────────

function resetForm() {
  selectedPipeline = null;
  dynamicFields    = [];
  activeFormId     = null;

  document.querySelectorAll('.pipeline-card').forEach(c => c.classList.remove('selected'));
  ['f-name','f-dob','f-nationality','f-email','f-phone','f-position','f-exp',
   'f-employer','f-skills','f-address','f-ec-name','f-ec-rel','f-ec-phone'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  document.getElementById('f-gender').value = '';
  document.getElementById('f-consent').checked = false;
  document.getElementById('dynamic-fields-wrap').style.display = 'none';
  document.getElementById('dynamic-fields').innerHTML = '';
  hide('form-error');

  const btn = document.getElementById('btn-submit');
  btn.disabled = false;
  btn.textContent = 'Submit Application';

  hide('view-success');
  show('view-form');
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
