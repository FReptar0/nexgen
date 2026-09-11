# Technology Stack

**Analysis Date:** 2026-09-11

## Languages

**Primary:**
- JavaScript (Node.js, CommonJS module system, no ESM) - entire codebase: `index.js`, `src/**/*.js`, `tests/**/*.test.js`. `require`/`module.exports` throughout; no `"type": "module"` in `package.json`, no `import`/`export` syntax anywhere.

**Secondary:**
- None. No TypeScript, no `.mjs`, no other language runtime in the repo.

## Runtime

**Environment:**
- Node.js 14+ (documented minimum — `README.md` "Requirements" section and `CLAUDE.md`). Not enforced in code: no `engines` field in `package.json`, no `.nvmrc`. The `crypto.randomBytes`-based UUID generator in `src/api/synexusRequestBuilder.js:99-108` deliberately avoids `crypto.randomUUID()` (Node 14.17+) because the production server's exact Node version is unverified.
- Local exploration environment observed `node --version` = v23.10.0; this is not a pinned requirement, just what was available while mapping.

**Package Manager:**
- npm (10.9.2 observed locally)
- Lockfile: present — `package-lock.json`, `lockfileVersion: 3`. No `yarn.lock` or `pnpm-lock.yaml`.

## Frameworks

**Core:**
- None. This is not a web server or long-running service — `index.js` is a one-shot CLI entry point that runs a single operation and exits (`process.exit(1)` on error, implicit exit on success). There is no HTTP listener anywhere in the codebase.

**Testing:**
- Jest 29.7.0 (devDependency, pinned exact — not `^29.7.0`). Added in Phase 1 of the v2 migration (2026-09-11); did not exist before. Config: `jest.config.js` (`testEnvironment: 'node'`, `setupFiles: ['<rootDir>/tests/setup.js']`). 9 test suites, 242 cases total (per `.planning/PROJECT.md`), run via `npm test`. See `TESTING.md` for patterns (quality-focus doc, not covered by this pass).

**Build/Dev:**
- None. No bundler, no transpiler, no linter config (no `.eslintrc*`, no `eslint.config.*`), no formatter config (no `.prettierrc*`), no `.editorconfig`, no CI config (no `.github/workflows/`, no other `*.yml`/`*.yaml` CI file found in the repo root).

## Key Dependencies

**Critical:**
- `axios` ^1.7.9 (resolved `1.7.9`) - sole HTTP transport for both external integrations. Two call sites, one per contract: `src/api/taxApiClient.js` (v1) and `src/api/synexusApiClient.js` (v2). Convention (`CLAUDE.md`): never import `axios` outside these two files. Both clients fix `this.timeout = 30000` (ms) independently — not a shared constant.
- `dotenv` ^16.4.7 (resolved `16.4.7`) - loads `.env` from the repo root exactly once, in `src/config/index.js:3`. `src/config/synexusConfig.js` does **not** call `dotenv.config()` itself; it depends on `src/config/index.js` having already run (see the load-order warning comment at the top of that file) — if that require order were ever reversed, `SYNEXUS_*` vars would read empty even with a correct `.env`.
- `winston` ^3.17.0 (resolved `3.17.0`) - sole logging sink, wired in `src/infrastructure/logger.js`. Level fixed at `error`; only transport is a daily-rotated file (`logs/log_YYYY-MM-DD.log`). `Logger.info/warn/debug` exist as public methods but are no-ops at this transport — the codebase convention is `console.log` for trace output instead (none of which is persisted to disk).

**Known vulnerabilities (deliberately deferred):**
- `npm audit` reports 3 advisories, all transitive via `axios`: `form-data` (critical), `axios` itself (high), `follow-redirects` (moderate). Resolved transitive versions per `package-lock.json`: `follow-redirects@1.15.9`, `form-data@4.0.2`. Fixing requires upgrading `axios`, the same client that carries v1's unusual GET-with-body pattern (`src/api/taxApiClient.js`) — explicitly moved `Out of Scope` for the current milestone in `.planning/PROJECT.md`, pending its own milestone with explicit v1 revalidation. Do not run `npm audit fix` on this repo without that context.

**Infrastructure:**
- None beyond the three runtime dependencies above. No database driver, no cache client, no message queue client, no ORM.

## Configuration

**Environment:**
- `.env` at repo root, gitignored, loaded once by `src/config/index.js:3`.
- A second, undotted `env` file also exists at repo root (also gitignored; `.gitignore` flags it explicitly as containing `API_CODE`, noted as having "appeared loose" per a 2026-09-09 meeting). Existence noted only — contents not read, per this mapping pass's security policy.
- All `process.env` reads in production code are centralized in exactly two files: `src/config/index.js` (v1 + the contract selector) and `src/config/synexusConfig.js` (v2). Convention (`CLAUDE.md`): no other layer reads `process.env` directly.
- `src/config/index.js` exports a **singleton instance** (`module.exports = new Config()`) — required env vars are validated at first `require`, i.e. at process startup, for every run regardless of which contract is selected.
- `src/config/synexusConfig.js` exports the **class**, not an instance, deliberately: it is only ever `new`'d in `index.js` when the resolved contract is `v2` (see selector below), so a server with no `SYNEXUS_*` variables set never trips v2's constructor-time validation and v1 keeps working untouched.

**Contract/version selector (chooses between the two integrations documented in `INTEGRATIONS.md`):**
- `TAX_API_VERSION` env var - `Config.getApiVersion()` (`src/config/index.js:64-68`). Strict `=== 'v2'` comparison: absent, empty, or misspelled resolves to `v1` — no accidental v2 activation.
- `--api-version=<v1|v2>` CLI flag - `TaxCommandHandler.resolveApiVersion()` (`src/cli/taxCommandHandler.js:51-68`, static method), overrides the env var for a single invocation. Any value other than exactly `v1` or `v2` throws rather than silently defaulting.
- Resolved once in `index.js:59`, **before** the dependency-injection graph is built, so `SynexusConfig`/`SynexusApiClient` are constructed (and only then validate their own env vars) only when v2 is actually selected; under v1 both stay `null` (`index.js:60-65`).

**Build:**
- None. No build config files exist. `node index.js <operation> <path>` executes source directly — no compile step, ever.

## Platform Requirements

**Development:**
- Node.js 14+, npm.
- Running the test suite requires nothing external: no `.env`, no credentials, no network access. `tests/setup.js` supplies fictitious env values and blocks outbound HTTP before any `src/` module loads (see `INTEGRATIONS.md` "Test Isolation" for detail).
- Running the CLI for real requires a populated `.env` with at minimum `BASE_URL`, `API_CODE`, `OUTPUT_DIR` (v1, always required), plus `SYNEXUS_BASE_URL` and `SYNEXUS_API_KEY` if `TAX_API_VERSION=v2` or `--api-version=v2` will be used.

**Production:**
- Runs on-premises as an ERP-invoked CLI, not as a hosted/deployed service. The documented example `OUTPUT_DIR` (`README.md`) is a Windows path (`C:\Directorio_de_Trabajo\NEO\Taxes\respuesta`), indicating the real deployment target is a Windows server colocated with Sage 300, invoked per-transaction by an ERP wrapper script running `node index.js get_tax <path>` with no flags.
- No containerization (no `Dockerfile`, no `docker-compose*.yml`) found in the repo.
- No process manager or service config (no `pm2` ecosystem file, no `systemd` unit) found in the repo — process lifecycle is entirely the ERP wrapper's responsibility (one invocation, one operation, exit).

---

*Stack analysis: 2026-09-11*
