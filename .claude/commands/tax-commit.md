---
description: Run post_tax (COMMITTING) against a fixture in test-files/. Requires Committed=true. Warns about TEST_MODE before running.
argument-hint: [filename in test-files/]
allowed-tools: Read, Bash(node:*), Bash(ls:*), Bash(cat:*)
---

# /tax-commit

> **WARNING — this command commits.** `post_tax` records a taxable
> event in the remote system. In production (`TEST_MODE=false`) this
> impacts the customer's actual tax liability. In test
> (`TEST_MODE=true`) it impacts the sandbox.

Run `post_tax` against the fixture `$ARGUMENTS` and explain the
outcome.

## Pre-flight (mandatory)

Before invoking `node`, confirm these out loud to the user:

1. The fixture `test-files/$ARGUMENTS` exists. List candidates if not:

   !`ls -1 test-files/ 2>/dev/null || echo "(test-files/ is gitignored — fixtures must be present locally)"`

2. The fixture has `"Committed": true`. If it has `false`, **stop**.
   `post_tax` will fail with the validation error
   `Para la operación post_tax, el valor "Committed" debe ser true.`
3. **Confirm `TEST_MODE` with the user explicitly.** Do not assume.
   - If they say "test", they should already have `TEST_MODE=true` in
     `.env`. The URL printed will contain `STCCalcV3_TEST`.
   - If they say "production", `TEST_MODE` should be `false` or
     absent, and the URL will contain `STCCalcV3` (no suffix).
   - If they are unsure, **stop** and ask. Do not run.
4. Confirm `OUTPUT_DIR` is somewhere they can read the response from.

## Steps

1. Run:
   ```bash
   node index.js post_tax test-files/$ARGUMENTS
   ```
2. Capture:
   - URL printed (verify the suffix matches the expected mode).
   - Status code.
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
  from the `_handleError` output.
- HTTP 5xx: the API is unhappy. Don't retry blindly — escalate per
  `RUNBOOK.md` §8.
- Network failure: see `RUNBOOK.md` §4.1.

Never silently re-run on failure for `post_tax`.
