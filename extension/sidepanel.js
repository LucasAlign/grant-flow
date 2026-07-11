const API_BASE = "http://localhost:3000";
let currentFields = [];
let currentDrafts = [];
let currentSkipped = [];
let currentPageUrl = "";

const fieldsEl = document.querySelector("#fields");
const scanBtn = document.querySelector("#scanBtn");
const reviewBtn = document.querySelector("#reviewBtn");
const askBtn = document.querySelector("#askBtn");
const pickQuestionBtn = document.querySelector("#pickQuestionBtn");
const chatInput = document.querySelector("#chatInput");
const chatLog = document.querySelector("#chatLog");
const reviewLog = document.querySelector("#reviewLog");
const statusSummary = document.querySelector("#statusSummary");
const statusDetails = document.querySelector("#statusDetails");
let currentProfile = {};

function setStatus(summary, details = "") {
  statusSummary.textContent = summary;
  statusDetails.textContent = details || "Diagnostics stay summarized for demo use.";
}

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function isSupportedPageUrl(url = "") {
  return /^https?:\/\//.test(url);
}

async function sendToContent(message) {
  const tab = await activeTab();
  if (!tab?.id || !isSupportedPageUrl(tab.url)) {
    throw new Error("Open a normal http or https application page first.");
  }
  try {
    return await chrome.tabs.sendMessage(tab.id, message);
  } catch (error) {
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ["content.js"]
      });
      return chrome.tabs.sendMessage(tab.id, message);
    } catch (injectError) {
      throw new Error(`GrantFlow cannot access this page. Chrome may be blocking extensions here, or the extension needs to be reloaded. ${injectError.message}`);
    }
  }
}

async function postJson(path, body) {
  const response = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.json();
}

async function getJson(path) {
  const response = await fetch(`${API_BASE}${path}`);
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.json();
}

function labelFor(field) {
  return field.context || field.label || field.placeholder || field.name || field.id || "Application field";
}

function localDraftFor(field) {
  const label = labelFor(field).toLowerCase();
  const org = currentProfile.organization || "the organization";
  const mission = currentProfile.mission || `We serve our community with clear purpose and responsible stewardship.`;
  const audiences = currentProfile.audiences || [];
  const focus = (currentProfile.focusAreas || []).slice(0, 4).join(", ");
  if (label.includes("organization name") || label.includes("organizationname")) return currentProfile.organization || "Lucas Align";
  if (label.includes("primary contact") || label.includes("contact name") || label.includes("contactname")) return currentProfile.primaryContact || "";
  if (label.includes("ein") || label.includes("employer identification")) return currentProfile.ein || "";
  if (label.includes("tax exempt") || label.includes("tax-exempt")) return currentProfile.taxExemptNo || "";
  if (label.includes("requested amount")) return currentProfile.requestedAmountNarrative || "To be determined based on the foundation's funding guidelines.";
  if (label.includes("lgbtq")) {
    return "We believe every person should be treated with dignity, kindness, and respect. We also remain faithful to our Christian convictions and program standards, seeking to be clear without being harsh and loving without compromising our beliefs.";
  }
  if (label.includes("gender identity")) {
    return "We hold to a biblical understanding of identity and operate according to our boy-focused program standards. We seek to communicate those standards with humility, clarity, and care for every person.";
  }
  if (label.includes("nondiscrimination") || label.includes("eligibility")) {
    return "We explain eligibility and program standards clearly, apply them consistently, and reject hostility or mistreatment. Our goal is to be faithful to our beliefs while treating people with dignity.";
  }
  if (label.includes("cultural") || label.includes("conflict")) {
    return "We respond to disagreement with patience and respect. We do not hide our biblical convictions, but we seek to express them with kindness, humility, and love for our neighbors.";
  }
  if (label.includes("biblical") || label.includes("religious conviction") || label.includes("faith identity")) {
    return "Our faith shapes why and how we serve. We seek to love our neighbors, speak with humility, and remain steady in our biblical convictions.";
  }
  if (label.includes("mission")) return mission;
  if (label.includes("population") || label.includes("served")) return audiences.length ? `We serve ${audiences.slice(0, 3).join(", ")}.` : `We serve the people most directly connected to ${org}'s mission.`;
  if (label.includes("wraparound")) return currentProfile.programContext || mission;
  if (label.includes("technology") || label.includes("ai")) return `We use practical tools only where they help ${org} serve more clearly, consistently, and responsibly.`;
  if (label.includes("volunteer") || label.includes("advocate")) return `We rely on committed volunteers and community partners to carry out ${org}'s mission with consistency and care.`;
  if (label.includes("budget")) return `Grant funds will support the people, materials, training, and activities needed to carry out ${org}'s mission responsibly.`;
  if (label.includes("outcome") || label.includes("evaluation")) return `We will measure whether our work is helping people experience the purpose described in our mission: ${mission}`;
  if (label.includes("report")) return `We will report clearly on activities, participation, follow-up, and outcomes connected to ${org}'s mission.`;
  if (label.includes("foundation") || label.includes("fit")) return "This request fits funders who value practical care, coordinated community support, and responsible stewardship.";
  if (label.includes("implementation") || label.includes("timeline")) return `We will start with ${focus || "the core program work"}, train key roles, launch carefully, and improve based on feedback.`;
  if (label.includes("risk")) return "The main risks are adoption, sensitive information, and complexity; we address them with simple workflows, training, and careful access.";
  if (label.includes("partner")) return `We work with partners who strengthen ${org}'s mission and help the work reach people with greater consistency.`;
  if (label.includes("security") || label.includes("permission") || label.includes("steward")) return "We protect sensitive information by giving people the access they need to serve responsibly and no more.";
  return mission;
}

