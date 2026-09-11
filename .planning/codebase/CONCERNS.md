# Codebase Concerns

**Analysis Date:** 2026-09-11

> Alcance: repo completo, con énfasis en lo nuevo desde el mapeo anterior
> (2026-09-10): el código v2 de la Fase 1 (`src/config/synexusConfig.js`,
> `src/api/synexusRequestBuilder.js`, `src/api/synexusApiClient.js`, la rama
> v2 de `src/cli/taxCommandHandler.js`) y `tests/`. Los hallazgos ya resueltos
> en la revisión de Fase 1 (WR-01, WR-02, WR-05 — ver
> `.planning/phases/01-camino-v2-de-punta-a-punta-para-una-cotizaci-n/01-REVIEW.md`)
> no aparecen aquí: este documento describe el estado actual, no el historial.
> Los ítems ya registrados en `.planning/REQUIREMENTS.md` § "v2 Requirements"
> (DEPS-01/02, DEBT-01/02/03/04) se citan como *tracked*, no se re-derivan.

## Tech Debt

**Sanitización de apóstrofos de v1 aplicada al cable v2 (WR-03 — diferido a Fase 2 por decisión):**
- Issue: `sanitizeStringFields` reemplaza `'` por `\'` en todo string del cuerpo. La regla nació para el contrato v1 (direcciones tipo `Plummer's...`, ver `CLAUDE.md`); la rama v2 llama al mismo método sobre el mismo cuerpo antes de construir el request.
- Files: `src/cli/taxCommandHandler.js:216` (llamada), `src/validators/taxValidator.js:133-152` (`sanitizeStringFields`)
- Impact: un `to_street` con apóstrofo llega al proveedor v2 como `O\'Brien St` (barra invertida literal en el cable JSON). `to_street` participa en resolución de jurisdicción; no hay evidencia de que el proveedor v2 necesite ese escape.
- Fix approach: decisión ya diferida a Fase 2 — no sanear bajo v2, o confirmar con el proveedor y congelar el comportamiento con una prueba en `tests/v2QuoteEndToEnd.test.js` que capture `axios.mock.calls[0][0].data`. No reabrir sin esa decisión; ver WR-03 en `01-REVIEW.md`.

**URL base de v1 obsoleta repetida en cuatro documentos (DEBT-01 — tracked en `.planning/REQUIREMENTS.md`):**
- Issue: `https://syn-magento.azurewebsites.net/api/` aparece como valor/ejemplo de `BASE_URL` en cuatro documentos de referencia distintos.
- Files: `README.md:44`, `HANDOFF.md:10,95`, `RUNBOOK.md:126,160,174`, `ARCHITECTURE.md:266`
- Impact: cualquiera que use la documentación para configurar o diagnosticar v1 parte de un host potencialmente incorrecto; `RUNBOOK.md:174` incluso da ese host como objetivo de `nslookup` para diagnosticar `ENOTFOUND`.
- Fix approach: tracked as DEBT-01. Confirmar el host vigente una sola vez y propagarlo a los cinco puntos.

**Ningún documento de referencia describe la capa v2, salvo `README.md` (nuevo, no cubierto por la revisión de Fase 1):**
- Issue: `ARCHITECTURE.md`, `RUNBOOK.md` y `HANDOFF.md` —los tres "docs profundos" que `CLAUDE.md` señala para desglose por capa, modelo de error y procedimientos operativos— tienen cero menciones de `Synexus`, `SYNEXUS_*`, `SynexusConfig`, `SynexusRequestBuilder` o `SynexusApiClient` (confirmado con `grep -c` sobre los tres archivos). Sólo `README.md` documenta las variables y los flags de v2.
- Files: `ARCHITECTURE.md`, `RUNBOOK.md`, `HANDOFF.md` (ausencia total de contenido v2)
- Impact: un operador que siga `RUNBOOK.md` para diagnosticar una corrida v2 no encuentra ninguna sección propia. Fase 3 exige `VERIF-02` ("procedimiento escrito, ejecutable desde el servidor, para validar las tres operaciones contra staging") y hoy no hay dónde apoyarlo salvo los flags documentados en `README.md`.
- Fix approach: antes o durante Fase 3, extender `RUNBOOK.md` con diagnóstico v2 (qué imprime `printProfile`, qué significa cada rama de `_handleError` en `src/api/synexusApiClient.js`) y `ARCHITECTURE.md` con el desglose de las tres clases nuevas.

