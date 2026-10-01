---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
status: ready_to_plan
stopped_at: Fase 2.1 cerrada — el archivo de respuesta se escribe también cuando falla (SAFE-07). Falta la verificación en vivo (Fase 3, la ejecuta el área de ERP)
last_updated: "2026-10-01T18:00:00.000Z"
last_activity: 2026-10-01 -- Fase 2.1 (SAFE-07) completa: un fallo v2 también escribe RESPONSE_. 486 pruebas verdes, 4 mutantes validados. Fase 3 lista para planear
progress:
  total_phases: 4
  completed_phases: 3
  total_plans: 8
  completed_plans: 8
  percent: 75
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-09-10)

**Core value:** El monto de impuesto que nexgen escribe en el archivo de respuesta tiene que ser el correcto, y no debe alterar estado en la API del proveedor sin que se haya pedido explícitamente.
**Current focus:** Phase 3 — verificación contra staging y corte documentado

## Current Position

Phase: 3
Plan: Not started
Status: Ready to plan
Last activity: 2026-10-01

Progress: [████████░░] 75% (3/4 fases)

## Performance Metrics

**Velocity:**

- Total plans completed: 8
- Average duration: —
- Total execution time: —

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 01 | 4 | - | - |
| 02 | 4 | - | - |

**Recent Trend:**

- Last 5 plans: —
- Trend: —

*Updated after each plan completion*
| Phase 01 P01 | 6min | 3 tasks | 8 files |
| Phase 01 P02 | 16min | 2 tasks | 8 files |
| Phase 01 P03 | 9min | 2 tasks | 7 files |
| Phase 01 P04 | 13min | 3 tasks | 13 files |
| Phase 02 P01 | 15min | 3 tasks | 14 files |
| Phase 02 P02 | 12min | 2 tasks | 12 files |
| Phase 02 P03 | 12min | 2 tasks | 9 files |
| Phase 02 P04 | 13min | 2 tasks | 10 files |

## Accumulated Context

### Decisions

Las decisiones se registran en la tabla Key Decisions de PROJECT.md.
Decisiones que afectan el trabajo actual:

