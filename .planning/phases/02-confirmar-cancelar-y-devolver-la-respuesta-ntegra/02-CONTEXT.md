# Phase 2: Confirmar, cancelar y devolver la respuesta íntegra - Context

**Gathered:** 2026-09-11
**Status:** Ready for planning
**Source:** Decisiones tomadas por Claude bajo delegación explícita del dueño del proyecto (modo autónomo), verificadas contra `data/API_REFERENCE.pdf` y contra el código que dejó la Fase 1

<domain>
## Phase Boundary

Migrar las dos operaciones restantes al contrato v2 —`post_tax` (confirmar) y `cancel_tax`
(cancelar)— y garantizar que la respuesta del proveedor llegue **íntegra** al archivo que
lee el ERP: mismos dígitos, mismo nombre de archivo, con el identificador de petición
registrado y los errores clasificados por su código estable. Incluye el fixture de contrato
tomado de la respuesta real de staging y cerrar las dos advertencias del code review que se
difirieron a esta fase (WR-03, WR-04).

Al terminar esta fase, **las tres operaciones funcionan contra v2** y el encargo del área
de ERP —"que funcione para la v2, igual que la uno, sólo apuntando"— queda cubierto en
código. Lo que sigue (Fase 3) es la verificación en vivo, que ejecuta el área de ERP.

Fuera de esta fase: cualquier llamada real al proveedor, el procedimiento de staging, la
lista de corte, y `PATCH /invoices/update` (promoción de snapshot — NEW-02, diferido).

</domain>

<decisions>
## Implementation Decisions

### `post_tax` → mismo endpoint, intención invertida

- `post_tax` ⇒ `POST /api/v1/tax_calculations` con `transaction_type: "sales_invoice"` **y**
  `committed: true`. Es la única combinación que registra una factura confirmada.
- Se añade al mapeo de `SynexusRequestBuilder.getIntentFor`, que sigue sin rama por omisión:
  `cancel_tax` y cualquier otra operación siguen lanzando desde ahí para el camino de
  cálculo — pero ver abajo, porque `cancel_tax` ya no pasa por ese mapeo.
- `validateV2IntentFields` ya cubre la contradicción: un archivo con `committed: false` o
  `transaction_type: "sales_estimate"` bajo `post_tax` aborta. La guardia de archivo v1
  (`Committed` con mayúscula) también aplica. No hay validación nueva que inventar.
- `TEST-02` para `post_tax`: el cuerpo construido afirma `sales_invoice` **y** `committed
  === true`, y niega `sales_estimate` — el espejo exacto de `TEST-03`.

### `cancel_tax` → otro endpoint, otro cuerpo, otra forma de error

- `cancel_tax` ⇒ `POST /api/v1/invoices/cancel`. **No** es `tax_calculations`.
- El contrato (API Reference, sección *Cancel a Transaction*) exige exactamente dos campos
  en el cuerpo: `invoice_id` y `customer_id`. Nada más.
- **El cuerpo de cancelación es una proyección, no un paso directo:** nexgen toma
  `invoice_id` y `customer_id` del archivo del ERP y construye `{ invoice_id, customer_id }`.
  Ningún otro campo del archivo viaja. Razón: el archivo del ERP tiene la forma del cálculo
  (cart, direcciones…) y el endpoint de cancelación no documenta qué hace con campos
  extra. Proyectar es lo único que respeta el contrato tal como está escrito. Esto NO es
  traducir esquemas —los dos nombres son los mismos del contrato v2— es elegir qué mandar.
- Si falta `invoice_id` o `customer_id` en el archivo, la corrida aborta **antes de la red**
  con mensaje en español que nombra el campo. El proveedor devolvería `400`; fallar antes es
  más barato y más claro.
