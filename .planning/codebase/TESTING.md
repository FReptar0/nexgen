# Testing Patterns

**Analysis Date:** 2026-09-10

## Test Framework

**Runner:**
- None installed. `package.json` has no `devDependencies` block at all, and no test runner (Jest, Mocha, Vitest, `tap`, `node:test`) appears in `package.json`, `package-lock.json`, or `node_modules/`.
- Config: none present. `jest.config.*`, `vitest.config.*`, `.mocharc*` do not exist anywhere in the repo.

**Assertion Library:**
- None installed.

**Run Commands:**
```bash
npm test    # runs the package.json placeholder script:
            #   "echo \"Error: no test specified\" && exit 1"
            # Always fails immediately. Does not execute any application code.
```
There is no watch-mode command and no coverage command — neither is implemented.

## Test File Organization

**Location:** Not applicable. No test files exist anywhere in the repository. Confirmed via repo-wide search: zero `*.test.js` or `*.spec.js` files outside `node_modules`.

**Naming:** Not established by any existing code. `ARCHITECTURE.md` §10 recommends a `__tests__` folder alongside each `src/<layer>/` directory (mirroring the existing one-folder-per-layer structure), but this has not been implemented — treat it as a plan, not a current pattern.

**Structure:** N/A — no tests to describe.

## Test Structure

Not applicable. No `describe`/`it`/`test` blocks exist in the codebase to derive a pattern from.

## Mocking

**Framework:** None installed (no `jest.mock`, `sinon`, `nock`, `msw`, or manual mock directories exist).

**What would need mocking if a suite is added** (per `ARCHITECTURE.md` §10, not yet implemented):
- `axios` — `TaxApiClient.makeRequest` (`src/api/taxApiClient.js:29`) is the only HTTP boundary in the entire codebase. Every other layer is synchronous/pure and does not touch the network.
- `fs` — `FileManager` (`src/storage/fileManager.js`) wraps every filesystem read/write via the synchronous API (`existsSync`, `readFileSync`, `writeFileSync`, `mkdirSync`, `readdirSync`). Mocking these calls would isolate `FileManager` — and everything downstream of it — from disk.
- `dotenv` — `src/config/index.js:3` calls `require('dotenv').config(...)` at module load time, and the module exports a singleton (`module.exports = new Config();`, line 91). Testing `Config` requires either controlling `process.env` *before* the singleton is first required, or resetting the module registry (`jest.resetModules()`) between test cases, since re-requiring the same module returns the cached singleton instance.

**What NOT to mock (architectural guidance, not an existing test convention):**
- Don't reach into a collaborator's internals from a test of the layer above it. Every class in `src/` is constructor-injected (`docs/MEMORY.md` decisions D1/C3), specifically so each one can be unit-tested in isolation. A test of `TaxCommandHandler` should inject fakes/mocks for its five collaborators (`config, logger, fileManager, validator, apiClient` — the exact constructor signature at `src/cli/taxCommandHandler.js:20`) rather than mocking `fs`/`axios` transitively through them.

## Fixtures and Factories

None exist in the repository. There is no `__fixtures__/` directory and no committed sample-payload file.

- Real client transaction JSON is explicitly excluded from git: `.gitignore` lists `results/` and `test-files` (client data, not safe to commit — see `docs/MEMORY.md` "Deuda conocida" and commit `6968cda`).
- A future test suite needs synthetic fixture payloads checked in separately from real client data — minimally: a request body with `"Committed": true`, one with `"Committed": false`, and a mock STCCalcV3-shaped response body.

## Coverage

**Requirements:** None enforced — no coverage tool is configured. `coverage/` and `.nyc_output` are listed in `.gitignore` pre-emptively, but no tool that would populate them (`nyc`, `c8`, Jest's `--coverage`) is installed.

**View Coverage:**
```bash
# Not available — no coverage tooling installed.
```

## Test Types

**Unit Tests:** Not implemented. `ARCHITECTURE.md` §10 identifies the highest-value first targets, in the codebase's own recommended order:
- `Config.getEndpointUrl` (`src/config/index.js:65`) with `TEST_MODE` on and off — a pure function of env state once the singleton is constructed; the easiest first test to write.
- `TaxValidator.validateCommittedField` (`src/validators/taxValidator.js:38`) for all three operations, happy and unhappy paths (strict `===` checks on `Committed`).
- `TaxValidator.sanitizeStringFields` (`src/validators/taxValidator.js:76`) — apostrophe replacement, nested objects, arrays, confirming the original object is not mutated (implementation clones via `JSON.parse(JSON.stringify(...))`).
- `FileManager.getResponseFileName` (`src/storage/fileManager.js:163`) — path joining, basenames, trailing separators, the `RESPONSE_` prefix contract.
- `TaxApiClient._handleResponse` (`src/api/taxApiClient.js:66`) decision table — 2xx pass-through, `status >= 400` throws, response body shape in the thrown error message.

**Integration Tests:** Not implemented. Would need to cover `TaxCommandHandler.execute` (`src/cli/taxCommandHandler.js:53-92`) end-to-end with `fs` and `axios` mocked, verifying the full 8-step orchestration: parse args → validate operation → check file exists → read JSON → validate + sanitize → call API → save response → log success.

**E2E Tests:** Not used in an automated form. The `postman/` directory exists (currently untracked/uncommitted — see git status) as the manual alternative: it exercises the live `STCCalcV3`/`STCCalcV3_TEST` endpoint by hand rather than through an automated suite.

## Common Patterns

**Async Testing:** N/A — no tests exist yet. When added: `TaxApiClient.makeRequest` and everything upstream of it (`TaxCommandHandler.execute`, `main()` in `index.js:34`) is `async`, so any test harness must `await` the call or return the promise. `FileManager` and `Logger` are fully synchronous and need no async test handling.

**Error Testing:** N/A — no tests exist yet. Because every failure path in this codebase is `throw new Error(stringMessage)` rather than a typed/custom error class (see `CONVENTIONS.md` "Error Handling"), future assertions need to match on `error.message` content — e.g. `expect(() => validator.validateCommittedField('get_tax', { Committed: true })).toThrow('Para la operación get_tax, el valor "Committed" debe ser false.')` — rather than on an error type or `.code` property, since none is ever set.

## Closing the Gap

This is a **known, documented gap**, not an oversight to silently work around. `docs/MEMORY.md` ("Deuda conocida") states the `package.json` test placeholder has existed since the first commit; `ARCHITECTURE.md` §10 and `README.md` ("Coming soon — test suite with Jest") both point at the same unimplemented plan. If a suite is introduced, follow that existing plan rather than inventing a new one:

1. Add `jest` as a `devDependency` (`npm install --save-dev jest`) and configure `testEnvironment: 'node'` in a new `jest.config.js`.
2. Mirror the existing layer layout with `src/<layer>/__tests__/` folders (e.g. `src/validators/__tests__/taxValidator.test.js`).
3. Replace the `package.json` `"test"` script (currently `echo "Error: no test specified" && exit 1`) with `jest`.
4. Start with the five pure/isolatable unit-test targets listed above before attempting an end-to-end test of `TaxCommandHandler`, since those five need no `fs`/`axios` mocking at all (`Config`, `TaxValidator`) or only one dependency mocked each.
5. Per `CLAUDE.md` ("Workflow expectations for Claude"): introducing a test framework is a behavior/tooling change and needs an explicit ask before implementation, even though the plan itself is already documented in this repo.

---

*Testing analysis: 2026-09-10*
