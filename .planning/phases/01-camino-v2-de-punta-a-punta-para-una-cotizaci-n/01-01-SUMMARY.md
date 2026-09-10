---
phase: 01-camino-v2-de-punta-a-punta-para-una-cotizaci-n
plan: 01
subsystem: testing
tags: [jest, v1-freeze, network-isolation, env-isolation, comp-01]

# Dependency graph
requires: []
provides:
  - Runner de pruebas ejecutable con `npm test` (Jest 29.7.0 exacto, devDependency)
  - Aislamiento de la suite en `tests/setup.js`: variables ficticias forzadas y bloqueo de http/https
  - Dobles comunes en `tests/helpers/fakes.js` (createFakeLogger, createFakeConfig, createAxiosResponse)
  - Congelamiento del cable de v1 (método GET, URL resuelta, credencial en query, timeout, corte de status)
  - Congelamiento literal de los mensajes de error de v1 y del parseo posicional del CLI
affects: [01-02, 01-03, 01-04, fase-2, fase-3]

# Tech tracking
tech-stack:
  added: [jest@29.7.0 (devDependency)]
  patterns:
    - "Dobles de prueba como objetos literales (fakes.js), nunca mocks de clases del proyecto"
    - "jest.mock('axios') + axios.mock.calls[0][0] como único punto de intercepción del cable"
    - "toThrow(new Error(msg)) para congelar mensajes con igualdad exacta, no contención"
    - "jest.isolateModules + jest.doMock('dotenv') para recargar el singleton de Config"
    - "Toda prueba restaura process.env en afterEach; setup.js deja SYNEXUS_ENTITY y TAX_API_VERSION ausentes"

key-files:
  created:
    - jest.config.js
    - tests/setup.js
    - tests/setup.test.js
    - tests/helpers/fakes.js
    - tests/v1Freeze.wire.test.js
    - tests/v1Freeze.messages.test.js
  modified:
    - package.json
    - package-lock.json

key-decisions:
  - "Mensajes congelados con toThrow(new Error(msg)): Jest compara por igualdad exacta, mientras toThrow('msg') sólo verifica contención y dejaría pasar cambios sutiles"
  - "parseArguments se afirma por propiedad (operation, filePath), no con toEqual del objeto, para que el plan 02 pueda agregar el selector sin romper el congelamiento"
  - "Las URLs de v1 se congelan con toBe sobre la cadena completa, no con endsWith: fija también la concatenación sin separador de baseUrl"
  - "jest.dontMock('dotenv') además de resetModules en la limpieza: resetModules no borra los registros explícitos de doMock"

patterns-established:
  - "Verificación por mutación: cada prueba de congelamiento se validó alterando temporalmente el código de v1 y confirmando que la suite falla, antes de restaurar"
  - "Ningún archivo de prueba requiere index.js; src/config sólo se requiere porque setup.js ya fijó las variables"

requirements-completed: [TEST-01, TEST-06, COMP-01]

# Metrics
duration: 6min
completed: 2026-09-10
---

# Phase 01 Plan 01: Runner de pruebas y congelamiento de v1 Summary

**Jest 29.7.0 con `npm test` verde en 38 casos, suite aislada de `.env` y de la red, y el camino v1 congelado en método HTTP, URL resuelta, credencial en query string, timeout, corte de status, mensajes de error literales y parseo posicional del CLI — todo verificado por mutación.**

## Performance

- **Duration:** 6 min
- **Started:** 2026-09-10T20:27:38Z
- **Completed:** 2026-09-10T20:33:55Z
- **Tasks:** 3
- **Files modified:** 8 (6 creados, 2 modificados)

## Accomplishments

- `npm test` deja de ser el stub que falla y ejecuta Jest: 3 suites, 38 casos, código de salida 0 (TEST-01).
- La suite corre sin `.env`, sin credenciales y sin red: `tests/setup.js` sobreescribe `BASE_URL`, `API_CODE`, `OUTPUT_DIR`, `TEST_MODE`, `SYNEXUS_BASE_URL` y `SYNEXUS_API_KEY` con valores ficticios y reemplaza `http/https.request` y `.get` por funciones que lanzan `La suite de pruebas no puede salir a la red.` (TEST-06). Se comprobó que una llamada real de axios muere con ese mensaje.
- El camino v1 está congelado (COMP-01): 15 casos en `v1Freeze.wire.test.js` y 12 en `v1Freeze.messages.test.js`. Cada uno se validó por mutación: alterar el método, agregar un header, bajar el timeout, renombrar `STCCalcV3`, meter `?code=` en `cancel_tax`, cambiar un mensaje del validador o del CLI, o invertir los posicionales, hace fallar la suite.
- `src/` no se tocó: `git status --porcelain src/` vacío, `git diff --stat src/api/taxApiClient.js` vacío.

## Task Commits

Each task was committed atomically:

1. **Task 1: Runner de pruebas con aislamiento de red y credenciales** - `b9230e1` (chore)
2. **Task 2: Congelar el cable de v1 — método, URL y autenticación** - `2807c0c` (test)
3. **Task 3: Congelar los mensajes y el parseo posicional de v1** - `b931b0a` (test)

**Plan metadata:** ver commit `docs(01-01)` al final de este plan.

## Files Created/Modified

