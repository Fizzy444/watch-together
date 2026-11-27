import {
  useEffect,
  useRef,
  useState,
  useCallback,
  useImperativeHandle,
  forwardRef,
  memo,
} from 'react';
import Artplayer from 'artplayer';
import Hls from 'hls.js';
import { VolumeX, ShieldAlert, Wifi } from 'lucide-react';
import {
  createVttBlobUrl,
  getFriendlySubtitleLabel,
  formatSubtitleTrackLabel,
} from '../utils/subtitles.js';
import { formatAudioTrackLabel } from '../utils/audio.js';

const HARD_SEEK_THRESHOLD = 1.5;
const CATCHUP_THRESHOLD = 0.3;
const CATCHUP_MAX_LAG = 10.0;
const SUBTITLE_SWITCH_GUARD_MS = 800;

const AUDIO_CONTROL_ICON =
  '<span class="art-icon art-icon-audio" style="display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="pointer-events:none;"><path d="M3 18v-6a9 9 0 0 1 18 0v6"></path><path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z"></path></svg></span>';

const SUBTITLE_CONTROL_ICON =
  '<span class="art-icon art-icon-subtitle" style="display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="pointer-events:none;"><path d="M4 5h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z"></path><path d="M7 15h3M14 15h3M7 11h10"></path></svg></span>';

const SUB_PREF_KEYS = {
  size: 'watch_together_sub_size',
  location: 'watch_together_sub_location',
  color: 'watch_together_sub_color',
  bg: 'watch_together_sub_bg',
  shadow: 'watch_together_sub_shadow',
  preferredSubLang: 'watch_together_preferred_sub_lang',
  preferredAudioLang: 'watch_together_preferred_audio_lang',
};

const SHADOW_STYLES = {
  crisp: '0 2px 4px rgba(0, 0, 0, 0.95), 0 0 2px rgba(0, 0, 0, 0.95)',
  heavy: '0 2px 6px #000, 0 0 6px #000, 0 0 10px #000',
  minimal: '0 1px 2px rgba(0, 0, 0, 0.8)',
};

const SIZE_LABELS = {
  '16px': 'Small',
  '22px': 'Medium',
  '28px': 'Large',
  '34px': 'Extra Large',
  '42px': 'Huge',
};

const LOCATION_LABELS = {
  bottom: 'Bottom',
  lower: 'Lower Bottom',
  raised: 'Raised Bottom',
  middle: 'Middle',
  top: 'Top',
};

const COLOR_LABELS = {
  '#ffffff': 'White',
  '#fde047': 'Yellow',
  '#67e8f9': 'Cyan',
  '#86efac': 'Green',
};

const BG_LABELS = {
  none: 'None',
  dark: 'Semi-Transparent',
  solid: 'Solid Black',
};

const SHADOW_LABELS = {
  crisp: 'Crisp Outline',
  heavy: 'Heavy Outline',
  minimal: 'Soft Shadow',
};

function readStorage(key, fallback = null) {
  try {
    return localStorage.getItem(key) || fallback;
  } catch {
    return fallback;
  }
}

function writeStorage(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {}
}

function resolveSubUrl(rawUrl, videoSrc) {
  if (!rawUrl) return '';
  if (rawUrl.startsWith('http://') || rawUrl.startsWith('https://') || rawUrl.startsWith('blob:')) {
    return rawUrl;
  }
  if (videoSrc && (videoSrc.startsWith('http://') || videoSrc.startsWith('https://'))) {
    try {
      const origin = new URL(videoSrc).origin;
      return `${origin}${rawUrl.startsWith('/') ? '' : '/'}${rawUrl}`;
    } catch {}
  }
  return rawUrl;
}

function getSavedSubPrefs() {
  return {
    size: readStorage(SUB_PREF_KEYS.size, '22px'),
    location: readStorage(SUB_PREF_KEYS.location, 'bottom'),
    color: readStorage(SUB_PREF_KEYS.color, '#ffffff'),
    bg: readStorage(SUB_PREF_KEYS.bg, 'none'),
    shadow: readStorage(SUB_PREF_KEYS.shadow, 'crisp'),
  };
}

function applySubtitleStyles(art) {
  if (!art?.subtitle) return;
  const prefs = getSavedSubPrefs();
  const shadow = SHADOW_STYLES[prefs.shadow] || SHADOW_STYLES.crisp;

  if (art.template?.$player) {
    art.template.$player.setAttribute('data-sub-location', prefs.location);
    art.template.$player.setAttribute('data-sub-bg', prefs.bg);
  }

  art.subtitle.style({
    fontSize: prefs.size,
    color: prefs.color,
    textShadow: shadow,
  });
}

function applySafeSubtitleOffset(art, offsetSeconds) {
  const textTrack = art?.subtitle?.textTrack;
  if (!textTrack) return;
  const num = Number(offsetSeconds);
  if (!Number.isFinite(num)) return;

  try {
    const rawCues = textTrack.cues;
    if (!rawCues || rawCues.length === 0) {
      art.notice.show = 'No active subtitle cues loaded';
      return;
    }

    const duration = Number(art.duration) || 0;
    const hasFiniteDuration = Number.isFinite(duration) && duration > 0;
    const prevMode = textTrack.mode;
    textTrack.mode = 'disabled';

    try {
      for (let i = 0; i < rawCues.length; i++) {
        const cue = rawCues[i];
        if (!cue) continue;
        cue.originalStartTime = cue.originalStartTime ?? cue.startTime;
        cue.originalEndTime = cue.originalEndTime ?? cue.endTime;

        const newStart = cue.originalStartTime + num;
        const newEnd = cue.originalEndTime + num;

        if (hasFiniteDuration) {
          cue.startTime = Math.max(0, Math.min(newStart, duration));
          cue.endTime = Math.max(0, Math.min(newEnd, duration));
        } else {
          cue.startTime = Math.max(0, newStart);
          cue.endTime = Math.max(0, newEnd);
        }
      }
    } finally {
      textTrack.mode = prevMode || 'hidden';
    }

    art.subtitle.update();
    art.notice.show = `Subtitle Sync: ${num > 0 ? '+' : ''}${num.toFixed(1)}s`;
  } catch (err) {
    console.warn('[Subtitles] Failed to apply subtitle offset:', err);
  }
}

function stripSubtitleFormatting(text) {
  if (typeof text !== 'string') return text;
  return text.replace(/\{[^}\n]+\}/g, '').replace(/<[^>\n]+>/g, '');
}

