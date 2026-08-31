/* Grant Flow — split-screen grant assistant. Vanilla JS, no build step. */

const state = {
  tab: "dashboard",
  loading: true,
  error: "",
  status: null,
  profile: null,
  answers: [],
  applications: [],
  selectedApplicationId: null,
  ui: {
    appModal: null, // { mode: 'add' | 'edit', data: {...} } | null
    answerModal: null, // { mode: 'add' | 'edit', data: {...} } | null
    answerSearch: "",
    draftQuestion: "",
    draftAnswer: "",
    draftStatus: "",
    draftUnavailable: "",
    draftBusy: false,
    profileDraft: null,
    guideOs: "win",
    orgSwitcherOpen: false,
    onboarding: { step: 1, orgName: "", website: "", busy: "" },
  },
};

const NAV = [
  { id: "dashboard", label: "Dashboard", icon: "◧", eyebrow: "Overview", title: "Dashboard", sub: "Every application, one glance." },
  { id: "answers", label: "Grant answers", icon: "✎", eyebrow: "Copy into your portal", title: "Grant answers", sub: "Write each answer once, then copy it into the funder's form on your other half." },
  { id: "profile", label: "Organization profile", icon: "◔", eyebrow: "Organization info", title: "Organization profile", sub: "The facts that stay the same on every application." },
  { id: "guide", label: "Help & split screen", icon: "?", eyebrow: "Help", title: "Help & split screen", sub: "How Grant Flow works, and how to put it side by side with your portal." },
];

const ONBOARDING_META = { id: "onboarding", eyebrow: "Setup", title: "Set up Grant Flow", sub: "Three quick steps to your first application." };

const STATUS_STYLE = {
  draft: { label: "Draft", color: "var(--ink-soft)", bg: "var(--line-soft)" },
  working: { label: "In progress", color: "var(--forest)", bg: "var(--forest-tint)" },
  submitted: { label: "Submitted", color: "var(--slate)", bg: "var(--slate-tint)" },
  awarded: { label: "Awarded", color: "var(--mint)", bg: "var(--mint-tint)" },
  declined: { label: "Declined", color: "var(--coral)", bg: "var(--coral-tint)" },
};

const app = document.getElementById("app");

