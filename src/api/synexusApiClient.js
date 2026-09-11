// src/api/synexusApiClient.js
const axios = require('axios');

/**
 * API Layer - Synexus API Client (contrato v2)
 * Responsabilidad: Gestionar todas las peticiones HTTP al proveedor del
 * contrato v2 (Synexus Compute). Recibe el cuerpo YA construido por
 * SynexusRequestBuilder y la entidad ya resuelta: este cliente no construye
 * nada, sólo emite. Enruta por operación: get_tax y post_tax van al endpoint
 * de cálculo, cancel_tax al de cancelación; las URL las da SynexusConfig,
 * este cliente no compone rutas (CONN-04)
 * Principio SOLID: Single Responsibility Principle (SRP)
 * Patrón: Dependency Injection
 *
 * Copiado de src/api/taxApiClient.js (congelado) con estas divergencias
 * deliberadas: método POST, credencial en el header Authorization: Bearer
 * (nunca en la URL), código de entidad en su header dedicado, ninguna
 * traza que pueda llevar la llave, el identificador de petición del
 * proveedor registrado en toda corrida —línea de éxito, mensaje de error y
 * log— para poder levantar soporte (SAFE-06), y los errores clasificados
 * por su código estable (cálculo) o por status (cancelación), nunca por el
 * texto del proveedor (SAFE-05).
 */
class SynexusApiClient {
    /**
     * Constructor con inyección de dependencias
     * @param {SynexusConfig} synexusConfig - Configuración del contrato v2
     * @param {Logger} logger - Instancia del logger
     */
    constructor(synexusConfig, logger) {
        this.synexusConfig = synexusConfig;
        this.logger = logger;
        this.timeout = 30000; // 30 segundos, el mismo valor que v1
        // Nombre del header de entidad como propiedad de instancia, igual que
        // validOperations en el validador: greppable, sustituible desde una
        // prueba, y un solo lugar que tocar en el siguiente cambio de marca.
        // Es el nombre de la marca nueva; el anterior (X-Syntax-*) ya no aplica.
        this.entityHeaderName = 'X-Synexus-Entity';
    }

