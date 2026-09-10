# CLAUDE.md — nexgen

> Persistent instructions for Claude Code sessions in this repo.
> Keep concise; expand only when the same correction is needed twice.

## What this project is

A Node.js CLI that bridges an ERP (Sage 300 in production) with the
Magento STCCalcV3 Tax API on Azure. Reads a JSON transaction, calls
`get_tax` / `post_tax` / `cancel_tax`, and writes the response to
`OUTPUT_DIR/RESPONSE_<file>.json`. Not a daemon — one invocation, one
operation, exit.

## Stack

- Node.js 14+, CommonJS (no ESM).
- Three runtime deps: `axios ^1.7.9`, `dotenv ^16.4.7`, `winston ^3.17.0`.
- No tests, no CI, no linter. See `ARCHITECTURE.md` §10 for the gap.

## Architecture (5 layers + DI in `index.js`)

```
CLI → Validator → API → Storage → Infrastructure (logger, config)
```

DI is wired exclusively in `index.js`. No layer reaches across — they
receive collaborators in the constructor. Full breakdown in
`ARCHITECTURE.md`.

## Critical files

| Path                                | Purpose                                              |
| ----------------------------------- | ---------------------------------------------------- |
| `index.js`                          | Entry point, builds DI graph                         |
| `src/cli/taxCommandHandler.js`      | argv parsing, command lifecycle                      |
| `src/validators/taxValidator.js`    | `Committed` rules + string sanitization              |
| `src/api/taxApiClient.js`           | axios HTTP client, 30s timeout, error classification |
| `src/storage/fileManager.js`        | JSON read/write, `RESPONSE_*` naming                 |
| `src/infrastructure/logger.js`      | winston, error-only, daily file rotation             |
| `src/config/index.js`               | dotenv + endpoint URL resolution (singleton)         |

## Commands

```bash
npm install                                # install deps
node index.js get_tax    <path-to-json>    # quote (Committed must be false)
node index.js post_tax   <path-to-json>    # commit (Committed must be true)
node index.js cancel_tax <path-to-json>    # cancel (Committed not checked)
```

There is no `npm start`, no `npm test` that does anything real, and no
build step.

## Environment variables

Required (constructor throws otherwise): `BASE_URL`, `API_CODE`,
`OUTPUT_DIR`. Optional: `TEST_MODE` (defaults to `false`). The `.env`
file lives at the repo root and is gitignored. See `HANDOFF.md` §9 for
the full table.

## Conventions

- Inline comments and user-facing error messages: **Spanish**.
- Class, method, variable, file names: **English camelCase**.
- Logging level: `error` only. `logger.info/warn/debug` are no-ops at
  the file transport. Use `console.log` for trace output.
- HTTP: always through `TaxApiClient`. Never import `axios` elsewhere.
- Filesystem: always through `FileManager`. Never import `fs` outside
  this class.
- Env vars: always through `Config`. Never read `process.env` directly
  in other layers.
- Errors are thrown (`throw new Error(...)`), not returned. The CLI
  layer catches and `process.exit(1)`s.

## Edge cases and gotchas

1. **`TEST_MODE` is easy to leave on.** `STCCalcV3_TEST` vs `STCCalcV3`
   is decided by a single env var. Always verify the URL printed in
   stdout at the start of a run. `cancel_tax` ignores `TEST_MODE` and
   always hits `CancelTransaction`.
2. **`Committed` semantics matter.** `get_tax` requires `false`,
   `post_tax` requires `true` (strict `===` check). A typo in the
   input JSON aborts before any HTTP call. `cancel_tax` does not
   validate this field.
3. **The API uses `GET` with a JSON body.** Unusual but real
   (`taxApiClient.js` lines 36-48). Don't "fix" it to `POST` without
   coordinating with the API team.
4. **String sanitization escapes only apostrophes** (`'` → `\'`).
   Changes the wire payload. Originated from `Plummer's...`
   address-line failures.
5. **Response files overwrite.** `RESPONSE_<basename>.json` does not
   include a timestamp. Concurrent invocations on the same input file
   race.
6. **Logger date is fixed at construction.** A process that spans
   midnight keeps writing to yesterday's `log_*.log`.

## Do not touch lightly

- **`Config.getEndpointUrl`** — the `STCCalcV3` / `STCCalcV3_TEST` /
  `CancelTransaction` strings are wire-level contract.
- **`TaxValidator.validateCommittedField`** — the strict `===` checks
  protect against silent state corruption in the upstream API.
- **`FileManager.getResponseFileName`** — the `RESPONSE_` prefix is a
  convention the ERP wrappers depend on.
- **`Logger` level** — changing from `error` will flood disk in
  high-volume environments.
- **`TaxApiClient.timeout`** — `30000` ms. Lowering it will cause
  spurious failures on slow Azure responses.

## Pointers to deeper docs

- `HANDOFF.md` — owner-to-owner transfer brief (Spanish).
- `ARCHITECTURE.md` — per-layer breakdown, lifecycle, error model.
- `RUNBOOK.md` — operational procedures (Spanish).
- `docs/MEMORY.md` — historical decisions and conventions.

## Plan técnico: GSD es el dueño

Desde 2026-09-10 este repo usa GSD. **El plan técnico vive en `.planning/`, no
aquí.** Este archivo describe cómo es el código; `.planning/` describe qué se
está construyendo y por qué. No dupliques entre los dos.

- `.planning/PROJECT.md` — contexto, requisitos validados vs activos, decisiones clave.
- `.planning/ROADMAP.md` — fases y criterios de éxito.
- `.planning/REQUIREMENTS.md` — los requisitos con ID y su trazabilidad a fases.
- `.planning/STATE.md` — dónde va el trabajo. Léelo primero al retomar sesión.
- `.planning/codebase/` — mapa del código en 7 documentos (generado, regenerable
  con `/gsd-map-codebase`).

Milestone en curso: **migración a Synexus Compute v2**, 3 fases. El camino v1 que
corre en producción no se toca — ver `COMP-01` en `REQUIREMENTS.md`.

## Workflow expectations for Claude

- Behavior changes need an explicit ask. Docs/meta changes can be
  proactive.
- Don't invent endpoints, env vars, or API fields — read the code or
  ask. The wire contract lives in `src/config/index.js` and external
  documentation that is **not** in this repo.
- When adding a new operation, update (in order): `TaxValidator.validOperations`,
  `TaxValidator.validateCommittedField` (if applicable), and
  `Config.getEndpointUrl`. See `HANDOFF.md` FAQ.
- Never commit `.env` or any value that smells like a secret
  (`API_CODE`, password, token).
- Custom subagents (`.claude/agents/`) and slash commands
  (`.claude/commands/`) are committed — review and update them when
  the code they reference changes.
