// tests/v2IntentValidation.test.js
// La validación de los campos de intención bajo el contrato v2 y el orden de la
// rama v2 de execute():
//   1. validateV2IntentFields como método hermano de validateCommittedField:
//      guardia de archivo v1, regla de contradicción (OPER-04 bajo v2) y el
//      campo request_id como propiedad de nexgen.
//   2. validateV2FileShape: la forma del archivo bajo v2 —objeto, no arreglo
//      (WR-04), y no de v1— comprobada antes de resolver la entidad.
//   3. El recorrido de _executeV2 con el TaxValidator REAL: qué se llama, en
//      qué orden, con qué argumentos, qué NO se llama nunca (validate,
//      validateCommittedField y, desde WR-03, sanitizeStringFields: el cuerpo
//      viaja CRUDO), y que termina emitiendo con el cliente v2 —o en la
//      guardia de cableado si ese cliente no se inyectó.
//
// Ningún archivo de prueba requiere index.js (ejecuta main() al cargarse).
const TaxValidator = require('../src/validators/taxValidator');
const TaxCommandHandler = require('../src/cli/taxCommandHandler');
const SynexusRequestBuilder = require('../src/api/synexusRequestBuilder');
const fakes = require('./helpers/fakes');

// La intención que devuelve SynexusRequestBuilder.getIntentFor('get_tax'). Aquí
// va literal a propósito: el validador la recibe como argumento y no guarda su
// propia copia, así que la prueba unitaria tampoco depende del builder.
const expectedIntent = { transaction_type: 'sales_estimate', committed: false };

// La intención que devuelve SynexusRequestBuilder.getIntentFor('post_tax'): el
// espejo exacto de la anterior. También literal: el validador compara contra lo
// que recibe, así que sus reglas para post_tax se prueban sin el builder.
const postTaxExpectedIntent = { transaction_type: 'sales_invoice', committed: true };

// Cuerpo con forma v2, calcado del ejemplo de postman/synexus-v2-api.postman_collection.json.
// Sin Committed, committed, transaction_type ni request_id: es exactamente el
// archivo que deja el área de ERP, y el caso más importante de este archivo.
const createV2Body = () => ({
    invoice_id: 'DEMO-001',
    customer_id: 'CUST-1',
    to_state: 'TX',
    to_zip: '75001',
    cart: [
        { item_id: 'SKU-1', price: 49.99, quantity: 1, tax_code: 'TPP' }
    ]
});

// Cuerpo con forma v1: Committed en mayúscula y sin campos en minúsculas.
const createV1Body = () => ({
    Committed: false,
    cartID: 'CART-1'
});

const v1FileGuardMessage = 'parece del contrato v1';

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

