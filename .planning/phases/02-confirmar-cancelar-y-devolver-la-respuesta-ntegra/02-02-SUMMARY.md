---
phase: 02-confirmar-cancelar-y-devolver-la-respuesta-ntegra
plan: 02
subsystem: api
tags: [cancel-tax, invoices-cancel, projection, oper-03, test-02, conn-04, no-default-branch, tdd, mutation-validated]

# Dependency graph
requires:
  - phase: 02-01
    provides: validateV2FileShape en el paso 2 de _executeV2 (común a las tres operaciones); getIntentFor con throw terminal que nombra a cancel_tax como fuera del mapeo; dos casos que esperaban que cancel_tax NO pasara por getIntentFor
  - phase: 01-04
    provides: SynexusApiClient con makeRequest(operation, cuerpo, entidad) y una sola URL; tests/v2QuoteEndToEnd.test.js como molde del recorrido completo con el grafo real a mano
provides:
  - SynexusConfig.cancelPath ('/api/v1/invoices/cancel') y getCancelUrl(): mismo molde que getCalculationUrl, desde el origin de la URL ya validada (CONN-04)
  - SynexusRequestBuilder.buildCancelBody(requestBody): proyección { invoice_id, customer_id } en un objeto nuevo; aborta antes de la red nombrando la lista literal de faltantes; sin getIntentFor, sin request_id, sin transaction_type ni committed
  - TaxCommandHandler._buildV2Body(operation, requestBody): bifurcación por operación sin rama por omisión (cancel_tax → buildCancelBody; get_tax/post_tax → intención → validar → construir; otra → throw); _executeV2 queda en siete pasos
  - SynexusApiClient._resolveUrl(operation): URL por operación pedida a SynexusConfig, throw terminal antes de tocar axios; envoltorios postTax y cancelTax
  - tests/v2CancelEndToEnd.test.js: TEST-02 para cancel_tax con el grafo real (sólo axios y FileManager sustituidos) y contraste COMP-01 contra CancelTransaction
affects: [02-03, 02-04, fase-3]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Proyección explícita en vez de esparcido: el cuerpo de cancelación se construye llave por llave ({ invoice_id, customer_id }) y la prueba afirma Object.keys(...).sort() contra el literal, de modo que cualquier campo extra que se cuele pone la suite en rojo"
    - "Bifurcación por operación con throw terminal y sin else, replicada en dos capas (_buildV2Body en CLI, _resolveUrl en API), con el mismo molde que getIntentFor: la rama terminal es defensa contra ampliar validOperations sin dar constructor ni endpoint a la operación nueva"
    - "Excepción acotada y documentada de un requisito transversal (SAFE-01): la cancelación no lleva request_id, y el porqué (no documentado; idempotente por naturaleza; 409 seguro de reintentar) vive en el comentario del builder, en el nombre del it y en el threat register (T-02-02-05, accept)"
    - "Las aserciones de 'nombra el campo ausente' afirman la lista literal 'falta(n): a, b.' cuando los nombres también aparecen en la parte fija del mensaje: 'contiene' no distingue; se descubrió por mutación antes de commitear"
    - "Recorrido completo por archivo de operación: v2CancelEndToEnd copia buildGraph de v2QuoteEndToEnd (convención 'todo lo demás va en sitio', IN-10 diferido) y expone requestBuilder y validator para espiar sobre las instancias reales que getIntentFor y validateV2IntentFields no se llaman"

key-files:
  created:
    - tests/v2CancelEndToEnd.test.js
  modified:
    - src/config/synexusConfig.js
    - src/api/synexusRequestBuilder.js
    - src/api/synexusApiClient.js
    - src/cli/taxCommandHandler.js
    - tests/synexusConfig.test.js
    - tests/synexusRequestBuilder.test.js
    - tests/synexusApiClient.test.js
    - tests/v2IntentValidation.test.js
    - .claude/commands/tax-cancel.md
    - .claude/agents/nexgen-explorer.md
    - .claude/agents/tax-validator-helper.md

