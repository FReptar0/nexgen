# Technology Stack

**Analysis Date:** 2026-09-10

## Languages

**Primary:**
- JavaScript (Node.js, CommonJS) - entire codebase: `index.js`, `src/**/*.js`. No `"type": "module"` in `package.json`; no `import`/`export` syntax anywhere, only `require`/`module.exports`.

**Secondary:**
- None. No TypeScript (no `tsconfig.json`, no `.ts` files). No other application language.

## Runtime

**Environment:**
- Node.js, stated requirement "14 or higher" (`README.md`, `CLAUDE.md`). Not enforced in code: `package.json` has no `engines` field, so an older/newer Node can still run it without a warning.
- Sandbox used for this analysis has Node v23.10.0 / npm 10.9.2 installed, but that is this machine's local toolchain, not a pinned project requirement.
- No `.nvmrc` or `.node-version` file present.

**Package Manager:**
- npm (evidenced by `package-lock.json`, `lockfileVersion: 3`).
- Lockfile: present (`package-lock.json`).

## Frameworks

**Core:**
- None. This is a plain Node.js CLI script with no web/application framework (no Express, Fastify, Nest, etc.). Structure is a hand-rolled 5-layer architecture (CLI → Validator → API → Storage → Infrastructure) wired together manually via constructor-injection in `index.js`.

**Testing:**
- None installed. `package.json` `"scripts.test"` is the default stub: `"echo \"Error: no test specified\" && exit 1"`. No Jest/Mocha/Vitest dependency, no test files anywhere in the repo.
- `ARCHITECTURE.md` §10 ("Testing gap") documents this as a known gap and sketches a target Jest setup (`testEnvironment: 'node'`, per-layer `__tests__` folders, mocks for `axios`/`fs`/`dotenv`) — none of it exists yet.

**Build/Dev:**
- None. No bundler (webpack/esbuild/rollup/vite), no transpiler (Babel/SWC/tsc), no dev server, no linter config (no `.eslintrc*`, no `eslint.config.*`), no formatter config (no `.prettierrc*`). Execution is direct: `node index.js <operation> <file>`.

## Key Dependencies

**Critical:**
- `axios ^1.7.9` (resolved `1.7.9`) - sole HTTP client for the outbound tax API call. Used exclusively inside `src/api/taxApiClient.js`; project convention (`CLAUDE.md`) forbids importing `axios` from any other file.
- `dotenv ^16.4.7` (resolved `16.4.7`) - loads the root `.env` file. Invoked once, at the top of `src/config/index.js:3`; every other layer reads config through the `Config` singleton, never `process.env` directly.
- `winston ^3.17.0` (resolved `3.17.0`) - file-based logger, wrapped by `src/infrastructure/logger.js`. Configured for `error` level only, writing to `logs/log_<YYYY-MM-DD>.log`.

**Infrastructure:**
- None beyond the three packages above. All other entries in `package-lock.json` (`follow-redirects`, `form-data`, `logform`, `readable-stream`, `color`, etc.) are transitive sub-dependencies of `axios`/`winston`, not directly imported anywhere in `src/`.

## Configuration

**Environment:**
- Loaded via `dotenv.config({ path: path.resolve(__dirname, '../../.env') })` in `src/config/index.js:3`, executed once when the `Config` singleton module is first required (`index.js:24`).
- Precedence (`ARCHITECTURE.md` §8): values already present in `process.env` (e.g. set by the invoking shell/wrapper) win over `.env`; `.env` fills the rest; there are no built-in defaults for the three required vars.
- Required (constructor throws if any is missing — `src/config/index.js:19-26`): `BASE_URL`, `API_CODE`, `OUTPUT_DIR`.
- Optional: `TEST_MODE` (compared with strict `=== 'true'`; anything else, including unset, behaves as `false`).
- `.env` lives at the repo root and is gitignored. A second, undotted file named `env` also exists at the repo root (untracked/local) — per a `.gitignore` comment it "trae API_CODE" (carries `API_CODE`). It is **not** loaded by the app (only `../../.env` is referenced in code); its existence is noted here, contents were not read.
- Full required-var table and rationale: `HANDOFF.md` §9.

**Build:**
- No build config files exist (no `tsconfig.json`, `webpack.config.js`, `babel.config.js`, `.eslintrc*`, `.prettierrc*`, `jest.config.*`). The only "config" artifacts are `package.json` / `package-lock.json`.

## Platform Requirements

**Development:**
- Node.js 14+ on any OS capable of running Node (README states no OS constraint for dev). `data/` (gitignored) is used for local notes/meeting PDFs and is not part of the runtime.

**Production:**
- Windows. `RUNBOOK.md` §1 documents production invocation as a child process of the Sage 300 ERP through a PowerShell wrapper (`wrapper-nexgen.ps1`), typical install path `C:\nexgen`, Node binary at `C:\Program Files\nodejs\node.exe`. A `.bat` wrapper is documented as a simpler alternative.
- No daemon and no built-in scheduler — the ERP job (or Windows Task Scheduler, per `RUNBOOK.md`) controls invocation cadence; each run is a single operation then exit. A Linux/macOS `cron` alternative is documented for non-ERP periodic runs (dev/test only).
- `OUTPUT_DIR` values seen in docs use Windows path syntax (e.g. `C:\Directorio_de_Trabajo\NEO\Taxes\respuesta`), confirming the production target.

---

*Stack analysis: 2026-09-10*