function fallbackDrafts(fields) {
  return fields.map((field) => ({
    ...field,
    answer: localDraftFor(field)
  }));
}

function normalizeDrafts(sessionFields) {
  return currentFields.map((field) => {
    const match = (sessionFields || []).find((draft) => draft.key === field.key);
    return {
      ...field,
      answer: match?.answer || localDraftFor(field)
    };
  });
}

function draftIndexForField(field) {
  return currentFields.findIndex((candidate) => candidate.key === field?.key);
}

function updateDraftAt(index, answer) {
  if (index < 0) return;
  currentDrafts[index] = currentDrafts[index] || { ...currentFields[index], answer: "" };
  currentDrafts[index].answer = answer;
}

async function saveLearnedAnswer(field, answer, originalAnswer = "", instruction = "") {
  const response = await postJson("/api/learn-answer", {
    field,
    answer,
    originalAnswer,
    instruction,
    pageUrl: currentPageUrl
  });
  return response;
}

function renderFields() {
  if (!currentFields.length) {
    fieldsEl.className = "summary muted";
    fieldsEl.innerHTML = `No supported text fields detected.${currentSkipped.length ? `<span>${currentSkipped.length} sensitive or unsupported field${currentSkipped.length === 1 ? "" : "s"} skipped.</span>` : ""}`;
    reviewBtn.disabled = true;
    return;
  }
  fieldsEl.className = "summary";
  const drafted = currentDrafts.filter((draft) => String(draft.answer || "").trim()).length;
  const org = currentProfile.organization || "active organization";
  const skippedNote = currentSkipped.length
    ? `<span>${currentSkipped.length} sensitive or unsupported field${currentSkipped.length === 1 ? "" : "s"} skipped.</span>`
    : "";
  fieldsEl.innerHTML = `
    <strong>${currentFields.length} fields detected</strong>
    <span>${drafted} drafted for ${escapeHtml(org)}.</span>
    <span>Review the answers directly on the page. Use Pick & Fill to revise one field.</span>
    ${skippedNote}`;
  reviewBtn.disabled = false;
}