- `cancel_tax` **no** lleva `transaction_type`, `committed` ni `request_id`. Ninguno está
  documentado para este endpoint y `CLAUDE.md` prohíbe inventar campos. `SAFE-01` ("toda
  petición v2 lleva llave de idempotencia") queda acotado a las peticiones de cálculo, y
  esta excepción se registra aquí con su razón: la cancelación es idempotente por
  naturaleza — repetirla sobre una factura ya cancelada devuelve `404`/`422` sin doble
  efecto, y el `409` de este endpoint está documentado como *"safe to retry immediately"*.
- `cancel_tax` **no** pasa por `getIntentFor` ni por `validateV2IntentFields` (no hay
  intención que validar; la guardia de archivo v1 sí se conserva porque es barata y
  atrapa el mismo error humano). El builder expone un método distinto para el cuerpo de
  cancelación; el manejador decide cuál llamar según la operación.
- La respuesta de cancelación tiene otra forma: `{ message, updated_invoices, invoice_id,
  client_id, entity_id }`. Se escribe tal cual al archivo `RESPONSE_`, como cualquier otra.
- Los errores de cancelación vienen en forma **simple** `{ error, message }`, **sin `code`**.
  Ver "clasificación de errores" abajo.

### Un reintento en proceso, con la misma llave — y sólo cuando es seguro

- `SAFE-02` presupone que existe un reintento. Sin lógica de reintento en nexgen, el
  "reintento" sería un humano volviendo a correr el CLI: proceso nuevo, `request_id` nuevo,
  y un `post_tax` podría **registrar la factura dos veces**. Por eso el reintento vive
  dentro del proceso.
- `SynexusApiClient` reintenta **una sola vez**, con el **mismo cuerpo ya construido** (por
  tanto el mismo `request_id`), sólo ante: timeout (`ECONNABORTED`), `502`, `503`, `504`, y
  —para cancelación— el `409` que el contrato marca como seguro. Espera breve entre
  intentos (del orden de un segundo; el planner fija el valor).
- **Nunca** reintenta `4xx` de validación ni `401`, ni el `409 idempotency_key_conflict`
  del cálculo: ese conflicto significa "misma llave, cuerpo distinto", es decir, alguien
  cambió el archivo entre corridas — merece ojos humanos, no un reintento.
- Un solo reintento, no una política configurable. Con timeout de 30 s, el peor caso es
  ~61 s, aceptable para un CLI de una invocación. Más reintentos alargan la corrida sin
  mejorar la probabilidad de éxito contra un backend caído.
- El reintento se registra en stdout (*"Reintentando (1/1) con la misma llave…"*) para que
  una corrida lenta sea diagnosticable.

### Fidelidad numérica: no hacer nada, y probar que no se hizo nada

- El contrato v2 devuelve montos y tasas como cadenas (`"49.99"`, `"0.0825"`). axios los
  entrega como cadenas; `FileManager.writeJsonFile` hace `JSON.stringify(data, null, 2)`;
  las cadenas sobreviven solas. **`SAFE-04` se cumple por paso directo.**
- Lo que la fase añade es la **prueba** (`TEST-04`): con el `FileManager` **real**
  escribiendo a un directorio temporal y la respuesta real de staging como entrada, el
  archivo resultante contiene `"tax_amount": "0.00"` y `"pre_tax_amount": "49.99"` como
  cadenas — con comillas — y **no** `0` ni `49.99` sin comillas. Además, un `grep` de
  aceptación: cero `parseFloat`, `Number(` y `+` unario sobre campos de respuesta en
  `src/`.
- No se agrega ninguna capa de "normalización" de montos. Cualquier transformación es un
  lugar donde se puede perder un dígito.

### Clasificación de errores por código estable, con la forma simple como respaldo

- Los errores del **cálculo** (`tax_calculations`) traen `{ error, code, message,
  request_id, details[], warnings[], docs_url }`. `SynexusApiClient` ramifica por
  `response.data.code` cuando existe. Códigos que reciben mensaje propio en español:
  `invalid_key` (401), `tax_code_missing` (422), `idempotency_key_conflict` (409),
  `invoice_stale_object` (409), `rate_limited` (429, leer `Retry-After`), `cart_empty`
  (422), `validation_error` (422, listar `details[]`). El resto cae a un mensaje genérico
  que **incluye el `code` literal** para que el operador pueda buscarlo.
- Los errores de **cancelación** no traen `code`. Ahí se clasifica por **status HTTP**
  (`400`, `404`, `422`, `409`) y se muestra `message` tal cual, **sin ramificar por su
  texto**. Nunca `if (message.includes(...))`.
- El `docs_url` que viene en los errores apunta a un host que no resuelve (verificado el
  10-sep). Se registra en el log por si algún día vive, pero no se le dice al operador que
  lo abra.

### El identificador de petición del proveedor se registra siempre

- Éxito: `meta.request_id` del cuerpo (cálculo) y el header `X-Request-Id` (todos los
  endpoints). Se imprime en stdout en la línea de éxito: *"SUCCESS: … request_id=…"*.
- Error con respuesta: `request_id` del cuerpo de error o el header. Va **en el mensaje
  de error y en el log de winston**, porque es lo que el proveedor pide para soporte.
- Error sin respuesta (timeout, red): no hay identificador del proveedor; se registra el
  `request_id` que **nexgen** generó, para poder correlacionar si el proveedor sí lo recibió.

### El contrato de archivos no cambia — y ahora tiene prueba con el `FileManager` real

- `COMP-02`/`COMP-03` ya se cumplen estructuralmente: la rama v2 devuelve la respuesta al
  paso 7 de `execute()`, que llama al mismo `_saveResponse` que v1. No se toca.
- Lo que falta es **probarlo con el `FileManager` real** (el mapa del código señala que
  hoy nunca se instancia en pruebas: siempre se dobla). La prueba de punta a punta de esta
  fase usa `FileManager` real sobre `os.tmpdir()` y afirma: nombre `RESPONSE_<original>`,
  numeración intacta, directorio de salida, y cuerpo idéntico al que devolvió el doble de
  axios (comparación por `JSON.parse` del archivo, no por cadena, para no acoplarse al
  formato de indentación).

### Fixture de contrato — de `data/` a `tests/`

- La respuesta y la petición reales del 9-sep ya están extraídas en `data/fixtures/`
  (fuera de git). Para que una prueba las use tienen que estar en el repositorio: se
  **copian** a `tests/fixtures/synexus-staging-2026-09-09-{request,response}.json`.
- Es seguro versionarlas: no contienen credenciales, nombres de personas ni del cliente.
  `entity_id: 635` y `client_id: "E635"` son identificadores del sandbox; `DEMO-001` y
  `CUST-1` son valores de demostración. `data/fixtures/README.md` lo documenta.
- `VERIF-01`: una prueba carga el fixture y afirma su **forma** — llaves de primer nivel
  (`transaction`, `origin`, `destination`, `totals`, `cart`, `warnings`, `meta`), que todo
  monto de `totals` y `cart[]` es cadena, que `meta.request_id` existe y que `warnings` es
  array. Otra prueba alimenta ese mismo fixture al doble de axios y verifica que el archivo
  escrito es idéntico. Si el proveedor cambia la forma y alguien actualiza el fixture, la
  primera prueba se pone en rojo y obliga a mirar.
- El fixture muestra `tax_amount: "0.00"` por `exemption.source = "no_nexus"`. **Ninguna
  prueba debe tratar el cero como fallo.**

### WR-03 — el escape de apóstrofos no aplica a v2

- `sanitizeStringFields` reemplaza `'` por `\'`. Fue un parche para la API legada de v1.
  En el cable v2, `JSON.stringify` escapa la barra invertida y el proveedor recibe
  literalmente `O\'Brien`: **datos corruptos en sus registros fiscales.**
- **La rama v2 deja de llamar a `sanitizeStringFields`.** Los strings del archivo viajan
  tal cual; JSON ya sabe entrecomillar. `validateRequestBody` sí se conserva.
- `sanitizeStringFields` **no se modifica**: v1 lo sigue usando y `COMP-01` lo protege.
- Prueba: un archivo con `"address_line1": "O'Brien St"` produce un cuerpo v2 con la
  cadena intacta (sin barra), y la prueba de congelamiento de v1 sigue viendo el escape.
- Consecuencia sobre el plan 01-02: su gate contaba exactamente 2 llamadas en
  `_executeV2` (`validateRequestBody` + `sanitizeStringFields`). Pasa a 1. Actualizar la
  prueba correspondiente, no debilitarla.

### WR-04 — un JSON cuyo raíz es un array se rechaza en la rama v2

- `validateRequestBody` acepta arrays (`typeof [] === 'object'`). En la rama v2, un array
  raíz se esparce como `{ "0": {...} }` y sale a la red. Se rechaza **antes**, en la rama
  v2, con mensaje en español: *"El archivo de entrada debe ser un objeto JSON, no un
  arreglo"*. `validateRequestBody` no se modifica (v1 lo usa).

### Claude's Discretion

- Nombre del método del builder para el cuerpo de cancelación y cómo el manejador elige
  entre cálculo y cancelación (un mapa operación → constructor, o un `if`; sin rama por
  omisión en ningún caso).
- Dónde vive la lógica de reintento dentro de `SynexusApiClient` y cómo se inyecta el
  reloj/espera para que la prueba no duerma de verdad.
- Estructura exacta de los mensajes por código de error, mientras incluyan el `code` y el
  `request_id`.
- Si el cliente v2 resuelve la URL de cancelación pidiéndosela a `SynexusConfig`
  (`getCancelUrl()`) o construyéndola desde `getBaseUrl()`; preferible lo primero, por
  simetría con `getCalculationUrl()` y porque `SynexusConfig` ya valida la base.

</decisions>

<code_context>
## Existing Code Insights

### Lo que esta fase extiende
- `src/api/synexusRequestBuilder.js` — `getIntentFor` gana `post_tax`; se añade el
  constructor del cuerpo de cancelación. `_generateRequestId` y `buildRequestBody` no
  cambian de contrato.
- `src/api/synexusApiClient.js` — reintento único, clasificación por `code`/status,
  registro de `request_id`, URL de cancelación. Sigue siendo hermano de `TaxApiClient`.
- `src/cli/taxCommandHandler.js` — `_executeV2` deja de llamar a `sanitizeStringFields`,
  rechaza arrays, y elige constructor de cuerpo por operación. `execute()` y la rama v1
  no cambian.
- `src/config/synexusConfig.js` — `getCancelUrl()`, si el planner opta por eso.
- `tests/` — `synexusRequestBuilder.test.js`, `v2IntentValidation.test.js`,
  `synexusApiClient.test.js`, `v2QuoteEndToEnd.test.js` crecen; se añade
  `tests/fixtures/` y la prueba de contrato.

### Lo que no se toca
- `src/api/taxApiClient.js` — congelado.
- `validate()`, `validateCommittedField`, `sanitizeStringFields`, `validateRequestBody` en
  `src/validators/taxValidator.js` — v1 los usa; `COMP-01` los protege.
- `src/storage/fileManager.js` — `writeJsonFile` ya hace lo correcto; la fase lo **prueba**,
  no lo cambia.
- `tests/v1Freeze.*.test.js` — intactos.

### Estado de partida (Fase 1 cerrada)
- 9 suites / 242 pruebas en verde, sin `.env`, sin red.
- `_executeV2` hoy: `validateRequestBody` → `sanitizeStringFields` → `resolveEntityCode` →
  `printProfile` → `getIntentFor` → `validateV2IntentFields` → `buildRequestBody` → guardia →
  `makeRequest` → return. Esta fase cambia el segundo paso (se va) y bifurca del quinto en
  adelante según la operación.

</code_context>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Decisiones y estado
- `.planning/PROJECT.md` — Key Decisions; requisitos ya validados en Fase 1
- `.planning/REQUIREMENTS.md` — los 11 requisitos de esta fase con su redacción exacta
- `.planning/ROADMAP.md` — los 6 criterios de éxito de la Fase 2
- `.planning/phases/01-camino-v2-de-punta-a-punta-para-una-cotizaci-n/01-CONTEXT.md` —
  decisiones de la Fase 1 que siguen vigentes (aislamiento de v1, dueño de los campos de
  intención, `X-Synexus-Entity`, UUID desde `randomBytes`, `CFG-05` acotado a v2)
- `.planning/phases/01-camino-v2-de-punta-a-punta-para-una-cotizaci-n/01-REVIEW.md` —
  WR-03 y WR-04 con su evidencia ejecutada; los 10 informativos abiertos

### Código (mapa refrescado el 2026-09-11)
- `.planning/codebase/ARCHITECTURE.md` — los dos caminos con `file:line`; `_executeV2`
  en `taxCommandHandler.js:211-253`
- `.planning/codebase/TESTING.md` — cómo están montadas las 9 suites, los dobles, y la
  convención de validar por mutación
- `.planning/codebase/CONCERNS.md` — `fileManager.js` y `logger.js` nunca instanciados en
  pruebas; los 10 informativos con líneas actuales

### Contrato del proveedor
- `data/API_REFERENCE.pdf` — sección *Cancel a Transaction* (cuerpo `{ invoice_id,
  customer_id }`, respuesta, errores sin `code`); catálogo de errores del cálculo (pág. 7,
  con `code`); `request_id` en la tabla de campos del cuerpo (pág. 10). **Excluido de git:
  no citar su contenido dentro de `.planning/`.**
- `data/fixtures/synexus-staging-2026-09-09-{request,response}.json` — petición y respuesta
  reales; copiar a `tests/fixtures/` en esta fase

</canonical_refs>

<specifics>
## Specific Ideas

- La respuesta real trae `transaction_purpose: "invoice"` **y** `transaction_type:
  "sales_invoice"` a la vez (ventana de deprecación del proveedor). La prueba de forma del
  fixture no debe exigir que `transaction_purpose` desaparezca.
- `X-Request-Id` es header de **respuesta** en todos los endpoints; `meta.request_id` sólo
  en el cuerpo del cálculo. Leer los dos y preferir el del cuerpo cuando exista.
- Para `TEST-04` conviene una segunda entrada además del fixture: una respuesta sintética
  con `"tax_rate": "0.0825"` y `"tax_amount": "1234567.89"` — valores donde un
  `parseFloat` + `stringify` sí cambiaría dígitos o el formato — para que la prueba no
  dependa de que el fixture real tenga ceros.
- El `409` del cálculo tiene dos códigos distintos con semántica opuesta:
  `idempotency_key_conflict` (no reintentar) e `invoice_stale_object` (concurrencia;
  reintentar es razonable). Ramificar por `code`, no por status.

</specifics>

<deferred>
## Deferred Ideas

- Procedimiento de verificación contra staging, lista de corte, reversión a v1 — Fase 3.
- `PATCH /api/v1/invoices/update` — NEW-02, sin equivalente en el CLI.
- Los 10 informativos del review (IN-01…IN-10) — ninguno bloquea; el planner puede tomar
  los que caigan naturalmente en archivos que ya toca, sin abrir alcance por ellos.
- Documentar v2 en `ARCHITECTURE.md`, `RUNBOOK.md`, `HANDOFF.md` del repositorio — el mapa
  lo señala como vacío. Va con la Fase 3, junto con el procedimiento operativo.
- Pruebas que instancien `logger.js` real — fuera de alcance; esta fase sólo cubre
  `fileManager.js` real porque `COMP-02/03` lo exigen.

</deferred>

<open_risks>
## Riesgos abiertos que la planeación debe considerar

- **Sigue sin confirmarse con el área de ERP** la forma del JSON v2, que `tax_code` venga
  en cada línea, y cómo entregan el código de entidad. Nada de esto bloquea la Fase 2
  (todo es sin red), pero condiciona la Fase 3. Mensaje redactado y pendiente de envío.
- **El archivo de cancelación del ERP**: se asume que trae `invoice_id` y `customer_id` con
  esos nombres (forma v2). Si el ERP deja para cancelar un archivo con otra forma, la
  proyección aborta antes de la red con mensaje claro — es el comportamiento deseado, pero
  hay que decírselo al área de ERP en la Fase 3.
- **Dos agentes se atoraron en la Fase 1** (fixer y verifier) por inactividad de stream.
  Si vuelve a pasar, el orquestador ejecuta el paso directamente; el árbol siempre queda
  en estado commiteable entre pasos.

</open_risks>

---

*Phase: 02-confirmar-cancelar-y-devolver-la-respuesta-ntegra*
*Context gathered: 2026-09-11*
