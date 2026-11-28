import {
  NoiseGateWorkletNode,
  RnnoiseWorkletNode,
  loadRnnoise,
} from '@sapphi-red/web-noise-suppressor';
import rnnoiseWasmUrl from '@sapphi-red/web-noise-suppressor/rnnoise.wasm?url';
import rnnoiseSimdWasmUrl from '@sapphi-red/web-noise-suppressor/rnnoise_simd.wasm?url';
import rnnoiseWorkletUrl from '@sapphi-red/web-noise-suppressor/rnnoiseWorklet.js?url';
import noiseGateWorkletUrl from '@sapphi-red/web-noise-suppressor/noiseGateWorklet.js?url';
import {
  optimizeOpusSdp,
  computeAudioLevelPercent,
  isLevelSpeaking,
} from './voiceSdp.js';

export { optimizeOpusSdp, computeAudioLevelPercent, isLevelSpeaking };

const VOICE_SETTINGS_STORAGE_KEY = 'wt_voice_settings';
const PEER_VOLUMES_STORAGE_KEY = 'wt_voice_peer_volumes';

const TARGET_SAMPLE_RATE = 48000;
const HIGH_PASS_FREQUENCY_HZ = 85;
const NOISE_GATE_HOLD_MS = 220;
const NOISE_GATE_HYSTERESIS_DB = 6;

export const DEFAULT_VOICE_SETTINGS = {
  noiseSuppressionMode: 'rnnoise',
  inputMode: 'vad',
  gateThresholdDb: -50,
  micGain: 1,
  inputDeviceId: '',
  outputDeviceId: '',
  echoCancellation: true,
  autoGainControl: true,
};

let cachedRnnoiseWasmPromise = null;

function getCachedRnnoiseWasm() {
  if (!cachedRnnoiseWasmPromise) {
    cachedRnnoiseWasmPromise = loadRnnoise({
      url: rnnoiseWasmUrl,
      simdUrl: rnnoiseSimdWasmUrl,
    }).catch((err) => {
      cachedRnnoiseWasmPromise = null;
      throw err;
    });
  }
  return cachedRnnoiseWasmPromise;
}

export function loadVoiceSettings() {
  try {
    const raw = localStorage.getItem(VOICE_SETTINGS_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_VOICE_SETTINGS };
    const parsed = JSON.parse(raw);
    return {
      ...DEFAULT_VOICE_SETTINGS,
      ...parsed,
    };
  } catch {
    return { ...DEFAULT_VOICE_SETTINGS };
  }
}