/* ---------------- API ---------------- */
async function api(path, options = {}) {
  const res = await fetch(path, {
    method: options.method || "GET",
    headers: { "Content-Type": "application/json" },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  let data = {};
  try { data = await res.json(); } catch { /* no body */ }
  if (!res.ok || data.error) throw new Error(data.error || `Request to ${path} failed`);
  return data;
}

async function loadAll() {
  state.loading = true;
  render();
  try {
    const [status, profile, answers, applications] = await Promise.all([
      api("/api/status"),
      api("/api/profile"),
      api("/api/answers"),
      api("/api/applications"),
    ]);
    state.status = status;
    state.profile = profile;
    state.answers = answers.items || [];
    state.applications = applications.items || [];
    state.error = "";
  } catch (err) {
    state.error = err.message || "Could not reach Grant Flow's server.";
  } finally {
    state.loading = false;
    render();
  }
}

async function reloadScoped() {
  const [answers, applications] = await Promise.all([api("/api/answers"), api("/api/applications")]);
  state.answers = answers.items || [];
  state.applications = applications.items || [];
  if (!state.applications.some((a) => a.id === state.selectedApplicationId)) state.selectedApplicationId = null;
}

/* ---------------- helpers ---------------- */
function esc(str = "") {
  return String(str).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function toast(message) {
  let el = document.querySelector(".gf-toast");
  if (!el) {
    el = document.createElement("div");
    el.className = "gf-toast";
    el.setAttribute("role", "status");
    el.setAttribute("aria-live", "polite");
    document.body.appendChild(el);
  }
  el.textContent = message;
  el.classList.add("show");
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove("show"), 2200);
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast("Copied — paste it into your grant portal");
  } catch {
    toast("Couldn't copy automatically — select and copy manually");
  }
}

function initials(name = "") {
  return name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "?";
}

function daysUntil(dateStr) {
  if (!dateStr) return null;
  const target = new Date(dateStr);
  if (Number.isNaN(target.getTime())) return null;
  const diff = Math.ceil((target - new Date()) / 86400000);
  return diff;
}

function statusMeta(status) {
  return STATUS_STYLE[status] || STATUS_STYLE.working;
}

function activeMeta() {
  return state.tab === "onboarding" ? ONBOARDING_META : (NAV.find((n) => n.id === state.tab) || NAV[0]);
}

// Mirror of the server's scrape detector so the UI can flag unreviewed content.
function looksLikeScrape(text = "") {
  const value = String(text || "");
  if (!value.trim()) return false;
  if (/\bSource:\s*https?:\/\//i.test(value)) return true;
  if (/^\s*Title:\s/i.test(value)) return true;
  const navHits = (value.match(/\b(HOME|ABOUT|DONATE|CONTACT|SPONSOR|SPONSORS|MENU|LOGIN|SIGN IN|SUBSCRIBE|SHOP|BLOG|EVENTS|GALLERY|VOLUNTEER|APPLY)\b/g) || []).length;
  return navHits >= 3;
}

function activeOrgEntry(p = state.profile) {
  if (!p) return null;
  return (p.organizations || []).find((o) => o.id === p.activeOrganizationId) || null;
}

function profileNeedsReview(p = state.profile) {
  if (!p) return false;
  const entry = activeOrgEntry(p);
  if (entry && entry.needsReview) return true;
  return !String(p.organization || "").trim()
    || !String(p.mission || "").trim()
    || !String(p.summary || "").trim()
    || looksLikeScrape(p.mission)
    || looksLikeScrape(p.summary);
}

// Core fields that read as empty or scraped, for the profile-quality warning.
function profileQualityWarnings(p = state.profile) {
  if (!p) return [];
  const warnings = [];
  const core = [["organization", "Organization name"], ["mission", "Mission statement"], ["summary", "One-line summary"]];
  for (const [key, label] of core) {
    const val = String(p[key] || "").trim();
    if (!val) warnings.push(`${label} is empty.`);
    else if (looksLikeScrape(val)) warnings.push(`${label} still looks like raw website text — rewrite it in your own words.`);
  }
  return warnings;
}

function answerSourceMeta(source = "") {
  if (source === "manual") return { label: "Manual", kind: "manual" };
  if (source === "chat-draft" || source === "ai") return { label: "AI-generated", kind: "ai" };
  if (/onboard/i.test(source)) return { label: "Imported", kind: "saved" };
  return { label: "Saved", kind: "saved" };
}

// Case-insensitive duplicate names get a disambiguator (website or id).
function orgDisplayList(p = state.profile) {
  const orgs = (p && p.organizations) || [];
  const counts = {};
  orgs.forEach((o) => { const k = (o.organization || "").trim().toLowerCase(); counts[k] = (counts[k] || 0) + 1; });
  return orgs.map((o) => {
    const dup = counts[(o.organization || "").trim().toLowerCase()] > 1;
    const hint = dup ? (o.website || o.id) : "";
    return { ...o, hint };
  });
}

/* ---------------- render shell ---------------- */
function render() {
  const active = activeMeta();
  const p = state.profile;
  const orgName = p ? (p.organization || "Untitled organization") : "";
  app.innerHTML = `
    <div class="gf-root">
      <div class="gf-rail">
        <div class="gf-rail-logo" title="Grant Flow" aria-hidden="true">G</div>
        ${NAV.map((n) => `
          <button class="gf-rail-btn ${state.tab === n.id ? "active" : ""}" data-tab="${n.id}" aria-label="${n.label}">
            <span aria-hidden="true">${n.icon}</span>
            <span class="gf-rail-tip">${n.label}</span>
          </button>
        `).join("")}
        <div class="gf-rail-spacer"></div>
      </div>
      <div class="gf-main">
        <div class="gf-topbar">
          <div class="gf-topbar-row">
            <div style="min-width:0;">
              <div class="gf-eyebrow">${active.eyebrow}</div>
              <h1 class="gf-title gf-display">${active.title}</h1>
            </div>
            ${p ? `
              <button class="gf-org-chip" id="orgSwitchBtn" aria-label="Active organization: ${esc(orgName)}. Switch organization.">
                <span class="gf-org-chip-avatar" aria-hidden="true">${esc(initials(orgName))}</span>
                <span class="gf-org-chip-name">${esc(orgName)}</span>
                <span aria-hidden="true">⌄</span>
              </button>
            ` : ""}
          </div>
          <div class="gf-sub">${active.sub}</div>
        </div>
        <div class="gf-body" id="gfBody">
          ${state.loading ? renderLoading() : state.error ? renderError() : renderTab()}
        </div>
      </div>
    </div>
    ${state.ui.orgSwitcherOpen ? renderOrgSwitcher() : ""}
    ${state.ui.appModal ? renderAppModal() : ""}
    ${state.ui.answerModal ? renderAnswerModal() : ""}
  `;
  wireGlobal();
  if (!state.loading && !state.error) wireTab();
  if (state.ui.orgSwitcherOpen) wireOrgSwitcher();
  if (state.ui.appModal) wireAppModal();
  if (state.ui.answerModal) wireAnswerModal();
}

function renderLoading() {
  return `<div class="gf-empty">Loading your grants…</div>`;
}

function renderError() {
  return `
    <div class="gf-empty">
      ${esc(state.error)}<br/><br/>
      <button class="gf-btn gf-btn-primary gf-btn-sm" id="retryBtn">Try again</button>
    </div>
  `;
}

function renderTab() {
  if (state.tab === "onboarding") return renderOnboarding();
  if (state.tab === "dashboard") return renderDashboard();
  if (state.tab === "answers") return renderAnswers();
  if (state.tab === "profile") return renderProfile();
  if (state.tab === "guide") return renderGuide();
  return "";
}

function goTab(tab) { state.tab = tab; render(); }

function wireGlobal() {
  app.querySelectorAll("[data-tab]").forEach((btn) => {
    btn.addEventListener("click", () => goTab(btn.dataset.tab));
  });
  const orgBtn = document.getElementById("orgSwitchBtn");
  if (orgBtn) orgBtn.addEventListener("click", () => { state.ui.orgSwitcherOpen = true; render(); });
  const retryBtn = document.getElementById("retryBtn");
  if (retryBtn) retryBtn.addEventListener("click", loadAll);
}

/* ---------------- onboarding checklist ---------------- */
function checklistItems() {
  return [
    { done: Boolean(state.profile && state.profile.organization), label: "Choose your organization" },
    { done: state.profile && !profileNeedsReview(), label: "Review your organization profile" },
    { done: state.applications.length > 0, label: "Add your first application" },
    { done: state.answers.length > 0, label: "Save your first answer" },
  ];
}

function renderChecklist() {
  const items = checklistItems();
  if (items.every((i) => i.done)) return "";
  return `
    <div class="gf-card gf-checklist-card" style="margin-bottom:20px;">
      <div class="gf-row" style="margin-bottom:10px;">
        <div class="gf-display" style="font-size:15px;font-weight:600;">Finish setting up</div>
        <button class="gf-btn gf-btn-brass gf-btn-sm" id="openOnboardingBtn">Open setup</button>
      </div>
      <ul class="gf-checklist" aria-label="Setup progress">
        ${items.map((i) => `
          <li class="gf-check ${i.done ? "done" : ""}">
            <span class="gf-check-box" aria-hidden="true">${i.done ? "✓" : ""}</span>
            <span>${esc(i.label)}</span>
          </li>
        `).join("")}
      </ul>
    </div>
  `;
}

/* ---------------- dashboard ---------------- */
function renderDashboard() {
  const apps = state.applications;
  const activeCount = apps.filter((a) => !["awarded", "declined"].includes(a.status)).length;
  const next = apps
    .map((a) => ({ a, d: daysUntil(a.deadline) }))
    .filter((x) => x.d !== null && x.d >= 0)
    .sort((x, y) => x.d - y.d)[0];

  const reviewBanner = profileNeedsReview() ? `
    <div class="gf-banner gf-banner-warn" style="margin-bottom:20px;">
      <div>
        <strong>${esc(state.profile.organization || "This organization")}</strong> has imported website content that hasn't been reviewed yet. Drafts shouldn't rely on it until you check it.
      </div>
      <button class="gf-btn gf-btn-ghost gf-btn-sm" id="reviewProfileBtn">Review profile</button>
    </div>
  ` : "";

  return `
    ${reviewBanner}
    ${renderChecklist()}
    <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:10px;margin-bottom:20px;">
      <div class="gf-card gf-hstack">
        <div class="gf-mono" style="font-size:19px;font-weight:600;">${activeCount}</div>
        <div style="font-size:12px;color:var(--ink-soft);">Active applications</div>
      </div>
      <div class="gf-card gf-hstack">
        <div class="gf-mono" style="font-size:19px;font-weight:600;">${next ? `${next.d}d` : "—"}</div>
        <div style="font-size:12px;color:var(--ink-soft);">${next ? "Next deadline" : "No upcoming deadlines"}</div>
      </div>
    </div>
    <div class="gf-row" style="margin-bottom:10px;">
      <div class="gf-display" style="font-size:16px;font-weight:600;">Your applications</div>
      <button class="gf-btn gf-btn-primary gf-btn-sm" id="addAppBtn">+ New application</button>
    </div>
    ${apps.length === 0 ? `
      <div class="gf-empty">
        No applications yet. Add one for each grant you're working on, then open it to draft, save, and copy answers into the funder's portal.
        <div style="margin-top:14px;"><button class="gf-btn gf-btn-primary gf-btn-sm" id="emptyAddAppBtn">Add your first application</button></div>
      </div>
    ` : `
      <div class="gf-stack">
        ${apps.map(renderAppCard).join("")}
      </div>
    `}
  `;
}

function renderAppCard(a) {
  const s = statusMeta(a.status);
  const d = daysUntil(a.deadline);
  return `
    <div class="gf-card" style="align-items:flex-start;" data-app-id="${a.id}">
      <div class="gf-hstack" style="align-items:flex-start;">
        <div class="gf-stamp" style="color:${s.color};">${s.label}</div>
        <div style="flex:1;min-width:0;">
          <div class="gf-row" style="align-items:flex-start;">
            <div style="min-width:0;">
              <div style="font-weight:600;font-size:14.5px;margin-bottom:2px;">${esc(a.applicationName || "Untitled application")}</div>
              <div style="font-size:12.5px;color:var(--ink-soft);">${esc(a.funderName || "")}</div>
            </div>
            <button class="gf-btn gf-btn-ghost gf-btn-sm edit-app-btn" data-id="${a.id}">Edit</button>
          </div>
          <div style="display:flex;align-items:center;gap:14px;margin-top:10px;font-size:12px;color:var(--ink-soft);flex-wrap:wrap;">
            ${a.deadline ? `<span>Due ${esc(a.deadline)}${d !== null ? ` <span class="gf-mono">(${d >= 0 ? d + "d left" : "past"})</span>` : ""}</span>` : "<span>No deadline set</span>"}
            ${a.sourceUrl ? `<a href="${esc(a.sourceUrl)}" target="_blank" rel="noopener" style="color:var(--slate);">Open portal ↗</a>` : ""}
          </div>
          ${a.notes ? `<div style="font-size:12.5px;color:var(--ink-soft);margin-top:8px;line-height:1.5;">${esc(a.notes)}</div>` : ""}
        </div>
      </div>
      <div class="gf-hstack" style="margin-top:12px;">
        <button class="gf-btn gf-btn-primary gf-btn-sm work-app-btn" data-id="${a.id}">Work on this application →</button>
      </div>
    </div>
  `;
}

function wireTab() {
  if (state.tab === "onboarding") wireOnboarding();
  if (state.tab === "dashboard") wireDashboard();
  if (state.tab === "answers") wireAnswers();
  if (state.tab === "profile") wireProfile();
  if (state.tab === "guide") wireGuide();
}

function openAppModal() {
  state.ui.appModal = { mode: "add", data: { funderName: "", applicationName: "", deadline: "", sourceUrl: "", status: "working", notes: "" } };
  render();
}

function wireDashboard() {
  const addBtn = document.getElementById("addAppBtn");
  if (addBtn) addBtn.addEventListener("click", openAppModal);
  const emptyAdd = document.getElementById("emptyAddAppBtn");
  if (emptyAdd) emptyAdd.addEventListener("click", openAppModal);
  const openOnb = document.getElementById("openOnboardingBtn");
  if (openOnb) openOnb.addEventListener("click", () => { state.ui.onboarding.step = 1; goTab("onboarding"); });
  const reviewBtn = document.getElementById("reviewProfileBtn");
  if (reviewBtn) reviewBtn.addEventListener("click", () => goTab("profile"));
  app.querySelectorAll(".edit-app-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const item = state.applications.find((a) => a.id === btn.dataset.id);
      if (item) { state.ui.appModal = { mode: "edit", data: { ...item } }; render(); }
    });
  });
  app.querySelectorAll(".work-app-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.selectedApplicationId = btn.dataset.id;
      goTab("answers");
    });
  });
}

