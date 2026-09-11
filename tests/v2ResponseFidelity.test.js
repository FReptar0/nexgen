// tests/v2ResponseFidelity.test.js
// La respuesta real de staging como fixture de contrato, y la fidelidad de lo
// que nexgen escribe para el ERP — con el FileManager REAL, sobre disco.
//
// Los fixtures. tests/fixtures/synexus-staging-2026-09-09-{request,response}.json
// son la petición y la respuesta REALES contra compute.staging.synexustax.com
// del 9-sep-2026, recibidas del área de ERP por correo y copiadas byte a byte
// desde data/fixtures/ (fuera de git). Son seguras de versionar: no traen
// credenciales (la llave y el código de entidad viajaron en headers, que no se
// archivan) ni nombres de personas ni del cliente. entity_id 635 y client_id
// "E635" son identificadores del sandbox; DEMO-001 y CUST-1, valores de
// demostración. Son de CONTRATO: describen lo que el proveedor devuelve hoy.
//
//   1. VERIF-01 — el primer describe afirma la FORMA de la respuesta: llaves de
//      primer nivel, montos como cadenas, meta.request_id, warnings como arreglo.
//      Si el proveedor cambia y alguien actualiza el fixture, esto se pone en
//      rojo y obliga a mirar. tax_amount "0.00" NO es un fallo: es no_nexus.
//   2. COMP-02, COMP-03, SAFE-04, TEST-04 — el segundo describe arma el grafo de
//      index.js a mano (como buildGraph en v2QuoteEndToEnd.test.js) con el
//      FileManager REAL y afirma que la respuesta llega a RESPONSE_<original>
//      con el mismo nombre, la misma numeración, en el directorio de salida,
//      con el cuerpo completo y cada monto entre comillas, dígito por dígito.
//
// Es el ÚNICO archivo de la suite que instancia el FileManager real y que toca
// disco: siempre bajo os.tmpdir() con mkdtempSync, nunca dentro del repositorio
// ni en un OUTPUT_DIR real, y borra lo suyo en afterEach.
// .planning/codebase/CONCERNS.md señalaba que fileManager.js nunca se
// instanciaba en pruebas; desde este archivo, sí. El Logger real sigue fuera de
// alcance por decisión de la fase: aquí es el doble.
//
// Sobre fs y os aquí: la regla "fs sólo en FileManager" es de las capas de
// src/, no de las pruebas; esta prueba necesita leer lo que el FileManager real
// escribió.
//
// Validación por mutación (convención de la suite, .planning/codebase/TESTING.md):
// insertar temporalmente una conversión —parseFloat sobre totals.tax_amount en
// _handleResponse del cliente v2, o en writeJsonFile— pone en rojo las
// aserciones de texto crudo del segundo describe. Se ejecutó y se restauró
// antes de commitear; el resultado está en 02-01-SUMMARY.md.
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

const FIXTURES_DIR = path.join(__dirname, 'fixtures');
const REQUEST_FIXTURE = path.join(FIXTURES_DIR, 'synexus-staging-2026-09-09-request.json');
const RESPONSE_FIXTURE = path.join(FIXTURES_DIR, 'synexus-staging-2026-09-09-response.json');

// Se leen con fs en cada caso, no con require: require cachea el objeto y un
// caso que lo mutara contaminaría al siguiente.
const readFixture = (fixturePath) => JSON.parse(fs.readFileSync(fixturePath, 'utf8'));

// Copia profunda: lo que alimenta al doble de axios nunca es el mismo objeto
// contra el que se compara al final.
const deepCopy = (value) => JSON.parse(JSON.stringify(value));

// Cadena decimal: dígitos, punto, dígitos. Es la forma en que el contrato v2
// devuelve todo monto y toda tasa. Un número JSON no la cumple: typeof lo
// separa antes de llegar aquí.
const DECIMAL_STRING = /^-?\d+\.\d+$/;

