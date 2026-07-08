// POSEIDON CRM — Admin Panel JS
// v1.0.0 — 2025-05-25

const API = 'https://poseidon-api.putuastrawijaya.workers.dev/api/v1';

const CERT_TYPES = [
  // Identity
  { type:'PASSPORT',       label:'Passport',                         hasIssuedNation:true, hasIssuedPlace:true },
  { type:'SEAMAN_BOOK',    label:'Seaman Book' },
  { type:'MEDICAL',        label:'Medical Certificate' },
  // STCW
  { type:'BST',            label:'Basic Safety Training (BST)' },
  { type:'PSCRB',          label:'Proficiency in Survival Craft (PSCRB)' },
  { type:'ATV',            label:'Advanced Training (ATV)',            hasAppointment:true },
  { type:'BID',            label:'BID',                               noNumber:true },
  { type:'CRISIS_MGT',     label:'Crisis Management' },
  { type:'CROWD_MGT',      label:'Crowd Management' },
  { type:'ETR',            label:'Elementary Training (ETR)' },
  { type:'SAT',            label:'SAT Certificate' },
  { type:'SDB',            label:'SDB',                               noNumber:true },
  { type:'COC_COE',        label:'COC/COE' },
  { type:'IGF_BASIC_COP',  label:'IGF Basic CoP (V/3-1)' },
  { type:'RATING_II4',     label:'Rating Forming II/4' },
  { type:'RATING_II5',     label:'Rating Forming II/5' },
  { type:'RATING_III4',    label:'Rating Forming III/4' },
  { type:'PROF_CERT_1',    label:'Proficiency Certificate 1' },
  { type:'PROF_CERT_2',    label:'Proficiency Certificate 2' },
  { type:'MCV',            label:'MCV Certificate',                   hasExtraNumber:true },
  { type:'WELDER_CERT',    label:'Welder Certificate' },
  { type:'WHITE_STAR',     label:'White Star Training',               noNumber:true },
  // Visas
  { type:'C1_VISA',        label:'C1 Visa' },
  { type:'C1D_VISA',       label:'C1/D Visa',                        hasAppointment:true, hasCost:true },
  { type:'D_VISA',         label:'D Visa' },
  { type:'SCHENGEN',       label:'Schengen Visa',                     hasCost:true },
  { type:'SPAIN_SCHENGEN', label:'Spain Schengen Visa',               hasCost:true },
  { type:'CANADIAN_VISA',  label:'Canadian Visa',                     hasCost:true },
  { type:'NZETA_VISA',     label:'NZeTA Visa' },
  { type:'OTHER_VISA',     label:'Other Visa',                        hasCustomName:true, hasAppointment:true, hasCost:true },
];

const CERT_ID_TYPES    = ['PASSPORT','SEAMAN_BOOK','MEDICAL'];
const CERT_STCW_TYPES  = ['BST','PSCRB','ATV','BID','CRISIS_MGT','CROWD_MGT','ETR','SAT','SDB','COC_COE','IGF_BASIC_COP','RATING_II4','RATING_II5','RATING_III4','PROF_CERT_1','PROF_CERT_2','MCV','WELDER_CERT','WHITE_STAR'];
const CERT_VISA_TYPES  = ['C1_VISA','C1D_VISA','D_VISA','SCHENGEN','SPAIN_SCHENGEN','CANADIAN_VISA','NZETA_VISA','OTHER_VISA'];

const SEAFARER_FIELD_REGISTRY = [
  // Personal
  { key:'salutation',                    label:'Salutation',              type:'select',   section:'personal',    source:'sp', options:['Mr.','Ms.','Mrs.','Dr.','Capt.'] },
  { key:'date_of_birth',                 label:'Date of Birth',           type:'date',     section:'personal',    source:'sp' },
  { key:'place_of_birth',                label:'Place of Birth',          type:'text',     section:'personal',    source:'sp' },
  { key:'nationality',                   label:'Nationality',             type:'text',     section:'personal',    source:'c'  },
  { key:'height',                        label:'Height (cm)',             type:'number',   section:'personal',    source:'sp' },
  { key:'weight',                        label:'Weight (kg)',             type:'number',   section:'personal',    source:'sp' },
  { key:'eye_color',                     label:'Eye Color',               type:'select',   section:'personal',    source:'sp', options:['Brown','Black','Blue','Green','Hazel','Gray'] },
  { key:'hair_color',                    label:'Hair Color',              type:'select',   section:'personal',    source:'sp', options:['Black','Brown','Blonde','Gray','White','Red'] },
  // Onboarding
  { key:'position_hired',                label:'Position Hired',          type:'text',     section:'onboarding',  source:'sp' },
  { key:'department',                    label:'Department',              type:'text',     section:'onboarding',  source:'sp' },
  { key:'cruise_line',                   label:'Cruise Line',             type:'text',     section:'onboarding',  source:'sp' },
  { key:'joining_ship',                  label:'Joining Ship',            type:'text',     section:'onboarding',  source:'sp' },
  { key:'sign_on_date',                  label:'Sign-On Date',            type:'date',     section:'onboarding',  source:'sp' },
  { key:'sign_off_date',                 label:'Sign-Off Date',           type:'date',     section:'onboarding',  source:'sp' },
  { key:'sign_on_port',                  label:'Sign-On Port',            type:'text',     section:'onboarding',  source:'sp' },
  { key:'gateway_airport',               label:'Gateway Airport',         type:'text',     section:'onboarding',  source:'sp' },
  { key:'seafarers_status',              label:'Seafarer Status',         type:'select',   section:'onboarding',  source:'c',  options:['Active','Available','On Leave','Resigned','Terminated'] },
  { key:'onboarding_status',             label:'Onboarding Status',       type:'select',   section:'onboarding',  source:'c',  options:['Pending','Processing','Complete','On Hold','Cancelled'] },
  { key:'rescheduled_sign_on_date',      label:'Rescheduled Sign-On',     type:'date',     section:'onboarding',  source:'sp' },
  { key:'rescheduled_reasons',           label:'Rescheduled Reason',      type:'text',     section:'onboarding',  source:'sp' },
  { key:'change_joining_ship_1',         label:'New Ship 1',              type:'text',     section:'onboarding',  source:'sp' },
  { key:'change_joining_port_1',         label:'New Port 1',              type:'text',     section:'onboarding',  source:'sp' },
  { key:'change_sign_on_date_1',         label:'New Sign-On 1',           type:'date',     section:'onboarding',  source:'sp' },
  { key:'change_sign_off_date_1',        label:'New Sign-Off 1',          type:'date',     section:'onboarding',  source:'sp' },
  { key:'change_joining_ship_2',         label:'New Ship 2',              type:'text',     section:'onboarding',  source:'sp' },
  { key:'change_joining_port_2',         label:'New Port 2',              type:'text',     section:'onboarding',  source:'sp' },
  { key:'change_sign_on_date_2',         label:'New Sign-On 2',           type:'date',     section:'onboarding',  source:'sp' },
  { key:'change_sign_off_date_2',        label:'New Sign-Off 2',          type:'date',     section:'onboarding',  source:'sp' },
  // Employment
  { key:'current_job_title',             label:'Current Job Title',       type:'text',     section:'employment',  source:'sp' },
  { key:'placement_sector',              label:'Placement Sector',        type:'text',     section:'employment',  source:'sp' },
  { key:'project',                       label:'Project',                 type:'text',     section:'employment',  source:'sp' },
  { key:'contract_number',               label:'Contract No.',            type:'text',     section:'employment',  source:'sp' },
  { key:'hired_date',                    label:'Hired Date',              type:'date',     section:'employment',  source:'sp' },
  { key:'rotation_ready_date',           label:'Rotation Ready',          type:'date',     section:'employment',  source:'sp' },
  { key:'sign_off_reason',               label:'Sign-Off Reason',         type:'select',   section:'employment',  source:'sp', options:['Completed Contract','Resignation','Medical','Family','Terminated','Other'] },
  { key:'sign_off_report_date',          label:'Sign-Off Report',         type:'date',     section:'employment',  source:'sp' },
  { key:'resignation_date',              label:'Resignation Date',        type:'date',     section:'employment',  source:'sp' },
  { key:'resignation_reasons',           label:'Resignation Reason',      type:'text',     section:'employment',  source:'sp' },
  { key:'skill_set',                     label:'Skill Set',               type:'textarea', section:'employment',  source:'sp' },
  { key:'go_video_link',                 label:'Go Video Link',           type:'url',      section:'employment',  source:'sp' },
  { key:'temporary_id',                  label:'Temporary ID',            type:'text',     section:'employment',  source:'sp' },
  { key:'crew_id_2',                     label:'Crew ID 2',               type:'text',     section:'employment',  source:'sp' },
  { key:'previous_office',               label:'Previous Office',         type:'text',     section:'employment',  source:'sp' },
  { key:'additional_info',               label:'Additional Info',         type:'textarea', section:'employment',  source:'sp' },
  { key:'comment_result',                label:'Comment Result',          type:'textarea', section:'employment',  source:'sp' },
  // Marlins
  { key:'marlins_code',                  label:'Code',                    type:'text',     section:'marlins',     source:'sp' },
  { key:'marlins_score',                 label:'Score',                   type:'number',   section:'marlins',     source:'sp' },
  { key:'marlins_test_result',           label:'Result',                  type:'select',   section:'marlins',     source:'sp', options:['Pass','Fail','Pending'] },
  { key:'marlins_test_duration',         label:'Duration',                type:'text',     section:'marlins',     source:'sp' },
  // Compliance
  { key:'mistral_status',                label:'Mistral Status',          type:'select',   section:'compliance',  source:'sp', options:['Active','Pending','Expired','Not Required'] },
  { key:'oktb_status',                   label:'OKTB Status',             type:'select',   section:'compliance',  source:'sp', options:['OK to Board','Pending','Rejected','Not Required'] },
  { key:'completed_vaccination',         label:'Vaccination',             type:'text',     section:'compliance',  source:'sp' },
  { key:'date_mmr1_completed',           label:'MMR1 Completed',          type:'date',     section:'compliance',  source:'sp' },
  { key:'crew_compliance_audit_call',    label:'Compliance Audit Call',   type:'date',     section:'compliance',  source:'sp' },
  { key:'compliance_notes',              label:'Compliance Notes',        type:'textarea', section:'compliance',  source:'sp' },
  // Banking
  { key:'bank_name',                     label:'Bank Name',               type:'select',   section:'banking',     source:'sp', options:['BCA','BNI','BRI','Mandiri','CIMB Niaga','Danamon','Other'] },
  { key:'bank_account_number',           label:'Account Number',          type:'text',     section:'banking',     source:'sp' },
  // Costs
  { key:'medical_cost',                  label:'Medical',                 type:'currency', section:'costs',       source:'sp' },
  { key:'meal_allowance_cost',           label:'Meal Allowance',          type:'currency', section:'costs',       source:'sp' },
  { key:'rt_pcr_cost',                   label:'RT-PCR',                  type:'currency', section:'costs',       source:'sp' },
  { key:'vaccination_cost',              label:'Vaccination Cost',        type:'currency', section:'costs',       source:'sp' },
  { key:'reimbursement_date',            label:'Reimbursement Date',      type:'date',     section:'costs',       source:'sp' },
  // Emergency
  { key:'emergency_contact_name',        label:'Name',                    type:'text',     section:'emergency',   source:'sp' },
  { key:'emergency_contact_number',      label:'Number',                  type:'text',     section:'emergency',   source:'sp' },
  { key:'emergency_relationship',        label:'Relationship',            type:'select',   section:'emergency',   source:'sp', options:['Parent','Spouse','Sibling','Child','Friend','Other'] },
  { key:'emergency_contact_city',        label:'City',                    type:'text',     section:'emergency',   source:'sp' },
  { key:'emergency_contact_address',     label:'Street Address',          type:'text',     section:'emergency',   source:'sp' },
  // Address
  { key:'address_street',                label:'Street',                  type:'text',     section:'address',     source:'sp' },
  { key:'address_city',                  label:'City',                    type:'text',     section:'address',     source:'sp' },
  { key:'address_province',              label:'Province',                type:'text',     section:'address',     source:'sp' },
  { key:'address_country',               label:'Country',                 type:'text',     section:'address',     source:'sp' },
  { key:'address_postal_code',           label:'Postal Code',             type:'text',     section:'address',     source:'sp' },
];

const DEFAULT_SF_SECTIONS = [
  { id:'personal',    label:'Personal Information'   },
  { id:'onboarding',  label:'Onboarding Information' },
  { id:'employment',  label:'Employment'             },
  { id:'marlins',     label:'Marlins Test'           },
  { id:'compliance',  label:'Compliance'             },
  { id:'banking',     label:'Banking'                },
  { id:'costs',       label:'Costs'                  },
  { id:'emergency',   label:'Emergency Contact'      },
  { id:'address',     label:'Address'                },
];

let _sfCurrentSection = 'personal';

// Pipeline stages a Profile section can opt into. If a section's visibleStages
// array is empty or absent, the section is shown at every stage (back-compat).
const SF_STAGE_CHOICES = [
  { id: 'ONBOARDING',      label: 'Onboarding' },
  { id: 'READY_TO_DEPLOY', label: 'Ready' },
  { id: 'DEPLOYED',        label: 'Deployed' },
  { id: 'ARCHIVED',        label: 'Archived' },
];

// Per-field stage visibility. Each field carries `appearsStages` — an array
// of pipeline stages it shows in. An undefined/empty array means "all stages"
// (back-compat default). ARCHIVED candidates always see every field so
// recruiters reviewing history have the full picture.
const SF_STAGE_ORDER = {
  ONBOARDING: 0, READY_TO_DEPLOY: 1, DEPLOYED: 2, ARCHIVED: 99,
};
// Stages selectable in the per-field chip strip (ARCHIVED excluded — always visible).
const SF_FIELD_STAGES = SF_STAGE_CHOICES.filter(s => s.id !== 'ARCHIVED');
// Ultra-short labels for the per-row chip strip.
const SF_STAGE_SHORT = {
  ONBOARDING: 'Onb', READY_TO_DEPLOY: 'Ready', DEPLOYED: 'Dep',
};

// Resolve the effective array of stages for a field, migrating legacy values
// (single-stage `appearsAt` strings) into cumulative arrays on the fly.
function _sfFieldEffectiveStages(field) {
  if (Array.isArray(field.appearsStages)) return field.appearsStages;
  if (field.appearsAt) {
    const start = SF_STAGE_ORDER[field.appearsAt];
    if (start !== undefined) return SF_FIELD_STAGES.filter(s => SF_STAGE_ORDER[s.id] >= start).map(s => s.id);
  }
  return null; // null = "all stages" default
}

function _sfFieldVisibleAt(field, status) {
  if (!field) return false;
  if (status === 'ARCHIVED') return true;
  const stages = _sfFieldEffectiveStages(field);
  if (!stages || stages.length === 0) return true;
  return stages.includes(status);
}

function getMergedSfConfig() {
  const saved = STATE.sfFieldConfig || {};
  const fields = SEAFARER_FIELD_REGISTRY.map((r, i) => ({
    key: r.key, label: r.label, type: r.type, section: r.section, source: r.source,
    order: i, visible: true, showInOverview: true,
    appearsStages: null,   // null = visible at all stages (default)
    options: r.options ? [...r.options] : undefined,
  }));
  if (saved.fields) {
    saved.fields.forEach(sf => {
      const f = fields.find(x => x.key === sf.key);
      if (f) {
        if (sf.label          !== undefined) f.label          = sf.label;
        if (sf.section        !== undefined) f.section        = sf.section;
        if (sf.order          !== undefined) f.order          = sf.order;
        if (sf.visible        !== undefined) f.visible        = sf.visible;
        if (sf.showInOverview !== undefined) f.showInOverview = sf.showInOverview;
        if (sf.options        !== undefined) f.options        = sf.options;
        // Migration: prefer new appearsStages array; convert legacy appearsAt string
        if (Array.isArray(sf.appearsStages)) f.appearsStages = sf.appearsStages;
        else if (sf.appearsAt) f.appearsStages = _sfFieldEffectiveStages({ appearsAt: sf.appearsAt });
      } else if (sf.custom) {
        fields.push({
          key: sf.key, label: sf.label, type: sf.type || 'text',
          section: sf.section, source: 'custom', order: sf.order ?? 999,
          visible: sf.visible !== false,
          showInOverview: sf.showInOverview !== false,
          appearsStages: Array.isArray(sf.appearsStages) ? sf.appearsStages
                       : (sf.appearsAt ? _sfFieldEffectiveStages({ appearsAt: sf.appearsAt }) : null),
          options: sf.options ? [...sf.options] : undefined,
          custom: true
        });
      }
    });
  }
  const sectionOrder = {};
  (saved.sections || DEFAULT_SF_SECTIONS).forEach((s, i) => { sectionOrder[s.id] = i; });
  fields.sort((a, b) => {
    const sA = sectionOrder[a.section] ?? 999, sB = sectionOrder[b.section] ?? 999;
    if (sA !== sB) return sA - sB;
    return a.order - b.order;
  });
  return { sections: saved.sections || DEFAULT_SF_SECTIONS, fields };
}

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
  recruiters: [],
  sfFieldConfig: undefined,
  newSubPage: 1,
  fiPage: 1,
  olPage: 1,
  onbPage: 1,
  arcPage: 1,
  newSubPipeline: '',
  fiPipeline: '',
  onbPipeline: '',
  arcPipeline: '',
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
  STATE = { accessToken: null, refreshToken: null, user: null, currentView: null, candidatePage: 1, submissionPage: 1, activePipeline: '', currentCandidate: null, clients: [], recruiters: [], sfFieldConfig: undefined, newSubPage: 1, fiPage: 1, olPage: 1, onbPage: 1, arcPage: 1, newSubPipeline: '', fiPipeline: '', onbPipeline: '', arcPipeline: '' };
  localStorage.removeItem('poseidon_rt');
  document.getElementById('view-app').classList.add('hidden');
  document.getElementById('view-login').style.display = '';
}

function bootApp() {
  document.getElementById('view-login').style.display = 'none';
  document.getElementById('view-app').classList.remove('hidden');
  const u = STATE.user;
  document.getElementById('user-name').textContent = `${u.firstName} ${u.lastName}`;
  document.getElementById('user-role').textContent = u.role.replace(/_/g, ' ');
  document.getElementById('user-avatar').textContent = (u.firstName[0] + u.lastName[0]).toUpperCase();
  // Role-based visibility is now handled inside openProgSwitcher() popup rendering
  loadClientsList();
  loadRecruitersList();
  const savedView = localStorage.getItem('poseidon_view') || 'dashboard';
  // Determine default program and pre-render sidebar stages
  let defaultProg = 'J1_PROGRAM';
  if (savedView.includes(':')) {
    const [p] = savedView.split(':');
    if (PIPELINE_STAGES[p]) defaultProg = p;
  }
  _navProgram = defaultProg;
  _renderSidebarStages(defaultProg);
  _initWorkspaceDrawer();
  // Restore navigation state
  if (savedView.includes(':')) {
    const [prog, sub] = savedView.split(':');
    if (PIPELINE_STAGES[prog]) {
      setTimeout(() => {
        if (sub === 'overview')                           showOverview(prog);
        else if (['local','fields','docs'].includes(sub)) showTool(prog, sub);
        else                                              showStage(prog, sub);
      }, 0);
    } else { showGeneralView('dashboard'); }
  } else {
    showGeneralView(VIEW_META[savedView] ? savedView : 'dashboard');
  }
  pollNotifications();
}

// ── Pipeline Stage Definitions ────────────────────────────────────────────────

// Pure CRM (v8): candidates only ever arrive via ZeusHire's "Hired" push, so
// every pre-hire stage (New Submission, Candidates, Final Interview, Offer
// Letter, and J1's Consultation/Stage 1-4/Visa) is gone — that's ZeusHire's
// pipeline now. Poseidon starts at Onboarding.
const PIPELINE_STAGES = {
  J1_PROGRAM: [
    { id: 'ONBOARDING',        label: 'Onboarding',      icon: '🎓' },
    { id: 'READY_TO_DEPLOY',   label: 'Ready to Go',     icon: '✅' },
    { id: 'DEPLOYMENTS',       label: 'Placements',      icon: '🇺🇸' },
    { id: 'CLIENTS',           label: 'Clients',         icon: '👔' },
    { id: 'ARCHIVED',          label: 'Archived',        icon: '📦' },
  ],
  SEA_BASED: [
    { id: 'ONBOARDING',        label: 'Onboarding',      icon: '⚓' },
    { id: 'READY_TO_DEPLOY',   label: 'Ready to Go',     icon: '✅' },
    { id: 'DEPLOYMENTS',       label: 'Deployments',     icon: '🚢' },
    { id: 'CLIENTS',           label: 'Clients',         icon: '👔' },
    { id: 'ARCHIVED',          label: 'Archived',        icon: '📦' },
  ],
  LAND_BASED: [
    { id: 'ONBOARDING',        label: 'Onboarding',      icon: '🏨' },
    { id: 'READY_TO_DEPLOY',   label: 'Ready to Go',     icon: '✅' },
    { id: 'DEPLOYMENTS',       label: 'Placements',      icon: '🏢' },
    { id: 'CLIENTS',           label: 'Clients',         icon: '👔' },
    { id: 'ARCHIVED',          label: 'Archived',        icon: '📦' },
  ],
};

