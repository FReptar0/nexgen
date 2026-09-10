# Deferred items — Phase 01

Descubrimientos fuera del alcance del plan en curso. No se corrigen en el plan que los
encuentra; se registran aquí para que el plan o milestone correcto los recoja.

## Registrados durante 01-02

- **Los agentes y comandos versionados en `.claude/` describen sólo el ciclo de vida v1.**
  `.claude/agents/nexgen-explorer.md` traza `validator.validate → apiClient.makeRequest` como
  única secuencia de `execute()`, y `.claude/commands/tax-quote.md`, `tax-commit.md` y
  `tax-cancel.md` exigen `Committed` en el JSON e invocan sin flags. Siguen siendo exactos
  para v1 (que es el camino por omisión), pero `CLAUDE.md` pide actualizarlos cuando cambie
  el código que referencian. Conviene hacerlo **al cerrar el plan 01-04**, cuando el camino v2
  ya emita la petición y haya algo real que documentar (`--api-version=v2`, `--entity=`,
  el perfil impreso y las variables `SYNEXUS_*`). Hacerlo antes documentaría un camino que
  todavía se detiene en la guardia de cableado.

- **`.env.example` no pudo crearse desde la sesión.** La configuración de permisos del
  proyecto (`.claude/settings.json`) niega `Write`, `Edit` y `Read` sobre `./.env.*`, y
  también negó la escritura por shell. Es una decisión del dueño del repo y no se rodeó.
  El contenido propuesto está en `01-02-SUMMARY.md` §User Setup Required, listo para pegar.
  Si el dueño prefiere mantener la regla tal cual, la alternativa es documentar las variables
  en `HANDOFF.md` §9 (que ya tiene la tabla de v1) en vez de en un archivo `.env.*`.