export function saveVoiceSettings(settings) {
  try {
    localStorage.setItem(VOICE_SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  } catch {}
}

export function loadPeerVolumes() {
  try {
    const raw = localStorage.getItem(PEER_VOLUMES_STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export function savePeerVolumes(volumes) {
  try {
    localStorage.setItem(PEER_VOLUMES_STORAGE_KEY, JSON.stringify(volumes));
  } catch {}
}

async function acquireMicStream(settings) {
  const baseAudio = {
    echoCancellation: Boolean(settings.echoCancellation),
    autoGainControl: Boolean(settings.autoGainControl),
    noiseSuppression: settings.noiseSuppressionMode === 'browser',
    channelCount: 1,
    sampleRate: TARGET_SAMPLE_RATE,
  };

  if (settings.inputDeviceId) {
    try {
      return await navigator.mediaDevices.getUserMedia({
        audio: {
          ...baseAudio,
          deviceId: { exact: settings.inputDeviceId },
        },
        video: false,
      });
    } catch (err) {
      if (err?.name !== 'OverconstrainedError' && err?.name !== 'NotFoundError') {
        throw err;
      }
    }
  }

  return navigator.mediaDevices.getUserMedia({
    audio: baseAudio,
    video: false,
  });
}

function createAudioContextForVoice() {
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  try {
    return new AudioCtx({ sampleRate: TARGET_SAMPLE_RATE, latencyHint: 'interactive' });
  } catch {
    return new AudioCtx({ latencyHint: 'interactive' });
  }
}

export async function createVoiceInputPipeline(settings = DEFAULT_VOICE_SETTINGS) {
  const rawStream = await acquireMicStream(settings);
  const audioContext = createAudioContextForVoice();
  if (audioContext.state === 'suspended') {
    await audioContext.resume();
  }

  const source = audioContext.createMediaStreamSource(rawStream);
  const highPass = audioContext.createBiquadFilter();
  highPass.type = 'highpass';
  highPass.frequency.value = HIGH_PASS_FREQUENCY_HZ;
  highPass.Q.value = 0.7;

  const gainNode = audioContext.createGain();
  gainNode.gain.value = Math.max(0.1, Math.min(2, Number(settings.micGain) || 1));

  const compressor = audioContext.createDynamicsCompressor();
  compressor.threshold.value = -24;
  compressor.knee.value = 18;
  compressor.ratio.value = 3.5;
  compressor.attack.value = 0.005;
  compressor.release.value = 0.15;

  const analyser = audioContext.createAnalyser();
  analyser.fftSize = 512;
  analyser.smoothingTimeConstant = 0.4;
  const analyserBuffer = new Uint8Array(analyser.fftSize);

  const destination = audioContext.createMediaStreamDestination();

  let rnnoiseNode = null;
  let noiseGateNode = null;
  let activeMode = settings.noiseSuppressionMode;

  if (settings.noiseSuppressionMode === 'rnnoise') {
    const canUseWorklet =
      Boolean(audioContext.audioWorklet) &&
      audioContext.sampleRate === TARGET_SAMPLE_RATE;

    if (canUseWorklet) {
      try {
        const [wasmBinary] = await Promise.all([
          getCachedRnnoiseWasm(),
          audioContext.audioWorklet.addModule(rnnoiseWorkletUrl),
          audioContext.audioWorklet.addModule(noiseGateWorkletUrl),
        ]);

        rnnoiseNode = new RnnoiseWorkletNode(audioContext, {
          maxChannels: 1,
          wasmBinary,
        });

        if (settings.inputMode !== 'ptt') {
          const openDb = Number(settings.gateThresholdDb ?? -50);
          noiseGateNode = new NoiseGateWorkletNode(audioContext, {
            openThreshold: openDb,
            closeThreshold: openDb - NOISE_GATE_HYSTERESIS_DB,
            holdMs: NOISE_GATE_HOLD_MS,
            maxChannels: 1,
          });
        }
      } catch (err) {
        console.warn('[Voice] RNNoise worklet init failed, falling back to browser NS:', err);
        activeMode = 'browser';
      }
    } else {
      activeMode = 'browser';
    }
  } else if (settings.noiseSuppressionMode === 'browser' && audioContext.audioWorklet) {
    if (settings.inputMode !== 'ptt') {
      try {
        await audioContext.audioWorklet.addModule(noiseGateWorkletUrl);
        const openDb = Number(settings.gateThresholdDb ?? -50);
        noiseGateNode = new NoiseGateWorkletNode(audioContext, {
          openThreshold: openDb,
          closeThreshold: openDb - NOISE_GATE_HYSTERESIS_DB,
          holdMs: NOISE_GATE_HOLD_MS,
          maxChannels: 1,
        });
      } catch {}
    }
  }

  if (activeMode === 'browser' && settings.noiseSuppressionMode === 'rnnoise') {
    const rawTrack = rawStream.getAudioTracks()[0];
    if (rawTrack?.applyConstraints) {
      await rawTrack.applyConstraints({ noiseSuppression: true }).catch(() => {});
    }
  }

  if (activeMode === 'off') {
    source.connect(gainNode);
    gainNode.connect(analyser);
    analyser.connect(destination);
  } else {
    let tail = source;
    tail.connect(highPass);
    tail = highPass;
    tail.connect(gainNode);
    tail = gainNode;
    if (rnnoiseNode) {
      tail.connect(rnnoiseNode);
      tail = rnnoiseNode;
    }
    if (noiseGateNode) {
      tail.connect(noiseGateNode);
      tail = noiseGateNode;
    }
    tail.connect(compressor);
    compressor.connect(analyser);
    analyser.connect(destination);
  }

  function setMicGain(value) {
    gainNode.gain.setTargetAtTime(
      Math.max(0.1, Math.min(2, Number(value) || 1)),
      audioContext.currentTime,
      0.02
    );
  }

  function setEnabled(enabled) {
    for (const track of destination.stream.getAudioTracks()) {
      track.enabled = Boolean(enabled);
    }
    for (const track of rawStream.getAudioTracks()) {
      track.enabled = Boolean(enabled);
    }
  }

  function getAudioLevel() {
    return computeAudioLevelPercent(analyser, analyserBuffer);
  }

  function destroy() {
    try {
      rnnoiseNode?.destroy();
    } catch {}
    try {
      source.disconnect();
      destination.disconnect();
    } catch {}
    for (const track of rawStream.getTracks()) {
      try {
        track.stop();
      } catch {}
    }
    for (const track of destination.stream.getTracks()) {
      try {
        track.stop();
      } catch {}
    }
    if (audioContext.state !== 'closed') {
      audioContext.close().catch(() => {});
    }
  }

  return {
    processedStream: destination.stream,
    rawStream,
    audioContext,
    activeMode,
    setMicGain,
    setEnabled,
    getAudioLevel,
    destroy,
  };
}

export function createRemotePeerAudio(stream, { volumePercent = 100, muted = false, outputDeviceId = '' } = {}) {
  const anchorAudio = new Audio();
  anchorAudio.srcObject = stream;
  anchorAudio.muted = true;
  anchorAudio.volume = 0;
  anchorAudio.play().catch(() => {});

  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  const audioContext = new AudioCtx({ latencyHint: 'interactive' });
  if (audioContext.state === 'suspended') {
    audioContext.resume().catch(() => {});
  }

  const source = audioContext.createMediaStreamSource(stream);
  const gainNode = audioContext.createGain();
  const analyser = audioContext.createAnalyser();
  analyser.fftSize = 256;
  analyser.smoothingTimeConstant = 0.45;
  const analyserBuffer = new Uint8Array(analyser.fftSize);
  const destination = audioContext.createMediaStreamDestination();

  source.connect(analyser);
  analyser.connect(gainNode);
  gainNode.connect(destination);

  const outputAudio = new Audio();
  outputAudio.srcObject = destination.stream;
  outputAudio.autoplay = true;
  outputAudio.play().catch(() => {});

  function applyVolume(nextVolumePercent, nextMuted) {
    const gainValue = nextMuted ? 0 : Math.max(0, Math.min(2, Number(nextVolumePercent) / 100));
    gainNode.gain.setTargetAtTime(gainValue, audioContext.currentTime, 0.02);
  }

  async function setOutputDevice(deviceId) {
    if (!deviceId || typeof outputAudio.setSinkId !== 'function') return;
    try {
      await outputAudio.setSinkId(deviceId);
    } catch {}
  }

  applyVolume(volumePercent, muted);
  if (outputDeviceId) {
    setOutputDevice(outputDeviceId);
  }

  function getAudioLevel() {
    return computeAudioLevelPercent(analyser, analyserBuffer);
  }

  function destroy() {
    try {
      anchorAudio.pause();
      anchorAudio.srcObject = null;
    } catch {}
    try {
      outputAudio.pause();
      outputAudio.srcObject = null;
    } catch {}
    try {
      source.disconnect();
      destination.disconnect();
    } catch {}
    if (audioContext.state !== 'closed') {
      audioContext.close().catch(() => {});
    }
  }

  return {
    applyVolume,
    setOutputDevice,
    getAudioLevel,
    destroy,
  };
}
