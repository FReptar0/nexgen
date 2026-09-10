// src/api/synexusApiClient.js
const axios = require('axios');

/**
 * API Layer - Synexus API Client (contrato v2)
 * Responsabilidad: Gestionar todas las peticiones HTTP al proveedor del
 * contrato v2 (Synexus Compute). Recibe el cuerpo YA construido por
 * SynexusRequestBuilder y la entidad ya resuelta: este cliente no construye
 * nada, sólo emite
 * Principio SOLID: Single Responsibility Principle (SRP)
 * Patrón: Dependency Injection
 *
 * Copiado de src/api/taxApiClient.js (congelado) con estas divergencias
 * deliberadas: método POST, credencial en el header Authorization: Bearer
 * (nunca en la URL), código de entidad en su header dedicado, y ninguna
 * traza que pueda llevar la llave.
 */
class SynexusApiClient {
    /**
     * Constructor con inyección de dependencias
     * @param {SynexusConfig} synexusConfig - Configuración del contrato v2
     * @param {Logger} logger - Instancia del logger
     */
    constructor(synexusConfig, logger) {
        this.synexusConfig = synexusConfig;
        this.logger = logger;
        this.timeout = 30000; // 30 segundos, el mismo valor que v1
        // Nombre del header de entidad como propiedad de instancia, igual que
        // validOperations en el validador: greppable, sustituible desde una
        // prueba, y un solo lugar que tocar en el siguiente cambio de marca.
        // Es el nombre de la marca nueva; el anterior (X-Syntax-*) ya no aplica.
        this.entityHeaderName = 'X-Synexus-Entity';
    }

    /**
     * Realiza una petición al proveedor v2
     * @param {string} operation - Operación a realizar
     * @param {Object} requestBody - Cuerpo YA construido (intención + request_id incluidos)
     * @param {string} entityCode - Código de entidad ya resuelto
     * @returns {Promise<Object>} Respuesta del proveedor, sin transformar
     * @throws {Error} Si la petición falla
     */
    async makeRequest(operation, requestBody, entityCode) {
        const url = this.synexusConfig.getCalculationUrl();

        // Esta traza es segura: la URL de v2 no lleva credencial. El cuerpo no
        // se imprime aquí porque la rama v2 del CLI ya lo imprimió, y el objeto
        // headers no se imprime nunca, por ninguna vía: lleva la llave.
        console.log(`Realizando petición ${operation.toUpperCase()} a: ${url}`);

        try {
            const response = await axios({
                method: 'POST',
                url: url,
                data: requestBody,
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.synexusConfig.getApiKey()}`,
                    [this.entityHeaderName]: entityCode
                },
                timeout: this.timeout,
                // Considera exitosos todos los códigos de estado menores a 500
                // para manejarlos manualmente en _handleResponse
                validateStatus: (status) => status < 500
            });

            return this._handleResponse(response, url, operation);
        } catch (error) {
            this._handleError(error, url, operation);
            throw error;
        }
    }

    /**
     * Maneja la respuesta del proveedor
     * @private
     * @param {Object} response - Respuesta de axios
     * @param {string} url - URL de la petición
     * @param {string} operation - Operación realizada
     * @returns {Object} Datos de la respuesta, tal cual llegaron
     * @throws {Error} Si el status code indica error
     */
    _handleResponse(response, url, operation) {
        console.log(`Respuesta recibida - Status: ${response.status} ${response.statusText}`);

        // Mostrar datos de respuesta
        if (response.data) {
            console.log('Respuesta del servidor:', JSON.stringify(response.data, null, 2));
        }

        // Verificar si el servidor indica error mediante el status code
        if (response.status >= 400) {
            const serverErrorMsg = response.data ? JSON.stringify(response.data) : response.statusText;
            const errorMsg = `Error HTTP ${response.status}: ${serverErrorMsg}`;
            console.error(errorMsg);
            this.logger.error(`${errorMsg} - URL: ${url} - Operation: ${operation}`);
            throw new Error(errorMsg);
        }

        // Log de éxito
        const successLogMsg = `SUCCESS: ${operation} - Status: ${response.status}`;
        console.log(successLogMsg);

        return response.data;
    }

    /**
     * Maneja errores de petición HTTP
     *
     * CUIDADO: el objeto de error de axios lleva la petición completa en
     * error.config —headers incluidos, y por tanto la llave portadora— y un
     * toJSON que la serializa. Aquí sólo se leen error.code, error.message,
     * error.response.status y error.response.data. No serializar el error
     * entero, ni error.config, ni error.request, ni llamar a su toJSON: sería
     * imprimir la llave en la salida estándar y en los archivos de log (CFG-05).
     * No "mejore" el diagnóstico imprimiendo el error completo.
     * @private
     * @param {Error} error - Error capturado
     * @param {string} url - URL de la petición
     * @param {string} operation - Operación realizada
     */
    _handleError(error, url, operation) {
        let errorMsg = 'Error en la petición: ';

        if (error.code === 'ECONNREFUSED') {
            errorMsg += 'Conexión rechazada. El servidor no está disponible o la URL es incorrecta.';
            console.error(errorMsg);
            console.error(`URL intentada: ${url}`);
            console.error('Verifique que:');
            console.error('1. El servidor esté en funcionamiento');
            console.error('2. La SYNEXUS_BASE_URL en .env sea correcta');
            console.error('3. No hay firewall bloqueando la conexión');
        } else if (error.code === 'ECONNABORTED') {
            errorMsg += 'Timeout de conexión. La petición tardó más de 30 segundos.';
            console.error(errorMsg);
        } else if (error.code === 'ENOTFOUND') {
            errorMsg += 'Servidor no encontrado. Verifique la URL en SYNEXUS_BASE_URL.';
            console.error(errorMsg);
            console.error(`URL: ${url}`);
        } else if (error.response) {
            // Error con respuesta del servidor: sólo el status y el cuerpo
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
        const detailedLog = `${errorMsg} - Operation: ${operation} - URL: ${url}`;
        this.logger.error(detailedLog);

        // Información de diagnóstico
        console.error('\n--- Información de diagnóstico ---');
        console.error(`Operación: ${operation}`);
        console.error(`URL: ${url}`);
        console.error(`Timestamp: ${new Date().toISOString()}`);
    }

    /**
     * Realiza una petición para cotizar impuestos (get_tax) bajo el contrato v2.
     * postTax y cancelTax son de la Fase 2
     * @param {Object} requestBody - Cuerpo ya construido por SynexusRequestBuilder
     * @param {string} entityCode - Código de entidad ya resuelto
     * @returns {Promise<Object>} Respuesta del proveedor
     */
    async getTax(requestBody, entityCode) {
        return this.makeRequest('get_tax', requestBody, entityCode);
    }
}

module.exports = SynexusApiClient;
