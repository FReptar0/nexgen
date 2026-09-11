---
phase: 01-camino-v2-de-punta-a-punta-para-una-cotizaci-n
verified: 2026-09-11T03:40:00Z
status: passed
score: 6/6 criterios de éxito verificados · 21/21 requisitos cubiertos · 35/35 comprobaciones ejecutadas
re_verification: false
verified_by: orquestador (el agente gsd-verifier se atoró dos veces por inactividad de stream; las comprobaciones se ejecutaron directamente contra el código, no contra los SUMMARY)
---

# Fase 1: Camino v2 de punta a punta para una cotización — Reporte de verificación

**Meta de la fase:** Dejar el camino v2 funcionando de punta a punta para una cotización, sin que v1 se mueva
**Verificado:** 2026-09-11
**Estado:** PASSED
**Re-verificación:** No — verificación inicial

Toda comprobación de este reporte se obtuvo **ejecutando** comandos contra el árbol en
`0e73499` — `npm test`, `git diff`, `node -e`, y corridas reales del CLI con la red
bloqueada por preload — no leyendo los SUMMARY. Ningún paso requirió `.env` (no existe en
esta máquina), credenciales ni red.

---

## Logro de la meta

### Criterios de éxito del ROADMAP

| # | Criterio | Estado | Evidencia |
|---|----------|--------|-----------|
| 1 | Un solo comando ejecuta la suite sin `.env`, sin credenciales y sin red, exit 0 | VERIFIED | `npm test` → 9 suites, **242 pruebas**, exit 0. `.env` ausente. `tests/setup.js` fija valores ficticios, bloquea `http/https.request` y neutraliza `dotenv.config()` |
| 2 | La suite falla si v1 cambia de método, URL, auth o mensajes | VERIFIED | `tests/v1Freeze.wire.test.js` (15 casos) y `tests/v1Freeze.messages.test.js` (12 casos), validados por mutación en la ola 1 (método, header, timeout, nombre de endpoint, mensaje de validador, texto de uso: cada mutación puso la suite en rojo). `git diff 3150ae2 HEAD -- src/api/taxApiClient.js` **vacío** para toda la fase |
| 3 | Nada llega a v2 sin pedirlo explícitamente, con prueba | VERIFIED | Corrida real sin flag con archivo v1 y **con** `SYNEXUS_*` en el entorno → `GET https://v1.invalid/api/STCCalcV3?code=…`, sin rastro del perfil v2. `-api-version=v2` (un guion) aborta con mensaje en vez de caer en v1 (fix WR-02, `4d4d2ac`). `tests/argumentParsing.test.js` cubre ambos |
| 4 | Toda corrida v2 anuncia contrato, host y entidad antes de la red, y aborta en español si falta algo o el prefijo de llave no corresponde al host | VERIFIED | Corrida real v2: `Perfil efectivo -> contrato: v2 \| host: … \| entidad: SMOKE \| llave: synexus_test_...0000` impreso antes de la petición. `http://` rechazado (*"debe usar el esquema https"*), ruta `/api/v1` rechazada (*"trae la ruta"*), credenciales embebidas enmascaradas `***@` (fix WR-01, `8afd6a6`). La llave completa: **0 apariciones** en stdout+stderr |
| 5 | `get_tax` produce un `POST` v2 tipado como estimación que no persiste, con guardia de regresión | VERIFIED | `getIntentFor('get_tax')` → `{"transaction_type":"sales_estimate","committed":false}`; `post_tax`/`cancel_tax`/otro lanzan; sin `else`/`default`. Corrida real: cuerpo con `sales_estimate`, `committed: false`, `request_id` UUID; `POST …/api/v1/tax_calculations`; la red lo detiene ahí. `TEST-03` niega `sales_invoice` 6 veces; validado por mutación en la ola 3 |
| 6 | Cableado nuevo sólo en `index.js`; ninguna capa nueva requiere a otra | VERIFIED | `require('axios')` sólo en `src/api/taxApiClient.js` y `src/api/synexusApiClient.js`. Un solo `process.exit` (`index.js`). `SynexusConfig`, `SynexusRequestBuilder` y `SynexusApiClient` exportan clase y reciben colaboradores por constructor; el ejecutor de la ola 4 verificó cero `require` entre hermanas |

**Puntaje:** 6/6 criterios verificados

---

### Decisiones bloqueadas de `01-CONTEXT.md`

