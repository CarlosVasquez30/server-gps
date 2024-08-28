; (async () => {
    const fs = require("fs");
    const net = require("net");
    const axios = require('axios');
    const { ProtocolParser, parseIMEI, Data, GPRS, BufferReader } = require('complete-teltonika-parser')
    const https = require("https");
    

    
    // Create a Teltonika TCP server that listens on port 5500
    const server = net.createServer((socket) => {
      console.log("New Teltonika device connected");
  
      // When a new connection is established, listen for data events
      var imei;
      socket.on("data", (response) => {
          const buf = Buffer.from(response);
          console.log({response: response.toString(), buf})
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
          socket.write(confirmationPacket);
  
          console.log("imei------", imei);
          console.log(`Sent confirmation packet ${acceptData ? "01" : "00"}`);
        }
        else {
          let parsed;
          try {
            parsed = new ProtocolParser(packet);
          } catch (error) {
            console.error(error)
          }
          if (!parsed) {
            const transformed = transformPacket(packet)
            if (transformed) {
              if (transformed.codecID === "0c") {
                console.log("es Codec 12")
                console.log({transformed})
                console.log({ packet, imei })
                const packetString = Buffer.from(transformed.command, 'hex').toString('utf-8');

                console.log({ extractDesiredPart: extractDesiredPart(packetString) })
                
                sendHourmeterData({
                  imei, dataFrame: extractDesiredPart(packetString)
                });
              }
            }
            
            return;
          }
          const dataLength = parsed.Content.AVL_Datas.length;
          console.log("CodecType:", parsed.CodecType);
  
          console.log({content: parsed.Content})
          if (parsed.CodecType == "data sending") {
              let avlDatas = parsed.Content
              avlDatas.AVL_Datas.map((ad) => console.log({ad}))
            try {
              const avlData = avlDatas.AVL_Datas[1];
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
    
              const deviceInfo = { longitude, latitude, speed, 
                timestamp, movement, battery, fuel, signalStatus, iccid, ignition
              };
              
              if (deviceInfo.fuel) {
                const fuel = deviceInfo.fuel;
                sendFuelData({fuel, imei})
              }
    
    
              let address = '';
              https.get(`https://maps.googleapis.com/maps/api/geocode/json?latlng=${latitude},${longitude}&key=AIzaSyD9vdLrtEtIZ-U2i8tRqMVyrI0J_KbfeDk`, (response) => {
                let data = '';
    
                response.on('data', (chunk) => {
                  data += chunk;
                });
    
                response.on('end', () => {
                  let res = JSON.parse(data);
                  address = res.results[0]? res.results[0].formatted_address : '';
    
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
                      ignition : ignition,
                      ip: srcIp
                  };
                  console.log({record})
                });
              }).on('error', (error) => {
                console.error(error);
              });
            } catch (error) {
              console.log(error)
            }

            const avlData = avlDatas.AVL_Datas;
            
            /*if (imei === "863719064985097") {
              const command = "CMD1, 1800 <CR><LF>"
              const codec12Command = buildCodec12Command(command);
              socket.write(codec12Command)
              console.log({codec12Command})
            }*/
            
            const latitude = avlData[0]?.GPSelement.Latitude;
            const longitude = avlData[0]?.GPSelement.Longitude;
            console.log({ latitude, longitude })
            const dataReceivedPacket = Buffer.alloc(4);
            dataReceivedPacket.writeUInt32BE(dataLength);
            console.log({dataReceivedPacket})
            
            socket.write(dataReceivedPacket);
            console.log("dataLength --------", dataLength);
            if (latitude && longitude) {
              sendGPSData({ imei, lat: parseFloat(latitude), lng: parseFloat(longitude) });
            }
            
          } else {
            let gprs = parsed.Content
            console.log("gprs-----",gprs);
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

function sendGPSData(model) {
  
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

