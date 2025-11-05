// src/cli/taxCommandHandler.js
const path = require('path');

/**
 * CLI Layer - Tax Command Handler
 * Responsabilidad: Orquestar todas las capas para ejecutar comandos CLI
 * Principio SOLID:
 * - Single Responsibility: Solo orquesta, no implementa lógica de negocio
 * - Dependency Inversion: Depende de abstracciones (inyección de dependencias)
 */
class TaxCommandHandler {
    /**
     * Constructor con inyección de dependencias
     * @param {Config} config - Configuración
     * @param {Logger} logger - Logger
     * @param {FileManager} fileManager - Gestor de archivos
     * @param {TaxValidator} validator - Validador
     * @param {TaxApiClient} apiClient - Cliente API
     */
    constructor(config, logger, fileManager, validator, apiClient) {
        this.config = config;
        this.logger = logger;
        this.fileManager = fileManager;
        this.validator = validator;
        this.apiClient = apiClient;
    }

    /**
     * Parsea los argumentos de línea de comandos
     * @param {string[]} args - Argumentos de process.argv
     * @returns {Object} Objeto con operation y filePath
     * @throws {Error} Si los argumentos son inválidos
     */
    parseArguments(args) {
        if (args.length < 2) {
            const message = 'Uso: node index.js <operacion> <ruta_del_archivo>\n' +
                'Operaciones válidas: "get_tax", "post_tax" o "cancel_tax"';
            console.error(message);
            this.logger.error(message);
            throw new Error(message);
        }

        return {
            operation: args[0],
            filePath: args[1]
        };
    }

    /**
     * Ejecuta el comando principal
     * @param {string[]} args - Argumentos de línea de comandos
     */
    async execute(args) {
        try {
            // 1. Parsear argumentos
            const { operation, filePath } = this.parseArguments(args);

            // 2. Validar operación
            this.validator.validateOperation(operation);

            // 3. Verificar que el archivo existe
            if (!this.fileManager.exists(filePath)) {
                const errorMsg = `El archivo no existe en la ruta especificada: ${filePath}`;
                console.error(errorMsg);
                this.logger.error(errorMsg);
                throw new Error(errorMsg);
            }

            // 4. Leer y parsear el archivo JSON
            const requestBody = this.fileManager.readJsonFile(filePath);

            // 5. Validar el cuerpo de la petición y el campo Committed, obtener datos sanitizados
            const sanitizedRequestBody = this.validator.validate(operation, requestBody);

            // 6. Realizar la petición a la API con los datos sanitizados
            const responseData = await this.apiClient.makeRequest(operation, sanitizedRequestBody);

            // 7. Preparar y guardar la respuesta
            await this._saveResponse(responseData, filePath);

            // 8. Log de éxito
            const originalName = path.basename(filePath);
            const successMsg = `Operación ${operation} completada exitosamente`;
            console.log(successMsg);
            console.log(`SUCCESS: ${operation} - File: ${originalName}`);

        } catch (error) {
            // Manejo centralizado de errores
            this._handleError(error);
            throw error;
        }
    }

    /**
     * Guarda la respuesta de la API en un archivo
     * @private
     * @param {Object} responseData - Datos de respuesta
     * @param {string} originalFilePath - Ruta del archivo original
     */
    async _saveResponse(responseData, originalFilePath) {
        const outputDir = this.config.getOutputDir();

        // Asegurar que el directorio de salida existe
        this.fileManager.ensureDirectory(outputDir);

        // Generar nombre del archivo de respuesta
        const responseFileName = this.fileManager.getResponseFileName(
            originalFilePath,
            outputDir
        );

        // Escribir el archivo
        this.fileManager.writeJsonFile(responseFileName, responseData);

        console.log(`Respuesta guardada en: ${responseFileName}`);
    }

    /**
     * Maneja errores de manera centralizada
     * @private
     * @param {Error} error - Error capturado
     */
    _handleError(error) {
        console.error(`\n❌ Error: ${error.message}`);
        this.logger.error(error.message);
    }

    /**
     * Muestra ayuda de uso
     */
    showHelp() {
        console.log('NexGen Tax API Client');
        console.log('');
        console.log('Uso: node index.js <operacion> <ruta_del_archivo>');
        console.log('');
        console.log('Operaciones disponibles:');
        console.log('  get_tax    - Calcula impuestos sin confirmar (Committed: false)');
        console.log('  post_tax   - Calcula y confirma impuestos (Committed: true)');
        console.log('  cancel_tax - Cancela una transacción de impuestos');
        console.log('');
        console.log('Ejemplo:');
        console.log('  node index.js get_tax ./data/transaction.json');
    }
}

module.exports = TaxCommandHandler;