- [Roadmap]: Se añade v2 en paralelo en vez de refactorizar el camino existente — riesgo cero para producción y vuelta atrás con un selector, no revirtiendo commits
- [Roadmap]: El roadmap se consolida de 6 fases a 3 (granularidad `coarse`) — el encargo es migrar a la versión dos, no rediseñar nexgen, y el proyecto no da para más ceremonia. Alcance más corto, mismas garantías: ningún requisito se eliminó ni se difirió
- [Producto]: v1 es el comportamiento por defecto y v2 requiere activación explícita, con el interruptor en la configuración de entorno y un argumento de línea de comandos que lo sobreescribe. Cierra la tensión CFG-03 ↔ COMP-01 y de paso satisface VERIF-04, porque revertir deja de ser un despliegue
- [Roadmap]: OPER-01 y su guardia de regresión TEST-03 viven en la misma fase (Phase 1), porque la prueba es lo único que impide que un refactor reintroduzca la persistencia fantasma de la cotización
- [Roadmap]: La verificación contra staging es una fase final aparte (Phase 3) que ejecuta el área de ERP, no quien implementa — el proveedor restringe el acceso a EE.UU./Canadá y las credenciales viven con ese equipo
- [Roadmap]: Las fases 1 y 2 se escriben para ser comprobables sin red; el único criterio de todo el roadmap que exige una llamada en vivo es el criterio 2 de la Phase 3
- [Phase 01]: Mensajes de v1 congelados con toThrow(new Error(msg)) — Jest exige igualdad exacta del mensaje con una instancia de Error; toThrow('msg') sólo verifica contención y dejaría pasar cambios sutiles
- [Phase 01]: parseArguments se congela por propiedad (operation, filePath), no con toEqual del objeto completo — El plan 02 agrega el selector de contrato al objeto de retorno; un toEqual estricto convertiría ese cambio legítimo en un falso positivo
- [Phase 01]: Las URLs de v1 se congelan con toBe sobre la cadena completa — Es más fuerte que endsWith y fija también la concatenación sin separador de baseUrl, que es parte de la URL resuelta
- [Phase 01]: Cada prueba de congelamiento se validó por mutación antes de commitear — Alterar v1, ver fallar la suite y restaurar es lo que convierte 'la suite protege a v1' de una afirmación en un hecho
- [Phase 01]: SynexusConfig exporta la clase y se construye sólo cuando el selector resolvió v2 — El require es inocuo para v1 y sus frenos (variables requeridas, llave↔host) nunca corren en un servidor sin variables de v2
- [Phase 01]: execute() ramifica por contrato ANTES del paso 5 de v1; _executeV2 llama validateRequestBody y sanitizeStringFields por separado y nunca validate() ni validateCommittedField — El archivo v2 no trae Committed y el agregador de v1 lo rechazaría antes de llegar a rama alguna
- [Phase 01]: _maskApiKey devuelve *** también con una llave de longitud exacta prefijo+4 — Con esa longitud la máscara revelaría la llave entera, que es lo que CFG-05 prohíbe
- [Phase 01]: El doble de Config gana getApiVersion => 'v1' por omisión — El doble refleja la superficie pública real de Config y las pruebas de congelamiento de v1 siguen verdes sin tocarlas
- [Phase 01]: .env.example no se creó: los permisos del proyecto niegan escribir ./.env.* y no se rodeó — Es una decisión del dueño del repo sobre esa familia de archivos; el contenido propuesto va en 01-02-SUMMARY.md como acción del usuario
- [Phase 01]: El helper privado de la llave se llama _generateRequestId, no _generateIdempotencyKey — El criterio de aceptación exige grep 'Idempotency' = 0 sobre el builder (ninguna cabecera de idempotencia inventada) y el nombre de la interfaz del plan lo contradecía; ningún otro plan depende del nombre
- [Phase 01]: El builder v2 se construye siempre en index.js, fuera del condicional del selector — No valida nada al construirse y es inocuo bajo v1
- [Phase 01]: La traza 'Cuerpo v2 a enviar:' es un solo console.log con JSON a dos espacios, mismo formato que el cliente v1 — La prueba fija la cadena exacta para que el operador vea el cuerpo tal cual sale, antes de que salga
- [Phase 01]: Los mensajes de contradicción citan el valor del archivo con JSON.stringify — 'false' (cadena) y false (booleano) se distinguen a simple vista, que es lo que explica por qué === los separó
- [Phase 01]: buildHandler de tests/argumentParsing.test.js gana un doble del builder en vez de hacer tolerante a _executeV2 ante un builder ausente — Un cableado roto debe fallar, no pasar en silencio; mismo criterio que la wave 2 aplicó a getApiVersion
- [Phase Phase 01]: La prueba del 400 del cliente v2 no cuenta llamadas al logger — En el molde de v1 el throw de _handleResponse cae en el catch de makeRequest, que además pasa por _handleError; copiar la estructura exacta pesa más que un conteo de llamadas
- [Phase Phase 01]: Los archivos de prueba de la wave 3 construyen el manejador con ocho argumentos y sus casos v2 pasan de 'rechaza en la guardia' a 'resuelve y llama al cliente' — Ninguna aserción se debilitó; la guardia de cableado conserva una prueba dedicada con null en cada archivo
- [Phase Phase 01]: Se actualizaron los agentes de .claude/agents además de los comandos — CLAUDE.md exige revisarlos cuando cambia el código que referencian; el ayudante del validador pedía que toda regla nueva fuera alcanzable desde validate(), lo que rompería la rama v2
- [Phase Phase 01]: La corrida de humo del CLI real se hace con un preload que bloquea http/https, como tests/setup.js — Prueba que index.js cablea el cliente y que la guardia se pasa sin que nada salga a la red ni exista .env
- [Phase Phase 02]: El throw terminal de getIntentFor deja de decir 'todavía' y nombra a cancel_tax como fuera del mapeo — Conserva la frase 'mapeo de intención' que buscan las pruebas y no promete un mapeo que el plan 02-02 no dará: cancel_tax tendrá su propio constructor
- [Phase Phase 02]: La guardia de archivo v1 se copia literal en validateV2FileShape en vez de compartirse — La duplicación de cuatro líneas es el precio de que git diff del validador sea sólo adiciones, la prueba mecánica de que nada congelado se movió
- [Phase Phase 02]: validateV2FileShape corre en el paso 2 de _executeV2, antes de resolver la entidad — Un archivo v1 bajo v2 aborta con la causa raíz y no con 'no se pudo resolver el código de entidad' (cierra IN-08); validateV2IntentFields conserva su guardia como defensa en profundidad
- [Phase Phase 02]: La Task 2 no tiene commit feat: el paso directo ya es la implementación de SAFE-04 y COMP-03 — Lo que se commitea es la prueba con el FileManager real y la evidencia de mutación: parseFloat en el cliente v2 y en writeJsonFile ponen 4 casos en rojo cada una
- [Phase Phase 02]: El caso de la Fase 1 'archivo v1 bajo la rama v2' se actualiza para afirmar el aborto temprano — Describía el orden viejo (guardia después de resolver la entidad); ahora afirma además que la entidad nunca se resolvió: más fuerte, no más débil
- [Phase 02]: El cuerpo de cancelación v2 es una proyección explícita { invoice_id, customer_id } construida llave por llave, sin request_id, transaction_type ni committed — El endpoint sólo documenta esos dos campos y no dice qué hace con los extra; la excepción a SAFE-01 se acepta porque la cancelación es idempotente por naturaleza (repetir → 404/422 sin doble efecto; 409 documentado como seguro de reintentar)
- [Phase 02]: _buildV2Body en el manejador y _resolveUrl en el cliente bifurcan por operación con throw terminal y sin rama else, con el molde de getIntentFor — Mandar una cancelación a la ruta de cálculo (o al revés) confundiría al proveedor con un cuerpo válido para otra cosa; la URL de cancelación sale sólo de SynexusConfig.getCancelUrl() (CONN-04)
- [Phase 02]: Las aserciones de campo ausente afirman la lista literal 'falta(n): …' y no sólo que el mensaje contiene el nombre — Los dos nombres también aparecen en la parte fija del mensaje y la mutación 'sin comprobación de customer_id' dejaba pasar el caso 'sin los dos'; se reforzó antes del commit GREEN
- [Phase 02]: La corrida de humo con el index.js real fue denegada por permisos del entorno y no se rodeó — La cobertura equivalente es v2CancelEndToEnd con el grafo real a mano; index.js está congelado y su cableado ya se probó de humo en 01-04 y 02-01
- [Phase 02]: docs_url se filtra también de la traza 'Respuesta del servidor:' y del molde serializado con una copia superficial (_withoutDocsUrl) — El plan exige que ninguna línea de consola lo lleve y la traza heredada imprimía el cuerpo entero; la respuesta devuelta y escrita sigue intacta (SAFE-04)
- [Phase 02]: Los errores v2 se clasifican por data.code (cálculo) y por status HTTP (cancelación), citando el message del proveedor entre comillas sin interpretarlo — Un cambio de redacción del proveedor no debe cambiar el comportamiento de nexgen; gate de grep contra message.includes y parientes, validado por mutación (el mutante dispara el gate)
- [Phase 02]: El request_id del proveedor se prefiere del cuerpo (meta.request_id / request_id) sobre el header x-request-id, y de los headers sólo se lee ése — Es el que el proveedor cita para soporte; nunca se serializa el objeto headers ni response.config/error.config (CFG-05)
- [Phase 02]: Los 4xx resueltos lanzan un Error propio marcado con providerResponded/providerRequestId; los errores de axios (5xx, red) se re-lanzan por identidad y el id va a consola y log, no al message — La prueba de identidad de la Fase 1 (toBe) sigue en pie; sin respuesta queda el request_id que generó nexgen, y la cancelación dice 'ninguno'
- [Phase 02]: options.wait se acepta sólo si es función y en otro caso se usa el setTimeout real — index.js no pasa opciones y hereda la espera de 1000 ms; la inyección existe únicamente para que la suite no duerma
- [Phase 02]: El registro del reintento es la línea 'Reintentando (1/1) …' en stdout; la entrada de winston sigue siendo una sola, la del desenlace final — El plan exige que el intento reintentado no pase por _handleError y que _handleError no cambie; la prueba 'timeout dos veces' fija logger.error una vez
- [Phase 02]: createClient conserva la firma (logger, options) y los casos que cuentan llamadas al doble de configuración leen client.synexusConfig — El constructor ya expone la configuración; el criterio de a lo sumo dos construcciones directas del cliente en la prueba se cumple
- [Phase 02]: La documentación de 02-04 se extendió sin reescribir: lo único falso era 'only get_tax is implemented' en README, reemplazado por la tabla de las tres operaciones — Los comandos y agentes ya describían v2 desde 02-01..02-03; RUNBOOK, ARCHITECTURE y HANDOFF siguen para la Fase 3 por decisión de la fase

