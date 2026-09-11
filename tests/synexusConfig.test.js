// tests/synexusConfig.test.js
// Frenos de arranque del contrato v2 (SAFE-03, CFG-04), resolución del código
// de entidad por precedencia (CFG-01, CFG-02), composición de las URL de cálculo
// y de cancelación desde configuración (CONN-04, OPER-03) y enmascaramiento de
// la llave (CFG-05).
//
// src/config/synexusConfig.js exporta la CLASE, así que cada caso muta
// process.env.SYNEXUS_* y construye una instancia nueva. Los valores originales
// (fijados por tests/setup.js) se guardan antes de cada caso y se restauran al
// terminar, para no contaminar a las demás suites.
//
// Ninguna aserción usa una llave real: la de prueba es el prefijo ficticio de
// tests/setup.js seguido de 64 ceros, y la de "producción" es igual de ficticia.
const SynexusConfig = require('../src/config/synexusConfig');

const stagingHost = 'https://compute.staging.synexustax.com';
const productionHost = 'https://compute.synexustax.com';
const testKey = 'synexus_test_' + '0'.repeat(64);
const liveKey = 'synexus_live_' + '1'.repeat(64);
const legacyPrefixKey = 'syntax_test_' + '0'.repeat(64);

const synexusVars = ['SYNEXUS_BASE_URL', 'SYNEXUS_API_KEY', 'SYNEXUS_ENTITY'];

let originalEnv;
let consoleLogSpy;
let consoleErrorSpy;

beforeEach(() => {
    originalEnv = {};
    synexusVars.forEach(name => {
        originalEnv[name] = process.env[name];
    });
    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
    synexusVars.forEach(name => {
        if (originalEnv[name] === undefined) {
            delete process.env[name];
        } else {
            process.env[name] = originalEnv[name];
        }
    });
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
});

/**
 * Construye la configuración y devuelve el error que lanzó, o null si no lanzó.
 * Permite afirmar varias cosas sobre el mismo mensaje sin repetir el try/catch.
 * @returns {Error|null}
 */
const constructAndCatch = () => {
    try {
        new SynexusConfig();
        return null;
    } catch (error) {
        return error;
    }
};

describe('SynexusConfig — variables requeridas por v2 (CFG-04)', () => {
    beforeEach(() => {
        process.env.SYNEXUS_BASE_URL = stagingHost;
        process.env.SYNEXUS_API_KEY = testKey;
    });

    it('sin SYNEXUS_BASE_URL lanza nombrando SYNEXUS_BASE_URL', () => {
        delete process.env.SYNEXUS_BASE_URL;
        expect(() => new SynexusConfig()).toThrow('SYNEXUS_BASE_URL');
    });

    it('sin SYNEXUS_API_KEY lanza nombrando SYNEXUS_API_KEY', () => {
        delete process.env.SYNEXUS_API_KEY;
        expect(() => new SynexusConfig()).toThrow('SYNEXUS_API_KEY');
    });

    it('sin las dos las nombra juntas, separadas por coma', () => {
        delete process.env.SYNEXUS_BASE_URL;
        delete process.env.SYNEXUS_API_KEY;
        expect(() => new SynexusConfig()).toThrow('SYNEXUS_BASE_URL, SYNEXUS_API_KEY');
    });

    it('el mensaje dice dónde ponerlas: el archivo .env de la raíz', () => {
        delete process.env.SYNEXUS_API_KEY;
        expect(() => new SynexusConfig()).toThrow('.env');
    });

    it('una variable vacía cuenta como faltante', () => {
        process.env.SYNEXUS_API_KEY = '';
        expect(() => new SynexusConfig()).toThrow('SYNEXUS_API_KEY');
    });

    it('imprime el mensaje por console.error antes de lanzar (el operador ve la causa, no sólo el genérico de index.js)', () => {
        delete process.env.SYNEXUS_BASE_URL;
        const error = constructAndCatch();
        expect(error).not.toBeNull();
        expect(consoleErrorSpy).toHaveBeenCalledWith(error.message);
    });

    it('SYNEXUS_ENTITY ausente NO impide construir: se resuelve después, por precedencia', () => {
        delete process.env.SYNEXUS_ENTITY;
        expect(() => new SynexusConfig()).not.toThrow();
    });
});

