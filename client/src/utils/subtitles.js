/**
 * Subtitle Processing Utilities
 * Converts SRT to WebVTT and creates browser-compatible text track blob URLs.
 */

/**
 * Convert SubRip (.srt) subtitle string to valid WebVTT (.vtt) format.
 * @param {string} srtText
 * @returns {string} WebVTT formatted text
 */
export function srtToVtt(srtText) {
  if (!srtText || typeof srtText !== 'string') return 'WEBVTT\n\n';

  // Normalize line breaks
  let text = srtText.replace(/\r\n|\r/g, '\n').trim();

  // If already WebVTT, return as-is
  if (text.startsWith('WEBVTT')) {
    return text;
  }

  // Remove byte order mark (BOM) if present
  text = text.replace(/^\uFEFF/, '');

  // Convert SRT comma decimals to WebVTT period decimals in timestamps
  // Matches: 00:00:00,000 --> 00:00:00,000
  text = text.replace(
    /(\d{2}:\d{2}:\d{2}),(\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2}),(\d{3})/g,
    '$1.$2 --> $3.$4'
  );

  // Also handle 2-part timestamps (e.g. 00:00,000 --> 00:00,000)
  text = text.replace(
    /(?:^|\n)(\d{2}:\d{2}),(\d{3})\s*-->\s*(\d{2}:\d{2}),(\d{3})/g,
    '\n00:$1.$2 --> 00:$3.$4'
  );

  // Strip unneeded legacy font tags
  text = text.replace(/<font[^>]*>/gi, '').replace(/<\/font>/gi, '');

  return `WEBVTT\n\n${text}\n`;
}

/**
 * Creates a Blob URL for a subtitle file (.srt or .vtt).
 * @param {string} content Subtitle text
 * @param {string} format 'srt' | 'vtt'
 * @returns {string} Object URL pointing to text/vtt
 */
export function createVttBlobUrl(content, format = 'vtt') {
  const vttContent = format.toLowerCase() === 'srt' || !content.trim().startsWith('WEBVTT')
    ? srtToVtt(content)
    : content;
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
