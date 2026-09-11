---
phase: 02-confirmar-cancelar-y-devolver-la-respuesta-ntegra
plan: 03
subsystem: api
tags: [request-id, x-request-id, error-classification, safe-05, safe-06, docs-url, tdd, mutation-validated, no-text-branching]

# Dependency graph
requires:
  - phase: 02-02
    provides: _resolveUrl(operation), postTax/cancelTax, la forma de _handleResponse (corte en 400) y de _handleError (cadena if/else if, detailedLog, bloque de diagnóstico); la nota de que la cancelación no lleva request_id de nexgen
  - phase: 01-04
    provides: SynexusApiClient con makeRequest y el molde de v1 (try/catch, _handleResponse lanza dentro del try); createAxiosError con config.headers.Authorization poblado y expectNoCredentialLeak en tests/synexusApiClient.test.js
provides:
  - SynexusApiClient._extractProviderRequestId(response) — meta.request_id (éxito del cálculo) > request_id (error del cálculo) > header x-request-id (todos los endpoints); sólo cadena no vacía, null si no hay; acceso defensivo
  - Línea de éxito `SUCCESS: <op> - Status: <status> - request_id=<id | no informado por el proveedor>`
  - 4xx resuelto — mensaje lanzado y logger con `request_id=`; el Error lleva providerResponded = true y providerRequestId; docs_url SÓLO al log de winston
  - _handleError(error, url, operation, requestBody) — nota "Identificador para soporte" en el bloque de diagnóstico y en detailedLog; del proveedor (4xx y 5xx), la llave propia del cálculo cuando no respondió, "ninguno" para la cancelación sin respuesta
  - _describeCalculationError(status, data, headers) — catálogo por data.code (invalid_key, tax_code_missing, idempotency_key_conflict, invoice_stale_object, rate_limited con retry-after, cart_empty, validation_error con details[]) y genérico con el código literal
  - _describeCancelError(status, data) — 400/404/409/422 y genérico "La cancelación falló con HTTP <status>"; el message del proveedor citado tal cual, nunca interpretado
  - createAxiosResponse(status, data, headers) en tests/helpers/fakes.js con headers en minúsculas
affects: [02-04, fase-3]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Clasificación por señal estable, nunca por texto: el cálculo ramifica por data.code y la cancelación por status; el message del proveedor sólo se cita entre comillas (_quoteProviderMessage). Gate de grep que prohíbe message.includes/indexOf/match/search/startsWith/test y `.message === '…'` fuera de comentarios"
    - "El identificador del proveedor se extrae de una sola vía por respuesta (cuerpo antes que header) y de los headers se lee únicamente x-request-id: nunca se serializa el objeto headers ni response.config/error.config"
    - "Lo que se imprime en consola se filtra (sin docs_url) sin tocar lo que se devuelve: _withoutDocsUrl es una copia superficial para la traza y el molde; response.data va intacto al manejador y al archivo (SAFE-04 conservado)"
    - "Los errores propios que caen en el catch del molde van marcados (providerResponded/providerRequestId) para que _handleError distinga 'el proveedor respondió con 4xx' de 'no respondió' sin leer el texto del mensaje"
    - "Prueba de texto engañoso como definición del requisito: code y message invertidos entre sí, y el mismo message bajo dos status en la cancelación; validada por mutación con el gate de grep disparándose sobre el mutante"

key-files:
  created: []
  modified:
    - src/api/synexusApiClient.js
    - tests/helpers/fakes.js
    - tests/synexusApiClient.test.js
    - tests/v2QuoteEndToEnd.test.js
    - tests/v2CancelEndToEnd.test.js
    - .claude/agents/nexgen-explorer.md
    - .claude/commands/tax-quote.md
    - .claude/commands/tax-commit.md
    - .claude/commands/tax-cancel.md

