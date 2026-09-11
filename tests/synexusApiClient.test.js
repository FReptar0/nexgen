// tests/synexusApiClient.test.js
// El cliente HTTP del contrato v2 (src/api/synexusApiClient.js): método,
// URL por operación (cálculo para get_tax/post_tax, cancelación para
// cancel_tax, sin rama por omisión), headers, el identificador de petición
// del proveedor en toda corrida (SAFE-06) y —sobre todo— que la llave
// portadora no se filtre por ninguna vía de consola, ni en el camino feliz
// ni en el de error (CONN-01, CONN-02, CONN-03, CONN-04, CFG-05, OPER-03).
//
// src/api/taxApiClient.js es el molde del que se copió este cliente y está
// CONGELADO: aquí no se prueba nada de v1 (eso es tests/v1Freeze.wire.test.js).
// Como el cliente requiere axios en el tope del módulo y lo invoca como
// función, el único punto de intercepción es jest.mock('axios'): el automock
// convierte la función exportada en un jest.fn() y el argumento se lee de
// axios.mock.calls[0][0].
jest.mock('axios');

const axios = require('axios');
const SynexusApiClient = require('../src/api/synexusApiClient');
const fakes = require('./helpers/fakes');

// Llave ficticia. Lleva el prefijo real de staging para que el enmascarado
// tenga algo que reconocer, y un cuerpo que no es hexadecimal para que sea
// evidente que no es una llave de verdad. Lo que importa aquí es que sea una
// cadena única: la prueba de fuga busca que NUNCA aparezca completa.
const apiKey = 'synexus_test_llave-ficticia-de-prueba-0000-9999';
const calculationUrl = 'https://compute.staging.synexustax.com/api/v1/tax_calculations';
const cancelUrl = 'https://compute.staging.synexustax.com/api/v1/invoices/cancel';
const entityCode = 'USA';

// Cuerpo YA construido por SynexusRequestBuilder: el cliente no lo toca.
const createRequestBody = () => ({
    invoice_id: 'DEMO-001',
    customer_id: 'CUST-1',
    to_state: 'TX',
    to_zip: '75001',
    cart: [
        { item_id: 'SKU-1', price: 49.99, quantity: 1, tax_code: 'TPP' }
    ],
    transaction_type: 'sales_estimate',
    committed: false,
    request_id: '11111111-1111-4111-8111-111111111111'
});

// Cuerpo de cancelación YA proyectado por SynexusRequestBuilder.buildCancelBody:
// exactamente dos llaves. El cliente tampoco lo toca.
const createCancelBody = () => ({
    invoice_id: 'DEMO-001',
    customer_id: 'CUST-1'
});

const createSynexusConfigDouble = () => ({
    getCalculationUrl: jest.fn(() => calculationUrl),
    getCancelUrl: jest.fn(() => cancelUrl),
    getApiKey: jest.fn(() => apiKey)
});

/**
 * Error con la forma que axios entrega en Node: lleva la petición completa en
 * `config` (headers incluidos, y por tanto la llave), `request` cuando el
 * socket llegó a abrirse, `response` cuando el servidor contestó, y un
 * `toJSON` que serializa todo eso. Es exactamente lo que _handleError NO debe
 * imprimir entero.
 * @param {Object} overrides - code, response, request, message
 * @returns {Error}
 */
const createAxiosError = (overrides) => {
    const options = overrides || {};
    const error = new Error(options.message || 'Error de transporte simulado');
    error.isAxiosError = true;
    error.code = options.code;
    error.config = {
        method: 'post',
        url: calculationUrl,
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
            'X-Synexus-Entity': entityCode
        },
        data: JSON.stringify(createRequestBody())
    };
    if (options.request !== undefined) {
        error.request = options.request;
    }
    if (options.response !== undefined) {
        error.response = options.response;
    }
    error.toJSON = () => ({
        message: error.message,
        code: error.code,
        config: error.config
    });
    return error;
};

let consoleLogSpy;
let consoleErrorSpy;

/**
 * Todo lo que salió por consola durante la prueba, argumento por argumento,
 * convertido a cadena. Sirve para afirmar que la llave no aparece en NINGUNA
 * línea, venga de console.log o de console.error.
 * @returns {string[]}
 */
const capturedConsoleOutput = () => {
    return consoleLogSpy.mock.calls.concat(consoleErrorSpy.mock.calls)
        .reduce((all, call) => all.concat(call), [])
        .map(arg => (typeof arg === 'string' ? arg : JSON.stringify(arg)));
};

const expectNoCredentialLeak = () => {
    const output = capturedConsoleOutput();
    expect(output.length).toBeGreaterThan(0);
    output.forEach(line => {
        expect(line).not.toContain(apiKey);
        expect(line).not.toContain('Bearer ');
    });
};

beforeEach(() => {
    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    axios.mockReset();
});

afterEach(() => {
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
});