function getSubtitleSettingsList() {
  const prefs = getSavedSubPrefs();

  return [
    {
      name: 'subtitle-settings',
      html: 'Subtitle Settings',
      icon: SUBTITLE_CONTROL_ICON,
      width: 240,
      tooltip: 'Customize',
      selector: [
        {
          name: 'subtitle-size',
          html: 'Text Size',
          width: 240,
          tooltip: SIZE_LABELS[prefs.size] || 'Medium',
          selector: [
            { html: 'Small (16px)', value: '16px', default: prefs.size === '16px' },
            { html: 'Medium (22px)', value: '22px', default: prefs.size === '22px' },
            { html: 'Large (28px)', value: '28px', default: prefs.size === '28px' },
            { html: 'Extra Large (34px)', value: '34px', default: prefs.size === '34px' },
            { html: 'Huge (42px)', value: '42px', default: prefs.size === '42px' },
          ],
          onSelect: function (item) {
            writeStorage(SUB_PREF_KEYS.size, item.value);
            this.subtitle?.style('fontSize', item.value);
            return SIZE_LABELS[item.value] || item.html;
          },
        },
        {
          name: 'subtitle-location',
          html: 'Position',
          width: 240,
          tooltip: LOCATION_LABELS[prefs.location] || 'Bottom',
          selector: [
            { html: 'Bottom (Standard)', value: 'bottom', default: prefs.location === 'bottom' },
            { html: 'Lower Bottom', value: 'lower', default: prefs.location === 'lower' },
            { html: 'Raised Above Controls', value: 'raised', default: prefs.location === 'raised' },
            { html: 'Middle', value: 'middle', default: prefs.location === 'middle' },
            { html: 'Top', value: 'top', default: prefs.location === 'top' },
          ],
          onSelect: function (item) {
            writeStorage(SUB_PREF_KEYS.location, item.value);
            this.template?.$player?.setAttribute('data-sub-location', item.value);
            return LOCATION_LABELS[item.value] || item.html;
          },
        },
        {
          name: 'subtitle-color',
          html: 'Text Color',
          width: 220,
          tooltip: COLOR_LABELS[prefs.color] || 'White',
          selector: [
            { html: 'White', value: '#ffffff', default: prefs.color === '#ffffff' },
            { html: 'Yellow', value: '#fde047', default: prefs.color === '#fde047' },
            { html: 'Cyan', value: '#67e8f9', default: prefs.color === '#67e8f9' },
            { html: 'Green', value: '#86efac', default: prefs.color === '#86efac' },
          ],
          onSelect: function (item) {
            writeStorage(SUB_PREF_KEYS.color, item.value);
            this.subtitle?.style('color', item.value);
            return item.html;
          },
        },
        {
          name: 'subtitle-bg',
          html: 'Background',
          width: 240,
          tooltip: BG_LABELS[prefs.bg] || 'None',
          selector: [
            { html: 'None (Transparent)', value: 'none', default: prefs.bg === 'none' },
            { html: 'Semi-Transparent Dark', value: 'dark', default: prefs.bg === 'dark' },
            { html: 'Solid Black Box', value: 'solid', default: prefs.bg === 'solid' },
          ],
          onSelect: function (item) {
            writeStorage(SUB_PREF_KEYS.bg, item.value);
            this.template?.$player?.setAttribute('data-sub-bg', item.value);
            return BG_LABELS[item.value] || item.html;
          },
        },
        {
          name: 'subtitle-shadow',
          html: 'Outline',
          width: 240,
          tooltip: SHADOW_LABELS[prefs.shadow] || 'Crisp Outline',
          selector: [
            { html: 'Crisp Outline', value: 'crisp', default: prefs.shadow === 'crisp' },
            { html: 'Heavy Outline', value: 'heavy', default: prefs.shadow === 'heavy' },
            { html: 'Soft Shadow', value: 'minimal', default: prefs.shadow === 'minimal' },
          ],
          onSelect: function (item) {
            writeStorage(SUB_PREF_KEYS.shadow, item.value);
            const shadow = SHADOW_STYLES[item.value] || SHADOW_STYLES.crisp;
            this.subtitle?.style('textShadow', shadow);
            return item.html;
          },
        },
        {
          name: 'subtitle-sync',
          html: 'Timing Offset',
          width: 240,
          tooltip: '0.0s',
          selector: [
            { html: '-2.0s', value: -2.0 },
            { html: '-1.0s', value: -1.0 },
            { html: '-0.5s', value: -0.5 },
            { html: '0.0s (Normal)', value: 0.0, default: true },
            { html: '+0.5s', value: 0.5 },
            { html: '+1.0s', value: 1.0 },
            { html: '+2.0s', value: 2.0 },
          ],
          onSelect: function (item) {
            applySafeSubtitleOffset(this, item.value);
            return item.value === 0 ? '0.0s' : item.html;
          },
        },
      ],
    },
  ];
}

function patchDurationAccessors(art, effectiveDurationRef) {
  if (!art) return;

  try {
    Object.defineProperty(art, 'duration', {
      configurable: true,
      enumerable: true,
      get: () => {
        if (effectiveDurationRef.current > 0) {
          return effectiveDurationRef.current;
        }
        const videoDuration = art.template?.$video?.duration;
        return videoDuration === Infinity || !videoDuration ? 0 : videoDuration;
      },
    });
  } catch {}

  if (art.template?.$video) {
    const nativeDurationDesc = Object.getOwnPropertyDescriptor(
      HTMLMediaElement.prototype,
      'duration'
    );
    try {
      Object.defineProperty(art.template.$video, 'duration', {
        configurable: true,
        enumerable: true,
        get: () => {
          if (effectiveDurationRef.current > 0) {
            return effectiveDurationRef.current;
          }
          try {
            return nativeDurationDesc?.get?.call(art.template.$video) || 0;
          } catch {
            return 0;
          }
        },
      });
    } catch {}
  }
}

