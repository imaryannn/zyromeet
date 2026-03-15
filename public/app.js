const socket = io();
let localStream;
let peerConnection;
let isConnected = false;

const config = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' }
  ],
  iceCandidatePoolSize: 10
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
  console.log('Peer found, initiator:', initiator);
  updateStatus('Stranger found! Connecting...');
  await createPeerConnection(initiator);
});

socket.on('signal', async (data) => {
  try {
    if (!peerConnection) {
      console.error('No peer connection');
      return;
    }

    if (data.type === 'offer') {
      console.log('Received offer');
      await peerConnection.setRemoteDescription(new RTCSessionDescription(data));
      const answer = await peerConnection.createAnswer();
      await peerConnection.setLocalDescription(answer);
      socket.emit('signal', answer);
      console.log('Sent answer');
    } else if (data.type === 'answer') {
      console.log('Received answer');
      await peerConnection.setRemoteDescription(new RTCSessionDescription(data));
    } else if (data.candidate) {
      console.log('Received ICE candidate');
      await peerConnection.addIceCandidate(new RTCIceCandidate(data));
    }
  } catch (err) {
    console.error('Signal error:', err);
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
      video: { width: { ideal: 1280 }, height: { ideal: 720 } }, 
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true
      }
    });
    localVideo.srcObject = localStream;
    console.log('Local stream started');
    
    startBtn.disabled = true;
    skipBtn.disabled = false;
    stopBtn.disabled = false;
    
    updateStatus('Looking for someone...');
    socket.emit('find-peer');
  } catch (err) {
    updateStatus('Error: Cannot access camera/microphone');
    console.error('Media error:', err);
  }
}

async function createPeerConnection(initiator) {
  peerConnection = new RTCPeerConnection(config);
  console.log('Peer connection created');
  
  localStream.getTracks().forEach(track => {
    peerConnection.addTrack(track, localStream);
    console.log('Added track:', track.kind);
  });
  
  peerConnection.ontrack = (event) => {
    console.log('Received remote track:', event.track.kind);
    if (remoteVideo.srcObject !== event.streams[0]) {
      remoteVideo.srcObject = event.streams[0];
      console.log('Remote stream set');
    }
    updateStatus('Connected! Say hi 👋');
    isConnected = true;
    messageInput.disabled = false;
    sendBtn.disabled = false;
  };
  
  peerConnection.onicecandidate = (event) => {
    if (event.candidate) {
      console.log('Sending ICE candidate');
      socket.emit('signal', { candidate: event.candidate });
    }
  };
  
  peerConnection.oniceconnectionstatechange = () => {
    console.log('ICE connection state:', peerConnection.iceConnectionState);
    if (peerConnection.iceConnectionState === 'disconnected' || 
        peerConnection.iceConnectionState === 'failed') {
      updateStatus('Connection lost');
      cleanup();
    }
  };
  
  peerConnection.onconnectionstatechange = () => {
    console.log('Connection state:', peerConnection.connectionState);
    if (peerConnection.connectionState === 'disconnected' || 
        peerConnection.connectionState === 'failed') {
      updateStatus('Connection lost');
      cleanup();
    }
  };
  
  if (initiator) {
    console.log('Creating offer');
    const offer = await peerConnection.createOffer({
      offerToReceiveAudio: true,
      offerToReceiveVideo: true
    });
    await peerConnection.setLocalDescription(offer);
    socket.emit('signal', offer);
    console.log('Offer sent');
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
