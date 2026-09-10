# Phase 1: Camino v2 de punta a punta para una cotización - Mapa de Patrones

**Mapped:** 2026-09-10
**Archivos analizados:** 14 (5 nuevos de código, 5 modificados, 4+ de prueba/config sin análogo)
**Análogos encontrados:** 8 / 14

> **Regla que ordena todo este documento:** `src/api/taxApiClient.js` está **CONGELADO**.
> Es el análogo del que más se copia y el archivo que nunca se edita. Cada excerpt que
> viene de ahí es material de copia, no de modificación. La garantía de `COMP-01` se
> demuestra con `git diff`, no con argumentos.

---

## Clasificación de archivos

| Archivo nuevo/modificado | Rol | Flujo de datos | Análogo más cercano | Calidad |
|---|---|---|---|---|
| `src/api/synexusApiClient.js` *(nuevo)* | api-client | request-response | `src/api/taxApiClient.js` | **exacto** (copiar de) |
| `src/api/synexusRequestBuilder.js` *(nuevo)* | transform/builder | transform | `src/validators/taxValidator.js:76-95` + `src/config/index.js:65-79` | parcial (dos fuentes) |
| `src/config/synexusConfig.js` *(nuevo)* | config | lookup + validación al construir | `src/config/index.js` | rol (con una divergencia crítica) |
| `src/cli/taxCommandHandler.js` *(modificado)* | cli | request-response | sí mismo, `parseArguments` líneas 34-47 | exacto (auto-análogo) |
| `src/config/index.js` *(modificado)* | config | lookup | sí mismo, getters líneas 32-58 | exacto (auto-análogo) |
| `src/validators/taxValidator.js` *(modificado)* | validator | validación/transform | sí mismo, `validateCommittedField` líneas 38-55 | exacto (auto-análogo) |
| `index.js` *(modificado)* | composition root | wiring | sí mismo, líneas 24-29 y 37-55 | exacto (auto-análogo) |
| `package.json` *(modificado)* | config | — | sí mismo, línea 6 (`scripts.test`) | exacto (auto-análogo) |
| `jest.config.js` *(nuevo)* | config | — | **ninguno** | ninguno |
| `tests/helpers/fakes.js` *(nuevo)* | test-helper | — | **ninguno** | ninguno |
| `tests/v1Freeze.test.js` *(nuevo)* | test | request-response | **ninguno** | ninguno |
| `tests/synexusRequestBuilder.test.js` *(nuevo)* | test | transform | **ninguno** | ninguno |
| `tests/synexusConfig.test.js` *(nuevo)* | test | validación | **ninguno** | ninguno |
| `tests/argumentParsing.test.js` *(nuevo)* | test | transform | **ninguno** | ninguno |

**Nota sobre nombres:** el `CONTEXT.md` deja los nombres exactos a discreción. Los de
arriba son propuestas que respetan camelCase en inglés y la distribución por capas. El
prefijo `synexus` separa visualmente v2 (proveedor Synexus Compute) de v1 (`tax*` /
`STCCalcV3`) sin que ninguna clase existente tenga que aprender que v2 existe.

---

## Asignación de patrones

### `src/api/synexusApiClient.js` (api-client, request-response)

**Análogo:** `src/api/taxApiClient.js` — **congelado, copiar de él, nunca editarlo.**

**Encabezado, JSDoc de clase y constructor DI** (`src/api/taxApiClient.js:1-20`):

```javascript
// src/api/taxApiClient.js
const axios = require('axios');

/**
 * API Layer - Tax API Client
 * Responsabilidad: Gestionar todas las peticiones HTTP a la API de impuestos
 * Principio SOLID: Single Responsibility Principle (SRP)
 * Patrón: Dependency Injection
 */
class TaxApiClient {
    /**
     * Constructor con inyección de dependencias
     * @param {Config} config - Configuración de la aplicación
     * @param {Logger} logger - Instancia del logger
     */
    constructor(config, logger) {
        this.config = config;
        this.logger = logger;
        this.timeout = 30000; // 30 segundos
    }
```

Copiar tal cual: la línea 1 con la ruta relativa del archivo, el bloque JSDoc con
"Responsabilidad" + principio SOLID, y el constructor posicional `(config, logger)`.
El `this.timeout = 30000` también se copia — es el valor que `CLAUDE.md` marca como
"no tocar a la ligera" y no hay razón para que v2 use otro.

**Punto de entrada `makeRequest`** (`src/api/taxApiClient.js:29-55`):

```javascript
    async makeRequest(operation, requestBody) {
        const url = this.config.getEndpointUrl(operation);

        console.log(`Realizando petición ${operation.toUpperCase()} a: ${url}`);
        console.log(`Enviando datos: ${JSON.stringify(requestBody, null, 2)}`);

        try {
            const response = await axios({
                method: 'GET',
                url: url,
                data: requestBody,
                headers: {
                    'Content-Type': 'application/json'
                },
                timeout: this.timeout,
                validateStatus: function (status) {
                    // Considera exitosos todos los códigos de estado para manejarlos manualmente
                    return status < 500;
                }
            });

            return this._handleResponse(response, url, operation);
        } catch (error) {
            this._handleError(error, url, operation);
            throw error;
        }
    }
```

