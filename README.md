# Grant Flow

Grant Flow is a split-screen grant-writing assistant. There's no browser extension to install: open the web app in one half of your screen, your grant portal in the other, and copy answers across as you go.

**How it's meant to be used:** navigate to Grant Flow, navigate to your grant portal in a second window, put your browser into split screen (see the in-app Split-Screen Guide tab for Windows/Mac steps), and start filling out the application — pulling answers from your Answer Library and Profile with one click to copy.

## What Is Included

- Node + Express local app/API at `http://localhost:3000`
- A dashboard (`public/`) with four views: **Dashboard** (application tracker), **Answer Library** (reusable Q&A with one-click copy + AI drafting), **Profile** (org facts used by every draft), and **Split-Screen Guide** (Windows/Mac setup)
- JSON dev data under `data/`
- OpenAI-backed drafting and chat through the local API
- Clear fallback messages when `OPENAI_API_KEY` is missing
- Lightweight API verification script

The old Chrome extension (`extension/`) has been retired — its DOM-scanning approach relied on injecting into the grant portal's tab, which a plain web app can't do across origins. The dashboard, answer library, and AI drafting logic it depended on lived in `server.js` all along and needed no changes; only the fill mechanism changed, from automatic DOM injection to a one-click copy you paste into the portal yourself.

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

   Without a key, the demo still runs and returns clear fallback answers.

4. Start the app:

   ```bash
   npm start
   ```

5. Open the dashboard:

   [http://localhost:3000](http://localhost:3000)

## Split-Screen Setup

1. Open [http://localhost:3000](http://localhost:3000) in one browser window.
2. Open your grant portal in a second window.
3. Snap the two side by side — the app's **Split-Screen Guide** tab walks through the Windows and Mac shortcuts.
4. Work from the **Answer Library** tab: search or draft an answer, hit **Copy**, and paste it into the portal.

## Demo Flow

1. Open [http://localhost:3000](http://localhost:3000).
2. On the **Dashboard** tab, add an application (funder, deadline, portal link, status) to track it.
3. On the **Answer Library** tab, paste a question from the portal into "Draft a new answer" and click **Draft with AI** — or search your existing saved answers.
4. Click **Copy** on any answer and paste it into the portal field.
5. Save new AI drafts to the library so they're reusable next time the same or a similar question comes up.
6. On the **Profile** tab, keep organization facts (mission, contact, requested-amount language) up to date — every AI draft uses this as its source of truth.

## Editable Data

Everything above is reachable from the in-app tabs (Dashboard, Answer Library, Profile). The underlying files are stored separately:

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

Open [http://localhost:3000/onboarding](http://localhost:3000/onboarding), enter an organization name and public website, then submit. GrantFlow scrapes the homepage and a few relevant same-site pages, asks the configured AI model to extract grant-writing context, creates a new active organization, saves scoped document context and answer examples, and writes a Markdown reference under `data/organizations/`.

If the AI key is missing or the model is unavailable, GrantFlow still creates a scoped organization from the scraped website text and shows a fallback status message.

## Verify The API

Run:

```bash
npm run verify
```

The script checks status, draft generation, and chat. It will report whether OpenAI is configured or fallback mode is active.

For a harsher local pass, run:

```bash
npm run firetest
```

The fire test starts an isolated server with AI keys disabled and checks fallback diagnostics, concurrent draft pressure, and review edge cases.

## Notes

- Grant Flow never touches the grant portal's page directly — it has no way to, and isn't trying to. Every answer is a deliberate copy-and-paste action you control.
- Nothing submits on your behalf. You review and paste each answer yourself.
- AI drafting always has a clear fallback message when no API key is configured, so the app is fully usable without one.
