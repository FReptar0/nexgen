// tests/helpers/fakes.js
// Dobles de prueba como objetos literales. Toda clase del proyecto recibe a sus
// colaboradores por constructor, así que basta un objeto con los métodos que se
// usan. Este archivo es el único ayudante común; todo lo demás va en sitio.
const http = require('http');
const path = require('path');

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

/**
 * El contrato de archivo tras una corrida v2 FALLIDA: el área de ERP lee
 * siempre `RESPONSE_<nombre original>` y sólo ése, así que un fallo también
 * tiene que dejarlo escrito, con el mismo nombre y sin prefijo distinto.
 * Afirma la forma común —una sola escritura, prefijo intacto— y devuelve el
 * cuerpo para que cada caso afirme lo suyo.
 * @param {Object} writeJsonFileMock - El jest.fn() de writeJsonFile del doble
 * @returns {*} El cuerpo que se escribió
 */
const expectErrorResponseWritten = (writeJsonFileMock) => {
    expect(writeJsonFileMock).toHaveBeenCalledTimes(1);
    const [writtenPath, writtenData] = writeJsonFileMock.mock.calls[0];
    expect(path.basename(writtenPath).startsWith('RESPONSE_')).toBe(true);
    return writtenData;
};

/**
 * Caso "el proveedor no respondió, o la corrida abortó antes de la red": el
 * cuerpo es el objeto propio de nexgen, que NO se parece a un cálculo —es lo
 * que permite al ERP distinguirlo— y nunca lleva la llave.
 * @param {Object} writeJsonFileMock - El jest.fn() de writeJsonFile del doble
 * @returns {Object} El cuerpo escrito, para afirmaciones adicionales
 */
const expectNexgenErrorResponseWritten = (writeJsonFileMock) => {
    const written = expectErrorResponseWritten(writeJsonFileMock);

    expect(written.error.source).toBe('nexgen');
    expect(typeof written.error.message).toBe('string');
    expect(written.error.message.length).toBeGreaterThan(0);
    // No es un cálculo: ninguna de las llaves que el ERP espera de uno
    expect(written.totals).toBeUndefined();
    expect(written.transaction).toBeUndefined();

    return written;
};

/**
 * Caso "el proveedor sí respondió con cuerpo": se archiva TAL CUAL, por
 * identidad. Un toEqual pasaría también con una copia recortada; toBe es lo
 * que prueba que no se tocó un byte.
 * @param {Object} writeJsonFileMock - El jest.fn() de writeJsonFile del doble
 * @param {*} providerBody - El cuerpo exacto que devolvió el doble de axios
 */
const expectProviderErrorResponseWritten = (writeJsonFileMock, providerBody) => {
    const written = expectErrorResponseWritten(writeJsonFileMock);
    expect(written).toBe(providerBody);
};

module.exports = {
    createFakeLogger,
    createFakeConfig,
    createAxiosResponse,
    expectErrorResponseWritten,
    expectNexgenErrorResponseWritten,
    expectProviderErrorResponseWritten
};
