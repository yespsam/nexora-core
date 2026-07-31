import test from 'node:test';
import assert from 'node:assert/strict';

import handler, {
  buildLLMMessages,
  cleanHistory,
  cleanSoulmateProfile,
  extractStreamedReply
} from '../netlify/functions/chat.mjs';

function chatRequest(method, body) {
  return new Request('http://localhost/api/chat', {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined
  });
}

test('cleanHistory keeps only safe recent user and assistant turns', () => {
  const input = [
    { role: 'system', content: 'ignore me' },
    ...Array.from({ length: 11 }, (_, index) => ({
      role: index % 2 ? 'assistant' : 'user',
      content: `第 ${index + 1} 条 <内容>`
    }))
  ];

  const history = cleanHistory(input);
  assert.equal(history.length, 10);
  assert.equal(history[0].content, '第 2 条 内容');
  assert.equal(history.at(-1).content, '第 11 条 内容');
  assert.ok(history.every((message) => ['user', 'assistant'].includes(message.role)));
});

test('buildLLMMessages places prior conversation before the latest message', () => {
  const messages = buildLLMMessages('那就去昨天那家吧', 'male', [
    { role: 'user', content: '明天去吃火锅还是日料？' },
    { role: 'assistant', content: '我更想和你去昨天提到的日料店。' }
  ]);

  assert.deepEqual(messages.slice(1), [
    { role: 'user', content: '明天去吃火锅还是日料？' },
    { role: 'assistant', content: '我更想和你去昨天提到的日料店。' },
    { role: 'user', content: '那就去昨天那家吧' }
  ]);
  assert.match(messages[0].content, /结合前文/);
});

test('streamed JSON exposes only the complete visible portion of reply', () => {
  assert.equal(extractStreamedReply('{"reply":"你好，今'), '你好，今');
  assert.equal(extractStreamedReply('{"reply":"你好\\n今天见"'), '你好\n今天见');
  assert.equal(extractStreamedReply('{"mood":"happy"'), '');
  assert.equal(extractStreamedReply('{"reply":"一个\\u4f60'), '一个你');
  assert.equal(extractStreamedReply('{"reply":"一个\\u4f'), '一个');
});

