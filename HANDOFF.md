# HANDOFF — nexgen

> Documento de transferencia para el nuevo responsable del proyecto.
> Idioma: español. Última actualización: 2026-05-12.

## 1. ¿Qué es nexgen?

**nexgen** es un cliente de línea de comandos en Node.js que actúa como puente
entre un ERP (en producción: **Sage 300**) y una API de cálculo de impuestos
hospedada en Azure bajo el nombre `syn-magento.azurewebsites.net`. Recibe un
archivo JSON con los datos de una transacción, llama a la API correspondiente
(`get_tax`, `post_tax` o `cancel_tax`) y deja la respuesta como
`RESPONSE_<archivo>.json` en el directorio configurado.

No es un servicio, no es un demonio. Es una **herramienta CLI invocada por el
ERP** (por ejemplo, desde un script de Sage que envuelve `node index.js`).

## 2. Estado actual

- **Versión**: `1.0.0` (ver `package.json`).
- **Funciona en producción** para el cliente final (Plummer's Environmental
  Services, identificado en `clientID` / fixtures).
- **Última firma de cambios** en `main`: commit `6968cda` — ignora `results/`
  y `test-files/`. Antes: sanitización de campos de texto (`ed6b3f2`),
  endpoint de producción (`6b6ce39`), arquitectura por capas (`4d00602`).
- **Deuda principal**: no hay tests automatizados (el README dice
  "Coming soon - test suite with Jest" desde hace meses).
- **Deuda secundaria**: no hay CI, `package.json` tiene `description`,
  `author` y `repository` vacíos, y no hay script de release.

## 3. Quién usa esto

- **Cliente directo de Tersoft**: el cliente que tiene el ERP donde se
  integra el cálculo de impuestos (en producción Sage 300, ver
  `SourceID: "Sage300"` en `test-files/test_apostrophe.json`).
- **Cliente final identificado en fixtures**: Plummer's Environmental
  Services Group (`PLUMME001`, Byron Center MI). El `clientID` que aparece
  en los JSON es `LIGFBP`.
- **Flujo real**: el ERP exporta una transacción a JSON, dispara
  `node index.js <op> <archivo.json>`, lee el `RESPONSE_*.json` resultante
  y reintegra los impuestos al documento original.

## 4. Arquitectura en una pantalla

Arquitectura por capas con inyección de dependencias (DI) orquestada en
`index.js`. Cada capa solo conoce a la capa inmediatamente inferior.

```
┌─────────────────────────────────────┐
│   CLI Layer (taxCommandHandler)    │ <- argv, dispatch, orquestación
├─────────────────────────────────────┤
│   Validation Layer (taxValidator)  │ <- reglas Committed + sanitización
├─────────────────────────────────────┤
│   API Layer (taxApiClient)         │ <- axios + manejo HTTP
├─────────────────────────────────────┤
│   Storage Layer (fileManager)      │ <- read/write JSON, ensureDir
├─────────────────────────────────────┤
│   Infrastructure (logger, config)  │ <- winston, dotenv, endpoints
└─────────────────────────────────────┘
```

Ver `ARCHITECTURE.md` para el desglose por capa y el lifecycle del comando.

## 5. Stack técnico

| Componente   | Versión / Detalle                                          |
| ------------ | ---------------------------------------------------------- |
| Runtime      | Node.js **14+** (sin features de Node 18+; sin ESM)        |
| Módulos      | CommonJS (`require`/`module.exports`)                      |
| HTTP         | `axios` `^1.7.9`                                           |
| Logging      | `winston` `^3.17.0`                                        |
| Config       | `dotenv` `^16.4.7`                                         |
| Tests        | **Ninguno** (placeholder en `npm test`)                    |
| CI/CD        | **No configurado**                                         |
| Linter       | **No configurado**                                         |

Solo tres dependencias en producción. Esto es deliberado: facilita la
auditoría y minimiza la superficie de actualizaciones.

## 6. Cómo correrlo

### 6.1 Instalación

```bash
git clone https://github.com/FReptar0/nexgen.git
cd nexgen
npm install
```

### 6.2 Configurar `.env`

