<!-- refreshed: 2026-09-11 -->
# Architecture

**Analysis Date:** 2026-09-11

## System Overview

```text
                     argv: node index.js <operation> <path> [--api-version=][--entity=]
                                            │
                                            ▼
┌────────────────────────────────────────────────────────────────────────────┐
│  CLI — TaxCommandHandler.execute()          `src/cli/taxCommandHandler.js`  │
│  parseArguments() → resolveApiVersion() → branches on apiVersion at :166    │
└───────────────────────┬──────────────────────────────┬─────────────────────┘
            apiVersion === 'v1' (default)   apiVersion === 'v2' (--api-version=v2
                        │                     or TAX_API_VERSION=v2)
                        ▼                                ▼
┌─────────────────────────────────┐   ┌──────────────────────────────────────┐
│ v1 Validation — FROZEN          │   │ v2 Validation + Build (_executeV2)    │
│ `src/validators/taxValidator.js`│   │ `taxCommandHandler.js:211-253`        │
│ validate() :160 → validateCommi-│   │ + `src/api/synexusRequestBuilder.js`  │
│ ttedField, sanitizeStringFields │   │ validateV2IntentFields, getIntentFor, │
│                                  │   │ buildRequestBody                      │
└────────────────┬─────────────────┘   └────────────────────┬─────────────────┘
                  ▼                                          ▼
┌─────────────────────────────────┐   ┌──────────────────────────────────────┐
│ v1 API — TaxApiClient           │   │ v2 API — SynexusApiClient             │
│ `src/api/taxApiClient.js`       │   │ `src/api/synexusApiClient.js`         │
│ GET + JSON body, ?code= in URL  │   │ POST, Authorization: Bearer +         │
│ → STCCalcV3[_TEST] / CancelTx   │   │ X-Synexus-Entity → tax_calculations   │
└────────────────┬─────────────────┘   └────────────────────┬─────────────────┘
                  └───────────────────────┬────────────────────┘
                                          ▼
                    ┌──────────────────────────────────────┐
                    │  Storage — FileManager (shared)       │
                    │  `src/storage/fileManager.js`         │
                    │  writes RESPONSE_<basename>.json      │
                    └──────────────────────────────────────┘

  Cross-cutting, reachable from every box above:
  Logger (`src/infrastructure/logger.js`) · Config (`src/config/index.js`, v1
  singleton, also supplies getOutputDir() to both contracts) · SynexusConfig
  (`src/config/synexusConfig.js`, v2 only — constructed conditionally in
  `index.js:60-65`, never touched under v1)
```

## Component Responsibilities

| Component | Responsibility | File |
|-----------|----------------|------|
| Composition root | Builds the DI graph bottom-up; resolves the contract *before* constructing v2's collaborators; constructs `SynexusConfig`/`SynexusApiClient` only when `apiVersion === 'v2'` | `index.js` |
| TaxCommandHandler | argv parsing, flag extraction, the one place that knows both contracts exist, sequences validate → build → call → save | `src/cli/taxCommandHandler.js` |
| TaxValidator | v1: `Committed` rules + sanitization (aggregated by `validate()`). v2: intent-field contradiction checks (`validateV2IntentFields`, called directly, never through `validate()`) | `src/validators/taxValidator.js` |
| TaxApiClient | v1 HTTP client — **frozen**, GET-with-body to Magento `STCCalcV3`/`CancelTransaction` | `src/api/taxApiClient.js` |
| SynexusRequestBuilder | v2 only, no v1 equivalent — owns the `transaction_type`/`committed`/`request_id` intent fields and builds the typed body | `src/api/synexusRequestBuilder.js` |
| SynexusApiClient | v2 HTTP client — POST with `Authorization: Bearer` + `X-Synexus-Entity` to Synexus Compute | `src/api/synexusApiClient.js` |
| FileManager | JSON read/write, `RESPONSE_` naming — unmodified, shared by both contracts | `src/storage/fileManager.js` |
| Logger | winston error-only file logger — shared by both contracts | `src/infrastructure/logger.js` |
| Config | v1 config — `require`-time singleton, env var validation, endpoint URL resolution, `getApiVersion()` selector | `src/config/index.js` |
| SynexusConfig | v2 config — exported as a class, built only when v2 resolved; key↔host validation, entity precedence, masked profile line | `src/config/synexusConfig.js` |

## Pattern Overview