**Qué se copia de esta forma:** la firma `async makeRequest(operation, requestBody)`,
el objeto de configuración de axios en una sola llamada, `validateStatus` con corte en
500 (los 4xx se manejan a mano en `_handleResponse`, los 5xx los lanza axios y los
atrapa `_handleError`), y el `try/catch` que delega en `_handleError` y **re-lanza el
error original sin envolverlo**.

**Qué diverge a propósito — el planeador debe listarlo explícitamente para que nadie
copie de más:**

| Línea del análogo | v1 (congelado) | v2 | Requisito |
|---|---|---|---|
| 37 | `method: 'GET'` con `data` | `method: 'POST'` con `data` | `CONN-01` (y el anti-patrón documentado en `ARCHITECTURE.md` §Anti-Patterns: los endpoints nuevos usan POST) |
| 30 | credencial dentro de la URL (`?code=`) | header `Authorization: Bearer <llave>` | `CONN-02` |
| 40-42 | sólo `Content-Type` | + header de entidad + header de llave de idempotencia | `CONN-03`, `SAFE-01` |
| 32 | `console.log` de la URL completa **con la credencial** | línea de perfil enmascarada, impresa antes de salir a la red | `CONN-05`, `CFG-05` (v1 queda como `DEBT-04`) |
| 44 | `function (status)` | usar arrow (`(status) => status < 500`) | `CONVENTIONS.md` §Code Style línea 34: arrow para callbacks nuevos |

**El `console.log` de la línea 33 (`Enviando datos`) sí se copia** — en v2 el cuerpo no
lleva credencial. Lo que **nunca** se imprime crudo es el objeto `headers`.

**Manejo de respuesta** (`src/api/taxApiClient.js:66-88`) — copiar la estructura completa:

```javascript
    _handleResponse(response, url, operation) {
        console.log(`Respuesta recibida - Status: ${response.status} ${response.statusText}`);

        // Mostrar datos de respuesta
        if (response.data) {
            console.log('Respuesta del servidor:', JSON.stringify(response.data, null, 2));
        }

        // Verificar si el servidor indica error mediante el status code
        if (response.status >= 400) {
            const serverErrorMsg = response.data ? JSON.stringify(response.data) : response.statusText;
            const errorMsg = `Error HTTP ${response.status}: ${serverErrorMsg}`;
            console.error(errorMsg);
            this.logger.error(`${errorMsg} - URL: ${url} - Operation: ${operation}`);
            throw new Error(errorMsg);
        }

        // Log de éxito
        const successLogMsg = `SUCCESS: ${operation} - Status: ${response.status}`;
        console.log(successLogMsg);

        return response.data;
    }
```

**Manejo de error de transporte** (`src/api/taxApiClient.js:97-141`, el método más largo
del repositorio ~45 líneas) — cadena lineal `if`/`else if` sobre `error.code`, sin
anidamiento:

```javascript
    _handleError(error, url, operation) {
        let errorMsg = 'Error en la petición: ';

        if (error.code === 'ECONNREFUSED') {
            errorMsg += 'Conexión rechazada. El servidor no está disponible o la URL es incorrecta.';
            console.error(errorMsg);
            console.error(`URL intentada: ${url}`);
            console.error('Verifique que:');
            console.error('1. El servidor esté en funcionamiento');
            console.error('2. La BASE_URL en .env sea correcta');
            console.error('3. No hay firewall bloqueando la conexión');
        } else if (error.code === 'ECONNABORTED') {
            errorMsg += 'Timeout de conexión. La petición tardó más de 30 segundos.';
            console.error(errorMsg);
        } else if (error.code === 'ENOTFOUND') {
            errorMsg += 'Servidor no encontrado. Verifique la URL en BASE_URL.';
            console.error(errorMsg);
            console.error(`URL: ${url}`);
        } else if (error.response) {
            // ... HTTP + status del servidor
        } else if (error.request) {
            // ... sin respuesta
        } else {
            errorMsg += error.message;
            console.error(errorMsg);
        }

        // Log detallado del error
        const detailedLog = `${errorMsg} - Operation: ${operation} - URL: ${url}`;
        this.logger.error(detailedLog);

        // Información de diagnóstico
        console.error('\n--- Información de diagnóstico ---');
        console.error(`Operación: ${operation}`);
        console.error(`URL: ${url}`);
        console.error(`Timestamp: ${new Date().toISOString()}`);
    }
```

Copiar la cadena y el bloque de diagnóstico final. **Ajustar sólo los textos que citan
`BASE_URL`** (v2 lee otra variable). La clasificación por código estable del proveedor es
`SAFE-05`, que **no está en Fase 1** — no adelantarla aquí.

**Envoltorios por operación** (`src/api/taxApiClient.js:143-168`) y export
(`src/api/taxApiClient.js:171`):

```javascript
    async getTax(requestBody) {
        return this.makeRequest('get_tax', requestBody);
    }
}

module.exports = TaxApiClient;
```

En Fase 1 sólo hace falta el envoltorio de `get_tax`. `postTax`/`cancelTax` son Fase 2.

---

### `src/api/synexusRequestBuilder.js` (transform/builder, transform)

**Análogo:** parcial, dos fuentes. No existe un "builder" en el repositorio.

**Fuente 1 — forma "recibe cuerpo, devuelve objeto nuevo, lanza si falla"**
(`src/validators/taxValidator.js:76-95`):

