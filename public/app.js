const routes = {
  "/": renderDashboard,
  "/onboarding": renderOnboarding,
  "/profile": renderProfile,
  "/answers": renderAnswers,
  "/documents": renderDocuments,
  "/drafts": renderDrafts,
  "/applications": renderApplications,
  "/mock-grant": renderMockGrant
};

const app = document.querySelector("#app");

function nav() {
  return `
    <header class="topbar">
      <div class="brand">GrantFlow Assistant</div>
      <nav class="nav">
        <a href="/">Dashboard</a>
        <a href="/onboarding">AI Onboarding</a>
        <a href="/mock-grant">Mock Grant</a>
        <a href="/profile">Profile</a>
        <a href="/answers">Answers</a>
        <a href="/documents">Documents</a>
        <a href="/applications">Workspaces</a>
        <a href="/drafts">Drafts</a>
      </nav>
    </header>`;
}

async function api(path, options) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options
  });
  if (!response.ok) {
    let message = `${response.status} ${response.statusText}`;
    try {
      const payload = await response.json();
      if (payload.error) message = payload.error;
    } catch {
      // Keep the HTTP status when the response is not JSON.
    }
    throw new Error(message);
  }
  return response.json();
}

function mount(html) {
  app.innerHTML = nav() + `<main>${html}</main>`;
}

async function renderDashboard() {
  const status = await api("/api/status");
  const profile = await api("/api/profile");
  mount(`
    <section class="hero">
      <div class="panel">
        <h1>Lucas Align grant-writing copilot demo hub</h1>
        <p>Use this dashboard to test the local app, the mock grant form, organization profiles, and saved draft sessions.</p>
        <span class="status-pill">${status.aiConfigured ? `${status.aiProvider} API connected` : "API key missing: fallback answers enabled"}</span>
        <span class="status-pill">Active organization: ${escapeHtml(status.activeOrganization || "None selected")}</span>
        <div class="dashboard-switcher">
          <label for="dashboardOrgSelect">Apply grants as</label>
          <select id="dashboardOrgSelect">
            ${(profile.organizations || []).map((org) => `<option value="${escapeAttr(org.id)}" ${org.id === profile.activeOrganizationId ? "selected" : ""}>${escapeHtml(org.organization)}</option>`).join("")}
          </select>
          <div id="dashboardOrgStatus" class="small">Drafting, answers, documents, learning, and extension requests use this active organization.</div>
        </div>
      </div>
      <div class="panel">
        <h2>Demo Flow</h2>
        <p>Start the server, load the extension, open the mock grant, scan fields, draft answers, edit one, and fill the application.</p>
      </div>
    </section>
    <section class="grid">
      ${card("Mock grant application", "A long localhost application page tailored to Lucas Align grant requirements.", "/mock-grant")}
      ${card("AI organization onboarding", "Add a new organization by scraping its public website into scoped grant-writing context.", "/onboarding")}
      ${card("Editable profile", "Organization profile and public knowledge base used by the copilot.", "/profile")}
      ${card("Answer library", "Saved reusable answers and extension edits for learning loop testing.", "/answers")}
      ${card("Document context", "Simple text area for context pulled from grant docs or notes.", "/documents")}
      ${card("Application workspaces", "Track funder, deadline, source URL, notes, final answers, and exports for each grant.", "/applications")}
      ${card("Recent draft sessions", `${status.savedDraftSessions} saved sessions from extension/API drafting.`, "/drafts")}
    </section>`);

  document.querySelector("#dashboardOrgSelect")?.addEventListener("change", async (event) => {
    const statusEl = document.querySelector("#dashboardOrgStatus");
    statusEl.textContent = "Switching active organization...";
    const nextProfile = await api("/api/profile/active", { method: "PUT", body: JSON.stringify({ id: event.target.value }) });
    statusEl.textContent = `Active organization set to ${nextProfile.organization}.`;
    renderDashboard();
  });
}

