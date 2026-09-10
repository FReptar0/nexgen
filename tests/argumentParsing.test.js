// tests/argumentParsing.test.js
// El selector de contrato (CFG-03) de punta a punta dentro de la capa CLI:
//   1. parseArguments / resolveApiVersion — cómo se leen los flags y por qué
//      una invocación sin flags (la del envoltorio del ERP) cae siempre en v1.
//   2. La ramificación de execute() por contrato, que ocurre ANTES de la
//      validación de v1 y con el TaxValidator real como testigo.
//
// Ningún archivo de prueba requiere index.js (ejecuta main() al cargarse).
// src/config sí se requiere: tests/setup.js ya fijó las variables de v1.
const config = require('../src/config');
const TaxValidator = require('../src/validators/taxValidator');
const TaxCommandHandler = require('../src/cli/taxCommandHandler');
const fakes = require('./helpers/fakes');

const usageMessage = 'Uso: node index.js <operacion> <ruta_del_archivo>\n' +
    'Operaciones válidas: "get_tax", "post_tax" o "cancel_tax"';

let originalTaxApiVersion;
let consoleLogSpy;
let consoleErrorSpy;

beforeEach(() => {
    originalTaxApiVersion = process.env.TAX_API_VERSION;
    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
    if (originalTaxApiVersion === undefined) {
        delete process.env.TAX_API_VERSION;
    } else {
        process.env.TAX_API_VERSION = originalTaxApiVersion;
    }
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
});

