// tests/v2QuoteEndToEnd.test.js
// Recorrido completo del CLI para los dos contratos, sin red y sin credenciales:
// desde los argumentos hasta el archivo de respuesta, con el grafo de
// dependencias armado A MANO igual que lo arma index.js (que no puede
// requerirse: ejecuta main() al cargarse). Cubre las dos operaciones de
// cálculo bajo v2 —la cotización (get_tax) y la confirmación (post_tax), que
// van al mismo endpoint con la intención invertida— y el camino v1 de
// contraste. El nombre del archivo se conserva aunque ya no sea sólo de la
// cotización: los SUMMARY, el review y el mapa del código lo citan.
//
// Sólo axios está sustituido. Todo lo demás es real: el Config singleton (las
// variables ficticias de tests/setup.js ya lo permiten), el TaxValidator, el
// TaxApiClient de v1, la SynexusConfig, el SynexusRequestBuilder y el
// SynexusApiClient. El único doble además de axios es FileManager, porque la
// suite no escribe en disco. Eso es lo que convierte este archivo en la prueba
// más valiosa de la fase: si algo del cableado real se rompe, se rompe aquí.
//
// El caso de v1 usa el TaxApiClient REAL a propósito: es lo que hace de esa
// aserción una prueba de no regresión de verdad (COMP-01, CFG-03) y no una
// tautología sobre dobles.
jest.mock('axios');

const path = require('path');
const axios = require('axios');
const config = require('../src/config');
const TaxValidator = require('../src/validators/taxValidator');
const TaxApiClient = require('../src/api/taxApiClient');
const SynexusRequestBuilder = require('../src/api/synexusRequestBuilder');
const SynexusConfig = require('../src/config/synexusConfig');
const SynexusApiClient = require('../src/api/synexusApiClient');
const TaxCommandHandler = require('../src/cli/taxCommandHandler');
const fakes = require('./helpers/fakes');

// Valores ficticios fijados en tests/setup.js.
const v1ResolvedUrl = 'https://ejemplo-v1.invalid/api/STCCalcV3?code=codigo-de-prueba-v1';
const v2CalculationUrl = 'https://compute.staging.synexustax.com/api/v1/tax_calculations';
const v2ApiKey = process.env.SYNEXUS_API_KEY;

const uuidV4Pattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

// Cuerpo con forma v2, calcado del ejemplo de postman/synexus-v2-api.postman_collection.json.
// SIN Committed: así es el archivo real que deja el área de ERP.
const createV2Body = (overrides) => Object.assign({
    invoice_id: 'DEMO-001',
    customer_id: 'CUST-1',
    to_state: 'TX',
    to_zip: '75001',
    cart: [
        { item_id: 'SKU-1', price: 49.99, quantity: 1, tax_code: 'TPP' }
    ]
}, overrides || {});

// Cuerpo del contrato v1: Committed en mayúscula, sin campos de intención en minúsculas.
const createV1Body = () => ({
    Committed: false,
    cartID: 'CART-1',
    ToState: 'TX',
    cart: []
});

// Respuesta del proveedor v2 con la forma de la respuesta real de staging del
// 9-sep-2026: montos como cadenas decimales, un cero que NO es defecto y el
// identificador de petición del proveedor en meta.request_id (SAFE-06).
const createProviderResponse = () => ({
    id: 'txn_demo_001',
    transaction_type: 'sales_estimate',
    committed: false,
    total_tax: '0.00',
    exemption: { source: 'no_nexus' },
    meta: { request_id: 'e2e-rid-0001' }
});

// La misma forma para una confirmación: lo que el proveedor devuelve cuando la
// factura quedó registrada. El cero sigue sin ser defecto (no_nexus).
const createConfirmedProviderResponse = () => Object.assign(createProviderResponse(), {
    id: 'txn_demo_002',
    transaction_type: 'sales_invoice',
    committed: true
});

let originalTaxApiVersion;
let originalSynexusEntity;
let consoleLogSpy;
let consoleErrorSpy;

beforeEach(() => {
    originalTaxApiVersion = process.env.TAX_API_VERSION;
    originalSynexusEntity = process.env.SYNEXUS_ENTITY;
    delete process.env.TAX_API_VERSION;
    delete process.env.SYNEXUS_ENTITY;
    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    axios.mockReset();
});

