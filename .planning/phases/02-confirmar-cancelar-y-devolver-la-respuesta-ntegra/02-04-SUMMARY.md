---
phase: 02-confirmar-cancelar-y-devolver-la-respuesta-ntegra
plan: 04
subsystem: api
tags: [retry, idempotency, request-id, safe-02, injected-wait, tdd, mutation-validated, docs, claude-commands]

# Dependency graph
requires:
  - phase: 02-03
    provides: makeRequest con el molde try/catch y una sola llamada a axios; _handleResponse (corte en 400, clasificación por data.code y por status) y _handleError (nota de soporte con request_id); las marcas providerResponded/providerRequestId; createAxiosError con config.headers.Authorization poblado y expectNoCredentialLeak
  - phase: 02-02
    provides: _resolveUrl(operation) con throw terminal; la proyección { invoice_id, customer_id } de la cancelación sin request_id; el 409 de la cancelación documentado como seguro de reintentar
  - phase: 01-04
    provides: SynexusApiClient, los recorridos v2QuoteEndToEnd y la regla de que index.js construye el cliente con dos argumentos
provides:
  - SynexusApiClient(synexusConfig, logger, options): options.wait inyectable; maxRetries = 1 y retryDelayMs = 1000 como constantes de clase, no configurables por entorno ni por flag
  - _send(url, requestBody, entityCode): la única llamada a axios; devuelve { response } o { error }, nunca lanza; data es el MISMO objeto en cada intento
  - _sendWithRetry(operation, url, requestBody, entityCode): un solo reintento con el mismo cuerpo y la misma URL; línea 'Reintentando (1/1) …' en stdout sin headers ni llave; el intento reintentado no pasa por _handleError; reporta el desenlace del último intento
  - _retryReasonFor(outcome, operation): lista cerrada — ECONNABORTED, HTTP 502/503/504, 409 de la cancelación, 409 invoice_stale_object del cálculo (por data.code); rama explícita para idempotency_key_conflict (nunca); 401/400/404/422/429/500/ECONNREFUSED/ENOTFOUND/genérico: nunca
  - createClient(logger, options) en tests/synexusApiClient.test.js como único punto de construcción del cliente (espera espiada, ninguna prueba duerme)
  - README.md, .claude/commands/tax-{quote,commit,cancel}.md y .claude/agents/{nexgen-explorer,tax-validator-helper}.md describiendo las tres operaciones bajo v2
affects: [fase-3, runbook-v2]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Reintento en proceso con el mismo objeto de cuerpo por identidad: la prueba afirma toBe entre axios.mock.calls[0][0].data y [1][0].data, unitaria y de recorrido; el mutante Object.assign la pone en rojo"
    - "Decisión de reintento por lista cerrada y señal estable: error.code/error.response.status en los rechazos, status + data.code en los 4xx resueltos; la rama que devuelve null para idempotency_key_conflict se escribe explícita para que un refactor no la simplifique"
    - "Espera inyectable (options.wait) con constantes de clase greppables; la prueba afirma el valor pedido a wait, nunca duerme; gate de tiempo total de la suite"
    - "_send envuelve la única llamada a axios y devuelve { response } | { error } para que la decisión de reintento vea los dos desenlaces con la misma forma"

key-files:
  created: []
  modified:
    - src/api/synexusApiClient.js
    - tests/synexusApiClient.test.js
    - tests/v2QuoteEndToEnd.test.js
    - tests/v2CancelEndToEnd.test.js
    - README.md
    - .claude/commands/tax-quote.md
    - .claude/commands/tax-commit.md
    - .claude/commands/tax-cancel.md
    - .claude/agents/nexgen-explorer.md
    - .claude/agents/tax-validator-helper.md

