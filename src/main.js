import { KalturaAvatarSession } from '@unisphere/models-sdk-js';
import { Mp3Encoder } from '@breezystack/lamejs';

// ─── Config ──────────────────────────────────────────────────────────────────

const CONFIG_KEY = 'kaltura_avatar_config';

function getConfig() {
  try {
    return JSON.parse(localStorage.getItem(CONFIG_KEY) || '{}');
  } catch {
    return {};
  }
}

function saveConfig(config) {
  localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
}

// ─── State ────────────────────────────────────────────────────────────────────

let avatarSession = null;
let mediaRecorder = null;
let audioChunks = [];
let recordingTimerId = null;
let recordingSeconds = 0;
let recordedBlob = null;
let isSpeaking = false;

// ─── DOM ──────────────────────────────────────────────────────────────────────

const $ = (id) => document.getElementById(id);

const settingsBtn     = $('settings-btn');
const settingsModal   = $('settings-modal');
const closeModal      = $('close-modal');
const saveSettingsBtn = $('save-settings-btn');
const ksInput         = $('ks-input');
const avatarIdInput   = $('avatar-id-input');
const voiceIdInput    = $('voice-id-input');

const avatarPlaceholder = $('avatar-placeholder');
const connectBtn        = $('connect-btn');
const disconnectBtn     = $('disconnect-btn');
const reconnectBtn      = $('reconnect-btn');
const interruptBtn      = $('interrupt-btn');
const statusDot         = $('status-dot');
const statusText        = $('status-text');

const textInput  = $('text-input');
const sayBtn     = $('say-btn');

const recordBtn     = $('record-btn');
const stopBtn       = $('stop-btn');
const rerecordBtn   = $('rerecord-btn');
const sendAudioBtn  = $('send-audio-btn');
const audioPreview  = $('audio-preview');
const recordTimer   = $('record-timer');
const recordIdle    = $('record-idle');
const recordActive  = $('record-active');
const recordReview  = $('record-review');

// ─── Toast ────────────────────────────────────────────────────────────────────

const toastEl = Object.assign(document.createElement('div'), { id: 'toast' });
document.body.appendChild(toastEl);

let toastTimeout;
function showToast(msg, isError = false) {
  clearTimeout(toastTimeout);
  toastEl.textContent = msg;
  toastEl.className = isError ? 'error' : '';
  requestAnimationFrame(() => {
    toastEl.classList.add('show');
  });
  toastTimeout = setTimeout(() => {
    toastEl.classList.remove('show');
  }, 3000);
}

// ─── Status helpers ───────────────────────────────────────────────────────────

function setStatus(state, text) {
  statusDot.className = `dot ${state}`;
  statusText.textContent = text;
}

function setConnected(yes) {
  // Controls
  sayBtn.disabled = !yes;
  textInput.disabled = !yes;
  recordBtn.disabled = !yes;
  // Nav buttons
  connectBtn.style.display = yes ? 'none' : 'inline-flex';
  disconnectBtn.style.display = yes ? 'inline-flex' : 'none';
  reconnectBtn.style.display = 'none';
  // Placeholder
  if (yes) avatarPlaceholder.style.display = 'none';
}

function markReady() {
  if (statusDot.classList.contains('ready')) return; // already done
  setStatus('ready', 'Connected & Ready');
  setConnected(true);
  connectBtn.disabled = false;
  reconnectBtn.disabled = false;
}

function setSessionEnded() {
  isSpeaking = false;
  interruptBtn.style.display = 'none';
  setConnected(false);
  connectBtn.style.display = 'none';
  reconnectBtn.style.display = 'inline-flex';
  avatarPlaceholder.style.display = 'flex';
  resetRecording();
}

// ─── Settings ─────────────────────────────────────────────────────────────────

function openSettings() {
  const cfg = getConfig();
  ksInput.value        = cfg.ks        || '';
  avatarIdInput.value  = cfg.avatarId  || '';
  voiceIdInput.value   = cfg.voiceId   || '';
  settingsModal.style.display = 'flex';
}

