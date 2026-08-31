const path = require("path");
const fs = require("fs/promises");
const http = require("http");
const os = require("os");
const { URL } = require("url");

loadDotEnv();

let express;
let OpenAI;
try {
  express = require("express");
} catch {
  express = null;
}
try {
  OpenAI = require("openai");
} catch {
  OpenAI = null;
}

const app = express ? express() : createMiniApp();
const PORT = process.env.PORT || 3000;
const SOURCE_DATA_DIR = path.join(__dirname, "data");
const DATA_DIR = process.env.DATA_DIR || (process.env.VERCEL ? path.join(os.tmpdir(), "grantflow-data") : SOURCE_DATA_DIR);
const PUBLIC_DIR = path.join(__dirname, "public");
const ORG_MD_DIR = path.join(DATA_DIR, "organizations");
const SOURCE_ORG_MD_DIR = path.join(SOURCE_DATA_DIR, "organizations");
let dataStoreReady;
let lastAiDiagnostic = {
  provider: (process.env.AI_PROVIDER || "openai").toLowerCase(),
  ok: null,
  model: "",
  status: "not_checked",
  error: "",
  checkedAt: ""
};

const files = {
  profile: "profile.json",
  answers: "answers.json",
  documents: "documents.json",
  drafts: "drafts.json",
  learning: "learning.json",
  applications: "applications.json"
};

if (express) {
  app.use(express.json({ limit: "1mb" }));
  app.use(express.static(PUBLIC_DIR));
} else {
  app.setStaticDir(PUBLIC_DIR);
}

function loadDotEnv() {
  try {
    const dotenv = require("dotenv");
    dotenv.config();
  } catch {
    try {
      const envPath = path.join(__dirname, ".env");
      require("fs").readFileSync(envPath, "utf8").split(/\r?\n/).forEach((line) => {
        const match = line.match(/^\s*([^#=\s]+)\s*=\s*(.*)\s*$/);
        if (!match || process.env[match[1]]) return;
        process.env[match[1]] = match[2].replace(/^["']|["']$/g, "");
      });
    } catch {
      // .env is optional for fallback mode.
    }
  }
}

function recordAiDiagnostic(update) {
  lastAiDiagnostic = {
    ...lastAiDiagnostic,
    ...update,
    checkedAt: new Date().toISOString()
  };
  return lastAiDiagnostic;
}

function publicAiDiagnostic() {
  return {
    provider: lastAiDiagnostic.provider,
    ok: lastAiDiagnostic.ok,
    model: lastAiDiagnostic.model,
    status: lastAiDiagnostic.status,
    error: lastAiDiagnostic.error,
    checkedAt: lastAiDiagnostic.checkedAt
  };
}

function createMiniApp() {
  const routes = [];
  let staticDir = "";
  const mime = {
    ".html": "text/html",
    ".css": "text/css",
    ".js": "text/javascript",
    ".json": "application/json"
  };
  const add = (method, routePath, handler) => routes.push({ method, routePath, handler });
  const appLike = {
    use() {},
    setStaticDir(dir) {
      staticDir = dir;
    },
    get(routePath, handler) {
      add("GET", routePath, handler);
    },
    put(routePath, handler) {
      add("PUT", routePath, handler);
    },
    post(routePath, handler) {
      add("POST", routePath, handler);
    },
    listen(port, cb) {
      const server = http.createServer(async (req, res) => {
        decorateResponse(res);
        const url = new URL(req.url, `http://${req.headers.host}`);
        req.path = url.pathname;
        req.query = Object.fromEntries(url.searchParams.entries());
        try {
          if (["POST", "PUT", "PATCH"].includes(req.method)) {
            req.body = await readBody(req);
          }
          const exactRoute = routes.find((candidate) => candidate.method === req.method && candidate.routePath === req.path);
          if (exactRoute) return exactRoute.handler(req, res);
          if (req.method === "GET" && staticDir) {
            const filePath = safeStaticPath(staticDir, req.path);
            if (filePath) {
              try {
                const data = await fs.readFile(filePath);
                res.writeHead(200, { "Content-Type": mime[path.extname(filePath)] || "application/octet-stream" });
                return res.end(data);
              } catch (error) {
                if (error.code !== "ENOENT") throw error;
              }
            }
          }
          const wildcardRoute = routes.find((candidate) => candidate.method === req.method && candidate.routePath === "*");
          if (wildcardRoute) return wildcardRoute.handler(req, res);
          res.writeHead(404);
          res.end("Not found");
        } catch (error) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: error.message }));
        }
      });
      return server.listen(port, cb);
    }
  };
  return appLike;
}

function decorateResponse(res) {
  res.json = (data) => {
    res.writeHead(res.statusCode && res.statusCode !== 200 ? res.statusCode : 200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(data));
  };
  res.sendFile = async (filePath) => {
    const data = await fs.readFile(filePath);
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(data);
  };
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1024 * 1024) reject(new Error("Request body too large"));
    });
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        resolve({});
      }
    });
    req.on("error", reject);
  });
}

function safeStaticPath(root, requestPath) {
  const pathname = requestPath === "/" ? "/index.html" : requestPath;
  const filePath = path.normalize(path.join(root, pathname));
  if (!filePath.startsWith(root)) return null;
  return filePath;
}

async function readJson(name) {
  await ensureDataStore();
  try {
    const text = await fs.readFile(path.join(DATA_DIR, files[name]), "utf8");
    return JSON.parse(text);
  } catch (error) {
    if (error.code === "ENOENT" && name === "learning") {
      return { organizations: {} };
    }
    if (error.code === "ENOENT" && name === "applications") {
      return { items: [] };
    }
    throw error;
  }
}

async function writeJson(name, data) {
  await ensureDataStore();
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(path.join(DATA_DIR, files[name]), JSON.stringify(data, null, 2));
}

async function pathExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function copySeedFile(fileName) {
  const target = path.join(DATA_DIR, fileName);
  if (await pathExists(target)) return;
  await fs.copyFile(path.join(SOURCE_DATA_DIR, fileName), target);
}

async function ensureDataStore() {
  if (!dataStoreReady) {
    dataStoreReady = (async () => {
      if (DATA_DIR === SOURCE_DATA_DIR) return;
      await fs.mkdir(DATA_DIR, { recursive: true });
      await Promise.all(Object.values(files).map(copySeedFile));
      if (!(await pathExists(ORG_MD_DIR)) && await pathExists(SOURCE_ORG_MD_DIR)) {
        await fs.cp(SOURCE_ORG_MD_DIR, ORG_MD_DIR, { recursive: true });
      }
    })();
  }
  return dataStoreReady;
}

function slug(value) {
  return String(value || "organization")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48) || `org-${Date.now()}`;
}

function escapeMarkdown(value = "") {
  return String(value).replace(/\r\n/g, "\n").trim();
}