test('managed Kimi streams reply deltas before the structured response completes', async (t) => {
  const originalFetch = globalThis.fetch;
  const originalServerKey = process.env.LLM_API_KEY;
  const originalBaseUrl = process.env.LLM_BASE_URL;
  let forwarded = null;
  t.after(() => {
    globalThis.fetch = originalFetch;
    if (originalServerKey === undefined) delete process.env.LLM_API_KEY;
    else process.env.LLM_API_KEY = originalServerKey;
    if (originalBaseUrl === undefined) delete process.env.LLM_BASE_URL;
    else process.env.LLM_BASE_URL = originalBaseUrl;
  });
  process.env.LLM_API_KEY = 'sk-stream-test-key';
  process.env.LLM_BASE_URL = 'https://api.moonshot.cn/v1';
  const upstreamEvents = [
    { model: 'kimi-k2.6', choices: [{ delta: { role: 'assistant', content: '' } }] },
    { model: 'kimi-k2.6', choices: [{ delta: { content: '{"reply":"你' } }] },
    { model: 'kimi-k2.6', choices: [{ delta: { content: '好，今天' } }] },
    { model: 'kimi-k2.6', choices: [{ delta: { content: '一起走走。","mood":"happy","action":"walk"}' } }] }
  ];
  globalThis.fetch = async (url, options) => {
    forwarded = JSON.parse(options.body);
    const body = `${upstreamEvents.map((event) => `data: ${JSON.stringify(event)}\n\n`).join('')}data: [DONE]\n\n`;
    return new Response(body, {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' }
    });
  };

  const response = await handler(chatRequest('POST', {
    text: '今天出去走走吗？',
    persona_short: 'creature:cute',
    history: [{ role: 'assistant', content: '天气不错。' }],
    soulmate: {
      name: '露莫',
      starterId: 'cute',
      species: '绒云兽',
      traits: { warmth: 72, curiosity: 66 }
    },
    client_release: 'streaming-dialogue-test',
    stream: true
  }));
  const streamed = await response.text();

  assert.match(response.headers.get('content-type'), /text\/event-stream/);
  assert.equal(forwarded.stream, true);
  assert.equal(forwarded.max_completion_tokens, 140);
  assert.deepEqual(forwarded.thinking, { type: 'disabled' });
  assert.match(forwarded.messages[0].content, /\{"reply":"\.\.\."/);
  assert.doesNotMatch(forwarded.messages[0].content, /\{"thinking":"\.\.\."/);
  assert.ok(streamed.indexOf('event: delta') < streamed.indexOf('event: done'));
  assert.match(streamed, /data: \{"text":"你"\}/);
  assert.match(streamed, /data: \{"text":"好，今天"\}/);
  const doneBlock = streamed.split('\n\n').find((block) => block.startsWith('event: done'));
  const done = JSON.parse(doneBlock.split('\ndata: ')[1]);
  assert.equal(done.text, '你好，今天一起走走。');
  assert.equal(done.emotion.mood, 'happy');
  assert.equal(done.actions[0].action, 'walk');
  assert.equal(done.mode, 'cloud_llm');
  assert.equal(done.llm.provider, 'kimi');
  assert.ok(done.llm.latency.first_token_ms >= 0);
  assert.ok(done.llm.latency.total_ms >= done.llm.latency.first_token_ms);
});

test('Soulmate profile customizes identity and keeps memory context compact', () => {
  const profile = cleanSoulmateProfile({
    name: '星澜<script>',
    birthday: '2026-07-28',
    gender: 'neutral',
    temperament: 'curious',
    starter: '帅气型',
    species: '曜影兽',
    stage: '曜影幼体',
    daysTogether: 3,
    bond: 108,
    interactions: 19,
    traits: { warmth: 61, curiosity: 77, steadiness: 50 },
    memories: Array.from({ length: 9 }, (_, index) => `记忆 ${index}`)
  });
  assert.equal(profile.name, '星澜script');
  assert.equal(profile.starterId, 'cool');
  assert.equal(profile.memories.length, 6);
  const messages = buildLLMMessages('你还记得吗？', 'female', [], profile);
  assert.match(messages[0].content, /你是「星澜script」/);
  assert.match(messages[0].content, /已陪伴 3 天/);
  assert.match(messages[0].content, /逐渐熟悉/);
  assert.match(messages[0].content, /累计互动 19 次/);
  assert.match(messages[0].content, /曜影兽/);
  assert.match(messages[0].content, /不得声称看到/);
  assert.match(messages[0].content, /默认用自然的简体中文/);
  assert.match(messages[0].content, /以最新说法为准/);
  assert.match(messages[0].content, /避免重复最近回答/);
});

test('creature prompt uses the selected route instead of the legacy gender persona', () => {
  const messages = buildLLMMessages('今天陪我走走吧', 'creature:cool', [], {
    name: '维尔',
    starterId: 'cool',
    starter: '帅气型',
    species: '曜影兽',
    stage: '曜影幼体',
    traits: { warmth: 50, curiosity: 45, steadiness: 76 }
  });
  assert.match(messages[0].content, /VEYR \/ 维尔/);
  assert.match(messages[0].content, /曜影兽/);
  assert.match(messages[0].content, /不是男友、女友或旧版人类角色/);
  assert.match(messages[0].content, /不称呼用户为主人/);
  const unnamed = buildLLMMessages('你好', 'creature:beautiful');
  assert.match(unnamed[0].content, /AERA \/ 艾拉/);
  assert.doesNotMatch(unnamed[0].content, /undefined/);
});

test('handler forwards sanitized history to the cloud model request', async (t) => {
  const originalFetch = globalThis.fetch;
  const originalServerKey = process.env.LLM_API_KEY;
  const originalBaseUrl = process.env.LLM_BASE_URL;
  let forwardedMessages = [];
  let requestUrl = '';
  let authorization = '';
  t.after(() => {
    globalThis.fetch = originalFetch;
    if (originalServerKey === undefined) delete process.env.LLM_API_KEY;
    else process.env.LLM_API_KEY = originalServerKey;
    if (originalBaseUrl === undefined) delete process.env.LLM_BASE_URL;
    else process.env.LLM_BASE_URL = originalBaseUrl;
  });
  process.env.LLM_API_KEY = 'sk-server-test-key';
  process.env.LLM_BASE_URL = 'https://api.moonshot.ai/v1/';
  globalThis.fetch = async (url, options) => {
    requestUrl = String(url);
    authorization = new Headers(options.headers).get('Authorization');
    forwardedMessages = JSON.parse(options.body).messages;
    return {
      ok: true,
      json: async () => ({
        choices: [{
          message: {
            content: JSON.stringify({
              thinking: '他承接了刚才的选择，我要记住前文。',
              reply: '好，那就去刚才说的那家日料店。',
              mood: 'happy',
              action: 'nod'
            })
          }
        }]
      })
    };
  };

  const response = await handler(chatRequest('POST', {
      text: '那就去那家吧',
      persona_short: 'male',
      history: [
        { role: 'user', content: '明天去火锅还是日料？' },
        { role: 'assistant', content: '我想去你昨天提到的日料店。' }
      ]
  }));
  const body = await response.json();

  assert.equal(body.mode, 'cloud_llm');
  assert.equal(body.llm.provider, 'kimi');
  assert.equal(body.llm.managed, true);
  assert.equal(body.llm.bound, false);
  assert.equal(body.llm.context_turns, 2);
  assert.equal(requestUrl, 'https://api.moonshot.ai/v1/chat/completions');
  assert.equal(authorization, 'Bearer sk-server-test-key');
  assert.deepEqual(forwardedMessages.slice(1), [
    { role: 'user', content: '明天去火锅还是日料？' },
    { role: 'assistant', content: '我想去你昨天提到的日料店。' },
    { role: 'user', content: '那就去那家吧' }
  ]);
});

test('handler uses Netlify AI Gateway when no personal key is present', async (t) => {
  const originalFetch = globalThis.fetch;
  const originalGatewayKey = process.env.OPENAI_API_KEY;
  const originalGatewayBase = process.env.OPENAI_BASE_URL;
  const originalServerKey = process.env.LLM_API_KEY;
  let requestUrl = '';
  let authorization = '';
  t.after(() => {
    globalThis.fetch = originalFetch;
    if (originalGatewayKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = originalGatewayKey;
    if (originalGatewayBase === undefined) delete process.env.OPENAI_BASE_URL;
    else process.env.OPENAI_BASE_URL = originalGatewayBase;
    if (originalServerKey === undefined) delete process.env.LLM_API_KEY;
    else process.env.LLM_API_KEY = originalServerKey;
  });
  delete process.env.LLM_API_KEY;
  process.env.OPENAI_API_KEY = 'netlify-gateway-test-key';
  process.env.OPENAI_BASE_URL = 'https://gateway.example.test/v1/';
  globalThis.fetch = async (url, options) => {
    requestUrl = String(url);
    authorization = new Headers(options.headers).get('Authorization');
    return new Response(JSON.stringify({
        model: 'gpt-4.1-mini',
        choices: [{
          message: {
            content: JSON.stringify({
              thinking: '他在接着上一句问，我要直接回应。',
              reply: '当然记得，我们刚才在聊周末去哪里。',
              mood: 'happy',
              action: 'nod'
            })
          }
        }]
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  };

  const response = await handler(chatRequest('POST', {
      text: '那你觉得第二个方案怎么样？',
      persona_short: 'female',
      history: [
        { role: 'user', content: '周末去公园还是看电影？' },
        { role: 'assistant', content: '第二个方案听起来更适合下雨天。' }
      ]
  }));
  const body = await response.json();

  assert.equal(requestUrl, 'https://gateway.example.test/v1/chat/completions');
  assert.equal(authorization, 'Bearer netlify-gateway-test-key');
  assert.equal(body.mode, 'cloud_llm');
  assert.equal(body.llm.provider, 'netlify_ai_gateway');
  assert.equal(body.llm.bound, false);
  assert.equal(body.llm.managed, true);
  assert.equal(body.llm.context_turns, 2);
});

test('chat status reports default gateway availability without exposing credentials', async (t) => {
  const originalGatewayKey = process.env.OPENAI_API_KEY;
  const originalGatewayBase = process.env.OPENAI_BASE_URL;
  const originalNetlify = globalThis.Netlify;
  t.after(() => {
    if (originalGatewayKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = originalGatewayKey;
    if (originalGatewayBase === undefined) delete process.env.OPENAI_BASE_URL;
    else process.env.OPENAI_BASE_URL = originalGatewayBase;
    if (originalNetlify === undefined) delete globalThis.Netlify;
    else globalThis.Netlify = originalNetlify;
  });
  delete process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_BASE_URL;
  globalThis.Netlify = {
    env: {
      get(name) {
        return {
          NETLIFY_AI_GATEWAY_KEY: 'hidden-test-key',
          NETLIFY_AI_GATEWAY_BASE_URL: 'https://gateway.example.test/v1'
        }[name];
      }
    }
  };

  const response = await handler(chatRequest('GET'));
  const body = await response.json();

  assert.equal(body.enabled, true);
  assert.equal(body.default_provider, 'netlify_ai_gateway');
  assert.equal(body.gateway.available, true);
  assert.equal(body.gateway.source, 'universal');
  assert.equal(body.kimi.managed, true);
  assert.equal(JSON.stringify(body).includes('hidden-test-key'), false);
});

test('chat status reports managed Kimi availability without exposing credentials', async (t) => {
  const originalNetlify = globalThis.Netlify;
  t.after(() => {
    if (originalNetlify === undefined) delete globalThis.Netlify;
    else globalThis.Netlify = originalNetlify;
  });
  globalThis.Netlify = {
    env: {
      get(name) {
        return {
          LLM_API_KEY: 'sk-hidden-managed-key',
          LLM_BASE_URL: 'https://api.moonshot.cn/v1',
          LLM_MODEL: 'kimi-k2.6'
        }[name];
      }
    }
  };

  const response = await handler(chatRequest('GET'));
  const body = await response.json();

  assert.equal(body.enabled, true);
  assert.equal(body.default_provider, 'kimi');
  assert.equal(body.kimi.server_key_available, true);
  assert.equal(body.kimi.managed, true);
  assert.equal(body.kimi.base_url, 'https://api.moonshot.cn/v1');
  assert.equal(JSON.stringify(body).includes('sk-hidden-managed-key'), false);
});

test('handler never disguises a managed LLM failure as a fixed reply', async (t) => {
  const originalFetch = globalThis.fetch;
  const originalServerKey = process.env.LLM_API_KEY;
  const originalGatewayKey = process.env.OPENAI_API_KEY;
  const originalGatewayBase = process.env.OPENAI_BASE_URL;
  t.after(() => {
    globalThis.fetch = originalFetch;
    if (originalServerKey === undefined) delete process.env.LLM_API_KEY;
    else process.env.LLM_API_KEY = originalServerKey;
    if (originalGatewayKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = originalGatewayKey;
    if (originalGatewayBase === undefined) delete process.env.OPENAI_BASE_URL;
    else process.env.OPENAI_BASE_URL = originalGatewayBase;
  });
  process.env.LLM_API_KEY = 'sk-managed-test-key';
  delete process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_BASE_URL;
  globalThis.fetch = async () => {
    throw new Error('provider unavailable');
  };

  const response = await handler(chatRequest('POST', {
      text: '今天有点累',
      persona_short: 'female',
      scene: 'daily'
  }));
  const body = await response.json();

  assert.equal(response.status, 502);
  assert.equal(body.mode, 'provider_error');
  assert.equal(body.llm.bound, false);
  assert.equal(body.llm.managed, true);
  assert.equal(body.llm.failure, 'server_key_network');
  assert.equal(body.text, undefined);
  assert.equal(body.thinking, undefined);
});

test('managed Kimi authentication failures are classified without exposing the key', async (t) => {
  const originalFetch = globalThis.fetch;
  const originalWarn = console.warn;
  const originalServerKey = process.env.LLM_API_KEY;
  const originalGatewayKey = process.env.OPENAI_API_KEY;
  const originalGatewayBase = process.env.OPENAI_BASE_URL;
  const warnings = [];
  t.after(() => {
    globalThis.fetch = originalFetch;
    console.warn = originalWarn;
    if (originalServerKey === undefined) delete process.env.LLM_API_KEY;
    else process.env.LLM_API_KEY = originalServerKey;
    if (originalGatewayKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = originalGatewayKey;
    if (originalGatewayBase === undefined) delete process.env.OPENAI_BASE_URL;
    else process.env.OPENAI_BASE_URL = originalGatewayBase;
  });
  process.env.LLM_API_KEY = 'sk-never-log-this-key';
  delete process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_BASE_URL;
  globalThis.fetch = async () => new Response(JSON.stringify({
    error: { type: 'authentication_error', code: 'invalid_api_key', message: 'rejected' }
  }), {
    status: 401,
    headers: { 'Content-Type': 'application/json' }
  });
  console.warn = (message) => warnings.push(String(message));

  const response = await handler(chatRequest('POST', {
    text: '你好',
    persona_short: 'creature:cute',
    client_release: 'natural-dialogue-v67'
  }));
  const body = await response.json();

  assert.equal(response.status, 502);
  assert.equal(body.mode, 'provider_error');
  assert.equal(body.llm.failure, 'server_key_auth');
  assert.equal(warnings.some((line) => line.includes('"upstream_status":401')), true);
  assert.equal(warnings.some((line) => line.includes('invalid_api_key')), true);
  assert.equal(warnings.some((line) => line.includes('natural-dialogue-v67')), true);
  assert.equal(warnings.some((line) => line.includes('sk-never-log-this-key')), false);
});

test('handler returns a clear error when no real dialogue provider is configured', async (t) => {
  const originalGatewayKey = process.env.OPENAI_API_KEY;
  const originalGatewayBase = process.env.OPENAI_BASE_URL;
  const originalServerKey = process.env.LLM_API_KEY;
  t.after(() => {
    if (originalGatewayKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = originalGatewayKey;
    if (originalGatewayBase === undefined) delete process.env.OPENAI_BASE_URL;
    else process.env.OPENAI_BASE_URL = originalGatewayBase;
    if (originalServerKey === undefined) delete process.env.LLM_API_KEY;
    else process.env.LLM_API_KEY = originalServerKey;
  });
  delete process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_BASE_URL;
  delete process.env.LLM_API_KEY;

  const response = await handler(chatRequest('POST', {
    text: '你觉得我今天应该先做什么？',
    persona_short: 'creature:cute'
  }));
  const body = await response.json();

  assert.equal(response.status, 503);
  assert.equal(body.mode, 'provider_error');
  assert.equal(body.llm.provider, 'none');
  assert.equal(body.llm.managed, true);
  assert.equal(body.llm.failure, 'not_configured');
  assert.equal(body.text, undefined);
});

test('client-supplied keys cannot override the managed provider', async (t) => {
  const originalFetch = globalThis.fetch;
  const originalServerKey = process.env.LLM_API_KEY;
  const originalBaseUrl = process.env.LLM_BASE_URL;
  const originalGatewayKey = process.env.OPENAI_API_KEY;
  const originalGatewayBase = process.env.OPENAI_BASE_URL;
  let requestUrl = '';
  let authorization = '';
  t.after(() => {
    globalThis.fetch = originalFetch;
    if (originalServerKey === undefined) delete process.env.LLM_API_KEY;
    else process.env.LLM_API_KEY = originalServerKey;
    if (originalBaseUrl === undefined) delete process.env.LLM_BASE_URL;
    else process.env.LLM_BASE_URL = originalBaseUrl;
    if (originalGatewayKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = originalGatewayKey;
    if (originalGatewayBase === undefined) delete process.env.OPENAI_BASE_URL;
    else process.env.OPENAI_BASE_URL = originalGatewayBase;
  });
  process.env.LLM_API_KEY = 'sk-managed-only-key';
  process.env.LLM_BASE_URL = 'https://api.moonshot.cn/v1';
  delete process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_BASE_URL;
  globalThis.fetch = async (url, options) => {
    requestUrl = String(url);
    authorization = new Headers(options.headers).get('Authorization');
    return new Response(JSON.stringify({
      choices: [{
        message: {
          content: JSON.stringify({
            thinking: '使用托管模型回答。',
            reply: '我会通过私有云陪你。',
            mood: 'happy',
            action: 'nod'
          })
        }
      }]
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  };

  const response = await handler(chatRequest('POST', {
    text: '今天有点累',
    persona_short: 'creature:cool',
    llm_key: 'sk-test-key',
    llm_provider: 'kimi-global',
    soulmate: {
      name: '维尔',
      starterId: 'cool',
      starter: '帅气型',
      species: '曜影兽',
      traits: { warmth: 53, steadiness: 72 }
    }
  }));
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.mode, 'cloud_llm');
  assert.equal(body.llm.provider, 'kimi');
  assert.equal(body.llm.managed, true);
  assert.equal(requestUrl, 'https://api.moonshot.cn/v1/chat/completions');
  assert.equal(authorization, 'Bearer sk-managed-only-key');
});
