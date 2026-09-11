---
description: Run cancel_tax against a fixture in test-files/ to revert a previously committed transaction.
argument-hint: [filename in test-files/]
allowed-tools: Read, Bash(node:*), Bash(ls:*), Bash(cat:*)
---

# /tax-cancel

Revert a previously committed tax transaction by hitting the
`CancelTransaction` endpoint with the fixture `$ARGUMENTS`.

> **Contract note.** This command runs the **v1** path by default. The
> `--api-version=v2` flag (or `TAX_API_VERSION=v2`) selects the Synexus
> Compute contract, where `cancel_tax` is a **different endpoint with a
> different body** (plan 02-02): `POST <SYNEXUS_BASE_URL>/api/v1/invoices/cancel`
> with **exactly** `{ invoice_id, customer_id }` projected from the file
> — no `cart`, no `transaction_type`/`committed`, no `request_id`. If
> either field is missing/empty the run aborts before any request with
> `Para cancelar bajo el contrato v2 el archivo debe traer "invoice_id" y
> "customer_id"; falta(n): …`. A v1-shaped file (`Committed`) under v2
> aborts with `parece del contrato v1`. Do not add the flag here unless
> the user asks for v2; everything below describes v1.

> **Note on TEST_MODE**: `cancel_tax` **does not respect `TEST_MODE`**.
> The URL is always `<BASE_URL>CancelTransaction` regardless. If you
> need to cancel a sandbox transaction, the same endpoint is used —
> coordinate with the API team if this is ambiguous.

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
   error, and vice versa.

## Steps

1. Run:
   ```bash
   node index.js cancel_tax test-files/$ARGUMENTS
   ```
2. Capture:
   - URL printed. It should end with `CancelTransaction` (no `?code=`,
     no `_TEST` suffix).
   - Status code.
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
- There is no idempotency guarantee in this codebase — re-running
  cancel may or may not error depending on the API's behavior.

## If something fails

- HTTP 4xx (transaction not found, etc.): show the server message
  verbatim. Don't retry.
- HTTP 5xx: escalate per `RUNBOOK.md` §8.
- Network failure: see `RUNBOOK.md` §4.1.
