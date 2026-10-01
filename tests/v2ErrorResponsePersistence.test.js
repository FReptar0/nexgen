// tests/v2ErrorResponsePersistence.test.js
// Un fallo bajo v2 también deja archivo de respuesta — con el FileManager REAL,
// sobre disco.
//
// Por qué existe este archivo. El área de ERP lee SIEMPRE el mismo archivo y
// sólo ése: `RESPONSE_<nombre original>` en el directorio de salida. Pidió que
// una respuesta de error o advertencia se guarde "igualito", sin prefijo ni
// sufijo distinto, porque si no es el cálculo que espera, lo detecta por su
// lado. Hasta la Fase 2 una corrida fallida no escribía nada, y entonces el
// ERP leía el RESPONSE_ de una corrida ANTERIOR y lo tomaba por bueno: un dato
// viejo presentado como actual, que es peor que no tener archivo.
//
// Lo que se afirma aquí:
//   1. El proveedor respondió con error (4xx, 5xx): su cuerpo se archiva TAL
//      CUAL, por identidad, con el nombre de siempre.
//   2. El proveedor no respondió (timeout, red): se archiva un objeto propio de
//      nexgen que NO se parece a un cálculo.
//   3. La corrida abortó antes de salir a la red (validación): igual, objeto
//      propio de nexgen.
//   4. El archivo se escribe PERO la corrida sigue fallando: el código de
//      salida 1 no se pierde por haber escrito.
//   5. A prueba de errores: si escribir falla, el error que llega al operador
//      sigue siendo el ORIGINAL, no el de la escritura.
//   6. Nunca sale la llave en lo que se archiva.
//   7. v1 no cambió: un fallo bajo v1 no escribe nada (COMP-01).
//
// Toca disco como v2ResponseFidelity.test.js: siempre bajo os.tmpdir() con
// mkdtempSync, nunca dentro del repositorio ni en un OUTPUT_DIR real, y borra
// lo suyo en afterEach.
//
// Validación por mutación (convención de la suite, .planning/codebase/TESTING.md):
//   - Quitar la llamada a _saveErrorResponse en el catch de execute() pone en
//     rojo todos los casos de los describe 1 a 4.
//   - Devolver el objeto de nexgen en vez del cuerpo del proveedor en
//     _errorResponseBodyFor pone en rojo el caso de identidad del describe 1.
//   - Re-lanzar saveError en _saveErrorResponse pone en rojo el describe 5.
//   - Escribir bajo v1 pone en rojo el describe 7.
jest.mock('axios');

const fs = require('fs');
const os = require('os');
const path = require('path');
const axios = require('axios');
const config = require('../src/config');
const FileManager = require('../src/storage/fileManager');
const TaxValidator = require('../src/validators/taxValidator');
const TaxApiClient = require('../src/api/taxApiClient');
const SynexusRequestBuilder = require('../src/api/synexusRequestBuilder');
const SynexusConfig = require('../src/config/synexusConfig');
const SynexusApiClient = require('../src/api/synexusApiClient');
const TaxCommandHandler = require('../src/cli/taxCommandHandler');
const fakes = require('./helpers/fakes');

// El nombre numerado tal como lo emite el ERP, y el que debe conservar la
// salida: mismo nombre, prefijo RESPONSE_, misma numeración.
const INPUT_FILE_NAME = 'ORD-0001234.json';
const EXPECTED_OUTPUT_NAME = 'RESPONSE_ORD-0001234.json';

// La llave que tests/setup.js fija para el contrato v2. Se usa para afirmar que
// no aparece en nada de lo que se escribe.
const V2_API_KEY = process.env.SYNEXUS_API_KEY;

/**
 * Un cuerpo v2 de cotización, el que produce la extracción del ERP.
 * @returns {Object} Cuerpo de entrada
 */
const createV2Body = () => ({
    invoice_id: 'DEMO-001',
    customer_id: 'CUST-1',
    to_state: 'TX',
    to_zip: '75001',
    cart: [{ item_id: 'SKU-1', price: 49.99, quantity: 1, tax_code: 'TPP' }]
});