const VideoPlayer = forwardRef(function VideoPlayer(
  {
    src,
    videoPath = null,
    subtitleUrl = null,
    subtitleTracks = null,
    audioTracks: initialAudioTracksProp = null,
    knownDuration = null,
    onPlaybackError = null,
    streamObject = null,
    isP2P = false,
    p2pStatus = null,
    isTorrent = false,
    torrentMagnet = null,
    onStreamReady = null,
    isHost = false,
    canControl,
    initialTime = 0,
    initialPlaying = false,
    wasPlayingBeforeDisconnect: _wasPlayingBeforeDisconnect = false,
    onPlay,
    onPause,
    onSeek,
    onTimeUpdate,
  },
  ref
) {
  const effectiveCanControl = canControl ?? isHost;
  const containerRef = useRef(null);
  const artRef = useRef(null);
  const hiddenSubFileInputRef = useRef(null);
  const subtitleBlobUrlsRef = useRef(new Set());
  const effectiveDurationRef = useRef(Number(knownDuration) || 0);

  const onPlaybackErrorRef = useRef(onPlaybackError);
  const isHostRef = useRef(isHost);
  const canControlRef = useRef(effectiveCanControl);
  const onPlayRef = useRef(onPlay);
  const onPauseRef = useRef(onPause);
  const onSeekRef = useRef(onSeek);
  const onTimeUpdateRef = useRef(onTimeUpdate);

  const [muted, setMuted] = useState(false);
  const [autoplayMuted, setAutoplayMuted] = useState(false);
  const [hostReconnecting, setHostReconnecting] = useState(false);
  const [torrentStatusText, setTorrentStatusText] = useState('');
  const [torrentError, setTorrentError] = useState('');
  const [detectedSubtitles, setDetectedSubtitles] = useState([]);
  const [detectedAudioTracks, setDetectedAudioTracks] = useState([]);

  const detectedSubtitlesRef = useRef(detectedSubtitles);
  const detectedAudioTracksRef = useRef(detectedAudioTracks);
  const hasInitializedTime = useRef(false);
  const pendingInitialTime = useRef(initialTime);
  const pendingInitialPlaying = useRef(initialPlaying);
  const hostPlayingRef = useRef(Boolean(initialPlaying));
  const hostPositionRef = useRef(Number(initialTime) || 0);
  const isSyncSeekingRef = useRef(false);
  const isRemoteSyncActionRef = useRef(false);
  const remoteSyncTimerRef = useRef(null);
  const pendingPauseTarget = useRef(null);
  const pendingPauseTimer = useRef(null);
  const isSettingOpenRef = useRef(false);
  const isSwitchingSubtitleRef = useRef(false);
  const switchingSubTimerRef = useRef(null);

  useEffect(() => {
    onPlaybackErrorRef.current = onPlaybackError;
    isHostRef.current = isHost;
    canControlRef.current = effectiveCanControl;
    onPlayRef.current = onPlay;
    onPauseRef.current = onPause;
    onSeekRef.current = onSeek;
    onTimeUpdateRef.current = onTimeUpdate;
  }, [onPlaybackError, isHost, effectiveCanControl, onPlay, onPause, onSeek, onTimeUpdate]);

  useEffect(() => {
    detectedSubtitlesRef.current = detectedSubtitles;
  }, [detectedSubtitles]);

  useEffect(() => {
    detectedAudioTracksRef.current = detectedAudioTracks;
  }, [detectedAudioTracks]);

  const markSubtitleSwitching = useCallback(() => {
    isSwitchingSubtitleRef.current = true;
    clearTimeout(switchingSubTimerRef.current);
    switchingSubTimerRef.current = setTimeout(() => {
      isSwitchingSubtitleRef.current = false;
    }, SUBTITLE_SWITCH_GUARD_MS);
  }, []);

  const updateSubtitleButtonActive = useCallback((artInstance, isShow) => {
    const btn = artInstance?.controls?.['subtitle-button'];
    if (btn) {
      btn.classList.toggle('active', Boolean(isShow));
    }
  }, []);

  const notifyDurationUpdated = useCallback((duration) => {
    const parsed = Number(duration);
    if (!Number.isFinite(parsed) || parsed <= 0) return;
    if (effectiveDurationRef.current === parsed) return;
    effectiveDurationRef.current = parsed;
    const art = artRef.current;
    if (!art) return;

    try {
      art.emit('video:progress');
      art.emit('video:durationchange');
    } catch {}
  }, []);

  useEffect(() => {
    if (knownDuration && Number(knownDuration) > 0) {
      notifyDurationUpdated(knownDuration);
    }
  }, [knownDuration, notifyDurationUpdated]);

  useEffect(() => {
    if (effectiveDurationRef.current > 0 || !src) return;
    if (!src.startsWith('http://') && !src.startsWith('https://')) return;

    const controller = new AbortController();
    try {
      const origin = new URL(src).origin;
      fetch(`${origin}/health`, { signal: controller.signal })
        .then((res) => {
          if (!res.ok) throw new Error();
          return res.json();
        })
        .then((data) => {
          if (data && typeof data.duration === 'number' && data.duration > 0) {
            notifyDurationUpdated(data.duration);
          }
        })
        .catch(() => {});
    } catch {}

    return () => controller.abort();
  }, [src, notifyDurationUpdated]);

  useEffect(() => {
    if (initialTime > 0 && !hasInitializedTime.current) {
      pendingInitialTime.current = initialTime;
      hostPositionRef.current = initialTime;
    }
  }, [initialTime]);

  useEffect(() => {
    if (!hasInitializedTime.current) {
      pendingInitialPlaying.current = initialPlaying;
      hostPlayingRef.current = Boolean(initialPlaying);
    }
  }, [initialPlaying]);

  useEffect(() => {
    const urls = subtitleBlobUrlsRef.current;
    return () => {
      clearTimeout(pendingPauseTimer.current);
      clearTimeout(switchingSubTimerRef.current);
      urls.forEach((url) => {
        try {
          URL.revokeObjectURL(url);
        } catch {}
      });
    };
  }, []);

  const buildSubtitleControlConfig = useCallback(
    (tracks, artInstance) => {
      const currentUrl = artInstance?.subtitle?.url;
      const isShown = Boolean(artInstance?.subtitle?.show);

      const selector = [
        {
          html: 'Off',
          value: 'off',
          default: !currentUrl || !isShown,
        },
        ...tracks.map((track) => ({
          html: track.label,
          value: track.id,
          url: track.blobUrl,
          language: track.language,
          default: isShown && currentUrl === track.blobUrl,
        })),
        {
          html: 'Upload Subtitle (.srt, .vtt)',
          value: 'upload',
        },
      ];

      return {
        name: 'subtitle-button',
        position: 'right',
        index: 23,
        html: SUBTITLE_CONTROL_ICON,
        tooltip: 'Subtitles (Key: C)',
        selector,
        onSelect: function (item) {
          if (item.value === 'off') {
            this.subtitle.show = false;
            updateSubtitleButtonActive(this, false);
            writeStorage(SUB_PREF_KEYS.preferredSubLang, 'off');
            this.notice.show = 'Subtitles Off';
          } else if (item.value === 'upload') {
            hiddenSubFileInputRef.current?.click();
          } else if (item.url) {
            markSubtitleSwitching();
            this.subtitle.switch(item.url, { type: 'vtt' }).catch(() => {});
            this.subtitle.show = true;
            updateSubtitleButtonActive(this, true);
            applySubtitleStyles(this);
            if (item.language) {
              writeStorage(SUB_PREF_KEYS.preferredSubLang, item.language.toLowerCase());
            }
            this.notice.show = `Subtitles: ${item.html}`;
          }
          this.controls['subtitle-button']?.classList.remove('art-selector-show');
          return SUBTITLE_CONTROL_ICON;
        },
        click: function (_control, event) {
          if (event.target.closest('.art-selector-list')) return;
          const el = this.controls['subtitle-button'];
          if (el) el.classList.toggle('art-selector-show');
        },
      };
    },
    [markSubtitleSwitching, updateSubtitleButtonActive]
  );

  const buildAudioControlConfig = useCallback((tracks, artInstance) => {
    const currentHlsIndex = artInstance?.hls?.audioTrack ?? 0;
    const selector =
      tracks.length > 0
        ? tracks.map((track, idx) => ({
            default: (track.hlsTrackId ?? idx) === currentHlsIndex,
            html: track.label,
            value: track.hlsTrackId ?? track.streamIndex ?? idx,
            hlsTrackId: track.hlsTrackId ?? idx,
            language: track.language,
          }))
        : [{ html: 'Default Audio Track', value: 0, default: true }];

    return {
      name: 'audio',
      position: 'right',
      index: 22,
      html: AUDIO_CONTROL_ICON,
      tooltip: 'Audio Language (Key: B)',
      selector,
      onSelect: function (item) {
        if (this.hls && typeof item.hlsTrackId === 'number') {
          this.hls.audioTrack = item.hlsTrackId;
        }
        if (item.language) {
          writeStorage(SUB_PREF_KEYS.preferredAudioLang, item.language.toLowerCase());
        }
        this.notice.show = `Audio: ${item.html}`;
        this.controls['audio']?.classList.remove('art-selector-show');
        return AUDIO_CONTROL_ICON;
      },
      click: function (_control, event) {
        if (event.target.closest('.art-selector-list')) return;
        const el = this.controls['audio'];
        if (el) el.classList.toggle('art-selector-show');
      },
    };
  }, []);

  const updateSubtitleMenu = useCallback(
    (art, tracks) => {
      if (!art || !tracks || tracks.length === 0) return;
      art.controls.update(buildSubtitleControlConfig(tracks, art));
      updateSubtitleButtonActive(art, Boolean(art.subtitle?.show));
    },
    [buildSubtitleControlConfig, updateSubtitleButtonActive]
  );

  const updateAudioTrackMenu = useCallback(
    (art, tracks) => {
      if (!art || !tracks || tracks.length === 0) return;
      art.controls.update(buildAudioControlConfig(tracks, art));
    },
    [buildAudioControlConfig]
  );

  useEffect(() => {
    if (artRef.current && detectedSubtitles.length > 0) {
      updateSubtitleMenu(artRef.current, detectedSubtitles);
    }
  }, [detectedSubtitles, updateSubtitleMenu]);

  useEffect(() => {
    if (artRef.current && detectedAudioTracks.length > 0) {
      updateAudioTrackMenu(artRef.current, detectedAudioTracks);
    }
  }, [detectedAudioTracks, updateAudioTrackMenu]);

  useEffect(() => {
    if (!containerRef.current) return;

    const isHls = Boolean(
      src && (src.includes('.m3u8') || src.includes('/hls') || src.includes('/stream'))
    );

    const art = new Artplayer({
      container: containerRef.current,
      url: src || '',
      type: isHls ? 'hls' : 'auto',
      theme: '#e5484d',
      volume: 1,
      isLive: false,
      muted: false,
      autoplay: false,
      pip: true,
      autoSize: false,
      autoMini: false,
      screenshot: true,
      setting: true,
      loop: false,
      flip: true,
      playbackRate: true,
      aspectRatio: true,
      fullscreen: true,
      fullscreenWeb: true,
      subtitleOffset: false,
      miniProgressBar: false,
      mutex: true,
      backdrop: false,
      gesture: false,
      playsInline: true,
      autoPlayback: false,
      airplay: true,
      moreVideoAttr: {
        playsInline: true,
        'webkit-playsinline': 'true',
        crossOrigin: 'anonymous',
      },
      subtitle: {
        url: '',
        type: 'vtt',
        style: {
          color: '#ffffff',
          fontSize: '22px',
          textShadow: SHADOW_STYLES.crisp,
          bottom: '50px',
        },
        encoding: 'utf-8',
        escape: false,
        onVttLoad: stripSubtitleFormatting,
      },
      controls: [buildAudioControlConfig([], null), buildSubtitleControlConfig([], null)],
      settings: [...getSubtitleSettingsList()],
      customType: {
        hls: function (video, url, artInstance) {
          if (Hls.isSupported()) {
            const hls = new Hls({
              enableWorker: true,
              lowLatencyMode: false,
              maxBufferLength: 30,
              maxMaxBufferLength: 60,
              fragLoadingTimeOut: 25000,
              fragLoadingMaxRetry: 8,
              fragLoadingRetryDelay: 500,
              nudgeMaxRetry: 10,
            });
            hls.loadSource(url);
            hls.attachMedia(video);
            artInstance.hls = hls;

            const handleAudioTracks = (tracksList) => {
              const rawTracks = tracksList || hls.audioTracks || [];
              if (rawTracks.length > 0) {
                const formatted = rawTracks.map((t, idx) => ({
                  id: `hls-audio-${t.id ?? idx}`,
                  hlsTrackId: t.id ?? idx,
                  label: formatAudioTrackLabel(t, idx),
                  language: t.lang,
                  name: t.name,
                  isDefault: Boolean(t.default),
                }));
                setDetectedAudioTracks(formatted);
              }
            };

            hls.on(Hls.Events.MANIFEST_PARSED, () => {
              if (effectiveDurationRef.current > 0) {
                artInstance.emit('video:progress');
              }
              handleAudioTracks();
            });

            hls.on(Hls.Events.LEVEL_LOADED, (_event, data) => {
              if (effectiveDurationRef.current <= 0 && data?.details?.totalduration > 0) {
                notifyDurationUpdated(data.details.totalduration);
              }
            });

            hls.on(Hls.Events.AUDIO_TRACKS_UPDATED, (_event, data) => {
              handleAudioTracks(data?.audioTracks);
            });

            hls.on(Hls.Events.ERROR, (_event, data) => {
              if (data.fatal) {
                switch (data.type) {
                  case Hls.ErrorTypes.NETWORK_ERROR:
                    hls.startLoad();
                    break;
                  case Hls.ErrorTypes.MEDIA_ERROR:
                    hls.recoverMediaError();
                    break;
                  default:
                    onPlaybackErrorRef.current?.(data, url);
                    hls.destroy();
                    break;
                }
              }
            });
          } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
            video.src = url;
          }
        },
      },
    });

    artRef.current = art;
    patchDurationAccessors(art, effectiveDurationRef);

    const backdropEl = document.createElement('div');
    backdropEl.className = 'art-setting-backdrop';
    backdropEl.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      art.setting.show = false;
      art.setting.render();
    });
    art.template?.$player?.appendChild(backdropEl);

    art.on('setting', (show) => {
      isSettingOpenRef.current = Boolean(show);
    });

    try {
      const noticeProto = Object.getPrototypeOf(art.notice);
      const originalShowDesc = Object.getOwnPropertyDescriptor(noticeProto, 'show');
      if (originalShowDesc) {
        Object.defineProperty(art.notice, 'show', {
          configurable: true,
          enumerable: true,
          get: () => originalShowDesc.get?.call(art.notice) || false,
          set: (msg) => {
            if (typeof msg === 'string' && msg.toLowerCase().includes('aspect ratio')) {
              return;
            }
            originalShowDesc.set?.call(art.notice, msg);
          },
        });
      }
    } catch {}

    art.on('subtitleBeforeUpdate', (activeCues) => {
      if (Array.isArray(activeCues)) {
        for (const cue of activeCues) {
          if (cue && typeof cue.text === 'string') {
            cue.text = stripSubtitleFormatting(cue.text);
          }
        }
      }
    });

    art.on('ready', () => {
      applySubtitleStyles(art);
      if (effectiveDurationRef.current > 0) {
        art.emit('video:progress');
        art.emit('video:durationchange');
      }
      updateSubtitleButtonActive(art, art.subtitle?.show);
      if (pendingInitialTime.current > 0 && !hasInitializedTime.current) {
        isSyncSeekingRef.current = true;
        art.currentTime = pendingInitialTime.current;
        hasInitializedTime.current = true;
        setTimeout(() => {
          isSyncSeekingRef.current = false;
        }, 250);
      }
      if (pendingInitialPlaying.current) {
        art.play().catch(() => {
          art.muted = true;
          setMuted(true);
          setAutoplayMuted(true);
          art.play().catch(() => {});
        });
      }
    });

    const isMobileTouch = () =>
      window.matchMedia('(pointer: coarse)').matches ||
      /Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

    let savedRotate = false;
    const applyPortraitRotateFallback = () => {
      const vw = document.documentElement.clientWidth;
      const vh = document.documentElement.clientHeight;
      const playerEl = art.template?.$player;
      if (playerEl && vw < vh) {
        playerEl.style.width = `${vh}px`;
        playerEl.style.height = `${vw}px`;
        playerEl.style.transformOrigin = '0 0';
        playerEl.style.transform = `rotate(90deg) translate(0, -${vw}px)`;
        playerEl.classList.add('art-auto-orientation');
        art.isRotate = true;
        savedRotate = true;
        art.emit('resize');
      }
    };
    const clearWebRotate = () => {
      const playerEl = art.template?.$player;
      if (!playerEl || !savedRotate) return;
      playerEl.style.width = '';
      playerEl.style.height = '';
      playerEl.style.transformOrigin = '';
      playerEl.style.transform = '';
      playerEl.classList.remove('art-auto-orientation');
      art.isRotate = false;
      savedRotate = false;
      art.emit('resize');
    };

    const enterLandscapeOnMobile = async () => {
      if (!isMobileTouch()) return;
      if (screen.orientation?.lock) {
        try {
          await screen.orientation.lock('landscape-secondary');
          return;
        } catch {
          try {
            await screen.orientation.lock('landscape');
            return;
          } catch {}
        }
      }
      applyPortraitRotateFallback();
    };

    const exitLandscapeOnMobile = () => {
      if (!isMobileTouch()) return;
      try {
        screen.orientation?.unlock?.();
      } catch {}
      clearWebRotate();
    };

    art.on('fullscreen', (isFullscreen) => {
      if (isFullscreen) {
        enterLandscapeOnMobile();
      } else {
        exitLandscapeOnMobile();
      }
    });

    art.on('fullscreenWeb', (isWebFullscreen) => {
      if (isWebFullscreen) {
        enterLandscapeOnMobile();
      } else {
        exitLandscapeOnMobile();
      }
    });

    const videoEl = art.template?.$video;
    const handleViewerVideoClick = (e) => {
      if (!canControlRef.current) {
        e.stopImmediatePropagation();
        e.preventDefault();
        art.controls.show = !art.controls.show;
      }
    };
    if (videoEl) {
      videoEl.addEventListener('click', handleViewerVideoClick, true);
    }

    art.on('video:loadedmetadata', () => {
      if (effectiveDurationRef.current > 0) {
        art.emit('video:progress');
      }
    });

    art.on('video:play', () => {
      if (isRemoteSyncActionRef.current) {
        return;
      }
      if (canControlRef.current) {
        onPlayRef.current?.(art.currentTime);
        return;
      }
      if (!hostPlayingRef.current) {
        art.pause();
        if (Math.abs(art.currentTime - hostPositionRef.current) > 0.25) {
          isSyncSeekingRef.current = true;
          art.currentTime = hostPositionRef.current;
          setTimeout(() => {
            isSyncSeekingRef.current = false;
          }, 250);
        }
        art.notice.show = 'Playback is paused by the host';
        return;
      }
      if (Math.abs(art.currentTime - hostPositionRef.current) > 0.5) {
        isSyncSeekingRef.current = true;
        art.currentTime = hostPositionRef.current;
        setTimeout(() => {
          isSyncSeekingRef.current = false;
        }, 250);
      }
    });

    art.on('video:pause', () => {
      if (isSettingOpenRef.current || isSwitchingSubtitleRef.current || isRemoteSyncActionRef.current) {
        return;
      }
      if (canControlRef.current) {
        onPauseRef.current?.(art.currentTime);
        return;
      }
      if (hostPlayingRef.current && !art.video?.ended) {
        art.play().catch(() => {});
      }
    });

    art.on('video:seeking', () => {
      if (!canControlRef.current && !isSyncSeekingRef.current) {
        if (Math.abs(art.currentTime - hostPositionRef.current) > 0.4) {
          isSyncSeekingRef.current = true;
          art.currentTime = hostPositionRef.current;
          setTimeout(() => {
            isSyncSeekingRef.current = false;
          }, 250);
        }
      }
    });

    art.on('seek', (time) => {
      if (!canControlRef.current) {
        art.notice.show = 'Only the host or an admin can seek';
        return;
      }
      onSeekRef.current?.(time);
    });

    art.on('video:timeupdate', () => {
      onTimeUpdateRef.current?.(art.currentTime);
    });

    art.on('video:volumechange', () => {
      const nextMuted = Boolean(art.muted);
      setMuted((prev) => (prev === nextMuted ? prev : nextMuted));
    });

    return () => {
      clearWebRotate();
      if (videoEl) {
        videoEl.removeEventListener('click', handleViewerVideoClick, true);
      }
      backdropEl.remove();
      if (art.hls) {
        art.hls.destroy();
        art.hls = null;
      }
      art.destroy(false);
      artRef.current = null;
    };
  }, [
    src,
    buildAudioControlConfig,
    buildSubtitleControlConfig,
    updateSubtitleButtonActive,
    notifyDurationUpdated,
  ]);

  useEffect(() => {
    const container = containerRef.current;
    const art = artRef.current;
    if (!art || !container) return;
    container.classList.toggle('viewer-mode', !effectiveCanControl);
    if (art.hotkey?.keys) {
      if (!effectiveCanControl) {
        delete art.hotkey.keys.Space;
        delete art.hotkey.keys.ArrowLeft;
        delete art.hotkey.keys.ArrowRight;
      } else {
        const step = Artplayer.SEEK_STEP || 5;
        if (!art.hotkey.keys.Space) {
          art.hotkey.add('Space', () => art.toggle());
        }
        if (!art.hotkey.keys.ArrowLeft) {
          art.hotkey.add('ArrowLeft', () => {
            art.backward = step;
          });
        }
        if (!art.hotkey.keys.ArrowRight) {
          art.hotkey.add('ArrowRight', () => {
            art.forward = step;
          });
        }
      }
    }
  }, [effectiveCanControl]);

  useEffect(() => {
    const art = artRef.current;
    if (!art || !isHost || !onStreamReady) return;

    const tryCapture = () => {
      if (art.video && art.video.readyState >= 1) {
        const stream = art.video.captureStream
          ? art.video.captureStream()
          : art.video.mozCaptureStream
          ? art.video.mozCaptureStream()
          : null;
        if (stream && stream.getTracks().length > 0) {
          onStreamReady(stream);
        }
      }
    };

    tryCapture();
    art.on('video:loadedmetadata', tryCapture);
    art.on('video:canplay', tryCapture);
    art.on('video:play', tryCapture);

    return () => {
      art.off('video:loadedmetadata', tryCapture);
      art.off('video:canplay', tryCapture);
      art.off('video:play', tryCapture);
    };
  }, [isHost, onStreamReady]);

  useEffect(() => {
    const art = artRef.current;
    if (!art || !streamObject) return;

    art.video.srcObject = streamObject;

    const handleTrackChange = () => {
      art.video.srcObject = new MediaStream(streamObject.getTracks());
      art.play().catch(() => {});
    };

    streamObject.addEventListener('addtrack', handleTrackChange);
    streamObject.addEventListener('removetrack', handleTrackChange);

    art.play().catch(() => {
      art.muted = true;
      setAutoplayMuted(true);
      art.play().catch(() => {});
    });

    return () => {
      streamObject.removeEventListener('addtrack', handleTrackChange);
      streamObject.removeEventListener('removetrack', handleTrackChange);
    };
  }, [streamObject]);

  useEffect(() => {
    if (!isTorrent || !torrentMagnet) return;
    const art = artRef.current;
    if (!art) return;

    let isCancelled = false;
    let client = null;

    if (window.electronAPI?.startTorrent) {
      const removeProgress = window.electronAPI.onTorrentProgress?.((data) => {
        if (isCancelled) return;
        if (!data.hasMetadata) {
          setTorrentStatusText(
            data.numPeers > 0
              ? `Connected to ${data.numPeers} seeder(s) — Finding video metadata...`
              : 'Connecting to BitTorrent swarm...'
          );
        } else {
          const speedKB = (data.downloadSpeed / 1024).toFixed(0);
          setTorrentStatusText(`Buffering from ${data.numPeers} seeder(s) (${speedKB} KB/s)...`);
        }
      });

      const removeError = window.electronAPI.onTorrentError?.((err) => {
        if (isCancelled) return;
        const msg = typeof err === 'string' ? err : err?.message || 'Torrent error occurred';
        if (!msg.includes('reply was never sent') && !msg.includes('Torrent cancelled')) {
          setTorrentError(msg);
        }
      });

      window.electronAPI
        .startTorrent(torrentMagnet)
        .then((data) => {
          if (isCancelled || !data?.streamUrl) return;
          art.switchUrl(data.streamUrl);
        })
        .catch((err) => {
          if (isCancelled) return;
          const msg = err?.message || 'Failed to start torrent stream';
          if (!msg.includes('reply was never sent') && !msg.includes('Torrent cancelled')) {
            setTorrentError(msg);
          }
        });

      return () => {
        isCancelled = true;
        setTorrentStatusText('');
        setTorrentError('');
        removeProgress?.();
        removeError?.();
        window.electronAPI.stopTorrent();
      };
    }

    import('webtorrent/dist/webtorrent.min.js')
      .then((mod) => {
        if (isCancelled) return;
        const WebTorrentClass = mod.default || mod;
        client = new WebTorrentClass();
        client.add(torrentMagnet, (torrent) => {
          if (isCancelled || !art.video) return;
          let largestFile = torrent.files[0];
          for (const file of torrent.files) {
            if (file.length > largestFile.length) {
              largestFile = file;
            }
          }
          largestFile.renderTo(art.video, { autoplay: false }, (err) => {
            if (err) console.error('[WebTorrent] renderTo error:', err);
          });
        });
      })
      .catch((err) => {
        console.error('[WebTorrent] Failed to dynamically load WebTorrent:', err);
      });

    return () => {
      isCancelled = true;
      if (client) {
        client.destroy();
      }
    };
  }, [isTorrent, torrentMagnet]);

  useEffect(() => {
    const art = artRef.current;
    if (!art) return;

    const subUrl =
      subtitleUrl ||
      (typeof window !== 'undefined' ? window.__hostSubtitleUrl : null) ||
      (src && src.includes('.m3u8')
        ? `${src.replace(/\/stream\.m3u8.*$/, '')}/subtitles.vtt`
        : null);

    if (!subUrl) return;

    const controller = new AbortController();
    let cancelled = false;

    fetch(subUrl, { signal: controller.signal })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.text();
      })
      .then((vttContent) => {
        if (cancelled || !vttContent || !vttContent.trim().startsWith('WEBVTT')) return;
        const blobUrl = createVttBlobUrl(vttContent, 'vtt');
        subtitleBlobUrlsRef.current.add(blobUrl);

        const trackItem = {
          id: 'external-hls-sub',
          label: formatSubtitleTrackLabel({ label: 'Subtitles' }, 0),
          blobUrl,
        };

        setDetectedSubtitles((prev) =>
          prev.some((t) => t.id === 'external-hls-sub') ? prev : [trackItem, ...prev]
        );

        markSubtitleSwitching();
        art.subtitle.switch(blobUrl, { type: 'vtt', name: trackItem.label }).catch(() => {});

        const preferredSubLang = readStorage(SUB_PREF_KEYS.preferredSubLang);
        const shouldShow = Boolean(preferredSubLang && preferredSubLang !== 'off');
        art.subtitle.show = shouldShow;
        updateSubtitleButtonActive(art, shouldShow);
        applySubtitleStyles(art);
      })
      .catch(() => {});

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [subtitleUrl, src, markSubtitleSwitching, updateSubtitleButtonActive]);

  useEffect(() => {
    const art = artRef.current;
    if (!art || !window.electronAPI?.findMatchingSubtitles) return;
    const targetPath = videoPath || (typeof window !== 'undefined' ? window.__hostFilePath : null);
    if (!targetPath) return;

    let cancelled = false;

    window.electronAPI
      .findMatchingSubtitles(targetPath)
      .then((matches) => {
        if (cancelled || !matches || matches.length === 0) return;

        const found = matches.map((m, idx) => {
          const blobUrl = createVttBlobUrl(m.content, m.format);
          subtitleBlobUrlsRef.current.add(blobUrl);

          const trackLabel = m.isEmbedded
            ? formatSubtitleTrackLabel(
                {
                  title: m.title,
                  language: m.language,
                  streamIndex: m.streamIndex,
                },
                idx
              )
            : getFriendlySubtitleLabel(m.fileName);

          return {
            id: m.isEmbedded ? `embedded-${m.streamIndex ?? idx}` : `local-${idx}`,
            label: trackLabel,
            language: m.language,
            blobUrl,
          };
        });

        setDetectedSubtitles((prev) => {
          const existingIds = new Set(prev.map((p) => p.id));
          const additions = found.filter((f) => !existingIds.has(f.id));
          return additions.length > 0 ? [...prev, ...additions] : prev;
        });
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [videoPath]);

  useEffect(() => {
    const art = artRef.current;
    if (!art) return;

    const tracksToLoad =
      subtitleTracks || (typeof window !== 'undefined' ? window.__hostSubtitleTracks : null);

    const applyTracks = (list) => {
      if (!list || !Array.isArray(list) || list.length === 0) return;

      const formatted = list.map((t, idx) => ({
        id: t.id || `track-sub-${idx}`,
        label: formatSubtitleTrackLabel(t, idx),
        language: t.language || 'und',
        blobUrl: resolveSubUrl(t.url, src),
        isDefault: Boolean(t.isDefault),
      }));

      setDetectedSubtitles((prev) => {
        const existingIds = new Set(prev.map((p) => p.id));
        const additions = formatted.filter((f) => !existingIds.has(f.id));
        return additions.length > 0 ? [...prev, ...additions] : prev;
      });

      const preferredSubLang = readStorage(SUB_PREF_KEYS.preferredSubLang);
      if (!preferredSubLang || preferredSubLang === 'off') {
        art.subtitle.show = false;
        updateSubtitleButtonActive(art, false);
        return;
      }

      const matchedTrack =
        formatted.find((t) => t.language?.toLowerCase() === preferredSubLang.toLowerCase()) ||
        formatted.find((t) => t.isDefault);

      if (matchedTrack && matchedTrack.blobUrl) {
        markSubtitleSwitching();
        art.subtitle
          .switch(matchedTrack.blobUrl, { type: 'vtt', name: matchedTrack.label })
          .catch(() => {});
        art.subtitle.show = true;
        updateSubtitleButtonActive(art, true);
        applySubtitleStyles(art);
      } else {
        art.subtitle.show = false;
        updateSubtitleButtonActive(art, false);
      }
    };

    if (tracksToLoad && Array.isArray(tracksToLoad) && tracksToLoad.length > 0) {
      applyTracks(tracksToLoad);
      return;
    }

    if (src && src.includes('.m3u8')) {
      const controller = new AbortController();
      let cancelled = false;
      const baseHlsUrl = src.replace(/\/[^/]+\.m3u8(\?.*)?$/, '');

      fetch(`${baseHlsUrl}/subtitles.json`, { signal: controller.signal })
        .then((res) => {
          if (!res.ok) throw new Error();
          return res.json();
        })
        .then((subsList) => {
          if (!cancelled && Array.isArray(subsList) && subsList.length > 0) {
            applyTracks(subsList);
          }
        })
        .catch(() => {});

      return () => {
        cancelled = true;
        controller.abort();
      };
    }
  }, [src, subtitleTracks, markSubtitleSwitching, updateSubtitleButtonActive]);

  useEffect(() => {
    const art = artRef.current;
    if (!art) return;

    const tracksList =
      Array.isArray(initialAudioTracksProp) && initialAudioTracksProp.length > 0
        ? initialAudioTracksProp
        : Array.isArray(window.__hostAudioTracks) && window.__hostAudioTracks.length > 0
        ? window.__hostAudioTracks
        : null;

    if (!tracksList || tracksList.length === 0) return;

    const formatted = tracksList.map((t, idx) => ({
      id: `audio-${t.id ?? idx}`,
      streamIndex: t.streamIndex,
      label: formatAudioTrackLabel(t, idx),
      language: t.language,
      hlsTrackId: idx,
    }));
    setDetectedAudioTracks(formatted);

    const preferredAudioLang = readStorage(SUB_PREF_KEYS.preferredAudioLang);
    if (preferredAudioLang && art.hls) {
      const matchIdx = formatted.findIndex(
        (t) => t.language?.toLowerCase() === preferredAudioLang.toLowerCase()
      );
      if (matchIdx !== -1) {
        art.hls.audioTrack = formatted[matchIdx].hlsTrackId ?? matchIdx;
      }
    }
  }, [initialAudioTracksProp]);

  const handleCustomSubtitleFile = useCallback(
    (file) => {
      if (!file || !artRef.current) return;
      const reader = new FileReader();
      reader.onload = (e) => {
        const content = e.target?.result;
        if (!content || !artRef.current) return;

        const ext = file.name.split('.').pop()?.toLowerCase() || 'srt';
        const blobUrl = createVttBlobUrl(content, ext);
        subtitleBlobUrlsRef.current.add(blobUrl);

        const newTrack = {
          id: `custom-${Date.now()}`,
          label: getFriendlySubtitleLabel(file.name),
          blobUrl,
        };

        setDetectedSubtitles((prev) => [...prev, newTrack]);

        markSubtitleSwitching();
        artRef.current.subtitle
          .switch(blobUrl, { type: 'vtt', name: newTrack.label })
          .catch(() => {});
        artRef.current.subtitle.show = true;
        updateSubtitleButtonActive(artRef.current, true);
        applySubtitleStyles(artRef.current);
        artRef.current.notice.show = `Loaded subtitle: ${newTrack.label}`;
      };
      reader.readAsText(file);
    },
    [markSubtitleSwitching, updateSubtitleButtonActive]
  );

  const handleUnmutePrompt = useCallback(() => {
    const art = artRef.current;
    if (art) {
      art.muted = false;
      setMuted(false);
      setAutoplayMuted(false);
      art.play().catch(() => {});
    }
  }, []);

  const lastHlsKickRef = useRef(0);
  const kickHlsLoad = useCallback((art, targetTime) => {
    if (!art?.hls) return;
    const now = Date.now();
    if (now - lastHlsKickRef.current < 4000) return;
    lastHlsKickRef.current = now;
    art.hls.startLoad(targetTime);
  }, []);

  useImperativeHandle(ref, () => ({
    handleSyncMessage(wsMsg) {
      if (!wsMsg || !artRef.current) return;
      const art = artRef.current;

      const setRateSafe = (rate) => {
        if (Math.abs(art.playbackRate - rate) > 0.001) {
          art.playbackRate = rate;
        }
      };

      const seekSyncSafe = (target) => {
        isSyncSeekingRef.current = true;
        art.currentTime = target;
        setTimeout(() => {
          isSyncSeekingRef.current = false;
        }, 250);
      };

      const markRemoteSyncAction = () => {
        isRemoteSyncActionRef.current = true;
        if (remoteSyncTimerRef.current) {
          clearTimeout(remoteSyncTimerRef.current);
        }
        remoteSyncTimerRef.current = setTimeout(() => {
          isRemoteSyncActionRef.current = false;
        }, 250);
      };

      const pauseSyncSafe = () => {
        markRemoteSyncAction();
        art.pause();
      };

      const playWithMutedFallback = () => {
        markRemoteSyncAction();
        art.play().catch(() => {
          art.muted = true;
          setMuted(true);
          setAutoplayMuted(true);
          markRemoteSyncAction();
          art.play().catch(() => {});
        });
      };

      switch (wsMsg.type) {
        case 'room_state': {
          const roomState = wsMsg.room;
          if (roomState) {
            hostPlayingRef.current = Boolean(roomState.playing);
            hostPositionRef.current = roomState.currentTime || 0;
          }
          if (roomState && !hasInitializedTime.current) {
            const target = roomState.currentTime || 0;
            pendingInitialTime.current = target;
            pendingInitialPlaying.current = Boolean(roomState.playing);
            if (art.video && art.video.readyState >= 1) {
              if (target > 0) {
                seekSyncSafe(target);
              }
              hasInitializedTime.current = true;
              if (roomState.playing) {
                playWithMutedFallback();
              }
            }
          }
          break;
        }

        case 'play': {
          clearTimeout(pendingPauseTimer.current);
          pendingPauseTarget.current = null;
          setHostReconnecting(false);
          hostPlayingRef.current = true;

          const currentAbsolute = art.currentTime;
          const networkLatency = wsMsg.serverTime
            ? Math.max(0, (Date.now() - wsMsg.serverTime) / 1000 / 2)
            : 0;
          const targetTime = (wsMsg.position ?? currentAbsolute) + networkLatency;
          hostPositionRef.current = targetTime;

          if (Math.abs(art.currentTime - targetTime) > 0.4) {
            seekSyncSafe(targetTime);
          }
          setRateSafe(1.0);
          playWithMutedFallback();
          break;
        }

        case 'pause': {
          if (wsMsg.hostDisconnected) {
            setHostReconnecting(true);
          }
          hostPlayingRef.current = false;
          const targetPauseTime = typeof wsMsg.position === 'number' ? wsMsg.position : null;
          if (targetPauseTime !== null) {
            hostPositionRef.current = targetPauseTime;
          }

          const currentAbsolute = art.currentTime;
          const lag = targetPauseTime !== null ? targetPauseTime - currentAbsolute : 0;

          if (targetPauseTime !== null && lag > CATCHUP_THRESHOLD && lag <= CATCHUP_MAX_LAG && !art.video.paused) {
            pendingPauseTarget.current = targetPauseTime;
            setRateSafe(1.0);

            clearTimeout(pendingPauseTimer.current);
            pendingPauseTimer.current = setTimeout(() => {
              if (pendingPauseTarget.current !== null && artRef.current) {
                const snap = pendingPauseTarget.current;
                pendingPauseTarget.current = null;
                markRemoteSyncAction();
                artRef.current.pause();
                seekSyncSafe(snap);
              }
            }, Math.max(500, (lag + 1.5) * 1000));
          } else {
            clearTimeout(pendingPauseTimer.current);
            pendingPauseTarget.current = null;
            pauseSyncSafe();
            if (targetPauseTime !== null && Math.abs(art.currentTime - targetPauseTime) > 0.2) {
              seekSyncSafe(targetPauseTime);
            }
            setRateSafe(1.0);
          }
          break;
        }

        case 'seek': {
          clearTimeout(pendingPauseTimer.current);
          pendingPauseTarget.current = null;
          const target = wsMsg.position ?? 0;
          hostPositionRef.current = target;
          seekSyncSafe(target);
          setRateSafe(1.0);
          if (hostPlayingRef.current && art.video?.paused) {
            playWithMutedFallback();
          }
          break;
        }

        case 'sync_tick': {
          hostPlayingRef.current = Boolean(wsMsg.playing);
          if (typeof wsMsg.position === 'number') {
            hostPositionRef.current = wsMsg.position;
          }
          if (isHostRef.current) break;
          if (pendingPauseTarget.current !== null) break;

          if (!wsMsg.playing) {
            if (!art.video?.paused) {
              art.pause();
            }
            if (
              typeof wsMsg.position === 'number' &&
              Math.abs(art.currentTime - wsMsg.position) > 0.4
            ) {
              seekSyncSafe(wsMsg.position);
            }
            setRateSafe(1.0);
            break;
          }

          if (!art.video) break;

          const currentAbsolute = art.currentTime;
          const networkLatency = wsMsg.serverTime
            ? Math.max(0, (Date.now() - wsMsg.serverTime) / 1000 / 2)
            : 0;
          const expected = (wsMsg.position ?? currentAbsolute) + networkLatency;
          hostPositionRef.current = expected;
          const drift = currentAbsolute - expected;

          if (Math.abs(drift) > HARD_SEEK_THRESHOLD) {
            seekSyncSafe(expected);
            if (art.hls && art.video.readyState < 3) {
              kickHlsLoad(art, expected);
            }
            setRateSafe(1.0);
            if (art.video.paused) {
              playWithMutedFallback();
            }
            break;
          }

          if (art.video.seeking || art.video.readyState < 3) {
            if (art.hls && !art.video.seeking && art.video.readyState < 2) {
              kickHlsLoad(art, expected);
            }
            break;
          }

          if (art.video.paused) {
            playWithMutedFallback();
          }

          if (Math.abs(drift) > CATCHUP_THRESHOLD) {
            setRateSafe(drift > 0 ? 0.95 : 1.05);
          } else {
            setRateSafe(1.0);
          }
          break;
        }

        default:
          break;
      }
    },
  }));

  useEffect(() => {
    const onKeyDown = (e) => {
      const tag = document.activeElement?.tagName?.toLowerCase();
      if (
        tag === 'input' ||
        tag === 'textarea' ||
        tag === 'select' ||
        document.activeElement?.isContentEditable
      ) {
        return;
      }

      const art = artRef.current;
      if (!art) return;

      if (e.code === 'KeyC' && !e.shiftKey) {
        e.preventDefault();
        art.subtitle.show = !art.subtitle.show;
        art.notice.show = art.subtitle.show ? 'Subtitles On' : 'Subtitles Off';
        updateSubtitleButtonActive(art, art.subtitle.show);
        if (!art.subtitle.show) {
          writeStorage(SUB_PREF_KEYS.preferredSubLang, 'off');
        }
        updateSubtitleMenu(art, detectedSubtitlesRef.current);
      } else if (e.code === 'KeyB') {
        e.preventDefault();
        const tracks = art.hls?.audioTracks || detectedAudioTracksRef.current;
        if (tracks.length > 1) {
          const currentIdx = art.hls?.audioTrack ?? 0;
          const nextIdx = (currentIdx + 1) % tracks.length;
          if (art.hls) {
            art.hls.audioTrack = nextIdx;
          }
          const nextTrack = detectedAudioTracksRef.current[nextIdx] || tracks[nextIdx];
          if (nextTrack?.language) {
            writeStorage(SUB_PREF_KEYS.preferredAudioLang, nextTrack.language.toLowerCase());
          }
          const label = formatAudioTrackLabel(nextTrack, nextIdx);
          art.notice.show = `Audio: ${label}`;
          updateAudioTrackMenu(art, detectedAudioTracksRef.current);
        }
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [updateAudioTrackMenu, updateSubtitleMenu, updateSubtitleButtonActive]);

  useEffect(() => {
    const handleDocClick = (e) => {
      if (!e.target.closest('.art-control-selector')) {
        document.querySelectorAll('.art-control-selector.art-selector-show').forEach((el) => {
          el.classList.remove('art-selector-show');
        });
      }
    };
    document.addEventListener('click', handleDocClick);
    return () => document.removeEventListener('click', handleDocClick);
  }, []);

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', backgroundColor: '#000' }}>
      <div
        ref={containerRef}
        style={{ width: '100%', height: '100%' }}
        onClick={() => {
          if (autoplayMuted) {
            handleUnmutePrompt();
          }
        }}
      />

      {isP2P && (
        <div className="player-p2p-badge" title="Direct WebRTC P2P stream">
          <Wifi size={13} />
          <span>
            {isHost ? `P2P (${p2pStatus?.viewersCount || 0} connected)` : 'P2P Connected'}
          </span>
        </div>
      )}

      {hostReconnecting && (
        <div className="player-reconnect-badge">
          <ShieldAlert size={14} color="var(--warning)" />
          <span>Host disconnected — waiting to resume</span>
        </div>
      )}

      {isTorrent && torrentStatusText && (
        <div className="player-torrent-status">
          <span>{torrentStatusText}</span>
        </div>
      )}

      {isTorrent && torrentError && (
        <div className="player-torrent-error">
          <ShieldAlert size={14} />
          <span>{torrentError}</span>
        </div>
      )}

      {autoplayMuted && muted && (
        <button
          type="button"
          className="player-unmute-banner"
          onClick={handleUnmutePrompt}
          title="Click to unmute video"
        >
          <VolumeX size={15} />
          <span>Audio muted — click to unmute</span>
        </button>
      )}

      <input
        type="file"
        ref={hiddenSubFileInputRef}
        accept=".srt,.vtt"
        style={{ display: 'none' }}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) {
            handleCustomSubtitleFile(file);
          }
          e.target.value = '';
        }}
      />
    </div>
  );
});

export default memo(VideoPlayer);
