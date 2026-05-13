# MEMORY — nexgen

> Memoria histórica reconstruida desde `git log` y la lectura del
> código. Léelo antes de cambios estructurales: aquí están los "por qué"
> que no caben en el código.
> Idioma: español. Última actualización: 2026-05-12.

## Decisiones históricas

### D1 — Arquitectura por capas con DI (commit `4d00602`, 2025-10-21)

**Decisión**: refactorizar el `index.js` monolítico original (un script
único de ~150 líneas) a cinco capas independientes con inyección de
dependencias orquestada en el entry point.

**Motivación**: el `index.js` original mezclaba CLI parsing, validación,
HTTP, persistencia y logging. Hacer cualquier cambio requería tocar
varias responsabilidades a la vez. La refactorización aplica SRP
(Single Responsibility Principle) por capa y Dependency Inversion para
permitir tests con mocks en el futuro.

**Consecuencias**:
- Cada clase es testeable en aislamiento (aunque hoy no hay tests).
- El `index.js` quedó como ensamblador puro (70 líneas, todas DI).
- El "costo" es que agregar una operación implica tocar al menos tres
  archivos (validator, config, opcionalmente apiClient).

### D2 — `TEST_MODE` para alternar endpoints (commits `2877886`, `6b6ce39`)

**Decisión**: una sola variable de entorno `TEST_MODE` controla si las
operaciones `get_tax`/`post_tax` golpean el endpoint
`STCCalcV3_TEST` (modo de pruebas) o `STCCalcV3` (producción). El
`cancel_tax` no respeta este flag y siempre va a `CancelTransaction`.

**Motivación**: poder verificar comportamiento contra la API sin
escribir transacciones en la contabilidad real del cliente. Originalmente
(`2877886`) se introdujo el switch; después (`6b6ce39`) se ajustó el
nombre del endpoint de producción a `STCCalcV3`.

**Riesgo asumido**: si alguien deja `TEST_MODE=true` por error en una
máquina productiva, los montos calculados no impactan la contabilidad
real y el ERP queda desincronizado. Documentado en `HANDOFF.md` §7 y
`RUNBOOK.md` §3.

### D3 — Sanitización de strings para apostrofes (commit `ed6b3f2`, 2025-11-05)

**Decisión**: antes de enviar el body a la API, recorrer recursivamente
todos los strings y reemplazar `'` por `\'`.

