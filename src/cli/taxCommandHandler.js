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
     * @param {SynexusRequestBuilder} requestBuilder - Constructor del cuerpo v2 (tipado con intención + llave para el cálculo; proyección para la cancelación)
     * @param {SynexusApiClient|null} synexusApiClient - Cliente API del contrato v2; null cuando el contrato resuelto es v1
     */
    constructor(config, logger, fileManager, validator, apiClient, synexusConfig, requestBuilder, synexusApiClient) {
        this.config = config;
        this.logger = logger;
        this.fileManager = fileManager;
        this.validator = validator;
        this.apiClient = apiClient;
        this.synexusConfig = synexusConfig;
        this.requestBuilder = requestBuilder;
        this.synexusApiClient = synexusApiClient;
        // Flags reconocidos por parseArguments. Fuera de los dos posicionales
        // (operación y ruta), cualquier otro argumento que no sea uno de estos
        // flags con su valor es error: un flag mal escrito (-api-version=v2, un
        // guion tipográfico, --api-version sin =) que cayera en silencio en v1
        // le haría creer al operador que probó v2.
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
        // 1. Clasificar cada argumento. Sólo hay tres destinos: un flag reconocido
        //    con su valor, uno de los dos posicionales, o error. Un argumento que
        //    empieza con guion —ASCII o tipográfico (– —, lo que produce un editor
        //    que "corrige" el doble guion)— sólo puede ser flag, y si no es uno de
        //    los reconocidos se rechaza: -api-version=v2 o --api-version sin = no
        //    pueden caer en v1 en silencio. Un tercer posicional también se rechaza:
        //    la invocación del envoltorio del ERP trae exactamente dos, así que su
        //    resultado no cambia (COMP-01).
        //    Cuenta como guion: el ASCII, los tipográficos U+2010..U+2015
        //    (‐ ‑ ‒ – — ―) y el signo menos U+2212
        const looksLikeFlag = /^[-\u2010-\u2015\u2212]/;
        const positionals = [];
        const unknownArguments = [];
        args.forEach(arg => {
            if (this.knownFlags.some(flag => arg.startsWith(flag))) {
                return;
            }
            if (!looksLikeFlag.test(arg) && positionals.length < 2) {
                positionals.push(arg);
                return;
            }
            unknownArguments.push(arg);
        });

        // 2. Argumentos desconocidos: se rechazan antes que nada, mostrando todos
        //    los que sobran y las dos formas aceptadas
        if (unknownArguments.length > 0) {
            const errorMsg = `Argumento no reconocido: ${unknownArguments.join(', ')}. ` +
                'Sólo se aceptan la operación, la ruta del archivo y los flags ' +
                '--api-version=<v1|v2> y --entity=<codigo>.';
            console.error(errorMsg);
            this.logger.error(errorMsg);
            throw new Error(errorMsg);
        }

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
        // Fuera del try porque el catch los necesita: bajo v2, un fallo también
        // tiene que dejar archivo de respuesta, y para eso hacen falta la ruta
        // del archivo de entrada y el contrato. Si parseArguments es lo que
        // falla, quedan en undefined y el catch no intenta escribir nada.
        let operation;
        let filePath;
        let apiVersion;

        try {
            // 1. Parsear argumentos
            const parsed = this.parseArguments(args);
            operation = parsed.operation;
            filePath = parsed.filePath;
            apiVersion = parsed.apiVersion;
            const entityCode = parsed.entityCode;

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

            // Bajo v2, el ERP lee SIEMPRE el mismo archivo y sólo ése. Si una
            // corrida fallida no deja nada, lee el RESPONSE_ de una corrida
            // anterior y lo toma por bueno: peor que no tener archivo. Por eso
            // el fallo también escribe, con el mismo nombre y sin prefijo
            // distinto. v1 queda intacto (COMP-01).
            if (apiVersion === 'v2' && typeof filePath === 'string' && filePath.length > 0) {
                await this._saveErrorResponse(error, filePath, operation);
            }

            throw error;
        }
    }

    /**
     * Archiva el desenlace de una corrida v2 fallida en el MISMO archivo de
     * respuesta de siempre: `RESPONSE_<nombre original>` en el directorio de
     * salida, sin prefijo adicional ni sufijo. Es lo que pidió el área de ERP:
     * su proceso abre ese archivo y sólo ése, y si lo que encuentra no es el
     * cálculo que esperaba, lo detecta por su lado y levanta el error.
     *
     * NUNCA lanza. Si escribir falla —disco lleno, permisos, ruta inválida— lo
     * reporta y regresa: el error que debe llegar al operador y al código de
     * salida es el original, no el de la escritura. Enmascararlo convertiría
     * "el proveedor devolvió 422" en "no se pudo escribir", que es el
     * diagnóstico equivocado.
     * @private
     * @param {Error} error - Error que abortó la corrida
     * @param {string} originalFilePath - Ruta del archivo de entrada
     * @param {string} [operation] - Operación en curso, si se alcanzó a parsear
     */
    async _saveErrorResponse(error, originalFilePath, operation) {
        try {
            const body = this._errorResponseBodyFor(error, operation);
            await this._saveResponse(body, originalFilePath);

            const origen = error.providerResponded === true
                ? 'la respuesta del proveedor, íntegra'
                : 'un detalle generado por nexgen (el proveedor no respondió)';
            console.log(`El archivo de respuesta quedó escrito con ${origen}.`);
        } catch (saveError) {
            const errorMsg = `No se pudo escribir el archivo de respuesta tras el fallo: ${saveError.message}`;
            console.error(errorMsg);
            this.logger.error(`${errorMsg} - Archivo de entrada: ${originalFilePath}`);
            // Sin re-lanzar: el error original sigue su camino intacto
        }
    }

    /**
     * Decide QUÉ se escribe cuando la corrida v2 falló.
     *
     *   - El proveedor respondió (4xx o 5xx con cuerpo): su cuerpo tal cual,
     *     sin tocar un byte. Es lo que pidió el área de ERP.
     *   - El proveedor no respondió, o respondió sin cuerpo útil (timeout, red,
     *     DNS, un 4xx vacío), o la corrida abortó antes de salir a la red
     *     (validación, entidad sin resolver): un objeto propio de nexgen. No
     *     se parece a un cálculo, que es justo lo que permite al ERP
     *     distinguirlo.
     *
     * El objeto propio lleva sólo campos ya saneados: el mensaje del Error
     * —que las capas construyen sin credenciales— y el código de red. Nunca el
     * error completo, ni error.config, ni los headers: ahí viaja la llave
     * (CFG-05).
     * @private
     * @param {Error} error - Error que abortó la corrida
     * @param {string} [operation] - Operación en curso, si se alcanzó a parsear
     * @returns {*} Cuerpo a escribir
     */
    _errorResponseBodyFor(error, operation) {
        const body = error.providerResponseBody;
        const providerSentSomething = error.providerResponded === true &&
            body !== undefined &&
            body !== null &&
            body !== '';

        if (providerSentSomething) {
            return body;
        }

        return {
            error: {
                source: 'nexgen',
                message: typeof error.message === 'string' ? error.message : String(error),
                code: typeof error.code === 'string' ? error.code : null,
                operation: typeof operation === 'string' ? operation : null,
                provider_responded: error.providerResponded === true,
                provider_request_id: typeof error.providerRequestId === 'string' ? error.providerRequestId : null,
                request_id: typeof error.nexgenRequestId === 'string' ? error.nexgenRequestId : null,
                timestamp: new Date().toISOString()
            }
        };
    }

    /**
     * Rama v2 de execute(): valida el cuerpo y la forma del archivo, resuelve
     * la entidad, anuncia el perfil efectivo, construye el cuerpo v2 según la
     * operación (bifurcación en _buildV2Body: cálculo o cancelación), lo
     * imprime, pasa la guardia de cableado y emite la petición con el cliente v2.
     *
     * No usa el agregador del validador porque el archivo v2 no trae el campo
     * Committed —es del contrato v1— y la validación de ese campo rechazaría todo
     * archivo v2 real. Tampoco sanea: el cuerpo viaja CRUDO (ver el paso 2).
     * validateOperation no se repite: ya corrió en el paso 2 de execute, común
     * a los dos contratos. La validación estricta de v2 es
     * validateV2IntentFields, con la intención que devuelve el builder, y sólo
     * aplica a las operaciones de cálculo (ver _buildV2Body).
     * @private
     * @param {string} operation - Operación ya validada
     * @param {Object} requestBody - Cuerpo CRUDO, tal como salió de readJsonFile
     * @param {string|undefined} entityCode - Valor del flag --entity=, si se dio
     * @returns {Promise<Object>} Respuesta del proveedor v2, tal cual la devolvió el cliente
     * @throws {Error} Si el cuerpo no es un objeto, si es un arreglo o parece de v1, si la entidad no se
     *   resuelve, si la operación no tiene constructor de cuerpo, si el archivo contradice la operación
     *   o no trae lo que la cancelación exige, si falta el cliente v2, o si la petición falla
     */
    async _executeV2(operation, requestBody, entityCode) {
        // 1. Mismo freno que v1: un cuerpo nulo debe fallar en español, no con un TypeError
        this.validator.validateRequestBody(requestBody);

        // 2. La forma del archivo bajo v2: objeto —no arreglo— y no de v1. Va
        //    ANTES de resolver la entidad, así que un archivo v1 bajo v2 aborta
        //    con la causa raíz y no con "no se pudo resolver el código de entidad"
        //    (IN-08 del review de la Fase 1). Aplica a las TRES operaciones,
        //    incluida la cancelación.
        //
        //    La rama v2 NO sanea (WR-03). sanitizeStringFields sustituye ' por \'
        //    y nació como parche de la API legada de v1; en el cable v2
        //    JSON.stringify escapa la barra y el proveedor recibiría literalmente
        //    O\'Brien en sus registros fiscales. JSON ya sabe entrecomillar: los
        //    strings del archivo viajan tal cual. v1 sigue saneando vía
        //    validate() y COMP-01 lo protege.
        this.validator.validateV2FileShape(requestBody);

        // 3. Resolver la entidad sobre el cuerpo crudo: entity_id es una de sus tres vías
        const resolvedEntityCode = this.synexusConfig.resolveEntityCode(entityCode, requestBody);

        // 4. Anunciar el perfil efectivo antes de cualquier salida a la red
        this.synexusConfig.printProfile(resolvedEntityCode);

        // 5. Construir el cuerpo v2 según la operación y mostrarlo: es lo que
        //    permite al operador verificar lo que sale antes de que salga (el
        //    tipado en el cálculo, la proyección en la cancelación). No lleva
        //    credencial alguna
        const v2RequestBody = this._buildV2Body(operation, requestBody);
        console.log(`Cuerpo v2 a enviar: ${JSON.stringify(v2RequestBody, null, 2)}`);

        // 6. Guardia de cableado. No es un andamio: el cliente v2 ya se inyecta
        //    desde index.js y en operación normal esta condición es falsa; queda
        //    como defensa permanente contra un cableado incompleto en index.js
        if (!this.synexusApiClient) {
            const errorMsg = 'Falta inyectar el cliente v2 en el manejador de comandos: ' +
                `la operación ${operation} no puede emitirse. Revise el cableado de index.js.`;
            console.error(errorMsg);
            this.logger.error(errorMsg);
            throw new Error(errorMsg);
        }

        // 7. Emitir la petición con el cuerpo construido y la entidad resuelta. El
        //    valor de retorno viaja al paso 7 de execute, que guarda la respuesta
        //    con el mismo mecanismo de siempre: el contrato de archivos no cambia
        try {
            return await this.synexusApiClient.makeRequest(operation, v2RequestBody, resolvedEntityCode);
        } catch (error) {
            // La llave de idempotencia que generó nexgen, para que el archivo de
            // error la lleve cuando el proveedor no respondió y no hay id suyo
            // que citar. Se MUTA el error: la identidad se conserva.
            if (typeof v2RequestBody.request_id === 'string' && v2RequestBody.request_id.length > 0) {
                error.nexgenRequestId = v2RequestBody.request_id;
            }
            throw error;
        }
    }

    /**
     * Construye el cuerpo v2 según la operación. Dos caminos, uno por forma de
     * cuerpo del contrato:
     *   - cancel_tax: la proyección { invoice_id, customer_id } del builder.
     *   - get_tax y post_tax: intención → validar el archivo contra ESA misma
     *     intención → construir el cuerpo tipado (la secuencia del plan 01-03).
     *
     * La cancelación no pasa por getIntentFor ni por validateV2IntentFields
     * porque no tiene intención que mapear ni que validar: su endpoint no
     * documenta transaction_type ni committed. Las guardias de archivo v1 y de
     * arreglo raíz sí le aplican: ya corrieron en validateV2FileShape (paso 2
     * de _executeV2), común a las tres operaciones.
     *
     * Sigue el molde de getIntentFor: comprobación por operación y throw
     * terminal, SIN rama else con valor por omisión. validateOperation ya corrió
     * en el paso 2 de execute, así que la rama terminal sólo dispara si alguien
     * amplía validOperations sin dar a la operación nueva un constructor de
     * cuerpo: mejor abortar aquí que mandar un cuerpo de cálculo a un endpoint
     * que no lo espera
     * @private
     * @param {string} operation - Operación ya validada
     * @param {Object} requestBody - Cuerpo CRUDO, ya validado en forma
     * @returns {Object} Cuerpo listo para emitirse
     * @throws {Error} Si la operación no tiene constructor de cuerpo, si el archivo contradice la
     *   intención (cálculo) o si falta invoice_id o customer_id (cancelación)
     */
    _buildV2Body(operation, requestBody) {
        if (operation === 'cancel_tax') {
            return this.requestBuilder.buildCancelBody(requestBody);
        }

        if (operation === 'get_tax' || operation === 'post_tax') {
            // La intención primero: una operación sin mapeo aborta aquí, antes
            // de que se valide o se construya nada. Después, validar antes de
            // construir: un archivo que contradice la operación aborta antes de
            // que exista un cuerpo. La intención que se compara es la MISMA que
            // devolvió el builder: una sola fuente
            const intent = this.requestBuilder.getIntentFor(operation);
            this.validator.validateV2IntentFields(operation, requestBody, intent);
            return this.requestBuilder.buildRequestBody(operation, requestBody);
        }

        const errorMsg = `La operación "${operation}" no tiene constructor de cuerpo en el contrato v2.`;
        console.error(errorMsg);
        this.logger.error(`${errorMsg} - Operation: ${operation}`);
        throw new Error(errorMsg);
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
