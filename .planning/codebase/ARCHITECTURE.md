<!-- refreshed: 2026-09-10 -->
# Architecture

**Analysis Date:** 2026-09-10

## System Overview

`nexgen` is a single-process Node.js CLI, not a service. One process = one
operation (`get_tax` | `post_tax` | `cancel_tax`) = one exit code. There is
no HTTP server, no daemon, no queue consumer.

```text
                              argv (process.argv)
                                     │
                                     ▼
┌────────────────────────────────────────────────────────────────┐
│  Entry Point — DI Composition Root                              │
│  `index.js`                                                     │
│  builds every layer bottom-up, calls commandHandler.execute()   │
└──────────────────────────────┬────────────────────────────────┘
                                 │ constructs + delegates to
                                 ▼
┌────────────────────────────────────────────────────────────────┐
│  CLI Layer — TaxCommandHandler                                  │
│  `src/cli/taxCommandHandler.js`                                 │
│  argv parsing, lifecycle orchestration, response persistence    │
└──────────────────────────────┬────────────────────────────────┘
                                 │ validator.validate(operation, body)
                                 ▼
┌────────────────────────────────────────────────────────────────┐
│  Validation Layer — TaxValidator                                │
│  `src/validators/taxValidator.js`                               │
│  operation whitelist, Committed rules, string sanitization      │
└──────────────────────────────┬────────────────────────────────┘
                                 │ sanitized request body
                                 ▼
┌────────────────────────────────────────────────────────────────┐
│  API Layer — TaxApiClient                                       │
│  `src/api/taxApiClient.js`                                      │
│  axios GET-with-body, status/error classification               │
└──────────────────────────────┬────────────────────────────────┘
                                 │ response JSON
                                 ▼
┌────────────────────────────────────────────────────────────────┐
│  Storage Layer — FileManager                                    │
│  `src/storage/fileManager.js`                                   │
│  RESPONSE_<basename>.json write, directory creation              │
└────────────────────────────────────────────────────────────────┘

  Cross-cutting infrastructure (constructed first, injected everywhere):
┌───────────────────────────────┬────────────────────────────────┐
│  Logger (winston)              │  Config (dotenv, singleton)     │
│  `src/infrastructure/logger.js`│  `src/config/index.js`          │
│  error-only, daily file        │  env validation, endpoint URLs  │
└───────────────────────────────┴────────────────────────────────┘
                                 │
                                 ▼
                  External: Magento STCCalcV3 Tax API (Azure)
                  `syn-magento.azurewebsites.net`
```

## Component Responsibilities

| Component | Responsibility | File |
|-----------|----------------|------|
| Entry point / DI root | Build the dependency graph bottom-up, run one command, top-level error boundary | `index.js` |
| `TaxCommandHandler` | Parse argv, sequence validate → call API → persist response, orchestrate — no business rules itself | `src/cli/taxCommandHandler.js` |
| `TaxValidator` | Enforce operation whitelist, `Committed` semantics per operation, sanitize string fields | `src/validators/taxValidator.js` |
| `TaxApiClient` | Speak HTTP to the Magento STCCalcV3 / CancelTransaction endpoints, classify transport vs. HTTP errors | `src/api/taxApiClient.js` |
| `FileManager` | All filesystem reads/writes: input JSON, `RESPONSE_*.json` output, directory creation | `src/storage/fileManager.js` |
| `Logger` | Error-only winston logging to a daily rotating file | `src/infrastructure/logger.js` |
| `Config` | Load/validate env vars, resolve per-operation endpoint URLs, singleton shared by reference | `src/config/index.js` |

## Pattern Overview

**Overall:** Layered architecture (5 conceptual layers: CLI, Validation,
API, Storage, Infrastructure) wired with constructor-based Dependency
Injection, composed exclusively at the entry point. Plain CommonJS
classes — no framework (no Express, no Nest, no DI container library).

**Key Characteristics:**
- One-shot process: no state survives between invocations; the process
  exits after exactly one operation.
- Composition root is `index.js` only. No layer `require()`s a sibling
  layer or self-constructs a collaborator — everything arrives through
  the constructor (`index.js:37-55`).
- `Config` is the sole exception: it is a `require`d singleton
  (`module.exports = new Config()`, `src/config/index.js:91`), not
  passed as an interface — every other collaborator is positional
  constructor injection.
- Failures propagate as thrown `Error` objects, never as return codes
  or `{ ok, error }` result tuples (see Error Handling below).
- Every layer is instantiated exactly once per process
  (`index.js:37-55`) and discarded on exit — no pooling, no caching
  layer, no in-memory session.

## Layers

**Entry point (composition root):**
- Purpose: build the DI graph and run one command
- Location: `index.js`
- Contains: `require()` of every layer (`index.js:24-29`), bottom-up
  construction (`index.js:37-55`), single top-level `try/catch`