describe('Selector de contrato — parseArguments y resolveApiVersion (CFG-03, COMP-01)', () => {
    let handler;
    let logger;

    beforeEach(() => {
        // parseArguments no usa fileManager, validator, apiClient ni synexusConfig.
        // El Config es el real: así getApiVersion se prueba de verdad, no un doble.
        delete process.env.TAX_API_VERSION;
        logger = fakes.createFakeLogger();
        handler = new TaxCommandHandler(config, logger, {}, {}, {}, {});
    });

    it('sin TAX_API_VERSION y sin flags resuelve v1 — es la invocación del envoltorio del ERP', () => {
        const parsed = handler.parseArguments(['get_tax', 'a.json']);
        expect(parsed.apiVersion).toBe('v1');
    });

    it('con TAX_API_VERSION=v2 y sin flags resuelve v2', () => {
        process.env.TAX_API_VERSION = 'v2';
        const parsed = handler.parseArguments(['get_tax', 'a.json']);
        expect(parsed.apiVersion).toBe('v2');
    });

    it.each(['V2', 'true', '', 'v3'])('con TAX_API_VERSION=%j resuelve v1: el selector afirma v2, no niega v1', (value) => {
        process.env.TAX_API_VERSION = value;
        const parsed = handler.parseArguments(['get_tax', 'a.json']);
        expect(parsed.apiVersion).toBe('v1');
    });

    it('--api-version=v2 gana sobre TAX_API_VERSION=v1', () => {
        process.env.TAX_API_VERSION = 'v1';
        const parsed = handler.parseArguments(['get_tax', 'a.json', '--api-version=v2']);
        expect(parsed.apiVersion).toBe('v2');
    });

    it('--api-version=v1 gana sobre TAX_API_VERSION=v2', () => {
        process.env.TAX_API_VERSION = 'v2';
        const parsed = handler.parseArguments(['get_tax', 'a.json', '--api-version=v1']);
        expect(parsed.apiVersion).toBe('v1');
    });

    it.each([
        ['antes de la operación', ['--api-version=v2', 'get_tax', 'a.json']],
        ['entre operación y ruta', ['get_tax', '--api-version=v2', 'a.json']],
        ['después de la ruta', ['get_tax', 'a.json', '--api-version=v2']]
    ])('el flag %s no corre los índices de los posicionales', (_position, args) => {
        const parsed = handler.parseArguments(args);
        expect(parsed.operation).toBe('get_tax');
        expect(parsed.filePath).toBe('a.json');
        expect(parsed.apiVersion).toBe('v2');
    });

    it('con flag y sin ruta lanza el mensaje de uso exacto: los flags se retiran ANTES de contar posicionales', () => {
        expect(() => handler.parseArguments(['get_tax', '--api-version=v2'])).toThrow(new Error(usageMessage));
    });

    it('--entity=USA produce entityCode USA', () => {
        const parsed = handler.parseArguments(['get_tax', 'a.json', '--entity=USA']);
        expect(parsed.entityCode).toBe('USA');
    });

    it('sin --entity el entityCode queda indefinido', () => {
        const parsed = handler.parseArguments(['get_tax', 'a.json']);
        expect(parsed.entityCode).toBeUndefined();
    });

    it('un flag mal escrito (--apiversion=v2) lanza "Argumento no reconocido" en vez de caer en v1 en silencio', () => {
        expect(() => handler.parseArguments(['get_tax', 'a.json', '--apiversion=v2'])).toThrow('Argumento no reconocido');
    });

    it('un flag desconocido se registra con el trío console.error + logger.error + throw', () => {
        expect(() => handler.parseArguments(['get_tax', 'a.json', '--foo=bar'])).toThrow('Argumento no reconocido');
        expect(consoleErrorSpy).toHaveBeenCalled();
        expect(logger.error).toHaveBeenCalled();
    });

    it('--api-version=V2 lanza "Valor inválido", no cae en v1 por omisión', () => {
        expect(() => handler.parseArguments(['get_tax', 'a.json', '--api-version=V2'])).toThrow('Valor inválido');
    });

    it('sin flags, operation y filePath siguen siendo los dos posicionales (COMP-01)', () => {
        const parsed = handler.parseArguments(['get_tax', 'a.json']);
        expect(parsed.operation).toBe('get_tax');
        expect(parsed.filePath).toBe('a.json');
    });

    describe('resolveApiVersion como método estático (index.js lo necesita antes de construir el manejador)', () => {
        it('sin flag devuelve lo que diga config.getApiVersion()', () => {
            const fakeConfig = fakes.createFakeConfig({ getApiVersion: jest.fn(() => 'v2') });
            expect(TaxCommandHandler.resolveApiVersion(['get_tax', 'a.json'], fakeConfig, logger)).toBe('v2');
            expect(fakeConfig.getApiVersion).toHaveBeenCalledTimes(1);
        });

        it('con flag no consulta la configuración: el flag sobreescribe', () => {
            const fakeConfig = fakes.createFakeConfig({ getApiVersion: jest.fn(() => 'v2') });
            expect(TaxCommandHandler.resolveApiVersion(['get_tax', 'a.json', '--api-version=v1'], fakeConfig, logger)).toBe('v1');
            expect(fakeConfig.getApiVersion).not.toHaveBeenCalled();
        });

        it('con valor inválido lanza y registra por logger.error', () => {
            const fakeConfig = fakes.createFakeConfig({ getApiVersion: jest.fn(() => 'v1') });
            expect(() => TaxCommandHandler.resolveApiVersion(['--api-version=beta'], fakeConfig, logger)).toThrow('Valor inválido');
            expect(logger.error).toHaveBeenCalled();
        });
    });
});

