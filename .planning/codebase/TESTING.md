# Testing Patterns

**Analysis Date:** 2026-09-11

As of this analysis the suite is **9 test suites / 242 tests, all passing** (`npx jest` completes in well under a second — no real I/O anywhere). This is a change from the state described in the root `ARCHITECTURE.md` §10 ("no test suite") and `HANDOFF.md` ("no hay tests automatizados") — those two documents are stale on this point; `README.md`'s "Running Tests" section and this file reflect the current, real setup. The suite was introduced entirely within the current `.planning/` milestone (Synexus Compute v2 migration, Phase 1) specifically to freeze v1's observable behavior before building v2 alongside it (`COMP-01`).

## Test Framework

**Runner:**
- Jest `29.7.0`, pinned exactly (no `^`/`~` range) as the **sole** entry under `devDependencies` in `package.json`. The three runtime dependencies (`axios`, `dotenv`, `winston`) are untouched by testing infrastructure.
- Config: `jest.config.js` (repo root) — deliberately minimal, two keys:
```javascript
module.exports = {
    testEnvironment: 'node',
    setupFiles: ['<rootDir>/tests/setup.js']
};
```

**Assertion Library:**
- Jest's built-in `expect`. No `chai`, `sinon`, or other assertion/mocking library.

**Run Commands:**
```bash
npm test                                       # run all 9 suites (242 tests)
npx jest tests/synexusConfig.test.js           # run a single file
npx jest -t "CFG-05"                           # run tests whose name matches a string/regex
npx jest --watch                               # watch mode — no npm script defined, invoke jest directly
npx jest --coverage                            # coverage — no npm script defined; coverage/ is already gitignored
```
`package.json` defines only `"test": "jest"`. There is no `test:watch` or `test:coverage` script — use `npx jest <flags>` directly for anything beyond a full run.

## Test File Organization

**Location:** All tests live under `tests/`, separate from `src/` (not co-located with the modules they test).

