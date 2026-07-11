# GrantFlow Assistant Replit Handoff

## Project

GrantFlow Assistant is a Node/Express proof-of-concept for Lucas Align: a browser-native grant-writing copilot that drafts grant application answers from local organization data, saved answer examples, document context, learning memory, and scanned form fields.

It includes:

- Express API and web app in `server.js`
- Plain HTML/CSS/JS dashboard in `public/`
- Chrome MV3 extension in `extension/`
- JSON-backed local data in `data/`
- Verification scripts in `scripts/`

## Replit Goal

Get the app running reliably in Replit, verify the API, and preserve the current local/demo behavior.

Do not rewrite the app unless required. Prefer small compatibility fixes.

## Install

```bash
npm install
```

## Environment

Use Replit Secrets, not committed files, for keys.

Required only for live AI drafting:

```text
OPENAI_API_KEY=...
OPENAI_MODEL=gpt-4o-mini
```

Optional Gemini mode:

```text
AI_PROVIDER=gemini
GEMINI_API_KEY=...
GEMINI_MODEL=gemma-4-31b-it
```

The app can run without keys and will return fallback/demo answers.

`server.js` already uses:

```js
const PORT = process.env.PORT || 3000;
```

So it should work with Replit's assigned port.

## Start

```bash
npm start
```

Expected console output:

```text
GrantFlow Assistant running at http://localhost:<port>
```

Open the Replit web preview.

Useful routes:

- `/`
- `/mock-grant`
- `/profile`
- `/answers`
- `/documents`
- `/applications`
- `/drafts`
- `/onboarding`
- `/api/status`

## Verify

Run:

```bash
npm run verify
npm run firetest
```

Expected:

- `npm run verify` checks app routes, API status, draft generation, revise/chat/review behavior, JSON data, and extension syntax.
- `npm run firetest` starts an isolated server with AI keys disabled and checks fallback behavior, concurrent drafts, review edge cases, workspace export, and extension hardening.

## Important Files

- `server.js`
  - Express app/API
  - Data access
  - AI provider calls
  - Website onboarding
  - Draft/revise/review/chat endpoints

- `public/app.js`
  - Dashboard pages
  - Profile editor
  - Answer library
  - Documents/context page
  - Application workspaces
  - Draft history
  - Mock grant app

- `public/styles.css`
  - App styling

- `extension/`
  - Chrome MV3 side panel extension
  - `sidepanel.js` controls Draft & Fill, Review, Pick & Fill, Ask
  - `content.js` scans/fills grant form fields
  - `manifest.json` contains permissions

- `data/`
  - JSON local persistence
  - Organization Markdown references

- `scripts/verify-api.js`
  - Main smoke test

- `scripts/firetest.js`
  - Harsher fallback/edge-case test

## Main API Routes

- `GET /api/status`
- `GET /api/profile`
- `PUT /api/profile`
- `PUT /api/profile/active`
- `POST /api/profile/organizations`
- `POST /api/onboard/website`
- `GET /api/answers`
- `PUT /api/answers`
- `GET /api/documents`
- `PUT /api/documents`
- `GET /api/drafts`
- `GET /api/applications`
- `POST /api/applications`
- `PUT /api/applications`
- `POST /api/applications/from-draft`
- `GET /api/applications/export?id=...&format=markdown|json`
- `GET /api/learning`
- `POST /api/learn-answer`
- `POST /api/draft`
- `POST /api/review`
- `POST /api/revise`
- `POST /api/chat`

## Data Model Notes

All dev data is stored in `data/`.

Key files:

- `profile.json`
- `answers.json`
- `documents.json`
- `drafts.json`
- `applications.json`
- `learning.json`
- `organizations/*.md`

Organization scoping matters. Drafts, answers, documents, learning memory, and application workspaces should stay isolated by the active organization.

Do not mix language or data between organizations.

## Replit-Specific Caveats

### 1. Chrome Extension API Base

`extension/sidepanel.js` currently has:

```js
const API_BASE = "http://localhost:3000";
```

That works for local desktop use.

If testing the Chrome extension against a Replit-hosted backend, this must be changed to the Replit app URL, for example:

```js
const API_BASE = "https://your-repl-name.your-user.replit.app";
```

Better long-term fix: make the API base configurable from extension storage or an options page.

### 2. Browser Extension Cannot Run Inside Replit Preview

The web app and API can run in Replit.

The Chrome extension still needs to be loaded in a real Chrome browser via:

1. `chrome://extensions`
2. Developer mode
3. Load unpacked
4. Select the `extension/` folder

### 3. Local JSON Persistence

The app writes to `data/*.json`.

That is fine for a Replit prototype, but it is not production-grade persistence. If this needs real deployment, replace JSON files with a database.

## Current Features

- Active organization selector
- Organization profile editor
- Scoped answer library
- Scoped document/context editor
- Application workspaces
- Draft session history
- Markdown/JSON workspace export
- Website onboarding from public URLs
- AI drafting with OpenAI or Gemini
- Fallback drafting when no AI key is configured
- Chrome extension Draft & Fill
- Chrome extension Pick & Fill
- Chrome extension Review Application
- Chrome extension Ask GrantFlow chat
- Sensitive-field skipping
- Contenteditable support
- Duplicate answer guard
- Review checks for missing, thin, long, duplicate, unsupported, or wrong-org answers

## Suggested First Task In Replit

1. Run `npm install`.
2. Run `npm start`.
3. Open `/api/status`.
4. Run `npm run verify`.
5. Run `npm run firetest`.
6. If either test fails, fix only the compatibility issue.
7. Confirm `/mock-grant` works in the Replit preview.
8. Confirm `/api/draft` returns fallback answers without a key.
9. Add AI key through Replit Secrets and confirm `/api/status` shows `aiConfigured: true`.

## Acceptance Criteria

The Replit migration is successful when:

- `npm install` completes.
- `npm start` launches the server.
- Replit preview opens the dashboard.
- `/api/status` returns JSON.
- `/mock-grant` loads.
- `npm run verify` passes.
- `npm run firetest` passes.
- No secrets are committed.
- Existing `data/` JSON remains valid.
- The app still works without AI keys in fallback mode.

## Do Not Do Yet

Avoid these unless explicitly asked:

- Do not convert the frontend to React.
- Do not replace Express.
- Do not remove the Chrome extension.
- Do not commit API keys.
- Do not merge all JSON files into one file.
- Do not change organization scoping behavior.
- Do not make broad visual redesigns before the app is stable in Replit.
