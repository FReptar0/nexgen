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
