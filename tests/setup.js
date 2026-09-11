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

// 1b. Neutralizar dotenv.
//
// Borrar las dos variables de arriba no basta: src/config llama a
// dotenv.config() al cargarse, y dotenv rellena desde .env toda clave que
// esté AUSENTE en process.env (sólo respeta las que ya existen). Un .env real
// con TAX_API_VERSION=v2 o SYNEXUS_ENTITY=... las repondría en cuanto una
// prueba hiciera require('../src/config'), y la suite se comportaría distinto
// en el servidor —que sí tiene .env— que en una máquina sin él.
//
// Se sustituye config() por un no-op ANTES de que src/config requiera dotenv.
// require cachea el módulo, así que el stub persiste para todo el archivo de
// prueba. La única prueba que aísla el registro de módulos
// (v1Freeze.messages) instala su propio doble y no depende de éste.
// setup.test.js verifica que esta neutralización siga en pie.
const dotenv = require('dotenv');
dotenv.config = () => ({ parsed: {} });

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