// Las once llaves de monto de totals. invoice_discount_percent NO está: es
// número en el contrato. fees y exemption son objetos, no montos.
const TOTALS_AMOUNT_KEYS = [
    'tax_rate',
    'pre_tax_amount',
    'taxable_amount',
    'tax_amount',
    'total',
    'discount_amount',
    'amount_subject_to_discount',
    'invoice_discount_amount',
    'shipping_cost',
    'shipping_tax',
    'total_fees'
];

// Las llaves de monto de cada línea del carrito. quantity y discount_percent
// son números; tax_rate puede ser null y se afirma aparte.
const CART_LINE_AMOUNT_KEYS = ['price', 'discount_amount', 'taxable_amount', 'tax_amount'];

describe('VERIF-01 — la respuesta real de staging es el fixture de contrato: su forma se afirma, y si el proveedor cambia y alguien actualiza el fixture, esto se pone en rojo', () => {
    it('las llaves de primer nivel, ordenadas, son exactamente cart, destination, meta, origin, totals, transaction, warnings', () => {
        const response = readFixture(RESPONSE_FIXTURE);

        // toEqual sobre el arreglo completo: una llave de más o de menos falla
        expect(Object.keys(response).sort()).toEqual([
            'cart', 'destination', 'meta', 'origin', 'totals', 'transaction', 'warnings'
        ]);
    });

    it.each(TOTALS_AMOUNT_KEYS)('totals.%s es una cadena decimal, no un número', (key) => {
        const { totals } = readFixture(RESPONSE_FIXTURE);

        expect(typeof totals[key]).toBe('string');
        expect(totals[key]).toMatch(DECIMAL_STRING);
    });

    it('la lista de montos de totals tiene once llaves y NO incluye invoice_discount_percent, que es número en el contrato', () => {
        const { totals } = readFixture(RESPONSE_FIXTURE);

        expect(TOTALS_AMOUNT_KEYS).toHaveLength(11);
        expect(TOTALS_AMOUNT_KEYS).not.toContain('invoice_discount_percent');
        expect(typeof totals.invoice_discount_percent).toBe('number');
    });

    it('cart es un arreglo no vacío y en cada línea price, discount_amount, taxable_amount y tax_amount son cadenas decimales', () => {
        const { cart } = readFixture(RESPONSE_FIXTURE);

        expect(Array.isArray(cart)).toBe(true);
        expect(cart.length).toBeGreaterThan(0);
        cart.forEach(line => {
            CART_LINE_AMOUNT_KEYS.forEach(key => {
                expect(typeof line[key]).toBe('string');
                expect(line[key]).toMatch(DECIMAL_STRING);
            });
        });
    });

    it('en cada línea del carrito tax_rate es null o una cadena decimal', () => {
        const { cart } = readFixture(RESPONSE_FIXTURE);

        cart.forEach(line => {
            if (line.tax_rate !== null) {
                expect(typeof line.tax_rate).toBe('string');
                expect(line.tax_rate).toMatch(DECIMAL_STRING);
            }
        });
    });

    it('meta.request_id es una cadena no vacía con forma de UUID', () => {
        const { meta } = readFixture(RESPONSE_FIXTURE);

        expect(typeof meta.request_id).toBe('string');
        expect(meta.request_id.length).toBeGreaterThan(0);
        expect(meta.request_id).toMatch(/^[0-9a-f-]{36}$/);
    });

    it('warnings es un arreglo', () => {
        const { warnings } = readFixture(RESPONSE_FIXTURE);

        expect(Array.isArray(warnings)).toBe(true);
    });

    it('transaction.transaction_type es cadena, y transaction_purpose PUEDE coexistir: si está es cadena, y nunca se exige su ausencia (ventana de deprecación del proveedor)', () => {
        const { transaction } = readFixture(RESPONSE_FIXTURE);

        expect(typeof transaction.transaction_type).toBe('string');
        if (transaction.transaction_purpose !== undefined) {
            expect(typeof transaction.transaction_purpose).toBe('string');
        }
    });

    it('totals.tax_amount es la cadena "0.00" porque totals.exemption.source es "no_nexus": el cero NO es un fallo', () => {
        const { totals } = readFixture(RESPONSE_FIXTURE);

        expect(totals.tax_amount).toBe('0.00');
        expect(totals.exemption.source).toBe('no_nexus');
    });

    it('el fixture de petición trae invoice_id, customer_id, to_state, to_zip y un cart con tax_code en cada línea', () => {
        const request = readFixture(REQUEST_FIXTURE);

        expect(typeof request.invoice_id).toBe('string');
        expect(typeof request.customer_id).toBe('string');
        expect(typeof request.to_state).toBe('string');
        expect(typeof request.to_zip).toBe('string');
        expect(Array.isArray(request.cart)).toBe(true);
        expect(request.cart.length).toBeGreaterThan(0);
        request.cart.forEach(line => {
            expect(typeof line.tax_code).toBe('string');
        });
    });

    it('el fixture de petición NO trae Committed, transaction_type, committed ni request_id: así lo deja el área de ERP y así lo exige la rama v2', () => {
        const request = readFixture(REQUEST_FIXTURE);

        expect(request).not.toHaveProperty('Committed');
        expect(request).not.toHaveProperty('transaction_type');
        expect(request).not.toHaveProperty('committed');
        expect(request).not.toHaveProperty('request_id');
    });
});

