
const net = require('net')
const { decode } = require("teltonika-decoder")


let server = net.createServer((c) => {
    console.log("client connected");
    c.on('end', () => {
        console.log("client disconnected");
    });

    c.on('data', (data) => {

        let buffer = data;
        const decoded = decode(Buffer.from(buffer, 'hex'))
        console.log(decoded)
    });
});

server.listen(80, () => {
    console.log("Server started");
});