- [Phase 2.1]: Un fallo bajo v2 escribe el MISMO archivo `RESPONSE_<original>`, sin prefijo ni sufijo distinto — El área de ERP lee un solo archivo y sólo ése (*"igual igual, porque como nada más leo ese archivo"*, 1-oct 00:07:49); un nombre distinto lo dejaría sin encontrar, y no escribir nada lo dejaría leyendo el RESPONSE_ de una corrida anterior como si fuera de ahora
- [Phase 2.1]: Cuando el proveedor respondió se archiva su cuerpo ÍNTEGRO, docs_url incluido — El filtro `_withoutDocsUrl` es sólo para consola y para el mensaje del Error; lo que se archiva no se recorta. Un cuerpo que no es JSON (el HTML de un gateway en un 502) se archiva como la cadena que es: es justo el caso que el ERP caza por su lado
- [Phase 2.1]: Cuando el proveedor NO respondió se archiva un objeto propio de nexgen con `error.source: "nexgen"` — Deliberadamente no se parece a un cálculo (sin `totals`, sin `transaction`), que es lo que permite al ERP distinguirlo. Lleva la llave de idempotencia generada, para preguntarle al proveedor si la recibió
- [Phase 2.1]: El alcance incluye los abortos ANTES de la red (validación, entidad sin resolver), no sólo los errores del proveedor — Desde el ERP el hueco es el mismo: mandó un archivo y no recibió respuesta. Es lo que pedía "a prueba de errores"
- [Phase 2.1]: `_saveErrorResponse` NUNCA lanza; si escribir falla, el error que se propaga es el original — Enmascararlo convertiría "el proveedor devolvió 422" en "no se pudo escribir", que es el diagnóstico equivocado. El fallo de escritura se reporta aparte, en consola y en el log
- [Phase 2.1]: El cuerpo del proveedor viaja en el Error como `providerResponseBody`, mutando el objeto en vez de envolverlo — Las pruebas de identidad (`rejects.toBe`) de las fases 1 y 2 siguen en pie sin tocarlas
- [Phase 2.1]: Las 20 pruebas que afirmaban "no se escribe archivo" se actualizaron a afirmar QUÉ se escribe, no a borrarse — Afirman más que antes: identidad del cuerpo del proveedor (`toBe`, no `toEqual`) y forma del objeto de nexgen
- [Phase 2.1]: v1 no cambió — un fallo bajo v1 sigue sin escribir nada (COMP-01), con dos pruebas dedicadas y un mutante que lo verifica

