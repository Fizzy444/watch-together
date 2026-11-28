import { useState, useEffect, useRef } from 'react';
import {
  X,
  Mic,
  Volume2,
  Sparkles,
  SlidersHorizontal,
  Radio,
  ShieldCheck,
} from 'lucide-react';
import {
  createVoiceInputPipeline,
  createRemotePeerAudio,
} from '../utils/voiceAudio.js';

const NOISE_MODES = [
  {
    id: 'rnnoise',
    label: 'Discord AI (RNNoise)',
    desc: 'Neural noise suppression + high-pass filter & gate. Blocks fans, typing, and room noise.',
  },
  {
    id: 'browser',
    label: 'Standard (Browser)',
    desc: 'Lightweight built-in WebRTC noise suppression.',
  },
  {
    id: 'off',
    label: 'Off (Raw Audio)',
    desc: 'Unprocessed microphone feed for studio mics.',
  },
];

export default function VoiceSettingsModal({
  isOpen,
  onClose,
  voiceSettings,
  activeNoiseMode,
  audioDevices,
  isInVoice,
  micLevel,
  onUpdateSettings,
}) {
  const [isTestingMic, setIsTestingMic] = useState(false);
  const [testLevel, setTestLevel] = useState(0);
  const [testError, setTestError] = useState('');
  const testCleanupRef = useRef(null);

  useEffect(() => {
    if (!isOpen && testCleanupRef.current) {
      testCleanupRef.current();
      testCleanupRef.current = null;
      setIsTestingMic(false);
      setTestLevel(0);
    }
  }, [isOpen]);

  useEffect(() => {
    return () => {
      testCleanupRef.current?.();
      testCleanupRef.current = null;
    };
  }, []);

  if (!isOpen) return null;

  async function toggleMicTest() {
    if (isTestingMic) {
      testCleanupRef.current?.();
      testCleanupRef.current = null;
      setIsTestingMic(false);
      setTestLevel(0);
      return;
    }

    setTestError('');
    try {
      const pipeline = await createVoiceInputPipeline(voiceSettings);
      const loopback = createRemotePeerAudio(pipeline.processedStream, {
        volumePercent: 100,
        muted: false,
        outputDeviceId: voiceSettings.outputDeviceId,
      });

      const timer = setInterval(() => {
        setTestLevel(pipeline.getAudioLevel());
      }, 65);

      testCleanupRef.current = () => {
        clearInterval(timer);
        loopback.destroy();
        pipeline.destroy();
      };
      setIsTestingMic(true);
    } catch (err) {
      setTestError(err?.message || 'Unable to start mic test.');
    }
  }

  const displayedLevel = isTestingMic ? testLevel : (isInVoice ? micLevel : 0);
  const supportsOutputSelect =
    typeof HTMLMediaElement !== 'undefined' &&
    typeof HTMLMediaElement.prototype.setSinkId === 'function';

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal-content voice-settings-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--sp-2)' }}>
            <SlidersHorizontal size={17} />
            <h3>Voice & Audio Settings</h3>
          </div>
          <button
            type="button"
            className="btn-icon"
            onClick={onClose}
            aria-label="Close voice settings"
          >
            <X size={16} />
          </button>
        </div>

        <div className="modal-body" style={{ gap: 'var(--sp-4)' }}>
          <div className="field-group">
            <div className="voice-setting-label-row">
              <label className="field-label" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <Sparkles size={13} color="var(--success)" />
                Noise Suppression
              </label>
              {isInVoice && (
                <span className="badge badge-success badge-compact">
                  Active: {activeNoiseMode === 'rnnoise' ? 'RNNoise AI' : activeNoiseMode === 'browser' ? 'Standard' : 'Off'}
                </span>
              )}
            </div>
            <div className="voice-mode-grid">
              {NOISE_MODES.map((mode) => {
                const selected = voiceSettings.noiseSuppressionMode === mode.id;
                return (
                  <button
                    key={mode.id}
                    type="button"
                    className={`voice-mode-option ${selected ? 'is-selected' : ''}`}
                    onClick={() => onUpdateSettings({ noiseSuppressionMode: mode.id })}
                  >
                    <div className="voice-mode-option-title">{mode.label}</div>
                    <div className="voice-mode-option-desc">{mode.desc}</div>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="field-group">
            <label className="field-label" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <Radio size={13} />
              Input Mode
            </label>
            <div className="voice-input-mode-row">
              <button
                type="button"
                className={`btn btn-sm ${voiceSettings.inputMode === 'vad' ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => onUpdateSettings({ inputMode: 'vad' })}
                style={{ flex: 1 }}
              >
                Voice Activity
              </button>
              <button
                type="button"
                className={`btn btn-sm ${voiceSettings.inputMode === 'ptt' ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => onUpdateSettings({ inputMode: 'ptt' })}
                style={{ flex: 1 }}
              >
                Push to Talk (Hold V)
              </button>
            </div>
          </div>

          {voiceSettings.inputMode === 'vad' && (
            <div className="field-group">
              <div className="voice-setting-label-row">
                <label htmlFor="voice-gate-slider" className="field-label">
                  Noise Gate Sensitivity
                </label>
                <span className="voice-setting-value">
                  {voiceSettings.gateThresholdDb} dB
                </span>
              </div>
              <input
                id="voice-gate-slider"
                type="range"
                min={-65}
                max={-25}
                step={1}
                value={voiceSettings.gateThresholdDb}
                onChange={(e) =>
                  onUpdateSettings({ gateThresholdDb: Number(e.target.value) })
                }
                className="voice-range-input"
              />
              <div className="voice-slider-hints">
                <span>Sensitive (quiet voice)</span>
                <span>Strict (blocks background)</span>
              </div>
            </div>
          )}

          <div className="field-group">
            <div className="voice-setting-label-row">
              <label className="field-label" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <Mic size={13} />
                Mic Test & Input Level
              </label>
              <button
                type="button"
                className={`btn btn-sm ${isTestingMic ? 'btn-danger-soft' : 'btn-secondary'}`}
                onClick={toggleMicTest}
              >
                {isTestingMic ? 'Stop Test' : 'Let’s Check (Loopback)'}
              </button>
            </div>
            <div className="voice-test-meter">
              <div
                className="voice-test-meter-fill"
                style={{ width: `${displayedLevel}%` }}
              />
            </div>
            {testError && <div className="modal-alert modal-alert-error">{testError}</div>}
          </div>

          <div className="field-group">
            <div className="voice-setting-label-row">
              <label htmlFor="voice-mic-gain" className="field-label">
                Input Gain
              </label>
              <span className="voice-setting-value">
                {Math.round((voiceSettings.micGain || 1) * 100)}%
              </span>
            </div>
            <input
              id="voice-mic-gain"
              type="range"
              min={0.2}
              max={2}
              step={0.05}
              value={voiceSettings.micGain}
              onChange={(e) => onUpdateSettings({ micGain: Number(e.target.value) })}
              className="voice-range-input"
            />
          </div>

          <div className="voice-device-grid">
            <div className="field-group">
              <label htmlFor="voice-input-device" className="field-label" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <Mic size={13} />
                Input Device
              </label>
              <select
                id="voice-input-device"
                className="input input-sm"
                value={voiceSettings.inputDeviceId}
                onChange={(e) => onUpdateSettings({ inputDeviceId: e.target.value })}
              >
                <option value="">Default Microphone</option>
                {audioDevices.inputs.map((dev, idx) => (
                  <option key={dev.deviceId || idx} value={dev.deviceId}>
                    {dev.label || `Microphone ${idx + 1}`}
                  </option>
                ))}
              </select>
            </div>

            {supportsOutputSelect && (
              <div className="field-group">
                <label htmlFor="voice-output-device" className="field-label" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Volume2 size={13} />
                  Output Device
                </label>
                <select
                  id="voice-output-device"
                  className="input input-sm"
                  value={voiceSettings.outputDeviceId}
                  onChange={(e) => onUpdateSettings({ outputDeviceId: e.target.value })}
                >
                  <option value="">Default Speakers / Headphones</option>
                  {audioDevices.outputs.map((dev, idx) => (
                    <option key={dev.deviceId || idx} value={dev.deviceId}>
                      {dev.label || `Output ${idx + 1}`}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          <div className="voice-toggle-list">
            <label className="voice-toggle-row">
              <div>
                <div className="voice-toggle-title" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <ShieldCheck size={13} color="var(--info)" />
                  Echo Cancellation
                </div>
                <div className="voice-toggle-desc">
                  Prevents movie audio from speakers feeding back into your mic
                </div>
              </div>
              <input
                type="checkbox"
                checked={voiceSettings.echoCancellation}
                onChange={(e) => onUpdateSettings({ echoCancellation: e.target.checked })}
              />
            </label>

            <label className="voice-toggle-row">
              <div>
                <div className="voice-toggle-title">Auto Gain Control</div>
                <div className="voice-toggle-desc">
                  Automatically balances quiet and loud speaking levels
                </div>
              </div>
              <input
                type="checkbox"
                checked={voiceSettings.autoGainControl}
                onChange={(e) => onUpdateSettings({ autoGainControl: e.target.checked })}
              />
            </label>
          </div>
        </div>

        <div className="modal-footer">
          <button type="button" className="btn btn-primary btn-sm" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
