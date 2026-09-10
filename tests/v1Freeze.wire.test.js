// tests/v1Freeze.wire.test.js
// Congelamiento del camino v1 en el cable: método HTTP, URL resuelta y
// mecanismo de autenticación (COMP-01).
//
// Estas pruebas se escribieron leyendo el código TAL COMO ESTÁ HOY, no como
// debería ser. Lo que parezca un defecto (un GET con cuerpo, la credencial en
// la cadena de consulta) se congela igual: corregirlo es otro milestone.
//
// src/api/taxApiClient.js está CONGELADO y no se edita. Como requiere axios en
// el tope del módulo y lo invoca como función (`axios({...})`), el único punto
// de intercepción es jest.mock('axios'): el automock convierte la función
// exportada en un jest.fn() y el argumento se lee de axios.mock.calls[0][0].
jest.mock('axios');

const axios = require('axios');
const TaxApiClient = require('../src/api/taxApiClient');
const fakes = require('./helpers/fakes');

// Nota sobre las aserciones de mensajes: toThrow('cadena') sólo verifica que
// el mensaje CONTENGA la cadena. toThrow(new Error('cadena')) exige igualdad
// exacta del mensaje, que es lo que significa "congelar".

describe('v1 congelado — la llamada a axios (src/api/taxApiClient.js)', () => {
    const resolvedUrl = 'https://ejemplo-v1.invalid/api/STCCalcV3?code=codigo-de-prueba-v1';
    const requestBody = { Committed: false, CartID: 'ABC-123', Lines: [] };

    let consoleLogSpy;
    let consoleErrorSpy;
    let axiosCallArgument;

    beforeEach(async () => {
        consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
        consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

        axios.mockClear();
        axios.mockResolvedValue(fakes.createAxiosResponse(200, { InvoiceTaxAmt: 0 }));

        const config = fakes.createFakeConfig({
            getEndpointUrl: jest.fn(() => resolvedUrl)
        });
        const client = new TaxApiClient(config, fakes.createFakeLogger());

        await client.makeRequest('get_tax', requestBody);
        axiosCallArgument = axios.mock.calls[0][0];
    });

    afterEach(() => {
        consoleLogSpy.mockRestore();
        consoleErrorSpy.mockRestore();
    });

    it('invoca axios exactamente una vez, con un solo objeto de configuración', () => {
        expect(axios).toHaveBeenCalledTimes(1);
        expect(axios.mock.calls[0]).toHaveLength(1);
    });

    it('usa el método GET', () => {
        expect(axiosCallArgument.method).toBe('GET');
    });

    it('envía a axios la URL que resolvió Config, sin alterarla', () => {
        expect(axiosCallArgument.url).toBe(resolvedUrl);
    });

    it('manda el cuerpo en `data` aunque el método sea GET (contrato heredado, se congela a propósito)', () => {
        expect(axiosCallArgument.data).toBe(requestBody);
    });

    it('manda exactamente un header: Content-Type application/json (sin Authorization ni entidad)', () => {
        // toEqual sobre el objeto completo: agregar CUALQUIER header a v1 rompe esta prueba.
        expect(axiosCallArgument.headers).toEqual({ 'Content-Type': 'application/json' });
    });

    it('usa un timeout de 30000 ms', () => {
        expect(axiosCallArgument.timeout).toBe(30000);
    });

    it('validateStatus acepta 499 (los 4xx se manejan manualmente)', () => {
        expect(axiosCallArgument.validateStatus(499)).toBe(true);
    });

    it('validateStatus rechaza 500 (los 5xx los lanza axios)', () => {
        expect(axiosCallArgument.validateStatus(500)).toBe(false);
    });
});

describe('v1 congelado — la URL resuelta (src/config/index.js)', () => {
    // Se usa el Config REAL. Es seguro porque tests/setup.js ya fijó las
    // variables obligatorias antes de este require, y es necesario porque
    // congelar "la URL resuelta" con un doble congelaría el doble, no v1.
    const config = require('../src/config');

    // Valores ficticios fijados en tests/setup.js.
    const baseUrl = 'https://ejemplo-v1.invalid/api/';
    const apiCode = 'codigo-de-prueba-v1';

    const originalTestMode = process.env.TEST_MODE;

    afterEach(() => {
        process.env.TEST_MODE = originalTestMode;
    });

    describe('con TEST_MODE en false', () => {
        beforeEach(() => {
            process.env.TEST_MODE = 'false';
        });

        it('get_tax resuelve a STCCalcV3 con la credencial en la cadena de consulta', () => {
            expect(config.getEndpointUrl('get_tax')).toBe(`${baseUrl}STCCalcV3?code=${apiCode}`);
        });

        it('post_tax resuelve a STCCalcV3 con la credencial en la cadena de consulta', () => {
            expect(config.getEndpointUrl('post_tax')).toBe(`${baseUrl}STCCalcV3?code=${apiCode}`);
        });
    });

    describe('con TEST_MODE en true', () => {
        beforeEach(() => {
            process.env.TEST_MODE = 'true';
        });

        it('get_tax resuelve a STCCalcV3_TEST con la credencial en la cadena de consulta', () => {
            expect(config.getEndpointUrl('get_tax')).toBe(`${baseUrl}STCCalcV3_TEST?code=${apiCode}`);
        });

        it('post_tax resuelve a STCCalcV3_TEST con la credencial en la cadena de consulta', () => {
            expect(config.getEndpointUrl('post_tax')).toBe(`${baseUrl}STCCalcV3_TEST?code=${apiCode}`);
        });
    });

    describe('cancel_tax', () => {
        it('resuelve a CancelTransaction sin importar TEST_MODE', () => {
            process.env.TEST_MODE = 'false';
            expect(config.getEndpointUrl('cancel_tax')).toBe(`${baseUrl}CancelTransaction`);

            process.env.TEST_MODE = 'true';
            expect(config.getEndpointUrl('cancel_tax')).toBe(`${baseUrl}CancelTransaction`);
        });

        it('no lleva credencial: la URL no contiene "code="', () => {
            // Este contraste con get_tax/post_tax es lo que congela el mecanismo
            // de autenticación de v1: credencial en la cadena de consulta, y
            // cancel_tax sin credencial.
            expect(config.getEndpointUrl('cancel_tax')).not.toContain('code=');
        });
    });
});

describe('v1 congelado — operación inválida en Config', () => {
    const config = require('../src/config');

    it('getEndpointUrl lanza "Operación inválida: foo" (sin comillas; el del validador sí las lleva)', () => {
        expect(() => config.getEndpointUrl('foo')).toThrow(new Error('Operación inválida: foo'));
    });
});