key-decisions:
  - "El mensaje de _getConfiguredUrl ('La ruta /api/v1/tax_calculations la agrega nexgen') se deja como está: el plan lo dejaba a discreción; lo que el operador debe corregir (quitar la ruta de SYNEXUS_BASE_URL) es el mismo con una ruta o con dos, y no tocarlo evita mover una prueba que fija ese texto"
  - "El mensaje de campo ausente termina con la lista literal 'falta(n): invoice_id, customer_id.' y las pruebas la afirman tal cual: la mutación 'sin comprobación de customer_id' dejó pasar el caso 'sin los dos' porque los dos nombres aparecen en la parte fija del mensaje; se reforzó antes del commit GREEN (3 casos en rojo con la mutación, no 2)"
  - "_buildV2Body es una cadena de if con throw terminal, no un mapa operación → constructor: es el molde de getIntentFor y de _resolveUrl, y el criterio de aceptación (cero '} else {') se comprueba por grep sobre las dos"
  - "Se corrieron dos mutaciones más que las del plan en la Task 2 —el manejador esparciendo el archivo entero sobre la proyección, y el manejador añadiendo request_id— porque las guardas del orquestador las exigían: 6 casos en rojo cada una"
  - "Los tres archivos de .claude/ que citaban 'cancel_tax is not wired under v2 yet', la traza vieja de _executeV2 y 'validateV2IntentFields la llama _executeV2' se actualizaron en un commit docs aparte, como en 02-01: CLAUDE.md lo exige cuando cambia el código que referencian"

patterns-established:
  - "Verificación por mutación de la Task 1: paso directo Object.assign({}, requestBody) en buildCancelBody (4 fallos), sin comprobación de customer_id (3 fallos tras reforzar), getCancelUrl devolviendo la ruta de cálculo (5 fallos)"
  - "Verificación por mutación de la Task 2: _resolveUrl siempre a getCalculationUrl (6 fallos: 3 del cliente, 2 del recorrido, 1 del envoltorio), cancel_tax por la rama de cálculo en _buildV2Body (22 fallos), esparcido del archivo en la cancelación (6), request_id añadido a la proyección (6)"

requirements-completed: [OPER-03, TEST-02]

# Metrics
duration: 12min
completed: 2026-09-11
---

# Phase 02 Plan 02: cancel_tax bajo v2 — otro endpoint, otro cuerpo, proyección de dos campos Summary

**`node index.js cancel_tax archivo.json --api-version=v2` emite un `POST` contra `<SYNEXUS_BASE_URL>/api/v1/invoices/cancel` con el cuerpo exactamente `{ invoice_id, customer_id }` proyectado del archivo del ERP —sin `cart`, sin direcciones, sin `entity_id`, sin `transaction_type`/`committed` y sin `request_id` (excepción acotada y documentada de SAFE-01)—, aborta antes de la red en español nombrando la lista literal de campos ausentes, no pasa por `getIntentFor` ni por `validateV2IntentFields`, conserva las guardias de archivo v1 y de arreglo raíz, escribe la respuesta `{ message, updated_invoices, invoice_id, client_id, entity_id }` tal cual en `RESPONSE_<original>`, y la misma invocación sin flags sigue siendo el `GET` de v1 contra `CancelTransaction` con el archivo entero y sin `Authorization`. Con esto las TRES operaciones funcionan contra v2 y TEST-02 queda completo: cada una tiene prueba del cuerpo que sale al cable sin salir a la red.**

## Performance

- **Duration:** 12 min
- **Started:** 2026-09-11T20:58:50Z
- **Completed:** 2026-09-11T21:11:14Z
- **Tasks:** 2 (las dos TDD: RED → GREEN, cada una con validación por mutación antes del commit GREEN)
- **Files modified:** 12 (1 creado, 11 modificados; `index.js`, `src/validators/taxValidator.js` y los cinco archivos congelados sin un solo cambio en este plan)

## Accomplishments