settingsBtn.addEventListener('click', openSettings);
closeModal.addEventListener('click', () => { settingsModal.style.display = 'none'; });
settingsModal.addEventListener('click', (e) => {
  if (e.target === settingsModal) settingsModal.style.display = 'none';
});

saveSettingsBtn.addEventListener('click', () => {
  const ks       = ksInput.value.trim();
  const avatarId = avatarIdInput.value.trim();
  const voiceId  = voiceIdInput.value.trim();

  if (!ks)       { showToast('KS is required.', true); return; }
  if (!avatarId) { showToast('Avatar ID is required.', true); return; }

  saveConfig({ ks, avatarId, voiceId });
  settingsModal.style.display = 'none';
  showToast('Settings saved.');

  // If not connected, update status hint
  if (!avatarSession) {
    setStatus('idle', 'Ready — click Connect Avatar');
  }
});

// ─── Connect / Disconnect ─────────────────────────────────────────────────────

connectBtn.addEventListener('click', () => connectAvatar());
reconnectBtn.addEventListener('click', () => connectAvatar());
disconnectBtn.addEventListener('click', disconnectAvatar);
interruptBtn.addEventListener('click', async () => {
  if (avatarSession) {
    try { await avatarSession.interrupt(); } catch (e) { console.warn('interrupt:', e); }
  }
});

async function connectAvatar() {
  const cfg = getConfig();
  if (!cfg.ks || !cfg.avatarId) {
    openSettings();
    showToast('Please configure your settings first.', true);
    return;
  }

  setStatus('connecting', 'Connecting…');
  connectBtn.disabled = true;
  reconnectBtn.disabled = true;
  avatarPlaceholder.style.display = 'flex';

  try {
    avatarSession = new KalturaAvatarSession(cfg.ks, {
      baseUrl: 'https://api.avatar.us.kaltura.ai/v1/avatar-session',
    });

    avatarSession.on('stateChange', (state) => {
      console.log('[Avatar] state:', state);
      const s = String(state).toUpperCase();
      switch (s) {
        case 'IDLE':
          setStatus('idle', 'Idle');
          break;
        case 'CREATING':
          setStatus('connecting', 'Creating session…');
          break;
        case 'READY':
          markReady();
          break;
        case 'ENDED':
          setStatus('ended', 'Session ended');
          setSessionEnded();
          avatarSession = null;
          break;
        case 'ERROR':
          setStatus('error', 'Error — check console');
          setSessionEnded();
          avatarSession = null;
          break;
      }
    });

    avatarSession.on('connectionChange', (state) => {
      console.log('[Avatar] connection:', state);
      const s = String(state).toUpperCase();
      if (s === 'CONNECTED') {
        // WebRTC stream is live — treat as ready regardless of session state
        markReady();
      } else if (s === 'FAILED' || s === 'CLOSED') {
        setStatus('error', `Connection ${state.toLowerCase()}`);
      }
    });

    avatarSession.on('speakingStart', () => {
      isSpeaking = true;
      interruptBtn.style.display = 'inline-flex';
    });

    avatarSession.on('speakingEnd', () => {
      isSpeaking = false;
      interruptBtn.style.display = 'none';
      setSayBtnReady();
    });

    avatarSession.on('error', (err) => {
      console.error('[Avatar] error:', err);
      showToast(`Avatar error: ${err.message || err}`, true);
    });

    const isEself = cfg.voiceId && cfg.voiceId.startsWith('eself-');

    if (isEself) {
      // eself- voices are Kaltura voice clones. The SDK hardcodes modelId:'eleven_flash_v2_5'
      // for all voices which the API rejects for cloned voices. Create the session manually
      // without modelId, then hand off to initSession for WebRTC setup.
      const BASE = 'https://api.avatar.us.kaltura.ai/v1/avatar-session';
      const res = await fetch(`${BASE}/create`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `ks ${cfg.ks}`,
        },
        body: JSON.stringify({
          clientId: 'kaltura-avatar-sdk',
          visualConfig: { id: cfg.avatarId },
          voiceConfig: { id: cfg.voiceId },
        }),
      });

      if (!res.ok) {
        const body = await res.text();
        throw new Error(`Session create failed (${res.status}): ${body}`);
      }

      const { success, error, sessionId, token } = await res.json();
      if (!success) throw new Error(error || 'Session create failed');

      await avatarSession.initSession(
        { sessionId, token },
        { videoContainerId: 'avatar-container' }
      );
    } else {
      await avatarSession.createSession({
        avatarId: cfg.avatarId,
        ...(cfg.voiceId ? { voiceId: cfg.voiceId } : {}),
        videoContainerId: 'avatar-container',
      });
    }

  } catch (err) {
    console.error('[Avatar] connect failed:', err);
    setStatus('error', `Failed: ${err.message}`);
    showToast(`Connection failed: ${err.message}`, true);
    connectBtn.disabled = false;
    reconnectBtn.disabled = false;
    avatarSession = null;
  }
}

