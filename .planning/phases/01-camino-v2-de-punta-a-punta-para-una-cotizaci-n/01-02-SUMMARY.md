---
phase: 01-camino-v2-de-punta-a-punta-para-una-cotizaci-n
plan: 02
subsystem: config
tags: [cli, config, contract-selector, safe-03, key-masking, entity-precedence, tdd]

# Dependency graph
requires:
  - phase: 01-01
    provides: Jest con aislamiento de red y credenciales, dobles en tests/helpers/fakes.js, congelamiento de v1
provides:
  - SynexusConfig (clase, no instancia) con frenos de arranque: variables requeridas de v2 y correspondencia llave↔host
  - Selector de contrato: Config.getApiVersion() + TaxCommandHandler.resolveApiVersion (estático) + flags --api-version= y --entity=
  - execute() ramificado por contrato ANTES del paso 5 de v1; rama _executeV2 que valida y sanea por separado, resuelve entidad, imprime perfil y termina en la guardia de cableado
  - index.js construye SynexusConfig sólo cuando el contrato resuelto es v2 y la inyecta como sexto argumento
  - Doble de Config con getApiVersion => 'v1' por omisión
affects: [01-03, 01-04, fase-2, fase-3]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Configuración v2 exporta la CLASE y se construye sólo bajo v2: el require es inocuo para v1"
    - "Frenos en el constructor de la configuración, no antes de cada petición"
    - "Selector que afirma v2 con === y cae en v1 en cualquier otro caso (molde isTestMode)"
    - "Flags --nombre=valor retirados antes de contar posicionales; flag desconocido lanza, nunca cae en v1 en silencio"
    - "Ramificación por contrato antes de la validación; la rama v2 llama métodos del validador por separado, nunca el agregador"
    - "Guardia de cableado permanente en la rama v2 (no es andamio)"
    - "Capa de configuración falla con console.error + throw (sin logger, que se construye después)"

key-files:
  created:
    - src/config/synexusConfig.js
    - tests/synexusConfig.test.js
    - tests/argumentParsing.test.js
    - .planning/phases/01-camino-v2-de-punta-a-punta-para-una-cotizaci-n/deferred-items.md
  modified:
    - src/config/index.js
    - src/cli/taxCommandHandler.js
    - index.js
    - tests/helpers/fakes.js

key-decisions:
  - "_maskApiKey devuelve *** también cuando la llave mide exactamente prefijo + 4: con esa longitud la máscara revelaría la llave entera"
  - "parseArguments delega en el método estático resolveApiVersion en vez de duplicar la validación del flag: un solo punto de verdad para index.js y para el manejador"
  - "El doble de Config (tests/helpers/fakes.js) gana getApiVersion => 'v1' como valor por omisión: el doble debe reflejar la superficie pública real, y así las pruebas de congelamiento de v1 siguen verdes sin tocarlas"
  - "printProfile imprime la URL base completa como host (contiene el hostname y es lo que el operador compara contra su .env)"
  - "El mensaje de CFG-04 nombra sólo el .env de la raíz: no señala .env.example porque ese archivo no pudo crearse"

patterns-established:
  - "Verificación de fuga por barrido: la prueba recorre todos los argumentos capturados de console.log y afirma que ninguno contiene la llave completa"
  - "Prueba de ramificación con el validador REAL y jest.spyOn de paso: los ceros y unos de llamadas prueban la regla, no un doble"
  - "Prueba de orden con mock.invocationCallOrder (printProfile después de resolveEntityCode)"

requirements-completed: [CFG-03, CONN-04, CONN-05, CFG-01, CFG-02, CFG-04, CFG-05, SAFE-03, TEST-05, COMP-04]

# Metrics
duration: 16min
completed: 2026-09-10
---

# Phase 01 Plan 02: Selector de contrato y frenos de arranque de v2 Summary

