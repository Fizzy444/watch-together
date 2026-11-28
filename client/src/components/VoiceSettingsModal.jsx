import { useState, useEffect, useRef } from 'react';
import {
  X,
  Mic,
  Volume2,
  SlidersHorizontal,
} from 'lucide-react';
import {
  createVoiceInputPipeline,
  createRemotePeerAudio,
} from '../utils/voiceAudio.js';

const NOISE_MODES = [
  {
    id: 'rnnoise',
    label: 'RNNoise AI',
    desc: 'Neural denoiser with high-pass filter and noise gate for keyboard, fan, and room noise.',
  },
  {
    id: 'browser',
    label: 'Standard',
    desc: 'Built-in browser noise suppression with lighter CPU usage.',
  },
  {
    id: 'off',
    label: 'Off',
    desc: 'Raw unprocessed microphone audio for dedicated studio setups.',
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
      setTestError(err?.message || 'Unable to start microphone test.');
    }
  }

  const selectedNoiseMeta =
    NOISE_MODES.find((m) => m.id === voiceSettings.noiseSuppressionMode) || NOISE_MODES[0];
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
            <SlidersHorizontal size={16} />
            <h3>Voice Settings</h3>
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

        <div className="modal-body" style={{ gap: 'var(--sp-5)' }}>
          <div className="field-group">
            <div className="voice-setting-label-row">
              <span className="field-label">Noise suppression</span>
              {isInVoice && (
                <span className="voice-setting-status">
                  Running: {activeNoiseMode === 'rnnoise' ? 'RNNoise AI' : activeNoiseMode === 'browser' ? 'Standard' : 'Off'}
                </span>
              )}
            </div>
            <div className="voice-segmented" role="group" aria-label="Noise suppression mode">
              {NOISE_MODES.map((mode) => {
                const selected = voiceSettings.noiseSuppressionMode === mode.id;
                return (
                  <button
                    key={mode.id}
                    type="button"
                    className={`voice-segmented-btn ${selected ? 'is-selected' : ''}`}
                    onClick={() => onUpdateSettings({ noiseSuppressionMode: mode.id })}
                    aria-pressed={selected}
                  >
                    {mode.label}
                  </button>
                );
              })}
            </div>
            <p className="voice-setting-hint">{selectedNoiseMeta.desc}</p>
          </div>

          <div className="field-group">
            <span className="field-label">Input mode</span>
            <div className="voice-segmented" role="group" aria-label="Microphone input mode">
              <button
                type="button"
                className={`voice-segmented-btn ${voiceSettings.inputMode === 'vad' ? 'is-selected' : ''}`}
                onClick={() => onUpdateSettings({ inputMode: 'vad' })}
                aria-pressed={voiceSettings.inputMode === 'vad'}
              >
                Voice Activity
              </button>
              <button
                type="button"
                className={`voice-segmented-btn ${voiceSettings.inputMode === 'ptt' ? 'is-selected' : ''}`}
                onClick={() => onUpdateSettings({ inputMode: 'ptt' })}
                aria-pressed={voiceSettings.inputMode === 'ptt'}
              >
                Push to Talk (Hold V)
              </button>
            </div>
          </div>

          {voiceSettings.inputMode === 'vad' && (
            <div className="field-group">
              <div className="voice-setting-label-row">
                <label htmlFor="voice-gate-slider" className="field-label">
                  Input sensitivity
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
                <span>Sensitive</span>
                <span>Strict gate</span>
              </div>
            </div>
          )}

          <div className="field-group">
            <div className="voice-setting-label-row">
              <span className="field-label">Microphone check</span>
              <button
                type="button"
                className={`btn btn-sm ${isTestingMic ? 'btn-danger-soft' : 'btn-secondary'}`}
                onClick={toggleMicTest}
              >
                {isTestingMic ? 'Stop Test' : 'Test Mic'}
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
                Input volume
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
                Input device
              </label>
              <select
                id="voice-input-device"
                className="input input-sm"
                value={voiceSettings.inputDeviceId}
                onChange={(e) => onUpdateSettings({ inputDeviceId: e.target.value })}
              >
                <option value="">Default microphone</option>
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
                  Output device
                </label>
                <select
                  id="voice-output-device"
                  className="input input-sm"
                  value={voiceSettings.outputDeviceId}
                  onChange={(e) => onUpdateSettings({ outputDeviceId: e.target.value })}
                >
                  <option value="">Default speakers / headphones</option>
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
            <div className="voice-toggle-row">
              <div>
                <div className="voice-toggle-title">Echo cancellation</div>
                <div className="voice-toggle-desc">
                  Prevents movie audio from feeding back into your mic
                </div>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={voiceSettings.echoCancellation}
                aria-label="Echo cancellation"
                className={`voice-switch ${voiceSettings.echoCancellation ? 'is-on' : ''}`}
                onClick={() =>
                  onUpdateSettings({ echoCancellation: !voiceSettings.echoCancellation })
                }
              >
                <span className="voice-switch-thumb" />
              </button>
            </div>

            <div className="voice-toggle-row">
              <div>
                <div className="voice-toggle-title">Auto gain control</div>
                <div className="voice-toggle-desc">
                  Balances quiet and loud speech automatically
                </div>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={voiceSettings.autoGainControl}
                aria-label="Auto gain control"
                className={`voice-switch ${voiceSettings.autoGainControl ? 'is-on' : ''}`}
                onClick={() =>
                  onUpdateSettings({ autoGainControl: !voiceSettings.autoGainControl })
                }
              >
                <span className="voice-switch-thumb" />
              </button>
            </div>
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
