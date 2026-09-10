---
description: Run a non-committing tax quote (get_tax) against a fixture in test-files/ and explain the response.
argument-hint: [filename in test-files/]
allowed-tools: Read, Bash(node:*), Bash(ls:*), Bash(cat:*)
---

# /tax-quote

Run `get_tax` against the fixture `$ARGUMENTS` (or pick the most
recent one in `test-files/` if no argument given), then explain what
came back.

> **Contract note.** This command runs the **v1** path by default
> (`STCCalcV3` on Azure). The new Synexus Compute contract exists behind
> `--api-version=v2` (or `TAX_API_VERSION=v2` in `.env`), with an
> optional `--entity=<code>`. Under v2 the fixture must be in v2 shape
> (no `Committed` field; nexgen adds `transaction_type: "sales_estimate"`,
> `committed: false` and `request_id` itself) and the `SYNEXUS_*`
> variables must be set. Do not add the flag unless the user asks for v2.

## Pre-flight checks

- Confirm `.env` exists at the repo root (do **not** read its
  contents — the file is in the deny list).
- Confirm `node` is on PATH.
- Available fixtures:

!`ls -1 test-files/ 2>/dev/null || echo "(test-files/ is gitignored — fixtures must be present locally)"`

## Steps

1. **Validate the input JSON**: read `test-files/$ARGUMENTS`. The
   `Committed` field **must be `false`** for `get_tax` — if it's
   `true`, stop and tell the user to flip it, or copy the fixture
   under a new name and edit. Don't silently mutate the file.
   (Under `--api-version=v2` the rule inverts: the file must **not**
   have `Committed` at all, or the run aborts with
   `parece del contrato v1`.)
2. **Run the command** exactly:
   ```bash
   node index.js get_tax test-files/$ARGUMENTS
   ```
   For the v2 contract, only when the user asked for it:
   ```bash
   node index.js get_tax test-files/$ARGUMENTS --api-version=v2 --entity=<code>
   ```
3. **Capture and explain**:
   - The URL printed to stdout (verify `STCCalcV3` vs `STCCalcV3_TEST`
     against `TEST_MODE`).
   - **Under v2**, the first thing printed is the profile line:
     `Perfil efectivo -> contrato: v2 | host: ... | entidad: ... | llave: synexus_test_...abcd`.
     Verify contract, host and entity there, and the URL printed later
     ends in `/api/v1/tax_calculations` with no `?code=`. **The masked
     key (`prefix...last4`) is correct and intentional** — it is not a
     truncated or broken value; do not report it as a defect and do not
     try to print the full key.
   - The status code returned by the server.
   - The `RESPONSE_$ARGUMENTS` file in `OUTPUT_DIR` (if produced).
4. **Summarize** for the operator:
   - What operation ran.
   - Which endpoint (test or prod).
   - Sub-totals: total tax computed, line count, any line marked
     `Exempt`.
   - Exit code.

## Reminders for the operator

- `get_tax` does **not** commit. The remote system does not record a
  taxable event. Safe to run repeatedly.
- The response file overwrites prior runs against the same fixture.
- If `TEST_MODE=true`, the calculation is against the sandbox — do
  not use this result as a real invoice value.

## If something fails

- Validation failure: read the error message verbatim. It will be in
  Spanish and pinpoint the field. Don't guess — show the user.
- Network failure: see `RUNBOOK.md` §6.1 for the symptom decision
  tree.
- Don't retry on errors automatically. Surface to the user.