**`node index.js get_tax archivo.json` sigue cayendo en v1 sin necesitar ni una variable de v2 y con su secuencia de validación intacta; `--api-version=v2` o `TAX_API_VERSION=v2` ramifica antes de la validación de `Committed`, construye `SynexusConfig` —que aborta en el constructor si faltan variables o si la llave no corresponde al host—, resuelve la entidad por precedencia, imprime el perfil con la llave enmascarada y se detiene en la guardia de cableado, todo sin tocar `taxApiClient.js` ni `taxValidator.js`.**

## Performance

- **Duration:** 16 min
- **Started:** 2026-09-10T20:37:56Z
- **Completed:** 2026-09-10T20:54:00Z
- **Tasks:** 2 (ambas TDD: RED → GREEN)
- **Files modified:** 8 (4 creados, 4 modificados)

## Accomplishments

- **v1 no se movió.** `git diff --stat src/api/taxApiClient.js` y `src/validators/taxValidator.js` vacíos; `src/config/index.js` sólo suma líneas (`git diff | grep -c "^-"` = 0); las dos líneas de los pasos 5 y 6 de `execute()` sobreviven con su texto, sólo cambian de sangría; `tests/v1Freeze.*` verdes sin modificación. Comprobado además con el CLI real: sin flags y sin variables `SYNEXUS_*`, `get_tax` toma v1 y falla con el mensaje v1 de siempre.
- **La ramificación ocurre antes de la validación.** `awk` confirma que la llamada a `_executeV2` precede al paso 5 de v1; el cuerpo de `_executeV2` tiene 0 menciones a `validator.validate(`/`validateCommittedField` y exactamente 2 a `validateRequestBody`/`sanitizeStringFields`. Con el `TaxValidator` real: bajo v1 un cuerpo v2 (sin `Committed`) se rechaza con el mensaje literal; bajo v2 el mismo cuerpo pasa la rama con cero llamadas a `validate`.
- **Los cuatro abortos de arranque funcionan y se ven.** Variables faltantes (nombra cuáles y el `.env`), prefijo desconocido (nombra los dos aceptados), llave↔host cruzados (nombra prefijo y ambos hosts, nunca la llave), entidad sin vía (nombra las tres). Todos por `console.error` + `throw`, atrapados en `index.js` con salida 1.
- **La llave nunca sale completa.** Perfil `contrato: v2 | host: … | entidad: … | llave: synexus_test_...0000` en una línea; prueba que barre todo `console.log`; barrido adicional sobre stdout+stderr de una corrida real del CLI: 0 ocurrencias.
- `npm test`: 5 suites, **97 casos** (38 previos + 30 de `synexusConfig` + 29 de `argumentParsing`), código de salida 0, sin `.env`, sin red.

## Task Commits

Each task was committed atomically (TDD: RED → GREEN):

1. **Task 1: SynexusConfig — los frenos que corren antes de que exista una petición**
   - RED `2ef7dbd` (test) — 30 casos: variables requeridas, llave↔host, prefijo de marca anterior, URL malformada, `getCalculationUrl`, precedencia de entidad, enmascaramiento y perfil
   - GREEN `cd96501` (feat) — `src/config/synexusConfig.js`
2. **Task 2: El selector de contrato, de la línea de comandos al punto de entrada**
   - RED `8649bab` (test) — 29 casos: `parseArguments`/`resolveApiVersion` y ramificación de `execute()` con el validador real
   - GREEN `4ec2a49` (feat) — `src/config/index.js`, `src/cli/taxCommandHandler.js`, `index.js`, `tests/helpers/fakes.js`
   - FIX `21bf66b` (fix) — el mensaje de CFG-04 deja de señalar `.env.example` (ver Deviations)

**Plan metadata:** ver commit `docs(01-02)` al final de este plan.

## Files Created/Modified

