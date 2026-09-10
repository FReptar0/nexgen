# Codebase Structure

**Analysis Date:** 2026-09-10

## Directory Layout

```
nexgen/
├── index.js                    # Entry point — DI composition root, runs one command
├── package.json                # 3 runtime deps, no build step, no real test script
├── package-lock.json
├── .gitignore
├── CLAUDE.md                   # Persistent instructions for Claude Code sessions
├── ARCHITECTURE.md             # Repo-root engineer-facing architecture doc (predates GSD)
├── HANDOFF.md                  # Owner-to-owner transfer brief (Spanish)
├── RUNBOOK.md                  # Operational procedures (Spanish)
├── README.md                   # Setup + usage
├── env                         # Stray file at repo root — see "Key File Locations"
├── src/
│   ├── cli/
│   │   └── taxCommandHandler.js       # Argv parsing, command lifecycle orchestration
│   ├── validators/
│   │   └── taxValidator.js            # Committed-field rules, string sanitization
│   ├── api/
│   │   └── taxApiClient.js            # axios HTTP client (STCCalcV3 / CancelTransaction)
│   ├── storage/
│   │   └── fileManager.js             # JSON file I/O, RESPONSE_ naming
│   ├── infrastructure/
│   │   └── logger.js                  # winston, error-only, daily file rotation
│   └── config/
│       └── index.js                   # dotenv load + validation, endpoint resolution (singleton)
├── docs/
│   └── MEMORY.md               # Historical decisions (D1-D9), conventions (C1-C6) — Spanish
├── .claude/
│   ├── agents/                 # Custom subagents (nexgen-explorer, tax-validator-helper)
│   ├── commands/                # Slash commands (/tax-quote, /tax-commit, /tax-cancel)
│   └── settings.json             # Tool permission allow/deny list
├── .planning/
│   └── codebase/                # GSD codebase maps — this document's home
├── postman/                    # Untracked — manual API-testing collections/environments
├── data/                       # Local-only (git-excluded) — raw meeting notes, reference PDFs
├── node_modules/               # npm-installed dependencies (gitignored)
└── logs/                       # Runtime-generated, gitignored — absent until first run
```

Confirmed via `git ls-files` (tracked set): `.claude/**`, `.gitignore`,
`ARCHITECTURE.md`, `CLAUDE.md`, `HANDOFF.md`, `README.md`, `RUNBOOK.md`,
`docs/MEMORY.md`, `index.js`, `package.json`, `package-lock.json`, and
all six files under `src/`. Everything else listed above (`postman/`,
`env`, `data/`, `node_modules/`, `logs/`, `.planning/`) is untracked,
gitignored, or excluded via `.git/info/exclude`.

## Directory Purposes

**`src/cli/`:**
- Purpose: user-facing command orchestration layer
- Contains: one class (`TaxCommandHandler`) — argv parsing, step
  sequencing, response persistence, centralized error logging
- Key files: `src/cli/taxCommandHandler.js`

**`src/validators/`:**
- Purpose: business-rule enforcement before any network call
- Contains: one class (`TaxValidator`) — operation whitelist,
  `Committed` semantics, recursive string sanitization
- Key files: `src/validators/taxValidator.js`

**`src/api/`:**
- Purpose: the only place HTTP is spoken in this codebase
- Contains: one class (`TaxApiClient`) — axios request construction,
  response/error classification
- Key files: `src/api/taxApiClient.js`

**`src/storage/`:**
- Purpose: the only place the filesystem is touched in this codebase
- Contains: one class (`FileManager`) — JSON read/write, directory
  creation, response filename convention
- Key files: `src/storage/fileManager.js`

**`src/infrastructure/`:**
- Purpose: cross-cutting logging service
- Contains: one class (`Logger`) wrapping a single `winston` instance
- Key files: `src/infrastructure/logger.js`

**`src/config/`:**
- Purpose: centralize environment variable access and endpoint URL
  resolution
- Contains: one class (`Config`), exported pre-constructed as a
  singleton
- Key files: `src/config/index.js`

