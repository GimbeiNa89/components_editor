const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
app.use(express.static(__dirname + "/"));

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

app.get("/", (req, res) => {
  res.sendFile(__dirname + "/index.html");
  console.log("dirname:", __dirname);
});

io.on("connection", (socket) => {
  console.log("socket:", socket);
  console.log(`[CONNESSIONE] Utente connesso con ID: ${socket.id}`);
  socket.on("join_document", (docId) => {
    socket.rooms.forEach((room) => {
      if (room !== socket.id) {
        socket.leave(room);
      }
    });
    socket.join(docId);
    console.log(`Utente ${socket.id} entrato nel documento: ${docId}`);
  });

  socket.on("push_update", (data) => {
    const docId = data.docId;
    socket.to(docId).emit("update", data);
  });

  socket.on("disconnect", () => {
    console.log(`[DISCONNESSIONE] Utente disconnesso: ${socket.id}`);
  });
});

const PORT = 3000;
server.listen(PORT, () => {
  console.log(`✅ Socket.IO Server in ascolto sulla porta ${PORT}`);
});