Crea un archivo `.env` en la raíz (está en `.gitignore`, **nunca commitear**):

```env
BASE_URL=https://syn-magento.azurewebsites.net/api/
API_CODE=ABC123XYZ456DEFG789HIJK0LMNOPQRS==
OUTPUT_DIR=C:\Directorio_de_Trabajo\NEO\Taxes\respuesta
TEST_MODE=false
```

`TEST_MODE=true` cambia el endpoint a `STCCalcV3_TEST` (ver §7).

### 6.3 Comandos disponibles

```bash
# Cotizar (no confirma la transacción)
node index.js get_tax <ruta-al-json>

# Confirmar (impacta la contabilidad del proveedor de impuestos)
node index.js post_tax <ruta-al-json>

# Revertir una transacción previamente confirmada
node index.js cancel_tax <ruta-al-json>
```

### 6.4 Formato del JSON de entrada

El JSON sigue el contrato de la API STCCalcV3 (Magento Tax). Campos clave:

| Campo                | Tipo    | Notas                                                        |
| -------------------- | ------- | ------------------------------------------------------------ |
| `Committed`          | boolean | **Obligatorio**. Ver tabla más abajo                         |
| `cartID`             | string  | ID de la orden (ej. `ORD044588`)                             |
| `customerID`         | string  | ID del cliente final                                         |
| `clientID`           | string  | ID del cliente Tersoft (ej. `LIGFBP`)                        |
| `SourceID`           | string  | Identifica el ERP origen (ej. `Sage300`)                     |
| `FromAddress*`       | string  | Dirección de origen del envío                                |
| `ToAddress*`         | string  | Dirección de destino                                         |
| `cart[]`             | array   | Líneas con `ItemID`, `TaxCode`, `Price`, `Quantity`, `Exempt`|

Reglas del campo `Committed` por operación (validado en
`src/validators/taxValidator.js`):

| Operación    | Valor esperado de `Committed` | Comportamiento si no coincide |
| ------------ | ----------------------------- | ----------------------------- |
| `get_tax`    | `false`                       | Error fatal, exit 1           |
| `post_tax`   | `true`                        | Error fatal, exit 1           |
| `cancel_tax` | (no se valida)                | —                             |

Ver `test-files/test_apostrophe.json` (no commiteado) como ejemplo real.

## 7. TEST_MODE vs producción

**Esto es la única configuración con riesgo real de error operativo.**

La resolución del endpoint vive en `src/config/index.js`:

```js
const endpoint = this.isTestMode() ? 'STCCalcV3_TEST' : 'STCCalcV3';
return `${baseUrl}${endpoint}?code=${apiCode}`;
```

| `TEST_MODE` | Endpoint para get_tax/post_tax | Endpoint para cancel_tax |
| ----------- | ------------------------------ | ------------------------ |
| `true`      | `STCCalcV3_TEST`               | `CancelTransaction` (\*) |
| `false`     | `STCCalcV3`                    | `CancelTransaction` (\*) |

(\*) `cancel_tax` **no respeta `TEST_MODE`** y siempre apunta a
`CancelTransaction`. Si necesitas un cancel "de prueba", debes coordinarlo
con el equipo que opera la API; el código no lo distingue.

**Riesgo**: si dejas `TEST_MODE=true` por error en una máquina de
producción, los cálculos llegan al endpoint de pruebas y el ERP recibirá
montos que no se reflejan en la contabilidad real del proveedor. Validar
siempre la URL impresa en consola al inicio de cada corrida.

## 8. Logs y output

| Tipo            | Destino                                       | Notas                            |
| --------------- | --------------------------------------------- | -------------------------------- |
| Salida normal   | `stdout` (consola)                            | `console.log` en cada capa       |
| Errores         | `stderr` (consola) + `logs/log_YYYY-MM-DD.log`| Solo `level: error` (winston)    |
| Respuesta API   | `${OUTPUT_DIR}/RESPONSE_<archivo>.json`       | Sobreescribe si ya existe        |

El logger está fijado a `level: 'error'` en `src/infrastructure/logger.js`,
así que llamadas a `logger.info`/`warn`/`debug` no llegan al archivo. Solo
los errores quedan persistidos en disco.

