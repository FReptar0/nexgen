---
phase: 02-confirmar-cancelar-y-devolver-la-respuesta-ntegra
verified: 2026-09-11T06:30:00Z
status: passed
score: 6/6 criterios de éxito · 11/11 requisitos · 33/33 comprobaciones ejecutadas contra el código · review 0 críticos, 2 advertencias resueltas
re_verification: false
verified_by: orquestador (comprobaciones ejecutadas directamente; el patrón de agentes verifier atorándose se evitó a propósito)
---

# Fase 2: Confirmar, cancelar y devolver la respuesta íntegra — Reporte de verificación

**Meta de la fase:** Las otras dos operaciones migradas y la respuesta llegando íntegra al ERP
**Verificado:** 2026-09-11 · árbol `b9f681d`
**Estado:** PASSED

Toda comprobación se obtuvo **ejecutando** comandos contra el árbol — `npm test`, `git diff`,
`node -e`, corridas reales del CLI con la red bloqueada por preload — sin `.env`, sin
credenciales, sin red.

**Con esta fase, las tres operaciones funcionan contra el contrato v2. El encargo del área
de ERP —"que funcione para la v2, igual que la uno, sólo apuntando"— queda cubierto en
código.** Lo que sigue (Fase 3) es verificación en vivo y corte documentado.

---

## Criterios de éxito del ROADMAP

| # | Criterio | Estado | Evidencia |
|---|----------|--------|-----------|
| 1 | `post_tax` registra factura confirmada, con validación estricta vigente bajo v2 | VERIFIED | `getIntentFor('post_tax')` → `{sales_invoice, committed:true}`; corrida real: cuerpo tipado `sales_invoice` + `committed: true` a `/api/v1/tax_calculations`. TEST-02 validada por 3 mutaciones (`committed:false`, `sales_estimate`, `else` por omisión). `validateV2IntentFields` aborta ante contradicción; guardia de archivo v1 vigente |
| 2 | `cancel_tax` apunta al endpoint v2 conservando su semántica | VERIFIED | Corrida real: `POST …/api/v1/invoices/cancel` con cuerpo **exactamente** `{invoice_id, customer_id}` — `to_state`/`cart` del archivo no viajan; aborta antes de red si falta alguno o no es cadena (WR-01). URL sólo en `SynexusConfig`. No pasa por `getIntentFor` (lanza) |
| 3 | Reintento tras timeout reutiliza la misma llave, con prueba | VERIFIED | `_sendWithRetry`: `maxRetries = 1`, mismo objeto `requestBody` por identidad, lista cerrada (ECONNABORTED/502/503/504/409-cancel/409-`invoice_stale_object`), nunca `idempotency_key_conflict`/401/4xx. 4 mutaciones en la ola 4 + 2 casos WR-02 (espera detenida → axios en 1; espera que rechaza → sin segundo intento), verificados por mutación |
| 4 | Cada operación con prueba del cuerpo v2 sin red; fixture real como contrato con prueba de forma | VERIFIED | `tests/fixtures/` byte a byte con `data/fixtures/` (`cmp`), sin credenciales (grep). 21 casos de forma (llaves raíz, montos como cadena en `totals` y `cart[]`, `meta.request_id`, `warnings[]`). `tax_amount: "0.00"` = `no_nexus`, nunca fallo |
| 5 | Montos con los mismos dígitos; prueba que falla ante punto flotante | VERIFIED | `FileManager` **real** sobre tmpdir (primera vez instanciado en pruebas): `"0.00"`, `"0.0825"`, `"1234567.89"` llegan entre comillas. `grep` en `src/`: 0 `parseFloat`/`Number(`/`toFixed`. Sin capa de normalización por diseño |
| 6 | Archivo `RESPONSE_<original>` intacto; errores por código estable; `request_id` registrado siempre | VERIFIED | Nombre/numeración/directorio probados con `FileManager` real. Cálculo: 7 códigos + genérico con el literal; cancelación: por status; 0 ramificaciones por texto (el único hit del grep es un comentario). `request_id`: cuerpo > header `x-request-id`; en éxito (stdout), en 4xx (mensaje + winston), en red sin respuesta (el de nexgen). Sólo 2 headers leídos: `x-request-id`, `retry-after` |

**Puntaje:** 6/6

---

## Invariantes de toda la fase (desde `4d6d438`)

| Invariante | Estado |
|---|---|
| `src/api/taxApiClient.js`, `src/storage/fileManager.js`, `index.js`, `src/config/index.js`, `tests/v1Freeze.*.test.js` — cero cambios | VERIFIED |
| `src/validators/taxValidator.js` — sólo añadidos (`validateV2FileShape`), 0 líneas borradas | VERIFIED |
| `require('axios')` sólo en los dos clientes; un `process.exit`; 3 deps de runtime | VERIFIED |
| Rama v2 no llama a `validate()`/`validateCommittedField`/`sanitizeStringFields`; sin flag → v1 intacto (corrida real rechaza archivo sin `Committed`, sin rastro del perfil v2) | VERIFIED |
| Llave completa: 0 apariciones en stdout+stderr de las tres corridas v2; cero serialización de `error`/`config`/`headers` | VERIFIED |
| `X-Synexus-Entity` en el cliente; `X-Syntax-Entity` ausente en `src/` | VERIFIED |

## Cobertura de requisitos

| Plan | Requisitos |
|------|------------|
| 02-01 | OPER-02, TEST-02, VERIF-01, TEST-04, SAFE-04, COMP-02, COMP-03 |
| 02-02 | OPER-03, TEST-02 |
| 02-03 | SAFE-05, SAFE-06 |
| 02-04 | SAFE-02 |

**11/11.** Suite: 11 suites / **467 casos** (242 al abrir la fase). Cada ola validada por mutación antes de cada GREEN.

## Code review (`02-REVIEW.md`)

0 críticos · 2 advertencias **resueltas** (WR-01 `ee0c1c7`, WR-02 `596c2ff`) · 8 informativos sin acción. Buscado con insistencia y **no** encontrado: fuga de la llave por el reintento, reintento fuera de la lista o con otro cuerpo, crash ante `data` nulo/HTML/arreglo, APIs incompatibles con Node 14.15.

## No son brechas

WR-03/WR-04 de la Fase 1 — **cerrados aquí**. `.env.example` — bloqueado por permisos, contenido en README. `PATCH /invoices/update` (NEW-02), devoluciones (NEW-01), DEPS/DEBT — diferidos con razón. Documentar v2 en `ARCHITECTURE.md`/`RUNBOOK.md`/`HANDOFF.md` — Fase 3, con el procedimiento operativo. 8 informativos del review + 9 abiertos de la Fase 1 — ninguno bloquea.

## Pendientes fuera del código que condicionan la Fase 3

- Confirmación del área de ERP: forma del JSON v2, `tax_code` en cada línea, forma del archivo de cancelación (debe traer `invoice_id` y `customer_id` como cadenas), y mecanismo del `entity`.
- `mv env .env` en esta máquina.
- El mapa de código (`.planning/codebase/`) se refrescó al abrir la fase; queda ligeramente desfasado (retry, clasificación, `buildCancelBody`). Refrescar antes de planear la Fase 3 es opcional: la Fase 3 es documental.

---

*Verificado: 2026-09-11 · 30 commits en la fase*
