// tests/helpers/fakes.js
// Dobles de prueba como objetos literales. Toda clase del proyecto recibe a sus
// colaboradores por constructor, así que basta un objeto con los métodos que se
// usan. Este archivo es el único ayudante común; todo lo demás va en sitio.
const http = require('http');

/**
 * Doble del Logger (src/infrastructure/logger.js).
 * Ofrece exactamente los cuatro métodos públicos del logger real.
 * @returns {Object} Logger falso con jest.fn() en cada método
 */
const createFakeLogger = () => {
    return {
        error: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        debug: jest.fn()
    };
};

/**
 * Doble de Config (src/config/index.js).
 * Valores por omisión razonables; cualquier propiedad de `overrides`
 * reemplaza a la del doble.
 * @param {Object} [overrides] - Métodos o valores que sustituyen los por omisión
 * @returns {Object} Config falsa
 */
const createFakeConfig = (overrides) => {
    const defaults = {
        getEndpointUrl: jest.fn((operation) => `https://ejemplo-v1.invalid/api/${operation}`),
        getBaseUrl: jest.fn(() => 'https://ejemplo-v1.invalid/api/'),
        getApiCode: jest.fn(() => 'codigo-de-prueba-v1'),
        getOutputDir: jest.fn(() => '/tmp/nexgen-tests-output'),
        isTestMode: jest.fn(() => false)
    };

    return Object.assign(defaults, overrides || {});
};

/**
 * Respuesta con la forma que axios entrega a TaxApiClient._handleResponse.
 * El statusText se deriva del código de estado, igual que lo haría Node.
 * @param {number} status - Código HTTP
 * @param {*} data - Cuerpo de la respuesta
 * @returns {{ status: number, statusText: string, data: * }}
 */
const createAxiosResponse = (status, data) => {
    return {
        status: status,
        statusText: http.STATUS_CODES[status] || '',
        data: data
    };
};

module.exports = {
    createFakeLogger,
    createFakeConfig,
    createAxiosResponse
};