- **OPER-03 / CONN-04 — la URL de cancelación sale de la configuración.** `SynexusConfig` gana `this.cancelPath = '/api/v1/invoices/cancel'` junto a `calculationPath` y `getCancelUrl()` inmediatamente después de `getCalculationUrl()`, con el mismo cuerpo cambiando la ruta: parte del `origin` de `_getConfiguredUrl()`, así que una barra final en la variable no produce barra doble y nada de lo que la validación de forma rechaza se cuela. Seis casos espejo de los de `getCalculationUrl`: staging, barra final, producción con `synexus_live_`, sin `tax_calculations` ni `?`, `cancelPath` como propiedad, y las dos rutas conviviendo en la misma instancia. Fuera de comentarios, `invoices/cancel` aparece una vez en `synexusConfig.js` y cero en `synexusApiClient.js`.
- **La proyección.** `SynexusRequestBuilder.buildCancelBody(requestBody)` recolecta los campos ausentes de `['invoice_id', 'customer_id']` (ausente = `undefined`, `null` o `''`; no se comprueba el tipo: nexgen no valida el esquema del ERP) y, si hay alguno, lanza con el trío: `Para cancelar bajo el contrato v2 el archivo debe traer "invoice_id" y "customer_id"; falta(n): <lista>. La cancelación aborta antes de emitir petición alguna.` Si no falta ninguno, devuelve un objeto NUEVO con exactamente las dos llaves y una traza `Cuerpo v2 de cancelación construido: invoice_id=…, customer_id=…`. Dentro del método, fuera de comentarios, no aparecen `request_id`, `_generateRequestId`, `getIntentFor`, `transaction_type` ni `committed`. El comentario deja escrito el porqué de proyectar (el archivo tiene forma de cálculo y el endpoint no documenta qué hace con campos extra; no es traducir esquemas) y el porqué de no llevar `request_id` (no documentado; idempotente por naturaleza: repetir devuelve 404/422 sin doble efecto; 409 documentado como seguro de reintentar). Dieciséis casos unitarios, incluido que `getIntentFor('cancel_tax')` sigue lanzando y mencionando el mapeo de intención.
- **La bifurcación del manejador.** `_executeV2` pasa de nueve pasos a siete: los pasos 5-7 (intención → validar → construir) se extraen a `_buildV2Body(operation, requestBody)`, que bifurca por operación sin rama `else`: `cancel_tax` → `buildCancelBody`; `get_tax`/`post_tax` → `getIntentFor` → `validateV2IntentFields` contra la MISMA intención → `buildRequestBody` (la secuencia del plan 01-03, intacta); cualquier otra → trío y `La operación "<op>" no tiene constructor de cuerpo en el contrato v2.` (defensa: `validateOperation` ya corrió en el paso 2 de `execute`). La traza `Cuerpo v2 a enviar:` conserva texto y formato. `execute()` y la rama v1 no cambian. Con el validador real y dobles: orden `validateRequestBody → validateV2FileShape → resolveEntityCode → printProfile → buildCancelBody → makeRequest`, cuerpo crudo por identidad a `buildCancelBody`, proyección por identidad a `makeRequest('cancel_tax', …, 'USA')`, `getIntentFor` y `validateV2IntentFields` con cero llamadas, archivo v1 y arreglo raíz abortando antes, `buildCancelBody` que lanza sin traza ni archivo, respuesta por identidad a `_saveResponse`, y el caso "operación sin mapeo aborta en `getIntentFor`" convertido en "con un doble que LANZA en `getIntentFor`, la cancelación igual llega al cliente". Con el builder real: `cancel_tax` llega con exactamente `{ invoice_id, customer_id }` y sin `customer_id` aborta antes del cliente.
- **El enrutamiento del cliente.** `SynexusApiClient._resolveUrl(operation)` pide `getCancelUrl()` para `cancel_tax` y `getCalculationUrl()` para `get_tax`/`post_tax`, con trío y throw terminal (`La operación "<op>" no tiene endpoint en el contrato v2.`) ANTES de tocar axios y sin rama por omisión; `makeRequest` toma la URL de `_resolveUrl` en su primera línea y el resto del método no cambia (mismo `axios({...})`, mismos tres headers, mismo `try`/`catch`). Envoltorios `postTax` y `cancelTax` junto a `getTax`; el JSDoc que decía "son de la Fase 2" desaparece. Once casos nuevos: URL por operación con conteo de llamadas a cada getter, operación desconocida con axios en cero llamadas, la cancelación con `POST`, exactamente los tres headers (`toEqual`), `data` por identidad, `timeout` 30000, traza `Realizando petición CANCEL_TAX a: …`, y los tres envoltorios delegando en `makeRequest`.
- **TEST-02 para `cancel_tax` — `tests/v2CancelEndToEnd.test.js`** (435 líneas, 20 casos, grafo real a mano con sólo axios y `FileManager` sustituidos): axios exactamente una vez; `POST`; URL exactamente `https://compute.staging.synexustax.com/api/v1/invoices/cancel`, distinta de la de cálculo, sin `code=`, sin `?` ni subcadena de la llave; `data` `toEqual` `{ invoice_id: 'DEMO-001', customer_id: 'CUST-1' }` y `Object.keys(data).sort()` igual a `['customer_id', 'invoice_id']`; `not.toHaveProperty` para `transaction_type`, `committed`, `request_id`, `cart`, `to_state`, `to_zip`, `entity_id` y `Committed`; headers `toEqual` los tres con `X-Synexus-Entity: USA`; respuesta escrita por identidad en `RESPONSE_c.json` con `ensureDirectory` + `getResponseFileName` + `writeJsonFile`; mensajes `Operación cancel_tax completada exitosamente` y `SUCCESS: cancel_tax - File: c.json`; perfil antes de axios; llave nunca en consola ni logger; espías sobre el builder y el validador REALES con cero llamadas a `getIntentFor` y `validateV2IntentFields`; `entity_id: 'CA-01'` del archivo al header y no al cuerpo; abortos sin red y sin archivo por `invoice_id` ausente, `customer_id` ausente, archivo v1 y arreglo raíz; y COMP-01: `['cancel_tax', 'c.json']` sin flags → `GET` contra `https://ejemplo-v1.invalid/api/CancelTransaction`, headers `toEqual` `{ 'Content-Type': 'application/json' }`, `data` `toEqual` el archivo v1 ENTERO, configuración y cliente v2 en `null`, sin línea de perfil.
- **Sin rama por omisión, comprobado por grep:** cero `} else {` dentro de `_buildV2Body` y de `_resolveUrl`; `getCalculationUrl()` aparece una sola vez en el cliente (dentro de `_resolveUrl`); `_buildV2Body(operation, requestBody)` aparece dos veces en el manejador (definición y llamada); ningún archivo de `tests/` requiere `index.js`.
- `npm test`: 11 suites, **367 casos** (304 previos + 6 configuración + 16 builder + 11 cliente + 10 validación/rama + 20 recorrido de cancelación), código de salida 0, sin `.env`, sin red.