**Overall:** Layered architecture (5 layers) with constructor-based dependency injection wired exclusively in `index.js`. As of Phase 1 of the Synexus v2 migration, this became a **parallel-path** variant: two sibling implementations of the Validation and API layers (v1 frozen, v2 new) selected by a runtime contract switch. There is no shared interface or abstract base class between `TaxApiClient`/`SynexusApiClient`, nor between `validate()`/`validateV2IntentFields` — the branch lives procedurally in the CLI orchestrator, which is the only class aware both contracts exist.

**Key Characteristics:**
- Single-process CLI, one command per invocation, no daemon/server/HTTP listener (unchanged from v1).
- DI is entirely positional-constructor based; no framework, no container, no `require()` of a sibling layer from inside a layer.
- v2 was added **by addition, not modification**: `src/api/taxApiClient.js`, the v1 surface of `src/config/index.js`, `validateCommittedField`, and `validate()` are byte-for-byte frozen and regression-tested (`tests/v1Freeze.wire.test.js`, `tests/v1Freeze.messages.test.js`).
- The contract selector is resolved once per invocation, **before** construction (`index.js:59`), and gates whether v2's constructors even run — a server with no `SYNEXUS_*` env vars stays fully functional under v1 because `SynexusConfig` is never `new`'d (`index.js:60-65`).
- Two aggregator-shaped methods exist side by side and never call each other: `TaxValidator.validate()` (v1, `src/validators/taxValidator.js:160-168`) and `TaxCommandHandler._executeV2()` (v2, `src/cli/taxCommandHandler.js:211-253`), which calls the validator's granular methods directly instead of going through an aggregator.

## Layers

**CLI Layer:**
- Purpose: parse argv, resolve which contract applies, sequence validation/build/API/storage steps for one invocation
- Location: `src/cli/taxCommandHandler.js`
- Contains: `TaxCommandHandler` class — the only file in the repo that branches on contract
- Depends on: `Config`, `Logger`, `FileManager`, `TaxValidator`, `TaxApiClient`, `SynexusConfig` (nullable), `SynexusRequestBuilder`, `SynexusApiClient` (nullable) — 8 constructor params (`src/cli/taxCommandHandler.js:23`)
- Used by: `index.js` only

**Validation Layer:**
- Purpose: enforce business rules before any HTTP call — `Committed` semantics for v1, intent-field contradiction for v2, text sanitization shared by both
- Location: `src/validators/taxValidator.js`
- Contains: `TaxValidator` class, one aggregation style per contract (`validate()` for v1; granular calls orchestrated by the CLI layer for v2)
- Depends on: `Logger` only
- Used by: `TaxCommandHandler` (both branches). Never called from either API client.

**Build Layer (v2 only — no v1 equivalent):**
- Purpose: construct the typed v2 request body, owning the fields v1 doesn't have and that the ERP file must never supply itself
- Location: `src/api/synexusRequestBuilder.js`
- Contains: `SynexusRequestBuilder` — `getIntentFor` (single source of truth for the operation→intent mapping) and `buildRequestBody`
- Depends on: `Logger`, Node's `crypto` (UUID v4 generation)
- Used by: `TaxCommandHandler._executeV2` only

**API Layer:**
- Purpose: HTTP transport
- Location: `src/api/taxApiClient.js` (v1), `src/api/synexusApiClient.js` (v2)
- Contains: two independent axios clients with the same method shape (`makeRequest` / `_handleResponse` / `_handleError`) and deliberate wire-level divergences (see Data Flow)
- Depends on: `axios`, and their respective config object (`Config` for v1, `SynexusConfig` for v2)
- Used by: `TaxCommandHandler` exclusively — no other file imports `axios` (enforced convention, see `CLAUDE.md`)

**Storage Layer:**
- Purpose: every filesystem touch — read input JSON, write `RESPONSE_<name>.json`
- Location: `src/storage/fileManager.js`
- Contains: `FileManager` class, shared **unmodified** by both contracts
- Depends on: `Logger`, Node `fs`/`path`
- Used by: `TaxCommandHandler` — same call site for both branches (`execute():177`)

**Infrastructure / Configuration Layer:**
- Purpose: cross-cutting services — logging, env var validation, endpoint/host resolution
- Location: `src/infrastructure/logger.js`, `src/config/index.js` (v1), `src/config/synexusConfig.js` (v2)
- Contains: `Logger` (winston, error-only), `Config` (singleton, exported as an instance), `SynexusConfig` (exported as a class, instantiated conditionally)
- Depends on: `winston`, `dotenv`, Node's `URL`
- Used by: every layer above (`Logger`); `Config` by the v1 API layer + `index.js` + shared `getOutputDir()`; `SynexusConfig` only by the v2 CLI branch and the v2 API layer

