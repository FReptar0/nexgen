// tests/setup.test.js
// Prueba de humo del aislamiento que monta tests/setup.js (TEST-06).
// Si esta prueba falla, ninguna otra prueba de la suite es confiable.
const http = require('http');
const https = require('https');

const networkBlockMessage = 'La suite de pruebas no puede salir a la red.';

describe('aislamiento de la suite (tests/setup.js)', () => {
    describe('bloqueo de red', () => {
        it('https.request lanza con el mensaje del bloqueo', () => {
            expect(() => https.request('https://ejemplo-v1.invalid/')).toThrow(networkBlockMessage);
        });

        it('https.get lanza con el mensaje del bloqueo', () => {
            expect(() => https.get('https://ejemplo-v1.invalid/')).toThrow(networkBlockMessage);
        });

        it('http.request lanza con el mensaje del bloqueo', () => {
            expect(() => http.request('http://ejemplo-v1.invalid/')).toThrow(networkBlockMessage);
        });

        it('http.get lanza con el mensaje del bloqueo', () => {
            expect(() => http.get('http://ejemplo-v1.invalid/')).toThrow(networkBlockMessage);
        });
    });

    describe('variables de entorno ficticias', () => {
        it('BASE_URL apunta al host reservado .invalid', () => {
            expect(process.env.BASE_URL).toBe('https://ejemplo-v1.invalid/api/');
        });

        it('API_CODE es el código ficticio', () => {
            expect(process.env.API_CODE).toBe('codigo-de-prueba-v1');
        });

        it('OUTPUT_DIR está definido', () => {
            expect(process.env.OUTPUT_DIR).toBeTruthy();
        });

        it('TEST_MODE arranca en false', () => {
            expect(process.env.TEST_MODE).toBe('false');
        });

        it('SYNEXUS_API_KEY es una llave ficticia con el prefijo de prueba', () => {
            expect(process.env.SYNEXUS_API_KEY).toBe('synexus_test_' + '0'.repeat(64));
        });

        // Estas dos aserciones NO son decorativas. Los planes 02 y 03 prueban la
        // precedencia del código de entidad y el valor por omisión del selector
        // de contrato, y ambas cosas dependen de que estas variables estén
        // ausentes al arrancar. No "arregles" la suite fijándolas en setup.js.
        it('SYNEXUS_ENTITY está ausente', () => {
            expect(process.env.SYNEXUS_ENTITY).toBeUndefined();
        });

        it('TAX_API_VERSION está ausente', () => {
            expect(process.env.TAX_API_VERSION).toBeUndefined();
        });
    });
});
