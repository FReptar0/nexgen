# Requirements: nexgen — Migración a Synexus Compute v2

**Defined:** 2026-09-10
**Core Value:** El monto de impuesto que nexgen escribe en el archivo de respuesta tiene que ser el correcto, y no debe alterar estado en la API del proveedor sin que se haya pedido explícitamente.

## v1 Requirements

Requisitos de esta migración. Cada uno mapea a una fase del roadmap.

### Conexión y contrato (CONN)

- [ ] **CONN-01**: El cliente HTTP emite `POST` con cuerpo JSON contra el contrato v2, sin alterar el `GET`-con-cuerpo que usa el camino v1
- [ ] **CONN-02**: La autenticación v2 viaja como header `Authorization: Bearer <llave>`, nunca como parámetro en la URL
- [ ] **CONN-03**: El código de entidad viaja en su header dedicado en toda petición v2 que lo requiera
- [ ] **CONN-04**: La URL base de v2 se resuelve desde configuración, no está escrita en el código
- [ ] **CONN-05**: El operador puede leer en la salida estándar, al inicio de cada corrida, qué contrato y qué host se van a usar antes de que salga la petición

### Semántica de operaciones (OPER)

- [ ] **OPER-01**: `get_tax` cotiza sin dejar rastro en el proveedor — no persiste factura ni snapshot
- [ ] **OPER-02**: `post_tax` registra una factura confirmada
- [ ] **OPER-03**: `cancel_tax` cancela una transacción previamente confirmada contra el endpoint v2 correspondiente
- [ ] **OPER-04**: La validación estricta que hoy protege `get_tax` y `post_tax` de invertirse sigue vigente bajo el contrato v2
- [ ] **OPER-05**: Una operación inválida o un campo de intención ausente aborta antes de emitir cualquier petición de red

### Rieles anti-falla (SAFE)

- [ ] **SAFE-01**: Toda petición v2 lleva una llave de idempotencia única generada por nexgen
- [ ] **SAFE-02**: Un reintento tras timeout reutiliza la misma llave de idempotencia, de modo que no puede duplicar un registro fiscal
- [ ] **SAFE-03**: nexgen rechaza la corrida, antes de tocar la red, si el prefijo de la llave no corresponde al host configurado
- [ ] **SAFE-04**: Los montos y tasas de la respuesta se preservan tal cual llegan, sin conversión a punto flotante en ningún punto del camino
- [ ] **SAFE-05**: Los errores del contrato v2 se clasifican por su código estable, no por el texto del mensaje
- [ ] **SAFE-06**: El identificador de petición que devuelve el proveedor queda registrado en toda corrida, exitosa o fallida, para poder levantar soporte

### Configuración (CFG)

- [ ] **CFG-01**: El código de entidad se resuelve por precedencia — argumento de línea de comandos, luego variable de entorno, luego campo del JSON de entrada — y nunca está escrito en el código
- [ ] **CFG-02**: Si el código de entidad no se resuelve por ninguna vía, la corrida aborta con un mensaje en español que dice cómo proporcionarlo
- [ ] **CFG-03**: El operador puede elegir explícitamente entre el camino v1 y el v2; no hay selección implícita ni por omisión
- [ ] **CFG-04**: Si falta cualquier variable requerida por el camino v2, la corrida aborta al arrancar, nombrando cuáles faltan
- [ ] **CFG-05**: Ninguna credencial aparece en la salida estándar ni en los archivos de log

### Compatibilidad (COMP)

- [ ] **COMP-01**: El camino v1 conserva exactamente su comportamiento actual — mismo método, misma URL, misma autenticación, mismos mensajes
- [ ] **COMP-02**: El contrato de archivos se conserva sin cambios: mismo nombre de entrada, prefijo `RESPONSE_`, numeración original, mismo directorio de salida
- [ ] **COMP-03**: La respuesta v2 se escribe completa y sin transformar, tal como la devuelve el proveedor
- [ ] **COMP-04**: La arquitectura en cinco capas se respeta — ninguna capa nueva alcanza a otra por fuera de la inyección de dependencias en el punto de entrada

### Pruebas (TEST)