describe('SynexusConfig — correspondencia llave↔host (SAFE-03, TEST-05)', () => {
    it('llave synexus_test_ contra el host de producción lanza, nombrando prefijo y los dos hosts, sin la llave', () => {
        process.env.SYNEXUS_BASE_URL = productionHost;
        process.env.SYNEXUS_API_KEY = testKey;

        const error = constructAndCatch();
        expect(error).not.toBeNull();
        expect(error.message).toContain('synexus_test_');
        expect(error.message).toContain('compute.staging.synexustax.com');
        expect(error.message).toContain('compute.synexustax.com');
        expect(error.message).not.toContain(testKey);
        expect(consoleErrorSpy).toHaveBeenCalledWith(error.message);
    });

    it('llave synexus_live_ contra el host de staging lanza igual', () => {
        process.env.SYNEXUS_BASE_URL = stagingHost;
        process.env.SYNEXUS_API_KEY = liveKey;

        const error = constructAndCatch();
        expect(error).not.toBeNull();
        expect(error.message).toContain('synexus_live_');
        expect(error.message).toContain('compute.synexustax.com');
        expect(error.message).toContain('compute.staging.synexustax.com');
        expect(error.message).not.toContain(liveKey);
    });

    it('llave synexus_test_ contra staging construye sin lanzar', () => {
        process.env.SYNEXUS_BASE_URL = stagingHost;
        process.env.SYNEXUS_API_KEY = testKey;
        expect(() => new SynexusConfig()).not.toThrow();
    });

    it('llave synexus_live_ contra producción construye sin lanzar', () => {
        process.env.SYNEXUS_BASE_URL = productionHost;
        process.env.SYNEXUS_API_KEY = liveKey;
        expect(() => new SynexusConfig()).not.toThrow();
    });

    it('un prefijo desconocido (el de la marca anterior, syntax_test_) lanza nombrando los dos prefijos aceptados', () => {
        process.env.SYNEXUS_BASE_URL = stagingHost;
        process.env.SYNEXUS_API_KEY = legacyPrefixKey;

        const error = constructAndCatch();
        expect(error).not.toBeNull();
        expect(error.message).toContain('synexus_test_');
        expect(error.message).toContain('synexus_live_');
        expect(error.message).not.toContain(legacyPrefixKey);
    });

    it('una SYNEXUS_BASE_URL malformada lanza un mensaje en español, no un TypeError de Node', () => {
        process.env.SYNEXUS_BASE_URL = 'esto-no-es-una-url';
        process.env.SYNEXUS_API_KEY = testKey;

        const error = constructAndCatch();
        expect(error).not.toBeNull();
        expect(error).not.toBeInstanceOf(TypeError);
        expect(error.message).toContain('SYNEXUS_BASE_URL');
    });
});