describe('SynexusApiClient — la llamada a axios (CONN-01, CONN-02, CONN-03)', () => {
    let requestBody;
    let synexusConfig;
    let axiosCallArgument;

    beforeEach(async () => {
        axios.mockResolvedValue(fakes.createAxiosResponse(200, { total_tax: '0.00' }));
        requestBody = createRequestBody();
        synexusConfig = createSynexusConfigDouble();

        const client = new SynexusApiClient(synexusConfig, fakes.createFakeLogger());
        await client.makeRequest('get_tax', requestBody, entityCode);
        axiosCallArgument = axios.mock.calls[0][0];
    });

    it('invoca axios exactamente una vez, con un solo objeto de configuración', () => {
        expect(axios).toHaveBeenCalledTimes(1);
        expect(axios.mock.calls[0]).toHaveLength(1);
    });

    it('usa el método POST (CONN-01)', () => {
        expect(axiosCallArgument.method).toBe('POST');
    });

    it('manda en `data` el cuerpo recibido, sin transformarlo: el cliente no construye nada', () => {
        expect(axiosCallArgument.data).toBe(requestBody);
        expect(axiosCallArgument.data).toEqual(createRequestBody());
    });

    it('usa exactamente la URL que devolvió getCalculationUrl(), sin alterarla', () => {
        expect(synexusConfig.getCalculationUrl).toHaveBeenCalledTimes(1);
        expect(axiosCallArgument.url).toBe(calculationUrl);
    });

    it('la URL no lleva credencial: ni code=, ni key=, ni token=, ni la llave (CONN-02)', () => {
        expect(axiosCallArgument.url).not.toContain('code=');
        expect(axiosCallArgument.url).not.toContain('key=');
        expect(axiosCallArgument.url).not.toContain('token=');
        expect(axiosCallArgument.url).not.toContain(apiKey);
        expect(axiosCallArgument.url).not.toContain(apiKey.slice(-8));
        expect(axiosCallArgument.url).not.toContain('synexus_test_');
        expect(axiosCallArgument.url).not.toContain('?');
    });

    it('autentica con el header Authorization: la palabra Bearer, un espacio y la llave (CONN-02)', () => {
        expect(synexusConfig.getApiKey).toHaveBeenCalled();
        expect(axiosCallArgument.headers.Authorization).toBe(`Bearer ${apiKey}`);
    });

    it('manda el código de entidad recibido como tercer argumento en el header X-Synexus-Entity (CONN-03)', () => {
        expect(axiosCallArgument.headers['X-Synexus-Entity']).toBe(entityCode);
    });

    it('NO manda el header de la marca anterior, X-Syntax-Entity', () => {
        expect(axiosCallArgument.headers).not.toHaveProperty('X-Syntax-Entity');
        expect(Object.keys(axiosCallArgument.headers)).not.toContain('X-Syntax-Entity');
    });

    it('declara Content-Type application/json', () => {
        expect(axiosCallArgument.headers['Content-Type']).toBe('application/json');
    });

    it('manda exactamente tres headers: ninguno de idempotencia ni de otra cosa', () => {
        // toEqual sobre el objeto completo: la llave de idempotencia viaja en el
        // cuerpo (request_id); un header inventado para eso rompe esta prueba.
        expect(axiosCallArgument.headers).toEqual({
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
            'X-Synexus-Entity': entityCode
        });
    });

    it('usa un timeout de 30000 ms, el mismo que v1', () => {
        expect(axiosCallArgument.timeout).toBe(30000);
    });

    it('validateStatus acepta 499 (los 4xx se manejan manualmente)', () => {
        expect(axiosCallArgument.validateStatus(499)).toBe(true);
    });

    it('validateStatus rechaza 500 (los 5xx los lanza axios)', () => {
        expect(axiosCallArgument.validateStatus(500)).toBe(false);
    });

    it('el nombre del header de entidad es una propiedad de instancia, sustituible desde una prueba', () => {
        const client = new SynexusApiClient(synexusConfig, fakes.createFakeLogger());
        expect(client.entityHeaderName).toBe('X-Synexus-Entity');
    });
});

describe('SynexusApiClient — el endpoint por operación (OPER-03)', () => {
    // La URL sale de SynexusConfig según la operación (CONN-04): el cliente no
    // compone rutas ni conoce la cadena invoices/cancel. Mandar una
    // cancelación a la ruta de cálculo (o al revés) confundiría al proveedor
    // con un cuerpo válido para otra cosa; por eso no hay rama por omisión.
    it('cancel_tax llama a axios con la URL de cancelación: getCancelUrl una vez y getCalculationUrl ninguna', async () => {
        axios.mockResolvedValue(fakes.createAxiosResponse(200, { message: 'Invoice cancelled' }));
        const synexusConfig = createSynexusConfigDouble();
        const client = new SynexusApiClient(synexusConfig, fakes.createFakeLogger());

        await client.makeRequest('cancel_tax', createCancelBody(), entityCode);

        expect(axios).toHaveBeenCalledTimes(1);
        expect(axios.mock.calls[0][0].url).toBe(cancelUrl);
        expect(synexusConfig.getCancelUrl).toHaveBeenCalledTimes(1);
        expect(synexusConfig.getCalculationUrl).not.toHaveBeenCalled();
    });

    it('get_tax va a la URL de cálculo y no consulta getCancelUrl', async () => {
        axios.mockResolvedValue(fakes.createAxiosResponse(200, { total_tax: '0.00' }));
        const synexusConfig = createSynexusConfigDouble();
        const client = new SynexusApiClient(synexusConfig, fakes.createFakeLogger());

        await client.makeRequest('get_tax', createRequestBody(), entityCode);

        expect(axios.mock.calls[0][0].url).toBe(calculationUrl);
        expect(synexusConfig.getCalculationUrl).toHaveBeenCalledTimes(1);
        expect(synexusConfig.getCancelUrl).not.toHaveBeenCalled();
    });

    it('post_tax va a la MISMA URL de cálculo que get_tax y no consulta getCancelUrl', async () => {
        axios.mockResolvedValue(fakes.createAxiosResponse(200, { total_tax: '0.00' }));
        const synexusConfig = createSynexusConfigDouble();
        const client = new SynexusApiClient(synexusConfig, fakes.createFakeLogger());

        await client.makeRequest('post_tax', createRequestBody(), entityCode);

        expect(axios.mock.calls[0][0].url).toBe(calculationUrl);
        expect(synexusConfig.getCalculationUrl).toHaveBeenCalledTimes(1);
        expect(synexusConfig.getCancelUrl).not.toHaveBeenCalled();
    });

    it('una operación desconocida lanza en español nombrándola ANTES de llamar a axios, con el trío', async () => {
        const logger = fakes.createFakeLogger();
        const synexusConfig = createSynexusConfigDouble();
        const client = new SynexusApiClient(synexusConfig, logger);

        let caught = null;
        try {
            await client.makeRequest('lo_que_sea', createRequestBody(), entityCode);
        } catch (error) {
            caught = error;
        }

        expect(caught).not.toBeNull();
        expect(caught.message).toContain('"lo_que_sea"');
        expect(caught.message).toContain('endpoint');
        expect(caught.message).toContain('contrato v2');
        expect(axios).not.toHaveBeenCalled();
        expect(synexusConfig.getCalculationUrl).not.toHaveBeenCalled();
        expect(synexusConfig.getCancelUrl).not.toHaveBeenCalled();
        expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
        expect(consoleErrorSpy).toHaveBeenCalledWith(caught.message);
        expect(logger.error).toHaveBeenCalledTimes(1);
        expect(logger.error.mock.calls[0][0]).toContain('lo_que_sea');
    });

    describe('la cancelación viaja con el mismo molde que el cálculo', () => {
        let cancelBody;
        let axiosCallArgument;

        beforeEach(async () => {
            axios.mockResolvedValue(fakes.createAxiosResponse(200, { message: 'Invoice cancelled' }));
            cancelBody = createCancelBody();
            const client = new SynexusApiClient(createSynexusConfigDouble(), fakes.createFakeLogger());
            await client.makeRequest('cancel_tax', cancelBody, entityCode);
            axiosCallArgument = axios.mock.calls[0][0];
        });

        it('método POST', () => {
            expect(axiosCallArgument.method).toBe('POST');
        });

        it('exactamente los tres headers de siempre: Content-Type, Authorization: Bearer y X-Synexus-Entity', () => {
            expect(axiosCallArgument.headers).toEqual({
                'Content-Type': 'application/json',
                Authorization: `Bearer ${apiKey}`,
                'X-Synexus-Entity': entityCode
            });
        });

        it('data es el cuerpo recibido por identidad: el cliente no proyecta ni añade nada', () => {
            expect(axiosCallArgument.data).toBe(cancelBody);
            expect(axiosCallArgument.data).toEqual({ invoice_id: 'DEMO-001', customer_id: 'CUST-1' });
        });

        it('timeout 30000 ms', () => {
            expect(axiosCallArgument.timeout).toBe(30000);
        });

        it('la traza nombra la operación en mayúsculas y la URL de cancelación', () => {
            expect(consoleLogSpy).toHaveBeenCalledWith(`Realizando petición CANCEL_TAX a: ${cancelUrl}`);
        });
    });
});

