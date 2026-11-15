/**
 * Subtitle Processing Utilities
 * Converts SRT to WebVTT and creates browser-compatible text track blob URLs.
 */

/**
 * Convert SubRip (.srt) subtitle string to valid WebVTT (.vtt) format.
 * @param {string} srtText
 * @returns {string} WebVTT formatted text
 */
function shiftTimestamp(timestampString, offsetSeconds) {
  const parts = timestampString.split(':');
  let seconds = 0;
  if (parts.length === 3) {
    seconds = parseInt(parts[0], 10) * 3600 + parseInt(parts[1], 10) * 60 + parseFloat(parts[2]);
  } else if (parts.length === 2) {
    seconds = parseInt(parts[0], 10) * 60 + parseFloat(parts[1]);
  }
  const shifted = Math.max(0, seconds - offsetSeconds);
  const hours = Math.floor(shifted / 3600);
  const minutes = Math.floor((shifted % 3600) / 60);
  const secs = (shifted % 60).toFixed(3);
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${secs.padStart(6, '0')}`;
}

export function srtToVtt(srtText, offsetSeconds = 0) {
  if (!srtText || typeof srtText !== 'string') return 'WEBVTT\n\n';

  let text = srtText.replace(/\r\n|\r/g, '\n').trim();
  text = text.replace(/^\uFEFF/, '');

  if (text.startsWith('WEBVTT')) {
    text = text.replace(/^WEBVTT[^\n]*\n+/, '');
  }

  text = text.replace(
    /(\d{2}:\d{2}:\d{2}),(\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2}),(\d{3})/g,
    '$1.$2 --> $3.$4'
  );

  text = text.replace(
    /(?:^|\n)(\d{2}:\d{2}),(\d{3})\s*-->\s*(\d{2}:\d{2}),(\d{3})/g,
    '\n00:$1.$2 --> 00:$3.$4'
  );

  if (offsetSeconds !== 0) {
    text = text.replace(
      /(\d{2}:\d{2}:\d{2}\.\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2}\.\d{3})/g,
      (_match, startStr, endStr) => `${shiftTimestamp(startStr, offsetSeconds)} --> ${shiftTimestamp(endStr, offsetSeconds)}`
    );
  }

  text = text.replace(/<font[^>]*>/gi, '').replace(/<\/font>/gi, '');

  return `WEBVTT\n\n${text}\n`;
}

export function createVttBlobUrl(content, format = 'vtt', offsetSeconds = 0) {
  const vttContent = srtToVtt(content, offsetSeconds);
  const blob = new Blob([vttContent], { type: 'text/vtt;charset=utf-8' });
  return URL.createObjectURL(blob);
}

/**
 * Parses language code or returns clean user-friendly label from subtitle filename.
 * @param {string} filename e.g. "Inception.en.srt"
 * @returns {string} e.g. "English (Inception.en.srt)"
 */
export function getFriendlySubtitleLabel(filename) {
  if (!filename) return 'Subtitle';
  const cleanName = filename.replace(/\.[^/.]+$/, '');
  const parts = cleanName.split(/[._-]/);
  const lastPart = parts[parts.length - 1].toLowerCase();

  const LANG_MAP = {
    en: 'English',
    eng: 'English',
    es: 'Spanish',
    spa: 'Spanish',
    fr: 'French',
    fra: 'French',
    fre: 'French',
    de: 'German',
    ger: 'German',
    deu: 'German',
    it: 'Italian',
    ita: 'Italian',
    pt: 'Portuguese',
    por: 'Portuguese',
    ru: 'Russian',
    rus: 'Russian',
    ja: 'Japanese',
    jpn: 'Japanese',
    zh: 'Chinese',
    chi: 'Chinese',
    zho: 'Chinese',
    hi: 'Hindi',
    hin: 'Hindi',
    ko: 'Korean',
    kor: 'Korean',
    ar: 'Arabic',
    ara: 'Arabic',
  };

  if (LANG_MAP[lastPart]) {
    return `${LANG_MAP[lastPart]} (${filename})`;
  }

  return filename;
}
