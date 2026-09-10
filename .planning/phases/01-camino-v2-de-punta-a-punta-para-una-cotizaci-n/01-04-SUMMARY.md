---
phase: 01-camino-v2-de-punta-a-punta-para-una-cotizaci-n
plan: 04
subsystem: api
tags: [api-client, post, bearer, entity-header, cfg-05, end-to-end, wiring, docs, tdd]

# Dependency graph
requires:
  - phase: 01-01
    provides: Jest con aislamiento de red y credenciales, dobles en tests/helpers/fakes.js, congelamiento de v1
  - phase: 01-02
    provides: SynexusConfig (getCalculationUrl, getApiKey, resolveEntityCode, printProfile), selector de contrato, rama _executeV2 con guardia de cableado
  - phase: 01-03
    provides: SynexusRequestBuilder, validateV2IntentFields, _executeV2 con v2RequestBody construido justo antes de la guardia, séptimo parámetro del manejador
provides:
  - SynexusApiClient (capa API): POST con cuerpo JSON, Authorization: Bearer, X-Synexus-Entity como propiedad de instancia, timeout 30000, _handleError que nunca serializa el error de axios
  - _executeV2 cerrado: la guardia permanece y, pasada, delega en synexusApiClient.makeRequest(operation, cuerpo, entidad); el retorno viaja a _saveResponse
  - index.js construye SynexusApiClient sólo dentro del bloque v2 y lo inyecta como octavo argumento; bajo v1 queda en null
  - tests/v2QuoteEndToEnd.test.js: recorrido completo de los dos contratos con el grafo real y sólo axios sustituido
  - README y .claude/{commands,agents} al día con el selector, las variables de v2, la reversión a v1 y el runner
affects: [fase-2, fase-3]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Cliente v2 copiado del molde congelado con divergencias enumeradas (método, autenticación por header, header de entidad, flecha en validateStatus, sin traza del cuerpo)"
    - "Nombre del header de entidad como propiedad de instancia (entityHeaderName), greppable y sustituible"
    - "En _handleError sólo se leen error.code, error.message, error.response.status y error.response.data; el error de axios nunca se serializa entero"
    - "Prueba de recorrido completo que reproduce a mano el grafo de index.js (que no puede requerirse) con sólo axios sustituido"
    - "La guardia de cableado se conserva tras la inyección y gana su propia prueba con el cliente en null"

key-files:
  created:
    - src/api/synexusApiClient.js
    - tests/synexusApiClient.test.js
    - tests/v2QuoteEndToEnd.test.js
  modified:
    - src/cli/taxCommandHandler.js
    - index.js
    - tests/argumentParsing.test.js
    - tests/v2IntentValidation.test.js
    - README.md
    - .claude/commands/tax-quote.md
    - .claude/commands/tax-commit.md
    - .claude/commands/tax-cancel.md
    - .claude/agents/nexgen-explorer.md
    - .claude/agents/tax-validator-helper.md

key-decisions:
  - "La prueba del 400 acepta dos entradas en el logger: en el molde de v1 el throw de _handleResponse cae en el catch de makeRequest, que además pasa por _handleError; copiar la estructura exacta pesa más que un conteo de llamadas"
  - "Los archivos de prueba de la wave 3 construyen el manejador con ocho argumentos y sus casos de la rama v2 pasan de 'rechaza en la guardia' a 'resuelve y llama al cliente' (orden, identidad del cuerpo, entidad); la guardia conserva una prueba dedicada con null en cada archivo"
  - "Se actualizaron también los dos agentes de .claude/agents (no listados en el plan): CLAUDE.md exige revisarlos cuando cambia el código que referencian y el explorador trazaba sólo validate → apiClient.makeRequest, mientras el ayudante del validador pedía que toda regla nueva fuera alcanzable desde validate(), lo que rompería la rama v2"
  - "La corrida de humo del CLI real se hizo con un preload que bloquea http/https como tests/setup.js: prueba que index.js cablea el cliente y que la guardia se pasa, sin que nada salga a la red ni exista .env"

patterns-established:
  - "Verificación por mutación del cliente v2: imprimir error.config (4 fallos), imprimir headers (6), X-Syntax-Entity (4) y llave en la URL (12) hacen fallar la suite"
  - "Prueba de no filtrado que barre console.log, console.error y logger.error con un error de axios que trae config.headers.Authorization poblado"

requirements-completed: [CONN-01, CONN-02, CONN-03, COMP-04, CFG-05]

# Metrics
duration: 13min
completed: 2026-09-10
---

