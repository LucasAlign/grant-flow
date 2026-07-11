# GrantFlow Assistant Handoff

## Project Summary

GrantFlow Assistant is a local proof-of-concept browser-native grant-writing copilot. It runs a Node/Express API and plain HTML/CSS/JS app at `http://localhost:3000`, plus a Chrome MV3 extension in `extension/`.

The extension scans supported text inputs and textareas on normal `http`/`https` application pages, drafts answers using the active organization profile and local knowledge base, fills fields without submitting forms, and supports targeted revisions through Pick & Fill.

## Current User Workflow

1. Start the local server with `npm start`.
2. Load `extension/` as an unpacked Chrome extension.
3. Open a grant application page.
4. Open the GrantFlow side panel.
5. Click `Draft & Fill`.
6. Review answers directly on the application page.
7. Use `Pick & Fill` to click or highlight one question and have Gemini revise and autofill that field.
8. Use `Review` to check the current page answers for issues.

## Setup

Install dependencies:

```bash
npm install
```

Create `.env` from `.env.example` and add the AI key.

Gemini/Gemma example:

```text
AI_PROVIDER=gemini
GEMINI_API_KEY=your_key_here
GEMINI_MODEL=gemma-4-31b-it
PORT=3000
```

OpenAI example:

```text
OPENAI_API_KEY=your_key_here
OPENAI_MODEL=gpt-4o-mini
PORT=3000
```

Run:

```bash
npm start
```

Verify:

```bash
npm run verify
```

Run harsher local edge-case testing:

```bash
npm run firetest
```

## Important Files

- `server.js`: local app/API, data access, AI provider calls, drafting, revision, review, onboarding.
- `public/app.js`: dashboard, onboarding page, profile editor, answer editor, documents, drafts, mock grant.
- `public/styles.css`: local app styling.
- `extension/manifest.json`: MV3 extension configuration and host permissions.
- `extension/content.js`: page scanning, field filling, Pick & Fill page selection.
- `extension/sidepanel.html`: extension side panel markup.
- `extension/sidepanel.js`: extension workflow logic.
- `extension/sidepanel.css`: side panel styling.
- `scripts/verify-api.js`: smoke test for server/API, extension syntax, draft/revise/chat/review/learning.

## Data Files

All dev data is stored under `data/`.

- `data/profile.json`: active organization and organization profiles.
- `data/answers.json`: scoped answer library.
- `data/documents.json`: scoped document/context text.
- `data/drafts.json`: recent draft sessions.
- `data/applications.json`: scoped application/session workspaces with funder, deadline, source URL, notes, status, and final answers.
- `data/learning.json`: organization-specific edit/revision learning memory.
- `data/organizations/*.md`: Markdown reference files for each organization.

Organization scoping is important. Drafting, answer library, document context, and learning memory should stay isolated by `activeOrganizationId`.

## Main API Routes

- `GET /api/status`: app/provider/active-org status plus non-secret last AI diagnostic.
- `GET /api/profile`: active organization plus organization list.
- `PUT /api/profile`: update active organization profile.
- `PUT /api/profile/active`: switch active organization.
- `POST /api/profile/organizations`: add a blank organization.
- `POST /api/onboard/website`: scrape a public website and create a scoped organization.
- `GET /api/answers`, `PUT /api/answers`: scoped answer library.
- `GET /api/documents`, `PUT /api/documents`: scoped document context.
- `GET /api/drafts`: recent draft sessions.
- `GET /api/applications`: scoped application workspaces.
- `POST /api/applications`: create a blank/scaffolded application workspace.
- `PUT /api/applications`: update a scoped application workspace.
- `POST /api/applications/from-draft`: create a workspace from a draft session.
- `GET /api/applications/export?id=...&format=markdown|json`: export a workspace.
- `GET /api/learning`: scoped learning memory.
- `POST /api/learn-answer`: save an edited/reworked answer and update learning memory.
- `POST /api/draft`: draft answers for detected fields.
- `POST /api/revise`: revise one picked/selected question.
- `POST /api/review`: review current field answers for quality issues.
- `POST /api/chat`: Ask GrantFlow chat response.

## Current Features

- Dashboard with active organization dropdown.
- Application workspaces with funder name, deadline, source URL, notes, status, final answers, and Markdown/JSON export.
- Provider diagnostics in `/api/status` showing provider, model, last non-secret AI status, and last non-secret error summary.
- AI organization onboarding from a public website.
- Multiple organizations with scoped profiles, documents, answers, and learning.
- Markdown organization references.
- Mock foundation grant application with broad nonprofit questions and values/culture prompts.
- Chrome extension Draft & Fill workflow.
- Pick & Fill targeted revision workflow.
- Extension skipped-field reporting for sensitive-looking or unsupported fields.
- Contenteditable scanning/filling and native input setters for modern app forms.
- Review Application checks for:
  - missing answers
  - thin answers
  - long answers
  - duplicate/similar answers
  - unsupported strong claims or exact numbers
  - wrong-organization leakage
  - values-alignment risks
  - weak budget/outcomes/values answers
  - field character limits
- Draft intent detection, such as mission, outcomes, budget, values/culture, volunteers, reporting, stewardship, etc.
- Duplicate-answer guard so two narrative fields are not answered identically.
- Gemini retry fallback when strict JSON mode hiccups.
- Fire test script for fallback diagnostics, review pressure cases, concurrent drafts, extension hardening checks, and malformed onboarding validation.

## Extension Notes

The side panel is intentionally streamlined.

- `Draft & Fill`: scans, drafts, fills all supported fields, and does not submit.
- `Review`: reads current page values first, then reviews what is actually in the form.
- `Pick & Fill`: click or highlight one question; the extension finds the nearest field, calls `/api/revise`, saves learning memory, and fills that field.
- `Ask`: short chat answer using active organization, current context, and learning memory.

The content script skips sensitive-looking fields by name/id/placeholder/autocomplete/label, including SSN, payment, bank, password, token, CVV/CVC, DOB, medical, salary, race, passport, file upload, and confidential fields. The side panel reports how many fields were skipped.

## Known Caveats

- The extension can access normal `http` and `https` pages, but Chrome blocks browser-internal pages and some protected sites.
- Pick & Fill uses nearest-field matching. It works best on forms where question text and the textarea/input are in the same visible section.
- Website onboarding is a lightweight scraper. It pulls a homepage and a few likely relevant same-host pages; it is not a full crawler.
- AI output can still be imperfect. Review Application is meant to catch common issues before submission.
- The verification script intentionally snapshots and restores JSON data around mutating tests, but existing dev data may already contain draft/learning history from manual testing.
- `.env` contains local secrets and should never be committed.

## Recommended Next Improvements

- Add PDF export for completed application answers.
- Improve Pick & Fill matching with a prebuilt question-to-field map from the scan.
- Add visible answer length controls: short, standard, detailed, character limit.
- Add organization-specific `do not say` and required-phrase guardrails.
- Add source-backed facts for onboarded organizations with URLs and confidence.
- Add a small UI to inspect and edit `data/learning.json` preferences.

## Verification Checklist

Run before handoff:

```bash
npm run verify
npm run firetest
```

Then manually reload the unpacked Chrome extension and smoke test:

1. Open a grant form page.
2. Click `Draft & Fill`.
3. Confirm fields fill and the form is not submitted.
4. Edit one answer on the page.
5. Click `Review` and confirm it reads the current page value.
6. Click `Pick & Fill`, select one question, and confirm the field is revised/refilled.