afterEach(() => {
    if (originalTaxApiVersion === undefined) {
        delete process.env.TAX_API_VERSION;
    } else {
        process.env.TAX_API_VERSION = originalTaxApiVersion;
    }
    if (originalSynexusEntity === undefined) {
        delete process.env.SYNEXUS_ENTITY;
    } else {
        process.env.SYNEXUS_ENTITY = originalSynexusEntity;
    }
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
});

/**
 * Arma el grafo completo reproduciendo a mano los pasos 1-6 de index.js:
 * infraestructura → almacenamiento → validación → API → contrato → CLI.
 * La configuración y el cliente v2 se construyen SÓLO cuando el contrato
 * resuelto es v2; bajo v1 quedan en null, igual que en el punto de entrada.
 * @param {string[]} args - Argumentos tal como llegarían en process.argv.slice(2)
 * @param {*} requestBody - Lo que readJsonFile devolverá
 * @returns {Object} handler y colaboradores para las aserciones
 */
const buildGraph = (args, requestBody) => {
    const logger = fakes.createFakeLogger();
    const fileManager = {
        exists: jest.fn(() => true),
        readJsonFile: jest.fn(() => requestBody),
        writeJsonFile: jest.fn(),
        ensureDirectory: jest.fn(),
        getResponseFileName: jest.fn((originalFilePath, outputDir) =>
            path.join(outputDir, 'RESPONSE_' + path.basename(originalFilePath)))
    };
    const validator = new TaxValidator(logger);
    const apiClient = new TaxApiClient(config, logger);
    const requestBuilder = new SynexusRequestBuilder(logger);

    const apiVersion = TaxCommandHandler.resolveApiVersion(args, config, logger);
    let synexusConfig = null;
    let synexusApiClient = null;
    if (apiVersion === 'v2') {
        synexusConfig = new SynexusConfig();
        synexusApiClient = new SynexusApiClient(synexusConfig, logger);
    }

    const handler = new TaxCommandHandler(
        config,
        logger,
        fileManager,
        validator,
        apiClient,
        synexusConfig,
        requestBuilder,
        synexusApiClient
    );

    return { handler, logger, fileManager, apiVersion, synexusConfig, synexusApiClient };
};

/**
 * Todo lo que salió por consola, argumento por argumento, como cadenas.
 * @returns {string[]}
 */
const capturedConsoleOutput = () => {
    return consoleLogSpy.mock.calls.concat(consoleErrorSpy.mock.calls)
        .reduce((all, call) => all.concat(call), [])
        .map(arg => (typeof arg === 'string' ? arg : JSON.stringify(arg)));
};

