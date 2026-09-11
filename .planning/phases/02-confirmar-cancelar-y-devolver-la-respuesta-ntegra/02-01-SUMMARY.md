---
phase: 02-confirmar-cancelar-y-devolver-la-respuesta-ntegra
plan: 01
subsystem: api
tags: [post-tax, sales-invoice, test-02, contract-fixture, response-fidelity, file-manager, wr-03, wr-04, tdd, mutation-validated]

# Dependency graph
requires:
  - phase: 01-03
    provides: SynexusRequestBuilder.getIntentFor con throw terminal, validateV2IntentFields, _executeV2 con el orden validar → sanear → entidad → perfil → intención → construir
  - phase: 01-04
    provides: SynexusApiClient con makeRequest(operation, cuerpo, entidad), grafo cerrado en index.js, tests/v2QuoteEndToEnd.test.js como molde del recorrido completo
provides:
  - getIntentFor('post_tax') → { transaction_type: 'sales_invoice', committed: true }, sin rama por omisión; TEST-02 como espejo de TEST-03, verificada por mutación
  - tests/fixtures/synexus-staging-2026-09-09-{request,response}.json — petición y respuesta reales de staging, byte a byte, como fixture de contrato (VERIF-01)
  - tests/v2ResponseFidelity.test.js — el único archivo de la suite que instancia el FileManager real y toca disco (os.tmpdir()); prueba COMP-02, COMP-03, SAFE-04 y TEST-04
  - TaxValidator.validateV2FileShape — arreglo raíz (WR-04) y guardia de archivo v1 antes de resolver la entidad; sólo adiciones al archivo
  - _executeV2 sin sanitizeStringFields (WR-03): el cuerpo crudo viaja por identidad a resolveEntityCode, validateV2IntentFields y buildRequestBody
affects: [02-02, 02-03, 02-04, fase-3]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Guardia de regresión espejo: TEST-02 afirma sales_invoice, committed toBe(true) y niega sales_estimate, con su propio recuadro que explica qué se pierde al borrarla"
    - "Fixture de contrato copiado byte a byte desde data/ con cmp como gate, leído con fs en cada caso (no require) y alimentado al doble de axios como copia profunda"
    - "Prueba de fidelidad con el colaborador de disco REAL sobre mkdtempSync bajo os.tmpdir(): aserciones de texto crudo con comillas más entrada sintética donde parseFloat sí cambiaría dígitos"
    - "La implementación de una garantía de paso directo es no escribir código: se prueba que no hay conversión y se protege con grep de aceptación sobre src/"
    - "Método hermano por adición pura: el gate mecánico es git diff | grep -c '^-[^-]' = 0 sobre el archivo congelado; se copia un literal en vez de referenciarlo para no mover líneas"
    - "Actualizar sin debilitar: toda aserción que pasa de 'saneado' a 'crudo' gana la identidad toBe que antes no podía tener; ningún toHaveBeenCalledTimes se borra"

key-files:
  created:
    - tests/fixtures/synexus-staging-2026-09-09-request.json
    - tests/fixtures/synexus-staging-2026-09-09-response.json
    - tests/v2ResponseFidelity.test.js
  modified:
    - src/api/synexusRequestBuilder.js
    - src/validators/taxValidator.js
    - src/cli/taxCommandHandler.js
    - tests/synexusRequestBuilder.test.js
    - tests/v2IntentValidation.test.js
    - tests/v2QuoteEndToEnd.test.js
    - tests/argumentParsing.test.js
    - .claude/commands/tax-commit.md
    - .claude/commands/tax-cancel.md
    - .claude/agents/nexgen-explorer.md
    - .claude/agents/tax-validator-helper.md