## Task Commits

Each task was committed atomically (TDD: RED → GREEN):

1. **Task 1: La URL de cancelación en la configuración y la proyección del cuerpo en el builder**
   - RED `9f10f86` (test) — 21 casos en rojo (`getCancelUrl is not a function`, `buildCancelBody is not a function`); el único nuevo que pasaba era el de `getIntentFor('cancel_tax')`, que afirma comportamiento sin cambios
   - GREEN `b8f3374` (feat) — `src/config/synexusConfig.js`, `src/api/synexusRequestBuilder.js`; incluye el refuerzo de tres aserciones en `tests/synexusRequestBuilder.test.js` (ver Decisions)
2. **Task 2: La cancelación de punta a punta — el manejador bifurca, el cliente enruta y el recorrido completo lo prueba**
   - RED `ccbbdad` (test) — 29 casos en rojo (6 cliente + 8 manejador + 15 recorrido); los 5 del recorrido que ya pasaban son guardia v1, arreglo raíz y los tres de COMP-01: comportamiento que no cambia
   - GREEN `d9ed72b` (feat) — `src/cli/taxCommandHandler.js`, `src/api/synexusApiClient.js`
3. **Documentación exigida por CLAUDE.md** — `c4e0e6c` (docs) — `.claude/commands/tax-cancel.md`, `.claude/agents/nexgen-explorer.md`, `.claude/agents/tax-validator-helper.md`