**Response file overwrite en corridas concurrentes (DEBT-02 — tracked):**
- Issue: `getResponseFileName` no incluye marca de tiempo.
- Files: `src/storage/fileManager.js:163-166`
- Impact: dos invocaciones simultáneas sobre el mismo archivo de entrada compiten por `RESPONSE_<basename>.json`.
- Fix approach: tracked as DEBT-02.

**Logger congela la fecha del archivo al construirse (DEBT-03 — tracked):**
- Issue: el nombre del archivo de log se calcula una sola vez, en el constructor.
- Files: `src/infrastructure/logger.js:13-17,44-47`
- Impact: un proceso que cruza medianoche sigue escribiendo en `log_<fecha-de-ayer>.log`.
- Fix approach: tracked as DEBT-03.

**v1 imprime la credencial en la URL de stdout (DEBT-04 — tracked):**
- Issue: `console.log` imprime la URL completa, que en v1 incluye `?code=<API_CODE>`.
- Files: `src/api/taxApiClient.js:32`
- Impact: la credencial de v1 queda expuesta en cualquier consola o log de shell/CI que capture stdout.
- Fix approach: tracked as DEBT-04; no se corrige en este milestone porque cambiaría la salida de v1 y `COMP-01` lo prohíbe.

**Literales de flags CLI duplicados en tres sitios (IN-06 del review, abierto):**
- Issue: `'--api-version='` vive en `knownFlags` y en `resolveApiVersion`; `'--entity='` vive en `knownFlags` y en `parseArguments`.
- Files: `src/cli/taxCommandHandler.js:37` (`knownFlags`), `:52` (`resolveApiVersion`), `:127` (`parseArguments`)
- Impact: renombrar un flag exige editar 2 sitios; olvidar uno desincroniza el rechazo de "argumento no reconocido" de la lectura real del valor.
- Fix approach: constantes estáticas (`static API_VERSION_FLAG = '--api-version='`) y derivar `knownFlags` de ellas.

**`package.json` no declara `engines` (IN-09 del review, abierto):**
- Issue: no hay piso de Node declarado, pese a que el diseño de Fase 1 depende de uno (UUID manual en vez de `crypto.randomUUID`, ausencia deliberada de `?.`/`??`/`.at()`/`structuredClone` en todo `src/` y `tests/`).
- Files: `package.json:1-19`
- Impact: `npm install` en un Node menor a 14.15 no avisa; el fallo llega después, de forma opaca.
- Fix approach: `"engines": { "node": ">=14.15.0" }`.

**Ayudantes de prueba duplicados y ya divergentes en cuatro archivos (IN-10 del review, confirmado y ampliado):**
- Issue: `createV2Body` está copiado en CUATRO archivos y ya diverge en forma — la copia de `tests/v2QuoteEndToEnd.test.js:39` acepta un parámetro `overrides` que las otras tres no tienen. `capturedConsoleOutput` está copiado en dos archivos. El doble de `fileManager` (objeto literal `{ exists, readJsonFile, ensureDirectory, writeJsonFile, getResponseFileName }`) se reconstruye en línea en al menos tres archivos en vez de vivir en `tests/helpers/fakes.js`. Además, el comentario de `tests/v1Freeze.messages.test.js:77` sigue citando "líneas 36-37" para el mensaje de uso; hoy ese mensaje se compone en `src/cli/taxCommandHandler.js:118-119` — la referencia ya derivó dos veces desde que se escribió (36-37 → 95-96 al momento de la revisión de Fase 1 → 118-119 ahora).
- Files: `tests/synexusRequestBuilder.test.js:16`, `tests/argumentParsing.test.js:238,261,270`, `tests/v2QuoteEndToEnd.test.js:39,108,146`, `tests/v2IntentValidation.test.js:26,264,274`, `tests/synexusApiClient.test.js:93`, `tests/v1Freeze.messages.test.js:77-78`
- Impact: una prueba que confíe en su copia de `createV2Body` puede quedar con una forma de cuerpo desactualizada sin que otra prueba lo detecte; el comentario con la línea incorrecta puede desorientar a quien edite `parseArguments` a continuación.
- Fix approach: mover `createV2Body`, `createV1Body`, `capturedConsoleOutput` y un `createFakeFileManager` a `tests/helpers/fakes.js`; corregir o quitar la referencia de línea del comentario.