```javascript
    sanitizeStringFields(requestBody) {
        try {
            // Recursivamente sanitiza todos los campos de string
            const sanitized = JSON.parse(JSON.stringify(requestBody, (key, value) => {
                if (typeof value === 'string') {
                    return value.replace(/'/g, "\\'");
                }
                return value;
            }));

            console.log('Datos sanitizados exitosamente');
            return sanitized;
        } catch (err) {
            const errorMsg = `Error al sanitizar los datos: ${err.message}`;
            console.error(errorMsg);
            this.logger.error(errorMsg);
            throw new Error(errorMsg);
        }
    }
```

Copiar: devolver un objeto **nuevo** (nunca mutar `requestBody` en sitio), un
`console.log` de traza al terminar, y el trío `console.error` + `logger.error` + `throw`
en el catch.

**Fuente 2 — mapeo operación → valores, con `throw` terminal**
(`src/config/index.js:65-79`):

```javascript
    getEndpointUrl(operation) {
        const baseUrl = this.getBaseUrl();

        if (operation === 'get_tax' || operation === 'post_tax') {
            const apiCode = this.getApiCode();
            const endpoint = this.isTestMode() ? 'STCCalcV3_TEST' : 'STCCalcV3';
            return `${baseUrl}${endpoint}?code=${apiCode}`;
        }

        if (operation === 'cancel_tax') {
            return `${baseUrl}CancelTransaction`;
        }

        throw new Error(`Operación inválida: ${operation}`);
    }
```

Este es el molde exacto para el mapeo de intención: `if (operation === 'get_tax')`
devuelve `transaction_type: 'sales_estimate'` **y** `committed: false`; cualquier
operación no contemplada cae al `throw` terminal en vez de devolver un valor por omisión.
Ese `throw` final es lo que satisface `OPER-05`, y la ausencia de un `else` con valor por
defecto es lo que impide que un refactor futuro reintroduzca `sales_invoice` por omisión
(`TEST-03` es la guardia).

**Llave de idempotencia — sin análogo.** No hay un solo `require('crypto')` en todo
`src/`. Convención de importación aplicable (`CONVENTIONS.md` §Import Organization):
built-ins de Node primero, sin destructurar el require.

```javascript
// primera línea del bloque de imports, antes de cualquier paquete de terceros
const crypto = require('crypto');
```

Decisión de `CONTEXT.md`: UUID v4 desde `crypto.randomBytes(16)`, un solo camino de
código, sin detección de características (`crypto.randomUUID()` existe sólo desde Node
14.17). **Dónde vive:** o un método privado `_generateIdempotencyKey()` dentro de este
builder — que es lo que mejor calza con el patrón de helpers `_`-prefijados del
repositorio — o un módulo aparte. No hay ningún módulo de funciones sueltas en `src/`:
**todos los archivos exportan una clase**, así que un archivo nuevo sólo para esto
rompería la convención de módulo por menos beneficio del que cuesta.

**Constructor:** `constructor(logger)` posicional, igual que `TaxValidator`
(`src/validators/taxValidator.js:13-16`), si necesita registrar. Si es puramente
funcional, sigue siendo una clase con `module.exports = SynexusRequestBuilder`.

---

### `src/config/synexusConfig.js` (config, lookup + validación al construir)

**Análogo:** `src/config/index.js` — mismo rol, **con una divergencia estructural crítica.**

**Encabezado y carga de dotenv** (`src/config/index.js:1-13`):

```javascript
// src/config/index.js
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

/**
 * Configuration Layer
 * Responsabilidad: Centralizar toda la configuración de la aplicación
 * Principio SOLID aplicado: Single Responsibility Principle (SRP)
 */
class Config {
    constructor() {
        this._validateRequiredEnvVars();
    }
```

**No repetir la línea 3.** `dotenv` ya se cargó cuando `src/config/index.js` fue
requerido; llamarlo dos veces es ruido. La clase v2 lee `process.env` directamente (sigue
siendo capa de configuración, así que no viola la regla de `CLAUDE.md`) o recibe el
singleton `config` por constructor.

**Validación al construir, con nombres de lo que falta** (`src/config/index.js:19-26`) —
molde exacto para `CFG-04`:

```javascript
    _validateRequiredEnvVars() {
        const required = ['BASE_URL', 'API_CODE', 'OUTPUT_DIR'];
        const missing = required.filter(key => !process.env[key]);

        if (missing.length > 0) {
            throw new Error(`Variables de entorno faltantes: ${missing.join(', ')}`);
        }
    }
```

**Este array de la línea 20 NO se toca.** Las variables de v2 sólo son obligatorias
cuando el contrato seleccionado es v2 — por eso viven en el `_validateRequiredEnvVars`
de la clase nueva, no en el de `Config`. Ese es exactamente el mecanismo que hace que
`node index.js get_tax <archivo>` sin selector siga funcionando en un servidor cuyo
`.env` no tiene ni una variable de v2.

**Getters de una línea** (`src/config/index.js:44-58`) — molde para todos los getters v2:

```javascript
    /**
     * Obtiene el directorio de salida para respuestas
     * @returns {string}
     */
    getOutputDir() {
        return process.env.OUTPUT_DIR;
    }

    /**
     * Verifica si está en modo de prueba
     * @returns {boolean}
     */
    isTestMode() {
        return process.env.TEST_MODE === 'true';
    }
```