**Plan metadata:** ver commit `docs(02-02)` al final de este plan.

## Files Created/Modified

- `src/config/synexusConfig.js` — `cancelPath` en el constructor con comentario (sección *Cancel a Transaction*; sólo la ruta es literal); `getCancelUrl()` tras `getCalculationUrl()` con JSDoc y `@returns`; cabecera de la clase nombra las dos rutas. `_getConfiguredUrl` y su mensaje sin cambios.
- `src/api/synexusRequestBuilder.js` — `buildCancelBody(requestBody)` después de `buildRequestBody`, con JSDoc (`@param`, `@returns`, `@throws`) y los dos porqués en comentario; cabecera de la clase con las dos formas de cuerpo. `getIntentFor`, `buildRequestBody`, `_generateRequestId` y `_assertIntentFieldsPresent` sin cambios.
- `src/api/synexusApiClient.js` — `_resolveUrl(operation)` antes de `_handleResponse`; `makeRequest` con `const url = this._resolveUrl(operation);` como primera línea; `postTax` y `cancelTax`; JSDoc de `makeRequest`, `getTax` y cabecera de la clase actualizados. `_handleResponse` y `_handleError` intactos: una cancelación con 4xx sigue produciendo `Error HTTP <status>: <cuerpo>` (la clasificación por status es del plan 02-03).
- `src/cli/taxCommandHandler.js` — `_buildV2Body` tras `_executeV2`, con JSDoc y el comentario sobre por qué la cancelación no pasa por `getIntentFor` ni `validateV2IntentFields`; `_executeV2` renumerado a siete pasos y su JSDoc reescrito ("bifurcación en _buildV2Body: cálculo o cancelación"); JSDoc del parámetro `requestBuilder` del constructor nombra la proyección.
- `tests/v2CancelEndToEnd.test.js` — Nuevo. Encabezado con lo que se afirma sólo aquí y de dónde se copian `buildGraph`, `capturedConsoleOutput` y los `beforeEach`/`afterEach`; `createCancelFile`, `createV1CancelFile`, `createCancelResponse` en sitio; cuatro `describe` (cancelación completa, entidad del archivo, abortos antes de la red, contraste v1).
- `tests/synexusConfig.test.js` — Describe `getCancelUrl (OPER-03, CONN-04)` con seis casos; cabecera actualizada.
- `tests/synexusRequestBuilder.test.js` — Describe `buildCancelBody — la cancelación es una proyección de dos campos (OPER-03)` con dieciséis casos; cabecera con el punto 6.
- `tests/synexusApiClient.test.js` — `cancelUrl`, `createCancelBody`, `getCancelUrl` en el doble; describe "el endpoint por operación" (4 + 5 anidados); describe de envoltorios con `postTax` y `cancelTax`; "no ofrece postTax ni cancelTax" invertido en "ofrece los tres envoltorios"; cabecera actualizada.
- `tests/v2IntentValidation.test.js` — `buildCancelBody` en el doble del builder; describe "la rama de cancelación" (8 casos, incluido `_buildV2Body` con operación desconocida); caso "sin mapeo" convertido; dos casos con el builder real para `cancel_tax`; cabecera con el punto 4. Ninguna aserción existente de `get_tax`/`post_tax` se recortó.
- `.claude/commands/tax-cancel.md`, `.claude/agents/nexgen-explorer.md`, `.claude/agents/tax-validator-helper.md` — Ver Deviations.

## Decisions Made