function card(title, body, href) {
  return `<article class="card"><h3>${title}</h3><p>${body}</p><a href="${href}">Open</a></article>`;
}

async function renderOnboarding() {
  mount(`
    <h1>AI Organization Onboarding</h1>
    <section class="panel">
      <p>Enter a public website. GrantFlow will scrape a few relevant pages, summarize the organization, create scoped context, add answer examples, and make the organization active.</p>
      <form id="onboardForm">
        <div class="field-row"><label>Organization Name</label><input name="organization" placeholder="Example: Trail Life Troop PA 2301" required></div>
        <div class="field-row"><label>Website URL</label><input name="website" placeholder="https://example.org" required></div>
        <button>Scrape & Create Organization</button>
      </form>
      <div id="onboardStatus" class="small" style="margin-top:12px"></div>
    </section>
    <section id="onboardResult" class="list" style="margin-top:16px"></section>`);

  document.querySelector("#onboardForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const status = document.querySelector("#onboardStatus");
    const result = document.querySelector("#onboardResult");
    status.textContent = "Scraping website and building organization profile...";
    result.innerHTML = "";
    try {
      const data = Object.fromEntries(new FormData(event.target));
      const response = await api("/api/onboard/website", { method: "POST", body: JSON.stringify(data) });
      status.textContent = response.status;
      result.innerHTML = `
        <article class="card">
          <h3>${escapeHtml(response.organization.organization)}</h3>
          <p>Created from ${response.scrapedPages.length} scraped page(s). Added ${response.answerExamples} answer example(s). This organization is now active.</p>
          <pre>${escapeHtml(response.scrapedPages.map((page) => page.url).join("\\n"))}</pre>
          <div class="actions">
            <a href="/profile">Review Profile</a>
            <a href="/documents">Review Context</a>
            <a href="/answers">Review Answers</a>
          </div>
        </article>`;
    } catch (error) {
      status.textContent = `Unable to onboard: ${error.message}`;
    }
  });
}

async function renderProfile() {
  const profile = await api("/api/profile");
  mount(`
    <h1>Organizations / Knowledge Base</h1>
    <section class="panel" style="margin-bottom:16px">
      <div class="field-row">
        <label>Active Organization</label>
        <select id="orgSelect">
          ${(profile.organizations || []).map((org) => `<option value="${escapeAttr(org.id)}" ${org.id === profile.activeOrganizationId ? "selected" : ""}>${escapeHtml(org.organization)}</option>`).join("")}
        </select>
      </div>
      <div class="actions">
        <button id="addOrgBtn" type="button" class="secondary">Add Organization</button>
      </div>
    </section>
    <form id="profileForm" class="panel">
      <input type="hidden" name="id" value="${escapeAttr(profile.id || profile.activeOrganizationId || "")}">
      <div class="field-row"><label>Organization</label><input name="organization" value="${escapeAttr(profile.organization)}"></div>
      <div class="field-row"><label>Primary Contact</label><input name="primaryContact" value="${escapeAttr(profile.primaryContact || "")}"></div>
      <div class="field-row"><label>Contact Title</label><input name="contactTitle" value="${escapeAttr(profile.contactTitle || "")}"></div>
      <div class="field-row"><label>Contact Email</label><input name="contactEmail" value="${escapeAttr(profile.contactEmail || "")}"></div>
      <div class="field-row"><label>EIN</label><input name="ein" value="${escapeAttr(profile.ein || "")}"></div>
      <div class="field-row"><label>Tax Exempt No.</label><input name="taxExemptNo" value="${escapeAttr(profile.taxExemptNo || "")}"></div>
      <div class="field-row"><label>Requested Amount Narrative</label><input name="requestedAmountNarrative" value="${escapeAttr(profile.requestedAmountNarrative || "")}"></div>
      <div class="field-row"><label>Summary</label><textarea name="summary">${escapeHtml(profile.summary)}</textarea></div>
      <div class="field-row"><label>Mission</label><textarea name="mission">${escapeHtml(profile.mission)}</textarea></div>
      <div class="field-row"><label>Focus Areas, one per line</label><textarea name="focusAreas">${escapeHtml((profile.focusAreas || []).join("\n"))}</textarea></div>
      <div class="field-row"><label>Voice</label><input name="voice" value="${escapeAttr(profile.voice)}"></div>
      <button>Save Profile</button> <span id="saveStatus" class="small"></span>
    </form>`);
  document.querySelector("#orgSelect").addEventListener("change", async (event) => {
    await api("/api/profile/active", { method: "PUT", body: JSON.stringify({ id: event.target.value }) });
    renderProfile();
  });
  document.querySelector("#addOrgBtn").addEventListener("click", async () => {
    const organization = prompt("Organization name");
    if (!organization) return;
    await api("/api/profile/organizations", { method: "POST", body: JSON.stringify({ organization }) });
    renderProfile();
  });
  document.querySelector("#profileForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.target));
    data.focusAreas = data.focusAreas.split("\n").map((line) => line.trim()).filter(Boolean);
    await api("/api/profile", { method: "PUT", body: JSON.stringify(data) });
    document.querySelector("#saveStatus").textContent = "Saved.";
  });
}

