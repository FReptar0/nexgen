# nexgen — Puente Sage 300 ↔ API de Impuestos

## What This Is

CLI de Node.js que conecta el ERP (Sage 300 en producción) con una API externa de
cálculo de impuestos de EE.UU. Lee un JSON de transacción que el área de ERP extrae
desde Sage, llama a la API, y escribe la respuesta en `OUTPUT_DIR/RESPONSE_<archivo>.json`
para que el ERP la recoja. No es un demonio: una invocación, una operación, sale.

El proveedor liberó un contrato nuevo (**Synexus Compute v2**) y el encargo actual es
que nexgen funcione contra esa versión, sin tocar lo que hoy corre en producción.

## Core Value

**El monto de impuesto que nexgen escribe en el archivo de respuesta tiene que ser el
correcto, y no debe alterar estado en la API del proveedor sin que se haya pedido
explícitamente.** Todo lo demás —velocidad, ergonomía, cobertura— es secundario:
esto toca dinero y registros fiscales de un tercero.

## Requirements

### Validated

<!-- Inferido del código existente. Funciona en producción hoy. -->

- ✓ CLI de una invocación / una operación / exit — `index.js`, `src/cli/taxCommandHandler.js`
- ✓ Tres operaciones: `get_tax` (cotizar), `post_tax` (confirmar), `cancel_tax` (cancelar)
- ✓ Arquitectura en 5 capas con inyección de dependencias cableada sólo en `index.js`
- ✓ Validación estricta del campo `Committed` (`get_tax` exige `false`, `post_tax` exige `true`) — `src/validators/taxValidator.js:38-55`
- ✓ Sanitización de apóstrofes en campos de texto — `src/validators/taxValidator.js:76-95`
- ✓ Intercambio por archivos: lee JSON de entrada, escribe `RESPONSE_<nombre>.json` conservando la numeración original — `src/storage/fileManager.js`
- ✓ Configuración por `dotenv`, singleton, con `BASE_URL` / `API_CODE` / `OUTPUT_DIR` requeridos — `src/config/index.js`
- ✓ Logger winston nivel `error` con rotación diaria — `src/infrastructure/logger.js`
- ✓ Cliente HTTP único con timeout de 30s y clasificación de errores de red — `src/api/taxApiClient.js`
- ✓ Integración v1 vigente: `STCCalcV3` / `STCCalcV3_TEST` / `CancelTransaction`, vía `GET` con cuerpo JSON y autenticación `?code=` en la URL

<!-- Validado en Fase 1 (2026-09-11): verificado sin red contra el código; la confirmación en vivo es de la Fase 3. -->

- ✓ Runner de pruebas con un comando, sin `.env`, sin credenciales, sin red — `npm test`, 242 casos — Fase 1
- ✓ Camino v1 congelado por pruebas de cable y de mensajes; `taxApiClient.js` sin un solo cambio — Fase 1
- ✓ Selector de contrato: v1 por omisión, v2 explícito vía `TAX_API_VERSION` o `--api-version=v2`; flag mal escrito aborta en vez de caer en v1 — Fase 1
- ✓ `get_tax` v2 tipado `sales_estimate` + `committed: false` — no persiste factura — con guardia de regresión que niega `sales_invoice` — Fase 1
- ✓ `POST /api/v1/tax_calculations` con `Authorization: Bearer` y `X-Synexus-Entity`; credencial nunca en la URL ni en stdout/logs — Fase 1
- ✓ `request_id` UUID v4 en cada petición v2, desde `randomBytes` — Fase 1
- ✓ Freno host ↔ prefijo de llave antes de la red; rechaza `http://`, rutas, query y credenciales embebidas — Fase 1
- ✓ Código de entidad por precedencia flag > env > JSON, nunca hardcodeado; aborta en español si no se resuelve — Fase 1
- ✓ Guardia "archivo parece del contrato v1" bajo selector v2 — Fase 1

### Active

<!-- Alcance actual. Hipótesis hasta que se verifiquen contra staging. -->

- [ ] `post_tax` debe confirmar (`transaction_type: "sales_invoice"` + `committed: true`) — Fase 2
- [ ] `cancel_tax` debe apuntar a `POST /api/v1/invoices/cancel` — Fase 2
- [ ] Tratar montos y tasas como cadenas decimales de extremo a extremo (cero `parseFloat`) — Fase 2
- [ ] Respuesta v2 escrita completa y sin transformar, con `request_id` del proveedor registrado — Fase 2
- [ ] Reintento tras timeout reutiliza la misma llave de idempotencia — Fase 2
- [ ] Fixture de contrato desde la respuesta real de staging (hoy dentro de un PDF en `data/`) — Fase 2
- [ ] Decidir el escape de apóstrofos en el cable v2 (WR-03) y la validación de forma del JSON raíz (WR-04) — Fase 2
- [ ] Procedimiento de verificación contra staging y lista de corte a producción — Fase 3
- [ ] Camino v1 intacto y funcionando durante toda la migración — continuo, verificado por la suite en cada fase