key-decisions:
  - "docs_url se quita también de la traza 'Respuesta del servidor:' y del cuerpo serializado del molde, mediante una copia superficial (_withoutDocsUrl): el plan exigía que NINGUNA línea de consola lo llevara y la traza existente imprimía el cuerpo entero; la respuesta devuelta y escrita sigue intacta"
  - "El sufijo 'Mensaje del proveedor' vive en un helper único (_quoteProviderMessage) que comprueba el tipo sobre una variable local (typeof providerMessage === 'string') y no sobre data.message: el gate de grep del plan captura literalmente `.message === '…'`, y una comprobación de tipo escrita así lo dispararía sin ser una decisión por texto"
  - "_describeCalculationError conserva el parámetro status de la interfaz del plan aunque no clasifique por él (lo hace data.code): el 02-04 envuelve estas firmas y la simetría con _describeCancelError se documenta en el JSDoc"
  - "El texto engañoso también se prueba en el sentido contrario al del plan (mismo code bajo 422 y 400 produce la misma descripción del cálculo; mismo message bajo 404 y 422 produce descripciones distintas de la cancelación): fija que cada endpoint usa SU señal y no la del otro"
  - "Se corrió una tercera mutación en la Task 1 exigida por las guardas del orquestador (el 4xx pierde el request_id del mensaje): 6 casos en rojo, incluido el caso existente del 400 que ahora fija el mensaje exacto"

patterns-established:
  - "Verificación por mutación de la Task 1: header antes que cuerpo en _extractProviderRequestId (3 fallos), nota siempre con la llave propia (6 fallos), 4xx sin request_id en el mensaje (6 fallos)"
  - "Verificación por mutación de la Task 2: invalid_key decidiendo por data.message === 'Invalid API key' (5 fallos y el gate de texto pasa de 0 a 1), cancelación clasificada por data.code al quitar la rama por operación (10 fallos)"

requirements-completed: [SAFE-05, SAFE-06]

# Metrics
duration: 12min
completed: 2026-09-11
---

# Phase 02 Plan 03: El operador sabe por qué falló y tiene el identificador para pedir soporte Summary

**Toda corrida v2 deja registrado el identificador de petición del proveedor —`meta.request_id` del cuerpo, o `X-Request-Id` del header, prefiriendo el cuerpo— en la línea de éxito (`SUCCESS: get_tax - Status: 200 - request_id=…`), en el mensaje lanzado y en el log de winston cuando el proveedor responde con 4xx, y en la consola y el log cuando axios rechaza (5xx o red: ahí queda el `request_id` que generó nexgen, marcado como propio; la cancelación dice "ninguno"). Los errores del cálculo llegan como `Error HTTP <status> (<code>): <qué pasó y qué hacer> - request_id=<id>` decididos por `data.code` con siete mensajes en español y un genérico que conserva el literal; los de cancelación, que no traen `code`, como `Error HTTP <status>: <descripción> Mensaje del proveedor: "<tal cual>" - request_id=<id>` decididos por status. Ninguna rama lee el texto del proveedor (gate de grep en 0), `docs_url` va sólo al log, y de `error.response` sólo se leen `status`, `statusText`, `data` y el header `x-request-id`: el error de axios se sigue re-lanzando por identidad y la llave plantada en `config.headers.Authorization` no llega a stdout, stderr, mensaje ni logger.**

## Performance

- **Duration:** 12 min
- **Started:** 2026-09-11T21:17:12Z
- **Completed:** 2026-09-11T21:30:07Z
- **Tasks:** 2 (las dos TDD: RED → GREEN, cada una con validación por mutación antes del commit GREEN)
- **Files modified:** 9 (5 de código y pruebas, 4 de `.claude/`; los cinco archivos congelados, el manejador, el builder, el validador y `synexusConfig.js` sin un solo cambio en este plan)

## Accomplishments

