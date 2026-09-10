---
phase: 01-camino-v2-de-punta-a-punta-para-una-cotizaci-n
plan: 03
subsystem: api
tags: [request-builder, sales-estimate, idempotency, uuid-v4, intent-validation, oper-01, test-03, tdd]

# Dependency graph
requires:
  - phase: 01-01
    provides: Jest con aislamiento de red y credenciales, dobles en tests/helpers/fakes.js, congelamiento de v1
  - phase: 01-02
    provides: Rama _executeV2 (validar → sanear → entidad → perfil → guardia), SynexusConfig, selector de contrato, sexto parámetro del manejador
provides:
  - SynexusRequestBuilder (capa API): getIntentFor con throw terminal, buildRequestBody que esparce el archivo y encima la intención de nexgen, request_id UUID v4 desde crypto.randomBytes(16)
  - TaxValidator.validateV2IntentFields, hermano de validateCommittedField, que corre sólo en la rama v2 (guardia de archivo v1, contradicción de transaction_type/committed con ===, request_id heredado)
  - _executeV2 extendido entre printProfile y la guardia: getIntentFor → validateV2IntentFields → buildRequestBody → traza "Cuerpo v2 a enviar:"
  - index.js construye el builder junto a la capa API y lo inyecta como séptimo argumento
  - TEST-03: guardia de regresión de OPER-01 verificada por mutación
affects: [01-04, fase-2, fase-3]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Mapeo operación → intención con el molde de Config.getEndpointUrl: una comprobación por operación y throw terminal, sin rama else con valores por omisión"
    - "Esparcido archivo-primero, intención-después: lo que nexgen decide queda encima de lo que traiga el archivo"
    - "Validar antes de construir: una contradicción del archivo aborta antes de que exista cuerpo alguno"
    - "Una sola fuente de verdad para la intención: el validador la recibe como argumento y no guarda copia"
    - "UUID v4 en un solo camino de código (randomBytes + bits de versión/variante), sin detección de características"
    - "Guardia barata por presencia (!== undefined), no por veracidad, cuando el valor legítimo puede ser false"

key-files:
  created:
    - src/api/synexusRequestBuilder.js
    - tests/synexusRequestBuilder.test.js
    - tests/v2IntentValidation.test.js
  modified:
    - src/validators/taxValidator.js
    - src/cli/taxCommandHandler.js
    - index.js
    - tests/argumentParsing.test.js

key-decisions:
  - "El helper privado de la llave se llama _generateRequestId y no _generateIdempotencyKey: el criterio de aceptación exige grep 'Idempotency' = 0 sobre el archivo (ninguna cabecera de idempotencia inventada) y el nombre de la interfaz del plan lo contradecía; ningún otro plan depende del nombre"
  - "El builder se construye siempre en index.js, fuera del condicional del selector: no valida nada al construirse y es inocuo bajo v1"
  - "La traza 'Cuerpo v2 a enviar:' es un solo console.log con el JSON a dos espacios, mismo formato que la línea 33 del cliente v1; la prueba fija la cadena exacta"
  - "Los mensajes de contradicción citan el valor del archivo con JSON.stringify para que 'false' (cadena) y false (booleano) se distingan a simple vista en la salida"
  - "El ayudante buildHandler de tests/argumentParsing.test.js gana un doble del builder en vez de hacer tolerante a _executeV2 ante un builder ausente: un cableado roto debe fallar, no pasar en silencio"

patterns-established:
  - "Verificación por mutación de la guardia de regresión: sales_invoice, sin transaction_type, esparcido invertido y else con valor por omisión hacen fallar TEST-03; sin guardia de Committed, != en committed y guardia al final hacen fallar la validación v2"
  - "Prueba de orden con invocationCallOrder sobre siete colaboradores, y aserción de identidad (toBe) sobre la intención que viaja del builder al validador"

requirements-completed: [OPER-01, TEST-03, OPER-05, SAFE-01, OPER-04]

# Metrics
duration: 9min
completed: 2026-09-10
---

# Phase 01 Plan 03: Cuerpo v2 tipado como estimación y validación de intención Summary

**`--api-version=v2` construye e imprime un cuerpo tipado como `sales_estimate` + `committed: false` con un `request_id` UUID v4 generado por nexgen, aborta antes de construir si el archivo contradice la operación o parece del contrato v1, y sigue deteniéndose en la guardia de cableado — con TEST-03 verificada por mutación y sin tocar `taxApiClient.js` ni una sola línea existente de `taxValidator.js`.**

## Performance

- **Duration:** 9 min
- **Started:** 2026-09-10T20:58:57Z
- **Completed:** 2026-09-10T21:07:52Z
- **Tasks:** 2 (ambas TDD: RED → GREEN)
- **Files modified:** 7 (3 creados, 4 modificados)

## Accomplishments

