; (async () => {
    const fs = require("fs");
    const net = require("net");
    const axios = require('axios');
    const { ProtocolParser, parseIMEI, Data, GPRS, BufferReader } = require('complete-teltonika-parser')
    const https = require("https");
    const deviceMap = new Map();
    // Para generar el CRC16 (puedes usar una librería como 'crc')

  
    
    // Create a Teltonika TCP server that listens on port 5500
  const server = net.createServer((socket) => {
    console.log("New Teltonika device connected");
  
    // When a new connection is established, listen for data events
    var imei;
    socket.on("data", (response) => {
      const buf = Buffer.from(response);
      console.log({ response: response.toString(), buf })
      // Extract the source and destination IP addresses from the buffer
      const srcIp = `${buf[12]}.${buf[13]}.${buf[14]}.${buf[15]}`;
      console.log("device ip:", srcIp);
  
      const packet = response.toString("hex");
          
      console.log({ packet, length: packet.length })
        
  
      if (packet.length === 34) {
        imei = parseIMEI(packet)
        const acceptData = true;
        const confirmationPacket = Buffer.alloc(1);
        confirmationPacket.writeUInt8(acceptData ? 0x01 : 0x00);
        socket.write(confirmationPacket, (err) => {
          if (err) {
            console.error('Error al enviar el paquete de confirmación:', err);
          } else {
            console.log(`Paquete de confirmación enviado: ${confirmationPacket}`);
            
          }
        });
          
        console.log("imei------", imei);
         

      }
      else {
        if (response.toString().includes("CTCR")) {
          const [command, imei, activar] = response.toString().split('|');
          console.log({ command, imei, activar })
          if (command === 'CTCR' && imei && activar) {
            deviceMap.set(imei, { CTCR: activar === 'true' });
            console.log(`Device IMEI ${imei} stored with activar=${activar}`);
          }
        } else {
          let parsed;
          try {
            parsed = new ProtocolParser(packet);
          } catch (error) {
            console.error({ error })
          }
          console.log({ par: parsed })
          if (parsed) {
            const dataLength = parsed.Content.AVL_Datas.length;
            console.log("CodecType:", parsed.CodecType);
  
            console.log({ content: parsed.Content })
            if (parsed.CodecType == "data sending") {
              let avlDatas = parsed.Content
              avlDatas.AVL_Datas.map((ad) => console.log({ ad }))
              try {
                const index = avlDatas.AVL_Datas.length === 1 ? 0 : avlDatas.AVL_Datas.length - 1;
                const avlData = avlDatas.AVL_Datas[index];
                const gpsElement = avlData?.GPSelement;
                const timestamp = avlData?.Timestamp;
    
                const longitude = gpsElement?.Longitude;
                const latitude = gpsElement?.Latitude;
                const speed = gpsElement?.Speed;
    
    
                const ioElement = avlData?.IOelement;
    
                //movement detection
                let movement = 0;
                if (ioElement && ioElement.Elements && ioElement.Elements['240']) {
                  movement = ioElement.Elements['240'];
                }
    
                let signalStatus = 0;
                if (ioElement && ioElement.Elements && ioElement.Elements['21']) {
                  signalStatus = ioElement.Elements['21'];
                }
    
                let battery = 0;
                if (ioElement && ioElement.Elements && ioElement.Elements['66']) {
                  battery = ioElement.Elements['66'] * 100 / 13090;
                }
    
                let fuel = 0;
                if (ioElement && ioElement.Elements && ioElement.Elements['9']) {
                  fuel = ioElement.Elements['9'] * 0.001;
                }
    
                let iccid = '';
                if (ioElement && ioElement.Elements && ioElement.Elements['11'] && ioElement.Elements['14']) {
                  let iccid1 = ioElement.Elements['11'];
                  let iccid2 = ioElement.Elements['14'];
                  iccid = iccid1.toString() + iccid2.toString();
                }
    
                let ignition = 0;
                if (ioElement && ioElement.Elements && ioElement.Elements['239']) {
                  ignition = ioElement.Elements['239'];
                }

                let secs = 0;
                if (ioElement && ioElement.Elements && ioElement.Elements['449']) {
                  secs = ioElement.Elements['449'];
                }

                let powerTakeOff = 0;
                if (ioElement && ioElement.Elements && ioElement.Elements['449']) {
                  powerTakeOff = ioElement.Elements['1'];
                }
    
                const deviceInfo = {
                  longitude, latitude, speed,
                  timestamp, movement, battery, fuel, signalStatus, iccid, ignition
                };
              
                if (fuel) {
                  sendFuelData({ fuel, imei })
                }

                if (powerTakeOff) {
                  const model = { status: powerTakeOff === 1, imei };
                  sendPowerTakeOffData(model)
                }

                if (secs) {
                  sendHourUpdateData({ secs, imei })
                }
                console.log({ ioElements: ioElement.Elements })

                sendGPSData(
                  {
                    imei, lat: isNaN(latitude) ? undefined : latitude,
                    lng: isNaN(longitude) ? undefined : longitude,
                    transferDate: new Date(timestamp),
                    ignition
                  });
              
    
    
                let address = '';
                https.get(`https://maps.googleapis.com/maps/api/geocode/json?latlng=${latitude},${longitude}&key=AIzaSyD9vdLrtEtIZ-U2i8tRqMVyrI0J_KbfeDk`, (response) => {
                  let data = '';
    
                  response.on('data', (chunk) => {
                    data += chunk;
                  });
    
                  response.on('end', () => {
                    let res = JSON.parse(data);
                    address = res.results[0] ? res.results[0].formatted_address : '';
    
                    console.log('device info --------', deviceInfo);
                    let record = {
                      deviceImei: imei,
                      lat: latitude,
                      lng: longitude,
                      transferDate: timestamp,
                      movement: movement,
                      speed: speed,
                      fuel: fuel,
                      battery: battery,
                      signal: signalStatus,
                      address: address,
                      iccid: iccid,
                      ignition: ignition,
                      ip: srcIp
                    };
                    console.log({ record })
                  });
                }).on('error', (error) => {
                  console.error(error);
                });
              } catch (error) {
                console.log(error)
              }

            
              const dataReceivedPacket = Buffer.alloc(4);
              dataReceivedPacket.writeUInt32BE(dataLength);
              console.log({ dataReceivedPacket })
            
              socket.write(dataReceivedPacket, (err) => {
                if (err) {
                  console.error({err})
                } else {
                  const deviceTasks = deviceMap.get(imei);
                  console.log({ deviceTasks })
                  if (deviceTasks) {
                    const commandPacket = createCodec12Command(0x05, 'getio');//Buffer.from("000000000000000f0C010500000007676574696e666f0100004312", "hex");
                    console.log({command: commandPacket})
                    socket.write(commandPacket, (err) => {
                      if (err) {
                        console.error('Error al enviar el comando:', err);
                      } else {
                        console.log(`Sent command packet: ${commandPacket}`);
                        
                        deviceMap.delete(imei);
                        console.log(`IMEI ${imei} eliminado de deviceMap`);
                        
                      }
                    });         

                  }
                }
              });
              
              console.log("dataLength --------", dataLength);
            
            }
          

                 
          }
        }
      }
    });

  });

    server.listen(80, () => {
      console.log("Teltonika server listening on port 80");
    });
})()



  
function transformPacket(packet) {
  // Extraer partes del paquete
  const preamble = packet.substring(0, 8);
  const dataSize = packet.substring(8, 16);
  const codecID = packet.substring(16, 18);
  const commandQuantity1 = packet.substring(18, 20); // Ignorado
  const type = packet.substring(20, 22); // Tipo de comando
  const commandSize = packet.substring(22, 30); // Tamaño del comando
  const command = packet.substring(30); // Subcadena del paquete que representa el comando en HEX
  const commandQuantity2 = packet.substring(30, 32); // Mismo valor que commandQuantity1
  const crc16 = packet.substring(packet.length - 8); // Valor CRC-16

  // Construir el paquete transformado
  const transformedPacket = {
    preamble, dataSize, codecID, commandQuantity1, type, commandSize, command, commandQuantity2, crc16
  }
  

  return transformedPacket;
}