function renderAppModal() {
  const { mode, data } = state.ui.appModal;
  return `
    <div class="gf-modal-overlay" id="appModalOverlay">
      <div class="gf-modal" role="dialog" aria-modal="true" aria-labelledby="appModalTitle">
        <div class="gf-row" style="margin-bottom:14px;">
          <div class="gf-display" id="appModalTitle" style="font-size:16px;font-weight:600;">${mode === "add" ? "New application" : "Edit application"}</div>
          <button class="gf-btn gf-btn-ghost gf-btn-sm" id="appModalClose">Close</button>
        </div>
        <div class="gf-field"><label class="gf-label" for="fName">Application name <span class="gf-req">*</span></label><input class="gf-input" id="fName" required value="${esc(data.applicationName)}" /></div>
        <div class="gf-field"><label class="gf-label" for="fFunder">Funder name</label><input class="gf-input" id="fFunder" value="${esc(data.funderName)}" /></div>
        <div class="gf-field"><label class="gf-label" for="fDeadline">Deadline</label><input class="gf-input" type="date" id="fDeadline" value="${esc(data.deadline)}" /></div>
        <div class="gf-field"><label class="gf-label" for="fUrl">Portal link</label><input class="gf-input" id="fUrl" placeholder="https://" value="${esc(data.sourceUrl)}" /></div>
        <div class="gf-field">
          <label class="gf-label" for="fStatus">Status</label>
          <select class="gf-select" id="fStatus">
            ${Object.entries(STATUS_STYLE).map(([k, v]) => `<option value="${k}" ${data.status === k ? "selected" : ""}>${v.label}</option>`).join("")}
          </select>
        </div>
        <div class="gf-field"><label class="gf-label" for="fNotes">Notes</label><textarea class="gf-textarea" id="fNotes">${esc(data.notes)}</textarea></div>
        <div class="gf-hstack" style="margin-top:6px;">
          <button class="gf-btn gf-btn-primary" id="appModalSave">${mode === "add" ? "Add application" : "Save changes"}</button>
          <button class="gf-btn gf-btn-ghost" id="appModalCancel">Cancel</button>
        </div>
      </div>
    </div>
  `;
}

function wireAppModal() {
  const close = () => { state.ui.appModal = null; render(); };
  const overlay = document.getElementById("appModalOverlay");
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
  document.getElementById("appModalClose").addEventListener("click", close);
  document.getElementById("appModalCancel").addEventListener("click", close);
  document.getElementById("fName").focus();
  document.getElementById("appModalSave").addEventListener("click", async () => {
    const { mode } = state.ui.appModal;
    const nameEl = document.getElementById("fName");
    const payload = {
      id: state.ui.appModal.data.id,
      funderName: document.getElementById("fFunder").value.trim(),
      applicationName: nameEl.value.trim(),
      deadline: document.getElementById("fDeadline").value.trim(),
      sourceUrl: document.getElementById("fUrl").value.trim(),
      status: document.getElementById("fStatus").value,
      notes: document.getElementById("fNotes").value.trim(),
    };
    if (!payload.applicationName) {
      toast("Give the application a name first");
      nameEl.classList.add("gf-invalid");
      nameEl.focus();
      return;
    }
    try {
      if (mode === "add") {
        const item = await api("/api/applications", { method: "POST", body: payload });
        state.applications = [item, ...state.applications];
        state.selectedApplicationId = item.id;
        state.ui.appModal = null;
        toast("Application added — start answering its questions");
        goTab("answers");
      } else {
        const item = await api("/api/applications", { method: "PUT", body: payload });
        state.applications = state.applications.map((a) => (a.id === item.id ? item : a));
        state.ui.appModal = null;
        toast("Saved");
        render();
      }
    } catch (err) {
      toast(err.message || "Couldn't save that");
    }
  });
}

/* ---------------- grant answers ---------------- */
function renderSelectedAppContext() {
  const a = state.applications.find((x) => x.id === state.selectedApplicationId);
  if (!a) {
    return `
      <div class="gf-banner" style="margin-bottom:16px;">
        <div>You're writing reusable answers. Open an application from the Dashboard to answer it with its deadline and portal in view.</div>
        <button class="gf-btn gf-btn-ghost gf-btn-sm" data-tab="dashboard">Go to Dashboard</button>
      </div>
    `;
  }
  const s = statusMeta(a.status);
  const d = daysUntil(a.deadline);
  const answered = state.answers.length;
  return `
    <div class="gf-card gf-appctx" style="margin-bottom:16px;">
      <div class="gf-row" style="align-items:flex-start;">
        <div style="min-width:0;">
          <div class="gf-eyebrow">Working on</div>
          <div class="gf-display" style="font-size:16px;font-weight:600;">${esc(a.applicationName || "Untitled application")}</div>
          <div style="font-size:12.5px;color:var(--ink-soft);margin-top:2px;">${esc(a.funderName || "No funder set")}</div>
        </div>
        <span class="gf-badge" style="color:${s.color};background:${s.bg};">${s.label}</span>
      </div>
      <div style="display:flex;align-items:center;gap:14px;margin-top:10px;font-size:12px;color:var(--ink-soft);flex-wrap:wrap;">
        ${a.deadline ? `<span>Due ${esc(a.deadline)}${d !== null ? ` <span class="gf-mono">(${d >= 0 ? d + "d left" : "past"})</span>` : ""}</span>` : "<span>No deadline set</span>"}
        ${a.sourceUrl ? `<a href="${esc(a.sourceUrl)}" target="_blank" rel="noopener" style="color:var(--slate);">Open portal ↗</a>` : ""}
        <span>${answered} saved answer${answered === 1 ? "" : "s"} available</span>
      </div>
      <div class="gf-hstack" style="margin-top:12px;">
        <button class="gf-btn gf-btn-ghost gf-btn-sm" id="clearSelectedApp">← Back to all applications</button>
        <button class="gf-btn gf-btn-ghost gf-btn-sm" id="editSelectedApp">Edit details</button>
      </div>
    </div>
  `;
}

