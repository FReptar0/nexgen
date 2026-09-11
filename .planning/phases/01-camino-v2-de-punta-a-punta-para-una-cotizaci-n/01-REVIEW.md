---
phase: 01-camino-v2-de-punta-a-punta-para-una-cotizaci-n
reviewed: 2026-09-10T22:01:22Z
depth: standard
files_reviewed: 20
files_reviewed_list:
  - src/api/synexusApiClient.js
  - src/api/synexusRequestBuilder.js
  - src/cli/taxCommandHandler.js
  - src/config/index.js
  - src/config/synexusConfig.js
  - src/validators/taxValidator.js
  - index.js
  - jest.config.js
  - package.json
  - tests/setup.js
  - tests/helpers/fakes.js
  - tests/v1Freeze.wire.test.js
  - tests/v1Freeze.messages.test.js
  - tests/synexusConfig.test.js
  - tests/argumentParsing.test.js
  - tests/synexusRequestBuilder.test.js
  - tests/v2IntentValidation.test.js
  - tests/synexusApiClient.test.js
  - tests/v2QuoteEndToEnd.test.js
  - tests/setup.test.js
findings:
  critical: 0
  warning: 5          # 3 resueltas (WR-01, WR-02, WR-05) · 2 diferidas a Fase 2 (WR-03, WR-04)
  info: 10
  total: 15
status: resolved_with_deferrals
---

# Fase 01: Reporte de revisión de código

**Revisado:** 2026-09-10T22:01:22Z
**Profundidad:** standard
**Archivos revisados:** 20
**Estado:** resolved_with_deferrals — 3 advertencias corregidas, 2 diferidas a Fase 2, 10 informativos sin acción

## Resumen

Se revisaron los 20 archivos de la fase (7 de código, 13 de pruebas) con lectura completa,
`git diff` contra `b9230e1^` y sondeos ejecutados contra el código real para confirmar o
descartar cada hipótesis. La suite corre en verde (9 suites, 219 casos, Node 23; Jest
29.7.0 con `engines ^14.15.0`).

**Lo que se buscó con más insistencia y NO se encontró:**

- **Fuga de la llave v2.** No hay ninguna vía por la que `SYNEXUS_API_KEY` llegue a stdout,
  stderr, el log de winston ni a un mensaje de error. `SynexusApiClient._handleError` sólo
  lee `code`, `message`, `response.status/data/statusText`; nunca serializa `error`,
  `error.config` ni `error.request`. `execute()` y `main()` sólo imprimen `error.message`.
  Los detectores de fuga de las pruebas (`capturedConsoleOutput`) son sólidos: se verificó
  que `JSON.stringify` de un `Error` con `config.headers` sí serializa la cabecera, así que
  una regresión que imprimiera el error completo sería detectada.
- **Regresión observable de v1.** `src/api/taxApiClient.js`, `fileManager.js` y `logger.js`
  no cambiaron (`git diff --name-only` vacío). Para la invocación del envoltorio del ERP
  (`get_tax <archivo>` sin flags) la secuencia, stdout, stderr, código de salida y archivo
  de salida son idénticos. El único cambio deliberado es que un argumento `--desconocido`
  ahora aborta; está documentado en el código y en el plan.
- **Emisión de una cotización sin `sales_estimate` o con el archivo pisando la intención.**
  `Object.assign({}, archivo, intent, {request_id})` garantiza que nexgen gana;
  `_assertIntentFieldsPresent` cierra el caso de mapeo vacío. Se probó un archivo con
  `__proto__` malicioso: no contamina `Object.prototype` y el cable sale limpio.
- **Compatibilidad con Node 14.15.** No se usa `?.`, `??`, `.at()`, `structuredClone`,
  `randomUUID`, `AbortController` ni `replaceAll` en `src/` ni en `tests/`.

**Lo que sí se encontró** se concentra en dos zonas: (1) los frenos de arranque de
`SynexusConfig` validan el *hostname* pero no el esquema ni la forma de la URL, con lo que
un `http://` o una base con ruta pasan el freno; y (2) el parseo de flags sólo reconoce el
prefijo `--`, así que un typo con un guion (`-api-version=v2`) se convierte en posicional
ignorado y la corrida cae en v1 en silencio, exactamente lo que el diseño quería impedir.
Además, el saneado de apóstrofos heredado de v1 corrompe cadenas en el cable v2.

