const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const { chromium } = require("playwright-core");

const PORT = Number(process.env.BROWSER_CHECK_PORT || 3110);
const BASE = `http://localhost:${PORT}`;
let server;
let browser;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function browserCandidates() {
  const values = [
    process.env.CHROME_PATH,
    process.env.EDGE_PATH,
    process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, "Microsoft", "Edge", "Application", "msedge.exe"),
    process.env["PROGRAMFILES(X86)"] && path.join(process.env["PROGRAMFILES(X86)"], "Microsoft", "Edge", "Application", "msedge.exe"),
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "Microsoft", "Edge", "Application", "msedge.exe"),
    process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, "Google", "Chrome", "Application", "chrome.exe"),
    process.env["PROGRAMFILES(X86)"] && path.join(process.env["PROGRAMFILES(X86)"], "Google", "Chrome", "Application", "chrome.exe"),
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, "Google", "Chrome", "Application", "chrome.exe"),
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/microsoft-edge",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser"
  ];
  return values.filter(Boolean);
}

function findBrowser() {
  const executable = browserCandidates().find((candidate) => fs.existsSync(candidate));
  if (!executable) {
    throw new Error("No installed Chrome or Edge browser found. Set CHROME_PATH or EDGE_PATH to run browsercheck.");
  }
  return executable;
}

async function waitForServer() {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      const response = await fetch(`${BASE}/api/status`);
      if (response.ok) return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  throw new Error(`Server did not start at ${BASE}`);
}

async function assertAccessibleControls(page, location) {
  const unnamed = await page.locator("button, a[href], input, textarea, select").evaluateAll((elements) => elements
    .filter((element) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.visibility !== "hidden" && style.display !== "none" && rect.width > 0 && rect.height > 0;
    })
    .filter((element) => {
      const labelledBy = element.getAttribute("aria-labelledby");
      const labelledText = labelledBy
        ? labelledBy.split(/\s+/).map((id) => document.getElementById(id)?.textContent || "").join(" ")
        : "";
      const associatedLabel = element.id ? document.querySelector(`label[for="${CSS.escape(element.id)}"]`)?.textContent : "";
      const wrappedLabel = element.closest("label")?.textContent || "";
      const name = element.getAttribute("aria-label")
        || labelledText
        || associatedLabel
        || wrappedLabel
        || ((element.tagName === "BUTTON" || element.tagName === "A") ? element.textContent : "")
        || element.getAttribute("title")
        || "";
      return !name.trim();
    })
    .map((element) => `<${element.tagName.toLowerCase()} id="${element.id}" class="${element.className}">`));
  assert(unnamed.length === 0, `${location} has controls without accessible names: ${unnamed.join(", ")}`);
}

async function assertNarrowLayout(page, location) {
  await page.setViewportSize({ width: 420, height: 820 });
  await page.goto(`${BASE}${location}`);
  await page.waitForLoadState("domcontentloaded");
  await page.locator("h1").waitFor({ state: "visible" });
  const layout = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    documentWidth: document.documentElement.scrollWidth,
    bodyWidth: document.body.scrollWidth
  }));
  assert(layout.documentWidth <= layout.viewport + 1, `${location} overflows the 420px viewport (${layout.documentWidth}px document).`);
  assert(layout.bodyWidth <= layout.viewport + 1, `${location} body overflows the 420px viewport (${layout.bodyWidth}px body).`);
  const navigation = page.getByRole("button", { name: "Grant answers" });
  assert(await navigation.isVisible(), `${location} hides primary navigation at 420px.`);
  const box = await navigation.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return { width: rect.width, height: rect.height };
  });
  assert(box.width >= 32 && box.height >= 32, `${location} navigation target is too small at 420px.`);
  await assertAccessibleControls(page, `${location} at 420px`);
}

async function main() {
  server = spawn(process.execPath, ["server.js"], {
    stdio: "ignore",
    env: { ...process.env, PORT: String(PORT), OPENAI_API_KEY: "", GEMINI_API_KEY: "" }
  });
  await waitForServer();
  browser = await chromium.launch({ executablePath: findBrowser(), headless: true });
  const page = await browser.newPage({ viewport: { width: 1100, height: 850 } });

  await page.goto(BASE);
  await page.locator("h1").waitFor({ state: "visible" });
  await assertAccessibleControls(page, "Dashboard");

  await page.getByRole("button", { name: /New application|Add your first application/ }).first().click();
  await page.getByRole("dialog").waitFor({ state: "visible" });
  await assertAccessibleControls(page, "New application dialog");
  await page.getByRole("button", { name: "Cancel" }).click();

  await page.goto(`${BASE}/onboarding`);
  await page.getByRole("heading", { name: "Set up Grant Flow" }).waitFor({ state: "visible" });
  await assertAccessibleControls(page, "Onboarding");

  await assertNarrowLayout(page, "/");
  await assertNarrowLayout(page, "/onboarding");

  console.log("GrantFlow browser check");
  console.log(`Browser: ${findBrowser()}`);
  console.log("Accessibility: visible controls named on dashboard, application dialog, and onboarding");
  console.log("Narrow layout: dashboard and onboarding fit 420px without horizontal overflow");
  console.log("Result: OK");
}

main()
  .catch((error) => {
    console.error(`Result: FAILED - ${error.message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (browser) await browser.close();
    if (server) server.kill();
  });