**Ausencia de `.env.example` (gap conocido, bloqueado por regla de permisos del proyecto):**
- Issue: no existe una plantilla de variables de entorno versionada; sólo existe el `.env` real (gitignorado) y un archivo suelto `env` (sin punto, también gitignorado — ver el comentario en `.gitignore` sobre la reunión del 9-sep-2026).
- Files: (ausente por diseño; no crear sin resolver primero la regla de permisos que lo bloquea)
- Impact: bajo — `README.md` (sección "Environment Configuration", líneas 38-90) ya documenta cada variable en prosa, así que el costo de onboarding es menor que si no hubiera documentación alguna.
- Fix approach: no es una tarea de código; requiere resolver la restricción de permisos antes de crear el archivo. No reabrir como tarea de Fase 2 sin esa resolución.

## Known Bugs

**Un archivo JSON con raíz de array atraviesa la rama v2 (WR-04 — diferido a Fase 2 por decisión):**
- Symptoms: el cuerpo emitido convierte el array en un objeto con claves numéricas (`{"0": {...}, "transaction_type": "sales_estimate", "committed": false, "request_id": "..."}`); el proveedor responde 4xx en vez de que nexgen frene antes de la red.
- Files: `src/cli/taxCommandHandler.js:213` (`validateRequestBody`, acepta arrays porque `typeof [] === 'object'`), `src/validators/taxValidator.js:119-126`, `src/api/synexusRequestBuilder.js:78-80` (`Object.assign({}, array, intent, {...})`)
- Trigger: invocar `get_tax --api-version=v2` con un archivo cuyo JSON raíz es `[...]` en vez de `{...}`.
- Workaround: ninguno automatizado hoy; el ERP produce objetos en la práctica, así que el riesgo es bajo. El freno de una línea ya está diseñado — ver WR-04 en `01-REVIEW.md` — y pendiente de Fase 2.

**`--help` se rechaza como argumento no reconocido; `showHelp()` es código muerto (IN-07 del review, abierto):**
- Symptoms: `node index.js --help` produce `Argumento no reconocido: --help` en vez de la ayuda de uso.
- Files: `src/cli/taxCommandHandler.js:78-136` (`parseArguments` no reconoce `--help`/`-h`), `:292-310` (`showHelp()`, verificado sin llamador en todo `src/`, `index.js` y `tests/`)
- Trigger: ejecutar el CLI con `--help` o `-h`.
- Workaround: ninguno; usar `RUNBOOK.md`/`README.md` para el uso correcto.

**La entidad se resuelve antes que la guardia de archivo v1 bajo v2 (IN-08 del review, abierto):**
- Symptoms: un archivo v1 (con campo `Committed`) corrido bajo `--api-version=v2` sin `--entity` ni `SYNEXUS_ENTITY` resueltos aborta con "No se pudo resolver el código de entidad" en vez del mensaje que señala que el archivo parece de v1.
- Files: `src/cli/taxCommandHandler.js:219` (`resolveEntityCode`, paso 3) corre antes que `:231` (`validateV2IntentFields`, paso 6, donde vive la guardia de "Committed")
- Trigger: correr un archivo v1 bajo el selector v2 sin ninguna de las tres vías de entidad resuelta.
- Workaround: leer el mensaje de entidad sabiendo que puede ser síntoma y no causa; la solución (mover `getIntentFor` + `validateV2IntentFields` antes de `resolveEntityCode`) está descrita en `01-REVIEW.md` IN-08.

## Security Considerations