describe('Recorrido completo — cotización v2 (get_tax --api-version=v2 --entity=USA)', () => {
    const args = ['get_tax', 'a.json', '--api-version=v2', '--entity=USA'];
    let graph;
    let providerResponse;
    let axiosCallArgument;

    beforeEach(async () => {
        providerResponse = createProviderResponse();
        axios.mockResolvedValue(fakes.createAxiosResponse(200, providerResponse));
        graph = buildGraph(args, createV2Body());

        await graph.handler.execute(args);
        axiosCallArgument = axios.mock.calls.length > 0 ? axios.mock.calls[0][0] : undefined;
    });

    it('el grafo construyó la configuración y el cliente v2 reales', () => {
        expect(graph.apiVersion).toBe('v2');
        expect(graph.synexusConfig).toBeInstanceOf(SynexusConfig);
        expect(graph.synexusApiClient).toBeInstanceOf(SynexusApiClient);
    });

    it('axios se llama exactamente una vez', () => {
        expect(axios).toHaveBeenCalledTimes(1);
        expect(axiosCallArgument).toBeDefined();
    });

    it('con el método POST (CONN-01)', () => {
        expect(axiosCallArgument.method).toBe('POST');
    });

    it('contra la ruta de cálculo del contrato v2, sin credencial en la URL (CONN-04, CONN-02)', () => {
        expect(axiosCallArgument.url).toBe(v2CalculationUrl);
        expect(axiosCallArgument.url).not.toContain('code=');
        expect(axiosCallArgument.url).not.toContain(v2ApiKey);
    });

    it('con la llave en el header Authorization, con el prefijo Bearer (CONN-02)', () => {
        expect(axiosCallArgument.headers.Authorization.startsWith('Bearer ')).toBe(true);
        expect(axiosCallArgument.headers.Authorization).toBe(`Bearer ${v2ApiKey}`);
    });

    it('con el código de entidad del flag en el header X-Synexus-Entity (CONN-03, CFG-01)', () => {
        expect(axiosCallArgument.headers['X-Synexus-Entity']).toBe('USA');
        expect(axiosCallArgument.headers).not.toHaveProperty('X-Syntax-Entity');
    });

    it('con el cuerpo tipado como estimación: transaction_type sales_estimate, committed false y request_id (OPER-01, SAFE-01)', () => {
        expect(axiosCallArgument.data.transaction_type).toBe('sales_estimate');
        expect(axiosCallArgument.data.committed).toBe(false);
        expect(typeof axiosCallArgument.data.request_id).toBe('string');
        expect(axiosCallArgument.data.request_id.length).toBeGreaterThan(0);
        expect(axiosCallArgument.data.request_id).toMatch(uuidV4Pattern);
    });

    it('el cuerpo conserva los campos del archivo del ERP tal cual', () => {
        expect(axiosCallArgument.data.invoice_id).toBe('DEMO-001');
        expect(axiosCallArgument.data.to_state).toBe('TX');
        expect(axiosCallArgument.data.cart).toEqual([
            { item_id: 'SKU-1', price: 49.99, quantity: 1, tax_code: 'TPP' }
        ]);
        expect(axiosCallArgument.data).not.toHaveProperty('Committed');
    });

    it('la respuesta del proveedor se escribe tal cual, sin transformar, con el nombre RESPONSE_<archivo>', () => {
        expect(graph.fileManager.ensureDirectory).toHaveBeenCalledTimes(1);
        expect(graph.fileManager.ensureDirectory).toHaveBeenCalledWith(config.getOutputDir());
        expect(graph.fileManager.writeJsonFile).toHaveBeenCalledTimes(1);
        const [writtenPath, writtenData] = graph.fileManager.writeJsonFile.mock.calls[0];
        expect(writtenPath).toBe(path.join(config.getOutputDir(), 'RESPONSE_a.json'));
        expect(writtenData).toBe(providerResponse);
    });

    it('la línea de perfil se imprime ANTES de la salida a la red, con la llave enmascarada (CONN-05, CFG-05)', () => {
        const profileIndex = consoleLogSpy.mock.calls
            .findIndex(call => typeof call[0] === 'string' && call[0].startsWith('Perfil efectivo -> contrato: v2'));
        expect(profileIndex).toBeGreaterThanOrEqual(0);
        expect(consoleLogSpy.mock.calls[profileIndex][0]).toContain('entidad: USA');
        expect(consoleLogSpy.mock.calls[profileIndex][0]).toContain('llave: synexus_test_...0000');
        expect(consoleLogSpy.mock.invocationCallOrder[profileIndex]).toBeLessThan(axios.mock.invocationCallOrder[0]);
    });

    it('la corrida termina con el mensaje de éxito del CLI', () => {
        expect(consoleLogSpy).toHaveBeenCalledWith('Operación get_tax completada exitosamente');
        expect(consoleLogSpy).toHaveBeenCalledWith('SUCCESS: get_tax - File: a.json');
    });

    it('la línea de éxito del cliente v2 lleva el request_id del proveedor, tomado de meta.request_id del cuerpo (SAFE-06)', () => {
        expect(consoleLogSpy).toHaveBeenCalledWith('SUCCESS: get_tax - Status: 200 - request_id=e2e-rid-0001');
    });

    it('la llave completa no aparece en ninguna línea de consola ni del logger (CFG-05)', () => {
        const output = capturedConsoleOutput();
        expect(output.length).toBeGreaterThan(0);
        output.forEach(line => {
            expect(line).not.toContain(v2ApiKey);
        });
        graph.logger.error.mock.calls.forEach(call => {
            call.forEach(arg => {
                expect(String(arg)).not.toContain(v2ApiKey);
            });
        });
    });
});