const PROGRAM_META = {
  J1_PROGRAM: { label: 'J1 Program',  icon: '🎓', badgeClass: 'prog-badge-j1',   color: '#8b5cf6' },
  SEA_BASED:  { label: 'Sea-Based',   icon: '🚢', badgeClass: 'prog-badge-sea',  color: '#38bdf8' },
  LAND_BASED: { label: 'Land-Based',  icon: '🏨', badgeClass: 'prog-badge-land', color: '#22c55e' },
};

const LOCAL_SETTINGS_FIELDS = {
  J1_PROGRAM: [
    { key: 'default_sponsor',        label: 'Default Sponsor Name',              placeholder: 'e.g. CETUSA' },
    { key: 'sevis_fee_amount',        label: 'SEVIS Fee Amount (USD)',             type: 'number', placeholder: '220' },
    { key: 'default_program_months',  label: 'Default Program Duration (months)', type: 'number', placeholder: '12' },
    { key: 'ds2019_reminder_days',    label: 'DS-2019 Expiry Reminder (days)',    type: 'number', placeholder: '30' },
  ],
  SEA_BASED: [
    { key: 'default_vessel_type',             label: 'Default Vessel Type',                placeholder: 'Cruise' },
    { key: 'c1d_appointment_cost',            label: 'C1/D Visa Appointment Cost (USD)',   type: 'number', placeholder: '160' },
    { key: 'medical_validity_months',         label: 'Medical Cert Validity (months)',     type: 'number', placeholder: '24' },
    { key: 'stcw_reminder_days',              label: 'STCW Expiry Reminder (days)',        type: 'number', placeholder: '60' },
    { key: 'onboarding_required_docs',        label: 'Onboarding Required Documents',      placeholder: 'PASSPORT,SEAMAN_BOOK,STCW_BASIC,MEDICAL_CERT,YELLOW_FEVER,C1D_VISA', help: 'Comma-separated doc types required + unexpired before Ready to Go' },
  ],
  LAND_BASED: [
    { key: 'default_contract_type',           label: 'Default Contract Type',              placeholder: 'Fixed-Term' },
    { key: 'visa_reminder_days',              label: 'Visa Expiry Reminder (days)',        type: 'number', placeholder: '45' },
    { key: 'bg_check_provider',               label: 'Background Check Provider',          placeholder: 'Sterling' },
    { key: 'onboarding_required_docs',        label: 'Onboarding Required Documents',      placeholder: 'PASSPORT,WORK_VISA,MEDICAL_CERT,BG_CHECK,EMPLOYMENT_CONTRACT', help: 'Comma-separated doc types required + unexpired before Ready to Go' },
  ],
};

// ── Nav State ─────────────────────────────────────────────────────────────────

let _navProgram = null;   // 'J1_PROGRAM' | 'SEA_BASED' | 'LAND_BASED' | null
let _navStage   = null;   // e.g. 'ONBOARDING' | 'READY_TO_DEPLOY'
let _navTool    = null;   // 'local' | 'fields' | 'docs'
let _stagePanePage = 1;

// ── View router ───────────────────────────────────────────────────────────────

const VIEW_META = {
  dashboard:  { title: 'Dashboard',      action: null },
  clients:    { title: 'Clients',         action: { label: '+ Add Client',    fn: () => openAddClientModal() } },
  compliance: { title: 'Document Filter', action: null },
  users:      { title: 'Users',           action: null },
  settings:   { title: 'Settings',        action: null },
};

function _showPane(name) {
  document.querySelectorAll('.pane').forEach(p => p.classList.add('hidden'));
  document.getElementById(`pane-${name}`)?.classList.remove('hidden');
}

// ── Sidebar active state ─────────────────────────────────────────────────────

function _renderSidebarActive() {
  // Clear general nav active
  document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
  // Clear stage/tool active
  document.querySelectorAll('#sidebar-stages .sidebar-stage-item, #sidebar-tools .sidebar-stage-item')
    .forEach(el => el.classList.remove('active'));
}

function _markSidebarActive(kind, id) {
  document.querySelectorAll('#sidebar-stages .sidebar-stage-item, #sidebar-tools .sidebar-stage-item')
    .forEach(el => el.classList.remove('active'));
  if (kind === 'overview') {
    document.querySelector('#sidebar-stages .sidebar-stage-item[data-overview]')?.classList.add('active');
  } else if (kind === 'stage') {
    document.querySelector(`#sidebar-stages .sidebar-stage-item[data-stage="${id}"]`)?.classList.add('active');
  } else {
    document.querySelector(`#sidebar-tools .sidebar-stage-item[data-tool="${id}"]`)?.classList.add('active');
  }
}

// ── Per-workspace state cache (preserves last active stage/tool per workspace) ──
const _workspaceCache = {};

// ── Workspace switcher popup ──────────────────────────────────────────────────

function openProgSwitcher() {
  const panel    = document.getElementById('prog-sub-panel');
  const u        = STATE.user;
  const isAdmin  = ['SUPER_ADMIN', 'ADMIN'].includes(u?.role);

  // Brand header is static in HTML (permanent) — only the body is rendered here.
  // Two-section body
  document.getElementById('prog-sub-body').innerHTML = `
    <div class="popup-section-label">Workspace</div>

    ${Object.entries(PROGRAM_META).map(([key, pm]) => `
      <div class="prog-popup-item${_navProgram === key ? ' active' : ''}" data-prog="${key}" onclick="switchProgram('${key}')">
        <span style="font-size:17px;line-height:1;flex-shrink:0">${pm.icon}</span>
        <span>${pm.label}</span>
        ${_navProgram === key
          ? `<svg style="width:11px;height:11px;margin-left:auto;flex-shrink:0;opacity:.9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>`
          : ''}
      </div>`).join('')}

    <div class="popup-section-label" style="margin-top:6px">General</div>

    <div class="popup-general-item" data-view="dashboard" onclick="showGeneralView('dashboard')">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>
      <span>Dashboard</span>
    </div>
    <div class="popup-general-item popup-parent open" onclick="_togglePopupGroup(this)">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
      <span>Settings</span>
      <svg class="popup-caret" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="margin-left:auto"><polyline points="9 18 15 12 9 6"/></svg>
    </div>
    <div class="popup-children open">
      ${isAdmin ? `
      <div class="popup-general-item popup-child" data-view="users" onclick="showGeneralView('users')">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
        <span>Users</span>
      </div>` : ''}
    </div>`;

  panel.classList.add('open');
}

function closeProgSwitcher() {
  _drawerPinned = false;
  document.body.classList.remove('drawer-pinned');
  document.getElementById('prog-sub-panel').classList.remove('open');
}

// Drawer "pinned" state — kept open while the user is on a General view
// (Dashboard / Interview Setup / Form Builder / Users), since those views use
// the drawer itself as their navigation context.
let _drawerPinned = false;

function showGeneralView(name) {
  _drawerPinned = true;
  document.body.classList.add('drawer-pinned');
  showView(name, true);   // render the pane, but keep the drawer open
  const panel = document.getElementById('prog-sub-panel');
  if (!panel.classList.contains('open')) openProgSwitcher();
  panel.classList.add('open');
  _markDrawerGeneralActive(name);
}

function _markDrawerGeneralActive(name) {
  document.querySelectorAll('#prog-sub-body .popup-general-item').forEach(el => el.classList.remove('active'));
  document.querySelector(`#prog-sub-body .popup-general-item[data-view="${name}"]`)?.classList.add('active');
  // In General mode no workspace is the active context — clear the workspace
  // active highlight + its inline checkmark in the drawer.
  document.querySelectorAll('#prog-sub-body .prog-popup-item').forEach(el => {
    el.classList.remove('active');
    el.querySelector('svg')?.remove();
  });
}

// Expand/collapse a nested group (e.g. Settings) in the workspace drawer
function _togglePopupGroup(el) {
  el.classList.toggle('open');
  const kids = el.nextElementSibling;
  if (kids && kids.classList.contains('popup-children')) kids.classList.toggle('open');
}

// Hover-driven edge drawer: reveal when the cursor hits the screen's left edge,
// auto-close (with a small grace delay) when the cursor leaves the panel.
function _initWorkspaceDrawer() {
  const trigger = document.getElementById('edge-trigger');
  const panel   = document.getElementById('prog-sub-panel');
  if (!trigger || !panel || trigger._wired) return;
  trigger._wired = true;
  let openTimer = null, closeTimer = null;
  const clearOpen  = () => { if (openTimer)  { clearTimeout(openTimer);  openTimer  = null; } };
  const clearClose = () => { if (closeTimer) { clearTimeout(closeTimer); closeTimer = null; } };

  // Open only after the cursor DWELLS on the edge (hover-intent) — a quick
  // pass-through near the edge no longer fires it.
  trigger.addEventListener('mouseenter', () => {
    clearClose();
    clearOpen();
    openTimer = setTimeout(openProgSwitcher, 120);
  });
  trigger.addEventListener('mouseleave', clearOpen);   // bailed before dwell → cancel

  // Stay open while over the panel; close on leave with a forgiving delay
  // (skipped entirely when pinned — General views keep the drawer visible).
  panel.addEventListener('mouseenter', () => { clearOpen(); clearClose(); });
  panel.addEventListener('mouseleave', () => {
    clearOpen();
    clearClose();
    if (_drawerPinned) return;
    closeTimer = setTimeout(closeProgSwitcher, 280);
  });
}

function switchProgram(prog) {
  // Save current workspace state before leaving
  if (_navProgram && PIPELINE_STAGES[_navProgram]) {
    _workspaceCache[_navProgram] = { stage: _navStage, tool: _navTool };
  }
  closeProgSwitcher();
  _navProgram = prog;
  _navStage   = null;
  _navTool    = null;
  _renderSidebarStages(prog);
  // Restore last known state for this workspace, or land on the Overview
  const cached = _workspaceCache[prog];
  if (cached?.tool)                      showTool(prog, cached.tool);
  else if (cached?.stage === 'overview') showOverview(prog);
  else if (cached?.stage)                showStage(prog, cached.stage);
  else                                   showOverview(prog);
}

// ── Permanent sidebar stage/tool rendering ────────────────────────────────────

function _renderSidebarStages(prog) {
  const pm     = PROGRAM_META[prog];
  const stages = PIPELINE_STAGES[prog] || [];
  // Update switcher button
  document.getElementById('prog-sw-icon').textContent  = pm.icon;
  document.getElementById('prog-sw-label').textContent = pm.label;
  const btn = document.getElementById('prog-switcher-btn');
  btn.setAttribute('data-prog', prog);
  document.getElementById('sidebar').setAttribute('data-prog', prog);
  // Render Overview (workspace dashboard) + pipeline stages
  const overviewItem = `
    <div class="sidebar-stage-item" data-overview="1" onclick="showOverview('${prog}')">
      <span class="stage-icon-sm">📊</span>
      <span>Overview</span>
    </div>`;
  document.getElementById('sidebar-stages').innerHTML = overviewItem + stages.map(s => `
    <div class="sidebar-stage-item" data-stage="${s.id}" onclick="showStage('${prog}','${s.id}')">
      <span class="stage-icon-sm">${s.icon}</span>
      <span>${s.label}</span>
    </div>`).join('');
  // Render tools (monochrome line icons for a clean, consistent look)
  const ico = svg => `<span class="stage-icon-sm"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${svg}</svg></span>`;
  document.getElementById('sidebar-tools').innerHTML = `
    <div class="sidebar-stage-item" data-tool="local"  onclick="showTool('${prog}','local')">${ico('<line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/>')}<span>Local Settings</span></div>
    <div class="sidebar-stage-item" data-tool="fields" onclick="showTool('${prog}','fields')">${ico('<line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>')}<span>Stage Fields</span></div>
    <div class="sidebar-stage-item" data-tool="docs"   onclick="showTool('${prog}','docs')">${ico('<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>')}<span>Documents</span></div>`;
}

function _ensureProgOpen(prog) { /* no-op */ }

// ── Navigation ────────────────────────────────────────────────────────────────

// PROGRAM key → API workspace token
const PROGRAM_TYPE = { J1_PROGRAM: 'J1', SEA_BASED: 'SEA', LAND_BASED: 'LAND' };

function showOverview(program) {
  _navProgram    = program;
  _navStage      = 'overview';
  _navTool       = null;
  closeProgSwitcher();
  _renderSidebarActive();
  _markSidebarActive('overview');
  _showPane('workspace-overview');
  const pm = PROGRAM_META[program];
  document.getElementById('page-title').textContent = `${pm.icon} ${pm.label} — Overview`;
  document.getElementById('ws-overview-title').textContent = 'Overview';
  document.getElementById('ws-overview-sub').innerHTML =
    `<span class="prog-badge ${pm.badgeClass}">${pm.icon} ${pm.label}</span>`;
  document.getElementById('topbar-action').style.display = 'none';
  STATE.currentView = `${program}:overview`;
  localStorage.setItem('poseidon_view', `${program}:overview`);
  loadWorkspaceOverview(program);
}

async function loadWorkspaceOverview(program) {
  const el = document.getElementById('workspace-overview-content');
  el.innerHTML = '<div class="spinner" style="margin:48px auto"></div>';
  try {
    const d = await api('GET', `/workspaces/${PROGRAM_TYPE[program]}/dashboard`);
    renderWorkspaceOverview(program, d);
  } catch (e) {
    el.innerHTML = `<div class="table-empty">Failed to load overview: ${esc(e.message)}</div>`;
  }
}

function renderWorkspaceOverview(program, d) {
  const el = document.getElementById('workspace-overview-content');
  const pm = PROGRAM_META[program];
  const funnel = d.funnel || {};
  const comp = d.compliance || {};
  const compTotal = (comp.expired || 0) + (comp.expiringSoon || 0);
  const accent = { J1_PROGRAM: 'purple', SEA_BASED: 'blue', LAND_BASED: 'green' }[program];

  const cards = [
    { label: 'Total Candidates',  value: d.total ?? 0,                cls: accent },
    { label: 'Deploy Rate',       value: (d.deployRate ?? 0) + '%',    cls: 'green' },
    { label: 'Pushed (30 days)',  value: d.pushedLast30Days ?? 0,      cls: 'amber' },
    { label: 'Compliance Alerts', value: compTotal,                    cls: compTotal ? 'red' : 'green' },
  ];

  // Only Sea-Based / Land-Based use READY_TO_DEPLOY (J1 tracks onboarding via j1_profiles instead).
  const funnelStages = [
    { key: 'ONBOARDING',      label: 'Onboarding' },
    { key: 'READY_TO_DEPLOY', label: 'Ready to Deploy' },
    { key: 'DEPLOYED',        label: 'Deployed' },
  ];
  const maxVal = Math.max(1, ...funnelStages.map(s => funnel[s.key] || 0));

  el.innerHTML = `
    <div class="stat-grid">
      ${cards.map(c => `
        <div class="stat-card ${c.cls}">
          <div class="stat-value">${c.value}</div>
          <div class="stat-label">${c.label}</div>
        </div>`).join('')}
    </div>

    <div class="card" style="margin-top:20px">
      <div class="card-header"><span class="card-title">Onboarding Funnel</span></div>
      <div style="padding:8px 20px 18px">
        ${funnelStages.map(s => {
          const v = funnel[s.key] || 0;
          const pct = Math.round((v / maxVal) * 100);
          return `
          <div style="display:flex;align-items:center;gap:12px;padding:7px 0">
            <div style="width:140px;font-size:.78rem;color:var(--text-muted);flex-shrink:0">${s.label}</div>
            <div style="flex:1;background:var(--navy-mid);border-radius:4px;height:10px;overflow:hidden">
              <div style="height:100%;width:${pct}%;background:${pm.color};border-radius:4px;transition:width .4s"></div>
            </div>
            <div style="width:40px;text-align:right;font-weight:600">${v}</div>
          </div>`;
        }).join('')}
      </div>
    </div>

    <div class="card" style="margin-top:20px">
      <div class="card-header"><span class="card-title">Document Compliance</span></div>
      <div class="stat-grid" style="padding:16px 20px">
        <div class="stat-card red"><div class="stat-value">${comp.expired || 0}</div><div class="stat-label">Expired</div></div>
        <div class="stat-card amber"><div class="stat-value">${comp.expiringSoon || 0}</div><div class="stat-label">Expiring ≤ 30 days</div></div>
      </div>
    </div>`;
}

function showStage(program, stage) {
  _navProgram    = program;
  _navStage      = stage;
  _navTool       = null;
  _stagePanePage = 1;
  closeProgSwitcher();
  _renderSidebarActive();
  _markSidebarActive('stage', stage);
  _showPane('stage');
  const pm = PROGRAM_META[program];
  const sm = PIPELINE_STAGES[program]?.find(s => s.id === stage);
  document.getElementById('page-title').textContent = `${pm.icon} ${pm.label} — ${sm?.label || stage}`;
  document.getElementById('topbar-action').style.display = 'none';
  STATE.currentView = `${program}:${stage}`;
  localStorage.setItem('poseidon_view', `${program}:${stage}`);
  loadStagePane();
}

function showTool(program, tool) {
  _navProgram = program;
  _navStage   = null;
  _navTool    = tool;
  closeProgSwitcher();
  _renderSidebarActive();
  _markSidebarActive('tool', tool);
  const paneMap = { local: 'prog-local', fields: 'prog-fields', docs: 'prog-docs' };
  _showPane(paneMap[tool]);
  const pm = PROGRAM_META[program];
  const toolLabel = { local: 'Local Settings', fields: 'Stage Fields', docs: 'Documents' }[tool];
  document.getElementById('page-title').textContent = `${pm.icon} ${pm.label} — ${toolLabel}`;
  document.getElementById('topbar-action').style.display = 'none';
  STATE.currentView = `${program}:${tool}`;
  localStorage.setItem('poseidon_view', `${program}:${tool}`);
  if (tool === 'local')  loadLocalSettings();
  if (tool === 'fields') loadStageFields();
  if (tool === 'docs')   loadProgDocs();
}

function showView(name, keepDrawer = false) {
  // Keep _navProgram — sidebar stages stay visible for last active workspace
  _navStage = null;
  _navTool  = null;
  if (!keepDrawer) closeProgSwitcher();
  _renderSidebarActive();
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.querySelector(`[data-view="${name}"]`)?.classList.add('active');
  _showPane(name);
  const meta = VIEW_META[name];
  document.getElementById('page-title').textContent = meta?.title || name;
  const btn = document.getElementById('topbar-action');
  if (meta?.action) { btn.style.display = ''; btn.textContent = meta.action.label; btn.onclick = meta.action.fn || null; }
  else { btn.style.display = 'none'; }
  STATE.currentView = name;
  localStorage.setItem('poseidon_view', name);
  if (name === 'dashboard')  loadDashboard();
  if (name === 'clients')    loadClients();
  if (name === 'compliance') { /* loadCompliance called by comp filter button */ }
  if (name === 'users')      loadUsers();
  if (name === 'settings')   loadSettings();
}

// ── Stage Pane (generic per-program stage view) ───────────────────────────────

async function loadStagePane() {
  const prog = _navProgram, stage = _navStage;
  if (!prog || !stage) return;
  const pm = PROGRAM_META[prog];
  const sm = PIPELINE_STAGES[prog]?.find(s => s.id === stage);

  document.getElementById('stage-pane-title').textContent = sm?.label || stage;
  document.getElementById('stage-pane-sub').innerHTML =
    `<span class="prog-badge ${pm.badgeClass}">${pm.icon} ${pm.label}</span>`;

  // DEPLOYMENTS is a separate ledger, not a candidate-status filter.
  if (stage === 'DEPLOYMENTS') return loadDeploymentsLedger(prog);

  const search    = document.getElementById('stage-pane-search')?.value || '';
  const recruiter = document.getElementById('stage-pane-recruiter')?.value || '';
  const tbody = document.getElementById('stage-pane-tbody');
  const thead = document.getElementById('stage-pane-thead');
  tbody.innerHTML = `<tr><td colspan="5" class="table-empty"><span class="spinner"></span></td></tr>`;

  // Build column headers contextually
  thead.innerHTML = getStagePaneHeaders(prog, stage);

  try {
    const params = new URLSearchParams({ pipeline: prog, status: stage, page: _stagePanePage, limit: 25 });
    if (search) params.set('search', search);
    if (recruiter) params.set('recruiterId', recruiter);
    const d = await api('GET', `/candidates?${params}`);
    const rows = d.candidates || [];
    tbody.innerHTML = rows.map(c => getStagePaneRow(c, prog, stage)).join('')
      || `<tr><td colspan="5" class="table-empty">No candidates in ${sm?.label || stage}</td></tr>`;
    renderPagination('stage-pane-pagination', d.total, d.limit || 25, d.page || _stagePanePage,
      p => { _stagePanePage = p; loadStagePane(); });
  } catch (e) { toast(e.message, 'error'); }
}