async function renderAnswers() {
  const profile = await api("/api/profile");
  const answers = await api("/api/answers");
  mount(`
    <h1>Editable Answer Library</h1>
    <p>Editing answers for ${escapeHtml(profile.organization)} only.</p>
    <form id="answersForm" class="panel">
      <div class="field-row"><label>Answer Library JSON</label><textarea name="json" style="min-height:420px">${escapeHtml(JSON.stringify(answers, null, 2))}</textarea></div>
      <button>Save Answers</button> <span id="saveStatus" class="small"></span>
    </form>`);
  document.querySelector("#answersForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const parsed = JSON.parse(new FormData(event.target).get("json"));
    await api("/api/answers", { method: "PUT", body: JSON.stringify(parsed) });
    document.querySelector("#saveStatus").textContent = "Saved.";
  });
}

async function renderDocuments() {
  const profile = await api("/api/profile");
  const documents = await api("/api/documents");
  mount(`
    <h1>Editable Document Context</h1>
    <p>Editing document context for ${escapeHtml(profile.organization)} only.</p>
    <form id="docsForm" class="panel">
      <div class="field-row"><label>Simple Context Text</label><textarea name="context" style="min-height:360px">${escapeHtml(documents.context)}</textarea></div>
      <button>Save Context</button> <span id="saveStatus" class="small"></span>
    </form>`);
  document.querySelector("#docsForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    await api("/api/documents", { method: "PUT", body: JSON.stringify(Object.fromEntries(new FormData(event.target))) });
    document.querySelector("#saveStatus").textContent = "Saved.";
  });
}

async function renderDrafts() {
  const drafts = await api("/api/drafts");
  mount(`
    <h1>Recent Saved Draft Sessions</h1>
    <section class="list">
      ${(drafts.sessions || []).map((session) => `
        <article class="card">
          <h3>${session.createdAt} · ${session.fieldCount} fields</h3>
          <p>${escapeHtml(session.status)} ${session.pageUrl ? `from ${escapeHtml(session.pageUrl)}` : ""}</p>
          <pre>${escapeHtml(JSON.stringify(session.fields.slice(0, 5), null, 2))}</pre>
        </article>`).join("") || `<p>No draft sessions yet.</p>`}
    </section>`);
}