**`postman/` es nuevo, no está en `.gitignore`, y su entorno de staging tiene un campo listo para la llave viva (nuevo, no cubierto por la revisión de Fase 1):**
- Risk: `postman/` aparece como no rastreado en `git status` (`?? postman/`). `postman/synexus-staging.postman_environment.json` define las variables `synexus_base_url` (con valor), `synexus_api_key` (hoy vacío) y `synexus_entity` (hoy vacío); `postman/nexgen-test.postman_environment.json` define `api_code` (hoy vacío) de forma análoga para v1. Nada impide que alguien pegue la llave real ahí para probar contra staging y luego corra un `git add` amplio que la suba.
- Files: `postman/synexus-staging.postman_environment.json`, `postman/nexgen-test.postman_environment.json`
- Current mitigation: ninguna específica — `.gitignore` cubre `.env`, `.env.*` y la variante suelta `env`, pero no `postman/*.postman_environment.json`.
- Recommendations: añadir `postman/*.postman_environment.json` (o todo `postman/*environment*.json`) a `.gitignore`; marcar esas variables como tipo `secret` en Postman (no se exportan en texto plano). Actualizar también `HANDOFF.md:207`, que hoy describe `postman/` como "Carpeta vacía hoy; placeholder para colecciones" — ya no lo está: trae dos colecciones y dos entornos.

**La llave v2 sólo se valida por prefijo, no por longitud (IN-03 del review, abierto):**
- Risk: `synexus_test_ab` construye sin error (pasa `_validateKeyHostMatch`) y sólo falla con 401 al tocar la red. El freno de arranque (SAFE-03) existe precisamente para evitar esa clase de sorpresa tardía.
- Files: `src/config/synexusConfig.js:96-99` (`_findKeyPrefix`, sólo compara `startsWith`)
- Current mitigation: ninguna. El proveedor documenta llaves de 76 caracteres (12 de prefijo + 64 hex, según la descripción de `postman/synexus-v2-api.postman_collection.json`), pero el código no lo exige.
- Recommendations: exigir longitud mínima en `_validateKeyHostMatch` (`> prefijo + 16`, o 76 exactos si el proveedor lo garantiza), con mensaje en español.

**Los frenos de arranque de `SynexusConfig` no escriben en el log de winston (IN-05 del review, abierto):**
- Risk: `SynexusConfig` no recibe logger; sus errores de arranque (variables faltantes, prefijo desconocido, descuadre llave↔host, URL malformada) sólo se imprimen por consola. Una corrida fallida en un cron o en un wrapper del ERP que no capture stdout no deja rastro en `logs/log_*.log`.
- Files: `src/config/synexusConfig.js:57,76,87,127,135,163` (throws del constructor, sin logger), `index.js:82-86` (catch genérico de `main()` que sólo imprime un texto fijo, no el mensaje real)
- Current mitigation: los errores de `resolveEntityCode` (`synexusConfig.js:226`) sí llegan al log, pero indirectamente, vía el catch de `execute()` en `taxCommandHandler.js`.
- Recommendations: inyectar el logger en el constructor de `SynexusConfig` (`new SynexusConfig(logger)`) y seguir el mismo trío `console.error + logger.error + throw` que usa el resto del repo.

## Performance Bottlenecks

No se identificaron cuellos de botella de rendimiento. `nexgen` es un CLI de una sola invocación, una sola operación HTTP y salida (`CLAUDE.md`: "Not a daemon — one invocation, one operation, exit"). Las operaciones de archivo en `src/storage/fileManager.js` son síncronas (`readFileSync`/`writeFileSync`/`existsSync`), lo cual es apropiado para un proceso que lee y escribe una sola vez antes de salir. Único punto a vigilar, no un hallazgo separado: el transporte de log (`src/infrastructure/logger.js:42-50`) no declara `maxsize`/`maxFiles`, así que el archivo del día podría crecer sin cota en un ambiente de muy alto volumen de errores — relacionado con DEBT-03, ya tracked.

## Fragile Areas

**Flags repetidos: gana el primero, sin aviso (IN-01 del review, abierto):**
- Files: `src/cli/taxCommandHandler.js:53` (`resolveApiVersion`, usa `args.find`), `:128` (`entityFlag`, también `args.find`)
- Why fragile: `--api-version=v2 --api-version=v1` resuelve `v2` en silencio; `--entity=USA --entity=CA` resuelve `USA`. Una ambigüedad de este tipo debería abortar, no resolverse por posición del argumento.
- Safe modification: cambiar `find` por `filter` y lanzar si hay más de una coincidencia por prefijo.
- Test coverage: sin prueba que cubra el caso de flag repetido hoy en `tests/argumentParsing.test.js`.