function markdownForOrganization(org, context = "", answers = []) {
  const list = (items = []) => items.length ? items.map((item) => `- ${item}`).join("\n") : "- Not provided yet.";
  return `# ${escapeMarkdown(org.organization || "New Organization")}

## Profile

- Organization ID: \`${escapeMarkdown(org.id || "")}\`
- Website: ${escapeMarkdown(org.website || "")}
- Primary contact: ${escapeMarkdown(org.primaryContact || "")}
- Contact title: ${escapeMarkdown(org.contactTitle || "")}
- Contact email: ${escapeMarkdown(org.contactEmail || "")}
- EIN: ${escapeMarkdown(org.ein || "")}
- Tax exempt no.: ${escapeMarkdown(org.taxExemptNo || "")}
- Requested amount narrative: ${escapeMarkdown(org.requestedAmountNarrative || "")}

## Summary

${escapeMarkdown(org.summary || "Not provided yet.")}

## Mission

${escapeMarkdown(org.mission || "Not provided yet.")}

## Positioning

${escapeMarkdown(org.positioning || "Not provided yet.")}

## Program Context

${escapeMarkdown(org.programContext || "Not provided yet.")}

## Audiences

${list(org.audiences || [])}

## Focus Areas

${list(org.focusAreas || [])}

## Answer Principles

${list(org.answerPrinciples || [])}

## Drafting Voice

${escapeMarkdown(org.voice || "First person plural, concise, warm, and direct.")}

## Organization Context

${escapeMarkdown(context || "No additional document context has been added for this organization yet.")}

## Answer Examples

${answers.length ? answers.map((item) => `### ${escapeMarkdown(item.question)}\n\n${escapeMarkdown(item.answer)}`).join("\n\n") : "No scoped answer examples have been added for this organization yet."}
`;
}

async function writeOrganizationMarkdown(org, context = "", answers = []) {
  await ensureDataStore();
  await fs.mkdir(ORG_MD_DIR, { recursive: true });
  await fs.writeFile(path.join(ORG_MD_DIR, `${org.id}.md`), markdownForOrganization(org, context, answers));
}

function normalizeProfileStore(store) {
  if (Array.isArray(store.organizations)) {
    const activeOrganizationId = store.activeOrganizationId || store.organizations[0]?.id;
    return { ...store, activeOrganizationId };
  }
  const id = store.id || slug(store.organization || "Lucas Align");
  return {
    activeOrganizationId: id,
    organizations: [{ id, ...store }]
  };
}

async function readProfileStore() {
  return normalizeProfileStore(await readJson("profile"));
}

function activeProfile(store) {
  return store.organizations.find((org) => org.id === store.activeOrganizationId) || store.organizations[0] || {};
}

function profileResponse(store) {
  return {
    ...activeProfile(store),
    activeOrganizationId: store.activeOrganizationId,
    organizations: store.organizations.map((org) => ({
      id: org.id,
      organization: org.organization,
      website: org.website || "",
      needsReview: Boolean(org.needsReview)
    }))
  };
}

function stripHtml(html = "") {
  return String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function pageTitle(html = "") {
  const match = String(html).match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return stripHtml(match?.[1] || "");
}

// Heuristic: does this text look like raw scraped page/navigation output rather
// than a written mission/summary? Used to keep unreviewed scrape text from being
// presented as an organization fact. Shared by the server and mirrored in app.js.
function looksLikeScrape(text = "") {
  const value = String(text || "");
  if (!value.trim()) return false;
  if (/\bSource:\s*https?:\/\//i.test(value)) return true;
  if (/^\s*Title:\s/i.test(value)) return true;
  // Runs of ALL-CAPS nav words like "HOME ABOUT DONATE CONTACT".
  const navHits = (value.match(/\b(HOME|ABOUT|DONATE|CONTACT|SPONSOR|SPONSORS|MENU|LOGIN|SIGN IN|SUBSCRIBE|SHOP|BLOG|EVENTS|GALLERY|VOLUNTEER|APPLY)\b/g) || []).length;
  if (navHits >= 3) return true;
  return false;
}

function sameHostLinks(baseUrl, html = "") {
  const base = new URL(baseUrl);
  const candidates = [];
  const pattern = /href=["']([^"']+)["']/gi;
  let match;
  while ((match = pattern.exec(html))) {
    try {
      const url = new URL(match[1], base);
      if (url.protocol.startsWith("http") && url.hostname === base.hostname) {
        url.hash = "";
        const value = url.toString();
        const pathText = `${url.pathname} ${value}`.toLowerCase();
        if (/(about|mission|program|service|impact|who-we-are|values|faith|ministr|donat|leadership)/.test(pathText)) {
          candidates.push(value);
        }
      }
    } catch {
      // Ignore bad links.
    }
  }
  return [...new Set(candidates)].slice(0, 5);
}

async function fetchPage(url) {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "GrantFlowAssistant/0.1 (+local onboarding)",
      "Accept": "text/html,application/xhtml+xml"
    }
  });
  if (!response.ok) throw new Error(`Could not fetch ${url}: ${response.status}`);
  const html = await response.text();
  return {
    url,
    title: pageTitle(html),
    text: stripHtml(html).slice(0, 9000),
    links: sameHostLinks(url, html)
  };
}

async function scrapeOrganizationWebsite(startUrl) {
  const normalized = /^https?:\/\//i.test(startUrl) ? startUrl : `https://${startUrl}`;
  const first = await fetchPage(normalized);
  const queue = first.links.slice(0, 4);
  const pages = [first];
  for (const url of queue) {
    try {
      if (!pages.some((page) => page.url === url)) pages.push(await fetchPage(url));
    } catch {
      // Keep onboarding resilient if a secondary page fails.
    }
  }
  return pages;
}

function parseOnboardingJson(text, fallback) {
  const raw = String(text || "").replace(/^```json\s*/i, "").replace(/```$/i, "").trim();
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  const candidate = start >= 0 && end > start ? raw.slice(start, end + 1) : raw;
  try {
    return { ...fallback, ...JSON.parse(candidate) };
  } catch {
    return fallback;
  }
}

function fallbackOnboardingProfile(organization, website, scrapedText) {
  // Without an AI extraction step we must not present raw scraped page text as a
  // mission or summary. Leave the human-facing fields blank so onboarding can
  // prompt the user to review and write them. The raw text is preserved in
  // `context` (stored as scoped document context / source excerpt) only.
  return {
    organization,
    website,
    summary: "",
    mission: "",
    positioning: "",
    programContext: "",
    audiences: [],
    focusAreas: [],
    answerPrinciples: [
      "Use first person plural: We...",
      "Be direct and concise.",
      "Stay true to the selected organization's mission, values, audience, eligibility standards, and program model.",
      "Do not invent details not found in the profile or website context."
    ],
    voice: "First person plural, concise, warm, and direct.",
    context: scrapedText.slice(0, 5000),
    answerExamples: []
  };
}

function scopedAnswers(answers, organizationId) {
  return {
    ...answers,
    items: (answers.items || []).filter((item) => item.organizationId === organizationId)
  };
}

function scopedDocuments(documents, organizationId) {
  if (documents.contexts) {
    return { context: documents.contexts[organizationId] || "" };
  }
  return { context: documents.context || "" };
}

function profileIsReviewed(profile = {}) {
  return Boolean(
    String(profile.organization || "").trim()
    && String(profile.mission || "").trim()
    && String(profile.summary || "").trim()
    && !looksLikeScrape(profile.mission)
    && !looksLikeScrape(profile.summary)
  );
}

async function approvePendingImport(organizationId) {
  const documents = await readJson("documents");
  const pending = documents.pendingImports?.[organizationId];
  if (!pending) return { promotedAnswers: 0 };

  documents.contexts = documents.contexts || {};
  documents.contexts[organizationId] = String(pending.context || "");
  delete documents.pendingImports[organizationId];
  await writeJson("documents", documents);

  const answers = await readJson("answers");
  const imported = (pending.answerExamples || [])
    .filter((item) => item.question && item.answer)
    .slice(0, 12)
    .map((item, index) => ({
      id: `${organizationId}_onboard_${index + 1}`,
      organizationId,
      question: item.question,
      answer: item.answer,
      source: "website-onboarding",
      updatedAt: new Date().toISOString()
    }));
  answers.items = [
    ...(answers.items || []).filter((item) => !(item.organizationId === organizationId && item.source === "website-onboarding")),
    ...imported
  ];
  await writeJson("answers", answers);
  return { promotedAnswers: imported.length };
}

function scopedApplications(applications, organizationId) {
  return {
    items: (applications.items || [])
      .filter((item) => item.organizationId === organizationId)
      .sort((a, b) => String(b.updatedAt || b.createdAt || "").localeCompare(String(a.updatedAt || a.createdAt || "")))
  };
}

function normalizeFinalAnswers(fields = []) {
  return (fields || [])
    .filter((field) => field && (field.answer || field.value || field.label || field.context))
    .map((field, index) => ({
      key: field.key || `answer-${index + 1}`,
      label: String(field.label || field.question || fieldLabel(field)).trim(),
      intent: field.intent || fieldIntent(field),
      answer: String(field.answer || field.value || "").trim(),
      maxLength: Number(field.maxLength || 0)
    }));
}

function cleanApplicationPayload(body = {}) {
  return {
    funderName: String(body.funderName || "").trim(),
    applicationName: String(body.applicationName || "").trim(),
    deadline: String(body.deadline || "").trim(),
    sourceUrl: String(body.sourceUrl || "").trim(),
    status: String(body.status || "working").trim() || "working",
    notes: String(body.notes || "").trim(),
    finalAnswers: normalizeFinalAnswers(body.finalAnswers || [])
  };
}

function applicationMarkdown(application, profile) {
  const lines = [
    `# ${application.applicationName || application.funderName || "Grant Application"}`,
    "",
    `- Organization: ${profile.organization || application.organizationId || ""}`,
    `- Funder: ${application.funderName || ""}`,
    `- Deadline: ${application.deadline || ""}`,
    `- Source URL: ${application.sourceUrl || ""}`,
    `- Status: ${application.status || "working"}`,
    `- Updated: ${application.updatedAt || ""}`,
    "",
    "## Notes",
    "",
    application.notes || "No notes saved.",
    "",
    "## Final Answers",
    ""
  ];
  for (const answer of application.finalAnswers || []) {
    lines.push(`### ${answer.label || answer.key || "Application Question"}`);
    lines.push("");
    lines.push(answer.answer || "");
    lines.push("");
  }
  return lines.join("\n");
}