key-decisions:
  - "El throw terminal de getIntentFor pasa de 'todavía no tiene mapeo' a 'no tiene mapeo de intención… cancel_tax no pasa por este mapeo': conserva la frase que buscan las pruebas y deja de prometer un mapeo futuro que cancel_tax no tendrá (plan 02-02 le da su propio constructor)"
  - "La guardia de archivo v1 se copia literal en validateV2FileShape en vez de extraerse a una constante compartida: la duplicación de cuatro líneas es el precio de que el diff del validador sea sólo adiciones, que es la prueba mecánica de que nada congelado se movió"
  - "validateV2FileShape va en el paso 2 de _executeV2, antes de resolver la entidad: un archivo v1 bajo v2 aborta con la causa raíz y no con 'no se pudo resolver el código de entidad' (IN-08 del review); validateV2IntentFields conserva su guardia como defensa en profundidad"
  - "La prueba de la Fase 1 'archivo v1 bajo la rama v2' se actualiza para afirmar el aborto temprano (validateV2FileShape una vez, resolveEntityCode y validateV2IntentFields cero): describía el orden viejo y ahora es más fuerte, no más débil"
  - "Task 2 no tiene commit feat: el paso directo YA es la implementación de SAFE-04 y COMP-03, como dice el plan. Lo que se commitea es la prueba que lo demuestra y las dos mutaciones que la ponen en rojo"
  - "El criterio 'git diff --stat 4d6d438 -- src/ no reporta cambios al terminar la Task 2' se lee como 'src/ limpio respecto a HEAD tras restaurar la mutación': literalmente no puede cumplirse porque la Task 1 ya cambió el builder respecto a esa línea base"

patterns-established:
  - "Verificación por mutación de TEST-02: committed false (9 fallos), sales_estimate (9 fallos), else con valor por omisión en lugar del throw (4 fallos)"
  - "Verificación por mutación de la fidelidad: parseFloat sobre totals en _handleResponse del cliente v2 (4 fallos) y replacer que convierte cadenas decimales en writeJsonFile (4 fallos)"
  - "Verificación por mutación de WR-03/WR-04: volver a sanear en _executeV2 (6 fallos), quitar Array.isArray (6 fallos)"
  - "Corrida de humo con index.js real, red bloqueada por preload y variables inline: post_tax imprime sales_invoice/committed true y cae en el bloqueo; el arreglo aborta en español antes de 'Realizando petición'; O'Brien sale intacto bajo v2 y como O\\'Brien bajo v1"

requirements-completed: [OPER-02, TEST-02, VERIF-01, TEST-04, SAFE-04, COMP-02, COMP-03]

# Metrics
duration: 15min
completed: 2026-09-11
---

# Phase 02 Plan 01: post_tax bajo v2, fixture de contrato y fidelidad de la respuesta Summary

**`node index.js post_tax archivo.json --api-version=v2` emite contra la misma ruta de cálculo un cuerpo tipado como `sales_invoice` + `committed: true` con guardia TEST-02 verificada por mutación; la respuesta real de staging del 9-sep vive en `tests/fixtures/` byte a byte con una prueba de forma que se pone en rojo si el proveedor cambia; y con el `FileManager` REAL escribiendo a `os.tmpdir()` queda demostrado que `RESPONSE_ORD-0001234.json` conserva nombre, numeración, directorio y cada monto entre comillas —`"tax_amount": "0.00"`, `"tax_rate": "0.0825"`, `"discount_amount": "0.10"`— sin que exista una sola conversión en `src/`. De paso, la rama v2 deja de escapar apóstrofos (`O'Brien St` viaja intacto; v1 sigue mandando `O\'Brien St`) y rechaza un arreglo raíz en español antes de resolver la entidad, con el validador ganando 41 líneas y perdiendo cero.**

## Performance

- **Duration:** 15 min
- **Started:** 2026-09-11T20:37:27Z
- **Completed:** 2026-09-11T20:52:36Z
- **Tasks:** 3 (las tres TDD: RED → GREEN; la Task 2 sin código de producción por diseño)
- **Files modified:** 14 (3 creados, 11 modificados; `index.js` y los cinco archivos congelados sin un solo cambio)

## Accomplishments

