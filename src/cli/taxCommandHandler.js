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
     * @param {TaxApiClient} apiClient - Cliente API (contrato v1)
     * @param {SynexusConfig|null} synexusConfig - Configuración del contrato v2; null cuando el contrato resuelto es v1
     */
    constructor(config, logger, fileManager, validator, apiClient, synexusConfig) {
        this.config = config;
        this.logger = logger;
        this.fileManager = fileManager;
        this.validator = validator;
        this.apiClient = apiClient;
        this.synexusConfig = synexusConfig;
        // Flags reconocidos por parseArguments. Cualquier otro argumento que
        // empiece con -- es error: un flag mal escrito que cayera en silencio en
        // v1 le haría creer al operador que probó v2.
        this.knownFlags = ['--api-version=', '--entity='];
    }

    /**
     * Resuelve el contrato de API a usar: el flag --api-version=<v1|v2> sobreescribe
     * a la configuración de entorno. Es estático porque index.js necesita el
     * contrato ANTES de construir el manejador (para decidir si construye la
     * configuración v2), y porque es una función pura: mismos argumentos, mismo resultado
     * @param {string[]} args - Argumentos de process.argv
     * @param {Config} config - Configuración (provee el valor de la variable de entorno)
     * @param {Logger} logger - Logger
     * @returns {string} 'v1' | 'v2'
     * @throws {Error} Si el valor del flag no es exactamente v1 ni v2
     */
    static resolveApiVersion(args, config, logger) {
        const flagPrefix = '--api-version=';
        const flag = args.find(arg => arg.startsWith(flagPrefix));

        if (flag === undefined) {
            return config.getApiVersion();
        }

        const value = flag.slice(flagPrefix.length);
        if (value !== 'v1' && value !== 'v2') {
            const errorMsg = `Valor inválido para --api-version: "${value}". Use "v1" o "v2".`;
            console.error(errorMsg);
            logger.error(errorMsg);
            throw new Error(errorMsg);
        }

        return value;
    }

    /**
     * Parsea los argumentos de línea de comandos. Los flags se aceptan en cualquier
     * posición y se retiran antes de resolver los posicionales, para que operación
     * y ruta conserven sus índices (el envoltorio del ERP invoca sin flags)
     * @param {string[]} args - Argumentos de process.argv
     * @returns {Object} Objeto con operation, filePath, apiVersion y entityCode
     * @throws {Error} Si los argumentos son inválidos
     */
    parseArguments(args) {
        // 1. Flags desconocidos: se rechazan antes que nada
        const unknownFlags = args.filter(arg => arg.startsWith('--') &&
            !this.knownFlags.some(flag => arg.startsWith(flag)));
        if (unknownFlags.length > 0) {
            const errorMsg = `Argumento no reconocido: ${unknownFlags.join(', ')}. ` +
                'Flags válidos: --api-version=<v1|v2> y --entity=<codigo>.';
            console.error(errorMsg);
            this.logger.error(errorMsg);
            throw new Error(errorMsg);
        }

        // 2. Separar los posicionales retirando todo lo que empiece con --
        const positionals = args.filter(arg => !arg.startsWith('--'));

        // 3. Comprobación de longitud sobre los posicionales YA filtrados: si corriera
        //    antes, una invocación con flag y sin ruta pasaría y fallaría más tarde
        //    con un mensaje peor
        if (positionals.length < 2) {
            const message = 'Uso: node index.js <operacion> <ruta_del_archivo>\n' +
                'Operaciones válidas: "get_tax", "post_tax" o "cancel_tax"';
            console.error(message);
            this.logger.error(message);
            throw new Error(message);
        }

        // 4. Componer el retorno: el selector de contrato y el código de entidad se
        //    suman a las dos propiedades de siempre; execute desestructura por nombre
        const entityFlagPrefix = '--entity=';
        const entityFlag = args.find(arg => arg.startsWith(entityFlagPrefix));

        return {
            operation: positionals[0],
            filePath: positionals[1],
            apiVersion: TaxCommandHandler.resolveApiVersion(args, this.config, this.logger),
            entityCode: entityFlag === undefined ? undefined : entityFlag.slice(entityFlagPrefix.length)
        };
    }

    /**
     * Ejecuta el comando principal
     * @param {string[]} args - Argumentos de línea de comandos
     */
    async execute(args) {
        try {
            // 1. Parsear argumentos
            const { operation, filePath, apiVersion, entityCode } = this.parseArguments(args);

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

            // 5-6. Ramificar por contrato ANTES de validar. El archivo v2 no trae el
            //      campo Committed de v1, así que la rama v2 valida por su cuenta y
            //      sustituye a los pasos 5 y 6; bajo v1 esos dos pasos se conservan
            //      con su texto y su orden.
            let responseData;
            if (apiVersion === 'v2') {
                responseData = await this._executeV2(operation, requestBody, entityCode);
            } else {
                // 5. Validar el cuerpo de la petición y el campo Committed, obtener datos sanitizados
                const sanitizedRequestBody = this.validator.validate(operation, requestBody);

                // 6. Realizar la petición a la API con los datos sanitizados
                responseData = await this.apiClient.makeRequest(operation, sanitizedRequestBody);
            }

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
     * Rama v2 de execute(): valida y sanea por separado, resuelve la entidad,
     * anuncia el perfil efectivo y se detiene en la guardia de cableado.
     *
     * No usa el agregador del validador porque el archivo v2 no trae el campo
     * Committed —es del contrato v1— y la validación de ese campo rechazaría todo
     * archivo v2 real. validateOperation no se repite: ya corrió en el paso 2,
     * común a los dos contratos. La validación de intención propia de v2 se
     * agrega en el plan 01-03, entre el anuncio del perfil y la guardia.
     * @private
     * @param {string} operation - Operación ya validada
     * @param {Object} requestBody - Cuerpo CRUDO, tal como salió de readJsonFile
     * @param {string|undefined} entityCode - Valor del flag --entity=, si se dio
     * @returns {Promise<Object>} Respuesta del cliente v2
     * @throws {Error} Si el cuerpo no es un objeto, si la entidad no se resuelve, o si falta el cliente v2
     */
    async _executeV2(operation, requestBody, entityCode) {
        // 1. Mismo freno que v1: un cuerpo nulo debe fallar en español, no con un TypeError
        this.validator.validateRequestBody(requestBody);

        // 2. Mismo saneado de apóstrofos que v1, llamado por separado
        const sanitizedRequestBody = this.validator.sanitizeStringFields(requestBody);

        // 3. Resolver la entidad sobre el cuerpo ya saneado: entity_id es una de sus tres vías
        const resolvedEntityCode = this.synexusConfig.resolveEntityCode(entityCode, sanitizedRequestBody);

        // 4. Anunciar el perfil efectivo antes de cualquier salida a la red
        this.synexusConfig.printProfile(resolvedEntityCode);

        // 5. Guardia de cableado. No es un andamio: cuando el cliente v2 se inyecte
        //    (plan 01-04) queda como defensa permanente contra un cableado
        //    incompleto en index.js
        if (!this.synexusApiClient) {
            const errorMsg = 'Falta inyectar el cliente v2 en el manejador de comandos: ' +
                `la operación ${operation} no puede emitirse. Revise el cableado de index.js.`;
            console.error(errorMsg);
            this.logger.error(errorMsg);
            throw new Error(errorMsg);
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
        console.log('Uso: node index.js <operacion> <ruta_del_archivo> [--api-version=<v1|v2>] [--entity=<codigo>]');
        console.log('');
        console.log('Operaciones disponibles:');
        console.log('  get_tax    - Calcula impuestos sin confirmar (Committed: false)');
        console.log('  post_tax   - Calcula y confirma impuestos (Committed: true)');
        console.log('  cancel_tax - Cancela una transacción de impuestos');
        console.log('');
        console.log('Flags opcionales (se aceptan en cualquier posición):');
        console.log('  --api-version=<v1|v2> - Contrato de API. Sobreescribe TAX_API_VERSION; sin ninguno de los dos, v1');
        console.log('  --entity=<codigo>     - Código de entidad para v2. Gana sobre SYNEXUS_ENTITY y sobre entity_id del JSON');
        console.log('');
        console.log('Ejemplos:');
        console.log('  node index.js get_tax ./data/transaction.json');
        console.log('  node index.js get_tax ./data/transaction.json --api-version=v2 --entity=USA');
    }
}

module.exports = TaxCommandHandler;
