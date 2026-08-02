import { Constants, EdgeTTS } from '@andresaya/edge-tts';
import { resolveVoice } from './voice-data.mjs';

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

async function* synthesizeChunks(text, cast, mood) {
  const prosody = voiceProsody(cast, mood);
  const tts = new EdgeTTS();
  yield* tts.synthesizeStream(text, cast.voice, {
    outputFormat,
    ...prosody
  });
}

export function createVoiceReadableStream(text, cast, mood, {
  synthesizeVoice = synthesizeChunks,
  retryDelayMs = 250,
  onComplete = () => {},
  onError = () => {}
} = {}) {
  let cancelled = false;
  return new ReadableStream({
    start(controller) {
      void (async () => {
        let sentBytes = 0;
        let firstChunkMs = 0;
        let lastError;
        const startedAt = Date.now();
        for (let attempt = 0; attempt < 2; attempt += 1) {
          try {
            for await (const chunk of synthesizeVoice(text, cast, mood)) {
              if (cancelled) return;
              const bytes = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk);
              if (!bytes.byteLength) continue;
              if (!firstChunkMs) firstChunkMs = Date.now() - startedAt;
              sentBytes += bytes.byteLength;
              controller.enqueue(bytes);
            }
            if (cancelled) return;
            controller.close();
            onComplete({
              durationMs: Date.now() - startedAt,
              firstChunkMs,
              bytes: sentBytes
            });
            return;
          } catch (error) {
            lastError = error;
            if (sentBytes > 0 || attempt > 0) break;
            await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
          }
        }
        if (cancelled) return;
        onError({
          durationMs: Date.now() - startedAt,
          firstChunkMs,
          bytes: sentBytes,
          error: lastError
        });
        controller.error(lastError || new Error('voice synthesis failed'));
      })();
    },
    cancel() {
      cancelled = true;
    }
  });
}

function responseHeaders(cast) {
  return {
    'Content-Type': 'audio/mpeg',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'X-Nexora-Voice': cast.voice,
    'X-Nexora-Archetype': cast.archetype || 'default',
    'X-Nexora-Audio-Quality': '24khz-48kbps-stream',
    'X-Nexora-Voice-Profile': 'natural-v3-stream'
  };
}

export async function createVoiceResponse(payload) {
  const text = prepareSpeechText(payload.text);
  if (!text) {
    return Response.json({ error: 'missing text' }, { status: 400 });
  }

  const cast = resolveVoice(
    payload.persona,
    payload.archetype || payload.voice || '',
    payload.starter || ''
  );
  const stream = createVoiceReadableStream(text, cast, payload.mood, {
    onComplete({ durationMs, firstChunkMs, bytes }) {
      console.info(JSON.stringify({
        event: 'voice_synthesis_result',
        status: 'ok',
        voice: cast.voice,
        archetype: cast.archetype || 'default',
        mood: String(payload.mood || 'neutral').slice(0, 24),
        first_chunk_ms: firstChunkMs,
        duration_ms: durationMs,
        bytes
      }));
    },
    onError({ durationMs, firstChunkMs, bytes, error }) {
      console.warn(JSON.stringify({
        event: 'voice_synthesis_result',
        status: 'error',
        voice: cast.voice,
        archetype: cast.archetype || 'default',
        first_chunk_ms: firstChunkMs,
        duration_ms: durationMs,
        bytes,
        failure: String(error?.name || 'synthesis_failed').slice(0, 48)
      }));
    }
  });
  return new Response(stream, {
    status: 200,
    headers: responseHeaders(cast)
  });
}

export default async function voiceSpeak(request) {
  if (request.method !== 'POST') {
    return Response.json({ error: 'method not allowed' }, { status: 405 });
  }

  let payload;
  try {
    payload = await request.json();
  } catch (error) {
    return Response.json({ error: 'invalid json' }, { status: 400 });
  }
  return createVoiceResponse(payload);
}