- **OPER-02 / TEST-02.** `getIntentFor('post_tax')` devuelve `{ transaction_type: 'sales_invoice', committed: true }` después del bloque de `get_tax` y antes del `throw` terminal; sigue sin rama `else`. Los cinco casos de TEST-02 en el builder afirman `sales_invoice`, `committed` con `toBe(true)` y `typeof 'boolean'`, la negación de `sales_estimate`, que la intención de nexgen gana sobre un archivo que ya trae `sales_estimate`/`committed: false`, y el `request_id` UUID v4. Un caso más afirma que las dos intenciones mapeadas son opuestas en los dos campos. Los tres casos de "operación sin mapeo" pasan a `cancel_tax`.
- **OPER-04 bajo v2, lado de confirmación.** Con la intención de `post_tax` literal en la prueba, `validateV2IntentFields` rechaza `committed: false` (mensaje con `"committed"`, `post_tax` y `debe ser true`), `committed: 'true'` (cadena), `transaction_type: 'sales_estimate'` (citando los dos valores); tolera `committed: true` + `sales_invoice`; y dispara la guardia de archivo v1 con `Committed: true`. Con el builder real, `post_tax` llega a `makeRequest('post_tax', cuerpo, 'USA')` con lo impreso igual a lo emitido, y `committed: false` en el archivo aborta antes del cliente.
- **Recorrido completo de la confirmación** (`tests/v2QuoteEndToEnd.test.js`, 9 casos + 3 abortos): axios una vez, `POST`, la MISMA `v2CalculationUrl` que `get_tax` sin credencial, `sales_invoice` + `committed` `toBe(true)` + negación de `sales_estimate` + UUID v4, `Authorization: Bearer` y `X-Synexus-Entity: USA`, respuesta escrita por identidad en `RESPONSE_a.json`, mensajes de éxito nombrando `post_tax`, llave nunca en consola ni logger. `committed: false`, `sales_estimate` y archivo v1 abortan sin axios y sin archivo. El caso "post_tax aborta en el mapeo" desaparece: describía un manejador que ya no existe.
- **VERIF-01.** `tests/fixtures/` con los dos archivos reales (`cmp` = 0 contra `data/fixtures/`; `git check-ignore` = 1; grep de credenciales = 0). 21 casos de forma: llaves de primer nivel exactamente `cart, destination, meta, origin, totals, transaction, warnings`; las once llaves de monto de `totals` y las cuatro por línea del carrito son cadenas decimales (`it.each`); `invoice_discount_percent` afirmado como número y fuera de la lista; `tax_rate` de línea `null` o decimal; `meta.request_id` con forma UUID; `warnings` arreglo; `transaction_purpose` tolerado, nunca exigida su ausencia; `tax_amount: "0.00"` con `exemption.source: "no_nexus"` como caso que pasa; la petición trae los cuatro obligatorios y `tax_code` por línea y NO trae `Committed`, `transaction_type`, `committed` ni `request_id`.
- **COMP-02 / COMP-03 / SAFE-04 / TEST-04.** Grafo de `index.js` a mano con `new FileManager(logger)` real, `Config` real y sólo axios sustituido; dos `mkdtempSync` bajo `os.tmpdir()`, `OUTPUT_DIR` apuntado y restaurado, `rmSync` en `afterEach`. `get_tax` con el fixture: el directorio de salida contiene exactamente `RESPONSE_ORD-0001234.json`; su `JSON.parse` es `toEqual` al fixture leído aparte; el texto crudo contiene `"tax_amount": "0.00"` y `"pre_tax_amount": "49.99"` y no cumple `/"tax_amount": 0[,\n]/` ni `/"pre_tax_amount": 49\.99/`; la entrada queda byte a byte igual; la corrida termina con éxito con el cero. `post_tax` con el mismo fixture: mismo nombre, mismo contenido. Respuesta sintética: `"tax_rate": "0.0825"`, `"tax_amount": "1234567.89"`, `"discount_amount": "0.10"`, `"price": "0.10"` exactos, con sus negaciones.
- **Ninguna capa de normalización.** `grep` sobre `src/`: 0 `parseFloat(`/`Number(`/`parseInt(`/`toFixed(` fuera de comentarios, 0 `+` unario. No se escribió código de producción en la Task 2.
- **WR-04.** `validateV2FileShape` como hermano entre `validateV2IntentFields` y `validateRequestBody`: `Array.isArray` → trío y `throw` con mensaje que empieza por `El archivo de entrada debe ser un objeto JSON, no un arreglo`; después, la guardia de `Committed` copiada literal. `validate()`, `validateCommittedField`, `sanitizeStringFields`, `validateRequestBody` y `validateV2IntentFields` intactos: `git diff 4d6d438 | grep -c "^-[^-]"` = 0. Siete casos unitarios, incluido "un arreglo cuyo primer elemento trae `Committed` da el mensaje del arreglo" y "`validate()` no lo llama".
- **WR-03.** `_executeV2` sin `sanitizeStringFields`: `validateRequestBody` → `validateV2FileShape` → `resolveEntityCode` → `printProfile` → `getIntentFor` → `validateV2IntentFields` → `buildRequestBody` → guardia → `makeRequest`, con el cuerpo crudo por identidad (`toBe(rawBody)`) y `customer_id: "Plummer's"` sin barra. El gate del plan 01-02 pasa de 2 a 1 (actualizado, no borrado); `sanitizeStringFields` con `not.toHaveBeenCalled()`. En el recorrido completo, `address_line1: "O'Brien St"` llega a axios intacto bajo v2, y bajo v1 con el `TaxApiClient` real sale `O\'Brien St`: esa aserción congela la diferencia entre contratos (COMP-01).
- **Comprobado con el CLI real** (`index.js`, preload que bloquea `http`/`https`, variables inline, sin `.env`): `post_tax` v2 imprime perfil enmascarado, `Cuerpo v2 construido para post_tax: sales_invoice, committed=true`, `Realizando petición POST_TAX a: …/api/v1/tax_calculations` y cae en el bloqueo con salida 1; arreglo raíz aborta con el mensaje en español sin llegar a `Realizando`; apóstrofo intacto bajo v2, `Datos sanitizados exitosamente` y `O\\'Brien` bajo v1; ningún archivo de salida escrito.
- `npm test`: 10 suites, **304 casos** (242 previos + 6 builder + 14 validación/rama + 14 recorrido + 28 fidelidad), código de salida 0, sin `.env`, sin red.