const https = require("https");

function sendPowerTakeOffData(model) {
  
  // Datos para la petición HTTP
  const postData = JSON.stringify(model);
  const options = {
    hostname: 'controller.agrochofa.cl',
    port: 443,
    path: '/api/sga/logsTomaFuerza/crear',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    }
  };

  const req = https.request(options, (res) => {
    console.log(`Estado de la petición: ${res.statusCode}`);

    res.on('data', (chunk) => {
        console.log(`Datos recibidos del otro servidor: ${chunk}`);
    });
  });

  req.on('error', (error) => {
      console.error('Error al enviar la petición al otro servidor:', error);
  });

  // Envía los datos al otro servidor
  req.write(postData);
  req.end();

}

function sendFuelData(model) {
  
  // Datos para la petición HTTP
  const postData = JSON.stringify(model);
  const options = {
    hostname: 'controller.agrochofa.cl',
    port: 443,
    path: '/api/sga/logsCombustible/crear',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    }
  };

  const req = https.request(options, (res) => {
    console.log(`Estado de la petición: ${res.statusCode}`);

    res.on('data', (chunk) => {
        console.log(`Datos recibidos del otro servidor: ${chunk}`);
    });
  });

  req.on('error', (error) => {
      console.error('Error al enviar la petición al otro servidor:', error);
  });

  // Envía los datos al otro servidor
  req.write(postData);
  req.end();

}