describe('SynexusConfig — forma de SYNEXUS_BASE_URL: sólo https y host (SAFE-03, CONN-04)', () => {
    // Todas las formas rechazadas usan el host de staging con la llave de
    // prueba: la correspondencia llave↔host es correcta, así que lo único que
    // puede abortar es la forma de la URL. Y aborta al construir, es decir,
    // antes de que exista petición alguna.
    beforeEach(() => {
        process.env.SYNEXUS_API_KEY = testKey;
    });

    it('http:// se rechaza al construir aunque el host corresponda a la llave: la llave no puede viajar en texto claro', () => {
        process.env.SYNEXUS_BASE_URL = 'http://compute.staging.synexustax.com';

        const error = constructAndCatch();
        expect(error).not.toBeNull();
        expect(error).not.toBeInstanceOf(TypeError);
        expect(error.message).toContain('SYNEXUS_BASE_URL');
        expect(error.message).toContain('https:');
        expect(error.message).toContain('http:');
        expect(consoleErrorSpy).toHaveBeenCalledWith(error.message);
    });

    it('una ruta (/api/v1, la forma en que suelen documentarse las "base URL") se rechaza nombrando la ruta encontrada', () => {
        process.env.SYNEXUS_BASE_URL = 'https://compute.staging.synexustax.com/api/v1';

        const error = constructAndCatch();
        expect(error).not.toBeNull();
        expect(error.message).toContain('SYNEXUS_BASE_URL');
        expect(error.message).toContain('la ruta "/api/v1"');
        expect(error.message).toContain('Ejemplo: https://compute.staging.synexustax.com');
        expect(consoleErrorSpy).toHaveBeenCalledWith(error.message);
    });

    it('una consulta (?x=1) se rechaza nombrando la consulta encontrada', () => {
        process.env.SYNEXUS_BASE_URL = 'https://compute.staging.synexustax.com/?x=1';

        const error = constructAndCatch();
        expect(error).not.toBeNull();
        expect(error.message).toContain('la consulta "?x=1"');
        expect(error.message).toContain('Ejemplo: https://compute.staging.synexustax.com');
    });

    it('un fragmento (#seccion) se rechaza nombrando el fragmento encontrado', () => {
        process.env.SYNEXUS_BASE_URL = 'https://compute.staging.synexustax.com#seccion';

        const error = constructAndCatch();
        expect(error).not.toBeNull();
        expect(error.message).toContain('el fragmento "#seccion"');
    });

    it('credenciales (user:pw@) se rechazan y ni el usuario ni la contraseña se repiten en el mensaje', () => {
        process.env.SYNEXUS_BASE_URL = 'https://admin-xyz:secreto-xyz@compute.staging.synexustax.com';

        const error = constructAndCatch();
        expect(error).not.toBeNull();
        expect(error.message).toContain('credenciales');
        expect(error.message).toContain('***@compute.staging.synexustax.com');
        expect(error.message).not.toContain('secreto-xyz');
        expect(error.message).not.toContain('admin-xyz');
        expect(consoleErrorSpy).toHaveBeenCalledWith(error.message);
    });

    it('si sobran varias partes, el mensaje las nombra todas', () => {
        process.env.SYNEXUS_BASE_URL = 'https://compute.staging.synexustax.com/api/v1?x=1#f';

        const error = constructAndCatch();
        expect(error).not.toBeNull();
        expect(error.message).toContain('la ruta "/api/v1"');
        expect(error.message).toContain('la consulta "?x=1"');
        expect(error.message).toContain('el fragmento "#f"');
    });

    it('sólo esquema y host construye sin lanzar', () => {
        process.env.SYNEXUS_BASE_URL = stagingHost;
        expect(() => new SynexusConfig()).not.toThrow();
    });

    it('una barra final se tolera: construye sin lanzar y la URL de cálculo es la misma que sin barra', () => {
        process.env.SYNEXUS_BASE_URL = stagingHost + '/';
        expect(() => new SynexusConfig()).not.toThrow();
        expect(new SynexusConfig().getCalculationUrl())
            .toBe('https://compute.staging.synexustax.com/api/v1/tax_calculations');
    });
});

describe('SynexusConfig — getCalculationUrl (CONN-04)', () => {
    beforeEach(() => {
        process.env.SYNEXUS_API_KEY = testKey;
    });

    it('compone host de configuración + /api/v1/tax_calculations', () => {
        process.env.SYNEXUS_BASE_URL = stagingHost;
        const config = new SynexusConfig();
        expect(config.getCalculationUrl()).toBe('https://compute.staging.synexustax.com/api/v1/tax_calculations');
    });

    it('una barra final sobrante en la variable produce exactamente la misma cadena, sin barra doble', () => {
        process.env.SYNEXUS_BASE_URL = stagingHost + '/';
        const config = new SynexusConfig();
        expect(config.getCalculationUrl()).toBe('https://compute.staging.synexustax.com/api/v1/tax_calculations');
    });

    it('el host sale de configuración: cambiar SYNEXUS_BASE_URL cambia la URL resuelta', () => {
        process.env.SYNEXUS_BASE_URL = productionHost;
        process.env.SYNEXUS_API_KEY = liveKey;
        const config = new SynexusConfig();
        expect(config.getCalculationUrl()).toBe('https://compute.synexustax.com/api/v1/tax_calculations');
    });

    it('la ruta canónica no lleva el alias /calculate', () => {
        process.env.SYNEXUS_BASE_URL = stagingHost;
        const config = new SynexusConfig();
        expect(config.getCalculationUrl()).not.toContain('/calculate');
    });
});

