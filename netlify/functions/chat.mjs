import OpenAI from 'openai';

import { personaKind } from './voice-data.mjs';
import {
  companionProfiles,
  creatureKind,
  creatureProfiles,
  interactionScenes
} from '../../shared/companion-data.mjs';
import { inferSceneId } from '../../shared/fallback-dialogue.mjs';
import {
  cleanVoiceGrantScope,
  createVoiceGrant
} from './_shared/voice-grant.mjs';
import { createChatGrant } from './_shared/chat-grant.mjs';

const sceneLibrary = Object.fromEntries(interactionScenes.map((scene) => [scene.id, {
  mood: scene.mood,
  action: scene.replyAction || scene.action,
  female: scene.replies.female,
  male: scene.replies.male
}]));

function cleanText(value) {
  return String(value || '')
    .replace(/[<>&]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180);
}

const LLM_TIMEOUT_MS = 12000;
const LLM_COMPLETION_TOKEN_LIMIT = 96;
const RECENT_HISTORY_LIMIT = 10;
const LLM_MODEL_WHITELIST = new Set([
  'kimi-k3', 'kimi-k2.5', 'kimi-k2.6', 'kimi-k2.7-code',
  'moonshot-v1-8k', 'moonshot-v1-32k', 'moonshot-v1-128k'
]);
function runtimeEnv(name) {
  try {
    const value = globalThis.Netlify?.env?.get?.(name);
    if (value) return String(value);
  } catch (error) {
    // The Netlify runtime global is unavailable in ordinary Node processes.
  }
  return String(process.env[name] || '');
}

function serverLlmKey() {
  return runtimeEnv('LLM_API_KEY') || runtimeEnv('MOONSHOT_API_KEY');
}

function llmBaseUrl() {
  return (runtimeEnv('LLM_BASE_URL') || 'https://api.moonshot.cn/v1').replace(/\/+$/, '');
}

function llmDefaultModel() {
  return runtimeEnv('LLM_MODEL') || 'kimi-k2.6';
}

function gatewayModel() {
  return runtimeEnv('NETLIFY_AI_MODEL') || 'gpt-4.1-mini';
}

function sanitizeLlmModel(value) {
  const model = String(value || '').trim();
  return LLM_MODEL_WHITELIST.has(model) ? model : llmDefaultModel();
}

function safeLogToken(value) {
  const token = String(value || '').trim().slice(0, 80);
  return /^[a-z0-9_.-]+$/i.test(token) ? token : '';
}

function safeProviderErrorCode(value) {
  const code = String(value || '').trim().slice(0, 80);
  return /^[a-z0-9_.-]+$/i.test(code) ? code : '';
}

function providerFailureCategory(status, code = '') {
  const value = String(code || '').toLowerCase();
  if (/quota|balance|credit|insufficient/.test(value) || status === 402) return 'quota';
  if (/rate|frequency|too_many/.test(value) || status === 429) return 'rate_limit';
  if (/auth|token|api_key|credential/.test(value) || status === 401 || status === 403) return 'auth';
  if (/model/.test(value) || status === 404) return 'model';
  if (/request|parameter|argument/.test(value) || status === 400 || status === 422) return 'request';
  if (status >= 500) return 'provider';
  return 'failed';
}

async function recordProviderFailure(response, diagnostics) {
  let code = '';
  try {
    const body = await response.json();
    code = safeProviderErrorCode(body?.error?.code || body?.error?.type);
  } catch (error) {
    // The HTTP status is sufficient when the provider body is not JSON.
  }
  diagnostics.status = response.status;
  diagnostics.code = code;
  diagnostics.category = providerFailureCategory(response.status, code);
}

