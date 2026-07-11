# GrantFlow Assistant

GrantFlow Assistant is a functional proof-of-concept for Lucas Align: a browser-native grant-writing copilot that drafts concise application answers from a local knowledge base, editable answer library, simple document context, and detected localhost form fields.

## What Is Included

- Node + Express local app/API at `http://localhost:3000`
- Plain HTML/CSS/JS dashboard and mock grant application
- JSON dev data under `data/`
- Chrome MV3 extension under `extension/`
- OpenAI-backed drafting and chat through the local API
- Clear fallback messages when `OPENAI_API_KEY` is missing
- Lightweight API verification script

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

## Load The Extension

1. Open Chrome.
2. Go to `chrome://extensions`.
3. Enable Developer mode.
4. Choose Load unpacked.
5. Select the `extension/` folder in this project.
6. Pin or click GrantFlow Assistant to open the side panel.

The extension can scan normal `http` and `https` application pages. Chrome still blocks extensions on browser-internal pages such as `chrome://` and some protected store/login surfaces.

## Demo Flow

1. Open [http://localhost:3000/mock-grant](http://localhost:3000/mock-grant).
2. Open the GrantFlow Assistant side panel.
3. Click Draft & Fill.
4. GrantFlow scans supported fields, drafts concise answers, and fills the page without submitting.
5. Review and approve answers directly in the application page.
6. Use Pick & Fill to click or highlight one question, ask Gemini for a revision, and autofill that field.
7. Use Review Application to check the current page answers for repeated answers, missing answers, length issues, unsupported claims, and values-alignment risks.
8. Use Ask GrantFlow for a brief chat answer using the active organization, current scanned form context, and learning memory.
9. View saved draft sessions at [http://localhost:3000/drafts](http://localhost:3000/drafts).

## Editable Demo Data

- Profile and knowledge base: [http://localhost:3000/profile](http://localhost:3000/profile)
- AI organization onboarding: [http://localhost:3000/onboarding](http://localhost:3000/onboarding)
- Answer library: [http://localhost:3000/answers](http://localhost:3000/answers)
- Document context: [http://localhost:3000/documents](http://localhost:3000/documents)
- Application workspaces: [http://localhost:3000/applications](http://localhost:3000/applications)
- Recent draft sessions: [http://localhost:3000/drafts](http://localhost:3000/drafts)

Files are stored separately:

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

The fire test starts an isolated server with AI keys disabled and checks fallback diagnostics, concurrent draft pressure, review edge cases, extension syntax, sensitive-field hardening, and contenteditable support.

## Notes

- The content script scans only normal text inputs and textareas.
- Sensitive-looking fields such as SSN, payment, bank, password, and token fields are skipped.
- The extension never submits forms.
- There are no copy-answer buttons and no per-field approval requirement before filling.