describe('SynexusApiClient — trazas de la petición', () => {
    it('imprime la traza de la petición con el formato de v1: la URL, que en v2 no lleva credencial', async () => {
        axios.mockResolvedValue(fakes.createAxiosResponse(200, { total_tax: '0.00' }));
        const client = new SynexusApiClient(createSynexusConfigDouble(), fakes.createFakeLogger());

        await client.makeRequest('get_tax', createRequestBody(), entityCode);

        expect(consoleLogSpy).toHaveBeenCalledWith(`Realizando petición GET_TAX a: ${calculationUrl}`);
    });

    it('NO imprime el cuerpo: la rama v2 del CLI ya lo imprimió y duplicarlo ensucia la salida', async () => {
        axios.mockResolvedValue(fakes.createAxiosResponse(200, { total_tax: '0.00' }));
        const client = new SynexusApiClient(createSynexusConfigDouble(), fakes.createFakeLogger());

        await client.makeRequest('get_tax', createRequestBody(), entityCode);

        const bodyTraces = consoleLogSpy.mock.calls
            .filter(call => typeof call[0] === 'string' && call[0].startsWith('Enviando datos'));
        expect(bodyTraces).toHaveLength(0);
    });

    it('nunca imprime el objeto headers ni el nombre del header de entidad', async () => {
        axios.mockResolvedValue(fakes.createAxiosResponse(200, { total_tax: '0.00' }));
        const client = new SynexusApiClient(createSynexusConfigDouble(), fakes.createFakeLogger());

        await client.makeRequest('get_tax', createRequestBody(), entityCode);

        capturedConsoleOutput().forEach(line => {
            expect(line).not.toContain('X-Synexus-Entity');
            expect(line).not.toContain('Authorization');
        });
    });
});

describe('SynexusApiClient — manejo de la respuesta (_handleResponse)', () => {
    it('con 200 devuelve response.data tal cual, sin transformarlo', async () => {
        const providerBody = { id: 'txn_1', total_tax: '0.00', lines: [{ item_id: 'SKU-1', tax: '0.00' }] };
        axios.mockResolvedValue(fakes.createAxiosResponse(200, providerBody));
        const client = new SynexusApiClient(createSynexusConfigDouble(), fakes.createFakeLogger());

        const result = await client.makeRequest('get_tax', createRequestBody(), entityCode);

        expect(result).toBe(providerBody);
        expect(consoleLogSpy).toHaveBeenCalledWith('Respuesta recibida - Status: 200 OK');
        // La línea de éxito lleva SIEMPRE el identificador del proveedor; este
        // cuerpo no trae meta.request_id ni la respuesta trae X-Request-Id, y
        // eso también se dice (SAFE-06).
        expect(consoleLogSpy).toHaveBeenCalledWith('SUCCESS: get_tax - Status: 200 - request_id=no informado por el proveedor');
    });

    it('con 400 lanza con un mensaje que empieza por "Error HTTP 400: " y registra en el logger', async () => {
        const logger = fakes.createFakeLogger();
        axios.mockResolvedValue(fakes.createAxiosResponse(400, { error: 'tax_code_missing' }));
        const client = new SynexusApiClient(createSynexusConfigDouble(), logger);

        let caught = null;
        try {
            await client.makeRequest('get_tax', createRequestBody(), entityCode);
        } catch (error) {
            caught = error;
        }

        expect(caught).not.toBeNull();
        expect(caught.message.startsWith('Error HTTP 400: ')).toBe(true);
        // Ese cuerpo no trae `code`, así que sigue el molde de v1 (cuerpo
        // serializado) más el identificador del proveedor, que aquí no vino
        // por ninguna vía (SAFE-06).
        expect(caught.message).toBe('Error HTTP 400: {"error":"tax_code_missing"} - request_id=no informado por el proveedor');
        // Misma estructura que el molde de v1: el throw de _handleResponse cae en
        // el catch de makeRequest, que además pasa por _handleError. Por eso el
        // logger recibe dos entradas; la primera es la de _handleResponse.
        expect(logger.error).toHaveBeenCalled();
        expect(logger.error.mock.calls[0][0]).toContain('Error HTTP 400');
        expect(logger.error.mock.calls[0][0]).toContain('Operation: get_tax');
        expect(consoleErrorSpy).toHaveBeenCalledWith('Error HTTP 400: {"error":"tax_code_missing"} - request_id=no informado por el proveedor');
    });

    it('con 422 (dentro del corte de validateStatus) también lanza con el prefijo Error HTTP', async () => {
        axios.mockResolvedValue(fakes.createAxiosResponse(422, { error: 'tax_code_missing', detail: 'cart[0]' }));
        const client = new SynexusApiClient(createSynexusConfigDouble(), fakes.createFakeLogger());

        await expect(client.makeRequest('get_tax', createRequestBody(), entityCode))
            .rejects.toThrow('Error HTTP 422: ');
    });
});