async function renderApplications() {
  const profile = await api("/api/profile");
  const applications = await api("/api/applications");
  const drafts = await api("/api/drafts");
  const latestDraft = (drafts.sessions || [])[0];
  mount(`
    <h1>Application Workspaces</h1>
    <section class="panel">
      <p>Track grant applications for ${escapeHtml(profile.organization)}. Save funder details, deadline, notes, and final answers; export when ready.</p>
      <form id="applicationForm" class="workspace-form">
        <div class="field-row"><label>Funder Name</label><input name="funderName" placeholder="Example Foundation" required></div>
        <div class="field-row"><label>Application Name</label><input name="applicationName" placeholder="2026 Community Grant"></div>
        <div class="field-row"><label>Deadline</label><input name="deadline" type="date"></div>
        <div class="field-row"><label>Source URL</label><input name="sourceUrl" placeholder="https://..."></div>
        <div class="field-row"><label>Notes</label><textarea name="notes" placeholder="Eligibility notes, funder priorities, next steps..."></textarea></div>
        <div class="actions">
          <button>Create Workspace</button>
          <button id="importLatestDraftBtn" type="button" class="secondary" ${latestDraft ? "" : "disabled"}>Import Latest Draft</button>
        </div>
        <div id="applicationStatus" class="small"></div>
      </form>
    </section>
    <section class="list workspace-list">
      ${(applications.items || []).map(renderApplicationCard).join("") || `<p>No application workspaces yet.</p>`}
    </section>`);

  document.querySelector("#applicationForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const status = document.querySelector("#applicationStatus");
    status.textContent = "Creating workspace...";
    try {
      const data = Object.fromEntries(new FormData(event.target));
      await api("/api/applications", { method: "POST", body: JSON.stringify(data) });
      status.textContent = "Workspace created.";
      renderApplications();
    } catch (error) {
      status.textContent = `Unable to create workspace: ${error.message}`;
    }
  });

  document.querySelector("#importLatestDraftBtn")?.addEventListener("click", async () => {
    if (!latestDraft) return;
    const status = document.querySelector("#applicationStatus");
    status.textContent = "Importing latest draft...";
    try {
      const data = Object.fromEntries(new FormData(document.querySelector("#applicationForm")));
      await api("/api/applications/from-draft", {
        method: "POST",
        body: JSON.stringify({
          ...data,
          draftId: latestDraft.id,
          applicationName: data.applicationName || `Workspace from ${latestDraft.createdAt}`,
          sourceUrl: data.sourceUrl || latestDraft.pageUrl || ""
        })
      });
      status.textContent = "Latest draft imported.";
      renderApplications();
    } catch (error) {
      status.textContent = `Unable to import draft: ${error.message}`;
    }
  });

  document.querySelectorAll(".workspace-editor").forEach((form) => {
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const data = Object.fromEntries(new FormData(event.target));
      const status = event.target.querySelector(".workspace-save-status");
      status.textContent = "Saving...";
      try {
        data.finalAnswers = JSON.parse(data.finalAnswers || "[]");
        await api("/api/applications", { method: "PUT", body: JSON.stringify(data) });
        status.textContent = "Saved.";
      } catch (error) {
        status.textContent = `Unable to save: ${error.message}`;
      }
    });
  });
}

