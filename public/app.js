/* Grant Flow — split-screen grant assistant. Vanilla JS, no build step. */

const state = {
  tab: "dashboard",
  loading: true,
  error: "",
  status: null,
  profile: null,
  answers: [],
  applications: [],
  ui: {
    orgSwitcherOpen: false,
    appModal: null, // { mode: 'add' | 'edit', data: {...} } | null
    answerModal: null, // { mode: 'add' | 'edit', data: {...} } | null
    answerSearch: "",
    draftQuestion: "",
    draftAnswer: "",
    draftBusy: false,
    profileDraft: null,
    guideOs: "win",
  },
};

const NAV = [
  { id: "dashboard", label: "Dashboard", icon: "◧", eyebrow: "Overview", title: "Dashboard", sub: "Every application, one glance." },
  { id: "answers", label: "Answer library", icon: "✎", eyebrow: "Split-screen autofill", title: "Answer library", sub: "Write it once here, then copy it into the form on your other half." },
  { id: "profile", label: "Profile", icon: "◔", eyebrow: "Organization info", title: "Profile", sub: "The facts that stay the same on every application." },
  { id: "guide", label: "Split-screen guide", icon: "⛶", eyebrow: "Setup", title: "Put Grant Flow in split screen", sub: "Two minutes, once, and you're set for every grant." },
];

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

