# ARCHITECTURE — nexgen

> Codebase map for engineers. Read this before changing behavior.
> Language: English. Last updated: 2026-05-12.

## 1. High-level

`nexgen` is a single-process Node.js CLI. The entry point (`index.js`)
wires five layers using constructor-style dependency injection and
delegates one CLI command per invocation. There is no daemon, no HTTP
server, no background worker.

```
argv ──► index.js (DI root)
            │
            ▼
    ┌────────────────────────────┐
    │  CLI: TaxCommandHandler    │  parse argv, orchestrate
    └─────────────┬──────────────┘
                  │ uses
    ┌─────────────▼──────────────┐
    │  Validation: TaxValidator  │  Committed rules, sanitization
    └─────────────┬──────────────┘
                  │ uses
    ┌─────────────▼──────────────┐
    │  API: TaxApiClient         │  axios HTTP, error parsing
    └─────────────┬──────────────┘
                  │ uses
    ┌─────────────▼──────────────┐
    │  Storage: FileManager      │  read/write JSON, ensure dirs
    └─────────────┬──────────────┘
                  │ uses
    ┌─────────────▼──────────────┐
    │  Infra: Logger, Config     │  winston, dotenv, endpoint URLs
    └────────────────────────────┘
```

Every layer accepts its dependencies through the constructor.
Construction happens **only** in `index.js`. No layer reaches out to
`require('./config')` or similar — they receive what they need.

## 2. Per-layer breakdown

### 2.1 Entry point — `index.js`

- **Purpose**: build the dependency graph and run one command.
- **Public surface**: none (top-level script).
- **Dependencies**: every layer below.
- **Notes**: top-level `try/catch` exits with code `1` if any layer
  throws. Errors are already logged by the layer that detected them, so
  the entry point only prints the operator-friendly line.

### 2.2 CLI layer — `src/cli/taxCommandHandler.js`

- **Purpose**: orchestrate one invocation. Parse argv, validate, read
  input, call API, save response.
- **Class**: `TaxCommandHandler(config, logger, fileManager, validator, apiClient)`.
- **Public methods**:
  - `execute(args)` — main lifecycle (see §3).
  - `parseArguments(args)` — returns `{ operation, filePath }`.
  - `showHelp()` — prints usage to stdout. Currently not auto-invoked.
- **Notes**: this layer does not implement business rules — it only
  sequences them.

### 2.3 Validation layer — `src/validators/taxValidator.js`

- **Purpose**: enforce business rules on the request body before it
  hits the API.
- **Class**: `TaxValidator(logger)`.
- **Valid operations**: `['get_tax', 'post_tax', 'cancel_tax']`.
- **Public methods**:
  - `validateOperation(operation)` — throws if not in `validOperations`.
  - `validateRequestBody(body)` — throws if not an object.
  - `validateCommittedField(operation, body)` — see §5.
  - `sanitizeStringFields(body)` — see §5.
  - `validate(operation, body)` — wraps the above and returns the
    sanitized body (this is what the CLI layer calls).
  - `getValidOperations()` — defensive copy of the operations array.

### 2.4 API layer — `src/api/taxApiClient.js`

- **Purpose**: speak HTTP with the Magento STCCalcV3 endpoints.
- **Class**: `TaxApiClient(config, logger)`.
- **Timeout**: `30000` ms (hard-coded, `this.timeout`).
- **Public methods**:
  - `makeRequest(operation, body)` — generic, used internally and by
    the CLI layer.
  - `getTax(body)` / `postTax(body)` / `cancelTax(body)` — thin wrappers
    over `makeRequest`.
- **HTTP shape** (unusual, see §6):
  - Method: `GET`
  - Body: JSON request body
  - Headers: `Content-Type: application/json`
  - `validateStatus: status < 500` — everything below 500 is "non-throw"
    and inspected manually.
- **Error path**: `_handleError` distinguishes `ECONNREFUSED`,
  `ECONNABORTED`, `ENOTFOUND`, server response, and "no response"
  cases, and logs each with diagnostic details.

### 2.5 Storage layer — `src/storage/fileManager.js`