## Advertencias

### WR-01: Los frenos de arranque validan sólo el hostname: `http://`, ruta, query y userinfo en `SYNEXUS_BASE_URL` pasan

> ✅ **RESUELTO** en `8afd6a6` — `_getConfiguredUrl` parsea una sola vez y rechaza esquema ≠ https, ruta, query, fragmento y userinfo (enmascarado en el mensaje). 8 casos nuevos.

**Archivo:** `src/config/synexusConfig.js:67-88`, `107-118`, `142-145`
**Problema:** `_validateKeyHostMatch` compara únicamente `new URL(baseUrl).hostname` contra
el host esperado. Se comprobó ejecutando el constructor:

| `SYNEXUS_BASE_URL` | Resultado |
|---|---|
| `http://compute.staging.synexustax.com` | Acepta. `Authorization: Bearer <llave>` viaja en texto claro por el puerto 80. |
| `https://compute.staging.synexustax.com/api/v1` | Acepta. `getCalculationUrl()` devuelve `.../api/v1/api/v1/tax_calculations` (ruta doble → 404 en vivo). |
| `https://compute.staging.synexustax.com/?x=1` | Acepta. URL resultante `.../?x=1/api/v1/tax_calculations`. |
| `https://user:pw@compute.staging.synexustax.com` | Acepta. El userinfo se imprime en `Realizando petición ... a:` y en la línea de perfil. |

El freno existe precisamente para atrapar errores de configuración antes de la red; estas
cuatro formas lo atraviesan y fallan (o filtran) después. El caso `/api/v1` es el más
probable en la práctica: es la forma en que suelen documentarse las "base URL".
**Solución:** validar la URL completa y componer desde `origin`, no desde la cadena cruda:

```js
_getConfiguredUrl() {
    const baseUrl = this.getBaseUrl();
    let url;
    try {
        url = new URL(baseUrl);
    } catch (err) {
        // ... mensaje actual ...
    }
    if (url.protocol !== 'https:') {
        throw new Error(`SYNEXUS_BASE_URL debe usar https: "${baseUrl}". La llave viaja en un header y no puede salir en texto claro.`);
    }
    if (url.username || url.password || url.search || url.hash || (url.pathname !== '/' && url.pathname !== '')) {
        throw new Error(`SYNEXUS_BASE_URL debe ser sólo esquema y host, sin ruta ni credenciales: "${baseUrl}". Ejemplo: https://compute.staging.synexustax.com`);
    }
    return url;
}

getCalculationUrl() {
    return `${this._getConfiguredUrl().origin}${this.calculationPath}`;
}
```

Añadir a `tests/synexusConfig.test.js` un caso por fila de la tabla anterior.

### WR-02: Un flag mal escrito con un solo guion (o guion tipográfico) cae en v1 en silencio

> ✅ **RESUELTO** en `4d4d2ac` — todo argumento que no sea uno de los dos posicionales ni un flag reconocido aborta mostrando los sobrantes y los flags aceptados. La invocación sin flags del ERP no cambia. 12 casos nuevos.

**Archivo:** `src/cli/taxCommandHandler.js:78-89`
**Problema:** El rechazo de flags desconocidos sólo mira argumentos que empiezan con `--`.
Cualquier otro argumento es posicional, y el tercer posicional en adelante se ignora sin
aviso. Se comprobó:

```
parseArguments(['get_tax','a.json','-api-version=v2'])  → { operation:'get_tax', filePath:'a.json', apiVersion:'v1' }
parseArguments(['get_tax','a.json','––api-version=v2']) → { operation:'get_tax', filePath:'a.json', apiVersion:'v1' }
```

Es el escenario que el propio comentario de `knownFlags` (línea 32-34) declara querer
impedir: "un flag mal escrito que cayera en silencio en v1 le haría creer al operador que
probó v2". Con un archivo v2 el operador verá el mensaje de `Committed` de v1, que apunta al
archivo y no al flag; con un archivo v1 la corrida golpea la API legada creyendo probar v2.
**Solución:** tratar como candidato a flag todo argumento que empiece con `-` (un solo
guion basta), no sólo con `--`. No rechazar posicionales extra: eso sí cambiaría v1.

```js
const looksLikeFlag = arg => arg.startsWith('-');
const unknownFlags = args.filter(arg => looksLikeFlag(arg) &&
    !this.knownFlags.some(flag => arg.startsWith(flag)));