| Decisión | Estado | Evidencia |
|----------|--------|-----------|
| `TaxApiClient` no se modifica ni una línea | VERIFIED | diff vacío contra `3150ae2` |
| `Config.getEndpointUrl()` y las variables requeridas de v1 no cambian | VERIFIED | `src/config/index.js`: +10 −0 |
| La rama v2 **nunca** llama a `validate()` ni `validateCommittedField` | VERIFIED | `_executeV2` (línea rel. 26 de `execute()`) precede a `validate()` (29); cero llamadas dentro de `_executeV2`; corrida real con archivo v2 sin `Committed` pasa la rama v2 |
| `OPER-04` bajo v2 lo cumple `validateV2IntentFields` | VERIFIED | `taxValidator.js` +57 −0; guardia *"parece del contrato v1"* dispara con archivo v1 bajo `--api-version=v2` (corrida real) |
| Header de entidad `X-Synexus-Entity`, nunca `X-Syntax-Entity` | VERIFIED | `grep -r X-Syntax-Entity src/` vacío; `X-Synexus-Entity` en `synexusApiClient.js` |
| Jest 29.7.0 exacto, sólo `devDependencies` | VERIFIED | `package.json`: `"jest": "29.7.0"`; runtime sigue `axios, dotenv, winston` |
| `request_id` desde `randomBytes`, en el cuerpo, sin header | VERIFIED | corrida real muestra UUID v4 en el cuerpo; el review confirmó ausencia de `randomUUID` y de header de idempotencia |
| Configuración v2 exporta la clase, no un singleton | VERIFIED | `new SynexusConfig()` una sola vez dentro del condicional v2 de `index.js`; v1 sin flags corre sin variables de v2 |
| `CFG-05` acotado a v2; fuga de v1 registrada como DEBT-04 | VERIFIED | v1 sigue imprimiendo `?code=` (comportamiento congelado); v2: 0 fugas |

---

### Cobertura de requisitos

Los 21 IDs de la fase aparecen en el frontmatter `requirements:` de exactamente un plan y en `REQUIREMENTS.md`:

| Plan | Requisitos | Estado |
|------|------------|--------|
| 01-01 | TEST-01, TEST-06, COMP-01 | ✓ |
| 01-02 | CFG-03, CONN-04, CONN-05, CFG-01, CFG-02, CFG-04, CFG-05, SAFE-03, TEST-05 | ✓ |
| 01-03 | OPER-01, TEST-03, OPER-04, OPER-05, SAFE-01 | ✓ |
| 01-04 | CONN-01, CONN-02, CONN-03, COMP-04 | ✓ |

**21/21.** Cero huérfanos, cero duplicados.

---

### Code review (post-ejecución)

`01-REVIEW.md`: 0 críticos, 5 advertencias, 10 informativos. Lo buscado con insistencia y **no** encontrado: fuga de la llave por objetos de error de axios, regresión de v1, cotización sin `sales_estimate`, APIs incompatibles con Node 14.15.

| Advertencia | Resolución |
|---|---|
| WR-01 freno host↔llave sólo miraba hostname | ✅ `8afd6a6` — 8 casos nuevos |
| WR-02 flag mal escrito caía en v1 en silencio | ✅ `4d4d2ac` — 12 casos nuevos |
| WR-05 `.env` real reponía variables borradas en la suite | ✅ `2dd5667` — 3 casos nuevos, verificado por mutación |
| WR-03 escape de apóstrofos de v1 aplicado al cable v2 | ⏭ Fase 2 (va con la fidelidad de respuesta) |
| WR-04 JSON raíz-array atraviesa la rama v2 | ⏭ Fase 2 (caso borde; el ERP produce objetos) |

---

## No son brechas (deliberado, documentado)

- `.env.example` no existe — bloqueado por la regla `Write(./.env.*)` del proyecto; ningún requisito depende de él; contenido listo en `01-02-SUMMARY.md` y reflejado en `README.md`.
- `post_tax` / `cancel_tax` sin mapeo v2 — Fase 2 por diseño.
- v1 imprime `?code=` a stdout — DEBT-04, diferido; `COMP-01` prohíbe cambiarlo.
- axios vulnerable — DEPS-01, diferido con razón registrada.
- `.planning/codebase/` desfasado (3 clases nuevas, `tests/`) — refrescar con `/gsd-map-codebase` antes de planear la Fase 2.
- Verificación en vivo contra staging — Fase 3, la ejecuta el área de ERP.

## Pendientes fuera del código, que sí condicionan la Fase 3

- Confirmar con el área de ERP la forma del JSON v2 y que `tax_code` viene en cada línea del `cart[]` (`01-CONTEXT.md` › riesgos abiertos).
- Definir el mecanismo de entrega del código de entidad.
- `mv env .env` en esta máquina para poder correr el CLI real sin variables inline.

---

*Verificado: 2026-09-11 · árbol `0e73499` · 33 commits desde `3150ae2`*