- Depends on: every layer below (directly), `Config` (via `require`)
- Used by: invoked directly by `node index.js <operation> <path>`

**CLI layer:**
- Purpose: orchestrate one invocation — parse, validate, call, persist
- Location: `src/cli/taxCommandHandler.js`
- Contains: `TaxCommandHandler` class — `parseArguments`, `execute`,
  `_saveResponse`, `_handleError`, `showHelp` (unused today)
- Depends on: `Config`, `Logger`, `FileManager`, `TaxValidator`,
  `TaxApiClient` (all five, via constructor)
- Used by: `index.js` only

**Validation layer:**
- Purpose: enforce business rules before any network call
- Location: `src/validators/taxValidator.js`
- Contains: `TaxValidator` class — `validateOperation`,
  `validateRequestBody`, `validateCommittedField`,
  `sanitizeStringFields`, `validate` (aggregator)
- Depends on: `Logger`
- Used by: `TaxCommandHandler`

**API layer:**
- Purpose: HTTP communication with the external tax API
- Location: `src/api/taxApiClient.js`
- Contains: `TaxApiClient` class — `makeRequest`, `_handleResponse`,
  `_handleError`, plus `getTax`/`postTax`/`cancelTax` wrappers
- Depends on: `Config` (endpoint URL resolution), `Logger`, `axios`
- Used by: `TaxCommandHandler`

**Storage layer:**
- Purpose: every filesystem touch in the application
- Location: `src/storage/fileManager.js`
- Contains: `FileManager` class — `exists`, `readJsonFile`,
  `writeJsonFile`, `ensureDirectory`, `getResponseFileName`
- Depends on: `Logger`, Node's `fs`/`path`
- Used by: `TaxCommandHandler`

**Infrastructure — Logger:**
- Purpose: error-only, durable logging
- Location: `src/infrastructure/logger.js`
- Contains: `Logger` class wrapping a single `winston` instance
- Depends on: `winston`, Node's `fs`/`path`
- Used by: `FileManager`, `TaxValidator`, `TaxApiClient`,
  `TaxCommandHandler` (all layers that can fail)

**Infrastructure — Configuration:**
- Purpose: centralize env var access and endpoint resolution
- Location: `src/config/index.js`
- Contains: `Config` class, exported as a pre-constructed singleton
- Depends on: `dotenv`, Node's `path`, `process.env`
- Used by: `index.js` (log dir, DI), `TaxApiClient` (endpoint URL),
  `TaxCommandHandler` (output dir)

## Data Flow

### Primary Request Path

1. Process starts; `index.js` builds the DI graph bottom-up — `Logger`
   → `FileManager` → `TaxValidator` → `TaxApiClient` →
   `TaxCommandHandler` (`index.js:37-55`) — then calls
   `commandHandler.execute(process.argv.slice(2))` (`index.js:58-59`).
2. `TaxCommandHandler.parseArguments` splits argv into
   `{ operation, filePath }`; throws if fewer than 2 args
   (`src/cli/taxCommandHandler.js:34-47`).
3. `TaxValidator.validateOperation` checks `operation` against
   `['get_tax', 'post_tax', 'cancel_tax']`
   (`src/validators/taxValidator.js:15,23-30`, called from
   `src/cli/taxCommandHandler.js:59`).
4. `FileManager.exists` + `readJsonFile` load and JSON-parse the input
   file (`src/storage/fileManager.js:24-53`, called from
   `src/cli/taxCommandHandler.js:62-70`).
5. `TaxValidator.validate` runs `validateRequestBody` →
   `validateCommittedField` → `sanitizeStringFields` and returns the
   sanitized body (`src/validators/taxValidator.js:103-111`, called
   from `src/cli/taxCommandHandler.js:73`).
6. `TaxApiClient.makeRequest` resolves the URL via
   `Config.getEndpointUrl(operation)` and issues an axios `GET` with a
   JSON `data` body (`src/api/taxApiClient.js:29-55`, called from
   `src/cli/taxCommandHandler.js:76`).
7. `TaxCommandHandler._saveResponse` ensures `OUTPUT_DIR` exists and
   writes `RESPONSE_<basename>.json` through `FileManager`
   (`src/cli/taxCommandHandler.js:100-116`).
8. Success is logged to stdout; the function returns and the process
   exits `0` implicitly (`src/cli/taxCommandHandler.js:81-85`).

### Error Flow

1. Any layer that detects an invalid state logs first
   (`console.error` + `Logger.error`) and then `throw new Error(...)`
   — never a returned `{ ok: false }` value.
2. `TaxCommandHandler.execute`'s own `try/catch` calls `_handleError`
   (logs again) and re-throws unchanged
   (`src/cli/taxCommandHandler.js:87-91,123-126`).
