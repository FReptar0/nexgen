---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
status: executing
stopped_at: Completed 01-01-PLAN.md
last_updated: "2026-09-10T20:35:35.358Z"
last_activity: 2026-09-10
progress:
  total_phases: 3
  completed_phases: 0
  total_plans: 4
  completed_plans: 1
  percent: 25
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-09-10)

**Core value:** El monto de impuesto que nexgen escribe en el archivo de respuesta tiene que ser el correcto, y no debe alterar estado en la API del proveedor sin que se haya pedido explícitamente.
**Current focus:** Phase 01 — camino-v2-de-punta-a-punta-para-una-cotizaci-n

## Current Position

Phase: 01 (camino-v2-de-punta-a-punta-para-una-cotizaci-n) — EXECUTING
Plan: 2 of 4
Status: Ready to execute
Last activity: 2026-09-10

Progress: [███░░░░░░░] 25%

## Performance Metrics

**Velocity:**

- Total plans completed: 0
- Average duration: —
- Total execution time: —

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| - | - | - | - |

**Recent Trend:**

- Last 5 plans: —
- Trend: —

*Updated after each plan completion*
| Phase 01 P01 | 6min | 3 tasks | 8 files |

## Accumulated Context

### Decisions

Las decisiones se registran en la tabla Key Decisions de PROJECT.md.
Decisiones que afectan el trabajo actual:

- [Roadmap]: Se añade v2 en paralelo en vez de refactorizar el camino existente — riesgo cero para producción y vuelta atrás con un selector, no revirtiendo commits
- [Roadmap]: El roadmap se consolida de 6 fases a 3 (granularidad `coarse`) — el encargo es migrar a la versión dos, no rediseñar nexgen, y el proyecto no da para más ceremonia. Alcance más corto, mismas garantías: ningún requisito se eliminó ni se difirió
- [Producto]: v1 es el comportamiento por defecto y v2 requiere activación explícita, con el interruptor en la configuración de entorno y un argumento de línea de comandos que lo sobreescribe. Cierra la tensión CFG-03 ↔ COMP-01 y de paso satisface VERIF-04, porque revertir deja de ser un despliegue
- [Roadmap]: OPER-01 y su guardia de regresión TEST-03 viven en la misma fase (Phase 1), porque la prueba es lo único que impide que un refactor reintroduzca la persistencia fantasma de la cotización
- [Roadmap]: La verificación contra staging es una fase final aparte (Phase 3) que ejecuta el área de ERP, no quien implementa — el proveedor restringe el acceso a EE.UU./Canadá y las credenciales viven con ese equipo
- [Roadmap]: Las fases 1 y 2 se escriben para ser comprobables sin red; el único criterio de todo el roadmap que exige una llamada en vivo es el criterio 2 de la Phase 3
- [Phase 01]: Mensajes de v1 congelados con toThrow(new Error(msg)) — Jest exige igualdad exacta del mensaje con una instancia de Error; toThrow('msg') sólo verifica contención y dejaría pasar cambios sutiles
- [Phase 01]: parseArguments se congela por propiedad (operation, filePath), no con toEqual del objeto completo — El plan 02 agrega el selector de contrato al objeto de retorno; un toEqual estricto convertiría ese cambio legítimo en un falso positivo
- [Phase 01]: Las URLs de v1 se congelan con toBe sobre la cadena completa — Es más fuerte que endsWith y fija también la concatenación sin separador de baseUrl, que es parte de la URL resuelta
- [Phase 01]: Cada prueba de congelamiento se validó por mutación antes de commitear — Alterar v1, ver fallar la suite y restaurar es lo que convierte 'la suite protege a v1' de una afirmación en un hecho

### Pending Todos

[De .planning/todos/pending/ — ideas capturadas durante las sesiones]

Ninguno aún.

### Blockers/Concerns

- ~~BLOQUEANTE — forma del JSON de entrada~~ **Rebajado el 2026-09-10 tras releer la
  transcripción.** El área de ERP dijo textualmente que genera desde Sage *"un archivo
  JSON con lo que tú vas a mandar de body"*, y el cuerpo real que entregó como referencia
  ya está en forma v2. La forma del archivo es su lado del contrato y ya la produjo.
  nexgen no traduce esquemas. Lo que el planner vio (`Committed`, `cartID`, `ToState`)
  son los archivos de la era v1, no lo que se dejará para v2.
  **Lo que sí era un defecto real, y quedó corregido en `01-CONTEXT.md`:** el plan 01-02
  hacía correr `validate()` de v1 también en la rama v2, y ese agregador lee
  `requestBody.Committed` con mayúscula — campo que el archivo v2 no trae. Habría
  rechazado todo archivo real. La rama v2 debe llamar a los métodos del validador por
  separado y cumplir `OPER-04` con `validateV2IntentFields`. Planes 01-02 y 01-03
  requieren revisión puntual.
  **Queda una confirmación de una línea con el área de ERP**, no una decisión: que la
  extracción de Sage para v2 emite la misma forma que el cuerpo del 9-sep.

- **El mecanismo del código de entidad quedó explícitamente sin definir** en la reunión del 9-sep. CFG-01 fija la precedencia (argumento > variable de entorno > campo del JSON), pero `Config` es hoy un singleton de proceso sin lugar para un valor por petición: su superficie pública probablemente cambie en Phase 1 y eso repercute en `TaxApiClient` y en el parseo de argumentos del CLI.
- ~~Discrepancia en la ruta de cálculo v2~~ **Resuelto 2026-09-10:** no era discrepancia. La referencia de API (pág. 9) documenta `/api/v1/tax_calculations/calculate` como **alias oficial** de `/api/v1/tax_calculations`. Las dos rutas funcionan; la guía de migración simplemente usó el alias. nexgen usa la ruta canónica sin `/calculate`.
- **Sin acceso a staging desde la máquina local.** Toda verificación en vivo depende del servidor de la empresa y del área de ERP. No hay forma de saltar esta frontera.
- **El repositorio no tiene ninguna prueba, CI ni linter.** Phase 1 construye la primera infraestructura de pruebas desde cero; no hay andamiaje previo que extender.

## Deferred Items

Items reconocidos y arrastrados desde el cierre del milestone anterior:

| Category | Item | Status | Deferred At |
|----------|------|--------|-------------|
| Seguridad de dependencias | DEPS-01 / DEPS-02 — `npm audit fix` y revalidación del `GET`-con-cuerpo de v1 | Diferido a milestone propio | 2026-09-10 |
| Deuda de v1 | DEBT-01 — URL base obsoleta en la documentación del repo | Diferido | 2026-09-10 |
| Deuda de v1 | DEBT-02 — marca de tiempo en el nombre del archivo de respuesta | Diferido | 2026-09-10 |
| Deuda de v1 | DEBT-03 — recalcular la fecha del log en cada escritura | Diferido | 2026-09-10 |
| Capacidades v2 | NEW-01 — flujo de devoluciones y notas de crédito | Diferido | 2026-09-10 |
| Capacidades v2 | NEW-02 — promoción de snapshot a factura confirmada | Diferido | 2026-09-10 |
| Corte a producción | PROD-01 — ejecutar el corte del camino de producción a v2 | Decisión operativa del área de ERP | 2026-09-10 |
| Pregunta abierta | "SDCAM" — mencionado dos veces en la reunión del 9-sep, cero coincidencias en la documentación del proveedor | Sin resolver | 2026-09-10 |

## Session Continuity

Last session: 2026-09-10T20:35:35.355Z
Stopped at: Completed 01-01-PLAN.md
Resume file: None