# Phase 01 Plan 04: El cliente v2, el grafo cerrado y el recorrido completo Summary

**`node index.js get_tax archivo.json --api-version=v2` recorre el camino v2 de punta a punta: `SynexusApiClient` emite un POST con cuerpo JSON contra `<SYNEXUS_BASE_URL>/api/v1/tax_calculations`, con la llave en `Authorization: Bearer` y ninguna credencial en la URL, el código de entidad en `X-Synexus-Entity`, y sin que la llave aparezca en consola ni en el logger ni siquiera cuando axios devuelve su error con la petición entera dentro; la misma invocación sin flags sigue emitiendo el GET de v1 con `STCCalcV3?code=` y sin `Authorization`, demostrado desde el punto de entrada con el `TaxApiClient` real — y `taxApiClient.js` sigue sin un solo cambio.**

## Performance

- **Duration:** 13 min
- **Started:** 2026-09-10T21:15:17Z
- **Completed:** 2026-09-10T21:28:18Z
- **Tasks:** 3 (dos TDD: RED → GREEN; una de documentación)
- **Files modified:** 13 (3 creados, 10 modificados)

## Accomplishments

- **CONN-01 / CONN-02 / CONN-03.** El único argumento que recibe axios lleva `method: 'POST'`, la URL exacta de `getCalculationUrl()` (sin `code=`, `key=`, `token=`, `?` ni subcadena de la llave), `Authorization: Bearer <llave>`, `X-Synexus-Entity: <entidad>` y `Content-Type: application/json` — y **exactamente esos tres headers** (`toEqual` sobre el objeto: un header de idempotencia inventado rompe la prueba). `X-Syntax-Entity` afirmado ausente. Timeout 30000 y `validateStatus(499)/(500)` como v1.
- **CFG-05 en el camino de error.** `_handleError` se copió como cadena lineal de `if`/`else if` y sólo toca `error.code`, `error.message`, `error.response.status` y `error.response.data`; comentario en español explicando que `error.config` lleva la llave. Seis pruebas barren `console.log` + `console.error` + `logger.error` en respuesta 200, 400, 5xx con `config.headers.Authorization` poblado, `ECONNREFUSED` con `config` poblado y error genérico con `config` poblado: la llave nunca aparece, ni la palabra `Bearer`. `grep` de aceptación sobre líneas no comentadas: 0 serializaciones del error.
- **Diagnósticos de v2.** `ECONNREFUSED`, `ECONNABORTED` y `ENOTFOUND` con sus textos en español citando `SYNEXUS_BASE_URL`; la prueba borra esa cadena de la salida y afirma que no queda `BASE_URL` a secas. El error original se re-lanza por identidad (`toBe`).
- **Grafo cerrado en `index.js`.** `require` de `SynexusApiClient` en la capa API; `new SynexusApiClient(synexusConfig, logger)` una sola vez, dentro del `if (apiVersion === 'v2')`; octavo argumento del manejador. `grep` de hermanos de `src/` en las tres clases nuevas: 0 (COMP-04). Un solo `process.exit`, en `index.js`. `require('axios')`: dos, ambos en `src/api/`.
- **La guardia se queda.** Su condición es falsa en operación normal; conserva el mensaje que señala `index.js` y gana una prueba propia con `synexusApiClient: null` en `argumentParsing.test.js` y en `v2IntentValidation.test.js` (recorre hasta construir e imprimir el cuerpo, lanza, no emite ni escribe).
- **Recorrido completo (`tests/v2QuoteEndToEnd.test.js`, 27 casos).** Grafo reproducido a mano: `Config` real, `TaxValidator` real, `TaxApiClient` real, `SynexusConfig` real, `SynexusRequestBuilder` real, `SynexusApiClient` real; sólo axios y `FileManager` sustituidos. Cubre los siete comportamientos del plan más: perfil impreso **antes** de la llamada a axios (`invocationCallOrder`), respuesta escrita por identidad en `RESPONSE_a.json`, `TAX_API_VERSION=v2` sin flags → v2, `=v1` → v1, flag gana sobre variable, `SYNEXUS_ENTITY` gana sobre `entity_id`, `sales_invoice` y `post_tax` bajo v2 abortan sin axios, 422 del proveedor sin archivo y sin fuga, error de transporte con `config` sin fuga.
- **COMP-01 / CFG-03 desde el punto de entrada.** Sin flags y sin `TAX_API_VERSION`: `GET`, `https://ejemplo-v1.invalid/api/STCCalcV3?code=codigo-de-prueba-v1`, headers exactamente `{ Content-Type }`, y `synexusConfig`/`synexusApiClient` en `null` — la configuración v2 ni se construye.
- **Comprobado con el CLI real** (sin `.env`, red bloqueada por un preload idéntico a `tests/setup.js`): v2 con flags imprime perfil enmascarado, cuerpo tipado, `Realizando petición GET_TAX a: https://compute.staging.synexustax.com/api/v1/tax_calculations` y cae en el bloqueo con salida 1 — la guardia ya no dispara, 0 ocurrencias de la llave, 0 de `Bearer`, sin archivo de salida; v1 sin flags imprime la URL `STCCalcV3?code=`; archivo v1 bajo v2 aborta con `parece del contrato v1`; v2 sin variables aborta en el freno de arranque.
- **Documentación.** `README.md` documenta `TAX_API_VERSION` (ausente o distinto de `v2` ⇒ v1), `SYNEXUS_BASE_URL`, `SYNEXUS_API_KEY` con la correspondencia prefijo↔host obligatoria y su aborto al arrancar, `SYNEXUS_ENTITY` opcional con las tres vías en orden, los dos flags con ejemplo, la invocación sin flags en v1, la subsección *Reverting to v1* (una línea de `.env`, sin desplegar), la forma del archivo v2 y *Running Tests* sin "Coming soon". Los tres comandos de `.claude/commands/` llevan la nota de contrato; `tax-quote.md` explica la línea de perfil y que la llave enmascarada es lo correcto. `grep` de llaves con forma real en la documentación: 0.
- `npm test`: 9 suites, **219 casos** (154 previos + 36 del cliente + 27 del recorrido + 2 nuevos en `v2IntentValidation`), código de salida 0.