function routeError(res, error, statusCode = 500) {
  res.statusCode = statusCode;
  return res.json({ error: error.message || "Request failed." });
}

function fieldLabel(field) {
  return [field.context, field.label, field.placeholder, field.name, field.id].filter(Boolean).join(" | ") || "Grant application field";
}

function fieldIntent(field) {
  const label = fieldLabel(field).toLowerCase();
  if (isSimpleProfileField(field)) return "identity";
  if (/(lgbtq|gender identity|nondiscrimination|eligibility|cultural|conflict|biblical|religious|faith)/i.test(label)) return "values-culture";
  if (/(mission|purpose|why do you exist)/i.test(label)) return "mission";
  if (/(population|served|participant|audience|who will be served)/i.test(label)) return "population-served";
  if (/(need|gap|problem|evidence)/i.test(label)) return "community-need";
  if (/(program model|model|activities|participant journey|core activities|service delivery)/i.test(label)) return "program-model";
  if (/(leadership|character|mentoring|maturity|resilience|adult support)/i.test(label)) return "development";
  if (/(volunteer|advocate|parent|family engagement|staffing)/i.test(label)) return "volunteers";
  if (/(outcome|measurement|evaluation|impact|short-term|long-term|effectiveness)/i.test(label)) return "outcomes";
  if (/(budget|equipment|supplies|scholarship|cost|requested amount)/i.test(label)) return "budget";
  if (/(sustainability|continue|after grant)/i.test(label)) return "sustainability";
  if (/(report|data quality|visibility)/i.test(label)) return "reporting";
  if (/(financial stewardship|donor stewardship|stewardship|security|privacy|confidentiality|permission)/i.test(label)) return "stewardship";
  if (/(timeline|implementation|milestone|launch)/i.test(label)) return "implementation";
  if (/(risk|safety|screening|supervision)/i.test(label)) return "risk-safety";
  if (/(partner|collaboration|church|school|civic)/i.test(label)) return "partnerships";
  if (/(foundation fit|fit|priority)/i.test(label)) return "foundation-fit";
  if (/(accessibility|barrier|transportation|financial)/i.test(label)) return "accessibility";
  if (/(service area|geographic|rural|urban|county)/i.test(label)) return "service-area";
  if (/(communication|explain|community communications)/i.test(label)) return "communications";
  if (/(technology|software|ai|automation)/i.test(label)) return "technology";
  return "general";
}

function intentGuidance(intent) {
  const guidance = {
    identity: "Provide the exact profile fact only.",
    mission: "State purpose and community value directly.",
    "population-served": "Name who is served and why they matter.",
    "community-need": "Describe the need or gap without inventing statistics.",
    "program-model": "Explain what happens in the program.",
    development: "Show how people grow through the program.",
    volunteers: "Explain volunteer roles, support, and follow-through.",
    outcomes: "Name measurable changes or learning signals.",
    budget: "Describe responsible use of funds without inventing line items.",
    sustainability: "Explain how the work continues after the grant.",
    reporting: "Explain what will be reported and how progress stays visible.",
    stewardship: "Emphasize responsible management, privacy, safety, and accountability.",
    implementation: "Summarize practical next steps or milestones.",
    "risk-safety": "Name the risk or safety practice and how it is managed.",
    partnerships: "Explain appropriate collaborators and boundaries.",
    "foundation-fit": "Connect the request to funder priorities.",
    accessibility: "Explain how barriers are reduced.",
    "service-area": "Describe geography or community context.",
    communications: "Explain how the mission is communicated clearly and respectfully.",
    technology: "Discuss tools only as practical support for people and mission.",
    "values-culture": "Be kind, clear, respectful, and faithful to the organization's stated convictions.",
    general: "Answer the exact question with a distinct, practical emphasis."
  };
  return guidance[intent] || guidance.general;
}

function fallbackAnswer(field, profile) {
  const label = fieldLabel(field).toLowerCase();
  const org = profile.organization || "the organization";
  const mission = profile.mission || `We serve our community with clear purpose and responsible stewardship.`;
  const focus = (profile.focusAreas || []).slice(0, 4).join(", ");
  if (label.includes("organization name") || label.includes("organizationname")) return org;
  if (label.includes("primary contact") || label.includes("contact name") || label.includes("contactname")) return profile.primaryContact || "";
  if (label.includes("contact title") || label.includes("title")) return profile.contactTitle || "";
  if (label.includes("contact email") || label.includes("email")) return profile.contactEmail || "";
  if (label.includes("ein") || label.includes("employer identification")) return profile.ein || "";
  if (label.includes("tax exempt") || label.includes("tax-exempt")) return profile.taxExemptNo || "";
  if (label.includes("requested amount")) return profile.requestedAmountNarrative || "To be determined based on the foundation's funding guidelines.";
  if (label.includes("lgbtq")) {
    return `We believe every person should be treated with dignity, kindness, and respect. We also remain faithful to our Christian convictions and program standards, seeking to be clear without being harsh and loving without compromising our beliefs.`;
  }
  if (label.includes("gender identity")) {
    return `We hold to a biblical understanding of identity and operate according to our boy-focused program standards. We seek to communicate those standards with humility, clarity, and care for every person.`;
  }
  if (label.includes("nondiscrimination") || label.includes("eligibility")) {
    return `We explain eligibility and program standards clearly, apply them consistently, and reject hostility or mistreatment. Our goal is to be faithful to our beliefs while treating people with dignity.`;
  }
  if (label.includes("cultural") || label.includes("conflict")) {
    return `We respond to disagreement with patience and respect. We do not hide our biblical convictions, but we seek to express them with kindness, humility, and love for our neighbors.`;
  }
  if (label.includes("biblical") || label.includes("religious conviction") || label.includes("faith identity")) {
    return `Our faith shapes why and how we serve. We seek to love our neighbors, speak with humility, and remain steady in our biblical convictions.`;
  }
  if (label.includes("mission")) return mission;
  if (label.includes("population") || label.includes("served")) return profile.audiences?.length ? `We serve ${profile.audiences.slice(0, 3).join(", ")}.` : `We serve the people most directly connected to ${org}'s mission.`;
  if (label.includes("program model") || label.includes("model")) return profile.programContext || `Our model focuses on ${focus || "clear service, strong relationships, and consistent follow-through"}.`;
  if (label.includes("wraparound")) return profile.programContext || mission;
  if (label.includes("outcome") || label.includes("evaluation")) return `We will measure whether our work is helping people experience the purpose described in our mission: ${mission}`;
  if (label.includes("report")) return `We will report clearly on activities, participation, follow-up, and outcomes connected to ${org}'s mission.`;
  if (label.includes("budget")) return `Grant funds will support the people, materials, training, and activities needed to carry out ${org}'s mission responsibly.`;
  if (label.includes("sustain")) return `We sustain the work by keeping it aligned with ${org}'s mission, volunteers, partners, and available resources.`;
  if (label.includes("technology") || label.includes("ai") || label.includes("automation")) return `We use practical tools only where they help ${org} serve more clearly, consistently, and responsibly.`;
  if (label.includes("volunteer") || label.includes("advocate") || label.includes("church")) return `We rely on committed volunteers and community partners to carry out ${org}'s mission with consistency and care.`;
  if (label.includes("county") || label.includes("admin")) return `We help leaders see what is happening, where support is needed, and how the work is advancing ${org}'s mission.`;
  if (label.includes("foundation") || label.includes("fit")) return `This request fits funders who value practical care, coordinated community support, and responsible stewardship.`;
  if (label.includes("implementation") || label.includes("timeline")) return `We will start with the care process, train key roles, launch with a focused group, and improve based on partner feedback.`;
  if (label.includes("risk")) return `The main risks are adoption, sensitive information, and complexity; we address them with simple workflows, training, and careful access.`;
  if (label.includes("partner")) return `We work with partners who strengthen ${org}'s mission and help the work reach people with greater consistency.`;
  if (label.includes("security") || label.includes("permission") || label.includes("steward") || label.includes("privacy")) return `We protect sensitive information by giving people the access they need to serve responsibly and no more.`;
  return mission;
}

function answerMentionsOtherOrganization(answer, profile) {
  const text = String(answer || "").toLowerCase();
  const org = String(profile.organization || "").toLowerCase();
  const otherOrgSignals = [
    { org: "lucas align", terms: ["lucas align", "wraparound care", "foster", "adoptive", "kinship", "custom software", "ai solutions"] },
    { org: "trail life", terms: ["trail life", "trailman", "trailmen", "troop pa", "outdoor adventure", "godly and responsible men"] },
    { org: "sample family support", terms: ["sample family support"] }
  ];
  return otherOrgSignals.some((signal) => !org.includes(signal.org) && signal.terms.some((term) => text.includes(term)));
}