key-decisions:
  - "options.wait se acepta sólo si es función y en otro caso se usa el setTimeout real: index.js no pasa opciones y hereda la espera de 1000 ms; la opción existe únicamente para que la suite no duerma"
  - "El registro del reintento es la línea 'Reintentando (1/1) …' en stdout, como fija 02-CONTEXT; la entrada de winston sigue siendo una sola (la del desenlace final) porque el plan exige que el intento reintentado no pase por _handleError y que _handleError no cambie"
  - "Los casos que necesitan contar llamadas a la configuración doble leen client.synexusConfig en vez de ampliar la firma de createClient: el constructor ya la expone y el helper conserva la forma (logger, options) de <interfaces>"
  - "Se corrió una cuarta mutación exigida por las guardas del orquestador (reintentar el 401): 2 casos en rojo, uno unitario y uno de recorrido"
  - "La documentación se extiende, no se reescribe: las notas de contrato de los comandos ya describían v2 desde 02-01..02-03 (ninguna decía 'not mapped under v2 yet' al empezar); lo que sí era falso —'Under v2, only get_tax is implemented' en README— se reemplazó por la tabla de las tres operaciones"

patterns-established:
  - "Verificación por mutación de la Task 1: cuerpo reconstruido con Object.assign en el segundo intento (8 en rojo), razón para idempotency_key_conflict (2), maxRetries = 2 (15), reintento del 401 (2)"

requirements-completed: [SAFE-02]

# Metrics
duration: 13min
completed: 2026-09-11
---

# Phase 02 Plan 04: Un reintento en proceso con la misma llave, y la documentación de las tres operaciones bajo v2 Summary

**`SynexusApiClient` reintenta exactamente una vez, dentro del mismo proceso y con el MISMO objeto de cuerpo ya construido —por tanto la misma llave `request_id`—, sólo ante un timeout (`ECONNABORTED`), un 502/503/504, el 409 `invoice_stale_object` del cálculo (decidido por `data.code`) o el 409 de la cancelación (documentado como seguro); nunca ante 401, 4xx de validación, 429, 500, red caída ni el 409 `idempotency_key_conflict`, que tiene su rama explícita. La espera de 1000 ms se inyecta (`options.wait`) y la suite —457 casos, 0.46 s— afirma el valor pedido sin dormir; el reintento se anuncia en stdout con `Reintentando (1/1) …` llevando sólo la llave y la razón, y el error que se reporta es el del segundo intento. `README.md`, los tres comandos de `.claude/commands/` y los dos agentes describen ahora `get_tax`, `post_tax` y `cancel_tax` bajo v2 (endpoint, cuerpo, `--entity=`, `TEST_MODE` que no aplica, `request_id`, códigos de error, reintento único y por qué no re-correr a mano). Con este plan la fase queda completa.**

## Performance

- **Duration:** 13 min
- **Started:** 2026-09-11T21:35:20Z
- **Completed:** 2026-09-11T21:48:04Z
- **Tasks:** 2 (Task 1 TDD: RED → GREEN con cuatro mutaciones antes del commit GREEN; Task 2 sólo documentación)
- **Files modified:** 10 (4 de código y pruebas, 6 de documentación; los cinco archivos congelados, el manejador, el builder, el validador, `synexusConfig.js` y `tests/helpers/fakes.js` sin un solo cambio)

## Accomplishments