## Data Flow

### Contract Resolution (runs once, before either path)

1. `index.js:58` — `const args = process.argv.slice(2);`
2. `index.js:59` — `TaxCommandHandler.resolveApiVersion(args, config, logger)`: reads the `--api-version=` flag (`src/cli/taxCommandHandler.js:51-53`); if absent, falls back to `config.getApiVersion()` (`src/cli/taxCommandHandler.js:56`, `src/config/index.js:64-68` — strict `=== 'v2'` check on `TAX_API_VERSION`, so absent/empty/misspelled always means v1)
3. `index.js:60-65` — only when the resolved value is `'v2'` are `SynexusConfig` and `SynexusApiClient` constructed; otherwise both stay `null` and are passed as `null` into `TaxCommandHandler`
4. `src/cli/taxCommandHandler.js:145` — `parseArguments` (called from inside `execute`) re-resolves the same value into the `apiVersion` property of its return object, and also extracts `--entity=` into `entityCode` (`:127-134`)
5. `src/cli/taxCommandHandler.js:166` — `if (apiVersion === 'v2')` is the single branch point for everything downstream

### Shared Steps (both contracts, same call sites)

1. `src/cli/taxCommandHandler.js:148` — `validator.validateOperation(operation)` — the only validator call common to both branches
2. `src/cli/taxCommandHandler.js:151-156` — `fileManager.exists(filePath)`, throws if missing
3. `src/cli/taxCommandHandler.js:159` — `fileManager.readJsonFile(filePath)` → raw `requestBody`
4. `src/cli/taxCommandHandler.js:177` → `_saveResponse` (`:261-277`) — `config.getOutputDir()` (always the v1 `Config`, even under v2), `fileManager.ensureDirectory`, `fileManager.getResponseFileName` (`RESPONSE_<basename>`), `fileManager.writeJsonFile`
5. `src/cli/taxCommandHandler.js:180-183` — success lines to stdout (`SUCCESS: <operation> - File: <name>`)

### v1 Request Path (default — no flag, no env var)

1. `src/cli/taxCommandHandler.js:170` — `this.validator.validate(operation, requestBody)` (`src/validators/taxValidator.js:160-168`) aggregates, in order: `validateOperation` → `validateRequestBody` (`:119-126`) → `validateCommittedField` (`:38-55` — strict `===`; `get_tax` requires `false`, `post_tax` requires `true`, `cancel_tax` skipped) → `sanitizeStringFields` (`:133-152` — escapes `'` → `\'` recursively via a `JSON.parse(JSON.stringify(..., replacer))` clone)
2. `src/cli/taxCommandHandler.js:173` — `this.apiClient.makeRequest(operation, sanitizedRequestBody)` (`src/api/taxApiClient.js:29-55`)
3. `src/api/taxApiClient.js:30` — URL from `config.getEndpointUrl(operation)` (`src/config/index.js:75-89`): `get_tax`/`post_tax` → `` `${BASE_URL}STCCalcV3[_TEST]?code=${API_CODE}` ``; `cancel_tax` → `` `${BASE_URL}CancelTransaction` `` (no `?code`, ignores `TEST_MODE`)
4. `src/api/taxApiClient.js:36-48` — `axios({ method: 'GET', url, data: requestBody, headers: { 'Content-Type': 'application/json' }, timeout: 30000, validateStatus: status < 500 })` — GET with a JSON body (non-standard, intentional), credential travels in the query string
5. `src/api/taxApiClient.js:66-88` / `:97-141` — `_handleResponse` (status ≥ 400 → throw) / `_handleError` (`ECONNREFUSED` / `ECONNABORTED` / `ENOTFOUND` / server-response / no-response branches, each logged with diagnostic context)
6. Return value flows back through `taxCommandHandler.js:173` as `responseData`, then joins the shared save step

### v2 Request Path (`--api-version=v2` or `TAX_API_VERSION=v2`)

Runs entirely inside `_executeV2` (`src/cli/taxCommandHandler.js:211-253`) — **never calls `validate()` or `validateCommittedField`.**