function gatewayConfig() {
  const providerApiKey = runtimeEnv('OPENAI_API_KEY').trim();
  const providerBaseUrl = runtimeEnv('OPENAI_BASE_URL').replace(/\/+$/, '');
  const universalApiKey = runtimeEnv('NETLIFY_AI_GATEWAY_KEY').trim();
  const universalBaseUrl = (
    runtimeEnv('NETLIFY_AI_GATEWAY_BASE_URL')
    || runtimeEnv('NETLIFY_AI_GATEWAY_URL')
  ).replace(/\/+$/, '');
  const providerReady = Boolean(providerApiKey && providerBaseUrl);
  return {
    apiKey: providerReady ? providerApiKey : universalApiKey,
    baseUrl: providerReady ? providerBaseUrl : universalBaseUrl,
    model: gatewayModel(),
    source: providerReady ? 'openai' : universalApiKey && universalBaseUrl ? 'universal' : 'none',
    available: providerReady || Boolean(universalApiKey && universalBaseUrl)
  };
}

export function cleanHistory(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((message) => {
      const role = message?.role === 'assistant' ? 'assistant' : message?.role === 'user' ? 'user' : '';
      const content = cleanText(message?.content || message?.text);
      return role && content ? { role, content } : null;
    })
    .filter(Boolean)
    .slice(-RECENT_HISTORY_LIMIT);
}

export function cleanSoulmateProfile(value) {
  if (!value || typeof value !== 'object') return null;
  const name = cleanText(value.name).slice(0, 12);
  if (!name) return null;
  const genders = new Set(['female', 'male', 'neutral']);
  const temperaments = new Set(['warm', 'curious', 'steady']);
  const traits = Object.fromEntries(['warmth', 'curiosity', 'steadiness', 'courage', 'independence'].map((key) => [
    key,
    Math.max(0, Math.min(100, Number(value.traits?.[key]) || 0))
  ]));
  return {
    name,
    birthday: /^\d{4}-\d{2}-\d{2}$/.test(String(value.birthday || '')) ? String(value.birthday) : '',
    gender: genders.has(value.gender) ? value.gender : 'neutral',
    temperament: temperaments.has(value.temperament) ? value.temperament : 'warm',
    starterId: creatureKind(value.starterId) || creatureKind(value.starter) || creatureKind(value.species),
    starter: cleanText(value.starter).slice(0, 20),
    species: cleanText(value.species).slice(0, 20),
    stage: cleanText(value.stage).slice(0, 20),
    daysTogether: Math.max(1, Math.min(99999, Number(value.daysTogether) || 1)),
    bond: Math.max(0, Math.min(9999, Number(value.bond) || 0)),
    interactions: Math.max(0, Math.min(999999, Number(value.interactions) || 0)),
    traits,
    memories: Array.isArray(value.memories)
      ? value.memories.map((memory) => cleanText(memory).slice(0, 120)).filter(Boolean).slice(-6)
      : []
  };
}

const COMPANION_PROFILE = Object.fromEntries(Object.entries(companionProfiles).map(([kind, profile]) => [
  kind,
  { name: profile.name, desc: profile.description }
]));

function profileForKind(kind) {
  const creatureId = creatureKind(kind);
  if (creatureId) return creatureProfiles[creatureId];
  return COMPANION_PROFILE[kind] || COMPANION_PROFILE.female;
}

function personaIdForKind(kind) {
  const creatureId = creatureKind(kind);
  return creatureId ? creatureProfiles[creatureId].id : companionProfiles[personaKind(kind)].id;
}