**`.claude/`:**
- Purpose: Claude Code project configuration — committed and versioned
- Contains: two custom subagents (read-only tracer, validator-editing
  helper) and three slash commands (`tax-quote`, `tax-commit`,
  `tax-cancel`), plus the permission `settings.json`
- Key files: `.claude/agents/nexgen-explorer.md`,
  `.claude/agents/tax-validator-helper.md`,
  `.claude/commands/tax-quote.md`, `.claude/commands/tax-commit.md`,
  `.claude/commands/tax-cancel.md`, `.claude/settings.json`

**`docs/`:**
- Purpose: historical/decision record, separate from the operational
  handoff docs at repo root
- Contains: `MEMORY.md` only — decisions D1-D9 (layering, `TEST_MODE`,
  sanitization, logger level, etc.) and conventions C1-C6
- Key files: `docs/MEMORY.md`

**`.planning/codebase/`:**
- Purpose: GSD-generated, machine-maintained codebase reference docs
  consumed by `/gsd-plan-phase` and `/gsd-execute-phase`
- Contains: this file and its sibling architecture/stack/etc. docs
- Key files: `.planning/codebase/ARCHITECTURE.md`,
  `.planning/codebase/STRUCTURE.md`

## Key File Locations

**Entry Points:**
- `index.js`: process entry point; builds the DI graph, runs one
  command, sole `process.exit(1)` boundary.

**Configuration:**
- `src/config/index.js`: loads `.env` from the repo root
  (`path.resolve(__dirname, '../../.env')`, line 3), validates
  `BASE_URL`/`API_CODE`/`OUTPUT_DIR`, resolves endpoint URLs, exported
  as a singleton.