## Task Commits

Each task was committed atomically (TDD: RED → GREEN):

1. **Task 1: post_tax bajo v2 — factura confirmada, con su guardia espejo de TEST-03**
   - RED `a30d9b9` (test) — 21 casos en rojo con "no tiene mapeo de intención" (5 unitarios del validador con `postTaxExpectedIntent` pasaban ya: no dependen del builder)
   - GREEN `33b8f4c` (feat) — `src/api/synexusRequestBuilder.js`
2. **Task 2: El fixture de contrato en el repositorio y la fidelidad de la respuesta con el FileManager real**
   - `a7d271a` (test) — fixtures byte a byte + `tests/v2ResponseFidelity.test.js`, 28 casos. Sin commit `feat`: no hay código de producción que escribir (ver TDD Gate Compliance)
3. **Task 3: WR-03 y WR-04 — la rama v2 deja de escapar apóstrofos y rechaza un arreglo raíz antes de la red**
   - RED `9021182` (test) — 23 casos en rojo (`validateV2FileShape is not a function`; `"Plummer\'s"` donde se esperaba `"Plummer's"`)
   - GREEN `eb9e4dd` (feat) — `src/validators/taxValidator.js`, `src/cli/taxCommandHandler.js`, un caso de la Fase 1 actualizado
4. **Documentación exigida por CLAUDE.md** — `46536a4` (docs) — `.claude/commands/tax-commit.md`, `tax-cancel.md`, `.claude/agents/nexgen-explorer.md`, `tax-validator-helper.md`

**Plan metadata:** ver commit `docs(02-01)` al final de este plan.

## Files Created/Modified