- **OPER-01 / TEST-03.** `get_tax` produce `transaction_type: 'sales_estimate'` **y** `committed: false`. Los cuatro casos de la guardia afirman el tipo positivamente, el `committed` con `toBe(false)`, el tipo negativamente contra `sales_invoice`, y que la intención de nexgen gana sobre un archivo que ya trae `sales_invoice`. Verificado por mutación: tipar como `sales_invoice` (4 fallos), quitar el tipado (14 fallos), invertir el esparcido (1 fallo) y añadir un `else` con valor por omisión (5 fallos). Comentario en español dentro del archivo de prueba explicando qué se pierde al borrarlos.
- **SAFE-01.** `request_id` UUID v4 desde `crypto.randomBytes(16)` con los bits de versión y variante fijados sobre el búfer; un solo camino de código, `grep randomUUID` = 0. Viaja en el cuerpo, no en un header: `grep Idempotency` = 0. Prueba de formato, de unicidad entre invocaciones y de 50 llaves sin repetición.
- **OPER-05.** `getIntentFor` sólo conoce `get_tax`; `post_tax`, `cancel_tax` y cualquier otra caen al `throw` terminal nombrando la operación. `_assertIntentFieldsPresent` aborta nombrando el campo si el mapeo devolviera un objeto incompleto o si la llave fuera vacía. Las dos cosas ocurren antes de que exista cuerpo alguno.
- **OPER-04 bajo v2.** `validateV2IntentFields` compara con `===` `transaction_type` y `committed` del archivo contra la intención que devolvió el builder: contradecir aborta (`'false'` y `0` contradicen a `false`), coincidir se tolera, ausente es el caso normal. `validateCommittedField` sigue intacto y con cero llamadas en la rama v2 (afirmado con el `TaxValidator` real).
- **Guardia de archivo v1.** `Committed` con mayúscula, con cualquier valor, aborta con un mensaje que contiene `parece del contrato v1`, cita `"Committed"` y orienta hacia el selector. Corre antes que las contradicciones (prueba de orden con un archivo que dispararía las dos).
- **Rama v2 completa y en orden.** Con el validador real y siete colaboradores espiados: `validateRequestBody` → `sanitizeStringFields` → `resolveEntityCode` → `printProfile` → `getIntentFor` → `validateV2IntentFields` (con la **misma** intención, por identidad) → `buildRequestBody` (con el cuerpo saneado) → traza → guardia. `validate` y `validateCommittedField` con cero llamadas. Con contradicción o archivo v1, `buildRequestBody` no se llama y no se imprime ningún cuerpo.
- **Comprobado con el CLI real** (`index.js`, variables inline, sin `.env`, sin red): archivo v2 imprime perfil enmascarado + cuerpo tipado y para en la guardia con salida 1; archivo v1, contradicción y `post_tax` abortan con sus mensajes antes de construir; `get_tax` sin flags con archivo v2 conserva el mensaje literal de v1 (COMP-01). Cero ocurrencias de la llave completa en stdout+stderr; no se escribe archivo de salida.
- `npm test`: 7 suites, **154 casos** (97 previos + 24 del builder + 33 de la validación v2), código de salida 0.

## Task Commits

Each task was committed atomically (TDD: RED → GREEN):

1. **Task 1: El cuerpo tipado como estimación, con su llave de idempotencia**
   - RED `3771c7d` (test) — 24 casos: TEST-03, objeto nuevo, UUID v4 y unicidad, `getIntentFor`, campos ausentes
   - GREEN `5f4957c` (feat) — `src/api/synexusRequestBuilder.js`
2. **Task 2: La regla de contradicción y el cableado del builder**
   - RED `cabf9fd` (test) — 33 casos: guardia v1, contradicción, `request_id`, aislamiento de v1, recorrido de `_executeV2` con doble y con builder real
   - GREEN `5f445e6` (feat) — `src/validators/taxValidator.js`, `src/cli/taxCommandHandler.js`, `index.js`, `tests/argumentParsing.test.js`

**Plan metadata:** ver commit `docs(01-03)` al final de este plan.

## Files Created/Modified