function contextBundle(profile, documents, answers, fields = [], learning = null) {
  return {
    profile,
    activeOrganizationOnly: true,
    valuesGuardrails: {
      organization: profile.organization || "",
      mission: profile.mission || "",
      positioning: profile.positioning || "",
      programContext: profile.programContext || "",
      focusAreas: profile.focusAreas || [],
      audiences: profile.audiences || [],
      answerPrinciples: profile.answerPrinciples || [],
      voice: profile.voice || ""
    },
    documentContext: String(documents.context || "").slice(0, 10000),
    answerLibrary: compactAnswerLibrary(answers.items || [], fields),
    learningMemory: learning || { preferences: [], similarPastAnswers: [] },
    detectedFields: fields.map((f) => ({
      key: f.key,
      label: fieldLabel(f),
      intent: fieldIntent(f),
      guidance: intentGuidance(fieldIntent(f)),
      type: f.type
    }))
  };
}

function compactAnswerLibrary(items = [], fields = [], limit = 10) {
  const fieldText = (fields || []).map(fieldLabel).join(" ");
  return (items || [])
    .map((item) => ({
      question: item.question,
      answer: item.answer,
      source: item.source,
      score: similarity(fieldText, `${item.question || ""} ${item.answer || ""}`)
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ score, ...item }) => item);
}

function tokenize(value = "") {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length > 2);
}

function similarity(a = "", b = "") {
  const left = new Set(tokenize(a));
  const right = new Set(tokenize(b));
  if (!left.size || !right.size) return 0;
  let overlap = 0;
  for (const token of left) {
    if (right.has(token)) overlap += 1;
  }
  return overlap / Math.max(left.size, right.size);
}

function scopedLearning(learning, organizationId) {
  const scoped = learning.organizations?.[organizationId] || {};
  return {
    preferences: scoped.preferences || [],
    events: scoped.events || []
  };
}

function similarLearningExamples(learning, organizationId, fields, limit = 6) {
  const scoped = scopedLearning(learning, organizationId);
  const fieldText = (fields || []).map(fieldLabel).join(" ");
  return scoped.events
    .map((event) => ({
      question: event.question,
      finalAnswer: event.finalAnswer,
      instruction: event.instruction || "",
      source: event.source || "",
      score: similarity(fieldText, `${event.question} ${event.finalAnswer}`)
    }))
    .filter((event) => event.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ score, ...event }) => event);
}

function learningContext(learning, organizationId, fields) {
  const scoped = scopedLearning(learning, organizationId);
  return {
    preferences: scoped.preferences || [],
    similarPastAnswers: similarLearningExamples(learning, organizationId, fields)
  };
}

function inferLearningPreferences(events = []) {
  const recent = events.slice(0, 40);
  const text = recent.map((event) => `${event.instruction || ""} ${event.finalAnswer || ""}`).join(" ").toLowerCase();
  const preferences = [
    "Follow the user's final edited answers as examples for tone, length, and substance.",
    "Prefer direct, concise, plainspoken answers over broad or abstract language."
  ];
  const averageWords = recent.length
    ? recent.reduce((sum, event) => sum + tokenize(event.finalAnswer || "").length, 0) / recent.length
    : 0;
  if (averageWords && averageWords < 55) preferences.push("Keep answers short unless the question clearly requires detail.");
  if (/(shorter|concise|direct|to the point|word salad)/.test(text)) preferences.push("Lead with the answer and avoid filler, setup, and repeated mission language.");
  if (/(warm|kind|loving|respect|humility|humble)/.test(text)) preferences.push("Use a warm, respectful tone without sounding defensive.");
  if (/(biblical|belief|conviction|lgbtq|gender|cultural)/.test(text)) preferences.push("For cultural or values questions, be kind and respectful while staying steady in the organization's stated beliefs.");
  if (/(technical|software|ai|automation)/.test(text)) preferences.push("Avoid technical detail unless the application specifically asks for it.");
  return [...new Set(preferences)].slice(0, 8);
}

async function recordLearningEvent(organizationId, event) {
  const learning = await readJson("learning");
  learning.organizations = learning.organizations || {};
  const scoped = learning.organizations[organizationId] || { preferences: [], events: [] };
  const item = {
    id: `learn_${Date.now()}`,
    organizationId,
    question: event.question || "Application field",
    originalAnswer: event.originalAnswer || "",
    finalAnswer: event.finalAnswer || "",
    instruction: event.instruction || "",
    field: event.field || {},
    pageUrl: event.pageUrl || "",
    source: event.source || "extension-edit",
    updatedAt: new Date().toISOString()
  };
  scoped.events = [
    item,
    ...(scoped.events || []).filter((existing) => !(existing.question === item.question && existing.finalAnswer === item.finalAnswer))
  ].slice(0, 200);
  scoped.preferences = inferLearningPreferences(scoped.events);
  scoped.updatedAt = new Date().toISOString();
  learning.organizations[organizationId] = scoped;
  await writeJson("learning", learning);
  return { item, preferences: scoped.preferences };
}

function answerContradictsValues(answer, field, profile) {
  const text = String(answer || "").toLowerCase();
  const label = fieldLabel(field).toLowerCase();
  const org = String(profile.organization || "").toLowerCase();
  if (org.includes("trail life")) {
    const culturalField = /(lgbtq|gender identity|nondiscrimination|eligibility|cultural|religious|biblical)/i.test(label);
    if (culturalField) {
      const wavering = [
        "change our beliefs",
        "set aside our beliefs",
        "compromise our beliefs",
        "abandon our biblical",
        "affirm all gender identities",
        "regardless of gender identity in all roles",
        "remove boy-focused",
        "not faith-based"
      ];
      const harsh = [
        "condemn",
        "reject people",
        "hate",
        "unwelcome as people",
        "lesser dignity"
      ];
      return wavering.some((term) => text.includes(term)) || harsh.some((term) => text.includes(term));
    }
  }
  return false;
}

function distinctAnswerForDuplicate(answer, field, profile, usedAnswers) {
  const normalized = normalizeAnswer(answer);
  const isRepeat = [...usedAnswers].some((used) => used === normalized || similarity(used, normalized) > 0.82);
  if (!isRepeat) return answer;

  const fallback = fallbackAnswer(field, profile);
  const fallbackNormalized = normalizeAnswer(fallback);
  const fallbackRepeats = [...usedAnswers].some((used) => used === fallbackNormalized || similarity(used, fallbackNormalized) > 0.82);
  if (!fallbackRepeats) return fallback;

  return uniqueFallbackAnswer(field, profile);
}