1. `src/cli/taxCommandHandler.js:213` — `validator.validateRequestBody(requestBody)` (same null/object guard as v1, called directly)
2. `src/cli/taxCommandHandler.js:216` — `validator.sanitizeStringFields(requestBody)` (same apostrophe-escaping as v1, called directly — not through `validate()`)
3. `src/cli/taxCommandHandler.js:219` — `synexusConfig.resolveEntityCode(entityCode, sanitizedRequestBody)` (`src/config/synexusConfig.js:208-227`) — precedence: `--entity=` flag → `SYNEXUS_ENTITY` env var → `entity_id` field of the body (**truthy** checks, so an empty string falls through to the next tier); throws naming all three sources if none resolve
4. `src/cli/taxCommandHandler.js:222` — `synexusConfig.printProfile(resolvedEntityCode)` (`src/config/synexusConfig.js:255-260`) — prints contract/host/entity/masked key to stdout **before** any network call
5. `src/cli/taxCommandHandler.js:226` — `requestBuilder.getIntentFor(operation)` (`src/api/synexusRequestBuilder.js:42-59`) — only `get_tax` is mapped (`{ transaction_type: 'sales_estimate', committed: false }`); any other operation throws (`post_tax`/`cancel_tax` are Phase 2 scope)
6. `src/cli/taxCommandHandler.js:231` — `validator.validateV2IntentFields(operation, sanitizedRequestBody, intent)` (`src/validators/taxValidator.js:68-112`) — aborts if the file carries `Committed` (looks like a v1 file, `:73-79`), if `transaction_type`/`committed` contradict the intent (`:82-101`), or if the file brings its own `request_id` (`:104-109`)
7. `src/cli/taxCommandHandler.js:235` — `requestBuilder.buildRequestBody(operation, sanitizedRequestBody)` (`src/api/synexusRequestBuilder.js:70-88`) — `Object.assign({}, requestBody, intent, { request_id: this._generateRequestId() })`: file first, nexgen's intent fields layered **on top**, never the reverse; `_generateRequestId` (`:99-108`) is a UUID v4 built from `crypto.randomBytes(16)`
8. `src/cli/taxCommandHandler.js:241-247` — wiring guard: throws if `this.synexusApiClient` is `null` (defends against incomplete wiring in `index.js`; unreachable in normal operation because `index.js:60-65` only leaves it `null` when v1 was resolved)
9. `src/cli/taxCommandHandler.js:252` — `synexusApiClient.makeRequest(operation, v2RequestBody, resolvedEntityCode)` (`src/api/synexusApiClient.js:43-72`)
10. `src/api/synexusApiClient.js:44` — URL from `synexusConfig.getCalculationUrl()` (`src/config/synexusConfig.js:193-195`) = `<SYNEXUS_BASE_URL origin>/api/v1/tax_calculations` (no `/calculate` suffix — confirmed canonical against `postman/synexus-v2-api.postman_collection.json`)
11. `src/api/synexusApiClient.js:52-65` — `axios({ method: 'POST', url, data: requestBody, headers: { 'Content-Type', Authorization: 'Bearer <key>', 'X-Synexus-Entity': entityCode }, timeout: 30000, validateStatus: status < 500 })`
12. `src/api/synexusApiClient.js:83-105` / `:122-166` — same `_handleResponse`/`_handleError` shape as v1, with an explicit code comment (`:110-116`) forbidding serialization of `error.config`/`error.request`/`error.toJSON()` because they carry the bearer key
13. Return value flows back through `taxCommandHandler.js:252` as the return value of `_executeV2`, then joins the shared save step

**State Management:**
- No persistent in-process state across invocations — one process, one operation, exit.
- `Config` is memoized via Node's `require` cache as a singleton (`module.exports = new Config()`, `src/config/index.js:101`) — every layer that ever requires `src/config` shares one instance, and its constructor-time env var validation runs exactly once per process.
- `SynexusConfig` deliberately avoids this: it exports the class, and `index.js:60-65` constructs it at most once per invocation, only when v2 is resolved. No shared/global v2 config instance exists.
- No database, no cache, no session — the only "store" is the filesystem (`FileManager`, `OUTPUT_DIR`).

## Key Abstractions

**Contract Selector (`'v1' | 'v2'`):**
- Purpose: a plain string threaded through `index.js`, `TaxCommandHandler`, and `Config`, resolved once via a pure static function of `(args, config)`
- Examples: `src/cli/taxCommandHandler.js:51-68` (`resolveApiVersion`), `src/config/index.js:64-68` (`getApiVersion`)
- Pattern: precedence chain (CLI flag overrides env var), strict equality asserting the affirmative value only — never negates the default, so ausente/vacío/mal escrito never activates v2 by accident