- **SAFE-02 — el reintento vive en el proceso, no en el operador.** `makeRequest` resuelve la URL una vez, imprime la traza inicial una vez y llama a `_sendWithRetry`, que a su vez llama a `_send` (la única `await axios(` del archivo, con el mismo objeto de configuración y los mismos tres headers) y decide con `_retryReasonFor`. Si hay razón y `attempt < maxRetries`, imprime la línea de reintento, espera `this.wait(this.retryDelayMs)` y vuelve a enviar **el mismo objeto** `requestBody`. Si no, devuelve la respuesta al molde (`_handleResponse` la clasifica) o re-lanza el error original de axios por identidad (`_handleError` lo diagnostica). El intento reintentado no deja diagnóstico ni entrada en el log.
- **Lista cerrada, con la rama del conflicto escrita a mano.** Rechazos: `ECONNABORTED` → `timeout (ECONNABORTED)`; `error.response.status` 502/503/504 → `HTTP <status>`; todo lo demás (500, `ECONNREFUSED`, `ENOTFOUND`, sin código) → `null`. Resueltos: sólo el 409. En `cancel_tax` → `HTTP 409 en la cancelación (el contrato lo marca como seguro de reintentar)`; en el cálculo, `invoice_stale_object` → `HTTP 409 invoice_stale_object (concurrencia)`, `idempotency_key_conflict` → `null` en una rama explícita con su comentario (misma llave, cuerpo distinto: ojos humanos), sin `code` → `null`. Ningún otro 4xx ni 2xx. `maxRetries = 1` y `retryDelayMs = 1000` son constantes de clase; el gate de `process.env|SYNEXUS_RETR` en el cliente devuelve 0.
- **Ninguna prueba duerme.** `createClient(logger, options)` construye el cliente con la configuración doble y `wait: jest.fn(async () => {})`; las 23 construcciones directas del archivo migraron a él (incluidos `runWithRejection`, `runResolved`, `runRejected`, `runCalculationError` y `runCancelError`), y la única `new SynexusApiClient(` que queda fuera del helper es el caso de la espera por omisión, que no emite petición alguna (comprueba `typeof client.wait === 'function'` y que `wait(0)` resuelve). Los dos `buildGraph` inyectan `{ wait: async () => {} }` con el comentario de que `index.js` hereda la espera real. Suite completa en 0.46 s (gate: < 2 s).
- **La prueba que define el requisito.** Describe "SAFE-02" con 22 casos en tres grupos: constantes y espera (3), lo que sí se reintenta (9: timeout→200 con identidad `toBe` del `data`, mismos headers y URL, `wait` una vez con 1000, línea con la llave y `timeout (ECONNABORTED)`, sin diagnóstico ni log del primer intento y sin fuga con `config.headers.Authorization` poblado; `it.each` 502/503/504; timeout dos veces → el SEGUNDO error por identidad y nunca una tercera llamada; 409 `invoice_stale_object`→200; 409 de la cancelación→200 con la línea `con el mismo cuerpo … no lleva llave`; 409 de la cancelación dos veces → `chocó` con `_handleResponse` una sola vez; timeout en la cancelación; barrido de consola sin `Authorization`/`Bearer `/llave), lo que nunca (10: 500, `ECONNREFUSED`, `ENOTFOUND`, genérico, 401/422/429 clasificados, 409 `idempotency_key_conflict` con `No se reintenta`, 409 sin `code`, 200 a la primera). Los casos existentes "ECONNABORTED" y "5xx (503)" ganan `toHaveBeenCalledTimes(2)` sin perder ninguna aserción.
- **Recorridos con el grafo real.** `post_tax --api-version=v2 --entity=USA` con timeout y luego 200: axios dos veces, `calls[0][0].data` `toBe` `calls[1][0].data`, mismo `request_id` UUID v4, `sales_invoice` + `committed: true`, archivo escrito una vez con el cuerpo del 200, línea `Reintentando (1/1)` con esa llave, `SUCCESS: post_tax - Status: 200 - request_id=e2e-rid-0001`, logger sin llamadas, llave en ninguna línea. `post_tax` con 409 `idempotency_key_conflict`: una llamada, rechazo con el código, sin archivo. `cancel_tax` con 409 y luego 200: dos llamadas contra `/api/v1/invoices/cancel`, `data` idéntico por identidad e igual a `{ invoice_id: 'DEMO-001', customer_id: 'CUST-1' }` en las dos, archivo una vez, `request_id=rid-cancel-retry` del header.
- **Documentación que dice la verdad.** README: tabla de las tres operaciones bajo v2 (endpoint y cuerpo al cable) en lugar de "only `get_tax` is implemented"; Input File Format con el mapeo de `post_tax`, lo que necesita el archivo de cancelación, el arreglo raíz rechazado y los strings sin el escape de v1; subsección "v2 diagnostics" (línea `SUCCESS … request_id=`, `Error HTTP <status> (<code>): …`, cancelación por status, nota de soporte, reintento único y por qué una segunda invocación manual puede duplicar la factura); `TEST_MODE` no aplica a v2. Comandos: `/tax-commit` y `/tax-cancel` ganan el comando v2 en Steps, la línea de éxito en Capture, `--entity=`, la confirmación de ambiente por perfil en vez de `TEST_MODE`, el catálogo de errores y el reintento; `/tax-cancel` sustituye "There is no idempotency guarantee" por la realidad de cada contrato; `/tax-quote` aclara el reintento automático junto a "Don't retry". Agentes: el explorador traza `_sendWithRetry → _send → _retryReasonFor` y lo lleva al modelo de error y a la forma de salida; el ayudante del validador deja escrito WR-03 en "Preserve invariants" y los tres puntos v2 al añadir una operación.
- `npm test`: 11 suites, **457 casos** (431 previos + 22 SAFE-02 en el cliente + 2 recorridos en `v2QuoteEndToEnd` + 1 en `v2CancelEndToEnd`; los 2 existentes actualizados), código de salida 0, 0.46 s, sin `.env`, sin red.

