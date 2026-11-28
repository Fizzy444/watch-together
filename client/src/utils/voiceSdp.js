const SPEAKING_LEVEL_THRESHOLD = 8;

export function optimizeOpusSdp(sdp) {
  if (typeof sdp !== 'string' || !sdp) return sdp;

  const lines = sdp.split('\r\n');
  let opusPayloadType = null;

  for (const line of lines) {
    const match = line.match(/^a=rtpmap:(\d+)\s+opus\/48000/i);
    if (match) {
      opusPayloadType = match[1];
      break;
    }
  }

  if (!opusPayloadType) return sdp;

  const desiredParams = {
    minptime: '10',
    useinbandfec: '1',
    maxaveragebitrate: '64000',
    stereo: '0',
    'sprop-stereo': '0',
  };

  const fmtpPrefix = `a=fmtp:${opusPayloadType} `;
  let foundFmtp = false;

  const updatedLines = lines.map((line) => {
    if (!line.startsWith(fmtpPrefix)) return line;
    foundFmtp = true;
    const existingBody = line.slice(fmtpPrefix.length).trim();
    const paramMap = new Map();
    if (existingBody) {
      for (const pair of existingBody.split(';')) {
        const trimmed = pair.trim();
        if (!trimmed) continue;
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx === -1) {
          paramMap.set(trimmed, null);
        } else {
          paramMap.set(trimmed.slice(0, eqIdx).trim(), trimmed.slice(eqIdx + 1).trim());
        }
      }
    }
    for (const [key, value] of Object.entries(desiredParams)) {
      paramMap.set(key, value);
    }
    const serialized = Array.from(paramMap.entries())
      .map(([k, v]) => (v === null ? k : `${k}=${v}`))
      .join(';');
    return `${fmtpPrefix}${serialized}`;
  });

  if (!foundFmtp) {
    const rtpmapPrefix = `a=rtpmap:${opusPayloadType} `;
    const rtpmapIdx = updatedLines.findIndex((line) => line.startsWith(rtpmapPrefix));
    if (rtpmapIdx !== -1) {
      const serialized = Object.entries(desiredParams)
        .map(([k, v]) => `${k}=${v}`)
        .join(';');
      updatedLines.splice(rtpmapIdx + 1, 0, `${fmtpPrefix}${serialized}`);
    }
  }

  return updatedLines.join('\r\n');
}

export function computeAudioLevelPercent(analyser, buffer) {
  if (!analyser || !buffer) return 0;
  analyser.getByteTimeDomainData(buffer);
  let sumSquares = 0;
  for (let i = 0; i < buffer.length; i++) {
    const centered = (buffer[i] - 128) / 128;
    sumSquares += centered * centered;
  }
  const rms = Math.sqrt(sumSquares / buffer.length);
  return Math.min(100, Math.round(rms * 320));
}

export function isLevelSpeaking(levelPercent, threshold = SPEAKING_LEVEL_THRESHOLD) {
  return levelPercent >= threshold;
}