3. `index.js`'s `main()` catch block prints one generic Spanish
   operator line and calls `process.exit(1)` (`index.js:61-65`). This
   is the only place the process exit code is set.

**State Management:**
No in-memory or persisted application state crosses invocations. The
only carried-over "state" is: (a) the `Config` singleton, constructed
once per `require('./src/config')` and shared by reference across the
DI graph (`src/config/index.js:91`); (b) `RESPONSE_*.json` files on
disk, which are overwritten — not versioned — on every run for the
same input filename (`src/storage/fileManager.js:163-166`).

## Key Abstractions

**Layer class (constructor-injected collaborator):**
- Purpose: each architectural layer is exactly one plain class,
  instantiated once, whose dependencies arrive as constructor
  parameters
- Examples: `TaxCommandHandler`, `TaxValidator`, `TaxApiClient`,
  `FileManager`, `Logger`
- Pattern: no factories, no interfaces/abstract base classes (plain JS
  duck typing) — the "abstraction" is the constructor signature itself

**Operation as a plain string enum:**
- Purpose: `'get_tax' | 'post_tax' | 'cancel_tax'` is threaded through
  argv, the validator, and the config layer as a bare string, not a
  class or a typed enum
- Examples: `TaxValidator.validOperations`
  (`src/validators/taxValidator.js:15`), the `if`/`else if` chain in
  `Config.getEndpointUrl` (`src/config/index.js:65-79`)
- Pattern: centralized whitelist in one place
  (`TaxValidator.validOperations`); every other layer trusts that
  gate has already run

**Config singleton:**
- Purpose: one shared-by-reference object for env access and endpoint
  URLs, instead of DI for this one cross-cutting concern
- Location: `src/config/index.js:91`
```js
// Singleton pattern - una sola instancia de configuración
module.exports = new Config();
```
- Pattern: constructed at first `require`; every layer that needs it
  receives the same instance; `process.env` is read nowhere else in
  the codebase by convention (`docs/MEMORY.md` "Anti-patrones
  evitados")

## Entry Points

**CLI invocation — `index.js`:**
- Location: `index.js`
- Triggers: `node index.js <get_tax|post_tax|cancel_tax> <path-to-json>`,
  run by an ERP wrapper (Sage 300) or an operator/slash command
  (`.claude/commands/tax-quote.md`, `tax-commit.md`, `tax-cancel.md`)
- Responsibilities: construct the DI graph in dependency order, invoke
  `TaxCommandHandler.execute`, serve as the single top-level error
  boundary (`process.exit(1)` on any thrown error)

This is the only entry point in the codebase — no HTTP listener, no
message-queue consumer, no scheduled job, no REPL.

## Architectural Constraints

- **Threading:** single-threaded, single event loop. No
  `worker_threads`, no `child_process` spawning. Exactly one axios
  request is ever in flight, because each process handles one
  operation and exits.
- **Global state:** `src/config/index.js` exports a `Config` singleton
  evaluated once at first `require` (`src/config/index.js:91`). No
  other module-level singletons exist. Env vars are intended to be
  read only inside `Config` — no other file calls `process.env`
  directly.
- **Circular imports:** none. The dependency graph is a strict DAG:
  `index.js` requires every layer; layers never `require()` each
  other (they receive collaborators via constructor). `Config` is the
  only module required directly by two places (`index.js` and
  implicitly nowhere else — every other layer receives it as a
  constructor argument, not via `require`).
- **Process lifecycle:** one operation per process invocation; no
  retry loop, no long-running listener. Concurrent invocations against
  the same input filename can race on
  `OUTPUT_DIR/RESPONSE_<basename>.json` since writes are unconditional
  overwrites with no locking (`src/storage/fileManager.js:126-137`).
- **External contract ownership:** the wire format (field names,
  required vs. optional) for `STCCalcV3` is owned by the API team, not
  this repo — `Config.getEndpointUrl`'s three literal path segments
  (`STCCalcV3`, `STCCalcV3_TEST`, `CancelTransaction`,
  `src/config/index.js:65-79`) are the full extent of what this
  codebase controls.

## Anti-Patterns

### GET request carrying a JSON body

**What happens:** `TaxApiClient.makeRequest` issues `method: 'GET'`
with a `data` payload (`src/api/taxApiClient.js:36-39`) instead of
query parameters or a `POST` body.
**Why it's wrong:** this is inherited from the external Magento
`STCCalcV3` contract, not a choice made in this repo — HTTP GET is not
guaranteed to carry a body through proxies, gateways, or caching
layers, and most HTTP tooling assumes GET requests are bodyless.
**Do this instead:** when wiring a **new** endpoint into `TaxApiClient`
(e.g., during the Synexus v2 migration explored in `postman/`), default
to standard `POST`/`PUT` semantics matching the payload's intent.
Reproduce GET-with-body only if the external contract explicitly
requires it, and document why, the way `docs/MEMORY.md` D6 does for
today's endpoints.

### Unscoped, blanket string sanitization

**What happens:** `TaxValidator.sanitizeStringFields` recursively
walks the entire request body via a `JSON.stringify` replacer and
replaces every `'` with `\'` in every string field, at any depth, for
every operation, with no per-field opt-out
(`src/validators/taxValidator.js:76-95`).
**Why it's wrong:** the transform is global and unconditional — there
is no mechanism to exclude a field that must travel unmodified. The
codebase's own history documents this risk (`docs/MEMORY.md` D3:
"Alcance: solo apostrofes... la regla se amplía" — scope creep is
anticipated but not yet guarded against).
**Do this instead:** when extending sanitization (see
`.claude/agents/tax-validator-helper.md`), keep new character rules
scoped and explicitly justified per failure case rather than widening
the same blanket replacer. Prefer per-field allowlists over adding more
global regex-style substitutions to `sanitizeStringFields`.

