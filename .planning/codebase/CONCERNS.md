# Codebase Concerns

**Analysis Date:** 2026-09-10

## Tech Debt

**Zero automated test suite:**
- Issue: `package.json` ships the default placeholder `"test": "echo \"Error: no test specified\" && exit 1"`. It has been this way since the first commit (`42f0429`). No `__tests__/` directories, no `jest.config.js`, no test runner installed.
- Files: `package.json`, entire `src/` tree.
- Impact: every change to `Config.getEndpointUrl`, `TaxValidator.validateCommittedField`, or `TaxValidator.sanitizeStringFields` is verified only by manual smoke test (`RUNBOOK.md` §1.3, §6). A regression in the `Committed` check or the endpoint switch would ship silently.
- Fix approach: `ARCHITECTURE.md` §10 already specifies the minimal Jest plan (mocks for `axios`, `fs`, `dotenv`; per-layer `__tests__/`). Implement it, starting with `taxValidator.js` and `config/index.js` (see Test Coverage Gaps below).

**No CI pipeline:**
- Issue: no `.github/workflows/` or equivalent. Nothing runs `npm install && npm test` (or lint) on push/PR.
- Files: repo root (absence of `.github/`).
- Impact: a broken `main` is only caught when the ERP invokes nexgen in production.
- Fix approach: add a minimal GitHub Actions job once a real test script exists; gate merges on it.

**No linter or formatter configured:**
- Issue: no `.eslintrc*`, `eslint.config.*`, or `.prettierrc*` anywhere in the repo.
- Files: repo root.
- Impact: style consistency (e.g. the Spanish-comments/English-identifiers convention documented in `docs/MEMORY.md` C1) is enforced only by code review, not tooling.
- Fix approach: add a minimal ESLint config; low effort given the codebase is 855 lines total across 7 files.

**`package.json` metadata and version enforcement incomplete:**
- Issue: `description`, `author`, `repository`, `keywords` are empty; there is no `engines` field and no `.nvmrc`, even though `README.md` and `HANDOFF.md` both declare "Node.js 14+".
- Files: `package.json`.
- Impact: nothing prevents installing/running on a Node version that breaks the declared CommonJS/no-ESM constraint. The environment used for this audit runs Node `v23.10.0` — nine majors past the documented floor — with no tooling to catch a floor violation.
- Fix approach: add `"engines": { "node": ">=14" }` and an `.nvmrc`; fill in the empty metadata fields (already tracked as HANDOFF.md §11.3/§11.10).

**`GET` with a JSON body is the wire contract for the current (v1) API:**
- Issue: `TaxApiClient.makeRequest` (`src/api/taxApiClient.js:36-48`) sends `method: 'GET'` with a `data` body. This is unusual and, per `HANDOFF.md` §11.6, many proxies/gateways strip bodies from GET requests.
- Files: `src/api/taxApiClient.js:36-48`.
- Impact: currently works because axios and the Magento-based server both support it, but it's a foot-gun for any future infra change (load balancer, API gateway) placed in front of the current host.
- Fix approach: `HANDOFF.md` §11.6 already recommends evaluating a move to `POST` if the API team supports it. The in-flight Synexus v2 migration (see `data/reunion v2.md`) replaces this endpoint with a `POST /api/v1/tax_calculations` call — meaning `TaxApiClient` will need a second request mode rather than a straight swap, since `cancel_tax` and any interim v1 traffic still need the GET-with-body behavior during the transition.

**String sanitization covers exactly one character:**
- Issue: `TaxValidator.sanitizeStringFields` (`src/validators/taxValidator.js:76-95`) replaces `'` with `\'` and nothing else. It was added reactively for one client's address format (`Plummer's Environmental SRVC`, see `docs/MEMORY.md` D3).
- Files: `src/validators/taxValidator.js:76-95`.
- Impact: any future customer name/address with `"`, control characters, or other payload-breaking characters will reproduce the exact same class of production failure that D3 fixed, with no regression test to catch it (see Test Coverage Gaps).
- Fix approach: `HANDOFF.md` §11.8 already flags this; widen the replacer or move to a vetted escaping utility when the next character class breaks.

