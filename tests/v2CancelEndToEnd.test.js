// tests/v2CancelEndToEnd.test.js
// Recorrido completo de la CANCELACIÓN bajo el contrato v2 (cancel_tax
// --api-version=v2), sin red y sin credenciales: desde los argumentos hasta el
// archivo de respuesta, con el grafo de dependencias armado A MANO igual que
// lo arma index.js (que no puede requerirse: ejecuta main() al cargarse).
// Es TEST-02 para cancel_tax: con get_tax (Fase 1) y post_tax (plan 02-01) en
// tests/v2QuoteEndToEnd.test.js, las tres operaciones tienen prueba del cuerpo
// que sale al cable.
//
// Lo que se afirma aquí con el grafo real y en ningún otro sitio:
//   - POST contra <host>/api/v1/invoices/cancel: otro endpoint que el de
//     cálculo (OPER-03, CONN-04)
//   - el cuerpo es EXACTAMENTE { invoice_id, customer_id }: proyección del
//     archivo, sin cart, direcciones, entidad, intención ni request_id (la
//     excepción documentada de SAFE-01)
//   - sin invoice_id o customer_id aborta antes de la red nombrando el campo
//   - la guardia de archivo v1 y la de arreglo raíz aplican también a la
//     cancelación (validateV2FileShape es común a las tres operaciones)
//   - la respuesta { message, updated_invoices, invoice_id, client_id,
//     entity_id } se escribe por identidad en RESPONSE_<original>
//   - la línea de éxito lleva el X-Request-Id del proveedor y un 404 lanza
//     clasificado por status, citando el mensaje del proveedor y el id
//     (SAFE-06, SAFE-05)
//   - COMP-01: cancel_tax sin selector sigue siendo el GET de v1 contra
//     CancelTransaction, con el archivo v1 ENTERO y sin Authorization
//
// buildGraph, capturedConsoleOutput y los beforeEach/afterEach de variables se
// COPIAN de tests/v2QuoteEndToEnd.test.js. La convención del repositorio es
// "el único ayudante común es tests/helpers/fakes.js; todo lo demás va en
// sitio" (IN-10 del review de la Fase 1 sigue diferido). La única diferencia:
// buildGraph expone también requestBuilder y validator, para espiar sobre las
// instancias REALES que getIntentFor y validateV2IntentFields no se llaman.
//
// Sólo axios está sustituido. Todo lo demás es real: el Config singleton (las
// variables ficticias de tests/setup.js ya lo permiten), el TaxValidator, el
// TaxApiClient de v1, la SynexusConfig, el SynexusRequestBuilder y el
// SynexusApiClient. El único doble además de axios es FileManager, porque
// esta suite no escribe en disco (eso es tests/v2ResponseFidelity.test.js).
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

// Valores ficticios fijados en tests/setup.js. La URL v1 de cancel_tax es
// ${BASE_URL}CancelTransaction, sin credencial (tests/v1Freeze.wire.test.js).
const v1CancelUrl = 'https://ejemplo-v1.invalid/api/CancelTransaction';
const v2CancelUrl = 'https://compute.staging.synexustax.com/api/v1/invoices/cancel';
const v2CalculationUrl = 'https://compute.staging.synexustax.com/api/v1/tax_calculations';
const v2ApiKey = process.env.SYNEXUS_API_KEY;

// El archivo que el ERP deja para cancelar: el cuerpo v2 de siempre, con forma
// de cálculo (cart, direcciones). SIN Committed. entity_id sólo en los casos
// que lo piden por overrides.
const createCancelFile = (overrides) => Object.assign({
    invoice_id: 'DEMO-001',
    customer_id: 'CUST-1',
    to_state: 'TX',
    to_zip: '75001',
    cart: [
        { item_id: 'SKU-1', price: 49.99, quantity: 1, tax_code: 'TPP' }
    ]
}, overrides || {});

