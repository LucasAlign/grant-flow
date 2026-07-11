const { spawn } = require("child_process");
const fs = require("fs/promises");
const path = require("path");

const PORT = 3107;
const BASE = `http://localhost:${PORT}`;
const dataFiles = ["answers.json", "applications.json", "documents.json", "drafts.json", "learning.json", "profile.json"];
let server;
let serverOutput = "";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function waitForServer() {
  for (let i = 0; i < 30; i += 1) {
    try {
      const response = await fetch(`${BASE}/api/status`);
      if (response.ok) return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  }
  throw new Error(`Server did not start at ${BASE}`);
}

async function startServer() {
  server = spawn(process.execPath, ["server.js"], {
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      PORT: String(PORT),
      AI_PROVIDER: "openai",
      OPENAI_API_KEY: "",
      GEMINI_API_KEY: ""
    }
  });
  server.stdout.on("data", (chunk) => {
    serverOutput += chunk.toString();
  });
  server.stderr.on("data", (chunk) => {
    serverOutput += chunk.toString();
  });
  await waitForServer();
}

async function getJson(pathname) {
  const response = await fetch(`${BASE}${pathname}`);
  if (!response.ok) throw new Error(`${pathname}: ${response.status} ${response.statusText}`);
  return response.json();
}

async function postJson(pathname, body, expectedStatus = 200) {
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

async function verifyExtensionHardening() {
  for (const file of ["extension/content.js", "extension/sidepanel.js", "extension/background.js"]) {
    await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, ["--check", file], { stdio: "ignore" });
      child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`${file} syntax check failed`))));
      child.on("error", reject);
    });
  }
  const content = await fs.readFile("extension/content.js", "utf8");
  for (const term of ["birth", "salary", "medical", "passport", "contenteditable", "HTMLInputElement.prototype"]) {
    assert(content.includes(term), `Content script hardening is missing ${term}.`);
  }
}

function field(index, overrides = {}) {
  return {
    key: `#fire-${index}`,
    id: `fire-${index}`,
    name: `fire-${index}`,
    type: "textarea",
    label: `Fire Test Narrative ${index}`,
    context: `Fire Test Narrative ${index} Explain the work with a distinct answer.`,
    ...overrides
  };
}

async function verifyDraftPressure() {
  const fields = Array.from({ length: 40 }, (_, index) => field(index + 1));
  const draft = await postJson("/api/draft", { fields, pageUrl: `${BASE}/mock-grant?fire=40` });
  assert(draft.fields.length === 40, "Draft did not return all 40 fields.");
  assert(draft.status.includes("fallback"), "Fire test expected fallback status with AI keys disabled.");
  assert(draft.fields.every((item) => typeof item.intent === "string"), "Draft fields are missing intents.");

  const concurrent = await Promise.all([
    postJson("/api/draft", { fields: fields.slice(0, 5), pageUrl: `${BASE}/mock-grant?fire=a` }),
    postJson("/api/draft", { fields: fields.slice(5, 10), pageUrl: `${BASE}/mock-grant?fire=b` }),
    postJson("/api/draft", { fields: fields.slice(10, 15), pageUrl: `${BASE}/mock-grant?fire=c` })
  ]);
  assert(concurrent.every((session) => session.fields.length === 5), "Concurrent draft sessions did not complete cleanly.");
}

async function verifyReviewFindsUglyCases() {
  const review = await postJson("/api/review", {
    pageUrl: `${BASE}/mock-grant?fire=review`,
    fields: [
      field(1, { answer: "" }),
      field(2, { label: "Budget", context: "Budget How will funds be used?", answer: "We care about the community.", intent: "budget" }),
      field(3, { label: "Outcomes", context: "Outcomes What will change?", answer: "We guarantee 100% success for 500 families.", intent: "outcomes" }),
      field(4, { label: "Short limit", maxLength: 10, answer: "This answer is intentionally far too long for the configured field limit." }),
      field(5, { label: "Duplicate A", answer: "We guide the work with clarity, care, and responsible stewardship." }),
      field(6, { label: "Duplicate B", answer: "We guide the work with clarity, care, and responsible stewardship." }),
      field(7, { label: "Organization leakage", answer: "Trail Life and Lucas Align will deliver this work together." })
    ]
  });
  assert(review.summary.issueCount >= 6, "Review did not flag enough intentional issues.");
  assert(review.issues.some((issue) => /Missing answer/i.test(issue.message)), "Review missed a missing answer.");
  assert(review.issues.some((issue) => /field limit/i.test(issue.message)), "Review missed maxLength overflow.");
  assert(review.issues.some((issue) => /exact numbers|strong claim/i.test(issue.message)), "Review missed unsupported claim risk.");
  assert(review.issues.some((issue) => /similar/i.test(issue.message)), "Review missed duplicate answers.");
}

async function verifyWorkspaceFlow() {
  const created = await postJson("/api/applications", {
    funderName: "Fire Test Foundation",
    applicationName: "Fire Test Workspace",
    deadline: "2026-10-01",
    sourceUrl: "https://example.org/grants",
    notes: "Pressure test workspace.",
    finalAnswers: [
      field(1, { label: "Mission", answer: "We serve the community with clarity and care." })
    ]
  });
  assert(created.id && created.finalAnswers.length === 1, "Workspace create failed.");
  const updated = await fetch(`${BASE}/api/applications`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...created,
      status: "review",
      notes: "Updated during fire test."
    })
  }).then((response) => response.json());
  assert(updated.status === "review", "Workspace update failed.");
  const markdown = await fetch(`${BASE}/api/applications/export?id=${encodeURIComponent(created.id)}&format=markdown`).then((response) => response.text());
  assert(markdown.includes("Fire Test Workspace") && markdown.includes("Final Answers"), "Workspace markdown export failed.");
}

async function main() {
  await startServer();
  const snapshot = await snapshotData();
  try {
    await verifyExtensionHardening();
    const initialStatus = await getJson("/api/status");
    assert(initialStatus.aiConfigured === false, "Fire test server should run with AI disabled.");

    await verifyDraftPressure();
    const statusAfterDraft = await getJson("/api/status");
    assert(statusAfterDraft.aiDiagnostic?.status === "missing_key", "AI diagnostic did not expose missing-key fallback.");
    assert(!/key=/i.test(JSON.stringify(statusAfterDraft.aiDiagnostic)), "AI diagnostic appears to expose secret-like material.");

    await verifyReviewFindsUglyCases();
    await verifyWorkspaceFlow();
    await postJson("/api/onboard/website", {}, 400);

    console.log("GrantFlow fire test");
    console.log(`Server: isolated on ${BASE}`);
    console.log(`AI diagnostic: ${statusAfterDraft.aiDiagnostic.provider}/${statusAfterDraft.aiDiagnostic.status}`);
    console.log("Draft pressure: 40 fields plus concurrent draft sessions");
    console.log("Review pressure: missing, duplicate, length, claim, and budget issues");
    console.log("Workspace pressure: create, update, and Markdown export");
    console.log("Extension hardening: syntax, sensitive-field terms, contenteditable, native setter");
    console.log("Result: OK");
  } finally {
    await restoreData(snapshot);
    if (server) server.kill();
  }
}

main().catch((error) => {
  if (server) server.kill();
  console.error(`Result: FAILED - ${error.message}`);
  if (serverOutput.trim()) {
    console.error("Server output:");
    console.error(serverOutput.trim().slice(-2000));
  }
  process.exitCode = 1;
});
