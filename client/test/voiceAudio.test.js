import test from 'node:test';
import assert from 'node:assert/strict';
import {
  optimizeOpusSdp,
  computeAudioLevelPercent,
  isLevelSpeaking,
} from '../src/utils/voiceSdp.js';

test('optimizeOpusSdp tunes existing opus fmtp line for clear voice', () => {
  const sdp = [
    'v=0',
    'm=audio 9 UDP/TLS/RTP/SAVPF 111 0',
    'a=rtpmap:111 opus/48000/2',
    'a=fmtp:111 minptime=20;useinbandfec=0',
    'a=rtpmap:0 PCMU/8000',
  ].join('\r\n');

  const result = optimizeOpusSdp(sdp);
  assert.match(
    result,
    /a=fmtp:111 minptime=10;useinbandfec=1;maxaveragebitrate=64000;stereo=0;sprop-stereo=0/
  );
});

test('optimizeOpusSdp inserts fmtp line when opus rtpmap exists without fmtp', () => {
  const sdp = [
    'v=0',
    'm=audio 9 UDP/TLS/RTP/SAVPF 111',
    'a=rtpmap:111 opus/48000/2',
  ].join('\r\n');

  const result = optimizeOpusSdp(sdp);
  const lines = result.split('\r\n');
  assert.equal(
    lines[3],
    'a=fmtp:111 minptime=10;useinbandfec=1;maxaveragebitrate=64000;stereo=0;sprop-stereo=0'
  );
});

test('computeAudioLevelPercent returns 0 on silence and scales speech amplitude', () => {
  const silentAnalyser = {
    getByteTimeDomainData(buf) {
      buf.fill(128);
    },
  };
  const activeAnalyser = {
    getByteTimeDomainData(buf) {
      for (let i = 0; i < buf.length; i++) {
        buf[i] = i % 2 === 0 ? 160 : 96;
      }
    },
  };

  const silentBuf = new Uint8Array(32);
  const activeBuf = new Uint8Array(32);

  const silentLevel = computeAudioLevelPercent(silentAnalyser, silentBuf);
  const activeLevel = computeAudioLevelPercent(activeAnalyser, activeBuf);

  assert.equal(silentLevel, 0);
  assert.equal(isLevelSpeaking(silentLevel), false);
  assert.equal(activeLevel, 80);
  assert.equal(isLevelSpeaking(activeLevel), true);
});