function sendHourUpdateData(model) {
  
  // Datos para la petición HTTP
  const postData = JSON.stringify(model);
  const options = {
    hostname: 'controller.agrochofa.cl',
    port: 443,
    path: '/api/sga/logsHoras/crear',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    }
  };

  const req = https.request(options, (res) => {
    console.log(`Estado de la petición: ${res.statusCode}`);

    res.on('data', (chunk) => {
        console.log(`Datos recibidos del otro servidor: ${chunk}`);
    });
  });

  req.on('error', (error) => {
      console.error('Error al enviar la petición al otro servidor:', error);
  });

  // Envía los datos al otro servidor
  req.write(postData);
  req.end();

}

function sendGPSData(model) {
  console.log({modelGPS: model})
  // Datos para la petición HTTP
  const postData = JSON.stringify(model);
  const options = {
    hostname: 'controller.agrochofa.cl',
    port: 443,
    path: '/api/sga/logsGPS/crear',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    }
  };

  const req = https.request(options, (res) => {
    console.log(`Estado de la petición: ${res.statusCode}`);

    res.on('data', (chunk) => {
        console.log(`Datos recibidos del otro servidor: ${chunk}`);
    });
  });

  req.on('error', (error) => {
      console.error('Error al enviar la petición al otro servidor:', error);
  });

  // Envía los datos al otro servidor
  req.write(postData);
  req.end();

}

function buildCodec12Command(command, isText) {
  if (isText) {
    let codecId = Buffer.from([0x0C]); // Codec 12
    const commandSize = Buffer.alloc(4); // 4 bytes for the command size
    commandSize.writeUInt32BE(command.length);
    const commandBuffer = Buffer.from(command, 'utf8');

    // Construct the packet
    return Buffer.concat([
      codecId,
      Buffer.from([0x01]), // number of commands, here it's just 1
      commandSize,
      commandBuffer,
      Buffer.from([0x00]) // single command response, not using CRC here
    ]); 
  }
  

  codecId = "0C"; // Codec 12 en hexadecimal
  const numberOfCommands = "01"; // Solo un comando, en hexadecimal
  const commandLength = command.length.toString(16).padStart(8, '0'); // Longitud del comando en hexadecimal (4 bytes)
  
  // Comando completo en formato texto codec 12
  const packet = codecId + numberOfCommands + commandLength + Buffer.from(command, 'utf8').toString('hex');
  
  return packet;

}

function sendHourmeterData(model) {
  if (!model.dataFrame) return;
  // Datos para la petición HTTP
  const postData = JSON.stringify(model);
  const options = {
    hostname: 'controller.agrochofa.cl',
    port: 443,
    path: '/api/sga/logsHorometro/crear',
    method: 'POST',
    headers: {
        'Content-Type': 'application/json',
    } 
  };

  // Crea la petición HTTP
  const req = https.request(options, (res) => {
      console.log(`Estado de la petición: ${res.statusCode}`);

      res.on('data', (chunk) => {
          console.log(`Datos recibidos del otro servidor: ${chunk}`);
      });
  });

  req.on('error', (error) => {
      console.error('Error al enviar la petición al otro servidor:', error);
  });

  // Envía los datos al otro servidor
  req.write(postData);
  req.end();
}