- `src/config/synexusConfig.js` — Clase (no instancia). Constructor: mapa prefijo→host (`synexus_test_`→staging, `synexus_live_`→producción) y ruta `/api/v1/tax_calculations` como propiedades de instancia; luego `_validateRequiredEnvVars` (`SYNEXUS_BASE_URL`, `SYNEXUS_API_KEY`) y `_validateKeyHostMatch` (hostname vía `URL`, envuelto para fallar en español). `getCalculationUrl` sin barra doble ni alias `/calculate`. `resolveEntityCode` por veracidad: `--entity` > `SYNEXUS_ENTITY` > `entity_id`. `_maskApiKey` prefijo + `...` + últimos 4, o `***`. `printProfile` una línea. Comentario de cabecera documentando que no llama a `dotenv` y depende del orden de requires de `index.js`.
- `src/config/index.js` — Sólo agrega `getApiVersion()` (`=== 'v2' ? 'v2' : 'v1'`). `TAX_API_VERSION` aparece únicamente dentro del método.
- `src/cli/taxCommandHandler.js` — Sexto parámetro `synexusConfig`; `this.knownFlags`; `static resolveApiVersion(args, config, logger)`; `parseArguments` en el orden no negociable (flags desconocidos → filtrar posicionales → `length < 2` sobre filtrados → retorno con `apiVersion` y `entityCode`); `execute()` ramifica tras el paso 4 con `let responseData; if (apiVersion === 'v2') {…} else { pasos 5 y 6 intactos }`; `_executeV2` con sus cinco pasos y la guardia permanente sobre `this.synexusApiClient` que señala `index.js`; `showHelp()` documenta los flags.
- `index.js` — `require('./src/config/synexusConfig')` tras `TaxApiClient`; `args` sube antes de la capa CLI; `resolveApiVersion` → `if (apiVersion === 'v2') { synexusConfig = new SynexusConfig(); }` (única ocurrencia, dentro del condicional); pasos renumerados 5-7; el `catch` no cambia.
- `tests/helpers/fakes.js` — `createFakeConfig` gana `getApiVersion: jest.fn(() => 'v1')`.
- `tests/synexusConfig.test.js` — 30 casos en 5 `describe`, con guardado/restauración de `SYNEXUS_*` y spies de consola.
- `tests/argumentParsing.test.js` — 29 casos en 2 `describe`; el segundo usa el `TaxValidator` real espiado y dobles literales para `fileManager`, `apiClient` y `synexusConfig`; comentario en español sobre qué demuestra cada uno de los dos casos clave.
- `.planning/phases/01-…/deferred-items.md` — creado; ver Issues.

## Decisions Made

- **`_maskApiKey` devuelve `***` con `length <= prefix + 4`, no sólo `<`.** Con longitud exacta, "prefijo + últimos cuatro" es la llave entera; ese es precisamente el caso que CFG-05 prohíbe. Hay prueba (`synexus_test_abcd` → `***`).
- **`parseArguments` reutiliza `TaxCommandHandler.resolveApiVersion`** en lugar de re-implementar la lectura del flag: `index.js` y el manejador resuelven el contrato con el mismo código, así no pueden discrepar.
- **El doble de Config gana `getApiVersion`** (ver Deviations). Alternativas descartadas: hacer `parseArguments` tolerante a un `config` sin el método (ocultaría un cableado roto) o tocar la prueba de congelamiento (prohibido).
- **`printProfile` imprime `getBaseUrl()` completo** en el campo `host`. Contiene el hostname y es lo que el operador compara contra su `.env`; el `hostname` puro se usa sólo para la comparación de SAFE-03.
- **El prefijo desconocido se detecta antes de parsear la URL.** Orden del plan: prefijo → host esperado → hostname configurado.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] El doble de Config no conocía `getApiVersion`**
- **Found during:** Task 2 (GREEN)
- **Issue:** `tests/v1Freeze.messages.test.js` construye el manejador con `createFakeConfig()` sin overrides; al hacer que `parseArguments` consulte `config.getApiVersion()`, dos casos de congelamiento fallaban con `TypeError: config.getApiVersion is not a function`. La prueba de congelamiento no puede modificarse.
- **Fix:** `createFakeConfig` incorpora `getApiVersion: jest.fn(() => 'v1')` en sus valores por omisión — el doble debe reflejar la superficie pública real de `Config`, y `'v1'` es exactamente lo que devuelve el `Config` real con `TAX_API_VERSION` ausente (como la deja `tests/setup.js`).
- **Files modified:** `tests/helpers/fakes.js` (no listado en `files_modified` del plan)
- **Verification:** `tests/v1Freeze.messages.test.js` y `tests/v1Freeze.wire.test.js` verdes sin cambios; `npm test` 97/97.
- **Committed in:** `4ec2a49`

