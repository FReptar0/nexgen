# Coding Conventions

**Analysis Date:** 2026-09-11

No linter and no formatter are configured anywhere in this repository (no
`.eslintrc*`, no `eslint.config.*`, no `.prettierrc*`, no `biome.json`, no
lint/format `devDependency` in `package.json`). Every convention below is
enforced by human consistency and copy-from-the-nearest-analog, not by
tooling — verified by reading all 9 files in `src/`, `index.js`, and the
`tests/` suite, and by `grep` for the boundary rules called out below.

## Naming Patterns

**Files:**
- `camelCase.js`, matching the class it exports, lower-cased: `taxCommandHandler.js` exports `TaxCommandHandler`, `synexusApiClient.js` exports `SynexusApiClient`, `fileManager.js` exports `FileManager`.
- Test files: `<subject>.test.js` under `tests/`, either mirroring one `src/` module (`synexusConfig.test.js` ↔ `src/config/synexusConfig.js`) or named after the guarantee it protects when it spans multiple files (`v1Freeze.wire.test.js`, `v2QuoteEndToEnd.test.js`).
- One shared test helper file: `tests/helpers/fakes.js`. No other shared helpers exist — see `TESTING.md` §Fixtures.

**Functions/Methods:**
- Public methods: camelCase verbs — `validateOperation`, `makeRequest`, `resolveEntityCode`, `getEndpointUrl`, `parseArguments`.
- Private/internal helpers: single leading underscore + camelCase — `_handleResponse`, `_handleError`, `_saveResponse`, `_validateRequiredEnvVars`, `_ensureLogDir`, `_createLogger`, `_handleFileReadError`, `_listSimilarFiles`, `_maskApiKey`, `_getConfiguredUrl`, `_findKeyPrefix`, `_validateKeyHostMatch`, `_generateRequestId`, `_assertIntentFieldsPresent`, `_executeV2`. This is a naming convention only — the language-level `#private` syntax is never used anywhere in the repo.

**Variables:**
- camelCase everywhere: `requestBody`, `sanitizedRequestBody`, `resolvedEntityCode`, `axiosCallArgument`.
- No `UPPER_SNAKE_CASE` constants, including for fixed lists. Lists that another codebase might hoist to a module-level constant are instance properties assigned in the constructor instead: `this.validOperations = ['get_tax', 'post_tax', 'cancel_tax']` (`src/validators/taxValidator.js:15`), `this.knownFlags = ['--api-version=', '--entity=']` (`src/cli/taxCommandHandler.js:37`), `this.entityHeaderName = 'X-Synexus-Entity'` (`src/api/synexusApiClient.js:32`), `this.keyPrefixHosts = {...}` (`src/config/synexusConfig.js:29`). Follow this shape for any new fixed list — do not introduce a top-level `const FOO = [...]`.

**Classes:**
- PascalCase, exactly one exported class per file, matching the filename: `TaxValidator`, `TaxApiClient`, `TaxCommandHandler`, `FileManager`, `Logger`, `Config`, `SynexusConfig`, `SynexusApiClient`, `SynexusRequestBuilder`.

**Types:**
- No TypeScript, no JSDoc `@typedef` catalog. Object shapes are documented inline via JSDoc `@param`/`@returns`, e.g. `@returns {{ transaction_type: string, committed: boolean }}` (`src/api/synexusRequestBuilder.js:39`).

## Code Style

**Formatting:**
- No tool. Style consistency observed across every `src/` file and `tests/`: 4-space indentation, single quotes for strings, semicolons always, template literals for interpolation, arrow functions for inline callbacks (`.map`, `.filter`, `.find`, `beforeEach`/`it` bodies).
- Double quotes are used only when the string literal itself contains an apostrophe, to avoid escaping: `body.customer_id = "Plummer's";` (`tests/argumentParsing.test.js:371`). Do not escape apostrophes inside single-quoted test fixtures — switch the outer quote to double instead.

**Linting:**
- None configured. When adding new code, match the nearest existing file in the same directory rather than inventing a new shape.

## Import Organization

**Order:**
1. Node builtins (`path`, `crypto`, `fs`, `http`, `https`)
2. Third-party packages (`axios`, `dotenv`, `winston`)
3. Local `src/...` requires (relative paths)

Every `src/` file and `index.js` opens with a `// path/to/file.js` header comment naming its own repo-relative path, before any `require` statement. Add this header to any new file.

**Path Aliases:**
- None. All local requires are relative (`require('../config')`, `require('./src/config')`). There is no `tsconfig.json`/`jsconfig.json` defining `paths`.

**Module System:**
- CommonJS exclusively (`require` / `module.exports`). No `import`/`export` syntax, no `"type": "module"` in `package.json`. Do not introduce ESM syntax — Node 14 (the stated minimum, see root `CLAUDE.md`) does not support it without a flag.

