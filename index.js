// index.js
const path = require('path');
// Carga el archivo .env que se encuentra en el mismo directorio que index.js
require('dotenv').config({ path: path.resolve(__dirname, '.env') });
const fs = require('fs');
const axios = require('axios');
const winston = require('winston');

// Configuración de winston para logs diarios de errores
const logDir = path.resolve(__dirname, 'logs');
if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
}
const logger = winston.createLogger({
    level: 'error',
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.printf(({ timestamp, level, message }) => {
            return `[${timestamp}] ${level.toUpperCase()}: ${message}`;
        })
    ),
    transports: [
        new winston.transports.File({
            filename: path.join(logDir, `log_${new Date().toISOString().slice(0, 10)}.log`),
            level: 'error',
        })
    ]
});

function logError(message) {
    logger.error(message);
}

async function main() {
    const args = process.argv.slice(2);
    if (args.length < 2) {
        const message = 'Uso: node index.js <operacion> <ruta_del_archivo>\nOperaciones válidas: "get_tax", "post_tax" o "cancel_tax"';
        console.error(message);
        logError(message);
        process.exit(1);
    }

    const operation = args[0];
    const filePath = args[1];

    // Validar que el archivo existe antes de intentar leerlo
    if (!fs.existsSync(filePath)) {
        const errorMsg = `El archivo no existe en la ruta especificada: ${filePath}`;
        console.error(errorMsg);
        logError(errorMsg);
        
        // Intentar listar el directorio para diagnóstico
        try {
            const dir = path.dirname(filePath);
            const fileName = path.basename(filePath);
            console.log(`Buscando archivo: ${fileName}`);
            console.log(`En directorio: ${dir}`);
            
            if (fs.existsSync(dir)) {
                const files = fs.readdirSync(dir);
                console.log(`Archivos encontrados en el directorio:`);
                files.forEach(file => console.log(`  - ${file}`));
                
                // Buscar archivos similares
                const similarFiles = files.filter(file => 
                    file.toLowerCase().includes('sage') || 
                    file.toLowerCase().includes('tax') ||
                    file.includes('ORD') ||
                    file.endsWith('.json')
                );
                
                if (similarFiles.length > 0) {
                    console.log(`Archivos similares encontrados:`);
                    similarFiles.forEach(file => console.log(`  - ${file}`));
                }
            } else {
                console.log(`El directorio ${dir} no existe`);
            }
        } catch (listErr) {
            console.log(`No se pudo listar el directorio: ${listErr.message}`);
        }
        
        process.exit(1);
    }

    // Leer y parsear el archivo JSON de entrada
    let requestBody;
    try {
        console.log(`Intentando leer archivo: ${filePath}`);
        const fileContent = fs.readFileSync(filePath, 'utf8');
        console.log(`Archivo leído exitosamente. Tamaño: ${fileContent.length} caracteres`);
        
        requestBody = JSON.parse(fileContent);
        console.log(`JSON parseado exitosamente`);
    } catch (err) {
        const errorMsg = `Error al leer o parsear el archivo: ${err.message}`;
        console.error(errorMsg);
        console.error(`Código de error: ${err.code}`);
        console.error(`Ruta del archivo: ${filePath}`);
        
        // Información adicional del error
        if (err.code === 'ENOENT') {
            console.error('El archivo no fue encontrado. Verifique:');
            console.error('1. Que la ruta del archivo sea correcta');
            console.error('2. Que tenga permisos de lectura');
            console.error('3. Que el archivo no esté siendo usado por otro proceso');
            console.error('4. Que no haya caracteres especiales en el nombre');
        } else if (err.code === 'EACCES') {
            console.error('Sin permisos para leer el archivo');
        } else if (err.name === 'SyntaxError') {
            console.error('El archivo no contiene JSON válido');
        }
        
        logError(errorMsg);
        process.exit(1);
    }

    // Validar el valor "Committed" según la operación
    if (operation === 'get_tax') {
        if (requestBody.Committed !== false) {
            const errorMsg = 'Para la operación get_tax, el valor "Committed" debe ser false.';
            console.error(errorMsg);
            logError(errorMsg);
            process.exit(1);
        }
    } else if (operation === 'post_tax') {
        if (requestBody.Committed !== true) {
            const errorMsg = 'Para la operación post_tax, el valor "Committed" debe ser true.';
            console.error(errorMsg);
            logError(errorMsg);
            process.exit(1);
        }
    }

    // Obtener la BASE_URL desde .env
    const baseUrl = process.env.BASE_URL;
    if (!baseUrl) {
        const errorMsg = 'No se ha definido BASE_URL en el archivo .env';
        console.error(errorMsg);
        logError(errorMsg);
        process.exit(1);
    }

    // Seleccionar la URL según la operación
    let url;
    if (operation === 'get_tax' || operation === 'post_tax') {
        const apiCode = process.env.API_CODE;
        if (!apiCode) {
            const errorMsg = 'No se ha definido API_CODE en el archivo .env';
            console.error(errorMsg);
            logError(errorMsg);
            process.exit(1);
        }
        
        // Determinar si está en modo de prueba
        const isTestMode = process.env.TEST_MODE === 'true';
        const endpoint = isTestMode ? 'STCCalcV3_TEST' : 'MGGetTaxForCart';
        url = `${baseUrl}${endpoint}?code=${apiCode}`;
    } else if (operation === 'cancel_tax') {
        url = `${baseUrl}CancelTransaction`;
    } else {
        const errorMsg = 'Operación inválida. Usa "get_tax", "post_tax" o "cancel_tax".';
        console.error(errorMsg);
        logError(errorMsg);
        process.exit(1);
    }

    try {
        console.log(`Realizando petición ${operation.toUpperCase()} a: ${url}`);
        console.log(`Enviando datos: ${JSON.stringify(requestBody, null, 2)}`);
        
        // Se usa el método GET para todas las operaciones, según lo requerido.
        const response = await axios({
            method: 'GET',
            url: url,
            data: requestBody,
            headers: {
                'Content-Type': 'application/json'
            },
            timeout: 30000, // 30 segundos de timeout
            validateStatus: function (status) {
                // Considera exitosos todos los códigos de estado para manejarlos manualmente
                return status < 500;
            }
        });

        console.log(`Respuesta recibida - Status: ${response.status} ${response.statusText}`);
        
        // Si hay datos en la respuesta, mostrarlos siempre (éxito o error)
        if (response.data) {
            console.log('Respuesta del servidor:', JSON.stringify(response.data, null, 2));
        }
        
        // Verificar si el servidor indica error mediante el status code
        if (response.status >= 400) {
            const serverErrorMsg = response.data ? JSON.stringify(response.data) : response.statusText;
            const errorMsg = `Error HTTP ${response.status}: ${serverErrorMsg}`;
            console.error(errorMsg);
            logError(`${errorMsg} - URL: ${url} - Operation: ${operation}`);
            process.exit(1);
        }

        // Obtener el directorio de salida desde .env
        const outputDir = process.env.OUTPUT_DIR;
        if (!outputDir) {
            const errorMsg = 'No se ha definido OUTPUT_DIR en el archivo .env';
            console.error(errorMsg);
            logError(errorMsg);
            process.exit(1);
        }

        // Asegurarse de que el directorio de salida exista, si no, crearlo
        try {
            if (!fs.existsSync(outputDir)) {
                fs.mkdirSync(outputDir, { recursive: true });
                console.log(`Directorio de salida creado: ${outputDir}`);
            }
        } catch (dirErr) {
            const errorMsg = `Error al crear el directorio de salida: ${dirErr.message}`;
            console.error(errorMsg);
            logError(errorMsg);
            process.exit(1);
        }

        // Crear el nombre del archivo de respuesta con el prefijo RESPONSE_
        const originalName = path.basename(filePath);
        const responseFileName = path.join(outputDir, 'RESPONSE_' + originalName);

        // Escribir la respuesta en el archivo
        try {
            fs.writeFileSync(responseFileName, JSON.stringify(response.data, null, 2));
            const successMsg = `Operación ${operation} completada exitosamente. Respuesta guardada en: ${responseFileName}`;
            console.log(successMsg);
            
            // Log de éxito también
            const successLogMsg = `SUCCESS: ${operation} - File: ${originalName} - Status: ${response.status}`;
            console.log(successLogMsg);
            
        } catch (writeErr) {
            const errorMsg = `Error al escribir el archivo de respuesta: ${writeErr.message}`;
            console.error(errorMsg);
            console.error(`Ruta de destino: ${responseFileName}`);
            logError(errorMsg);
            process.exit(1);
        }
        
    } catch (error) {
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
            // Error con respuesta del servidor - usar exactamente lo que regresa el servidor
            const serverResponse = error.response.data || error.response.statusText;
            errorMsg += `HTTP ${error.response.status}`;
            console.error(errorMsg);
            console.error(`URL: ${url}`);
            console.error('Mensaje del servidor:', JSON.stringify(serverResponse, null, 2));
        } else if (error.request) {
            // Error de red sin respuesta
            errorMsg += 'No se recibió respuesta del servidor (problema de conectividad)';
            console.error(errorMsg);
        } else {
            // Otro tipo de error
            errorMsg += error.message;
            console.error(errorMsg);
        }
        
        // Log detallado del error
        const detailedLog = `${errorMsg} - Operation: ${operation} - URL: ${url} - File: ${filePath}`;
        logError(detailedLog);
        
        console.error('\n--- Información de diagnóstico ---');
        console.error(`Operación: ${operation}`);
        console.error(`Archivo: ${filePath}`);
        console.error(`URL: ${url}`);
        console.error(`Timestamp: ${new Date().toISOString()}`);
        
        process.exit(1);
    }
}

main();