**Debug scaffolding lives in the production file-read path:**
- Issue: `FileManager._listSimilarFiles` (`src/storage/fileManager.js:88-118`) hardcodes substring matches for `"sage"`, `"tax"`, `"ord"`, and `.json` to help diagnose "file not found" errors. It runs on every `ENOENT` from `readJsonFile`.
- Files: `src/storage/fileManager.js:88-118`.
- Impact: low risk today (read-only, best-effort `try/catch`), but it's operator-debugging code permanently embedded in the storage layer, coupled to one client's naming conventions (`ORD*` order numbers).
- Fix approach: `HANDOFF.md` §11.9 already suggests parameterizing or removing it.

**Custom Claude Code subagents/commands encode v1-only assumptions:**
- Issue: `.claude/agents/nexgen-explorer.md`, `.claude/agents/tax-validator-helper.md`, and `.claude/commands/tax-{quote,commit,cancel}.md` all describe the current contract exclusively — `GET` with body, `?code=` query auth, `STCCalcV3`/`STCCalcV3_TEST`, no `entity` concept. None mention Synexus v2.
- Files: `.claude/agents/nexgen-explorer.md`, `.claude/agents/tax-validator-helper.md`, `.claude/commands/tax-quote.md`, `.claude/commands/tax-commit.md`, `.claude/commands/tax-cancel.md`.
- Impact: `CLAUDE.md` itself requires these to be "reviewed and updated when the code they reference changes." Once v2 code lands, these agents/commands will give confidently wrong guidance (wrong URL shape, wrong auth mechanism) unless updated in lockstep.
- Fix approach: update alongside the first v2 code change, not after.

**Handoff documentation is already stale relative to the current working tree, ~4 months after being written:**
- Issue: `ARCHITECTURE.md`, `HANDOFF.md`, `RUNBOOK.md`, and `docs/MEMORY.md` are all dated 2026-05-12. `docs/MEMORY.md` ("Deuda conocida") and `HANDOFF.md` §10 both state `postman/` is an empty placeholder folder — it now holds 4 populated files (`postman/nexgen-tax-api.postman_collection.json`, `postman/nexgen-test.postman_environment.json`, `postman/synexus-v2-api.postman_collection.json`, `postman/synexus-staging.postman_environment.json`), none of them committed yet.
- Files: `docs/MEMORY.md`, `HANDOFF.md` §10, `postman/` (actual contents).
- Impact: a reader following the handoff docs literally will look for an empty `postman/` folder and miss the v1/v2 reference collections that already exist and document real, verified API behavior (see next item).
- Fix approach: update the four handoff docs' "current state" sections once the v2 branch's exploratory work (postman collections, `data/reunion v2.md`) is folded into the narrative.

**In-flight Synexus v2 migration has an unresolved core design question and zero corresponding application code:**
- Issue: the current branch (`feat/synexus-v2-migration`) contains only planning artifacts — Postman collections, `data/reunion v2.md` (meeting notes from 2026-09-09), and reference PDFs in `data/`. No file under `src/` or `index.js` has been touched for v2. Per `data/reunion v2.md` ("Requiere más debate"), the mechanism for the new `entity` header/parameter (varies per company/inventory) is explicitly undecided.
- Files: `data/reunion v2.md`, `postman/synexus-v2-api.postman_collection.json`; absence of changes under `src/`.
- Impact: the current architecture has no concept of a per-request/per-tenant `entity` value — `Config` is a process-wide singleton reading one `.env` (`src/config/index.js:91`). Whatever design is chosen for `entity` will likely require `Config`'s public surface to change (from zero-argument getters to something that accepts a runtime/company value), which ripples into `TaxApiClient` and the CLI argument parsing (`TaxCommandHandler.parseArguments`, `src/cli/taxCommandHandler.js:34-47`, currently fixed at exactly `operation` + `filePath`).
- Fix approach: resolve the `entity` design question before writing `TaxApiClient` v2 code, to avoid a rewrite; `data/reunion v2.md` lists this as an open action item for Yahir Diaz.

## Known Bugs

