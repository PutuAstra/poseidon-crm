'use strict';

const API = 'https://poseidon-api.putuastrawijaya.workers.dev/api/v1';

let TOKEN    = null;
let SLOTS    = [];
let SELECTED = null;
let INTERVIEW = null;

// ── Utilities ─────────────────────────────────────────────────────────────────

function esc(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
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

function fmtSlotDateTime(iso) {
  const d = new Date(iso);
  return d.toLocaleString('en-US', {
    weekday:'long', year:'numeric', month:'long', day:'numeric',
    hour:'numeric', minute:'2-digit', hour12:true,
    timeZoneName:'short'
  });
}
function fmtSlotDate(iso) {
  return new Date(iso).toLocaleDateString('en-US', { weekday:'long', year:'numeric', month:'long', day:'numeric' });
}
function fmtSlotTime(iso) {
  return new Date(iso).toLocaleTimeString('en-US', { hour:'numeric', minute:'2-digit', hour12:true });
}

// ── Load booking data ─────────────────────────────────────────────────────────

async function loadBooking() {
  const params = new URLSearchParams(location.search);
  TOKEN = params.get('t');

  if (!TOKEN) {
    showError('No booking token found in the URL. Please use the link from your email.');
    return;
  }

  let data;
  try {
    const res = await fetch(`${API}/booking/${encodeURIComponent(TOKEN)}`);
    data = await res.json();
    if (!res.ok) {
      showError(data.error || 'This booking link is invalid or has expired.');
      return;
    }
  } catch (e) {
    showError('Network error. Please check your connection and try again.');
    return;
  }

  INTERVIEW = data.interview;
  SLOTS     = data.availableSlots || [];
  const candidate = data.candidate;

  // Populate header
  document.getElementById('interview-title').textContent = INTERVIEW?.title || 'Schedule Your Interview';
  if (INTERVIEW?.description) {
    document.getElementById('interview-desc').textContent = INTERVIEW.description;
  }

  // Candidate banner
  if (candidate) {
    const name = [candidate.first_name, candidate.last_name].filter(Boolean).join(' ');
    document.getElementById('candidate-name').textContent = name || 'Candidate';
    const pipeMap = { SEA_BASED:'Sea-Based', LAND_BASED:'Land-Based', J1_PROGRAM:'J1 Visa Program' };
    document.getElementById('candidate-position').textContent = pipeMap[candidate.pipeline] || candidate.pipeline || '';
    show('candidate-banner');
  }

  // Booking config
  const cfg = INTERVIEW?.booking_config ? JSON.parse(INTERVIEW.booking_config) : {};
  if (cfg.location || cfg.meetingUrl) {
    document.getElementById('confirm-location').textContent = cfg.meetingUrl || cfg.location;
    document.getElementById('interview-location').style.display = 'block';
  }

  renderSlots();
  hide('view-loading');
  show('view-booking');
}

// ── Render slots ──────────────────────────────────────────────────────────────

function renderSlots() {
  const container = document.getElementById('slots-container');
  if (!SLOTS.length) {
    container.innerHTML = '';
    show('no-slots');
    return;
  }
  hide('no-slots');

  // Group by date
  const groups = {};
  SLOTS.forEach(s => {
    const dateKey = fmtSlotDate(s.start_time);
    if (!groups[dateKey]) groups[dateKey] = [];
    groups[dateKey].push(s);
  });

  container.innerHTML = Object.entries(groups).map(([date, slots]) => `
    <div class="day-group">
      <div class="day-label">${esc(date)}</div>
      <div class="slot-grid">
        ${slots.map(s => `
          <div class="slot-btn" data-id="${esc(s.id)}" data-start="${esc(s.start_time)}" data-end="${esc(s.end_time)}"
            onclick="selectSlot(this,'${esc(s.id)}','${esc(s.start_time)}')">
            <div class="slot-time">${esc(fmtSlotTime(s.start_time))}</div>
            <div class="slot-date">${esc(fmtSlotTime(s.end_time))}</div>
          </div>
        `).join('')}
      </div>
    </div>
  `).join('');
}

function selectSlot(el, slotId, startTime) {
  document.querySelectorAll('.slot-btn').forEach(b => b.classList.remove('selected'));
  el.classList.add('selected');
  SELECTED = { slotId, startTime };
  document.getElementById('confirm-time').textContent = fmtSlotDateTime(startTime);
  show('confirm-box');
  document.getElementById('confirm-box').scrollIntoView({ behavior:'smooth', block:'nearest' });
}

function clearSelection() {
  SELECTED = null;
  document.querySelectorAll('.slot-btn').forEach(b => b.classList.remove('selected'));
  hide('confirm-box');
}

// ── Confirm ───────────────────────────────────────────────────────────────────

async function confirmBooking() {
  if (!SELECTED) return;
  const errEl = document.getElementById('confirm-error');
  hide('confirm-error');
  const btn = document.getElementById('btn-confirm');
  btn.disabled = true;
  btn.textContent = 'Confirming…';

  try {
    const res = await fetch(`${API}/booking/${encodeURIComponent(TOKEN)}/confirm`, {
      method:'POST',
      headers:{ 'Content-Type':'application/json' },
      body: JSON.stringify({
        slotId: SELECTED.slotId,
        notes: document.getElementById('booking-notes').value.trim() || undefined
      })
    });
    const data = await res.json();
    if (!res.ok) {
      errEl.textContent = data.error || 'Booking failed. The slot may no longer be available.';
      show('confirm-error');
      btn.disabled = false;
      btn.textContent = 'Confirm Booking';
      // Refresh slots if conflict
      if (res.status === 409) reloadSlots();
      return;
    }
    // Success
    document.getElementById('success-title').textContent  = INTERVIEW?.title || 'Interview';
    document.getElementById('success-time').textContent   = fmtSlotDateTime(SELECTED.startTime);
    const cfg = INTERVIEW?.booking_config ? JSON.parse(INTERVIEW.booking_config) : {};
    const loc = cfg.meetingUrl || cfg.location;
    if (loc) document.getElementById('success-location').textContent = loc;
    hide('view-booking');
    show('view-success');
    window.scrollTo({ top:0, behavior:'smooth' });
  } catch (e) {
    errEl.textContent = 'Network error. Please try again.';
    show('confirm-error');
    btn.disabled = false;
    btn.textContent = 'Confirm Booking';
  }
}

async function reloadSlots() {
  try {
    const res = await fetch(`${API}/booking/${encodeURIComponent(TOKEN)}`);
    if (res.ok) {
      const data = await res.json();
      SLOTS = data.availableSlots || [];
      clearSelection();
      renderSlots();
      toast('Slots refreshed — that slot was just taken. Please select another.', 'warning');
    }
  } catch (e) {}
}

// ── Error ─────────────────────────────────────────────────────────────────────

function showError(msg) {
  document.getElementById('error-msg').textContent = msg;
  hide('view-loading');
  show('view-error');
}

// ── Init ──────────────────────────────────────────────────────────────────────

loadBooking();