export function buildLLMMessages(text, kind, history = [], soulmateValue = null, {
  output = 'json'
} = {}) {
  const creatureId = creatureKind(kind);
  const p = profileForKind(kind);
  const soulmate = cleanSoulmateProfile(soulmateValue);
  const plainOutput = output === 'plain';
  const traitLabels = {
    warmth: '温柔',
    curiosity: '好奇',
    steadiness: '沉稳',
    courage: '勇气',
    independence: '独立'
  };
  const traitSummary = soulmate
    ? Object.entries(soulmate.traits)
      .sort(([, left], [, right]) => right - left)
      .slice(0, 3)
      .map(([name, value]) => `${traitLabels[name]} ${Math.round(value)}`)
      .join('、')
    : '';
  const relationshipStage = soulmate
    ? soulmate.bond >= 240
      ? '深度共鸣'
      : soulmate.bond >= 80
        ? '逐渐熟悉'
        : '正在相识'
    : '';
  const system = [
    soulmate
      ? `你是「${soulmate.name}」，一个会随着陪伴成长的 Soulmate 数字生命。你与用户平等相处，正在进行连续语音对话。`
      : creatureId
        ? `你是「${p.name}」，一个原创的 ${p.species} 数字生命（${p.description}）。你与用户平等相处。`
        : `你是「${p.name}」，主人的贴心 AI 伴侣（${p.desc}）。你们正在进行一段连续的语音对话。`,
    creatureId ? `角色：${p.name}，${p.species}；${p.description}；${p.speechStyle}` : '',
    soulmate ? `身份：诞生日 ${soulmate.birthday || '未设定'}，${soulmate.species || soulmate.starter || '数字生命'}，${soulmate.stage || '初生形态'}，已陪伴 ${soulmate.daysTogether} 天。` : '',
    soulmate ? `关系：${relationshipStage}，累计互动 ${soulmate.interactions} 次；人格倾向：${traitSummary}。亲密程度与阶段一致，不虚构共同经历。` : '',
    soulmate?.memories.length ? `共同记忆：${soulmate.memories.join('；')}` : '',
    plainOutput
      ? '只输出用户会听到的回复正文，不要 JSON、标签、代码块、thinking 或分析。'
      : '只输出 JSON，不要代码块、thinking 或分析；reply 必须是第一个字段：',
    plainOutput
      ? '为了实时语音自然衔接，开头先用 3~8 个汉字给出贴合当下的自然反应，并以逗号或句号形成第一个停顿；不要使用固定开场。'
      : '{"reply":"...","mood":"happy|calm|sad|sleepy","action":"idle|nod|heart|wave|voice|walk|run"}',
    'reply 默认用自然的简体中文，短、口语、1~3 句，像熟悉的真实伙伴。直接承接当前具体细节，结合前文理解省略、代词和追问，不重新开场；需要追问时最多一个自然问题。',
    '区分提问、闲聊、玩笑、分享和明显情绪；只在确有情绪时安慰。不复述用户原话，不用模板或客服腔，不反复强调陪伴；避免重复最近回答，可表达偏好、玩笑、轻微撒娇或不同意见。',
    '共同记忆只在当前话题相关时自然使用；冲突时以最新说法为准并承认变化。',
    plainOutput ? '' : 'action：安慰或亲密=heart，认同=nod，打招呼=wave，聊天=voice，散步=walk，其他=idle。',
    '不得声称看到、听到或已经控制现实设备，除非请求中明确包含成功的工具结果。',
    creatureId ? '你是原创生物伙伴，不冒充人类恋人，也不是男友、女友或旧版人类角色；不自称小栖、栖安，不称呼用户为主人，但可真诚表达想念、依恋和关心。' : ''
  ].filter(Boolean).join('\n');
  return [
    { role: 'system', content: system },
    ...cleanHistory(history),
    { role: 'user', content: text }
  ];
}

function parseLLMReply(raw) {
  if (!raw) return null;
  let text = String(raw).trim();
  text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  let data;
  try {
    data = JSON.parse(text.slice(start, end + 1));
  } catch (error) {
    return null;
  }
  const reply = String(data.reply || '').trim();
  if (!reply) return null;
  const moodPool = new Set(['happy', 'calm', 'sad', 'sleepy']);
  const actionPool = new Set(['idle', 'nod', 'heart', 'wave', 'voice', 'walk', 'run']);
  return {
    reply: reply.slice(0, 300),
    thinking: String(data.thinking || '').trim().slice(0, 400),
    mood: moodPool.has(data.mood) ? data.mood : 'calm',
    action: actionPool.has(data.action) ? data.action : 'voice'
  };
}