async function disconnectAvatar() {
  if (avatarSession) {
    try { await avatarSession.endSession(); } catch (e) { console.warn('endSession:', e); }
    avatarSession = null;
  }
  setStatus('idle', 'Disconnected');
  setSessionEnded();
  connectBtn.style.display = 'inline-flex';
  reconnectBtn.style.display = 'none';
  avatarPlaceholder.style.display = 'flex';
}

// ─── Text to Speech ───────────────────────────────────────────────────────────

function setSayBtnReady() {
  sayBtn.disabled = false;
  sayBtn.innerHTML = `
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
      <polygon points="5 3 19 12 5 21 5 3"/>
    </svg>
    Say This`;
}

sayBtn.addEventListener('click', async () => {
  const text = textInput.value.trim();
  if (!text || !avatarSession) return;

  sayBtn.disabled = true;
  sayBtn.innerHTML = `<span class="dot connecting" style="display:inline-block"></span> Speaking…`;

  try {
    await avatarSession.sayText(text);
    // speakingEnd event will re-enable the button
    // Fallback in case the event doesn't fire
    setTimeout(setSayBtnReady, 500);
  } catch (err) {
    console.error('[sayText]', err);
    showToast(`Failed to speak: ${err.message}`, true);
    setSayBtnReady();
  }
});

// Allow Ctrl+Enter to submit
textInput.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
    sayBtn.click();
  }
});

// ─── Audio Recording ──────────────────────────────────────────────────────────

recordBtn.addEventListener('click', startRecording);
stopBtn.addEventListener('click', stopRecording);

rerecordBtn.addEventListener('click', () => {
  resetRecording();
  recordIdle.style.display = 'flex';
});

sendAudioBtn.addEventListener('click', sendAudioToAvatar);

async function startRecording() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { sampleRate: 44100, channelCount: 1, echoCancellation: true },
    });

    audioChunks = [];
    const mimeType = getSupportedMimeType();
    mediaRecorder = new MediaRecorder(stream, mimeType ? { mimeType } : {});

    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) audioChunks.push(e.data);
    };

    mediaRecorder.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      const blob = new Blob(audioChunks, { type: mediaRecorder.mimeType || 'audio/webm' });
      recordedBlob = blob;
      const url = URL.createObjectURL(blob);
      audioPreview.src = url;
      recordActive.style.display = 'none';
      recordReview.style.display = 'flex';
    };

    mediaRecorder.start(250);

    recordingSeconds = 0;
    recordTimer.textContent = '0:00';
    recordingTimerId = setInterval(() => {
      recordingSeconds++;
      const m = Math.floor(recordingSeconds / 60);
      const s = recordingSeconds % 60;
      recordTimer.textContent = `${m}:${s.toString().padStart(2, '0')}`;
    }, 1000);

    recordIdle.style.display = 'none';
    recordActive.style.display = 'flex';

  } catch (err) {
    console.error('[mic]', err);
    showToast(`Microphone error: ${err.message}`, true);
  }
}