- **Mensaje de `_getConfiguredUrl` sin tocar.** Ver key-decisions: la instrucción al operador es la misma con una ruta o con dos.
- **Lista literal de faltantes en las aserciones.** La mutación "sin comprobación de `customer_id`" puso en rojo sólo 2 casos porque "sin los dos, el mensaje nombra los dos" pasaba con la parte fija del mensaje. Se reforzaron tres aserciones a `falta(n): invoice_id.`, `falta(n): customer_id.` y `falta(n): invoice_id, customer_id.`; la mutación pasó a 3 en rojo. El refuerzo viajó en el commit GREEN de la Task 1.
- **`_buildV2Body` como cadena de `if`**, no mapa: molde de `getIntentFor` y de `_resolveUrl`, y verificable por el grep de `} else {` del plan.
- **Mutaciones adicionales** (esparcido del archivo en el manejador; `request_id` añadido a la proyección): 6 en rojo cada una, exigidas por las guardas del orquestador y más fuertes que la del plan porque atacan la capa que consume la proyección, no la que la produce.
- **Prueba de `_buildV2Body` con operación desconocida** llamando al método privado directamente: es inalcanzable desde `execute()` (`validateOperation` corre antes), y el plan pide que el throw se conserve; la prueba directa es lo único que lo protege.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - CLAUDE.md] Comandos y agentes de `.claude/` afirmaban que `cancel_tax` no estaba cableado bajo v2 y trazaban la rama vieja**
- **Found during:** Cierre del plan, antes del SUMMARY
- **Issue:** `CLAUDE.md` exige revisar `.claude/agents/` y `.claude/commands/` cuando cambia el código que referencian. `tax-cancel.md` decía "is **not wired under v2 yet**" y citaba el aborto en `getIntentFor`; `nexgen-explorer.md` trazaba `_executeV2` con `getIntentFor → validateV2IntentFields → buildRequestBody` para toda operación y daba una sola URL v2 (`getCalculationUrl`); `tax-validator-helper.md` decía que `validateV2IntentFields` "is called only by `_executeV2`" sin excluir la cancelación.
- **Fix:** Sólo se reemplazaron las líneas que quedaron falsas: el endpoint y la proyección en la nota de contrato; la bifurcación de `_buildV2Body`, la traza y `_resolveUrl` en la traza del explorador, con las dos URL por operación; `_buildV2Body` sólo para `get_tax`/`post_tax` en el ayudante del validador. Metadatos intactos. Ningún archivo de `src/` ni de `tests/` tocado en este commit.
- **Files modified:** `.claude/commands/tax-cancel.md`, `.claude/agents/nexgen-explorer.md`, `.claude/agents/tax-validator-helper.md`
- **Verification:** `git diff --stat` del commit: 3 archivos, 43+/21−; `npm test` sin cambios (367/367).
- **Committed in:** `c4e0e6c`

---

**Total deviations:** 1 auto-fixed (Rule 2 por `CLAUDE.md`).
**Impact on plan:** Ninguna sobre el alcance ni la superficie pública. `getCancelUrl()`, `buildCancelBody(requestBody)`, `_buildV2Body(operation, requestBody)`, `_resolveUrl(operation)`, `postTax` y `cancelTax` son exactamente los de `<interfaces>`.

## Issues Encountered