**La guardia de cableado de `_executeV2` sólo cubre `synexusApiClient` (IN-02 del review, abierto):**
- Files: `src/cli/taxCommandHandler.js:219` (usa `this.synexusConfig` sin comprobar antes), `:226` (usa `this.requestBuilder` sin comprobar antes), `:241` (única comprobación explícita, sobre `this.synexusApiClient`)
- Why fragile: si `index.js` cableara `synexusConfig = null` o `requestBuilder = null` bajo v2 por un error futuro, el fallo real es un `TypeError` en inglés ("Cannot read properties of null...") en el paso 3, no el mensaje en español que la guardia actual describe como "defensa permanente contra un cableado incompleto".
- Safe modification: comprobar los tres colaboradores v2 al inicio de `_executeV2`, antes del paso 1.
- Test coverage: `tests/v2IntentValidation.test.js` y `tests/synexusApiClient.test.js` cubren `synexusApiClient` nulo; ninguna prueba cubre `synexusConfig` o `requestBuilder` nulos.

**`resolveEntityCode` no valida que `entity_id` sea cadena (IN-04 del review, abierto):**
- Files: `src/config/synexusConfig.js:217-219`
- Why fragile: `{ entity_id: 42 }` devuelve `42`; `{ entity_id: { a: 1 } }` devuelve el objeto, que termina como el string literal `"[object Object]"` en el header `X-Synexus-Entity` (`src/api/synexusApiClient.js:59`) — un 4xx del proveedor sin pista clara de la causa real.
- Safe modification: condición `typeof requestBody.entity_id === 'string' && requestBody.entity_id`, con mensaje explícito si el campo existe pero no es cadena.
- Test coverage: `tests/synexusConfig.test.js` cubre precedencia y ausencia de `entity_id`; no cubre tipo incorrecto.

## Scaling Limits

No aplica en el sentido de capacidad/throughput — cada invocación hace como máximo una llamada HTTP saliente y termina (arquitectura de una sola operación). El único límite real de concurrencia es sobre el mismo archivo de entrada, ya registrado en Tech Debt como DEBT-02 (`src/storage/fileManager.js:163-166`); no se repite aquí para no duplicar.

## Dependencies at Risk

**axios / form-data / follow-redirects (DEPS-01 y DEPS-02 — tracked en `.planning/REQUIREMENTS.md` § "v2 Requirements"):**
- Risk: la auditoría de dependencias reportó tres vulnerabilidades sobre esta cadena. Declarado en `package.json:12` como `axios: ^1.7.9`; versiones efectivamente instaladas hoy (verificadas en `node_modules/*/package.json`): `axios@1.7.9`, `form-data@4.0.2`, `follow-redirects@1.15.9` (resueltas también en `package-lock.json:12,1154-1155`).
- Impact: `axios` sostiene el `GET`-con-cuerpo no estándar del camino v1 (`src/api/taxApiClient.js:36-48`) y el `POST` de v2 (`src/api/synexusApiClient.js:52-65`); actualizar sin revalidar podría romper ese comportamiento.
- Migration plan: tracked as DEPS-01 (resolver las vulnerabilidades) y DEPS-02 (revalidar el `GET`-con-cuerpo tras actualizar). Fuera de este milestone por decisión explícita — ver "Out of Scope" en `REQUIREMENTS.md`: el riesgo de tumbar producción se juzgó mayor que el de las vulnerabilidades en un CLI interno de entrada controlada.

**Node.js — piso de versión no verificado en el servidor de producción:**
- Risk: el diseño de Fase 1 asume Node ≥14.15 (UUID manual en `src/api/synexusRequestBuilder.js:99-108` en vez de `crypto.randomUUID`; ausencia deliberada de `?.`/`??`/`.at()` en todo `src/` y `tests/`), pero `package.json` no declara `engines` (ver Tech Debt, IN-09) y la versión real del servidor de producción no está confirmada en el repo.
- Impact: si el servidor corre Node <14.15, riesgo de comportamiento indefinido en la ruta de generación de UUID; si corre una versión muy superior, sin riesgo pero tampoco garantía escrita.
- Migration plan: declarar `engines` (IN-09) es el primer paso de bajo costo; confirmar la versión real del servidor es un prerequisito natural de Fase 3 (corte a producción).