// Deployments ledger pane: rows from the deployments table, NOT a candidate-status
// filter. The master profile stays in the candidates table at status='DEPLOYED'.
async function loadDeploymentsLedger(prog) {
  const isLand = prog === 'LAND_BASED';
  const colVessel = isLand ? 'Work Location' : 'Vessel';
  const colDate   = isLand ? 'Start Date'    : 'Sign-On';
  const thead = document.getElementById('stage-pane-thead');
  const tbody = document.getElementById('stage-pane-tbody');
  thead.innerHTML = `<th>Candidate</th><th>Client</th><th>${colVessel}</th><th>${colDate}</th><th>Duration</th><th>Status</th><th></th>`;
  tbody.innerHTML = `<tr><td colspan="7" class="table-empty"><span class="spinner"></span></td></tr>`;
  document.getElementById('stage-pane-pagination').innerHTML = '';

  const search = document.getElementById('stage-pane-search')?.value?.trim() || '';
  const params = new URLSearchParams({ limit: 50, pipeline: prog });
  if (search) params.set('search', search);

  try {
    const d = await api('GET', `/sea/deployments?${params}`);
    const rows = d.deployments || [];
    if (!rows.length) {
      tbody.innerHTML = `<tr><td colspan="7" class="table-empty">No deployments yet</td></tr>`;
      return;
    }
    const badge = st => {
      const cls = st === 'ACTIVE' ? 'badge-deployed'
                : st === 'COMPLETED' ? 'badge-approved'
                : 'badge-new';
      return `<span class="badge ${cls}">${st}</span>`;
    };
    tbody.innerHTML = rows.map(r => `
      <tr onclick="openDetail('${esc(r.candidate_id)}')" style="cursor:pointer">
        <td><div style="font-weight:600">${esc(r.candidate_full_name)}</div></td>
        <td class="text-muted">${esc(r.client_name)}</td>
        <td>${esc(r.vessel_name)}</td>
        <td class="text-muted">${r.sign_on_date ? new Date(r.sign_on_date).toLocaleDateString() : '—'}</td>
        <td class="text-muted">${r.contract_duration_months}m</td>
        <td>${badge(r.status)}</td>
        <td style="text-align:right">
          ${r.status === 'ACTIVE'
            ? `<button class="btn btn-ghost btn-sm" onclick="event.stopPropagation();closeSeaDeployment('${esc(r.id)}')">⚓ Close</button>`
            : `<span class="text-muted text-sm">${r.sign_off_date ? new Date(r.sign_off_date).toLocaleDateString() : ''}</span>`}
        </td>
      </tr>`).join('');
  } catch (e) { toast(e.message, 'error'); }
}

function getStagePaneHeaders(prog, stage) {
  if (stage === 'ARCHIVED')
    return '<th>Candidate</th><th>Recruiter</th><th>Archived At</th><th>Reason</th><th></th>';
  if (stage === 'CLIENTS')
    return '<th>Candidate</th><th>Client / Ship</th><th>Recruiter</th><th>Updated</th><th></th>';
  return '<th>Candidate</th><th>Recruiter</th><th>Status</th><th>Updated</th><th></th>';
}

function getStagePaneRow(c, prog, stage) {
  const name = `${esc(c.first_name)} ${esc(c.last_name)}`;
  const recruiter = esc(c.recruiter_name || '—');
  const updated = relTime(c.updated_at);
  const viewBtn = `<button class="btn btn-ghost btn-sm" onclick="event.stopPropagation();openDetail('${c.id}')">View</button>`;

  if (stage === 'ARCHIVED') return `
    <tr onclick="openDetail('${c.id}')">
      <td><div style="font-weight:600">${name}</div><div style="font-size:11px;color:var(--text-muted)">${esc(c.email)}</div></td>
      <td class="text-muted">${recruiter}</td>
      <td class="text-muted">${c.archived_at ? relTime(c.archived_at) : updated}</td>
      <td class="text-muted">${esc(c.archive_reason || '—')}</td>
      <td>${viewBtn}</td>
    </tr>`;

  if (stage === 'CLIENTS') return `
    <tr onclick="openDetail('${c.id}')">
      <td><div style="font-weight:600">${name}</div><div style="font-size:11px;color:var(--text-muted)">${esc(c.email)}</div></td>
      <td class="text-muted">${esc(c.endorsed_client_name || '—')}</td>
      <td class="text-muted">${recruiter}</td>
      <td class="text-muted">${updated}</td>
      <td>${viewBtn}</td>
    </tr>`;

  return `
    <tr onclick="openDetail('${c.id}')">
      <td><div style="font-weight:600">${name}</div><div style="font-size:11px;color:var(--text-muted)">${esc(c.email)}</div></td>
      <td class="text-muted">${recruiter}</td>
      <td><span class="badge badge-active" style="font-size:10px">${esc(c.status.replace(/_/g,' '))}</span></td>
      <td class="text-muted">${updated}</td>
      <td>${viewBtn}</td>
    </tr>`;
}