- `src/api/synexusRequestBuilder.js` — Bloque `post_tax` en `getIntentFor` tras `get_tax`, con comentario sobre la única combinación que registra una factura confirmada. `throw` terminal: `La operación "X" no tiene mapeo de intención en el contrato v2: no puede emitirse por la ruta de cálculo. Sólo get_tax (sales_estimate) y post_tax (sales_invoice) tienen mapeo; cancel_tax no pasa por este mapeo.` Cabecera de la clase y JSDoc de `getIntentFor` actualizados (TEST-03 y TEST-02 como guardias). `buildRequestBody`, `_generateRequestId`, `_assertIntentFieldsPresent` sin cambios. `grep` fuera de comentarios: 1 `transaction_type: 'sales_invoice'`, 1 `committed: true`, 0 `} else {`.
- `src/validators/taxValidator.js` — Sólo 41 líneas añadidas: `validateV2FileShape(requestBody)` con JSDoc (`@param`, `@throws`) y comentarios que explican por qué se copia la guardia, que lo llama únicamente `_executeV2` para las tres operaciones (incluida la cancelación del plan 02-02) y que no forma parte de `validate()`.
- `src/cli/taxCommandHandler.js` — `_executeV2`: paso 2 = `validateV2FileShape` con el comentario de WR-03 (por qué la rama v2 no sanea) e IN-08 (por qué la forma va antes de la entidad); pasos 3, 6 y 7 reciben `requestBody`; JSDoc actualizado ("valida el cuerpo y la forma del archivo… Tampoco sanea"). `execute()`, la rama v1 y el resto del archivo sin cambios. Gate: 1 `validateRequestBody`, 0 `sanitizeStringFields`, 1 `validateV2FileShape` fuera de comentarios.
- `tests/fixtures/synexus-staging-2026-09-09-request.json`, `-response.json` — Copias byte a byte (`cp` + `cmp`). Sin README: el encabezado de la prueba explica de dónde salen.
- `tests/v2ResponseFidelity.test.js` — 377 líneas, 28 casos en dos `describe`. Constantes `TOTALS_AMOUNT_KEYS` (11), `CART_LINE_AMOUNT_KEYS` (4), `DECIMAL_STRING`; `readFixture` con `fs`, `deepCopy`, `buildRealGraph` con `new FileManager(logger)`; entrada `ORD-0001234.json`; salida `RESPONSE_ORD-0001234.json`. Encabezado que remite a `.planning/codebase/CONCERNS.md` y a la validación por mutación.
- `tests/synexusRequestBuilder.test.js` — Describe TEST-02 con su recuadro en español; `getIntentFor('post_tax')` exacto; "intenciones opuestas"; `cancel_tax` en los tres casos de "sin mapeo". Cabecera con los cinco puntos.
- `tests/v2IntentValidation.test.js` — `postTaxExpectedIntent`; describe "con la intención de post_tax" (5); describe `validateV2FileShape` (7); `buildHandler` con el espía nuevo; orden y conteos actualizados; identidad del cuerpo crudo (2 casos); arreglo bajo v2; `null` sin comprobar la forma; con el builder real, `post_tax` positivo y `post_tax` con `committed: false`; doble sin mapeo con `cancel_tax`; caso de archivo v1 con aborto temprano.
- `tests/v2QuoteEndToEnd.test.js` — Cabecera (cotización y confirmación); `createConfirmedProviderResponse`; describe de confirmación (9) + abortos bajo `post_tax` (3) + describe WR-03/WR-04 (3); "saneados" → "tal cual"; caso obsoleto borrado.
- `tests/argumentParsing.test.js` — Gate del plan 01-02 actualizado (1 llamada; `sanitizeStringFields` `not.toHaveBeenCalled()`; `resolveEntityCode` con `body` por identidad); caso del apóstrofo pasa a "CRUDO: viaja intacto". 16 `not.toHaveBeenCalled`, 2 `toBe(body)`.
- `.claude/commands/tax-commit.md`, `tax-cancel.md`, `.claude/agents/nexgen-explorer.md`, `tax-validator-helper.md` — Ver Deviations.

## Decisions Made