// ...
const positionals = args.filter(arg => !looksLikeFlag(arg));
```

Añadir a `tests/argumentParsing.test.js` los dos casos de la tabla (`-api-version=v2` y
el guion tipográfico) esperando `Argumento no reconocido`.

### WR-03: El saneado de apóstrofos de v1 se aplica al cable v2 y corrompe las cadenas

> ⏭ **DIFERIDO A FASE 2** — es decisión sobre qué llega al proveedor, y va junto con la fidelidad de la respuesta (SAFE-04/COMP-03). Registrar al planear la Fase 2.

**Archivo:** `src/cli/taxCommandHandler.js:193`; origen en `src/validators/taxValidator.js:139`
**Problema:** `sanitizeStringFields` sustituye `'` por `\'`. `CLAUDE.md` documenta que esa
regla nació de fallos en líneas de dirección de la API legada (`Plummer's...`); es un
parche del contrato v1. Aplicada al cuerpo v2, un JSON válido lleva al proveedor una cadena
con una barra invertida literal. Se comprobó el cable construido:

```json
{ "to_street": "O\\'Brien St", "transaction_type": "sales_estimate", ... }
```

El proveedor recibe `O\'Brien St`. Para una cotización el nombre del cliente es inocuo,
pero `to_street` participa en la resolución de jurisdicción y una barra invertida puede
degradar la validación de dirección. No hay evidencia de que el proveedor v2 necesite el
escape, y sí de que lo recibe alterado. La rama v2 llama el método por separado a propósito
(plan 01-03), pero la decisión de *qué* sanea heredó la razón de v1 sin revisarla.
**Solución:** no sanear bajo v2 (la rama ya llama los métodos por separado, así que
retirar la línea 193 y pasar `requestBody` a los pasos siguientes no toca v1), o bien
confirmar con el proveedor en la Fase 3 que el escape es requerido y dejar constancia en
`01-CONTEXT.md`. En cualquier caso, agregar un caso a `tests/v2QuoteEndToEnd.test.js` que
fije en el `axios.mock.calls[0][0].data` cómo viaja un apóstrofo bajo v2, para que la
decisión quede congelada en vez de implícita.

### WR-04: Un archivo JSON cuyo raíz es un array atraviesa la rama v2 y se emite como objeto con claves numéricas

> ⏭ **DIFERIDO A FASE 2** — caso borde de baja probabilidad (el ERP produce objetos). Encaja con la validación de forma de la Fase 2.

**Archivo:** `src/cli/taxCommandHandler.js:190`; `src/validators/taxValidator.js:120`; `src/api/synexusRequestBuilder.js:78-80`
**Problema:** `validateRequestBody` acepta arrays (`typeof [] === 'object'`). Bajo v2,
`Object.assign({}, array, intent, ...)` convierte el array en un objeto y la petición sale
así (comprobado):

```json
{ "0": { "item_id": "SKU-1" }, "transaction_type": "sales_estimate", "committed": false, "request_id": "..." }
```

El proveedor responderá 4xx, pero el operador verá un error del proveedor en vez de un
freno en español antes de la red, que es el principio de la fase. El archivo lo produce el
área de ERP, así que el riesgo es bajo, pero el freno es de una línea. No se puede añadir a
`validateRequestBody` porque cambiaría v1 (hoy v1 envía el array tal cual).
**Solución:** en `validateV2IntentFields` (sólo lo llama la rama v2), antes de la guardia
de `Committed`:

```js
if (Array.isArray(requestBody)) {
    const errorMsg = 'El archivo v2 debe ser un objeto JSON, no un arreglo.';
    console.error(errorMsg);
    this.logger.error(errorMsg);
    throw new Error(errorMsg);
}
```