describe('Recorrido completo — confirmación v2 (post_tax --api-version=v2 --entity=USA) (OPER-02, TEST-02)', () => {
    // El espejo del describe anterior: misma ruta de cálculo, intención
    // invertida. Cada aserción de intención va con su negación explícita,
    // porque lo que protege es que confirmar no cotice ni cotizar confirme.
    const args = ['post_tax', 'a.json', '--api-version=v2', '--entity=USA'];
    let graph;
    let providerResponse;
    let axiosCallArgument;

    beforeEach(async () => {
        providerResponse = createConfirmedProviderResponse();
        axios.mockResolvedValue(fakes.createAxiosResponse(200, providerResponse));
        graph = buildGraph(args, createV2Body());

        await graph.handler.execute(args);
        axiosCallArgument = axios.mock.calls.length > 0 ? axios.mock.calls[0][0] : undefined;
    });

    it('axios se llama exactamente una vez, con el método POST (CONN-01)', () => {
        expect(axios).toHaveBeenCalledTimes(1);
        expect(axiosCallArgument).toBeDefined();
        expect(axiosCallArgument.method).toBe('POST');
    });

    it('contra la MISMA ruta de cálculo que usa get_tax, sin credencial en la URL (CONN-04, CONN-02)', () => {
        expect(axiosCallArgument.url).toBe(v2CalculationUrl);
        expect(axiosCallArgument.url).not.toContain('code=');
        expect(axiosCallArgument.url).not.toContain(v2ApiKey);
    });

    it('con el cuerpo tipado como factura confirmada: transaction_type sales_invoice y committed true (OPER-02, TEST-02)', () => {
        expect(axiosCallArgument.data.transaction_type).toBe('sales_invoice');
        expect(axiosCallArgument.data.committed).toBe(true);
        expect(typeof axiosCallArgument.data.committed).toBe('boolean');
    });

    it('y NUNCA como estimación: transaction_type no es sales_estimate (TEST-02, la negación)', () => {
        expect(axiosCallArgument.data.transaction_type).not.toBe('sales_estimate');
        expect(axiosCallArgument.data.committed).not.toBe(false);
    });

    it('con request_id UUID v4: la llave de idempotencia también viaja en la confirmación (SAFE-01)', () => {
        expect(typeof axiosCallArgument.data.request_id).toBe('string');
        expect(axiosCallArgument.data.request_id).toMatch(uuidV4Pattern);
    });

    it('con la llave en Authorization: Bearer y la entidad del flag en X-Synexus-Entity (CONN-02, CONN-03)', () => {
        expect(axiosCallArgument.headers.Authorization).toBe(`Bearer ${v2ApiKey}`);
        expect(axiosCallArgument.headers['X-Synexus-Entity']).toBe('USA');
    });

    it('la respuesta del proveedor se escribe por identidad con el nombre RESPONSE_<archivo>', () => {
        expect(graph.fileManager.writeJsonFile).toHaveBeenCalledTimes(1);
        const [writtenPath, writtenData] = graph.fileManager.writeJsonFile.mock.calls[0];
        expect(writtenPath).toBe(path.join(config.getOutputDir(), 'RESPONSE_a.json'));
        expect(writtenData).toBe(providerResponse);
    });

    it('la corrida termina con el mensaje de éxito del CLI nombrando post_tax', () => {
        expect(consoleLogSpy).toHaveBeenCalledWith('Operación post_tax completada exitosamente');
        expect(consoleLogSpy).toHaveBeenCalledWith('SUCCESS: post_tax - File: a.json');
    });

    it('la línea de éxito del cliente v2 lleva el request_id del proveedor también en la confirmación (SAFE-06)', () => {
        expect(consoleLogSpy).toHaveBeenCalledWith('SUCCESS: post_tax - Status: 200 - request_id=e2e-rid-0001');
    });

    it('la llave completa no aparece en ninguna línea de consola ni del logger (CFG-05)', () => {
        const output = capturedConsoleOutput();
        expect(output.length).toBeGreaterThan(0);
        output.forEach(line => {
            expect(line).not.toContain(v2ApiKey);
        });
        graph.logger.error.mock.calls.forEach(call => {
            call.forEach(arg => {
                expect(String(arg)).not.toContain(v2ApiKey);
            });
        });
    });
});

