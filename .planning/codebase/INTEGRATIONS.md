# External Integrations

**Analysis Date:** 2026-09-11

**Two tax-calculation integrations are live in code simultaneously**, selected per-invocation by a contract selector (see "Contract Selector" below). Neither is a stub: both have a real client, a real config class, and (for v2) a real request builder, all wired in `index.js`.

## APIs & External Services

**Tax calculation - v1 (frozen, production default):**
- Service: Magento STCCalcV3 Tax API, an Azure Function App (documented example host `syn-magento.azurewebsites.net`, per `README.md`).
- Client: `src/api/taxApiClient.js` (class `TaxApiClient`), using `axios`.
- Method: **HTTP `GET` with a JSON body** (`axios({ method: 'GET', data: requestBody, ... })`, `src/api/taxApiClient.js:36-48`). Unusual but deliberate — `CLAUDE.md` explicitly warns not to "fix" this to `POST` without coordinating with the API team.
- Auth: static API key as a URL query parameter, `?code=<API_CODE>` (Azure Function key-style auth). Appended in `Config.getEndpointUrl()` (`src/config/index.js:75-89`).
- Endpoints, resolved by operation in `Config.getEndpointUrl()`:
  - `get_tax` / `post_tax` -> `${BASE_URL}STCCalcV3?code=${API_CODE}`, or `${BASE_URL}STCCalcV3_TEST?code=${API_CODE}` when `TEST_MODE=true`.
  - `cancel_tax` -> `${BASE_URL}CancelTransaction`, unmodified — the only v1 operation whose URL does **not** carry `?code=`, and the only one unaffected by `TEST_MODE` (there is no `CancelTransaction_TEST` branch).
- Timeout: 30000 ms (`this.timeout` in `TaxApiClient` constructor).
- Response handling: `validateStatus: status < 500` lets 4xx through for manual handling; `_handleResponse` throws on `status >= 400`; on success returns `response.data` untransformed, later written verbatim to `RESPONSE_<file>.json`.
- Credential exposure (known, deliberately unfixed): `TaxApiClient.makeRequest` (`src/api/taxApiClient.js:32`) does `console.log` of the full request URL, which for `get_tax`/`post_tax` includes `?code=<API_CODE>` in clear text on stdout. On an HTTP error, the same URL (with code) also reaches the winston error log file via `this.logger.error(...)`. Tracked as `DEBT-04` in `.planning/REQUIREMENTS.md`; not fixed in this milestone because `COMP-01` requires v1's observable behavior — including its stdout — to stay byte-for-byte identical during the migration.
- Frozen: zero changes to this file during Phase 1 of the v2 migration. `tests/v1Freeze.wire.test.js` and `tests/v1Freeze.messages.test.js` assert its HTTP method, resolved URL, auth mechanism, and error message text don't drift.