function renderAnswers() {
  const q = state.ui.answerSearch.toLowerCase();
  const filtered = state.answers.filter((a) => (a.question + " " + a.answer).toLowerCase().includes(q));
  const aiConfigured = state.status && state.status.aiConfigured;

  const draftResult = state.ui.draftUnavailable ? `
    <div class="gf-card gf-banner-warn" style="margin-top:10px;">
      <div style="font-size:12.5px;line-height:1.5;">${esc(state.ui.draftUnavailable)}</div>
      <div class="gf-hstack" style="margin-top:10px;">
        <button class="gf-btn gf-btn-primary gf-btn-sm" id="draftManualBtn">Write it manually</button>
        <button class="gf-btn gf-btn-ghost gf-btn-sm" id="draftUseSavedBtn">Use a saved answer</button>
      </div>
    </div>
  ` : state.ui.draftAnswer ? `
    <div class="gf-card" style="margin-top:10px;background:var(--brass-light);border-color:var(--brass);">
      <div class="gf-hstack" style="justify-content:space-between;margin-bottom:6px;">
        <span class="gf-badge gf-badge-ai">AI-generated draft</span>
        <span style="font-size:11px;color:var(--ink-soft);">Review before copying</span>
      </div>
      <label class="gf-label" for="draftAnswerEdit">Edit before you copy or save</label>
      <textarea class="gf-textarea" id="draftAnswerEdit" style="min-height:96px;background:var(--panel);">${esc(state.ui.draftAnswer)}</textarea>
      ${state.ui.draftStatus ? `<div style="font-size:11px;color:var(--ink-soft);margin-top:6px;">${esc(state.ui.draftStatus)}</div>` : ""}
      <div class="gf-hstack" style="margin-top:10px;">
        <button class="gf-btn gf-btn-primary gf-btn-sm" id="draftCopyBtn">Copy</button>
        <button class="gf-btn gf-btn-ghost gf-btn-sm" id="draftSaveBtn">Save to answers</button>
        <button class="gf-btn gf-btn-ghost gf-btn-sm" id="draftDiscardBtn">Discard</button>
      </div>
    </div>
  ` : "";

  return `
    ${renderSelectedAppContext()}
    <div class="gf-card" style="margin-bottom:16px;">
      <label class="gf-label" for="draftQuestion" style="margin-bottom:6px;">Draft a new answer</label>
      <textarea class="gf-textarea" id="draftQuestion" placeholder="Paste the question from your grant form…">${esc(state.ui.draftQuestion)}</textarea>
      <div class="gf-hstack" style="margin-top:8px;flex-wrap:wrap;">
        ${aiConfigured
          ? `<button class="gf-btn gf-btn-brass gf-btn-sm" id="draftBtn" ${state.ui.draftBusy ? "disabled" : ""}>${state.ui.draftBusy ? "Drafting…" : "Draft with AI"}</button>`
          : `<button class="gf-btn gf-btn-brass gf-btn-sm" id="draftBtn" disabled title="No AI key configured">Draft with AI (unavailable)</button>`}
        <button class="gf-btn gf-btn-ghost gf-btn-sm" id="writeManualBtn">Write it manually</button>
        ${!aiConfigured ? `<span style="font-size:11.5px;color:var(--ink-soft);">AI drafting is off — no API key configured. Write answers yourself or reuse saved ones.</span>` : ""}
      </div>
      ${draftResult}
    </div>

    <label class="gf-label" for="answerSearch" style="margin-bottom:4px;">Search saved answers</label>
    <input class="gf-input" id="answerSearch" placeholder="Search your saved answers" value="${esc(state.ui.answerSearch)}" style="margin-bottom:12px;" />

    <div class="gf-row" style="margin-bottom:10px;">
      <div class="gf-display" style="font-size:15px;font-weight:600;">Saved answers <span class="gf-mono" style="font-size:12px;color:var(--ink-soft);">(${filtered.length})</span></div>
      <button class="gf-btn gf-btn-ghost gf-btn-sm" id="addAnswerBtn">+ Add manually</button>
    </div>

    ${filtered.length === 0 ? `
      <div class="gf-empty">${state.answers.length === 0 ? "No saved answers yet. Draft one above, or add one manually." : "No answers match that search."}</div>
    ` : `
      <div class="gf-stack">
        ${filtered.map(renderAnswerCard).join("")}
      </div>
    `}
  `;
}

function renderAnswerCard(a) {
  const title = a.question.split("|")[0].trim();
  const src = answerSourceMeta(a.source);
  return `
    <div class="gf-card" style="padding:12px;">
      <div class="gf-row" style="align-items:flex-start;">
        <div style="font-weight:600;font-size:13.5px;min-width:0;">${esc(title)}</div>
        <span class="gf-badge gf-badge-${src.kind}">${src.label}</span>
      </div>
      <div style="font-size:12.5px;color:var(--ink-soft);margin-top:6px;line-height:1.5;">${esc(a.answer)}</div>
      <div class="gf-hstack" style="margin-top:10px;">
        <button class="gf-btn gf-btn-primary gf-btn-sm copy-answer-btn" data-id="${a.id}">Copy</button>
        <button class="gf-btn gf-btn-ghost gf-btn-sm edit-answer-btn" data-id="${a.id}">Edit</button>
        <button class="gf-btn gf-btn-danger gf-btn-sm delete-answer-btn" data-id="${a.id}">Delete</button>
      </div>
    </div>
  `;
}