async function exportStageCandidatesCSV() {
  if (!_navProgram || !_navStage) return;
  const params = new URLSearchParams({ pipeline: _navProgram, status: _navStage, limit: 1000 });
  const search = document.getElementById('stage-pane-search')?.value;
  if (search) params.set('search', search);
  try {
    const d = await api('GET', `/candidates?${params}`);
    const rows = d.candidates || [];
    const headers = ['ID','First Name','Last Name','Email','Phone','Pipeline','Status','Recruiter','Updated'];
    const csv = [headers, ...rows.map(c => [
      c.id, c.first_name, c.last_name, c.email, c.phone || '',
      c.pipeline, c.status, c.recruiter_name || '', c.updated_at
    ])].map(r => r.map(v => `"${String(v).replace(/"/g,'""')}"`).join(',')).join('\n');
    const a = document.createElement('a');
    a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv);
    a.download = `${_navProgram}_${_navStage}_${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
  } catch (e) { toast(e.message, 'error'); }
}

// ── Local Settings ────────────────────────────────────────────────────────────

async function loadLocalSettings() {
  const prog = _navProgram;
  if (!prog) return;
  const pm = PROGRAM_META[prog];
  const content = document.getElementById('local-settings-content');
  content.innerHTML = '<div class="iw-empty-state"><div class="spinner"></div></div>';
  const d = await api('GET', `/program-settings/${prog}`).catch(() => ({ settings: {} }));
  const s = d.settings || {};
  const fields = LOCAL_SETTINGS_FIELDS[prog] || [];
  content.innerHTML = `
    <div class="pane-header-row">
      <div>
        <div class="pane-title">Local Settings</div>
        <div class="pane-sub"><span class="prog-badge ${pm.badgeClass}">${pm.icon} ${pm.label}</span></div>
      </div>
      <button class="btn btn-primary" onclick="saveLocalSettings('${prog}')">Save Settings</button>
    </div>
    <div class="local-settings-card">
      <div class="section-title">Configuration</div>
      ${fields.map(f => `
        <div class="form-group">
          <label>${esc(f.label)}${f.help ? `<span style="font-weight:400;color:var(--text-muted);font-size:11px;margin-left:6px">${f.help}</span>` : ''}</label>
          ${f.type === 'checkbox'
            ? `<label style="display:flex;align-items:center;gap:8px;cursor:pointer"><input type="checkbox" id="ls-${f.key}" ${s[f.key]==='1'?'checked':''}> ${esc(f.checkLabel||'Enabled')}</label>`
            : `<input type="${f.type||'text'}" id="ls-${f.key}" value="${esc(s[f.key]||f.default||'')}" placeholder="${esc(f.placeholder||'')}">`
          }
        </div>`).join('')}
    </div>
    <div class="local-settings-card" style="margin-top:16px">
      <div class="section-title">Field Configuration</div>
      ${prog === 'SEA_BASED'
        ? `<div onclick="openSfFieldSettings()" style="background:var(--navy);border:1px solid var(--border);border-radius:10px;padding:16px;cursor:pointer;display:flex;align-items:center;gap:14px;transition:border-color .15s"
                onmouseenter="this.style.borderColor='var(--blue)'" onmouseleave="this.style.borderColor='var(--border)'">
             <div style="width:38px;height:38px;background:#1e3a5f;border-radius:8px;display:flex;align-items:center;justify-content:center;flex-shrink:0">
               <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--blue)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/></svg>
             </div>
             <div>
               <div style="font-weight:600;font-size:.92rem;margin-bottom:3px">Candidate Profile Fields</div>
               <div style="font-size:.8rem;color:var(--text-muted);line-height:1.45">Configure sections, field order, labels, dropdown options and visibility for ${pm.label} candidate profiles.</div>
             </div>
           </div>`
        : `<div style="color:var(--text-muted);font-size:.85rem;padding:6px 2px">Profile field configuration for ${pm.label} is coming soon.</div>`
      }
    </div>`;
}

async function saveLocalSettings(prog) {
  const fields = LOCAL_SETTINGS_FIELDS[prog] || [];
  const payload = {};
  fields.forEach(f => {
    const el = document.getElementById(`ls-${f.key}`);
    if (!el) return;
    payload[f.key] = f.type === 'checkbox' ? (el.checked ? '1' : '0') : el.value.trim();
  });
  try {
    await api('PATCH', `/program-settings/${prog}`, payload);
    toast('Settings saved', 'success');
  } catch (e) { toast(e.message, 'error'); }
}

// ── Stage Fields Config ───────────────────────────────────────────────────────

async function loadStageFields() {
  const prog = _navProgram;
  if (!prog) return;
  const pm = PROGRAM_META[prog];
  const stages = PIPELINE_STAGES[prog].filter(s => !['CLIENTS','ARCHIVED'].includes(s.id));
  const content = document.getElementById('stage-fields-content');
  content.innerHTML = `
    <div class="pane-header-row">
      <div>
        <div class="pane-title">Stage Fields Config</div>
        <div class="pane-sub"><span class="prog-badge ${pm.badgeClass}">${pm.icon} ${pm.label}</span> — customize fields required at each stage</div>
      </div>
    </div>
    <div class="iw-subnav" id="sf-stage-tabs">
      ${stages.map((s,i) => `<button class="filter-chip ${i===0?'active':''}" id="sf-tab-${s.id}" onclick="loadStageFieldsForStage('${prog}','${s.id}')">${s.icon} ${s.label}</button>`).join('')}
    </div>
    <div id="sf-fields-area"><div class="iw-empty-state"><div class="spinner"></div></div></div>`;
  await loadStageFieldsForStage(prog, stages[0].id);
}

async function loadStageFieldsForStage(prog, stage) {
  document.querySelectorAll('#sf-stage-tabs .filter-chip').forEach(b => b.classList.remove('active'));
  document.getElementById(`sf-tab-${stage}`)?.classList.add('active');
  const area = document.getElementById('sf-fields-area');
  area.innerHTML = '<div class="iw-empty-state"><div class="spinner"></div></div>';
  const d = await api('GET', `/stage-fields?pipeline=${prog}&stage=${stage}`).catch(() => ({ fields: [] }));
  const rows = (d.fields || []).sort((a,b) => a.sort_order - b.sort_order);
  area.innerHTML = `
    <div style="display:flex;justify-content:flex-end;margin-bottom:12px">
      <button class="btn btn-primary btn-sm" onclick="openAddStageFieldModal('${prog}','${stage}')">+ Add Field</button>
    </div>
    ${rows.length ? `
    <div class="table-wrap"><table>
      <thead><tr><th>Label</th><th>Key</th><th>Type</th><th>Required</th><th>Order</th><th>Actions</th></tr></thead>
      <tbody>
        ${rows.map(f => `<tr>
          <td style="font-weight:500">${esc(f.field_label)}</td>
          <td><code style="font-size:11px;background:var(--navy-mid);padding:2px 6px;border-radius:4px">${esc(f.field_key)}</code></td>
          <td><span class="field-type-badge">${esc(f.field_type)}</span></td>
          <td>${f.is_required ? '<span class="badge badge-approved" style="font-size:10px">Yes</span>' : '<span class="badge" style="font-size:10px;background:var(--navy-mid);color:var(--text-muted)">No</span>'}</td>
          <td class="text-muted">${f.sort_order}</td>
          <td style="white-space:nowrap">
            <button class="btn btn-ghost btn-sm" onclick="openEditStageFieldModal('${f.id}','${prog}','${stage}','${esc(f.field_label)}','${f.field_type}',${f.is_required},${f.sort_order})">✏</button>
            <button class="btn btn-ghost btn-sm" style="color:var(--danger)" onclick="deleteStageField('${f.id}','${prog}','${stage}','${esc(f.field_label)}')">🗑</button>
          </td>
        </tr>`).join('')}
      </tbody>
    </table></div>`
    : `<div class="iw-empty-state">No fields configured for this stage.<br><button class="btn btn-primary" style="margin-top:12px" onclick="openAddStageFieldModal('${prog}','${stage}')">+ Add First Field</button></div>`}`;
}

function openAddStageFieldModal(prog, stage) {
  openModal('Add Stage Field', `
    <div class="form-row">
      <div class="form-group"><label>Field Label *</label><input type="text" id="sf-label" placeholder="e.g. Interview Score"></div>
      <div class="form-group"><label>Field Key *</label><input type="text" id="sf-key" placeholder="e.g. interview_score"></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label>Type</label>
        <select id="sf-type">
          <option value="text">Text</option><option value="number">Number</option>
          <option value="date">Date</option><option value="select">Select</option>
          <option value="textarea">Textarea</option><option value="checkbox">Checkbox</option>
          <option value="file">File Upload</option>
        </select>
      </div>
      <div class="form-group"><label>Sort Order</label><input type="number" id="sf-order" value="0" min="0"></div>
    </div>
    <div class="form-group"><label>Placeholder</label><input type="text" id="sf-placeholder" placeholder="Optional hint text"></div>
    <label style="display:flex;align-items:center;gap:8px;margin-bottom:16px;cursor:pointer">
      <input type="checkbox" id="sf-required"> Mark as Required
    </label>
    <div class="modal-footer">
      <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="submitAddStageField('${prog}','${stage}')">Add Field</button>
    </div>`);
  document.getElementById('sf-label').oninput = function() {
    const key = document.getElementById('sf-key');
    if (!key._touched) key.value = this.value.toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_|_$/g,'');
  };
  document.getElementById('sf-key').oninput = function() { this._touched = true; };
}

async function submitAddStageField(prog, stage) {
  const label = document.getElementById('sf-label').value.trim();
  const key   = document.getElementById('sf-key').value.trim();
  if (!label || !key) { toast('Label and Key are required', 'error'); return; }
  try {
    await api('POST', '/stage-fields', {
      pipeline: prog, stage,
      fieldLabel: label, fieldKey: key,
      fieldType:  document.getElementById('sf-type').value,
      isRequired: document.getElementById('sf-required').checked,
      sortOrder:  parseInt(document.getElementById('sf-order').value) || 0,
      placeholder: document.getElementById('sf-placeholder').value.trim() || null,
    });
    closeModal(); toast('Field added', 'success'); loadStageFieldsForStage(prog, stage);
  } catch (e) { toast(e.message, 'error'); }
}

function openEditStageFieldModal(id, prog, stage, label, type, required, order) {
  openModal('Edit Stage Field', `
    <div class="form-group"><label>Field Label *</label><input type="text" id="sfe-label" value="${esc(label)}"></div>
    <div class="form-row">
      <div class="form-group"><label>Type</label>
        <select id="sfe-type">
          <option value="text" ${type==='text'?'selected':''}>Text</option>
          <option value="number" ${type==='number'?'selected':''}>Number</option>
          <option value="date" ${type==='date'?'selected':''}>Date</option>
          <option value="select" ${type==='select'?'selected':''}>Select</option>
          <option value="textarea" ${type==='textarea'?'selected':''}>Textarea</option>
          <option value="checkbox" ${type==='checkbox'?'selected':''}>Checkbox</option>
          <option value="file" ${type==='file'?'selected':''}>File Upload</option>
        </select>
      </div>
      <div class="form-group"><label>Sort Order</label><input type="number" id="sfe-order" value="${order}" min="0"></div>
    </div>
    <label style="display:flex;align-items:center;gap:8px;margin-bottom:16px;cursor:pointer">
      <input type="checkbox" id="sfe-required" ${required?'checked':''}> Mark as Required
    </label>
    <div class="modal-footer">
      <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="submitEditStageField('${id}','${prog}','${stage}')">Save Changes</button>
    </div>`);
}

async function submitEditStageField(id, prog, stage) {
  const label = document.getElementById('sfe-label').value.trim();
  if (!label) { toast('Label is required', 'error'); return; }
  try {
    await api('PATCH', `/stage-fields/${id}`, {
      fieldLabel: label,
      fieldType:  document.getElementById('sfe-type').value,
      isRequired: document.getElementById('sfe-required').checked,
      sortOrder:  parseInt(document.getElementById('sfe-order').value) || 0,
    });
    closeModal(); toast('Field updated', 'success'); loadStageFieldsForStage(prog, stage);
  } catch (e) { toast(e.message, 'error'); }
}

async function deleteStageField(id, prog, stage, label) {
  const ok = await showConfirm(`Delete field "${label}"? This cannot be undone.`);
  if (!ok) return;
  try {
    await api('DELETE', `/stage-fields/${id}`);
    toast('Field deleted', 'info'); loadStageFieldsForStage(prog, stage);
  } catch (e) { toast(e.message, 'error'); }
}

// ── Program Documents ─────────────────────────────────────────────────────────

function loadProgDocs() {
  const prog = _navProgram;
  if (!prog) return;
  const pm = PROGRAM_META[prog];
  const content = document.getElementById('prog-docs-content');

  // Pre-select doc types based on program
  const docPresets = {
    J1_PROGRAM: ['PASSPORT','DS_2019'],
    SEA_BASED:  ['PASSPORT','SEAMANS_BOOK','MEDICAL_CERTIFICATE','STCW_CERTIFICATE'],
    LAND_BASED: ['PASSPORT','NBI_CLEARANCE'],
  };
  const preset = docPresets[prog] || [];

  content.innerHTML = `
    <div class="pane-header-row" style="margin-bottom:20px">
      <div>
        <div class="pane-title">Documents Filter</div>
        <div class="pane-sub"><span class="prog-badge ${pm.badgeClass}">${pm.icon} ${pm.label}</span></div>
      </div>
    </div>
    <div class="card" style="margin-bottom:16px">
      <div class="card-title" style="margin-bottom:16px">Filter Criteria</div>
      <div class="form-row">
        <div class="form-group">
          <label>Document Types</label>
          <select id="pd-doc-types" multiple style="height:120px">
            <option value="PASSPORT"            ${preset.includes('PASSPORT')?'selected':''}>Passport</option>
            <option value="DS_2019"             ${preset.includes('DS_2019')?'selected':''}>DS-2019</option>
            <option value="SEAMANS_BOOK"        ${preset.includes('SEAMANS_BOOK')?'selected':''}>Seaman's Book</option>
            <option value="MEDICAL_CERTIFICATE" ${preset.includes('MEDICAL_CERTIFICATE')?'selected':''}>Medical Certificate</option>
            <option value="STCW_CERTIFICATE"    ${preset.includes('STCW_CERTIFICATE')?'selected':''}>STCW Certificate</option>
            <option value="C1D_VISA"            ${preset.includes('C1D_VISA')?'selected':''}>C1/D Visa</option>
            <option value="NBI_CLEARANCE"       ${preset.includes('NBI_CLEARANCE')?'selected':''}>NBI Clearance</option>
            <option value="WORK_PERMIT"         ${preset.includes('WORK_PERMIT')?'selected':''}>Work Permit</option>
          </select>
        </div>
        <div>
          <div class="form-group">
            <label>Expires Before</label>
            <input type="date" id="pd-expires-before">
          </div>
          <div class="form-group">
            <label>Candidate Status</label>
            <select id="pd-status">
              <option value="">All Statuses</option>
              ${(PIPELINE_STAGES[prog]||[]).map(s=>`<option value="${s.id}">${s.icon} ${s.label}</option>`).join('')}
            </select>
          </div>
        </div>
      </div>
      <button class="btn btn-primary" onclick="runProgDocsFilter('${prog}')">Run Filter</button>
    </div>
    <div id="pd-results"></div>`;
}

async function runProgDocsFilter(prog) {
  const types = [...document.getElementById('pd-doc-types').selectedOptions].map(o => o.value);
  const before = document.getElementById('pd-expires-before').value;
  const status = document.getElementById('pd-status').value;
  const results = document.getElementById('pd-results');
  results.innerHTML = '<div class="iw-empty-state"><div class="spinner"></div></div>';
  try {
    const params = new URLSearchParams({ pipeline: prog });
    if (types.length) params.set('certTypes', types.join(','));
    if (before) params.set('expiresBefore', before);
    if (status) params.set('status', status);
    const d = await api('GET', `/compliance?${params}`);
    const rows = d.results || [];
    if (!rows.length) { results.innerHTML = '<div class="iw-empty-state">No matching documents found.</div>'; return; }
    results.innerHTML = `
      <div class="table-wrap"><table>
        <thead><tr><th>Candidate</th><th>Document</th><th>Number</th><th>Expires</th><th>Days Left</th></tr></thead>
        <tbody>${rows.map(r => {
          const days = r.expiry_date ? Math.round((new Date(r.expiry_date) - Date.now()) / 86400000) : null;
          const cls  = days === null ? '' : days < 0 ? 'expiry-dead' : days < 30 ? 'expiry-warn' : 'expiry-ok';
          return `<tr onclick="openDetail('${r.candidate_id}')">
            <td><div style="font-weight:500">${esc(r.first_name)} ${esc(r.last_name)}</div><div style="font-size:11px;color:var(--text-muted)">${esc(r.email)}</div></td>
            <td class="text-muted">${esc(r.cert_type.replace(/_/g,' '))}</td>
            <td class="text-muted">${esc(r.cert_number||'—')}</td>
            <td class="text-muted">${r.expiry_date ? r.expiry_date.slice(0,10) : '—'}</td>
            <td class="${cls} compliance-days">${days !== null ? (days < 0 ? `${Math.abs(days)}d EXPIRED` : `${days}d`) : '—'}</td>
          </tr>`;
        }).join('')}</tbody>
      </table></div>`;
  } catch (e) { toast(e.message, 'error'); results.innerHTML = ''; }
}

// ── Debounce ──────────────────────────────────────────────────────────────────

function debounce(fn, ms) {
  let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

// ── Dashboard ─────────────────────────────────────────────────────────────────

async function loadDashboard() {
  try {
    const stats = await api('GET', '/stats');
    const bp = stats.byPipeline || {};
    const statCards = [
      { label: 'Total Candidates',   value: stats.total,             cls: 'blue'   },
      { label: 'Deployed',           value: stats.deployed,          cls: 'green'  },
      { label: 'Pushed (30 days)',   value: stats.pushedLast30Days,  cls: 'amber'  },
      { label: '🚢 Sea-Based',       value: bp.SEA_BASED  || 0,      cls: 'blue'   },
      { label: '🏢 Land-Based',      value: bp.LAND_BASED || 0,      cls: 'green'  },
      { label: '🎓 J1 Program',      value: bp.J1_PROGRAM || 0,      cls: 'purple' },
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
        <div class="card-header"><span class="card-title">Onboarding Funnel</span></div>
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

    document.getElementById('dash-recent-submissions').innerHTML = funnelHtml;
  } catch (e) { toast(e.message, 'error'); }
}

// Submissions, the form builder, and the standalone interview/booking pages
// were removed in v8 — application intake and interviewing are entirely
// ZeusHire's job now.

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

// NOTE: the legacy non-generic pipeline panes (Candidates/New Submissions/
// Final Interview/Offer Letter/Onboarding/Archive list views, and their
// setXxxPipeline()/loadXxx() loaders) were removed here — they were
// pre-hire ATS relics already unreachable from the UI (no VIEW_META entry,
// no stage dispatch pointed at them). Every pipeline stage now renders
// through the generic stage-pane (`loadStagePane()` / `showStage()`).

// Short alias used by stage-pane row click handlers (inline onclick= needs a
// global function reference; const at script top-level isn't always reachable).
function openDetail(id) { return openCandidateDetail(id); }

async function openCandidateDetail(id) {
  try {
    const c = await api('GET', `/candidates/${id}`);
    STATE.currentCandidate = c;
    document.getElementById('dp-name').textContent = `${c.first_name} ${c.last_name}`;
    document.getElementById('dp-email').textContent = c.email;
    document.getElementById('dp-avatar').textContent = (c.first_name[0] + c.last_name[0]).toUpperCase();
    const j1TabBtn = document.getElementById('tab-j1plan');
    if (j1TabBtn) j1TabBtn.style.display = c.pipeline === 'J1_PROGRAM' ? '' : 'none';
    renderDetailOverview(c);
    renderDetailInterviews(c);
    renderDetailDocuments(c);
    renderDetailHistory(c);
    renderDetailProfile(c);
    document.getElementById('dp-tab-j1plan').innerHTML = '<p style="color:var(--text-muted);padding:24px 0;">Loading J1 plan…</p>';
    document.querySelectorAll('.detail-body .tab').forEach((t, i) => { t.classList.toggle('active', i === 0); });
    document.querySelectorAll('[id^="dp-tab-"]').forEach((t, i) => { t.classList.toggle('hidden', i !== 0); });
    document.getElementById('detail-panel').classList.add('open');
    document.getElementById('detail-backdrop')?.classList.add('open');
    // Eagerly fetch profile data so Overview can show dynamic fields
    if (c.pipeline === 'SEA_BASED') {
      const fetches = [];
      if (!c.seafarerProfile) fetches.push(api('GET', `/candidates/${c.id}/seafarer-profile`).then(sp => { STATE.currentCandidate.seafarerProfile = sp; }));
      if (STATE.sfFieldConfig === undefined) fetches.push(api('GET', '/settings/seafarer-fields').then(cfg => { STATE.sfFieldConfig = cfg || {}; }).catch(() => { STATE.sfFieldConfig = {}; }));
      // Active deployment (only meaningful at DEPLOYED, but harmless to fetch always)
      if (c.status === 'DEPLOYED') {
        fetches.push(api('GET', `/candidates/${c.id}/deployments`).then(d => {
          STATE.currentCandidate.activeDeployment = (d.deployments || []).find(x => x.status === 'ACTIVE') || null;
        }).catch(() => { STATE.currentCandidate.activeDeployment = null; }));
      }
      if (fetches.length) Promise.all(fetches).then(() => { renderDetailOverview(STATE.currentCandidate); }).catch(() => {});
    }
  } catch (e) { toast(e.message, 'error'); }
}

function closeDetail() {
  document.getElementById('detail-panel').classList.remove('open');
  document.getElementById('detail-backdrop')?.classList.remove('open');
}

function renderDetailOverview(c) {
  const el = document.getElementById('dp-tab-overview');
  const SL = `font-size:.72rem;text-transform:uppercase;color:var(--blue);font-weight:700;letter-spacing:.06em;margin-bottom:10px;`;

  const stateActions = (() => {
    const s = c.status;
    if (s === 'ONBOARDING') {
      const readyBtn = ['SEA_BASED','LAND_BASED'].includes(c.pipeline)
        ? `<button class="btn btn-primary btn-sm" onclick="markSeaReadyToDeploy('${esc(c.id)}')">✅ Verify Documents & Mark Ready</button>`
        : '';
      return `
      ${readyBtn}
      <button class="btn btn-ghost btn-sm" style="color:var(--danger)" onclick="transitionArchive('${esc(c.id)}')">Archive</button>`;
    }
    if (s === 'READY_TO_DEPLOY') return `
      <button class="btn btn-primary btn-sm" onclick="createSeaDeployment('${esc(c.id)}')">🚢 Create Deployment</button>
      <button class="btn btn-ghost btn-sm" style="color:var(--danger)" onclick="transitionArchive('${esc(c.id)}')">Archive</button>`;
    if (s === 'DEPLOYED') {
      const dep = c.activeDeployment;
      const closeBtn = dep
        ? `<button class="btn btn-primary btn-sm" onclick="closeSeaDeployment('${esc(dep.id)}')">⚓ Close Deployment</button>`
        : `<span style="font-size:11px;color:var(--text-muted)">No active deployment row — out of sync</span>`;
      return `${closeBtn}`;
    }
    if (s === 'ARCHIVED') return `
      <button class="btn btn-ghost btn-sm" style="color:var(--blue)" onclick="transitionRestore('${esc(c.id)}')">↩ Restore</button>`;
    return '';
  })();

  const actionBar = `
    <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:16px">
      ${stateActions}
      ${(!c.portal_activated_at && ['ONBOARDING','READY_TO_DEPLOY','DEPLOYED'].includes(c.status)) ? `<button class="btn btn-ghost btn-sm" style="color:var(--text-muted)" onclick="sendPortalInvite('${esc(c.id)}')">Portal Invite</button>` : ''}
      <button class="btn btn-ghost btn-sm" onclick="openEditCandidateModal('${esc(c.id)}')">Edit</button>
    </div>`;

  // Recruiter assignment lives on Overview — the Interview tab is now a
  // read-only ZeusHire snapshot (see renderDetailInterviews).
  const currentRec = c.recruiter_fn ? `${esc(c.recruiter_fn)} ${esc(c.recruiter_ln)}` : null;
  const assignRecruiter = `
    <div style="background:var(--navy-mid);border:1px solid var(--border);border-radius:10px;padding:12px 14px;margin-bottom:16px">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap">
        <div style="font-size:11px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.5px">Assigned Recruiter</div>
        <div style="font-size:13px;color:${currentRec ? 'var(--text)' : 'var(--text-muted)'};font-weight:${currentRec ? '600' : '400'}">${currentRec || 'Unassigned'}</div>
      </div>
      <div style="display:flex;gap:8px;margin-top:10px">
        <select id="assign-recruiter-sel" style="flex:1">
          <option value="">— Select Recruiter —</option>
          ${STATE.recruiters.map(r => `<option value="${r.id}" ${r.id === c.assigned_recruiter_id ? 'selected' : ''}>${esc(r.first_name)} ${esc(r.last_name)}</option>`).join('')}
        </select>
        <button class="btn btn-secondary btn-sm" onclick="assignRecruiter('${c.id}')">${currentRec ? 'Reassign' : 'Assign'}</button>
      </div>
    </div>`;

  const notes = c.internal_notes
    ? `<div style="margin-bottom:12px"><label>Internal Notes</label><p class="text-sm text-muted" style="margin-top:4px">${esc(c.internal_notes)}</p></div>`
    : '';

  // ── SEA_BASED: dynamic field config sections ─────────────────────────────
  if (c.pipeline === 'SEA_BASED' && c.seafarerProfile !== undefined && STATE.sfFieldConfig !== undefined) {
    const sp = c.seafarerProfile || {};
    const config = getMergedSfConfig();

    // Group fields by section. Fields show as long as they're flagged for
    // Overview and their visible-stages array includes the current status —
    // empty values render as '—' (matches the Profile tab behaviour) so
    // configured fields are visible before any data has been entered.
    const fieldsBySec = {};
    config.fields
      .filter(f => f.visible !== false && f.showInOverview !== false && _sfFieldVisibleAt(f, c.status))
      .forEach(f => {
        const raw = (f.source === 'c' ? c : sp)[f.key];
        if (!fieldsBySec[f.section]) fieldsBySec[f.section] = [];
        fieldsBySec[f.section].push({ f, raw });
      });

    let sectionsHtml = '';
    config.sections.forEach(sec => {
      const items = fieldsBySec[sec.id];
      if (!items || !items.length) return;
      sectionsHtml += `<div style="margin-bottom:20px"><div style="${SL}">${esc(sec.label)}</div><div class="info-grid">`;
      items.forEach(({ f, raw }) => {
        const reg = SEAFARER_FIELD_REGISTRY.find(r => r.key === f.key) || f;
        let disp;
        if (raw == null || raw === '')         { disp = '—'; }
        else if (reg.type === 'date')          { disp = fmtDate(raw); }
        else if (reg.type === 'currency')      { disp = '$' + Number(raw).toLocaleString(); }
        else if (reg.type === 'checkbox')      { disp = raw ? 'Yes' : 'No'; }
        else if (reg.type === 'textarea')      { disp = `<span style="white-space:pre-wrap">${esc(String(raw))}</span>`; }
        else if (reg.type === 'url')           { disp = `<a href="${esc(String(raw))}" target="_blank" style="color:var(--blue)">${esc(String(raw))}</a>`; }
        else                                   { disp = esc(String(raw)); }
        const full = (reg.type === 'textarea') ? ' style="grid-column:1/-1"' : '';
        sectionsHtml += `<div class="info-item"${full}><label>${esc(f.label)}</label><span>${disp}</span></div>`;
      });
      sectionsHtml += `</div></div>`;
    });

    if (!sectionsHtml) {
      sectionsHtml = `
        <div style="background:var(--navy-mid);border:1px dashed var(--border);border-radius:10px;padding:24px;text-align:center;margin-bottom:20px">
          <p style="color:var(--text-muted);font-size:13px;margin:0 0 12px">No Overview fields configured yet.</p>
          <button class="btn btn-ghost btn-sm" onclick="openSfFieldSettings()">⚙ Customize Overview Fields</button>
          <p style="color:var(--text-muted);font-size:11px;margin:10px 0 0">Choose which fields from <strong>Profile</strong> show up here.</p>
        </div>`;
    }

    // Subtle affordance: configure-overview link (only when fields exist)
    const customizeLink = sectionsHtml.includes('No Overview fields configured') ? '' : `
      <div style="display:flex;justify-content:flex-end;margin-bottom:8px">
        <button class="btn btn-ghost btn-sm" style="font-size:11px;color:var(--text-muted);padding:3px 8px" onclick="openSfFieldSettings()">⚙ Customize Overview Fields</button>
      </div>`;

    el.innerHTML = `${actionBar}${customizeLink}${sectionsHtml}<hr style="border:none;border-top:1px solid var(--border);margin:16px 0">${assignRecruiter}${notes}`;
    return;
  }

  // ── Fallback: minimal Overview (non-SEA pipelines + Sea-Based still loading) ─
  // Profile data lives in the Profile tab; Overview shows at-a-glance status only.
  const loading = c.pipeline === 'SEA_BASED'
    ? `<p style="color:var(--text-muted);font-size:13px;margin-bottom:16px">Loading profile data…</p>`
    : `<p style="color:var(--text-muted);font-size:12px;margin-bottom:12px">Profile data lives under the <strong style="color:var(--text)">Profile</strong> tab. Customizable Overview fields are coming for this pipeline.</p>`;
  el.innerHTML = `${actionBar}
    ${loading}
    <div class="info-grid" style="margin-bottom:16px">
      <div class="info-item"><label>Portal</label><span>${c.portal_activated_at ? '<span style="color:var(--success)">Active</span>' : '<span style="color:var(--text-muted)">Not activated</span>'}</span></div>
      <div class="info-item"><label>Created</label><span>${relTime(c.created_at)}</span></div>
    </div>
    ${assignRecruiter}${notes}`;
}

async function markSeaReadyToDeploy(candidateId) {
  if (!confirm('Verify required documents and mark candidate Ready to Go?\n\n(Required: Passport, Seaman Book, STCW Basic, Medical Cert, Yellow Fever, C1/D Visa — all present and unexpired.)')) return;
  try {
    await api('POST', `/sea/onboarding/${candidateId}/ready`, {});
    toast('Documents verified → Ready to Go ✓', 'success');
    if (STATE.currentCandidate?.id === candidateId) openCandidateDetail(candidateId);
  } catch (e) {
    // Surface the missing/expired lists if the worker returned them.
    let body = null;
    try { body = JSON.parse(e.message); } catch {}
    if (body?.missing?.length || body?.expired?.length) {
      const missing = body.missing?.length ? `\nMissing: ${body.missing.join(', ')}` : '';
      const expired = body.expired?.length ? `\nExpired: ${body.expired.join(', ')}` : '';
      alert(`Cannot mark ready:${missing}${expired}`);
    } else {
      toast(e.message, 'error');
    }
  }
}

async function createSeaDeployment(candidateId) {
  const isLand = STATE.currentCandidate?.pipeline === 'LAND_BASED';
  const L = isLand
    ? { name: 'Work location / employer site', date: 'Start date (YYYY-MM-DD)', port: 'Work address (optional)', pos: 'Position / role (optional)', success: name => `Assigned to ${name} ✓` }
    : { name: 'Vessel name',                   date: 'Sign-on date (YYYY-MM-DD)', port: 'Sign-on port (optional)', pos: 'Position / rank (optional)', success: name => `Deployed to ${name} ✓` };

  const vesselName = (prompt(L.name + ':') || '').trim();
  if (!vesselName) return;
  const signOnDate = (prompt(L.date + ':') || '').trim();
  if (!signOnDate || isNaN(Date.parse(signOnDate))) { toast(`Invalid ${isLand ? 'start' : 'sign-on'} date`, 'error'); return; }
  const months = parseInt(prompt('Contract duration in months (1–24):') || '', 10);
  if (isNaN(months) || months < 1 || months > 24) { toast('Duration must be 1–24 months', 'error'); return; }
  const signOnPort = (prompt(L.port + ':') || '').trim() || undefined;
  const position   = (prompt(L.pos + ':') || '').trim() || undefined;
  try {
    await api('POST', '/sea/deployments', {
      candidateId, vesselName, signOnDate, contractDurationMonths: months, signOnPort, position
    });
    toast(L.success(vesselName), 'success');
    if (STATE.currentCandidate?.id === candidateId) openCandidateDetail(candidateId);
  } catch (e) { toast(e.message, 'error'); }
}

async function closeSeaDeployment(deploymentId) {
  const status = (prompt('Close status — type one of: COMPLETED, TERMINATED, CANCELLED') || '').trim().toUpperCase();
  if (!['COMPLETED','TERMINATED','CANCELLED'].includes(status)) { toast('Invalid close status', 'error'); return; }
  const signOffDate = (prompt('Sign-off date (YYYY-MM-DD):') || '').trim();
  if (!signOffDate || isNaN(Date.parse(signOffDate))) { toast('Invalid sign-off date', 'error'); return; }
  const signOffReason = (prompt('Sign-off reason (optional):') || '').trim() || undefined;
  try {
    await api('POST', `/sea/deployments/${deploymentId}/close`, { status, signOffDate, signOffReason });
    toast('Deployment closed — candidate available for re-deployment', 'success');
    const cid = STATE.currentCandidate?.id;
    if (cid) openCandidateDetail(cid);
  } catch (e) { toast(e.message, 'error'); }
}

async function transitionArchive(candidateId) {
  const reason = prompt('Archive reason (required):');
  if (!reason) return;
  try {
    await api('POST', `/candidates/${candidateId}/transitions/archive`, { reason });
    toast('Candidate archived', 'info');
    if (_navProgram && _navStage) loadStagePane();
    if (STATE.currentCandidate?.id === candidateId) closeDetail();
  } catch (e) { toast(e.message, 'error'); }
}

async function transitionRestore(candidateId) {
  const target = prompt('Restore to which state?\n(ONBOARDING / READY_TO_DEPLOY)');
  const VALID = ['ONBOARDING','READY_TO_DEPLOY'];
  if (!target || !VALID.includes(target.toUpperCase().trim())) { toast('Invalid state', 'error'); return; }
  try {
    await api('POST', `/candidates/${candidateId}/transitions/restore`, { restoreToStatus: target.toUpperCase().trim() });
    toast('Candidate restored ✓', 'success');
    if (_navProgram && _navStage) loadStagePane();
    if (STATE.currentCandidate?.id === candidateId) openCandidateDetail(candidateId);
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

// Read-only view of everything ZeusHire captured about this candidate before
// it pushed them to Poseidon as "Hired" (registration answers, department/
// position, notes, tags, stage history, any interview scores/recordings
// ZeusHire had). Poseidon never writes to this — it's a snapshot dump.
function renderDetailInterviews(c) {
  const el = document.getElementById('dp-tab-interviews');
  const snap = c.zeushireSnapshot;

  if (!snap || typeof snap !== 'object' || !Object.keys(snap).length) {
    el.innerHTML = '<div class="empty" style="padding:32px"><p>No ZeusHire data available</p></div>';
    return;
  }

  const fmtLabel = key => key
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, l => l.toUpperCase());

  const fmtValue = v => {
    if (v === null || v === undefined || v === '') return '<span class="text-muted">—</span>';
    if (Array.isArray(v) || typeof v === 'object') return `<pre style="white-space:pre-wrap;word-break:break-word;margin:0;font-size:12px;font-family:inherit">${esc(JSON.stringify(v, null, 2))}</pre>`;
    return esc(String(v));
  };

  el.innerHTML = `
    <div class="info-grid" style="grid-template-columns:1fr 1fr">
      ${Object.entries(snap)
        .filter(([, v]) => v !== null && v !== undefined)
        .map(([k, v]) => `<div class="info-item"><label>${esc(fmtLabel(k))}</label><span>${fmtValue(v)}</span></div>`)
        .join('')}
    </div>`;
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

function renderDetailHistory(c) {
  const el = document.getElementById('dp-tab-history');
  const hist = (c.stageHistory || []).slice().reverse();
  el.innerHTML = hist.length ? `<div class="timeline">${hist.map(h => {
    const isForce = (h.reason || '').startsWith('FORCE_OVERRIDE');
    const forceBadge = isForce
      ? `<span style="display:inline-block;background:#3a0d0d;color:#fca5a5;border-radius:4px;padding:1px 6px;font-size:10px;font-weight:700;letter-spacing:.04em;margin-left:6px" title="A SUPER_ADMIN bypassed the normal flow guards">⚠ ADMIN OVERRIDE</span>`
      : '';
    return `
    <div class="timeline-item">
      <div class="timeline-dot" ${isForce ? 'style="background:var(--danger)"' : ''}></div>
      <div class="timeline-label">${h.from_status ? `${statusLabel(h.from_status)} → ` : ''}${statusLabel(h.to_status)}${forceBadge}</div>
      <div class="timeline-meta">${h.fn ? `${esc(h.fn)} ${esc(h.ln)} · ` : ''}${relTime(h.created_at)}</div>
      ${h.reason ? `<div class="text-sm text-muted" style="margin-top:2px">${esc(h.reason)}</div>` : ''}
    </div>`;
  }).join('')}</div>` :
    '<div class="empty" style="padding:32px"><p>No history yet</p></div>';
}

function switchDetailTab(name, el) {
  document.querySelectorAll('.detail-body .tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('[id^="dp-tab-"]').forEach(t => t.classList.add('hidden'));
  el.classList.add('active');
  document.getElementById(`dp-tab-${name}`).classList.remove('hidden');
  if (name === 'j1plan' && STATE.currentCandidate) loadJ1Plan(STATE.currentCandidate.id);
  if (name === 'profile' && STATE.currentCandidate) {
    const c = STATE.currentCandidate;
    if (c.pipeline === 'SEA_BASED') {
      const fetches = [];
      if (!c.seafarerProfile)      fetches.push(api('GET', `/candidates/${c.id}/seafarer-profile`).then(sp => { STATE.currentCandidate.seafarerProfile = sp; }));
      if (!c.certificates)         fetches.push(api('GET', `/candidates/${c.id}/certificates`).then(certs => { STATE.currentCandidate.certificates = certs; }));
      if (STATE.sfFieldConfig === undefined) fetches.push(api('GET', '/settings/seafarer-fields').then(cfg => { STATE.sfFieldConfig = cfg || {}; }).catch(() => { STATE.sfFieldConfig = {}; }));
      if (fetches.length) Promise.all(fetches).then(() => {
        renderDetailProfile(STATE.currentCandidate);
        renderDetailOverview(STATE.currentCandidate); // keep overview in sync
      }).catch(() => {});
      else renderDetailProfile(STATE.currentCandidate);
    } else if (c.pipeline === 'J1_PROGRAM' && !c.j1Profile) {
      api('GET', `/candidates/${c.id}/j1-profile`).then(jp => { STATE.currentCandidate.j1Profile = jp; renderDetailProfile(STATE.currentCandidate); }).catch(() => {});
    } else {
      renderDetailProfile(STATE.currentCandidate);
    }
  }
}

// The Poseidon-native interview-template CRUD (called Poseidon's own
// /interviews REST API, now removed) and the embedded ZeusHire ops shell
// (one-way/two-way/booking management via a direct X-Admin-Key call to
// interview-api.putuastrawijaya.workers.dev) were both removed in v8.
// ZeusHire has its own dedicated admin panel now — interviewing is
// entirely its job, not something to duplicate here.

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
  const c = await api('GET', `/clients/${id}`);
  const contacts = c.contacts || [];
  openModal(c.name, `
    <div style="display:flex;justify-content:flex-end;gap:8px;margin-bottom:16px">
      <button class="btn btn-ghost btn-sm" onclick="openEditClientModal('${esc(id)}')">✏ Edit</button>
      <button class="btn btn-ghost btn-sm" style="color:var(--${c.is_active ? 'danger' : 'success'})" onclick="toggleClientActive('${esc(id)}',${c.is_active ? 1 : 0})">${c.is_active ? '⛔ Deactivate' : '✅ Reactivate'}</button>
    </div>
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
    <div>
      ${contacts.length ? contacts.map(ct => `
        <div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--border)">
          <div style="flex:1">
            <div style="font-weight:500;font-size:.88rem;">${esc(ct.first_name)} ${esc(ct.last_name)}</div>
            <div style="font-size:.78rem;color:var(--text-muted);">${esc(ct.email)}</div>
          </div>
          <button class="btn btn-ghost btn-sm" style="color:var(--danger)" onclick="removeContactFromClient('${esc(id)}','${esc(ct.user_id)}')">Remove</button>
        </div>`).join('') : '<div class="text-muted text-sm" style="padding:8px 0">No portal contacts linked. Add a CLIENT_CONTACT user to give access to the client portal.</div>'}
    </div>
    `, 'modal-lg');
}

async function openEditClientModal(id) {
  let c;
  try { c = await api('GET', `/clients/${id}`); } catch (e) { toast(e.message, 'error'); return; }
  openModal('Edit Client', `
    <div class="form-row">
      <div class="form-group"><label>Client Name *</label><input type="text" id="ec-name" value="${esc(c.name || '')}"></div>
      <div class="form-group"><label>Type</label>
        <select id="ec-type">
          <option value="CRUISE_LINE" ${c.type==='CRUISE_LINE'?'selected':''}>Cruise Line</option>
          <option value="LAND_BASED"  ${c.type==='LAND_BASED'?'selected':''}>Land-Based</option>
          <option value="J1_SPONSOR"  ${c.type==='J1_SPONSOR'?'selected':''}>J1 Sponsor</option>
        </select>
      </div>
    </div>
    <div class="form-row">
      <div class="form-group"><label>Country</label><input type="text" id="ec-country" value="${esc(c.country || '')}"></div>
      <div class="form-group"><label>Contact Email</label><input type="email" id="ec-email" value="${esc(c.contact_email || '')}"></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label>Contact Phone</label><input type="text" id="ec-phone" value="${esc(c.contact_phone || '')}"></div>
      <div class="form-group"><label>Website</label><input type="text" id="ec-website" value="${esc(c.website || '')}"></div>
    </div>
    <div class="form-group"><label>Notes</label><textarea id="ec-notes" rows="3">${esc(c.notes || '')}</textarea></div>
    <div class="modal-footer">
      <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="updateClient('${esc(id)}')">Save Changes</button>
    </div>`);
}

async function updateClient(id) {
  const name = document.getElementById('ec-name').value.trim();
  if (!name) { toast('Client name is required', 'error'); return; }
  try {
    await api('PATCH', `/clients/${id}`, {
      name,
      type:         document.getElementById('ec-type').value,
      country:      document.getElementById('ec-country').value.trim(),
      contactEmail: document.getElementById('ec-email').value.trim(),
      contactPhone: document.getElementById('ec-phone').value.trim(),
      website:      document.getElementById('ec-website').value.trim(),
      notes:        document.getElementById('ec-notes').value.trim(),
    });
    closeModal();
    toast('Client updated', 'success');
    loadClients();
    loadClientsList();
  } catch (e) { toast(e.message, 'error'); }
}

async function toggleClientActive(id, currentlyActive) {
  const action = currentlyActive ? 'deactivate' : 'reactivate';
  const ok = await showConfirm(`Are you sure you want to ${action} this client?`);
  if (!ok) return;
  try {
    await api('PATCH', `/clients/${id}`, { isActive: !currentlyActive });
    toast(`Client ${action}d`, 'success');
    closeModal();
    loadClients();
  } catch (e) { toast(e.message, 'error'); }
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

// The application-form builder (called Poseidon's own /forms REST API,
// now removed) was removed in v8 — application intake is entirely
// ZeusHire's job.

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
      <select id="au-role"><option value="RECRUITER">Recruiter</option><option value="ONBOARDING_TEAM">Onboarding Team</option><option value="ADMIN">Admin</option><option value="CLIENT_CONTACT">Client Contact</option></select>
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

// Manual candidate creation was removed in v8 — every candidate now
// arrives exclusively via the ZeusHire hired-push.

// ── Pipeline Profiles ─────────────────────────────────────────────────────────

function renderDetailProfile(c) {
  const el = document.getElementById('dp-tab-profile');
  if (!el) return;

  if (c.pipeline === 'SEA_BASED') {
    const sp    = c.seafarerProfile || {};
    const certs = c.certificates || [];
    const config = getMergedSfConfig();
    const SL = `font-size:.72rem;text-transform:uppercase;color:var(--blue);font-weight:700;letter-spacing:.06em;margin-bottom:10px;`;

    // Group visible fields by section, sorted by order. Field-level "appearsAt"
    // controls cumulative reveal: a field only shows once the candidate's
    // status is at-or-after the field's chosen first-appearance stage.
    const fieldsBySec = {};
    config.fields
      .filter(f => f.visible !== false && _sfFieldVisibleAt(f, c.status))
      .forEach(f => {
        if (!fieldsBySec[f.section]) fieldsBySec[f.section] = [];
        fieldsBySec[f.section].push(f);
      });

    let html = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
        <h4 style="margin:0;font-size:.9rem;">Seafarer Profile</h4>
        <button class="btn btn-primary btn-sm" onclick="openEditSeafarerProfileModal('${esc(c.id)}')">Edit Profile</button>
      </div>`;

    config.sections.forEach(section => {
      const fields = fieldsBySec[section.id];
      if (!fields || !fields.length) return;
      html += `<div style="margin-bottom:20px"><div style="${SL}">${esc(section.label)}</div><div class="info-grid">`;
      fields.forEach(f => {
        const reg = SEAFARER_FIELD_REGISTRY.find(r => r.key === f.key) || {};
        const rawVal = (reg.source === 'c' ? c : sp)[f.key];
        let disp;
        if (rawVal == null || rawVal === '') { disp = '—'; }
        else if (reg.type === 'date')     { disp = fmtDate(rawVal); }
        else if (reg.type === 'currency') { disp = '$' + Number(rawVal).toLocaleString(); }
        else if (reg.type === 'textarea') { disp = `<span style="white-space:pre-wrap">${esc(String(rawVal))}</span>`; }
        else if (reg.type === 'url')      { disp = `<a href="${esc(String(rawVal))}" target="_blank" style="color:var(--blue)">${esc(String(rawVal))}</a>`; }
        else { disp = esc(String(rawVal)); }
        const full = reg.type === 'textarea' ? ' style="grid-column:1/-1"' : '';
        html += `<div class="info-item"${full}><label>${esc(f.label)}</label><span>${disp}</span></div>`;
      });
      html += `</div></div>`;
    });

    // Certificates — always at the bottom
    const idCerts    = certs.filter(x => CERT_ID_TYPES.includes(x.cert_type));
    const stcwCerts  = certs.filter(x => CERT_STCW_TYPES.includes(x.cert_type));
    const visaCerts  = certs.filter(x => CERT_VISA_TYPES.includes(x.cert_type));
    const otherCerts = certs.filter(x => ![...CERT_ID_TYPES,...CERT_STCW_TYPES,...CERT_VISA_TYPES].includes(x.cert_type));
    html += `<div style="border-top:1px solid var(--border);padding-top:20px;margin-bottom:20px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
        <div style="${SL}margin-bottom:0">Identity Documents</div>
        <button class="btn btn-ghost btn-sm" onclick="openAddCertModal('${esc(c.id)}')">+ Add Certificate</button>
      </div>
      ${renderCertGroup(idCerts, c.id)}
      <div style="${SL}margin-top:16px">STCW Certificates</div>
      ${renderCertGroup(stcwCerts, c.id)}
      <div style="${SL}margin-top:16px">Visas</div>
      ${renderCertGroup(visaCerts, c.id)}
      ${otherCerts.length ? `<div style="${SL}margin-top:16px">Other</div>${renderCertGroup(otherCerts, c.id)}` : ''}
    </div>`;

    el.innerHTML = html;
    return;
  }

  if (c.pipeline === 'J1_PROGRAM') {
    const jp = c.j1Profile || {};
    let eligibleTags = '—';
    if (jp.eligible_programs) {
      try {
        const arr = JSON.parse(jp.eligible_programs);
        eligibleTags = Array.isArray(arr) && arr.length
          ? arr.map(p2 => `<span style="display:inline-block;background:var(--navy-mid);border-radius:4px;padding:2px 8px;font-size:.78rem;margin:2px">${esc(p2)}</span>`).join(' ')
          : esc(jp.eligible_programs);
      } catch { eligibleTags = esc(jp.eligible_programs); }
    }
    el.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
        <h4 style="margin:0;font-size:.9rem;">J1 Profile</h4>
        <button class="btn btn-primary btn-sm" onclick="openEditJ1ProfileModal('${esc(c.id)}')">Edit Profile</button>
      </div>
      <div style="margin-bottom:20px">
        <div style="font-size:.72rem;text-transform:uppercase;color:var(--text-muted);letter-spacing:.06em;margin-bottom:10px;">Application Info</div>
        <div class="info-grid">
          <div class="info-item"><label>Application Status</label><span>${esc(jp.j1_application_status||'—')}</span></div>
          <div class="info-item"><label>Program Sources</label><span>${esc(jp.j1_program_sources||'—')}</span></div>
          <div class="info-item"><label>CTI USA Review</label><span>${esc(jp.cti_usa_review||'—')}</span></div>
          <div class="info-item" style="grid-column:1/-1"><label>Eligible Programs</label><span>${eligibleTags}</span></div>
        </div>
      </div>
      <div style="margin-bottom:20px">
        <div style="font-size:.72rem;text-transform:uppercase;color:var(--text-muted);letter-spacing:.06em;margin-bottom:10px;">Consultation Call</div>
        <div class="info-grid">
          <div class="info-item"><label>Call Date</label><span>${fmtDate(jp.consultation_call_date)}</span></div>
          <div class="info-item"><label>Called By</label><span>${esc(jp.consultation_call_by||'—')}</span></div>
          <div class="info-item"><label>Call Status</label><span>${esc(jp.consultation_call_status||'—')}</span></div>
          <div class="info-item" style="grid-column:1/-1"><label>Call Notes</label><span style="white-space:pre-wrap">${esc(jp.consultation_call_notes||'—')}</span></div>
        </div>
      </div>
      <div style="margin-bottom:20px">
        <div style="font-size:.72rem;text-transform:uppercase;color:var(--text-muted);letter-spacing:.06em;margin-bottom:10px;">Assessment</div>
        <div class="info-grid">
          <div class="info-item"><label>English Assessment</label><span>${esc(jp.english_assessment||'—')}</span></div>
          <div class="info-item"><label>Participant Rating</label><span>${esc(jp.participant_rating||'—')}</span></div>
          <div class="info-item"><label>Attendance</label><span>${esc(jp.attendance||'—')}</span></div>
        </div>
      </div>
      <div style="margin-bottom:20px">
        <div style="font-size:.72rem;text-transform:uppercase;color:var(--text-muted);letter-spacing:.06em;margin-bottom:10px;">Program Placement</div>
        <div class="info-grid">
          <div class="info-item"><label>Hosting Company</label><span>${esc(jp.hosting_company||'—')}</span></div>
          <div class="info-item"><label>Selected Job</label><span>${esc(jp.selected_job||'—')}</span></div>
          <div class="info-item"><label>Occupational Fields</label><span>${esc(jp.occupational_fields||'—')}</span></div>
          <div class="info-item"><label>Processing Sponsor</label><span>${esc(jp.processing_sponsor||'—')}</span></div>
          <div class="info-item"><label>Ticket Pricing</label><span>${jp.ticket_pricing!=null?`$${Number(jp.ticket_pricing).toLocaleString()}`:'—'}</span></div>
          <div class="info-item"><label>Program Start</label><span>${fmtDate(jp.program_start_date)}</span></div>
          <div class="info-item"><label>Program End</label><span>${fmtDate(jp.program_end_date)}</span></div>
        </div>
      </div>
      <div style="margin-bottom:20px">
        <div style="font-size:.72rem;text-transform:uppercase;color:var(--text-muted);letter-spacing:.06em;margin-bottom:10px;">Investment</div>
        <div class="info-grid">
          <div class="info-item"><label>Total Paid</label><span>${jp.total_paid_investment!=null?`$${Number(jp.total_paid_investment).toLocaleString()}`:'—'}</span></div>
          <div class="info-item"><label>Stage 1</label><span>${jp.stage1_investment!=null?`$${Number(jp.stage1_investment).toLocaleString()}`:'—'}</span></div>
          <div class="info-item"><label>Stage 2</label><span>${jp.stage2_investment!=null?`$${Number(jp.stage2_investment).toLocaleString()}`:'—'}</span></div>
          <div class="info-item"><label>Stage 3</label><span>${jp.stage3_investment!=null?`$${Number(jp.stage3_investment).toLocaleString()}`:'—'}</span></div>
          <div class="info-item"><label>Stage 4</label><span>${jp.stage4_investment!=null?`$${Number(jp.stage4_investment).toLocaleString()}`:'—'}</span></div>
        </div>
      </div>
      <div>
        <div style="font-size:.72rem;text-transform:uppercase;color:var(--text-muted);letter-spacing:.06em;margin-bottom:10px;">Housing</div>
        <div class="info-grid">
          <div class="info-item"><label>Landlord</label><span>${esc(jp.housing_landlord||'—')}</span></div>
          <div class="info-item"><label>Address</label><span>${esc(jp.housing_address||'—')}</span></div>
          <div class="info-item"><label>Sponsor Invoice Status</label><span>${esc(jp.program_sponsor_invoice_status||'—')}</span></div>
        </div>
      </div>`;
    return;
  }

  el.innerHTML = `
    <div style="margin-bottom:16px"><h4 style="margin:0;font-size:.9rem;">Land-Based Profile</h4></div>
    <div class="info-grid" style="margin-bottom:16px">
      <div class="info-item"><label>Position Applied</label><span>${esc(c.position_applied||'—')}</span></div>
    </div>
    <p class="text-sm" style="color:var(--text-muted)">Land-Based profile fields coming soon.</p>`;
}

function certExpiryBadge(expiry) {
  if (!expiry) return '<span style="color:var(--text-muted)">—</span>';
  const days = Math.floor((new Date(expiry) - new Date()) / 86400000);
  if (days < 0)  return `<span style="color:#f87171;font-weight:600">${fmtDate(expiry)} <small style="opacity:.8">(Expired)</small></span>`;
  if (days < 90) return `<span style="color:#fbbf24;font-weight:600">${fmtDate(expiry)} <small style="opacity:.8">(${days}d left)</small></span>`;
  return `<span style="color:#4ade80">${fmtDate(expiry)}</span>`;
}

function renderCertGroup(certs, candidateId) {
  if (!certs.length) return `<p style="color:var(--text-muted);font-size:12px;padding:8px 0">None added.</p>`;
  return `<table style="width:100%;border-collapse:collapse;margin-bottom:4px">
    <thead><tr>
      <th style="font-size:11px;color:var(--text-muted);text-align:left;padding:5px 6px;border-bottom:1px solid var(--border)">Certificate</th>
      <th style="font-size:11px;color:var(--text-muted);text-align:left;padding:5px 6px;border-bottom:1px solid var(--border)">Number</th>
      <th style="font-size:11px;color:var(--text-muted);text-align:left;padding:5px 6px;border-bottom:1px solid var(--border)">Status</th>
      <th style="font-size:11px;color:var(--text-muted);text-align:left;padding:5px 6px;border-bottom:1px solid var(--border)">Expiry</th>
      <th style="border-bottom:1px solid var(--border)"></th>
    </tr></thead>
    <tbody>
      ${certs.map(cert => {
        const meta = CERT_TYPES.find(t => t.type === cert.cert_type) || { label: cert.cert_type };
        const sc = cert.cert_status==='Active'?'#4ade80':cert.cert_status==='Expired'?'#f87171':'var(--text-muted)';
        return `<tr style="border-bottom:1px solid var(--border)22">
          <td style="padding:6px;font-size:12px;font-weight:500">${esc(cert.cert_name||meta.label)}</td>
          <td style="padding:6px;font-size:12px">${esc(cert.cert_number||'—')}</td>
          <td style="padding:6px;font-size:12px"><span style="color:${sc}">${esc(cert.cert_status||'—')}</span></td>
          <td style="padding:6px;font-size:12px">${certExpiryBadge(cert.expiry_date)}</td>
          <td style="padding:6px;text-align:right;white-space:nowrap">
            <button class="btn btn-ghost btn-sm" style="padding:2px 8px;font-size:11px" onclick="openEditCertModal('${esc(cert.id)}','${esc(candidateId)}')">Edit</button>
            <button class="btn btn-ghost btn-sm" style="padding:2px 8px;font-size:11px;color:#f87171" onclick="deleteCert('${esc(cert.id)}','${esc(candidateId)}')">✕</button>
          </td>
        </tr>`;
      }).join('')}
    </tbody>
  </table>`;
}

function buildCertFields(meta, cert) {
  const statuses = ['Active','Pending','Expired','Rejected','Not Applicable'];
  let html = '';
  if (meta.hasCustomName) html += `<div class="form-group"><label>Certificate Name</label><input type="text" id="cert-name" value="${esc(cert.cert_name||'')}"></div>`;
  if (!meta.noNumber) {
    html += `<div class="form-row"><div class="form-group"><label>Number</label><input type="text" id="cert-number" value="${esc(cert.cert_number||'')}"></div>
    <div class="form-group"><label>Status</label><select id="cert-status"><option value="">— Select —</option>${statuses.map(s=>`<option value="${s}" ${cert.cert_status===s?'selected':''}>${s}</option>`).join('')}</select></div></div>`;
  } else {
    html += `<div class="form-group"><label>Status</label><select id="cert-status"><option value="">— Select —</option>${statuses.map(s=>`<option value="${s}" ${cert.cert_status===s?'selected':''}>${s}</option>`).join('')}</select></div>`;
  }
  html += `<div class="form-row">
    <div class="form-group"><label>Issued Date</label><input type="date" id="cert-issued-date" value="${esc(cert.issued_date||'')}"></div>
    <div class="form-group"><label>Expiry Date</label><input type="date" id="cert-expiry-date" value="${esc(cert.expiry_date||'')}"></div>
    ${meta.hasAppointment?`<div class="form-group"><label>Appointment Date</label><input type="date" id="cert-appt-date" value="${esc(cert.appointment_date||'')}"></div>`:'<input type="hidden" id="cert-appt-date" value="">'}
  </div>`;
  if (meta.hasIssuedNation||meta.hasIssuedPlace) {
    html += `<div class="form-row">`;
    if (meta.hasIssuedNation) html += `<div class="form-group"><label>Issued Nation</label><input type="text" id="cert-issued-nation" value="${esc(cert.issued_nation||'')}"></div>`;
    if (meta.hasIssuedPlace)  html += `<div class="form-group"><label>Issued Place</label><input type="text" id="cert-issued-place" value="${esc(cert.issued_place||'')}"></div>`;
    html += `</div>`;
  } else {
    html += `<input type="hidden" id="cert-issued-nation" value=""><input type="hidden" id="cert-issued-place" value="">`;
  }
  if (meta.hasExtraNumber) html += `<div class="form-group"><label>MCV Passport Number</label><input type="text" id="cert-extra-number" value="${esc(cert.extra_number||'')}"></div>`;
  else html += `<input type="hidden" id="cert-extra-number" value="">`;
  if (meta.hasCost) html += `<div class="form-group"><label>Cost ($)</label><input type="number" step="0.01" id="cert-cost" value="${cert.cost!=null?cert.cost:''}"></div>`;
  else html += `<input type="hidden" id="cert-cost" value="">`;
  html += `<div class="form-group"><label>Notes</label><textarea id="cert-notes" rows="2" style="width:100%;background:var(--input-bg);border:1px solid var(--border);color:var(--text);border-radius:6px;padding:8px;font-size:13px;resize:vertical;">${esc(cert.notes||'')}</textarea></div>`;
  return html;
}

function onCertTypeChange() {
  const type = document.getElementById('cert-type').value;
  const meta = CERT_TYPES.find(t => t.type === type) || {};
  document.getElementById('cert-dynamic-fields').innerHTML = type ? buildCertFields(meta, {}) : '';
}

function openAddCertModal(candidateId) {
  openModal('Add Certificate', `
    <div class="form-group"><label>Certificate Type</label>
      <select id="cert-type" onchange="onCertTypeChange()">
        <option value="">— Select Type —</option>
        ${CERT_TYPES.map(t=>`<option value="${t.type}">${t.label}</option>`).join('')}
      </select>
    </div>
    <div id="cert-dynamic-fields"></div>
    <div class="modal-footer">
      <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="saveCert('${esc(candidateId)}',null)">Add</button>
    </div>`, 'modal-lg');
}

function openEditCertModal(certId, candidateId) {
  const cert = (STATE.currentCandidate?.certificates||[]).find(x=>x.id===certId);
  if (!cert) return;
  const meta = CERT_TYPES.find(t=>t.type===cert.cert_type)||{label:cert.cert_type};
  openModal(`Edit — ${meta.label||cert.cert_type}`, `
    <div id="cert-dynamic-fields">${buildCertFields(meta, cert)}</div>
    <div class="modal-footer">
      <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="saveCert('${esc(candidateId)}','${esc(certId)}')">Save</button>
    </div>`, 'modal-lg');
}

async function saveCert(candidateId, certId) {
  const type = certId ? null : document.getElementById('cert-type')?.value;
  if (!certId && !type) { toast('Select a certificate type', 'error'); return; }
  const g = id => { const el=document.getElementById(id); return el?el.value.trim()||undefined:undefined; };
  const d = id => { const el=document.getElementById(id); return el?el.value||undefined:undefined; };
  const n = id => { const el=document.getElementById(id); return el&&el.value!==''?Number(el.value):undefined; };
  const body = {
    certType:        type||undefined,
    certName:        g('cert-name'),
    certNumber:      g('cert-number'),
    certStatus:      g('cert-status'),
    issuedDate:      d('cert-issued-date'),
    expiryDate:      d('cert-expiry-date'),
    appointmentDate: d('cert-appt-date'),
    issuedNation:    g('cert-issued-nation'),
    issuedPlace:     g('cert-issued-place'),
    extraNumber:     g('cert-extra-number'),
    cost:            n('cert-cost'),
    notes:           g('cert-notes'),
  };
  try {
    if (certId) await api('PATCH', `/candidates/${candidateId}/certificates/${certId}`, body);
    else        await api('POST',  `/candidates/${candidateId}/certificates`, body);
    closeModal();
    toast(`Certificate ${certId?'updated':'added'}`, 'success');
    const certs = await api('GET', `/candidates/${candidateId}/certificates`);
    STATE.currentCandidate.certificates = certs;
    renderDetailProfile(STATE.currentCandidate);
  } catch(e) { toast(e.message, 'error'); }
}

async function deleteCert(certId, candidateId) {
  if (!confirm('Delete this certificate?')) return;
  try {
    await api('DELETE', `/candidates/${candidateId}/certificates/${certId}`);
    toast('Certificate deleted', 'success');
    STATE.currentCandidate.certificates = (STATE.currentCandidate.certificates||[]).filter(x=>x.id!==certId);
    renderDetailProfile(STATE.currentCandidate);
  } catch(e) { toast(e.message, 'error'); }
}

// ── Settings View ─────────────────────────────────────────────────────────────

function loadSettings() {
  const el = document.getElementById('settings-content');
  if (!el) return;
  el.innerHTML = `
    <div style="max-width:860px">
      <div class="local-settings-card">
        <div class="section-title">System Settings</div>
        <div style="color:var(--text-muted);font-size:.85rem;line-height:1.6">
          Candidate profile field configuration now lives inside each workspace.
          Open a workspace, then go to <strong style="color:var(--text)">Local Settings → Field Configuration</strong> to manage its profile fields.
        </div>
      </div>
    </div>`;
}

// ── Seafarer Field Settings ───────────────────────────────────────────────────

async function openSfFieldSettings() {
  if (STATE.sfFieldConfig === undefined) {
    try { STATE.sfFieldConfig = await api('GET', '/settings/seafarer-fields') || {}; }
    catch { STATE.sfFieldConfig = {}; }
  }
  STATE._sfEditConfig = JSON.parse(JSON.stringify(getMergedSfConfig()));
  _sfCurrentSection = STATE._sfEditConfig.sections[0]?.id || 'personal';
  _renderSfSettingsModal();
}

function _renderSfSettingsModal() {
  const curSec = STATE._sfEditConfig.sections.find(s => s.id === _sfCurrentSection);
  openModal('Configure Seafarer Fields', `
    <div style="display:flex;gap:0;min-height:520px;max-height:72vh">
      <!-- Left sidebar -->
      <div style="width:210px;flex-shrink:0;border-right:1px solid var(--border);padding-right:12px;display:flex;flex-direction:column">
        <div style="font-size:10px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px;padding:0 4px">Sections</div>
        <div id="sf-sections-sidebar" style="flex:1;overflow-y:auto;min-height:0">${_buildSfSidebar()}</div>
        <div style="padding-top:8px;border-top:1px solid var(--border);margin-top:6px">
          <button class="btn btn-ghost btn-sm" onclick="sfSecAdd()" style="width:100%;font-size:12px">+ Add Section</button>
        </div>
      </div>
      <!-- Right panel -->
      <div style="flex:1;display:flex;flex-direction:column;min-width:0;padding-left:16px">
        <!-- Sticky toolbar -->
        <div style="display:flex;align-items:center;justify-content:space-between;padding-bottom:8px;border-bottom:1px solid var(--border);margin-bottom:8px;flex-shrink:0">
          <span id="sf-panel-title" style="font-weight:700;color:var(--blue);font-size:14px">${esc(curSec?.label||'')}</span>
          <div style="display:flex;gap:6px">
            <button class="btn btn-ghost btn-sm" onclick="sfSecDelete(_sfCurrentSection)" style="color:var(--danger);font-size:12px">Delete Section</button>
            <button class="btn btn-primary btn-sm" onclick="sfShowAddFieldRow()" style="font-size:12px">+ Add Field</button>
          </div>
        </div>
        <!-- Scrollable fields table -->
        <div style="flex:1;overflow-y:auto;min-height:0" id="sf-fields-content">${_buildSfSectionRows(_sfCurrentSection)}</div>
        <!-- Add field form (hidden, fixed below table) -->
        <div id="sf-add-field-form" style="display:none;margin-top:10px;background:var(--navy-mid);border:1px solid var(--blue);border-radius:8px;padding:12px;flex-shrink:0">
          <div style="font-size:12px;font-weight:600;color:var(--blue);margin-bottom:10px">New Field</div>
          <div style="display:flex;gap:10px;align-items:flex-end;flex-wrap:wrap">
            <div style="flex:1;min-width:130px">
              <div style="font-size:10px;color:var(--text-muted);margin-bottom:4px">Label</div>
              <input type="text" id="sf-new-label" placeholder="e.g. Passport Country"
                style="width:100%;background:var(--input-bg);border:1px solid var(--border);color:var(--text);border-radius:4px;padding:5px 8px;font-size:13px;outline:none;box-sizing:border-box">
            </div>
            <div style="min-width:120px">
              <div style="font-size:10px;color:var(--text-muted);margin-bottom:4px">Type</div>
              <select id="sf-new-type"
                style="width:100%;background:var(--input-bg);border:1px solid var(--border);color:var(--text);border-radius:4px;padding:5px 8px;font-size:13px;outline:none">
                <option value="text">Text</option>
                <option value="number">Number</option>
                <option value="date">Date</option>
                <option value="select">Dropdown</option>
                <option value="checkbox">Checkbox</option>
                <option value="textarea">Textarea</option>
                <option value="email">Email</option>
                <option value="phone">Phone</option>
                <option value="currency">Currency</option>
              </select>
            </div>
            <div style="display:flex;gap:6px">
              <button class="btn btn-primary btn-sm" onclick="sfAddFieldCommit()">Add</button>
              <button class="btn btn-ghost btn-sm" onclick="sfShowAddFieldRow()">Cancel</button>
            </div>
          </div>
        </div>
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="saveSfFieldConfig()">Save Changes</button>
    </div>`, 'modal-xl');
}

function _buildSfSidebar() {
  const config = STATE._sfEditConfig;
  const n = config.sections.length;
  return config.sections.map((s, i) => {
    const active = s.id === _sfCurrentSection;
    const stop = 'event.stopPropagation();';
    const arrowBtn = 'padding:2px 5px;font-size:11px;line-height:1;min-width:22px;flex-shrink:0;';
    return `<div id="sf-sec-row-${esc(s.id)}" style="display:flex;align-items:center;gap:2px;margin-bottom:2px;border-radius:6px;padding:3px 6px;cursor:pointer;${active?'background:var(--navy-mid);':''}"
      onclick="selectSfSection('${esc(s.id)}')">
      <input type="text" value="${esc(s.label)}"
        onclick="event.stopPropagation()"
        onfocus="selectSfSection('${esc(s.id)}');this.style.borderBottomColor='var(--blue)';this.style.cursor='text'"
        onblur="this.style.borderBottomColor='transparent';this.style.cursor='pointer'"
        onchange="sfSecRename('${esc(s.id)}',this.value)"
        style="flex:1;min-width:0;background:transparent;border:none;border-bottom:1px solid transparent;
          color:${active?'var(--text)':'var(--text-muted)'};font-size:13px;${active?'font-weight:600;':''}
          outline:none;cursor:pointer;">
      <button class="btn btn-ghost btn-sm" onclick="${stop}sfSecMoveUp('${esc(s.id)}')"
        title="Move up" style="${arrowBtn}${i===0?'opacity:.2;pointer-events:none;':''}">↑</button>
      <button class="btn btn-ghost btn-sm" onclick="${stop}sfSecMoveDown('${esc(s.id)}')"
        title="Move down" style="${arrowBtn}${i===n-1?'opacity:.2;pointer-events:none;':''}">↓</button>
      <button class="btn btn-ghost btn-sm" onclick="${stop}sfSecDelete('${esc(s.id)}')"
        title="Delete section" style="${arrowBtn}color:var(--danger);opacity:.5;">×</button>
    </div>`;
  }).join('');
}

function _refreshSfSidebarStyles() {
  STATE._sfEditConfig.sections.forEach(s => {
    const row = document.getElementById(`sf-sec-row-${s.id}`);
    if (!row) return;
    const active = s.id === _sfCurrentSection;
    row.style.background = active ? 'var(--navy-mid)' : '';
    const inp = row.querySelector('input[type="text"]');
    if (inp && document.activeElement !== inp) {
      inp.style.color = active ? 'var(--text)' : 'var(--text-muted)';
      inp.style.fontWeight = active ? '600' : '';
    }
  });
}

function _buildSfSectionRows(sectionId) {
  const config = STATE._sfEditConfig;
  const fields = config.fields.filter(f => f.section === sectionId && !f._removed).sort((a,b) => a.order - b.order);
  const sectionOpts = config.sections.map(s => `<option value="${esc(s.id)}" ${s.id===sectionId?'selected':''}>${esc(s.label)}</option>`).join('');
  const rows = fields.map((f, i) => {
    const reg = SEAFARER_FIELD_REGISTRY.find(r => r.key === f.key) || {};
    const hasOpts = (f.type||reg.type) === 'select' || (f.options && f.options.length);
    const visColor = f.visible !== false ? '#4ade80' : 'var(--text-muted)';
    const ovrColor = f.showInOverview !== false ? 'var(--blue)' : 'var(--text-muted)';
    const fieldType = f.type || reg.type || 'text';
    return `<tr data-key="${esc(f.key)}" style="border-bottom:1px solid #ffffff0a">
      <td style="padding:7px 4px;color:var(--text-muted);font-size:16px;cursor:default;user-select:none">≡</td>
      <td style="padding:7px 8px;min-width:130px">
        <input type="text" value="${esc(f.label)}"
          onchange="sfFieldSetLabel('${esc(f.key)}',this.value)"
          style="background:transparent;border:none;border-bottom:1px solid transparent;color:var(--text);font-size:13px;width:100%;outline:none;"
          onfocus="this.style.borderBottomColor='var(--blue)'"
          onblur="this.style.borderBottomColor='transparent'">
      </td>
      <td style="padding:7px 6px;font-size:11px;color:var(--text-muted);width:64px">${fieldType}</td>
      <td style="padding:7px 6px;width:130px">
        <select onchange="sfFieldMoveToSection('${esc(f.key)}',this.value)"
          style="font-size:11px;background:var(--navy-mid);border:1px solid var(--border);color:var(--text);border-radius:4px;padding:3px 6px;width:100%">${sectionOpts}</select>
      </td>
      <td style="padding:7px 6px;width:230px" id="sf-stg-${esc(f.key)}">${_buildSfFieldStageChips(f)}</td>
      <td style="padding:7px 4px;white-space:nowrap;width:56px">
        ${i>0?`<button class="btn btn-ghost btn-sm" style="padding:2px 5px;font-size:11px" onclick="sfFieldMoveUp('${esc(f.key)}')">↑</button>`:'<span style="display:inline-block;width:24px"></span>'}
        ${i<fields.length-1?`<button class="btn btn-ghost btn-sm" style="padding:2px 5px;font-size:11px" onclick="sfFieldMoveDown('${esc(f.key)}')">↓</button>`:''}
      </td>
      <td style="padding:7px 6px;white-space:nowrap;width:84px">
        ${hasOpts?`<button class="btn btn-ghost btn-sm" style="padding:2px 7px;font-size:11px" onclick="openSfFieldOpts('${esc(f.key)}')">Edit Options</button>`:''}
      </td>
      <td style="padding:7px 4px;width:56px;text-align:center">
        <label style="cursor:pointer;font-size:11px;color:${visColor};white-space:nowrap">
          <input type="checkbox" ${f.visible!==false?'checked':''} onchange="sfFieldToggleVisible('${esc(f.key)}',this.checked)" style="margin-right:3px">
          ${f.visible!==false?'On':'Off'}
        </label>
      </td>
      <td style="padding:7px 4px;width:62px;text-align:center">
        <label style="cursor:pointer;font-size:11px;color:${ovrColor};white-space:nowrap">
          <input type="checkbox" ${f.showInOverview!==false?'checked':''} onchange="sfFieldToggleOverview('${esc(f.key)}',this.checked)" style="margin-right:3px">
          ${f.showInOverview!==false?'On':'Off'}
        </label>
      </td>
      <td style="padding:7px 4px;width:28px;text-align:center">
        <button class="btn btn-ghost btn-sm" onclick="sfFieldDelete('${esc(f.key)}')"
          style="padding:1px 6px;font-size:14px;color:var(--danger);opacity:.6;min-width:0" title="Delete field">×</button>
      </td>
    </tr>`;
  }).join('');

  if (!fields.length) return `<p style="color:var(--text-muted);font-size:13px;padding:12px 0">No fields yet — click <strong>+ Add Field</strong> above to add one.</p>`;

  return `<table style="width:100%;border-collapse:collapse">
    <thead><tr style="border-bottom:1px solid var(--border)">
      <th style="font-size:10px;color:var(--text-muted);padding:6px 4px"></th>
      <th style="font-size:10px;color:var(--text-muted);padding:6px 8px;text-align:left">Label</th>
      <th style="font-size:10px;color:var(--text-muted);padding:6px;text-align:left">Type</th>
      <th style="font-size:10px;color:var(--text-muted);padding:6px;text-align:left">Move to Section</th>
      <th style="font-size:10px;color:var(--text-muted);padding:6px;text-align:left" title="Stages where this field is visible. Click chips to toggle; empty = visible at every stage.">Visible Stages</th>
      <th style="font-size:10px;color:var(--text-muted);padding:6px;text-align:left">Order</th>
      <th style="font-size:10px;color:var(--text-muted);padding:6px;text-align:left">Options</th>
      <th style="font-size:10px;color:var(--text-muted);padding:6px;text-align:center">Visible</th>
      <th style="font-size:10px;color:var(--text-muted);padding:6px;text-align:center">Overview</th>
      <th style="font-size:10px;color:var(--text-muted);padding:6px"></th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

function selectSfSection(sectionId) {
  if (_sfCurrentSection === sectionId) return;
  _sfCurrentSection = sectionId;
  _refreshSfSidebarStyles();
  const s = STATE._sfEditConfig.sections.find(x => x.id === sectionId);
  const title = document.getElementById('sf-panel-title');
  if (title && s) title.textContent = s.label;
  const form = document.getElementById('sf-add-field-form');
  if (form) form.style.display = 'none';
  const content = document.getElementById('sf-fields-content');
  if (content) content.innerHTML = _buildSfSectionRows(sectionId);
}

function sfSecRename(id, label) {
  const s = STATE._sfEditConfig.sections.find(x => x.id === id);
  if (!s) return;
  s.label = label;
  // keep the panel title and section-move dropdowns in sync
  if (id === _sfCurrentSection) {
    const title = document.getElementById('sf-panel-title');
    if (title) title.textContent = label;
  }
  document.querySelectorAll(`#sf-fields-content select option[value="${id}"]`).forEach(o => { o.textContent = label; });
}

function sfSecMoveUp(id) {
  const secs = STATE._sfEditConfig.sections;
  const idx = secs.findIndex(s => s.id === id);
  if (idx <= 0) return;
  [secs[idx], secs[idx-1]] = [secs[idx-1], secs[idx]];
  const sidebar = document.getElementById('sf-sections-sidebar');
  if (sidebar) sidebar.innerHTML = _buildSfSidebar();
}

function sfSecMoveDown(id) {
  const secs = STATE._sfEditConfig.sections;
  const idx = secs.findIndex(s => s.id === id);
  if (idx < 0 || idx >= secs.length - 1) return;
  [secs[idx], secs[idx+1]] = [secs[idx+1], secs[idx]];
  const sidebar = document.getElementById('sf-sections-sidebar');
  if (sidebar) sidebar.innerHTML = _buildSfSidebar();
}

function sfSecAdd() {
  const id = 'custom_sec_' + Date.now();
  STATE._sfEditConfig.sections.push({ id, label: 'New Section' });
  _sfCurrentSection = id;
  const sidebar = document.getElementById('sf-sections-sidebar');
  if (sidebar) sidebar.innerHTML = _buildSfSidebar();
  const title = document.getElementById('sf-panel-title');
  if (title) title.textContent = 'New Section';
  const form = document.getElementById('sf-add-field-form');
  if (form) form.style.display = 'none';
  const content = document.getElementById('sf-fields-content');
  if (content) content.innerHTML = _buildSfSectionRows(id);
  setTimeout(() => {
    const row = document.getElementById(`sf-sec-row-${id}`);
    const inp = row?.querySelector('input[type="text"]');
    if (inp) { inp.select(); inp.focus(); }
  }, 40);
}

function sfSecDelete(id) {
  const secs = STATE._sfEditConfig.sections;
  if (secs.length <= 1) { toast('Cannot delete the last section', 'error'); return; }
  const firstOther = secs.find(s => s.id !== id);
  STATE._sfEditConfig.fields.forEach(f => { if (f.section === id) f.section = firstOther.id; });
  STATE._sfEditConfig.sections = secs.filter(s => s.id !== id);
  if (_sfCurrentSection === id) _sfCurrentSection = STATE._sfEditConfig.sections[0].id;
  const sidebar = document.getElementById('sf-sections-sidebar');
  if (sidebar) sidebar.innerHTML = _buildSfSidebar();
  const title = document.getElementById('sf-panel-title');
  const cur = STATE._sfEditConfig.sections.find(s => s.id === _sfCurrentSection);
  if (title && cur) title.textContent = cur.label;
  const form = document.getElementById('sf-add-field-form');
  if (form) form.style.display = 'none';
  const content = document.getElementById('sf-fields-content');
  if (content) content.innerHTML = _buildSfSectionRows(_sfCurrentSection);
  toast(`Section deleted — fields moved to "${firstOther.label}"`, 'info');
}

function sfFieldDelete(key) {
  const f = STATE._sfEditConfig.fields.find(x => x.key === key);
  if (!f) return;
  if (f.custom) {
    STATE._sfEditConfig.fields = STATE._sfEditConfig.fields.filter(x => x.key !== key);
  } else {
    // registry field: hide rather than truly delete (will restore on next config load)
    f.visible = false;
    f._removed = true;
  }
  const content = document.getElementById('sf-fields-content');
  if (content) content.innerHTML = _buildSfSectionRows(_sfCurrentSection);
}

function sfShowAddFieldRow() {
  const form = document.getElementById('sf-add-field-form');
  if (!form) return;
  const visible = form.style.display !== 'none';
  form.style.display = visible ? 'none' : '';
  if (!visible) setTimeout(() => document.getElementById('sf-new-label')?.focus(), 30);
}

function sfAddFieldCommit() {
  const labelEl = document.getElementById('sf-new-label');
  const typeEl  = document.getElementById('sf-new-type');
  const label = labelEl?.value.trim();
  const type  = typeEl?.value || 'text';
  if (!label) { toast('Enter a field label', 'error'); labelEl?.focus(); return; }
  const key = 'custom_' + Date.now();
  const maxOrd = Math.max(-1, ...STATE._sfEditConfig.fields.filter(f => f.section === _sfCurrentSection).map(f => f.order));
  STATE._sfEditConfig.fields.push({
    key, label, type, section: _sfCurrentSection, source: 'custom',
    order: maxOrd + 1, visible: true,
    options: type === 'select' ? [] : undefined,
    custom: true
  });
  if (labelEl) labelEl.value = '';
  if (typeEl) typeEl.value = 'text';
  const form = document.getElementById('sf-add-field-form');
  if (form) form.style.display = 'none';
  const content = document.getElementById('sf-fields-content');
  if (content) content.innerHTML = _buildSfSectionRows(_sfCurrentSection);
}

function sfFieldSetLabel(key, value) {
  const f = STATE._sfEditConfig.fields.find(x => x.key === key);
  if (f) f.label = value;
}

function sfFieldMoveToSection(key, newSec) {
  const f = STATE._sfEditConfig.fields.find(x => x.key === key);
  if (!f) return;
  f.section = newSec;
  const maxOrd = Math.max(-1, ...STATE._sfEditConfig.fields.filter(x => x.section === newSec && x.key !== key).map(x => x.order));
  f.order = maxOrd + 1;
  const content = document.getElementById('sf-fields-content');
  if (content) content.innerHTML = _buildSfSectionRows(_sfCurrentSection);
}

function sfFieldMoveUp(key) {
  const fields = STATE._sfEditConfig.fields.filter(f => f.section === _sfCurrentSection && !f._removed).sort((a,b) => a.order - b.order);
  const idx = fields.findIndex(f => f.key === key);
  if (idx <= 0) return;
  [fields[idx].order, fields[idx-1].order] = [fields[idx-1].order, fields[idx].order];
  fields.sort((a,b)=>a.order-b.order).forEach((f,i) => f.order = i);
  const content = document.getElementById('sf-fields-content');
  if (content) content.innerHTML = _buildSfSectionRows(_sfCurrentSection);
}

function sfFieldMoveDown(key) {
  const fields = STATE._sfEditConfig.fields.filter(f => f.section === _sfCurrentSection && !f._removed).sort((a,b) => a.order - b.order);
  const idx = fields.findIndex(f => f.key === key);
  if (idx < 0 || idx >= fields.length - 1) return;
  [fields[idx].order, fields[idx+1].order] = [fields[idx+1].order, fields[idx].order];
  fields.sort((a,b)=>a.order-b.order).forEach((f,i) => f.order = i);
  const content = document.getElementById('sf-fields-content');
  if (content) content.innerHTML = _buildSfSectionRows(_sfCurrentSection);
}

function sfFieldToggleVisible(key, visible) {
  const f = STATE._sfEditConfig.fields.find(x => x.key === key);
  if (f) { f.visible = visible; }
}
function sfFieldToggleOverview(key, checked) {
  const f = STATE._sfEditConfig.fields.find(x => x.key === key);
  if (f) f.showInOverview = checked;
}

// Build the per-field stage chip strip (multi-select). Empty/null = visible at
// all stages, rendered with all chips lit + an "All" tag.
function _buildSfFieldStageChips(f) {
  const stages = _sfFieldEffectiveStages(f);
  const all = !stages || stages.length === 0;
  const chips = SF_FIELD_STAGES.map(s => {
    const on = all || stages.includes(s.id);
    const bg = on ? '#1e3a5f' : 'transparent';
    const fg = on ? '#93c5fd' : 'var(--text-muted)';
    const br = on ? '1px solid var(--blue)' : '1px solid var(--border)';
    return `<button type="button" onclick="sfFieldToggleStage('${esc(f.key)}','${esc(s.id)}')"
      title="${esc(s.label)}"
      style="background:${bg};color:${fg};border:${br};border-radius:10px;padding:1px 7px;font-size:10px;cursor:pointer;line-height:1.4">${esc(SF_STAGE_SHORT[s.id])}</button>`;
  }).join(' ');
  return `<div style="display:flex;flex-wrap:wrap;gap:3px;align-items:center">${chips}</div>`;
}

// Toggle a single stage for a field. Promotes the null/empty default into an
// explicit array on first click. If toggling fills every stage back, normalizes
// to null so the field saves as "all stages" again.
function sfFieldToggleStage(key, stageId) {
  const f = STATE._sfEditConfig.fields.find(x => x.key === key);
  if (!f) return;
  let stages = _sfFieldEffectiveStages(f);
  if (!stages || stages.length === 0) {
    stages = SF_FIELD_STAGES.map(s => s.id);    // first click: start from "all selected"
  } else {
    stages = [...stages];
  }
  const i = stages.indexOf(stageId);
  if (i >= 0) stages.splice(i, 1); else stages.push(stageId);
  f.appearsStages = stages.length === SF_FIELD_STAGES.length ? null : stages;
  delete f.appearsAt;   // legacy key always cleared on edit
  const cell = document.getElementById(`sf-stg-${key}`);
  if (cell) cell.innerHTML = _buildSfFieldStageChips(f);
}

function openSfFieldOpts(key) {
  const existing = document.getElementById(`sf-opts-row-${key}`);
  if (existing) { existing.remove(); return; }
  const f   = STATE._sfEditConfig.fields.find(x => x.key === key);
  const reg = SEAFARER_FIELD_REGISTRY.find(r => r.key === key) || {};
  const opts = (f?.options || reg.options || []).join('\n');
  const tr   = document.querySelector(`tr[data-key="${key}"]`);
  if (!tr) return;
  const editorRow = document.createElement('tr');
  editorRow.id = `sf-opts-row-${key}`;
  editorRow.innerHTML = `<td colspan="7" style="padding:10px 12px;background:var(--navy-mid);border-bottom:1px solid var(--border)">
    <div style="font-size:11px;color:var(--text-muted);margin-bottom:6px">Options for <strong style="color:var(--text)">${esc(f?.label||key)}</strong> — one per line:</div>
    <textarea id="sf-opts-ta-${key}" rows="6"
      style="width:100%;background:var(--input-bg);border:1px solid var(--border);color:var(--text);border-radius:6px;padding:8px;font-size:13px;resize:vertical;font-family:inherit">${esc(opts)}</textarea>
    <div style="display:flex;gap:8px;margin-top:8px">
      <button class="btn btn-primary btn-sm" onclick="sfSaveOpts('${esc(key)}')">Save Options</button>
      <button class="btn btn-ghost btn-sm" onclick="document.getElementById('sf-opts-row-${key}').remove()">Cancel</button>
    </div>
  </td>`;
  tr.after(editorRow);
}

function sfSaveOpts(key) {
  const ta = document.getElementById(`sf-opts-ta-${key}`);
  if (!ta) return;
  const opts = ta.value.split('\n').map(s => s.trim()).filter(Boolean);
  const f = STATE._sfEditConfig.fields.find(x => x.key === key);
  if (f) f.options = opts;
  document.getElementById(`sf-opts-row-${key}`)?.remove();
  toast('Options saved — click Save Changes to apply', 'info');
}

async function saveSfFieldConfig() {
  try {
    await api('PUT', '/settings/seafarer-fields', STATE._sfEditConfig);
    STATE.sfFieldConfig = STATE._sfEditConfig;
    delete STATE._sfEditConfig;
    closeModal();
    toast('Field configuration saved', 'success');
    if (STATE.currentCandidate) renderDetailProfile(STATE.currentCandidate);
  } catch(e) { toast(e.message, 'error'); }
}

function switchSfTab(name, el) {
  document.querySelectorAll('#sf-mtabs .sf-mtab').forEach(t => t.classList.remove('active'));
  el.classList.add('active');
  ['personal','onboarding','employment','compliance','banking'].forEach(t => {
    const panel = document.getElementById(`sf-mt-${t}`);
    if (panel) panel.style.display = (t === name) ? '' : 'none';
  });
}

function openEditSeafarerProfileModal(candidateId) {
  const sp = STATE.currentCandidate?.seafarerProfile || {};
  const c  = STATE.currentCandidate || {};
  openModal('Edit Seafarer Profile', `
    <div id="sf-mtabs" style="display:flex;gap:4px;border-bottom:1px solid var(--border);margin-bottom:16px;flex-wrap:wrap">
      <div class="sf-mtab tab active" onclick="switchSfTab('personal',this)">Personal</div>
      <div class="sf-mtab tab" onclick="switchSfTab('onboarding',this)">Onboarding</div>
      <div class="sf-mtab tab" onclick="switchSfTab('employment',this)">Employment</div>
      <div class="sf-mtab tab" onclick="switchSfTab('compliance',this)">Compliance</div>
      <div class="sf-mtab tab" onclick="switchSfTab('banking',this)">Banking & Costs</div>
    </div>

    <!-- PERSONAL -->
    <div id="sf-mt-personal">
      <div class="form-row">
        <div class="form-group"><label>Salutation</label>
          <select id="sf-salutation">${['','Mr.','Ms.','Mrs.','Dr.'].map(s=>`<option value="${s}" ${sp.salutation===s?'selected':''}>${s||'— Select —'}</option>`).join('')}</select>
        </div>
        <div class="form-group"><label>Date of Birth</label><input type="date" id="sf-dob" value="${esc(sp.date_of_birth||'')}"></div>
        <div class="form-group"><label>Place of Birth</label><input type="text" id="sf-pob" value="${esc(sp.place_of_birth||'')}"></div>
      </div>
      <div class="form-row">
        <div class="form-group"><label>Height (cm)</label><input type="number" id="sf-height" value="${sp.height!=null?sp.height:''}"></div>
        <div class="form-group"><label>Weight (kg)</label><input type="number" id="sf-weight" value="${sp.weight!=null?sp.weight:''}"></div>
        <div class="form-group"><label>Eye Color</label>
          <select id="sf-eye">${['','Brown','Black','Blue','Green','Hazel','Gray'].map(s=>`<option value="${s}" ${sp.eye_color===s?'selected':''}>${s||'— Select —'}</option>`).join('')}</select>
        </div>
        <div class="form-group"><label>Hair Color</label>
          <select id="sf-hair">${['','Black','Brown','Blonde','Gray','White','Red'].map(s=>`<option value="${s}" ${sp.hair_color===s?'selected':''}>${s||'— Select —'}</option>`).join('')}</select>
        </div>
      </div>
    </div>

    <!-- ONBOARDING -->
    <div id="sf-mt-onboarding" style="display:none">
      <div class="form-row">
        <div class="form-group"><label>Department</label><input type="text" id="sf-department" value="${esc(sp.department||'')}"></div>
        <div class="form-group"><label>Position Hired</label><input type="text" id="sf-position-hired" value="${esc(sp.position_hired||'')}"></div>
      </div>
      <div class="form-row">
        <div class="form-group"><label>Cruise Line</label><input type="text" id="sf-cruise-line" value="${esc(sp.cruise_line||'')}"></div>
        <div class="form-group"><label>Joining Ship</label><input type="text" id="sf-joining-ship" value="${esc(sp.joining_ship||'')}"></div>
      </div>
      <div class="form-row">
        <div class="form-group"><label>Sign-On Date</label><input type="date" id="sf-sign-on-date" value="${esc(sp.sign_on_date||'')}"></div>
        <div class="form-group"><label>Sign-Off Date</label><input type="date" id="sf-sign-off-date" value="${esc(sp.sign_off_date||'')}"></div>
        <div class="form-group"><label>Sign-On Port</label><input type="text" id="sf-sign-on-port" value="${esc(sp.sign_on_port||'')}"></div>
      </div>
      <div class="form-row">
        <div class="form-group"><label>Gateway Airport</label><input type="text" id="sf-gateway-airport" value="${esc(sp.gateway_airport||'')}"></div>
        <div class="form-group"><label>Rescheduled Sign-On</label><input type="date" id="sf-resched-sod" value="${esc(sp.rescheduled_sign_on_date||'')}"></div>
        <div class="form-group"><label>Rescheduled Reason</label><input type="text" id="sf-resched-reason" value="${esc(sp.rescheduled_reasons||'')}"></div>
      </div>
      <div style="font-size:.72rem;text-transform:uppercase;color:var(--text-muted);margin:12px 0 8px">Contract Change 1</div>
      <div class="form-row">
        <div class="form-group"><label>New Ship</label><input type="text" id="sf-chg-ship1" value="${esc(sp.change_joining_ship_1||'')}"></div>
        <div class="form-group"><label>New Port</label><input type="text" id="sf-chg-port1" value="${esc(sp.change_joining_port_1||'')}"></div>
      </div>
      <div class="form-row">
        <div class="form-group"><label>New Sign-On</label><input type="date" id="sf-chg-son1" value="${esc(sp.change_sign_on_date_1||'')}"></div>
        <div class="form-group"><label>New Sign-Off</label><input type="date" id="sf-chg-sof1" value="${esc(sp.change_sign_off_date_1||'')}"></div>
      </div>
      <div style="font-size:.72rem;text-transform:uppercase;color:var(--text-muted);margin:12px 0 8px">Contract Change 2</div>
      <div class="form-row">
        <div class="form-group"><label>New Ship</label><input type="text" id="sf-chg-ship2" value="${esc(sp.change_joining_ship_2||'')}"></div>
        <div class="form-group"><label>New Port</label><input type="text" id="sf-chg-port2" value="${esc(sp.change_joining_port_2||'')}"></div>
      </div>
      <div class="form-row">
        <div class="form-group"><label>New Sign-On</label><input type="date" id="sf-chg-son2" value="${esc(sp.change_sign_on_date_2||'')}"></div>
        <div class="form-group"><label>New Sign-Off</label><input type="date" id="sf-chg-sof2" value="${esc(sp.change_sign_off_date_2||'')}"></div>
      </div>
      <div style="font-size:.72rem;text-transform:uppercase;color:var(--text-muted);margin:12px 0 8px">Marlins Test</div>
      <div class="form-row">
        <div class="form-group"><label>Code</label><input type="text" id="sf-marlins-code" value="${esc(sp.marlins_code||'')}"></div>
        <div class="form-group"><label>Score</label><input type="number" id="sf-marlins-score" value="${sp.marlins_score!=null?sp.marlins_score:''}"></div>
        <div class="form-group"><label>Result</label><input type="text" id="sf-marlins-result" value="${esc(sp.marlins_test_result||'')}"></div>
        <div class="form-group"><label>Duration</label><input type="text" id="sf-marlins-duration" value="${esc(sp.marlins_test_duration||'')}"></div>
      </div>
      <div style="font-size:.72rem;text-transform:uppercase;color:var(--text-muted);margin:12px 0 8px">Emergency Contact</div>
      <div class="form-row">
        <div class="form-group"><label>Name</label><input type="text" id="sf-ec-name" value="${esc(sp.emergency_contact_name||'')}"></div>
        <div class="form-group"><label>Number</label><input type="text" id="sf-ec-number" value="${esc(sp.emergency_contact_number||'')}"></div>
      </div>
      <div class="form-row">
        <div class="form-group"><label>Relationship</label><input type="text" id="sf-ec-relationship" value="${esc(sp.emergency_relationship||'')}"></div>
        <div class="form-group"><label>City</label><input type="text" id="sf-ec-city" value="${esc(sp.emergency_contact_city||'')}"></div>
      </div>
      <div class="form-group"><label>Street Address</label><input type="text" id="sf-ec-address" value="${esc(sp.emergency_contact_address||'')}"></div>
      <div style="font-size:.72rem;text-transform:uppercase;color:var(--text-muted);margin:12px 0 8px">Home Address</div>
      <div class="form-group"><label>Street</label><input type="text" id="sf-addr-street" value="${esc(sp.address_street||'')}"></div>
      <div class="form-row">
        <div class="form-group"><label>City</label><input type="text" id="sf-addr-city" value="${esc(sp.address_city||'')}"></div>
        <div class="form-group"><label>Province</label><input type="text" id="sf-addr-province" value="${esc(sp.address_province||'')}"></div>
      </div>
      <div class="form-row">
        <div class="form-group"><label>Country</label><input type="text" id="sf-addr-country" value="${esc(sp.address_country||'')}"></div>
        <div class="form-group"><label>Postal Code</label><input type="text" id="sf-addr-postal" value="${esc(sp.address_postal_code||'')}"></div>
      </div>
    </div>

    <!-- EMPLOYMENT -->
    <div id="sf-mt-employment" style="display:none">
      <div class="form-row">
        <div class="form-group"><label>Current Job Title</label><input type="text" id="sf-job-title" value="${esc(sp.current_job_title||'')}"></div>
        <div class="form-group"><label>Placement Sector</label><input type="text" id="sf-sector" value="${esc(sp.placement_sector||'')}"></div>
        <div class="form-group"><label>Project</label><input type="text" id="sf-project" value="${esc(sp.project||'')}"></div>
      </div>
      <div class="form-row">
        <div class="form-group"><label>Contract No.</label><input type="text" id="sf-contract-no" value="${esc(sp.contract_number||'')}"></div>
        <div class="form-group"><label>Hired Date</label><input type="date" id="sf-hired-date" value="${esc(sp.hired_date||'')}"></div>
        <div class="form-group"><label>Rotation Ready</label><input type="date" id="sf-rotation-ready" value="${esc(sp.rotation_ready_date||'')}"></div>
      </div>
      <div class="form-row">
        <div class="form-group"><label>Sign-Off Reason</label><input type="text" id="sf-signoff-reason" value="${esc(sp.sign_off_reason||'')}"></div>
        <div class="form-group"><label>Sign-Off Report Date</label><input type="date" id="sf-signoff-report" value="${esc(sp.sign_off_report_date||'')}"></div>
      </div>
      <div class="form-row">
        <div class="form-group"><label>Resignation Date</label><input type="date" id="sf-resign-date" value="${esc(sp.resignation_date||'')}"></div>
        <div class="form-group"><label>Resignation Reason</label><input type="text" id="sf-resign-reason" value="${esc(sp.resignation_reasons||'')}"></div>
      </div>
      <div class="form-group"><label>Skill Set</label><textarea id="sf-skill-set" rows="3" style="width:100%;background:var(--input-bg);border:1px solid var(--border);color:var(--text);border-radius:6px;padding:8px;font-size:13px;resize:vertical;">${esc(sp.skill_set||'')}</textarea></div>
      <div class="form-row">
        <div class="form-group"><label>Go Video Link</label><input type="url" id="sf-govideo" value="${esc(sp.go_video_link||'')}"></div>
        <div class="form-group"><label>Temporary ID</label><input type="text" id="sf-temp-id" value="${esc(sp.temporary_id||'')}"></div>
        <div class="form-group"><label>Crew ID 2</label><input type="text" id="sf-crew-id2" value="${esc(sp.crew_id_2||'')}"></div>
      </div>
      <div class="form-row">
        <div class="form-group"><label>Previous Office</label><input type="text" id="sf-prev-office" value="${esc(sp.previous_office||'')}"></div>
      </div>
      <div class="form-group"><label>Additional Info</label><textarea id="sf-addl-info" rows="2" style="width:100%;background:var(--input-bg);border:1px solid var(--border);color:var(--text);border-radius:6px;padding:8px;font-size:13px;resize:vertical;">${esc(sp.additional_info||'')}</textarea></div>
      <div class="form-group"><label>Comment Result</label><textarea id="sf-comment" rows="2" style="width:100%;background:var(--input-bg);border:1px solid var(--border);color:var(--text);border-radius:6px;padding:8px;font-size:13px;resize:vertical;">${esc(sp.comment_result||'')}</textarea></div>
    </div>

    <!-- COMPLIANCE -->
    <div id="sf-mt-compliance" style="display:none">
      <div class="form-row">
        <div class="form-group"><label>Mistral Status</label>
          <select id="sf-mistral">${['','Active','Pending','Expired','Not Required'].map(s=>`<option value="${s}" ${sp.mistral_status===s?'selected':''}>${s||'— Select —'}</option>`).join('')}</select>
        </div>
        <div class="form-group"><label>OKTB Status</label>
          <select id="sf-oktb">${['','OK to Board','Pending','Rejected','Not Required'].map(s=>`<option value="${s}" ${sp.oktb_status===s?'selected':''}>${s||'— Select —'}</option>`).join('')}</select>
        </div>
      </div>
      <div class="form-row">
        <div class="form-group"><label>Completed Vaccination</label><input type="text" id="sf-vaccination" placeholder="e.g. COVID-19, Hepatitis B" value="${esc(sp.completed_vaccination||'')}"></div>
        <div class="form-group"><label>MMR1 Completed Date</label><input type="date" id="sf-mmr1" value="${esc(sp.date_mmr1_completed||'')}"></div>
        <div class="form-group"><label>Compliance Audit Call</label><input type="date" id="sf-audit-call" value="${esc(sp.crew_compliance_audit_call||'')}"></div>
      </div>
      <div class="form-group"><label>Compliance Notes</label><textarea id="sf-compliance-notes" rows="3" style="width:100%;background:var(--input-bg);border:1px solid var(--border);color:var(--text);border-radius:6px;padding:8px;font-size:13px;resize:vertical;">${esc(sp.compliance_notes||'')}</textarea></div>
    </div>

    <!-- BANKING & COSTS -->
    <div id="sf-mt-banking" style="display:none">
      <div style="font-size:.72rem;text-transform:uppercase;color:var(--text-muted);margin-bottom:8px">Banking</div>
      <div class="form-row">
        <div class="form-group"><label>Bank Name</label><input type="text" id="sf-bank-name" value="${esc(sp.bank_name||'')}"></div>
        <div class="form-group"><label>Account Number</label><input type="text" id="sf-bank-acct" value="${esc(sp.bank_account_number||'')}"></div>
      </div>
      <div style="font-size:.72rem;text-transform:uppercase;color:var(--text-muted);margin:16px 0 8px">Costs</div>
      <div class="form-row">
        <div class="form-group"><label>Medical Cost ($)</label><input type="number" step="0.01" id="sf-cost-medical" value="${sp.medical_cost!=null?sp.medical_cost:''}"></div>
        <div class="form-group"><label>Meal Allowance ($)</label><input type="number" step="0.01" id="sf-cost-meal" value="${sp.meal_allowance_cost!=null?sp.meal_allowance_cost:''}"></div>
        <div class="form-group"><label>RT-PCR Cost ($)</label><input type="number" step="0.01" id="sf-cost-rtpcr" value="${sp.rt_pcr_cost!=null?sp.rt_pcr_cost:''}"></div>
      </div>
      <div class="form-row">
        <div class="form-group"><label>Vaccination Cost ($)</label><input type="number" step="0.01" id="sf-cost-vacc" value="${sp.vaccination_cost!=null?sp.vaccination_cost:''}"></div>
        <div class="form-group"><label>Reimbursement Date</label><input type="date" id="sf-reimburse-date" value="${esc(sp.reimbursement_date||'')}"></div>
      </div>
    </div>

    <div class="modal-footer">
      <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="saveSeafarerProfile('${esc(candidateId)}')">Save</button>
    </div>`, 'modal-xl');
}

async function saveSeafarerProfile(candidateId) {
  const g = id => { const el=document.getElementById(id); return el?el.value.trim()||undefined:undefined; };
  const d = id => { const el=document.getElementById(id); return el?el.value||undefined:undefined; };
  const n = id => { const el=document.getElementById(id); return el&&el.value!==''?Number(el.value):undefined; };
  const body = {
    salutation:            g('sf-salutation'),
    dateOfBirth:           d('sf-dob'),
    placeOfBirth:          g('sf-pob'),
    height:                n('sf-height'),
    weight:                n('sf-weight'),
    eyeColor:              g('sf-eye'),
    hairColor:             g('sf-hair'),
    department:            g('sf-department'),
    positionHired:         g('sf-position-hired'),
    cruiseLine:            g('sf-cruise-line'),
    joiningShip:           g('sf-joining-ship'),
    signOnDate:            d('sf-sign-on-date'),
    signOffDate:           d('sf-sign-off-date'),
    signOnPort:            g('sf-sign-on-port'),
    gatewayAirport:        g('sf-gateway-airport'),
    rescheduledSignOnDate: d('sf-resched-sod'),
    rescheduledReasons:    g('sf-resched-reason'),
    changeJoiningShip1:    g('sf-chg-ship1'),
    changeJoiningPort1:    g('sf-chg-port1'),
    changeSignOnDate1:     d('sf-chg-son1'),
    changeSignOffDate1:    d('sf-chg-sof1'),
    changeJoiningShip2:    g('sf-chg-ship2'),
    changeJoiningPort2:    g('sf-chg-port2'),
    changeSignOnDate2:     d('sf-chg-son2'),
    changeSignOffDate2:    d('sf-chg-sof2'),
    marlinsCode:           g('sf-marlins-code'),
    marlinsScore:          n('sf-marlins-score'),
    marlinsTestResult:     g('sf-marlins-result'),
    marlinsTestDuration:   g('sf-marlins-duration'),
    emergencyContactName:  g('sf-ec-name'),
    emergencyContactNumber:g('sf-ec-number'),
    emergencyRelationship: g('sf-ec-relationship'),
    emergencyContactCity:  g('sf-ec-city'),
    emergencyContactAddress:g('sf-ec-address'),
    addressStreet:         g('sf-addr-street'),
    addressCity:           g('sf-addr-city'),
    addressProvince:       g('sf-addr-province'),
    addressCountry:        g('sf-addr-country'),
    addressPostalCode:     g('sf-addr-postal'),
    currentJobTitle:       g('sf-job-title'),
    placementSector:       g('sf-sector'),
    project:               g('sf-project'),
    contractNumber:        g('sf-contract-no'),
    hiredDate:             d('sf-hired-date'),
    rotationReadyDate:     d('sf-rotation-ready'),
    signOffReason:         g('sf-signoff-reason'),
    signOffReportDate:     d('sf-signoff-report'),
    resignationDate:       d('sf-resign-date'),
    resignationReasons:    g('sf-resign-reason'),
    skillSet:              g('sf-skill-set'),
    goVideoLink:           g('sf-govideo'),
    temporaryId:           g('sf-temp-id'),
    crewId2:               g('sf-crew-id2'),
    previousOffice:        g('sf-prev-office'),
    additionalInfo:        g('sf-addl-info'),
    commentResult:         g('sf-comment'),
    mistralStatus:         g('sf-mistral'),
    oktbStatus:            g('sf-oktb'),
    completedVaccination:  g('sf-vaccination'),
    dateMmr1Completed:     d('sf-mmr1'),
    crewComplianceAuditCall:d('sf-audit-call'),
    complianceNotes:       g('sf-compliance-notes'),
    bankName:              g('sf-bank-name'),
    bankAccountNumber:     g('sf-bank-acct'),
    medicalCost:           n('sf-cost-medical'),
    mealAllowanceCost:     n('sf-cost-meal'),
    rtPcrCost:             n('sf-cost-rtpcr'),
    vaccinationCost:       n('sf-cost-vacc'),
    reimbursementDate:     d('sf-reimburse-date'),
  };
  try {
    await api('PUT', `/candidates/${candidateId}/seafarer-profile`, body);
    closeModal(); toast('Seafarer profile updated', 'success');
    STATE.currentCandidate.seafarerProfile = null;
    openCandidateDetail(candidateId);
  } catch (e) { toast(e.message, 'error'); }
}

function openEditJ1ProfileModal(candidateId) {
  const jp = STATE.currentCandidate?.j1Profile || {};
  let eligibleVal = '';
  if (jp.eligible_programs) { try { eligibleVal = JSON.parse(jp.eligible_programs).join(', '); } catch { eligibleVal = jp.eligible_programs; } }
  openModal('Edit J1 Profile', `
    <div style="font-size:.72rem;text-transform:uppercase;color:var(--text-muted);letter-spacing:.06em;margin-bottom:10px;">Application Info</div>
    <div class="form-row">
      <div class="form-group"><label>Application Status</label>
        <select id="j1p-app-status">${['NEW_SUBMISSION','CONSULTATION','INTERVIEW','VISA_PROCESSING','USA_ONBOARD','COMPLETED','ARCHIVED'].map(s=>`<option value="${s}" ${jp.j1_application_status===s?'selected':''}>${statusLabel(s)}</option>`).join('')}</select>
      </div>
      <div class="form-group"><label>Program Sources</label><input type="text" id="j1p-sources" value="${esc(jp.j1_program_sources||'')}"></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label>CTI USA Review</label><input type="text" id="j1p-cti-review" value="${esc(jp.cti_usa_review||'')}"></div>
      <div class="form-group"><label>Eligible Programs <small style="font-weight:400">(comma-separated)</small></label><input type="text" id="j1p-eligible" value="${esc(eligibleVal)}"></div>
    </div>
    <div style="font-size:.72rem;text-transform:uppercase;color:var(--text-muted);letter-spacing:.06em;margin:16px 0 10px;">Consultation Call</div>
    <div class="form-row">
      <div class="form-group"><label>Call Date</label><input type="date" id="j1p-call-date" value="${esc(jp.consultation_call_date||'')}"></div>
      <div class="form-group"><label>Called By</label><input type="text" id="j1p-call-by" value="${esc(jp.consultation_call_by||'')}"></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label>Call Status</label>
        <select id="j1p-call-status"><option value="">— Select —</option>${['Pending','Approved','Rejected'].map(s=>`<option value="${s}" ${jp.consultation_call_status===s?'selected':''}>${s}</option>`).join('')}</select>
      </div>
    </div>
    <div class="form-group"><label>Call Notes</label><textarea id="j1p-call-notes" rows="3" style="width:100%;background:var(--input-bg);border:1px solid var(--border);color:var(--text);border-radius:6px;padding:8px;font-size:13px;resize:vertical;">${esc(jp.consultation_call_notes||'')}</textarea></div>
    <div style="font-size:.72rem;text-transform:uppercase;color:var(--text-muted);letter-spacing:.06em;margin:16px 0 10px;">Assessment</div>
    <div class="form-row">
      <div class="form-group"><label>English Assessment</label><input type="text" id="j1p-english" value="${esc(jp.english_assessment||'')}"></div>
      <div class="form-group"><label>Participant Rating</label>
        <select id="j1p-rating"><option value="">— Select —</option>${['Excellent','Good','Average','Poor'].map(s=>`<option value="${s}" ${jp.participant_rating===s?'selected':''}>${s}</option>`).join('')}</select>
      </div>
      <div class="form-group"><label>Attendance</label>
        <select id="j1p-attendance"><option value="">— Select —</option>${['Attended','Absent','Pending'].map(s=>`<option value="${s}" ${jp.attendance===s?'selected':''}>${s}</option>`).join('')}</select>
      </div>
    </div>
    <div style="font-size:.72rem;text-transform:uppercase;color:var(--text-muted);letter-spacing:.06em;margin:16px 0 10px;">Program Placement</div>
    <div class="form-row">
      <div class="form-group"><label>Hosting Company</label><input type="text" id="j1p-hosting" value="${esc(jp.hosting_company||'')}"></div>
      <div class="form-group"><label>Selected Job</label><input type="text" id="j1p-job" value="${esc(jp.selected_job||'')}"></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label>Occupational Fields</label><input type="text" id="j1p-occ-fields" value="${esc(jp.occupational_fields||'')}"></div>
      <div class="form-group"><label>Processing Sponsor</label><input type="text" id="j1p-sponsor" value="${esc(jp.processing_sponsor||'')}"></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label>Ticket Pricing ($)</label><input type="number" step="0.01" id="j1p-ticket" value="${jp.ticket_pricing!=null?jp.ticket_pricing:''}"></div>
      <div class="form-group"><label>Program Start</label><input type="date" id="j1p-prog-start" value="${esc(jp.program_start_date||'')}"></div>
      <div class="form-group"><label>Program End</label><input type="date" id="j1p-prog-end" value="${esc(jp.program_end_date||'')}"></div>
    </div>
    <div style="font-size:.72rem;text-transform:uppercase;color:var(--text-muted);letter-spacing:.06em;margin:16px 0 10px;">Investment</div>
    <div class="form-row">
      <div class="form-group"><label>Total Paid ($)</label><input type="number" step="0.01" id="j1p-total-inv" value="${jp.total_paid_investment!=null?jp.total_paid_investment:''}"></div>
      <div class="form-group"><label>Stage 1 ($)</label><input type="number" step="0.01" id="j1p-stage1" value="${jp.stage1_investment!=null?jp.stage1_investment:''}"></div>
      <div class="form-group"><label>Stage 2 ($)</label><input type="number" step="0.01" id="j1p-stage2" value="${jp.stage2_investment!=null?jp.stage2_investment:''}"></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label>Stage 3 ($)</label><input type="number" step="0.01" id="j1p-stage3" value="${jp.stage3_investment!=null?jp.stage3_investment:''}"></div>
      <div class="form-group"><label>Stage 4 ($)</label><input type="number" step="0.01" id="j1p-stage4" value="${jp.stage4_investment!=null?jp.stage4_investment:''}"></div>
    </div>
    <div style="font-size:.72rem;text-transform:uppercase;color:var(--text-muted);letter-spacing:.06em;margin:16px 0 10px;">Housing</div>
    <div class="form-row">
      <div class="form-group"><label>Landlord</label><input type="text" id="j1p-landlord" value="${esc(jp.housing_landlord||'')}"></div>
      <div class="form-group"><label>Sponsor Invoice Status</label><input type="text" id="j1p-invoice-status" value="${esc(jp.program_sponsor_invoice_status||'')}"></div>
    </div>
    <div class="form-group"><label>Housing Address</label><input type="text" id="j1p-housing-addr" value="${esc(jp.housing_address||'')}"></div>
    <div class="modal-footer">
      <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="saveJ1Profile('${esc(candidateId)}')">Save</button>
    </div>`, 'modal-lg');
}

async function saveJ1Profile(candidateId) {
  const eligibleRaw = document.getElementById('j1p-eligible').value;
  const eligiblePrograms = eligibleRaw.split(',').map(s => s.trim()).filter(Boolean);
  const n = id => { const v = document.getElementById(id).value; return v !== '' ? Number(v) : undefined; };
  const body = {
    j1ApplicationStatus:         document.getElementById('j1p-app-status').value       || undefined,
    j1ProgramSources:            document.getElementById('j1p-sources').value.trim()   || undefined,
    ctiUsaReview:                document.getElementById('j1p-cti-review').value.trim()|| undefined,
    eligiblePrograms:            eligiblePrograms.length ? eligiblePrograms : undefined,
    consultationCallDate:        document.getElementById('j1p-call-date').value         || undefined,
    consultationCallBy:          document.getElementById('j1p-call-by').value.trim()    || undefined,
    consultationCallStatus:      document.getElementById('j1p-call-status').value       || undefined,
    consultationCallNotes:       document.getElementById('j1p-call-notes').value.trim() || undefined,
    englishAssessment:           document.getElementById('j1p-english').value.trim()    || undefined,
    participantRating:           document.getElementById('j1p-rating').value            || undefined,
    attendance:                  document.getElementById('j1p-attendance').value        || undefined,
    hostingCompany:              document.getElementById('j1p-hosting').value.trim()    || undefined,
    selectedJob:                 document.getElementById('j1p-job').value.trim()        || undefined,
    occupationalFields:          document.getElementById('j1p-occ-fields').value.trim()|| undefined,
    processingSponsor:           document.getElementById('j1p-sponsor').value.trim()    || undefined,
    ticketPricing:               n('j1p-ticket'),
    programStartDate:            document.getElementById('j1p-prog-start').value        || undefined,
    programEndDate:              document.getElementById('j1p-prog-end').value          || undefined,
    totalPaidInvestment:         n('j1p-total-inv'),
    stage1Investment:            n('j1p-stage1'),
    stage2Investment:            n('j1p-stage2'),
    stage3Investment:            n('j1p-stage3'),
    stage4Investment:            n('j1p-stage4'),
    housingLandlord:             document.getElementById('j1p-landlord').value.trim()       || undefined,
    housingAddress:              document.getElementById('j1p-housing-addr').value.trim()   || undefined,
    programSponsorInvoiceStatus: document.getElementById('j1p-invoice-status').value.trim() || undefined,
  };
  try {
    await api('PUT', `/candidates/${candidateId}/j1-profile`, body);
    closeModal(); toast('J1 profile updated', 'success');
    openCandidateDetail(candidateId);
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
    ONBOARDING:          'badge-deployed',
    READY_TO_DEPLOY:     'badge-approved',
    DEPLOYED:            'badge-deployed',
    ARCHIVED:            'badge-new',
  };
  return `<span class="badge ${map[s]||'badge-new'}">${statusLabel(s)}</span>`;
}

function statusLabel(s) {
  const labels = {
    NEW_SUBMISSION:       'New Submission',
    CANDIDATES:           'Candidates',
    FINAL_INTERVIEW:      'Final Interview',
    OFFER_LETTER:         'Offer Letter',
    ONBOARDING:           'Onboarding',
    READY_TO_DEPLOY:      'Ready to Go',
    DEPLOYED:             'Deployed',
    ARCHIVED:             'Archived',
    // Legacy labels (still used in history timeline)
    IN_REVIEW:'In Review', AVAILABLE:'Available', ENGAGED:'Engaged',
    OFFERED:'Offered', HIRED:'Hired', REJECTED:'Rejected',
    CONSULTATION:'Consultation', INTERVIEW:'Interview',
    VISA_PROCESSING:'Visa Processing', USA_ONBOARD:'USA Onboard',
    COMPLETED:'Completed', SHORTLISTED:'Shortlisted',
    ENDORSED:'Endorsed', CLIENT_APPROVED:'Client Approved',
    WITHDRAWN:'Withdrawn', DEPLOYED:'Deployed',
  };
  return labels[s] || s.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
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

async function exportCandidatesCSV(forceStatus) {
  const pipeline = STATE.activePipeline || '';
  const status = forceStatus || document.getElementById('cand-status')?.value || '';
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
    const d = await api('POST', `/candidates/${candidateId}/portal-invite`);
    if (d.emailSent) {
      toast('Portal activation email sent to candidate', 'success');
    } else {
      // Email not configured — show the link so admin can share manually
      openModal('Activation Link', `
        <p style="font-size:.85rem;color:var(--text-muted);margin:0 0 12px;">
          Email could not be sent (Microsoft Graph not configured).<br>
          Share this activation link with the candidate manually — it expires in <strong>72 hours</strong>.
        </p>
        <div style="background:var(--navy-mid);border-radius:6px;padding:10px 14px;font-size:.8rem;word-break:break-all;color:var(--blue);margin-bottom:16px;">
          ${d.activationLink || '—'}
        </div>
        <div class="modal-footer">
          <button class="btn btn-primary" onclick="navigator.clipboard.writeText('${d.activationLink}').then(()=>toast('Copied!'));closeModal()">Copy Link</button>
          <button class="btn btn-ghost" onclick="closeModal()">Close</button>
        </div>`);
    }
    openCandidateDetail(candidateId);
  } catch (e) { toast(e.message, 'error'); }
}

// Booking slots (and the calendar UI that managed them) were removed in v8.

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
      <div class="form-group"><label>Gender</label>
        <select id="ec-gender">
          <option value="">— Select —</option>
          <option value="Male" ${c.gender==='Male'?'selected':''}>Male</option>
          <option value="Female" ${c.gender==='Female'?'selected':''}>Female</option>
        </select>
      </div>
      <div class="form-group"><label>Marital Status</label>
        <select id="ec-marital">
          <option value="">— Select —</option>
          ${['Single','Married','Divorced','Widowed'].map(s=>`<option value="${s}" ${c.marital_status===s?'selected':''}>${s}</option>`).join('')}
        </select>
      </div>
    </div>
    <div class="form-row">
      <div class="form-group"><label>Date of Birth</label><input type="date" id="ec-dob" value="${esc(c.date_of_birth||'')}"></div>
      <div class="form-group"><label>Language Proficiency</label><input type="text" id="ec-lang" value="${esc(c.language_proficiency||'')}" placeholder="e.g. English, Japanese"></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label>CTI Office</label>
        <select id="ec-cti-office">
          <option value="">— Select Office —</option>
          ${['CTI Indonesia','CTI Group Myanmar','CTI Philippines','CTI Group USA'].map(o=>`<option value="${o}" ${c.cti_office===o?'selected':''}>${o}</option>`).join('')}
        </select>
      </div>
      <div class="form-group"><label>Employment Status</label>
        <select id="ec-emp-status">
          <option value="New" ${c.employment_status==='New'?'selected':''}>New</option>
          <option value="Repeater" ${c.employment_status==='Repeater'?'selected':''}>Repeater</option>
        </select>
      </div>
    </div>
    <div class="form-group"><label>Internal Notes</label><textarea id="ec-notes" rows="3" style="width:100%;background:var(--input-bg);border:1px solid var(--border);color:var(--text);border-radius:6px;padding:8px;font-size:13px;resize:vertical;">${esc(c.internal_notes||'')}</textarea></div>
    <div class="modal-footer">
      <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="saveEditCandidate('${esc(candidateId)}')">Save Changes</button>
    </div>`);
}

async function saveEditCandidate(candidateId) {
  const body = {
    firstName:          document.getElementById('ec-fn').value.trim()         || undefined,
    lastName:           document.getElementById('ec-ln').value.trim()         || undefined,
    middleName:         document.getElementById('ec-mn').value.trim()         || undefined,
    phone:              document.getElementById('ec-phone').value.trim()      || undefined,
    nationality:        document.getElementById('ec-nat').value.trim()        || undefined,
    gender:             document.getElementById('ec-gender').value            || undefined,
    maritalStatus:      document.getElementById('ec-marital').value           || undefined,
    dateOfBirth:        document.getElementById('ec-dob').value               || undefined,
    languageProficiency: document.getElementById('ec-lang').value.trim()      || undefined,
    ctiOffice:          document.getElementById('ec-cti-office').value        || undefined,
    employmentStatus:   document.getElementById('ec-emp-status').value        || undefined,
    internalNotes:      document.getElementById('ec-notes').value.trim()      || undefined,
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
