# External Integrations

**Analysis Date:** 2026-09-10

## APIs & External Services

**Tax calculation — current production integration:**
- Magento STCCalcV3 Tax API, hosted as an Azure Functions app. This is the entire reason the CLI exists: read a transaction JSON, call the API, write the response.
  - SDK/Client: none — raw `axios`, exclusively inside `src/api/taxApiClient.js`.
  - Auth: Azure Function key passed as a query string parameter, `?code=<API_CODE>` (env var `API_CODE`). No header-based auth, no OAuth.
  - Host: `syn-magento.azurewebsites.net` per `ARCHITECTURE.md` §9; the actual host recorded in the test Postman environment (`postman/nexgen-test.postman_environment.json`) is `https://syn-stccalcv3-prj20241220140507.azurewebsites.net/api/` — both are Azure Functions app hostnames for the same integration, exact production value comes from the `.env` `BASE_URL`.
  - Endpoints, resolved in `Config.getEndpointUrl` (`src/config/index.js:65-79`):
    - `GET <BASE_URL>STCCalcV3?code=<API_CODE>` — `get_tax` / `post_tax`, production (`TEST_MODE` unset/false).
    - `GET <BASE_URL>STCCalcV3_TEST?code=<API_CODE>` — `get_tax` / `post_tax`, when `TEST_MODE=true`.
    - `GET <BASE_URL>CancelTransaction` — `cancel_tax`, **always** this path; ignores `TEST_MODE` entirely.
  - Protocol quirk: HTTP `GET` with a JSON request body (`src/api/taxApiClient.js:36-48`, `data: requestBody` on a `method: 'GET'` axios call). Non-standard but required by the remote contract — `CLAUDE.md` explicitly warns not to "fix" this to `POST` without coordinating with the API team. `docs/MEMORY.md` D6 notes this may break under strict proxies/gateways that strip GET bodies.
  - Timeout: 30000 ms (`src/api/taxApiClient.js:19`).
  - Response handling: any HTTP status `< 500` is treated as a normal response (`validateStatus`); status `>= 400` is then thrown as an application error (`_handleResponse`, `src/api/taxApiClient.js:66-88`). Status `>= 500` rejects at the axios layer and is caught by `_handleError` (`src/api/taxApiClient.js:97-141`), which classifies `ECONNREFUSED` / `ECONNABORTED` / `ENOTFOUND` / server-error-with-body / no-response cases.
  - Full field-level schema for the request/response body is owned externally and is not in this repo (`ARCHITECTURE.md` §9); sample bodies exist in `postman/nexgen-tax-api.postman_collection.json`.

**Tax calculation — planned migration, not yet implemented:**
- Synexus Compute API v2 (`compute.synexustax.com`, staging `compute.staging.synexustax.com`). This is the target of the current branch, `feat/synexus-v2-migration`. As of this analysis it is **reference-only**: no file under `src/` or `index.js` mentions "synexus"; the only repo references are two untracked Postman artifacts, `postman/synexus-v2-api.postman_collection.json` and `postman/synexus-staging.postman_environment.json`.
  - SDK/Client: none yet.
  - Auth: `Authorization: Bearer <synexus_api_key>` (current collection uses env var `synexus_api_key`, empty/unset in the checked-in Postman environment — no secret present). Environment boundary is enforced by key prefix: `syntax_test_` only works against staging, `syntax_live_` only against production; crossing them returns `401 invalid_key`. Keys are a fixed 76 characters (12-char prefix + 64 hex chars). Post-release, prefixes are renamed to `synexus_test_` / `synexus_live_`.
  - Entity header: `X-Syntax-Entity` today; the collection has `X-Synexus-Entity` already present but disabled, to be swapped in on release day as a **hard cutover** (old header name stops being accepted, not a gradual deprecation).
  - Endpoints documented in the collection:
    - `GET /health` — liveness check, no entity header required.
    - `GET /api/v1/entities` — discovers valid entity codes for `X-Syntax-Entity` / `X-Synexus-Entity`; also does not require the entity header.
    - `POST /api/v1/tax_calculations` — the calculation call itself. Note: method changes from `GET` (current API) to `POST` (Synexus v2). The collection flags an unresolved discrepancy between source docs: the migration guide PDF says the path should be `/api/v1/tax_calculations/calculate`, but the API reference PDF's curl example (used as the collection's source of truth) omits `/calculate`; needs confirmation with Synexus before real integration work starts.
  - Contract changes vs. the current integration, as documented in the Postman collection description (sourced from `data/API_REFERENCE.pdf` and `data/Cambios_MIGRATION_GUIDE_v2.pdf` — both gitignored under `data/`, not read directly for this analysis):
    - Every `cart[]` line item must include a non-empty `tax_code`; missing/blank triggers `422 tax_code_missing`. Three reserved codes are always accepted without prior mapping: `TPP`, `SHIPPING`, `HANDLING`. An unmapped code is not an error — it returns `200`, bills the line as `TPP`, and adds a `tax_code_unmapped` warning.
    - Monetary amounts and rates are returned as decimal strings (e.g. `"20.50"`), not floats/numbers — must be parsed with a decimal-safe method, never `parseFloat`.
    - Inside `exemption.mapping`, the field previously called `client_category` is renamed to `tax_code`.
    - Response always includes a `warnings[]` array (possibly empty) and a `request_id`, which Synexus requires for support requests.
  - Additional source docs referenced but not present as Postman requests: `data/Cambios_PARTNER_API_CHANGES_CHECKLIST.pdf`, `data/ONBOARDING_GUIDE.pdf` (entity code table for Sage 300 is said to live in the Onboarding Guide, not the API Reference).
  - Impact when implemented: will require changes to `Config.getEndpointUrl` (new host/paths, `POST` instead of `GET`), `TaxApiClient` (Bearer header, entity header, no more `?code=`), and likely `TaxValidator`/request shape (new field names like `tax_code`, `invoice_id`, `to_state`/`to_zip` vs. current `FromAddress1`/`ToAddress1`-style fields).