- `package.json` - `scripts.test` pasa a `jest`; `devDependencies.jest` fijado a `29.7.0` exacto. Las tres dependencias de runtime siguen intactas.
- `package-lock.json` - árbol de Jest; sincronizado con el pin exacto.
- `jest.config.js` - `testEnvironment: 'node'` y `setupFiles: ['<rootDir>/tests/setup.js']`. Nada más.
- `tests/setup.js` - variables ficticias forzadas (no rellenadas) y bloqueo de `http`/`https`. Deja `SYNEXUS_ENTITY` y `TAX_API_VERSION` ausentes a propósito para los planes 02 y 03.
- `tests/setup.test.js` - prueba de humo del aislamiento (11 casos), incluidas las dos aserciones de ausencia que impiden "arreglar" la suite fijando esas variables.
- `tests/helpers/fakes.js` - `createFakeLogger`, `createFakeConfig(overrides)`, `createAxiosResponse(status, data)` como objetos literales; `statusText` derivado de `http.STATUS_CODES`.
- `tests/v1Freeze.wire.test.js` - la llamada a axios leída de `axios.mock.calls[0][0]` (GET, cuerpo en `data`, headers exactamente `{ Content-Type }` vía `toEqual`, timeout 30000, `validateStatus(499)/(500)`), la URL resuelta con el `Config` real (`STCCalcV3`, `STCCalcV3_TEST`, `CancelTransaction` sin `code=`) y el mensaje `Operación inválida: foo` de `Config`.
- `tests/v1Freeze.messages.test.js` - los cuatro mensajes del validador más el hueco de `cancel_tax`, `Error HTTP 400: {"error":"x"}`, el mensaje de uso del CLI con su `\n`, `operation`/`filePath` afirmados por separado, y `Variables de entorno faltantes: ...` recargando `src/config` en `jest.isolateModules` con `dotenv` sustituido.

## Decisions Made

- **`toThrow(new Error(msg))` en vez de `toThrow('msg')`.** El plan pide congelar cadenas "completas y literales". Con una cadena, Jest sólo verifica contención; con una instancia de `Error`, exige igualdad exacta del mensaje. Sin esto, un cambio de sufijo o de puntuación pasaría desapercibido.
- **URLs congeladas con `toBe` sobre la cadena completa**, no con `endsWith` como sugería el plan. Es estrictamente más fuerte y fija también que `baseUrl` se concatena sin separador, que es parte de la URL resuelta.
- **`parseArguments` afirmado por propiedad, con comentario en español** explicando que el plan 02 agrega propiedades al objeto de retorno y un `toEqual` estricto convertiría ese cambio legítimo en un falso positivo.
- **Un caso extra para el separador `, `** en `Variables de entorno faltantes` (con `BASE_URL` y `API_CODE` ausentes). Es el mismo mensaje que COMP-01 protege; con una sola variable faltante el formato del join quedaba sin congelar.
- **Dos aserciones extra en el bloque de axios**: que se invoca exactamente una vez con un solo objeto de configuración, y que la `url` que recibe es la que devolvió `Config` sin alterar. Ambas son propiedades del cable que COMP-01 nombra.
- **`jest.dontMock('dotenv')` en la limpieza** además del `jest.resetModules()` que pedía el plan: `resetModules` limpia registros de módulos, no las fábricas registradas con `doMock`.

## Deviations from Plan

None - plan executed exactly as written. Las decisiones de arriba refinan aserciones dentro del alcance que el plan define; ninguna agrega archivos, dependencias ni toca `src/`.

## Issues Encountered

- `npm install --save-dev jest@29.7.0` escribe `"^29.7.0"` (con caret) por omisión. Se reemplazó por `"29.7.0"` exacto en `package.json` y se volvió a correr `npm install` para que `package-lock.json` reflejara el pin. El criterio de aceptación exige el valor exacto.
- `npm install` reporta 3 vulnerabilidades (axios/form-data/follow-redirects). Son preexistentes, conocidas y diferidas (`DEPS-01`/`DEPS-02`); no se corrió `npm audit fix`.
- La entrada `.planning/STATE.md` ya venía modificada por el orquestador al arrancar la ejecución; se incluye en el commit de metadatos, no en los de tarea.

## Known Stubs

None. Los valores fijos de `createFakeConfig` (`/tmp/nexgen-tests-output`, host `.invalid`) son dobles de prueba deliberados, no datos que fluyan a producción.

## User Setup Required

None - no external service configuration required. La suite no necesita `.env`.

## Next Phase Readiness

- Los planes 01-02, 01-03 y 01-04 pueden modificar `src/config/index.js`, `src/cli/taxCommandHandler.js` y `src/validators/taxValidator.js` con la red de seguridad activa: cualquier cambio en el comportamiento observable de v1 rompe `npm test`.
- `tests/setup.js` ya fija `SYNEXUS_BASE_URL` y `SYNEXUS_API_KEY` ficticios (prefijo `synexus_test_`) y deja `SYNEXUS_ENTITY` y `TAX_API_VERSION` ausentes, como esperan las pruebas del selector y de precedencia de entidad.
- `createFakeConfig(overrides)` acepta métodos nuevos por `overrides`, así que los planes siguientes pueden inyectar `getSynexus*` sin tocar el ayudante.
- Recordatorio para el plan 02: `tests/v1Freeze.messages.test.js` congela `operation` y `filePath` por separado; al agregar el selector al objeto de retorno de `parseArguments`, la prueba debe seguir verde sin modificarla.

---
*Phase: 01-camino-v2-de-punta-a-punta-para-una-cotizaci-n*
*Completed: 2026-09-10*

## Self-Check: PASSED

Archivos creados (7/7) y commits de tarea (3/3) verificados en disco y en `git log`.