- **SAFE-06 — el identificador del proveedor, siempre.** `_extractProviderRequestId(response)` lee, en este orden, `data.meta.request_id` (cuerpo de éxito del cálculo; la cancelación no trae `meta`), `data.request_id` (cuerpo de error del cálculo) y `headers['x-request-id']` (todos los endpoints; axios entrega los nombres en minúsculas), devuelve sólo cadena no vacía o `null`, y tolera `data` nulo o cadena y `headers` ausente. La línea de éxito pasa a `SUCCESS: <op> - Status: <status> - request_id=<id | no informado por el proveedor>`. En el corte de `>= 400`, el mensaje lanzado y la entrada del logger llevan ` - request_id=<id>`, y el `Error` va marcado con `providerResponded = true` y `providerRequestId`. `_handleError(error, url, operation, requestBody)` calcula la nota —`request_id=<id> (del proveedor)` cuando hay `error.response` o la marca; `request_id=<uuid> (generado por nexgen; el proveedor no respondió)` cuando el cuerpo enviado trae `request_id`; `request_id=ninguno (la cancelación no lleva llave y el proveedor no respondió)` en otro caso—, la imprime como `Identificador para soporte: …` al final del bloque de diagnóstico (después de `Timestamp:`) y la lleva en `detailedLog`. Los casos existentes se actualizaron, no se borraron: "con 200 devuelve…" y "con 400 lanza…" fijan ahora las cadenas exactas con `request_id=no informado por el proveedor`; "ECONNREFUSED…" conserva una sola entrada del logger.
- **SAFE-05 — clasificación por código estable, nunca por el texto.** `_describeCalculationError(status, data, headers)` es una cadena de `if` por `data.code`: `invalid_key` (nombra `SYNEXUS_API_KEY` y `SYNEXUS_BASE_URL`), `tax_code_missing`, `idempotency_key_conflict` ("No se reintenta; requiere revisión humana"), `invoice_stale_object` (concurrencia; "Vuelva a ejecutar"), `rate_limited` (lee SÓLO el header `retry-after`: "Reintente en 30 segundos" o "en unos segundos"), `cart_empty`, `validation_error` (`details[]` unidos con `'; '`: cadenas tal cual, objetos con `JSON.stringify`, o "sin detalles") y el genérico `El proveedor devolvió el código "<code>".` `_describeCancelError(status, data)` ramifica por status 400/404/409/422 con el genérico `La cancelación falló con HTTP <status>.`; un `code` en un cuerpo de cancelación se ignora. Las dos añaden ` Mensaje del proveedor: "<message>"` cuando es cadena, vía `_quoteProviderMessage`, citándolo y sin interpretarlo. En `_handleResponse`: `cancel_tax` → `Error HTTP <status>: <descripción>`; cálculo con `code` cadena → `Error HTTP <status> (<code>): <descripción>`; sin `code` → el molde de v1 (cuerpo serializado). Siempre con `request_id=`, marcas y `docs_url` sólo al log. Comentarios en español sobre los dos 409 de semántica opuesta (el 02-04 ramifica el reintento por ese mismo `code`) y sobre por qué está prohibido ramificar por el texto.
- **La prueba que define el requisito.** `{ code: 'tax_code_missing', message: 'Invalid API key' }` se clasifica como `tax_code_missing` (contiene `tax_code`, no `SYNEXUS_API_KEY`, y el texto engañoso aparece sólo citado); `{ code: 'invalid_key', message: 'tax_code missing on line 1' }` como `invalid_key`. En la cancelación, el MISMO `message` bajo 404 y bajo 422 produce descripciones distintas, y `code: 'invalid_key'` en un cuerpo de cancelación no produce `SYNEXUS_API_KEY`. Un cuerpo que no es objeto (HTML de un proxy) también se clasifica por status sin lanzar por el acceso.
- **Sin fugas nuevas, con prueba.** `expectNoLeakAnywhere` extiende `expectNoCredentialLeak` de la Fase 1 al mensaje lanzado y al logger, y corre sobre: 503 rechazado por axios con `x-request-id` y `config.headers.Authorization` poblado; `ECONNABORTED` con la llave propia; y una respuesta RESUELTA de 4xx que trae `config.headers.Authorization` y `request._header` con la llave (forma real de axios). `docs_url: 'https://docs.invalid/x'` aparece en el logger y en ninguna línea de consola ni en el mensaje, tanto en el molde como en un error clasificado. Gates: texto = 0, serialización (`response.config|response.request|error.config|error.toJSON|JSON.stringify(error)`) = 0, `JSON.stringify` sobre headers = 0, `await axios(` = 1 (sin reintento: es el 02-04).
- **Recorridos con el grafo real.** Cotización y confirmación afirman `SUCCESS: <op> - Status: 200 - request_id=e2e-rid-0001` (de `meta.request_id`); la cancelación `… - request_id=rid-cancel-ok` (del header). El 422 de la cotización alimenta `{ code: 'tax_code_missing', message: 'tax_code is required', request_id: 'rid-422' }` y afirma `Error HTTP 422 (tax_code_missing): `, el mensaje citado, `request_id=rid-422` en el mensaje y en alguna entrada del logger, sin archivo y sin llave; `post_tax` con 401 `invalid_key` lanza con `(invalid_key)` y `SYNEXUS_API_KEY`; la cancelación con 404 `{ error, message }` y `x-request-id: rid-cancel-404` lanza con `no existe`, `Invoice not found` y `request_id=rid-cancel-404`, contra la URL de cancelación, sin archivo. El error de transporte con `config` afirma además `generado por nexgen` y el `request_id` que salió en `axios.mock.calls[0][0].data.request_id` en el logger y en la consola.
- `npm test`: 11 suites, **431 casos** (367 previos + 25 SAFE-06 en el cliente + 3 recorridos SAFE-06 + 34 SAFE-05 en el cliente + 2 recorridos SAFE-05 nuevos; el 422 existente se actualizó), código de salida 0, sin `.env`, sin red.