describe('Recorrido completo — el archivo que contradice la confirmación o parece de v1 bajo post_tax (OPER-04 bajo v2)', () => {
    const args = ['post_tax', 'a.json', '--api-version=v2', '--entity=USA'];

    it('un archivo v2 con committed: false bajo post_tax lanza nombrando committed y "debe ser true"; axios no se llama y no se escribe archivo', async () => {
        axios.mockResolvedValue(fakes.createAxiosResponse(200, createConfirmedProviderResponse()));
        const graph = buildGraph(args, createV2Body({ committed: false }));

        let caught = null;
        try {
            await graph.handler.execute(args);
        } catch (error) {
            caught = error;
        }

        expect(caught).not.toBeNull();
        expect(caught.message).toContain('"committed"');
        expect(caught.message).toContain('post_tax');
        expect(caught.message).toContain('debe ser true');
        expect(axios).not.toHaveBeenCalled();
        expect(graph.fileManager.writeJsonFile).not.toHaveBeenCalled();
    });

    it('un archivo v2 con transaction_type: sales_estimate bajo post_tax lanza citando sales_estimate y axios no se llama', async () => {
        axios.mockResolvedValue(fakes.createAxiosResponse(200, createConfirmedProviderResponse()));
        const graph = buildGraph(args, createV2Body({ transaction_type: 'sales_estimate' }));

        await expect(graph.handler.execute(args)).rejects.toThrow('sales_estimate');
        expect(axios).not.toHaveBeenCalled();
        expect(graph.fileManager.writeJsonFile).not.toHaveBeenCalled();
    });

    it('un archivo del contrato v1 (Committed: true) con post_tax --api-version=v2 lanza "parece del contrato v1" y axios no se llama', async () => {
        axios.mockResolvedValue(fakes.createAxiosResponse(200, createConfirmedProviderResponse()));
        const graph = buildGraph(args, { Committed: true, cartID: 'CART-1', ToState: 'TX', cart: [] });

        let caught = null;
        try {
            await graph.handler.execute(args);
        } catch (error) {
            caught = error;
        }

        expect(caught).not.toBeNull();
        expect(caught.message).toContain('parece del contrato v1');
        expect(axios).not.toHaveBeenCalled();
        expect(graph.fileManager.writeJsonFile).not.toHaveBeenCalled();
    });
});

describe('Recorrido completo — v1 sin selector es la petición de siempre (COMP-01, CFG-03)', () => {
    it('sin flags y sin TAX_API_VERSION: GET, URL de v1 terminada en STCCalcV3?code=, y SIN header Authorization', async () => {
        // Es la invocación literal del envoltorio del ERP. El cliente es el
        // TaxApiClient REAL y la URL la resuelve el Config REAL.
        expect(process.env.TAX_API_VERSION).toBeUndefined();
        axios.mockResolvedValue(fakes.createAxiosResponse(200, { InvoiceTaxAmt: 0 }));
        const args = ['get_tax', 'a.json'];
        const graph = buildGraph(args, createV1Body());

        await graph.handler.execute(args);

        expect(axios).toHaveBeenCalledTimes(1);
        const call = axios.mock.calls[0][0];
        expect(call.method).toBe('GET');
        expect(call.url).toBe(v1ResolvedUrl);
        expect(call.url.endsWith('STCCalcV3?code=codigo-de-prueba-v1')).toBe(true);
        expect(call.headers).not.toHaveProperty('Authorization');
        expect(call.headers).not.toHaveProperty('X-Synexus-Entity');
        expect(call.headers).toEqual({ 'Content-Type': 'application/json' });
        expect(call.data).toEqual(createV1Body());
    });

    it('bajo v1 ni la configuración ni el cliente v2 se construyen: quedan en null como en index.js', async () => {
        axios.mockResolvedValue(fakes.createAxiosResponse(200, { InvoiceTaxAmt: 0 }));
        const args = ['get_tax', 'a.json'];
        const graph = buildGraph(args, createV1Body());

        await graph.handler.execute(args);

        expect(graph.apiVersion).toBe('v1');
        expect(graph.synexusConfig).toBeNull();
        expect(graph.synexusApiClient).toBeNull();
        expect(consoleLogSpy.mock.calls.some(call => typeof call[0] === 'string' && call[0].startsWith('Perfil efectivo'))).toBe(false);
    });

    it('bajo v1 la respuesta se escribe con el mismo mecanismo de siempre', async () => {
        const v1Response = { InvoiceTaxAmt: 3.5, Lines: [] };
        axios.mockResolvedValue(fakes.createAxiosResponse(200, v1Response));
        const args = ['get_tax', 'a.json'];
        const graph = buildGraph(args, createV1Body());

        await graph.handler.execute(args);

        expect(graph.fileManager.writeJsonFile).toHaveBeenCalledWith(
            path.join(config.getOutputDir(), 'RESPONSE_a.json'),
            v1Response
        );
    });
});

