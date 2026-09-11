---
phase: 02-confirmar-cancelar-y-devolver-la-respuesta-ntegra
reviewed: 2026-09-11T22:02:41Z
depth: standard
files_reviewed: 16
files_reviewed_list:
  - src/api/synexusApiClient.js
  - src/api/synexusRequestBuilder.js
  - src/cli/taxCommandHandler.js
  - src/config/synexusConfig.js
  - src/validators/taxValidator.js
  - tests/helpers/fakes.js
  - tests/synexusApiClient.test.js
  - tests/synexusRequestBuilder.test.js
  - tests/v2IntentValidation.test.js
  - tests/v2QuoteEndToEnd.test.js
  - tests/v2CancelEndToEnd.test.js
  - tests/v2ResponseFidelity.test.js
  - tests/argumentParsing.test.js
  - tests/synexusConfig.test.js
  - tests/fixtures/synexus-staging-2026-09-09-request.json
  - tests/fixtures/synexus-staging-2026-09-09-response.json
findings:
  critical: 0
  warning: 2
  info: 8
  total: 10
status: resolved
---

# Fase 02: Reporte de revisión de código

**Revisado:** 2026-09-11T22:02:41Z
**Profundidad:** standard
**Archivos revisados:** 16 (5 de código, 9 de pruebas, 2 fixtures)
**Estado:** resolved — 2 advertencias corregidas, 8 informativos sin acción

## Resumen

Se revisó el diff `4d6d438..HEAD` (26 commits) con lectura completa de los 16 archivos
del alcance, y con sondeos ejecutados contra el código real para confirmar o descartar
cada hipótesis: un doble de axios programable fuera de Jest, y seis mutaciones sobre
`src/api/synexusApiClient.js` corridas contra la suite completa (11 suites, 457 casos,
Node 23; el árbol quedó restaurado y `git diff -- src/` vacío al terminar).

**Lo que se buscó con más insistencia y NO se encontró:**

- **Fuga de la llave por el camino nuevo del reintento.** Se enumeró cada sumidero del
  cliente (`console.log/error`, `logger.error`, `new Error`) y lo que interpola: operación,
  URL, status, cuerpo del proveedor, razón del reintento, identificadores y `error.message`.
  Ninguno toca `error.config`, `error.request`, `toJSON()` ni el objeto `headers`. La línea
  `Reintentando…` lleva sólo `requestBody.request_id` y la razón. Se sondeó con un error de
  axios cuyo `config.headers.Authorization` traía la llave, con `ERR_INVALID_CHAR` (el
  error que Node lanza por un valor de header inválido: cita el nombre, nunca el valor),
  con un `wait` que rechaza y con un 503 doble: la llave no salió por ninguna vía. La
  mutación "imprimir `error.config` en `_handleError`" rompe 14 casos: los detectores de
  fuga de la suite son reales.
- **Reintento fuera de la lista cerrada o con otro cuerpo.** `_retryReasonFor` sólo
  devuelve razón para `ECONNABORTED`, 502/503/504 rechazados, 409 de cancelación y 409
  `invoice_stale_object`; un 409 del cálculo sin `code` y el `idempotency_key_conflict`
  devuelven `null` (probado). `attempt < maxRetries` garantiza dos llamadas como máximo.
  `_send` manda `data: requestBody` por identidad: las mutaciones "reintentar todo 409",
  "reintentar 500", "copiar el cuerpo por intento" y "enrutar cancel a la URL de cálculo"
  rompen 3, 1, 10 y 8 casos respectivamente.
- **Clasificación que reviente con un cuerpo raro.** `data` nulo, cadena HTML, arreglo,
  `code` numérico, `details` ausente, `Retry-After` ausente: ninguno lanza antes de
  `_handleError`; todos producen mensaje en español con `request_id=…`. `_send` nunca
  deja `{response}` y `{error}` ambos indefinidos con un axios real.
- **Bifurcación por operación.** `_buildV2Body` y `_resolveUrl` mapean las tres operaciones
  con el mismo criterio y sin rama por omisión; `validateOperation` corre antes. No hay
  camino por el que `cancel_tax` entre a `getIntentFor`/`validateV2IntentFields` (espías
  sobre las instancias reales lo afirman) ni por el que un cuerpo de cálculo salga a
  `invoices/cancel`.
