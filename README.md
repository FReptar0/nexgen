# NexGen Tax API Client

A Node.js application for interacting with the Magento Tax API to calculate, commit, and cancel tax transactions.

## Handoff

This project is being handed off to a new owner. Start with these documents (in order):

1. [HANDOFF.md](./HANDOFF.md) — owner-to-owner brief (Spanish): what nexgen is, current state, deuda técnica, FAQ.
2. [ARCHITECTURE.md](./ARCHITECTURE.md) — per-layer codebase map (English).
3. [RUNBOOK.md](./RUNBOOK.md) — operational procedures (Spanish).
4. [docs/MEMORY.md](./docs/MEMORY.md) — historical decisions and conventions (Spanish).
5. [CLAUDE.md](./CLAUDE.md) — persistent instructions for Claude Code sessions.

## Requirements

- Node.js (version 14 or higher)
- npm or yarn package manager

## Installation

1. Clone or download this repository
2. Navigate to the project directory
3. Install dependencies:

   ```bash
   npm install
   ```

## Dependencies

The project uses the following Node.js packages:

- `axios` (^1.7.9) - HTTP client for API requests
- `dotenv` (^16.4.7) - Environment variables loader
- `winston` (^3.17.0) - Logging library

## Environment Configuration

Create a `.env` file in the root directory with the following variables:

```env
# Contract v1 (Azure Function STCCalcV3) — ALWAYS required
BASE_URL=https://syn-magento.azurewebsites.net/api/
API_CODE=ABC123XYZ456DEFG789HIJK0LMNOPQRS==
OUTPUT_DIR=C:\Directorio_de_Trabajo\NEO\Taxes\respuesta
TEST_MODE=false

# Contract selector — optional. Absent, empty, or anything other than "v2" means v1
TAX_API_VERSION=v1

# Contract v2 (Synexus Compute) — required ONLY when the selected contract is v2
SYNEXUS_BASE_URL=https://compute.staging.synexustax.com
SYNEXUS_API_KEY=<key issued for that host — never commit a real value>
SYNEXUS_ENTITY=
```

The three v1 variables are validated on every run, whichever contract is
selected. The `SYNEXUS_*` variables are read **only** when the contract
resolves to v2; a server that runs v1 does not need them at all.

### Environment Variables Explained

