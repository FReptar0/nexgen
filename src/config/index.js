// src/config/index.js
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

/**
 * Configuration Layer
 * Responsabilidad: Centralizar toda la configuración de la aplicación
 * Principio SOLID aplicado: Single Responsibility Principle (SRP)
 */
class Config {
    constructor() {
        this._validateRequiredEnvVars();
    }

    /**
     * Valida que todas las variables de entorno requeridas estén presentes
     * @private
     */
    _validateRequiredEnvVars() {
        const required = ['BASE_URL', 'API_CODE', 'OUTPUT_DIR'];
        const missing = required.filter(key => !process.env[key]);

        if (missing.length > 0) {
            throw new Error(`Variables de entorno faltantes: ${missing.join(', ')}`);
        }
    }

    /**
     * Obtiene la URL base de la API
     * @returns {string}
     */
    getBaseUrl() {
        return process.env.BASE_URL;
    }

    /**
     * Obtiene el código de autenticación de la API
     * @returns {string}
     */
    getApiCode() {
        return process.env.API_CODE;
    }

    /**
     * Obtiene el directorio de salida para respuestas
     * @returns {string}
     */
    getOutputDir() {
        return process.env.OUTPUT_DIR;
    }

    /**
     * Verifica si está en modo de prueba
     * @returns {boolean}
     */
    isTestMode() {
        return process.env.TEST_MODE === 'true';
    }

    /**
     * Obtiene el endpoint según la operación y el modo
     * @param {string} operation - Operación a realizar
     * @returns {string} URL completa del endpoint
     */
    getEndpointUrl(operation) {
        const baseUrl = this.getBaseUrl();

        if (operation === 'get_tax' || operation === 'post_tax') {
            const apiCode = this.getApiCode();
            const endpoint = this.isTestMode() ? 'STCCalcV3_TEST' : 'MGGetTaxForCart';
            return `${baseUrl}${endpoint}?code=${apiCode}`;
        }

        if (operation === 'cancel_tax') {
            return `${baseUrl}CancelTransaction`;
        }

        throw new Error(`Operación inválida: ${operation}`);
    }

    /**
     * Obtiene el directorio de logs
     * @returns {string}
     */
    getLogDir() {
        return path.resolve(__dirname, '../../logs');
    }
}

// Singleton pattern - una sola instancia de configuración
module.exports = new Config();