describe('Recorrido completo — el selector desde la configuración de entorno (VERIF-04)', () => {
    it('TAX_API_VERSION=v2 sin flags recorre el camino v2: POST con header portador', async () => {
        process.env.TAX_API_VERSION = 'v2';
        process.env.SYNEXUS_ENTITY = 'USA';
        axios.mockResolvedValue(fakes.createAxiosResponse(200, createProviderResponse()));
        const args = ['get_tax', 'a.json'];
        const graph = buildGraph(args, createV2Body());

        await graph.handler.execute(args);

        expect(graph.apiVersion).toBe('v2');
        const call = axios.mock.calls[0][0];
        expect(call.method).toBe('POST');
        expect(call.url).toBe(v2CalculationUrl);
        expect(call.headers.Authorization).toBe(`Bearer ${v2ApiKey}`);
        expect(call.headers['X-Synexus-Entity']).toBe('USA');
    });

    it('revertir es cambiar esa línea: con TAX_API_VERSION=v1 la misma invocación vuelve a GET sin Authorization', async () => {
        process.env.TAX_API_VERSION = 'v1';
        axios.mockResolvedValue(fakes.createAxiosResponse(200, { InvoiceTaxAmt: 0 }));
        const args = ['get_tax', 'a.json'];
        const graph = buildGraph(args, createV1Body());

        await graph.handler.execute(args);

        expect(graph.apiVersion).toBe('v1');
        const call = axios.mock.calls[0][0];
        expect(call.method).toBe('GET');
        expect(call.url).toBe(v1ResolvedUrl);
        expect(call.headers).not.toHaveProperty('Authorization');
    });

    it('el flag gana sobre la variable: TAX_API_VERSION=v2 con --api-version=v1 recorre v1', async () => {
        process.env.TAX_API_VERSION = 'v2';
        axios.mockResolvedValue(fakes.createAxiosResponse(200, { InvoiceTaxAmt: 0 }));
        const args = ['get_tax', 'a.json', '--api-version=v1'];
        const graph = buildGraph(args, createV1Body());

        await graph.handler.execute(args);

        expect(graph.apiVersion).toBe('v1');
        expect(graph.synexusApiClient).toBeNull();
        expect(axios.mock.calls[0][0].method).toBe('GET');
        expect(axios.mock.calls[0][0].headers).not.toHaveProperty('Authorization');
    });
});

describe('Recorrido completo — precedencia del código de entidad de punta a punta (CFG-01, CFG-02)', () => {
    const args = ['get_tax', 'a.json', '--api-version=v2'];

    it('sin --entity= y sin SYNEXUS_ENTITY, el entity_id del archivo viaja en el header de entidad', async () => {
        expect(process.env.SYNEXUS_ENTITY).toBeUndefined();
        axios.mockResolvedValue(fakes.createAxiosResponse(200, createProviderResponse()));
        const graph = buildGraph(args, createV2Body({ entity_id: 'CA-01' }));

        await graph.handler.execute(args);

        expect(axios).toHaveBeenCalledTimes(1);
        expect(axios.mock.calls[0][0].headers['X-Synexus-Entity']).toBe('CA-01');
    });

    it('con SYNEXUS_ENTITY y entity_id en el archivo, gana la variable de entorno', async () => {
        process.env.SYNEXUS_ENTITY = 'ENV-ENT';
        axios.mockResolvedValue(fakes.createAxiosResponse(200, createProviderResponse()));
        const graph = buildGraph(args, createV2Body({ entity_id: 'CA-01' }));

        await graph.handler.execute(args);

        expect(axios.mock.calls[0][0].headers['X-Synexus-Entity']).toBe('ENV-ENT');
    });

    it('sin ninguna de las tres vías, la corrida lanza nombrándolas y axios NO se llama', async () => {
        axios.mockResolvedValue(fakes.createAxiosResponse(200, createProviderResponse()));
        const graph = buildGraph(args, createV2Body({ entity_id: '' }));

        let caught = null;
        try {
            await graph.handler.execute(args);
        } catch (error) {
            caught = error;
        }

        expect(caught).not.toBeNull();
        expect(caught.message).toContain('--entity=<codigo>');
        expect(caught.message).toContain('SYNEXUS_ENTITY');
        expect(caught.message).toContain('entity_id');
        expect(axios).not.toHaveBeenCalled();
        expect(graph.fileManager.writeJsonFile).not.toHaveBeenCalled();
    });
});