- **Purpose**: every filesystem touch goes through this class.
- **Class**: `FileManager(logger)`.
- **Public methods**:
  - `exists(path)`
  - `readJsonFile(path)` — reads, parses, returns object. Surfaces
    `ENOENT`, `EACCES`, and `SyntaxError` with operator-facing hints
    (`_handleFileReadError` + `_listSimilarFiles`).
  - `writeJsonFile(path, data)` — `JSON.stringify(data, null, 2)`.
  - `ensureDirectory(path)` — `mkdirSync(..., { recursive: true })`.
  - `getResponseFileName(originalPath, outputDir)` — returns
    `<outputDir>/RESPONSE_<basename>` (see §5).
- **Note**: `_listSimilarFiles` is a debugging convenience. It looks
  for files matching `sage`, `tax`, or `ORD` substrings, or `.json`.

### 2.6 Infrastructure — `src/infrastructure/logger.js`

- **Purpose**: error-only file logger using winston.
- **Class**: `Logger(logDir)`.
- **Transport**: one `winston.transports.File` per process at
  `<logDir>/log_<YYYY-MM-DD>.log`. The date is computed at
  construction time, not on each call, so a process spanning midnight
  keeps writing to yesterday's file.
- **Level**: `error`. `info`/`warn`/`debug` methods exist but produce
  no file output.

### 2.7 Configuration — `src/config/index.js`

- **Purpose**: load and validate env vars; resolve endpoint URLs.
- **Singleton**: the module exports `new Config()` so every layer sees
  the same instance.
- **Constructor**: calls `_validateRequiredEnvVars()` which throws if
  any of `BASE_URL`, `API_CODE`, `OUTPUT_DIR` is missing.
- **`dotenv.config({ path: ../../.env })`** — resolved relative to
  `src/config/index.js`, so the `.env` file must live at the repo
  root.
- **Public methods**: `getBaseUrl`, `getApiCode`, `getOutputDir`,
  `isTestMode`, `getEndpointUrl(operation)`, `getLogDir`.

## 3. Command lifecycle

`TaxCommandHandler.execute(args)` (`src/cli/taxCommandHandler.js`):

1. `parseArguments(args)` → `{ operation, filePath }`. Throws if
   `args.length < 2`.
2. `validator.validateOperation(operation)`.
3. `fileManager.exists(filePath)` check. Throws if missing.
4. `fileManager.readJsonFile(filePath)` → `requestBody`.
5. `validator.validate(operation, requestBody)` → `sanitizedRequestBody`
   (also validates `Committed` and sanitizes strings).
6. `apiClient.makeRequest(operation, sanitizedRequestBody)` →
   `responseData`.
7. `_saveResponse(responseData, filePath)`:
   - `config.getOutputDir()`
   - `fileManager.ensureDirectory(outputDir)`
   - `fileManager.getResponseFileName(filePath, outputDir)` →
     `RESPONSE_<basename>`
   - `fileManager.writeJsonFile(...)`
8. Log success to stdout. Return.

If any step throws: `_handleError(error)` logs and re-throws to
`index.js`, which prints the operator-facing line and `process.exit(1)`.

## 4. Endpoint resolution

`Config.getEndpointUrl(operation)` (`src/config/index.js`, lines 65–79):

```js
getEndpointUrl(operation) {
    const baseUrl = this.getBaseUrl();

    if (operation === 'get_tax' || operation === 'post_tax') {
        const apiCode = this.getApiCode();
        const endpoint = this.isTestMode() ? 'STCCalcV3_TEST' : 'STCCalcV3';
        return `${baseUrl}${endpoint}?code=${apiCode}`;
    }

    if (operation === 'cancel_tax') {
        return `${baseUrl}CancelTransaction`;
    }

    throw new Error(`Operación inválida: ${operation}`);
}
```

Two things to note:

1. The `?code=<API_CODE>` query string is **only attached to
   `get_tax`/`post_tax`**, not to `cancel_tax`. If the cancel endpoint
   starts requiring an auth code, this is the line to update.
2. `cancel_tax` ignores `TEST_MODE`. There is no `CancelTransaction_TEST`
   in the codebase.

## 5. Validation rules

### 5.1 `Committed` flag

```
get_tax    → requestBody.Committed must be exactly === false
post_tax   → requestBody.Committed must be exactly === true
cancel_tax → not validated
```