## Task Commits

Each task was committed atomically (TDD: RED → GREEN):

1. **Task 1: SAFE-06 — el identificador de petición del proveedor queda registrado en toda corrida**
   - RED `4423a8e` (test) — 29 casos en rojo (línea de éxito sin id, nota inexistente, mensaje del 4xx sin id); los 2 nuevos que pasaban describen comportamiento que no cambia (retorno de `response.data` por identidad; sin fuga con `response.config`)
   - GREEN `2ddcd1c` (feat) — `src/api/synexusApiClient.js`
2. **Task 2: SAFE-05 — los errores del cálculo se clasifican por código estable y los de cancelación por status**
   - RED `0f1c189` (test) — 30 casos en rojo; los 7 nuevos que pasaban son guardas o comportamiento sin cambio (molde sin `code`, sin `undefined`, sin fuga, `docs_url` al log ya desde la Task 1)
   - GREEN `b3560a7` (feat) — `src/api/synexusApiClient.js`
3. **Documentación exigida por CLAUDE.md** — `6e16d49` (docs) — `.claude/agents/nexgen-explorer.md`, `.claude/commands/tax-quote.md`, `.claude/commands/tax-commit.md`, `.claude/commands/tax-cancel.md`

**Plan metadata:** ver commit `docs(02-03)` al final de este plan.

## Files Created/Modified