## Task Commits

Each task was committed atomically (TDD: RED → GREEN):

1. **Task 1: El cliente v2 — POST, header portador y header de entidad**
   - RED `340f83b` (test) — 36 casos: cable, trazas, `_handleResponse`, `_handleError`, no filtrado, `getTax`
   - GREEN `71f8802` (feat) — `src/api/synexusApiClient.js`
2. **Task 2: Cerrar el grafo en el punto de entrada y probar el recorrido completo**
   - RED `993ebe7` (test) — 27 casos de recorrido completo (17 en rojo: los que necesitan el cliente cableado)
   - GREEN `bd825ec` (feat) — `src/cli/taxCommandHandler.js`, `index.js`, `tests/argumentParsing.test.js`, `tests/v2IntentValidation.test.js`
3. **Task 3: Poner al día la documentación que el operador y las herramientas leen**
   - `f08eadc` (docs) — `README.md`, `.claude/commands/tax-*.md`, `.claude/agents/*.md`

**Plan metadata:** ver commit `docs(01-04)` al final de este plan.

## Files Created/Modified

- `src/api/synexusApiClient.js` — 180 líneas. `constructor(synexusConfig, logger)` con `this.timeout = 30000` y `this.entityHeaderName = 'X-Synexus-Entity'`. `makeRequest(operation, requestBody, entityCode)`: URL de `getCalculationUrl()`, traza `Realizando petición …` (segura: sin credencial), `axios({ method: 'POST', url, data, headers: { Content-Type, Authorization: Bearer, [entityHeaderName] }, timeout, validateStatus: (status) => status < 500 })`, `try/catch` que delega en `_handleError` y re-lanza. `_handleResponse` copiado entero (traza de status, cuerpo, corte en 400 con trío `console.error` + `logger.error` + `throw`, log de éxito, `return response.data`). `_handleError` copiado con `SYNEXUS_BASE_URL` en los dos textos que citaban `BASE_URL` y el comentario de CFG-05. `getTax(requestBody, entityCode)` como único envoltorio.
- `src/cli/taxCommandHandler.js` — Octavo parámetro `synexusApiClient` (JSDoc incluido). `_executeV2`: paso 8 (guardia) con comentario actualizado, paso 9 `return await this.synexusApiClient.makeRequest(operation, v2RequestBody, resolvedEntityCode)`. Los pasos 1-7 y `execute()` no cambian.
- `index.js` — `require('./src/api/synexusApiClient')` tras `SynexusRequestBuilder` (capa API, antes de `SynexusConfig`); `let synexusApiClient = null` y construcción dentro del bloque v2; octavo argumento, uno por línea; comentario del paso 5 ampliado. El `catch` no cambia.
- `tests/synexusApiClient.test.js` — 36 casos en 6 `describe`; `createAxiosError` reproduce la forma real del error de axios (`config` con headers, `request`, `response`, `toJSON`); `expectNoCredentialLeak` barre los dos espías de consola.
- `tests/v2QuoteEndToEnd.test.js` — 27 casos en 6 `describe`; `buildGraph(args, requestBody)` reproduce los pasos 1-6 de `index.js`; guarda y restaura `TAX_API_VERSION` y `SYNEXUS_ENTITY`.
- `tests/argumentParsing.test.js` — `buildHandler(requestBody, options)` gana el doble del cliente v2 como octavo colaborador (`options.synexusApiClient` para sustituirlo, `null` para la guardia); el manejador de `parseArguments` se construye con ocho argumentos; los casos de la rama v2 resuelven y afirman `synexusApiClient.makeRequest` una vez y el cliente v1 sin llamadas.
- `tests/v2IntentValidation.test.js` — `buildHandler(requestBody, builderOverrides, options)`; el orden del contrato termina en `makeRequest`; caso nuevo de identidad (`makeRequest('get_tax', builtBody, 'USA')`, `toBe(builtBody)`, respuesta escrita por identidad); caso nuevo de la guardia con `null`; `buildRealHandler` con el doble de `FileManager` completo y el cliente; el caso del builder real afirma que lo emitido es igual a lo impreso.
- `README.md` — Secciones *Environment Configuration*, *Environment Variables Explained*, *Contract flags (v2)*, *Reverting to v1*, *Input File Format* (párrafo v2), *Project Structure* (`tests/`, `jest.config.js`, clases v2) y *Running Tests*.
- `.claude/commands/tax-quote.md`, `tax-commit.md`, `tax-cancel.md` — Nota de contrato bajo el título; `tax-quote` además el paso 1 (bajo v2 el archivo no trae `Committed`), el comando v2 en el paso 2 y la línea de perfil en el paso 3. Metadatos intactos.
- `.claude/agents/nexgen-explorer.md`, `tax-validator-helper.md` — Ver Deviations.

