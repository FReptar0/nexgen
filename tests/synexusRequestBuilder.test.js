// tests/synexusRequestBuilder.test.js
// El cuerpo de la cotización v2 tal como lo arma nexgen, sin red:
//   1. TEST-03 — la guardia de regresión de OPER-01 (los cuatro primeros casos).
//   2. La llave de idempotencia (SAFE-01): formato UUID v4 y unicidad.
//   3. getIntentFor como única fuente de verdad del mapeo, con throw terminal
//      para toda operación sin mapeo (OPER-05).
//   4. Un cuerpo con un campo de intención ausente nunca sale del builder.
//
// Ningún caso afirma nada sobre montos: los montos son de la Fase 2, y un
// impuesto de 0.00 no es un fallo (la entidad de sandbox no tiene nexo).
const SynexusRequestBuilder = require('../src/api/synexusRequestBuilder');
const fakes = require('./helpers/fakes');

// Cuerpo con forma v2, calcado del ejemplo de postman/synexus-v2-api.postman_collection.json.
// Sin transaction_type, committed ni request_id: así lo deja el área de ERP.
const createV2Body = () => ({
    invoice_id: 'DEMO-001',
    customer_id: 'CUST-1',
    to_state: 'TX',
    to_zip: '75001',
    cart: [
        { item_id: 'SKU-1', price: 49.99, quantity: 1, tax_code: 'TPP' }
    ]
});

// UUID v4 canónico: 8-4-4-4-12 hexadecimal, '4' como primer carácter del tercer
// grupo (versión) y 8, 9, a o b como primero del cuarto (variante RFC 4122).
const uuidV4Pattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

let builder;
let logger;
let consoleLogSpy;
let consoleErrorSpy;

beforeEach(() => {
    logger = fakes.createFakeLogger();
    builder = new SynexusRequestBuilder(logger);
    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
});

describe('TEST-03 — guardia de regresión de OPER-01: la cotización no persiste nada en el proveedor', () => {
    // ┌──────────────────────────────────────────────────────────────────────┐
    // │ NO BORRAR NI DEBILITAR ESTOS CUATRO CASOS.                            │
    // │                                                                      │
    // │ Son lo único que impide que una cotización empiece a dejar rastro en │
    // │ el proveedor. El valor por omisión de transaction_type del lado del  │
    // │ proveedor es sales_invoice, y con committed: false por sí solo el    │
    // │ proveedor IGUAL guarda un snapshot de factura. Lo que suprime la     │
    // │ persistencia es tipar la transacción como sales_estimate.            │
    // │                                                                      │
    // │ Si alguien quita el tipado explícito creyendo que es redundante, el  │
    // │ proveedor cae en su valor por omisión y cada get_tax crea un         │
    // │ registro fantasma. Estos casos fallan en ese momento, no en          │
    // │ producción.                                                          │
    // └──────────────────────────────────────────────────────────────────────┘

    it('get_tax produce transaction_type igual a sales_estimate', () => {
        const body = builder.buildRequestBody('get_tax', createV2Body());

        expect(body.transaction_type).toBe('sales_estimate');
    });

    it('get_tax produce committed estrictamente igual a false (no basta con que sea falsy)', () => {
        const body = builder.buildRequestBody('get_tax', createV2Body());

        expect(body.committed).toBe(false);
        expect(typeof body.committed).toBe('boolean');
    });

    it('get_tax NUNCA produce transaction_type sales_invoice — es el valor por omisión del proveedor', () => {
        const body = builder.buildRequestBody('get_tax', createV2Body());

        expect(body.transaction_type).not.toBe('sales_invoice');
        expect(body.transaction_type).toBeDefined();
    });

    it('un archivo que ya trae transaction_type sales_invoice produce igualmente sales_estimate: la intención de nexgen gana', () => {
        const input = createV2Body();
        input.transaction_type = 'sales_invoice';
        input.committed = true;

        const body = builder.buildRequestBody('get_tax', input);

        expect(body.transaction_type).toBe('sales_estimate');
        expect(body.committed).toBe(false);
    });
});

describe('buildRequestBody — el cuerpo es un objeto nuevo', () => {
    it('devuelve un objeto distinto del argumento', () => {
        const input = createV2Body();

        const body = builder.buildRequestBody('get_tax', input);

        expect(body).not.toBe(input);
    });

    it('mutar el cuerpo construido no altera el argumento', () => {
        const input = createV2Body();
        const snapshot = JSON.parse(JSON.stringify(input));

        const body = builder.buildRequestBody('get_tax', input);
        body.invoice_id = 'MUTADO';
        body.transaction_type = 'sales_invoice';

        expect(input).toEqual(snapshot);
    });

    it('el argumento no gana ninguna propiedad que no tuviera', () => {
        const input = createV2Body();
        const keysBefore = Object.keys(input).sort();

        builder.buildRequestBody('get_tax', input);

        expect(Object.keys(input).sort()).toEqual(keysBefore);
        expect(input.transaction_type).toBeUndefined();
        expect(input.committed).toBeUndefined();
        expect(input.request_id).toBeUndefined();
    });

    it('conserva los campos del archivo tal cual: nexgen no traduce esquemas', () => {
        const input = createV2Body();

        const body = builder.buildRequestBody('get_tax', input);

        expect(body.invoice_id).toBe('DEMO-001');
        expect(body.customer_id).toBe('CUST-1');
        expect(body.to_state).toBe('TX');
        expect(body.to_zip).toBe('75001');
        expect(body.cart).toEqual(input.cart);
    });

    it('emite una traza por console.log al terminar, como sanitizeStringFields', () => {
        builder.buildRequestBody('get_tax', createV2Body());

        expect(consoleLogSpy).toHaveBeenCalled();
    });
});

