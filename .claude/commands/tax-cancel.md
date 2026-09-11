---
description: Run cancel_tax against a fixture in test-files/ to revert a previously committed transaction.
argument-hint: [filename in test-files/]
allowed-tools: Read, Bash(node:*), Bash(ls:*), Bash(cat:*)
---

# /tax-cancel

Revert a previously committed tax transaction by hitting the
`CancelTransaction` endpoint with the fixture `$ARGUMENTS`.

> **Contract note.** This command runs the **v1** path by default. The
> `--api-version=v2` flag (or `TAX_API_VERSION=v2` in `.env`) selects the
> Synexus Compute contract, where `cancel_tax` is a **different endpoint
> with a different body** (plan 02-02): `POST
> <SYNEXUS_BASE_URL>/api/v1/invoices/cancel` with **exactly**
> `{ invoice_id, customer_id }` projected from the file — no `cart`, no
> `transaction_type`/`committed`, no `request_id` (documented exception:
> the cancellation is idempotent by nature, so it carries no idempotency
> key). If either field is missing/empty the run aborts before any
> request with `Para cancelar bajo el contrato v2 el archivo debe traer
> "invoice_id" y "customer_id"; falta(n): …`. A v1-shaped file
> (`Committed`) under v2 aborts with `parece del contrato v1`.
> `--entity=<code>` is the first delivery path of the entity code (then
> `SYNEXUS_ENTITY`, then the file's `entity_id`), sent in
> `X-Synexus-Entity`; the `SYNEXUS_*` variables must be set. `TEST_MODE`
> does **not** apply to v2 either: the environment is `SYNEXUS_BASE_URL`
> plus the key prefix, and the profile line (`Perfil efectivo -> …`) is
> printed before anything is sent. Cancel errors under v2 carry no
> `code`: they are classified by HTTP status (400/404/409/422) as `Error
> HTTP <status>: <Spanish description> Mensaje del proveedor: "<verbatim>"
> - request_id=<X-Request-Id>` (plan 02-03), and the success line carries
> the same header id. On a timeout, a 502/503/504 or a 409, nexgen
> **retries once automatically with the same body** (plan 02-04,
> `Reintentando (1/1) con el mismo cuerpo …` on stdout; the contract
> marks the cancel 409 as safe to retry). Do not add the flag here unless
> the user asks for v2; everything below describes v1 unless marked
> otherwise.

> **Note on TEST_MODE**: `cancel_tax` **does not respect `TEST_MODE`**.
> The URL is always `<BASE_URL>CancelTransaction` regardless. If you
> need to cancel a sandbox transaction, the same endpoint is used —
> coordinate with the API team if this is ambiguous. (Under v2 the
> question does not arise: staging and production are different hosts in
> `SYNEXUS_BASE_URL`, and the key prefix must match the host.)

## Pre-flight

1. Fixture `test-files/$ARGUMENTS` exists. List candidates if not:

   !`ls -1 test-files/ 2>/dev/null || echo "(test-files/ is gitignored — fixtures must be present locally)"`

2. `cancel_tax` does **not** validate the `Committed` field, so its
   value doesn't matter for argv parsing. But for safety: confirm with
   the user that the transaction in this fixture was previously
   committed (otherwise there's nothing to cancel and the API will
   likely return an error).
3. Confirm `BASE_URL` and `API_CODE` in `.env` match the environment
   where the original `post_tax` was issued. Cancelling a sandbox
   transaction against the production API will produce a "not found"
   error, and vice versa. (Under v2 the same applies to
   `SYNEXUS_BASE_URL` / `SYNEXUS_API_KEY`: a 404 means the invoice does
   not exist **in that environment**; under v2 the fixture must also
   carry non-empty `invoice_id` and `customer_id`, and no `Committed`.)

## Steps

1. Run:
   ```bash
   node index.js cancel_tax test-files/$ARGUMENTS
   ```
   For the v2 contract, only when the user asked for it:
   ```bash
   node index.js cancel_tax test-files/$ARGUMENTS --api-version=v2 --entity=<code>
   ```
2. Capture:
   - URL printed. It should end with `CancelTransaction` (no `?code=`,
     no `_TEST` suffix). Under v2 it must end with
     `/api/v1/invoices/cancel` — **not** `/tax_calculations`.
   - Status code.
   - Under v2, the line `SUCCESS: cancel_tax - Status: 200 -
     request_id=<id>`; the id comes from the provider's `X-Request-Id`
     response header (the cancel body has no `meta`). Keep it for
     support.
   - Under v2, whether a `Reintentando (1/1) con el mismo cuerpo …` line
     appeared (first attempt hit a timeout, a 502/503/504 or a 409). It
     is expected behavior; report it.
   - The `RESPONSE_$ARGUMENTS.json` in `OUTPUT_DIR`.
3. Report:
   - Endpoint actually hit.
   - Status code.
   - Any acknowledgement / error message in the response.
   - Exit code.

## Reminders

- The cancel response **overwrites** any prior `RESPONSE_$ARGUMENTS.json`
  on disk. If the operator needs to preserve the original commit
  response for audit, **copy it before running this**.
- Idempotency depends on the contract. **v1:** there is no guarantee in
  this codebase — re-running cancel may or may not error depending on
  the API's behavior. **v2:** the cancellation is idempotent by nature —
  repeating it on an already-cancelled invoice returns 404/422 with no
  double effect, which is why the v2 body carries no `request_id` and
  why nexgen may retry its 409 once automatically.

## If something fails

- HTTP 4xx (transaction not found, etc.): show the server message
  verbatim. Don't retry. Under v2 the cancel errors carry no `code` and
  arrive classified by status, always with the provider's `message`
  quoted verbatim and the `request_id`:
  - 400: the body is not valid for the provider (`no es válido`).
  - 404: the invoice does not exist **in that environment** (`no
    existe`) — check `invoice_id`, `customer_id` and that the original
    `post_tax` went against this same `SYNEXUS_BASE_URL`.
  - 409: conflict with another operation on the same invoice (`chocó`).
    nexgen already retried once automatically; if it still shows, the
    invoice is busy — wait and surface to the user.
  - 422: the provider cannot cancel it — already cancelled or never
    confirmed (`no puede cancelar`).
- HTTP 5xx: under v2, a 502/503/504 or a timeout was already retried
  once automatically with the same body (`Reintentando (1/1) …`); the
  reported error is the second attempt's. Escalate per `RUNBOOK.md` §8.
- Network failure: see `RUNBOOK.md` §4.1.