describe('validateV2IntentFields — método hermano de validateCommittedField, sólo para la rama v2', () => {
    let validator;
    let logger;

    beforeEach(() => {
        logger = fakes.createFakeLogger();
        validator = new TaxValidator(logger);
    });

    describe('el caso normal: el archivo que deja el área de ERP', () => {
        it('un cuerpo con forma v2, sin ningún campo de intención, NO lanza', () => {
            expect(() => validator.validateV2IntentFields('get_tax', createV2Body(), expectedIntent)).not.toThrow();
            expect(consoleErrorSpy).not.toHaveBeenCalled();
            expect(logger.error).not.toHaveBeenCalled();
        });

        it('no muta el cuerpo: sigue sin campos de intención después de validar', () => {
            const body = createV2Body();
            const snapshot = JSON.parse(JSON.stringify(body));

            validator.validateV2IntentFields('get_tax', body, expectedIntent);

            expect(body).toEqual(snapshot);
        });
    });

    describe('guardia de archivo v1: Committed con mayúscula', () => {
        it('con Committed: true lanza diciendo que el archivo parece del contrato v1 y cita "Committed"', () => {
            const body = createV2Body();
            body.Committed = true;

            expect(() => validator.validateV2IntentFields('get_tax', body, expectedIntent)).toThrow(v1FileGuardMessage);
            expect(() => validator.validateV2IntentFields('get_tax', body, expectedIntent)).toThrow('"Committed"');
        });

        it('con Committed: false lanza igual: la guardia comprueba presencia, no veracidad', () => {
            const body = createV2Body();
            body.Committed = false;

            expect(() => validator.validateV2IntentFields('get_tax', body, expectedIntent)).toThrow(v1FileGuardMessage);
        });

        it('con un archivo v1 puro (Committed: false, sin campos en minúsculas) el mensaje es el de la guardia', () => {
            expect(() => validator.validateV2IntentFields('get_tax', createV1Body(), expectedIntent)).toThrow(v1FileGuardMessage);
        });

        it('la guardia corre ANTES que las comprobaciones de contradicción: con Committed y transaction_type contradictorio, el mensaje es el de la guardia', () => {
            const body = createV2Body();
            body.Committed = false;
            body.transaction_type = 'sales_invoice';
            body.committed = true;

            let caught = null;
            try {
                validator.validateV2IntentFields('get_tax', body, expectedIntent);
            } catch (error) {
                caught = error;
            }

            expect(caught).not.toBeNull();
            expect(caught.message).toContain(v1FileGuardMessage);
            expect(caught.message).not.toContain('sales_invoice');
        });

        it('el mensaje orienta: o el archivo está en forma v1 o el selector debería ser v1', () => {
            const body = createV2Body();
            body.Committed = false;

            expect(() => validator.validateV2IntentFields('get_tax', body, expectedIntent)).toThrow(/selector/);
        });

        it('usa el trío del repositorio: console.error + logger.error + throw', () => {
            const body = createV2Body();
            body.Committed = false;

            expect(() => validator.validateV2IntentFields('get_tax', body, expectedIntent)).toThrow();
            expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
            expect(logger.error).toHaveBeenCalledTimes(1);
            expect(logger.error.mock.calls[0][0]).toContain(v1FileGuardMessage);
        });
    });

    describe('transaction_type: contradecir aborta, coincidir se tolera', () => {
        it('get_tax con transaction_type sales_invoice lanza nombrando el valor del archivo y el de la operación', () => {
            const body = createV2Body();
            body.transaction_type = 'sales_invoice';

            expect(() => validator.validateV2IntentFields('get_tax', body, expectedIntent)).toThrow('sales_invoice');
            expect(() => validator.validateV2IntentFields('get_tax', body, expectedIntent)).toThrow('sales_estimate');
            expect(() => validator.validateV2IntentFields('get_tax', body, expectedIntent)).toThrow('"transaction_type"');
        });

        it('get_tax con transaction_type sales_estimate (coincidente) NO lanza', () => {
            const body = createV2Body();
            body.transaction_type = 'sales_estimate';

            expect(() => validator.validateV2IntentFields('get_tax', body, expectedIntent)).not.toThrow();
        });

        it('la contradicción se compara con ===: una variante de mayúsculas también contradice', () => {
            const body = createV2Body();
            body.transaction_type = 'Sales_Estimate';

            expect(() => validator.validateV2IntentFields('get_tax', body, expectedIntent)).toThrow('"transaction_type"');
        });

        it('el mensaje explica por qué se aborta en vez de sobreescribir', () => {
            const body = createV2Body();
            body.transaction_type = 'sales_invoice';

            expect(() => validator.validateV2IntentFields('get_tax', body, expectedIntent)).toThrow(/sobreescribir/);
        });
    });

    describe('committed: OPER-04 bajo el contrato v2, con comparación estricta', () => {
        it('get_tax con committed: true lanza, y el mensaje nombra committed', () => {
            const body = createV2Body();
            body.committed = true;

            expect(() => validator.validateV2IntentFields('get_tax', body, expectedIntent)).toThrow('"committed"');
            expect(() => validator.validateV2IntentFields('get_tax', body, expectedIntent)).toThrow('get_tax');
        });

        it('get_tax con committed: false (coincidente) NO lanza', () => {
            const body = createV2Body();
            body.committed = false;

            expect(() => validator.validateV2IntentFields('get_tax', body, expectedIntent)).not.toThrow();
        });

        it('la comparación es estricta: committed "false" (cadena) contradice a false (booleano)', () => {
            const body = createV2Body();
            body.committed = 'false';

            expect(() => validator.validateV2IntentFields('get_tax', body, expectedIntent)).toThrow('"committed"');
        });

        it('la comparación es estricta: committed 0 contradice a false', () => {
            const body = createV2Body();
            body.committed = 0;

            expect(() => validator.validateV2IntentFields('get_tax', body, expectedIntent)).toThrow('"committed"');
        });

        it('la contradicción se mide contra la intención recibida, no contra una copia propia del validador', () => {
            const body = createV2Body();
            body.committed = true;
            const otherIntent = { transaction_type: 'sales_invoice', committed: true };

            expect(() => validator.validateV2IntentFields('post_tax', body, otherIntent)).not.toThrow();
        });
    });

    describe('request_id: campo de nexgen', () => {
        it('un cuerpo que ya trae request_id lanza: uno heredado rompería la idempotencia', () => {
            const body = createV2Body();
            body.request_id = '11111111-1111-4111-8111-111111111111';

            expect(() => validator.validateV2IntentFields('get_tax', body, expectedIntent)).toThrow('"request_id"');
        });

        it('request_id vacío también lanza: la presencia es lo que se rechaza', () => {
            const body = createV2Body();
            body.request_id = '';

            expect(() => validator.validateV2IntentFields('get_tax', body, expectedIntent)).toThrow('"request_id"');
        });
    });

    describe('con la intención de post_tax: las mismas reglas, con la intención invertida (OPER-02, OPER-04 bajo v2)', () => {
        it('post_tax con committed: false lanza nombrando committed, la operación y el valor que debe llevar', () => {
            const body = createV2Body();
            body.committed = false;

            expect(() => validator.validateV2IntentFields('post_tax', body, postTaxExpectedIntent)).toThrow('"committed"');
            expect(() => validator.validateV2IntentFields('post_tax', body, postTaxExpectedIntent)).toThrow('post_tax');
            expect(() => validator.validateV2IntentFields('post_tax', body, postTaxExpectedIntent)).toThrow('debe ser true');
        });

        it('la comparación es estricta también aquí: committed "true" (cadena) contradice a true (booleano)', () => {
            const body = createV2Body();
            body.committed = 'true';

            expect(() => validator.validateV2IntentFields('post_tax', body, postTaxExpectedIntent)).toThrow('"committed"');
        });

        it('post_tax con transaction_type sales_estimate lanza citando el valor del archivo y el de la operación', () => {
            const body = createV2Body();
            body.transaction_type = 'sales_estimate';

            expect(() => validator.validateV2IntentFields('post_tax', body, postTaxExpectedIntent)).toThrow('sales_estimate');
            expect(() => validator.validateV2IntentFields('post_tax', body, postTaxExpectedIntent)).toThrow('sales_invoice');
        });

        it('post_tax con committed: true y transaction_type sales_invoice (coincidentes) NO lanza', () => {
            const body = createV2Body();
            body.committed = true;
            body.transaction_type = 'sales_invoice';

            expect(() => validator.validateV2IntentFields('post_tax', body, postTaxExpectedIntent)).not.toThrow();
        });

        it('un archivo v1 con Committed: true bajo post_tax dispara la guardia de archivo v1, no la contradicción', () => {
            const body = createV2Body();
            body.Committed = true;

            expect(() => validator.validateV2IntentFields('post_tax', body, postTaxExpectedIntent)).toThrow(v1FileGuardMessage);
        });
    });

    describe('aislamiento respecto a v1', () => {
        it('validate() de v1 NO llama a validateV2IntentFields', () => {
            const spy = jest.spyOn(validator, 'validateV2IntentFields');

            validator.validate('get_tax', createV1Body());

            expect(spy).not.toHaveBeenCalled();
        });

        it('validateCommittedField sigue rechazando un cuerpo v2 con el mensaje literal de v1: no fue modificado', () => {
            expect(() => validator.validateCommittedField('get_tax', createV2Body()))
                .toThrow(new Error('Para la operación get_tax, el valor "Committed" debe ser false.'));
        });

        it('la lista de operaciones sigue siendo la de siempre', () => {
            expect(validator.getValidOperations()).toEqual(['get_tax', 'post_tax', 'cancel_tax']);
        });
    });
});