**Motivación**: el cliente final (Plummer's Environmental Services)
tiene un apostrofe en su nombre comercial. Direcciones del tipo
`Plummer's Environmental SRVC, 64` fallaban del lado del servidor. La
solución fue defensiva del lado del cliente.

**Alcance**: solo apostrofes. Si en el futuro aparecen problemas con
otros caracteres especiales (comillas dobles, control chars), la regla
se amplía en `TaxValidator.sanitizeStringFields`.

**Implementación**: `JSON.parse(JSON.stringify(body, replacer))` —
clona y transforma en una sola pasada. No muta el objeto original.

### D4 — Migración de `node-notifier` a winston (commits `ea97d2a` → `fb0ca9f` → `e403bf2`)

**Historia**:
1. `ea97d2a` (2025-03-10): se agregó `node-notifier` para mostrar
   notificaciones nativas del SO en errores.
2. `fb0ca9f` (2025-04-04): se eliminaron las notificaciones porque
   ensuciaban el flujo automatizado (Sage corre sin escritorio).
3. `e403bf2` (2025-07-02): se agregó `winston` para escribir errores a
   un archivo diario.

**Decisión final**: el logging es solo a archivo (no a SO), nivel
`error` exclusivamente. La consola sigue siendo el canal de salida
para humanos / wrappers.

### D5 — Logger fijo en `level: 'error'`

**Decisión**: el `winston.createLogger` está hard-coded a `level: 'error'`
en `src/infrastructure/logger.js`.

**Motivación**: el caso de uso real es operacional — el ERP llama a
nexgen miles de veces, no se quiere ruido en disco. Solo importa cuando
algo sale mal.

**Consecuencia**: los métodos `logger.info`, `logger.warn` y
`logger.debug` existen pero no producen output al archivo. Llamarlos no
es un error, simplemente es no-op desde el punto de vista de
persistencia.

### D6 — `GET` con body para la API STCCalcV3

**Decisión heredada del contrato externo**: la API expone
`STCCalcV3` y `STCCalcV3_TEST` como método HTTP `GET` que acepta un
body JSON. `taxApiClient.js` usa axios con `method: 'GET'` y `data:
requestBody`.

**Motivación**: no es decisión nuestra. La API fue diseñada así por el
equipo que la opera (probablemente porque Magento STC originalmente lo
expuso así, o por compatibilidad con un consumidor previo).

**Implicaciones**:
- Algunos proxies, balanceadores, o herramientas de test "limpian"
  bodies de requests GET. Si en el futuro nexgen se desplegara detrás
  de un gateway estricto, el body podría perderse.
- Hoy funciona porque axios lo soporta y el servidor lo espera.

### D7 — Convención de nombre del archivo de respuesta

**Decisión**: la respuesta de la API se persiste como
`RESPONSE_<archivo_original>.json` en `OUTPUT_DIR`.

**Implementación**: `FileManager.getResponseFileName(originalFilePath,
outputDir)` retorna
`path.join(outputDir, 'RESPONSE_' + path.basename(originalFilePath))`.

**Consecuencia**: si dos invocaciones procesan el mismo archivo, la
segunda **sobreescribe** el primer response. No hay versionado, no hay
sufijo de timestamp. Si el ERP necesita histórico, debe copiar el
archivo aparte antes de la siguiente corrida.

### D8 — `cancel_tax` no valida `Committed`

**Decisión**: las reglas de `Committed` son estrictas para `get_tax`
(debe ser `false`) y `post_tax` (debe ser `true`), pero `cancel_tax`
no valida este campo.

**Motivación**: el comportamiento de cancelar es independiente del
estado original de la transacción. El cliente solo necesita identificar
qué transacción cancelar (vía `cartID` y demás), no si estaba
confirmada o no.

**Implementación**: `TaxValidator.validateCommittedField` tiene un
comentario explícito `// cancel_tax no valida el campo Committed`.

### D9 — Configuración vía `.env` (singleton)

**Decisión**: `src/config/index.js` exporta `new Config()` (singleton).
La carga de `.env` ocurre una sola vez al `require`.

**Motivación**: evitar que cada capa cargue su propio `dotenv`.
Inicializar una sola vez y compartir.

**Implicación**: cambios al `.env` durante una ejecución **no se
recargan**. Si el proceso es de corta vida (CLI invocado por el ERP),
esto no importa. Si alguien quisiera convertirlo en daemon, cuidado:
hay que reiniciar el proceso para tomar nuevos valores.

## Convenciones

### C1 — Idioma en código

- **Comentarios JSDoc**: español. Toda la documentación inline está en
  español por consistencia con el equipo original.
- **Nombres de clases / métodos / variables**: inglés (`TaxValidator`,
  `getEndpointUrl`, `requestBody`, etc.).
- **Mensajes de error mostrados al usuario**: español ("Operación
  inválida", "Variables de entorno faltantes", etc.).
- **Nombres de archivos**: inglés camelCase (`taxApiClient.js`,
  `fileManager.js`).

### C2 — Estructura de carpetas

```
src/
├── cli/                   # capa CLI
├── validators/            # capa de validación
├── api/                   # capa HTTP
├── storage/               # capa de archivos
├── infrastructure/        # logger
└── config/                # configuración
```

Una carpeta por capa, **un archivo por capa** (hoy). Si una capa crece,
se split en submódulos dentro de la carpeta antes de mover a otra capa.

### C3 — Inyección de dependencias

Toda construcción ocurre **solo en `index.js`**. Ninguna capa hace
`require` de otra capa con efectos colaterales (excepto `config`, que
es un singleton legítimo). El orden de construcción es de abajo hacia
arriba: `Logger` → `FileManager` → `TaxValidator` → `TaxApiClient` →
`TaxCommandHandler`.

### C4 — Errores como excepciones

Toda capa que detecta un error inválido lanza con `throw new Error(...)`
y previamente loggea (consola + winston). El `index.js` tiene un
`try/catch` único que captura todo y hace `process.exit(1)`.

No se usa el patrón `return { ok: false, error: ... }`. Todo es
throw/catch.

### C5 — Salida

- **stdout**: trazas informativas (`console.log`).
- **stderr**: errores (`console.error`).
- **Archivo `logs/log_YYYY-MM-DD.log`**: solo errores (winston).
- **Archivo `OUTPUT_DIR/RESPONSE_*.json`**: la respuesta cruda de la API.

### C6 — Constantes hard-coded

Lista de strings sensibles que viven en el código (no en `.env`):

- `STCCalcV3`, `STCCalcV3_TEST` — nombres de endpoints
  (`src/config/index.js`).
- `CancelTransaction` — endpoint de cancelación
  (`src/config/index.js`).
- `RESPONSE_` — prefijo del archivo de respuesta
  (`src/storage/fileManager.js`).
- `30000` — timeout HTTP en ms (`src/api/taxApiClient.js`).
- `'error'` — nivel del logger (`src/infrastructure/logger.js`).
- `['get_tax', 'post_tax', 'cancel_tax']` — operaciones válidas
  (`src/validators/taxValidator.js`).

Cualquier cambio a estos valores requiere PR.

## Deuda conocida

(Cross-referencia con `HANDOFF.md` §11 — aquí solo el contexto histórico.)

- **Tests**: nunca se llegaron a escribir. El placeholder en
  `package.json` (`"test": "echo \"Error: no test specified\" && exit 1"`)
  está desde el `first commit`.
- **CI**: nunca se configuró. El repo no tiene `.github/workflows/`.
- **`package.json` incompleto**: `description`, `author`, `repository`,
  `keywords`, `license` (más allá del default `ISC`) están vacíos
  desde el inicio.
- **`postman/` vacío**: se creó la carpeta para guardar colecciones de
  Postman pero nunca se versionaron.
- **`results/` y `test-files/` gitignored**: contienen datos del
  cliente. Ver commit `6968cda`.

## Anti-patrones evitados

- **No** se usa el `process.env` directamente fuera de
  `src/config/index.js`. Si algo necesita un valor de entorno, lo pide
  por DI a `Config`.
- **No** se mezcla `fs` con lógica de negocio. Todo I/O pasa por
  `FileManager`.
- **No** se usa `axios` fuera de `TaxApiClient`. Es el único lugar que
  conoce HTTP.

## Lecciones aprendidas

1. **Sanitizar antes de enviar** (D3): los datos del cliente final
   tienen caracteres que el servidor no maneja en algunos casos. El
   cliente CLI es el lugar correcto para limpiarlos — no asumir que
   el ERP lo hará.
2. **El `Committed` flag es semántica del API, no nuestra**: la regla
   estricta evita que un `post_tax` con `Committed: false` pase por
   error (que dejaría la API en un estado raro).
3. **Logging solo en errores**: no contaminar disco con info
   operacional cuando el invocador (ERP) ya tiene su propia bitácora.