    /**
     * Realiza una petición al proveedor v2, contra el endpoint que corresponde
     * a la operación
     * @param {string} operation - Operación a realizar
     * @param {Object} requestBody - Cuerpo YA construido (el tipado del cálculo o la proyección de la cancelación)
     * @param {string} entityCode - Código de entidad ya resuelto
     * @returns {Promise<Object>} Respuesta del proveedor, sin transformar
     * @throws {Error} Si la operación no tiene endpoint en el contrato v2 (antes de tocar axios) o si la petición falla
     */
    async makeRequest(operation, requestBody, entityCode) {
        const url = this._resolveUrl(operation);

        // Esta traza es segura: la URL de v2 no lleva credencial. El cuerpo no
        // se imprime aquí porque la rama v2 del CLI ya lo imprimió, y el objeto
        // headers no se imprime nunca, por ninguna vía: lleva la llave.
        console.log(`Realizando petición ${operation.toUpperCase()} a: ${url}`);

        try {
            const response = await axios({
                method: 'POST',
                url: url,
                data: requestBody,
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.synexusConfig.getApiKey()}`,
                    [this.entityHeaderName]: entityCode
                },
                timeout: this.timeout,
                // Considera exitosos todos los códigos de estado menores a 500
                // para manejarlos manualmente en _handleResponse
                validateStatus: (status) => status < 500
            });

            return this._handleResponse(response, url, operation);
        } catch (error) {
            this._handleError(error, url, operation, requestBody);
            throw error;
        }
    }

    /**
     * Resuelve la URL del endpoint según la operación, pidiéndosela a
     * SynexusConfig: get_tax y post_tax comparten la ruta de cálculo y
     * cancel_tax va a la de cancelación. Este cliente no compone rutas ni
     * conoce sus cadenas (CONN-04).
     *
     * Sigue el molde de getIntentFor: comprobación por operación y throw
     * terminal, SIN rama else con valor por omisión. Mandar una cancelación a
     * la ruta de cálculo —o al revés— confundiría al proveedor con un cuerpo
     * válido para otra cosa; por eso una operación sin endpoint aborta aquí,
     * antes de tocar axios
     * @private
     * @param {string} operation - Operación a realizar
     * @returns {string} URL completa del endpoint
     * @throws {Error} Si la operación no tiene endpoint en el contrato v2
     */
    _resolveUrl(operation) {
        if (operation === 'cancel_tax') {
            return this.synexusConfig.getCancelUrl();
        }

        if (operation === 'get_tax' || operation === 'post_tax') {
            return this.synexusConfig.getCalculationUrl();
        }

        const errorMsg = `La operación "${operation}" no tiene endpoint en el contrato v2.`;
        console.error(errorMsg);
        this.logger.error(`${errorMsg} - Operation: ${operation}`);
        throw new Error(errorMsg);
    }

    /**
     * Extrae el identificador de petición que devuelve el proveedor (SAFE-06).
     * Es lo que el proveedor pide para levantar soporte, así que se registra
     * en toda corrida, exitosa o fallida. Llega por tres vías, en este orden
     * de preferencia:
     *   1. response.data.meta.request_id — cuerpo de ÉXITO del cálculo. Sólo
     *      existe ahí: la respuesta de cancelación no trae meta.
     *   2. response.data.request_id — cuerpo de ERROR del cálculo.
     *   3. response.headers['x-request-id'] — header de respuesta X-Request-Id,
     *      presente en todos los endpoints, también en la cancelación. axios
     *      entrega los nombres de header en minúsculas.
     * Se prefiere el cuerpo porque es el que el proveedor cita para soporte.
     * De los headers se lee SÓLO ése: nunca se serializa el objeto entero.
     * Acceso defensivo: data puede ser null o una cadena (un proxy que
     * contesta HTML), y headers puede faltar en un doble de prueba.
     * @private
     * @param {Object} response - Respuesta de axios (resuelta o la de un error)
     * @returns {string|null} El identificador, sólo si es cadena no vacía
     */
    _extractProviderRequestId(response) {
        const data = response ? response.data : null;
        if (data && typeof data === 'object') {
            const meta = data.meta;
            if (meta && typeof meta === 'object' && typeof meta.request_id === 'string' && meta.request_id.length > 0) {
                return meta.request_id;
            }
            if (typeof data.request_id === 'string' && data.request_id.length > 0) {
                return data.request_id;
            }
        }

        const headers = response ? response.headers : null;
        if (headers && typeof headers === 'object') {
            const headerValue = headers['x-request-id'];
            if (typeof headerValue === 'string' && headerValue.length > 0) {
                return headerValue;
            }
        }

        return null;
    }

    /**
     * Copia superficial del cuerpo sin docs_url, para lo que se imprime en
     * consola. El docs_url de los errores v2 apunta a un host que no resuelve
     * (verificado el 10-sep-2026): se conserva en el log de winston por si
     * algún día vive, pero no se le dice al operador que lo abra. La
     * respuesta que se devuelve al manejador —y que va al archivo— es la
     * original, intacta: esto sólo filtra la traza.
     * @private
     * @param {*} data - Cuerpo de la respuesta
     * @returns {*} El mismo valor, o una copia sin docs_url si la traía
     */
    _withoutDocsUrl(data) {
        if (!data || typeof data !== 'object' || Array.isArray(data) || !('docs_url' in data)) {
            return data;
        }
        const copy = Object.assign({}, data);
        delete copy.docs_url;
        return copy;
    }

    /**
     * Describe en español un error del endpoint de cálculo (get_tax y
     * post_tax), ramificando por data.code, el código estable del contrato
     * v2 (SAFE-05). El texto de data.message lo redacta el proveedor y puede
     * cambiar sin aviso: se cita entre comillas al final y NUNCA se
     * interpreta. Un código fuera del catálogo cae al genérico con su
     * literal, para que el operador pueda buscarlo —aquí SÍ hay respaldo,
     * por decisión de la fase: un código nuevo debe llegar con texto, no
     * abortar mudo.
     *
     * Los dos códigos del 409 tienen semántica opuesta y por eso se
     * distinguen por code y no por status: idempotency_key_conflict es
     * "misma llave, cuerpo distinto" (alguien cambió el archivo entre
     * corridas; no se reintenta, merece ojos humanos) e invoice_stale_object
     * es concurrencia (reintentar es razonable). El reintento del plan 02-04
     * ramifica por este mismo code.
     * @private
     * @param {number} status - Status HTTP; no clasifica (lo hace code), se recibe por simetría con _describeCancelError
     * @param {Object} data - Cuerpo del error, con code de tipo cadena
     * @param {Object} [headers] - Headers de respuesta en minúsculas; sólo se lee retry-after
     * @returns {string} Descripción en español, con el mensaje del proveedor citado si lo hay
     */
    _describeCalculationError(status, data, headers) {
        const code = data.code;
        let description;

        if (code === 'invalid_key') {
            description = 'La llave SYNEXUS_API_KEY fue rechazada por el proveedor. Verifique que sea la llave del ambiente al que apunta SYNEXUS_BASE_URL.';
        } else if (code === 'tax_code_missing') {
            description = 'Una línea del carrito no trae tax_code; el proveedor rechaza toda la petición. Corrija la extracción del ERP.';
        } else if (code === 'idempotency_key_conflict') {
            description = 'Ya existe una petición con la misma llave de idempotencia y un cuerpo distinto: el archivo cambió entre corridas. No se reintenta; requiere revisión humana.';
        } else if (code === 'invoice_stale_object') {
            description = 'La factura cambió mientras el proveedor la procesaba (conflicto de concurrencia). Vuelva a ejecutar la operación.';
        } else if (code === 'rate_limited') {
            // De los headers se lee SÓLO retry-after; el objeto nunca se serializa
            const retryAfter = headers && typeof headers === 'object' ? headers['retry-after'] : undefined;
            description = typeof retryAfter === 'string' && retryAfter.length > 0
                ? `El proveedor limitó la tasa de peticiones. Reintente en ${retryAfter} segundos.`
                : 'El proveedor limitó la tasa de peticiones. Reintente en unos segundos.';
        } else if (code === 'cart_empty') {
            description = 'El carrito está vacío: el archivo no trae líneas en cart.';
        } else if (code === 'validation_error') {
            // details[]: cadenas tal cual, objetos serializados, unidos con '; '
            const details = Array.isArray(data.details) && data.details.length > 0
                ? data.details.map(detail => (typeof detail === 'string' ? detail : JSON.stringify(detail))).join('; ')
                : 'sin detalles';
            description = `El proveedor rechazó el cuerpo por validación: ${details}`;
        } else {
            description = `El proveedor devolvió el código "${code}".`;
        }

        return this._quoteProviderMessage(description, data);
    }

    /**
     * Describe en español un error del endpoint de cancelación, ramificando
     * por status HTTP (SAFE-05). Sus errores vienen en forma simple
     * { error, message }, SIN code; por eso el status es la única señal
     * estable. Está PROHIBIDO ramificar por el texto de message
     * (message.includes y parientes): lo redacta el proveedor y puede
     * cambiar sin aviso, y un cambio de redacción no debe cambiar el
     * comportamiento de nexgen. Se cita tal cual, entre comillas. Si un
     * cuerpo de cancelación trajera code, se ignora: aquí clasifica el status.
     * @private
     * @param {number} status - Status HTTP de la respuesta
     * @param {*} data - Cuerpo del error (puede no ser objeto)
     * @returns {string} Descripción en español, con el mensaje del proveedor citado si lo hay
     */
    _describeCancelError(status, data) {
        let description;

        if (status === 400) {
            description = 'La cancelación fue rechazada: el cuerpo no es válido para el proveedor.';
        } else if (status === 404) {
            description = 'La factura a cancelar no existe en el proveedor: verifique invoice_id y customer_id, y que la factura se haya confirmado contra este mismo ambiente.';
        } else if (status === 409) {
            description = 'La cancelación chocó con otra operación en curso sobre la misma factura.';
        } else if (status === 422) {
            description = 'El proveedor no puede cancelar esta factura: probablemente ya está cancelada o nunca se confirmó.';
        } else {
            description = `La cancelación falló con HTTP ${status}.`;
        }

        return this._quoteProviderMessage(description, data);
    }

    /**
     * Añade a la descripción el mensaje del proveedor, citado entre comillas
     * y sin interpretarlo, cuando el cuerpo lo trae como cadena.
     * @private
     * @param {string} description - Descripción en español ya decidida
     * @param {*} data - Cuerpo del error
     * @returns {string} La descripción, con el sufijo si aplica
     */
    _quoteProviderMessage(description, data) {
        const providerMessage = data && typeof data === 'object' ? data.message : undefined;
        if (typeof providerMessage === 'string') {
            return `${description} Mensaje del proveedor: "${providerMessage}"`;
        }
        return description;
    }

    /**
     * Maneja la respuesta del proveedor. Toda salida lleva el identificador de
     * petición del proveedor (SAFE-06): la línea de éxito, el mensaje lanzado
     * y la entrada del log cuando el status es de error. Los errores llegan
     * clasificados (SAFE-05): por código estable en el cálculo, por status en
     * la cancelación, nunca por el texto del proveedor.
     * @private
     * @param {Object} response - Respuesta de axios
     * @param {string} url - URL de la petición
     * @param {string} operation - Operación realizada
     * @returns {Object} Datos de la respuesta, tal cual llegaron
     * @throws {Error} Si el status code indica error; el Error lleva providerResponded = true y providerRequestId
     */
    _handleResponse(response, url, operation) {
        console.log(`Respuesta recibida - Status: ${response.status} ${response.statusText}`);

        // Mostrar datos de respuesta (sin docs_url: sólo va al log)
        if (response.data) {
            console.log('Respuesta del servidor:', JSON.stringify(this._withoutDocsUrl(response.data), null, 2));
        }

        const providerRequestId = this._extractProviderRequestId(response);
        const requestIdNote = providerRequestId || 'no informado por el proveedor';

        // Verificar si el servidor indica error mediante el status code.
        // Clasificación (SAFE-05): la cancelación por status (sus errores no
        // traen code); el cálculo por data.code cuando es cadena; sin code,
        // el molde de v1 (cuerpo serializado). Siempre con el request_id.
        if (response.status >= 400) {
            const data = response.data;
            let errorMsg;
            if (operation === 'cancel_tax') {
                const description = this._describeCancelError(response.status, data);
                errorMsg = `Error HTTP ${response.status}: ${description} - request_id=${requestIdNote}`;
            } else if (data && typeof data === 'object' && typeof data.code === 'string') {
                const description = this._describeCalculationError(response.status, data, response.headers);
                errorMsg = `Error HTTP ${response.status} (${data.code}): ${description} - request_id=${requestIdNote}`;
            } else {
                const serverErrorMsg = data ? JSON.stringify(this._withoutDocsUrl(data)) : response.statusText;
                errorMsg = `Error HTTP ${response.status}: ${serverErrorMsg} - request_id=${requestIdNote}`;
            }
            console.error(errorMsg);
            // docs_url va SÓLO al log de winston, nunca a la consola ni al mensaje
            const docsUrlNote = data && typeof data.docs_url === 'string' ? ` - docs_url: ${data.docs_url}` : '';
            this.logger.error(`${errorMsg} - URL: ${url} - Operation: ${operation}${docsUrlNote}`);
            // Este Error es nuestro (no el de axios) y cae en el catch de
            // makeRequest, que lo pasa por _handleError: las marcas le dicen
            // que el proveedor SÍ respondió, para que la nota de soporte no
            // diga que no lo hizo.
            const error = new Error(errorMsg);
            error.providerResponded = true;
            error.providerRequestId = providerRequestId;
            throw error;
        }

        // Log de éxito, con el identificador del proveedor
        const successLogMsg = `SUCCESS: ${operation} - Status: ${response.status} - request_id=${requestIdNote}`;
        console.log(successLogMsg);

        return response.data;
    }

    /**
     * Maneja errores de petición HTTP
     *
     * CUIDADO: el objeto de error de axios lleva la petición completa en
     * error.config —headers incluidos, y por tanto la llave portadora— y un
     * toJSON que la serializa. Aquí sólo se leen error.code, error.message,
     * las marcas propias providerResponded/providerRequestId, y de
     * error.response únicamente status, statusText, data y headers (y de los
     * headers, sólo x-request-id). No serializar el error entero, ni
     * error.config, ni error.request (más allá de su presencia), ni
     * response.config, ni llamar a su toJSON: sería imprimir la llave en la
     * salida estándar y en los archivos de log (CFG-05). No "mejore" el
     * diagnóstico imprimiendo el error completo.
     *
     * requestBody es el cuerpo que nexgen construyó y envió —sin credencial:
     * la llave viaja en el header— y se usa sólo para leer su request_id,
     * la llave de idempotencia propia, cuando el proveedor no respondió.
     * @private
     * @param {Error} error - Error capturado
     * @param {string} url - URL de la petición
     * @param {string} operation - Operación realizada
     * @param {Object} [requestBody] - Cuerpo enviado; la cancelación no lleva request_id
     */
    _handleError(error, url, operation, requestBody) {
        let errorMsg = 'Error en la petición: ';

        if (error.code === 'ECONNREFUSED') {
            errorMsg += 'Conexión rechazada. El servidor no está disponible o la URL es incorrecta.';
            console.error(errorMsg);
            console.error(`URL intentada: ${url}`);
            console.error('Verifique que:');
            console.error('1. El servidor esté en funcionamiento');
            console.error('2. La SYNEXUS_BASE_URL en .env sea correcta');
            console.error('3. No hay firewall bloqueando la conexión');
        } else if (error.code === 'ECONNABORTED') {
            errorMsg += 'Timeout de conexión. La petición tardó más de 30 segundos.';
            console.error(errorMsg);
        } else if (error.code === 'ENOTFOUND') {
            errorMsg += 'Servidor no encontrado. Verifique la URL en SYNEXUS_BASE_URL.';
            console.error(errorMsg);
            console.error(`URL: ${url}`);
        } else if (error.response) {
            // Error con respuesta del servidor: sólo el status y el cuerpo
            const serverResponse = error.response.data || error.response.statusText;
            errorMsg += `HTTP ${error.response.status}`;
            console.error(errorMsg);
            console.error(`URL: ${url}`);
            console.error('Mensaje del servidor:', JSON.stringify(serverResponse, null, 2));
        } else if (error.request) {
            // Error de red sin respuesta
            errorMsg += 'No se recibió respuesta del servidor (problema de conectividad)';
            console.error(errorMsg);
        } else {
            // Otro tipo de error
            errorMsg += error.message;
            console.error(errorMsg);
        }

        // Identificador para soporte (SAFE-06). Si el proveedor respondió
        // —axios rechazó con response (5xx) o _handleResponse lanzó por un
        // 4xx— el que vale es el suyo. Si no respondió (timeout, red), no
        // hay identificador del proveedor y queda el request_id que nexgen
        // generó en el cuerpo del cálculo, para correlacionar si el proveedor
        // sí lo recibió. La cancelación no lleva llave: se dice tal cual.
        const providerResponded = Boolean(error.response) || error.providerResponded === true;
        let providerRequestId = null;
        if (error.response) {
            providerRequestId = this._extractProviderRequestId(error.response);
        } else if (error.providerResponded === true && typeof error.providerRequestId === 'string') {
            providerRequestId = error.providerRequestId;
        }
        const ownRequestId = requestBody && typeof requestBody.request_id === 'string' && requestBody.request_id.length > 0
            ? requestBody.request_id
            : null;
        let supportNote;
        if (providerResponded) {
            supportNote = `request_id=${providerRequestId || 'no informado por el proveedor'} (del proveedor)`;
        } else if (ownRequestId) {
            supportNote = `request_id=${ownRequestId} (generado por nexgen; el proveedor no respondió)`;
        } else {
            supportNote = 'request_id=ninguno (la cancelación no lleva llave y el proveedor no respondió)';
        }

        // Log detallado del error
        const detailedLog = `${errorMsg} - Operation: ${operation} - URL: ${url} - ${supportNote}`;
        this.logger.error(detailedLog);

        // Información de diagnóstico
        console.error('\n--- Información de diagnóstico ---');
        console.error(`Operación: ${operation}`);
        console.error(`URL: ${url}`);
        console.error(`Timestamp: ${new Date().toISOString()}`);
        console.error(`Identificador para soporte: ${supportNote}`);
    }

    /**
     * Realiza una petición para cotizar impuestos (get_tax) bajo el contrato v2:
     * estimación de venta, sin persistencia del lado del proveedor
     * @param {Object} requestBody - Cuerpo ya construido por SynexusRequestBuilder
     * @param {string} entityCode - Código de entidad ya resuelto
     * @returns {Promise<Object>} Respuesta del proveedor
     */
    async getTax(requestBody, entityCode) {
        return this.makeRequest('get_tax', requestBody, entityCode);
    }

    /**
     * Realiza una petición para confirmar impuestos (post_tax) bajo el contrato
     * v2: factura confirmada, mismo endpoint que la cotización
     * @param {Object} requestBody - Cuerpo ya construido por SynexusRequestBuilder
     * @param {string} entityCode - Código de entidad ya resuelto
     * @returns {Promise<Object>} Respuesta del proveedor
     */
    async postTax(requestBody, entityCode) {
        return this.makeRequest('post_tax', requestBody, entityCode);
    }

    /**
     * Realiza una petición para cancelar una transacción confirmada
     * (cancel_tax) bajo el contrato v2: otro endpoint, con la proyección
     * { invoice_id, customer_id } que construye SynexusRequestBuilder
     * @param {Object} requestBody - Proyección ya construida por SynexusRequestBuilder.buildCancelBody
     * @param {string} entityCode - Código de entidad ya resuelto
     * @returns {Promise<Object>} Respuesta del proveedor
     */
    async cancelTax(requestBody, entityCode) {
        return this.makeRequest('cancel_tax', requestBody, entityCode);
    }
}

module.exports = SynexusApiClient;