describe('COMP-02, COMP-03, SAFE-04, TEST-04 — con el FileManager REAL, la respuesta llega al archivo del ERP íntegra', () => {
    // Un nombre con numeración, para que COMP-02 tenga algo que conservar.
    const INPUT_FILE_NAME = 'ORD-0001234.json';
    const EXPECTED_OUTPUT_NAME = 'RESPONSE_ORD-0001234.json';

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

        // Dos directorios temporales bajo os.tmpdir(): entrada y salida. El
        // Config real lee OUTPUT_DIR en cada llamada, así que apuntarlo aquí
        // basta para que _saveResponse escriba en el de salida.
        inputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexgen-fidelity-in-'));
        outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexgen-fidelity-out-'));
        process.env.OUTPUT_DIR = outputDir;

        // El fixture de petición, escrito con el nombre numerado del ERP
        inputFilePath = path.join(inputDir, INPUT_FILE_NAME);
        fs.writeFileSync(inputFilePath, fs.readFileSync(REQUEST_FIXTURE));

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
     * El grafo de index.js a mano, como buildGraph de v2QuoteEndToEnd.test.js,
     * con una sola diferencia: el FileManager es el REAL. Config, TaxValidator,
     * TaxApiClient, SynexusConfig, SynexusRequestBuilder y SynexusApiClient son
     * reales; sólo axios está sustituido y el logger es el doble.
     * @param {string[]} args - Argumentos tal como llegarían en process.argv.slice(2)
     * @returns {Object} handler y colaboradores para las aserciones
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

        return { handler, logger, fileManager };
    };

    const writtenFiles = () => fs.readdirSync(outputDir);
    const readWrittenText = () => fs.readFileSync(path.join(outputDir, EXPECTED_OUTPUT_NAME), 'utf8');

    describe('get_tax <ruta> --api-version=v2 --entity=USA con el fixture real como respuesta del proveedor', () => {
        let inputBytesBefore;

        beforeEach(async () => {
            inputBytesBefore = fs.readFileSync(inputFilePath);
            axios.mockResolvedValue(fakes.createAxiosResponse(200, deepCopy(readFixture(RESPONSE_FIXTURE))));
            const args = ['get_tax', inputFilePath, '--api-version=v2', '--entity=USA'];
            const { handler } = buildRealGraph(args);

            await handler.execute(args);
        });

        it('en el directorio de salida existe exactamente un archivo y se llama RESPONSE_ORD-0001234.json: nombre original, prefijo, numeración y directorio (COMP-02)', () => {
            expect(writtenFiles()).toEqual([EXPECTED_OUTPUT_NAME]);
            expect(fs.existsSync(path.join(outputDir, EXPECTED_OUTPUT_NAME))).toBe(true);
        });

        it('el archivo escrito, parseado, es igual al fixture completo: cuerpo entero, sin transformar (COMP-03)', () => {
            // Comparación por objeto, no por cadena, para no acoplarse a la indentación
            expect(JSON.parse(readWrittenText())).toEqual(readFixture(RESPONSE_FIXTURE));
        });

        it('el TEXTO crudo lleva los montos entre comillas: "tax_amount": "0.00" y "pre_tax_amount": "49.99", nunca como números (SAFE-04, TEST-04)', () => {
            const text = readWrittenText();

            expect(text).toContain('"tax_amount": "0.00"');
            expect(text).toContain('"pre_tax_amount": "49.99"');
            expect(text).not.toMatch(/"tax_amount": 0[,\n]/);
            expect(text).not.toMatch(/"pre_tax_amount": 49\.99/);
        });

        it('el archivo de entrada queda byte a byte igual que antes de la corrida', () => {
            expect(fs.readFileSync(inputFilePath).equals(inputBytesBefore)).toBe(true);
        });

        it('la corrida terminó con éxito y escribió el archivo aunque tax_amount sea "0.00": el cero (no_nexus) no aborta nada', () => {
            expect(consoleLogSpy).toHaveBeenCalledWith('Operación get_tax completada exitosamente');
            expect(consoleLogSpy).toHaveBeenCalledWith(`SUCCESS: get_tax - File: ${INPUT_FILE_NAME}`);
            expect(consoleErrorSpy).not.toHaveBeenCalled();
        });
    });

    it('post_tax <ruta> --api-version=v2 --entity=USA con el mismo fixture escribe el mismo nombre y el mismo contenido íntegro: COMP-02 no depende de la operación', async () => {
        axios.mockResolvedValue(fakes.createAxiosResponse(200, deepCopy(readFixture(RESPONSE_FIXTURE))));
        const args = ['post_tax', inputFilePath, '--api-version=v2', '--entity=USA'];
        const { handler } = buildRealGraph(args);

        await handler.execute(args);

        expect(writtenFiles()).toEqual([EXPECTED_OUTPUT_NAME]);
        expect(JSON.parse(readWrittenText())).toEqual(readFixture(RESPONSE_FIXTURE));
        expect(readWrittenText()).toContain('"tax_amount": "0.00"');
        expect(consoleLogSpy).toHaveBeenCalledWith(`SUCCESS: post_tax - File: ${INPUT_FILE_NAME}`);
    });

    it('con una respuesta SINTÉTICA, los dígitos que un punto flotante alteraría llegan intactos: "0.0825", "1234567.89" y "0.10" (SAFE-04, TEST-04)', async () => {
        // JSON.stringify(parseFloat('0.10')) es '0.1' —un dígito menos— y es lo
        // que esta aserción detecta. El fixture real trae ceros que un parseFloat
        // dejaría casi iguales; estos valores no le dan esa suerte.
        const syntheticResponse = {
            totals: { tax_rate: '0.0825', tax_amount: '1234567.89', discount_amount: '0.10' },
            cart: [{ price: '0.10', tax_amount: '1234567.89' }],
            warnings: [],
            meta: { request_id: 'sintetico-01' }
        };
        axios.mockResolvedValue(fakes.createAxiosResponse(200, deepCopy(syntheticResponse)));
        const args = ['get_tax', inputFilePath, '--api-version=v2', '--entity=USA'];
        const { handler } = buildRealGraph(args);

        await handler.execute(args);

        const text = readWrittenText();
        expect(text).toContain('"tax_rate": "0.0825"');
        expect(text).toContain('"tax_amount": "1234567.89"');
        expect(text).toContain('"discount_amount": "0.10"');
        expect(text).toContain('"price": "0.10"');
        expect(text).not.toMatch(/"tax_rate": 0\.0825/);
        expect(text).not.toMatch(/"tax_amount": 1234567\.89/);
        expect(text).not.toMatch(/"discount_amount": 0\.1/);
        expect(text).not.toMatch(/"price": 0\.1/);
        expect(JSON.parse(text)).toEqual(syntheticResponse);
    });
});