**Naming:**
- `<subject>.test.js` mirroring one `src/` module: `synexusApiClient.test.js` ↔ `src/api/synexusApiClient.js`, `synexusConfig.test.js` ↔ `src/config/synexusConfig.js`, `synexusRequestBuilder.test.js` ↔ `src/api/synexusRequestBuilder.js`.
- Cross-cutting scenario suites, named after the guarantee they protect rather than a single source file: `v1Freeze.wire.test.js` and `v1Freeze.messages.test.js` (freeze v1's entire observable contract across four `src/` files), `v2IntentValidation.test.js` (validator + CLI branch together), `v2QuoteEndToEnd.test.js` (the whole DI graph), `argumentParsing.test.js` (CLI parsing + contract branching).
- `setup.test.js` is a smoke test *of the test harness itself* (`tests/setup.js`) — see below.

**Structure:**
```
tests/
├── setup.js                       # setupFiles entry: env stubs + network block + dotenv neutralization
├── setup.test.js                  # smoke test proving setup.js's isolation actually holds
├── helpers/
│   └── fakes.js                   # the ONE shared test-double factory
├── argumentParsing.test.js        # CLI parseArguments/resolveApiVersion + execute() contract branching
├── synexusApiClient.test.js       # v2 HTTP client: wire shape, error handling, key-leak guards
├── synexusConfig.test.js          # v2 config: startup guards, entity precedence, URL/key masking
├── synexusRequestBuilder.test.js  # v2 body construction: intent mapping, idempotency key, TEST-03 guard
├── v1Freeze.messages.test.js      # v1 error messages frozen as exact strings
├── v1Freeze.wire.test.js          # v1 HTTP method/URL/headers/timeout frozen
├── v2IntentValidation.test.js     # validateV2IntentFields + _executeV2 call sequencing
└── v2QuoteEndToEnd.test.js        # full DI graph, axios mocked, everything else real
```

**Gotcha:** do not name a fixture directory `test-files` — `.gitignore:76` ignores that exact name under a `# Test files` comment. `tests/` and `__tests__/` are safe; `coverage/` is already ignored.

## Test Structure

**Suite Organization:** `describe` blocks are written as full Spanish sentences stating the behavior being protected, and cite the requirement ID(s) from `.planning/REQUIREMENTS.md` in parentheses. `it` names continue the sentence in prose and frequently explain *why* the assertion exists, not only what it checks.

```javascript
// tests/synexusApiClient.test.js:119,163
describe('SynexusApiClient — la llamada a axios (CONN-01, CONN-02, CONN-03)', () => {
    it('autentica con el header Authorization: la palabra Bearer, un espacio y la llave (CONN-02)', () => {
        expect(synexusConfig.getApiKey).toHaveBeenCalled();
        expect(axiosCallArgument.headers.Authorization).toBe(`Bearer ${apiKey}`);
    });
});
```

Treat the requirement ID as load-bearing metadata: when a phase plan or `REQUIREMENTS.md` entry references `CONN-02`, `COMP-01`, `CFG-05`, etc., `grep -rn "CONN-02" tests/` to find every guard for it.

**Patterns:**
- Console silencing + restoration, in nearly every file's `beforeEach`/`afterEach`:
```javascript
beforeEach(() => {
    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
});
```
- `process.env` mutation is always snapshotted and restored with the `undefined → delete, else → reassign` idiom, never a blind reassignment (an absent var must stay absent after the test):
```javascript
afterEach(() => {
    if (originalTaxApiVersion === undefined) {
        delete process.env.TAX_API_VERSION;
    } else {
        process.env.TAX_API_VERSION = originalTaxApiVersion;
    }
});
```
- When multiple properties of the same thrown error need checking, catch it explicitly once rather than repeating the throwing call per assertion:
```javascript
let caught = null;
try {
    handler.parseArguments(['get_tax', 'a.json', argument]);
} catch (error) {
    caught = error;
}
expect(caught).not.toBeNull();
expect(caught.message).toContain('Argumento no reconocido');
```
- Call-order assertions collect `mock.invocationCallOrder[0]` from several different mocks into an array, then compare it to its own sorted copy — the idiom for "step N happened before step M" across unrelated collaborators (`tests/v2IntentValidation.test.js:336-347`):
```javascript
const order = [
    spies.validateRequestBody, spies.sanitizeStringFields,
    synexusConfig.resolveEntityCode, synexusConfig.printProfile,
    requestBuilder.getIntentFor, spies.validateV2IntentFields,
    requestBuilder.buildRequestBody, synexusApiClient.makeRequest
].map(fn => fn.mock.invocationCallOrder[0]);
expect(order).toEqual([...order].sort((a, b) => a - b));
```
- Parameterized cases use `it.each([...])('...%s...', (...) => {})` for input tables, e.g. rejected-argument shapes in `tests/argumentParsing.test.js:121-144` or `TAX_API_VERSION` variants at `tests/argumentParsing.test.js:63`.

## Mocking

**Framework:** Jest's built-in `jest.fn()`, `jest.spyOn()`, `jest.mock()`, `jest.isolateModules()`, `jest.doMock()`. No `sinon`, no `nock`, no HTTP-mocking library.

**Patterns:**

Literal-object doubles, not auto-mocked classes — every production class takes its collaborators positionally through the constructor, so a plain object exposing only the methods actually called is sufficient. The one shared factory is `tests/helpers/fakes.js`:
```javascript
const createFakeLogger = () => ({
    error: jest.fn(), info: jest.fn(), warn: jest.fn(), debug: jest.fn()
});

const createFakeConfig = (overrides) => Object.assign({
    getEndpointUrl: jest.fn((operation) => `https://ejemplo-v1.invalid/api/${operation}`),
    getApiVersion: jest.fn(() => 'v1')
    // ...
}, overrides || {});
```
Everything else — the eight collaborators `TaxCommandHandler` needs, provider response bodies, axios error shapes — is declared **locally inside the test file that needs it**. `fakes.js` stays deliberately small (its own header comment: "este archivo es el único ayudante común; todo lo demás va en sitio").

`jest.mock('axios')` at the top of any file exercising an HTTP client (`v1Freeze.wire.test.js`, `synexusApiClient.test.js`, `v2QuoteEndToEnd.test.js`). Both API clients `require('axios')` at module scope and invoke it **as a function** (`axios({...})`, never `axios.get(...)`), so the automock turning the export into a `jest.fn()` is the only interception point:
```javascript
jest.mock('axios');
const axios = require('axios');
// ...
axios.mockResolvedValue(fakes.createAxiosResponse(200, { total_tax: '0.00' }));
// or: axios.mockRejectedValue(someError);
const axiosCallArgument = axios.mock.calls[0][0];   // what was actually sent
```
Reset between tests with `axios.mockReset()` (clears implementation) or `axios.mockClear()` (clears call history only) in `beforeEach`.

`jest.spyOn(instance, 'method')` on a **real** `TaxValidator` or `SynexusRequestBuilder` instance when the point of the test is call order/count without losing real validation logic — a fake would make the assertion a tautology about the fake:
```javascript
const validator = new TaxValidator(fakes.createFakeLogger());
const spies = {
    validate: jest.spyOn(validator, 'validate'),
    validateCommittedField: jest.spyOn(validator, 'validateCommittedField')
};
// ... later:
expect(spies.validate).not.toHaveBeenCalled();
```

`jest.isolateModules()` + `jest.doMock('dotenv', ...)` to test `src/config/index.js`'s module-load-time throw (it validates required env vars inside its constructor, and the module exports an already-constructed singleton) without polluting the module registry for the rest of the suite:
```javascript
jest.isolateModules(() => {
    jest.doMock('dotenv', () => ({ config: () => ({ parsed: {} }) }));
    expect(() => require('../src/config')).toThrow(new Error(message));
});
```

Never mock `fs`/`http`/`https` per test — `tests/setup.js` already replaces `http.request`, `http.get`, `https.request`, `https.get` globally, once, for the whole run (see §Framework Internals below).

**What to Mock:** `axios`, always, via `jest.mock('axios')`. Any collaborator of the class under test that is not itself the subject of the test (a fake `FileManager`, a fake `SynexusConfig`, etc.) as a plain object.

**What NOT to Mock:** The real `TaxValidator`, `SynexusRequestBuilder`, and the real `config` singleton whenever the test's purpose is to prove genuine integration. Taken furthest in `tests/v2QuoteEndToEnd.test.js`, which builds the **entire production DI graph by hand**, mirroring `index.js` step for step, substituting only `axios` (mocked) and `FileManager` (a plain fake, so nothing touches disk).

## Fixtures and Factories

**Test Data:** No shared fixture directory and no JSON fixture files. Each test file declares its own small factory functions at the top of the file:
```javascript
// Cuerpo con forma v2, calcado del ejemplo de postman/synexus-v2-api.postman_collection.json.
const createV2Body = (overrides) => Object.assign({
    invoice_id: 'DEMO-001',
    customer_id: 'CUST-1',
    to_state: 'TX',
    to_zip: '75001',
    cart: [{ item_id: 'SKU-1', price: 49.99, quantity: 1, tax_code: 'TPP' }]
}, overrides || {});
```
These are re-declared per file **on purpose**, traced back in a comment to the exact Postman example they mirror (`postman/synexus-v2-api.postman_collection.json`, `postman/synexus-test.postman_environment.json`), so each file's intent stays local and self-contained rather than sharing a mutable central fixture.

**Location:** `tests/helpers/fakes.js` is the only cross-file helper — `createFakeLogger()`, `createFakeConfig(overrides)`, `createAxiosResponse(status, data)`. Everything else (`createV1Body`, `createV2Body`, `createProviderResponse`, `createAxiosError`, `buildHandler`, `buildGraph`) is file-local.

## Coverage

**Requirements:** None enforced. No `coverageThreshold` in `jest.config.js`, no CI pipeline (`CLAUDE.md`: "no tests, no CI, no linter" — CI specifically is still absent even though tests now exist).

**View Coverage:**
```bash
npx jest --coverage
```
`coverage/` is already listed in `.gitignore`, so running this locally will not accidentally stage report output.

## Test Types

**Unit Tests:** Per-class suites with literal-object doubles for every collaborator — `synexusConfig.test.js`, `synexusRequestBuilder.test.js`, most of `synexusApiClient.test.js`.

**Integration Tests:** `v2IntentValidation.test.js` and `argumentParsing.test.js` wire a **real** `TaxValidator` (and, in one nested `describe`, a real `SynexusRequestBuilder`) into `TaxCommandHandler`, with fakes for the remaining collaborators, to test cross-class call sequencing and argument shape without going through HTTP.

**End-to-End (in-process, no network):** `tests/v2QuoteEndToEnd.test.js` builds the full production dependency graph by hand — real `Config` singleton, real `TaxValidator`, real `TaxApiClient`, real `SynexusConfig`, real `SynexusRequestBuilder`, real `SynexusApiClient`, real `TaxCommandHandler` — substituting only `axios` (`jest.mock('axios')`) and `FileManager` (so nothing touches disk). This is the suite most likely to catch a dependency-injection wiring regression; consult it first when `index.js`'s DI graph changes.

**Contract-freeze regression tests:** `v1Freeze.wire.test.js` and `v1Freeze.messages.test.js` exist purely to keep the v1 path — the one running in production against Sage 300 today — byte-for-byte identical while v2 is built alongside it (`COMP-01`). Every assertion in these two files was **manually verified to fail** under a deliberate mutation (change the HTTP method, add a header, lower the timeout, rename `STCCalcV3`, insert `?code=` into `cancel_tax`'s URL, reword a validator message, invert the positional-argument order) before being committed. There is no automated mutation-testing tool (no Stryker) in the repo — this is a documented **manual discipline**, recorded per-phase in `.planning/STATE.md:76` and `.planning/phases/01-camino-v2-de-punta-a-punta-para-una-cotizaci-n/01-VERIFICATION.md`. Apply the same discipline to any new freeze/guard test: temporarily break the thing it claims to protect, confirm the suite goes red, then restore — before trusting the test.

## Common Patterns

**Async Testing:**
```javascript
await expect(handler.execute(['get_tax', 'a.json', '--api-version=v2']))
    .rejects.toThrow(new Error(v1CommittedMessage));