describe('SynexusConfig — getCancelUrl (OPER-03, CONN-04)', () => {
    // Espejo del describe de getCalculationUrl: la URL de cancelación sale del
    // mismo host de configuración, con otra ruta. Las dos conviven en la misma
    // instancia; el cliente v2 pide una u otra según la operación.
    beforeEach(() => {
        process.env.SYNEXUS_API_KEY = testKey;
    });

    it('compone host de configuración + /api/v1/invoices/cancel', () => {
        process.env.SYNEXUS_BASE_URL = stagingHost;
        const config = new SynexusConfig();
        expect(config.getCancelUrl()).toBe('https://compute.staging.synexustax.com/api/v1/invoices/cancel');
    });

    it('una barra final sobrante en la variable produce exactamente la misma cadena, sin barra doble', () => {
        process.env.SYNEXUS_BASE_URL = stagingHost + '/';
        const config = new SynexusConfig();
        expect(config.getCancelUrl()).toBe('https://compute.staging.synexustax.com/api/v1/invoices/cancel');
        expect(config.getCancelUrl()).not.toContain('//api');
    });

    it('el host sale de configuración: con el host de producción y la llave synexus_live_ cambia la URL resuelta', () => {
        process.env.SYNEXUS_BASE_URL = productionHost;
        process.env.SYNEXUS_API_KEY = liveKey;
        const config = new SynexusConfig();
        expect(config.getCancelUrl()).toBe('https://compute.synexustax.com/api/v1/invoices/cancel');
    });

    it('no es la ruta de cálculo ni lleva consulta: sin tax_calculations y sin "?"', () => {
        process.env.SYNEXUS_BASE_URL = stagingHost;
        const config = new SynexusConfig();
        expect(config.getCancelUrl()).not.toContain('tax_calculations');
        expect(config.getCancelUrl()).not.toContain('?');
    });

    it('cancelPath es una propiedad de instancia con valor /api/v1/invoices/cancel, como calculationPath', () => {
        process.env.SYNEXUS_BASE_URL = stagingHost;
        const config = new SynexusConfig();
        expect(config.cancelPath).toBe('/api/v1/invoices/cancel');
        expect(config.calculationPath).toBe('/api/v1/tax_calculations');
    });

    it('getCalculationUrl sigue devolviendo la ruta de cálculo: las dos rutas conviven en la misma instancia', () => {
        process.env.SYNEXUS_BASE_URL = stagingHost;
        const config = new SynexusConfig();
        expect(config.getCalculationUrl()).toBe('https://compute.staging.synexustax.com/api/v1/tax_calculations');
        expect(config.getCancelUrl()).toBe('https://compute.staging.synexustax.com/api/v1/invoices/cancel');
        expect(config.getCancelUrl()).not.toBe(config.getCalculationUrl());
    });
});