## Decisions Made

- **La prueba del 400 no cuenta llamadas al logger.** Mi primera versión exigía `toHaveBeenCalledTimes(1)`; el molde de v1 lanza desde `_handleResponse` dentro del `try` de `makeRequest`, así que `_handleError` también corre (rama genérica) y el logger recibe dos entradas. Copiar la estructura exacta del análogo es la instrucción del plan; se ajustó la aserción (primera entrada contiene `Error HTTP 400` y `Operation: get_tax`, y `console.error` recibe el mensaje literal) con un comentario que explica el porqué.
- **Los archivos de la wave 3 pasan el octavo argumento y sus casos v2 ahora resuelven.** Alternativa descartada: dejarlos con siete argumentos (la guardia seguiría disparando y las pruebas verdes), porque describirían un manejador que ya no existe en producción. Ninguna aserción se debilitó: las de orden, identidad, "`validate` nunca se llama" y "cliente v1 nunca se llama" se conservan y se les suma la llamada al cliente v2; la guardia conserva su cobertura con `null` explícito.
- **Corrida de humo sin red por preload**, no contra staging con puerto falso: el plan exige que ninguna verificación salga a la red, y un `SYN` a un host real con una llave ficticia ya sería salir.
- **El mensaje de `post_tax`/`cancel_tax` bajo v2 se documenta en sus comandos** como aborto previo a toda petición, en vez de omitirlo: es lo que el operador verá si añade el flag por analogía con `tax-quote`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - CLAUDE.md] Los agentes de `.claude/agents/` describían sólo v1 y uno de ellos prescribía romper la rama v2**
- **Found during:** Task 3
- **Issue:** El plan lista sólo los tres comandos, pero `CLAUDE.md` exige revisar también los subagentes cuando cambia el código que referencian, y `deferred-items.md` (01-02) dejaba el pendiente para el cierre de 01-04. `nexgen-explorer.md` trazaba `validate → apiClient.makeRequest` como única secuencia y un mapa de capas sin las tres clases v2; `tax-validator-helper.md` decía "New checks should be reachable from `validate()`" y "No tests today", lo que llevaría a meter `validateV2IntentFields` en el agregador de v1 (rechazaría todo archivo v2 real) y a inventar otro directorio de pruebas.
- **Fix:** Mapa de capas y ciclo de vida con las dos ramas en el explorador; `validateV2IntentFields` como hermano fuera de `validate()`, invariante v1/v2 y runner existente en el ayudante; redacción de `SYNEXUS_API_KEY` en la regla de no exponer credenciales. Sólo adiciones y reemplazos de las líneas que quedaron falsas; metadatos intactos.
- **Files modified:** `.claude/agents/nexgen-explorer.md`, `.claude/agents/tax-validator-helper.md`
- **Verification:** `git diff` sólo reemplaza las líneas citadas; `git diff --stat src/` vacío en la tarea.
- **Committed in:** `f08eadc`

