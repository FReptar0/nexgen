// src/infrastructure/logger.js
const winston = require('winston');
const path = require('path');
const fs = require('fs');

/**
 * Infrastructure Layer - Logger
 * Responsabilidad: Gestionar todos los logs de la aplicación
 * Principio SOLID: Single Responsibility Principle (SRP)
 * Patrón: Dependency Injection (puede ser inyectado en otras clases)
 */
class Logger {
    constructor(logDir) {
        this.logDir = logDir || path.resolve(__dirname, '../../logs');
        this._ensureLogDir();
        this._createLogger();
    }

    /**
     * Asegura que el directorio de logs exista
     * @private
     */
    _ensureLogDir() {
        if (!fs.existsSync(this.logDir)) {
            fs.mkdirSync(this.logDir, { recursive: true });
        }
    }

    /**
     * Crea la instancia de winston logger
     * @private
     */
    _createLogger() {
        this.logger = winston.createLogger({
            level: 'error',
            format: winston.format.combine(
                winston.format.timestamp(),
                winston.format.printf(({ timestamp, level, message }) => {
                    return `[${timestamp}] ${level.toUpperCase()}: ${message}`;
                })
            ),
            transports: [
                new winston.transports.File({
                    filename: path.join(
                        this.logDir,
                        `log_${new Date().toISOString().slice(0, 10)}.log`
                    ),
                    level: 'error',
                })
            ]
        });
    }

    /**
     * Registra un error
     * @param {string} message - Mensaje de error
     */
    error(message) {
        this.logger.error(message);
    }

    /**
     * Registra información
     * @param {string} message - Mensaje informativo
     */
    info(message) {
        this.logger.info(message);
    }

    /**
     * Registra una advertencia
     * @param {string} message - Mensaje de advertencia
     */
    warn(message) {
        this.logger.warn(message);
    }

    /**
     * Registra información de debug
     * @param {string} message - Mensaje de debug
     */
    debug(message) {
        this.logger.debug(message);
    }
}

module.exports = Logger;
