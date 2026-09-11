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
        isTestMode: jest.fn(() => false),
        // Mismo valor por omisión que el Config real con TAX_API_VERSION ausente
        // (tests/setup.js la deja ausente): cualquier prueba que quiera v2 lo
        // pide explícitamente por overrides o por el flag --api-version.
        getApiVersion: jest.fn(() => 'v1')
    };

    return Object.assign(defaults, overrides || {});
};

/**
 * Respuesta con la forma que axios entrega a _handleResponse (el de v1 y el
 * de v2). El statusText se deriva del código de estado, igual que lo haría
 * Node. Los headers son opcionales y, como los entrega axios en Node, van con
 * el nombre en MINÚSCULAS: { 'x-request-id': 'rid-1', 'retry-after': '30' }.
 * Sin tercer argumento, headers es {} — los usos existentes no cambian.
 * @param {number} status - Código HTTP
 * @param {*} data - Cuerpo de la respuesta
 * @param {Object} [headers] - Headers de respuesta, nombres en minúsculas
 * @returns {{ status: number, statusText: string, data: *, headers: Object }}
 */
const createAxiosResponse = (status, data, headers) => {
    return {
        status: status,
        statusText: http.STATUS_CODES[status] || '',
        data: data,
        headers: headers || {}
    };
};

module.exports = {
    createFakeLogger,
    createFakeConfig,
    createAxiosResponse
};