## 9. Variables de entorno

| Variable     | Obligatoria | Default | Descripción                                                 |
| ------------ | ----------- | ------- | ----------------------------------------------------------- |
| `BASE_URL`   | sí          | —       | URL base de la API. Incluir slash final                     |
| `API_CODE`   | sí          | —       | Código de autenticación (?code=...) para STCCalcV3          |
| `OUTPUT_DIR` | sí          | —       | Directorio donde se escriben los `RESPONSE_*.json`          |
| `TEST_MODE`  | no          | `false` | `true` enruta a `STCCalcV3_TEST`; cualquier otro = producción |

La validación de presencia ocurre en el constructor de `Config`
(`src/config/index.js`). Si falta alguna obligatoria, el proceso aborta con
el mensaje `Variables de entorno faltantes: ...`.

## 10. Archivos y carpetas críticas

| Ruta                                  | Propósito                                          |
| ------------------------------------- | -------------------------------------------------- |
| `index.js`                            | Entry point, orquesta la DI                        |
| `src/cli/taxCommandHandler.js`        | Parseo de argv, dispatcher, lifecycle del comando  |
| `src/validators/taxValidator.js`      | Reglas de `Committed` y sanitización de strings    |
| `src/api/taxApiClient.js`             | Cliente axios, manejo de errores HTTP              |
| `src/storage/fileManager.js`          | Lectura/escritura JSON, ensureDirectory            |
| `src/infrastructure/logger.js`        | Winston (error-only), rotación diaria              |
| `src/config/index.js`                 | dotenv + resolución de endpoint + getLogDir        |
| `.env`                                | Secretos locales. **Nunca commitear**              |
| `logs/`                               | Salida diaria de errores. Gitignored               |
| `results/`                            | Carpeta histórica de pruebas. Gitignored           |
| `test-files/`                         | Fixtures para pruebas manuales. Gitignored         |
| `postman/`                            | Carpeta vacía hoy; placeholder para colecciones    |

## 11. Próximos pasos / deuda técnica

Lista honesta basada en lectura de código y git log (no inventada):

1. **Sin tests automatizados.** El `package.json` tiene
   `"test": "echo \"Error: no test specified\" && exit 1"`. Añadir Jest y
   cubrir al menos: validador (rules de `Committed`, sanitización),
   `fileManager.getResponseFileName`, y `Config.getEndpointUrl` con
   `TEST_MODE` on/off.
2. **Sin CI.** No hay `.github/workflows/`. Configurar al menos un job que
   ejecute `npm install && npm test` en cada PR.
3. **`package.json` incompleto.** `description`, `author`, `repository` y
   `keywords` están vacíos. Llenarlos.
4. **Sin script de release / versionado.** Hoy se publica subiendo a
   `main`. Considerar `npm version` + tag + release notes.
5. **`logger.info/warn/debug` son no-ops.** El logger está hard-coded a
   `level: 'error'`. Si se quiere telemetría operativa, ampliar el nivel
   configurable por env.
6. **El método HTTP es `GET` con body.** Ver
   `src/api/taxApiClient.js:36-48`. Esto funciona porque axios + el
   servidor Magento lo aceptan, pero es inusual y muchos proxies o
   herramientas (curl con `--get`, fetch, http/2 strict) lo descartan.
   Documentar y considerar migración a `POST` si la API lo soporta.
7. **`cancel_tax` no respeta `TEST_MODE`.** Ver §7. Decidir si es un bug
   o un comportamiento intencional documentado.
8. **Sanitización solo escapa apostrofes.** `taxValidator.sanitizeStringFields`
   reemplaza `'` por `\'`. Si en el futuro hay problemas con otros
   caracteres (comillas dobles, control chars), ampliar la regla aquí.
9. **`fileManager._listSimilarFiles` está hard-coded** a buscar nombres
   que contengan "sage", "tax" u "ORD". Sirvió para debug; podría
   parametrizarse o eliminarse.
10. **No hay `.nvmrc` ni `engines` en `package.json`.** El README declara
    Node 14+, pero no hay enforcement.