async function reworkField(index, questionOverride = "", instructionOverride = "") {
  const field = currentFields[index];
  if (!field) {
    setStatus("Nothing to rework", "Scan the page first, then choose a detected field.");
    return null;
  }
  const instruction = instructionOverride || chatInput.value.trim() || "Make this answer more direct, concise, and high fidelity.";
  const currentAnswer = currentDrafts[index]?.answer || localDraftFor(field);
  setStatus("Reworking answer", "Asking GrantFlow for a sharper response to this specific question.");
  try {
    const response = await postJson("/api/revise", {
      field,
      question: questionOverride || labelFor(field),
      currentAnswer,
      instruction
    });
    updateDraftAt(index, response.answer);
    await saveLearnedAnswer(field, response.answer, currentAnswer, instruction);
    showAnswer(response.answer);
    setStatus(response.status, "The revised answer was saved to this organization's answer library.");
    return response.answer;
  } catch (error) {
    setStatus("Unable to rework", error.message);
    return null;
  }
}

async function draftAndFillApplication() {
  try {
    setStatus("Drafting and filling", "Scanning supported fields, drafting answers, and filling the page without submitting.");
    currentProfile = await getJson("/api/profile");
    const scan = await sendToContent({ type: "GRANTFLOW_SCAN" });
    currentPageUrl = scan.url || "";
    currentFields = scan.fields || [];
    currentSkipped = scan.skipped || [];
    currentDrafts = fallbackDrafts(currentFields);
    renderFields();
    const session = await postJson("/api/draft", {
      fields: currentFields,
      pageUrl: scan.url
    });
    currentDrafts = normalizeDrafts(session.fields);
    renderFields();
    const response = await sendToContent({ type: "GRANTFLOW_FILL", drafts: currentDrafts });
    setStatus(`Filled ${response.filled} fields`, `${session.status} Review answers on the page; the form was not submitted.`);
  } catch (error) {
    if (currentFields.length) {
      currentDrafts = fallbackDrafts(currentFields);
      renderFields();
      try {
        const response = await sendToContent({ type: "GRANTFLOW_FILL", drafts: currentDrafts });
        setStatus(`Filled ${response.filled} local drafts`, `AI draft was unavailable, so GrantFlow used local fallbacks. ${error.message}`);
      } catch {
        setStatus("Local drafts ready", `AI draft was unavailable. ${error.message}`);
      }
    } else {
      setStatus("Unable to draft", error.message);
    }
  }
}

async function reviewApplication() {
  try {
    if (!currentFields.length) {
      setStatus("Nothing to review", "Scan or pick at least one field first.");
      return;
    }
    await syncPageValues();
    if (!currentDrafts.length) currentDrafts = fallbackDrafts(currentFields);
    setStatus("Reviewing application", "Checking drafts for repetition, missing answers, length, claims, and values alignment.");
    reviewLog.classList.remove("muted");
    reviewLog.textContent = "Reviewing...";
    const response = await postJson("/api/review", { fields: currentDrafts, pageUrl: currentPageUrl });
    renderReview(response);
    setStatus(response.status, `${response.summary.high} high priority, ${response.summary.medium} medium priority.`);
  } catch (error) {
    setStatus("Unable to review", error.message);
    reviewLog.textContent = "Unable to review right now.";
  }
}

async function syncPageValues() {
  try {
    const scan = await sendToContent({ type: "GRANTFLOW_READ_VALUES" });
    currentPageUrl = scan.url || currentPageUrl;
    const pageFields = scan.fields || [];
    currentSkipped = scan.skipped || currentSkipped;
    currentFields = currentFields.length ? currentFields : pageFields;
    currentDrafts = currentFields.map((field) => {
      const pageField = pageFields.find((candidate) => candidate.key === field.key);
      const existing = currentDrafts.find((draft) => draft.key === field.key);
      return {
        ...field,
        ...(existing || {}),
        value: pageField ? pageField.value || "" : existing?.value || field.value || "",
        answer: pageField ? pageField.value || "" : existing?.answer || field.value || ""
      };
    });
    renderFields();
  } catch {
    // Review can still use the latest known drafts if the page cannot be read.
  }
}

async function fillSingleDraft(index) {
  const draft = currentDrafts[index];
  if (!draft?.key) return 0;
  const response = await sendToContent({ type: "GRANTFLOW_FILL", drafts: [draft] });
  return response.filled || 0;
}

