// src/api/synexusRequestBuilder.js
const crypto = require('crypto');

/**
 * API Layer - Synexus Request Builder (contrato v2)
 * Responsabilidad: Construir el cuerpo de la petición v2 a partir del archivo
 * del ERP y de la operación invocada. nexgen es dueño de los tres campos de
 * intención —transaction_type, committed y request_id— para las DOS operaciones
 * de cálculo (get_tax y post_tax) y los pone a partir de la operación; nunca
 * los hereda del archivo de entrada
 * Principio SOLID: Single Responsibility Principle (SRP)
 * Patrón: Dependency Injection
 *
 * Por qué existe este módulo: el valor por omisión de transaction_type del lado
 * del proveedor es sales_invoice, y committed: false por sí solo NO suprime la
 * persistencia (el proveedor igual guarda un snapshot de factura). Una
 * cotización sólo deja de dejar rastro si se tipa explícitamente como
 * sales_estimate; y una confirmación sólo registra la factura si va tipada
 * como sales_invoice Y confirmada. Las dos intenciones son opuestas en los dos
 * campos, van al mismo endpoint, y se deciden aquí y en ningún otro sitio.
 * cancel_tax no pasa por este mapeo: va a otro endpoint con otro cuerpo.
 */
class SynexusRequestBuilder {
    /**
     * Constructor con inyección de dependencias
     * @param {Logger} logger - Instancia del logger
     */
    constructor(logger) {
        this.logger = logger;
    }

    /**
     * Mapea la operación invocada a los campos de intención del contrato v2.
     * Es la ÚNICA fuente de verdad del mapeo: el validador recibe este objeto
     * como argumento y no guarda su propia copia.
     *
     * Sigue el molde de Config.getEndpointUrl: una comprobación por operación y
     * un throw terminal para todo lo demás. Deliberadamente NO hay rama else con
     * valores por omisión: su ausencia es lo que impide que un refactor futuro
     * reintroduzca sales_invoice por omisión. TEST-03 (cotización) y TEST-02
     * (confirmación) son las guardias; la forma de este método es la primera defensa
     * @param {string} operation - Operación invocada
     * @returns {{ transaction_type: string, committed: boolean }} Intención de la operación
     * @throws {Error} Si la operación no tiene mapeo de intención en el contrato v2 (OPER-05)
     */
    getIntentFor(operation) {
        if (operation === 'get_tax') {
            // Cotización: estimación de venta, sin confirmar. Los DOS campos son
            // necesarios; sólo sales_estimate suprime la persistencia del proveedor.
            return {
                transaction_type: 'sales_estimate',
                committed: false
            };
        }

        if (operation === 'post_tax') {
            // Confirmación: mismo endpoint que la cotización, intención invertida.
            // sales_invoice + committed: true es la ÚNICA combinación que registra
            // una factura confirmada del lado del proveedor; sales_invoice con
            // committed: false deja sólo un snapshot sin confirmar.
            return {
                transaction_type: 'sales_invoice',
                committed: true
            };
        }

        // Sólo las dos operaciones de cálculo tienen mapeo de intención.
        // cancel_tax no pasa por aquí: va a otro endpoint con un cuerpo de
        // proyección propio. Cualquier otra operación cae aquí también.
        const errorMsg = `La operación "${operation}" no tiene mapeo de intención en el contrato v2: ` +
            'no puede emitirse por la ruta de cálculo. Sólo get_tax (sales_estimate) y post_tax (sales_invoice) ' +
            'tienen mapeo; cancel_tax no pasa por este mapeo.';
        console.error(errorMsg);
        this.logger.error(`${errorMsg} - Operation: ${operation}`);
        throw new Error(errorMsg);
    }

    /**
     * Construye el cuerpo de la petición v2: el archivo del ERP tal cual, más los
     * campos de intención de nexgen encima. Devuelve un objeto NUEVO; el
     * argumento nunca se muta
     * @param {string} operation - Operación invocada
     * @param {Object} requestBody - Cuerpo ya validado y saneado, tal como lo dejó el ERP
     * @returns {Object} Cuerpo listo para emitirse, con transaction_type, committed y request_id
     * @throws {Error} Si la operación no tiene mapeo o si falta algún campo de intención
     */
    buildRequestBody(operation, requestBody) {
        // 1. La intención primero: una operación sin mapeo aborta aquí, antes de
        //    que exista cuerpo alguno
        const intent = this.getIntentFor(operation);

        // 2. El orden del esparcido importa: primero el archivo, después la
        //    intención. Lo que nexgen decide queda ENCIMA de lo que traiga el
        //    archivo, nunca debajo
        const body = Object.assign({}, requestBody, intent, {
            request_id: this._generateRequestId()
        });

        // 3. Segunda mitad de OPER-05: un campo de intención ausente aborta antes
        //    de devolver el cuerpo
        this._assertIntentFieldsPresent(body);

        console.log(`Cuerpo v2 construido para ${operation}: ${body.transaction_type}, committed=${body.committed}, request_id=${body.request_id}`);
        return body;
    }

    /**
     * Genera la llave de idempotencia que viaja en el cuerpo como request_id:
     * un UUID v4 a partir de crypto.randomBytes(16). Un solo camino de código,
     * sin consultar si existe el generador nativo de UUID de Node: ese
     * generador aparece en Node 14.17 y la versión del servidor de producción
     * es desconocida
     * @private
     * @returns {string} UUID v4 en formato 8-4-4-4-12
     */
    _generateRequestId() {
        const bytes = crypto.randomBytes(16);

        // Bits de versión (4) y de variante (RFC 4122) sobre el búfer
        bytes[6] = (bytes[6] & 0x0f) | 0x40;
        bytes[8] = (bytes[8] & 0x3f) | 0x80;

        const hex = bytes.toString('hex');
        return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
    }

    /**
     * Comprueba que el cuerpo construido lleve los tres campos de intención con el
     * tipo correcto. Si algo falta, aborta: un cuerpo a medias dejaría al proveedor
     * caer en sus valores por omisión, que es exactamente lo que OPER-01 prohíbe
     * @private
     * @param {Object} body - Cuerpo ya construido
     * @throws {Error} Si falta algún campo de intención, nombrándolo
     */
    _assertIntentFieldsPresent(body) {
        let missingField = null;

        if (typeof body.transaction_type !== 'string' || body.transaction_type.length === 0) {
            missingField = 'transaction_type';
        } else if (typeof body.committed !== 'boolean') {
            missingField = 'committed';
        } else if (typeof body.request_id !== 'string' || body.request_id.length === 0) {
            missingField = 'request_id';
        }

        if (missingField !== null) {
            const errorMsg = `El cuerpo v2 no lleva el campo de intención "${missingField}": ` +
                'no puede emitirse, porque el proveedor caería en su valor por omisión.';
            console.error(errorMsg);
            this.logger.error(errorMsg);
            throw new Error(errorMsg);
        }
    }
}

module.exports = SynexusRequestBuilder;