function wireAnswers() {
  app.querySelectorAll("[data-tab]").forEach((btn) => btn.addEventListener("click", () => goTab(btn.dataset.tab)));

  const clearSel = document.getElementById("clearSelectedApp");
  if (clearSel) clearSel.addEventListener("click", () => { state.selectedApplicationId = null; render(); });
  const editSel = document.getElementById("editSelectedApp");
  if (editSel) editSel.addEventListener("click", () => {
    const item = state.applications.find((a) => a.id === state.selectedApplicationId);
    if (item) { state.ui.appModal = { mode: "edit", data: { ...item } }; render(); }
  });

  const search = document.getElementById("answerSearch");
  search.addEventListener("input", () => {
    state.ui.answerSearch = search.value; render();
    const s = document.getElementById("answerSearch");
    s.focus(); s.selectionStart = s.value.length;
  });

  const draftQ = document.getElementById("draftQuestion");
  draftQ.addEventListener("input", () => { state.ui.draftQuestion = draftQ.value; });

  const draftEdit = document.getElementById("draftAnswerEdit");
  if (draftEdit) draftEdit.addEventListener("input", () => { state.ui.draftAnswer = draftEdit.value; });

  const writeManual = document.getElementById("writeManualBtn");
  if (writeManual) writeManual.addEventListener("click", () => {
    state.ui.answerModal = { mode: "add", data: { question: state.ui.draftQuestion.trim(), answer: "" } };
    render();
  });
  const draftManual = document.getElementById("draftManualBtn");
  if (draftManual) draftManual.addEventListener("click", () => {
    state.ui.answerModal = { mode: "add", data: { question: state.ui.draftQuestion.trim(), answer: "" } };
    render();
  });
  const useSaved = document.getElementById("draftUseSavedBtn");
  if (useSaved) useSaved.addEventListener("click", () => { const s = document.getElementById("answerSearch"); if (s) s.focus(); });

  const draftBtn = document.getElementById("draftBtn");
  if (draftBtn) draftBtn.addEventListener("click", async () => {
    const question = state.ui.draftQuestion.trim();
    if (!question) { toast("Paste a question first"); return; }
    state.ui.draftBusy = true; state.ui.draftUnavailable = ""; render();
    try {
      const res = await api("/api/chat", { method: "POST", body: { question, fields: [] } });
      if (res.available === false || !res.answer) {
        state.ui.draftAnswer = "";
        state.ui.draftStatus = "";
        state.ui.draftUnavailable = res.status || "AI drafting is unavailable. Write the answer yourself or reuse a saved answer.";
      } else {
        state.ui.draftAnswer = res.answer;
        state.ui.draftStatus = res.status || "Draft generated. Review before copying.";
        state.ui.draftUnavailable = "";
      }
    } catch (err) {
      state.ui.draftUnavailable = err.message || "Couldn't draft that right now.";
    } finally {
      state.ui.draftBusy = false; render();
    }
  });

  const copyBtn = document.getElementById("draftCopyBtn");
  if (copyBtn) copyBtn.addEventListener("click", () => copyText(state.ui.draftAnswer));

  const discardBtn = document.getElementById("draftDiscardBtn");
  if (discardBtn) discardBtn.addEventListener("click", () => { state.ui.draftAnswer = ""; state.ui.draftStatus = ""; render(); });

  const saveBtn = document.getElementById("draftSaveBtn");
  if (saveBtn) saveBtn.addEventListener("click", async () => {
    const answer = (state.ui.draftAnswer || "").trim();
    if (!answer) { toast("Nothing to save yet"); return; }
    await saveAnswers([...state.answers, {
      id: `ans_${Date.now()}`,
      question: state.ui.draftQuestion.trim(),
      answer,
      source: "chat-draft",
      updatedAt: new Date().toISOString(),
    }]);
    state.ui.draftQuestion = "";
    state.ui.draftAnswer = "";
    state.ui.draftStatus = "";
    toast("Saved to your answers");
    render();
  });

  document.getElementById("addAnswerBtn").addEventListener("click", () => {
    state.ui.answerModal = { mode: "add", data: { question: "", answer: "" } };
    render();
  });

  app.querySelectorAll(".copy-answer-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const item = state.answers.find((a) => a.id === btn.dataset.id);
      if (item) copyText(item.answer);
    });
  });
  app.querySelectorAll(".edit-answer-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const item = state.answers.find((a) => a.id === btn.dataset.id);
      if (item) { state.ui.answerModal = { mode: "edit", data: { ...item } }; render(); }
    });
  });
  app.querySelectorAll(".delete-answer-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm("Delete this saved answer?")) return;
      await saveAnswers(state.answers.filter((a) => a.id !== btn.dataset.id));
      toast("Deleted");
      render();
    });
  });
}

async function saveAnswers(nextItems) {
  try {
    const res = await api("/api/answers", { method: "PUT", body: { items: nextItems } });
    state.answers = res.items || [];
  } catch (err) {
    toast(err.message || "Couldn't save your answers");
  }
}

function renderAnswerModal() {
  const { mode, data } = state.ui.answerModal;
  return `
    <div class="gf-modal-overlay" id="answerModalOverlay">
      <div class="gf-modal" role="dialog" aria-modal="true" aria-labelledby="answerModalTitle">
        <div class="gf-row" style="margin-bottom:14px;">
          <div class="gf-display" id="answerModalTitle" style="font-size:16px;font-weight:600;">${mode === "add" ? "Add an answer" : "Edit answer"}</div>
          <button class="gf-btn gf-btn-ghost gf-btn-sm" id="answerModalClose">Close</button>
        </div>
        <div class="gf-field"><label class="gf-label" for="aQuestion">Question <span class="gf-req">*</span></label><input class="gf-input" id="aQuestion" required value="${esc(data.question)}" /></div>
        <div class="gf-field"><label class="gf-label" for="aAnswer">Answer <span class="gf-req">*</span></label><textarea class="gf-textarea" id="aAnswer" required style="min-height:100px;">${esc(data.answer)}</textarea></div>
        <div class="gf-hstack" style="margin-top:6px;">
          <button class="gf-btn gf-btn-primary" id="answerModalSave">Save</button>
          <button class="gf-btn gf-btn-ghost" id="answerModalCancel">Cancel</button>
        </div>
      </div>
    </div>
  `;
}

function wireAnswerModal() {
  const close = () => { state.ui.answerModal = null; render(); };
  const overlay = document.getElementById("answerModalOverlay");
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
  document.getElementById("answerModalClose").addEventListener("click", close);
  document.getElementById("answerModalCancel").addEventListener("click", close);
  document.getElementById("aQuestion").focus();
  document.getElementById("answerModalSave").addEventListener("click", async () => {
    const { mode, data } = state.ui.answerModal;
    const qEl = document.getElementById("aQuestion");
    const aEl = document.getElementById("aAnswer");
    const question = qEl.value.trim();
    const answer = aEl.value.trim();
    if (!question || !answer) {
      toast("Fill in both the question and the answer");
      (question ? aEl : qEl).classList.add("gf-invalid");
      (question ? aEl : qEl).focus();
      return;
    }
    let nextItems;
    if (mode === "add") {
      nextItems = [...state.answers, { id: `ans_${Date.now()}`, question, answer, source: "manual", updatedAt: new Date().toISOString() }];
    } else {
      nextItems = state.answers.map((a) => (a.id === data.id ? { ...a, question, answer, updatedAt: new Date().toISOString() } : a));
    }
    await saveAnswers(nextItems);
    state.ui.answerModal = null;
    toast("Saved");
    render();
  });
}

/* ---------------- organization profile ---------------- */
function renderProfile() {
  const p = state.ui.profileDraft || state.profile;
  const fields = [
    ["organization", "Organization name", "input", true],
    ["primaryContact", "Primary contact", "input", false],
    ["contactTitle", "Contact title", "input", false],
    ["contactEmail", "Contact email", "input", false],
    ["mission", "Mission statement", "textarea", true],
    ["summary", "One-line summary", "textarea", true],
    ["requestedAmountNarrative", "Typical requested-amount language", "textarea", false],
  ];
  const warnings = profileQualityWarnings(p);
  const entry = activeOrgEntry();
  const reviewBanner = profileNeedsReview() ? `
    <div class="gf-banner gf-banner-warn" style="margin-bottom:16px;">
      <div>
        <strong>Needs review.</strong> This organization was imported${entry && entry.website ? ` from <span class="gf-mono">${esc(entry.website)}</span>` : ""}. Rewrite the mission and summary in your own words, then save to confirm.
      </div>
    </div>
  ` : "";
  const warnBox = warnings.length ? `
    <div class="gf-banner gf-banner-warn" style="margin-bottom:16px;">
      <div><strong>Profile quality:</strong><ul style="margin:6px 0 0;padding-left:18px;">${warnings.map((w) => `<li>${esc(w)}</li>`).join("")}</ul></div>
    </div>
  ` : "";
  return `
    ${reviewBanner}
    ${warnBox}
    <div class="gf-card">
      <div style="font-size:12.5px;color:var(--ink-soft);margin-bottom:14px;line-height:1.5;">
        Fill this in once. It backs every AI draft and appears as a quick-copy source alongside your saved answers.
      </div>
      <div class="gf-stack">
        ${fields.map(([key, label, kind, required]) => {
          const id = `pf_${key}`;
          return `
          <div class="gf-field">
            <label class="gf-label" for="${id}">${label}${required ? ` <span class="gf-req">*</span>` : ""}</label>
            ${kind === "textarea"
              ? `<textarea class="gf-textarea" id="${id}" data-field="${key}">${esc(p[key] || "")}</textarea>`
              : `<input class="gf-input" id="${id}" data-field="${key}" value="${esc(p[key] || "")}" />`}
          </div>`;
        }).join("")}
      </div>
      <button class="gf-btn gf-btn-primary" id="saveProfileBtn" style="margin-top:16px;">Save profile</button>
    </div>
  `;
}