`isTestMode()` (líneas 56-58) es además el molde del **selector de contrato**: una
comparación estricta contra la cadena esperada, de modo que ausente o vacía cae al valor
por omisión. Aplicado a `CFG-03`: `TAX_API_VERSION === 'v2'` ⇒ v2; **todo lo demás ⇒ v1**.
Escribirlo así (afirmar `v2`, no negar `v1`) es lo que garantiza que ausente, vacía o
mal escrita nunca active v2 por accidente.

**Composición de URL** (`src/config/index.js:65-79`, ya citada arriba) — molde para
`CONN-04`: la base sale de una variable de entorno, sólo el fragmento de ruta es literal.
La ruta de cálculo v2 es `/api/v1/tax_calculations` según
`postman/synexus-v2-api.postman_collection.json`, **sin `/calculate`** — `CONTEXT.md`
§Specific Ideas ya resolvió esa contradicción a favor de la referencia de API.

**DIVERGENCIA CRÍTICA — el export** (`src/config/index.js:90-91`):

```javascript
// Singleton pattern - una sola instancia de configuración
module.exports = new Config();
```

**No copiar esto.** `src/config/index.js` es la única excepción del repositorio; todos los
demás archivos de `src/` hacen `module.exports = ClassName` (`CONVENTIONS.md` §Module
Design). La clase v2 debe exportar la clase, no una instancia, por dos razones concretas:

1. Un singleton evaluado en el `require` que lanza cuando faltan variables de v2 rompería
   toda corrida v1 en cuanto alguien lo requiriera desde `index.js`. Al exportar la clase,
   `index.js` la construye **sólo cuando el selector resolvió v2**.
2. `TEST-06` exige que la suite corra sin credenciales. Un singleton que valida en el
   `require` hace intesteable cualquier archivo que lo importe.

**Guardia llave↔host (`SAFE-03`) — sin análogo directo.** La forma más cercana es la
combinación de dos patrones que ya existen: validar al construir
(`_validateRequiredEnvVars`, líneas 19-26) y comparación estricta con mensaje en español
(`validateCommittedField`, líneas 38-55). `CONTEXT.md` decide que se valida al construir
la configuración v2, antes de que exista siquiera una petición.

**Enmascaramiento (`CFG-05`) — sin análogo.** `grep -rni "mask|redact|enmascar" src/`
devuelve cero resultados. Es código nuevo. Convención aplicable: helper privado con
guion bajo (`_maskApiKey`), igual que `_listSimilarFiles` en `fileManager.js`.

**Resolución del código de entidad (`CFG-01`) — sin análogo, y con riesgo abierto.**
`CONTEXT.md` §Riesgos abiertos advierte que `Config` es un singleton de proceso sin lugar
natural para un valor que varía por petición. Convención que acota el diseño
(`CONVENTIONS.md` §Function Design): parámetros posicionales, nunca objeto de opciones,
rara vez más de 3. Una firma como `resolveEntityCode(cliValue, requestBody)` absorbe la
precedencia (argumento CLI > variable de entorno > campo del JSON) sin que la clase tenga
que guardar estado por petición.

---

### `src/cli/taxCommandHandler.js` (modificado — cli, request-response)

**Análogo:** sí mismo. Éste es el archivo de mayor riesgo de regresión de toda la fase,
porque el envoltorio del ERP depende de que su comportamiento posicional no cambie.

**El método que aprende flags** (`src/cli/taxCommandHandler.js:34-47`):

```javascript
    parseArguments(args) {
        if (args.length < 2) {
            const message = 'Uso: node index.js <operacion> <ruta_del_archivo>\n' +
                'Operaciones válidas: "get_tax", "post_tax" o "cancel_tax"';
            console.error(message);
            this.logger.error(message);
            throw new Error(message);
        }

        return {
            operation: args[0],
            filePath: args[1]
        };
    }
```

**Forma del cambio, derivada del código tal como está:**

- Los flags se retiran **antes** de la comprobación de longitud y antes de resolver
  posicionales, de modo que `args[0]`/`args[1]` sigan apuntando a operación y ruta sin
  importar dónde aparezca el flag. Filtrar con `.filter()` y arrow, que es el patrón
  dominante de callbacks del repositorio.
- La comprobación `args.length < 2` debe correr contra el arreglo **ya filtrado**. Si
  corre antes, `node index.js get_tax --api-version=v2` (sin ruta) pasaría la validación
  y fallaría más tarde con un mensaje peor.
- **El texto del mensaje de las líneas 36-37 no se toca.** `COMP-01` exige "mismos
  mensajes". Si hay que documentar `--api-version`, el lugar es `showHelp()`
  (líneas 131-143, hoy sin usar) o el README, no este `throw`.
- El valor devuelto gana una tercera propiedad (la versión resuelta). Añadir al objeto
  literal de las líneas 43-46 no rompe a nadie: `execute` desestructura por nombre
  (línea 56).

**Dónde se ramifica el contrato** (`src/cli/taxCommandHandler.js:53-59, 76`):

```javascript
    async execute(args) {
        try {
            // 1. Parsear argumentos
            const { operation, filePath } = this.parseArguments(args);

            // 2. Validar operación
            this.validator.validateOperation(operation);
            ...
            // 6. Realizar la petición a la API con los datos sanitizados
            const responseData = await this.apiClient.makeRequest(operation, sanitizedRequestBody);
```