// Archivo del contrato v1 para el contraste COMP-01: Committed en mayúscula,
// sin campos en minúsculas. v1 no proyecta: viaja entero.
const createV1CancelFile = () => ({
    Committed: true,
    cartID: 'CART-1'
});

// Respuesta de cancelación con la forma documentada en 02-CONTEXT.md. Los
// valores son ilustrativos: E635 y 635 son identificadores del sandbox.
const createCancelResponse = () => ({
    message: 'Invoice cancelled',
    updated_invoices: 1,
    invoice_id: 'DEMO-001',
    client_id: 'E635',
    entity_id: 635
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
 * Copiado de tests/v2QuoteEndToEnd.test.js; expone además requestBuilder y
 * validator para espiar sobre las instancias reales.
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

    return { handler, logger, fileManager, validator, requestBuilder, apiVersion, synexusConfig, synexusApiClient };
};

/**
 * Todo lo que salió por consola, argumento por argumento, como cadenas.
 * Copiado de tests/v2QuoteEndToEnd.test.js.
 * @returns {string[]}
 */
const capturedConsoleOutput = () => {
    return consoleLogSpy.mock.calls.concat(consoleErrorSpy.mock.calls)
        .reduce((all, call) => all.concat(call), [])
        .map(arg => (typeof arg === 'string' ? arg : JSON.stringify(arg)));
};

describe('Recorrido completo — cancelación v2 (cancel_tax --api-version=v2 --entity=USA) (OPER-03, TEST-02)', () => {
    const args = ['cancel_tax', 'c.json', '--api-version=v2', '--entity=USA'];
    let graph;
    let cancelResponse;
    let axiosCallArgument;
    let intentSpy;
    let intentFieldsSpy;

    beforeEach(async () => {
        cancelResponse = createCancelResponse();
        // La cancelación no trae meta.request_id en el cuerpo: el identificador
        // del proveedor llega sólo por el header X-Request-Id (SAFE-06).
        axios.mockResolvedValue(fakes.createAxiosResponse(200, cancelResponse, { 'x-request-id': 'rid-cancel-ok' }));
        graph = buildGraph(args, createCancelFile());
        // Espías sobre el builder y el validador REALES, instalados antes de
        // ejecutar: dejan pasar la llamada y sólo cuentan
        intentSpy = jest.spyOn(graph.requestBuilder, 'getIntentFor');
        intentFieldsSpy = jest.spyOn(graph.validator, 'validateV2IntentFields');

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

    it('contra la ruta de CANCELACIÓN, no la de cálculo, sin credencial en la URL (OPER-03, CONN-04, CONN-02)', () => {
        expect(axiosCallArgument.url).toBe(v2CancelUrl);
        expect(axiosCallArgument.url).not.toBe(v2CalculationUrl);
        expect(axiosCallArgument.url).not.toContain('tax_calculations');
        expect(axiosCallArgument.url).not.toContain('code=');
        expect(axiosCallArgument.url).not.toContain('?');
        expect(axiosCallArgument.url).not.toContain(v2ApiKey);
        expect(axiosCallArgument.url).not.toContain('synexus_test_');
    });

    it('el cuerpo es EXACTAMENTE { invoice_id, customer_id }: la proyección del archivo, nada más', () => {
        expect(axiosCallArgument.data).toEqual({ invoice_id: 'DEMO-001', customer_id: 'CUST-1' });
        expect(Object.keys(axiosCallArgument.data).sort()).toEqual(['customer_id', 'invoice_id']);
    });

    it('el cuerpo NO lleva transaction_type, committed ni request_id (excepción documentada de SAFE-01), ni cart, to_state, to_zip o entity_id', () => {
        expect(axiosCallArgument.data).not.toHaveProperty('transaction_type');
        expect(axiosCallArgument.data).not.toHaveProperty('committed');
        expect(axiosCallArgument.data).not.toHaveProperty('request_id');
        expect(axiosCallArgument.data).not.toHaveProperty('cart');
        expect(axiosCallArgument.data).not.toHaveProperty('to_state');
        expect(axiosCallArgument.data).not.toHaveProperty('to_zip');
        expect(axiosCallArgument.data).not.toHaveProperty('entity_id');
        expect(axiosCallArgument.data).not.toHaveProperty('Committed');
    });

    it('con exactamente los tres headers de siempre y X-Synexus-Entity: USA (CONN-02, CONN-03)', () => {
        expect(axiosCallArgument.headers).toEqual({
            'Content-Type': 'application/json',
            Authorization: `Bearer ${v2ApiKey}`,
            'X-Synexus-Entity': 'USA'
        });
        expect(axiosCallArgument.headers).not.toHaveProperty('X-Syntax-Entity');
    });

    it('la respuesta de cancelación se escribe por identidad en RESPONSE_c.json, con el mismo mecanismo que el cálculo', () => {
        expect(graph.fileManager.ensureDirectory).toHaveBeenCalledTimes(1);
        expect(graph.fileManager.ensureDirectory).toHaveBeenCalledWith(config.getOutputDir());
        expect(graph.fileManager.getResponseFileName).toHaveBeenCalledTimes(1);
        expect(graph.fileManager.writeJsonFile).toHaveBeenCalledTimes(1);
        const [writtenPath, writtenData] = graph.fileManager.writeJsonFile.mock.calls[0];
        expect(writtenPath).toBe(path.join(config.getOutputDir(), 'RESPONSE_c.json'));
        expect(writtenData).toBe(cancelResponse);
        expect(writtenData).toEqual({
            message: 'Invoice cancelled',
            updated_invoices: 1,
            invoice_id: 'DEMO-001',
            client_id: 'E635',
            entity_id: 635
        });
    });

    it('la corrida termina con el mensaje de éxito del CLI nombrando cancel_tax', () => {
        expect(consoleLogSpy).toHaveBeenCalledWith('Operación cancel_tax completada exitosamente');
        expect(consoleLogSpy).toHaveBeenCalledWith('SUCCESS: cancel_tax - File: c.json');
    });

    it('la línea de éxito del cliente v2 lleva el request_id del header X-Request-Id: la cancelación no trae meta en el cuerpo (SAFE-06)', () => {
        expect(consoleLogSpy).toHaveBeenCalledWith('SUCCESS: cancel_tax - Status: 200 - request_id=rid-cancel-ok');
    });

    it('la línea de perfil se imprime ANTES de la llamada a axios, con la llave enmascarada (CONN-05, CFG-05)', () => {
        const profileIndex = consoleLogSpy.mock.calls
            .findIndex(call => typeof call[0] === 'string' && call[0].startsWith('Perfil efectivo -> contrato: v2'));
        expect(profileIndex).toBeGreaterThanOrEqual(0);
        expect(consoleLogSpy.mock.calls[profileIndex][0]).toContain('entidad: USA');
        expect(consoleLogSpy.mock.calls[profileIndex][0]).toContain('llave: synexus_test_...0000');
        expect(consoleLogSpy.mock.invocationCallOrder[profileIndex]).toBeLessThan(axios.mock.invocationCallOrder[0]);
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

    it('getIntentFor y validateV2IntentFields REALES con cero llamadas: la cancelación no tiene intención que mapear ni validar', () => {
        expect(intentSpy).not.toHaveBeenCalled();
        expect(intentFieldsSpy).not.toHaveBeenCalled();
    });
});

describe('Recorrido completo — la entidad del archivo viaja en el header, no en el cuerpo (CFG-01)', () => {
    it('sin --entity= y sin SYNEXUS_ENTITY, entity_id: CA-01 del archivo va en X-Synexus-Entity y el cuerpo sigue siendo de dos llaves', async () => {
        expect(process.env.SYNEXUS_ENTITY).toBeUndefined();
        axios.mockResolvedValue(fakes.createAxiosResponse(200, createCancelResponse()));
        const args = ['cancel_tax', 'c.json', '--api-version=v2'];
        const graph = buildGraph(args, createCancelFile({ entity_id: 'CA-01' }));

        await graph.handler.execute(args);

        expect(axios).toHaveBeenCalledTimes(1);
        const call = axios.mock.calls[0][0];
        expect(call.url).toBe(v2CancelUrl);
        expect(call.headers['X-Synexus-Entity']).toBe('CA-01');
        expect(call.data).toEqual({ invoice_id: 'DEMO-001', customer_id: 'CUST-1' });
        expect(call.data).not.toHaveProperty('entity_id');
    });
});

describe('Recorrido completo — la cancelación aborta antes de la red (OPER-03, WR-04)', () => {
    const args = ['cancel_tax', 'c.json', '--api-version=v2', '--entity=USA'];

    /**
     * Ejecuta el comando y devuelve el error atrapado, o null si no lanzó.
     * @param {Object} graph - Lo que devolvió buildGraph
     * @returns {Promise<Error|null>}
     */
    const runAndCatch = async (graph) => {
        try {
            await graph.handler.execute(args);
            return null;
        } catch (error) {
            return error;
        }
    };

    it('sin invoice_id en el archivo: rechaza nombrando invoice_id; axios no se llama; no se escribe archivo', async () => {
        axios.mockResolvedValue(fakes.createAxiosResponse(200, createCancelResponse()));
        const file = createCancelFile();
        delete file.invoice_id;
        const graph = buildGraph(args, file);

        const caught = await runAndCatch(graph);

        expect(caught).not.toBeNull();
        expect(caught.message).toContain('invoice_id');
        expect(caught.message).toContain('Para cancelar bajo el contrato v2');
        expect(axios).not.toHaveBeenCalled();
        expect(graph.fileManager.writeJsonFile).not.toHaveBeenCalled();
    });

    it('sin customer_id en el archivo: rechaza nombrando customer_id; axios no se llama; no se escribe archivo', async () => {
        axios.mockResolvedValue(fakes.createAxiosResponse(200, createCancelResponse()));
        const file = createCancelFile();
        delete file.customer_id;
        const graph = buildGraph(args, file);

        const caught = await runAndCatch(graph);

        expect(caught).not.toBeNull();
        expect(caught.message).toContain('customer_id');
        expect(axios).not.toHaveBeenCalled();
        expect(graph.fileManager.writeJsonFile).not.toHaveBeenCalled();
    });

    it('un archivo v1 (Committed: true, cartID) bajo cancel_tax --api-version=v2 rechaza con "parece del contrato v1"; axios no se llama', async () => {
        axios.mockResolvedValue(fakes.createAxiosResponse(200, createCancelResponse()));
        const graph = buildGraph(args, createV1CancelFile());

        const caught = await runAndCatch(graph);

        expect(caught).not.toBeNull();
        expect(caught.message).toContain('parece del contrato v1');
        expect(axios).not.toHaveBeenCalled();
        expect(graph.fileManager.writeJsonFile).not.toHaveBeenCalled();
    });

    it('readJsonFile devolviendo un arreglo bajo cancel_tax: rechaza con "no un arreglo"; axios no se llama', async () => {
        axios.mockResolvedValue(fakes.createAxiosResponse(200, createCancelResponse()));
        const graph = buildGraph(args, [createCancelFile()]);

        const caught = await runAndCatch(graph);

        expect(caught).not.toBeNull();
        expect(caught.message).toContain('no un arreglo');
        expect(axios).not.toHaveBeenCalled();
        expect(graph.fileManager.writeJsonFile).not.toHaveBeenCalled();
    });
});

describe('Recorrido completo — el error de cancelación llega clasificado por status, citando al proveedor y con su request_id (SAFE-05, SAFE-06)', () => {
    const args = ['cancel_tax', 'c.json', '--api-version=v2', '--entity=USA'];

    it('un 404 { error, message } con X-Request-Id lanza "Error HTTP 404", "no existe", el mensaje del proveedor y request_id=rid-cancel-404; no escribe archivo; la llave no sale', async () => {
        axios.mockResolvedValue(fakes.createAxiosResponse(
            404,
            { error: 'not_found', message: 'Invoice not found' },
            { 'x-request-id': 'rid-cancel-404' }
        ));
        const graph = buildGraph(args, createCancelFile());

        let caught = null;
        try {
            await graph.handler.execute(args);
        } catch (error) {
            caught = error;
        }

        expect(caught).not.toBeNull();
        expect(caught.message.startsWith('Error HTTP 404: ')).toBe(true);
        expect(caught.message).toContain('no existe');
        expect(caught.message).toContain('Mensaje del proveedor: "Invoice not found"');
        expect(caught.message).toContain('request_id=rid-cancel-404');
        expect(caught.message).not.toContain('undefined');
        expect(axios).toHaveBeenCalledTimes(1);
        expect(axios.mock.calls[0][0].url).toBe(v2CancelUrl);
        expect(graph.logger.error.mock.calls.some(call => String(call[0]).includes('rid-cancel-404'))).toBe(true);
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
});

describe('Recorrido completo — cancel_tax sin selector es el GET de v1 contra CancelTransaction (COMP-01, CFG-03)', () => {
    it('sin flags y sin TAX_API_VERSION: GET, URL exacta de CancelTransaction, sólo Content-Type y el archivo v1 ENTERO (v1 no proyecta)', async () => {
        // Es la invocación literal del envoltorio del ERP. El cliente es el
        // TaxApiClient REAL y la URL la resuelve el Config REAL.
        expect(process.env.TAX_API_VERSION).toBeUndefined();
        axios.mockResolvedValue(fakes.createAxiosResponse(200, { Status: 'Cancelled' }));
        const args = ['cancel_tax', 'c.json'];
        const graph = buildGraph(args, createV1CancelFile());

        await graph.handler.execute(args);

        expect(axios).toHaveBeenCalledTimes(1);
        const call = axios.mock.calls[0][0];
        expect(call.method).toBe('GET');
        expect(call.url).toBe(v1CancelUrl);
        expect(call.url).not.toContain('code=');
        expect(call.url).not.toContain('invoices/cancel');
        expect(call.headers).toEqual({ 'Content-Type': 'application/json' });
        expect(call.headers).not.toHaveProperty('Authorization');
        expect(call.headers).not.toHaveProperty('X-Synexus-Entity');
        expect(call.data).toEqual(createV1CancelFile());
        expect(call.data).toHaveProperty('cartID', 'CART-1');
        expect(call.data).toHaveProperty('Committed', true);
    });

    it('bajo v1 ni la configuración ni el cliente v2 se construyen: quedan en null como en index.js', async () => {
        axios.mockResolvedValue(fakes.createAxiosResponse(200, { Status: 'Cancelled' }));
        const args = ['cancel_tax', 'c.json'];
        const graph = buildGraph(args, createV1CancelFile());

        await graph.handler.execute(args);

        expect(graph.apiVersion).toBe('v1');
        expect(graph.synexusConfig).toBeNull();
        expect(graph.synexusApiClient).toBeNull();
        expect(consoleLogSpy.mock.calls.some(call => typeof call[0] === 'string' && call[0].startsWith('Perfil efectivo'))).toBe(false);
    });

    it('bajo v1 la respuesta de cancelación se escribe con el mismo mecanismo de siempre', async () => {
        const v1Response = { Status: 'Cancelled', TransactionID: 'CART-1' };
        axios.mockResolvedValue(fakes.createAxiosResponse(200, v1Response));
        const args = ['cancel_tax', 'c.json'];
        const graph = buildGraph(args, createV1CancelFile());

        await graph.handler.execute(args);

        expect(graph.fileManager.writeJsonFile).toHaveBeenCalledWith(
            path.join(config.getOutputDir(), 'RESPONSE_c.json'),
            v1Response
        );
    });
});