## Task Commits

Each task was committed atomically (TDD: RED → GREEN):

1. **Task 1: SAFE-02 — un solo reintento en proceso, con el mismo cuerpo y la misma llave, sólo cuando es seguro**
   - RED `32d6f51` (test) — 27 casos en rojo (hoy axios se llama una vez; `wait`, `maxRetries` y `retryDelayMs` no existen); el único nuevo que pasaba en rojo es el recorrido del 409 `idempotency_key_conflict`, previsto: describe comportamiento que no cambia (una sola llamada)
   - GREEN `134ec48` (feat) — `src/api/synexusApiClient.js`
2. **Task 2: Poner al día la documentación que leen el operador y las herramientas** — `09dc52a` (docs) — `README.md`, `.claude/commands/tax-{quote,commit,cancel}.md`, `.claude/agents/{nexgen-explorer,tax-validator-helper}.md`

**Plan metadata:** ver commit `docs(02-04)` al final de este plan.

## Files Created/Modified

- `src/api/synexusApiClient.js` — constructor con `options` (`wait`, `retryDelayMs = 1000`, `maxRetries = 1`) y su comentario; `makeRequest` conserva el molde y llama a `_sendWithRetry`; `_send` (única llamada a axios, devuelve `{ response }`/`{ error }`); `_sendWithRetry` (bucle, línea de reintento por operación, `await this.wait(this.retryDelayMs)`); `_retryReasonFor` (lista cerrada, rama explícita del conflicto). `_resolveUrl`, `_handleResponse`, `_handleError`, los helpers de 02-03, los envoltorios, los tres headers, `timeout` y `validateStatus` sin cambios. 169 líneas añadidas, ninguna lógica anterior movida.
- `tests/synexusApiClient.test.js` — 1378 → 1817 líneas. `createClient` tras `createSynexusConfigDouble`; cabecera con SAFE-02 y la regla "ninguna prueba duerme"; todas las construcciones migradas; los dos casos existentes con `toHaveBeenCalledTimes(2)`; describe "SAFE-02 …" con `retryLines()` y `run()` en sitio.
- `tests/v2QuoteEndToEnd.test.js` — `buildGraph` con la espera nula y su comentario; describe "SAFE-02 de punta a punta — el reintento reutiliza la llave" (2 casos); cabecera actualizada.
- `tests/v2CancelEndToEnd.test.js` — `buildGraph` con la espera nula; describe "SAFE-02 de punta a punta — el 409 de la cancelación se reintenta una vez con la misma proyección" (1 caso); cabecera con el punto SAFE-02.
- `README.md`, `.claude/commands/tax-quote.md`, `.claude/commands/tax-commit.md`, `.claude/commands/tax-cancel.md`, `.claude/agents/nexgen-explorer.md`, `.claude/agents/tax-validator-helper.md` — ver Accomplishments. Metadatos de cabecera intactos (dos `---` por archivo); ninguna llave con forma real (`grep` en 0); `ARCHITECTURE.md`, `RUNBOOK.md` y `HANDOFF.md` sin tocar (van con la Fase 3).