describe('Ramificación de execute() por contrato — antes de la validación de v1', () => {
    // Dos casos sostienen este describe. "v1 con cuerpo v2 rechaza con el
    // mensaje de Committed" demuestra que la ramificación temprana NO tocó la
    // secuencia de v1: validate() sigue corriendo y sigue rechazando igual que
    // siempre (COMP-01). "v2 con cuerpo v2 no rechaza con ese mensaje" demuestra
    // que la rama v2 no usa el agregador validate() ni validateCommittedField:
    // un archivo v2 real no trae Committed y esa validación lo tumbaría.
    //
    // El validador es el TaxValidator REAL con espías que dejan pasar la llamada.
    // Con un doble, estos casos serían una tautología sobre el doble.
    const v1CommittedMessage = 'Para la operación get_tax, el valor "Committed" debe ser false.';

    // Cuerpo con forma v2, calcado del ejemplo de postman/synexus-v2-api.postman_collection.json,
    // más entity_id vacío (así lo emite el ERP hoy). Sin Committed, committed,
    // transaction_type ni request_id.
    const createV2Body = () => ({
        invoice_id: 'DEMO-001',
        customer_id: 'CUST-1',
        entity_id: '',
        to_state: 'TX',
        to_zip: '75001',
        cart: [
            { item_id: 'SKU-1', price: 49.99, quantity: 1, tax_code: 'TPP' }
        ]
    });

    // Cuerpo con forma v1: Committed en mayúscula y cualquier otro campo.
    const createV1Body = () => ({
        Committed: false,
        cartID: 'CART-1'
    });

    /**
     * Arma el manejador con los dobles del caso y el validador real espiado.
     * @param {*} requestBody - Lo que readJsonFile devolverá
     * @returns {Object} handler y colaboradores para las aserciones
     */
    const buildHandler = (requestBody) => {
        const validator = new TaxValidator(fakes.createFakeLogger());
        const spies = {
            validate: jest.spyOn(validator, 'validate'),
            validateCommittedField: jest.spyOn(validator, 'validateCommittedField'),
            validateRequestBody: jest.spyOn(validator, 'validateRequestBody'),
            sanitizeStringFields: jest.spyOn(validator, 'sanitizeStringFields')
        };
        const fileManager = {
            exists: () => true,
            readJsonFile: () => requestBody,
            ensureDirectory: jest.fn(),
            getResponseFileName: jest.fn(() => '/tmp/nexgen-tests-output/RESPONSE_a.json'),
            writeJsonFile: jest.fn()
        };
        const apiClient = {
            makeRequest: jest.fn(async () => ({ TotalTax: '0.00' }))
        };
        const synexusConfig = {
            resolveEntityCode: jest.fn(() => 'USA'),
            printProfile: jest.fn()
        };
        // Doble del builder v2 (séptimo colaborador desde el plan 01-03). Aquí sólo
        // deja pasar la rama; lo que hace de verdad se prueba en
        // tests/synexusRequestBuilder.test.js y tests/v2IntentValidation.test.js.
        const requestBuilder = {
            getIntentFor: jest.fn(() => ({ transaction_type: 'sales_estimate', committed: false })),
            buildRequestBody: jest.fn((operation, body) => Object.assign({}, body, {
                transaction_type: 'sales_estimate',
                committed: false,
                request_id: '33333333-3333-4333-8333-333333333333'
            }))
        };
        const fakeConfig = fakes.createFakeConfig({ getApiVersion: jest.fn(() => 'v1') });
        const handler = new TaxCommandHandler(
            fakeConfig,
            fakes.createFakeLogger(),
            fileManager,
            validator,
            apiClient,
            synexusConfig,
            requestBuilder
        );

        return { handler, spies, apiClient, synexusConfig, fileManager, requestBuilder };
    };

    it('bajo v1 con cuerpo v1 conserva la secuencia de siempre: validate una vez y makeRequest con lo que validate devolvió', async () => {
        const body = createV1Body();
        const { handler, spies, apiClient, synexusConfig } = buildHandler(body);

        await handler.execute(['get_tax', 'a.json']);

        expect(spies.validate).toHaveBeenCalledTimes(1);
        expect(spies.validate).toHaveBeenCalledWith('get_tax', body);
        expect(apiClient.makeRequest).toHaveBeenCalledTimes(1);
        expect(apiClient.makeRequest).toHaveBeenCalledWith('get_tax', spies.validate.mock.results[0].value);
        expect(synexusConfig.resolveEntityCode).not.toHaveBeenCalled();
        expect(synexusConfig.printProfile).not.toHaveBeenCalled();
    });

    it('bajo v1 con cuerpo v2 (sin Committed) rechaza con el mensaje literal de v1 y no llama a la API (COMP-01)', async () => {
        const { handler, apiClient } = buildHandler(createV2Body());

        await expect(handler.execute(['get_tax', 'a.json'])).rejects.toThrow(new Error(v1CommittedMessage));
        expect(apiClient.makeRequest).not.toHaveBeenCalled();
    });

    it('bajo v2 con cuerpo v2 no rechaza con el mensaje de v1: validate y validateCommittedField tienen cero llamadas', async () => {
        const { handler, spies, apiClient, synexusConfig } = buildHandler(createV2Body());

        let caught = null;
        try {
            await handler.execute(['get_tax', 'a.json', '--api-version=v2']);
        } catch (error) {
            caught = error;
        }

        expect(caught).not.toBeNull();
        expect(caught.message).not.toBe(v1CommittedMessage);
        expect(spies.validate).not.toHaveBeenCalled();
        expect(spies.validateCommittedField).not.toHaveBeenCalled();
        expect(spies.validateRequestBody).toHaveBeenCalledTimes(1);
        expect(spies.sanitizeStringFields).toHaveBeenCalledTimes(1);
        expect(synexusConfig.resolveEntityCode).toHaveBeenCalledTimes(1);
        expect(synexusConfig.resolveEntityCode).toHaveBeenCalledWith(undefined, spies.sanitizeStringFields.mock.results[0].value);
        expect(synexusConfig.printProfile).toHaveBeenCalledTimes(1);
        expect(synexusConfig.printProfile).toHaveBeenCalledWith('USA');
        expect(synexusConfig.printProfile.mock.invocationCallOrder[0])
            .toBeGreaterThan(synexusConfig.resolveEntityCode.mock.invocationCallOrder[0]);
        expect(apiClient.makeRequest).not.toHaveBeenCalled();
    });

    it('bajo v2 la corrida termina en la guardia de cableado, porque el cliente v2 aún no existe', async () => {
        const { handler } = buildHandler(createV2Body());

        await expect(handler.execute(['get_tax', 'a.json', '--api-version=v2'])).rejects.toThrow('cliente v2');
        await expect(handler.execute(['get_tax', 'a.json', '--api-version=v2'])).rejects.toThrow('index.js');
    });

    it('bajo v2 resolveEntityCode recibe el cuerpo SANEADO, con el apóstrofo escapado', async () => {
        const body = createV2Body();
        body.customer_id = "Plummer's";
        const { handler, synexusConfig } = buildHandler(body);

        await expect(handler.execute(['get_tax', 'a.json', '--api-version=v2'])).rejects.toThrow();

        const receivedBody = synexusConfig.resolveEntityCode.mock.calls[0][1];
        expect(receivedBody.customer_id).toBe("Plummer\\'s");
        expect(receivedBody).not.toBe(body);
    });

    it('bajo v2 con readJsonFile devolviendo null rechaza en español y no llega a resolver la entidad', async () => {
        const { handler, synexusConfig } = buildHandler(null);

        await expect(handler.execute(['get_tax', 'a.json', '--api-version=v2']))
            .rejects.toThrow('El cuerpo de la petición no es un objeto válido');
        expect(synexusConfig.resolveEntityCode).not.toHaveBeenCalled();
    });

    it('bajo v2 con --entity=USA resolveEntityCode recibe USA como primer argumento', async () => {
        const { handler, synexusConfig } = buildHandler(createV2Body());

        await expect(handler.execute(['get_tax', 'a.json', '--api-version=v2', '--entity=USA'])).rejects.toThrow();

        expect(synexusConfig.resolveEntityCode.mock.calls[0][0]).toBe('USA');
    });

    it('bajo TAX_API_VERSION=v2 (sin flag) también ramifica a v2', async () => {
        const { handler, spies, synexusConfig } = buildHandler(createV2Body());
        handler.config.getApiVersion.mockReturnValue('v2');

        await expect(handler.execute(['get_tax', 'a.json'])).rejects.toThrow('cliente v2');

        expect(spies.validate).not.toHaveBeenCalled();
        expect(synexusConfig.printProfile).toHaveBeenCalledTimes(1);
    });
});