function renderApplicationCard(item) {
  const answers = JSON.stringify(item.finalAnswers || [], null, 2);
  return `
    <article class="card workspace-card">
      <form class="workspace-editor">
        <input type="hidden" name="id" value="${escapeAttr(item.id)}">
        <div class="workspace-card-head">
          <div>
            <h3>${escapeHtml(item.applicationName || item.funderName || "Untitled application")}</h3>
            <p>${escapeHtml(item.funderName || "No funder saved")} ${item.deadline ? `| Deadline ${escapeHtml(item.deadline)}` : ""}</p>
          </div>
          <select name="status">
            ${["working", "review", "submitted", "declined", "awarded"].map((status) => `<option value="${status}" ${item.status === status ? "selected" : ""}>${status}</option>`).join("")}
          </select>
        </div>
        <div class="workspace-fields">
          <div class="field-row"><label>Funder</label><input name="funderName" value="${escapeAttr(item.funderName || "")}"></div>
          <div class="field-row"><label>Application</label><input name="applicationName" value="${escapeAttr(item.applicationName || "")}"></div>
          <div class="field-row"><label>Deadline</label><input name="deadline" type="date" value="${escapeAttr(item.deadline || "")}"></div>
          <div class="field-row"><label>Source URL</label><input name="sourceUrl" value="${escapeAttr(item.sourceUrl || "")}"></div>
        </div>
        <div class="field-row"><label>Notes</label><textarea name="notes">${escapeHtml(item.notes || "")}</textarea></div>
        <div class="field-row"><label>Final Answers JSON</label><textarea name="finalAnswers" class="answers-json">${escapeHtml(answers)}</textarea></div>
        <div class="actions">
          <button>Save Workspace</button>
          <a href="/api/applications/export?id=${encodeURIComponent(item.id)}&format=markdown" target="_blank" rel="noreferrer">Markdown</a>
          <a href="/api/applications/export?id=${encodeURIComponent(item.id)}&format=json" target="_blank" rel="noreferrer">JSON</a>
          <span class="small workspace-save-status"></span>
        </div>
      </form>
    </article>`;
}

