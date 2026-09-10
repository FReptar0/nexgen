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
  goes here; the calculation path (`/api/v1/tax_calculations`) is added by
  the code. Staging is `https://compute.staging.synexustax.com`,
  production is `https://compute.synexustax.com`.
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
in the environment. Under v2, only `get_tax` is implemented in this
milestone phase: `post_tax` and `cancel_tax` with `--api-version=v2` abort
before any request is made.

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
(`invoice_id`, `to_state`, `cart[].item_id`, `cart[].tax_code`, ...) and
must **not** contain `Committed`: a file that brings it is treated as a v1
file and the run aborts with a message containing `parece del contrato v1`.
nexgen owns the intent fields and adds them itself: `get_tax` sends
`transaction_type: "sales_estimate"`, `committed: false` and a fresh
`request_id`. If the file already carries a `transaction_type` or
`committed` that contradicts the operation, the run aborts instead of
overwriting silently.

### Output

- Successful responses are saved as `RESPONSE_<original_filename>.json` in the directory specified by `OUTPUT_DIR`
- Error logs are saved in the `logs/` directory with daily rotation
- Console output shows success/error messages

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
