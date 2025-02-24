// index.js
const fs = require('fs');
const path = require('path');
const axios = require('axios');

async function main() {
    const args = process.argv.slice(2);
    if (args.length < 2) {
        console.error('Uso: node index.js <operacion> <ruta_del_archivo>');
        console.error('Operaciones válidas: "get_tax" o "cancel_tax"');
        process.exit(1);
    }

    const operation = args[0];
    const filePath = args[1];

    // Leer y parsear el archivo JSON de entrada
    let requestBody;
    try {
        requestBody = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (err) {
        console.error("Error al leer o parsear el archivo:", err.message);
        process.exit(1);
    }

    // Seleccionar la URL según la operación
    let url;
    if (operation === 'get_tax') {
        url = 'https://syn-magento.azurewebsites.net/api/MGGetTaxForCart?code=G5ifDDrBjOEDUGSTgaqbdkWAJy70z4xGqat6nYgTP873AzFuGRTiHQ==';
    } else if (operation === 'cancel_tax') {
        url = 'https://syn-magento.azurewebsites.net/api/CancelTransaction';
    } else {
        console.error('Operación inválida. Usa "get_tax" o "cancel_tax".');
        process.exit(1);
    }

    try {
        // Nota: aunque GET tradicionalmente no envía body, en este caso se incluye el JSON de prueba
        const response = await axios({
            method: 'GET',
            url: url,
            data: requestBody,
            headers: {
                'Content-Type': 'application/json'
            }
        });

        // Directorio de salida específico
        const outputDir = "C:\\Directorio_de_Trabajo\\NEO\\Taxes\\respuesta";
        
        // Asegurarse de que el directorio de salida exista, si no, crearlo
        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
        }

        // Crear el nombre del archivo de respuesta
        const originalName = path.basename(filePath);
        const responseFileName = path.join(outputDir, 'RESPONSE_' + originalName);

        // Escribir la respuesta en el archivo
        fs.writeFileSync(responseFileName, JSON.stringify(response.data, null, 2));
        console.log('Respuesta escrita en ' + responseFileName);
    } catch (error) {
        console.error('Error en la petición:', error.message);
    }
}

main();
