# RUNBOOK — nexgen

> Procedimientos operativos para correr, verificar y diagnosticar
> nexgen en producción.
> Idioma: español. Última actualización: 2026-05-12.

## 1. Cómo lo invoca el ERP

`nexgen` es una herramienta CLI. El ERP (Sage 300 en producción) la
invoca como un proceso hijo, espera a que termine, y procesa el archivo
de respuesta. Forma típica desde un job de Sage:

### 1.1 Wrapper PowerShell (recomendado en Windows)

```powershell
# wrapper-nexgen.ps1
param(
    [Parameter(Mandatory=$true)][ValidateSet('get_tax','post_tax','cancel_tax')]
    [string]$Operation,
    [Parameter(Mandatory=$true)][string]$InputJson
)

$ErrorActionPreference = 'Stop'

$nexgenRoot = 'C:\nexgen'          # ajustar a la instalación real
$nodeExe    = 'C:\Program Files\nodejs\node.exe'

Push-Location $nexgenRoot
try {
    & $nodeExe 'index.js' $Operation $InputJson
    $exit = $LASTEXITCODE
}
finally {
    Pop-Location
}

if ($exit -ne 0) {
    Write-Error "nexgen falló con exit code $exit. Revisar logs\log_$(Get-Date -Format yyyy-MM-dd).log"
    exit $exit
}

# Localizar el response
$responseDir  = ${env:OUTPUT_DIR}
$responseFile = Join-Path $responseDir ("RESPONSE_" + (Split-Path $InputJson -Leaf))
if (-not (Test-Path $responseFile)) {
    Write-Error "No se encontró el archivo de respuesta: $responseFile"
    exit 2
}

Write-Host "OK: $responseFile"
```

Uso:

```powershell
.\wrapper-nexgen.ps1 -Operation get_tax -InputJson 'C:\Sage\out\ORD044588.json'
```

### 1.2 Wrapper `.bat` (alternativa simple)

```bat
@echo off
setlocal
cd /d C:\nexgen
node index.js %1 %2
if errorlevel 1 (
    echo nexgen fallo. Revisar logs.
    exit /b %ERRORLEVEL%
)
endlocal
```

### 1.3 Smoke desde shell

Para verificar la instalación sin pasar por el ERP:

```bash
cd /ruta/a/nexgen
cp test-files/test_apostrophe.json /tmp/sample.json   # o cualquier fixture
node index.js get_tax /tmp/sample.json
```

> Recuerda ajustar `"Committed": false` en `/tmp/sample.json` antes de
> probar `get_tax` (el fixture viene con `true` para `post_tax`).

## 2. Cómo verificar el resultado de una corrida

1. **Exit code**: `0` = OK, cualquier otro = revisar logs.
2. **Stdout**: la última línea exitosa es `SUCCESS: <operation> - File: <archivo>`.
3. **Archivo de respuesta**: `${OUTPUT_DIR}/RESPONSE_<archivo>.json`.
   Debe contener la respuesta cruda de la API.
4. **Log de errores del día**: `logs/log_YYYY-MM-DD.log`. Si no existe
   o está vacío, no hubo errores (registrados) en esa fecha.

Checklist de verificación post-corrida:

- [ ] `echo %ERRORLEVEL%` / `echo $?` retorna `0`.
- [ ] El archivo `RESPONSE_*.json` se creó en `OUTPUT_DIR`.
- [ ] El JSON de respuesta tiene la forma esperada (mirar las claves
      principales — varía por operación).
- [ ] `logs/log_<hoy>.log` no tiene líneas nuevas.

## 3. Cambiar de TEST a producción (y viceversa)

> **Cambio de alto impacto.** Cualquier corrida en producción con
> `TEST_MODE=true` envía datos al endpoint de pruebas. Cualquier corrida
> en pruebas con `TEST_MODE=false` impacta la API productiva.

Procedimiento:

1. **Detener** cualquier job del ERP que dispare `nexgen`.
2. Editar `.env` en la raíz del proyecto:
   - `TEST_MODE=true` para entorno de pruebas.
   - `TEST_MODE=false` o ausente para producción.
3. Verificar que `BASE_URL` y `API_CODE` correspondan al ambiente
   correcto. Tradicionalmente la URL no cambia (es Azure), pero
   **el `API_CODE` sí puede ser distinto entre tests y producción** —
   confirmar con el equipo que opera la API.
