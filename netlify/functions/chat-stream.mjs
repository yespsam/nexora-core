import chatHandler from './chat.mjs';
import { verifyChatGrant } from './_shared/chat-grant.mjs';

function runtimeEnv(name) {
  try {
    const value = globalThis.Netlify?.env?.get?.(name);
    if (value) return String(value);
  } catch (error) {
    // The Netlify runtime global is unavailable in ordinary Node processes.
  }
  return String(process.env[name] || '');
}

function signingSecret() {
  return runtimeEnv('LLM_API_KEY') || runtimeEnv('MOONSHOT_API_KEY');
}

function json(body, status) {
  return Response.json(body, {
    status,
    headers: {
      'Cache-Control': 'private, no-store, max-age=0',
      'X-Content-Type-Options': 'nosniff'
    }
  });
}

export function createChatStreamHandler({
  secret = '',
  respond = chatHandler
} = {}) {
  return async function chatStream(request) {
    if (request.method !== 'POST') return json({ error: 'method not allowed' }, 405);
    const declaredLength = Number(request.headers.get('content-length') || 0);
    if (declaredLength > 32_768) return json({ error: 'payload too large' }, 413);
    const token = String(request.headers.get('x-nexora-chat-grant') || '').slice(0, 1200);
    let payload;
    try {
      payload = await request.clone().json();
    } catch (error) {
      return json({ error: 'invalid json' }, 400);
    }
    const activeSecret = secret || signingSecret();
    if (!verifyChatGrant(token, payload?.client_release, activeSecret)) {
      return json({ error: 'invalid_chat_grant' }, 401);
    }
    return respond(request);
  };
}

export default createChatStreamHandler();

export const config = {
  path: '/api/chat/stream',
  method: ['POST'],
  rateLimit: {
    windowLimit: 20,
    windowSize: 60,
    aggregateBy: ['ip', 'domain']
  }
};
