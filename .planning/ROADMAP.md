# Roadmap: nexgen — Migración a Synexus Compute v2

## Overview

El encargo no es construir algo nuevo: es hacer que un CLI que hoy corre en producción
hable un contrato distinto, sin que el camino actual se mueva un milímetro. Y es un
encargo corto: lo que pidió el área de ERP fue apuntar a la versión dos dejándola
funcionando igual que la uno, no rediseñar nexgen.

Por eso el recorrido son tres fases, no seis. La primera deja el camino v2 funcionando
de punta a punta para una cotización —red de seguridad que congela v1, arranque que
anuncia perfil y aborta antes de tocar la red, y `get_tax` emitiendo contra v2 sin dejar
rastro en el proveedor—. La segunda migra las otras dos operaciones y asegura que la
respuesta llegue íntegra al archivo que lee el ERP. La tercera es la verificación contra
staging, que **no ejecuta quien implementa** sino el área de ERP desde el servidor de la
empresa.

Esa última separación no es preferencia de diseño: el proveedor restringe el acceso a
EE.UU. y Canadá y las credenciales viven con el área de ERP. Por eso las fases 1 y 2
están escritas para ser comprobables **sin red**, contra pruebas y contra la respuesta
real archivada que sirve de fixture de contrato. Ninguna de sus condiciones de éxito
exige una llamada en vivo; el único criterio de todo el roadmap que la exige es el
criterio 2 de la fase 3.

Consolidar fases acorta el camino, no las garantías: los 35 requisitos siguen mapeados,
ninguno se diluyó y ninguno cambió de exigencia.

El milestone cierra en "verificado contra staging", no en "producción cortada". El corte
necesita servidor, llave de producción y el código de entidad real: insumos que no
controla quien implementa.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [x] **Phase 1: Camino v2 de punta a punta para una cotización** ✓ 2026-09-11 - Red de seguridad que congela v1, arranque con frenos antes de la red, y `get_tax` migrada sin dejar rastro en el proveedor
- [ ] **Phase 2: Confirmar, cancelar y devolver la respuesta íntegra** - `post_tax` y `cancel_tax` migradas, y la respuesta v2 llegando sin pérdida al archivo que lee el ERP
- [ ] **Phase 3: Verificación contra staging y corte documentado** - Procedimiento que el área de ERP ejecuta desde el servidor, más la lista de corte a producción

## Phase Details

### Phase 1: Camino v2 de punta a punta para una cotización
**Goal**: Dejar el camino v2 funcionando de punta a punta para una cotización, sin que v1 se mueva
**Mode:** mvp
**Depends on**: Nothing (first phase)
**Requirements**: TEST-01, TEST-06, COMP-01, COMP-04, CFG-03, CONN-04, CONN-05, CFG-01, CFG-02, CFG-04, CFG-05, SAFE-03, TEST-05, CONN-01, CONN-02, CONN-03, OPER-01, OPER-04, OPER-05, SAFE-01, TEST-03
**Success Criteria** (what must be TRUE):
  1. Un solo comando ejecuta la suite completa sin `.env`, sin credenciales y sin acceso a la red, y termina con código de salida 0
  2. La suite falla si el camino v1 cambia de método HTTP, URL resuelta, mecanismo de autenticación o mensajes de error respecto a su comportamiento actual; una invocación sin selector —`node index.js get_tax <archivo>`, tal como la emite el envoltorio del ERP— sigue tomando el camino v1, y v2 sólo se activa por el interruptor de configuración de entorno o por el argumento de línea de comandos que lo sobreescribe
  3. Al inicio de toda corrida v2, la salida estándar muestra el contrato, el host y el código de entidad efectivos antes de cualquier salida a la red; el host se lee de configuración y no está escrito en el código; ni la salida estándar ni los archivos de log contienen la llave, que aparece enmascarada
  4. El código de entidad se resuelve por precedencia —argumento de línea de comandos, luego variable de entorno, luego campo del JSON—; si ninguna vía lo provee, o si falta cualquier otra variable requerida por el camino v2, la corrida aborta al arrancar con un mensaje en español que nombra qué falta y cómo proporcionarlo
  5. Abortan antes de emitir cualquier petición de red: una corrida cuyo prefijo de llave no corresponde al host configurado —con prueba que verifica ese rechazo—, un `Committed` invertido, una operación fuera de la lista y un campo de intención ausente
  6. `get_tax` produce un `POST` con cuerpo JSON contra la ruta de cálculo v2, con la llave en el header `Authorization: Bearer`, el código de entidad en su header dedicado, ninguna credencial en la URL, una llave de idempotencia única generada por nexgen, y un cuerpo tipado de forma que el proveedor no persiste registro alguno —con prueba que falla si ese cuerpo pudiera persistir factura—; el cableado nuevo se arma sólo en `index.js`, sin que ninguna capa introducida requiera a otra por fuera de su constructor