4. **Smoke**: correr una operación de bajo riesgo:
   ```bash
   node index.js get_tax test-files/test_apostrophe.json
   ```
   (Asegurando `"Committed": false` en el JSON.)
5. Verificar la URL impresa en consola:
   ```
   Realizando petición GET_TAX a: https://syn-magento.azurewebsites.net/api/STCCalcV3?code=...
                                                                          ^^^^^^^^^
   ```
   - `STCCalcV3` → producción.
   - `STCCalcV3_TEST` → pruebas.
6. Revisar el `RESPONSE_*.json` y confirmar que los montos son
   coherentes.
7. Re-habilitar los jobs del ERP.

## 4. Investigar una respuesta de error

Orden de investigación (de menos a más profundo):

1. **Consola del invocador**: el ERP o el wrapper suelen capturar la
   salida. Buscar la última línea `❌ Error: <message>` o el bloque
   `--- Información de diagnóstico ---`.
2. **Log diario**: `logs/log_<YYYY-MM-DD>.log`. Una línea por error.
   Formato: `[ISO timestamp] ERROR: <mensaje>`.
3. **`RESPONSE_*.json`**: si la API respondió con un error pero el JSON
   se llegó a escribir, contiene la respuesta cruda. Si no se escribió,
   el error ocurrió antes (validación, conectividad o axios rechazó el
   status).
4. **Reproducir manualmente**:
   ```bash
   node index.js <operation> <archivo.json>
   ```
   Esto imprime toda la traza: archivo leído, body, URL, status, datos
   recibidos. Hacer en una máquina de pruebas, nunca en producción si
   `post_tax`.
5. **Probar el endpoint sin nexgen** (último recurso):
   ```bash
   curl -X GET \
        -H "Content-Type: application/json" \
        --data-binary @sample.json \
        "https://syn-magento.azurewebsites.net/api/STCCalcV3_TEST?code=$API_CODE"
   ```
   > Nota: la API espera `GET` con body. `curl` lo permite con
   > `--data-binary`. Si fuese `POST`, agregar `-X POST`.

### 4.1 Tabla de síntomas

| Síntoma                                               | Causa probable                                | Solución                                                        |
| ----------------------------------------------------- | --------------------------------------------- | --------------------------------------------------------------- |
| `Variables de entorno faltantes: ...`                 | `.env` ausente o incompleto                   | Crear/completar `.env` en la raíz                              |
| `El archivo no existe en la ruta especificada`        | Path mal escrito desde el ERP                 | Verificar comillas en el wrapper, caracteres especiales         |
| `El archivo no contiene JSON válido`                  | El ERP escribió un JSON truncado              | Revisar la salida del ERP, posible race condition               |
| `Para la operación get_tax, el valor "Committed" ...` | El ERP exportó el flag equivocado             | Ajustar en el ERP o en el preprocesador antes de invocar nexgen |
| `Conexión rechazada (ECONNREFUSED)`                   | Red caída o `BASE_URL` mal                    | Probar `curl` a `BASE_URL` desde la misma máquina               |
| `Servidor no encontrado (ENOTFOUND)`                  | DNS o typo en `BASE_URL`                      | `nslookup syn-magento.azurewebsites.net`                        |
| `Timeout de conexión` (`ECONNABORTED`)                | La API tarda >30s o no responde               | Reintentar; si persiste escalar al equipo de la API             |
| `Error HTTP 401/403`                                  | `API_CODE` vencido o ambiente equivocado      | Rotar `API_CODE`, confirmar `TEST_MODE`                         |
| `Error HTTP 400`                                      | Body inválido para el contrato STCCalcV3      | Comparar contra `test-files/test_apostrophe.json`               |
| `Error HTTP 500`                                      | Falla del lado de la API                      | Escalar al equipo que opera la API en Azure                     |
| `Error al escribir el archivo`                        | `OUTPUT_DIR` no existe / permisos             | Crear el directorio o ajustar permisos                          |

## 5. Rotar `API_CODE`

Cuando el equipo de la API regenera el código de autenticación:

1. **Recibir** el nuevo `API_CODE` por canal seguro (no email plano).
2. **Detener** los jobs del ERP que dispara `nexgen`.
3. Editar `.env`:
   ```env
   API_CODE=NUEVO_CODIGO_AQUI
   ```