function normalizeAnswer(answer = "") {
  return String(answer)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function uniqueFallbackAnswer(field, profile) {
  const label = fieldLabel(field).toLowerCase();
  const org = profile.organization || "the organization";
  if (label.includes("mission")) return `We exist to carry out ${org}'s mission with clarity, care, and responsible stewardship in the community we serve.`;
  if (label.includes("population") || label.includes("served")) return `We focus on the people most connected to our mission, shaping support around their real needs rather than offering a one-size-fits-all response.`;
  if (label.includes("program model")) return `We work through a practical program model that combines clear expectations, committed leadership, and consistent follow-through.`;
  if (label.includes("outcome") || label.includes("measurement")) return `We will look for clear signs that participants are growing, support is reaching the right people, and the work is producing meaningful change.`;
  if (label.includes("budget")) return `We will use grant funds for the direct costs that make this work possible, while managing every dollar with care and accountability.`;
  if (label.includes("sustain")) return `We will sustain the work through committed leadership, volunteer ownership, community support, and careful stewardship beyond the grant period.`;
  if (label.includes("volunteer")) return `We equip volunteers with clear roles and practical support so they can serve consistently and understand how their work advances the mission.`;
  if (label.includes("report")) return `We will report what was done, what changed, what we learned, and how funds were used to support the stated purpose.`;
  if (label.includes("faith") || label.includes("biblical") || label.includes("religious")) return `We are open about the beliefs that shape our work, and we aim to express those convictions with humility, steadiness, and care.`;
  if (label.includes("lgbtq") || label.includes("gender") || label.includes("cultural")) return `We treat people with dignity and kindness while remaining clear about the convictions and standards that guide our organization.`;
  return `We answer this question through the specific lens of ${org}'s mission, keeping the response practical, direct, and tied to the purpose of the request.`;
}

function uniqueSessionAnswer(answer, field, profile, usedAnswers) {
  if (isSimpleProfileField(field)) return answer;
  const guarded = answerMentionsOtherOrganization(answer, profile) || answerContradictsValues(answer, field, profile)
    ? fallbackAnswer(field, profile)
    : answer;
  const distinct = distinctAnswerForDuplicate(guarded, field, profile, usedAnswers);
  usedAnswers.add(normalizeAnswer(distinct));
  return distinct;
}

function wordCount(value = "") {
  return tokenize(value).length;
}

function unsupportedClaimRisk(answer, profile, documents) {
  const text = String(answer || "");
  const lower = text.toLowerCase();
  const sourceText = JSON.stringify({ profile, documents }).toLowerCase();
  if (/\b\d{2,}%|\b\d{3,}\b/.test(text)) return "Uses exact numbers or percentages that should be source-checked.";
  if (/\b(proven|guaranteed|certified|official partner|formal partnership|evidence-based|nationally recognized)\b/i.test(text)) {
    const riskyTerms = ["proven", "guaranteed", "certified", "official partner", "formal partnership", "evidence-based", "nationally recognized"];
    const unsupported = riskyTerms.find((term) => lower.includes(term) && !sourceText.includes(term));
    if (unsupported) return `Uses a strong claim, "${unsupported}", that is not clearly supported in the active organization context.`;
  }
  return "";
}

function addReviewIssue(issues, severity, field, message, suggestion = "") {
  issues.push({
    severity,
    key: field.key || "",
    label: fieldLabel(field),
    intent: field.intent || fieldIntent(field),
    message,
    suggestion
  });
}

function reviewApplication(fields, profile, documents = {}) {
  const issues = [];
  const seen = [];
  const narrativeFields = fields.filter((field) => !isSimpleProfileField(field));

  for (const field of fields) {
    const answer = String(field.answer || "").trim();
    const intent = field.intent || fieldIntent(field);
    const words = wordCount(answer);

    if (!answer) {
      addReviewIssue(issues, "high", field, "Missing answer.", "Draft or fill this field before submission.");
      continue;
    }

    if (!isSimpleProfileField(field) && words < 12) {
      addReviewIssue(issues, "medium", field, "Answer may be too thin for a narrative grant question.", "Add one concrete phrase tied to the question's intent.");
    }

    if (words > 95) {
      addReviewIssue(issues, "medium", field, "Answer may be too long for a concise application field.", "Tighten this to the strongest one or two sentences.");
    }

    const maxLength = Number(field.maxLength || 0);
    if (maxLength > 0 && answer.length > maxLength) {
      addReviewIssue(issues, "high", field, `Answer exceeds the field limit of ${maxLength} characters.`, "Shorten the answer before filling or submitting.");
    }

    if (answerMentionsOtherOrganization(answer, profile)) {
      addReviewIssue(issues, "high", field, "Answer appears to mention another organization's context.", "Rewrite using only the active organization's facts and language.");
    }

    if (answerContradictsValues(answer, field, profile)) {
      addReviewIssue(issues, "high", field, "Answer may conflict with the active organization's stated values.", "Revise with respectful clarity while staying true to the organization's beliefs.");
    }

    const claimRisk = unsupportedClaimRisk(answer, profile, documents);
    if (claimRisk) {
      addReviewIssue(issues, "medium", field, claimRisk, "Verify the claim or soften the wording.");
    }

    if (intent === "outcomes" && !/(measure|outcome|track|report|evaluate|change|growth|progress|impact|learn)/i.test(answer)) {
      addReviewIssue(issues, "medium", field, "Outcome answer does not clearly describe measurement or change.", "Name what will be measured or observed.");
    }

    if (intent === "budget" && !/(fund|cost|materials|training|equipment|supplies|scholarship|support|use|dollar|expense)/i.test(answer)) {
      addReviewIssue(issues, "medium", field, "Budget answer does not clearly explain how funds will be used.", "Connect requested funds to specific responsible uses.");
    }

    if (intent === "values-culture" && !/(dignity|respect|kind|humility|loving|care|belief|conviction|faith|biblical|standard)/i.test(answer)) {
      addReviewIssue(issues, "medium", field, "Values answer may not balance clarity and respect.", "Include both dignity for people and faithfulness to stated convictions.");
    }

    if (!isSimpleProfileField(field)) {
      const normalized = normalizeAnswer(answer);
      const duplicate = seen.find((item) => item.normalized === normalized || similarity(item.normalized, normalized) > 0.82);
      if (duplicate) {
        addReviewIssue(issues, "high", field, `Answer is too similar to "${duplicate.label}".`, "Rework this answer around its specific question intent.");
      }
      seen.push({ normalized, label: fieldLabel(field) });
    }
  }

  const intentCounts = narrativeFields.reduce((counts, field) => {
    const intent = field.intent || fieldIntent(field);
    counts[intent] = (counts[intent] || 0) + 1;
    return counts;
  }, {});
  const severityCounts = issues.reduce((counts, issue) => {
    counts[issue.severity] = (counts[issue.severity] || 0) + 1;
    return counts;
  }, { high: 0, medium: 0, low: 0 });

  return {
    status: issues.length
      ? `Review found ${issues.length} item${issues.length === 1 ? "" : "s"} to check.`
      : "Review complete: no major issues found.",
    summary: {
      fieldCount: fields.length,
      narrativeFieldCount: narrativeFields.length,
      issueCount: issues.length,
      high: severityCounts.high || 0,
      medium: severityCounts.medium || 0,
      low: severityCounts.low || 0,
      intents: intentCounts
    },
    issues: issues.slice(0, 30)
  };
}

function isSimpleProfileField(field) {
  const label = fieldLabel(field).toLowerCase();
  return [
    "organization name",
    "organizationname",
    "primary contact",
    "contact name",
    "contactname",
    "contact title",
    "contact email",
    "email",
    "ein",
    "employer identification",
    "tax exempt",
    "tax-exempt",
    "requested amount"
  ].some((token) => label.includes(token));
}

function parseAnswersJson(text, fallbacks) {
  const cleaned = String(text || "").replace(/^```json\s*/i, "").replace(/```$/i, "").trim();
  const candidates = [
    cleaned,
    cleaned.slice(cleaned.indexOf("{"), cleaned.lastIndexOf("}") + 1)
  ].filter((candidate) => candidate && candidate.startsWith("{"));
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (Array.isArray(parsed.answers)) return parsed.answers;
    } catch {
      // Try the next candidate.
    }
  }
  return fallbacks;
}

function parseChatAnswer(text, fallback) {
  const raw = String(text || "").trim();
  const answerMarker = raw.lastIndexOf("\"answer\"");
  if (answerMarker >= 0) {
    const start = raw.lastIndexOf("{", answerMarker);
    const end = raw.indexOf("}", answerMarker);
    if (start >= 0 && end > start) {
      try {
        const parsed = JSON.parse(raw.slice(start, end + 1));
        if (parsed.answer) return String(parsed.answer).trim();
      } catch {
        // Fall through to text cleanup.
      }
    }
  }
  const withoutFences = raw.replace(/^```(?:json)?\s*/i, "").replace(/```$/i, "").trim();
  if (/User Question:|Draft \d|JSON structure|First person plural/i.test(withoutFences)) {
    const sentences = withoutFences.split(/\n+/).map((line) => line.trim()).filter(Boolean);
    const candidate = sentences.reverse().find((line) => line.startsWith("We "));
    if (candidate) return candidate.replace(/^\*+\s*/, "").trim();
    return fallback;
  }
  return withoutFences || fallback;
}

async function generateWithOpenAI(messages, fallback) {
  if ((process.env.AI_PROVIDER || "").toLowerCase() === "gemini") {
    return generateWithGemini(messages, fallback);
  }
  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";
  if (!process.env.OPENAI_API_KEY) {
    recordAiDiagnostic({
      provider: "openai",
      ok: false,
      model,
      status: "missing_key",
      error: "OPENAI_API_KEY is not configured."
    });
    return { ok: false, source: "fallback", missingKey: true, text: fallback };
  }
  try {
    let response;
    if (OpenAI) {
      const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
      response = await client.chat.completions.create({
        model,
        messages,
        temperature: 0.25,
        max_tokens: 700
      });
    } else {
      const raw = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
        },
        body: JSON.stringify({
          model,
          messages,
          temperature: 0.25,
          max_tokens: 700
        })
      });
      if (!raw.ok) throw new Error(`OpenAI API ${raw.status}`);
      response = await raw.json();
    }
    recordAiDiagnostic({
      provider: "openai",
      ok: true,
      model,
      status: "ok",
      error: ""
    });
    return {
      ok: true,
      source: "openai",
      text: response.choices?.[0]?.message?.content?.trim() || fallback
    };
  } catch (error) {
    recordAiDiagnostic({
      provider: "openai",
      ok: false,
      model,
      status: "error",
      error: error.message
    });
    return { ok: false, source: "fallback", error: error.message, text: fallback };
  }
}