**Plans**: 4 (01-01 … 01-04), todos completos ✓ 2026-09-11
Plans:
- [x] 01-01-PLAN.md — Runner de pruebas y congelamiento del camino v1
- [x] 01-02-PLAN.md — Selector de contrato y configuración v2 con frenos antes de la red
- [x] 01-03-PLAN.md — Cuerpo de la cotización tipado como estimación, con su guardia de regresión
- [x] 01-04-PLAN.md — La petición v2 sale: POST, header portador y cierre del cableado
**Nota**: Aquí vive el riesgo más caro del milestone. El mapeo obvio del contrato v2 —marcar la cotización como no confirmada— igual persiste un snapshot de factura del lado del proveedor; suprimir la persistencia exige tipar la transacción explícitamente. Por eso OPER-01 y su guardia de regresión TEST-03 se quedan juntos en esta fase: la prueba es lo único que impide que un refactor futuro reintroduzca el registro fantasma.
**Nota**: La tensión CFG-03 ↔ COMP-01 ya está resuelta y esta fase la implementa, no la decide. v1 es el comportamiento por defecto cuando no se indica contrato, porque el envoltorio del ERP invoca `node index.js get_tax <archivo>` sin selector y no puede cambiarse; v2 requiere activación explícita mediante el interruptor de despliegue en la configuración de entorno, que un argumento de línea de comandos sobreescribe para pruebas puntuales.

### Phase 2: Confirmar, cancelar y devolver la respuesta íntegra
**Goal**: Las otras dos operaciones migradas y la respuesta llegando íntegra al ERP
**Mode:** mvp
**Depends on**: Phase 1
**Requirements**: SAFE-04, SAFE-05, SAFE-06, COMP-02, COMP-03, TEST-04, VERIF-01, OPER-02, OPER-03, SAFE-02, TEST-02
**Success Criteria** (what must be TRUE):
  1. `post_tax` construye una petición v2 que registra una factura confirmada, con la validación estricta de `Committed` vigente bajo el contrato v2
  2. `cancel_tax` apunta al endpoint de cancelación v2 y conserva su semántica actual de cancelar una transacción previamente confirmada
  3. Un reintento tras timeout reutiliza la misma llave de idempotencia, y hay prueba que lo verifica
  4. Cada una de las tres operaciones tiene prueba que verifica el cuerpo de la petición v2 que construye, sin salir a la red; la respuesta real de staging archivada en `data/` funciona como fixture de contrato de esas pruebas, y hay prueba que falla si la forma de la respuesta esperada se desvía de ella
  5. Los montos y tasas se escriben con los mismos dígitos que devolvió el proveedor, y hay prueba que falla si alguno pasa por conversión a punto flotante en cualquier punto del camino
  6. El archivo de salida conserva el nombre del archivo de entrada, el prefijo `RESPONSE_`, la numeración original y el directorio de salida, con el cuerpo escrito completo y sin transformar; los errores del contrato v2 se distinguen por su código estable y no por el texto del mensaje; y el identificador de petición que devuelve el proveedor queda registrado en toda corrida, exitosa o fallida
