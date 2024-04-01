import net from "net";
 

const server = net.createServer();
 

server.on("connection", (socket) => {


  socket.setEncoding("hex");


  socket.on("data", (data) => {


    socket.write("\x01");


    console.log(data);


  });
 

  socket.on("close", () => {});
 

  socket.on("error", (err) => {


    console.log(err.message);


  });


});
 

server.listen(443, () => {


  console.log("Server listening at " + server.address().port);


});