async function askGrantFlow() {
  const question = chatInput.value.trim();
  if (!question) return;
  chatInput.value = "";
  setStatus("Answering", "Using current form context and local knowledge base.");
  showAnswer("Working...");
  try {
    const response = await postJson("/api/chat", { question, fields: currentFields });
    showAnswer(response.answer);
    setStatus(response.status);
  } catch (error) {
    setStatus("Unable to answer", error.message);
    showAnswer("Unable to answer right now.");
  }
}

async function pickQuestionFromPage() {
  try {
    currentProfile = await getJson("/api/profile");
    setStatus("Pick a question", "Click or highlight a question. GrantFlow will draft and fill the matching field automatically.");
    const picked = await sendToContent({ type: "GRANTFLOW_PICK_QUESTION" });
    if (picked.cancelled) {
      setStatus("Pick cancelled", "No question was selected.");
      return;
    }
    currentPageUrl = picked.url || currentPageUrl;
    const instruction = chatInput.value.trim() || "Answer this exact question clearly and concisely.";
    chatInput.value = "";
    showAnswer("Drafting selected question...");
    setStatus("Drafting selected question", "GrantFlow is writing a fresh response and will place it into the selected field.");
    let index = draftIndexForField(picked.field);
    if (index < 0 && picked.field?.key) {
      currentFields.push(picked.field);
      currentDrafts.push({ ...picked.field, answer: localDraftFor(picked.field) });
      renderFields();
      index = currentFields.length - 1;
    }
    if (index >= 0) {
      const answer = await reworkField(index, picked.question, instruction);
      if (answer) {
        const filled = await fillSingleDraft(index);
        setStatus(
          filled ? "Picked question drafted and filled" : "Picked question drafted",
          filled ? "The matching field was filled. The form was not submitted." : "A draft was created, but the field could not be filled automatically."
        );
      }
      return;
    }
    setStatus("Answering selected question", "No matching field was found, so the response will appear in Ask GrantFlow.");
    const response = await postJson("/api/revise", {
      field: picked.field || {},
      question: picked.question,
      currentAnswer: "",
      instruction
    });
    showAnswer(response.answer);
    await saveLearnedAnswer(picked.field || { context: picked.question }, response.answer, "", instruction);
    setStatus(response.status, "Selected question answered without filling a field.");
  } catch (error) {
    setStatus("Unable to pick question", error.message);
  }
}

function showAnswer(text) {
  if (chatLog.classList.contains("muted")) {
    chatLog.classList.remove("muted");
  }
  chatLog.innerHTML = `<p>${escapeHtml(text)}</p>`;
  chatLog.scrollTop = chatLog.scrollHeight;
}

function renderReview(review) {
  const issues = review.issues || [];
  if (!issues.length) {
    reviewLog.innerHTML = `<p><strong>No major issues found.</strong></p><p>${escapeHtml(review.status)}</p>`;
    return;
  }
  reviewLog.innerHTML = `
    <p><strong>${escapeHtml(review.status)}</strong></p>
    <div class="review-summary">${review.summary.high} high · ${review.summary.medium} medium · ${review.summary.fieldCount} fields</div>
    ${issues.slice(0, 8).map((issue) => `
      <article class="review-issue ${escapeAttr(issue.severity)}">
        <div><strong>${escapeHtml(issue.severity.toUpperCase())}</strong> · ${escapeHtml(issue.intent || "general")}</div>
        <p>${escapeHtml(issue.message)}</p>
        <small>${escapeHtml(issue.suggestion || issue.label)}</small>
      </article>`).join("")}`;
  reviewLog.innerHTML = reviewLog.innerHTML.replaceAll("Â·", "|").replaceAll("·", "|");
}

function debounce(fn, delay) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

function escapeHtml(value = "") {
  return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
}

function escapeAttr(value = "") {
  return escapeHtml(value);
}

scanBtn.addEventListener("click", draftAndFillApplication);
reviewBtn.addEventListener("click", reviewApplication);
askBtn.addEventListener("click", askGrantFlow);
pickQuestionBtn.addEventListener("click", pickQuestionFromPage);
chatInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) askGrantFlow();
});