function extractDesiredPart(packetString) {
  // Define la expresión regular para buscar la parte entre '>' y '<'
  const regex = />(.*?)</;

  // Ejecuta la expresión regular en la cadena
  const match = regex.exec(packetString);

  // Si se encontró una coincidencia, devuelve la parte encontrada
  if (match && match.length > 1) {
      return match[1];
  } else {
      return null; // Si no se encontró ninguna coincidencia, devuelve null o maneja el caso de error de otra manera
  }
}

function stringToHex(str) {
  return Buffer.from(str, 'ascii').toString('hex');
}

const crc16 = require('crc');

// Función para construir el paquete
function buildCommandPacket(command) {
  const preambulo = '00000000';               // Preambulo fijo de 4 bytes (00 00 00 00)
  const codecId = '0C';                       // Codec 12
  const commandQuantity = '01';               // Enviando un solo comando
  const commandHex = stringToHex(command);    // Comando en formato ASCII convertido a hexadecimal
  const commandLength = (command.length).toString(16).padStart(4, '0'); // Longitud del comando (en bytes, 2 bytes en hexadecimal)

  // Arma el paquete sin el CRC16
  const dataWithoutCrc = preambulo + codecId + commandQuantity + commandLength + commandHex;

  // Calcula el CRC16 para todo el paquete (sin el preámbulo)
  const crc = crc16.crc16(Buffer.from(dataWithoutCrc, 'hex')).toString(16).padStart(4, '0');

  // Añade el CRC al final del paquete
  const fullPacket = dataWithoutCrc + crc;
  
  // Convierte el paquete a un buffer listo para enviarse
  return Buffer.from(fullPacket, 'hex');
}

function calculateCRC16(buffer) {
  let crc = 0x0000;
  for (let byte of buffer) {
      crc ^= byte << 8;
      for (let i = 0; i < 8; i++) {
          if ((crc & 0x8000) !== 0) {
              crc = (crc << 1) ^ 0x1021;
          } else {
              crc <<= 1;
          }
          crc &= 0xFFFF;
      }
  }
  return crc;
}


function createCodec12Command(commandType, commandData) {
  // Convierte el comando en un buffer
  const dataBuffer = Buffer.from(commandData, 'utf-8'); // Datos de comando en Buffer
  const commandLength = dataBuffer.length; // Longitud de los datos del comando

  // Longitud total del mensaje (sin incluir el CRC-16)
  const totalLength = 8 + 6 + commandLength + 1;
  const prefix = Buffer.alloc(8); // 8 bytes de prefijo
  prefix.writeUInt32BE(totalLength, 4); // Escribimos la longitud total del mensaje en el prefijo

  const codecId = Buffer.from([0x0C]); // Codec ID para codec12
  const commandQuantity = Buffer.from([0x01]); // Cantidad de comandos (1)
  const commandTypeBuffer = Buffer.from([commandType]); // Tipo de comando en hexadecimal

  // Longitud del comando en 4 bytes
  const commandLengthBuffer = Buffer.alloc(4);
  commandLengthBuffer.writeUInt32BE(commandLength);

  const endByte = Buffer.from([0x01]); // Byte de fin de comando

  // Concatenar todos los buffers antes de calcular el CRC-16
  const commandWithoutCRC = Buffer.concat([
      prefix,
      codecId,
      commandQuantity,
      commandTypeBuffer,
      commandLengthBuffer,
      dataBuffer,
      endByte
  ]);

  // Calcular el CRC-16 del comando sin el CRC
  const crc16 = calculateCRC16(commandWithoutCRC);
  const crcBuffer = Buffer.alloc(2);
  crcBuffer.writeUInt16BE(crc16);

  // Concatenar todo, incluyendo el CRC
  return Buffer.concat([commandWithoutCRC, crcBuffer]);
}



