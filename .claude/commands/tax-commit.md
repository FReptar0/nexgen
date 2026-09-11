---
description: Run post_tax (COMMITTING) against a fixture in test-files/. Requires Committed=true. Warns about TEST_MODE before running.
argument-hint: [filename in test-files/]
allowed-tools: Read, Bash(node:*), Bash(ls:*), Bash(cat:*)
---

# /tax-commit

> **WARNING — this command commits.** `post_tax` records a taxable
> event in the remote system. In production (`TEST_MODE=false`) this
> impacts the customer's actual tax liability. In test
> (`TEST_MODE=true`) it impacts the sandbox. Under v2 the environment is
> not `TEST_MODE` but `SYNEXUS_BASE_URL` plus the key prefix
> (`synexus_test_` = staging, `synexus_live_` = production).

Run `post_tax` against the fixture `$ARGUMENTS` and explain the
outcome.

> **Contract note.** This command runs the **v1** path by default. The
> `--api-version=v2` flag (or `TAX_API_VERSION=v2` in `.env`) selects the
> Synexus Compute contract. Under v2, `post_tax` goes to the **same**
> calculation route as `get_tax` — `POST
> <SYNEXUS_BASE_URL>/api/v1/tax_calculations` — with the intent inverted:
> nexgen itself sets `transaction_type: "sales_invoice"` and
> `committed: true` (the only combination that registers a confirmed
> invoice on the provider side) plus a fresh `request_id`, the
> idempotency key. The file must be in v2 shape: it must **not** carry
> `Committed` (the run aborts with `parece del contrato v1`), and a
> `committed: false` or a `transaction_type: "sales_estimate"` in the
> file aborts before any request. `--entity=<code>` is the first delivery
> path of the entity code (then `SYNEXUS_ENTITY`, then the file's
> `entity_id`); the `SYNEXUS_*` variables must be set. `TEST_MODE` does
> **not** apply to v2: the environment is decided by `SYNEXUS_BASE_URL`
> and the key prefix, and a mismatch aborts at startup. Before sending,
> the run prints the profile line (`Perfil efectivo -> contrato: v2 |
> host: … | entidad: … | llave: synexus_test_...abcd`, masked key on
> purpose) and the body
> (`Cuerpo v2 a enviar:`). The response is written verbatim to
> `RESPONSE_<file>.json` with amounts as quoted strings. The success line
> carries the provider's id (`SUCCESS: post_tax - Status: 200 -
> request_id=<meta.request_id>`) and a 4xx surfaces classified by `code`
> — `Error HTTP <status> (<code>): <Spanish description> -
> request_id=<id>` (plan 02-03). On a timeout, a 502/503/504 or a `409
> invoice_stale_object`, nexgen **retries once automatically with the
> same body and the same `request_id`** (plan 02-04, `Reintentando (1/1)
> …` on stdout); a `409 idempotency_key_conflict` means the file changed
> between runs and is never retried. Do not add the flag unless the user
> asks for v2; everything below describes v1 unless marked otherwise.

## Pre-flight (mandatory)

Before invoking `node`, confirm these out loud to the user:

1. The fixture `test-files/$ARGUMENTS` exists. List candidates if not:

   !`ls -1 test-files/ 2>/dev/null || echo "(test-files/ is gitignored — fixtures must be present locally)"`

2. The fixture has `"Committed": true`. If it has `false`, **stop**.
   `post_tax` will fail with the validation error
   `Para la operación post_tax, el valor "Committed" debe ser true.`
   (Under `--api-version=v2` the rule inverts: the file must **not**
   carry `Committed` at all; if it carries `committed`, it must be
   `true`, and `transaction_type`, if present, must be `sales_invoice`.)
3. **Confirm `TEST_MODE` with the user explicitly.** Do not assume.
   - If they say "test", they should already have `TEST_MODE=true` in
     `.env`. The URL printed will contain `STCCalcV3_TEST`.
   - If they say "production", `TEST_MODE` should be `false` or
     absent, and the URL will contain `STCCalcV3` (no suffix).
   - If they are unsure, **stop** and ask. Do not run.
   - Under v2, `TEST_MODE` is ignored: confirm instead that the host in
     the profile line (`host: …`) and the key prefix in `llave: …` are
     the environment the user means. Staging = `compute.staging.` +
     `synexus_test_`; production = `compute.` + `synexus_live_`.
4. Confirm `OUTPUT_DIR` is somewhere they can read the response from.

## Steps

1. Run:
   ```bash
   node index.js post_tax test-files/$ARGUMENTS
   ```
   For the v2 contract, only when the user asked for it:
   ```bash
   node index.js post_tax test-files/$ARGUMENTS --api-version=v2 --entity=<code>
   ```
2. Capture:
   - URL printed (verify the suffix matches the expected mode; under v2
     it must end in `/api/v1/tax_calculations` with no `?code=`).
   - Status code.
   - Under v2, the line `SUCCESS: post_tax - Status: 200 -
     request_id=<provider id>`. **Keep that `request_id`**: it is what
     the provider asks for in support, and the only handle on the
     confirmed invoice besides the response file.
   - Under v2, whether a `Reintentando (1/1) …` line appeared: it means
     the first attempt timed out or got a transient 5xx and the same
     body was sent again. Report it; it is expected behavior, not an
     error.
   - The `RESPONSE_$ARGUMENTS.json` in `OUTPUT_DIR`.
3. Report:
   - Endpoint actually hit (read it from the printed URL, do not
     re-derive).
   - Status code.
   - Total tax (from the response).
   - Any transaction identifier the API returned (the cancel path may
     need it later).
   - Exit code.

## Reminders for the operator

- The response file overwrites prior runs. If the operator needs to
  preserve the response (audit trail), they must copy it before the
  next invocation.
- If this was a mistake, see `/tax-cancel` — but a cancel still
  requires whatever identifier the API issued.

## If something fails

- Validation failure: print the exact Spanish error message.
- HTTP 4xx: the wire body was rejected. Show the full server message
  from the `_handleError` output. Under v2 the thrown message is
  `Error HTTP <status> (<code>): <Spanish description> - request_id=<id>`
  with the provider's stable code — quote both `code` and `request_id`:
  - `invalid_key` (401): the key was rejected; check `SYNEXUS_API_KEY`
    against `SYNEXUS_BASE_URL`.
  - `tax_code_missing` / `validation_error` / `cart_empty` (422): fix
    the ERP extraction; the file is wrong, not the environment.
  - `idempotency_key_conflict` (409): same key, different body — the
    file changed between runs. **Do not retry.** Hand it to a human.
  - `rate_limited` (429): the message names the `Retry-After` seconds.
    nexgen does not retry it; wait and surface to the user.
- HTTP 5xx / timeout: under v2, on a timeout or a 502/503/504 nexgen
  already **retried once automatically** with the same body and the same
  `request_id` (the `Reintentando (1/1) …` line on stdout) before
  reporting the failure; the error you see is the second attempt's, with
  its `request_id` in `Identificador para soporte:`. A 500 is not
  retried (the provider failed processing; repeating does not help).
  Under v1 there is no retry. Either way, don't retry blindly — escalate
  per `RUNBOOK.md` §8.
- Network failure: see `RUNBOOK.md` §4.1.

Never silently re-run on failure for `post_tax`. This holds **especially**
under v2: nexgen's automatic retry reuses the idempotency key, so the
provider deduplicates it; a second manual invocation is a new process
with a **new** `request_id`, which the provider treats as a new invoice
— that is exactly how a fiscal record gets registered twice.