### Generic `Error` with no discriminable type or code

**What happens:** every failure path across every layer throws a plain
`new Error(message)` with only a human-readable Spanish string — no
custom error subclasses, no `error.code`, no structured error data
(consistent throughout `src/validators/taxValidator.js`,
`src/api/taxApiClient.js`, `src/storage/fileManager.js`,
`src/cli/taxCommandHandler.js`).
**Why it's wrong:** callers (or future test code) cannot distinguish a
validation failure from a network failure from a filesystem failure
without fragile `error.message` string matching. `index.js`'s single
`catch` block already treats every error identically
(`index.js:61-65`), but a future consumer (e.g., the ERP wrapper
branching on failure type) would need to parse text to tell them apart.
**Do this instead:** when adding new failure paths, prefer
distinguishable error types or an `error.code`/`error.kind` property
over relying purely on message text for classification.

## Error Handling

**Strategy:** throw-and-catch with a single top-level boundary. No
layer returns a `{ ok, error }` result tuple; every detected failure is
logged (`console.error` + `Logger.error`) and then thrown as a plain
`Error`. Exactly one `try/catch` sits at the composition root
(`index.js` `main()`, `index.js:35,61-65`), which prints an
operator-facing line and calls `process.exit(1)`.
`TaxCommandHandler.execute` has its own `try/catch`
(`src/cli/taxCommandHandler.js:53-92`) that logs via `_handleError` and
re-throws — it does not swallow errors or exit the process itself.

**Patterns:**
- Validation errors throw synchronously before any HTTP call is made,
  so a bad `Committed` value or malformed JSON never reaches the
  network (`src/validators/taxValidator.js`).
- `TaxApiClient._handleError` classifies transport failures into
  `ECONNREFUSED` / `ECONNABORTED` / `ENOTFOUND` / server-response /
  no-response buckets, each with distinct diagnostic console output,
  then logs and lets the original error rethrow
  (`src/api/taxApiClient.js:97-141`).
- HTTP 4xx does **not** throw inside axios — a custom
  `validateStatus: status < 500` (`src/api/taxApiClient.js:44-47`)
  makes 4xx a normal resolved response, manually converted to a thrown
  `Error` in `_handleResponse` (`src/api/taxApiClient.js:66-81`). HTTP
  5xx throws natively from axios and is caught by `_handleError`.
- Filesystem errors (`ENOENT`, `EACCES`, JSON `SyntaxError`) are
  enriched with operator hints, including a directory scan for
  similarly named files, before rethrowing
  (`src/storage/fileManager.js:61-118`).

## Cross-Cutting Concerns

**Logging:** `winston`, one `error`-level file transport per process
at `<repo>/logs/log_<YYYY-MM-DD>.log`; the log filename's date is
computed once at `Logger` construction, so a process spanning midnight
keeps writing to the prior day's file
(`src/infrastructure/logger.js:33-51`). All non-error trace output
(request URLs, payloads, server responses) goes only to
`console.log`/`console.error` (stdout/stderr) and is not persisted.

**Validation:** centralized in `TaxValidator`, invoked exactly once per
command from `TaxCommandHandler.execute`, before any network or extra
filesystem I/O beyond reading the input file
(`src/validators/taxValidator.js`).

**Authentication:** outbound only, no inbound auth (this is a CLI, not
a server). A static `API_CODE` query-string credential is appended by
`Config.getEndpointUrl` for `get_tax`/`post_tax`; `cancel_tax` sends no
credential at all (`src/config/index.js:65-79`).

---

*Architecture analysis: 2026-09-10*