### WR-05: El aislamiento de `tests/setup.js` no cubre las dos variables que borra: un `.env` real las repone al cargar `src/config`

> ✅ **RESUELTO** en `2dd5667` — `setup.js` sustituye `dotenv.config()` por un no-op antes de cualquier `require` de `src/config`. 3 casos nuevos con sonda en tmpdir, verificados por mutación.

**Archivo:** `tests/setup.js:13-32`
**Problema:** El comentario afirma que "un `.env` real presente en la máquina del
desarrollador nunca debe alimentar la suite". Eso es cierto para las variables que se
*asignan* (dotenv no sobreescribe claves existentes), pero `TAX_API_VERSION` y
`SYNEXUS_ENTITY` se *borran* (líneas 31-32). En `node_modules/dotenv/lib/main.js`,
`populate()` hace `processEnv[key] = parsed[key]` para toda clave ausente. Así que en cuanto
un archivo de prueba hace `require('../src/config')` (lo hacen `argumentParsing`,
`v1Freeze.wire` y `v2QuoteEndToEnd`), un `.env` con `TAX_API_VERSION=v2` o
`SYNEXUS_ENTITY=...` repone esos valores. Hoy ninguna prueba falla porque cada una de esas
suites vuelve a borrar las variables en su propio `beforeEach`; la garantía descansa en
disciplina por archivo, no en `setup.js`, y `setup.test.js:53-58` sólo pasa porque ese
archivo no carga `src/config`. Una prueba futura que confíe en el comentario de `setup.js`
se volverá dependiente de la máquina.
**Solución:** neutralizar dotenv para toda la suite desde `jest.config.js`, lo que además
elimina el `jest.doMock('dotenv')` manual de `tests/v1Freeze.messages.test.js:124-129`:

```js
// jest.config.js
module.exports = {
    testEnvironment: 'node',
    setupFiles: ['<rootDir>/tests/setup.js'],
    moduleNameMapper: { '^dotenv$': '<rootDir>/tests/helpers/dotenvStub.js' }
};
// tests/helpers/dotenvStub.js
module.exports = { config: () => ({ parsed: {} }) };
```

## Información

### IN-01: Flags repetidos: gana el primero, sin aviso

**Archivo:** `src/cli/taxCommandHandler.js:51`, `105`
**Problema:** `args.find(...)` toma la primera aparición. `--api-version=v2 --api-version=v1`
resuelve `v2`; `--entity=USA --entity=CA` resuelve `USA`. En el selector de contrato una
ambigüedad debería abortar, no resolverse por posición.
**Solución:** usar `filter` y lanzar si hay más de una coincidencia por prefijo.

### IN-02: La guardia de cableado cubre sólo `synexusApiClient`; `synexusConfig` o `requestBuilder` nulos producen un `TypeError` en inglés

**Archivo:** `src/cli/taxCommandHandler.js:196`, `203`, `218-224`
**Problema:** Si `index.js` construyera el manejador con `synexusConfig = null` bajo v2,
el paso 3 falla con `Cannot read properties of null (reading 'resolveEntityCode')` antes de
llegar a la guardia del paso 8. La guardia se describe como "defensa permanente contra un
cableado incompleto" y sólo cubre uno de los tres colaboradores v2.
**Solución:** una comprobación de los tres al inicio de `_executeV2`, conservando la
posición actual de la guardia del cliente si se quiere mantener el "dry run" que imprime el
cuerpo.

### IN-03: La llave sólo se valida por prefijo; una llave truncada pasa el freno

**Archivo:** `src/config/synexusConfig.js:95-98`
**Problema:** `synexus_test_ab` construye sin error y falla con 401 en la red. Si el
proveedor documenta una longitud fija, conviene exigirla en el freno; si no, al menos un
mínimo razonable (por ejemplo `> prefijo + 16`).
**Solución:** comprobar longitud en `_validateKeyHostMatch` con mensaje en español.

### IN-04: `resolveEntityCode` devuelve `entity_id` sin comprobar que sea cadena