- **Fidelidad numérica.** Cero `parseFloat`, `Number(` y `parseInt` en `src/`. El
  `FileManager` real escribe las cadenas con comillas; la prueba sintética con `"0.10"` y
  `"1234567.89"` sí discrimina.
- **Compatibilidad con Node 14.15.** Sin `?.`, `??`, `.at()`, `structuredClone`,
  `AbortController`, `Object.hasOwn`, `replaceAll` ni `randomUUID` en `src/` ni `tests/`.
  El único API reciente es `fs.rmSync` (Node 14.14) y sólo en pruebas.
- **Fixtures.** I/O real de staging con identificadores de sandbox (`635`, `E635`) y valores
  de demostración; sin credenciales, sin nombres.

**Lo que sí se encontró** se concentra en dos puntos: (1) la guardia de presencia de la
proyección de cancelación deja pasar valores que no son cadenas ni "presencia" en ningún
sentido útil (`false`, `{}`, `[]`, `"  "`, números), y salen al cable; y (2) la suite del
reintento no protege que la espera de 1 s se **aguarde**: quitar el `await` de
`this.wait(...)` deja los 457 casos en verde. El resto son detalles de mensajes y de
consistencia con los invariantes que la propia fase declaró.

Patrones heredados del molde v1 que NO se reportan por ser deliberados y previos a la fase:
el trío de mensajes duplicados en stderr para un 4xx (`_handleResponse` → `_handleError`
→ `TaxCommandHandler._handleError`) y las dos entradas de winston por ese mismo camino (la
suite lo documenta como "molde de v1").

## Advertencias

### WR-01: La proyección de cancelación exige "presencia" pero deja pasar `false`, `{}`, `[]`, cadenas en blanco y números

> ✅ **RESUELTO** en `ee0c1c7` — cadena no vacía tras trim, mensaje con campo y tipo recibido; 8 casos nuevos.

**Archivo:** `src/api/synexusRequestBuilder.js:138-141`, `154-157`
**Problema:** `buildCancelBody` sólo rechaza `undefined`, `null` y `''`. Se comprobó
ejecutando el builder con el archivo que dejaría el ERP:

| `invoice_id` en el archivo | Resultado | Lo que sale al cable |
|---|---|---|
| `0` | pasa | `{"invoice_id":0,…}` |
| `false` | pasa | `{"invoice_id":false,…}` |
| `{}` | pasa | `{"invoice_id":{},…}` |
| `[]` | pasa | `{"invoice_id":[],…}` |
| `"   "` | pasa | `{"invoice_id":"   ",…}` |
| `12345` (y `customer_id: 987`) | pasa | `{"invoice_id":12345,"customer_id":987}` |