**2. [Rule 1 - Bug] Aserción de la prueba RED del 400 incompatible con la estructura del molde**
- **Found during:** Task 1 (GREEN)
- **Issue:** Ver Decisions. 35/36 verdes con el cliente correcto; el fallo era de la prueba, no del cliente.
- **Fix:** Aserción ajustada a la estructura copiada, sin cambiar el comportamiento exigido por el plan ("una respuesta 400 lanza con un mensaje que empieza por `Error HTTP 400: `").
- **Files modified:** `tests/synexusApiClient.test.js`
- **Verification:** 36/36; verificación por mutación de las pruebas de fuga, header y URL (ver patterns-established).
- **Committed in:** `71f8802`

---

**Total deviations:** 2 auto-fixed (1 × Rule 2 por `CLAUDE.md`, 1 × Rule 1).
**Impact on plan:** Ninguna sobre el alcance del código. La superficie pública (`SynexusApiClient` con `makeRequest`/`getTax`, octavo parámetro, construcción condicional en `index.js`) es exactamente la del plan.

## Issues Encountered

- **Pruebas que pasaban en RED de la Task 2 (10 de 27).** Los tres casos de v1 (congelan lo que NO debe cambiar), los dos del selector que vuelven a v1, y los cinco abortos anteriores a la guardia (entidad sin vía, `committed: true`, `sales_invoice`, archivo v1, `post_tax`). Revisados uno por uno: ninguno indica emisión v2 preexistente; los 17 que sí la exigen estaban en rojo.
- **`rm -rf` y `ls logs/` denegados por los permisos del proyecto.** Los fixtures de humo se borraron archivo por archivo con `rm` y `rmdir`; la observación sobre `logs/` se registró con la evidencia ya obtenida (ver `deferred-items.md`), sin volver a listar el directorio.
- **`.claude/settings.json` aparece modificado y `postman/` sin rastrear desde antes de la ejecución.** No se tocaron ni se incluyeron en ningún commit.

## Known Stubs

None. `synexusApiClient = null` bajo v1 en `index.js` no es un stub: es el diseño del selector (un servidor sin variables de v2 nunca construye la capa v2) y la guardia de `_executeV2` lo convierte en un mensaje claro si el cableado se rompe. Ningún valor vacío fluye a la salida.

## User Setup Required

None - no external service configuration required. La suite y las corridas de humo no necesitan `.env`. Sigue pendiente `.env.example` (plan 01-02, bloqueado por permisos); su contenido propuesto está en `01-02-SUMMARY.md` y ahora también está reflejado, en inglés, en `README.md`.

## Next Phase Readiness

- **Fase 2 (`post_tax`, `cancel_tax`, fidelidad numérica, escritura):** `SynexusApiClient.makeRequest` ya recibe la operación; `getIntentFor` es el único sitio donde añadir los mapeos nuevos; los envoltorios `postTax`/`cancelTax` se añaden junto a `getTax`. `_handleResponse` devuelve `response.data` sin transformar: la fidelidad numérica (montos como cadenas decimales) se decide ahí o en `_saveResponse`. La clasificación por código estable del proveedor (`SAFE-05`) va en la cadena `if`/`else if` de `_handleError`, que hoy es copia literal de v1.
- **Fase 3 (staging, área de ERP):** el operador tiene en `README.md` qué variables poner, qué imprime la línea de perfil, qué significa la llave enmascarada y cómo revertir. La primera corrida real va a tropezar, si acaso, con la correspondencia prefijo↔host, que está documentada como intencional.
- **Abierto:** `.env.example` (permisos) y la observación sobre `logs/` vacío tras corridas fallidas (`deferred-items.md`, preexistente, fuera de alcance).

---
*Phase: 01-camino-v2-de-punta-a-punta-para-una-cotizaci-n*
*Completed: 2026-09-10*

## Self-Check: PASSED

Archivos creados/modificados (13/13 más este resumen) y commits de tarea (5/5) verificados en disco y en `git log`. `npm test`: 219/219, código de salida 0, sin `.env`, sin red.