describe('validateV2FileShape — la forma del archivo bajo v2: objeto, no arreglo, y no de v1', () => {
    const arrayMessagePrefix = 'El archivo de entrada debe ser un objeto JSON, no un arreglo';
    let validator;
    let logger;

    beforeEach(() => {
        logger = fakes.createFakeLogger();
        validator = new TaxValidator(logger);
    });

    it('un arreglo con un objeto dentro lanza con un mensaje que EMPIEZA por "El archivo de entrada debe ser un objeto JSON, no un arreglo" (WR-04)', () => {
        let caught = null;
        try {
            validator.validateV2FileShape([{ invoice_id: 'X' }]);
        } catch (error) {
            caught = error;
        }

        expect(caught).not.toBeNull();
        expect(caught.message.startsWith(arrayMessagePrefix)).toBe(true);
    });

    it('un arreglo vacío lanza igual', () => {
        expect(() => validator.validateV2FileShape([])).toThrow(arrayMessagePrefix);
    });

    it('un objeto vacío y un cuerpo v2 normal no lanzan y no escriben en consola ni en el logger', () => {
        expect(() => validator.validateV2FileShape({})).not.toThrow();
        expect(() => validator.validateV2FileShape(createV2Body())).not.toThrow();
        expect(consoleErrorSpy).not.toHaveBeenCalled();
        expect(logger.error).not.toHaveBeenCalled();
    });

    it('un archivo v1 (Committed: false) lanza con el MISMO mensaje literal que produce validateV2IntentFields para ese archivo', () => {
        let fromFileShape = null;
        let fromIntentFields = null;
        try {
            validator.validateV2FileShape(createV1Body());
        } catch (error) {
            fromFileShape = error;
        }
        try {
            validator.validateV2IntentFields('get_tax', createV1Body(), expectedIntent);
        } catch (error) {
            fromIntentFields = error;
        }

        expect(fromFileShape).not.toBeNull();
        expect(fromIntentFields).not.toBeNull();
        expect(fromFileShape.message).toContain(v1FileGuardMessage);
        expect(fromFileShape.message).toBe(fromIntentFields.message);
    });

    it('un arreglo cuyo primer elemento trae Committed lanza el mensaje del arreglo, no el de v1: el arreglo se comprueba primero', () => {
        let caught = null;
        try {
            validator.validateV2FileShape([createV1Body()]);
        } catch (error) {
            caught = error;
        }

        expect(caught).not.toBeNull();
        expect(caught.message.startsWith(arrayMessagePrefix)).toBe(true);
        expect(caught.message).not.toContain(v1FileGuardMessage);
    });

    it('usa el trío del repositorio: console.error una vez, logger.error una vez, throw', () => {
        expect(() => validator.validateV2FileShape([])).toThrow();

        expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
        expect(logger.error).toHaveBeenCalledTimes(1);
        expect(logger.error.mock.calls[0][0]).toContain(arrayMessagePrefix);
    });

    it('validate() de v1 NO llama a validateV2FileShape: v1 intacto', () => {
        const spy = jest.spyOn(validator, 'validateV2FileShape');

        validator.validate('get_tax', createV1Body());

        expect(spy).not.toHaveBeenCalled();
    });
});