## Decisions Made

- **`options.wait` sólo si es función; si no, el `setTimeout` real.** `index.js` construye el cliente con dos argumentos y no cambia (`git diff` contra `4d6d438` vacío). La inyección existe para la suite; no hay validación con throw porque un `wait` mal tipado en un test se nota de inmediato (la suite dormiría un segundo y el gate de tiempo lo delata).
- **El registro del reintento es la línea de stdout.** `02-CONTEXT.md` fija que el reintento "se registra en stdout"; el plan exige que el intento reintentado no pase por `_handleError` y que `_handleError` no cambie, y la prueba "timeout dos veces" afirma `logger.error` una sola vez. Por eso la entrada de winston es la del desenlace final (con el `request_id` de ese intento, según 02-03) y el hecho del reintento queda en la consola, que es lo que el operador y el wrapper del ERP ven.
- **`client.synexusConfig` en vez de un tercer parámetro en `createClient`.** Cinco casos del archivo cuentan llamadas a `getCalculationUrl`/`getCancelUrl` sobre el doble; el constructor ya lo expone como propiedad, así que el helper conserva la firma `(logger, options)` de `<interfaces>` y el criterio "≤ 2 construcciones directas" se cumple con 2.
- **Cuarta mutación (reintentar el 401)** exigida por las guardas del orquestador además de las tres del plan: 2 casos en rojo (el unitario `401 invalid_key resuelto: una sola llamada` y el recorrido `post_tax con un 401 invalid_key … axios una vez`).
- **La documentación se extiende, no se reescribe.** Al empezar la Task 2, ninguna nota de contrato decía "not mapped under v2 yet" ni el explorador "only `get_tax` has an intent mapping" (02-01..02-03 ya lo habían corregido); lo que seguía falso era el README ("Under v2, only `get_tax` is implemented…") y lo que faltaba en todos era el reintento, `--entity=`, `TEST_MODE` bajo v2, el comando v2 en Steps de `/tax-commit` y `/tax-cancel`, la línea de éxito en Capture y el catálogo de errores. Se añadió exactamente eso; lo de v1 quedó intacto.

## Deviations from Plan

None - plan executed exactly as written. Los nombres, firmas, constantes, razones y líneas de stdout son los de `<interfaces>`; las cuatro mutaciones (tres del plan más la del 401) se ejecutaron y restauraron antes del commit GREEN; ningún archivo fuera de `files_modified` cambió.

## Issues Encountered

- **`it.each` con `%s` sobre el `statusText`:** la primera redacción del título de la tabla 502/503/504 imprimía `HTTP Bad Gateway`; se corrigió a `HTTP %i (%s)` antes del commit RED. Sin efecto sobre las aserciones.
- **Salto de línea que partió `committed: true`** en la nota de contrato de `/tax-commit` (el script de verificación del plan lo buscaba literal): se re-envolvió el párrafo antes del commit de la Task 2.
- **Una denegación de permisos del entorno** en un comando compuesto de verificación (por el `| head` y `ls -la .env`); se repitió sin esos fragmentos. No hay `.env` en el repositorio y no se creó; `.env.example` sigue sin poder crearse (regla de permisos del proyecto, plan 01-02) — el README ya refleja su contenido y este plan no añade variables (la política de reintento no es configurable).
- **`.claude/settings.json` modificado y `postman/` sin rastrear desde antes de la ejecución.** No se tocaron ni se incluyeron en ningún commit.