describe('Llave de idempotencia (SAFE-01) — request_id generado por nexgen', () => {
    it('request_id cumple el formato UUID v4: 8-4-4-4-12, versión 4 y variante 8/9/a/b', () => {
        const body = builder.buildRequestBody('get_tax', createV2Body());

        expect(typeof body.request_id).toBe('string');
        expect(body.request_id).toMatch(uuidV4Pattern);
    });

    it('dos invocaciones consecutivas producen request_id distintos', () => {
        const first = builder.buildRequestBody('get_tax', createV2Body());
        const second = builder.buildRequestBody('get_tax', createV2Body());

        expect(first.request_id).not.toBe(second.request_id);
    });

    it('_generateRequestId produce llaves con el formato y sin repetirse en una tanda', () => {
        const keys = new Set();
        for (let i = 0; i < 50; i++) {
            const key = builder._generateRequestId();
            expect(key).toMatch(uuidV4Pattern);
            keys.add(key);
        }

        expect(keys.size).toBe(50);
    });

    it('la llave viaja en el cuerpo, no en un header: el cuerpo construido la lleva como request_id', () => {
        const body = builder.buildRequestBody('get_tax', createV2Body());

        expect(Object.keys(body)).toContain('request_id');
    });
});

describe('getIntentFor — única fuente de verdad del mapeo operación → intención', () => {
    it('get_tax devuelve los dos campos de intención', () => {
        const intent = builder.getIntentFor('get_tax');

        expect(intent).toEqual({ transaction_type: 'sales_estimate', committed: false });
    });

    it('post_tax lanza nombrando la operación: no tiene mapeo de intención en esta fase (OPER-05)', () => {
        expect(() => builder.getIntentFor('post_tax')).toThrow('post_tax');
        expect(() => builder.getIntentFor('post_tax')).toThrow(/mapeo de intenci[oó]n/);
    });

    it('cancel_tax lanza nombrando la operación: no tiene mapeo de intención en esta fase (OPER-05)', () => {
        expect(() => builder.getIntentFor('cancel_tax')).toThrow('cancel_tax');
        expect(() => builder.getIntentFor('cancel_tax')).toThrow(/mapeo de intenci[oó]n/);
    });

    it('una operación desconocida lanza nombrándola, sin caer en ningún valor por omisión', () => {
        expect(() => builder.getIntentFor('lo_que_sea')).toThrow('lo_que_sea');
    });

    it('al lanzar usa el trío del repositorio: console.error + logger.error + throw', () => {
        expect(() => builder.getIntentFor('post_tax')).toThrow();

        expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
        expect(logger.error).toHaveBeenCalledTimes(1);
        expect(logger.error.mock.calls[0][0]).toContain('post_tax');
    });

    it('buildRequestBody con una operación sin mapeo lanza antes de construir nada', () => {
        const input = createV2Body();

        expect(() => builder.buildRequestBody('post_tax', input)).toThrow('post_tax');
        expect(input.request_id).toBeUndefined();
    });
});

describe('_assertIntentFieldsPresent — un campo de intención ausente aborta antes de que exista petición alguna (OPER-05)', () => {
    it('si el mapeo devolviera un objeto vacío, buildRequestBody lanza en vez de emitir un cuerpo a medias', () => {
        jest.spyOn(builder, 'getIntentFor').mockReturnValue({});

        expect(() => builder.buildRequestBody('get_tax', createV2Body())).toThrow('transaction_type');
    });

    it('si el mapeo trajera transaction_type pero no committed, lanza nombrando committed', () => {
        jest.spyOn(builder, 'getIntentFor').mockReturnValue({ transaction_type: 'sales_estimate' });

        expect(() => builder.buildRequestBody('get_tax', createV2Body())).toThrow('committed');
    });

    it('si committed no fuera booleano, lanza nombrando committed', () => {
        jest.spyOn(builder, 'getIntentFor').mockReturnValue({ transaction_type: 'sales_estimate', committed: 'false' });

        expect(() => builder.buildRequestBody('get_tax', createV2Body())).toThrow('committed');
    });

    it('si la llave de idempotencia faltara, lanza nombrando request_id', () => {
        jest.spyOn(builder, '_generateRequestId').mockReturnValue('');

        expect(() => builder.buildRequestBody('get_tax', createV2Body())).toThrow('request_id');
    });

    it('al abortar usa el trío del repositorio: console.error + logger.error + throw', () => {
        jest.spyOn(builder, 'getIntentFor').mockReturnValue({});

        expect(() => builder.buildRequestBody('get_tax', createV2Body())).toThrow();
        expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
        expect(logger.error).toHaveBeenCalledTimes(1);
    });
});