## Data Storage

**Databases:**
- None. No ORM, no DB driver/client dependency in `package.json`, no connection-string env vars anywhere in the codebase or docs.

**File Storage:**
- Local filesystem only, always accessed through `src/storage/fileManager.js` (project convention: never `fs` directly from other layers).
  - Input: an arbitrary JSON transaction file, path supplied as the second CLI argument, read via `FileManager.readJsonFile` (`src/storage/fileManager.js:34-53`).
  - Output: `OUTPUT_DIR/RESPONSE_<original_basename>.json`, written via `FileManager.writeJsonFile` (`src/storage/fileManager.js:126-137`) and named via `getResponseFileName` (`src/storage/fileManager.js:163-166`). Overwrites on every run against the same input filename — no timestamp, no versioning (`docs/MEMORY.md` D7).
  - Logs: `logs/log_<YYYY-MM-DD>.log`, directory resolved by `Config.getLogDir()` (`src/config/index.js:85-87`), created on demand by `Logger._ensureLogDir` (`src/infrastructure/logger.js:23-27`).

**Caching:**
- None.

## Authentication & Identity

**Auth Provider:**
- None for the CLI itself — this is a machine-invoked tool (spawned by the Sage 300 ERP or its PowerShell/.bat wrapper per `RUNBOOK.md` §1), with no user login, session, or identity layer of its own.
- Outbound API auth only: Azure Function key in the query string (current integration, `API_CODE`) versus Bearer token + entity header (planned Synexus v2 integration, see above). No JWT, no OAuth flow, no API-key-in-header pattern in the current code.

## Monitoring & Observability

**Error Tracking:**
- None. No Sentry/Bugsnag/Rollbar or similar dependency.

**Logs:**
- `winston`, configured for `error` level only, single `File` transport writing to `logs/log_<YYYY-MM-DD>.log` (`src/infrastructure/logger.js:33-51`). The log filename date is computed once at `Logger` construction — a long-lived process spanning midnight keeps writing to the previous day's file (`CLAUDE.md` gotcha #6).
- `logger.info` / `logger.warn` / `logger.debug` exist on the `Logger` class but are no-ops at the file transport because the underlying winston logger level is hard-set to `error`.
- Real-time trace output goes to `console.log` (stdout) / `console.error` (stderr) throughout `src/`; this is not persisted unless the invoking wrapper redirects it (`RUNBOOK.md` documents `> stdout.log 2>&1` as the pattern to capture it).

## CI/CD & Deployment

**Hosting:**
- None — not deployed as a network service. Distributed as a folder copied to the ERP host and invoked as a local child process; production location documented as `C:\nexgen` (`RUNBOOK.md` §1).

**CI Pipeline:**
- None detected. No `.github/workflows`, no other CI/CD config files in the repo.

**Deployment mechanism:**
- Manual: copy the project folder to the target Windows machine, ensure `.env` is present with the four vars, invoke via `wrapper-nexgen.ps1` (or the `.bat` alternative) from a Sage 300 ERP job or Windows Task Scheduler. `RUNBOOK.md` §1 has the full wrapper script and usage example.

## Environment Configuration

**Required env vars:**
- `BASE_URL` — trailing-slash base URL of the Azure Functions host.
- `API_CODE` — Azure Function key for `STCCalcV3` / `STCCalcV3_TEST` (not used for `CancelTransaction`).
- `OUTPUT_DIR` — directory where `RESPONSE_*.json` files are written (created automatically if missing).

**Optional env vars:**
- `TEST_MODE` — `true` routes `get_tax`/`post_tax` to `STCCalcV3_TEST`; any other value (including unset) is production. Does not affect `cancel_tax`.

**Secrets location:**
- `.env` at the repo root, gitignored (`.gitignore` lists `.env` and its variants explicitly).
- A second, undotted `env` file also exists at the repo root (untracked). A `.gitignore` comment notes it "trae API_CODE" (carries `API_CODE`) and appears to be a stray duplicate from a September 9 2026 meeting — it is not referenced by any code path (`src/config/index.js:3` loads only `.env`). Existence noted here only; contents were not read as part of this analysis.
- Full env var table with descriptions: `HANDOFF.md` §9.

## Webhooks & Callbacks

**Incoming:**
- None. The CLI has no HTTP listener/server of any kind — it is purely a short-lived process invoked with CLI args, one operation per invocation.

**Outgoing:**
- None beyond the synchronous tax-API request/response call itself. No fire-and-forget notifications, no separate webhook dispatch. (`docs/MEMORY.md` D4 notes a `node-notifier` desktop-notification dependency existed briefly in project history and was removed — not part of the current stack.)

---

*Integration audit: 2026-09-10*
