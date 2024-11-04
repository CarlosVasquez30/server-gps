function calculateCRC16(buffer) {
    let crc = 0x0000;
    for (let byte of buffer) {
        crc ^= byte;
        for (let i = 0; i < 8; i++) {
            let carry = crc & 1;
            crc >>= 1;
            if (carry) {
                crc ^= 0xA001;
            }
        }
    }
    return crc & 0xFFFF;
}

function createCodec12Command(command) {
    // Preamble (4 bytes de ceros)
    const preamble = Buffer.alloc(4, 0x00);

    // Codec ID (1 byte)
    const codecId = Buffer.from([0x0C]);

    // Command Quantity 1 (1 byte)
    const commandQuantity1 = Buffer.from([0x01]);

    // Command Type (1 byte): 0x05 para comando, 0x06 para respuesta
    const commandType = Buffer.from([0x05]);

    // Command Size (4 bytes)
    const commandData = Buffer.from(command, 'ascii'); // Comando en ASCII, conviértelo a hex si es necesario
    const commandSize = Buffer.alloc(4);
    commandSize.writeUInt32BE(commandData.length, 0);

    // Command Quantity 2 (1 byte)
    const commandQuantity2 = Buffer.from([0x01]);

    // Concatenar los campos desde Codec ID hasta Command Quantity 2 para calcular Data Size
    const dataWithoutDataSize = Buffer.concat([
        codecId,
        commandQuantity1,
        commandType,
        commandSize,
        commandData,
        commandQuantity2
    ]);

    // Data Size (4 bytes)
    const dataSize = Buffer.alloc(4);
    dataSize.writeUInt32BE(dataWithoutDataSize.length, 0);

    // Concatenar todas las partes desde Preamble hasta Command Quantity 2
    const message = Buffer.concat([
        preamble,
        dataSize,
        dataWithoutDataSize
    ]);

    // Calcular CRC-16 desde Codec ID hasta Command Quantity 2
    const crc = calculateCRC16(dataWithoutDataSize);
    const crcBuffer = Buffer.alloc(4); // Crear buffer de 4 bytes para el CRC
    crcBuffer.writeUInt16BE(crc, 2); // Escribir el CRC en los últimos 2 bytes (los primeros 2 bytes quedan en 0 para hacer 4 bytes en total)

    // Construir el mensaje final con CRC
    const fullMessage = Buffer.concat([message, crcBuffer]);

    return fullMessage;
}

// Ejemplo de uso
const command = 'getinfo';
const bufferCommand = createCodec12Command(command);
console.log(bufferCommand.toString('hex'));
