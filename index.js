// index.js - Punto de entrada refactorizado con Arquitectura por Capas
/**
 * ARQUITECTURA POR CAPAS IMPLEMENTADA:
 *
 * ┌─────────────────────────────────────┐
 * │   CLI Layer (taxCommandHandler)    │ <- Interfaz de usuario
 * ├─────────────────────────────────────┤
 * │   Validation Layer (taxValidator)  │ <- Reglas de negocio
 * ├─────────────────────────────────────┤
 * │   API Layer (taxApiClient)         │ <- Comunicación HTTP
 * ├─────────────────────────────────────┤
 * │   Storage Layer (fileManager)      │ <- Persistencia de datos
 * ├─────────────────────────────────────┤
 * │   Infrastructure (logger, config)  │ <- Servicios transversales
 * └─────────────────────────────────────┘
 *
 * PRINCIPIOS SOLID APLICADOS:
 * - Single Responsibility: Cada clase tiene una única responsabilidad
 * - Dependency Inversion: Inyección de dependencias en lugar de acoplamiento directo
 * - Open/Closed: Extensible sin modificar código existente
 */

// Importar todas las capas
const config = require('./src/config');
const Logger = require('./src/infrastructure/logger');
const FileManager = require('./src/storage/fileManager');
const TaxValidator = require('./src/validators/taxValidator');
const TaxApiClient = require('./src/api/taxApiClient');
const TaxCommandHandler = require('./src/cli/taxCommandHandler');

/**
 * Función principal - Orquesta la inyección de dependencias
 */
async function main() {
    try {
        // 1. Inicializar infraestructura (capa más baja)
        const logger = new Logger(config.getLogDir());

        // 2. Inicializar capa de almacenamiento
        const fileManager = new FileManager(logger);

        // 3. Inicializar capa de validación
        const validator = new TaxValidator(logger);

        // 4. Inicializar capa de API
        const apiClient = new TaxApiClient(config, logger);

        // 5. Inicializar capa CLI (capa más alta)
        const commandHandler = new TaxCommandHandler(
            config,
            logger,
            fileManager,
            validator,
            apiClient
        );

        // 6. Ejecutar el comando
        const args = process.argv.slice(2);
        await commandHandler.execute(args);

    } catch (error) {
        // Si hay error, salir con código de error
        console.error('\n❌ La operación falló. Revise los logs para más detalles.');
        process.exit(1);
    }
}

// Ejecutar la aplicación
main();
