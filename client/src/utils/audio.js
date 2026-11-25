const LANGUAGE_NAMES = {
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
  tr: 'Turkish',
  tur: 'Turkish',
  nl: 'Dutch',
  nld: 'Dutch',
  dut: 'Dutch',
  sv: 'Swedish',
  swe: 'Swedish',
  pl: 'Polish',
  pol: 'Polish',
  vi: 'Vietnamese',
  vie: 'Vietnamese',
  th: 'Thai',
  tha: 'Thai',
  id: 'Indonesian',
  ind: 'Indonesian',
  uk: 'Ukrainian',
  ukr: 'Ukrainian',
  fa: 'Persian',
  fas: 'Persian',
  per: 'Persian',
  he: 'Hebrew',
  heb: 'Hebrew',
  cs: 'Czech',
  ces: 'Czech',
  cze: 'Czech',
  el: 'Greek',
  ell: 'Greek',
  gre: 'Greek',
  ro: 'Romanian',
  ron: 'Romanian',
  rum: 'Romanian',
  hu: 'Hungarian',
  hun: 'Hungarian',
  da: 'Danish',
  dan: 'Danish',
  fi: 'Finnish',
  fin: 'Finnish',
  no: 'Norwegian',
  nor: 'Norwegian',
  bn: 'Bengali',
  ben: 'Bengali',
  ta: 'Tamil',
  tam: 'Tamil',
  te: 'Telugu',
  tel: 'Telugu',
  mr: 'Marathi',
  mar: 'Marathi',
  ur: 'Urdu',
  urd: 'Urdu',
};

export function getLanguageName(code) {
  if (!code) return null;
  const clean = code.toLowerCase().trim();
  return LANGUAGE_NAMES[clean] || null;
}

export function formatAudioTrackLabel(track, fallbackIndex = 0) {
  if (!track) return `Audio Track ${fallbackIndex + 1}`;

  const langCode = (track.lang || track.language || '').toLowerCase().trim();
  const langName = getLanguageName(langCode);

  const rawName = (track.name || track.label || track.title || '').trim();
  const isGenericName = !rawName || /^audio[_\s-]*\d+$/i.test(rawName) || /^track[_\s-]*\d+$/i.test(rawName);

  if (rawName && !isGenericName) {
    if (langName && !rawName.toLowerCase().includes(langName.toLowerCase())) {
      return `${langName} — ${rawName}`;
    }
    return rawName;
  }

  if (langName) {
    return langName;
  }

  if (langCode && langCode !== 'und') {
    return `Language: ${langCode.toUpperCase()}`;
  }

  return `Audio Track ${fallbackIndex + 1}`;
}