La línea 76 es el único punto donde se decide qué cliente se usa. Copiar el estilo de
comentarios numerados (`// 1.`, `// 2.` …) al insertar pasos nuevos.

**El constructor gana un colaborador** (`src/cli/taxCommandHandler.js:20`):

```javascript
    constructor(config, logger, fileManager, validator, apiClient) {
```

`CONVENTIONS.md` §Function Design: colaboradores posicionales en orden DI fijo, nunca un
objeto de opciones. El cliente v2 se **añade al final** de la lista para no correr los
índices de las llamadas existentes.

---

### `src/validators/taxValidator.js` (modificado — validator)

**Análogo:** sí mismo. `validateCommittedField` es el molde literal de la validación de
campos de intención (`src/validators/taxValidator.js:38-55`):

```javascript
    validateCommittedField(operation, requestBody) {
        if (operation === 'get_tax') {
            if (requestBody.Committed !== false) {
                const errorMsg = 'Para la operación get_tax, el valor "Committed" debe ser false.';
                console.error(errorMsg);
                this.logger.error(errorMsg);
                throw new Error(errorMsg);
            }
        } else if (operation === 'post_tax') {
            if (requestBody.Committed !== true) {
                const errorMsg = 'Para la operación post_tax, el valor "Committed" debe ser true.';
                console.error(errorMsg);
                this.logger.error(errorMsg);
                throw new Error(errorMsg);
            }
        }
        // cancel_tax no valida el campo Committed
    }
```

Copiar: comparación estricta (`!==`, nunca falsy), `errorMsg` en una constante que se usa
tres veces (`console.error`, `logger.error`, `throw`), comillas dobles **dentro** de la
cadena para citar el nombre del campo, y el comentario en español que explica el caso no
cubierto. Este método completo es lo que `OPER-04` mantiene vigente: **no se modifica**,
se le suma un hermano.

Ese mismo molde aplica a la regla del `CONTEXT.md` de que **un `transaction_type` en el
archivo de entrada que contradiga la operación aborta** en vez de sobreescribirse en
silencio.

**Dónde NO enchufar la validación v2** (`src/validators/taxValidator.js:103-111`):

```javascript
    validate(operation, requestBody) {
        this.validateOperation(operation);
        this.validateRequestBody(requestBody);
        this.validateCommittedField(operation, requestBody);

        // Sanitizar los datos antes de enviarlos
        const sanitizedData = this.sanitizeStringFields(requestBody);
        return sanitizedData;
    }
```

Este agregador lo llama el camino v1 en la línea 73 de `taxCommandHandler.js`. Insertar
un paso v2 aquí lo haría correr también en v1 y arriesgaría `COMP-01`. La validación de
intención de v2 va en un **método hermano** que sólo invoca la rama v2.

**No tocar la lista de operaciones** (`src/validators/taxValidator.js:15`):

```javascript
        this.validOperations = ['get_tax', 'post_tax', 'cancel_tax'];
```

`CLAUDE.md` manda actualizarla al **añadir una operación**. Esta fase no añade ninguna:
`--api-version` es un selector de contrato, no una operación. Si aparece `v2` o un flag
en este arreglo, el diseño se desvió.

---

### `index.js` (modificado — composition root)

**Análogo:** sí mismo. Es el único lugar donde se arma el grafo (`COMP-04`).

**Bloque de imports** (`index.js:24-29`):

```javascript
// Importar todas las capas
const config = require('./src/config');
const Logger = require('./src/infrastructure/logger');
const FileManager = require('./src/storage/fileManager');
const TaxValidator = require('./src/validators/taxValidator');
const TaxApiClient = require('./src/api/taxApiClient');
const TaxCommandHandler = require('./src/cli/taxCommandHandler');
```

Nótese: `config` en minúscula porque es la instancia singleton; todo lo demás en
PascalCase porque son clases. Los requires nuevos siguen el mismo orden ascendente por
capa y nunca se destructuran.

**Construcción bottom-up** (`index.js:34-59`):

```javascript
async function main() {
    try {
        // 1. Inicializar infraestructura (capa más baja)
        const logger = new Logger(config.getLogDir());

        // 2. Inicializar capa de almacenamiento
        const fileManager = new FileManager(logger);

        // 3. Inicializar capa de validación
        const validator = new TaxValidator(logger);

        // 4. Inicializar capa de API
        const apiClient = new TaxApiClient(config, logger);

        // 5. Inicializar capa CLI (capa más alta)
        const commandHandler = new TaxCommandHandler(
            config,
            logger,
            fileManager,
            validator,
            apiClient
        );

        // 6. Ejecutar el comando
        const args = process.argv.slice(2);
        await commandHandler.execute(args);
```

Insertar la construcción del cliente v2 y su configuración **entre los pasos 4 y 5**,
manteniendo la numeración de los comentarios y el orden bottom-up. Los argumentos del
`TaxCommandHandler` van uno por línea cuando pasan de tres — ya es el formato de las
líneas 49-55.

**Frontera de error** (`index.js:61-65`) — copiar tal cual, no ampliar:

```javascript
    } catch (error) {
        // Si hay error, salir con código de error
        console.error('\n❌ La operación falló. Revise los logs para más detalles.');
        process.exit(1);
    }
```