- `src/api/synexusApiClient.js` — `_extractProviderRequestId`, `_withoutDocsUrl`, `_describeCalculationError`, `_describeCancelError`, `_quoteProviderMessage` antes de `_handleResponse`; `_handleResponse` con línea de éxito, corte de 4xx clasificado, marcas y `docs_url` al log; `_handleError` con `requestBody` y la nota de soporte; `makeRequest` pasa `requestBody` al `catch` y sigue llamando a axios una sola vez. Comentario de CFG-05 ampliado: de `error.response` sólo `status`, `statusText`, `data` y `headers` (y de éstos sólo `x-request-id`); `requestBody` no lleva credencial y se usa sólo para su `request_id`. `_resolveUrl`, los tres envoltorios y la llamada a axios sin cambios.
- `tests/helpers/fakes.js` — `createAxiosResponse(status, data, headers)` con `headers || {}` y JSDoc (nombres en minúsculas, como los entrega axios). Los usos existentes no cambian.
- `tests/synexusApiClient.test.js` — 642 → 1378 líneas. Describe "SAFE-06 …" (25 casos en cuatro grupos: línea de éxito, 4xx resuelto, sin respuesta, 5xx rechazado) con `runResolved`/`runRejected`/`supportLine`/`loggerOutput`/`expectNoLeakAnywhere` en sitio; describe "SAFE-05 … cálculo" (23 casos: `it.each` de los siete códigos, `retry-after`, `details[]`, código desconocido, molde sin `code` y con `code` numérico, mensaje citado, sin `message`, sin fuga, `docs_url`, y los tres de texto engañoso); describe "SAFE-05 … cancelación" (11 casos: `it.each` de los cuatro status, 418, mismo `message` bajo dos status, sin `undefined`, `code` ignorado, sin `message`, cuerpo HTML, sin fuga). Cabecera actualizada.
- `tests/v2QuoteEndToEnd.test.js` — `createProviderResponse` con `meta.request_id: 'e2e-rid-0001'`; un `it` de línea de éxito en cotización y otro en confirmación; el caso de transporte afirma la llave propia en logger y consola; el 422 pasa a clasificado con `rid-422`; nuevo caso `post_tax` + 401 `invalid_key`.
- `tests/v2CancelEndToEnd.test.js` — el caso feliz alimenta `x-request-id: 'rid-cancel-ok'` y afirma la línea de éxito; nuevo describe con el 404 clasificado y `rid-cancel-404`; cabecera con el punto SAFE-05/SAFE-06.
- `.claude/agents/nexgen-explorer.md`, `.claude/commands/tax-quote.md`, `.claude/commands/tax-commit.md`, `.claude/commands/tax-cancel.md` — ver Deviations.

## Decisions Made

- **`docs_url` fuera de toda la consola, no sólo del mensaje.** El plan pedía que ninguna línea de consola llevara `docs.invalid`, pero la traza `Respuesta del servidor:` (heredada del molde) imprime el cuerpo entero y el molde sin `code` lo serializa en el mensaje. `_withoutDocsUrl` devuelve una copia superficial sin esa llave sólo para lo que se imprime; `response.data` llega intacto al manejador y al archivo (SAFE-04 y el gate de `parseFloat`/`Number(` siguen en 0 y en verde).
- **La comprobación de tipo del `message` sobre una variable local.** `typeof data.message === 'string'` contiene literalmente `.message === '`, que el gate de grep del plan captura aunque sea una comprobación de tipo. `_quoteProviderMessage` lee `data.message` a `providerMessage` y comprueba el tipo sobre ésta: el gate queda en 0 sin debilitarlo (sigue disparándose sobre cualquier comparación con el texto, como demostró el mutante C).
- **`status` se conserva en `_describeCalculationError`** aunque no clasifique: la firma es la de `<interfaces>` y el 02-04 la envuelve; el JSDoc lo dice.
- **Pruebas en el sentido inverso al del plan** (mismo `code` bajo dos status; mismo `message` bajo dos status) para fijar que cada endpoint usa su señal y sólo la suya.
- **Tercera mutación en la Task 1** (4xx sin `request_id` en el mensaje) porque las guardas del orquestador la exigían: 6 en rojo.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - CLAUDE.md] Comandos y explorador de `.claude/` describían el camino v2 sin el `request_id` ni el formato clasificado de los errores**
- **Found during:** Cierre del plan, antes del SUMMARY
- **Issue:** `CLAUDE.md` exige revisar `.claude/agents/` y `.claude/commands/` cuando cambia el código que referencian. Las notas de contrato v2 de `/tax-quote`, `/tax-commit` y `/tax-cancel` no mencionaban que la línea de éxito lleva `request_id` ni que los 4xx llegan como `Error HTTP <status> (<code>): … - request_id=<id>` (cálculo) o clasificados por status citando al proveedor (cancelación); `/tax-commit` decía "show the full server message from the `_handleError` output" sin indicar que bajo v2 el mensaje ya nombra `code` y `request_id`, ni que un `409 idempotency_key_conflict` no se vuelve a correr a ciegas; `nexgen-explorer.md` trazaba el cliente v2 sin la clasificación ni la nota de soporte.
- **Fix:** Sólo se añadieron las frases que faltaban en cada nota de contrato y en el modelo de error del explorador. Nada de lo existente quedaba falso (los comandos describen v1 por omisión). Ningún archivo de `src/` ni de `tests/` tocado en este commit.
- **Files modified:** `.claude/agents/nexgen-explorer.md`, `.claude/commands/tax-quote.md`, `.claude/commands/tax-commit.md`, `.claude/commands/tax-cancel.md`
- **Verification:** `git diff --stat` del commit: 4 archivos, 28+/8−; `npm test` sin cambios (431/431).
- **Committed in:** `6e16d49`

