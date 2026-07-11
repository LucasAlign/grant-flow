const { spawn } = require("child_process");
const fs = require("fs/promises");
const path = require("path");

const PORT = process.env.VERIFY_PORT || 3106;
const BASE = `http://localhost:${PORT}`;
let server;
const dataFiles = ["answers.json", "applications.json", "documents.json", "drafts.json", "learning.json", "profile.json"];

async function waitForServer() {
  for (let i = 0; i < 25; i += 1) {
    try {
      const response = await fetch(`${BASE}/api/status`);
      if (response.ok) return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  }
  throw new Error("Server did not start at http://localhost:3000");
}

async function ensureServer() {
  server = spawn(process.execPath, ["server.js"], {
    stdio: "ignore",
    detached: false,
    env: {
      ...process.env,
      PORT: String(PORT)
    }
  });
  await waitForServer();
  return true;
}

async function get(pathname) {
  const response = await fetch(`${BASE}${pathname}`);
  if (!response.ok) throw new Error(`${pathname}: ${response.status} ${response.statusText}`);
  return response;
}

async function getJson(pathname) {
  return (await get(pathname)).json();
}

async function post(pathname, body, expectedStatus = 200) {
  const response = await fetch(`${BASE}${pathname}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  if (response.status !== expectedStatus) {
    throw new Error(`${pathname}: expected ${expectedStatus}, got ${response.status} ${response.statusText}`);
  }
  return response.json();
}

async function snapshotData() {
  const snapshot = {};
  for (const file of dataFiles) {
    const filePath = path.join("data", file);
    try {
      snapshot[file] = await fs.readFile(filePath, "utf8");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      snapshot[file] = null;
    }
  }
  return snapshot;
}

async function restoreData(snapshot) {
  for (const [file, contents] of Object.entries(snapshot)) {
    const filePath = path.join("data", file);
    if (contents === null) {
      await fs.rm(filePath, { force: true });
    } else {
      await fs.writeFile(filePath, contents);
    }
  }
}

async function verifyJsonFiles() {
  for (const file of dataFiles) {
    JSON.parse(await fs.readFile(path.join("data", file), "utf8"));
  }
}

async function verifyExtensionFiles() {
  for (const file of ["extension/content.js", "extension/sidepanel.js", "extension/background.js"]) {
    await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, ["--check", file], { stdio: "ignore" });
      child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`${file} syntax check failed`))));
      child.on("error", reject);
    });
  }
  const manifest = JSON.parse(await fs.readFile("extension/manifest.json", "utf8"));
  if (manifest.manifest_version !== 3) throw new Error("Extension manifest is not MV3.");
  if (!manifest.side_panel?.default_path) throw new Error("Extension side panel is missing.");
  if (!manifest.permissions.includes("scripting")) throw new Error("Extension scripting permission is missing.");
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function normalizeAnswer(answer = "") {
  return String(answer)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function assertUniqueNarrativeAnswers(fields) {
  const seen = new Map();
  for (const field of fields) {
    if (["#organization-name", "#contact-name", "#contact-title", "#contact-email"].includes(field.key)) continue;
    const normalized = normalizeAnswer(field.answer);
    if (!normalized) continue;
    if (seen.has(normalized)) {
      throw new Error(`Duplicate narrative answer for ${seen.get(normalized)} and ${field.key}`);
    }
    seen.set(normalized, field.key);
  }
}

async function main() {
  const started = await ensureServer();
  const snapshot = await snapshotData();
  try {
    await verifyJsonFiles();
    await verifyExtensionFiles();

    const status = await getJson("/api/status");
    assert(status.app === "GrantFlow Assistant", "Unexpected status payload.");
    assert(status.aiDiagnostic && typeof status.aiDiagnostic.status === "string", "AI diagnostic payload missing.");

    for (const route of ["/", "/mock-grant", "/profile", "/answers", "/documents", "/drafts", "/applications", "/onboarding"]) {
      const html = await (await get(route)).text();
      assert(html.includes("GrantFlow Assistant") || html.includes("GrantFlow"), `${route} did not return the app shell.`);
    }

    const profile = await getJson("/api/profile");
    const learningBefore = await getJson("/api/learning");
    assert(Array.isArray(learningBefore.preferences), "Learning preferences are not scoped correctly.");

    const fields = [
      {
        key: "#organization-name",
        id: "organization-name",
        name: "organizationName",
        type: "text",
        label: "Organization Name",
        context: "Organization Name"
      },
      {
        key: "#mission",
        id: "mission",
        name: "mission",
        type: "textarea",
        label: "Mission and Community Need",
        placeholder: "Describe your mission and the community need this grant will address.",
        context: "Mission and Community Need Describe your mission and the community need this grant will address."
      },
      {
        key: "#lgbtq-respect",
        id: "lgbtq-respect",
        name: "lgbtq-respect",
        type: "textarea",
        label: "LGBTQ+ Respect and Religious Beliefs",
        placeholder: "How would your organization respond to concerns about LGBTQ+ inclusion while remaining faithful to your beliefs?",
        context: "LGBTQ+ Respect and Religious Beliefs How would your organization respond to concerns about LGBTQ+ inclusion while remaining faithful to your beliefs?"
      }
    ];

    const draft = await post("/api/draft", { fields, pageUrl: `${BASE}/mock-grant` });
    assert(draft.fields.length === fields.length, "Draft did not return all fields.");
    assert(draft.fields.every((field) => typeof field.answer === "string"), "Draft answer missing.");
    assert(draft.fields.every((field) => typeof field.intent === "string"), "Draft intent missing.");
    assert(draft.fields[0].answer === profile.organization, "Simple organization field was not filled from active profile.");
    assertUniqueNarrativeAnswers(draft.fields);

    const similarFields = [
      {
        key: "#volunteers",
        id: "volunteers",
        name: "volunteers",
        type: "textarea",
        label: "Volunteer Engagement",
        context: "Volunteer Engagement How do volunteers participate, lead, and sustain the work?"
      },
      {
        key: "#staffing-volunteers",
        id: "staffing-volunteers",
        name: "staffing-volunteers",
        type: "textarea",
        label: "Staffing and Volunteer Support",
        context: "Staffing and Volunteer Support How will staff or volunteer leaders be trained, supported, or equipped?"
      },
      {
        key: "#community-service",
        id: "community-service",
        name: "community-service",
        type: "textarea",
        label: "Community Service",
        context: "Community Service How does your program encourage participants to serve others?"
      }
    ];
    const similarDraft = await post("/api/draft", { fields: similarFields, pageUrl: `${BASE}/mock-grant` });
    assertUniqueNarrativeAnswers(similarDraft.fields);

    const review = await post("/api/review", {
      fields: [
        { ...similarDraft.fields[0], answer: "We guide boys toward courage, integrity, service, faith, and outdoor adventure." },
        { ...similarDraft.fields[1], answer: "We guide boys toward courage, integrity, service, faith, and outdoor adventure." },
        { ...similarDraft.fields[2], answer: similarDraft.fields[2].answer }
      ],
      pageUrl: `${BASE}/mock-grant`
    });
    assert(review.summary.issueCount >= 1, "Review did not flag an intentional issue.");
    assert(review.issues.some((issue) => /similar/i.test(issue.message)), "Review did not flag duplicate answers.");

    const revised = await post("/api/revise", {
      field: fields[2],
      question: fields[2].context,
      currentAnswer: draft.fields[2].answer,
      instruction: "Make this concise, kind, and direct."
    });
    assert(typeof revised.answer === "string" && revised.answer.length > 10, "Revise did not return an answer.");

    const learned = await post("/api/learn-answer", {
      field: fields[2],
      answer: revised.answer,
      originalAnswer: draft.fields[2].answer,
      instruction: "Make this concise, kind, and direct.",
      pageUrl: `${BASE}/mock-grant`
    });
    assert(Array.isArray(learned.learningPreferences), "Learning preferences were not returned.");

    const learningAfter = await getJson("/api/learning");
    assert(learningAfter.events.length >= 1, "Learning event was not saved.");

    const chat = await post("/api/chat", {
      question: "Give me a concise answer about volunteers.",
      fields
    });
    assert(typeof chat.answer === "string" && chat.answer.length > 5, "Chat did not return an answer.");

    const workspace = await post("/api/applications/from-draft", {
      draftId: draft.id,
      funderName: "Verification Foundation",
      applicationName: "Verification Workspace",
      deadline: "2026-12-31",
      notes: "Created by verification."
    });
    assert(workspace.finalAnswers.length === draft.fields.length, "Workspace did not import draft answers.");
    const workspaces = await getJson("/api/applications");
    assert(workspaces.items.some((item) => item.id === workspace.id), "Workspace list did not include imported workspace.");
    const markdown = await (await get(`/api/applications/export?id=${encodeURIComponent(workspace.id)}&format=markdown`)).text();
    assert(markdown.includes("Verification Workspace") && markdown.includes("Final Answers"), "Workspace Markdown export missing expected content.");

    await post("/api/onboard/website", {}, 400);
    const finalStatus = await getJson("/api/status");

    console.log("GrantFlow verification");
    console.log(`Server: ${started ? "started by script" : "already running"}`);
    console.log(`AI provider: ${status.aiProvider || "openai"}`);
    console.log(`AI configured: ${Boolean(status.aiConfigured || status.openaiConfigured)}`);
    console.log(`AI diagnostic: ${finalStatus.aiDiagnostic.provider}/${finalStatus.aiDiagnostic.status}`);
    console.log(`Active organization: ${status.activeOrganization || profile.organization}`);
    console.log(`Draft status: ${draft.status}`);
    console.log(`Revise status: ${revised.status}`);
    console.log(`Chat status: ${chat.status}`);
    console.log(`Review issues tested: ${review.summary.issueCount}`);
    console.log(`Learning events tested: ${learningAfter.events.length}`);
    console.log(`Workspace tested: ${workspace.finalAnswers.length} answers imported`);
    console.log("Result: OK");
  } finally {
    await restoreData(snapshot);
  }
}

main()
  .catch((error) => {
    console.error(`Result: FAILED - ${error.message}`);
    process.exitCode = 1;
  })
  .finally(() => {
    if (server) server.kill();
  });