function wireProfile() {
  app.querySelectorAll("[data-field]").forEach((el) => {
    el.addEventListener("input", () => {
      state.ui.profileDraft = state.ui.profileDraft || { ...state.profile };
      state.ui.profileDraft[el.dataset.field] = el.value;
    });
  });
  document.getElementById("saveProfileBtn").addEventListener("click", async () => {
    const payload = {};
    app.querySelectorAll("[data-field]").forEach((el) => { payload[el.dataset.field] = el.value; });
    payload.approveImportedContent = profileNeedsReview();
    const required = [
      ["organization", "pf_organization", "Organization name"],
      ["mission", "pf_mission", "Mission statement"],
      ["summary", "pf_summary", "One-line summary"]
    ];
    const missing = required.find(([key]) => !String(payload[key] || "").trim());
    const scraped = [["mission", "pf_mission"], ["summary", "pf_summary"]].find(([key]) => looksLikeScrape(payload[key]));
    if (missing || scraped) {
      const [, id, label] = missing || [...scraped, "This field"];
      toast(missing ? `${label} is required` : "Rewrite this field in your own words before confirming");
      const el = document.getElementById(id);
      el.classList.add("gf-invalid"); el.focus();
      return;
    }
    try {
      state.profile = await api("/api/profile", { method: "PUT", body: payload });
      state.ui.profileDraft = null;
      toast("Profile saved");
      render();
    } catch (err) {
      toast(err.message || "Couldn't save your profile");
    }
  });
}

/* ---------------- onboarding view ---------------- */
function renderOnboarding() {
  const step = state.ui.onboarding.step;
  const steps = ["Organization", "Review profile", "First application"];
  const stepper = `
    <div class="gf-stepper" role="list">
      ${steps.map((label, i) => `
        <div class="gf-step ${step === i + 1 ? "current" : ""} ${step > i + 1 ? "done" : ""}" role="listitem">
          <span class="gf-step-num">${step > i + 1 ? "✓" : i + 1}</span><span>${label}</span>
        </div>
      `).join("")}
    </div>
  `;
  let bodyHtml = "";
  if (step === 1) bodyHtml = renderOnboardingStep1();
  else if (step === 2) bodyHtml = renderOnboardingStep2();
  else bodyHtml = renderOnboardingStep3();
  return `${stepper}${bodyHtml}
    <div style="margin-top:18px;"><button class="gf-btn gf-btn-ghost gf-btn-sm" id="onbSkip">Skip setup — go to Dashboard</button></div>`;
}

function renderOnboardingStep1() {
  const orgs = orgDisplayList();
  const busy = state.ui.onboarding.busy;
  return `
    <div class="gf-card" style="margin-bottom:14px;">
      <div class="gf-display" style="font-size:15px;font-weight:600;margin-bottom:4px;">Choose an organization</div>
      <div style="font-size:12.5px;color:var(--ink-soft);margin-bottom:12px;line-height:1.5;">Everything you draft is scoped to one organization at a time. Pick one to continue.</div>
      <div class="gf-stack">
        ${orgs.map((o) => `
          <button class="gf-btn ${o.id === state.profile.activeOrganizationId ? "gf-btn-primary" : "gf-btn-ghost"}" style="justify-content:space-between;" data-choose-org="${o.id}">
            <span>${esc(o.organization)}${o.needsReview ? ` <span class="gf-badge gf-badge-saved" style="margin-left:6px;">Needs review</span>` : ""}</span>
            ${o.hint ? `<span class="gf-mono" style="font-size:10.5px;color:var(--ink-soft);">${esc(o.hint)}</span>` : ""}
          </button>
        `).join("")}
      </div>
    </div>
    <div class="gf-card" style="margin-bottom:14px;">
      <div class="gf-display" style="font-size:15px;font-weight:600;margin-bottom:10px;">Or create a new one</div>
      <div class="gf-field"><label class="gf-label" for="onbNewOrg">Organization name</label><input class="gf-input" id="onbNewOrg" value="${esc(state.ui.onboarding.orgName)}" placeholder="e.g. Riverside Youth Center" /></div>
      <button class="gf-btn gf-btn-brass gf-btn-sm" id="onbCreateBlank">Create blank organization</button>
    </div>
    <div class="gf-card">
      <div class="gf-display" style="font-size:15px;font-weight:600;margin-bottom:4px;">Or import from a website</div>
      <div style="font-size:12px;color:var(--ink-soft);margin-bottom:10px;line-height:1.5;">We pull a few public pages as a starting point. You'll review everything before it's used in a draft.</div>
      <div class="gf-field"><label class="gf-label" for="onbImportName">Organization name</label><input class="gf-input" id="onbImportName" value="${esc(state.ui.onboarding.orgName)}" /></div>
      <div class="gf-field"><label class="gf-label" for="onbImportSite">Public website</label><input class="gf-input" id="onbImportSite" value="${esc(state.ui.onboarding.website)}" placeholder="https://" /></div>
      <button class="gf-btn gf-btn-primary gf-btn-sm" id="onbImportBtn" ${busy === "import" ? "disabled" : ""}>${busy === "import" ? "Importing…" : "Import website"}</button>
    </div>
  `;
}

