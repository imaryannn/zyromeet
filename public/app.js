const socket = io();
let localStream;
let peerConnection;
let isConnected = false;
let nsfwModel;
let moderationInterval;
let violationCount = 0;
const MAX_VIOLATIONS = 2;
const NSFW_THRESHOLD = 0.6; // 60% confidence
const SCAN_INTERVAL = 15000; // 15 seconds

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
  startModeration();
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
      console.log('Received ICE candidate:', data.candidate);
      // Only add valid ICE candidates (skip null/empty ones)
      if (data.candidate.candidate && 
          (data.candidate.sdpMid !== null || data.candidate.sdpMLineIndex !== null)) {
        await peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate));
        console.log('ICE candidate added');
      } else {
        console.log('Skipped invalid ICE candidate');
      }
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
  stopModeration();
  cleanup();
});

socket.on('skipped', () => {
  updateStatus('Looking for someone...');
  stopModeration();
  cleanup();
  socket.emit('find-peer');
});

socket.on('moderation-warning', () => {
  addMessage('⚠️ Warning: Inappropriate content detected from stranger', 'system');
});

socket.on('moderation-disconnect', () => {
  addMessage('🚫 Connection terminated: Inappropriate content detected', 'system');
  stopModeration();
  cleanup();
});

socket.on('online-count', (count) => {
  updateOnlineCount(count);
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
    
    // Load NSFW model in background (non-blocking)
    if (!nsfwModel) {
      loadNSFWModel();
    }
    
    socket.emit('find-peer');
  } catch (err) {
    updateStatus('Error: Cannot access camera/microphone');
    console.error('Media error:', err);
  }
}

async function loadNSFWModel() {
  try {
    console.log('Loading NSFW model...');
    // Try loading from alternative CDN with explicit model path
    nsfwModel = await nsfwjs.load('https://nsfwjs.com/model/', {
      type: 'graph'
    });
    console.log('NSFW model loaded successfully');
  } catch (err) {
    console.error('Failed to load NSFW model:', err);
    console.log('Continuing without content moderation');
    // Continue without moderation rather than blocking the app
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
    } else {
      console.log('ICE gathering complete');
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
  stopModeration();
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
  violationCount = 0;
}

function cleanup() {
  stopModeration();
  if (peerConnection) {
    peerConnection.close();
    peerConnection = null;
  }
  remoteVideo.srcObject = null;
  isConnected = false;
  messageInput.disabled = true;
  sendBtn.disabled = true;
  violationCount = 0;
}

function updateStatus(message) {
  status.textContent = message;
}

function updateOnlineCount(count) {
  const onlineCounter = document.getElementById('onlineCounter');
  if (onlineCounter) {
    onlineCounter.textContent = count;
  }
}

function startModeration() {
  if (!nsfwModel) return;
  
  violationCount = 0;
  console.log('Starting content moderation...');
  
  moderationInterval = setInterval(async () => {
    await checkContent();
  }, SCAN_INTERVAL);
}

function stopModeration() {
  if (moderationInterval) {
    clearInterval(moderationInterval);
    moderationInterval = null;
    console.log('Stopped content moderation');
  }
}

async function checkContent() {
  if (!nsfwModel || !isConnected) return;
  
  try {
    // Check remote video (stranger's video)
    if (remoteVideo.readyState === remoteVideo.HAVE_ENOUGH_DATA) {
      const predictions = await nsfwModel.classify(remoteVideo);
      console.log('NSFW predictions:', predictions);
      
      // Check for inappropriate content
      const pornScore = predictions.find(p => p.className === 'Porn')?.probability || 0;
      const hentaiScore = predictions.find(p => p.className === 'Hentai')?.probability || 0;
      const sexyScore = predictions.find(p => p.className === 'Sexy')?.probability || 0;
      
      const maxScore = Math.max(pornScore, hentaiScore, sexyScore);
      
      if (maxScore > NSFW_THRESHOLD) {
        violationCount++;
        console.log(`Violation detected! Count: ${violationCount}, Score: ${maxScore.toFixed(2)}`);
        
        if (violationCount >= MAX_VIOLATIONS) {
          addMessage('🚫 Inappropriate content detected. Disconnecting...', 'system');
          socket.emit('report-violation');
          setTimeout(() => {
            skip();
          }, 1000);
        } else {
          addMessage('⚠️ Warning: Please keep content appropriate', 'system');
          socket.emit('send-warning');
        }
      }
    }
  } catch (err) {
    console.error('Moderation error:', err);
  }
}

updateStatus('Click Start to begin');
