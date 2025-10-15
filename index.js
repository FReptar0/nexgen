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
        url = `${baseUrl}MGGetTaxForCart?code=${apiCode}`;
    } else if (operation === 'cancel_tax') {
        url = `${baseUrl}CancelTransaction`;
    } else {
        const errorMsg = 'Operación inválida. Usa "get_tax", "post_tax" o "cancel_tax".';
        console.error(errorMsg);
        logError(errorMsg);
        process.exit(1);
    }

    try {
        // Se usa el método GET para todas las operaciones, según lo requerido.
        const response = await axios({
            method: 'GET',
            url: url,
            data: requestBody,
            headers: {
                'Content-Type': 'application/json'
            }
        });

        // Obtener el directorio de salida desde .env
        const outputDir = process.env.OUTPUT_DIR;
        if (!outputDir) {
            const errorMsg = 'No se ha definido OUTPUT_DIR en el archivo .env';
            console.error(errorMsg);
            logError(errorMsg);
            process.exit(1);
        }

        // Asegurarse de que el directorio de salida exista, si no, crearlo
        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
        }

        // Crear el nombre del archivo de respuesta con el prefijo RESPONSE_
        const originalName = path.basename(filePath);
        const responseFileName = path.join(outputDir, 'RESPONSE_' + originalName);

        // Escribir la respuesta en el archivo
        fs.writeFileSync(responseFileName, JSON.stringify(response.data, null, 2));
        const successMsg = 'Respuesta escrita en ' + responseFileName;
        console.log(successMsg);
    } catch (error) {
        const errorMsg = `Error en la petición: ${error.message}`;
        console.error(errorMsg);
        logError(errorMsg);
    }
}

main();