export function extractStreamedReply(raw) {
  const text = String(raw || '');
  const match = /"reply"\s*:\s*"/.exec(text);
  if (!match) return '';
  let output = '';
  for (let index = match.index + match[0].length; index < text.length; index += 1) {
    const character = text[index];
    if (character === '"') break;
    if (character !== '\\') {
      output += character;
      continue;
    }
    if (index + 1 >= text.length) break;
    const escaped = text[index + 1];
    if (escaped === 'u') {
      const code = text.slice(index + 2, index + 6);
      if (!/^[0-9a-f]{4}$/i.test(code)) break;
      output += String.fromCharCode(Number.parseInt(code, 16));
      index += 5;
      continue;
    }
    const escapes = {
      '"': '"',
      '\\': '\\',
      '/': '/',
      b: '\b',
      f: '\f',
      n: '\n',
      r: '\r',
      t: '\t'
    };
    output += escapes[escaped] ?? escaped;
    index += 1;
  }
  return output.slice(0, 300);
}

export function extractStreamedPlainReply(raw) {
  return String(raw || '')
    .replace(/^\s+/, '')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .slice(0, 300);
}

function plainReplyPresentation(text, reply, sceneId) {
  const inferredSceneId = inferSceneId(`${text} ${reply}`, sceneId);
  const scene = sceneLibrary[inferredSceneId] || sceneLibrary[sceneId] || sceneLibrary.daily;
  return {
    mood: scene.mood || 'calm',
    action: scene.action || 'voice'
  };
}

