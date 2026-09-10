# Phase 1: Camino v2 de punta a punta para una cotización - Context

**Gathered:** 2026-09-10
**Status:** Ready for planning
**Source:** Decisiones tomadas por Claude bajo delegación explícita del dueño del proyecto, para revisión posterior del interesado del negocio

<domain>
## Phase Boundary

Dejar el camino v2 funcionando de punta a punta para una cotización (`get_tax`), sin
que el camino v1 se mueva. Incluye: runner de pruebas, congelamiento del comportamiento
de v1, selector de contrato, resolución de configuración y código de entidad, frenos
que abortan antes de tocar la red, y la construcción y emisión de la petición v2 tipada
como estimación que no persiste nada del lado del proveedor.

Fuera de esta fase: `post_tax`, `cancel_tax`, fidelidad numérica de la respuesta y su
escritura al archivo de salida (Fase 2), y toda verificación en vivo (Fase 3).

</domain>

<decisions>
## Implementation Decisions

### Aislamiento del camino v1 — la decisión que ordena todo lo demás

- **`TaxApiClient` NO se modifica.** Ni una línea. El camino v2 vive en una clase
  hermana nueva, inyectada por separado en `index.js`.
- Razón: `COMP-01` exige que v1 conserve su comportamiento exacto. Si el archivo no se
  toca, esa garantía es demostrable por `git diff`, no por argumentación.
- `Config.getEndpointUrl()` tampoco se modifica. Los datos de v2 se exponen por
  métodos nuevos.
- El selector de contrato vive en la capa CLI, que decide qué cliente usar. Ninguna
  clase existente aprende que v2 existe.

### Selector de contrato

- Variable de entorno `TAX_API_VERSION`, valores `v1` | `v2`. **Ausente o vacía ⇒ `v1`.**
- Argumento de línea de comandos `--api-version=<v1|v2>`, que sobreescribe la variable.
- El envoltorio del ERP invoca `node index.js get_tax <archivo>` sin flags y debe seguir
  cayendo en v1 sin cambio alguno. El parseo de argumentos actual es estrictamente
  posicional (`taxCommandHandler.js:44-45`); los flags se aceptan en cualquier posición
  y se retiran antes de resolver los posicionales, para no correr los índices.
- Efecto colateral buscado: revertir producción a v1 es cambiar una línea de `.env`,
  sin desplegar código. Eso es lo que satisface `VERIF-04`.

### Qué campos son de nexgen y cuáles del archivo de entrada

- El JSON que deja el área de ERP es el cuerpo de la petición, igual que en v1 —
  **y ya viene en forma v2.** Es su lado del contrato: el área de ERP dijo textualmente
  que genera desde Sage *"un archivo JSON con lo que tú vas a mandar de body"*, y el
  cuerpo real que entregó como referencia ya usa `invoice_id`, `to_state`,
  `cart[].item_id`. nexgen **no traduce esquemas**; nunca lo hizo.
- **Consecuencia que el plan debe respetar: el archivo v2 NO trae `Committed` con
  mayúscula.** Ese campo es del contrato v1. Por tanto `validateCommittedField` (que lee
  `requestBody.Committed`) **no debe correr en la rama v2**: rechazaría todo archivo v2
  real con "el valor Committed debe ser false". La rama v2 llama a los métodos del
  validador por separado — `validateOperation`, `validateRequestBody`,
  `sanitizeStringFields` y el nuevo `validateV2IntentFields` — y nunca al agregador
  `validate()`, que queda intacto para v1.
- **`OPER-04` bajo v2 se cumple con `validateV2IntentFields`**, no con el chequeo de v1.
  La "validación estricta que impide invertir cotizar y confirmar" pasa a ser el chequeo
  `===` de `committed` y `transaction_type` contra la operación invocada. Es el mismo
  principio, sobre los campos del contrato que sí aplica.
- Guardia barata contra el error humano más probable: si un archivo en la rama v2 trae
  `Committed` con mayúscula, `validateV2IntentFields` aborta con un mensaje que diga que
  el archivo parece de v1. Es exactamente lo que pasaría si alguien deja un archivo viejo
  en la carpeta con el selector en v2.
