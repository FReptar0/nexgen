// tests/synexusRequestBuilder.test.js
// El cuerpo de las tres operaciones v2 tal como lo arma nexgen, sin red:
//   1. TEST-03 — la guardia de regresión de OPER-01 (los cuatro primeros casos):
//      la cotización no persiste nada.
//   2. TEST-02 — la guardia espejo para post_tax (OPER-02): la confirmación
//      registra una factura confirmada, no una cotización.
//   3. La llave de idempotencia (SAFE-01): formato UUID v4 y unicidad.
//   4. getIntentFor como única fuente de verdad del mapeo: get_tax y post_tax
//      son las dos operaciones mapeadas (mismo endpoint, intención invertida);
//      todo lo demás cae en el throw terminal (OPER-05). cancel_tax NO pasa
//      por este mapeo: su cuerpo es una proyección con constructor propio.
//   5. Un cuerpo con un campo de intención ausente nunca sale del builder.
//   6. buildCancelBody (OPER-03): la cancelación es una PROYECCIÓN de dos
//      campos del archivo —invoice_id y customer_id— sin intención, sin llave
//      de idempotencia (excepción documentada de SAFE-01) y sin arrastrar
//      ningún otro campo; y aborta antes de la red si falta uno de los dos.
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

describe('TEST-02 — guardia de regresión de OPER-02: la confirmación registra una factura confirmada, no una cotización', () => {
    // ┌──────────────────────────────────────────────────────────────────────┐
    // │ NO BORRAR NI DEBILITAR ESTOS CASOS. Son el espejo de TEST-03.        │
    // │                                                                      │
    // │ Un post_tax que saliera como sales_estimate, o con committed: false, │
    // │ COTIZARÍA en vez de confirmar: el proveedor no registraría la        │
    // │ factura, pero el ERP —que recibe un RESPONSE_ con montos y sin       │
    // │ error— creería que sí quedó registrada. Es la inversión de cotizar   │
    // │ y confirmar que OPER-04 prohíbe, vista desde el cuerpo que sale al   │
    // │ cable.                                                               │
    // │                                                                      │
    // │ Los DOS campos son necesarios: sales_invoice con committed: false    │
    // │ deja sólo un snapshot sin confirmar del lado del proveedor. Estos    │
    // │ casos fallan en cuanto alguien toque el mapeo, no cuando el área de  │
    // │ ERP concilie facturas que nunca existieron.                          │
    // └──────────────────────────────────────────────────────────────────────┘

    it('post_tax produce transaction_type igual a sales_invoice', () => {
        const body = builder.buildRequestBody('post_tax', createV2Body());

        expect(body.transaction_type).toBe('sales_invoice');
    });

    it('post_tax produce committed estrictamente igual a true (no basta con que sea truthy)', () => {
        const body = builder.buildRequestBody('post_tax', createV2Body());

        expect(body.committed).toBe(true);
        expect(typeof body.committed).toBe('boolean');
    });

    it('post_tax NUNCA produce transaction_type sales_estimate — eso cotizaría sin registrar la factura', () => {
        const body = builder.buildRequestBody('post_tax', createV2Body());

        expect(body.transaction_type).not.toBe('sales_estimate');
        expect(body.transaction_type).toBeDefined();
    });

    it('un archivo que ya trae transaction_type sales_estimate produce igualmente sales_invoice: la intención de nexgen gana', () => {
        // En la corrida real validateV2IntentFields aborta antes por la
        // contradicción; ésta es la regla del builder por sí mismo.
        const input = createV2Body();
        input.transaction_type = 'sales_estimate';
        input.committed = false;

        const body = builder.buildRequestBody('post_tax', input);

        expect(body.transaction_type).toBe('sales_invoice');
        expect(body.committed).toBe(true);
    });

    it('post_tax también lleva request_id con formato UUID v4: la llave de idempotencia no es sólo de la cotización (SAFE-01)', () => {
        const body = builder.buildRequestBody('post_tax', createV2Body());

        expect(typeof body.request_id).toBe('string');
        expect(body.request_id).toMatch(uuidV4Pattern);
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

    it('post_tax devuelve exactamente la intención de factura confirmada: sales_invoice y committed true (OPER-02)', () => {
        const intent = builder.getIntentFor('post_tax');

        expect(intent).toEqual({ transaction_type: 'sales_invoice', committed: true });
    });

    it('las dos intenciones mapeadas son opuestas en los dos campos: no hay forma de confundir cotizar con confirmar', () => {
        const quote = builder.getIntentFor('get_tax');
        const confirmation = builder.getIntentFor('post_tax');

        expect(quote.transaction_type).not.toBe(confirmation.transaction_type);
        expect(quote.committed).not.toBe(confirmation.committed);
    });

    it('cancel_tax lanza nombrando la operación: no pasa por el mapeo de intención (OPER-05)', () => {
        expect(() => builder.getIntentFor('cancel_tax')).toThrow('cancel_tax');
        expect(() => builder.getIntentFor('cancel_tax')).toThrow(/mapeo de intenci[oó]n/);
    });

    it('una operación desconocida lanza nombrándola, sin caer en ningún valor por omisión', () => {
        expect(() => builder.getIntentFor('lo_que_sea')).toThrow('lo_que_sea');
    });

    it('al lanzar usa el trío del repositorio: console.error + logger.error + throw', () => {
        expect(() => builder.getIntentFor('cancel_tax')).toThrow();

        expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
        expect(logger.error).toHaveBeenCalledTimes(1);
        expect(logger.error.mock.calls[0][0]).toContain('cancel_tax');
    });

    it('buildRequestBody con una operación sin mapeo lanza antes de construir nada', () => {
        const input = createV2Body();

        expect(() => builder.buildRequestBody('cancel_tax', input)).toThrow('cancel_tax');
        expect(input.request_id).toBeUndefined();
    });
});

describe('buildCancelBody — la cancelación es una proyección de dos campos (OPER-03)', () => {
    // El archivo del ERP tiene forma de cálculo (cart, direcciones, entidad);
    // el endpoint de cancelación documenta exactamente dos campos y no dice qué
    // hace con los extra. Proyectar es lo único que respeta el contrato tal
    // como está escrito. Estos casos fallan si alguien "simplifica" la
    // proyección a un paso directo del archivo.
    const cancelMessagePrefix = 'Para cancelar bajo el contrato v2';

    // Archivo v2 completo, con entity_id además: la entidad se resuelve de él,
    // pero NO viaja en el cuerpo de cancelación.
    const createCancelFile = () => Object.assign(createV2Body(), { entity_id: 'CA-01' });

    it('con un archivo v2 completo el resultado tiene exactamente las llaves customer_id e invoice_id', () => {
        const body = builder.buildCancelBody(createCancelFile());

        expect(Object.keys(body).sort()).toEqual(['customer_id', 'invoice_id']);
    });

    it('los valores son los del archivo: nexgen no traduce esquemas, los dos nombres son los del contrato v2', () => {
        const body = builder.buildCancelBody(createCancelFile());

        expect(body.invoice_id).toBe('DEMO-001');
        expect(body.customer_id).toBe('CUST-1');
        expect(body).toEqual({ invoice_id: 'DEMO-001', customer_id: 'CUST-1' });
    });

    it('devuelve un objeto NUEVO y no muta el archivo', () => {
        const input = createCancelFile();
        const snapshot = JSON.parse(JSON.stringify(input));

        const body = builder.buildCancelBody(input);
        body.invoice_id = 'MUTADO';

        expect(body).not.toBe(input);
        expect(input).toEqual(snapshot);
    });

    it('cart, to_state, to_zip y entity_id NO se propagan al cuerpo de cancelación', () => {
        const body = builder.buildCancelBody(createCancelFile());

        expect(body).not.toHaveProperty('cart');
        expect(body).not.toHaveProperty('to_state');
        expect(body).not.toHaveProperty('to_zip');
        expect(body).not.toHaveProperty('entity_id');
    });

    it('un archivo que además trae transaction_type y committed tampoco los propaga', () => {
        const input = Object.assign(createCancelFile(), { transaction_type: 'sales_invoice', committed: true });

        const body = builder.buildCancelBody(input);

        expect(body).not.toHaveProperty('transaction_type');
        expect(body).not.toHaveProperty('committed');
        expect(Object.keys(body).sort()).toEqual(['customer_id', 'invoice_id']);
    });

    it('NO lleva request_id, transaction_type ni committed: la cancelación es la excepción documentada de SAFE-01 (idempotente por naturaleza; ninguno de los tres está documentado para este endpoint)', () => {
        const body = builder.buildCancelBody(createCancelFile());

        expect(body).not.toHaveProperty('request_id');
        expect(body).not.toHaveProperty('transaction_type');
        expect(body).not.toHaveProperty('committed');
    });

    it('no consulta getIntentFor ni genera llave: la cancelación no tiene intención que mapear', () => {
        const intentSpy = jest.spyOn(builder, 'getIntentFor');
        const keySpy = jest.spyOn(builder, '_generateRequestId');

        builder.buildCancelBody(createCancelFile());

        expect(intentSpy).not.toHaveBeenCalled();
        expect(keySpy).not.toHaveBeenCalled();
    });

    it('sin invoice_id lanza con un mensaje que empieza por "Para cancelar bajo el contrato v2" y nombra invoice_id', () => {
        const input = createCancelFile();
        delete input.invoice_id;

        let caught = null;
        try {
            builder.buildCancelBody(input);
        } catch (error) {
            caught = error;
        }

        expect(caught).not.toBeNull();
        expect(caught.message.startsWith(cancelMessagePrefix)).toBe(true);
        expect(caught.message).toContain('invoice_id');
    });

    it('sin customer_id lanza nombrando customer_id', () => {
        const input = createCancelFile();
        delete input.customer_id;

        expect(() => builder.buildCancelBody(input)).toThrow(cancelMessagePrefix);
        expect(() => builder.buildCancelBody(input)).toThrow('customer_id');
    });

    it('sin los dos, el mensaje nombra los dos', () => {
        const input = createCancelFile();
        delete input.invoice_id;
        delete input.customer_id;

        let caught = null;
        try {
            builder.buildCancelBody(input);
        } catch (error) {
            caught = error;
        }

        expect(caught).not.toBeNull();
        expect(caught.message).toContain('invoice_id');
        expect(caught.message).toContain('customer_id');
    });

    it('invoice_id vacío ("") cuenta como ausente', () => {
        const input = Object.assign(createCancelFile(), { invoice_id: '' });

        expect(() => builder.buildCancelBody(input)).toThrow('invoice_id');
    });

    it('invoice_id null cuenta como ausente', () => {
        const input = Object.assign(createCancelFile(), { invoice_id: null });

        expect(() => builder.buildCancelBody(input)).toThrow('invoice_id');
    });

    it('al abortar usa el trío del repositorio: console.error una vez, logger.error una vez, throw', () => {
        const input = createCancelFile();
        delete input.customer_id;

        expect(() => builder.buildCancelBody(input)).toThrow();
        expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
        expect(logger.error).toHaveBeenCalledTimes(1);
        expect(logger.error.mock.calls[0][0]).toContain('customer_id');
    });

    it('el mensaje dice que aborta antes de emitir petición alguna', () => {
        const input = createCancelFile();
        delete input.invoice_id;

        expect(() => builder.buildCancelBody(input)).toThrow(/antes de emitir/);
    });

    it('emite una traza por console.log que empieza por "Cuerpo v2 de cancelación construido"', () => {
        builder.buildCancelBody(createCancelFile());

        const trace = consoleLogSpy.mock.calls
            .find(call => typeof call[0] === 'string' && call[0].startsWith('Cuerpo v2 de cancelación construido'));
        expect(trace).toBeDefined();
        expect(trace[0]).toContain('DEMO-001');
        expect(trace[0]).toContain('CUST-1');
    });

    it('getIntentFor(cancel_tax) sigue lanzando y mencionando el mapeo de intención: la proyección no le dio mapeo', () => {
        expect(() => builder.getIntentFor('cancel_tax')).toThrow('cancel_tax');
        expect(() => builder.getIntentFor('cancel_tax')).toThrow(/mapeo de intenci[oó]n/);
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