/* ---------------- helpers ---------------- */
function esc(str = "") {
  return String(str).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function toast(message) {
  let el = document.querySelector(".gf-toast");
  if (!el) {
    el = document.createElement("div");
    el.className = "gf-toast";
    document.body.appendChild(el);
  }
  el.textContent = message;
  el.classList.add("show");
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove("show"), 1800);
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

/* ---------------- render shell ---------------- */
function render() {
  const active = NAV.find((n) => n.id === state.tab);
  app.innerHTML = `
    <div class="gf-root">
      <div class="gf-rail">
        <div class="gf-rail-logo" title="Grant Flow">G</div>
        ${NAV.map((n) => `
          <button class="gf-rail-btn ${state.tab === n.id ? "active" : ""}" data-tab="${n.id}" aria-label="${n.label}">
            <span aria-hidden="true">${n.icon}</span>
            <span class="gf-rail-tip">${n.label}</span>
          </button>
        `).join("")}
        <div class="gf-rail-spacer"></div>
        ${state.profile ? `<button class="gf-rail-org" id="orgSwitchBtn" title="Switch organization">${esc(initials(state.profile.organization))}</button>` : ""}
      </div>
      <div class="gf-main">
        <div class="gf-topbar">
          <div class="gf-eyebrow">${active.eyebrow}</div>
          <h1 class="gf-title gf-display">${active.title}</h1>
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
  if (state.tab === "dashboard") return renderDashboard();
  if (state.tab === "answers") return renderAnswers();
  if (state.tab === "profile") return renderProfile();
  if (state.tab === "guide") return renderGuide();
  return "";
}

function wireGlobal() {
  app.querySelectorAll("[data-tab]").forEach((btn) => {
    btn.addEventListener("click", () => { state.tab = btn.dataset.tab; render(); });
  });
  const orgBtn = document.getElementById("orgSwitchBtn");
  if (orgBtn) orgBtn.addEventListener("click", () => { state.ui.orgSwitcherOpen = true; render(); });
  const retryBtn = document.getElementById("retryBtn");
  if (retryBtn) retryBtn.addEventListener("click", loadAll);
}

/* ---------------- dashboard ---------------- */
function renderDashboard() {
  const apps = state.applications;
  const activeCount = apps.filter((a) => !["awarded", "declined"].includes(a.status)).length;
  const next = apps
    .map((a) => ({ a, d: daysUntil(a.deadline) }))
    .filter((x) => x.d !== null && x.d >= 0)
    .sort((x, y) => x.d - y.d)[0];

  return `
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
        No applications yet. Add one for each grant you're working on — you'll track its deadline and status here,
        then use the Answer library tab beside your portal to fill it in.
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
    <div class="gf-card gf-hstack" style="align-items:flex-start;" data-app-id="${a.id}">
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
  `;
}

function wireTab() {
  if (state.tab === "dashboard") wireDashboard();
  if (state.tab === "answers") wireAnswers();
  if (state.tab === "profile") wireProfile();
  if (state.tab === "guide") wireGuide();
}

function wireDashboard() {
  const addBtn = document.getElementById("addAppBtn");
  if (addBtn) addBtn.addEventListener("click", () => {
    state.ui.appModal = { mode: "add", data: { funderName: "", applicationName: "", deadline: "", sourceUrl: "", status: "working", notes: "" } };
    render();
  });
  app.querySelectorAll(".edit-app-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const item = state.applications.find((a) => a.id === btn.dataset.id);
      if (item) { state.ui.appModal = { mode: "edit", data: { ...item } }; render(); }
    });
  });
}

function renderAppModal() {
  const { mode, data } = state.ui.appModal;
  return `
    <div class="gf-modal-overlay" id="appModalOverlay">
      <div class="gf-modal">
        <div class="gf-row" style="margin-bottom:14px;">
          <div class="gf-display" style="font-size:16px;font-weight:600;">${mode === "add" ? "New application" : "Edit application"}</div>
          <button class="gf-btn gf-btn-ghost gf-btn-sm" id="appModalClose">Close</button>
        </div>
        <div class="gf-field"><label class="gf-label">Funder name</label><input class="gf-input" id="fFunder" value="${esc(data.funderName)}" /></div>
        <div class="gf-field"><label class="gf-label">Application name</label><input class="gf-input" id="fName" value="${esc(data.applicationName)}" /></div>
        <div class="gf-field"><label class="gf-label">Deadline</label><input class="gf-input" type="date" id="fDeadline" value="${esc(data.deadline)}" /></div>
        <div class="gf-field"><label class="gf-label">Portal link</label><input class="gf-input" id="fUrl" placeholder="https://" value="${esc(data.sourceUrl)}" /></div>
        <div class="gf-field">
          <label class="gf-label">Status</label>
          <select class="gf-select" id="fStatus">
            ${Object.entries(STATUS_STYLE).map(([k, v]) => `<option value="${k}" ${data.status === k ? "selected" : ""}>${v.label}</option>`).join("")}
          </select>
        </div>
        <div class="gf-field"><label class="gf-label">Notes</label><textarea class="gf-textarea" id="fNotes">${esc(data.notes)}</textarea></div>
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
  document.getElementById("appModalSave").addEventListener("click", async () => {
    const { mode, data } = state.ui.appModal;
    const payload = {
      id: data.id,
      funderName: document.getElementById("fFunder").value.trim(),
      applicationName: document.getElementById("fName").value.trim(),
      deadline: document.getElementById("fDeadline").value.trim(),
      sourceUrl: document.getElementById("fUrl").value.trim(),
      status: document.getElementById("fStatus").value,
      notes: document.getElementById("fNotes").value.trim(),
    };
    try {
      if (mode === "add") {
        const item = await api("/api/applications", { method: "POST", body: payload });
        state.applications = [item, ...state.applications];
        toast("Application added");
      } else {
        const item = await api("/api/applications", { method: "PUT", body: payload });
        state.applications = state.applications.map((a) => (a.id === item.id ? item : a));
        toast("Saved");
      }
      state.ui.appModal = null;
      render();
    } catch (err) {
      toast(err.message || "Couldn't save that");
    }
  });
}

/* ---------------- answer library / autofill ---------------- */
function renderAnswers() {
  const q = state.ui.answerSearch.toLowerCase();
  const filtered = state.answers.filter((a) => (a.question + " " + a.answer).toLowerCase().includes(q));

  return `
    <div class="gf-card" style="margin-bottom:16px;">
      <div class="gf-label" style="margin-bottom:6px;">Draft a new answer</div>
      <textarea class="gf-textarea" id="draftQuestion" placeholder="Paste the question from your grant form…">${esc(state.ui.draftQuestion)}</textarea>
      <div class="gf-hstack" style="margin-top:8px;">
        <button class="gf-btn gf-btn-brass gf-btn-sm" id="draftBtn" ${state.ui.draftBusy ? "disabled" : ""}>${state.ui.draftBusy ? "Drafting…" : "Draft with AI"}</button>
        ${state.status && !state.status.aiConfigured ? `<span style="font-size:11.5px;color:var(--ink-soft);">No AI key set — you'll get a fallback draft to edit by hand.</span>` : ""}
      </div>
      ${state.ui.draftAnswer ? `
        <div class="gf-card" style="margin-top:10px;background:var(--forest-tint);border-color:var(--forest);">
          <div style="font-size:13px;line-height:1.5;">${esc(state.ui.draftAnswer)}</div>
          <div class="gf-hstack" style="margin-top:10px;">
            <button class="gf-btn gf-btn-primary gf-btn-sm" id="draftCopyBtn">Copy</button>
            <button class="gf-btn gf-btn-ghost gf-btn-sm" id="draftSaveBtn">Save to library</button>
          </div>
        </div>
      ` : ""}
    </div>

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
  return `
    <div class="gf-card" style="padding:12px;">
      <div style="font-weight:600;font-size:13.5px;">${esc(title)}</div>
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
  const search = document.getElementById("answerSearch");
  search.addEventListener("input", () => { state.ui.answerSearch = search.value; render(); document.getElementById("answerSearch").focus(); document.getElementById("answerSearch").selectionStart = document.getElementById("answerSearch").value.length; });

  const draftQ = document.getElementById("draftQuestion");
  draftQ.addEventListener("input", () => { state.ui.draftQuestion = draftQ.value; });

  document.getElementById("draftBtn").addEventListener("click", async () => {
    const question = state.ui.draftQuestion.trim();
    if (!question) { toast("Paste a question first"); return; }
    state.ui.draftBusy = true; render();
    try {
      const res = await api("/api/chat", { method: "POST", body: { question, fields: [] } });
      state.ui.draftAnswer = res.answer || "";
    } catch (err) {
      toast(err.message || "Couldn't draft that right now");
    } finally {
      state.ui.draftBusy = false; render();
    }
  });

  const copyBtn = document.getElementById("draftCopyBtn");
  if (copyBtn) copyBtn.addEventListener("click", () => copyText(state.ui.draftAnswer));

  const saveBtn = document.getElementById("draftSaveBtn");
  if (saveBtn) saveBtn.addEventListener("click", async () => {
    await saveAnswers([...state.answers, {
      id: `ans_${Date.now()}`,
      question: state.ui.draftQuestion.trim(),
      answer: state.ui.draftAnswer,
      source: "chat-draft",
      updatedAt: new Date().toISOString(),
    }]);
    state.ui.draftQuestion = "";
    state.ui.draftAnswer = "";
    toast("Saved to your answer library");
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
    toast(err.message || "Couldn't save your answer library");
  }
}

function renderAnswerModal() {
  const { mode, data } = state.ui.answerModal;
  return `
    <div class="gf-modal-overlay" id="answerModalOverlay">
      <div class="gf-modal">
        <div class="gf-row" style="margin-bottom:14px;">
          <div class="gf-display" style="font-size:16px;font-weight:600;">${mode === "add" ? "Add an answer" : "Edit answer"}</div>
          <button class="gf-btn gf-btn-ghost gf-btn-sm" id="answerModalClose">Close</button>
        </div>
        <div class="gf-field"><label class="gf-label">Question</label><input class="gf-input" id="aQuestion" value="${esc(data.question)}" /></div>
        <div class="gf-field"><label class="gf-label">Answer</label><textarea class="gf-textarea" id="aAnswer" style="min-height:100px;">${esc(data.answer)}</textarea></div>
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
  document.getElementById("answerModalSave").addEventListener("click", async () => {
    const { mode, data } = state.ui.answerModal;
    const question = document.getElementById("aQuestion").value.trim();
    const answer = document.getElementById("aAnswer").value.trim();
    if (!question || !answer) { toast("Fill in both fields"); return; }
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

/* ---------------- profile ---------------- */
function renderProfile() {
  const p = state.ui.profileDraft || state.profile;
  const fields = [
    ["organization", "Organization name"],
    ["primaryContact", "Primary contact"],
    ["contactTitle", "Contact title"],
    ["contactEmail", "Contact email"],
    ["mission", "Mission statement", "textarea"],
    ["summary", "One-line summary", "textarea"],
    ["requestedAmountNarrative", "Typical requested-amount language", "textarea"],
  ];
  return `
    <div class="gf-card">
      <div style="font-size:12.5px;color:var(--ink-soft);margin-bottom:14px;line-height:1.5;">
        Fill this in once. It backs every AI draft and appears as a quick-copy source alongside your answer library.
      </div>
      <div class="gf-stack">
        ${fields.map(([key, label, kind]) => `
          <div>
            <label class="gf-label">${label}</label>
            ${kind === "textarea"
              ? `<textarea class="gf-textarea" data-field="${key}">${esc(p[key] || "")}</textarea>`
              : `<input class="gf-input" data-field="${key}" value="${esc(p[key] || "")}" />`}
          </div>
        `).join("")}
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

/* ---------------- org switcher ---------------- */
function renderOrgSwitcher() {
  const orgs = state.profile?.organizations || [];
  return `
    <div class="gf-modal-overlay" id="orgOverlay">
      <div class="gf-modal">
        <div class="gf-row" style="margin-bottom:14px;">
          <div class="gf-display" style="font-size:16px;font-weight:600;">Switch organization</div>
          <button class="gf-btn gf-btn-ghost gf-btn-sm" id="orgClose">Close</button>
        </div>
        <div class="gf-stack">
          ${orgs.map((o) => `
            <button class="gf-btn ${o.id === state.profile.activeOrganizationId ? "gf-btn-primary" : "gf-btn-ghost"}" style="justify-content:flex-start;" data-org-id="${o.id}">
              ${esc(o.organization)}
            </button>
          `).join("")}
        </div>
        <div class="gf-hstack" style="margin-top:14px;">
          <input class="gf-input" id="newOrgName" placeholder="New organization name" />
          <button class="gf-btn gf-btn-brass gf-btn-sm" id="newOrgBtn">Add</button>
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
        const answers = await api("/api/answers");
        const applications = await api("/api/applications");
        state.answers = answers.items || [];
        state.applications = applications.items || [];
        state.ui.orgSwitcherOpen = false;
        toast(`Switched to ${state.profile.organization}`);
        render();
      } catch (err) {
        toast(err.message || "Couldn't switch organizations");
      }
    });
  });
  document.getElementById("newOrgBtn").addEventListener("click", async () => {
    const name = document.getElementById("newOrgName").value.trim();
    if (!name) return;
    try {
      state.profile = await api("/api/profile/organizations", { method: "POST", body: { organization: name } });
      state.answers = [];
      state.applications = [];
      state.ui.orgSwitcherOpen = false;
      toast(`${name} added`);
      render();
    } catch (err) {
      toast(err.message || "Couldn't add that organization");
    }
  });
}

/* ---------------- split-screen guide ---------------- */
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
loadAll();