describe('Rama v2 de execute() — el recorrido de _executeV2 con el TaxValidator real', () => {
    // El validador es el TaxValidator REAL con espías que dejan pasar la llamada.
    // Es deliberado: es lo que prueba que un cuerpo SIN Committed atraviesa la
    // rama v2 sin ser rechazado por la validación de v1. Con un doble, el caso
    // sería una tautología sobre el doble.
    const wiringGuardMessage = 'Falta inyectar el cliente v2';
    const bodyTracePrefix = 'Cuerpo v2 a enviar:';

    /**
     * Arma el manejador con el validador real espiado y dobles literales para
     * el resto. requestBuilder es un doble con getIntentFor y buildRequestBody;
     * synexusApiClient es un doble con makeRequest (octavo colaborador desde el
     * plan 01-04), sustituible por null para probar la guardia de cableado.
     * @param {*} requestBody - Lo que readJsonFile devolverá
     * @param {Object} [builderOverrides] - Reemplazos para el doble del builder
     * @param {Object} [options] - synexusApiClient: reemplazo del doble del cliente v2
     * @returns {Object} handler y colaboradores para las aserciones
     */
    const buildHandler = (requestBody, builderOverrides, options) => {
        const settings = options || {};
        const validator = new TaxValidator(fakes.createFakeLogger());
        const spies = {
            validate: jest.spyOn(validator, 'validate'),
            validateCommittedField: jest.spyOn(validator, 'validateCommittedField'),
            validateRequestBody: jest.spyOn(validator, 'validateRequestBody'),
            sanitizeStringFields: jest.spyOn(validator, 'sanitizeStringFields'),
            validateV2FileShape: jest.spyOn(validator, 'validateV2FileShape'),
            validateV2IntentFields: jest.spyOn(validator, 'validateV2IntentFields')
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
        const requestBuilder = Object.assign({
            getIntentFor: jest.fn(() => ({ transaction_type: 'sales_estimate', committed: false })),
            buildRequestBody: jest.fn((operation, body) => Object.assign({}, body, {
                transaction_type: 'sales_estimate',
                committed: false,
                request_id: '22222222-2222-4222-8222-222222222222'
            }))
        }, builderOverrides || {});
        const synexusApiClient = settings.synexusApiClient !== undefined
            ? settings.synexusApiClient
            : { makeRequest: jest.fn(async () => ({ id: 'txn_1', total_tax: '0.00' })) };
        const handler = new TaxCommandHandler(
            fakes.createFakeConfig(),
            fakes.createFakeLogger(),
            fileManager,
            validator,
            apiClient,
            synexusConfig,
            requestBuilder,
            synexusApiClient
        );

        return { handler, spies, apiClient, synexusConfig, requestBuilder, synexusApiClient, fileManager };
    };

    const runV2 = (handler) => handler.execute(['get_tax', 'a.json', '--api-version=v2']);

    it('con un cuerpo v2 recorre la rama completa en el orden del contrato y termina emitiendo con el cliente v2', async () => {
        const { handler, spies, apiClient, synexusConfig, requestBuilder, synexusApiClient } = buildHandler(createV2Body());

        await expect(runV2(handler)).resolves.toBeUndefined();

        // Lo que NO se llama nunca bajo v2. sanitizeStringFields desde WR-03:
        // el escape de apóstrofos es de v1 y corrompería el cable v2
        expect(spies.validate).not.toHaveBeenCalled();
        expect(spies.validateCommittedField).not.toHaveBeenCalled();
        expect(spies.sanitizeStringFields).not.toHaveBeenCalled();
        expect(apiClient.makeRequest).not.toHaveBeenCalled();

        // Lo que se llama, exactamente una vez cada uno
        expect(spies.validateRequestBody).toHaveBeenCalledTimes(1);
        expect(spies.validateV2FileShape).toHaveBeenCalledTimes(1);
        expect(synexusConfig.resolveEntityCode).toHaveBeenCalledTimes(1);
        expect(synexusConfig.printProfile).toHaveBeenCalledTimes(1);
        expect(requestBuilder.getIntentFor).toHaveBeenCalledTimes(1);
        expect(spies.validateV2IntentFields).toHaveBeenCalledTimes(1);
        expect(requestBuilder.buildRequestBody).toHaveBeenCalledTimes(1);
        expect(synexusApiClient.makeRequest).toHaveBeenCalledTimes(1);

        // El orden: validar → forma del archivo → entidad → perfil → intención → validar intención → construir → emitir
        const order = [
            spies.validateRequestBody,
            spies.validateV2FileShape,
            synexusConfig.resolveEntityCode,
            synexusConfig.printProfile,
            requestBuilder.getIntentFor,
            spies.validateV2IntentFields,
            requestBuilder.buildRequestBody,
            synexusApiClient.makeRequest
        ].map(fn => fn.mock.invocationCallOrder[0]);
        const sorted = [...order].sort((a, b) => a - b);
        expect(order).toEqual(sorted);
    });

    it('el cliente v2 recibe la operación, el MISMO cuerpo que devolvió buildRequestBody y la entidad resuelta', async () => {
        const { handler, requestBuilder, synexusApiClient, fileManager } = buildHandler(createV2Body());

        await expect(runV2(handler)).resolves.toBeUndefined();

        const builtBody = requestBuilder.buildRequestBody.mock.results[0].value;
        expect(synexusApiClient.makeRequest).toHaveBeenCalledWith('get_tax', builtBody, 'USA');
        expect(synexusApiClient.makeRequest.mock.calls[0][1]).toBe(builtBody);

        // Lo que devuelve el cliente viaja al paso 7 de execute sin transformarse
        const providerResponse = await synexusApiClient.makeRequest.mock.results[0].value;
        expect(fileManager.writeJsonFile).toHaveBeenCalledTimes(1);
        expect(fileManager.writeJsonFile.mock.calls[0][1]).toBe(providerResponse);
    });

    it('sin cliente v2 inyectado, la rama recorre todo hasta la guardia de cableado y lanza su mensaje sin emitir nada', async () => {
        const { handler, requestBuilder, apiClient, fileManager } = buildHandler(createV2Body(), {}, { synexusApiClient: null });

        await expect(runV2(handler)).rejects.toThrow(wiringGuardMessage);

        // La guardia va DESPUÉS de construir: el cuerpo ya existe y se imprimió
        expect(requestBuilder.buildRequestBody).toHaveBeenCalledTimes(1);
        expect(consoleLogSpy.mock.calls.some(call => typeof call[0] === 'string' && call[0].startsWith(bodyTracePrefix))).toBe(true);
        expect(apiClient.makeRequest).not.toHaveBeenCalled();
        expect(fileManager.writeJsonFile).not.toHaveBeenCalled();
    });

    it('pasa al validador la operación, el cuerpo CRUDO por identidad y la MISMA intención que devolvió el builder', async () => {
        const rawBody = createV2Body();
        const { handler, spies, requestBuilder } = buildHandler(rawBody);

        await expect(runV2(handler)).resolves.toBeUndefined();

        const intent = requestBuilder.getIntentFor.mock.results[0].value;
        expect(requestBuilder.getIntentFor).toHaveBeenCalledWith('get_tax');
        expect(spies.validateV2IntentFields).toHaveBeenCalledWith('get_tax', rawBody, intent);
        expect(spies.validateV2IntentFields.mock.calls[0][2]).toBe(intent);
        expect(spies.validateV2IntentFields.mock.calls[0][1]).toBe(rawBody);
    });

    it('resolveEntityCode, validateV2IntentFields y buildRequestBody reciben el cuerpo CRUDO por identidad, con el apóstrofo intacto (WR-03)', async () => {
        const rawBody = createV2Body();
        rawBody.customer_id = "Plummer's";
        const { handler, spies, requestBuilder, synexusConfig } = buildHandler(rawBody);

        await expect(runV2(handler)).resolves.toBeUndefined();

        expect(synexusConfig.resolveEntityCode.mock.calls[0][1]).toBe(rawBody);
        expect(spies.validateV2IntentFields.mock.calls[0][1]).toBe(rawBody);
        expect(requestBuilder.buildRequestBody).toHaveBeenCalledWith('get_tax', rawBody);
        expect(requestBuilder.buildRequestBody.mock.calls[0][1]).toBe(rawBody);
        expect(requestBuilder.buildRequestBody.mock.calls[0][1].customer_id).toBe("Plummer's");
        expect(requestBuilder.buildRequestBody.mock.calls[0][1].customer_id).not.toContain('\\');
    });

    it('con readJsonFile devolviendo un arreglo bajo v2, rechaza con "no un arreglo" antes de resolver la entidad y sin emitir ni escribir nada (WR-04)', async () => {
        const { handler, spies, requestBuilder, synexusConfig, synexusApiClient, fileManager } = buildHandler([createV2Body()]);

        await expect(runV2(handler)).rejects.toThrow('no un arreglo');

        expect(spies.validateRequestBody).toHaveBeenCalledTimes(1);
        expect(spies.validateV2FileShape).toHaveBeenCalledTimes(1);
        expect(synexusConfig.resolveEntityCode).not.toHaveBeenCalled();
        expect(requestBuilder.getIntentFor).not.toHaveBeenCalled();
        expect(requestBuilder.buildRequestBody).not.toHaveBeenCalled();
        expect(synexusApiClient.makeRequest).not.toHaveBeenCalled();
        expect(fileManager.writeJsonFile).not.toHaveBeenCalled();
    });

    it('imprime el cuerpo construido en la salida estándar, con JSON indentado a dos espacios, antes de emitir', async () => {
        const { handler, requestBuilder, synexusApiClient } = buildHandler(createV2Body());

        await expect(runV2(handler)).resolves.toBeUndefined();

        const builtBody = requestBuilder.buildRequestBody.mock.results[0].value;
        const traceCalls = consoleLogSpy.mock.calls
            .map((call, index) => ({ call, index }))
            .filter(entry => typeof entry.call[0] === 'string' && entry.call[0].startsWith(bodyTracePrefix));

        expect(traceCalls).toHaveLength(1);
        expect(traceCalls[0].call).toHaveLength(1);
        expect(traceCalls[0].call[0]).toBe(`${bodyTracePrefix} ${JSON.stringify(builtBody, null, 2)}`);
        expect(traceCalls[0].call[0]).toContain('"transaction_type": "sales_estimate"');
        expect(traceCalls[0].call[0]).toContain('"request_id"');

        // Después de construir el cuerpo y ANTES de emitirlo (invocationCallOrder es global entre mocks)
        const traceOrder = consoleLogSpy.mock.invocationCallOrder[traceCalls[0].index];
        expect(traceOrder).toBeGreaterThan(requestBuilder.buildRequestBody.mock.invocationCallOrder[0]);
        expect(traceOrder).toBeLessThan(synexusApiClient.makeRequest.mock.invocationCallOrder[0]);
    });

    it('con un archivo que contradice la operación, aborta ANTES de llamar a buildRequestBody', async () => {
        const body = createV2Body();
        body.transaction_type = 'sales_invoice';
        const { handler, spies, requestBuilder, synexusApiClient } = buildHandler(body);

        await expect(runV2(handler)).rejects.toThrow('sales_invoice');

        expect(requestBuilder.getIntentFor).toHaveBeenCalledTimes(1);
        expect(spies.validateV2IntentFields).toHaveBeenCalledTimes(1);
        expect(requestBuilder.buildRequestBody).not.toHaveBeenCalled();
        expect(synexusApiClient.makeRequest).not.toHaveBeenCalled();
        expect(consoleLogSpy.mock.calls.some(call => typeof call[0] === 'string' && call[0].startsWith(bodyTracePrefix))).toBe(false);
    });

    it('con committed invertido en el archivo, aborta nombrando committed y sin construir el cuerpo (OPER-04 bajo v2)', async () => {
        const body = createV2Body();
        body.committed = true;
        const { handler, requestBuilder, synexusApiClient } = buildHandler(body);

        await expect(runV2(handler)).rejects.toThrow('"committed"');

        expect(requestBuilder.buildRequestBody).not.toHaveBeenCalled();
        expect(synexusApiClient.makeRequest).not.toHaveBeenCalled();
    });

    it('con un archivo del contrato v1 bajo la rama v2, lanza el mensaje de la guardia y buildRequestBody no se llama', async () => {
        const { handler, spies, requestBuilder, synexusApiClient } = buildHandler(createV1Body());

        await expect(runV2(handler)).rejects.toThrow(v1FileGuardMessage);

        expect(spies.validate).not.toHaveBeenCalled();
        expect(spies.validateCommittedField).not.toHaveBeenCalled();
        expect(spies.validateV2IntentFields).toHaveBeenCalledTimes(1);
        expect(requestBuilder.buildRequestBody).not.toHaveBeenCalled();
        expect(synexusApiClient.makeRequest).not.toHaveBeenCalled();
    });

    it('con una operación sin mapeo, getIntentFor aborta antes de validar la intención y de construir nada', async () => {
        // El doble lanza como lo hace el builder real con cancel_tax en este
        // plan: no pasa por el mapeo de intención (el plan 02-02 le da su
        // propio constructor). post_tax ya no sirve de ejemplo: tiene mapeo.
        const noMappingMessage = 'La operación "cancel_tax" no pasa por el mapeo de intención del contrato v2';
        const { handler, spies, requestBuilder, synexusApiClient } = buildHandler(createV2Body(), {
            getIntentFor: jest.fn(() => { throw new Error(noMappingMessage); })
        });

        await expect(handler.execute(['cancel_tax', 'a.json', '--api-version=v2'])).rejects.toThrow('cancel_tax');

        expect(requestBuilder.getIntentFor).toHaveBeenCalledWith('cancel_tax');
        expect(spies.validateV2IntentFields).not.toHaveBeenCalled();
        expect(requestBuilder.buildRequestBody).not.toHaveBeenCalled();
        expect(spies.validate).not.toHaveBeenCalled();
        expect(synexusApiClient.makeRequest).not.toHaveBeenCalled();
    });

    it('con readJsonFile devolviendo null, falla en validateRequestBody (que va primero), no comprueba la forma y no consulta la intención', async () => {
        const { handler, spies, requestBuilder, synexusApiClient } = buildHandler(null);

        await expect(runV2(handler)).rejects.toThrow('El cuerpo de la petición no es un objeto válido');

        expect(spies.validateV2FileShape).not.toHaveBeenCalled();
        expect(requestBuilder.getIntentFor).not.toHaveBeenCalled();
        expect(requestBuilder.buildRequestBody).not.toHaveBeenCalled();
        expect(synexusApiClient.makeRequest).not.toHaveBeenCalled();
    });

    describe('con el SynexusRequestBuilder real', () => {
        const buildRealHandler = (requestBody) => {
            const logger = fakes.createFakeLogger();
            const validator = new TaxValidator(logger);
            const spies = {
                validate: jest.spyOn(validator, 'validate'),
                validateCommittedField: jest.spyOn(validator, 'validateCommittedField'),
                validateV2IntentFields: jest.spyOn(validator, 'validateV2IntentFields')
            };
            const requestBuilder = new SynexusRequestBuilder(logger);
            const synexusApiClient = { makeRequest: jest.fn(async () => ({ id: 'txn_1', total_tax: '0.00' })) };
            const handler = new TaxCommandHandler(
                fakes.createFakeConfig(),
                logger,
                {
                    exists: () => true,
                    readJsonFile: () => requestBody,
                    ensureDirectory: jest.fn(),
                    getResponseFileName: jest.fn(() => '/tmp/nexgen-tests-output/RESPONSE_a.json'),
                    writeJsonFile: jest.fn()
                },
                validator,
                { makeRequest: jest.fn() },
                { resolveEntityCode: jest.fn(() => 'USA'), printProfile: jest.fn() },
                requestBuilder,
                synexusApiClient
            );
            return { handler, spies, synexusApiClient };
        };

        it('get_tax con un archivo v2 llega al cliente v2 con el cuerpo tipado como sales_estimate y con request_id', async () => {
            const { handler, spies, synexusApiClient } = buildRealHandler(createV2Body());

            await expect(runV2(handler)).resolves.toBeUndefined();

            const trace = consoleLogSpy.mock.calls.find(call => typeof call[0] === 'string' && call[0].startsWith(bodyTracePrefix));
            expect(trace).toBeDefined();
            const printedBody = JSON.parse(trace[0].slice(bodyTracePrefix.length));
            expect(printedBody.transaction_type).toBe('sales_estimate');
            expect(printedBody.transaction_type).not.toBe('sales_invoice');
            expect(printedBody.committed).toBe(false);
            expect(printedBody.request_id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
            expect(printedBody.invoice_id).toBe('DEMO-001');
            expect(spies.validate).not.toHaveBeenCalled();
            expect(spies.validateCommittedField).not.toHaveBeenCalled();

            // Lo que se emite es exactamente lo que se imprimió
            expect(synexusApiClient.makeRequest).toHaveBeenCalledTimes(1);
            const [operation, sentBody, entity] = synexusApiClient.makeRequest.mock.calls[0];
            expect(operation).toBe('get_tax');
            expect(entity).toBe('USA');
            expect(sentBody).toEqual(printedBody);
            expect(sentBody.transaction_type).toBe('sales_estimate');
            expect(sentBody.committed).toBe(false);
        });

        it('post_tax con un archivo v2 llega al cliente v2 con el cuerpo tipado como sales_invoice, committed true y request_id (OPER-02, TEST-02)', async () => {
            const { handler, spies, synexusApiClient } = buildRealHandler(createV2Body());

            await expect(handler.execute(['post_tax', 'a.json', '--api-version=v2'])).resolves.toBeUndefined();

            const trace = consoleLogSpy.mock.calls.find(call => typeof call[0] === 'string' && call[0].startsWith(bodyTracePrefix));
            expect(trace).toBeDefined();
            const printedBody = JSON.parse(trace[0].slice(bodyTracePrefix.length));
            expect(printedBody.transaction_type).toBe('sales_invoice');
            expect(printedBody.transaction_type).not.toBe('sales_estimate');
            expect(printedBody.committed).toBe(true);
            expect(printedBody.request_id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
            expect(spies.validate).not.toHaveBeenCalled();
            expect(spies.validateCommittedField).not.toHaveBeenCalled();

            // El validador recibió por identidad la intención que devolvió el builder
            expect(spies.validateV2IntentFields).toHaveBeenCalledTimes(1);
            expect(spies.validateV2IntentFields.mock.calls[0][0]).toBe('post_tax');
            expect(spies.validateV2IntentFields.mock.calls[0][2]).toEqual({ transaction_type: 'sales_invoice', committed: true });

            // Lo que se emite es exactamente lo que se imprimió
            expect(synexusApiClient.makeRequest).toHaveBeenCalledTimes(1);
            const [operation, sentBody, entity] = synexusApiClient.makeRequest.mock.calls[0];
            expect(operation).toBe('post_tax');
            expect(entity).toBe('USA');
            expect(sentBody).toEqual(printedBody);
            expect(sentBody.transaction_type).toBe('sales_invoice');
            expect(sentBody.committed).toBe(true);
        });

        it('post_tax con un archivo que contradice la confirmación (committed: false) aborta antes del cliente v2 (OPER-04 bajo v2)', async () => {
            const body = createV2Body();
            body.committed = false;
            const { handler, spies, synexusApiClient } = buildRealHandler(body);

            let caught = null;
            try {
                await handler.execute(['post_tax', 'a.json', '--api-version=v2']);
            } catch (error) {
                caught = error;
            }

            expect(caught).not.toBeNull();
            expect(caught.message).toContain('"committed"');
            expect(caught.message).toContain('debe ser true');
            expect(caught.message).not.toContain(wiringGuardMessage);
            expect(spies.validateV2IntentFields).toHaveBeenCalledTimes(1);
            expect(synexusApiClient.makeRequest).not.toHaveBeenCalled();
        });
    });
});