4. **Smoke** con `TEST_MODE=true` y un `get_tax` contra un fixture de
   prueba.
5. Si pasa, repetir con `TEST_MODE=false`.
6. Verificar `RESPONSE_*.json` y exit code `0`.
7. Re-habilitar los jobs.
8. **No** dejar copias del código viejo en el repo, en backups locales,
   ni en historial de comandos. El `.env` está gitignored — eso es
   suficiente para git, pero revisa también `~/.bash_history` /
   `~/.zsh_history` si lo pegaste por consola.

## 6. Troubleshooting — recetas rápidas

### 6.1 "No genera ningún output"

Ejecutar a mano con un fixture pequeño y observar:

```bash
node index.js get_tax test-files/test_apostrophe.json
```

Esperar al menos:

```
Intentando leer archivo: test-files/test_apostrophe.json
Archivo leído exitosamente. Tamaño: ... caracteres
JSON parseado exitosamente
Datos sanitizados exitosamente
Realizando petición GET_TAX a: https://...
Respuesta recibida - Status: 200 OK
Archivo guardado exitosamente: .../RESPONSE_test_apostrophe.json
SUCCESS: get_tax - File: test_apostrophe.json
```

Si se cuelga sin imprimir `Respuesta recibida`, es un problema de red /
timeout. Si imprime `Status: 4xx`, es un problema de payload o auth.

### 6.2 "Falla al guardar"

`Error al escribir el archivo: EACCES` o `ENOENT`:

```bash
# Verificar que OUTPUT_DIR existe y es escribible
node -e "console.log(require('fs').accessSync(process.env.OUTPUT_DIR, 2))"
```

Si tira, crear el directorio manualmente o cambiar permisos. nexgen
intenta `mkdirSync({ recursive: true })`, pero si el padre no es
escribible, falla.

### 6.3 "El JSON cambia al pasar por nexgen"

Es esperado: la sanitización reemplaza `'` por `\'` en todos los
strings. Si necesitas comparar payload original vs enviado, mira el
`Enviando datos: ...` que imprime `taxApiClient.js` antes del request.

### 6.4 "El `cancel_tax` no usa el endpoint de TEST"

Es un comportamiento conocido (ver `HANDOFF.md` §7 y
`ARCHITECTURE.md` §4). `CancelTransaction` no tiene contraparte de
pruebas en el código. Si necesitas un cancel "de prueba", coordinar
con el equipo de la API.

### 6.5 "Quiero ver el body que se envió"

Está en stdout, no en el log. La línea es:

```
Enviando datos: {
  "facilityNumber": "0",
  ...
}
```

Si el ERP redirige stdout a un archivo, queda ahí. Si no, capturar con
`> stdout.log 2>&1` en el wrapper.

## 7. Operaciones programadas

Hoy nexgen **no tiene scheduler propio**. La cadencia la define el ERP
(eventos de orden, batch nocturno, etc.). Si necesitas correr nexgen
de forma periódica sin el ERP (p. ej. para regenerar respuestas), usa
el scheduler del sistema:

- Windows: Task Scheduler apuntando al wrapper PowerShell.
- Linux/macOS: `cron` invocando `node /ruta/index.js <op> <archivo>`.

Para evitar invocaciones simultáneas sobre el mismo `OUTPUT_DIR`, el
wrapper debería tomar un lock (un archivo `.lock` simple alcanza).
nexgen no implementa locking interno.

## 8. Cuando algo está realmente roto

1. Capturar:
   - Salida completa de la consola (stdout + stderr).
   - `logs/log_<hoy>.log`.
   - El JSON de entrada (con datos del cliente — manejar como sensible).
   - El `RESPONSE_*.json` si se llegó a escribir.
   - Versión de Node: `node --version`.
   - Contenido de `.env` **menos el `API_CODE`**.
2. Reproducir el error en una máquina aislada con el mismo JSON.
3. Si persiste, escalar al equipo que opera la API en Azure adjuntando
   la URL impresa, el body enviado, y el status code recibido.

---

Para "qué es esto" y "cómo está armado", ver `HANDOFF.md` y
`ARCHITECTURE.md`. Para historial de decisiones, ver `docs/MEMORY.md`.
