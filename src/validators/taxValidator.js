// src/validators/taxValidator.js

/**
 * Validation Layer - Tax Validator
 * Responsabilidad: Validar reglas de negocio relacionadas con impuestos
 * Principio SOLID: Single Responsibility Principle (SRP)
 */
class TaxValidator {
    /**
     * Constructor con inyección de dependencias
     * @param {Logger} logger - Instancia del logger
     */
    constructor(logger) {
        this.logger = logger;
        this.validOperations = ['get_tax', 'post_tax', 'cancel_tax'];
    }

    /**
     * Valida que la operación sea válida
     * @param {string} operation - Operación a validar
     * @throws {Error} Si la operación no es válida
     */
    validateOperation(operation) {
        if (!this.validOperations.includes(operation)) {
            const errorMsg = `Operación inválida: "${operation}". Usa "get_tax", "post_tax" o "cancel_tax".`;
            console.error(errorMsg);
            this.logger.error(errorMsg);
            throw new Error(errorMsg);
        }
    }

    /**
     * Valida el valor "Committed" según la operación
     * @param {string} operation - Operación a realizar
     * @param {Object} requestBody - Cuerpo de la petición
     * @throws {Error} Si el valor "Committed" no es válido
     */
    validateCommittedField(operation, requestBody) {
        if (operation === 'get_tax') {
            if (requestBody.Committed !== false) {
                const errorMsg = 'Para la operación get_tax, el valor "Committed" debe ser false.';
                console.error(errorMsg);
                this.logger.error(errorMsg);
                throw new Error(errorMsg);
            }
        } else if (operation === 'post_tax') {
            if (requestBody.Committed !== true) {
                const errorMsg = 'Para la operación post_tax, el valor "Committed" debe ser true.';
                console.error(errorMsg);
                this.logger.error(errorMsg);
                throw new Error(errorMsg);
            }
        }
        // cancel_tax no valida el campo Committed
    }

    /**
     * Valida los campos de intención del contrato v2 contra la intención de la
     * operación invocada. Es el hermano de validateCommittedField para la rama
     * v2: mismo principio (comparación estricta que impide invertir cotizar y
     * confirmar), sobre los campos del contrato que sí aplica. Lo llama
     * únicamente la rama v2 del manejador; NO forma parte de validate()
     * @param {string} operation - Operación a realizar
     * @param {Object} requestBody - Cuerpo de la petición, tal como lo dejó el ERP
     * @param {Object} expectedIntent - Intención de la operación, tal como la devolvió SynexusRequestBuilder.getIntentFor
     * @throws {Error} Si el archivo parece de v1, si contradice la operación, o si trae request_id
     */
    validateV2IntentFields(operation, requestBody, expectedIntent) {
        // 1. Guardia de archivo v1. Se comprueba presencia, no veracidad: Committed
        //    con valor false es justamente lo que traería una cotización v1. Va
        //    primero porque diagnostica la causa raíz (un archivo viejo en la
        //    carpeta con el selector en v2); las otras tres darían un síntoma.
        if (requestBody.Committed !== undefined) {
            const errorMsg = `El archivo trae el campo "Committed" (con mayúscula), que es del contrato v1: el archivo parece del contrato v1. ` +
                'O el archivo está en forma v1, o el selector debería ser v1 (--api-version=v1 o TAX_API_VERSION=v1).';
            console.error(errorMsg);
            this.logger.error(errorMsg);
            throw new Error(errorMsg);
        }

        // 2. transaction_type: contradecir aborta; coincidir se tolera; ausente es el caso normal
        if (requestBody.transaction_type !== undefined && requestBody.transaction_type !== expectedIntent.transaction_type) {
            const errorMsg = `Para la operación ${operation}, el archivo trae "transaction_type" = ${JSON.stringify(requestBody.transaction_type)}, ` +
                `pero la operación corresponde a "${expectedIntent.transaction_type}". ` +
                'Se aborta en vez de sobreescribir: una contradicción significa que la extracción del ERP cambió ' +
                'o que se invocó el comando equivocado, y las dos cosas merecen ojos humanos.';
            console.error(errorMsg);
            this.logger.error(errorMsg);
            throw new Error(errorMsg);
        }

        // 3. committed: OPER-04 bajo v2, con la misma comparación estricta de validateCommittedField
        if (requestBody.committed !== undefined && requestBody.committed !== expectedIntent.committed) {
            const errorMsg = `Para la operación ${operation}, el valor "committed" debe ser ${expectedIntent.committed} ` +
                `y el archivo trae ${JSON.stringify(requestBody.committed)}. ` +
                'Se aborta en vez de sobreescribir: una contradicción significa que la extracción del ERP cambió ' +
                'o que se invocó el comando equivocado, y las dos cosas merecen ojos humanos.';
            console.error(errorMsg);
            this.logger.error(errorMsg);
            throw new Error(errorMsg);
        }

        // 4. request_id es propiedad de nexgen: uno heredado del archivo rompería la idempotencia
        if (requestBody.request_id !== undefined) {
            const errorMsg = 'El archivo trae "request_id", que es un campo de nexgen: la llave de idempotencia ' +
                'se genera en cada corrida y una heredada del archivo rompería esa garantía. Retírelo del archivo.';
            console.error(errorMsg);
            this.logger.error(errorMsg);
            throw new Error(errorMsg);
        }
        // Un cuerpo sin ninguno de los tres campos es el caso normal: los pone el builder
    }

    /**
     * Valida que el cuerpo de la petición sea un objeto válido
     * @param {Object} requestBody - Cuerpo de la petición
     * @throws {Error} Si el cuerpo no es válido
     */
    validateRequestBody(requestBody) {
        if (!requestBody || typeof requestBody !== 'object') {
            const errorMsg = 'El cuerpo de la petición no es un objeto válido';
            console.error(errorMsg);
            this.logger.error(errorMsg);
            throw new Error(errorMsg);
        }
    }

    /**
     * Sanitiza campos de texto para evitar problemas con caracteres especiales
     * @param {Object} requestBody - Cuerpo de la petición
     * @returns {Object} Objeto sanitizado
     */
    sanitizeStringFields(requestBody) {
        try {
            // Recursivamente sanitiza todos los campos de string
            const sanitized = JSON.parse(JSON.stringify(requestBody, (key, value) => {
                if (typeof value === 'string') {
                    // Escapar apostrofes que pueden causar problemas en la transmisión
                    return value.replace(/'/g, "\\'");
                }
                return value;
            }));
            
            console.log('Datos sanitizados exitosamente');
            return sanitized;
        } catch (err) {
            const errorMsg = `Error al sanitizar los datos: ${err.message}`;
            console.error(errorMsg);
            this.logger.error(errorMsg);
            throw new Error(errorMsg);
        }
    }

    /**
     * Valida todos los aspectos de una operación de impuestos
     * @param {string} operation - Operación a realizar
     * @param {Object} requestBody - Cuerpo de la petición
     * @returns {Object} Objeto validado y sanitizado
     */
    validate(operation, requestBody) {
        this.validateOperation(operation);
        this.validateRequestBody(requestBody);
        this.validateCommittedField(operation, requestBody);
        
        // Sanitizar los datos antes de enviarlos
        const sanitizedData = this.sanitizeStringFields(requestBody);
        return sanitizedData;
    }

    /**
     * Obtiene la lista de operaciones válidas
     * @returns {string[]} Array de operaciones válidas
     */
    getValidOperations() {
        return [...this.validOperations];
    }
}

module.exports = TaxValidator;
