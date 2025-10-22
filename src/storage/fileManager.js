// src/storage/fileManager.js
const fs = require('fs');
const path = require('path');

/**
 * Storage Layer - File Manager
 * Responsabilidad: Gestionar todas las operaciones de lectura/escritura de archivos
 * Principio SOLID: Single Responsibility Principle (SRP)
 */
class FileManager {
    /**
     * Constructor con inyección de dependencias
     * @param {Logger} logger - Instancia del logger
     */
    constructor(logger) {
        this.logger = logger;
    }

    /**
     * Verifica si un archivo existe
     * @param {string} filePath - Ruta del archivo
     * @returns {boolean}
     */
    exists(filePath) {
        return fs.existsSync(filePath);
    }

    /**
     * Lee un archivo JSON y retorna el objeto parseado
     * @param {string} filePath - Ruta del archivo
     * @returns {Object} Objeto JSON parseado
     * @throws {Error} Si el archivo no existe o no es JSON válido
     */
    readJsonFile(filePath) {
        try {
            console.log(`Intentando leer archivo: ${filePath}`);

            if (!this.exists(filePath)) {
                throw new Error(`El archivo no existe: ${filePath}`);
            }

            const fileContent = fs.readFileSync(filePath, 'utf8');
            console.log(`Archivo leído exitosamente. Tamaño: ${fileContent.length} caracteres`);

            const jsonData = JSON.parse(fileContent);
            console.log('JSON parseado exitosamente');

            return jsonData;
        } catch (err) {
            this._handleFileReadError(err, filePath);
            throw err;
        }
    }

    /**
     * Maneja errores de lectura de archivos
     * @private
     * @param {Error} err - Error capturado
     * @param {string} filePath - Ruta del archivo
     */
    _handleFileReadError(err, filePath) {
        console.error(`Error al leer o parsear el archivo: ${err.message}`);
        console.error(`Código de error: ${err.code}`);
        console.error(`Ruta del archivo: ${filePath}`);

        if (err.code === 'ENOENT') {
            console.error('El archivo no fue encontrado. Verifique:');
            console.error('1. Que la ruta del archivo sea correcta');
            console.error('2. Que tenga permisos de lectura');
            console.error('3. Que el archivo no esté siendo usado por otro proceso');
            console.error('4. Que no haya caracteres especiales en el nombre');

            this._listSimilarFiles(filePath);
        } else if (err.code === 'EACCES') {
            console.error('Sin permisos para leer el archivo');
        } else if (err.name === 'SyntaxError') {
            console.error('El archivo no contiene JSON válido');
        }

        this.logger.error(`Error al leer archivo: ${err.message} - Path: ${filePath}`);
    }

    /**
     * Lista archivos similares en el directorio
     * @private
     * @param {string} filePath - Ruta del archivo
     */
    _listSimilarFiles(filePath) {
        try {
            const dir = path.dirname(filePath);
            const fileName = path.basename(filePath);

            console.log(`Buscando archivo: ${fileName}`);
            console.log(`En directorio: ${dir}`);

            if (fs.existsSync(dir)) {
                const files = fs.readdirSync(dir);
                console.log('Archivos encontrados en el directorio:');
                files.forEach(file => console.log(`  - ${file}`));

                const similarFiles = files.filter(file =>
                    file.toLowerCase().includes('sage') ||
                    file.toLowerCase().includes('tax') ||
                    file.includes('ORD') ||
                    file.endsWith('.json')
                );

                if (similarFiles.length > 0) {
                    console.log('Archivos similares encontrados:');
                    similarFiles.forEach(file => console.log(`  - ${file}`));
                }
            } else {
                console.log(`El directorio ${dir} no existe`);
            }
        } catch (listErr) {
            console.log(`No se pudo listar el directorio: ${listErr.message}`);
        }
    }

    /**
     * Escribe datos JSON en un archivo
     * @param {string} filePath - Ruta del archivo
     * @param {Object} data - Datos a escribir
     * @throws {Error} Si no se puede escribir el archivo
     */
    writeJsonFile(filePath, data) {
        try {
            fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
            console.log(`Archivo guardado exitosamente: ${filePath}`);
        } catch (err) {
            const errorMsg = `Error al escribir el archivo: ${err.message}`;
            console.error(errorMsg);
            console.error(`Ruta de destino: ${filePath}`);
            this.logger.error(errorMsg);
            throw err;
        }
    }

    /**
     * Crea un directorio si no existe
     * @param {string} dirPath - Ruta del directorio
     */
    ensureDirectory(dirPath) {
        try {
            if (!fs.existsSync(dirPath)) {
                fs.mkdirSync(dirPath, { recursive: true });
                console.log(`Directorio creado: ${dirPath}`);
            }
        } catch (err) {
            const errorMsg = `Error al crear el directorio: ${err.message}`;
            console.error(errorMsg);
            this.logger.error(errorMsg);
            throw err;
        }
    }

    /**
     * Genera el nombre del archivo de respuesta
     * @param {string} originalFilePath - Ruta del archivo original
     * @param {string} outputDir - Directorio de salida
     * @returns {string} Ruta completa del archivo de respuesta
     */
    getResponseFileName(originalFilePath, outputDir) {
        const originalName = path.basename(originalFilePath);
        return path.join(outputDir, 'RESPONSE_' + originalName);
    }
}

module.exports = FileManager;
