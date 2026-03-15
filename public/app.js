const socket = io();
let localStream;
let peerConnection;
let isConnected = false;

const config = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' }
  ]
};

const localVideo = document.getElementById('localVideo');
const remoteVideo = document.getElementById('remoteVideo');
const startBtn = document.getElementById('startBtn');
const skipBtn = document.getElementById('skipBtn');
const stopBtn = document.getElementById('stopBtn');
const messageInput = document.getElementById('messageInput');
const sendBtn = document.getElementById('sendBtn');
const chatBox = document.getElementById('chatBox');
const status = document.getElementById('status');

startBtn.addEventListener('click', start);
skipBtn.addEventListener('click', skip);
stopBtn.addEventListener('click', stop);
sendBtn.addEventListener('click', sendMessage);
messageInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') sendMessage();
});

socket.on('waiting', () => {
  updateStatus('Looking for someone...');
});

socket.on('peer-found', async ({ roomId, initiator }) => {
  updateStatus('Stranger found! Connecting...');
  await createPeerConnection(initiator);
});

socket.on('signal', async (data) => {
  if (data.type === 'offer') {
    await peerConnection.setRemoteDescription(new RTCSessionDescription(data));
    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);
    socket.emit('signal', answer);
  } else if (data.type === 'answer') {
    await peerConnection.setRemoteDescription(new RTCSessionDescription(data));
  } else if (data.candidate) {
    await peerConnection.addIceCandidate(new RTCIceCandidate(data));
  }
});

socket.on('chat-message', (message) => {
  addMessage(message, 'received');
});

socket.on('peer-disconnected', () => {
  updateStatus('Stranger disconnected');
  addMessage('Stranger has disconnected', 'system');
  cleanup();
});

socket.on('skipped', () => {
  updateStatus('Looking for someone...');
  cleanup();
  socket.emit('find-peer');
});

async function start() {
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ 
      video: true, 
      audio: true 
    });
    localVideo.srcObject = localStream;
    
    startBtn.disabled = true;
    skipBtn.disabled = false;
    stopBtn.disabled = false;
    
    updateStatus('Looking for someone...');
    socket.emit('find-peer');
  } catch (err) {
    updateStatus('Error: Cannot access camera/microphone');
    console.error(err);
  }
}

async function createPeerConnection(initiator) {
  peerConnection = new RTCPeerConnection(config);
  
  localStream.getTracks().forEach(track => {
    peerConnection.addTrack(track, localStream);
  });
  
  peerConnection.ontrack = (event) => {
    remoteVideo.srcObject = event.streams[0];
    updateStatus('Connected! Say hi 👋');
    isConnected = true;
    messageInput.disabled = false;
    sendBtn.disabled = false;
  };
  
  peerConnection.onicecandidate = (event) => {
    if (event.candidate) {
      socket.emit('signal', { candidate: event.candidate });
    }
  };
  
  peerConnection.onconnectionstatechange = () => {
    if (peerConnection.connectionState === 'disconnected') {
      updateStatus('Connection lost');
      cleanup();
    }
  };
  
  if (initiator) {
    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);
    socket.emit('signal', offer);
  }
}

function sendMessage() {
  const message = messageInput.value.trim();
  if (message && isConnected) {
    socket.emit('chat-message', message);
    addMessage(message, 'sent');
    messageInput.value = '';
  }
}

function addMessage(text, type) {
  const messageDiv = document.createElement('div');
  messageDiv.className = `message ${type}`;
  messageDiv.textContent = text;
  chatBox.appendChild(messageDiv);
  chatBox.scrollTop = chatBox.scrollHeight;
}

function skip() {
  socket.emit('skip');
  addMessage('Looking for a new stranger...', 'system');
}

function stop() {
  cleanup();
  if (localStream) {
    localStream.getTracks().forEach(track => track.stop());
    localStream = null;
  }
  localVideo.srcObject = null;
  
  startBtn.disabled = false;
  skipBtn.disabled = true;
  stopBtn.disabled = true;
  messageInput.disabled = true;
  sendBtn.disabled = true;
  
  updateStatus('Click Start to begin');
  chatBox.innerHTML = '';
}

function cleanup() {
  if (peerConnection) {
    peerConnection.close();
    peerConnection = null;
  }
  remoteVideo.srcObject = null;
  isConnected = false;
  messageInput.disabled = true;
  sendBtn.disabled = true;
}

function updateStatus(message) {
  status.textContent = message;
}

updateStatus('Click Start to begin');