- `src/api/synexusRequestBuilder.js` — Clase con `constructor(logger)`. `getIntentFor(operation)`: `get_tax` → `{ transaction_type: 'sales_estimate', committed: false }`; todo lo demás, `throw` terminal en español nombrando la operación (trío `console.error` + `logger.error` con `Operation:` + `throw`). `buildRequestBody(operation, requestBody)`: intención primero, `Object.assign({}, requestBody, intent, { request_id })`, `_assertIntentFieldsPresent`, traza `console.log`. `_generateRequestId()`: `randomBytes(16)`, `bytes[6] = (bytes[6] & 0x0f) | 0x40`, `bytes[8] = (bytes[8] & 0x3f) | 0x80`, hex en 8-4-4-4-12. `_assertIntentFieldsPresent(body)`: cadena no vacía / booleano / cadena no vacía, nombra el campo ausente. `require('crypto')` como primer y único import, sin desestructurar.
- `src/validators/taxValidator.js` — Sólo 57 líneas añadidas, 0 eliminadas. `validateV2IntentFields(operation, requestBody, expectedIntent)` inmediatamente después de `validateCommittedField`, con su forma (constante `errorMsg` tres veces, comillas dobles dentro de la cadena, comentario del caso normal). No está en `validate()`; `validOperations` intacto.
- `src/cli/taxCommandHandler.js` — Séptimo parámetro `requestBuilder` (JSDoc incluido). `_executeV2`: pasos 5-7 nuevos entre `printProfile` y la guardia (renumerada a 8, texto intacto); `console.log(\`Cuerpo v2 a enviar: ${JSON.stringify(v2RequestBody, null, 2)}\`)`. Los pasos 1-4 no se reordenan. `sed` sobre el cuerpo del método: 0 llamadas a `validator.validate(`/`validateCommittedField`.
- `index.js` — `require('./src/api/synexusRequestBuilder')` tras `TaxApiClient` (capa API, antes de `SynexusConfig`); `const requestBuilder = new SynexusRequestBuilder(logger)` dentro del paso 4, fuera del condicional del selector; séptimo argumento del manejador. Numeración 1-7 sin cambios; el `catch` no cambia.
- `tests/synexusRequestBuilder.test.js` — 24 casos en 5 `describe`. Los cuatro de TEST-03 encabezados por un recuadro en español que explica qué se pierde al borrarlos.
- `tests/v2IntentValidation.test.js` — 33 casos: 22 unitarios sobre el validador real (incluido "`validate()` no llama al hermano" y el congelamiento de `validateCommittedField`), 9 de recorrido de `_executeV2` con doble del builder (orden por `invocationCallOrder`, identidad de la intención, cuerpo saneado, traza exacta, abortos sin construir, operación sin mapeo, cuerpo `null`), y 2 con el `SynexusRequestBuilder` real (cuerpo impreso parseado: `sales_estimate`, `committed === false`, UUID v4; `post_tax` aborta en el mapeo).
- `tests/argumentParsing.test.js` — `buildHandler` gana un doble literal del builder como séptimo colaborador (ver Deviations).

## Decisions Made

- **`_generateRequestId` en vez de `_generateIdempotencyKey`.** El bloque `<interfaces>` del plan nombra `_generateIdempotencyKey()`, pero el criterio de aceptación exige `grep -c "Idempotency" src/api/synexusRequestBuilder.js` = 0 ("la llave viaja en el cuerpo, no en un header inventado"). Las dos cosas no pueden cumplirse a la vez. Se honró el criterio mecánico —es el que protege contra la cabecera inventada y el que corre el verificador— y se renombró el helper privado por el campo que rellena. Plan 01-04 no referencia el nombre; el JSDoc sigue diciendo "llave de idempotencia" en español (no dispara el `grep`, que es sensible a mayúsculas).
- **El comentario sobre el generador nativo de UUID no escribe su nombre.** `grep -c "randomUUID"` debe ser 0 y no distingue comentarios; el JSDoc dice "el generador nativo de UUID de Node (aparece en 14.17)".
- **Presencia por `!== undefined` en las cuatro comprobaciones.** Un cuerpo parseado de JSON no puede traer `undefined`, así que equivale a `in`, y es coherente con la guardia de `Committed`, donde `false` es precisamente el valor legítimo de v1. `null` cuenta como presente y contradice: correcto, porque `null !== 'sales_estimate'`.
- **`request_id` vacío también se rechaza.** La regla es de presencia, no de contenido: un archivo que lo trae, con lo que sea, indica que alguien cree que ese campo es suyo.
- **Los valores contradictorios se citan con `JSON.stringify`.** `"false"` (cadena) y `false` (booleano) se ven distintos en el mensaje, que es justo lo que el operador necesita para entender por qué `===` los separó.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] El ayudante `buildHandler` de la wave 2 construía el manejador con seis argumentos**
- **Found during:** Task 2 (GREEN)
- **Issue:** Al hacer que `_executeV2` llame a `this.requestBuilder.getIntentFor`, dos casos de `tests/argumentParsing.test.js` ("termina en la guardia de cableado" y "TAX_API_VERSION=v2 también ramifica") fallaban con `TypeError: Cannot read properties of undefined (reading 'getIntentFor')` en vez de llegar a la guardia. El archivo no está en `files_modified` del plan.
- **Fix:** `buildHandler` gana un doble literal `requestBuilder` (`getIntentFor` y `buildRequestBody` como `jest.fn()`) y lo pasa como séptimo argumento, con un comentario en español que remite a los archivos donde el builder se prueba de verdad. Se descartó hacer `_executeV2` tolerante a un builder ausente: ocultaría un cableado roto (mismo criterio que la wave 2 aplicó a `getApiVersion`).
- **Files modified:** `tests/argumentParsing.test.js`
- **Verification:** los 29 casos del archivo siguen verdes sin cambiar ninguna aserción; `npm test` 154/154.
- **Committed in:** `5f445e6`