describe('SynexusConfig — resolveEntityCode por precedencia (CFG-01, CFG-02)', () => {
    let config;

    beforeEach(() => {
        process.env.SYNEXUS_BASE_URL = stagingHost;
        process.env.SYNEXUS_API_KEY = testKey;
        delete process.env.SYNEXUS_ENTITY;
        config = new SynexusConfig();
    });

    it('el argumento de línea de comandos gana sobre la variable y sobre el JSON', () => {
        process.env.SYNEXUS_ENTITY = 'ENV';
        expect(config.resolveEntityCode('ARG', { entity_id: 'JSON' })).toBe('ARG');
    });

    it('sin argumento, la variable de entorno gana sobre el JSON', () => {
        process.env.SYNEXUS_ENTITY = 'ENV';
        expect(config.resolveEntityCode(undefined, { entity_id: 'JSON' })).toBe('ENV');
    });

    it('sin argumento ni variable, se toma entity_id del JSON', () => {
        expect(config.resolveEntityCode(undefined, { entity_id: 'JSON' })).toBe('JSON');
    });

    it('si ninguna vía lo provee lanza nombrando las tres: --entity=, SYNEXUS_ENTITY y entity_id', () => {
        const act = () => config.resolveEntityCode(undefined, {});
        expect(act).toThrow('--entity=');
        expect(act).toThrow('SYNEXUS_ENTITY');
        expect(act).toThrow('entity_id');
    });

    it('imprime el fallo de resolución por console.error antes de lanzar', () => {
        let caught = null;
        try {
            config.resolveEntityCode(undefined, {});
        } catch (error) {
            caught = error;
        }
        expect(caught).not.toBeNull();
        expect(consoleErrorSpy).toHaveBeenCalledWith(caught.message);
    });

    it('un argumento vacío cede el turno a la variable de entorno', () => {
        process.env.SYNEXUS_ENTITY = 'ENV';
        expect(config.resolveEntityCode('', { entity_id: 'JSON' })).toBe('ENV');
    });

    it('una variable de entorno vacía cede el turno al JSON', () => {
        process.env.SYNEXUS_ENTITY = '';
        expect(config.resolveEntityCode(undefined, { entity_id: 'JSON' })).toBe('JSON');
    });

    it('un entity_id vacío en el JSON (el caso real que produce el ERP hoy) cuenta como ausente', () => {
        expect(() => config.resolveEntityCode(undefined, { entity_id: '' })).toThrow('entity_id');
    });

    it('no hay valor por omisión: sin vías, lanza aunque el cuerpo tenga otros campos', () => {
        expect(() => config.resolveEntityCode(undefined, { invoice_id: 'DEMO-001' })).toThrow('SYNEXUS_ENTITY');
    });
});

describe('SynexusConfig — enmascaramiento y perfil (CFG-05, CONN-05)', () => {
    beforeEach(() => {
        process.env.SYNEXUS_BASE_URL = stagingHost;
        process.env.SYNEXUS_API_KEY = testKey;
    });

    it('_maskApiKey devuelve prefijo, tres puntos ASCII y los últimos cuatro caracteres', () => {
        const config = new SynexusConfig();
        expect(config._maskApiKey()).toBe('synexus_test_...0000');
    });

    it('_maskApiKey devuelve *** si la llave es tan corta que la máscara la revelaría entera', () => {
        // Pasa la correspondencia llave↔host (el prefijo es correcto) pero no
        // tiene nada que ocultar detrás de los cuatro últimos caracteres.
        process.env.SYNEXUS_API_KEY = 'synexus_test_abcd';
        const config = new SynexusConfig();
        expect(config._maskApiKey()).toBe('***');
    });

    it('printProfile imprime UNA línea con contrato: v2, el host, la entidad y la llave enmascarada', () => {
        const config = new SynexusConfig();
        config.printProfile('USA');

        expect(consoleLogSpy).toHaveBeenCalledTimes(1);
        const line = consoleLogSpy.mock.calls[0].join(' ');
        expect(line).toContain('contrato: v2');
        expect(line).toContain('compute.staging.synexustax.com');
        expect(line).toContain('USA');
        expect(line).toContain('synexus_test_...0000');
        expect(line).not.toContain('\n');
    });

    it('ninguna línea capturada de console.log contiene la llave completa', () => {
        const config = new SynexusConfig();
        config.printProfile('USA');

        const printedArguments = consoleLogSpy.mock.calls.reduce((all, call) => all.concat(call), []);
        expect(printedArguments.length).toBeGreaterThan(0);
        printedArguments.forEach(argument => {
            expect(String(argument)).not.toContain(testKey);
        });
    });
});