**Plans**: TBD

### Phase 3: Verificación contra staging y corte documentado
**Goal**: El área de ERP puede validar las tres operaciones contra staging siguiendo un procedimiento escrito, y queda con una lista de verificación para decidir y ejecutar el corte a producción
**Mode:** mvp
**Depends on**: Phase 2
**Requirements**: VERIF-02, VERIF-03, VERIF-04
**Success Criteria** (what must be TRUE):
  1. Existe un procedimiento escrito, ejecutable desde el servidor de la empresa, que valida las tres operaciones contra staging paso a paso, incluyendo qué observar en cada respuesta
  2. Las tres operaciones quedan ejecutadas con éxito contra staging y sus respuestas archivadas
  3. Existe una lista de verificación de corte a producción que incluye la comprobación previa de correspondencia llave↔host, qué observar en la primera transacción real, y cómo revertir al camino v1 sin desplegar código
**Plans**: TBD
**Nota**: Esta fase la **ejecuta el área de ERP**, no quien implementa. El proveedor restringe el acceso a EE.UU. y Canadá y las credenciales de staging viven con el área de ERP, así que la corrida en vivo no puede hacerse desde una máquina local en México. Lo que produce quien implementa son los criterios 1 y 3 —documentos ejecutables—; el criterio 2 es el único de todo el roadmap que exige red, y lo satisface un tercero siguiendo el procedimiento del criterio 1. La reversión del criterio 3 es una línea de configuración de entorno, no un despliegue, porque el interruptor de contrato vive ahí.

## Progress

**Execution Order:**
Las fases se ejecutan en orden numérico: 1 → 2 → 3

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Camino v2 de punta a punta para una cotización | 4/4 | Complete | 2026-09-11 |
| 2. Confirmar, cancelar y devolver la respuesta íntegra | 0/TBD | Not started | - |
| 3. Verificación contra staging y corte documentado | 0/TBD | Not started | - |

## Cobertura de requisitos

| Requisito | Fase |
|-----------|------|
| CONN-01 | Phase 1 |
| CONN-02 | Phase 1 |
| CONN-03 | Phase 1 |
| CONN-04 | Phase 1 |
| CONN-05 | Phase 1 |
| OPER-01 | Phase 1 |
| OPER-02 | Phase 2 |
| OPER-03 | Phase 2 |
| OPER-04 | Phase 1 |
| OPER-05 | Phase 1 |
| SAFE-01 | Phase 1 |
| SAFE-02 | Phase 2 |
| SAFE-03 | Phase 1 |
| SAFE-04 | Phase 2 |
| SAFE-05 | Phase 2 |
| SAFE-06 | Phase 2 |
| CFG-01 | Phase 1 |
| CFG-02 | Phase 1 |
| CFG-03 | Phase 1 |
| CFG-04 | Phase 1 |
| CFG-05 | Phase 1 |
| COMP-01 | Phase 1 |
| COMP-02 | Phase 2 |
| COMP-03 | Phase 2 |
| COMP-04 | Phase 1 |
| TEST-01 | Phase 1 |
| TEST-02 | Phase 2 |
| TEST-03 | Phase 1 |
| TEST-04 | Phase 2 |
| TEST-05 | Phase 1 |
| TEST-06 | Phase 1 |
| VERIF-01 | Phase 2 |
| VERIF-02 | Phase 3 |
| VERIF-03 | Phase 3 |
| VERIF-04 | Phase 3 |

**Cobertura: 35/35 requisitos v1 mapeados. Cero huérfanos, cero duplicados.**

---
*Roadmap creado: 2026-09-10*
*Roadmap consolidado a 3 fases: 2026-09-10 (granularidad `coarse`; sin cambios de alcance)*