- **Texto del `throw` terminal de `getIntentFor`.** El plan pide que siga conteniendo "mapeo de intención" y que diga que sólo `get_tax` y `post_tax` tienen mapeo y que `cancel_tax` no pasa por él. Se quitó "todavía" (ya no es una promesa pendiente) y se añadió "por la ruta de cálculo". `.claude/commands/tax-cancel.md` citaba el literal viejo y se actualizó.
- **Guardia de `Committed` copiada, no compartida.** Ver key-decisions. La prueba unitaria compara los dos `message` con `toBe`, así que una divergencia futura entre las dos copias se detecta.
- **`createConfirmedProviderResponse` en el recorrido completo** en vez de darle `overrides` a `createProviderResponse`: la factoría existente no cambia de firma y el describe de confirmación declara su propia respuesta, como manda la convención de factorías por archivo.
- **La prueba de fidelidad usa `it.each` sobre `TOTALS_AMOUNT_KEYS`**: once casos con nombre propio, de modo que si el proveedor renombra una sola llave el rojo dice cuál.
- **La corrida de humo se repartió en cuatro invocaciones** con un preload de bloqueo de red idéntico en espíritu a `tests/setup.js`; los archivos temporales se borraron al terminar y no se creó `.env`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Aserción de la Fase 1 que describía el orden viejo de la guardia de archivo v1**
- **Found during:** Task 3 (GREEN)
- **Issue:** `tests/v2IntentValidation.test.js` › "con un archivo del contrato v1 bajo la rama v2…" afirmaba `validateV2IntentFields` `toHaveBeenCalledTimes(1)`: hasta la Fase 1 la guardia corría ahí, después de resolver la entidad. Con `validateV2FileShape` en el paso 2 —lo que el plan manda y lo que cierra IN-08— el archivo v1 aborta antes, y esa aserción quedó falsa (1/304 en rojo).
- **Fix:** El caso pasa a afirmar el aborto temprano: `validateV2FileShape` una vez, `resolveEntityCode` cero, `validateV2IntentFields` cero, `buildRequestBody` cero, `makeRequest` cero, más las dos aserciones de v1 que ya tenía. Nombre y comentario explican el cambio de orden. Ninguna aserción se debilitó: el caso gana dos negaciones que antes no podía tener.
- **Files modified:** `tests/v2IntentValidation.test.js`
- **Verification:** 304/304; la mutación "quitar `Array.isArray`" y "volver a sanear" siguen poniendo en rojo 6 casos cada una.
- **Committed in:** `eb9e4dd`

**2. [Rule 2 - CLAUDE.md] Comandos y agentes de `.claude/` afirmaban que `post_tax` abortaba bajo v2 y describían la rama con `sanitizeStringFields`**
- **Found during:** Cierre del plan, antes del SUMMARY
- **Issue:** `CLAUDE.md` exige revisar `.claude/agents/` y `.claude/commands/` cuando cambia el código que referencian. `tax-commit.md` decía que `post_tax` "is not mapped under v2 yet" y citaba el mensaje viejo; `tax-cancel.md` citaba el literal `todavía no tiene mapeo…` que ya no existe; `nexgen-explorer.md` trazaba `_executeV2` con `sanitizeStringFields` y decía que sólo `get_tax` tenía mapeo; `tax-validator-helper.md` no conocía `validateV2FileShape` ni la regla de sólo adiciones, y su "do not remove `sanitizeStringFields` defensiveness" invitaba a volver a llamarla desde v2.
- **Fix:** Sólo se reemplazaron las líneas que quedaron falsas; metadatos intactos. Ningún archivo de `src/` ni de `tests/` tocado en este commit.
- **Files modified:** `.claude/commands/tax-commit.md`, `.claude/commands/tax-cancel.md`, `.claude/agents/nexgen-explorer.md`, `.claude/agents/tax-validator-helper.md`
- **Verification:** `git diff --stat` del commit: 4 archivos, 45+/19−; `npm test` sin cambios (304/304).
- **Committed in:** `46536a4`

---

**Total deviations:** 2 auto-fixed (1 × Rule 1, 1 × Rule 2 por `CLAUDE.md`).
**Impact on plan:** Ninguna sobre el alcance ni la superficie pública. `getIntentFor('post_tax')`, `validateV2FileShape(requestBody)` y el orden de `_executeV2` son exactamente los del plan.

## Issues Encountered

