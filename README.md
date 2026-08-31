# Grant Flow

Grant Flow is a split-screen grant-writing assistant. There's no browser extension to install: open the web app in one half of your screen, your grant portal in the other, and copy answers across as you go.

**How it's meant to be used:** open Grant Flow, open your grant portal in a second window, put your browser into split screen (see the in-app **Help & split screen** tab for Windows/Mac steps), and work an application — drafting, reviewing, and copying answers into the portal one click at a time.

## What Is Included

- Node + Express local app/API at `http://localhost:3000`
- A single-page app (`public/`) with a guided **Setup** flow (`/onboarding`) plus four views: **Dashboard** (application tracker + setup checklist), **Grant answers** (reusable Q&A with one-click copy + AI drafting, scoped to the application you're working on), **Organization profile** (org facts used by every draft), and **Help & split screen**
- JSON dev data under `data/`
- OpenAI-backed drafting and chat through the local API
- A safe unavailable state — with no AI key, Grant Flow never invents an answer; it tells you AI drafting is off and points you to write manually or reuse a saved answer
- Verification and fire-test scripts that both pass with AI keys disabled

The old Chrome extension has been retired — its DOM-scanning approach relied on injecting into the grant portal's tab, which a plain web app can't do across origins. Only the fill mechanism changed, from automatic DOM injection to a one-click copy you paste into the portal yourself. Grant Flow never submits to or modifies the funder's portal.

## Setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Create `.env` from the example:

   ```bash
   copy .env.example .env
   ```

3. Add your AI key in `.env`.

   For Gemma/Gemini:

   ```text
   AI_PROVIDER=gemini
   GEMINI_API_KEY=your_key_here
   GEMINI_MODEL=gemma-4-31b-it
   PORT=3000
   ```

   For OpenAI:

   ```text
   OPENAI_API_KEY=your_key_here
   OPENAI_MODEL=gpt-4o-mini
   PORT=3000
   ```

   Without a key, the app still runs. AI drafting is disabled and clearly labeled — Grant Flow never fabricates an answer — and everything else (tracking, manual answers, review, copy) works fully.

4. Start the app:

   ```bash
   npm start
   ```

5. Open the app:

   [http://localhost:3000](http://localhost:3000) — or start with the guided setup at [http://localhost:3000/onboarding](http://localhost:3000/onboarding).

## First-Time Setup

Open [http://localhost:3000/onboarding](http://localhost:3000/onboarding). The guided flow walks through three steps:

1. **Organization** — choose an existing organization, create a blank one, or import from a public website.
2. **Review profile** — imported website content lands in a *Needs review* state; rewrite the mission and one-line summary in your own words before they influence any draft. Grant Flow flags raw scraped/navigation text so it is never presented as a fact.
3. **First application** — add the grant you're working on, then jump straight into answering its questions.

The Dashboard shows a setup checklist until every step is done.

## Split-Screen Setup

1. Open [http://localhost:3000](http://localhost:3000) in one browser window.
2. Open your grant portal in a second window.
3. Snap the two side by side — the app's **Help & split screen** tab walks through the Windows and Mac shortcuts.
4. Work from the **Grant answers** tab: search or draft an answer, hit **Copy**, and paste it into the portal.

## Daily Flow

1. On the **Dashboard**, add or open an application (funder, deadline, portal link, status).
2. Click **Work on this application** to open **Grant answers** with that application's name, funder, deadline/status, and portal link in view.
3. Paste a question into "Draft a new answer" and click **Draft with AI** (when a key is configured). AI output is labeled a draft, editable before you copy or save, and marked *Review before copying* — or write it manually / reuse a saved answer.
4. Click **Copy** on any answer and paste it into the portal field yourself.
5. Save answers so they're reusable next time; each answer shows whether it's **Manual**, **AI-generated**, or **Saved/Imported**.
6. On the **Organization profile** tab, keep organization facts up to date — every AI draft uses this as its source of truth. Quality warnings appear when core fields are empty or look scraped.

## Editable Data

Everything above is reachable from the in-app tabs (Dashboard, Grant answers, Organization profile) and the guided Setup flow. The underlying files are stored separately:

- `data/profile.json`
- `data/answers.json`
- `data/documents.json`
- `data/drafts.json`
- `data/applications.json`
- `data/learning.json`
- Organization Markdown references are stored under `data/organizations/`.

GrantFlow drafts against the active organization only. The selected organization's mission, values, faith commitments, audience, eligibility standards, program model, answer principles, document context, and saved answer examples are treated as boundaries for drafting. Context and learned answers are scoped by organization to avoid mixing language between clients.

GrantFlow also stores organization-specific learning memory in `data/learning.json`. Manual edits and reworked answers save the original answer, final answer, question context, instruction, page URL, and inferred style preferences. Future drafts, revisions, and chat responses use similar past answers and preferences for that organization only.

Application workspaces in `data/applications.json` are also scoped by active organization. A workspace tracks funder name, application name, deadline, source URL, notes, status, and final answers. Workspaces can be created manually or imported from the latest draft session, then exported as Markdown or JSON.

## AI Organization Onboarding

From the Setup flow's **import from a website** option (or `POST /api/onboard/website`), enter an organization name and public website. GrantFlow scrapes the homepage and a few relevant same-site pages, asks the configured AI model to extract grant-writing context, creates a new active organization, saves scoped document context and answer examples, and writes a Markdown reference under `data/organizations/`.

Imported organizations start in a **Needs review** state. Raw scraped/navigation text is never written into the mission or summary as if it were a fact — those human-facing fields start blank (or are cleared if they still read as scraped) so you review and write them yourself. Imported context and answer examples remain quarantined from drafting until you explicitly approve a complete mission and summary. If the AI key is missing or the model is unavailable, GrantFlow still creates the scoped organization with safe blanks and a review prompt rather than copying raw page text in.

## Verify The API

Run:

```bash
npm run verify
```

The script syntax-checks the server and browser JS, confirms every route serves the app shell (including `/onboarding`), exercises draft/review/workspace/export, and confirms the missing-AI safe contract on `/api/chat`. It runs with AI keys disabled and prints `Result: OK`.

For a harsher local pass, run:

```bash
npm run firetest
```

The fire test starts an isolated server with AI keys disabled and checks the missing-AI safety contract, fallback diagnostics, concurrent draft pressure, review edge cases, workspace CRUD/export, and organization scoping.

For a real-browser accessibility and narrow split-screen check, run:

```bash
npm run browsercheck
```

This launches an installed Chrome or Edge browser, verifies accessible names on the dashboard, application dialog, and onboarding, then checks the dashboard and onboarding at 420px for horizontal overflow and usable navigation. Set `CHROME_PATH` or `EDGE_PATH` if the browser is installed in a nonstandard location.

## Notes

- Grant Flow never touches the grant portal's page directly — it has no way to, and isn't trying to. Every answer is a deliberate copy-and-paste action you control.
- Nothing submits on your behalf. You review and paste each answer yourself.
- With no API key, AI drafting is disabled and clearly labeled — Grant Flow never presents an invented answer. The rest of the app is fully usable.