describe('SynexusApiClient — errores de transporte (_handleError)', () => {
    /**
     * Ejecuta makeRequest con axios rechazando `error` y devuelve el error atrapado.
     * @param {Error} error - Lo que axios rechazará
     * @param {Object} [logger] - Doble del logger
     * @returns {Promise<Error>}
     */
    const runWithRejection = async (error, logger) => {
        axios.mockRejectedValue(error);
        const client = new SynexusApiClient(createSynexusConfigDouble(), logger || fakes.createFakeLogger());

        let caught = null;
        try {
            await client.makeRequest('get_tax', createRequestBody(), entityCode);
        } catch (thrown) {
            caught = thrown;
        }
        return caught;
    };

    /**
     * Toda la salida de consola sin las menciones a SYNEXUS_BASE_URL: lo que
     * quede no debe contener BASE_URL a secas, que es la variable de v1.
     * @returns {string[]}
     */
    const outputWithoutV2Variable = () => {
        return capturedConsoleOutput().map(line => line.split('SYNEXUS_BASE_URL').join(''));
    };

    it('re-lanza el error original sin envolverlo', async () => {
        const error = createAxiosError({ code: 'ECONNREFUSED', request: {} });

        const caught = await runWithRejection(error);

        expect(caught).toBe(error);
    });

    it('ECONNREFUSED: diagnóstico en español que cita SYNEXUS_BASE_URL y nunca BASE_URL', async () => {
        const logger = fakes.createFakeLogger();

        await runWithRejection(createAxiosError({ code: 'ECONNREFUSED', request: {} }), logger);

        expect(consoleErrorSpy).toHaveBeenCalledWith(
            'Error en la petición: Conexión rechazada. El servidor no está disponible o la URL es incorrecta.'
        );
        expect(consoleErrorSpy).toHaveBeenCalledWith(`URL intentada: ${calculationUrl}`);
        expect(consoleErrorSpy).toHaveBeenCalledWith('2. La SYNEXUS_BASE_URL en .env sea correcta');
        outputWithoutV2Variable().forEach(line => {
            expect(line).not.toContain('BASE_URL');
        });
        expect(logger.error).toHaveBeenCalledTimes(1);
        expect(logger.error.mock.calls[0][0]).toContain('Conexión rechazada');
        expect(logger.error.mock.calls[0][0]).toContain('Operation: get_tax');
        expect(logger.error.mock.calls[0][0]).toContain(`URL: ${calculationUrl}`);
    });

    it('ECONNABORTED: diagnóstico de timeout en español', async () => {
        await runWithRejection(createAxiosError({ code: 'ECONNABORTED', request: {} }));

        expect(consoleErrorSpy).toHaveBeenCalledWith(
            'Error en la petición: Timeout de conexión. La petición tardó más de 30 segundos.'
        );
        outputWithoutV2Variable().forEach(line => {
            expect(line).not.toContain('BASE_URL');
        });
    });

    it('ENOTFOUND: diagnóstico en español que cita SYNEXUS_BASE_URL y nunca BASE_URL', async () => {
        await runWithRejection(createAxiosError({ code: 'ENOTFOUND', request: {} }));

        expect(consoleErrorSpy).toHaveBeenCalledWith(
            'Error en la petición: Servidor no encontrado. Verifique la URL en SYNEXUS_BASE_URL.'
        );
        expect(consoleErrorSpy).toHaveBeenCalledWith(`URL: ${calculationUrl}`);
        outputWithoutV2Variable().forEach(line => {
            expect(line).not.toContain('BASE_URL');
        });
    });

    it('5xx (axios lo lanza por validateStatus): cita el status y serializa sólo el cuerpo de la respuesta', async () => {
        const error = createAxiosError({
            response: { status: 503, statusText: 'Service Unavailable', data: { error: 'upstream_unavailable' } }
        });

        await runWithRejection(error);

        expect(consoleErrorSpy).toHaveBeenCalledWith('Error en la petición: HTTP 503');
        expect(consoleErrorSpy).toHaveBeenCalledWith(
            'Mensaje del servidor:',
            JSON.stringify({ error: 'upstream_unavailable' }, null, 2)
        );
    });

    it('sin respuesta (error.request presente, sin código conocido): diagnóstico de conectividad', async () => {
        await runWithRejection(createAxiosError({ request: {} }));

        expect(consoleErrorSpy).toHaveBeenCalledWith(
            'Error en la petición: No se recibió respuesta del servidor (problema de conectividad)'
        );
    });

    it('cualquier otro error: cita error.message', async () => {
        await runWithRejection(createAxiosError({ message: 'algo inesperado' }));

        expect(consoleErrorSpy).toHaveBeenCalledWith('Error en la petición: algo inesperado');
    });

    it('siempre cierra con el bloque de diagnóstico: operación, URL y marca de tiempo', async () => {
        await runWithRejection(createAxiosError({ code: 'ECONNREFUSED', request: {} }));

        expect(consoleErrorSpy).toHaveBeenCalledWith('\n--- Información de diagnóstico ---');
        expect(consoleErrorSpy).toHaveBeenCalledWith('Operación: get_tax');
        expect(consoleErrorSpy).toHaveBeenCalledWith(`URL: ${calculationUrl}`);
        const timestampLine = consoleErrorSpy.mock.calls
            .find(call => typeof call[0] === 'string' && call[0].startsWith('Timestamp: '));
        expect(timestampLine).toBeDefined();
        expect(timestampLine[0]).toMatch(/^Timestamp: \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    });
});

describe('SynexusApiClient — la llave nunca sale por consola (CFG-05)', () => {
    it('en una respuesta exitosa', async () => {
        axios.mockResolvedValue(fakes.createAxiosResponse(200, { total_tax: '0.00' }));
        const client = new SynexusApiClient(createSynexusConfigDouble(), fakes.createFakeLogger());

        await client.makeRequest('get_tax', createRequestBody(), entityCode);

        expectNoCredentialLeak();
    });

    it('en una respuesta 400', async () => {
        axios.mockResolvedValue(fakes.createAxiosResponse(400, { error: 'bad_request' }));
        const client = new SynexusApiClient(createSynexusConfigDouble(), fakes.createFakeLogger());

        await expect(client.makeRequest('get_tax', createRequestBody(), entityCode)).rejects.toThrow();

        expectNoCredentialLeak();
    });

    it('en un error de transporte cuyo objeto trae config.headers.Authorization poblado, como los de axios', async () => {
        const error = createAxiosError({ code: 'ECONNREFUSED', request: {} });
        expect(error.config.headers.Authorization).toContain(apiKey);
        axios.mockRejectedValue(error);
        const client = new SynexusApiClient(createSynexusConfigDouble(), fakes.createFakeLogger());

        await expect(client.makeRequest('get_tax', createRequestBody(), entityCode)).rejects.toBe(error);

        expectNoCredentialLeak();
    });

    it('en un error 5xx con respuesta del servidor y config.headers.Authorization poblado', async () => {
        const error = createAxiosError({
            response: { status: 500, statusText: 'Internal Server Error', data: { error: 'boom' } }
        });
        axios.mockRejectedValue(error);
        const client = new SynexusApiClient(createSynexusConfigDouble(), fakes.createFakeLogger());

        await expect(client.makeRequest('get_tax', createRequestBody(), entityCode)).rejects.toBe(error);

        expectNoCredentialLeak();
    });

    it('en un error genérico sin código ni respuesta, con config.headers.Authorization poblado', async () => {
        const error = createAxiosError({ message: 'fallo genérico' });
        axios.mockRejectedValue(error);
        const client = new SynexusApiClient(createSynexusConfigDouble(), fakes.createFakeLogger());

        await expect(client.makeRequest('get_tax', createRequestBody(), entityCode)).rejects.toBe(error);

        expectNoCredentialLeak();
    });

    it('tampoco llega al logger en ninguno de los caminos de error', async () => {
        const logger = fakes.createFakeLogger();
        const error = createAxiosError({ code: 'ECONNREFUSED', request: {} });
        axios.mockRejectedValue(error);
        const client = new SynexusApiClient(createSynexusConfigDouble(), logger);

        await expect(client.makeRequest('get_tax', createRequestBody(), entityCode)).rejects.toBe(error);

        expect(logger.error).toHaveBeenCalled();
        logger.error.mock.calls.forEach(call => {
            call.forEach(arg => {
                const text = typeof arg === 'string' ? arg : JSON.stringify(arg);
                expect(text).not.toContain(apiKey);
            });
        });
    });
});

describe('SynexusApiClient — SAFE-06: el identificador de petición del proveedor se registra en toda corrida', () => {
    // Es lo que el proveedor pide para levantar soporte. Llega por tres vías:
    // meta.request_id en el cuerpo de ÉXITO del cálculo, request_id en el
    // cuerpo de ERROR del cálculo, y el header X-Request-Id —que axios entrega
    // en minúsculas— en todos los endpoints, también la cancelación. Se
    // prefiere el cuerpo. Cuando el proveedor NO respondió, lo único
    // correlacionable es la llave que nexgen generó en el cuerpo del cálculo;
    // la cancelación no lleva ninguna, y eso también se dice.
    const noProviderId = 'no informado por el proveedor';
    const ownRequestId = '11111111-1111-4111-8111-111111111111';

    /**
     * Ejecuta makeRequest con axios RESOLVIENDO `response` y devuelve el error
     * atrapado, o null si resolvió.
     * @param {string} operation - Operación
     * @param {Object} response - Lo que axios resolverá
     * @param {Object} [logger] - Doble del logger
     * @param {Object} [body] - Cuerpo a enviar (por omisión, el del cálculo)
     * @returns {Promise<Error|null>}
     */
    const runResolved = async (operation, response, logger, body) => {
        axios.mockResolvedValue(response);
        const client = new SynexusApiClient(createSynexusConfigDouble(), logger || fakes.createFakeLogger());
        try {
            await client.makeRequest(operation, body || createRequestBody(), entityCode);
            return null;
        } catch (error) {
            return error;
        }
    };

    /**
     * Ejecuta makeRequest con axios RECHAZANDO `error` y devuelve el error atrapado.
     * @param {string} operation - Operación
     * @param {Error} error - Lo que axios rechazará
     * @param {Object} [logger] - Doble del logger
     * @param {Object} [body] - Cuerpo a enviar (por omisión, el del cálculo)
     * @returns {Promise<Error|null>}
     */
    const runRejected = async (operation, error, logger, body) => {
        axios.mockRejectedValue(error);
        const client = new SynexusApiClient(createSynexusConfigDouble(), logger || fakes.createFakeLogger());
        try {
            await client.makeRequest(operation, body || createRequestBody(), entityCode);
            return null;
        } catch (thrown) {
            return thrown;
        }
    };

    /**
     * La línea "Identificador para soporte: …" del bloque de diagnóstico de
     * _handleError, o undefined si no se imprimió.
     * @returns {string|undefined}
     */
    const supportLine = () => {
        const call = consoleErrorSpy.mock.calls
            .find(call => typeof call[0] === 'string' && call[0].startsWith('Identificador para soporte: '));
        return call ? call[0] : undefined;
    };

    /**
     * Todo lo que recibió el logger, argumento por argumento, como cadenas.
     * @param {Object} logger - Doble del logger
     * @returns {string[]}
     */
    const loggerOutput = (logger) => {
        return logger.error.mock.calls
            .reduce((all, call) => all.concat(call), [])
            .map(arg => (typeof arg === 'string' ? arg : JSON.stringify(arg)));
    };

    /**
     * La llave no está en stdout, ni en stderr, ni en el mensaje lanzado, ni
     * en el logger. Es expectNoCredentialLeak extendida a las dos vías que
     * este plan añade (el mensaje con id y la nota de soporte).
     * @param {Error} caught - El error atrapado
     * @param {Object} logger - Doble del logger
     */
    const expectNoLeakAnywhere = (caught, logger) => {
        expectNoCredentialLeak();
        expect(caught.message).not.toContain(apiKey);
        expect(caught.message).not.toContain('Bearer ');
        const logged = loggerOutput(logger);
        expect(logged.length).toBeGreaterThan(0);
        logged.forEach(line => {
            expect(line).not.toContain(apiKey);
            expect(line).not.toContain('Bearer ');
            expect(line).not.toContain('Authorization');
        });
    };

    describe('en la línea de éxito', () => {
        it('con meta.request_id en el cuerpo Y X-Request-Id en el header, la línea lleva el del cuerpo: se prefiere el cuerpo', async () => {
            const response = fakes.createAxiosResponse(
                200,
                { total_tax: '0.00', meta: { request_id: 'rid-body' } },
                { 'x-request-id': 'rid-header' }
            );

            const caught = await runResolved('get_tax', response);

            expect(caught).toBeNull();
            expect(consoleLogSpy).toHaveBeenCalledWith('SUCCESS: get_tax - Status: 200 - request_id=rid-body');
            capturedConsoleOutput().forEach(line => {
                expect(line).not.toContain('rid-header');
            });
        });

        it('sólo con el header x-request-id (como lo entrega axios, en minúsculas), la línea lleva el header', async () => {
            const response = fakes.createAxiosResponse(200, { total_tax: '0.00' }, { 'x-request-id': 'rid-header' });

            await runResolved('get_tax', response);

            expect(consoleLogSpy).toHaveBeenCalledWith('SUCCESS: get_tax - Status: 200 - request_id=rid-header');
        });

        it('sin meta.request_id ni header, la línea lo dice: request_id=no informado por el proveedor', async () => {
            await runResolved('get_tax', fakes.createAxiosResponse(200, { total_tax: '0.00' }));

            expect(consoleLogSpy).toHaveBeenCalledWith(`SUCCESS: get_tax - Status: 200 - request_id=${noProviderId}`);
        });

        it('post_tax también: misma línea con su operación y el id del cuerpo', async () => {
            const response = fakes.createAxiosResponse(200, { total_tax: '1.00', meta: { request_id: 'rid-post' } });

            await runResolved('post_tax', response);

            expect(consoleLogSpy).toHaveBeenCalledWith('SUCCESS: post_tax - Status: 200 - request_id=rid-post');
        });

        it('cancel_tax con header: la cancelación no trae meta en el cuerpo, así que la línea lleva el header', async () => {
            const response = fakes.createAxiosResponse(
                200,
                { message: 'Invoice cancelled', updated_invoices: 1 },
                { 'x-request-id': 'rid-cancel' }
            );

            await runResolved('cancel_tax', response, undefined, createCancelBody());

            expect(consoleLogSpy).toHaveBeenCalledWith('SUCCESS: cancel_tax - Status: 200 - request_id=rid-cancel');
        });

        it('un meta.request_id vacío no cuenta: cae al header', async () => {
            const response = fakes.createAxiosResponse(
                200,
                { total_tax: '0.00', meta: { request_id: '' } },
                { 'x-request-id': 'rid-header' }
            );

            await runResolved('get_tax', response);

            expect(consoleLogSpy).toHaveBeenCalledWith('SUCCESS: get_tax - Status: 200 - request_id=rid-header');
        });

        it('leer el identificador no transforma la respuesta: el resultado sigue siendo response.data por identidad, con su meta', async () => {
            const providerBody = { total_tax: '0.00', meta: { request_id: 'rid-body' } };
            axios.mockResolvedValue(fakes.createAxiosResponse(200, providerBody, { 'x-request-id': 'rid-header' }));
            const client = new SynexusApiClient(createSynexusConfigDouble(), fakes.createFakeLogger());

            const result = await client.makeRequest('get_tax', createRequestBody(), entityCode);

            expect(result).toBe(providerBody);
            expect(result.meta).toEqual({ request_id: 'rid-body' });
        });
    });

    describe('en un error con respuesta del proveedor (4xx, resuelto dentro del corte de validateStatus)', () => {
        it('422 con request_id en el cuerpo de error: el mensaje lanzado y la primera entrada del logger llevan request_id=rid-err', async () => {
            const logger = fakes.createFakeLogger();
            const response = fakes.createAxiosResponse(422, { error: 'unprocessable', request_id: 'rid-err' });

            const caught = await runResolved('get_tax', response, logger);

            expect(caught).not.toBeNull();
            expect(caught.message.startsWith('Error HTTP 422')).toBe(true);
            expect(caught.message).toContain('request_id=rid-err');
            expect(logger.error.mock.calls[0][0]).toContain('request_id=rid-err');
            expect(logger.error.mock.calls[0][0]).toContain('Operation: get_tax');
        });

        it('422 sólo con el header x-request-id: el mensaje lanzado y el log llevan ese valor', async () => {
            const logger = fakes.createFakeLogger();
            const response = fakes.createAxiosResponse(422, { error: 'unprocessable' }, { 'x-request-id': 'rid-h422' });

            const caught = await runResolved('get_tax', response, logger);

            expect(caught).not.toBeNull();
            expect(caught.message).toContain('request_id=rid-h422');
            expect(logger.error.mock.calls[0][0]).toContain('request_id=rid-h422');
        });

        it('422 con request_id en el cuerpo Y en el header: gana el cuerpo, también en el error', async () => {
            const response = fakes.createAxiosResponse(422, { error: 'x', request_id: 'rid-err' }, { 'x-request-id': 'rid-h422' });

            const caught = await runResolved('get_tax', response);

            expect(caught.message).toContain('request_id=rid-err');
            expect(caught.message).not.toContain('rid-h422');
        });

        it('la nota de soporte de _handleError dice (del proveedor) con el MISMO id y NUNCA "generado por nexgen": el proveedor sí respondió', async () => {
            const logger = fakes.createFakeLogger();
            const response = fakes.createAxiosResponse(422, { error: 'x', request_id: 'rid-err' });

            await runResolved('get_tax', response, logger);

            const line = supportLine();
            expect(line).toBeDefined();
            expect(line).toBe('Identificador para soporte: request_id=rid-err (del proveedor)');
            expect(line).not.toContain('generado por nexgen');
            expect(line).not.toContain(ownRequestId);
            // La segunda entrada del logger es la de _handleError (molde de v1:
            // el throw de _handleResponse cae en el catch de makeRequest).
            expect(logger.error).toHaveBeenCalledTimes(2);
            expect(logger.error.mock.calls[1][0]).toContain('request_id=rid-err (del proveedor)');
            expect(logger.error.mock.calls[1][0]).not.toContain('generado por nexgen');
        });

        it('la nota de soporte se imprime dentro del bloque de diagnóstico, después de la marca de tiempo', async () => {
            await runResolved('get_tax', fakes.createAxiosResponse(422, { error: 'x', request_id: 'rid-err' }));

            const lines = consoleErrorSpy.mock.calls.map(call => call[0]);
            const headerIndex = lines.indexOf('\n--- Información de diagnóstico ---');
            const timestampIndex = lines.findIndex(line => typeof line === 'string' && line.startsWith('Timestamp: '));
            const supportIndex = lines.findIndex(line => typeof line === 'string' && line.startsWith('Identificador para soporte: '));
            expect(headerIndex).toBeGreaterThanOrEqual(0);
            expect(timestampIndex).toBeGreaterThan(headerIndex);
            expect(supportIndex).toBeGreaterThan(timestampIndex);
        });

        it('4xx sin id por ninguna vía: mensaje y nota dicen "no informado por el proveedor", y la nota sigue siendo (del proveedor)', async () => {
            const logger = fakes.createFakeLogger();

            const caught = await runResolved('get_tax', fakes.createAxiosResponse(400, { error: 'bad_request' }), logger);

            expect(caught.message).toContain(`request_id=${noProviderId}`);
            expect(supportLine()).toBe(`Identificador para soporte: request_id=${noProviderId} (del proveedor)`);
            expect(logger.error.mock.calls[1][0]).toContain(`request_id=${noProviderId} (del proveedor)`);
        });

        it('el Error lanzado va marcado para el resto del proceso: providerResponded true y providerRequestId con el id', async () => {
            const caught = await runResolved('get_tax', fakes.createAxiosResponse(422, { error: 'x', request_id: 'rid-err' }));

            expect(caught.providerResponded).toBe(true);
            expect(caught.providerRequestId).toBe('rid-err');
        });

        it('sin id, providerRequestId es null (no una cadena vacía ni el texto "no informado")', async () => {
            const caught = await runResolved('get_tax', fakes.createAxiosResponse(422, { error: 'x' }));

            expect(caught.providerResponded).toBe(true);
            expect(caught.providerRequestId).toBeNull();
        });

        it('cancel_tax con 404 y header: el mensaje lanzado y el log llevan el header (la cancelación no trae request_id en el cuerpo)', async () => {
            const logger = fakes.createFakeLogger();
            const response = fakes.createAxiosResponse(404, { error: 'not_found', message: 'Invoice not found' }, { 'x-request-id': 'rid-c404' });

            const caught = await runResolved('cancel_tax', response, logger, createCancelBody());

            expect(caught).not.toBeNull();
            expect(caught.message).toContain('request_id=rid-c404');
            expect(logger.error.mock.calls[0][0]).toContain('request_id=rid-c404');
            expect(supportLine()).toBe('Identificador para soporte: request_id=rid-c404 (del proveedor)');
        });

        it('docs_url del cuerpo de error va al logger de winston y a NINGUNA línea de consola: apunta a un host que no resuelve', async () => {
            const logger = fakes.createFakeLogger();
            const response = fakes.createAxiosResponse(422, {
                error: 'unprocessable',
                request_id: 'rid-doc',
                docs_url: 'https://docs.invalid/x'
            });

            const caught = await runResolved('get_tax', response, logger);

            expect(caught).not.toBeNull();
            expect(loggerOutput(logger).some(line => line.includes('docs_url: https://docs.invalid/x'))).toBe(true);
            capturedConsoleOutput().forEach(line => {
                expect(line).not.toContain('docs.invalid');
            });
            expect(caught.message).not.toContain('docs.invalid');
        });

        it('una respuesta resuelta que trae la petición en config y request (como las de axios) no filtra la llave: ni consola, ni logger, ni mensaje', async () => {
            const logger = fakes.createFakeLogger();
            const response = fakes.createAxiosResponse(422, { error: 'x', request_id: 'rid-err' }, { 'x-request-id': 'rid-h' });
            response.config = {
                url: calculationUrl,
                headers: { Authorization: `Bearer ${apiKey}`, 'X-Synexus-Entity': entityCode }
            };
            response.request = { _header: `Authorization: Bearer ${apiKey}` };

            const caught = await runResolved('get_tax', response, logger);

            expect(caught).not.toBeNull();
            expectNoLeakAnywhere(caught, logger);
        });
    });

    describe('en un error sin respuesta del proveedor', () => {
        it('ECONNABORTED en el cálculo: la consola y la única entrada del logger llevan el request_id que generó nexgen, marcado como tal', async () => {
            const logger = fakes.createFakeLogger();
            const body = createRequestBody();
            expect(body.request_id).toBe(ownRequestId);
            const error = createAxiosError({ code: 'ECONNABORTED', request: {} });

            const caught = await runRejected('get_tax', error, logger, body);

            expect(caught).toBe(error);
            const line = supportLine();
            expect(line).toBeDefined();
            expect(line).toContain(`Identificador para soporte: request_id=${ownRequestId} (generado por nexgen`);
            expect(line).toContain('el proveedor no respondió');
            expect(line).not.toContain('del proveedor)');
            expect(logger.error).toHaveBeenCalledTimes(1);
            expect(logger.error.mock.calls[0][0]).toContain(ownRequestId);
            expect(logger.error.mock.calls[0][0]).toContain('generado por nexgen');
            expectNoLeakAnywhere(caught, logger);
        });

        it('ECONNREFUSED en el cálculo: misma nota con la llave propia; el mensaje del error original NO se toca (se re-lanza por identidad)', async () => {
            const error = createAxiosError({ code: 'ECONNREFUSED', request: {} });
            const originalMessage = error.message;

            const caught = await runRejected('get_tax', error);

            expect(caught).toBe(error);
            expect(caught.message).toBe(originalMessage);
            expect(caught.message).not.toContain('request_id=');
            expect(supportLine()).toContain(`request_id=${ownRequestId} (generado por nexgen`);
        });

        it('cancel_tax con ECONNREFUSED: la nota dice ninguno, porque la cancelación no lleva llave y el proveedor no respondió', async () => {
            const logger = fakes.createFakeLogger();
            const error = createAxiosError({ code: 'ECONNREFUSED', request: {} });

            const caught = await runRejected('cancel_tax', error, logger, createCancelBody());

            expect(caught).toBe(error);
            expect(supportLine()).toBe(
                'Identificador para soporte: request_id=ninguno (la cancelación no lleva llave y el proveedor no respondió)'
            );
            expect(logger.error).toHaveBeenCalledTimes(1);
            expect(logger.error.mock.calls[0][0]).toContain('request_id=ninguno (la cancelación no lleva llave y el proveedor no respondió)');
            expect(logger.error.mock.calls[0][0]).not.toContain('generado por nexgen');
            expect(logger.error.mock.calls[0][0]).not.toContain('del proveedor)');
        });

        it('un error genérico sin código ni respuesta: también lleva la llave propia del cálculo', async () => {
            const caught = await runRejected('get_tax', createAxiosError({ message: 'algo inesperado' }));

            expect(caught.message).toBe('algo inesperado');
            expect(supportLine()).toContain(`request_id=${ownRequestId} (generado por nexgen`);
        });
    });

    describe('en un error que axios rechaza con respuesta del proveedor (5xx, fuera del corte de validateStatus)', () => {
        it('503 con x-request-id en la respuesta: consola y logger llevan request_id=rid-503 (del proveedor); el error se re-lanza por identidad', async () => {
            const logger = fakes.createFakeLogger();
            const error = createAxiosError({
                response: {
                    status: 503,
                    statusText: 'Service Unavailable',
                    data: { error: 'upstream_unavailable' },
                    headers: { 'x-request-id': 'rid-503' }
                }
            });
            expect(error.config.headers.Authorization).toContain(apiKey);

            const caught = await runRejected('get_tax', error, logger);

            expect(caught).toBe(error);
            expect(supportLine()).toBe('Identificador para soporte: request_id=rid-503 (del proveedor)');
            expect(logger.error).toHaveBeenCalledTimes(1);
            expect(logger.error.mock.calls[0][0]).toContain('request_id=rid-503 (del proveedor)');
            expect(logger.error.mock.calls[0][0]).not.toContain(ownRequestId);
            expectNoLeakAnywhere(caught, logger);
        });

        it('503 con request_id en el cuerpo del error y otro en el header: gana el cuerpo', async () => {
            const error = createAxiosError({
                response: {
                    status: 503,
                    statusText: 'Service Unavailable',
                    data: { error: 'upstream_unavailable', request_id: 'rid-503-body' },
                    headers: { 'x-request-id': 'rid-503-header' }
                }
            });

            await runRejected('get_tax', error);

            expect(supportLine()).toBe('Identificador para soporte: request_id=rid-503-body (del proveedor)');
        });

        it('5xx sin id por ninguna vía y sin headers en el doble: "no informado por el proveedor", sin lanzar por el acceso', async () => {
            const logger = fakes.createFakeLogger();
            const error = createAxiosError({
                response: { status: 502, statusText: 'Bad Gateway', data: 'Bad Gateway' }
            });

            const caught = await runRejected('get_tax', error, logger);

            expect(caught).toBe(error);
            expect(supportLine()).toBe(`Identificador para soporte: request_id=${noProviderId} (del proveedor)`);
            expect(logger.error.mock.calls[0][0]).toContain(`request_id=${noProviderId} (del proveedor)`);
        });
    });
});

describe('SynexusApiClient — envoltorios getTax, postTax y cancelTax', () => {
    it('getTax(requestBody, entityCode) delega en makeRequest con la operación get_tax', async () => {
        axios.mockResolvedValue(fakes.createAxiosResponse(200, { total_tax: '0.00' }));
        const client = new SynexusApiClient(createSynexusConfigDouble(), fakes.createFakeLogger());
        const makeRequestSpy = jest.spyOn(client, 'makeRequest');
        const requestBody = createRequestBody();

        const result = await client.getTax(requestBody, entityCode);

        expect(makeRequestSpy).toHaveBeenCalledTimes(1);
        expect(makeRequestSpy).toHaveBeenCalledWith('get_tax', requestBody, entityCode);
        expect(result).toEqual({ total_tax: '0.00' });
    });

    it('postTax(requestBody, entityCode) delega en makeRequest con la operación post_tax', async () => {
        axios.mockResolvedValue(fakes.createAxiosResponse(200, { total_tax: '0.00' }));
        const client = new SynexusApiClient(createSynexusConfigDouble(), fakes.createFakeLogger());
        const makeRequestSpy = jest.spyOn(client, 'makeRequest');
        const requestBody = createRequestBody();

        const result = await client.postTax(requestBody, entityCode);

        expect(makeRequestSpy).toHaveBeenCalledTimes(1);
        expect(makeRequestSpy).toHaveBeenCalledWith('post_tax', requestBody, entityCode);
        expect(result).toEqual({ total_tax: '0.00' });
    });

    it('cancelTax(requestBody, entityCode) delega en makeRequest con la operación cancel_tax', async () => {
        axios.mockResolvedValue(fakes.createAxiosResponse(200, { message: 'Invoice cancelled' }));
        const client = new SynexusApiClient(createSynexusConfigDouble(), fakes.createFakeLogger());
        const makeRequestSpy = jest.spyOn(client, 'makeRequest');
        const cancelBody = createCancelBody();

        const result = await client.cancelTax(cancelBody, entityCode);

        expect(makeRequestSpy).toHaveBeenCalledTimes(1);
        expect(makeRequestSpy).toHaveBeenCalledWith('cancel_tax', cancelBody, entityCode);
        expect(axios.mock.calls[0][0].url).toBe(cancelUrl);
        expect(result).toEqual({ message: 'Invoice cancelled' });
    });

    it('ofrece los tres envoltorios: getTax, postTax y cancelTax son funciones', () => {
        const client = new SynexusApiClient(createSynexusConfigDouble(), fakes.createFakeLogger());
        expect(typeof client.getTax).toBe('function');
        expect(typeof client.postTax).toBe('function');
        expect(typeof client.cancelTax).toBe('function');
    });
});