function renderOnboardingStep2() {
  const p = state.ui.profileDraft || state.profile;
  const needs = profileNeedsReview();
  const entry = activeOrgEntry();
  const fields = [
    ["organization", "Organization name", "input"],
    ["mission", "Mission statement", "textarea"],
    ["summary", "One-line summary", "textarea"],
  ];
  return `
    <div class="gf-banner ${needs ? "gf-banner-warn" : "gf-banner-ok"}" style="margin-bottom:14px;">
      <div>${needs
        ? `<strong>Needs review.</strong> Imported${entry && entry.website ? ` from <span class="gf-mono">${esc(entry.website)}</span>` : ""}. Rewrite anything that reads like raw website text before it's used in a draft.`
        : `<strong>Looks good.</strong> Confirm the basics below, then add your first application.`}</div>
    </div>
    ${entry && entry.needsReview && p.summary && looksLikeScrape(p.summary) ? "" : ""}
    <div class="gf-card">
      <div class="gf-stack">
        ${fields.map(([key, label, kind]) => {
          const id = `onb_${key}`;
          const flagged = kind === "textarea" && looksLikeScrape(p[key]);
          return `
          <div class="gf-field">
            <label class="gf-label" for="${id}">${label} <span class="gf-req">*</span>${flagged ? ` <span class="gf-badge gf-badge-ai" style="text-transform:none;">looks scraped</span>` : ""}</label>
            ${kind === "textarea"
              ? `<textarea class="gf-textarea" id="${id}" data-onb-field="${key}" placeholder="Write in your own words…">${esc(p[key] || "")}</textarea>`
              : `<input class="gf-input" id="${id}" data-onb-field="${key}" value="${esc(p[key] || "")}" />`}
          </div>`;
        }).join("")}
      </div>
      ${entry && entry.website ? `<div style="font-size:11px;color:var(--ink-soft);margin-top:10px;">Source: <span class="gf-mono">${esc(entry.website)}</span>. Imported text is kept as background context but won't appear as a fact until you review it.</div>` : ""}
      <div class="gf-hstack" style="margin-top:16px;">
        <button class="gf-btn gf-btn-ghost gf-btn-sm" id="onbBack2">← Back</button>
        <button class="gf-btn gf-btn-primary" id="onbSaveReview">Save & continue</button>
      </div>
    </div>
  `;
}

function renderOnboardingStep3() {
  const d = state.ui.onboarding;
  return `
    <div class="gf-card">
      <div class="gf-display" style="font-size:15px;font-weight:600;margin-bottom:4px;">Add your first application</div>
      <div style="font-size:12.5px;color:var(--ink-soft);margin-bottom:12px;line-height:1.5;">Track one grant. You can add more anytime from the Dashboard.</div>
      <div class="gf-field"><label class="gf-label" for="onbAppName">Application name <span class="gf-req">*</span></label><input class="gf-input" id="onbAppName" required value="${esc(d.appName || "")}" /></div>
      <div class="gf-field"><label class="gf-label" for="onbAppFunder">Funder name</label><input class="gf-input" id="onbAppFunder" value="${esc(d.appFunder || "")}" /></div>
      <div class="gf-field"><label class="gf-label" for="onbAppDeadline">Deadline</label><input class="gf-input" type="date" id="onbAppDeadline" value="${esc(d.appDeadline || "")}" /></div>
      <div class="gf-field"><label class="gf-label" for="onbAppUrl">Portal link</label><input class="gf-input" id="onbAppUrl" placeholder="https://" value="${esc(d.appUrl || "")}" /></div>
      <div class="gf-hstack" style="margin-top:8px;">
        <button class="gf-btn gf-btn-ghost gf-btn-sm" id="onbBack3">← Back</button>
        <button class="gf-btn gf-btn-primary" id="onbCreateApp">Add & start answering</button>
      </div>
    </div>
  `;
}

function wireOnboarding() {
  const skip = document.getElementById("onbSkip");
  if (skip) skip.addEventListener("click", () => goTab("dashboard"));

  // Step 1
  app.querySelectorAll("[data-choose-org]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      try {
        state.profile = await api("/api/profile/active", { method: "PUT", body: { id: btn.dataset.chooseOrg } });
        await reloadScoped();
        state.ui.profileDraft = null;
        state.ui.onboarding.step = 2;
        render();
      } catch (err) { toast(err.message || "Couldn't select that organization"); }
    });
  });
  const newOrgInput = document.getElementById("onbNewOrg");
  if (newOrgInput) newOrgInput.addEventListener("input", () => { state.ui.onboarding.orgName = newOrgInput.value; });
  const createBlank = document.getElementById("onbCreateBlank");
  if (createBlank) createBlank.addEventListener("click", async () => {
    const name = (document.getElementById("onbNewOrg").value || "").trim();
    if (!name) { toast("Enter an organization name first"); return; }
    try {
      state.profile = await api("/api/profile/organizations", { method: "POST", body: { organization: name } });
      state.answers = []; state.applications = []; state.selectedApplicationId = null;
      state.ui.profileDraft = null;
      state.ui.onboarding.step = 2;
      render();
    } catch (err) { toast(err.message || "Couldn't add that organization"); }
  });
  const importName = document.getElementById("onbImportName");
  if (importName) importName.addEventListener("input", () => { state.ui.onboarding.orgName = importName.value; });
  const importSite = document.getElementById("onbImportSite");
  if (importSite) importSite.addEventListener("input", () => { state.ui.onboarding.website = importSite.value; });
  const importBtn = document.getElementById("onbImportBtn");
  if (importBtn) importBtn.addEventListener("click", async () => {
    const organization = (document.getElementById("onbImportName").value || "").trim();
    const website = (document.getElementById("onbImportSite").value || "").trim();
    if (!organization || !website) { toast("Enter both a name and a website"); return; }
    state.ui.onboarding.busy = "import"; render();
    try {
      state.profile = await api("/api/onboard/website", { method: "POST", body: { organization, website } });
      await reloadScoped();
      state.selectedApplicationId = null;
      state.ui.profileDraft = null;
      state.ui.onboarding.busy = "";
      state.ui.onboarding.step = 2;
      toast("Imported — please review before drafting");
      render();
    } catch (err) {
      state.ui.onboarding.busy = ""; render();
      toast(err.message || "Couldn't import that website");
    }
  });

  // Step 2
  app.querySelectorAll("[data-onb-field]").forEach((el) => {
    el.addEventListener("input", () => {
      state.ui.profileDraft = state.ui.profileDraft || { ...state.profile };
      state.ui.profileDraft[el.dataset.onbField] = el.value;
    });
  });
  const back2 = document.getElementById("onbBack2");
  if (back2) back2.addEventListener("click", () => { state.ui.onboarding.step = 1; render(); });
  const saveReview = document.getElementById("onbSaveReview");
  if (saveReview) saveReview.addEventListener("click", async () => {
    const payload = {};
    app.querySelectorAll("[data-onb-field]").forEach((el) => { payload[el.dataset.onbField] = el.value; });
    payload.approveImportedContent = true;
    const required = [
      ["organization", "onb_organization", "Organization name"],
      ["mission", "onb_mission", "Mission statement"],
      ["summary", "onb_summary", "One-line summary"]
    ];
    const missing = required.find(([key]) => !String(payload[key] || "").trim());
    const scraped = [["mission", "onb_mission"], ["summary", "onb_summary"]].find(([key]) => looksLikeScrape(payload[key]));
    if (missing || scraped) {
      const [, id, label] = missing || [...scraped, "This field"];
      toast(missing ? `${label} is required` : "Rewrite this field in your own words before continuing");
      const el = document.getElementById(id);
      el.classList.add("gf-invalid"); el.focus();
      return;
    }
    try {
      state.profile = await api("/api/profile", { method: "PUT", body: payload });
      state.ui.profileDraft = null;
      state.ui.onboarding.step = 3;
      render();
    } catch (err) { toast(err.message || "Couldn't save the profile"); }
  });

  // Step 3
  const back3 = document.getElementById("onbBack3");
  if (back3) back3.addEventListener("click", () => { state.ui.onboarding.step = 2; render(); });
  ["onbAppName", "onbAppFunder", "onbAppDeadline", "onbAppUrl"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener("input", () => {
      const map = { onbAppName: "appName", onbAppFunder: "appFunder", onbAppDeadline: "appDeadline", onbAppUrl: "appUrl" };
      state.ui.onboarding[map[id]] = el.value;
    });
  });
  const createApp = document.getElementById("onbCreateApp");
  if (createApp) createApp.addEventListener("click", async () => {
    const nameEl = document.getElementById("onbAppName");
    const applicationName = nameEl.value.trim();
    if (!applicationName) { toast("Give the application a name"); nameEl.classList.add("gf-invalid"); nameEl.focus(); return; }
    try {
      const item = await api("/api/applications", { method: "POST", body: {
        applicationName,
        funderName: document.getElementById("onbAppFunder").value.trim(),
        deadline: document.getElementById("onbAppDeadline").value.trim(),
        sourceUrl: document.getElementById("onbAppUrl").value.trim(),
        status: "working",
        notes: "",
      } });
      state.applications = [item, ...state.applications];
      state.selectedApplicationId = item.id;
      state.ui.onboarding = { step: 1, orgName: "", website: "", busy: "" };
      toast("You're set up — start answering questions");
      goTab("answers");
    } catch (err) { toast(err.message || "Couldn't add that application"); }
  });
}

/* ---------------- org switcher ---------------- */
function renderOrgSwitcher() {
  const orgs = orgDisplayList();
  return `
    <div class="gf-modal-overlay" id="orgOverlay">
      <div class="gf-modal" role="dialog" aria-modal="true" aria-labelledby="orgSwitchTitle">
        <div class="gf-row" style="margin-bottom:14px;">
          <div class="gf-display" id="orgSwitchTitle" style="font-size:16px;font-weight:600;">Switch organization</div>
          <button class="gf-btn gf-btn-ghost gf-btn-sm" id="orgClose">Close</button>
        </div>
        <div class="gf-stack">
          ${orgs.map((o) => `
            <button class="gf-btn ${o.id === state.profile.activeOrganizationId ? "gf-btn-primary" : "gf-btn-ghost"}" style="justify-content:space-between;" data-org-id="${o.id}">
              <span>${esc(o.organization)}${o.needsReview ? ` <span class="gf-badge gf-badge-saved" style="margin-left:6px;">Needs review</span>` : ""}</span>
              ${o.hint ? `<span class="gf-mono" style="font-size:10.5px;color:var(--ink-soft);">${esc(o.hint)}</span>` : ""}
            </button>
          `).join("")}
        </div>
        <div class="gf-field" style="margin-top:14px;">
          <label class="gf-label" for="newOrgName">Add a new organization</label>
          <div class="gf-hstack">
            <input class="gf-input" id="newOrgName" placeholder="New organization name" />
            <button class="gf-btn gf-btn-brass gf-btn-sm" id="newOrgBtn">Add</button>
          </div>
        </div>
      </div>
    </div>
  `;
}

function wireOrgSwitcher() {
  const close = () => { state.ui.orgSwitcherOpen = false; render(); };
  const overlay = document.getElementById("orgOverlay");
  overlay.addEventListener("click", (e) => { if (e.target === overlay) close(); });
  document.getElementById("orgClose").addEventListener("click", close);
  app.querySelectorAll("[data-org-id]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      try {
        state.profile = await api("/api/profile/active", { method: "PUT", body: { id: btn.dataset.orgId } });
        await reloadScoped();
        state.selectedApplicationId = null;
        state.ui.orgSwitcherOpen = false;
        toast(`Switched to ${state.profile.organization}`);
        render();
      } catch (err) {
        toast(err.message || "Couldn't switch organizations");
      }
    });
  });
  document.getElementById("newOrgBtn").addEventListener("click", async () => {
    const input = document.getElementById("newOrgName");
    const name = input.value.trim();
    if (!name) { toast("Enter a name first"); input.focus(); return; }
    const dupe = (state.profile.organizations || []).some((o) => (o.organization || "").trim().toLowerCase() === name.toLowerCase());
    if (dupe && !confirm(`An organization named "${name}" already exists. Add another with the same name?`)) return;
    try {
      state.profile = await api("/api/profile/organizations", { method: "POST", body: { organization: name } });
      state.answers = [];
      state.applications = [];
      state.selectedApplicationId = null;
      state.ui.orgSwitcherOpen = false;
      toast(`${name} added`);
      render();
    } catch (err) {
      toast(err.message || "Couldn't add that organization");
    }
  });
}

/* ---------------- help & split screen ---------------- */
const GUIDE_STEPS = {
  win: [
    { k: `<span class="gf-kbd">Win</span><span class="gf-kbd">←</span>`, t: "Snap Grant Flow left", d: "Click this window, then press the shortcut. It jumps to the left half instantly." },
    { k: `<span class="gf-kbd">Click</span>`, t: "Choose the portal for the other half", d: "Windows shows your open windows as thumbnails — click your grant portal to fill the right side." },
    { k: `<span class="gf-kbd">Drag</span>`, t: "Adjust the divider", d: "Drag the line between the two windows to give either side more room." },
  ],
  mac: [
    { k: `<span class="gf-kbd">Hold</span> 🟢`, t: "Hold the green button", d: `Hover Grant Flow's green full-screen button until the tile menu appears, then choose "Tile Window to Left of Screen."` },
    { k: `<span class="gf-kbd">Click</span>`, t: "Pick your grant portal", d: "macOS lists your other open windows — click the portal to snap it to the right half." },
    { k: `<span class="gf-kbd">Drag</span>`, t: "Adjust the divider", d: "Drag the center line to resize either pane." },
  ],
};