function renderMockGrant() {
  const fields = [
    ["mission", "Mission and Community Need", "Describe your mission and the community need this grant will address."],
    ["population-served", "Population Served", "Who will be served by this program? Include ages, families, volunteers, and community groups where relevant."],
    ["community-need", "Community Need", "What local need or gap does your organization address?"],
    ["program-model", "Program Model", "Explain how your program works and what participants experience."],
    ["program-activities", "Core Activities", "Describe the regular activities, events, meetings, or services supported by this request."],
    ["participant-journey", "Participant Journey", "What does a participant experience from first involvement through deeper engagement?"],
    ["leadership-development", "Leadership Development", "How does your program develop leadership, responsibility, or maturity?"],
    ["character-development", "Character Development", "How does your program build character, integrity, service, and resilience?"],
    ["mentoring", "Mentoring and Adult Support", "Describe the role of adult mentors, trained leaders, parents, or volunteers."],
    ["volunteers", "Volunteer Engagement", "How do volunteers participate, lead, and sustain the work?"],
    ["family-engagement", "Family Engagement", "How are parents, guardians, or families involved in the program?"],
    ["faith-identity", "Faith Identity", "If your organization is faith-based, describe how faith informs the mission and program."],
    ["biblical-values", "Biblical Values", "How do biblical values shape your approach to service, leadership, character, and community?"],
    ["religious-conviction", "Religious Conviction and Public Benefit", "How do you maintain your religious convictions while serving the broader community with respect and care?"],
    ["lgbtq-respect", "LGBTQ+ Respect and Religious Beliefs", "How would your organization respond to concerns about LGBTQ+ inclusion while remaining faithful to your beliefs?"],
    ["gender-identity", "Gender Identity and Program Standards", "How do your program standards address gender identity while treating every person with dignity?"],
    ["nondiscrimination", "Nondiscrimination and Eligibility", "Describe who may participate, how eligibility is determined, and how your organization avoids hostility or mistreatment."],
    ["cultural-humility", "Cultural Humility", "How does your organization show kindness, humility, and respect toward people who do not share your beliefs?"],
    ["conflict-resolution", "Sensitive Questions and Conflict Resolution", "How would your leaders respond if a family, funder, or community member disagrees with your beliefs?"],
    ["safety", "Participant Safety", "Describe your approach to child safety, supervision, screening, and risk management."],
    ["privacy", "Privacy and Confidentiality", "How do you protect participant and family privacy?"],
    ["outcomes", "Outcomes and Measurement", "What outcomes will be measured and reported?"],
    ["short-term-outcomes", "Short-Term Outcomes", "What changes do you expect participants to experience in the first grant period?"],
    ["long-term-impact", "Long-Term Impact", "What lasting impact do you hope this work will have on participants, families, and the community?"],
    ["evidence", "Evidence of Need or Effectiveness", "What evidence, experience, or observations show that this program matters?"],
    ["budget-narrative", "Budget Narrative", "Explain how requested funds will be used."],
    ["equipment-supplies", "Equipment and Supplies", "What materials, equipment, supplies, or curriculum will the grant help provide?"],
    ["scholarships", "Scholarships and Access", "Will funds help reduce cost barriers for participants or families?"],
    ["staffing-volunteers", "Staffing and Volunteer Support", "How will staff or volunteer leaders be trained, supported, or equipped?"],
    ["sustainability", "Sustainability", "How will the program continue after grant funding?"],
    ["reporting", "Reporting", "Describe reporting cadence, data quality, and partner visibility."],
    ["financial-stewardship", "Financial Stewardship", "How will you manage grant funds responsibly and transparently?"],
    ["donor-stewardship", "Donor Stewardship", "How will you communicate impact to funders and partners?"],
    ["foundation-fit", "Foundation Fit", "Why is this request a strong fit for the foundation's priorities?"],
    ["implementation", "Implementation Timeline", "Summarize launch, training, pilot, and expansion milestones."],
    ["risk-management", "Risk Management", "Identify major risks and mitigation steps."],
    ["partnerships", "Partnerships", "Describe collaboration with churches, schools, nonprofits, civic groups, or community partners."],
    ["community-service", "Community Service", "How does your program encourage participants to serve others?"],
    ["accessibility", "Accessibility", "How do you make the program accessible to families with financial, transportation, schedule, or other barriers?"],
    ["rural-urban", "Service Area", "Describe the geographic area served and any rural, suburban, or urban considerations."],
    ["communications", "Community Communications", "How do you explain your mission to families, partners, and funders clearly and respectfully?"],
    ["collaboration-limits", "Partnership Boundaries", "Are there any values, doctrine, or program standards that shape which partnerships are appropriate?"],
    ["evaluation", "Evaluation Plan", "How will learning from the project improve future service?"],
    ["future-growth", "Future Growth", "How could this grant help the program grow or serve more participants over time?"],
    ["closing-statement", "Closing Statement", "Briefly summarize why this request matters now."]
  ];
  mount(`
    <h1>Mock Foundation Grant Application</h1>
    <p>This localhost form is intentionally long so the extension can scan, draft, edit, and fill realistic application fields.</p>
    <form id="grantForm">
      <section class="form-section">
        <div class="field-row"><label for="organization-name">Organization Name</label><input id="organization-name" name="organizationName" type="text" value="Lucas Align"></div>
        <div class="field-row"><label for="contact-name">Primary Contact</label><input id="contact-name" name="contactName" type="text"></div>
        <div class="field-row"><label for="requested-amount">Requested Amount Narrative</label><input id="requested-amount" name="requestedAmountNarrative" type="text"></div>
      </section>
      ${fields.map(([id, label, help]) => `
        <section class="form-section">
          <label for="${id}">${label}</label>
          <p class="small">${help}</p>
          <textarea id="${id}" name="${id}" placeholder="${escapeAttr(help)}"></textarea>
        </section>`).join("")}
      <div class="actions">
        <button type="button" class="secondary">Save Draft Locally</button>
        <button type="button" class="secondary">Preview Only</button>
      </div>
    </form>`);
}

function escapeHtml(value = "") {
  return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
}

function escapeAttr(value = "") {
  return escapeHtml(value);
}

window.addEventListener("popstate", () => (routes[location.pathname] || renderDashboard)());
document.addEventListener("click", (event) => {
  const link = event.target.closest("a[href^='/']");
  if (!link) return;
  event.preventDefault();
  history.pushState({}, "", link.href);
  (routes[location.pathname] || renderDashboard)();
});

(routes[location.pathname] || renderDashboard)();