**`cancel_tax` never respects `TEST_MODE`:**
- Symptoms: regardless of `TEST_MODE`, `cancel_tax` always resolves to `<BASE_URL>CancelTransaction` (`src/config/index.js:74-76`) — there is no `CancelTransaction_TEST` endpoint in the code.
- Files: `src/config/index.js:74-76`; documented in `HANDOFF.md` §7 and `docs/MEMORY.md` D8.
- Trigger: run `node index.js cancel_tax <file>` with `TEST_MODE=true` expecting a sandbox-safe cancel.
- Workaround: none in code. `RUNBOOK.md` §6.4 says to coordinate a "test cancel" manually with the API team. Whether this is intended behavior or a bug is explicitly undecided (`HANDOFF.md` §11.7: "Decidir si es un bug o un comportamiento intencional documentado").

**Response files silently overwrite with no timestamp or lock:**
- Symptoms: `FileManager.getResponseFileName` (`src/storage/fileManager.js:163-166`) always returns `<outputDir>/RESPONSE_<basename>`. A second run against the same input filename destroys the first response.
- Files: `src/storage/fileManager.js:163-166`; documented in `docs/MEMORY.md` D7 and `RUNBOOK.md` §7.
- Trigger: two invocations (manual + ERP-triggered, or two concurrent ERP jobs) processing the same input filename.
- Workaround: `RUNBOOK.md` §7 recommends the invoking wrapper take its own `.lock` file — nexgen implements no internal locking.

**Logger writes to yesterday's file after midnight:**
- Symptoms: the log filename is computed once, at `Logger` construction (`src/infrastructure/logger.js:44-47`), from `new Date().toISOString().slice(0, 10)`. A long-lived process (not the normal case, but possible under a scheduler) that spans midnight keeps appending to the prior day's `log_<date>.log`.
- Files: `src/infrastructure/logger.js:44-47`; documented in `ARCHITECTURE.md` §7.
- Trigger: process start before midnight, error logged after midnight.
- Workaround: none; low impact since each CLI invocation is normally short-lived (`index.js` is a single-shot script), but relevant if nexgen is ever run as a longer batch process (`RUNBOOK.md` §7 mentions scheduler-driven periodic runs).

**Documented `BASE_URL` example points at a host that no longer serves the tax-calc endpoints:**
- Symptoms: `get_tax`/`post_tax` return `Error HTTP 404: ...` (thrown by `taxApiClient.js:75-81`).
- Files: `HANDOFF.md` §6.2, `README.md` (Environment Configuration section), `ARCHITECTURE.md` §9 — all list `BASE_URL=https://syn-magento.azurewebsites.net/api/` as the example/production host.
- Trigger: configure `.env`/`env` with the `syn-magento.azurewebsites.net` host exactly as shown in the docs, then call `get_tax` or `post_tax`.
- Workaround: `postman/nexgen-tax-api.postman_collection.json`'s description (dated "7 agosto 2026") records that `STCCalcV3` was verified to return `404` on `syn-magento` and that the API "se migró al host nuevo" (`syn-stccalcv3-prj2024...azurewebsites.net`, `200`/`401` depending on auth). `CancelTransaction` still works on both hosts. The `.claude/settings.json` `WebFetch` allowlist (`WebFetch(domain:syn-magento.azurewebsites.net)`) also still references the old host.

## Security Considerations

**Vulnerable HTTP client dependency (the only HTTP surface in the app):**
- Risk: `npm audit` reports 3 vulnerabilities against the currently installed dependency tree — `axios@1.7.9` (**high**: SSRF via absolute URL, DoS via unbounded data/recursion, `NO_PROXY` bypass, prototype-pollution-based auth bypass and credential/response tampering, header injection, ReDoS, and more — see `npm audit` output for the full GHSA list), `form-data@4.0.2` (**critical**: unsafe random multipart boundary generation, CRLF injection), and `follow-redirects@1.15.9` (**moderate**: custom auth headers leak to cross-domain redirect targets).
- Files: `package.json` (`"axios": "^1.7.9"`), `package-lock.json`, `src/api/taxApiClient.js` (the sole file that imports `axios`, per `docs/MEMORY.md` anti-pattern C — "No se usa axios fuera de TaxApiClient").
- Current mitigation: none. `npm audit fix` is available and was not run.
- Recommendations: run `npm audit fix` (or a manual bump) and re-verify the GET-with-body behavior still works post-upgrade, since that pattern is unusual enough to be sensitive to axios internals changing across versions.