### Pending Todos

[De .planning/todos/pending/ — ideas capturadas durante las sesiones]

Ninguno aún.

### Blockers/Concerns

- ~~BLOQUEANTE — forma del JSON de entrada~~ **Rebajado el 2026-09-10 tras releer la
  transcripción.** El área de ERP dijo textualmente que genera desde Sage *"un archivo
  JSON con lo que tú vas a mandar de body"*, y el cuerpo real que entregó como referencia
  ya está en forma v2. La forma del archivo es su lado del contrato y ya la produjo.
  nexgen no traduce esquemas. Lo que el planner vio (`Committed`, `cartID`, `ToState`)
  son los archivos de la era v1, no lo que se dejará para v2.
  **Lo que sí era un defecto real, y quedó corregido en `01-CONTEXT.md`:** el plan 01-02
  hacía correr `validate()` de v1 también en la rama v2, y ese agregador lee
  `requestBody.Committed` con mayúscula — campo que el archivo v2 no trae. Habría
  rechazado todo archivo real. La rama v2 debe llamar a los métodos del validador por
  separado y cumplir `OPER-04` con `validateV2IntentFields`. Planes 01-02 y 01-03
  requieren revisión puntual.
  **Queda una confirmación de una línea con el área de ERP**, no una decisión: que la
  extracción de Sage para v2 emite la misma forma que el cuerpo del 9-sep.