Éste es el **único** `process.exit` del código. Ninguna clase nueva debe llamarlo.

**Gotcha para las pruebas** (`index.js:68-69`):

```javascript
// Ejecutar la aplicación
main();
```

`main()` se invoca al cargar el módulo. **Ningún archivo de prueba puede hacer
`require('../index.js')`** — dispararía una corrida real. Las pruebas ejercitan
`TaxCommandHandler` y las clases directamente.

---

### `package.json` (modificado — config)

**Análogo:** sí mismo (`package.json:5-7, 11-15`):

```json
  "scripts": {
    "test": "echo \"Error: no test specified\" && exit 1"
  },
  "dependencies": {
    "axios": "^1.7.9",
    "dotenv": "^16.4.7",
    "winston": "^3.17.0"
  }
```

- El stub de la línea 6 se reemplaza por el runner (`TEST-01`).
- Jest entra en un bloque `devDependencies` **nuevo y separado**; las tres dependencias
  de runtime no se tocan (`CONTEXT.md`: "devDependencies no se despliegan").
- **Dato verificado:** `jest@29.7.0` declara `engines: { node: '^14.15.0 || ^16.10.0 || >=18.0.0' }`
  — coincide exactamente con el piso de Node 14.15+ que fija `CONTEXT.md`. Jest 30 sube
  ese piso. Fijar la mayor de 29.x.
- El repositorio no tiene campo `engines` hoy (`CONTEXT.md` §Riesgos abiertos lo señala);
  añadirlo es opcional y no lo pide ningún requisito de la fase.

---

## Archivos de prueba: no hay análogo en el repositorio

**Hecho verificado, no una suposición:** no existe ni un archivo de prueba, ni directorio
`__tests__`/`tests`, ni configuración de jest, ni `node_modules` instalado. `CLAUDE.md` lo
dice sin rodeos: "No tests, no CI, no linter". **No inventar un análogo.** Lo que sigue no
es un patrón copiado sino la forma que las pruebas deben tomar, derivada de cómo está
escrito el código que cubren.

### Lo que el código bajo prueba impone

**1. Los dobles de prueba son objetos literales, no mocks de framework.** Toda clase
recibe sus colaboradores por constructor posicional, así que basta un objeto con los
métodos que se usan. El logger tiene exactamente cuatro métodos
(`src/infrastructure/logger.js:56-84`): `error`, `info`, `warn`, `debug`.

**2. Nunca hacer `require('../src/config')` desde una prueba.** El módulo exporta
`new Config()` (`src/config/index.js:91`) y el constructor llama a
`_validateRequiredEnvVars()` (línea 12), que **lanza en tiempo de `require`** si faltan
`BASE_URL`, `API_CODE` u `OUTPUT_DIR`. Requerirlo obligaría a que la suite tenga `.env`,
lo que contradice `TEST-06` frontalmente. En su lugar se pasa un objeto falso con sólo el
método que la clase bajo prueba invoca — para `TaxApiClient` es únicamente
`getEndpointUrl(operation)` (`src/api/taxApiClient.js:30`).

**3. `axios` se requiere en el tope del módulo** (`src/api/taxApiClient.js:2`) y se invoca
**como función** (`await axios({...})`, línea 36), no como `axios.get(...)`. No hay
colaborador HTTP inyectado, así que `jest.mock('axios')` es el único punto de
intercepción, y el mock tiene que ser una función invocable que devuelva
`{ status, statusText, data }`.

**4. La aserción de congelamiento de v1 se lee del único argumento de la llamada.** Con
`axios.mock.calls[0][0]` se verifica, contra el comportamiento actual y no contra el
deseable:

| Qué se congela | Dónde vive hoy | Valor de hoy |
|---|---|---|
| Método HTTP | `src/api/taxApiClient.js:37` | `'GET'` |
| URL resuelta | `src/config/index.js:71,75` | `${baseUrl}STCCalcV3?code=${apiCode}` · `${baseUrl}STCCalcV3_TEST?code=${apiCode}` · `${baseUrl}CancelTransaction` |
| Autenticación | `src/config/index.js:71` | credencial en query string; `cancel_tax` sin credencial |
| Cuerpo | `src/api/taxApiClient.js:39` | `data: requestBody` en un GET |
| Timeout | `src/api/taxApiClient.js:19,43` | `30000` |
| Corte de status | `src/api/taxApiClient.js:44-47` | `validateStatus(499) === true`, `validateStatus(500) === false` |

**5. Los mensajes de error se congelan como cadenas exactas.** Los que `COMP-01` protege,
con su origen:

- `src/api/taxApiClient.js:77` — `` `Error HTTP ${response.status}: ${serverErrorMsg}` ``
- `src/validators/taxValidator.js:25` — `` `Operación inválida: "${operation}". Usa "get_tax", "post_tax" o "cancel_tax".` ``
- `src/validators/taxValidator.js:41` — `Para la operación get_tax, el valor "Committed" debe ser false.`
- `src/validators/taxValidator.js:48` — `Para la operación post_tax, el valor "Committed" debe ser true.`
- `src/cli/taxCommandHandler.js:36-37` — el mensaje de uso, con su `\n` intermedio
- `src/config/index.js:24` — `` `Variables de entorno faltantes: ${missing.join(', ')}` ``