function renderGuide() {
  const os = state.ui.guideOs;
  const steps = GUIDE_STEPS[os];
  return `
    <div class="gf-card" style="margin-bottom:16px;">
      <div class="gf-display" style="font-size:15px;font-weight:600;margin-bottom:6px;">How Grant Flow works</div>
      <div style="font-size:12.5px;color:var(--ink-soft);line-height:1.6;">
        Grant Flow is a workspace for drafting and storing grant answers. It never touches the funder's portal and never submits anything for you —
        you copy each answer and paste it into the portal yourself. Put Grant Flow on one side of your screen and the portal on the other so copying across is quick.
      </div>
    </div>
    <div class="gf-display" style="font-size:15px;font-weight:600;margin-bottom:10px;">Put Grant Flow in split screen</div>
    <div class="gf-hstack" style="margin-bottom:16px;">
      <button class="gf-btn ${os === "win" ? "gf-btn-primary" : "gf-btn-ghost"}" data-os="win">Windows</button>
      <button class="gf-btn ${os === "mac" ? "gf-btn-primary" : "gf-btn-ghost"}" data-os="mac">macOS</button>
    </div>
    <div class="gf-card" style="margin-bottom:16px;padding:18px;">
      <div style="display:flex;gap:10px;height:90px;">
        <div style="flex:1;background:var(--forest);border-radius:7px;display:flex;align-items:center;justify-content:center;color:#fff;font-size:11.5px;font-weight:600;">Grant Flow</div>
        <div style="flex:1;background:var(--line-soft);border:1px dashed var(--ink-soft);border-radius:7px;display:flex;align-items:center;justify-content:center;color:var(--ink-soft);font-size:11.5px;font-weight:600;">Your grant portal</div>
      </div>
      <div style="font-size:11.5px;color:var(--ink-soft);margin-top:10px;text-align:center;">What you're aiming for — Grant Flow on one side, the funder's form on the other</div>
    </div>
    <div class="gf-stack">
      ${steps.map((s, i) => `
        <div class="gf-card" style="display:flex;gap:14px;align-items:flex-start;">
          <div class="gf-mono" style="width:22px;height:22px;border-radius:50%;background:var(--forest-tint);color:var(--forest);display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;flex-shrink:0;margin-top:1px;">${i + 1}</div>
          <div style="flex:1;">
            <div class="gf-hstack" style="margin-bottom:3px;"><span style="font-weight:600;font-size:13.5px;">${s.t}</span>${s.k}</div>
            <div style="font-size:12.5px;color:var(--ink-soft);line-height:1.5;">${s.d}</div>
          </div>
        </div>
      `).join("")}
    </div>
    <div style="font-size:11.5px;color:var(--ink-soft);margin-top:14px;">
      Works the same way in both Chrome and Edge — the shortcut lives in Windows or macOS, not the browser.
    </div>
  `;
}

function wireGuide() {
  app.querySelectorAll("[data-os]").forEach((btn) => {
    btn.addEventListener("click", () => { state.ui.guideOs = btn.dataset.os; render(); });
  });
}

/* ---------------- boot ---------------- */
function boot() {
  if (window.location && window.location.pathname === "/onboarding") {
    state.tab = "onboarding";
  }
  loadAll();
}

boot();
