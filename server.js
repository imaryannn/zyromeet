const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

app.get('/', (req, res) => {
  res.sendFile(__dirname + '/public/landing.html');
});

app.get('/app', (req, res) => {
  res.sendFile(__dirname + '/public/index.html');
});

app.get('/community-guidelines', (req, res) => {
  res.sendFile(__dirname + '/public/community-guidelines.html');
});

app.use(express.static('public'));

const waitingUsers = {
  text: [],
  video: []
};
const rooms = new Map();
let onlineUsers = 0;

function broadcastOnlineCount() {
  io.emit('online-count', onlineUsers);
  io.emit('userCount', onlineUsers);
  console.log('Online users:', onlineUsers);
}

io.on('connection', (socket) => {
  onlineUsers++;
  console.log('User connected:', socket.id);
  broadcastOnlineCount();

  socket.on('find-peer', (data = {}) => {
    const mode = data.mode === 'text' ? 'text' : 'video';
    const queue = waitingUsers[mode];

    if (queue.length > 0) {
      const peer = queue.shift();
      const roomId = `${socket.id}-${peer}`;
      
      socket.join(roomId);
      io.sockets.sockets.get(peer)?.join(roomId);
      
      rooms.set(socket.id, { roomId, peer, mode });
      rooms.set(peer, { roomId, peer: socket.id, mode });
      
      console.log(`Matched ${socket.id} with ${peer} in ${mode} mode`);
      
      io.to(peer).emit('peer-found', { roomId, initiator: false, mode });
      socket.emit('peer-found', { roomId, initiator: true, mode });
    } else {
      queue.push(socket.id);
      socket.emit('waiting');
      console.log(`${socket.id} is waiting in ${mode} mode`);
    }
  });

  socket.on('signal', (data) => {
    const room = rooms.get(socket.id);
    if (room) {
      console.log(`Signal from ${socket.id} to ${room.peer}:`, data.type || 'candidate');
      io.to(room.peer).emit('signal', data);
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

  socket.on('send-warning', () => {
    const room = rooms.get(socket.id);
    if (room) {
      io.to(room.peer).emit('moderation-warning');
      console.log(`Warning sent from ${socket.id} to ${room.peer}`);
    }
  });

  socket.on('report-violation', () => {
    const room = rooms.get(socket.id);
    if (room) {
      io.to(room.peer).emit('moderation-disconnect');
      console.log(`Violation reported: ${socket.id} reported ${room.peer}`);
      // Here you can add database logging for violations
    }
  });

  socket.on('disconnect', () => {
    onlineUsers--;
    handleDisconnect(socket);
    broadcastOnlineCount();
    console.log('User disconnected:', socket.id);
  });

  function handleDisconnect(socket) {
    const room = rooms.get(socket.id);
    if (room) {
      io.to(room.peer).emit('peer-disconnected');
      rooms.delete(room.peer);
      rooms.delete(socket.id);
      console.log(`Disconnected ${socket.id} from ${room.peer}`);
    }
    waitingUsers.text = waitingUsers.text.filter(id => id !== socket.id);
    waitingUsers.video = waitingUsers.video.filter(id => id !== socket.id);
  }
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