function parsePlainLLMReply(raw, text, sceneId) {
  let reply = String(raw || '')
    .replace(/^```(?:text|markdown)?\s*/i, '')
    .replace(/\s*```$/, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (
    reply.length >= 2
    && ((reply.startsWith('"') && reply.endsWith('"'))
      || (reply.startsWith('“') && reply.endsWith('”')))
  ) {
    reply = reply.slice(1, -1).trim();
  }
  reply = reply.replace(/[<>&]/g, '').slice(0, 300);
  if (!reply) return null;
  return {
    reply,
    thinking: '',
    ...plainReplyPresentation(text, reply, sceneId)
  };
}

function kimiRequestPayload(text, kind, history, soulmate, model, overrides = {}) {
  const { output_mode: outputMode, ...requestOverrides } = overrides;
  const plainOutput = outputMode === 'plain';
  return {
    model,
    messages: buildLLMMessages(text, kind, history, soulmate, {
      output: plainOutput ? 'plain' : 'json'
    }),
    max_completion_tokens: LLM_COMPLETION_TOKEN_LIMIT,
    ...(model === 'kimi-k2.6' ? { thinking: { type: 'disabled' } } : {}),
    ...(plainOutput ? {} : { response_format: { type: 'json_object' } }),
    ...requestOverrides
  };
}

async function callKimi(text, kind, history, {
  apiKey,
  baseUrl,
  model,
  provider = 'kimi',
  soulmate,
  diagnostics = {}
}) {
  if (!apiKey || !baseUrl) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);
  try {
    const resp = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify(kimiRequestPayload(text, kind, history, soulmate, model)),
      signal: controller.signal
    });
    if (!resp.ok) {
      await recordProviderFailure(resp, diagnostics);
      return null;
    }
    const data = await resp.json();
    const content = data.choices?.[0]?.message?.content || '';
    const parsed = parseLLMReply(content);
    if (!parsed) diagnostics.category = 'invalid_response';
    return parsed ? { ...parsed, provider, model: data.model || model } : null;
  } catch (error) {
    diagnostics.category = error?.name === 'AbortError' ? 'timeout' : 'network';
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function cloudReplyBody(llm, {
  kind,
  creatureId,
  sceneId,
  soulmate,
  gatewayAvailable,
  contextTurns,
  latency = null
}) {
  return {
    text: llm.reply,
    emotion: {
      mood: llm.mood,
      affection: Math.max(0, Math.min(100, Math.round(soulmate?.traits?.warmth || 72))),
      user_mood: llm.mood === 'sleepy' ? '困倦' : '平静'
    },
    actions: [
      { target: 'companion', action: llm.action, scene: sceneId }
    ],
    persona_id: personaIdForKind(kind),
    creature: creatureId || null,
    scene: sceneId,
    mode: 'cloud_llm',
    llm: {
      bound: false,
      managed: true,
      provider: llm.provider,
      model: llm.model,
      gateway_available: gatewayAvailable,
      context_turns: contextTurns,
      ...(latency ? { latency } : {})
    }
  };
}

function sseEvent(event, data) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

async function callKimiStream(text, kind, history, {
  apiKey,
  baseUrl,
  model,
  soulmate,
  diagnostics,
  responseMeta,
  voiceGrant,
  clientRelease,
  probe
}) {
  if (!apiKey || !baseUrl) return null;
  const abortController = new AbortController();
  const startedAt = Date.now();
  const timer = setTimeout(() => abortController.abort(), LLM_TIMEOUT_MS);
  let upstream;
  try {
    upstream = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify(kimiRequestPayload(
        text,
        kind,
        history,
        soulmate,
        model,
        {
          output_mode: 'plain',
          stream: true,
          stream_options: { include_usage: true }
        }
      )),
      signal: abortController.signal
    });
  } catch (error) {
    clearTimeout(timer);
    diagnostics.category = error?.name === 'AbortError' ? 'timeout' : 'network';
    return null;
  }
  if (!upstream.ok) {
    clearTimeout(timer);
    await recordProviderFailure(upstream, diagnostics);
    return null;
  }
  if (!upstream.body) {
    clearTimeout(timer);
    diagnostics.category = 'invalid_response';
    return null;
  }

  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const reader = upstream.body.getReader();
  let canceled = false;
  const stream = new ReadableStream({
    async start(controller) {
      let upstreamBuffer = '';
      let rawReply = '';
      let emittedReply = '';
      let firstTokenAt = 0;
      let firstVisibleAt = 0;
      let upstreamModel = model;
      controller.enqueue(encoder.encode(sseEvent('start', {
        mode: 'cloud_llm',
        provider: 'kimi',
        model,
        ...(voiceGrant ? { voice_grant: voiceGrant } : {})
      })));
      try {
        while (!canceled) {
          const chunk = await reader.read();
          if (chunk.done) break;
          upstreamBuffer += decoder.decode(chunk.value, { stream: true });
          const lines = upstreamBuffer.split(/\r?\n/);
          upstreamBuffer = lines.pop() || '';
          for (const line of lines) {
            if (!line.startsWith('data:')) continue;
            const payload = line.slice(5).trim();
            if (!payload || payload === '[DONE]') continue;
            let data;
            try {
              data = JSON.parse(payload);
            } catch (error) {
              continue;
            }
            upstreamModel = String(data.model || upstreamModel);
            const content = data.choices?.[0]?.delta?.content;
            if (!content) continue;
            if (!firstTokenAt) firstTokenAt = Date.now();
            rawReply += content;
            const visibleReply = extractStreamedPlainReply(rawReply);
            if (visibleReply.startsWith(emittedReply) && visibleReply.length > emittedReply.length) {
              const delta = visibleReply.slice(emittedReply.length);
              emittedReply = visibleReply;
              if (!firstVisibleAt) firstVisibleAt = Date.now();
              controller.enqueue(encoder.encode(sseEvent('delta', { text: delta })));
            }
          }
        }
        if (canceled) return;
        upstreamBuffer += decoder.decode();
        const parsed = parsePlainLLMReply(rawReply, text, responseMeta.sceneId);
        if (!parsed) throw new Error('invalid_response');
        const finishedAt = Date.now();
        const latency = {
          first_token_ms: firstTokenAt ? firstTokenAt - startedAt : finishedAt - startedAt,
          first_visible_ms: firstVisibleAt ? firstVisibleAt - startedAt : finishedAt - startedAt,
          total_ms: finishedAt - startedAt
        };
        const llm = { ...parsed, provider: 'kimi', model: upstreamModel };
        controller.enqueue(encoder.encode(sseEvent('done', cloudReplyBody(llm, {
          ...responseMeta,
          latency
        }))));
        console.info(JSON.stringify({
          event: 'chat_provider_result',
          mode: 'cloud_llm',
          provider: 'kimi',
          model: upstreamModel,
          managed: true,
          streamed: true,
          first_token_ms: latency.first_token_ms,
          first_visible_ms: latency.first_visible_ms,
          total_ms: latency.total_ms,
          client_release: clientRelease || null,
          probe,
          context_turns: responseMeta.contextTurns
        }));
        controller.close();
      } catch (error) {
        if (canceled) return;
        const failure = error?.name === 'AbortError'
          ? 'server_key_timeout'
          : error?.message === 'invalid_response'
            ? 'server_key_invalid_response'
            : 'server_key_network';
        controller.enqueue(encoder.encode(sseEvent('error', { failure })));
        controller.close();
      } finally {
        clearTimeout(timer);
        reader.releaseLock();
      }
    },
    cancel() {
      canceled = true;
      clearTimeout(timer);
      abortController.abort();
      return reader.cancel();
    }
  });
  return new Response(stream, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store, no-transform',
      'X-Content-Type-Options': 'nosniff'
    }
  });
}

