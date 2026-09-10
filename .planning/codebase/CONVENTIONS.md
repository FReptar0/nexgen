# Coding Conventions

**Analysis Date:** 2026-09-10

## Naming Patterns

**Files:**
- English camelCase for every implementation file: `taxApiClient.js`, `taxCommandHandler.js`, `taxValidator.js`, `fileManager.js`, `logger.js`.
- Each layer directory's module file is named `index.js` when it exports a singleton (`src/config/index.js`); otherwise the file is named after its class (`src/api/taxApiClient.js`).
- Root entry point is `index.js`.

**Functions/Methods:**
- camelCase always: `makeRequest`, `validateOperation`, `getEndpointUrl`, `sanitizeStringFields`, `ensureDirectory`.
- Private/internal helper methods are prefixed with a leading underscore: `_handleResponse`, `_handleError`, `_saveResponse`, `_validateRequiredEnvVars`, `_ensureLogDir`, `_createLogger`, `_handleFileReadError`, `_listSimilarFiles`. This is a naming convention only — JavaScript's `#private` syntax is never used, so these are still callable from outside the class.

**Variables:**
- camelCase: `requestBody`, `filePath`, `outputDir`, `sanitizedRequestBody`, `responseFileName`.
- No `UPPER_SNAKE_CASE` module-level constants exist anywhere. Fixed lists live as instance properties assigned in the constructor, e.g. `this.validOperations = ['get_tax', 'post_tax', 'cancel_tax'];` (`src/validators/taxValidator.js:15`), not as exported top-level constants.

**Classes:**
- PascalCase, exactly one class per file, name matches the file's purpose: `TaxCommandHandler` (`src/cli/taxCommandHandler.js`), `TaxValidator` (`src/validators/taxValidator.js`), `TaxApiClient` (`src/api/taxApiClient.js`), `FileManager` (`src/storage/fileManager.js`), `Logger` (`src/infrastructure/logger.js`), `Config` (`src/config/index.js`).

**Directories:**
- Lowercase, one per architectural layer, named for the layer's role (not the domain): `cli/`, `validators/`, `api/`, `storage/`, `infrastructure/`, `config/`.

## Code Style

**Formatting:**
- No formatter or linter is configured anywhere in the repo — no `.eslintrc*`, `eslint.config.*`, `.prettierrc*`, or `biome.json` exist. Style is enforced by convention/review only. `CLAUDE.md` confirms this explicitly: "No tests, no CI, no linter."
- Indentation: 4 spaces, consistent across every file in `src/` and `index.js`.
- Quotes: single quotes for string literals (192 single-quote characters vs. 24 double-quote characters across the codebase). Double quotes appear only *inside* string content — e.g. quoting an operation name in a user-facing message (`'Para la operación get_tax, el valor "Committed" debe ser false.'` in `src/validators/taxValidator.js:41`) — never as the JS string delimiter itself.
- Semicolons: always present; no reliance on ASI.
- Template literals (`` `...${x}...` ``) are used for interpolation; plain string concatenation with `+`/`+=` only appears for building multi-line messages (`src/cli/taxCommandHandler.js:36-37`, `src/api/taxApiClient.js:98-129`).
- Callbacks: arrow functions for inline callbacks (`.forEach`, `.filter`, the `JSON.stringify` replacer in `src/validators/taxValidator.js:79`). One exception uses the `function` keyword — the axios `validateStatus` option (`src/api/taxApiClient.js:44`). Prefer arrow functions for new inline callbacks to match the dominant pattern.

**Linting:**
- None configured. Treat a pattern repeated 2+ times across files as the de facto rule; otherwise follow this document.

## Import Organization

**Order (consistent in every file that has more than one import):**
1. Node built-ins (`path`, `fs`)
2. Third-party packages (`axios`, `winston`, `dotenv`)
3. Local/relative requires — only `index.js` does this, requiring each `./src/<layer>` module in construction order.

