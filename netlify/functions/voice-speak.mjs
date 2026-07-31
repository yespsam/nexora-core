import { Constants, EdgeTTS } from '@andresaya/edge-tts';
import { jsonResponse, resolveVoice } from './voice-data.mjs';

const outputFormat = Constants.OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3
  || 'audio-24khz-96kbitrate-mono-mp3';

export function prepareSpeechText(value) {
  const text = String(value || '')
    .replace(/https?:\/\/\S+/gi, '一个链接')
    .replace(/[<>&]/g, '')
    .replace(/[*_`#]/g, '')
    .replace(/(?:\r?\n)+/g, '。')
    .replace(/[“”"「」『』]/g, '')
    .replace(/[：:]/g, '，')
    .replace(/[；;]/g, '。')
    .replace(/[—–-]{2,}/g, '，')
    .replace(/\.{3,}|…+/g, '。')
    .replace(/\s+/g, ' ')
    .replace(/\s*([，。！？])\s*/g, '$1')
    .replace(/([，。！？])(?:\s*\1)+/g, '$1')
    .trim()
    .slice(0, 300);
  if (!text || /[。！？]$/.test(text)) return text;
  return `${text}。`;
}

function offsetValue(value, delta, suffix) {
  const base = Number.parseFloat(String(value || '0').replace(suffix, '')) || 0;
  const result = Math.round(base + delta);
  return `${result >= 0 ? '+' : ''}${result}${suffix}`;
}

export function voiceProsody(cast, mood = '') {
  const normalizedMood = String(mood || '').toLowerCase();
  const calm = /calm|gentle|comfort|sad|concern|warm/.test(normalizedMood);
  const lively = /happy|excited|joy|playful/.test(normalizedMood);
  const rateDelta = calm ? -1 : lively ? 1 : 0;
  return {
    rate: offsetValue(cast.rate, rateDelta, '%'),
    pitch: offsetValue(cast.pitch, 0, 'Hz'),
    volume: '96%'
  };
}

async function synthesize(text, cast, mood) {
  const prosody = voiceProsody(cast, mood);
  const tts = new EdgeTTS();
  await tts.synthesize(text, cast.voice, {
    outputFormat,
    ...prosody
  });
  return tts.toBuffer();
}

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return jsonResponse({ error: 'method not allowed' }, 405);
  }

  let payload;
  try {
    payload = JSON.parse(event.body || '{}');
  } catch (error) {
    return jsonResponse({ error: 'invalid json' }, 400);
  }

  const text = prepareSpeechText(payload.text);
  if (!text) {
    return jsonResponse({ error: 'missing text' }, 400);
  }

  const cast = resolveVoice(
    payload.persona,
    payload.archetype || payload.voice || '',
    payload.starter || ''
  );
  const startedAt = Date.now();
  try {
    let buffer;
    let lastError;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        buffer = await synthesize(text, cast, payload.mood);
        break;
      } catch (error) {
        lastError = error;
        if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 250));
      }
    }
    if (!buffer) throw lastError;
    console.info(JSON.stringify({
      event: 'voice_synthesis_result',
      status: 'ok',
      voice: cast.voice,
      archetype: cast.archetype || 'default',
      mood: String(payload.mood || 'neutral').slice(0, 24),
      duration_ms: Date.now() - startedAt,
      bytes: buffer.length
    }));
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'audio/mpeg',
        'Cache-Control': 'no-store',
        'X-Nexora-Voice': cast.voice,
        'X-Nexora-Archetype': cast.archetype || 'default',
        'X-Nexora-Audio-Quality': '24khz-96kbps',
        'X-Nexora-Voice-Profile': 'natural-v2'
      },
      body: buffer.toString('base64'),
      isBase64Encoded: true
    };
  } catch (error) {
    console.warn(JSON.stringify({
      event: 'voice_synthesis_result',
      status: 'error',
      voice: cast.voice,
      archetype: cast.archetype || 'default',
      duration_ms: Date.now() - startedAt,
      failure: String(error?.name || 'synthesis_failed').slice(0, 48)
    }));
    return jsonResponse({
      enabled: false,
      error: `voice synthesis failed: ${error.message || error}`,
      cast
    }, 502);
  }
};