### Out of Scope

<!-- Fronteras explícitas, con razón, para que no se re-agreguen sin discutirlo. -->

- **`npm audit fix`** (3 vulnerabilidades: `form-data` crítica, `axios` alta, `follow-redirects` moderada) — actualizar axios toca el mismo cliente HTTP que sostiene el `GET`-con-cuerpo de v1, un patrón inusual y sensible a los internos de axios. Arreglarlo aquí pone en riesgo producción. Va en milestone propio con revalidación explícita de v1.
- **`BASE_URL` obsoleta en la documentación** — `HANDOFF.md` §6.2, `README.md` y `ARCHITECTURE.md` §9 citan un host que devuelve 404 en `STCCalcV3`. Es deuda de v1 y no bloquea v2. Queda anotado en `.planning/codebase/CONCERNS.md`.
- **Suite de pruebas completa** — el repo no tiene ninguna. Construirla entera compite con el encargo. Sólo se cubre el mapeo v2, que es donde vive el riesgo nuevo.
- **Flujo de devoluciones / notas de crédito** (`return_invoice`, `return_estimate`) — capacidad nueva del contrato v2 que nexgen no tiene hoy y que nadie ha pedido.
- **`PATCH /api/v1/invoices/update`** (promover un snapshot a confirmado) — existe en v2, no tiene equivalente en el CLI actual. Se documenta, no se implementa.
- **Corte de producción a v2** — requiere acceso al servidor, llave de producción y el código de entidad real. Es una decisión operativa del área de ERP, no de este milestone.
- **"SDCAM"** — mencionado dos veces en la reunión del 9-sep como tema posterior. Cero coincidencias en los cuatro PDF del proveedor. No se infiere: queda como pregunta abierta.

## Context

**Origen del encargo.** Reunión del 9-sep-2026 con el área de ERP (transcripción y
correos en `data/`, fuera de git). El proveedor liberó el contrato v2 junto con un
rebrand de marca. El encargo textual fue: revisar qué cambios se requieren para
actualizar URL y headers, *sobre una rama nueva, sin mover producción*.

**Lo que NO cambia.** La metodología de intercambio por archivos se conserva tal cual:
el área de ERP genera una extracción desde Sage y deja un JSON; nexgen lo manda como
cuerpo de la petición, recibe la respuesta y escribe `RESPONSE_<mismo nombre>.json`
conservando la numeración. La instrucción fue explícita: *"dejemos la versión dos
funcionando igual que la uno, simplemente ya apuntando"*.

**El contrato v2 ya está vigente en staging.** El rebrand de headers y prefijos de
llave ya ocurrió del lado del proveedor; no es un cambio futuro que haya que anticipar.
Hay una prueba real exitosa contra staging (respuesta completa archivada en `data/`)
que sirve como contrato de referencia y evita ensayo y error.

**El material de referencia son cuatro PDF, no un spec.** No existe Swagger ni OpenAPI:
se confirmó con el proveedor y se verificó buscando en los cuatro documentos. Los PDF
fueron impresos desde un sitio HTML con Chrome headless, lo que sugiere que existe
documentación web detrás del portal. Los PDF viven en `data/` (excluido de git).

**Sobre la documentación del proveedor.** Las dos rutas de cálculo que aparecen en los
PDF (`/tax_calculations` y `/tax_calculations/calculate`) son equivalentes: la
referencia de API documenta la segunda como alias oficial de la primera. nexgen usa la
canónica, sin `/calculate`. La referencia de API trae la tabla completa de campos de
petición v2 (45 campos con tipo y obligatoriedad; sólo `invoice_id`, `customer_id`,
`to_state` y `to_zip` son obligatorios a nivel raíz), así que el contrato de destino
está íntegramente especificado. **Lo que no está en ningún PDF es la forma del JSON que
produce hoy la extracción de Sage** — eso sólo existe en los archivos reales del ERP.
El host de documentación de errores que la API devuelve en cada respuesta de error
(`docs_url`) no resuelve en DNS.