`CONTEXT.md` es explícito: se escriben leyendo el código tal como está hoy. Si algo del
comportamiento actual parece un defecto, **se congela igual y se anota**.

**6. `console.log`/`console.error` son la superficie de aserción de `CONN-05` y `CFG-05`.**
El repositorio usa la consola como canal de traza (`CONVENTIONS.md` §Logging). Un
`jest.spyOn(console, 'log')` sirve para dos cosas a la vez: mantener limpia la salida de
la suite y afirmar que la línea de perfil se imprimió y que **ninguna línea capturada
contiene la llave cruda**. Ojo: esa misma aserción aplicada a v1 fallaría a propósito
(`src/api/taxApiClient.js:32` imprime `?code=<API_CODE>`) — es `DEBT-04`, y por eso
`CFG-05` quedó acotado a v2.

**7. `TEST-03` es una prueba sobre el cuerpo construido, sin red.** Lo que verifica es
que para `get_tax` el cuerpo lleva `transaction_type: 'sales_estimate'` **y**
`committed: false`. Debe fallar si alguien quita el tipado explícito y deja que el
proveedor caiga en su valor por omisión (`sales_invoice`). Afirmar ambos campos, no sólo
`committed`: `CONTEXT.md` documenta que `committed: false` por sí solo **no** basta.

**8. Ninguna prueba debe tratar un impuesto de `0.00` como fallo.** La respuesta real de
staging trae `0.00` con `exemption.source: "no_nexus"` porque la entidad de sandbox no
tiene nexo en ese estado (`CONTEXT.md` §Specific Ideas). Los montos v2 llegan como
cadenas decimales (`"49.99"`).

### Gotcha de nombres de directorio

`.gitignore` contiene la entrada `test-files` (bajo el comentario `# Test files`). **Un
directorio de pruebas llamado `test-files` quedaría fuera de git sin aviso.** `tests/` y
`__tests__/` son seguros. `coverage/` ya está ignorado, así que `jest --coverage`
funciona sin tocar `.gitignore`.

### `jest.config.js`

Sin análogo: el repositorio no tiene ningún archivo de configuración de herramientas (no
hay `.eslintrc`, `.prettierrc`, `biome.json` — `CONVENTIONS.md` §Formatting lo confirma).
El `testEnvironment` por omisión de Jest 29 ya es `node`, que es lo que este proyecto
necesita. Un config mínimo y explícito, o la clave `jest` dentro de `package.json`, son
ambas coherentes; lo que no es coherente es un config elaborado en un repositorio que
hasta hoy no tenía ninguno.

### Fixture de contrato: no existe todavía como archivo

`CONTEXT.md` menciona una respuesta real de staging archivada en `data/` (9-sep-2026).
**Verificado: `data/` no contiene ningún `.json`** — sólo PDFs y un `.md` de reunión, y
`grep -rl "no_nexus" data/` no encuentra nada en texto plano. El fixture tendrá que
extraerse antes de usarse. No bloquea la Fase 1: su consumo formal es `VERIF-01`, de
Fase 2. Además `data/` está excluido de git y su contenido no debe citarse dentro de
`.planning/`.

---

## Patrones compartidos

### A. Encabezado de archivo con su ruta

**Fuente:** los 7 archivos de `src/` y `index.js`, sin excepción.
**Aplica a:** todo archivo nuevo.

```javascript
// src/api/taxApiClient.js
```

### B. JSDoc de clase con Responsabilidad y principio SOLID

**Fuente:** `src/api/taxApiClient.js:4-9`, `src/storage/fileManager.js:5-9`,
`src/validators/taxValidator.js:3-7`.
**Aplica a:** toda clase nueva.

```javascript
/**
 * API Layer - Tax API Client
 * Responsabilidad: Gestionar todas las peticiones HTTP a la API de impuestos
 * Principio SOLID: Single Responsibility Principle (SRP)
 * Patrón: Dependency Injection
 */
```

### C. Inyección de dependencias posicional

**Fuente:** `src/api/taxApiClient.js:16-20`, `src/cli/taxCommandHandler.js:20-26`,
`src/validators/taxValidator.js:13-16`, `src/storage/fileManager.js:15-17`.
**Aplica a:** toda clase nueva. Nunca objeto de opciones. Nunca `require` de un hermano.

### D. El trío del fallo: `console.error` + `logger.error` + `throw`

**Fuente:** `src/validators/taxValidator.js:41-44`, `:64-67`, `:90-93`;
`src/api/taxApiClient.js:78-80`; `src/cli/taxCommandHandler.js:63-66`.
**Aplica a:** todo camino de fallo nuevo.

```javascript
const errorMsg = 'Mensaje en español que explica qué pasó y qué se esperaba.';
console.error(errorMsg);
this.logger.error(errorMsg);
throw new Error(errorMsg);
```

Siempre `Error` de fábrica: no hay subclases ni `error.code` en ningún punto del
repositorio (`CONVENTIONS.md` §Error Handling). El patrón `return { ok: false }` nunca se
usa. `ARCHITECTURE.md` §Anti-Patterns sugiere tipos discriminables para caminos nuevos,
pero eso es `SAFE-05` y **no pertenece a Fase 1**.

### E. Mensaje de log con contexto suficiente

**Fuente:** `src/api/taxApiClient.js:79, 133`.
**Aplica a:** toda llamada a `logger.error` desde la capa API.

