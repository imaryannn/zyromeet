const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);

app.use(express.static('public'));

let waitingUsers = [];
const rooms = new Map();

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  socket.on('find-peer', () => {
    if (waitingUsers.length > 0) {
      const peer = waitingUsers.shift();
      const roomId = `${socket.id}-${peer}`;
      
      socket.join(roomId);
      io.sockets.sockets.get(peer)?.join(roomId);
      
      rooms.set(socket.id, { roomId, peer });
      rooms.set(peer, { roomId, peer: socket.id });
      
      io.to(peer).emit('peer-found', { roomId, initiator: false });
      socket.emit('peer-found', { roomId, initiator: true });
    } else {
      waitingUsers.push(socket.id);
      socket.emit('waiting');
    }
  });

  socket.on('signal', (data) => {
    const room = rooms.get(socket.id);
    if (room) {
      socket.to(room.peer).emit('signal', data);
    }
  });

  socket.on('chat-message', (message) => {
    const room = rooms.get(socket.id);
    if (room) {
      socket.to(room.peer).emit('chat-message', message);
    }
  });

  socket.on('skip', () => {
    handleDisconnect(socket);
    socket.emit('skipped');
  });

  socket.on('disconnect', () => {
    handleDisconnect(socket);
    console.log('User disconnected:', socket.id);
  });

  function handleDisconnect(socket) {
    const room = rooms.get(socket.id);
    if (room) {
      socket.to(room.peer).emit('peer-disconnected');
      rooms.delete(room.peer);
      rooms.delete(socket.id);
    }
    waitingUsers = waitingUsers.filter(id => id !== socket.id);
  }
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