**2. [Rule 1 - Bug] El mensaje de CFG-04 señalaba `.env.example`, que no existe en el repo**
- **Found during:** cierre del plan, al no poder crear `.env.example` (ver abajo)
- **Issue:** El mensaje de variables faltantes decía "(vea .env.example)". Con el archivo ausente, apuntaría al operador a algo que no existe.
- **Fix:** El mensaje nombra sólo el `.env` de la raíz, que es lo que exige el criterio de éxito.
- **Files modified:** `src/config/synexusConfig.js`
- **Verification:** la prueba "el mensaje dice dónde ponerlas: el archivo .env de la raíz" sigue verde.
- **Committed in:** `21bf66b`

### Not Completed — Requires User Action

**3. `.env.example` no pudo crearse.** La configuración de permisos del proyecto (`.claude/settings.json`) niega `Read`, `Edit` y `Write` sobre `./.env.*`, y el sistema de permisos también negó la escritura por shell. Es una decisión del dueño del repositorio sobre esa familia de archivos y **no se rodeó** (ni con otro nombre ni con copia desde `/tmp`). El artefacto queda pendiente; el contenido propuesto está en *User Setup Required*. Ningún requisito depende de él (CFG-04 se cumple con el mensaje de error), pero el criterio de aceptación "`.env.example` existe" **no se cumple**.

---

**Total deviations:** 2 auto-fixed (1 × Rule 3, 1 × Rule 1) + 1 artefacto bloqueado por permisos.
**Impact on plan:** Los auto-fixes son de corrección, sin ampliar alcance. El artefacto faltante es documentación ejecutable, no código: el camino v2 arranca, valida y anuncia igual sin él.

## Issues Encountered

- **`.claude/agents/nexgen-explorer.md` y `.claude/commands/tax-*.md` describen sólo el ciclo v1.** Siguen siendo exactos para el camino por omisión, y actualizarlos ahora documentaría una rama v2 que aún termina en la guardia de cableado. Registrado en `deferred-items.md` para hacerse al cerrar el plan 01-04.
- **Pruebas que pasaban en RED de la Task 2 (5 de 29).** Eran las que congelan lo que NO debe cambiar (posicionales, secuencia v1, rechazo v1 con cuerpo v2) más el caso del cuerpo `null` bajo v2, cuyo mensaje coincide con el que v1 ya produce. Se revisaron una por una antes de seguir a GREEN: ninguna indicaba funcionalidad preexistente; la aserción discriminante de cada una (cero llamadas a `resolveEntityCode`, etc.) sólo cobra sentido con la rama v2 presente.

## Known Stubs

- `this.synexusApiClient` nunca se asigna en este plan: `_executeV2` termina siempre en la guardia de cableado ("Falta inyectar el cliente v2 … Revise el cableado de index.js"). **Es intencional y está previsto**: el plan 01-04 agrega el octavo parámetro del constructor y la llamada a `makeRequest` después de la guardia, que se queda como defensa permanente. No es un dato vacío que fluya a ninguna salida.

## User Setup Required

**`.env.example` debe crearse a mano** (o relajarse la regla `Write(./.env.*)` en `.claude/settings.json` para que un agente pueda hacerlo). Contenido propuesto, sin valores reales:

```dotenv
# .env.example — plantilla de configuración de nexgen.
# Copie este archivo a .env en la raíz del proyecto y complete los valores.
# .env está en .gitignore: nunca lo suba al repositorio ni pegue aquí valores reales.

# ---------------------------------------------------------------------------
# Contrato v1 (Azure Function STCCalcV3) — obligatorias SIEMPRE
# El constructor de src/config/index.js aborta si falta alguna de las tres.
# ---------------------------------------------------------------------------
# URL base de la API v1, con barra final (ej. https://<host>/api/)
BASE_URL=
# Código de autenticación; viaja como ?code= en la URL de STCCalcV3
API_CODE=
# Directorio donde se escriben los archivos RESPONSE_<nombre>.json
OUTPUT_DIR=
# Opcional. true apunta a STCCalcV3_TEST en vez de STCCalcV3; ausente equivale a false.
# cancel_tax lo ignora y siempre va a CancelTransaction.
TEST_MODE=

# ---------------------------------------------------------------------------
# Selector de contrato
# ---------------------------------------------------------------------------
# Valores: v1 | v2. Ausente, vacío o cualquier otro valor equivale a v1: el
# envoltorio del ERP invoca `node index.js get_tax <archivo>` sin flags y debe
# seguir cayendo en v1. Revertir producción a v1 es cambiar esta línea, sin
# desplegar código. El argumento --api-version=<v1|v2> de la línea de comandos
# sobreescribe esta variable para pruebas puntuales.
TAX_API_VERSION=v1

# ---------------------------------------------------------------------------
# Contrato v2 (Synexus Compute) — obligatorias SÓLO cuando el contrato es v2
# Se validan al arrancar una corrida v2; una corrida v1 nunca las lee.
# ---------------------------------------------------------------------------
# Host del proveedor. Sólo el host va aquí: la ruta /api/v1/tax_calculations la
# pone el código.
#   Staging:    https://compute.staging.synexustax.com
#   Producción: https://compute.synexustax.com
SYNEXUS_BASE_URL=https://compute.staging.synexustax.com
# Llave portadora (Authorization: Bearer). Su prefijo debe corresponder al host:
# synexus_test_ sólo con staging y synexus_live_ sólo con producción. Si no
# corresponden, la corrida aborta antes de emitir petición alguna.
SYNEXUS_API_KEY=
# Opcional. Código de entidad (header X-Synexus-Entity). Se resuelve por
# precedencia: el argumento --entity=<codigo> gana sobre esta variable, y esta
# variable gana sobre el campo entity_id del archivo JSON de entrada. Si ninguna
# de las tres vías lo provee, la corrida aborta nombrándolas.
SYNEXUS_ENTITY=
```

Verificación tras crearlo: `git check-ignore .env.example` no debe reportar nada (ya comprobado: `.gitignore` no lo cubre).

## Next Phase Readiness

- **Para 01-03:** `_executeV2` está exactamente en la forma que ese plan espera: `validateRequestBody` → `sanitizeStringFields` → `resolveEntityCode` → `printProfile` → guardia. Inserta `getIntentFor → validateV2IntentFields → buildRequestBody` entre `printProfile` y la guardia, y agrega `requestBuilder` como séptimo parámetro del constructor.
- **Para 01-04:** la guardia comprueba `this.synexusApiClient`; el octavo parámetro y la llamada a `makeRequest` van después de ella. `index.js` ya tiene el bloque `if (apiVersion === 'v2') { … }` donde construir el cliente junto a la configuración. `SynexusConfig.getCalculationUrl()`, `getApiKey()` y `getBaseUrl()` están listos para el cliente.
- **Abierto:** `.env.example` (arriba) y la actualización de `.claude/agents` y `.claude/commands` al cerrar 01-04 (`deferred-items.md`).

---
*Phase: 01-camino-v2-de-punta-a-punta-para-una-cotizaci-n*
*Completed: 2026-09-10*

## Self-Check: PASSED

Archivos creados/modificados (9/9) y commits de tarea (5/5) verificados en disco y en `git log`. `.env.example` ausente por diseño del sistema de permisos del proyecto; documentado arriba como acción del usuario, no como omisión.