- `env` (repo root, **no leading dot**): present in the working tree,
  but this filename does not match the `.env` path
  `dotenv.config()` resolves in `src/config/index.js:3` — it is not
  automatically loaded by `Config`. `.gitignore` documents it as a
  stray file that carries `API_CODE` (comment: "apareció suelta...
  reunión 9-sep-2026"). Existence noted only — contents were not read
  (forbidden: contains a credential).
- `.claude/settings.json`: tool permission allow/deny list for Claude
  Code sessions in this repo (denies reading `.env*`, `logs/**`,
  `results/**`, `test-files/**`, among other destructive-command
  guards).

**Core Logic:**
- `src/cli/taxCommandHandler.js`: command lifecycle orchestration.
- `src/validators/taxValidator.js`: business rule enforcement.
- `src/api/taxApiClient.js`: external HTTP integration.
- `src/storage/fileManager.js`: filesystem I/O.

**Testing:**
- None exist. No test files, no test directories, no test runner
  configured. `package.json`'s `"test"` script is the npm default
  placeholder (`echo "Error: no test specified" && exit 1`).

## Naming Conventions

**Files:**
- Source files: English camelCase matching the class they export
  (`taxApiClient.js` → `TaxApiClient`, `fileManager.js` →
  `FileManager`, `taxCommandHandler.js` → `TaxCommandHandler`,
  `taxValidator.js` → `TaxValidator`).
- Module entry points use `index.js` (repo root and `src/config/`).
- Response files: `RESPONSE_<original-basename>` — fixed prefix,
  original extension preserved, no timestamp
  (`FileManager.getResponseFileName`,
  `src/storage/fileManager.js:163-166`).
- Log files: `log_<YYYY-MM-DD>.log`
  (`src/infrastructure/logger.js:44-47`).

**Directories:**
- One directory per architectural layer under `src/`, named as a
  lowercase singular noun or acronym: `cli`, `api`, `storage`,
  `infrastructure`, `config` — except `validators`, which is plural.
- One file per layer today. Per `docs/MEMORY.md` C2: if a layer grows,
  split it into submodules **inside its own folder** before creating a
  new top-level layer.

**Classes:**
- PascalCase, one class per file, matching the file's primary export:
  `TaxCommandHandler`, `TaxValidator`, `TaxApiClient`, `FileManager`,
  `Logger`, `Config`.

**Methods and variables:**
- English camelCase throughout: `getEndpointUrl`, `requestBody`,
  `sanitizeStringFields`, `parseArguments`.
- Private/internal methods are prefixed with `_` and marked `@private`
  in JSDoc: `_handleResponse`, `_handleError`, `_saveResponse`,
  `_ensureLogDir`, `_createLogger`, `_validateRequiredEnvVars`,
  `_listSimilarFiles`, `_handleFileReadError`.

**Language split (see `CLAUDE.md` and `docs/MEMORY.md` C1):**
- Class/method/variable/file names: English.
- JSDoc comments and user-facing error/log messages: Spanish.

## Where to Add New Code

**New tax operation (e.g., a 4th operation beyond get/post/cancel):**
- `src/validators/taxValidator.js`: add to `validOperations`
  (line 15) and, if applicable, a branch in `validateCommittedField`
  (lines 38-55).
- `src/config/index.js`: add a URL branch in `getEndpointUrl`
  (lines 65-79).
- `src/api/taxApiClient.js`: optionally add a thin wrapper method
  alongside `getTax`/`postTax`/`cancelTax` (lines 148-168).
- No changes needed in `index.js` or `TaxCommandHandler` — both are
  already operation-agnostic.
- Tests: none exist yet; no test directory convention is established
  in this codebase (the repo-root `ARCHITECTURE.md` §10 proposes
  `src/<layer>/__tests__/` but it is unused).

**New layer/module:**
- Create a new directory under `src/`, named as a lowercase singular
  noun for the responsibility it owns.
- Add one file exporting one PascalCase class whose constructor
  receives its collaborators (never `require`s a sibling layer
  directly).
- Wire its instantiation into `index.js`'s `main()`, in dependency
  order — lowest-level collaborators first (`index.js:37-55`).

**Utilities:**
- No shared `utils/` or `common/` folder exists. Each layer keeps its
  own private helpers as `_`-prefixed methods on its own class rather
  than extracting to a shared module. Follow this pattern rather than
  introducing a new cross-layer utilities directory unless a helper is
  demonstrably needed by more than one layer.

## Special Directories

**`logs/`:**
- Purpose: daily winston error-log files (`log_<date>.log`)
- Generated: Yes — created on first run by `Logger._ensureLogDir`
  (`src/infrastructure/logger.js:23-27`)
- Committed: No (gitignored)
- Currently absent from the working tree; created on demand

**`postman/`:**
- Purpose: manual API-testing collections/environments — one set for
  the current Magento tax API (`nexgen-tax-api.postman_collection.json`,
  `nexgen-test.postman_environment.json`) and one reference set for a
  prospective "Synexus Compute API v2"
  (`synexus-v2-api.postman_collection.json`,
  `synexus-staging.postman_environment.json`), matching the current
  branch name `feat/synexus-v2-migration`
- Generated: No (hand-maintained exports)
- Committed: No — currently untracked (`?? postman/` in git status)
- Not referenced by any runtime code; `grep` across `src/` and
  `index.js` found no "Synexus" references — the v2 integration is not
  yet implemented, only scoped

**`data/`:**
- Purpose: raw meeting notes and reference PDFs (bitácora)
- Generated: No
- Committed: No — excluded via local `.git/info/exclude` (not
  `.gitignore`), with the exclude file's own comment stating these
  notes must never leave the team. Do not copy contents from this
  directory into any file that will be committed.

**`.planning/codebase/`:**
- Purpose: GSD-generated codebase reference docs, read by
  `/gsd-plan-phase` and `/gsd-execute-phase`
- Generated: Yes, by `/gsd-map-codebase`
- Committed: Yes

**`node_modules/`:**
- Purpose: npm-installed dependencies (`axios`, `dotenv`, `winston`,
  and their transitive deps)
- Generated: Yes (`npm install`)
- Committed: No (gitignored)

**`test-files/` and `results/` (referenced, not present):**
- Purpose: `.claude/commands/tax-quote.md`, `tax-commit.md`, and
  `tax-cancel.md` all expect operator-provided fixtures under
  `test-files/` and treat `results/` as gitignored output; both are
  listed in `.gitignore` and in `.claude/settings.json`'s deny list
- Generated: No (operator-provided)
- Committed: No
- Currently absent from the working tree (not found by directory
  scan)

---

*Structure analysis: 2026-09-10*