**Estado del repositorio.** Rama `feat/synexus-v2-migration`. **Fase 1 completa
(2026-09-11):** el camino v2 emite una cotización de punta a punta, verificada sin red;
v1 congelado por pruebas. Jest 29.7.0 con 9 suites / 242 casos. Sin CI ni linter todavía.
Mapa del código en `.planning/codebase/` generado 2026-09-10 — **desfasado**: no incluye
`synexusConfig.js`, `synexusRequestBuilder.js`, `synexusApiClient.js` ni `tests/`;
refrescar con `/gsd-map-codebase` antes de planear la Fase 2.

## Constraints

- **Compatibilidad**: el camino v1 debe seguir funcionando sin cambios de comportamiento durante toda la migración — es lo que corre en producción y la instrucción fue no moverlo.
- **Contrato de integración**: el prefijo `RESPONSE_` y la conservación del nombre y numeración del archivo original son contrato con los envoltorios del ERP. No se tocan.
- **Frontera de ambientes**: el proveedor impone correspondencia dura entre host y prefijo de llave. Cruzarlos devuelve `401`. No hay forma de saltarla.
- **Acceso geográfico**: el portal y la API del proveedor sólo aceptan peticiones desde EE.UU. y Canadá. Toda verificación contra staging exige el servidor de la empresa o VPN — no se puede hacer desde una máquina local en México.
- **Tech stack**: Node.js 14+, CommonJS, sin ESM. Tres dependencias en runtime. Sin paso de build.
- **Idioma**: comentarios y mensajes de error al usuario en español; identificadores de código en inglés camelCase.
- **Secretos**: `.env` y cualquier valor con pinta de credencial nunca entran a git. `data/` está excluido del repositorio y su contenido no debe citarse en `.planning/`.

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Migrar las tres operaciones, no sólo el cálculo | Una migración parcial dejaría `post_tax` apuntando a la API vieja mientras `get_tax` apunta a la nueva: el estado de las transacciones se partiría entre dos proveedores | — Pending |
| Añadir v2 en paralelo en vez de refactorizar el camino existente | Riesgo cero para producción; permite volver atrás cambiando un selector en vez de revirtiendo commits | — Pending |
| v1 es el comportamiento por defecto; v2 se activa con un interruptor en la configuración de entorno | El envoltorio del ERP invoca `node index.js get_tax <archivo>` sin selector y no puede cambiarse, así que v1 tiene que seguir siendo el default: exigir el selector siempre rompería producción. Poner el interruptor en la configuración de entorno además satisface VERIF-04, porque revertir a v1 pasa a ser cambiar una línea de configuración sin desplegar código. Un argumento de línea de comandos lo sobreescribe para pruebas puntuales. Cierra la tensión CFG-03 ↔ COMP-01 | — Pending |
| `get_tax` → `transaction_type: "sales_estimate"`, no sólo `committed: false` | La referencia de API documenta que `committed: false` **igual persiste** un snapshot de factura, y que suprimir la persistencia requiere `sales_estimate`. El default del campo es `sales_invoice`. El mapeo ingenuo crearía un registro por cada cotización | — Pending |
| Enviar siempre `request_id` como llave de idempotencia | La API cachea la respuesta 5 minutos por `request_id`. Con timeout de 30s contra un backend en la nube, un reintento sin idempotencia puede duplicar un registro fiscal | — Pending |
| Validar host ↔ prefijo de llave antes de emitir la petición | La frontera de ambientes del proveedor devuelve `401` al cruzarlos. Fallar temprano con mensaje en español es diagnosticable; un `401` a media corrida no lo es | — Pending |
| Código de entidad por precedencia: flag CLI > variable de entorno > campo del JSON | El valor varía por empresa y por inventario de Sage, así que no puede fijarse. La precedencia acomoda cualquiera de las formas en que el área de ERP decida entregarlo, sin comprometer la decisión hoy | — Pending |
| Montos y tasas como cadena decimal de extremo a extremo | El contrato v2 devuelve `"49.99"`, no `49.99`. Un `parseFloat` intermedio introduce error de punto flotante en cifras fiscales | — Pending |
| Aplazar `npm audit fix` a milestone propio | La corrección toca axios, y axios sostiene el `GET`-con-cuerpo de v1. El riesgo de romper producción supera al de las vulnerabilidades en un CLI interno con entrada controlada | — Pending |
| Cerrar el milestone en "verificado contra staging", no en "producción cortada" | El corte necesita servidor, llave de producción y el entity real: insumos que no controla quien implementa | — Pending |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-09-11 after Phase 1 completion*