**Style:**
- CommonJS exclusively: `require(...)` / `module.exports = ClassName`. No ESM `import`/`export` anywhere; `package.json` has no `"type": "module"`.
- Never destructure a require: always `const Name = require('module')`, never `const { x } = require('module')`.
- No path aliases. All requires are relative (`./src/...`) or bare package names.
- No barrel/index re-export files. `src/config/index.js` is the module itself (a singleton instance), not an aggregator of other modules.

## Error Handling

**Pattern: throw/catch only, never result objects.**
- Every layer that detects an invalid state does `throw new Error('<Spanish message>')`. There are no custom `Error` subclasses anywhere in the codebase (no `.code` property, no `TaxValidationError` class) — always the built-in `Error`.
- The `return { ok: false, error }` pattern is never used (confirmed by `docs/MEMORY.md` convention C4 — "No se usa el patrón `return { ok: false, error: ... }`. Todo es throw/catch.").
- Errors are logged at the point of detection (`console.error(...)` then `this.logger.error(...)`) and then re-thrown, so a single failure can print at multiple layers on its way up before `index.js` prints the final `\n❌ La operación falló. Revise los logs para más detalles.` and calls `process.exit(1)`.
- `index.js:34-66` (`main()`) contains the *only* top-level `try/catch` that terminates the process. Every other `try/catch` in the codebase re-throws after logging — see `src/cli/taxCommandHandler.js:87-92` and `src/api/taxApiClient.js:51-54`.
- Each layer implements its own private `_handleError`/`_handleResponse`/`_handleFileReadError` method so the catch block's formatting/diagnostic logic stays out of the main method body — this "catch-and-translate" helper is repeated in `taxCommandHandler.js`, `taxApiClient.js`, and `fileManager.js`.

**Example (`src/validators/taxValidator.js:38-46`):**
```javascript
validateCommittedField(operation, requestBody) {
    if (operation === 'get_tax') {
        if (requestBody.Committed !== false) {
            const errorMsg = 'Para la operación get_tax, el valor "Committed" debe ser false.';
            console.error(errorMsg);
            this.logger.error(errorMsg);
            throw new Error(errorMsg);
        }
    } else if (operation === 'post_tax') {
        // ... same pattern, inverted condition
    }
    // cancel_tax no valida el campo Committed
}
```

## Logging

**Framework:** winston, wrapped by the `Logger` class in `src/infrastructure/logger.js`.

**Patterns:**
- `logger.error(message)` is the only method that actually persists to disk — the winston instance is hard-coded to `level: 'error'` (`src/infrastructure/logger.js:35`). `logger.info`, `logger.warn`, and `logger.debug` exist as methods but are no-ops at the file transport; do not rely on them for anything that must be recorded.
- Use `console.log` for trace/progress output aimed at a human or wrapper process watching stdout — this is the de facto "info channel" in this codebase (there is no gated log-level check before `console.log` calls).
- Use `console.error` for stderr-visible errors, always paired with a `this.logger.error(...)` call carrying the same or a more detailed message.
- Messages passed to `logger.error` should carry enough context to diagnose without re-reading the source — operation name, URL, file path — e.g. `` `${errorMsg} - Operation: ${operation} - URL: ${url}` `` (`src/api/taxApiClient.js:133`).
- Never call `process.env` or `fs`/`axios` directly to implement logging elsewhere — always go through the injected `Logger` instance.

## Comments

**When to Comment:**
- Every public method gets a full JSDoc block (`@param`, `@returns`, `@throws`) written in Spanish, even when the method is short and its behavior looks self-explanatory from the name.
- Every file opens with a single-line comment giving its repo-relative path, e.g. `// src/validators/taxValidator.js`. This is present in all 7 source files without exception — add it to any new file.
- Every class has a JSDoc block above it stating its "Responsabilidad" (single responsibility) and which SOLID principle it embodies, e.g. `src/storage/fileManager.js:5-9`.
- Inline comments explain *why*, not *what*, and are written in Spanish — e.g. `// cancel_tax no valida el campo Committed` (`src/validators/taxValidator.js:54`).