await expect(handler.execute(['get_tax', 'a.json'])).resolves.toBeUndefined();
```

**Error Testing — two distinct assertion strengths, used deliberately:**
- Substring match — `toThrow('cadena')` only asserts the message **contains** the string. Use for messages not considered part of a frozen contract:
```javascript
expect(() => builder.getIntentFor('post_tax')).toThrow('post_tax');
```
- Exact/frozen match — `toThrow(new Error('cadena'))` asserts full message equality. This literal equality is what "freezing" a message means in this repo (called out explicitly in a header comment in both `v1Freeze.*.test.js` files). Use it for any message a downstream consumer (the ERP wrapper, an operator runbook) depends on literally:
```javascript
expect(() => validator.validateOperation('foo')).toThrow(
    new Error('Operación inválida: "foo". Usa "get_tax", "post_tax" o "cancel_tax".')
);
```

**Credential-leak testing (project-specific — `CFG-05`, `CONN-02`):** Capture every argument passed to the `console.log`/`console.error` spies and to the fake logger's `error` mock, flatten to strings, and assert the raw API key (and any URL-embedded credential) never appears in any of them — including on error paths where `error.config.headers.Authorization` is populated exactly like axios's real error shape, but must never be serialized:
```javascript
const expectNoCredentialLeak = () => {
    const output = capturedConsoleOutput();
    expect(output.length).toBeGreaterThan(0);
    output.forEach(line => {
        expect(line).not.toContain(apiKey);
        expect(line).not.toContain('Bearer ');
    });
};
```
See `tests/synexusApiClient.test.js:93-106` for the full helper. Reuse this shape for any new credential the project introduces.

## Framework Internals — `tests/setup.js` (`setupFiles`, runs before any test file loads)

Two responsibilities, both mandatory per a `TEST-06` guard:

1. **Fictitious environment variables**, assigned (not merely defaulted) so a real `.env` on a developer or server machine can never leak into the suite: `BASE_URL` (`https://ejemplo-v1.invalid/` — the `.invalid` TLD is RFC 2606-reserved and never resolves), `API_CODE`, `OUTPUT_DIR` (a tmpdir path), `TEST_MODE='false'`, `SYNEXUS_BASE_URL` (staging host), `SYNEXUS_API_KEY` (`synexus_test_` + 64 zeros). `SYNEXUS_ENTITY` and `TAX_API_VERSION` are deliberately left **absent** (`delete process.env.*`) because two guard suites depend on that absence to test precedence and default-to-v1 behavior — do not "fix" this by setting them in `setup.js`.
2. **`dotenv.config` is replaced with a no-op** (`dotenv.config = () => ({ parsed: {} })`) before `src/config` (which calls `dotenv.config()` at module load) is ever required. Deleting the two variables above is not sufficient on its own: a real `.env` on disk would repopulate them the moment any test does `require('../src/config')`. `tests/setup.test.js` is a permanent regression guard for this neutralization (`WR-05`).
3. **Network is blocked globally**: `http.request`, `http.get`, `https.request`, `https.get` are all replaced with a function that throws `'La suite de pruebas no puede salir a la red.'`. Since axios routes all Node traffic through `http`/`https`, this is a backstop in addition to (not a replacement for) `jest.mock('axios')` in individual files.

`tests/setup.test.js` is a smoke test *of this file*: if it fails, no other result in the suite can be trusted, and it should be the first thing checked.

---

*Testing analysis: 2026-09-11*