Implementation: `TaxValidator.validateCommittedField`
(`src/validators/taxValidator.js`, lines 38–55). Triple-equals is used
on purpose so `"true"` (string) does not silently pass `post_tax`.

### 5.2 String sanitization

`TaxValidator.sanitizeStringFields` clones the body via
`JSON.parse(JSON.stringify(body, replacer))` where the replacer
substitutes every `'` (apostrophe) with `\'` in string values.

Scope: every string field at any depth, including inside `cart[]` items.
Was introduced in commit `ed6b3f2` to deal with addresses like
`Plummer's Environmental SRVC`.

## 6. Error model and exit codes

| Source                        | Logged where         | Exit code |
| ----------------------------- | -------------------- | --------- |
| Missing argv                  | stderr + log file    | 1         |
| Invalid operation             | stderr + log file    | 1         |
| Missing/invalid input file    | stderr + log file    | 1         |
| `Committed` mismatch          | stderr + log file    | 1         |
| Sanitization failure          | stderr + log file    | 1         |
| `ECONNREFUSED`/`ENOTFOUND`    | stderr + log file    | 1         |
| `ECONNABORTED` (timeout)      | stderr + log file    | 1         |
| HTTP 4xx                      | stderr + log file    | 1         |
| HTTP 5xx (rejected by axios)  | stderr + log file    | 1         |
| Filesystem write failure      | stderr + log file    | 1         |
| Successful completion         | stdout `SUCCESS: ...`| 0         |

Exit codes are produced exclusively by `index.js` (`process.exit(1)` in
the top-level catch, implicit `0` otherwise).

Note: `axios.validateStatus: status < 500` means 4xx responses come
back as normal resolved promises and are converted to thrown errors
inside `_handleResponse` (`taxApiClient.js`, lines 75–81). 5xx
responses are thrown by axios itself and caught by `_handleError`.

## 7. Logging

- One winston `File` transport per process.
- Path: `<logDir>/log_<YYYY-MM-DD>.log`.
- `logDir` defaults to `src/config/../../logs` (i.e., `<repo>/logs/`).
- Format: `[<ISO timestamp>] ERROR: <message>`.
- Daily rotation is implicit (date computed once at construction).
- Empty log files (e.g., `log_2025-10-16.log`) indicate the process
  ran but did not error that day.

## 8. Configuration precedence

`dotenv.config({ path: path.resolve(__dirname, '../../.env') })` runs at
the top of `src/config/index.js`. Resolution order:

1. **Existing `process.env`** wins (e.g., variables set in the shell
   before invocation override what's in `.env`).
2. **`.env` at the repo root** fills any remaining gaps.
3. **No defaults** for `BASE_URL`, `API_CODE`, `OUTPUT_DIR`. Missing
   any of the three: constructor throws, process exits.
4. `TEST_MODE` defaults to `false` (the comparison is `=== 'true'`).

## 9. External integration

- Host: `syn-magento.azurewebsites.net`
- Paths:
  - `<BASE_URL>STCCalcV3?code=<API_CODE>` — production tax calc/commit
  - `<BASE_URL>STCCalcV3_TEST?code=<API_CODE>` — test tax calc/commit
  - `<BASE_URL>CancelTransaction` — cancel (no `?code`)
- Protocol: HTTP `GET` with a JSON body (see §2.4). Yes, GET-with-body.
- The remote contract is owned by the API team, not by this repo.
  Schema details (full list of fields, optional vs required) live in
  external documentation.

## 10. Testing gap

There is no test suite. `package.json` keeps the default
`"test": "echo \"Error: no test specified\" && exit 1"`. A minimal
Jest setup would cover, at a minimum:

- `Config.getEndpointUrl` with `TEST_MODE` on and off.
- `TaxValidator.validateCommittedField` for all three operations and
  unhappy paths.
- `TaxValidator.sanitizeStringFields` (apostrophe replacement,
  nested objects, arrays).
- `FileManager.getResponseFileName` (paths, basenames, trailing
  separators).
- `TaxApiClient._handleResponse` decision table (2xx pass-through,
  4xx throws, body shape).

Mocks needed: `axios`, `fs`, `dotenv`. A `jest.config.js` with
`testEnvironment: 'node'` and per-layer `__tests__` folders alongside
`src/<layer>/` would match the existing structure.