function stopRecording() {
  clearInterval(recordingTimerId);
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.stop();
  }
}

function resetRecording() {
  clearInterval(recordingTimerId);
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.stop();
  }
  recordedBlob = null;
  audioPreview.src = '';
  recordIdle.style.display = 'flex';
  recordActive.style.display = 'none';
  recordReview.style.display = 'none';
}

function getSupportedMimeType() {
  const types = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/ogg;codecs=opus',
    'audio/ogg',
    'audio/mp4',
  ];
  return types.find((t) => MediaRecorder.isTypeSupported(t)) || null;
}

async function sendAudioToAvatar() {
  if (!recordedBlob || !avatarSession) return;

  sendAudioBtn.disabled = true;
  sendAudioBtn.innerHTML = `<span class="dot connecting" style="display:inline-block"></span> Converting…`;

  try {
    const mp3Blob   = await convertToMp3(recordedBlob);
    const duration  = await getAudioDuration(mp3Blob);
    const turnId    = `turn-${Date.now()}`;
    const mp3File   = new File([mp3Blob], 'recording.mp3', { type: 'audio/mpeg' });

    sendAudioBtn.innerHTML = `<span class="dot connecting" style="display:inline-block"></span> Sending…`;
    await avatarSession.sayAudio(mp3File, turnId, duration);

    showToast('Audio sent to avatar!');
    resetRecording();

  } catch (err) {
    console.error('[sendAudio]', err);
    showToast(`Failed to send audio: ${err.message}`, true);
  }

  sendAudioBtn.disabled = false;
  sendAudioBtn.innerHTML = `
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
      <line x1="22" y1="2" x2="11" y2="13"/>
      <polygon points="22 2 15 22 11 13 2 9 22 2"/>
    </svg>
    Send to Avatar`;
}

// ─── MP3 Conversion (lamejs) ──────────────────────────────────────────────────

async function convertToMp3(audioBlob) {
  const arrayBuffer = await audioBlob.arrayBuffer();

  // Decode audio at 44100 Hz mono
  const audioCtx   = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 44100 });
  const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer.slice(0));
  await audioCtx.close();

  const sampleRate  = audioBuffer.sampleRate;
  const numChannels = 1; // encode as mono
  const bitRate     = 128;

  const encoder = new Mp3Encoder(numChannels, sampleRate, bitRate);
  const pcmData  = audioBuffer.getChannelData(0); // Float32Array

  // Float32 → Int16
  const int16 = new Int16Array(pcmData.length);
  for (let i = 0; i < pcmData.length; i++) {
    const s = Math.max(-1, Math.min(1, pcmData[i]));
    int16[i] = s < 0 ? s * 32768 : s * 32767;
  }

  // Encode in blocks of 1152 samples (required by lamejs)
  const blockSize = 1152;
  const mp3Parts  = [];

  for (let i = 0; i < int16.length; i += blockSize) {
    const chunk = int16.subarray(i, i + blockSize);
    const buf   = encoder.encodeBuffer(chunk);
    if (buf.length > 0) mp3Parts.push(new Uint8Array(buf));
  }

  const flushed = encoder.flush();
  if (flushed.length > 0) mp3Parts.push(new Uint8Array(flushed));

  return new Blob(mp3Parts, { type: 'audio/mpeg' });
}

function getAudioDuration(blob) {
  return new Promise((resolve, reject) => {
    const audio = new Audio();
    const url   = URL.createObjectURL(blob);
    audio.onloadedmetadata = () => {
      URL.revokeObjectURL(url);
      resolve(audio.duration);
    };
    audio.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Could not determine audio duration'));
    };
    audio.src = url;
  });
}

// ─── Init ─────────────────────────────────────────────────────────────────────

function init() {
  const cfg = getConfig();
  if (!cfg.ks) {
    // First run — open settings
    settingsModal.style.display = 'flex';
    setStatus('idle', 'Configure settings to get started');
  } else {
    setStatus('idle', 'Ready — click Connect Avatar');
  }
}

init();
