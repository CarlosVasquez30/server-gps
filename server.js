const Parser = require('teltonika-parser-ex');
const binutils = require('binutils64');
const net = require('net')


let server = net.createServer((c) => {
    console.log("client connected");
    c.on('end', () => {
        console.log("client disconnected");
    });

    c.on('data', (data) => {

        let buffer = data;
        let parser = new Parser(buffer);
        console.log({parser})
        if(parser.isImei){
            c.write(Buffer.alloc(1, 1));
        }else {
            let avl = parser.getAvl();

            let writer = new binutils.BinaryWriter();
            writer.WriteInt32(avl.number_of_data);

            let response = writer.ByteBuffer;
            c.write(response);
            console.log({response})
        }
    });
});

server.listen(80, () => {
    console.log("Server started");
});