- **Pruebas que pasaban en RED de la Task 1 (5 de 26 nuevas).** Los cinco casos unitarios "con la intención de post_tax" declaran la intención literal (`postTaxExpectedIntent`) y no dependen del builder, así que `validateV2IntentFields` ya los cumplía. El plan lo prevé ("el validador no depende del builder"). Los 21 restantes estaban en rojo con el mensaje esperado.
- **Task 2 en verde desde el primer intento (28/28), por diseño.** El plan dice que no hay código de producción que escribir. El valor de la prueba se demostró por mutación (dos conversiones distintas, 4 fallos cada una), no por un RED previo.
- **Criterio de aceptación de la Task 2 literalmente incumplible.** "`git diff --stat 4d6d438 -- src/` no reporta cambios al terminar esta tarea" no puede ser cierto porque la Task 1 ya modificó el builder respecto a esa línea base. Se cumplió lo que el criterio protege: `git status --short src/` vacío tras restaurar las mutaciones, y los archivos congelados sin cambios respecto a `4d6d438` (criterio siguiente, verificado).
- **Un commit falló por comillas dobles dentro de `-m "…"`** (`"Plummer's"` y `"O'Brien St"` en el cuerpo del mensaje). Se repitió con `git commit -F` sobre un archivo temporal, borrado después. Sin efecto sobre el árbol.
- **`.claude/settings.json` modificado y `postman/` sin rastrear desde antes de la ejecución.** No se tocaron ni se incluyeron en ningún commit. `.planning/STATE.md` traía cambios del orquestador (arranque de la Fase 2); se conservan y se commitean con los metadatos del plan.

## TDD Gate Compliance

- Task 1: `test` `a30d9b9` → `feat` `33b8f4c`. Cumplido.
- Task 2: `test` `a7d271a` sin `feat` posterior. **Intencional y previsto por el plan**: "No hay código de producción que escribir en esta tarea: el paso directo YA es la implementación de SAFE-04 y COMP-03". La puerta GREEN la ocupa la evidencia de mutación (dos conversiones insertadas y restauradas, `git status src/` limpio).
- Task 3: `test` `9021182` → `feat` `eb9e4dd`. Cumplido.
- Sin commits `refactor`: no hubo limpieza posterior.

## Known Stubs

None. `validateV2FileShape` no deja ningún valor vacío fluyendo a la salida; la respuesta sintética de la prueba de fidelidad es entrada de prueba, no dato de producción; `cancel_tax` bajo v2 sigue abortando en `getIntentFor` como en la Fase 1 y el plan 02-02 le da su camino.

## User Setup Required

None - no external service configuration required. La suite, las mutaciones y la corrida de humo no necesitan `.env`, red ni credenciales. Sigue pendiente `.env.example` (plan 01-02, bloqueado por permisos del proyecto).

## Needs your decision

Ninguna. No hubo denegaciones de permisos en esta ejecución.

## Next Phase Readiness

- **Para 02-02 (`cancel_tax`):** `validateV2FileShape` ya sirve a las tres operaciones y corre antes de resolver la entidad; el manejador tiene que bifurcar el paso 5 de `_executeV2` por operación (constructor del cuerpo de cancelación vs `getIntentFor`) y `cancel_tax` debe dejar de pasar por `getIntentFor`. Dos casos lo esperan: `tests/synexusRequestBuilder.test.js` ("cancel_tax lanza… no pasa por el mapeo") y el doble sin mapeo de `tests/v2IntentValidation.test.js` (ahora con `cancel_tax`); `.claude/commands/tax-cancel.md` cita el mensaje actual. `SynexusApiClient.makeRequest` sigue resolviendo una sola URL (`getCalculationUrl`).
- **Para 02-03 (errores por código, `request_id`, reintento):** `_handleResponse` sigue devolviendo `response.data` sin tocar; `meta.request_id` está afirmado en el fixture (`15ee45f1-…`) y la prueba de fidelidad ya escribe el cuerpo completo, así que registrar el identificador en stdout no puede alterar el archivo sin que `v2ResponseFidelity` lo vea.
- **Para 02-04 / Fase 3:** `tests/fixtures/` es la referencia de forma para cualquier prueba nueva; el procedimiento de staging puede citar `RESPONSE_<original>.json` con montos entre comillas como lo que el área de ERP debe esperar.
- **Punto abierto para el área de ERP (sin cambio):** que la extracción de Sage para v2 emita la misma forma que el fixture de petición, y que los archivos de cancelación traigan `invoice_id` y `customer_id`.

---
*Phase: 02-confirmar-cancelar-y-devolver-la-respuesta-ntegra*
*Completed: 2026-09-11*

## Self-Check: PASSED

Archivos creados/modificados (14/14 más este resumen) y commits de tarea (6/6) verificados en disco y en `git log`. `npm test`: 304/304, código de salida 0, sin `.env`, sin red.