function messagesToGeminiPrompt(messages) {
  return messages.map((message) => `${message.role.toUpperCase()}:\n${message.content}`).join("\n\n");
}

async function generateWithGemini(messages, fallback) {
  const model = process.env.GEMINI_MODEL || "gemma-4-31b-it";
  if (!process.env.GEMINI_API_KEY) {
    recordAiDiagnostic({
      provider: "gemini",
      ok: false,
      model,
      status: "missing_key",
      error: "GEMINI_API_KEY is not configured."
    });
    return { ok: false, source: "fallback", missingKey: true, text: fallback };
  }
  const prompt = messagesToGeminiPrompt(messages);
  const request = async (jsonMode) => {
    const generationConfig = {
      temperature: 0.25,
      maxOutputTokens: 1800
    };
    if (jsonMode) generationConfig.responseMimeType = "application/json";
    const raw = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${process.env.GEMINI_API_KEY}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: [{ text: prompt }]
          }
        ],
        generationConfig
      })
    });
    if (!raw.ok) throw new Error(`Gemini API ${raw.status}`);
    return raw.json();
  };
  try {
    let response;
    try {
      response = await request(true);
    } catch {
      response = await request(false);
    }
    recordAiDiagnostic({
      provider: "gemini",
      ok: true,
      model,
      status: "ok",
      error: ""
    });
    return {
      ok: true,
      source: "gemini",
      text: response.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("").trim() || fallback
    };
  } catch (error) {
    recordAiDiagnostic({
      provider: "gemini",
      ok: false,
      model,
      status: "error",
      error: error.message
    });
    return { ok: false, source: "fallback", error: error.message, text: fallback };
  }
}

app.get("/api/status", async (_req, res) => {
  const drafts = await readJson("drafts");
  const applications = await readJson("applications");
  const profiles = await readProfileStore();
  const active = activeProfile(profiles);
  const scopedApplicationCount = (applications.items || []).filter((item) => item.organizationId === profiles.activeOrganizationId).length;
  const provider = (process.env.AI_PROVIDER || "openai").toLowerCase();
  res.json({
    app: "GrantFlow Assistant",
    aiProvider: provider,
    aiConfigured: provider === "gemini" ? Boolean(process.env.GEMINI_API_KEY) : Boolean(process.env.OPENAI_API_KEY),
    openaiConfigured: Boolean(process.env.OPENAI_API_KEY),
    aiDiagnostic: publicAiDiagnostic(),
    activeOrganization: active.organization || "",
    activeOrganizationId: profiles.activeOrganizationId,
    savedDraftSessions: drafts.sessions.length,
    savedApplicationWorkspaces: scopedApplicationCount
  });
});

app.get("/api/profile", async (_req, res) => res.json(profileResponse(await readProfileStore())));
app.put("/api/profile", async (req, res) => {
  const store = await readProfileStore();
  const approveImportedContent = req.body.approveImportedContent === true;
  const { approveImportedContent: _approval, ...profileFields } = req.body;
  const candidate = { ...activeProfile(store), ...profileFields, id: store.activeOrganizationId };
  if (approveImportedContent && !profileIsReviewed(candidate)) {
    res.statusCode = 400;
    return res.json({
      error: "Review is incomplete. Add an organization name, mission statement, and one-line summary in your own words."
    });
  }
  store.organizations = store.organizations.map((org) => {
    if (org.id !== store.activeOrganizationId) return org;
    const merged = { ...org, ...profileFields, id: org.id };
    merged.needsReview = !profileIsReviewed(merged);
    return merged;
  });
  await writeJson("profile", store);
  if (approveImportedContent && !activeProfile(store).needsReview) {
    await approvePendingImport(store.activeOrganizationId);
  }
  res.json(profileResponse(store));
});

app.put("/api/profile/active", async (req, res) => {
  const store = await readProfileStore();
  if (store.organizations.some((org) => org.id === req.body.id)) {
    store.activeOrganizationId = req.body.id;
    await writeJson("profile", store);
  }
  res.json(profileResponse(store));
});

app.post("/api/profile/organizations", async (req, res) => {
  const store = await readProfileStore();
  let id = slug(req.body.organization || "New Organization");
  while (store.organizations.some((org) => org.id === id)) id = `${id}-${Date.now()}`;
  const current = activeProfile(store);
  const organization = {
    ...current,
    id,
    organization: req.body.organization || "New Organization",
    primaryContact: "",
    contactTitle: "",
    contactEmail: "",
    summary: "",
    mission: "",
    positioning: "",
    programContext: "",
    audiences: [],
    focusAreas: [],
    answerPrinciples: current.answerPrinciples || [],
    voice: current.voice || "First person plural, concise, warm, and direct."
  };
  store.organizations.push(organization);
  store.activeOrganizationId = id;
  await writeJson("profile", store);
  await writeOrganizationMarkdown(organization, "", []);
  res.json(profileResponse(store));
});

app.post("/api/onboard/website", async (req, res) => {
  const organizationName = String(req.body.organization || "").trim();
  const website = String(req.body.website || "").trim();
  if (!organizationName || !website) {
    res.statusCode = 400;
    return res.json({ error: "Organization name and website are required." });
  }
  let pages = [];
  let scrapedText = "";
  try {
    pages = await scrapeOrganizationWebsite(website);
    scrapedText = pages.map((page) => `Source: ${page.url}\nTitle: ${page.title}\n${page.text}`).join("\n\n").slice(0, 28000);
  } catch (error) {
    res.statusCode = 400;
    return res.json({ error: error.message });
  }

  const fallback = fallbackOnboardingProfile(organizationName, website, scrapedText);
  const generated = await generateWithOpenAI([
    {
      role: "system",
      content: [
        "You create scoped grant-writing knowledge bases from public website text.",
        "Return strict JSON only.",
        "Do not invent facts not supported by the scraped text.",
        "Keep wording concise and grant-ready.",
        "Extract the organization's mission, audiences, programs, values, eligibility standards, faith commitments if present, focus areas, and answer principles.",
        "If values or faith commitments are present, preserve them accurately and respectfully."
      ].join(" ")
    },
    {
      role: "user",
      content: JSON.stringify({
        organization: organizationName,
        website,
        scrapedPages: pages.map((page) => ({ url: page.url, title: page.title })),
        scrapedText,
        outputShape: {
          summary: "string",
          mission: "string",
          positioning: "string",
          programContext: "string",
          audiences: ["string"],
          focusAreas: ["string"],
          answerPrinciples: ["string"],
          voice: "string",
          context: "string",
          answerExamples: [{ question: "string", answer: "string" }]
        }
      })
    }
  ], JSON.stringify(fallback));

  const learned = parseOnboardingJson(generated.text, fallback);
  const store = await readProfileStore();
  let id = slug(organizationName);
  while (store.organizations.some((org) => org.id === id)) id = `${slug(organizationName)}-${Date.now()}`;
  // Never let raw scrape/navigation text land in human-facing fields, even if the
  // model echoed it back. Blank anything that still looks scraped so onboarding
  // review starts from a clean, clearly-empty state.
  const safeField = (value) => (looksLikeScrape(value) ? "" : String(value || ""));
  const summary = safeField(learned.summary || fallback.summary);
  const mission = safeField(learned.mission || fallback.mission);
  const positioning = safeField(learned.positioning || fallback.positioning);
  const programContext = safeField(learned.programContext || fallback.programContext);
  const organization = {
    id,
    organization: organizationName,
    website,
    primaryContact: "",
    contactTitle: "",
    contactEmail: "",
    requestedAmountNarrative: "To be determined based on the foundation's funding guidelines.",
    summary,
    mission,
    positioning,
    programContext,
    audiences: Array.isArray(learned.audiences) ? learned.audiences : [],
    focusAreas: Array.isArray(learned.focusAreas) ? learned.focusAreas : [],
    answerPrinciples: Array.isArray(learned.answerPrinciples) && learned.answerPrinciples.length ? learned.answerPrinciples : fallback.answerPrinciples,
    voice: learned.voice || fallback.voice,
    // Imported content must be reviewed before it influences drafts.
    needsReview: true,
    importedFrom: website,
    importedAt: new Date().toISOString(),
    sourceExcerpt: String(scrapedText || "").slice(0, 1200)
  };

  store.organizations.push(organization);
  store.activeOrganizationId = id;
  await writeJson("profile", store);

  const documents = await readJson("documents");
  const nextDocuments = documents.contexts ? documents : { contexts: {} };
  nextDocuments.pendingImports = nextDocuments.pendingImports || {};
  nextDocuments.pendingImports[id] = {
    context: learned.context || fallback.context,
    answerExamples: Array.isArray(learned.answerExamples) ? learned.answerExamples : [],
    importedAt: organization.importedAt,
    importedFrom: website
  };
  await writeJson("documents", nextDocuments);

  const examples = Array.isArray(learned.answerExamples) ? learned.answerExamples : [];
  const scopedExamples = examples
    .filter((item) => item.question && item.answer)
    .slice(0, 12)
    .map((item, index) => ({
      id: `${id}_onboard_${index + 1}`,
      organizationId: id,
      question: item.question,
      answer: item.answer,
      source: "website-onboarding",
      updatedAt: new Date().toISOString()
    }));
  await writeOrganizationMarkdown(organization, "Pending human review; imported context is quarantined.", []);

  res.json({
    organization: profileResponse(store),
    scrapedPages: pages.map((page) => ({ url: page.url, title: page.title })),
    source: generated.source,
    status: generated.ok
      ? "Website imported into quarantine; review the profile before using it in drafts."
      : "Website text imported into quarantine; review the profile before using it in drafts.",
    pendingAnswerExamples: scopedExamples.length
  });
});

