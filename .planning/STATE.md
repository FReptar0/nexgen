# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-09-10)

**Core value:** El monto de impuesto que nexgen escribe en el archivo de respuesta tiene que ser el correcto, y no debe alterar estado en la API del proveedor sin que se haya pedido explícitamente.
**Current focus:** Phase 1 — Camino v2 de punta a punta para una cotización

## Current Position

Phase: 1 of 3 (Camino v2 de punta a punta para una cotización)
Plan: 0 of TBD in current phase
Status: Ready to plan
Last activity: 2026-09-10 — Roadmap consolidado a 3 fases (granularidad `coarse`); los 35 requisitos v1 siguen mapeados, ninguno diferido

Progress: [░░░░░░░░░░] 0%

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

### Pending Todos

[De .planning/todos/pending/ — ideas capturadas durante las sesiones]

Ninguno aún.

### Blockers/Concerns

- 🔴 **BLOQUEANTE — La forma del JSON de entrada no coincide con lo que espera v2.** El
  archivo que genera la extracción de Sage está en forma v1 (`Committed` con mayúscula,
  `cartID`, `ToState`, `cart[].ItemID`); el contrato v2 espera `committed`, `invoice_id`,
  `to_state`, `cart[].item_id`. Mandarlo tal cual produce un cuerpo con `Committed` y
  `committed` a la vez y sin los campos obligatorios: el proveedor lo rechaza con `422`.
  Detectado por el planner de Phase 1 el 2026-09-10, verificado contra
  `src/validators/taxValidator.js:40`, `README.md:92` y el cuerpo v2 real del 9-sep.
  **Origen:** `01-CONTEXT.md` fijó "el JSON del ERP es el cuerpo, igual que en v1"
  interpretando de más una frase de la reunión que hablaba de la metodología de
  intercambio, no de los nombres de campo.
  **Decisión pendiente con el área de ERP:** o la extracción de Sage pasa a emitir la
  forma v2 —lo probable, porque ya escribieron un cuerpo v2 a mano— o nexgen se hace
  dueño de una tabla de traducción entre dos contratos de proveedor. Consultado el
  2026-09-10; **los planes de Phase 1 quedan en pausa hasta la respuesta.**
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

Last session: 2026-09-10
Stopped at: Roadmap consolidado a 3 fases; trazabilidad de REQUIREMENTS.md remapeada, CFG-03 reescrito y su resolución registrada en Key Decisions de PROJECT.md
Resume file: None