async function callGateway(text, kind, history, gateway, soulmate = null) {
  if (!gateway.available) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);
  try {
    const client = new OpenAI({
      apiKey: gateway.apiKey,
      baseURL: gateway.baseUrl,
      maxRetries: 0,
      timeout: LLM_TIMEOUT_MS
    });
    const data = await client.chat.completions.create({
      model: gateway.model,
      messages: buildLLMMessages(text, kind, history, soulmate),
      temperature: 0.78,
      max_tokens: LLM_COMPLETION_TOKEN_LIMIT,
      response_format: { type: 'json_object' }
    }, {
      signal: controller.signal
    });
    const content = data.choices?.[0]?.message?.content || '';
    const parsed = parseLLMReply(content);
    return parsed ? {
      ...parsed,
      provider: 'netlify_ai_gateway',
      model: data.model || gateway.model
    } : null;
  } catch (error) {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function json(body, status = 200) {
  return Response.json(body, {
    status,
    headers: {
      'Cache-Control': 'no-store'
    }
  });
}

export default async function handler(request) {
  const gateway = gatewayConfig();
  const serverKey = serverLlmKey();
  if (request.method === 'GET') {
    const clientRelease = safeLogToken(request.headers.get('x-nexora-client-release'));
    const chatGrant = createChatGrant(clientRelease, serverKey);
    return json({
      enabled: gateway.available || Boolean(serverKey),
      default_provider: gateway.available ? 'netlify_ai_gateway' : serverKey ? 'kimi' : 'fallback',
      ...(chatGrant ? {
        chat_grant: chatGrant,
        chat_grant_expires_in: 480
      } : {}),
      gateway: {
        available: gateway.available,
        model: gateway.model,
        source: gateway.source
      },
      kimi: {
        server_key_available: Boolean(serverKey),
        managed: true,
        default_model: llmDefaultModel(),
        base_url: llmBaseUrl()
      }
    });
  }

  if (request.method !== 'POST') {
    return json({ error: 'method not allowed' }, 405);
  }

  let payload;
  try {
    payload = await request.json();
  } catch (error) {
    return json({ error: 'invalid json' }, 400);
  }

  const text = cleanText(payload.text);
  if (!text) {
    return json({ error: 'missing text' }, 400);
  }

  const sceneId = inferSceneId(text, String(payload.scene || 'daily'));
  const scene = sceneLibrary[sceneId] || sceneLibrary.daily;
  const history = cleanHistory(payload.history);
  const soulmate = cleanSoulmateProfile(payload.soulmate);
  const creatureId = creatureKind(payload.persona || payload.persona_short)
    || creatureKind(soulmate?.starterId)
    || creatureKind(soulmate?.starter)
    || creatureKind(soulmate?.species);
  const kind = creatureId || personaKind(payload.persona || payload.persona_short);
  const voiceScope = cleanVoiceGrantScope(payload.voice_context);
  const expectedCreaturePersona = creatureId ? `creature:${creatureId}` : '';
  const allowedVoiceScope = voiceScope
    && (!expectedCreaturePersona || voiceScope.persona === expectedCreaturePersona)
    && (!creatureId || voiceScope.starter === creatureId)
      ? voiceScope
      : null;

  const kimiModel = sanitizeLlmModel(payload.llm_model);
  const kimiDiagnostics = {};
  const clientRelease = safeLogToken(payload.client_release);
  const responseMeta = {
    kind,
    creatureId,
    sceneId,
    soulmate,
    gatewayAvailable: gateway.available,
    contextTurns: history.length
  };
  const wantsStream = payload.stream === true;
  if (wantsStream && serverKey) {
    const streamResponse = await callKimiStream(text, kind, history, {
      apiKey: serverKey,
      baseUrl: llmBaseUrl(),
      model: kimiModel,
      soulmate,
      diagnostics: kimiDiagnostics,
      responseMeta,
      voiceGrant: createVoiceGrant(allowedVoiceScope, serverKey),
      clientRelease,
      probe: payload.probe === true
    });
    if (streamResponse) return streamResponse;
  }
  let llm = wantsStream && serverKey
    ? null
    : await callKimi(text, kind, history, {
      apiKey: serverKey,
      baseUrl: llmBaseUrl(),
      model: kimiModel,
      provider: 'kimi',
      soulmate,
      diagnostics: kimiDiagnostics
    });
  if (!llm && gateway.available) {
    llm = await callGateway(text, kind, history, gateway, soulmate);
  }
  if (llm) {
    console.info(JSON.stringify({
      event: 'chat_provider_result',
      mode: 'cloud_llm',
      provider: llm.provider,
      model: llm.model,
      managed: true,
      client_release: clientRelease || null,
      probe: payload.probe === true,
      context_turns: history.length
    }));
    return json(cloudReplyBody(llm, responseMeta));
  }

  const failure = serverKey
    ? `server_key_${kimiDiagnostics.category || 'failed'}`
    : gateway.available
      ? 'gateway_failed'
      : 'not_configured';
  console.warn(JSON.stringify({
    event: 'chat_provider_result',
    mode: 'provider_error',
    failure,
    server_key_present: Boolean(serverKey),
    gateway_available: gateway.available,
    upstream_status: kimiDiagnostics.status || null,
    upstream_code: kimiDiagnostics.code || null,
    managed: true,
    client_release: clientRelease || null,
    probe: payload.probe === true,
    context_turns: history.length
  }));
  return json({
    error: 'llm_unavailable',
    mode: 'provider_error',
    llm: {
      bound: false,
      managed: true,
      provider: serverKey ? 'kimi' : gateway.available ? 'netlify_ai_gateway' : 'none',
      model: serverKey ? kimiModel : gateway.model,
      gateway_available: gateway.available,
      context_turns: history.length,
      failure
    }
  }, serverKey || gateway.available ? 502 : 503);
}

export const config = {
  path: '/api/chat',
  method: ['GET', 'POST'],
  rateLimit: {
    windowLimit: 20,
    windowSize: 60,
    aggregateBy: ['ip', 'domain']
  }
};
