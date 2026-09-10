// jest.config.js
// Configuración mínima: entorno Node y el archivo de aislamiento que corre
// antes de que Jest evalúe cualquier archivo de prueba (variables ficticias
// y bloqueo de red). Ver tests/setup.js.
module.exports = {
    testEnvironment: 'node',
    setupFiles: ['<rootDir>/tests/setup.js']
};