## Error Handling

The dominant pattern — used at essentially every validation and failure point across `src/validators/taxValidator.js`, `src/api/taxApiClient.js`, `src/api/synexusApiClient.js`, `src/api/synexusRequestBuilder.js`, `src/cli/taxCommandHandler.js`, and `src/config/*.js` — is the **"trío del fallo"** (fail trio): build the message once, print it, log it, then throw a plain `Error` constructed from the same string.

```javascript
const errorMsg = 'Mensaje en español que explica qué pasó y qué se esperaba.';
console.error(errorMsg);
this.logger.error(errorMsg);
throw new Error(errorMsg);
```

Real example (`src/validators/taxValidator.js:41-44`):
```javascript
const errorMsg = 'Para la operación get_tax, el valor "Committed" debe ser false.';
console.error(errorMsg);
this.logger.error(errorMsg);
throw new Error(errorMsg);
```

**Rules to follow for any new failure path:**
- Always `new Error(message)`. No custom `Error` subclasses, no `error.code`, no discriminated result objects (`{ ok: false, error }` is never used anywhere in this repo).
- Errors are thrown, never returned. `TaxCommandHandler.execute()` (`src/cli/taxCommandHandler.js:142-190`) is the one place that catches broadly — `_handleError(error)` prints/logs, then **re-throws**. `index.js`'s `main()` (`index.js:37-87`) is the only `try/catch` in the whole codebase that swallows: it prints one generic Spanish message and calls `process.exit(1)` — see `src/infrastructure/logger.js`/`index.js:82-86`.
- `logger.error` calls often append machine-diagnosable context after the human message, joined with ` - `: `` `${errorMsg} - URL: ${url} - Operation: ${operation}` `` (`src/api/taxApiClient.js:79`; mirrored in `src/api/synexusApiClient.js:96,159` and `src/api/synexusRequestBuilder.js:57`).
- State-transition guards (`Committed`/`committed` fields) always compare with strict `===`/`!==`, never truthy checks: a string `"false"` or a numeric `0` must be rejected exactly like an explicit contradiction (`src/validators/taxValidator.js:82,93` — `validateV2IntentFields`; exercised heavily in `tests/v2IntentValidation.test.js`).
- Guard order matters and is commented with numbered steps precisely because later validations assume earlier ones already ran (e.g. `validateV2IntentFields` checks the v1 "Committed" leak *before* checking the intent-contradiction cases, `src/validators/taxValidator.js:68-111`). Preserve existing guard ordering when editing; add new guards at the position their comment block indicates, not just appended at the end.
- A discriminated-result-type alternative to throwing is discussed in `ARCHITECTURE.md` (`SAFE-05`) but is explicitly deferred — do not introduce it without an explicit ask.

## Logging

**Framework:** `winston` (`src/infrastructure/logger.js`), wrapped in a project `Logger` class with exactly four public methods: `error`, `info`, `warn`, `debug`. Both the winston logger and its single file transport are constructed with `level: 'error'`, and the log file name embeds the date at **construction** time (`log_<YYYY-MM-DD>.log`).

**Patterns:**
- `console.log` / `console.error` is the operator-facing trace channel (stdout/stderr) — used liberally for request/response tracing, saved-file paths, and step-by-step progress. This is intentional, not leftover debug code (root `CLAUDE.md`: "Use `console.log` for trace output").
- `logger.error` is reserved for the persisted audit trail. Every thrown error is logged via the trío above (or via the centralized `_handleError` catch in `src/cli/taxCommandHandler.js:284-287`) immediately before or during the throw.
- `logger.info` / `logger.warn` / `logger.debug` are wired but are **no-ops in practice**: the file transport's `level: 'error'` silently drops anything less severe. Do not rely on them for anything that must be observable — use `console.log`.
- Never print or log secrets. `src/api/synexusApiClient.js:107-116` carries an explicit warning comment: never serialize `error.config`, `error.request`, or call an axios error's `toJSON()`, because those objects embed the full outgoing request including the `Authorization: Bearer <key>` header. `_handleError` in both API clients hand-picks only `error.code`, `error.message`, `error.response.status`, and `error.response.data` for display.

## Comments

**When to Comment:**
- Every file (all of `src/`, `index.js`) opens with a `// path/to/file.js` header before any code.
- Every class carries a JSDoc block stating its architectural layer, its single responsibility in one sentence, and — for most classes — the SOLID principle and pattern it embodies, e.g. `Principio SOLID: Single Responsibility Principle (SRP)`, `Patrón: Dependency Injection` (`src/api/taxApiClient.js:4-9`, `src/storage/fileManager.js:5-9`, `src/validators/taxValidator.js:3-7`).
- Non-obvious business rules get a prose comment explaining **why**, not just what: e.g. `src/api/synexusRequestBuilder.js:13-17` on why the intent fields must never be inherited from the input file, `src/config/synexusConfig.js:3-9` on the load-order fragility between `src/config/index.js` and `synexusConfig.js`.
- Multi-step orchestration methods use inline numbered comments per step (`// 1. ...`, `// 2. ...`) — see `execute()` and `_executeV2()` in `src/cli/taxCommandHandler.js`. Preserve step numbers when inserting a new step; several tests assert call order against these exact steps.