El contrato (fixture real y referencia de API) tipa los dos campos como cadenas
(`"DEMO-001"`, `"CUST-1"`). Un ERP que exporte el folio como número —Sage 300 lo hace
con frecuencia— o un campo vacío serializado como `0`/`false` atraviesa la guardia que la
fase diseñó precisamente para "abortar antes de la red con mensaje que nombre el campo",
y el operador recibe en su lugar el 400 genérico del proveedor ("el cuerpo no es válido")
sin saber cuál de los dos campos ni por qué. El docblock lo declara como decisión ("sólo se
exige presencia, no tipo"), pero `false`, `{}` y `[]` no son presencia en ningún sentido
útil y el mensaje actual diría, falsamente, que el campo sí está.
**Solución:** exigir cadena no vacía tras `trim()` y, si no lo es, nombrar campo y tipo
recibido. Si en la Fase 3 el área de ERP confirma que manda números, relajarlo
deliberadamente a `string|number` con su prueba; no al revés.

```js
const missingFields = ['invoice_id', 'customer_id'].filter(field => {
    const value = requestBody[field];
    return typeof value !== 'string' || value.trim() === '';
});

if (missingFields.length > 0) {
    const received = missingFields
        .map(field => `${field} (${requestBody[field] === undefined ? 'ausente' : typeof requestBody[field]})`)
        .join(', ');
    const errorMsg = 'Para cancelar bajo el contrato v2 el archivo debe traer "invoice_id" y "customer_id" ' +
        `como cadenas no vacías; falta(n) o no es cadena: ${received}. ` +
        'La cancelación aborta antes de emitir petición alguna.';
    // trío + throw
}
```

Añadir a `tests/synexusRequestBuilder.test.js` (bloque `buildCancelBody`) un `it.each` con
`0`, `false`, `{}`, `[]`, `'   '` y `12345` esperando `toThrow('invoice_id')`, y el espejo en
`tests/v2CancelEndToEnd.test.js` afirmando `axios` sin llamadas.

### WR-02: La suite del reintento no detecta que la espera deje de aguardarse: sin `await` en `this.wait(...)`, 457/457 en verde

> ✅ **RESUELTO** en `596c2ff` — espera controlada (axios en 1 hasta liberar) y espera que rechaza; verificado por mutación.

**Archivo:** `src/api/synexusApiClient.js:164`; `tests/synexusApiClient.test.js:1427-1620`;
`tests/v2QuoteEndToEnd.test.js:736-766`; `tests/v2CancelEndToEnd.test.js:490-523`
**Problema:** Todas las pruebas del reintento afirman `wait` **llamada** (`toHaveBeenCalledTimes(1)`,
`toHaveBeenCalledWith(1000)`) y `axios` llamada dos veces, pero ninguna afirma que la
segunda llamada ocurra **después** de que la espera resuelva. Se comprobó por mutación:

```
sed 's/await this.wait(this.retryDelayMs);/this.wait(this.retryDelayMs);/'  →  Tests: 457 passed, 457 total
```

Con esa regresión el CLI reintentaría de inmediato contra un backend que acaba de
contestar 502/503/504 —exactamente lo que el diseño de SAFE-02 ("espera breve entre
intentos", "peor caso ~61 s") quiere evitar— y la constante `retryDelayMs = 1000` que la
suite sí fija quedaría sin efecto real. Un `wait` que rechaza tampoco se prueba, aunque hoy
el rechazo sí escapa (está aguardado) y cae en `_handleError`.
**Solución:** un caso con una espera controlada que afirme la cuenta de `axios` mientras la
promesa está pendiente. Se verificó que discrimina: 1 llamada con el código actual, 2 con
la mutación.

```js
it('la segunda llamada a axios NO ocurre hasta que la espera resuelve: el await es real', async () => {
    let release;
    const wait = jest.fn(() => new Promise(resolve => { release = resolve; }));
    axios.mockRejectedValueOnce(createAxiosError({ code: 'ECONNABORTED', request: {} }))
        .mockResolvedValueOnce(okResponse());
    const client = createClient(undefined, { wait });

    const pending = client.makeRequest('get_tax', createRequestBody(), entityCode);
    await new Promise(resolve => setImmediate(resolve)); // deja correr las microtareas
    expect(wait).toHaveBeenCalledTimes(1);
    expect(axios).toHaveBeenCalledTimes(1);               // sin await, aquí ya serían 2

    release();
    await expect(pending).resolves.toEqual({ total_tax: '0.00' });
    expect(axios).toHaveBeenCalledTimes(2);
});

it('si la espera rechaza, makeRequest rechaza con ese error y no hay segundo intento', async () => {
    const wait = jest.fn(async () => { throw new Error('reloj roto'); });
    axios.mockRejectedValueOnce(createAxiosError({ code: 'ECONNABORTED', request: {} }))
        .mockResolvedValueOnce(okResponse());
    const client = createClient(undefined, { wait });

    await expect(client.makeRequest('get_tax', createRequestBody(), entityCode)).rejects.toThrow('reloj roto');
    expect(axios).toHaveBeenCalledTimes(1);
});
```

## Información

### IN-01: En un 5xx, `_handleError` vuelca `docs_url` a stderr y no lo registra en winston: el invariante de la fase sólo se cumple en el camino 4xx

**Archivo:** `src/api/synexusApiClient.js:533-539`, `576-577`
**Problema:** La decisión de la fase es "docs_url va sólo al log de winston, nunca a la
consola". `_handleResponse` (4xx) lo cumple con `_withoutDocsUrl` y `docsUrlNote`. Pero un
502/503/504 tras el reintento —o un 500— pasa por la rama `error.response` de
`_handleError`, que imprime `JSON.stringify(error.response.data)` entero (con `docs_url`,
comprobado con `{ code: 'upstream', request_id: 'rid-503', docs_url: … }`) y en el log
escribe sólo `HTTP 503 … request_id=rid-503`. Tampoco clasifica por `code` aunque el
cuerpo lo traiga.
**Solución:** en esa rama usar `this._withoutDocsUrl(error.response.data)` para la
consola y añadir al `detailedLog` el mismo `docsUrlNote` que construye `_handleResponse`.

### IN-02: `Retry-After` puede ser una fecha HTTP y el mensaje diría "Reintente en Wed, 21 Oct 2026 07:28:00 GMT segundos"

**Archivo:** `src/api/synexusApiClient.js:361-367`
**Problema:** RFC 7231 permite `Retry-After` en segundos **o** como fecha HTTP. El código
acepta cualquier cadena no vacía y le pega "segundos". Comprobado con el sondeo.
**Solución:** `/^\d+$/.test(retryAfter)` → "Reintente en N segundos"; en otro caso
"Reintente después de <valor>"; sin header, el texto actual.

### IN-03: `validation_error` con `details` que no es arreglo se reporta como "sin detalles" aunque el proveedor sí los mandó

**Archivo:** `src/api/synexusApiClient.js:370-374`
**Problema:** `Array.isArray(data.details)` falso (objeto o cadena) cae en `'sin detalles'`;
el operador sólo los ve si repara en el volcado "Respuesta del servidor". Comprobado con
`details: { field: 'zip' }`.
**Solución:** si `details` existe y no es arreglo, `JSON.stringify(details)`; reservar
"sin detalles" para ausente o vacío.

### IN-04: El mapa de status de la cancelación no cubre 401 ni 429: una llave equivocada en `cancel_tax` recibe el genérico "falló con HTTP 401"

**Archivo:** `src/api/synexusApiClient.js:394-408`
**Problema:** El contexto fijó 400/404/409/422 porque son los del catálogo del endpoint,
pero el 401 por llave de otro ambiente y el 429 los devuelve cualquier endpoint. En el
cálculo el 401 dice "La llave SYNEXUS_API_KEY fue rechazada… verifique el ambiente"; en la
cancelación dice "La cancelación falló con HTTP 401." Mismo error, diagnóstico distinto
según la operación.
**Solución:** añadir `status === 401` con el mismo texto que `invalid_key` y `status === 429`
con la lectura de `retry-after` (extraer ambos textos a ayudantes compartidos entre los dos
descriptores).

### IN-05: Tras un reintento, un 404/422 de cancelación en el segundo intento es ambiguo y el mensaje no lo dice

**Archivo:** `src/api/synexusApiClient.js:150-172`, `398-404`
**Problema:** Si el primer intento de `cancel_tax` cae por `ECONNABORTED`/502-504 pero el
proveedor sí lo procesó, el segundo intento devuelve 404/422 ("ya cancelada"), la corrida
termina en error y **no se escribe `RESPONSE_`**: el ERP cree que la cancelación falló
cuando la factura ya está cancelada en el proveedor. La ambigüedad es inherente al timeout
(el contexto la acepta), pero el reintento la hace más probable y hoy nada en la salida
avisa que hubo un primer intento.
**Solución:** que `_sendWithRetry` devuelva también `attempt` (o lo guarde en el error) y
que `_describeCancelError` para 404/422, cuando `attempt > 0`, agregue: "Hubo un reintento:
el primer intento pudo haber cancelado la factura; verifíquelo en el proveedor antes de
repetir." Registrar lo mismo en winston.

### IN-06: La lista cerrada del reintento no está congelada por la suite: agregar `ECONNRESET` deja 457/457 en verde

**Archivo:** `src/api/synexusApiClient.js:198-208`; `tests/synexusApiClient.test.js:1622-1723`
**Problema:** El bloque "lo que NUNCA se reintenta" cubre 500, `ECONNREFUSED`, `ENOTFOUND`,
un error genérico y los 4xx clasificados. Una mutación que añade `ECONNRESET` a la razón
de reintento sobrevive; lo mismo pasaría con `EAI_AGAIN`, `EPIPE` o `ERR_BAD_RESPONSE` sin
`response`. El comentario del método promete "lista CERRADA", pero la suite sólo fija
cinco ausencias concretas.
**Solución:** un `it.each` sobre `['ECONNRESET', 'EAI_AGAIN', 'EPIPE', 'ERR_BAD_RESPONSE', 'ETIMEDOUT']`
afirmando una sola llamada y `wait` sin llamadas, y otro sobre 501/505 rechazados por axios.

### IN-07: `v2ResponseFidelity.test.js` construye el cliente v2 real sin inyectar `wait`: el primer caso que provoque un reintento dormirá 1 s

**Archivo:** `tests/v2ResponseFidelity.test.js:275`
**Problema:** Las otras dos suites de recorrido pasan `{ wait: async () => {} }` y el
encabezado de `synexusApiClient.test.js` declara que ninguna prueba duerme. Aquí no se
pasa; hoy no hay reintento en ese archivo, así que no duele, pero es el único punto de
construcción de la suite que hereda el `setTimeout` real.
**Solución:** `new SynexusApiClient(synexusConfig, logger, { wait: async () => {} })`, con
el mismo comentario que en `buildGraph`.

### IN-08: La prueba de forma del fixture acepta como `meta.request_id` cualquier cadena de 36 caracteres hexadecimales o guiones

**Archivo:** `tests/v2ResponseFidelity.test.js:147`
**Problema:** `/^[0-9a-f-]{36}$/` acepta `"------------------------------------"` o 36
ceros. El resto de la prueba de forma es estricta (llaves exactas por `toEqual`, tipos por
monto); esta aserción es la única floja y es la que documenta el identificador que el
proveedor pide para soporte.
**Solución:** reutilizar el patrón `uuidV4Pattern` de `v2QuoteEndToEnd.test.js:39`
(8-4-4-4-12 con versión 4 y variante RFC 4122), o al menos `/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/`.

## Informativos de la Fase 1 (no se re-reportan)

Estado de los diez informativos de `01-REVIEW.md` visto desde el código de esta fase:

| Id | Estado | Nota |
|---|---|---|
| IN-01 flags repetidos | abierto | `taxCommandHandler.js:53`, `128` siguen con `find` |
| IN-02 guardia de cableado parcial | abierto | `_executeV2` toca `synexusConfig` (l. 233) antes de la guardia (l. 248) |
| IN-03 llave validada sólo por prefijo | abierto | `synexusConfig.js:102-105` |
| IN-04 `entity_id` sin comprobar tipo | abierto | `synexusConfig.js:236-238` |
| IN-05 `SynexusConfig` sin logger | abierto | — |
| IN-06 literales de flags en tres sitios | abierto | `taxCommandHandler.js:37`, `52`, `127` |
| IN-07 `showHelp` muerto | abierto | `taxCommandHandler.js:347-364`, ampliado otra vez |
| IN-08 entidad antes que la guardia v1 | **cerrado por esta fase** | `validateV2FileShape` corre antes de `resolveEntityCode` (`taxCommandHandler.js:230-233`) |
| IN-09 `package.json` sin `engines` | abierto | — |
| IN-10 ayudantes duplicados | abierto y **creció** | `buildGraph`/`capturedConsoleOutput` copiados también en `v2CancelEndToEnd.test.js` y `v2ResponseFidelity.test.js`; hoy `buildGraph`/`buildHandler` vive en 5 archivos, `capturedConsoleOutput` en 3, `createV2Body` en 4 |

---

_Revisado: 2026-09-11T22:02:41Z_
_Revisor: Claude (gsd-code-reviewer)_
_Profundidad: standard_