- **Pero nexgen es dueño de los campos de intención**, porque de ellos depende que una
  cotización no cree registros: `transaction_type`, `committed` y `request_id` los pone
  nexgen a partir de la operación invocada, no se heredan del archivo.
- **Si el archivo de entrada ya trae un `transaction_type` que contradice la operación,
  la corrida aborta** en vez de sobreescribir en silencio. Una contradicción significa
  que la extracción cambió o que se invocó el comando equivocado, y las dos cosas
  merecen ojos humanos.
- Punto a revisar con el área de ERP: si su extracción empieza a incluir
  `transaction_type` de forma rutinaria, esta regla se vuelve ruidosa y hay que
  cambiarla por sobreescritura con aviso.

### Mapeo de `get_tax` (el riesgo caro de la fase)

- `get_tax` ⇒ `transaction_type: "sales_estimate"` **y** `committed: false`.
- El `sales_estimate` es lo que suprime la persistencia. El `committed: false` por sí
  solo NO basta: la referencia de API documenta que igual guarda un snapshot de factura,
  y el valor por omisión del campo es `sales_invoice`.
- `TEST-03` es la guardia de regresión de esto y es lo único que impide que un refactor
  futuro reintroduzca el registro fantasma. No es una prueba opcional.

### Runner de pruebas

- **Jest como `devDependency`**, fijado a una versión compatible con Node 14.15+.
- Razón: `ARCHITECTURE.md` §10 ya lo propone, así que no inventamos convención. Y a
  diferencia de `node:test`, funciona en Node 14 — importante porque la suite debe poder
  correrse también desde el servidor de la empresa (`VERIF-02`) y no sabemos su versión
  de Node.
- No altera las tres dependencias de runtime: `devDependencies` no se despliegan.
- `npm test` deja de ser el stub que falla y pasa a ejecutar la suite (`TEST-01`).

### Llave de idempotencia

- UUID v4 derivado de `crypto.randomBytes(16)`, un solo camino de código, sin detección
  de características.
- Razón: `crypto.randomUUID()` sólo existe desde Node 14.17 y no sabemos la versión
  exacta del servidor de producción. Cinco líneas eliminan ese riesgo por completo.

### Frenos antes de la red

- La correspondencia host ↔ prefijo de llave se valida al construir la configuración v2,
  antes de que exista siquiera una petición. Staging acepta sólo el prefijo de prueba;
  producción sólo el de producción.
- El perfil efectivo (contrato, host, entidad, prefijo enmascarado) se imprime al inicio
  de toda corrida v2, antes de cualquier salida a la red (`CONN-05`).
- Todos los abortos son `throw` con mensaje en español, atrapados en la capa CLI, que
  sale con código 1. Es el modelo de errores que ya usa el repositorio.

### Enmascaramiento de credenciales — alcance acotado a propósito

- `CFG-05` se aplica **sólo al camino v2**. La llave se imprime como prefijo + últimos
  cuatro caracteres.
- **`CFG-05` NO se aplica retroactivamente a v1**, aunque hoy `taxApiClient.js:32`
  imprime la URL completa con `?code=<API_CODE>` — es decir, v1 ya filtra su credencial
  a stdout.
- Razón del recorte: enmascararlo cambiaría la salida estándar de v1, y `COMP-01` exige
  que v1 conserve sus mensajes exactos. Las dos reglas se contradicen y v1 gana, porque
  no moverlo fue instrucción explícita.
- **Esta fuga queda registrada como deuda, no como algo aceptable.** Debe ir a los
  diferidos como `DEBT-04` para que no se pierda.

### Congelamiento de v1

- Las pruebas que congelan v1 verifican el método HTTP, la URL resuelta, el mecanismo de
  autenticación y los mensajes de error, contra el comportamiento actual.
- Se escriben leyendo el código tal como está hoy, no cómo debería ser. Si algo del
  comportamiento actual parece un defecto, se congela igual y se anota — corregirlo es
  otro milestone.

### Nombre del header de entidad — resuelto, no elegir por parecido

- **El header correcto es `X-Synexus-Entity`.** No `X-Syntax-Entity`.
- La colección de Postman trae los dos porque fue escrita anticipando el cambio de
  marca, con el nuevo desactivado. Esa colección quedó desfasada: el cambio ya ocurrió
  del lado del proveedor.