**2. [Rule 2 - Correctness] `docs_url` también se filtra de la traza `Respuesta del servidor:` y del cuerpo serializado del molde**
- **Found during:** Task 1 (al escribir la prueba "docs_url … NINGUNA línea de consola")
- **Issue:** El plan fija que `docs_url` va sólo al log (T-02-03-04), pero el `_handleResponse` heredado del molde imprime el cuerpo entero en consola antes del corte de 400 y, sin `code`, lo serializa en el mensaje: la prueba exigida por el plan no podía pasar sin tocar esas dos salidas.
- **Fix:** `_withoutDocsUrl(data)` (copia superficial sin `docs_url`, sólo para la traza y el molde). La respuesta devuelta y escrita no cambia.
- **Files modified:** `src/api/synexusApiClient.js`
- **Verification:** Caso "docs_url del cuerpo de error va al logger de winston y a NINGUNA línea de consola" (molde) y "docs_url del cuerpo clasificado …" (Task 2); `tests/v2ResponseFidelity.test.js` con el `FileManager` real sigue en verde.
- **Committed in:** `2ddcd1c`

---

**Total deviations:** 2 auto-fixed (Rule 2, una por `CLAUDE.md` y una de corrección exigida por el propio `<behavior>` del plan).
**Impact on plan:** Ninguna sobre el alcance ni la superficie pública. `_extractProviderRequestId(response)`, `_describeCalculationError(status, data, headers)`, `_describeCancelError(status, data)`, `_handleError(error, url, operation, requestBody)`, la línea de éxito, los formatos de mensaje y las marcas `providerResponded`/`providerRequestId` son exactamente los de `<interfaces>`. `_withoutDocsUrl` y `_quoteProviderMessage` son helpers privados adicionales.

## Issues Encountered

- **Denegación de permisos del entorno en la corrida de humo.** Se intentó una corrida con el `index.js` real contra un servidor HTTP local efímero (en `/tmp`, con un 422 clasificado y un 404 de cancelación con `X-Request-Id`) para ver la salida tal como la verá el operador. La herramienta denegó el comando, como en 02-02. **No se rodeó.** Cobertura equivalente: los tres recorridos (`v2QuoteEndToEnd`, `v2CancelEndToEnd`, `v2ResponseFidelity`) arman el grafo real a mano como `index.js` (congelado y sin cambios desde `4d6d438`) con sólo axios y —en los dos primeros— `FileManager` sustituidos, y fijan las cadenas exactas de la línea de éxito y de los mensajes clasificados. Queda como acción opcional del usuario: `node index.js get_tax <archivo-v2>.json --api-version=v2 --entity=USA` contra staging debería terminar en `SUCCESS: get_tax - Status: 200 - request_id=<uuid>` o en `Error HTTP <status> (<code>): … - request_id=<id>` seguido del bloque de diagnóstico con `Identificador para soporte: request_id=<id> (del proveedor)`.
- **Títulos de las tablas `it.each` corregidos antes del commit RED:** la primera redacción tenía más marcadores `%i`/`%s` que argumentos y Jest imprimía `NaN` y `%s` en los nombres; se dejaron tres marcadores para tres argumentos (y dos para dos). Sin efecto sobre las aserciones.
- **Casos que pasaban en RED, todos previstos:** Task 1, 2 de 28 nuevos; Task 2, 7 de 37 nuevos/actualizados (ver Task Commits).
- **`.claude/settings.json` modificado y `postman/` sin rastrear desde antes de la ejecución.** No se tocaron ni se incluyeron en ningún commit.