**Intent Fields (`transaction_type` / `committed` / `request_id`):**
- Purpose: the three fields nexgen — not the ERP file — owns for v2, expressing "what this request means" independent of the raw file content
- Examples: `src/api/synexusRequestBuilder.js:42-59` (single source of truth for the operation→intent mapping), `src/validators/taxValidator.js:68-112` (contradiction checks against that same mapping object)
- Pattern: single-producer field ownership — the file may omit them (normal case) or match them (tolerated) but never contradict them (aborts, since a contradiction means the ERP extraction changed or the wrong command was invoked)

**Frozen Analog / Parallel Client (`TaxApiClient` / `SynexusApiClient`):**
- Purpose: v2's HTTP client is a structural copy of v1's (identical method names, identical try/catch/`_handleResponse`/`_handleError` shape) with deliberate wire-level divergences
- Examples: `src/api/taxApiClient.js`, `src/api/synexusApiClient.js`
- Pattern: copy-and-diverge, not a shared base class or interface — see `.planning/phases/01-camino-v2-de-punta-a-punta-para-una-cotizaci-n/01-PATTERNS.md` for the line-by-line divergence table (GET→POST, query-string code→Bearer header, no entity header→`X-Synexus-Entity`)

**Config vs. SynexusConfig lifecycle:**
- Purpose: v1's `Config` is a `require`-time singleton — `new Config()` executes (and can throw) the moment anything requires `src/config`. v2's `SynexusConfig` exports the class itself, so construction — and its startup validation — happens only when `index.js` has already decided v2 was selected
- Examples: `src/config/index.js:101`, `src/config/synexusConfig.js:263`, `index.js:60-65`
- Pattern: conditional construction as an isolation mechanism — a server with no `SYNEXUS_*` variables never runs `SynexusConfig`'s constructor, so it can never throw

## Entry Points

**CLI invocation:**
- Location: `index.js`
- Triggers: `node index.js <operation> <path> [--api-version=<v1|v2>] [--entity=<code>]` — the ERP wrapper (Sage 300) invokes without flags today; a human operator or a future wrapper can add them
- Responsibilities: build the full DI graph bottom-up (`index.js:37-77`), resolve the contract before constructing v2's collaborators, run exactly one operation, exit `1` on any thrown error (`index.js:82-86`), implicit `0` otherwise

This is the only entry point — no HTTP server, no daemon, no scheduled job.

## Architectural Constraints

- **Threading:** single-threaded, synchronous-per-invocation Node process. `async/await` is used only around I/O that is genuinely async (`axios` calls); filesystem access is synchronous throughout (`fs.readFileSync`/`writeFileSync`/`existsSync`/`mkdirSync` in `src/storage/fileManager.js`). No worker threads.
- **Global state:** `Config` is a `require`-cache singleton (`src/config/index.js:101`) — shared by every layer that requires `src/config`, with constructor-time validation that runs exactly once per process. `SynexusConfig` deliberately avoids this pattern (see Key Abstractions).
- **Circular imports:** none observed. Every `src/*` file requires only `axios`/`crypto`/`fs`/`path`/Node builtins, or nothing at all — no layer requires a sibling layer. All cross-layer wiring happens exclusively in `index.js`.
- **Single orchestrator, dual contract awareness:** `TaxCommandHandler` is the only class in the repository aware that both `v1` and `v2` exist. Neither `TaxValidator`'s two validation paths nor the two API clients know about each other. Extending to a third contract means widening this same file's branch again, not touching the leaves.
- **v1 freeze boundary:** `src/api/taxApiClient.js` and the v1 surface of `src/config/index.js` / `src/validators/taxValidator.js` are protected by regression tests (`tests/v1Freeze.wire.test.js`, `tests/v1Freeze.messages.test.js`) asserting on exact wire shape and exact error message strings. Any structural refactor to these files that changes observable behavior fails `npm test` by design.

## Anti-Patterns

### Aggregator reentry across contracts

**What happens:** `TaxValidator.validate()` (`src/validators/taxValidator.js:160-168`) is the v1 aggregator (`validateOperation` → `validateRequestBody` → `validateCommittedField` → `sanitizeStringFields`). It is tempting to call it from `_executeV2` too, or to add v2-specific checks inside it.

**Why it's wrong:** `validateCommittedField` reads `requestBody.Committed` (capital C, a v1-only field). A real v2 file never carries it, so `validate()` would reject every valid v2 request. This exact mistake was made and reverted during Phase 1 planning (see `.planning/STATE.md` § Blockers/Concerns).

