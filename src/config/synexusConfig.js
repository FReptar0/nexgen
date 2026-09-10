// src/config/synexusConfig.js
//
// ORDEN DE CARGA: este módulo NO llama a dotenv. Depende de que
// src/config/index.js ya se haya cargado, porque ese módulo es el que lee el
// archivo .env una sola vez y puebla process.env. index.js lo garantiza al
// requerir './src/config' en su primera línea de imports. Si alguien mueve los
// requires y este archivo se carga antes que src/config/index.js, las
// variables SYNEXUS_* estarán vacías y el constructor abortará aunque el .env
// sea correcto.

/**
 * Configuration Layer - Synexus Config (contrato v2)
 * Responsabilidad: Centralizar la configuración del contrato v2 y aplicar los
 * frenos de arranque —variables requeridas y correspondencia llave↔host— al
 * construirse, antes de que exista petición alguna
 * Principio SOLID aplicado: Single Responsibility Principle (SRP)
 *
 * A diferencia de src/config/index.js, este módulo exporta la CLASE y no una
 * instancia: se construye únicamente cuando el selector de contrato resolvió
 * v2, de modo que un servidor sin variables de v2 siga corriendo v1 intacto.
 */
class SynexusConfig {
    constructor() {
        // Correspondencia dura entre prefijo de llave y host: es la frontera de
        // ambientes del proveedor y cruzarla devuelve 401. Sólo los prefijos de
        // la marca nueva; los de la marca anterior (syntax_*) ya no son válidos
        // y caen en la rama de "prefijo desconocido".
        this.keyPrefixHosts = {
            'synexus_test_': 'compute.staging.synexustax.com',
            'synexus_live_': 'compute.synexustax.com'
        };

        // Ruta canónica de cálculo según la referencia de API. Sin el alias
        // /calculate: sólo este fragmento es literal, el host sale de configuración.
        this.calculationPath = '/api/v1/tax_calculations';

        this._validateRequiredEnvVars();
        this._validateKeyHostMatch();
    }

    /**
     * Valida que las variables de entorno que exige el contrato v2 estén presentes.
     * SYNEXUS_ENTITY no va aquí: se resuelve por precedencia y su ausencia
     * tiene su propio mensaje en resolveEntityCode
     * @private
     * @throws {Error} Si falta alguna, nombrando cuáles y dónde ponerlas
     */
    _validateRequiredEnvVars() {
        const required = ['SYNEXUS_BASE_URL', 'SYNEXUS_API_KEY'];
        const missing = required.filter(key => !process.env[key]);

        if (missing.length > 0) {
            const errorMsg = `Variables de entorno faltantes para el contrato v2: ${missing.join(', ')}. ` +
                'Defínalas en el archivo .env de la raíz del proyecto.';
            console.error(errorMsg);
            throw new Error(errorMsg);
        }
    }

    /**
     * Verifica que el prefijo de la llave corresponda al host configurado (SAFE-03).
     * Una llave de producción apuntada a staging, o al revés, aborta aquí: antes
     * de que exista siquiera una petición
     * @private
     * @throws {Error} Si el prefijo no se reconoce o no corresponde al host
     */
    _validateKeyHostMatch() {
        const prefix = this._findKeyPrefix();
        const acceptedPrefixes = Object.keys(this.keyPrefixHosts).join(', ');

        if (!prefix) {
            const errorMsg = 'El prefijo de SYNEXUS_API_KEY no se reconoce. ' +
                `Prefijos aceptados: ${acceptedPrefixes}. Verifique que la llave sea la re-emitida con la marca nueva.`;
            console.error(errorMsg);
            throw new Error(errorMsg);
        }

        const expectedHost = this.keyPrefixHosts[prefix];
        const configuredHost = this._getConfiguredHost();

        if (configuredHost !== expectedHost) {
            const errorMsg = `La llave con prefijo ${prefix} sólo es válida contra ${expectedHost}, ` +
                `pero SYNEXUS_BASE_URL apunta a ${configuredHost}. ` +
                'Corrija SYNEXUS_BASE_URL o use la llave del ambiente al que quiere apuntar.';
            console.error(errorMsg);
            throw new Error(errorMsg);
        }
    }

    /**
     * Busca cuál de los prefijos aceptados encabeza la llave configurada
     * @private
     * @returns {string|undefined} El prefijo, o undefined si ninguno corresponde
     */
    _findKeyPrefix() {
        const apiKey = this.getApiKey();
        return Object.keys(this.keyPrefixHosts).find(prefix => apiKey.startsWith(prefix));
    }

