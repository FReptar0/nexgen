// src/api/taxApiClient.js
const axios = require('axios');

/**
 * API Layer - Tax API Client
 * Responsabilidad: Gestionar todas las peticiones HTTP a la API de impuestos
 * Principio SOLID: Single Responsibility Principle (SRP)
 * Patrón: Dependency Injection
 */
class TaxApiClient {
    /**
     * Constructor con inyección de dependencias
     * @param {Config} config - Configuración de la aplicación
     * @param {Logger} logger - Instancia del logger
     */
    constructor(config, logger) {
        this.config = config;
        this.logger = logger;
        this.timeout = 30000; // 30 segundos
    }

    /**
     * Realiza una petición a la API de impuestos
     * @param {string} operation - Operación a realizar
     * @param {Object} requestBody - Datos a enviar
     * @returns {Promise<Object>} Respuesta de la API
     * @throws {Error} Si la petición falla
     */
    async makeRequest(operation, requestBody) {
        const url = this.config.getEndpointUrl(operation);

        console.log(`Realizando petición ${operation.toUpperCase()} a: ${url}`);
        console.log(`Enviando datos: ${JSON.stringify(requestBody, null, 2)}`);

        try {
            const response = await axios({
                method: 'GET',
                url: url,
                data: requestBody,
                headers: {
                    'Content-Type': 'application/json'
                },
                timeout: this.timeout,
                validateStatus: function (status) {
                    // Considera exitosos todos los códigos de estado para manejarlos manualmente
                    return status < 500;
                }
            });

            return this._handleResponse(response, url, operation);
        } catch (error) {
            this._handleError(error, url, operation);
            throw error;
        }
    }

    /**
     * Maneja la respuesta de la API
     * @private
     * @param {Object} response - Respuesta de axios
     * @param {string} url - URL de la petición
     * @param {string} operation - Operación realizada
     * @returns {Object} Datos de la respuesta
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
            // Error con respuesta del servidor
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
     * Realiza una petición para calcular impuestos (get_tax)
     * @param {Object} requestBody - Datos de la transacción
     * @returns {Promise<Object>} Respuesta de la API
     */
    async getTax(requestBody) {
        return this.makeRequest('get_tax', requestBody);
    }

    /**
     * Realiza una petición para calcular y confirmar impuestos (post_tax)
     * @param {Object} requestBody - Datos de la transacción
     * @returns {Promise<Object>} Respuesta de la API
     */
    async postTax(requestBody) {
        return this.makeRequest('post_tax', requestBody);
    }

    /**
     * Realiza una petición para cancelar una transacción de impuestos
     * @param {Object} requestBody - Datos de la transacción a cancelar
     * @returns {Promise<Object>} Respuesta de la API
     */
    async cancelTax(requestBody) {
        return this.makeRequest('cancel_tax', requestBody);
    }
}

module.exports = TaxApiClient;