**Tax calculation - v2 (Synexus Compute, opt-in, `get_tax` only so far):**
- Service: Synexus Compute — a rebrand of a prior "Syntax" product (old `syntax_*` key prefixes and an `X-Syntax-Entity` header are no longer valid; both appear only as superseded reference points in `postman/synexus-v2-api.postman_collection.json` and in code comments explaining the new names). Hosts: `compute.staging.synexustax.com` (staging), `compute.synexustax.com` (production).
- Client: `src/api/synexusApiClient.js` (class `SynexusApiClient`), using `axios`, `POST`.
- Request builder: `src/api/synexusRequestBuilder.js` (class `SynexusRequestBuilder`) - owns three "intent" fields nexgen injects on top of the ERP's file, and **never** inherits them from the input file: `transaction_type`, `committed`, `request_id`. `getIntentFor('get_tax')` returns `{ transaction_type: 'sales_estimate', committed: false }` — `sales_estimate` specifically, not the provider's own default (`sales_invoice`), because `committed: false` alone does not suppress server-side persistence of an invoice snapshot (per the provider's field reference, described in `.planning/PROJECT.md`). `post_tax`/`cancel_tax` have no intent mapping yet and throw (`OPER-05`) — Phase 2 work.
- Config: `src/config/synexusConfig.js` (class `SynexusConfig`, exported as a class — see `STACK.md`). Validates at construction, before any request is possible:
  - Required vars present: `SYNEXUS_BASE_URL`, `SYNEXUS_API_KEY` (`_validateRequiredEnvVars`).
  - `SYNEXUS_BASE_URL` shape: must parse as a URL, must be `https:` only, must be host-only — no path, query, fragment, or embedded credentials (`_getConfiguredUrl`, `src/config/synexusConfig.js:117-167`). A URL with leftovers is rejected with a message naming exactly what to remove; embedded credentials are masked before being echoed in that message.
  - Key-prefix-to-host correspondence (`_validateKeyHostMatch`, `SAFE-03`): `synexus_test_*` keys are only valid against the staging host, `synexus_live_*` keys only against production. A mismatch — or an unrecognized prefix — throws before any network call.
- Calculation endpoint: `SynexusConfig.getCalculationUrl()` = `${origin}/api/v1/tax_calculations` (`calculationPath` is a fixed literal on top of the validated origin). The provider also documents an equivalent alias `/tax_calculations/calculate` (per `.planning/PROJECT.md` Context notes); nexgen always uses the canonical, non-alias path.
- Auth: `Authorization: Bearer <SYNEXUS_API_KEY>` header — never in the URL — plus an `X-Synexus-Entity: <entityCode>` header for multi-entity routing (`this.entityHeaderName` in `SynexusApiClient`, kept as an instance property specifically so a future rebrand only touches one line).
- Entity resolution precedence (`SynexusConfig.resolveEntityCode`, `CFG-01`): `--entity=<code>` CLI flag, then `SYNEXUS_ENTITY` env var, then the `entity_id` field of the input JSON body — checked for truthiness, not just `!== undefined`, because the ERP's real extraction ships `"entity_id": ""`. If none of the three resolve, the run aborts (`CFG-02`) naming all three paths.
- Idempotency: every v2 request carries a fresh `request_id` — a UUID v4 built from `crypto.randomBytes(16)` in `SynexusRequestBuilder._generateRequestId()` (not `crypto.randomUUID()` — see `STACK.md` Runtime notes). The provider caches responses by `request_id` for 5 minutes server-side (per `.planning/PROJECT.md`); this matters for a future timeout-retry (Phase 2 scope, not yet implemented).
- Guard against v1 files under the v2 selector: `TaxValidator.validateV2IntentFields` (`src/validators/taxValidator.js:68-112`) rejects a body that carries `Committed` (capital C — v1's field), or a `transaction_type`/`committed` that contradicts the resolved operation's intent, or an inbound `request_id` (which would break the idempotency guarantee above).
- Credential hygiene in error paths: `SynexusApiClient._handleError` (`src/api/synexusApiClient.js:107-166`) deliberately reads only `error.code`, `error.message`, `error.response.status`, and `error.response.data` — the surrounding comment warns never to serialize `error.config`, `error.request`, or the error object whole, because axios embeds the full outgoing request (headers included, i.e. the bearer key) there.
- Startup profile line (`CONN-05`): `SynexusConfig.printProfile(entityCode)` prints one line — contract, host, entity, masked key (prefix + last 4 chars, ASCII `...`, never the raw value) — before any v2 request is made.
- Timeout: 30000 ms, an independent constant in `SynexusApiClient` (not shared with `TaxApiClient`).
- Response handling: same shape as v1 — `validateStatus: status < 500`, throw on `status >= 400`, return `response.data` untransformed.
- Reference material: no OpenAPI/Swagger exists for this API (confirmed with the provider per `.planning/PROJECT.md`). The provider publishes 4 PDFs (out of repo, in `data/`, gitignored) as the only spec, documenting 45 request fields at the root level (only `invoice_id`, `customer_id`, `to_state`, `to_zip` required). Within this repo, `postman/synexus-v2-api.postman_collection.json` documents `GET /health`, `GET /api/v1/entities` (entity code discovery), and `POST /api/v1/tax_calculations`; `postman/synexus-staging.postman_environment.json` holds the matching Postman variables (`synexus_base_url`, `synexus_api_key`, `synexus_entity`). The `postman/` directory is untracked in git as of this analysis (`git status`: `?? postman/`).
- Implemented scope: only `get_tax`. `post_tax` and `cancel_tax` invoked with `--api-version=v2` throw in `SynexusRequestBuilder.getIntentFor` before any request is built — explicitly Phase 2.

## Contract Selector

Both integrations above are reachable from every invocation; a selector picks exactly one per run:

- `TAX_API_VERSION` env var, read via `Config.getApiVersion()` (`src/config/index.js:64-68`) — strict `=== 'v2'`; anything else (absent, empty, misspelled) resolves to `v1`.
- `--api-version=<v1|v2>` CLI flag, read via `TaxCommandHandler.resolveApiVersion()` (`src/cli/taxCommandHandler.js:51-68`, static) — overrides the env var for a single invocation; any other value throws instead of silently choosing v1.
- Resolved once in `index.js:59`, before the DI graph is built. Under v1, `SynexusConfig`/`SynexusApiClient` are never constructed (`index.js:60-65`, both stay `null`) — so a server with no `SYNEXUS_*` variables set is completely unaffected by v2's existence. `TaxCommandHandler._executeV2` also carries its own defense-in-depth guard (`if (!this.synexusApiClient) throw ...`) against incomplete wiring.
- The ERP wrapper's real invocation (`node index.js get_tax <path>`, no flags) always takes the v1 path unless `TAX_API_VERSION=v2` is set server-side — this is `COMP-01`: production behavior is unchanged unless someone deliberately flips the switch.

## Data Storage

**Databases:**
- None. No database of any kind is used or configured.

**File Storage:**
- Local filesystem only, via `src/storage/fileManager.js` (class `FileManager`) — the only place in the codebase that imports `fs` (convention per `CLAUDE.md`).
- Input: `FileManager.readJsonFile(filePath)` reads and `JSON.parse`s the ERP-produced transaction file — same input contract for both v1 and v2 (v2's body validation happens afterward, in `TaxCommandHandler._executeV2`, not in `FileManager`).
- Output: `FileManager.writeJsonFile` writes the (untransformed) API response to `${OUTPUT_DIR}/RESPONSE_<original_filename>.json` via `FileManager.getResponseFileName` — identical mechanism for v1 and v2 responses, no version marker in the filename. `OUTPUT_DIR` is created if missing (`FileManager.ensureDirectory`).
- This file-drop contract is deliberate and explicitly preserved across the v1/v2 migration (per `.planning/PROJECT.md`: "dejemos la version dos funcionando igual que la uno").

**Caching:**
- None inside nexgen. The v2 provider caches responses server-side by `request_id` for 5 minutes (external behavior, not implemented or observable in this codebase).

## Authentication & Identity

**Auth Provider:**
- None — nexgen has no end users and no login. It is an unattended CLI invoked once per transaction by an ERP wrapper script.
- Per-integration credential (not a shared identity system):
  - v1: static API key via URL query parameter `?code=<API_CODE>` (Azure Function key auth). See the "credential exposure" note under v1 above — this is a known, deliberately-unfixed gap (`DEBT-04`).
  - v2: bearer token via `Authorization: Bearer <SYNEXUS_API_KEY>` header, with startup-time validation that the key's prefix matches the configured host (`SAFE-03`), and masking everywhere the key is echoed (`CFG-05`).

## Monitoring & Observability

**Error Tracking:**
- None. No Sentry/Bugsnag/Datadog or equivalent APM/error-tracking service integrated.

**Logs:**
- `src/infrastructure/logger.js` (class `Logger`), backed by `winston` — see `STACK.md` for dependency detail. Level fixed at `error`; one file per day, `logs/log_YYYY-MM-DD.log`. Both `TaxApiClient` and `SynexusApiClient` log HTTP failures here via `this.logger.error(...)`, in addition to `console.error` for interactive/console visibility.

## CI/CD & Deployment

**Hosting:**
- None for nexgen itself — see `STACK.md` "Platform Requirements" (runs on-prem as a CLI alongside the ERP, not as a deployed/hosted service).

**CI Pipeline:**
- None. No `.github/workflows/`, no other CI config file found anywhere in the repo.

## Environment Configuration

**Required always (v1 - `Config` constructor throws if missing, `src/config/index.js:19-26`):**
- `BASE_URL`, `API_CODE`, `OUTPUT_DIR`

**Optional (v1):**
- `TEST_MODE` (default `false`; `true` routes `get_tax`/`post_tax` to `STCCalcV3_TEST` instead of `STCCalcV3` — does not affect `cancel_tax`)
- `TAX_API_VERSION` (default resolves to `v1` — see Contract Selector above)

**Required only when the v2 contract is selected (`SynexusConfig` constructor throws if missing/malformed, `src/config/synexusConfig.js:49-59`):**
- `SYNEXUS_BASE_URL` (https + host only), `SYNEXUS_API_KEY` (prefix must match the host)

**Optional (v2):**
- `SYNEXUS_ENTITY` (one of three ways to supply the entity code — see precedence under v2 above)

**Per-run CLI overrides (any position, per `TaxCommandHandler.knownFlags`):**
- `--api-version=<v1|v2>`, `--entity=<code>`

**Secrets location:**
- `.env` at repo root (gitignored), loaded by `src/config/index.js:3`.
- A second, undotted `env` file also exists at the repo root — also gitignored, and separately flagged in `.gitignore` as containing `API_CODE`. Noted here by existence only; not read by this mapping pass (forbidden-file policy).
- Neither file is required to run the test suite (see "Test Isolation" below).

## Webhooks & Callbacks

**Incoming:**
- None. nexgen never listens for inbound HTTP of any kind — it is a CLI, not a service.

**Outgoing:**
- None in the webhook/callback sense (no fire-and-forget notification to a third party). The closest analog is the file-drop handoff to the ERP: nexgen writes `RESPONSE_<name>.json` into `OUTPUT_DIR`, and the ERP wrapper is expected to read that path afterward. This is a filesystem contract, not a network callback — see "Data Storage" above.

## Test Isolation from External Integrations

`tests/setup.js` runs as a Jest `setupFiles` entry — before any test file or any `src/` module loads — and enforces that the entire 9-suite / 242-case run touches neither integration for real:
- Hardcodes fictitious values for all six v1+v2 env vars (`BASE_URL`, `API_CODE`, `OUTPUT_DIR`, `TEST_MODE`, `SYNEXUS_BASE_URL`, `SYNEXUS_API_KEY`), using the RFC 2606 reserved-invalid TLD `.invalid` for both URLs so they can never resolve on a real network.
- Deliberately leaves `SYNEXUS_ENTITY` and `TAX_API_VERSION` **unset** (`delete process.env...`) so individual tests can control precedence/default behavior themselves.
- Monkey-patches `dotenv.config` to a no-op (`dotenv.config = () => ({ parsed: {} })`) **before** `src/config` ever requires `dotenv`, so a real `.env` present on the machine running the suite can never leak in and change test behavior between a developer laptop and the company server.
- Replaces `http.request`/`http.get`/`https.request`/`https.get` (all four, both modules) with a function that throws — since axios routes all Node HTTP traffic through these, any accidental real call from either `TaxApiClient` or `SynexusApiClient` fails the test immediately instead of reaching a live endpoint.
- `tests/setup.test.js` exists specifically to assert this neutralization itself hasn't regressed.

---

*Integration audit: 2026-09-11*