**Language split (non-negotiable, verified across every file):**
- **Spanish:** every JSDoc body, every inline comment, every user-facing or logged error string.
- **English:** every identifier — class name, method name, variable name, file name (camelCase / PascalCase).

Do not mix these. A new error message in English, or a new method named in Spanish, is a convention violation.

**JSDoc:**
- Public methods document `@param`, `@returns`, and `@throws` where applicable; `@private` marks internal helpers in addition to the underscore prefix. `tests/helpers/fakes.js` follows the same JSDoc style for its factory functions.

## Function Design

**Size:** Small, single-purpose methods are the norm. The exceptions are the multi-step orchestrators (`TaxCommandHandler.execute`, `TaxCommandHandler._executeV2`), which stay as one long method with numbered inline comments rather than being split into many tiny private methods — because the step order itself is the contract under test.

**Parameters:** Always positional, never an options object — including for dependency injection. `TaxCommandHandler`'s constructor takes eight positional collaborators (`config, logger, fileManager, validator, apiClient, synexusConfig, requestBuilder, synexusApiClient` — `src/cli/taxCommandHandler.js:23`). When adding a ninth collaborator, extend the positional list (and every call site, including every test that constructs the class) — do not switch to a config object.

**Return Values:** A method returns either a plain value/object or a `Promise` (every HTTP call and every file write is `async`). No `{ success, data }`-style result wrapper is used anywhere.

## Module Design

**Exports:** `module.exports = ClassName` in every file under `src/`, with exactly one exception: `src/config/index.js` exports an **already-constructed singleton** — `module.exports = new Config()` — because its constructor validates required env vars once, at process start, and every consumer should share that one validated instance. Do not replicate the singleton pattern in `src/config/synexusConfig.js`: it deliberately exports the **class**, so `index.js` can construct it conditionally, only once the resolved API contract is `v2` (`index.js:60-65`). A server with no `SYNEXUS_*` variables must be able to keep running v1 untouched.

**Barrel Files:** None. No `src/*/index.js` re-export barrels other than `src/config/index.js` itself (which is a real module, not a barrel). Every consumer requires the concrete file directly, e.g. `require('../config/synexusConfig')`, never a re-exported alias.

**Dependency injection:** Wired exclusively in `index.js`'s `main()`, in one fixed bottom-up order: infrastructure (`Logger`) → storage (`FileManager`) → validation (`TaxValidator`) → API (`TaxApiClient`, `SynexusRequestBuilder`) → contract resolution (`TaxCommandHandler.resolveApiVersion`, then conditionally `SynexusConfig`/`SynexusApiClient`) → CLI (`TaxCommandHandler`). No layer `require`s a sibling layer directly; collaborators only ever arrive through a constructor argument. See `ARCHITECTURE.md` for the full layer diagram.

**Boundary rules enforced by convention only (each verified directly with `grep -rn` across `src/` and `index.js` on 2026-09-11 — not by a linter):**
- **`axios`** is required in exactly two files, both under `src/api/`: `src/api/taxApiClient.js` (v1) and `src/api/synexusApiClient.js` (v2). Never `require('axios')` from `src/cli/`, `src/validators/`, `src/config/`, or `src/storage/`.
- **`fs`** is required in exactly two files: `src/storage/fileManager.js` (all business-data file I/O — reading/writing JSON, checking existence, listing a directory) and `src/infrastructure/logger.js` (`_ensureLogDir` only, to create the log directory before winston's file transport is constructed). This is narrower than "FileManager owns all filesystem access" — `Logger` has its own single, bounded `fs` use for bootstrap. Do not add a third file that touches `fs` directly; route new file I/O through `FileManager`.
- **`process.env`** is read directly in exactly two files, both under `src/config/`: `src/config/index.js` (v1 settings) and `src/config/synexusConfig.js` (v2 settings). Every other layer receives configuration exclusively through the injected `config`/`synexusConfig` object's getter methods (`getBaseUrl()`, `getApiKey()`, `isTestMode()`, etc.) — never `process.env` directly.
- **`process.exit`** is called exactly once, in `index.js:85`, inside `main()`'s top-level `catch`. No other file calls `process.exit`; a thrown `Error` is always the mechanism for surfacing failure up to that one call site.

---

*Convention analysis: 2026-09-11*