## TDD Gate Compliance

- Task 1: `test` `4423a8e` → `feat` `2ddcd1c`. Cumplido.
- Task 2: `test` `0f1c189` → `feat` `b3560a7`. Cumplido.
- Sin commits `refactor`: no hubo limpieza posterior.

## Known Stubs

None. Ningún valor vacío fluye a la salida: `_extractProviderRequestId` devuelve `null` y la salida lo dice en palabras ("no informado por el proveedor"); ningún `TODO`/`FIXME`/placeholder en los archivos tocados; los cuerpos de error de las pruebas son dobles con la forma de `02-CONTEXT.md`, no datos de producción.

## Threat Flags

None. Toda la superficie tocada está en el `<threat_model>` del plan y cada mitigación tiene su prueba: T-02-03-01 (sólo `status`/`statusText`/`data`/`headers` de la respuesta; gate de serialización en 0; `expectNoLeakAnywhere` sobre 4xx resuelto con `config`, 5xx rechazado y `ECONNABORTED`), T-02-03-02 (ramificación por `data.code` y por status; prueba de texto engañoso; gate de texto en 0 y disparándose sobre el mutante), T-02-03-03 (`request_id` en éxito, mensaje, log y nota de soporte; el propio de nexgen sin respuesta), T-02-03-04 (`docs_url` sólo al log, con barrido de consola y de mensaje). T-02-03-05 y T-02-03-06 se aceptan con su razón en el plan; el 429 informa `Retry-After` y no se reintenta aquí (sin reintento en este plan: `await axios(` aparece una vez).

## User Setup Required

None - no external service configuration required. La suite y las mutaciones no necesitan `.env`, red ni credenciales. Sigue pendiente `.env.example` (plan 01-02, bloqueado por permisos del proyecto).

## Needs your decision

Ninguna. La única denegación de permisos (corrida de humo) no bloquea el plan; ver Issues Encountered.

## Next Phase Readiness

- **Para 02-04 (reintento único):** `makeRequest` sigue llamando a axios exactamente una vez; el reintento debe envolver esa llamada sin tocar `_handleResponse`/`_handleError`. Para decidir si reintentar, dispone de `error.code` (`ECONNABORTED`), `error.response.status` (502/503/504) y —para el 409 del cálculo— `response.data.code` (`invoice_stale_object` sí, `idempotency_key_conflict` nunca): el cliente ya distingue los dos por `code` y el comentario de `_describeCalculationError` lo deja escrito. Un 4xx resuelto llega al `catch` como `Error` propio con `providerResponded = true`; un 5xx llega como error de axios con `response`. El mismo cuerpo (y por tanto el mismo `request_id`) está a mano en el `catch` porque ya se pasa a `_handleError`. `createAxiosResponse` acepta headers, útil para simular `Retry-After` o `X-Request-Id` en el segundo intento.
- **Para la Fase 3:** el procedimiento de staging puede citar textualmente la línea de éxito y los formatos de error; el operador debe copiar el `request_id` de la línea `Identificador para soporte:` (o del mensaje) al levantar soporte. El `RUNBOOK.md` del repositorio sigue sin documentar v2 (diferido a la Fase 3 en `02-CONTEXT.md`).
- **Punto abierto sin cambio:** el nombre real del header del proveedor se asume `X-Request-Id` según la referencia de API; axios lo entrega como `x-request-id`. Si staging lo devolviera con otro nombre, la línea de éxito diría "no informado por el proveedor" sin fallar: la Fase 3 lo verá en la primera corrida.

---
*Phase: 02-confirmar-cancelar-y-devolver-la-respuesta-ntegra*
*Completed: 2026-09-11*

## Self-Check: PASSED

Archivos modificados (9/9 más este resumen) y commits de tarea (5/5) verificados en disco y en `git log`. `npm test`: 431/431, código de salida 0, sin `.env`, sin red.