- **El mecanismo del código de entidad quedó explícitamente sin definir** en la reunión del 9-sep. CFG-01 fija la precedencia (argumento > variable de entorno > campo del JSON), pero `Config` es hoy un singleton de proceso sin lugar para un valor por petición: su superficie pública probablemente cambie en Phase 1 y eso repercute en `TaxApiClient` y en el parseo de argumentos del CLI.
- ~~Discrepancia en la ruta de cálculo v2~~ **Resuelto 2026-09-10:** no era discrepancia. La referencia de API (pág. 9) documenta `/api/v1/tax_calculations/calculate` como **alias oficial** de `/api/v1/tax_calculations`. Las dos rutas funcionan; la guía de migración simplemente usó el alias. nexgen usa la ruta canónica sin `/calculate`.
- **Sin acceso a staging desde la máquina local.** Toda verificación en vivo depende del servidor de la empresa y del área de ERP. No hay forma de saltar esta frontera.
- **El repositorio no tiene ninguna prueba, CI ni linter.** Phase 1 construye la primera infraestructura de pruebas desde cero; no hay andamiaje previo que extender.

## Deferred Items

Items reconocidos y arrastrados desde el cierre del milestone anterior:

| Category | Item | Status | Deferred At |
|----------|------|--------|-------------|
| Seguridad de dependencias | DEPS-01 / DEPS-02 — `npm audit fix` y revalidación del `GET`-con-cuerpo de v1 | Diferido a milestone propio | 2026-09-10 |
| Deuda de v1 | DEBT-01 — URL base obsoleta en la documentación del repo | Diferido | 2026-09-10 |
| Deuda de v1 | DEBT-02 — marca de tiempo en el nombre del archivo de respuesta | Diferido | 2026-09-10 |
| Deuda de v1 | DEBT-03 — recalcular la fecha del log en cada escritura | Diferido | 2026-09-10 |
| Capacidades v2 | NEW-01 — flujo de devoluciones y notas de crédito | Diferido | 2026-09-10 |
| Capacidades v2 | NEW-02 — promoción de snapshot a factura confirmada | Diferido | 2026-09-10 |
| Corte a producción | PROD-01 — ejecutar el corte del camino de producción a v2 | Decisión operativa del área de ERP | 2026-09-10 |
| Pregunta abierta | "SDCAM" — mencionado dos veces en la reunión del 9-sep, cero coincidencias en la documentación del proveedor | Sin resolver | 2026-09-10 |

## Session Continuity

Last session: 2026-10-01T18:00:00.000Z
Stopped at: Completed Phase 2.1 (SAFE-07), ejecutada en línea sin plan
Resume file: None