app.get("/api/answers", async (_req, res) => {
  const store = await readProfileStore();
  res.json(scopedAnswers(await readJson("answers"), store.activeOrganizationId));
});
app.put("/api/answers", async (req, res) => {
  const store = await readProfileStore();
  const all = await readJson("answers");
  const incoming = (req.body.items || []).map((item) => ({ ...item, organizationId: store.activeOrganizationId }));
  all.items = [
    ...incoming,
    ...(all.items || []).filter((item) => item.organizationId && item.organizationId !== store.activeOrganizationId)
  ];
  await writeJson("answers", all);
  res.json(scopedAnswers(all, store.activeOrganizationId));
});

app.get("/api/documents", async (_req, res) => {
  const store = await readProfileStore();
  res.json(scopedDocuments(await readJson("documents"), store.activeOrganizationId));
});
app.put("/api/documents", async (req, res) => {
  const store = await readProfileStore();
  const documents = await readJson("documents");
  const next = documents.contexts ? documents : { contexts: { [store.activeOrganizationId]: documents.context || "" } };
  next.contexts[store.activeOrganizationId] = req.body.context || "";
  await writeJson("documents", next);
  res.json(scopedDocuments(next, store.activeOrganizationId));
});

app.get("/api/drafts", async (_req, res) => res.json(await readJson("drafts")));

app.get("/api/applications", async (_req, res) => {
  try {
    const store = await readProfileStore();
    res.json(scopedApplications(await readJson("applications"), store.activeOrganizationId));
  } catch (error) {
    routeError(res, error);
  }
});

app.post("/api/applications", async (req, res) => {
  try {
    const store = await readProfileStore();
    const applications = await readJson("applications");
    const payload = cleanApplicationPayload(req.body);
    const now = new Date().toISOString();
    const item = {
      id: `app_${Date.now()}`,
      organizationId: store.activeOrganizationId,
      ...payload,
      applicationName: payload.applicationName || payload.funderName || "Untitled application",
      createdAt: now,
      updatedAt: now
    };
    applications.items = [item, ...(applications.items || [])].slice(0, 100);
    await writeJson("applications", applications);
    res.json(item);
  } catch (error) {
    routeError(res, error);
  }
});

app.put("/api/applications", async (req, res) => {
  try {
    const store = await readProfileStore();
    const applications = await readJson("applications");
    const existing = (applications.items || []).find((item) => item.id === req.body.id && item.organizationId === store.activeOrganizationId);
    if (!existing) {
      res.statusCode = 404;
      return res.json({ error: "Application workspace not found for the active organization." });
    }
    const payload = cleanApplicationPayload({ ...existing, ...req.body });
    const updated = {
      ...existing,
      ...payload,
      applicationName: payload.applicationName || payload.funderName || existing.applicationName || "Untitled application",
      updatedAt: new Date().toISOString()
    };
    applications.items = (applications.items || []).map((item) => item.id === updated.id ? updated : item);
    await writeJson("applications", applications);
    res.json(updated);
  } catch (error) {
    routeError(res, error);
  }
});

app.post("/api/applications/from-draft", async (req, res) => {
  try {
    const store = await readProfileStore();
    const drafts = await readJson("drafts");
    const draft = (drafts.sessions || []).find((session) => session.id === req.body.draftId);
    if (!draft) {
      res.statusCode = 404;
      return res.json({ error: "Draft session not found." });
    }
    const applications = await readJson("applications");
    const payload = cleanApplicationPayload({
      ...req.body,
      sourceUrl: req.body.sourceUrl || draft.pageUrl || "",
      finalAnswers: draft.fields || []
    });
    const now = new Date().toISOString();
    const item = {
      id: `app_${Date.now()}`,
      organizationId: store.activeOrganizationId,
      funderName: payload.funderName || "Draft import",
      applicationName: payload.applicationName || `Application from ${draft.createdAt || "draft"}`,
      deadline: payload.deadline,
      sourceUrl: payload.sourceUrl,
      status: payload.status || "working",
      notes: payload.notes || `Imported from draft session ${draft.id}.`,
      finalAnswers: payload.finalAnswers,
      draftId: draft.id,
      createdAt: now,
      updatedAt: now
    };
    applications.items = [item, ...(applications.items || [])].slice(0, 100);
    await writeJson("applications", applications);
    res.json(item);
  } catch (error) {
    routeError(res, error);
  }
});

app.get("/api/applications/export", async (req, res) => {
  try {
    const store = await readProfileStore();
    const profile = activeProfile(store);
    const applications = await readJson("applications");
    const item = (applications.items || []).find((application) => application.id === req.query.id && application.organizationId === store.activeOrganizationId);
    if (!item) {
      res.statusCode = 404;
      return res.json({ error: "Application workspace not found for the active organization." });
    }
    const format = String(req.query.format || "markdown").toLowerCase();
    if (format === "json") {
      return res.json(item);
    }
    res.writeHead(200, { "Content-Type": "text/markdown; charset=utf-8" });
    res.end(applicationMarkdown(item, profile));
  } catch (error) {
    routeError(res, error);
  }
});

app.get("/api/learning", async (_req, res) => {
  const store = await readProfileStore();
  res.json(scopedLearning(await readJson("learning"), store.activeOrganizationId));
});

app.post("/api/learn-answer", async (req, res) => {
  const { field, answer, originalAnswer, instruction, pageUrl } = req.body;
  const store = await readProfileStore();
  const answers = await readJson("answers");
  const question = fieldLabel(field || {});
  const item = {
    id: `ans_${Date.now()}`,
    organizationId: store.activeOrganizationId,
    question,
    answer,
    source: "extension-edit",
    updatedAt: new Date().toISOString()
  };
  answers.items = [
    item,
    ...(answers.items || []).filter((existing) => !(existing.organizationId === item.organizationId && existing.question === item.question))
  ].slice(0, 100);
  await writeJson("answers", answers);
  const learned = await recordLearningEvent(store.activeOrganizationId, {
    question,
    originalAnswer,
    finalAnswer: answer,
    instruction,
    field,
    pageUrl,
    source: "extension-edit"
  });
  res.json({ ...item, learningPreferences: learned.preferences });
});