**Do this instead:** call the granular validator methods directly from `_executeV2` (`src/cli/taxCommandHandler.js:213,216`) and keep v2-only rules in the sibling method `validateV2IntentFields` (`src/validators/taxValidator.js:68-112`) — never inside `validate()`.

### Reintroducing the provider's default `transaction_type`

**What happens:** omitting `transaction_type: 'sales_estimate'` from the v2 body, or setting only `committed: false`.

**Why it's wrong:** the Synexus provider's own default for `transaction_type` is `sales_invoice`, and `committed: false` alone does **not** suppress persistence — the provider still stores an invoice snapshot unless `transaction_type` is explicitly `sales_estimate`. A refactor that "simplifies" `buildRequestBody` to drop the explicit type would silently start persisting a fiscal record for every quote.

**Do this instead:** `getIntentFor` (`src/api/synexusRequestBuilder.js:42-59`) has no `else` branch with a default — unmapped operations throw instead of falling through. `_assertIntentFieldsPresent` (`:118-136`) re-checks the built body before it can be sent. `tests/v2QuoteEndToEnd.test.js` is the regression guard; do not weaken it to assert only on `committed`.

### Printing the v2 credential (mirrors an accepted v1 defect)

**What happens:** `TaxApiClient` (v1, frozen) prints the full request URL including `?code=<API_CODE>` (`src/api/taxApiClient.js:32`) — a known, accepted defect that cannot be fixed without changing v1's observable output. Doing the equivalent for v2 — logging the `headers` object, or passing the raw axios `error` (whose `error.config` carries the `Authorization` header) to `console.error`/`logger.error` — would leak the bearer key to stdout and to the log file.

**Why it's wrong:** the v2 credential travels only in a header, by design, specifically so it never appears in a URL, a log line, or a stack trace.

**Do this instead:** `SynexusApiClient._handleError` (`src/api/synexusApiClient.js:107-121`) has an explicit code comment forbidding serialization of `error.config`/`error.request`/`error.toJSON()`; only `error.code`, `error.message`, `error.response.status`, `error.response.data` are read. `SynexusConfig.printProfile`/`_maskApiKey` (`src/config/synexusConfig.js:236-260`) is the only sanctioned way to show the key (recognized prefix + last 4 characters).

## Error Handling

**Strategy:** throw-and-catch, not error codes or Result types. Every validation/business-rule failure is `throw new Error(<Spanish message>)`. The CLI's top-level `execute()` catch (`src/cli/taxCommandHandler.js:185-189`) logs via `_handleError` and re-throws; `index.js`'s catch (`index.js:82-86`) is the only place that prints the generic operator-facing failure line and calls `process.exit(1)`.

**Patterns:**
- The "trio": `console.error(msg)` + `this.logger.error(msg)` + `throw new Error(msg)`, repeated verbatim across every layer (e.g., `src/validators/taxValidator.js:26-28`, `:74-78`; `src/api/taxApiClient.js:78-80`). Exception: `SynexusConfig`'s constructor-time errors (`src/config/synexusConfig.js:56-57` etc.) skip `logger.error` because no `Logger` instance exists yet at that point in `index.js`'s wiring — only `console.error` + `throw`.
- HTTP error classification is duplicated, not shared: both `src/api/taxApiClient.js:97-141` and `src/api/synexusApiClient.js:122-166` implement the same `if`/`else if` chain over `error.code`/`error.response`/`error.request` independently. There is no shared error-classification helper between the two clients.
- No custom `Error` subclasses anywhere in the codebase; no `error.code` attached to thrown errors. Discrimination happens by message string only — which is exactly what the v1-freeze tests assert on.

## Cross-Cutting Concerns

**Logging:** winston, error-level only, one file per process day (`src/infrastructure/logger.js:33-51`, date computed once at construction). Every meaningful step also duplicates to `console.log`/`console.error` for interactive/ERP-wrapper visibility — logging is console + file in parallel, not a single funnel.

**Validation:** two independent validation paths by convention rather than a shared pipeline — the v1 aggregator (`validate()`) and the v2 granular sequence orchestrated by `_executeV2`. Both live in the same `TaxValidator` class but are never both exercised on the same request.

**Authentication:** v1 — API code in the URL query string, visible in console/log output (accepted defect, frozen by `COMP-01`). v2 — bearer key in the `Authorization` header only, deliberately never logged raw (`SynexusConfig._maskApiKey`/`printProfile`).

---

*Architecture analysis: 2026-09-11*