- La referencia de API documenta el nombre viejo porque es anterior al cambio de marca.
- Evidencia que decide: existe una petición real contra staging, del 9-sep-2026, que usó
  `X-Synexus-Entity` y devolvió `200` con cuerpo completo. Una respuesta real gana sobre
  documentación desfasada. El correo con esa petición y su respuesta está en `data/`.
- Corolario: el prefijo de llave vigente también es el de la marca nueva, no el anterior.

### No replicar el patrón singleton de `Config` en el camino v2

- `src/config/index.js:91` exporta una instancia ya construida, y ese constructor valida
  variables de entorno, es decir **lanza en tiempo de `require`**.
- Replicar esa forma para v2 rompería toda corrida v1 en un servidor que no tenga las
  variables de v2 configuradas, y haría imposible `TEST-06` (suite sin credenciales).
- La configuración v2 **exporta la clase**, e `index.js` la construye únicamente cuando
  el selector ya resolvió v2.

### Restricciones que heredan las pruebas

- Las pruebas no pueden hacer `require` de `src/config` (lanza al cargar) ni de
  `index.js` (ejecuta `main()` al cargarse).
- Los dobles de prueba son objetos literales. Es viable precisamente porque toda clase
  recibe a sus colaboradores por constructor.
- **El directorio de pruebas no puede llamarse `test-files`**: ese nombre ya está en
  `.gitignore` y las pruebas quedarían fuera de git sin aviso. Usar `tests/` o
  `__tests__/`.
- Jest se fija en `29.7.0`, cuyo campo `engines` es `^14.15.0 || ^16.10.0 || >=18.0.0`
  — coincide con el piso de Node que asumimos. Jest 30 sube ese piso y no sirve.

### Claude's Discretion

- Nombres exactos de archivos y clases nuevos, respetando el camelCase en inglés y la
  distribución por capas que ya existe.
- Cómo se organiza el módulo que arma el cuerpo v2 y dónde vive dentro de la capa API.
- Estructura interna de los archivos de prueba y qué se factoriza como ayudante común.
- Formato exacto de la línea de perfil que se imprime al inicio.
- Si la resolución del código de entidad vive en `Config` o en un colaborador aparte
  — ver el riesgo abierto abajo.

</decisions>

<code_context>
## Existing Code Insights

### Lo que se reutiliza tal cual
- `src/storage/fileManager.js` — lectura del JSON de entrada. Sin cambios en esta fase.
- `src/infrastructure/logger.js` — winston nivel `error`. El camino v2 usa el mismo.
- `index.js` — único lugar donde se arma el grafo de dependencias. Todo lo nuevo se
  cablea ahí y en ningún otro sitio (`COMP-04`).

### Lo que se extiende sin modificar comportamiento existente
- `src/config/index.js` — se le añaden métodos para v2. `getEndpointUrl()`,
  `_validateRequiredEnvVars()` y el conjunto de variables requeridas por v1 no cambian:
  las variables nuevas de v2 sólo son obligatorias cuando el contrato seleccionado es v2.
- `src/cli/taxCommandHandler.js` — `parseArguments()` aprende a retirar flags antes de
  resolver posicionales; el resto del ciclo de vida no cambia.
- `src/validators/taxValidator.js` — la validación estricta de `Committed` sigue vigente
  (`OPER-04`); se le suma la validación de los campos de intención de v2.

### Lo que no se toca
- `src/api/taxApiClient.js` — congelado. Cualquier necesidad de tocarlo es señal de que
  el diseño se desvió.

</code_context>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Contrato y decisiones del milestone
- `.planning/PROJECT.md` — Key Decisions, restricciones, y qué quedó fuera de alcance con su razón
- `.planning/REQUIREMENTS.md` — los 21 requisitos de esta fase con su redacción exacta
- `.planning/ROADMAP.md` — criterios de éxito de la Fase 1 y la nota sobre `OPER-01`

### Estado del código
- `.planning/codebase/ARCHITECTURE.md` — las cinco capas, el ciclo de vida y el modelo de errores
- `.planning/codebase/CONVENTIONS.md` — estilo, nombres y manejo de errores vigentes
- `.planning/codebase/CONCERNS.md` — deuda preexistente; casi toda deliberadamente fuera de alcance
- `CLAUDE.md` — convenciones del repositorio y la lista de "no tocar a la ligera"