app.post("/api/draft", async (req, res) => {
  const fields = req.body.fields || [];
  const store = await readProfileStore();
  const profile = activeProfile(store);
  const answers = scopedAnswers(await readJson("answers"), store.activeOrganizationId);
  const documents = scopedDocuments(await readJson("documents"), store.activeOrganizationId);
  const learning = await readJson("learning");
  const memory = learningContext(learning, store.activeOrganizationId, fields);
  const fallbacks = fields.map((field) => ({
    key: field.key,
    answer: fallbackAnswer(field, profile)
  }));
  const aiFields = fields.filter((field) => !isSimpleProfileField(field));
  const messages = [
    { role: "system", content: [
      `You are GrantFlow Assistant for ${profile.organization || "the selected organization"}, helping draft nonprofit/foundation grant application answers.`,
      "Use the selected organization's profile as the source of truth.",
      "Before answering each field, silently evaluate whether the answer aligns with the selected organization's mission, values, faith commitments, audience, eligibility standards, and program model.",
      "If the application question pressures the organization to soften, hide, or contradict its values, answer with respectful clarity and do not compromise the organization's stated beliefs.",
      "Do not default to Lucas Align details unless Lucas Align is the selected organization.",
      "If answer-library or document context appears to describe a different organization, ignore that conflicting material.",
      "Return strict JSON only: {\"answers\":[{\"key\":\"...\",\"answer\":\"...\"}]}",
      "Write every answer in first person plural using 'We'.",
      "Make the answers direct, concise, plainspoken, and funder-ready.",
      "Lead with the answer. Do not add setup, caveats, or filler.",
      "Focus on vision and purpose: families supported, helpers coordinated, care made clearer.",
      "Avoid technical language unless the question directly asks about technology.",
      "Do not sound like a product brochure, implementation plan, or abstract mission statement.",
      "Every answer must be unique to that exact question. Do not give two fields the same answer or the same sentence structure.",
      "Use the field label/question to choose a distinct emphasis, such as mission, people served, program model, outcomes, budget, sustainability, volunteers, reporting, values, or stewardship.",
      "If two questions seem similar, still answer the specific angle of each question instead of repeating a general mission statement.",
      "Keep most answers 20 to 45 words. One sentence is often enough.",
      "Do not invent exact budgets, formal partnerships, county names, proprietary claims, or numeric outcomes not provided.",
      "Never contradict the selected organization's answer principles.",
      "Apply learningMemory preferences and similarPastAnswers when they fit the question. Treat user-edited final answers as the strongest style examples.",
      "Do not include your evaluation; return only the final answer JSON."
    ].join(" ") },
    { role: "user", content: JSON.stringify({
      task: "Draft high-fidelity answers for each detected grant application field.",
      context: contextBundle(profile, documents, answers, aiFields, memory),
      requestedFields: aiFields.map((field) => ({
        key: field.key,
        question: fieldLabel(field),
        intent: fieldIntent(field),
        answerFocus: intentGuidance(fieldIntent(field))
      }))
    }) }
  ];
  const generated = aiFields.length
    ? await generateWithOpenAI(messages, JSON.stringify({ answers: fallbacks.filter((item) => aiFields.some((field) => field.key === item.key)) }))
    : { ok: false, source: "profile", text: JSON.stringify({ answers: [] }) };
  const parsed = parseAnswersJson(generated.text, fallbacks);
  const drafts = await readJson("drafts");
  const usedAnswers = new Set();
  const session = {
    id: `draft_${Date.now()}`,
    createdAt: new Date().toISOString(),
    pageUrl: req.body.pageUrl || "",
    fieldCount: fields.length,
    source: generated.source,
    status: generated.missingKey ? "API key missing; fallback answers generated." : generated.ok ? `${generated.source} draft generated.` : "AI provider unavailable; fallback answers generated.",
    fields: fields.map((field) => ({
      ...field,
      intent: fieldIntent(field),
      answer: (() => {
        const answer = parsed.find((item) => item.key === field.key)?.answer || fallbackAnswer(field, profile);
        return uniqueSessionAnswer(answer, field, profile, usedAnswers);
      })()
    }))
  };
  drafts.sessions = [session, ...(drafts.sessions || [])].slice(0, 25);
  await writeJson("drafts", drafts);
  res.json(session);
});

app.post("/api/review", async (req, res) => {
  const store = await readProfileStore();
  const profile = activeProfile(store);
  const documents = scopedDocuments(await readJson("documents"), store.activeOrganizationId);
  const fields = (req.body.fields || []).map((field) => ({
    ...field,
    intent: field.intent || fieldIntent(field)
  }));
  res.json(reviewApplication(fields, profile, documents));
});

app.post("/api/revise", async (req, res) => {
  const store = await readProfileStore();
  const profile = activeProfile(store);
  const answers = scopedAnswers(await readJson("answers"), store.activeOrganizationId);
  const documents = scopedDocuments(await readJson("documents"), store.activeOrganizationId);
  const field = req.body.field || {};
  const question = req.body.question || fieldLabel(field);
  const learning = await readJson("learning");
  const memory = learningContext(learning, store.activeOrganizationId, [field]);
  const currentAnswer = req.body.currentAnswer || fallbackAnswer(field, profile);
  const instruction = req.body.instruction || "Improve this answer.";
  const fallback = currentAnswer || fallbackAnswer(field, profile);
  const generated = await generateWithOpenAI([
    { role: "system", content: [
      `You are GrantFlow Assistant for ${profile.organization || "the selected organization"}.`,
      "Return strict JSON only: {\"answer\":\"...\"}",
      "The answer value must be the final revised response only.",
      "Do not include analysis, dialogue, alternatives, labels, markdown, or preamble.",
      "Use first person plural with 'We' when drafting organizational language.",
      "Make the answer concise, direct, plainspoken, and funder-ready.",
      "Lead with the answer. Avoid filler and word salad.",
      "Stay true to the selected organization's mission, values, faith commitments, audience, eligibility standards, and program model.",
      "If the question involves a cultural or values issue, answer with respectful clarity and do not compromise the selected organization's stated beliefs.",
      "Use only the selected organization's scoped context. Ignore material for other organizations.",
      "Do not invent exact budgets, partnerships, numbers, or claims not provided.",
      "Apply learningMemory preferences and similarPastAnswers when they fit this question. Treat user-edited final answers as the strongest style examples.",
      "Keep most answers 20 to 45 words unless the instruction asks for more."
    ].join(" ") },
    { role: "user", content: JSON.stringify({
      task: "Revise one grant application answer.",
      question,
      currentAnswer,
      instruction,
      field,
      context: contextBundle(profile, documents, answers, [field], memory),
      output: "Return only JSON with one answer string."
    }) }
  ], JSON.stringify({ answer: fallback }));
  const revised = parseChatAnswer(generated.text, fallback);
  const answer = answerMentionsOtherOrganization(revised, profile) || answerContradictsValues(revised, field, profile)
    ? fallbackAnswer(field, profile)
    : revised;
  res.json({
    answer,
    status: generated.missingKey ? "API key missing; showing fallback revision." : generated.ok ? `Revised with ${generated.source}.` : "AI provider unavailable; showing fallback revision.",
    source: generated.source
  });
});

app.post("/api/chat", async (req, res) => {
  const store = await readProfileStore();
  const profile = activeProfile(store);
  const answers = scopedAnswers(await readJson("answers"), store.activeOrganizationId);
  const documents = scopedDocuments(await readJson("documents"), store.activeOrganizationId);
  const question = req.body.question || "";
  const fields = req.body.fields || [];
  const learning = await readJson("learning");
  const memory = learningContext(learning, store.activeOrganizationId, fields);
  // When AI is unavailable we must NOT surface an invented narrative as if it
  // answered the question. This string is only ever used internally as the
  // provider fallback text; it is never returned to the user (see below).
  const fallback = `We help volunteers understand what is needed, take action, and follow through so families receive timely, practical support.`;
  const generated = await generateWithOpenAI([
    { role: "system", content: [
      "You are GrantFlow Assistant.",
      "Return strict JSON only: {\"answer\":\"...\"}",
      "The answer value must be the final response only.",
      "Do not include analysis, drafts, checklists, dialogue labels, markdown, or preamble.",
      "Be direct, concise, plainspoken, and grant-ready.",
      `Use first person plural when drafting text for ${profile.organization || "the selected organization"}.`,
      "Use only the selected organization's profile and matching context. Ignore material for other organizations.",
      "Silently evaluate alignment with the selected organization's mission, values, faith commitments, audience, eligibility standards, and program model before answering.",
      "If the user asks about a cultural or values issue, answer with respectful clarity without compromising the selected organization's stated beliefs.",
      "Apply learningMemory preferences and similarPastAnswers when they fit the user's question.",
      "Keep most answers under 45 words unless the user asks for more."
    ].join(" ") },
    { role: "user", content: JSON.stringify({
      question,
      context: contextBundle(profile, documents, answers, fields, memory),
      output: "Return only JSON with one answer string."
    }) }
  ], fallback);
  if (!generated.ok) {
    // AI could not answer. Return an explicit unavailable result with a blank
    // answer and a machine-readable flag rather than an invented paragraph.
    return res.json({
      answer: "",
      available: false,
      source: "unavailable",
      status: generated.missingKey
        ? "AI drafting is unavailable — no API key is configured. Write the answer yourself or reuse a saved answer."
        : "AI drafting is unavailable right now. Write the answer yourself or reuse a saved answer."
    });
  }
  const answer = parseChatAnswer(generated.text, "");
  if (!answer) {
    return res.json({
      answer: "",
      available: false,
      source: "unavailable",
      status: "AI returned an empty draft. Write the answer yourself or reuse a saved answer."
    });
  }
  res.json({
    answer,
    available: true,
    source: generated.source,
    status: `Draft generated with ${generated.source}. Review before copying.`
  });
});

app.get("*", (_req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, "index.html"));
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`GrantFlow Assistant running at http://localhost:${PORT}`);
  });
}

module.exports = app;