## Missing Critical Features

**`post_tax` y `cancel_tax` sin mapeo de intención v2 (alcance de Fase 2 por diseño — tracked):**
- Problem: `src/api/synexusRequestBuilder.js:52-58` lanza explícitamente para toda operación que no sea `get_tax`; no existe mapeo de intención v2 para confirmar ni cancelar.
- Blocks: nexgen no puede emitir `post_tax` ni `cancel_tax` bajo el contrato v2 todavía.
- Files: `src/api/synexusRequestBuilder.js:52-58`
- Nota: esto es alcance planeado de Fase 2 (`OPER-02`/`OPER-03` en `.planning/REQUIREMENTS.md`), junto con `SAFE-02/04/05/06` y `COMP-02/03`. No se duplican aquí — ver ese documento para la lista completa con trazabilidad a fase.

## Test Coverage Gaps

**`src/storage/fileManager.js` y `src/infrastructure/logger.js` no tienen ninguna prueba que ejecute su código real (nuevo, no cubierto por la revisión de Fase 1):**
- What's not tested: ningún archivo bajo `tests/` hace `new FileManager(...)` ni `new Logger(...)`, ni requiere esos dos módulos directamente (confirmado por búsqueda sobre los 11 archivos de `tests/`). Cada suite construye su propio objeto literal `{ exists, readJsonFile, ensureDirectory, writeJsonFile, getResponseFileName }` en línea (ver también IN-10 en Tech Debt). Como contraste, `src/api/taxApiClient.js` sí se instancia de verdad en `tests/v1Freeze.wire.test.js:16-41` con `axios` mockeado vía `jest.mock('axios')`.
- Files: `src/storage/fileManager.js` (169 líneas, sin prueba directa), `src/infrastructure/logger.js` (87 líneas, sin prueba directa)
- Risk: la lógica real de `_handleFileReadError`/`_listSimilarFiles` (mensajes de diagnóstico ENOENT/EACCES/SyntaxError), la construcción real de winston (nivel `error`, nombre de archivo por fecha) y la generación real del nombre `RESPONSE_*` nunca se ejercitan en la suite; una regresión en cualquiera de las dos sólo se detectaría en producción.
- Priority: Medium — son archivos simples y estables hoy, pero `getResponseFileName` sostiene una convención de la que dependen los envoltorios del ERP (`CLAUDE.md`, sección "Do not touch lightly").

**Ninguna prueba fija cómo viaja un apóstrofo en el cable v2 (relacionado con WR-03, diferido):**
- What's not tested: `tests/v2QuoteEndToEnd.test.js` no tiene un caso que capture `axios.mock.calls[0][0].data` con un apóstrofo en un campo de dirección bajo v2.
- Files: `tests/v2QuoteEndToEnd.test.js`
- Risk: mientras no exista esa prueba, la decisión de Fase 2 sobre WR-03 puede tomarse — o revertirse — sin que nada la congele.
- Priority: Low — depende de una decisión de producto ya diferida a Fase 2; el propio `01-REVIEW.md` recomienda añadirla junto con esa decisión.

**Sin guarda ni prueba para cuerpo v2 con raíz de array (relacionado con WR-04, diferido):**
- What's not tested: ningún caso en `tests/v2IntentValidation.test.js` ni `tests/v2QuoteEndToEnd.test.js` cubre un archivo de entrada `[...]` bajo `--api-version=v2`.
- Files: `tests/v2IntentValidation.test.js`, `tests/v2QuoteEndToEnd.test.js`
- Risk: el caso queda exactamente como lo describe WR-04 — un 4xx del proveedor en vez de un freno en español — hasta que Fase 2 lo aborde.
- Priority: Low — mismo diferimiento que WR-04; el ERP produce objetos en la práctica, así que la probabilidad real es baja.

---

*Concerns audit: 2026-09-11*