- [ ] **TEST-01**: Existe un runner de pruebas ejecutable con un solo comando
- [ ] **TEST-02**: Cada una de las tres operaciones tiene prueba que verifica el cuerpo de la petición v2 que se construye, sin salir a la red
- [ ] **TEST-03**: Hay prueba que falla si `get_tax` llegara a construir una petición que persista factura
- [ ] **TEST-04**: Hay prueba que falla si un monto de la respuesta pasa por conversión a punto flotante
- [ ] **TEST-05**: Hay prueba que verifica el rechazo por descuadre entre prefijo de llave y host
- [ ] **TEST-06**: La suite corre sin credenciales y sin acceso a la red

### Verificación (VERIF)

- [ ] **VERIF-01**: La respuesta real de staging archivada en `data/` se usa como fixture de contrato, y hay prueba que falla si la forma de la respuesta esperada se desvía de ella
- [ ] **VERIF-02**: Existe un procedimiento escrito, ejecutable desde el servidor, para validar las tres operaciones contra staging
- [ ] **VERIF-03**: Las tres operaciones quedan ejecutadas con éxito contra staging y sus respuestas archivadas
- [ ] **VERIF-04**: Existe un procedimiento de corte a producción documentado como lista de verificación, que incluye la comprobación previa de correspondencia llave↔host, qué observar en la primera transacción real, y cómo revertir al camino v1 sin desplegar código

## v2 Requirements

Diferidos. Registrados, fuera del roadmap actual.

### Seguridad de dependencias (DEPS)

- **DEPS-01**: Resolver las tres vulnerabilidades reportadas por la auditoría de dependencias
- **DEPS-02**: Revalidar el `GET`-con-cuerpo del camino v1 tras la actualización del cliente HTTP

### Deuda de v1 (DEBT)

- **DEBT-01**: Corregir la URL base obsoleta que la documentación del repositorio sigue citando
- **DEBT-02**: Incluir marca de tiempo en el nombre del archivo de respuesta para evitar sobrescritura en corridas concurrentes
- **DEBT-03**: Recalcular la fecha del log en cada escritura, para que un proceso que cruce la medianoche no siga escribiendo en el archivo del día anterior

### Capacidades nuevas del contrato v2 (NEW)

- **NEW-01**: Flujo de devoluciones y notas de crédito
- **NEW-02**: Promoción de un snapshot no confirmado a factura confirmada

### Corte a producción (PROD)

- **PROD-01**: Ejecutar el corte del camino de producción al contrato v2

## Out of Scope

| Feature | Reason |
|---------|--------|
| Actualización de dependencias vulnerables | Toca el cliente HTTP que sostiene el `GET`-con-cuerpo de v1; el riesgo de tumbar producción supera al de las vulnerabilidades en un CLI interno con entrada controlada. Va como DEPS-01/02 |
| Suite de pruebas completa del repositorio | Construirla entera compite con el encargo. Sólo se cubre la superficie nueva, que es donde vive el riesgo |
| Flujo de devoluciones y notas de crédito | Capacidad nueva del contrato v2 que nexgen no tiene hoy y que nadie ha pedido. Va como NEW-01 |
| Promoción de snapshot a confirmado | Existe en v2 sin equivalente en el CLI actual. Se documenta, no se implementa. Va como NEW-02 |
| Corte de producción a v2 | Requiere servidor, llave de producción y el código de entidad real: insumos que no controla quien implementa. Decisión operativa del área de ERP. Va como PROD-01 |
| "SDCAM" | Mencionado dos veces en la reunión del 9-sep como tema posterior. Cero coincidencias en los cuatro PDF del proveedor. No se infiere qué es |
| Refactorizar el camino v1 | La instrucción explícita fue no moverlo |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| CONN-01 … CONN-05 | TBD | Pending |
| OPER-01 … OPER-05 | TBD | Pending |
| SAFE-01 … SAFE-06 | TBD | Pending |
| CFG-01 … CFG-05 | TBD | Pending |
| COMP-01 … COMP-04 | TBD | Pending |
| TEST-01 … TEST-06 | TBD | Pending |
| VERIF-01 … VERIF-04 | TBD | Pending |

**Coverage:**
- v1 requirements: 33 total
- Mapped to phases: 0 (roadmap pendiente)
- Unmapped: 33 ⚠️

---
*Requirements defined: 2026-09-10*
*Last updated: 2026-09-10 after initialization*
