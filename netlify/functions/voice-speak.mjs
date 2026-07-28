import { Constants, EdgeTTS } from '@andresaya/edge-tts';
import { jsonResponse, resolveVoice } from './voice-data.mjs';

const outputFormat = Constants.OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3
  || 'audio-24khz-48kbitrate-mono-mp3';

function cleanText(value) {
  return String(value || '')
    .replace(/[<>&]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 300);
}

async function synthesize(text, cast) {
  const tts = new EdgeTTS();
  await tts.synthesize(text, cast.voice, {
    outputFormat,
    rate: cast.rate,
    pitch: cast.pitch,
    volume: '90%'
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

  const text = cleanText(payload.text);
  if (!text) {
    return jsonResponse({ error: 'missing text' }, 400);
  }

  const cast = resolveVoice(
    payload.persona,
    payload.archetype || payload.voice || '',
    payload.starter || ''
  );
  try {
    let buffer;
    let lastError;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        buffer = await synthesize(text, cast);
        break;
      } catch (error) {
        lastError = error;
        if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 250));
      }
    }
    if (!buffer) throw lastError;
    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'audio/mpeg',
        'Cache-Control': 'no-store',
        'X-Qiban-Voice': cast.voice,
        'X-Qiban-Archetype': cast.archetype || 'default'
      },
      body: buffer.toString('base64'),
      isBase64Encoded: true
    };
  } catch (error) {
    return jsonResponse({
      enabled: false,
      error: `voice synthesis failed: ${error.message || error}`,
      cast
    }, 502);
  }
};
