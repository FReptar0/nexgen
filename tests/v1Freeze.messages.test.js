// tests/v1Freeze.messages.test.js
// Congelamiento literal de los mensajes de error del camino v1 y del parseo
// posicional de argumentos del que depende el envoltorio del ERP (COMP-01).
//
// Los mensajes van en español porque así están en el código. Ninguno se
// reescribe: se copian tal cual, y si uno cambia, esta suite falla.
//
// Nota sobre las aserciones: toThrow('cadena') sólo verifica que el mensaje
// CONTENGA la cadena. toThrow(new Error('cadena')) exige igualdad exacta del
// mensaje, que es lo que significa "congelar".
const TaxValidator = require('../src/validators/taxValidator');
const TaxApiClient = require('../src/api/taxApiClient');
const TaxCommandHandler = require('../src/cli/taxCommandHandler');
const fakes = require('./helpers/fakes');

let consoleLogSpy;
let consoleErrorSpy;

beforeEach(() => {
    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
});

describe('v1 congelado — mensajes del validador (src/validators/taxValidator.js)', () => {
    let validator;

    beforeEach(() => {
        validator = new TaxValidator(fakes.createFakeLogger());
    });

    it('validateOperation: operación desconocida', () => {
        expect(() => validator.validateOperation('foo')).toThrow(
            new Error('Operación inválida: "foo". Usa "get_tax", "post_tax" o "cancel_tax".')
        );
    });

    it('validateCommittedField: get_tax exige Committed === false', () => {
        expect(() => validator.validateCommittedField('get_tax', { Committed: true })).toThrow(
            new Error('Para la operación get_tax, el valor "Committed" debe ser false.')
        );
    });

    it('validateCommittedField: post_tax exige Committed === true', () => {
        expect(() => validator.validateCommittedField('post_tax', { Committed: false })).toThrow(
            new Error('Para la operación post_tax, el valor "Committed" debe ser true.')
        );
    });

    it('validateCommittedField: cancel_tax no valida Committed (hueco documentado en el código; se congela igual)', () => {
        expect(() => validator.validateCommittedField('cancel_tax', {})).not.toThrow();
    });

    it('validateRequestBody: cuerpo nulo', () => {
        expect(() => validator.validateRequestBody(null)).toThrow(
            new Error('El cuerpo de la petición no es un objeto válido')
        );
    });
});

describe('v1 congelado — mensaje de error HTTP del cliente (src/api/taxApiClient.js)', () => {
    it('_handleResponse con status 400 lanza "Error HTTP <status>: <cuerpo JSON>"', () => {
        // Es el formato del que dependen los operadores para diagnosticar.
        const client = new TaxApiClient(fakes.createFakeConfig(), fakes.createFakeLogger());
        const response = fakes.createAxiosResponse(400, { error: 'x' });

        expect(() => client._handleResponse(response, 'https://ejemplo-v1.invalid/api/x', 'get_tax')).toThrow(
            new Error('Error HTTP 400: {"error":"x"}')
        );
    });
});

describe('v1 congelado — parseo posicional del CLI (src/cli/taxCommandHandler.js)', () => {
    // Mensaje de uso tal como lo componen las líneas 36-37, con su salto de
    // línea intermedio.
    const usageMessage = 'Uso: node index.js <operacion> <ruta_del_archivo>\n' +
        'Operaciones válidas: "get_tax", "post_tax" o "cancel_tax"';

    let handler;

    beforeEach(() => {
        handler = new TaxCommandHandler(fakes.createFakeConfig(), fakes.createFakeLogger(), {}, {}, {});
    });

    it('sin argumentos lanza el mensaje de uso', () => {
        expect(() => handler.parseArguments([])).toThrow(new Error(usageMessage));
    });

    it('con sólo la operación lanza el mensaje de uso', () => {
        expect(() => handler.parseArguments(['get_tax'])).toThrow(new Error(usageMessage));
    });

    // Las dos propiedades se afirman POR SEPARADO, nunca con toEqual sobre el
    // objeto completo. El plan 02 le agrega propiedades a este objeto de
    // retorno (el selector de contrato); un toEqual estricto convertiría ese
    // cambio legítimo en un falso positivo y empujaría a alguien a relajar la
    // prueba justo donde no debe relajarse. Lo que se congela es que el primer
    // posicional es la operación y el segundo la ruta: eso es lo que el
    // envoltorio del ERP invoca sin flags y debe seguir funcionando igual.
    it('el primer posicional es la operación', () => {
        const parsed = handler.parseArguments(['get_tax', 'archivo.json']);
        expect(parsed.operation).toBe('get_tax');
    });

    it('el segundo posicional es la ruta del archivo', () => {
        const parsed = handler.parseArguments(['get_tax', 'archivo.json']);
        expect(parsed.filePath).toBe('archivo.json');
    });
});

describe('v1 congelado — variables de entorno faltantes (src/config/index.js)', () => {
    // src/config exporta una instancia ya construida, y el constructor lanza
    // al cargarse si faltan variables. Para provocar ese error hay que
    // recargar el módulo en aislamiento. dotenv se sustituye por un doble
    // porque, sin él, un .env real de la máquina repondría BASE_URL y la
    // prueba dejaría de ser determinista.
    const originalBaseUrl = process.env.BASE_URL;
    const originalApiCode = process.env.API_CODE;

    const expectConfigLoadToThrow = (message) => {
        jest.isolateModules(() => {
            jest.doMock('dotenv', () => ({ config: () => ({ parsed: {} }) }));
            expect(() => require('../src/config')).toThrow(new Error(message));
        });
    };

    afterEach(() => {
        process.env.BASE_URL = originalBaseUrl;
        process.env.API_CODE = originalApiCode;
        jest.dontMock('dotenv');
        jest.resetModules();
    });

    it('sin BASE_URL lanza "Variables de entorno faltantes: BASE_URL"', () => {
        delete process.env.BASE_URL;
        expectConfigLoadToThrow('Variables de entorno faltantes: BASE_URL');
    });

    it('con varias faltantes las une con coma y espacio, en el orden BASE_URL, API_CODE, OUTPUT_DIR', () => {
        delete process.env.BASE_URL;
        delete process.env.API_CODE;
        expectConfigLoadToThrow('Variables de entorno faltantes: BASE_URL, API_CODE');
    });
});