    /**
     * Extrae el hostname de SYNEXUS_BASE_URL. Envuelve al constructor URL para que
     * una variable malformada produzca un mensaje en español, no un TypeError de Node
     * @private
     * @returns {string} hostname configurado
     * @throws {Error} Si la variable no es una URL válida
     */
    _getConfiguredHost() {
        const baseUrl = this.getBaseUrl();

        try {
            return new URL(baseUrl).hostname;
        } catch (err) {
            const errorMsg = `SYNEXUS_BASE_URL no es una URL válida: "${baseUrl}". ` +
                'Ejemplo: https://compute.staging.synexustax.com';
            console.error(errorMsg);
            throw new Error(errorMsg);
        }
    }

    /**
     * Obtiene la URL base del proveedor v2
     * @returns {string}
     */
    getBaseUrl() {
        return process.env.SYNEXUS_BASE_URL;
    }

    /**
     * Obtiene la llave portadora del proveedor v2. Nunca imprimirla completa:
     * para mostrarla use _maskApiKey
     * @returns {string}
     */
    getApiKey() {
        return process.env.SYNEXUS_API_KEY;
    }

    /**
     * Compone la URL de cálculo: host de configuración + ruta canónica (CONN-04).
     * Quita barras finales sobrantes de la base para no producir una barra doble
     * @returns {string} URL completa del endpoint de cálculo
     */
    getCalculationUrl() {
        const baseUrl = this.getBaseUrl().replace(/\/+$/, '');
        return `${baseUrl}${this.calculationPath}`;
    }

    /**
     * Resuelve el código de entidad por precedencia (CFG-01): argumento de línea de
     * comandos, luego variable de entorno, luego campo entity_id del cuerpo.
     * Se comprueba por veracidad, no por !== undefined: una cadena vacía cede el
     * turno a la siguiente vía. Es el caso real: el JSON que produce el ERP hoy
     * trae "entity_id": "". No hay valor por omisión escrito en el código
     * @param {string|undefined} cliEntityCode - Valor del argumento --entity=, si se dio
     * @param {Object} requestBody - Cuerpo de la petición ya leído y saneado
     * @returns {string} Código de entidad efectivo
     * @throws {Error} Si ninguna de las tres vías lo provee (CFG-02)
     */
    resolveEntityCode(cliEntityCode, requestBody) {
        if (cliEntityCode) {
            return cliEntityCode;
        }

        if (process.env.SYNEXUS_ENTITY) {
            return process.env.SYNEXUS_ENTITY;
        }

        if (requestBody && requestBody.entity_id) {
            return requestBody.entity_id;
        }

        const errorMsg = 'No se pudo resolver el código de entidad para el contrato v2. ' +
            'Proporciónelo por una de estas tres vías, en orden de precedencia: ' +
            'el argumento --entity=<codigo>, la variable de entorno SYNEXUS_ENTITY, ' +
            'o el campo entity_id del archivo JSON de entrada.';
        console.error(errorMsg);
        throw new Error(errorMsg);
    }

    /**
     * Enmascara la llave para mostrarla: prefijo reconocido, tres puntos ASCII
     * (no el carácter de elipsis, para que la línea siga siendo greppable) y los
     * últimos cuatro caracteres (CFG-05)
     * @private
     * @returns {string} Llave enmascarada, o *** si no puede enmascararse sin fuga
     */
    _maskApiKey() {
        const apiKey = this.getApiKey();
        const prefix = this._findKeyPrefix();

        // Sin prefijo reconocido, o con una llave tan corta que prefijo + últimos
        // cuatro la revelarían entera, no se arriesga una fuga parcial.
        if (!prefix || apiKey.length <= prefix.length + 4) {
            return '***';
        }

        return `${prefix}...${apiKey.slice(-4)}`;
    }

    /**
     * Imprime en una sola línea el perfil efectivo de la corrida v2 (CONN-05):
     * contrato, host, entidad y llave enmascarada. Debe verse antes de cualquier
     * salida a la red. Nunca imprime el objeto completo ni la llave cruda
     * @param {string} entityCode - Código de entidad ya resuelto
     */
    printProfile(entityCode) {
        console.log(
            `Perfil efectivo -> contrato: v2 | host: ${this.getBaseUrl()} | ` +
            `entidad: ${entityCode} | llave: ${this._maskApiKey()}`
        );
    }
}

module.exports = SynexusConfig;