describe('Recorrido completo — el archivo que contradice la operación o parece de v1 (OPER-04 bajo v2)', () => {
    const args = ['get_tax', 'a.json', '--api-version=v2', '--entity=USA'];

    it('un archivo v2 con committed: true bajo get_tax lanza la contradicción de validateV2IntentFields y axios no se llama', async () => {
        axios.mockResolvedValue(fakes.createAxiosResponse(200, createProviderResponse()));
        const graph = buildGraph(args, createV2Body({ committed: true }));

        let caught = null;
        try {
            await graph.handler.execute(args);
        } catch (error) {
            caught = error;
        }

        expect(caught).not.toBeNull();
        expect(caught.message).toContain('"committed"');
        expect(caught.message).toContain('get_tax');
        expect(caught.message).toContain('debe ser false');
        expect(axios).not.toHaveBeenCalled();
        expect(graph.fileManager.writeJsonFile).not.toHaveBeenCalled();
    });

    it('un archivo v2 con transaction_type: sales_invoice bajo get_tax lanza la contradicción y axios no se llama', async () => {
        axios.mockResolvedValue(fakes.createAxiosResponse(200, createProviderResponse()));
        const graph = buildGraph(args, createV2Body({ transaction_type: 'sales_invoice' }));

        await expect(graph.handler.execute(args)).rejects.toThrow('sales_invoice');
        expect(axios).not.toHaveBeenCalled();
    });

    it('un archivo del contrato v1 (Committed: false) con --api-version=v2 lanza "parece del contrato v1" y axios no se llama', async () => {
        axios.mockResolvedValue(fakes.createAxiosResponse(200, createProviderResponse()));
        const graph = buildGraph(args, createV1Body());

        let caught = null;
        try {
            await graph.handler.execute(args);
        } catch (error) {
            caught = error;
        }

        expect(caught).not.toBeNull();
        expect(caught.message).toContain('parece del contrato v1');
        expect(axios).not.toHaveBeenCalled();
        expect(graph.fileManager.writeJsonFile).not.toHaveBeenCalled();
    });
});

describe('WR-03 y WR-04 — lo que sale al cable v2 no se escapa y un arreglo no sale', () => {
    const v2Args = ['get_tax', 'a.json', '--api-version=v2', '--entity=USA'];

    it("bajo v2, address_line1 \"O'Brien St\" llega a axios con el apóstrofo intacto y sin barra: la rama v2 no sanea (WR-03)", async () => {
        axios.mockResolvedValue(fakes.createAxiosResponse(200, createProviderResponse()));
        const graph = buildGraph(v2Args, createV2Body({ address_line1: "O'Brien St" }));

        await graph.handler.execute(v2Args);

        expect(axios).toHaveBeenCalledTimes(1);
        const sentBody = axios.mock.calls[0][0].data;
        expect(sentBody.address_line1).toBe("O'Brien St");
        expect(JSON.stringify(sentBody)).not.toContain("\\'");
        expect(JSON.stringify(sentBody)).toContain("O'Brien St");
    });

    it("la misma cadena bajo v1 (Committed: false, Address \"O'Brien St\", sin flags) sale como O\\'Brien St: v1 sigue escapando, y esta aserción congela la diferencia entre contratos (COMP-01)", async () => {
        // Cliente v1 REAL, como el resto de casos v1 del archivo: es lo que hace
        // de esto una prueba de no regresión y no una tautología sobre dobles.
        expect(process.env.TAX_API_VERSION).toBeUndefined();
        axios.mockResolvedValue(fakes.createAxiosResponse(200, { InvoiceTaxAmt: 0 }));
        const args = ['get_tax', 'a.json'];
        const v1Body = Object.assign(createV1Body(), { Address: "O'Brien St" });
        const graph = buildGraph(args, v1Body);

        await graph.handler.execute(args);

        expect(axios).toHaveBeenCalledTimes(1);
        const call = axios.mock.calls[0][0];
        expect(call.method).toBe('GET');
        expect(call.data.Address).toBe("O\\'Brien St");
        expect(call.data.Address).not.toBe("O'Brien St");
    });

    it('con readJsonFile devolviendo un arreglo raíz bajo v2, la corrida rechaza con "no un arreglo" en español, axios no se llama y no se escribe archivo (WR-04)', async () => {
        axios.mockResolvedValue(fakes.createAxiosResponse(200, createProviderResponse()));
        const graph = buildGraph(v2Args, [createV2Body()]);

        let caught = null;
        try {
            await graph.handler.execute(v2Args);
        } catch (error) {
            caught = error;
        }

        expect(caught).not.toBeNull();
        expect(caught.message.startsWith('El archivo de entrada debe ser un objeto JSON, no un arreglo')).toBe(true);
        expect(axios).not.toHaveBeenCalled();
        expect(graph.fileManager.writeJsonFile).not.toHaveBeenCalled();
    });
});