describe('Un fallo bajo v2 deja el archivo de respuesta de siempre (FileManager real)', () => {
    let inputDir;
    let outputDir;
    let inputFilePath;
    let originalOutputDir;
    let originalTaxApiVersion;
    let originalSynexusEntity;
    let consoleLogSpy;
    let consoleErrorSpy;

    beforeEach(() => {
        originalOutputDir = process.env.OUTPUT_DIR;
        originalTaxApiVersion = process.env.TAX_API_VERSION;
        originalSynexusEntity = process.env.SYNEXUS_ENTITY;
        delete process.env.TAX_API_VERSION;
        delete process.env.SYNEXUS_ENTITY;

        inputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexgen-errfile-in-'));
        outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexgen-errfile-out-'));
        process.env.OUTPUT_DIR = outputDir;

        inputFilePath = path.join(inputDir, INPUT_FILE_NAME);
        fs.writeFileSync(inputFilePath, JSON.stringify(createV2Body(), null, 2));

        consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
        consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
        axios.mockReset();
    });

    afterEach(() => {
        if (originalOutputDir === undefined) {
            delete process.env.OUTPUT_DIR;
        } else {
            process.env.OUTPUT_DIR = originalOutputDir;
        }
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
        fs.rmSync(inputDir, { recursive: true, force: true });
        fs.rmSync(outputDir, { recursive: true, force: true });
        consoleLogSpy.mockRestore();
        consoleErrorSpy.mockRestore();
    });

    /**
     * El grafo de index.js a mano, con el FileManager REAL. Sólo axios está
     * sustituido y el logger es el doble.
     * @param {string[]} args - Argumentos tal como llegarían en process.argv.slice(2)
     * @returns {Object} handler y colaboradores
     */
    const buildRealGraph = (args) => {
        const logger = fakes.createFakeLogger();
        const fileManager = new FileManager(logger);
        const validator = new TaxValidator(logger);
        const apiClient = new TaxApiClient(config, logger);
        const requestBuilder = new SynexusRequestBuilder(logger);

        const apiVersion = TaxCommandHandler.resolveApiVersion(args, config, logger);
        let synexusConfig = null;
        let synexusApiClient = null;
        if (apiVersion === 'v2') {
            synexusConfig = new SynexusConfig();
            // wait inyectado: varios casos de aquí provocan el reintento y la
            // espera real de 1000 ms dormiría la suite. Misma inyección que usa
            // el plan 02-04; no cambia ninguna decisión de reintento
            synexusApiClient = new SynexusApiClient(synexusConfig, logger, { wait: () => Promise.resolve() });
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

        return { handler, logger, fileManager };
    };

    const v2Args = () => ['get_tax', inputFilePath, '--api-version=v2', '--entity=USA'];
    const writtenFiles = () => fs.readdirSync(outputDir);
    const readWrittenText = () => fs.readFileSync(path.join(outputDir, EXPECTED_OUTPUT_NAME), 'utf8');
    const readWritten = () => JSON.parse(readWrittenText());

    /**
     * Corre y devuelve el error, sin dejar que tumbe la prueba.
     * @param {string[]} args - Argumentos de la corrida
     * @returns {Promise<Error|null>} El error capturado
     */
    const runAndCatch = async (args) => {
        const { handler } = buildRealGraph(args);
        try {
            await handler.execute(args);
            return null;
        } catch (error) {
            return error;
        }
    };

    describe('1. El proveedor respondió con error: su cuerpo se archiva tal cual', () => {
        const providerBody = {
            error: 'unprocessable',
            code: 'tax_code_missing',
            message: 'tax_code is required',
            details: [{ field: 'cart[0].tax_code', code: 'missing' }],
            docs_url: 'https://docs.synexustax.com/errors/tax_code_missing',
            request_id: 'rid-422-disco'
        };

        beforeEach(async () => {
            axios.mockResolvedValue(fakes.createAxiosResponse(422, providerBody, { 'x-request-id': 'rid-422-disco' }));
        });

        it('el archivo existe, se llama RESPONSE_ORD-0001234.json y es el único: mismo nombre, mismo prefijo, misma numeración', async () => {
            await runAndCatch(v2Args());

            expect(writtenFiles()).toEqual([EXPECTED_OUTPUT_NAME]);
        });

        it('el contenido es el cuerpo del proveedor COMPLETO, sin recortar: también docs_url, que sólo se filtra de la consola', async () => {
            await runAndCatch(v2Args());

            expect(readWritten()).toEqual(providerBody);
            expect(readWritten().docs_url).toBe('https://docs.synexustax.com/errors/tax_code_missing');
        });

        it('la corrida SIGUE fallando: haber escrito no convierte el 422 en éxito', async () => {
            const caught = await runAndCatch(v2Args());

            expect(caught).not.toBeNull();
            expect(caught.message.startsWith('Error HTTP 422 (tax_code_missing): ')).toBe(true);
        });

        it('un 5xx, donde axios rechaza y el cuerpo viaja en error.response.data, se archiva igual', async () => {
            const serverBody = { error: 'internal', code: 'internal_error', message: 'boom' };
            const axiosError = new Error('Request failed with status code 500');
            axiosError.response = { status: 500, statusText: 'Internal Server Error', data: serverBody, headers: {} };
            axios.mockRejectedValue(axiosError);

            const caught = await runAndCatch(v2Args());

            expect(caught).toBe(axiosError);
            expect(writtenFiles()).toEqual([EXPECTED_OUTPUT_NAME]);
            expect(readWritten()).toEqual(serverBody);
        });

        it('lo archivado no contiene la llave por ninguna vía', async () => {
            await runAndCatch(v2Args());

            expect(readWrittenText()).not.toContain(V2_API_KEY);
            expect(readWrittenText()).not.toContain('Authorization');
            expect(readWrittenText()).not.toContain('Bearer');
        });
    });

    describe('2. El proveedor no respondió: se archiva el detalle propio de nexgen', () => {
        beforeEach(() => {
            const timeout = new Error('timeout of 30000ms exceeded');
            timeout.code = 'ECONNABORTED';
            axios.mockRejectedValue(timeout);
        });

        it('el archivo existe con el nombre de siempre', async () => {
            await runAndCatch(v2Args());

            expect(writtenFiles()).toEqual([EXPECTED_OUTPUT_NAME]);
        });

        it('el contenido dice que la fuente es nexgen y NO se parece a un cálculo: el ERP puede distinguirlo', async () => {
            await runAndCatch(v2Args());
            const written = readWritten();

            expect(written.error.source).toBe('nexgen');
            expect(written.error.code).toBe('ECONNABORTED');
            expect(written.error.provider_responded).toBe(false);
            expect(written.error.operation).toBe('get_tax');
            expect(written.totals).toBeUndefined();
            expect(written.transaction).toBeUndefined();
            expect(written.cart).toBeUndefined();
        });

        it('lleva la llave de idempotencia que generó nexgen, para correlacionar si el proveedor sí la recibió', async () => {
            await runAndCatch(v2Args());

            expect(readWritten().error.request_id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
        });

        it('lleva una marca de tiempo ISO de cuándo se archivó', async () => {
            await runAndCatch(v2Args());

            expect(() => new Date(readWritten().error.timestamp).toISOString()).not.toThrow();
        });

        it('no contiene la llave', async () => {
            await runAndCatch(v2Args());

            expect(readWrittenText()).not.toContain(V2_API_KEY);
        });
    });

    describe('3. La corrida abortó antes de salir a la red: también deja archivo', () => {
        it('un archivo que contradice la operación (transaction_type sales_invoice bajo get_tax) aborta, no llama a axios y deja el detalle de nexgen', async () => {
            const contradictorio = Object.assign(createV2Body(), { transaction_type: 'sales_invoice', committed: true });
            fs.writeFileSync(inputFilePath, JSON.stringify(contradictorio, null, 2));

            const caught = await runAndCatch(v2Args());

            expect(caught).not.toBeNull();
            expect(axios).not.toHaveBeenCalled();
            expect(writtenFiles()).toEqual([EXPECTED_OUTPUT_NAME]);
            expect(readWritten().error.source).toBe('nexgen');
            expect(readWritten().error.message).toContain('sales_estimate');
        });

        it('sin código de entidad por ninguna vía, aborta y deja el detalle de nexgen nombrando las tres vías', async () => {
            const args = ['get_tax', inputFilePath, '--api-version=v2'];

            const caught = await runAndCatch(args);

            expect(caught).not.toBeNull();
            expect(axios).not.toHaveBeenCalled();
            expect(readWritten().error.message).toContain('--entity=<codigo>');
            // Abortó antes de construir el cuerpo: no hay llave propia que citar
            expect(readWritten().error.request_id).toBeNull();
        });

        it('un archivo del contrato v1 bajo v2 aborta y deja el detalle, no el archivo de entrada', async () => {
            fs.writeFileSync(inputFilePath, JSON.stringify({ Committed: false, cartID: 'CART-1', ToState: 'TX', cart: [] }, null, 2));

            await runAndCatch(v2Args());

            expect(readWritten().error.message).toContain('parece del contrato v1');
            expect(readWritten().Committed).toBeUndefined();
        });
    });

    describe('4. El archivo anterior se reemplaza: el ERP nunca lee un cálculo viejo como si fuera de ahora', () => {
        it('tras una corrida exitosa, una fallida sobrescribe el RESPONSE_ con el error', async () => {
            // Primera corrida: éxito, deja el cálculo
            const calculo = { transaction: { invoice_id: 'DEMO-001' }, totals: { tax_amount: '4.12' } };
            axios.mockResolvedValue(fakes.createAxiosResponse(200, calculo));
            await runAndCatch(v2Args());
            expect(readWritten().totals.tax_amount).toBe('4.12');

            // Segunda corrida: el proveedor falla
            const errorBody = { error: 'unprocessable', code: 'tax_code_missing', message: 'tax_code is required' };
            axios.mockReset();
            axios.mockResolvedValue(fakes.createAxiosResponse(422, errorBody));
            await runAndCatch(v2Args());

            expect(writtenFiles()).toEqual([EXPECTED_OUTPUT_NAME]);
            expect(readWritten()).toEqual(errorBody);
            expect(readWritten().totals).toBeUndefined();
        });
    });

    describe('5. A prueba de errores: si escribir falla, el error que llega es el ORIGINAL', () => {
        /**
         * Grafo con un FileManager real al que se le rompe la escritura, como
         * si el disco estuviera lleno o faltaran permisos.
         * @param {string[]} args - Argumentos de la corrida
         * @returns {Object} handler y el logger doble
         */
        const buildGraphConEscrituraRota = (args) => {
            const graph = buildRealGraph(args);
            jest.spyOn(graph.fileManager, 'writeJsonFile').mockImplementation(() => {
                throw new Error('EACCES: permission denied');
            });
            return graph;
        };

        it('el error que se propaga es el del proveedor, no el de la escritura: el diagnóstico no se enmascara', async () => {
            const providerBody = { error: 'unprocessable', code: 'tax_code_missing', message: 'tax_code is required' };
            axios.mockResolvedValue(fakes.createAxiosResponse(422, providerBody));
            const args = v2Args();
            const { handler } = buildGraphConEscrituraRota(args);

            let caught = null;
            try {
                await handler.execute(args);
            } catch (error) {
                caught = error;
            }

            expect(caught).not.toBeNull();
            expect(caught.message.startsWith('Error HTTP 422 (tax_code_missing): ')).toBe(true);
            expect(caught.message).not.toContain('EACCES');
        });

        it('el fallo de escritura se reporta aparte, en consola y en el log', async () => {
            axios.mockResolvedValue(fakes.createAxiosResponse(422, { code: 'tax_code_missing', message: 'x' }));
            const args = v2Args();
            const { handler, logger } = buildGraphConEscrituraRota(args);

            try {
                await handler.execute(args);
            } catch (error) {
                // El error original; ya se afirmó en el caso anterior
            }

            const consola = consoleErrorSpy.mock.calls.map(call => String(call[0]));
            expect(consola.some(line => line.includes('No se pudo escribir el archivo de respuesta'))).toBe(true);
            expect(logger.error.mock.calls.some(call => String(call[0]).includes('No se pudo escribir el archivo de respuesta'))).toBe(true);
        });

        it('un cuerpo que NO es JSON —el HTML de un gateway en un 502— se archiva igual, y es lo que el ERP detecta como "no es un JSON"', async () => {
            // El caso que describió el área de ERP: lee el archivo y, si lo que
            // encuentra no es el cálculo que espera, lo caza por su lado. Un
            // proxy delante del proveedor devuelve HTML, no JSON; axios lo
            // entrega como cadena y así se archiva.
            const html = '<html><head><title>502 Bad Gateway</title></head><body>nginx</body></html>';
            const axiosError = new Error('Request failed with status code 502');
            axiosError.response = { status: 502, statusText: 'Bad Gateway', data: html, headers: {} };
            // Sin reintento: la espera real dormiría la suite
            axios.mockRejectedValueOnce(axiosError).mockRejectedValueOnce(axiosError);

            const caught = await runAndCatch(v2Args());

            expect(caught).toBe(axiosError);
            expect(writtenFiles()).toEqual([EXPECTED_OUTPUT_NAME]);
            // El contenido es la cadena, no un cálculo: parsea a string, no a objeto
            expect(readWritten()).toBe(html);
            expect(typeof readWritten()).toBe('string');
        });
    });

    describe('6. v1 no cambió: un fallo bajo v1 no escribe nada (COMP-01)', () => {
        it('una corrida v1 que aborta en la validación de Committed no deja archivo alguno', async () => {
            // Archivo del contrato v1 con Committed invertido para get_tax
            fs.writeFileSync(inputFilePath, JSON.stringify({ Committed: true, cartID: 'CART-1' }, null, 2));
            const args = ['get_tax', inputFilePath];

            const caught = await runAndCatch(args);

            expect(caught).not.toBeNull();
            expect(caught.message).toContain('debe ser false');
            expect(writtenFiles()).toEqual([]);
        });

        it('una corrida v1 cuyo proveedor responde 400 tampoco deja archivo', async () => {
            fs.writeFileSync(inputFilePath, JSON.stringify({ Committed: false, cartID: 'CART-1' }, null, 2));
            axios.mockResolvedValue(fakes.createAxiosResponse(400, { Message: 'bad request' }));
            const args = ['get_tax', inputFilePath];

            const caught = await runAndCatch(args);

            expect(caught).not.toBeNull();
            expect(writtenFiles()).toEqual([]);
        });
    });
});