- **BASE_URL**: The base URL for the Magento Tax API
- **API_CODE**: Authentication code for accessing the tax calculation endpoints
- **OUTPUT_DIR**: Directory where response files will be saved (will be created automatically if it doesn't exist)
- **TEST_MODE**: Set to `true` to use test endpoint (`STCCalcV3_TEST`), `false` for production endpoint (`STCCalcV3`)
- **TAX_API_VERSION** (optional): Contract selector. `v2` activates the
  Synexus Compute contract. **Absent, empty, or any value other than `v2`
  leaves the behavior on v1** — there is no way to enable v2 by accident.
  The `--api-version=<v1|v2>` command-line flag overrides this variable
  for a single run.
- **SYNEXUS_BASE_URL** (v2 only): Host of the v2 provider. Only the host
  goes here; the calculation path (`/api/v1/tax_calculations`) and the
  cancel path (`/api/v1/invoices/cancel`) are added by the code. Staging
  is `https://compute.staging.synexustax.com`, production is
  `https://compute.synexustax.com`. `TEST_MODE` does not apply to v2: the
  environment is this host together with the key prefix.
- **SYNEXUS_API_KEY** (v2 only): Bearer key. It travels in the
  `Authorization: Bearer` header and never in the URL. **Its prefix must
  match the host**: `synexus_test_` keys are only valid against staging and
  `synexus_live_` keys only against production. A mismatch (or an
  unrecognized prefix) aborts the run at startup, before any request is
  made — this is the first thing you will hit when configuring v2 for the
  first time, and it is intentional.
- **SYNEXUS_ENTITY** (v2 only, optional): Entity code sent in the
  `X-Synexus-Entity` header. It is one of three delivery paths, resolved in
  this order of precedence: the `--entity=<code>` command-line flag, then
  this variable, then the `entity_id` field of the input JSON. If none of
  the three provides a value, the run aborts naming all three.

## Usage

The application accepts three operations:

```bash
node index.js <operation> <json_file_path>
```

### Operations

1. **get_tax** - Calculate tax without committing the transaction

   ```bash
   node index.js get_tax input.json
   ```

   - Requires `"Committed": false` in the JSON file

2. **post_tax** - Calculate and commit the tax transaction

   ```bash
   node index.js post_tax input.json
   ```

   - Requires `"Committed": true` in the JSON file

3. **cancel_tax** - Cancel a previously committed transaction

   ```bash
   node index.js cancel_tax input.json
   ```

### Contract flags (v2)

Two optional flags select the contract and the entity for a single run.
They are accepted in any position and are removed before the positional
arguments are resolved, so `<operation>` and `<json_file_path>` keep their
places.

- **`--api-version=<v1|v2>`** — overrides `TAX_API_VERSION` for this run.
  Any value other than `v1` or `v2` aborts.

  ```bash
  node index.js get_tax input.json --api-version=v2
  ```

- **`--entity=<code>`** — entity code for v2. It wins over
  `SYNEXUS_ENTITY` and over the `entity_id` field of the input file.

  ```bash
  node index.js get_tax input.json --api-version=v2 --entity=USA
  ```

**The invocation without flags — the one the ERP wrapper emits — keeps
taking the v1 path**, exactly as before, unless `TAX_API_VERSION=v2` is set
in the environment. Under v2 the three operations are implemented; each
one maps to the v2 contract like this:

| Operation    | v2 request                                          | Body that goes on the wire                                                                          |
| ------------ | --------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `get_tax`    | `POST <SYNEXUS_BASE_URL>/api/v1/tax_calculations`   | the file, plus `transaction_type: "sales_estimate"`, `committed: false` and a fresh `request_id`   |
| `post_tax`   | same calculation endpoint                           | the file, plus `transaction_type: "sales_invoice"`, `committed: true` and a fresh `request_id`     |
| `cancel_tax` | `POST <SYNEXUS_BASE_URL>/api/v1/invoices/cancel`    | exactly `{ invoice_id, customer_id }`, projected from the file — nothing else, and no `request_id` |

The key travels in the `Authorization: Bearer` header and the entity code
in `X-Synexus-Entity`; the URL never carries a credential. The
`request_id` is the idempotency key of the calculation requests: the
provider deduplicates a repeated body with the same key, which is what
makes the automatic retry below safe. The cancellation carries none on
purpose — it is idempotent by nature (repeating it returns 404/422 with no
double effect, and its 409 is documented as safe to retry).

Every v2 run prints one profile line before touching the network:

```
Perfil efectivo -> contrato: v2 | host: https://... | entidad: USA | llave: synexus_test_...abcd
```

The key is deliberately masked (prefix plus last four characters). That is
the expected output, not a truncation bug.

### Reverting to v1

Reverting production to v1 is a configuration change, not a deployment:
set `TAX_API_VERSION=v1` (or remove the line) in `.env` and the next run
takes the v1 path with the same `BASE_URL` / `API_CODE` as always. No
code changes, no `npm install`, no restart of anything — the process is
one invocation, one operation. The `SYNEXUS_*` variables can stay in the
file; they are ignored under v1.

### Input File Format

The input JSON file should contain the transaction data in the format expected by the Magento Tax API. The `Committed` field is crucial:

- For `get_tax`: Set `"Committed": false`
- For `post_tax`: Set `"Committed": true`
- For `cancel_tax`: The `Committed` value is not validated

Under **v2** the input file is the request body of the v2 contract
(`invoice_id`, `customer_id`, `to_state`, `cart[].item_id`,
`cart[].tax_code`, ...) and must **not** contain `Committed`: a file that
brings it is treated as a v1 file and the run aborts with a message
containing `parece del contrato v1`. A file whose root is an array is also
rejected (`debe ser un objeto JSON, no un arreglo`). nexgen owns the
intent fields and adds them itself: `get_tax` sends `transaction_type:
"sales_estimate"`, `committed: false` and a fresh `request_id`; `post_tax`
sends `transaction_type: "sales_invoice"`, `committed: true` and a fresh
`request_id`. If the file already carries a `transaction_type` or
`committed` that contradicts the operation — or its own `request_id` —
the run aborts instead of overwriting silently. For `cancel_tax` the file
only needs non-empty `invoice_id` and `customer_id` (the ERP may leave the
same calculation-shaped file; everything else is ignored); if either is
missing the run aborts before any request, naming the field. Under v2 the
strings of the file travel verbatim — the apostrophe escape (`'` → `\'`)
is a v1-only rule.

### Output

- Successful responses are saved as `RESPONSE_<original_filename>.json` in the directory specified by `OUTPUT_DIR`
- Error logs are saved in the `logs/` directory with daily rotation
- Console output shows success/error messages

### v2 diagnostics

Every v2 run leaves the provider's request identifier on the console —
it is what the provider asks for when opening a support case:

- **Success:** `SUCCESS: <operation> - Status: 200 - request_id=<id>`.
  The id comes from `meta.request_id` in the calculation response, or
  from the `X-Request-Id` response header (the only source for
  `cancel_tax`). The response is written to the file verbatim: amounts
  and rates stay the quoted strings the provider sent (`"49.99"`,
  `"0.0825"`), nothing is parsed or rounded.
- **Calculation error (`get_tax` / `post_tax`):**
  `Error HTTP <status> (<code>): <Spanish description> - request_id=<id>`.
  The branch is decided by the provider's stable `code` — `invalid_key`,
  `tax_code_missing`, `idempotency_key_conflict`, `invoice_stale_object`,
  `rate_limited` (names the `Retry-After` seconds), `cart_empty`,
  `validation_error` (lists `details`) — never by the wording of its
  `message`, which is only quoted.
- **Cancel error:** `Error HTTP <status>: <Spanish description> Mensaje
  del proveedor: "<verbatim>" - request_id=<id>`. Cancel errors carry no
  `code`, so they are classified by status: 400 invalid body, 404 the
  invoice does not exist in that environment, 409 conflict with another
  operation on the same invoice, 422 already cancelled or never
  confirmed.
- **Transport failure** (timeout, refused connection, 5xx): the
  diagnostic block ends with `Identificador para soporte: request_id=…`
  — the provider's id when it answered, the `request_id` nexgen
  generated (`generado por nexgen`) when it did not.
- **Automatic retry:** on a timeout, a 502/503/504, the calculation's
  `409 invoice_stale_object` or the cancel 409, nexgen waits one second
  and sends the **same body once more** — same `request_id` — printing
  `Reintentando (1/1) con la misma llave de idempotencia (request_id=…)
  tras …` (or `… con el mismo cuerpo …` for the cancellation, which has
  no key). One retry, never more, and never on 401, 400/404/422, 429,
  500, a refused connection or a `409 idempotency_key_conflict` (same
  key, different body: the file changed between runs and needs a human).
  If the retry fails too, the reported error is the second attempt's.
  **Do not re-run a failed `post_tax` by hand to "retry" it**: a new
  process is a new `request_id`, and the provider will treat it as a new
  invoice.

## Logging

The application uses Winston for error logging:

- Log files are created daily in the `logs/` directory
- Format: `log_YYYY-MM-DD.log`
- Only error-level messages are logged to files

## Error Handling

The application validates:

- Command-line arguments
- Environment variables
- JSON file format
- `Committed` field values based on operation type
- API response handling

All errors are logged both to console and log files for debugging purposes.
Under v2 the log entry also carries the `request_id` (see *v2
diagnostics* above), and a transient failure is retried once with the
same body before it is reported.

## Project Structure

```tree
nexgen/
├── index.js                          # Entry point with dependency injection
├── src/
│   ├── cli/                          # CLI interface layer
│   ├── validators/                   # Business rules validation
│   ├── api/                          # HTTP API clients (v1: taxApiClient, v2: synexusApiClient + synexusRequestBuilder)
│   ├── storage/                      # File system operations
│   ├── infrastructure/               # Logging and cross-cutting concerns
│   └── config/                       # Configuration management (v1: index.js, v2: synexusConfig.js)
├── tests/                            # Jest suite (no .env, no credentials, no network)
├── jest.config.js                    # Test runner configuration
├── logs/                             # Application logs
├── .env                              # Environment variables
├── package.json                      # Project metadata and dependencies
├── package-lock.json                 # Exact dependency versions
└── README.md                         # This documentation
```

## Development

### Running Tests

```bash
npm test
```

The suite runs on Jest (pinned as a `devDependency`; the three runtime
dependencies are untouched) and needs **no `.env`, no credentials and no
network access**: `tests/setup.js` forces fictitious environment
variables and blocks every outgoing HTTP call before any test file loads,
so it can be run on any machine — including the company server — without
touching a real API. Only `axios` is substituted in the tests; every
other class is the real one. A single test file, `tests/*.test.js`, can be
run with `npm test -- tests/<file>.test.js`.

The suite also freezes the v1 path (HTTP method, resolved URL,
authentication mechanism, error messages and argument parsing): any change
in v1's observable behavior turns `npm test` red.

### Code Structure

Each layer is independent and testable:

- **CLI Layer**: Command parsing and orchestration
- **Validation Layer**: Business rules and data validation
- **API Layer**: HTTP communication with tax API
- **Storage Layer**: File operations
- **Infrastructure**: Logging, configuration

## Contributing

When adding new features:

1. Apply SOLID principles
2. Add appropriate error handling
3. Update tests and documentation