**Archivo:** `src/config/synexusConfig.js:167-169`
**Problema:** `{ entity_id: 42 }` devuelve `42` y `{ entity_id: { a: 1 } }` devuelve el
objeto, que acabaría como `[object Object]` en el header.
**Solución:** `typeof requestBody.entity_id === 'string' && requestBody.entity_id` y, si no
es cadena, mensaje explícito.

### IN-05: Los frenos de `SynexusConfig` y `resolveEntityCode` no escriben en el log de winston

**Archivo:** `src/config/synexusConfig.js:55`, `74`, `85`, `115`, `175`; `index.js:82-86`
**Problema:** La clase no recibe logger. Los errores del constructor ocurren en `main()` y
sólo se imprimen por consola; el archivo `log_*.log` no registra nada de esa corrida. Los de
`resolveEntityCode` sí llegan al log, pero sólo porque el catch de `execute()` los reenvía.
El resto del repo usa el trío `console.error + logger.error + throw`.
**Solución:** inyectar el logger en el constructor (`new SynexusConfig(logger)`) y seguir
el trío.

### IN-06: Los literales de los flags viven en tres sitios

**Archivo:** `src/cli/taxCommandHandler.js:35`, `50`, `104`
**Problema:** `'--api-version='` aparece en `knownFlags` y en `resolveApiVersion`;
`'--entity='` en `knownFlags` y en `parseArguments`. Un cambio de nombre desincroniza el
rechazo de desconocidos y la lectura del valor.
**Solución:** constantes estáticas (`static API_VERSION_FLAG = '--api-version='`) y
derivar `knownFlags` de ellas.

### IN-07: `showHelp()` es código muerto y `--help` se rechaza como desconocido

**Archivo:** `src/cli/taxCommandHandler.js:269-286`, `78-86`
**Problema:** Nadie llama a `showHelp` (era muerto antes de la fase y se amplió igual).
`node index.js --help` produce `Argumento no reconocido: --help`.
**Solución:** o cablear `--help`/`-h` en `parseArguments` antes del rechazo, o retirar el
método.

### IN-08: La entidad se resuelve antes que la guardia de archivo v1, así que el mensaje de "causa raíz" no siempre se alcanza

**Archivo:** `src/cli/taxCommandHandler.js:196-208`
**Problema:** El validador argumenta que la guardia de `Committed` "va primero porque
diagnostica la causa raíz". Pero en `_executeV2` el paso 3 (`resolveEntityCode`) corre
antes. Un archivo v1 bajo v2, sin `--entity` ni `SYNEXUS_ENTITY`, aborta con "No se pudo
resolver el código de entidad" — el síntoma, no la causa.
**Solución:** mover `getIntentFor` + `validateV2IntentFields` antes de `resolveEntityCode`,
o al menos documentar que la guardia sólo diagnostica cuando la entidad ya resolvió.

### IN-09: `package.json` sigue sin campo `engines`

**Archivo:** `package.json:1-19`
**Problema:** El contexto de la fase registra la versión de Node del servidor como riesgo
abierto y toma decisiones (Jest 29, UUID manual) para el piso 14.15. Declarar el piso hace
que `npm install` en un Node menor avise en vez de fallar de forma opaca.
**Solución:** `"engines": { "node": ">=14.15.0" }`.

### IN-10: Ayudantes de prueba duplicados y una referencia de líneas desactualizada

**Archivo:** `tests/argumentParsing.test.js:185-239`, `tests/v2IntentValidation.test.js:264-311`, `tests/v1Freeze.messages.test.js:78-79`
**Problema:** `buildHandler` (≈50 líneas), `createV2Body` y `capturedConsoleOutput` están
copiados en cuatro archivos y ya divergen en detalles (respuesta del doble, `request_id`
fijo). Además el comentario de `v1Freeze.messages.test.js:78` cita "líneas 36-37" del
manejador; hoy el mensaje de uso está en las 95-96.
**Solución:** mover `createV2Body`, `createV1Body` y `capturedConsoleOutput` a
`tests/helpers/fakes.js` (mantener `buildHandler` en sitio si se prefiere ver el grafo en
cada archivo) y corregir la referencia de líneas o quitarla.

---

_Revisado: 2026-09-10T22:01:22Z_
_Revisor: Claude (gsd-code-reviewer)_
_Profundidad: standard_