**Language split (do not violate):**
- Spanish: JSDoc bodies, inline comments, all user-facing and logged error strings.
- English: class names, method names, variable names, file names.

## Function Design

**Size:** Small and single-purpose. The largest method in the codebase is `_handleError` in `src/api/taxApiClient.js` (~45 lines, lines 97-141) — it is a linear `if`/`else if` chain over `error.code` / `error.response` / `error.request`, not deep nesting.

**Parameters:** Positional, never an options-object. Constructors take collaborators positionally in a fixed DI order — e.g. `constructor(config, logger, fileManager, validator, apiClient)` in `TaxCommandHandler` (`src/cli/taxCommandHandler.js:20`). Methods rarely exceed 3 parameters.

**Return Values:** Methods return a plain value/object on success (`getEndpointUrl` returns a string, `validate` returns the sanitized request body) or return nothing and rely on a thrown exception for the failure path. No method returns `null`/`undefined`/`false` to signal failure — that would break the throw/catch convention above.

**Async:** `async`/`await` is used only for the one genuinely asynchronous boundary — `TaxApiClient.makeRequest` (`src/api/taxApiClient.js:29`) and everything upstream that calls it (`TaxCommandHandler.execute`, `main()`). All filesystem calls use the *synchronous* `fs` API (`readFileSync`, `writeFileSync`, `existsSync`, `mkdirSync`, `readdirSync` — see `src/storage/fileManager.js` and `src/infrastructure/logger.js`); `fs.promises` is never used. Do not introduce async fs calls without updating the full call chain above `FileManager` — it currently assumes synchronous file I/O throughout.

## Module Design

**Exports:**
- Every file in `src/` except `src/config/index.js` exports a bare class: `module.exports = ClassName`. Instantiation and wiring happens exclusively in `index.js`.
- `src/config/index.js` is the one exception: it exports a singleton instance (`module.exports = new Config();`), not the class. `docs/MEMORY.md` (decision D9) documents this as deliberate — load `.env` once via `dotenv` at `require` time and share the same instance everywhere, rather than each layer loading its own copy.

**Barrel Files:** None. No module re-exports another module's exports.

**Dependency Injection:**
- Strict discipline: a layer never `require`s another layer directly. The only exception is `Config`, a legitimate cross-cutting singleton. All other collaborators are passed into the constructor.
- Construction order in `index.js:34-59` is bottom-up: `Logger` → `FileManager` → `TaxValidator` → `TaxApiClient` → `TaxCommandHandler`. When adding a new layer/class, wire it the same way in `index.js` (constructor injection, bottom-up) rather than letting the new class `require` its own dependencies.

**Hard-coded constants (changing these is a wire-level/behavioral change — see `docs/MEMORY.md` C6 and `CLAUDE.md` "Do not touch lightly"):**
- `STCCalcV3`, `STCCalcV3_TEST`, `CancelTransaction` — endpoint name fragments, `src/config/index.js:70,75`.
- `RESPONSE_` — response filename prefix, `src/storage/fileManager.js:165`.
- `30000` — HTTP timeout in ms, `src/api/taxApiClient.js:19`.
- `'error'` — winston log level, `src/infrastructure/logger.js:35`.
- `['get_tax', 'post_tax', 'cancel_tax']` — valid operations list, `src/validators/taxValidator.js:15`.

## Commit Message Style

- Historical commits are in Spanish, imperative/infinitive mood, descriptive rather than terse: `"Sanitizar campos de texto en la validación de impuestos y actualizar la documentación de TEST_MODE en README.md"` (`ed6b3f2`).
- Recent commits (post handoff-docs work) switched to Conventional Commits in English: `docs(readme): add handoff section pointing to HANDOFF and friends` (`3150ae2`), `chore(claude): configure Claude Code best-practice integration` (`0216dfe`). Prefer this newer `type(scope): summary` style going forward for consistency with the most recent history.

---

*Convention analysis: 2026-09-10*