### Contrato del proveedor
- `data/API_REFERENCE.pdf` — referencia definitiva. La semántica de `transaction_type`,
  `committed` y `test_transaction` está en la pág. 11; el catálogo de errores en la pág. 7.
  **Excluido de git: no citar su contenido dentro de `.planning/`.**
- `postman/synexus-v2-api.postman_collection.json` — contrato ejecutable, sin credenciales

</canonical_refs>

<specifics>
## Specific Ideas

- Existe una respuesta real de staging obtenida el 9-sep-2026, que sirve como fixture de
  contrato. **Ojo: hoy no existe como archivo `.json`** — vive dentro de un PDF de correo
  en `data/`. Extraerla a un `.json` es trabajo pendiente, pero **no bloquea esta fase**:
  su consumo formal es `VERIF-01`, de la Fase 2. En esta fase sólo se usa como referencia
  de la forma esperada.
- Esa misma respuesta muestra impuesto `0.00` con `exemption.source: "no_nexus"`. **Un
  cero ahí no es un defecto**: la entidad de sandbox no tiene nexo en ese estado. Ninguna
  prueba debe tratar un cero como fallo.
- El contrato v2 devuelve montos como cadenas decimales (`"49.99"`). Ya se ve en la
  respuesta archivada.
- La ruta del cálculo es la de la referencia de API, sin `/calculate`. La guía de
  migración dice otra cosa; gana la referencia porque coincide con la respuesta real que
  devolvió `200`.

</specifics>

<deferred>
## Deferred Ideas

- **`DEBT-04` (nuevo, surgido al decidir esta fase)** — v1 imprime su credencial a stdout
  en `src/api/taxApiClient.js:32`. No se corrige aquí porque cambiaría la salida de v1 y
  `COMP-01` lo prohíbe. Debe añadirse a los diferidos de `.planning/REQUIREMENTS.md`.
- `post_tax` y `cancel_tax` contra v2 — Fase 2.
- Fidelidad numérica de la respuesta y escritura al archivo de salida — Fase 2.
- Toda ejecución en vivo contra staging — Fase 3, y la ejecuta el área de ERP.
- Actualización de dependencias vulnerables, URL base obsoleta, sobrescritura de archivos
  de respuesta y la fecha fija del logger — diferidos del milestone, ya registrados.

</deferred>

<open_risks>
## Riesgos abiertos que la planeación debe considerar

- **El mecanismo de entrega del código de entidad sigue sin definirse con el área de ERP.**
  Quedó explícitamente abierto en la reunión del 9-sep. `Config` es hoy un singleton de
  proceso, sin lugar natural para un valor que varía por petición. La precedencia
  decidida (argumento CLI > variable de entorno > campo del JSON) absorbe cualquiera de
  las tres formas en que lo entreguen, pero la superficie pública de `Config` puede tener
  que cambiar, con repercusión en el parseo de argumentos del CLI.
- **`tax_code` es obligatorio en cada línea del `cart[]` del contrato v2.** Si falta o va
  vacío, el proveedor rechaza toda la petición con `422 tax_code_missing`. nexgen no lo
  inyecta ni lo valida —el cuerpo es del área de ERP— así que depende de que la
  extracción de Sage lo emita siempre. El cuerpo de referencia del 9-sep sí lo trae
  (`"TPP"`). **A confirmar con el área de ERP junto con la forma del archivo**, antes de la
  Fase 3, para no descubrirlo en vivo. Tres valores se aceptan sin mapeo previo: `TPP`,
  `SHIPPING`, `HANDLING`; un código no mapeado no es error, se cobra como `TPP` con un
  warning `tax_code_unmapped`.
- **La versión de Node del servidor de producción es desconocida.** `package.json` no
  tiene campo `engines` y la documentación sólo dice "14 o superior". Las decisiones de
  Jest y del UUID están tomadas para el piso más bajo de ese rango.

</open_risks>

---

*Phase: 01-camino-v2-de-punta-a-punta-para-una-cotizaci-n*
*Context gathered: 2026-09-10*