**Auth code travels as a URL query string and is logged in full to stdout:**
- Risk: `Config.getEndpointUrl` (`src/config/index.js:71`) appends `?code=${apiCode}` directly to the URL for every `get_tax`/`post_tax` call. `TaxApiClient.makeRequest` then prints that full URL — API code included — to stdout on every single invocation (`src/api/taxApiClient.js:32`).
- Files: `src/config/index.js:71`, `src/api/taxApiClient.js:32`.
- Current mitigation: none at the application level. `RUNBOOK.md` §8 tells operators to capture "Contenido de `.env` **menos el `API_CODE`**" when escalating issues, which implicitly acknowledges the code shouldn't be shared — but the code is already in every stdout stream regardless.
- Recommendations: if the invoking wrapper (per `RUNBOOK.md` §1.1/§1.2) redirects stdout to a file for auditing, that file becomes a plaintext credential store. Mask the `code` query param in the printed URL (e.g. `?code=***`).

**Full request/response payloads (customer PII) print to stdout unredacted:**
- Risk: `TaxApiClient.makeRequest` logs the entire outgoing body (`src/api/taxApiClient.js:33`, `Enviando datos: ...`) and the entire response body (`src/api/taxApiClient.js:70-71`, `Respuesta del servidor: ...`) on every call, with no redaction and no log-level gating (this happens via `console.log`, independent of the winston `error`-only level).
- Files: `src/api/taxApiClient.js:32-33,66-71`.
- Current mitigation: `RUNBOOK.md` §8 already treats the input JSON as sensitive ("con datos del cliente — manejar como sensible") when escalating, but that guidance is about incident handling, not about what the app itself prints on every normal run.
- Recommendations: gate verbose payload logging behind an explicit debug flag, or redact address/customer fields before printing, especially since this app processes real customer data (`clientID: LIGFBP`, Plummer's Environmental Services per `HANDOFF.md` §3).

**A dotless `env` file with `API_CODE` was outside both the git-ignore and the Claude Code permission deny-list:**
- Risk: per the `.gitignore` comment ("Variante sin punto: apareció suelta y trae API_CODE (reunión 9-sep-2026)"), a file literally named `env` (no leading dot) exists at the repo root and carries `API_CODE`. It shows as untracked (`??`) in `git status` and was not matched by any of the `.env*` patterns already in `.gitignore` until a currently **uncommitted** edit added a bare `env` line.
- Files: `.gitignore` (working-tree diff, not yet committed), `.claude/settings.json` (`permissions.deny`).
- Current mitigation: the `.gitignore` fix exists but isn't committed. Separately, `.claude/settings.json`'s deny list blocks `Read(./.env)` / `Read(./.env.*)` / `Edit`/`Write` on those same patterns, but has no equivalent rule for the dotless `env` filename — the same naming gap exists in both protection layers.
- Recommendations: commit the `.gitignore` fix, and add matching `Read(./env)`/`Edit(./env)`/`Write(./env)` (or a broader `env*` pattern) entries to `.claude/settings.json`'s deny list. Confirm the stray `env` file is not already present in any prior commit's history.

**`postman/` is untracked and not yet committed — verify before adding to git:**
- Risk: `postman/synexus-staging.postman_environment.json` and `postman/nexgen-test.postman_environment.json` declare `secret`-type variables (`synexus_api_key`, `api_code`) that are currently empty placeholders — good — but nothing prevents a real key from being pasted in during manual testing and then committed.
- Files: `postman/synexus-staging.postman_environment.json`, `postman/nexgen-test.postman_environment.json`, `postman/synexus-v2-api.postman_collection.json`.
- Current mitigation: `postman/synexus-v2-api.postman_collection.json`'s own description documents the real key format (76 characters: a 12-character `syntax_test_`/`syntax_live_` or `synexus_test_`/`synexus_live_` prefix + 64 hex characters), which makes it straightforward to grep for before a commit.
- Recommendations: grep `postman/**` for a 76-character token matching that shape immediately before staging the folder.

**Sanitization is a narrow, ad hoc escape rather than a vetted encoding strategy:**
- Risk: `TaxValidator.sanitizeStringFields` (`src/validators/taxValidator.js:76-95`) only escapes `'`. It is not a general injection defense (it was written to fix one address-formatting bug, per `docs/MEMORY.md` D3, not for security).
- Files: `src/validators/taxValidator.js:76-95`.
- Current mitigation: the receiving system's own input handling (STCCalcV3, owned externally) is the actual boundary; nexgen's sanitization is cosmetic/compatibility-focused, not a security control.
- Recommendations: don't treat this function as an injection defense if the v2 migration introduces any endpoint that renders these strings in an unsafe context downstream.

## Performance Bottlenecks

**No retry/backoff on transient HTTP failures:**
- Problem: `TaxApiClient.makeRequest` makes exactly one attempt with a fixed 30s timeout (`src/api/taxApiClient.js:19,43`) and throws on any failure.
- Files: `src/api/taxApiClient.js:19,29-55`.
- Cause: no retry logic exists anywhere in the call path; `TaxCommandHandler.execute` (`src/cli/taxCommandHandler.js:53-92`) propagates the first error straight to `process.exit(1)`.
- Improvement path: for a CLI invoked per-transaction by an ERP batch job, a single transient network blip aborts that transaction entirely and requires the ERP layer to notice the nonzero exit code and re-invoke. A small bounded retry (e.g., 1-2 retries with backoff) for `ECONNABORTED`/`ECONNREFUSED` would reduce operator noise without changing the CLI contract.

**Full-tree JSON clone on every validation pass:**
- Problem: `TaxValidator.sanitizeStringFields` (`src/validators/taxValidator.js:79-85`) does `JSON.parse(JSON.stringify(requestBody, replacer))`, walking and re-serializing the entire request body (including every `cart[]` line item) on every single invocation.
- Files: `src/validators/taxValidator.js:76-95`.
- Cause: this is the simplest correct way to deep-clone-and-transform in one pass, and it's fine at today's payload sizes (single-order JSON files).
- Improvement path: not a current issue; flagging because it scales linearly with cart size and would be worth revisiting if nexgen is ever asked to process bulk/batched carts instead of one order at a time.

## Fragile Areas

**`Config.getEndpointUrl` — hardcoded wire contract, zero test coverage:**
- Files: `src/config/index.js:65-79`.
- Why fragile: the literal strings `STCCalcV3`, `STCCalcV3_TEST`, and `CancelTransaction` are called out in `CLAUDE.md` as "Do not touch lightly" — a typo here silently misroutes production traffic to a nonexistent or wrong endpoint. There is no test asserting the `TEST_MODE` on/off behavior.
- Safe modification: any change should be paired with the `TEST_MODE` on/off test that `ARCHITECTURE.md` §10 already specifies but that was never written; manually verify by checking the printed URL against `RUNBOOK.md` §3 step 5 before trusting a change.
- Test coverage: none.

**`TaxValidator.validateCommittedField` — sole guard against corrupting upstream tax state:**
- Files: `src/validators/taxValidator.js:38-55`.
- Why fragile: this is the only thing standing between a malformed ERP export and a `post_tax` call reaching the API with the wrong commit semantics (`docs/MEMORY.md` "Lecciones aprendidas" #2 calls this out explicitly). It's pure logic with no I/O, trivially testable, and still has zero tests.
- Safe modification: preserve the strict `===` comparisons (already flagged as "Do not touch lightly" in `CLAUDE.md`); the existing `tax-validator-helper` subagent (`.claude/agents/tax-validator-helper.md`) encodes the same constraint.
- Test coverage: none.

**The entire application has zero automated regression protection:**
- Files: all of `src/`, `index.js`.
- Why fragile: every one of the "Do not touch lightly" items in `CLAUDE.md` (`Config.getEndpointUrl`, `TaxValidator.validateCommittedField`, `FileManager.getResponseFileName`, the logger level, the 30s timeout) is protected only by documentation and manual smoke-testing procedure (`RUNBOOK.md` §1-§6), not by tests.
- Safe modification: follow `RUNBOOK.md`'s smoke-test checklist (§1.3, §2) after every change, against a non-production `TEST_MODE=true` fixture, before trusting a change in production.
- Test coverage: 0% (no test files exist anywhere in the repo).

**`.claude/settings.json` deny-list patterns were silently non-functional (now fixed, not yet committed):**
- Files: `.claude/settings.json` (`permissions.deny`), current working-tree diff vs. HEAD.
- Why fragile: the previous committed version used colon-delimited Bash patterns (e.g. `Bash(rm:-rf:*)`, `Bash(git push:* --force:*)`) that don't match real shell invocations (`rm -rf ...`, `git push --force ...`) — meaning the destructive-command guardrails for `rm -rf`, force-push, `git reset --hard`, and `git clean -f` may not have actually blocked anything for the lifetime of that config.
- Safe modification: the working tree already corrects these to space-separated patterns (`Bash(rm -rf *)`, `Bash(git push --force*)`, etc.); this fix is currently unstaged/uncommitted.
- Test coverage: none (permission configs aren't covered by any automated check).

## Scaling Limits

**Single-tenant configuration singleton has no home for the v2 `entity` parameter:**
- Current capacity: `Config` (`src/config/index.js:91`) is a process-wide singleton reading exactly one `.env` — one `BASE_URL`, one `API_CODE`, one `OUTPUT_DIR`, one `TEST_MODE`.
- Limit: the Synexus v2 API requires a per-request `entity` value that "varía dependiendo de la empresa y del inventario de Sage" (`data/reunion v2.md`), which the current one-process-one-config model cannot express without either a config rework or one process instance per entity.
- Scaling path: unresolved as of the 2026-09-09 meeting (`data/reunion v2.md`: "Se dejó pendiente la definición exacta del mecanismo"). Two directions were implicitly on the table in the meeting: a dynamic parameter passed at invocation time, vs. a value embedded in the request body — neither has been decided.

**No concurrency control across invocations sharing an `OUTPUT_DIR`:**
- Current capacity: nexgen assumes one invocation at a time per input file / output directory.
- Limit: `RUNBOOK.md` §7 states plainly that "nexgen no implementa locking interno" — two concurrent ERP-triggered runs against the same `OUTPUT_DIR` can race on `RESPONSE_*.json` (ties to the Known Bugs overwrite entry above).
- Scaling path: `RUNBOOK.md` §7 recommends the invoking wrapper take an external `.lock` file; nothing in-process addresses this.

## Dependencies at Risk

**`axios ^1.7.9`:**
- Risk: see Security Considerations — high-severity advisories (SSRF, prototype pollution, ReDoS, credential/response tampering) against the installed `1.7.9`.
- Impact: `axios` is the sole HTTP client in the codebase (`src/api/taxApiClient.js`), so any exploit path applies to 100% of the app's network traffic, including the credential-bearing `get_tax`/`post_tax` calls.
- Migration plan: `npm audit fix` is available; re-run the GET-with-body smoke test (`RUNBOOK.md` §1.3) after upgrading, since that call shape is nonstandard enough to be worth re-verifying against a newer axios internals.

**`form-data@4.0.2` (transitive, via axios):**
- Risk: critical advisory for unsafe random multipart-boundary generation and CRLF injection.
- Impact: nexgen doesn't send multipart requests directly (it sends JSON), so exposure depends on whether axios' internals route through `form-data` for the current GET-with-JSON-body pattern — worth confirming rather than assuming safety.
- Migration plan: resolved by the same `axios` bump (transitive dependency), per `npm audit`.

**Declared Node.js floor is unenforced:**
- Risk: `README.md` and `HANDOFF.md` both state "Node.js 14+" as the requirement, but `package.json` has no `engines` field and there's no `.nvmrc`.
- Impact: nothing in the repo would catch a change that accidentally depends on a Node 16+/18+ feature; nothing would warn a developer running a much newer Node (this audit's environment: `v23.10.0`) that they're outside the tested range in the other direction either.
- Migration plan: add `"engines": { "node": ">=14" }` to `package.json` and an `.nvmrc`; low effort, already tracked in `HANDOFF.md` §11.10.

## Missing Critical Features

**No idempotency or locking for concurrent invocations:**
- Problem: two simultaneous runs against the same input filename can interleave writes to the same `RESPONSE_*.json` (see Known Bugs / Scaling Limits above).
- Blocks: safe use of nexgen from more than one scheduler/trigger source at a time without an external locking wrapper.

**No retry/backoff for transient failures:**
- Problem: a single dropped connection or timeout (30s fixed, `src/api/taxApiClient.js:19`) aborts the whole operation.
- Blocks: unattended/batch operation resilience — every transient network hiccup becomes an operator-visible failure requiring manual re-run.

**No response versioning or audit trail:**
- Problem: `RESPONSE_<file>.json` always overwrites the prior response for that input filename (`src/storage/fileManager.js:163-166`).
- Blocks: any downstream need to compare "what the API said last time" vs. "what it says now" for the same order without the ERP copying files out-of-band first (`docs/MEMORY.md` D7).

**No sandbox-safe path for `cancel_tax`:**
- Problem: `CancelTransaction` has no `_TEST` counterpart in the API or the code (`src/config/index.js:74-76`).
- Blocks: verifying cancel behavior against non-production data without coordinating a manual exception with the API team (`RUNBOOK.md` §6.4).

## Test Coverage Gaps

**`TaxValidator.validateCommittedField` (the `Committed` flag guard):**
- What's not tested: all three operations' happy and unhappy paths — `get_tax` with `Committed: true`, `post_tax` with `Committed: false`, `post_tax` with `Committed: "true"` (string, should fail the strict `===` check), `cancel_tax` with any value (should pass through unchecked).
- Files: `src/validators/taxValidator.js:38-55`.
- Risk: this is the only thing preventing a malformed ERP export from confirming or leaving unconfirmed a real tax transaction in the upstream system.
- Priority: High.

**`Config.getEndpointUrl` (`TEST_MODE` routing):**
- What's not tested: `TEST_MODE=true`/`false`/unset for `get_tax`/`post_tax`, and that `cancel_tax` always resolves to `CancelTransaction` regardless of `TEST_MODE`.
- Files: `src/config/index.js:65-79`.
- Risk: a broken `isTestMode()` comparison could silently route production calls to the test endpoint (or vice versa) — exactly the "risk asumido" documented in `docs/MEMORY.md` D2.
- Priority: High.

**`TaxValidator.sanitizeStringFields` (apostrophe-escaping regression protection):**
- What's not tested: nested objects, arrays (`cart[]` items), non-string field types passing through unchanged, and the specific `Plummer's Environmental SRVC` case this function was written to fix.
- Files: `src/validators/taxValidator.js:76-95`.
- Risk: this function exists because of one real production incident (`docs/MEMORY.md` D3); without a regression test, a future refactor could silently reintroduce the exact bug it was written to prevent.
- Priority: High.

**`TaxApiClient._handleResponse` status-code decision table:**
- What's not tested: 2xx pass-through, 4xx-throws-with-server-message, and the `validateStatus: status < 500` boundary that makes 4xx "resolve" while 5xx "reject" at the axios layer.
- Files: `src/api/taxApiClient.js:66-88`.
- Risk: a change to the status-handling logic could flip which error codes are treated as fatal vs. retryable without anyone noticing until a live 4xx/5xx response.
- Priority: Medium.

**`FileManager.getResponseFileName` (output path construction):**
- What's not tested: basename extraction from paths with/without directories, trailing separators, and the fixed `RESPONSE_` prefix that `CLAUDE.md` marks as a convention external ERP wrappers depend on.
- Files: `src/storage/fileManager.js:163-166`.
- Risk: low complexity but zero safety net for a convention that's explicitly load-bearing for downstream consumers.
- Priority: Low.

**The entire Synexus v2 contract (once implemented):**
- What's not tested: nothing exists yet — no v2 request builder, no `entity` parameter handling, no v2 response parsing. The Postman collection (`postman/synexus-v2-api.postman_collection.json`) is exploratory reference material, not application code.
- Files: none yet under `src/`; reference material in `postman/synexus-v2-api.postman_collection.json` and `data/reunion v2.md`.
- Risk: whatever ships first for v2 will ship with zero test coverage by default unless tests are written alongside it — there's no existing test scaffolding in this repo to extend, so it would need to be built from scratch at the same time as the migration itself.
- Priority: High (new code, direct production financial impact once it replaces the v1 path).

---

*Concerns audit: 2026-09-10*
