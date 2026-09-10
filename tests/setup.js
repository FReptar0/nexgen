// tests/setup.js
// Aislamiento de la suite. Jest lo ejecuta (setupFiles) antes de evaluar
// cualquier archivo de prueba, es decir, antes de cualquier require de src/.
//
// Hace dos cosas, ambas obligatorias para TEST-06:
//   1. Fuerza variables de entorno ficticias.
//   2. Bloquea toda salida HTTP real.
const os = require('os');
const path = require('path');
const http = require('http');
const https = require('https');

// 1. Variables de entorno ficticias.
//
// Se ASIGNAN, no se rellenan: un .env real presente en la máquina del
// desarrollador nunca debe alimentar la suite. dotenv no sobreescribe lo que
// ya está en process.env, así que fijarlas aquí las vuelve deterministas.
//
// BASE_URL usa el TLD .invalid (RFC 2606): está reservado y no resuelve nunca.
process.env.BASE_URL = 'https://ejemplo-v1.invalid/api/';
process.env.API_CODE = 'codigo-de-prueba-v1';
process.env.OUTPUT_DIR = path.join(os.tmpdir(), 'nexgen-tests-output');
process.env.TEST_MODE = 'false';
process.env.SYNEXUS_BASE_URL = 'https://compute.staging.synexustax.com';
process.env.SYNEXUS_API_KEY = 'synexus_test_' + '0'.repeat(64);

// SYNEXUS_ENTITY y TAX_API_VERSION se dejan AUSENTES a propósito. Su ausencia
// es lo que permite probar la precedencia del código de entidad y el valor por
// omisión del selector de contrato (v1). No las fijes aquí; hazlo dentro de
// la prueba que las necesite y restáuralas al terminar.
delete process.env.SYNEXUS_ENTITY;
delete process.env.TAX_API_VERSION;

// 2. Bloqueo de red.
//
// axios enruta todo su tráfico en Node por http/https, así que basta con
// reemplazar request y get de esos dos módulos. No se toca `net` para no
// interferir con la mecánica interna de Jest. No hace falta guardar las
// funciones originales: el proceso de Jest es efímero.
const networkBlockMessage = 'La suite de pruebas no puede salir a la red.';

const blockNetwork = () => {
    throw new Error(networkBlockMessage);
};

http.request = blockNetwork;
http.get = blockNetwork;
https.request = blockNetwork;
https.get = blockNetwork;