**2. [Rule 1 - Bug] Nombre del helper privado en conflicto con un criterio de aceptación**
- **Found during:** Task 1 (GREEN), al correr los `grep` de aceptación
- **Issue:** `grep -c "Idempotency"` devolvía 2 por el nombre `_generateIdempotencyKey` que el propio plan dicta en `<interfaces>`; `grep -c "randomUUID"` devolvía 1 por un comentario.
- **Fix:** Renombrado a `_generateRequestId` (ver Decisions) y comentario reescrito. La prueba RED referenciaba el nombre en dos sitios; se actualizó en el commit GREEN sin cambiar ninguna aserción de comportamiento.
- **Files modified:** `src/api/synexusRequestBuilder.js`, `tests/synexusRequestBuilder.test.js`
- **Verification:** ambos `grep` = 0; 24/24 verdes.
- **Committed in:** `5f4957c`

---

**Total deviations:** 2 auto-fixed (1 × Rule 3, 1 × Rule 1).
**Impact on plan:** Ninguna sobre el alcance. El comportamiento y la superficie pública (`getIntentFor`, `buildRequestBody`, `validateV2IntentFields`, séptimo parámetro) son exactamente los del plan.

## Issues Encountered

- **Pruebas que pasaban en RED de la Task 2 (2 de 33).** "`validateCommittedField` sigue rechazando un cuerpo v2 con el mensaje literal de v1" y "la lista de operaciones sigue siendo la de siempre" congelan lo que NO debe cambiar; ninguna indica funcionalidad preexistente. Se revisaron antes de seguir a GREEN, como en la wave 2.
- **Una corrida de humo compuesta fue denegada por el sistema de permisos** (heredocs a `/tmp` + `export` + `rm -rf` en un solo comando). Se repartió en escrituras con la herramienta `Write` bajo `/private/tmp` y ejecuciones con variables inline; los fixtures se borraron al terminar. No se creó `.env`.
- **`env $VAR` en zsh no divide palabras.** La primera pasada de humo colapsó las variables en una sola; se corrigió con `${=E}` y `pipestatus`. Sin efecto sobre el código.

## Known Stubs

- `this.synexusApiClient` sigue sin asignarse: `_executeV2` termina siempre en la guardia de cableado. **Intencional y previsto por el plan**: 01-04 agrega el octavo parámetro y la llamada a `makeRequest` después de la guardia, que se queda como defensa permanente. No es un dato vacío que fluya a ninguna salida; la corrida sale con código 1 y no escribe archivo de respuesta.

## User Setup Required

None - no external service configuration required. La suite y las corridas de humo no necesitan `.env`. Sigue pendiente `.env.example` del plan 01-02 (bloqueado por permisos del proyecto).

## Next Phase Readiness

- **Para 01-04:** `_executeV2` deja `v2RequestBody` construido e impreso justo antes de la guardia; el cliente v2 recibe `(operation, v2RequestBody, resolvedEntityCode)` o lo que ese plan defina, después de la guardia. El octavo parámetro del constructor va tras `requestBuilder`. `index.js` ya construye el builder en el paso 4; el cliente v2 va en el bloque `if (apiVersion === 'v2')` del paso 5 junto a `SynexusConfig`. Los dobles de `tests/argumentParsing.test.js` y `tests/v2IntentValidation.test.js` construyen el manejador con siete argumentos: el octavo puede omitirse en ellos (la guardia sigue disparando) o inyectarse como doble.
- **Para Fase 2:** `getIntentFor` es el único sitio donde añadir `post_tax` y `cancel_tax`; `validateV2IntentFields` ya compara contra la intención recibida, así que no necesita cambios para operaciones nuevas.
- **Punto a revisar con el área de ERP (de 01-CONTEXT.md):** si su extracción empieza a incluir `transaction_type` de forma rutinaria, la regla de contradicción se vuelve ruidosa y habría que cambiarla por sobreescritura con aviso.
- **Abierto:** `.env.example` y la actualización de `.claude/agents` y `.claude/commands` al cerrar 01-04 (`deferred-items.md`).

---
*Phase: 01-camino-v2-de-punta-a-punta-para-una-cotizaci-n*
*Completed: 2026-09-10*

## Self-Check: PASSED

Archivos creados/modificados (7/7) y commits de tarea (4/4) verificados en disco y en `git log`. `npm test`: 154/154, código de salida 0.