describe('Recorrido completo — el camino de error del proveedor v2 tampoco filtra la llave, y llega clasificado por código con su request_id (SAFE-05, SAFE-06)', () => {
    const args = ['get_tax', 'a.json', '--api-version=v2', '--entity=USA'];

    it('con un 422 tax_code_missing del proveedor, la corrida lanza "Error HTTP 422 (tax_code_missing)" con request_id=rid-422, lo registra, no escribe archivo y la llave no sale', async () => {
        axios.mockResolvedValue(fakes.createAxiosResponse(422, {
            error: 'unprocessable',
            code: 'tax_code_missing',
            message: 'tax_code is required',
            request_id: 'rid-422'
        }));
        const graph = buildGraph(args, createV2Body());

        let caught = null;
        try {
            await graph.handler.execute(args);
        } catch (error) {
            caught = error;
        }

        expect(caught).not.toBeNull();
        expect(caught.message.startsWith('Error HTTP 422 (tax_code_missing): ')).toBe(true);
        expect(caught.message).toContain('tax_code');
        expect(caught.message).toContain('Mensaje del proveedor: "tax_code is required"');
        expect(caught.message).toContain('request_id=rid-422');
        expect(graph.logger.error.mock.calls.some(call => String(call[0]).includes('rid-422'))).toBe(true);
        expect(graph.fileManager.writeJsonFile).not.toHaveBeenCalled();
        capturedConsoleOutput().forEach(line => {
            expect(line).not.toContain(v2ApiKey);
        });
        graph.logger.error.mock.calls.forEach(call => {
            call.forEach(arg => {
                expect(String(arg)).not.toContain(v2ApiKey);
            });
        });
    });

    it('post_tax con un 401 invalid_key lanza "Error HTTP 401 (invalid_key)" nombrando SYNEXUS_API_KEY, sin escribir archivo', async () => {
        const postArgs = ['post_tax', 'a.json', '--api-version=v2', '--entity=USA'];
        axios.mockResolvedValue(fakes.createAxiosResponse(401, { error: 'unauthorized', code: 'invalid_key', message: 'Unauthorized' }));
        const graph = buildGraph(postArgs, createV2Body());

        let caught = null;
        try {
            await graph.handler.execute(postArgs);
        } catch (error) {
            caught = error;
        }

        expect(caught).not.toBeNull();
        expect(caught.message.startsWith('Error HTTP 401 (invalid_key): ')).toBe(true);
        expect(caught.message).toContain('SYNEXUS_API_KEY');
        expect(caught.message).toContain('Mensaje del proveedor: "Unauthorized"');
        expect(axios).toHaveBeenCalledTimes(1);
        expect(graph.fileManager.writeJsonFile).not.toHaveBeenCalled();
        capturedConsoleOutput().forEach(line => {
            expect(line).not.toContain(v2ApiKey);
        });
    });

    it('con un error de transporte que trae la petición en config (como los de axios), la llave no sale por consola ni por el logger, y el log lleva el request_id que generó nexgen (SAFE-06)', async () => {
        const error = new Error('connect ECONNREFUSED');
        error.code = 'ECONNREFUSED';
        error.request = {};
        error.config = { url: v2CalculationUrl, headers: { Authorization: `Bearer ${v2ApiKey}` } };
        axios.mockRejectedValue(error);
        const graph = buildGraph(args, createV2Body());

        await expect(graph.handler.execute(args)).rejects.toBe(error);

        capturedConsoleOutput().forEach(line => {
            expect(line).not.toContain(v2ApiKey);
        });
        graph.logger.error.mock.calls.forEach(call => {
            call.forEach(arg => {
                expect(String(arg)).not.toContain(v2ApiKey);
            });
        });
        // El proveedor no respondió: lo único correlacionable es la llave de
        // idempotencia que salió en el cuerpo, y el log la nombra como propia.
        const sentRequestId = axios.mock.calls[0][0].data.request_id;
        expect(sentRequestId).toMatch(uuidV4Pattern);
        const loggedLines = graph.logger.error.mock.calls.map(call => String(call[0]));
        expect(loggedLines.some(line => line.includes('generado por nexgen') && line.includes(sentRequestId))).toBe(true);
        expect(capturedConsoleOutput().some(line => line.includes(`Identificador para soporte: request_id=${sentRequestId} (generado por nexgen`))).toBe(true);
    });
});