```javascript
this.logger.error(`${errorMsg} - URL: ${url} - Operation: ${operation}`);
```

### F. Helper privado con guion bajo

**Fuente:** `_handleResponse`, `_handleError`, `_saveResponse`, `_validateRequiredEnvVars`,
`_ensureLogDir`, `_createLogger`, `_handleFileReadError`, `_listSimilarFiles`.
**Aplica a:** toda lógica auxiliar que saca formato o diagnóstico del cuerpo del método
principal. Convención de nombres únicamente — la sintaxis `#private` no se usa nunca.

### G. División de idiomas (no negociable)

**Fuente:** `CONVENTIONS.md` §Comments, y los 7 archivos de `src/`.

- **Español:** cuerpos de JSDoc, comentarios en línea, todo mensaje de error visible o
  registrado.
- **Inglés:** nombres de clases, métodos, variables y archivos (camelCase / PascalCase).

### H. Estilo

4 espacios de indentación, comillas simples, punto y coma siempre, template literals para
interpolación, arrow functions para callbacks en línea. Sin `UPPER_SNAKE_CASE`: las listas
fijas van como propiedades de instancia asignadas en el constructor
(`src/validators/taxValidator.js:15`).

### I. Export

`module.exports = ClassName` en todos los archivos de `src/`. La única excepción del
repositorio es `src/config/index.js:91`, y **no debe replicarse** (ver la divergencia
crítica de `synexusConfig.js`).

---

## Sin análogo en el repositorio

| Necesidad | Rol | Flujo | Verificación |
|---|---|---|---|
| Archivos de prueba y runner | test | — | Cero archivos de prueba, cero config de herramientas. `CLAUDE.md`: "No tests, no CI, no linter" |
| Generación de llave de idempotencia | utility | transform | `grep -rn "crypto\|randomUUID\|randomBytes" src/ index.js` → sin resultados |
| Petición `POST` | api-client | request-response | `grep -rn "POST" src/ index.js` → sin resultados. Todo el repositorio es `GET` |
| Autenticación por header | api-client | request-response | `grep -rn "Bearer\|Authorization" src/ index.js` → sin resultados. v1 pone la credencial en la URL |
| Enmascaramiento de credenciales | utility | transform | `grep -rni "mask\|redact\|enmascar" src/ index.js` → sin resultados |
| Parseo de flags `--nombre=valor` | cli | transform | `grep -rn '\-\-' src/cli/taxCommandHandler.js` → sin resultados. El parseo es estrictamente posicional |
| Fixture de respuesta de contrato | test-fixture | — | `find data -name '*.json'` → sin resultados |

Para todos estos, el planeador no tiene de dónde copiar dentro del repositorio: la guía
disponible es `CONTEXT.md` (que ya decidió el enfoque de cada uno) y
`postman/synexus-v2-api.postman_collection.json`, que es el contrato ejecutable sin
credenciales.

---

## Contrato v2 observado (de `postman/synexus-v2-api.postman_collection.json`)

Fuente ejecutable, sin credenciales, ya en el repositorio. Útil para que el planeador no
invente nombres de campos ni de headers:

- **Auth de la colección:** `bearer`, token `{{synexus_api_key}}` → header
  `Authorization: Bearer <llave>` (`CONN-02`).
- **Ruta de cálculo:** `POST {{synexus_base_url}}/api/v1/tax_calculations` — **sin
  `/calculate`**, tal como resolvió `CONTEXT.md`.
- **Headers de entidad presentes en la colección:** `X-Syntax-Entity` y `X-Synexus-Entity`,
  ambos con el valor `{{synexus_entity}}`. **Hay dos y sólo uno puede ser el correcto** —
  el planeador debe resolver cuál contra la referencia de API antes de escribir el
  cliente, no elegir por parecido.
- **Otras rutas disponibles:** `GET /health`, `GET /api/v1/entities` (descubrir códigos de
  entidad — relevante para `CFG-01`/`CFG-02`).
- **Host de staging:** `https://compute.staging.synexustax.com`
  (`postman/synexus-staging.postman_environment.json`). Va a configuración, nunca al
  código (`CONN-04`).
- **Forma del cuerpo del ejemplo:** `invoice_id`, `customer_id`, `to_state`, `to_zip`,
  `cart[]` con `item_id`, `price`, `quantity`, `tax_code`. **El ejemplo de Postman no
  incluye `transaction_type`, `committed` ni `request_id`** — que son precisamente los
  tres campos de intención de los que nexgen es dueño según `CONTEXT.md`. Su ausencia en
  el ejemplo es la razón exacta por la que `OPER-01` es el riesgo caro de la fase: el
  valor por omisión del proveedor persiste.

---

## Metadata

**Alcance de la búsqueda de análogos:** `index.js`, `src/api/`, `src/cli/`, `src/config/`,
`src/infrastructure/`, `src/storage/`, `src/validators/`, `postman/`, `package.json`,
`.gitignore`, `data/` (sólo listado de archivos, sin leer contenido).
**Archivos escaneados:** 7 fuentes de `src/` + `index.js` + `package.json` + 2 colecciones
Postman = 11.
**Archivos leídos íntegros:** 8 (todos por debajo de 200 líneas).
**Fecha de extracción:** 2026-09-10

---

*Phase: 01-camino-v2-de-punta-a-punta-para-una-cotizaci-n*