## 12. Memoria histórica

Decisiones, convenciones y contexto reconstruido del repo en
[`docs/MEMORY.md`](./docs/MEMORY.md). Léelo antes de hacer cambios
estructurales: ahí están los "por qué" detrás del código actual.

## 13. Contactos y accesos

| Ítem                                   | Dónde / Cómo obtenerlo                          |
| -------------------------------------- | ----------------------------------------------- |
| Repo GitHub                            | https://github.com/FReptar0/nexgen              |
| `API_CODE`                             | Lo provee el equipo que opera la API en Azure   |
| `BASE_URL`                             | Dado por el cliente (Sage 300 admin / Tersoft)  |
| `OUTPUT_DIR`                           | Lo define el operador del ERP                   |
| Documentación del contrato STCCalcV3   | Provista por el equipo de la API (no en repo)   |
| Owner saliente                         | Fernando Rodriguez Memije <fmemije00@gmail.com> |

> **Placeholders**: cuando recibas el handoff, agrega aquí los contactos
> del cliente final, del equipo de la API en Azure, y del operador del
> ERP. Hoy esos datos viven en correos / Slack y no en el repo.

## 14. FAQ

**P: ¿Cómo agrego una nueva operación (por ejemplo `refund_tax`)?**
R: Cuatro cambios coordinados, todos en `src/`:
1. Añadir el nombre en `TaxValidator.validOperations` (validators/taxValidator.js).
2. Añadir reglas específicas en `validateCommittedField` si aplica.
3. Añadir el branch correspondiente en `Config.getEndpointUrl`
   (config/index.js).
4. (Opcional) Añadir un método `refundTax(body)` en `TaxApiClient` para
   simetría con `getTax`/`postTax`/`cancelTax`.
La capa CLI no requiere cambios porque ya despacha por nombre de operación.

**P: ¿Cómo cambio el endpoint sin tocar código?**
R: Edita `.env` → `BASE_URL`. El path (`STCCalcV3` o `STCCalcV3_TEST`) lo
controla `TEST_MODE`. Los nombres `STCCalcV3*` y `CancelTransaction` están
hard-coded en `src/config/index.js`, así que un cambio de path sí requiere
PR.

**P: ¿Qué pasa si el JSON tiene `Committed` con el valor equivocado para
la operación?**
R: El validador aborta antes de llamar a la API. Mensaje:
`Para la operación get_tax, el valor "Committed" debe ser false.`
(o `true` para `post_tax`). El proceso termina con exit 1 y se escribe en
`logs/log_YYYY-MM-DD.log`.

**P: ¿Qué hace exactamente la sanitización?**
R: `taxValidator.sanitizeStringFields` clona el body con `JSON.parse(JSON.stringify(..., replacer))` y reemplaza cada `'` por `\'` en los strings. Es defensivo: la API rechazaba ciertos payloads con apostrofes en direcciones (ej. `Plummer's`). Si la API empieza a fallar con comillas dobles u otros caracteres, esta función es donde se amplía.

**P: ¿Dónde aterriza un error de timeout?**
R: Tres lugares: (1) `stderr` con un mensaje "Timeout de conexión", (2)
`logs/log_YYYY-MM-DD.log` con el detalle, (3) exit code 1. El timeout
está fijo en 30 segundos en `TaxApiClient.timeout`.

**P: ¿Cómo verifico que una corrida fue exitosa sin abrir el JSON?**
R: El proceso imprime `SUCCESS: <operation> - File: <name>` en consola y
sale con exit 0. Si el script invocador captura `$?` o `%ERRORLEVEL%`,
con eso basta. Para verificar el contenido, abrir `RESPONSE_<archivo>.json`
en `OUTPUT_DIR` (se sobreescribe en cada corrida del mismo archivo de
entrada).

---

**Bienvenido al proyecto.** Empieza por leer este documento, luego
`ARCHITECTURE.md` para el mapa del código, y `RUNBOOK.md` para los
procedimientos del día a día. Cualquier supuesto que detectes que ya no
aplique, actualízalo aquí: este documento es la fuente de verdad para
quien venga después.