## TDD Gate Compliance

- Task 1: `test` `32d6f51` → `feat` `134ec48`. Cumplido.
- Task 2: sólo documentación, sin `tdd="true"`; `git diff --stat HEAD -- src/ tests/ index.js` vacío en esa tarea.
- Sin commits `refactor`: no hubo limpieza posterior.

## Known Stubs

None. Ningún valor vacío fluye a la salida; ningún `TODO`/`FIXME`/placeholder en los archivos tocados (`grep` en 0); los cuerpos de error y las respuestas de las pruebas son dobles con la forma de `02-CONTEXT.md`.

## Threat Flags

None. Toda la superficie tocada está en el `<threat_model>` del plan y cada mitigación tiene su prueba: T-02-04-01 (identidad `toBe` del cuerpo, unitaria y de recorrido; mutante `Object.assign` en rojo), T-02-04-02 (lista cerrada con rama explícita; tabla "una sola llamada, sin wait" por cada caso prohibido; mutantes del conflicto y del 401 en rojo), T-02-04-03 (línea sólo con la llave y la razón; `expectNoCredentialLeak` y barrido de `Authorization`/`Bearer ` en el escenario con `config.headers.Authorization` poblado; gates de serialización de 02-03 siguen en 0), T-02-04-04 (constantes de clase; gate de `process.env` en 0; mutante `maxRetries = 2` en rojo con 15 casos), T-02-04-05 (espera inyectada; suite en 0.46 s), T-02-04-06 (línea en stdout, documentada en los tres comandos y el README), T-02-04-07 (gate de llaves con forma real en 0), T-02-04-08 (`/tax-commit`, `/tax-quote` y README explican que una segunda invocación manual es otra llave).

## User Setup Required

None - no external service configuration required. La suite y las mutaciones no necesitan `.env`, red ni credenciales. Sigue pendiente `.env.example` (plan 01-02, bloqueado por permisos del proyecto); su contenido está en el README y no cambia con este plan.

## Needs your decision

Ninguna. La denegación de permisos fue sobre un comando de verificación, no sobre el plan.

## Next Phase Readiness

- **Fase 2 completa:** las tres operaciones migradas (02-01, 02-02), la respuesta íntegra (02-02), el diagnóstico con `request_id` y la clasificación por señal estable (02-03) y el reintento único (02-04). `index.js`, `src/api/taxApiClient.js`, `src/storage/fileManager.js`, `src/config/index.js` y las dos pruebas de congelamiento sin cambios desde `4d6d438`.
- **Para la Fase 3 (staging, área de ERP):** el procedimiento puede citar la línea `Reintentando (1/1) con la misma llave de idempotencia (request_id=…) tras …` como comportamiento esperado ante un timeout aislado, y la regla operativa "no volver a correr `post_tax` a mano tras un fallo v2" tal como quedó en `/tax-commit` y el README. `RUNBOOK.md`, `ARCHITECTURE.md` y `HANDOFF.md` siguen sin documentar v2 por decisión de la fase.
- **Comprobación en vivo que sólo staging puede dar:** que un timeout real de axios llega con `code === 'ECONNABORTED'` (valor por omisión de axios 1.x; con `transitional.clarifyTimeoutError` sería `ETIMEDOUT`, y el cliente no lo activa) y que el proveedor deduplica de verdad el segundo envío con la misma llave dentro de la ventana de 5 minutos. Si la primera corrida de la Fase 3 muestra `Reintentando (1/1)` seguido de un 409 `idempotency_key_conflict`, ése es el síntoma a reportar.

## Self-Check: PASSED

Archivos modificados (10/10 más este resumen) y commits de tarea (3/3) verificados en disco y en `git log`. `npm test`: 457/457, código de salida 0, 0.46 s, sin `.env`, sin red.