- **Denegación de permisos del entorno en la corrida de humo.** Se intentó reproducir la corrida de humo del plan 02-01 con el `index.js` real (preload que bloquea `http`/`https` en `/tmp`, variables inline, tres archivos temporales, `rm -rf` al final) y la herramienta denegó el comando compuesto. **No se rodeó**, siguiendo la instrucción del orquestador. Cobertura equivalente: `tests/v2CancelEndToEnd.test.js` arma el grafo real a mano igual que `index.js` (que está congelado y sin cambios desde `4d6d438`: el cableado del builder y del cliente v2 ya se probó de humo en 01-04 y 02-01), con sólo axios y `FileManager` sustituidos. Queda como acción opcional del usuario: `node index.js cancel_tax <archivo-v2>.json --api-version=v2 --entity=USA` sin red debería imprimir el perfil, `Cuerpo v2 de cancelación construido: …`, `Cuerpo v2 a enviar: { "invoice_id": …, "customer_id": … }` y `Realizando petición CANCEL_TAX a: …/api/v1/invoices/cancel` antes de fallar por conectividad.
- **Casos que pasaban en RED, todos previstos:** Task 1, 1 de 22 nuevos (`getIntentFor('cancel_tax')` sigue lanzando: sin cambios). Task 2, 5 de 34 nuevos (archivo v1 y arreglo raíz bajo `cancel_tax` —`validateV2FileShape` ya corría para las tres operaciones desde 02-01— y los tres de COMP-01, que describen v1).
- **`.claude/settings.json` modificado y `postman/` sin rastrear desde antes de la ejecución.** No se tocaron ni se incluyeron en ningún commit.

## TDD Gate Compliance

- Task 1: `test` `9f10f86` → `feat` `b8f3374`. Cumplido.
- Task 2: `test` `ccbbdad` → `feat` `d9ed72b`. Cumplido.
- Sin commits `refactor`: no hubo limpieza posterior.

## Known Stubs

None. `buildCancelBody` no deja ningún valor vacío fluyendo a la salida (abort si falta); `createCancelResponse` es un doble de prueba con la forma de `02-CONTEXT.md`, no dato de producción; ningún `TODO`/`FIXME`/placeholder en los archivos tocados.

## Threat Flags

None. La única superficie nueva —el endpoint `/api/v1/invoices/cancel` y su cuerpo— está en el `<threat_model>` del plan (T-02-02-01 a T-02-02-07) y cada mitigación tiene su prueba: proyección explícita con `Object.keys` (T-01), bifurcación sin rama por omisión en dos capas (T-02), aborto antes de la red por identificador ausente (T-03), guardias de forma comunes (T-04), mismos tres headers y barrido de consola/logger (T-06), COMP-01 con `CancelTransaction` (T-07). T-05 (sin `request_id`) se acepta con su razón en el comentario del builder.

## User Setup Required

None - no external service configuration required. La suite y las mutaciones no necesitan `.env`, red ni credenciales. Sigue pendiente `.env.example` (plan 01-02, bloqueado por permisos del proyecto).

## Needs your decision

Ninguna. La única denegación de permisos (corrida de humo con el CLI real) no bloquea el plan; ver Issues Encountered.

## Next Phase Readiness

- **Para 02-03 (errores por código, `request_id`, reintento):** `_handleResponse` sigue lanzando el genérico `Error HTTP <status>: <cuerpo>` para la cancelación con 4xx (sus errores no traen `code`: clasificar por status ahí, nunca por texto). `_resolveUrl` se llama una vez por `makeRequest`, así que un reintento dentro de `makeRequest` reutiliza la misma `url` y el mismo cuerpo (y por tanto el mismo `request_id` en el cálculo). La cancelación no tiene `request_id` de nexgen: en un error sin respuesta sólo habrá el `X-Request-Id` del proveedor cuando exista. Los envoltorios `postTax`/`cancelTax` existen; el manejador sigue llamando a `makeRequest` directamente, como `getTax` en la Fase 1.
- **Para 02-04 / Fase 3:** el procedimiento de staging puede citar el cuerpo exacto de cancelación (`{ invoice_id, customer_id }`) y el aborto en español si el archivo del ERP no los trae. **Punto abierto para el área de ERP (sin cambio):** que los archivos de cancelación traigan `invoice_id` y `customer_id` con esos nombres.
- **`.claude/commands/tax-cancel.md`** describe ahora los dos contratos; sigue corriendo v1 por omisión.

---
*Phase: 02-confirmar-cancelar-y-devolver-la-respuesta-ntegra*
*Completed: 2026-09-11*

## Self-Check: PASSED

Archivos creados/modificados (12/12 más este resumen) y commits de tarea (5/5) verificados en disco y en `git log`. `npm test`: 367/367, código de salida 0, sin `.env`, sin red.
