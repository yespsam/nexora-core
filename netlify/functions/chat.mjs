import OpenAI from 'openai';

import { personaKind } from './voice-data.mjs';
import {
  companionProfiles,
  creatureKind,
  creatureProfiles,
  interactionScenes
} from '../../shared/companion-data.mjs';
import {
  contextualFallbackReply,
  inferSceneId
} from '../../shared/fallback-dialogue.mjs';

const sceneLibrary = Object.fromEntries(interactionScenes.map((scene) => [scene.id, {
  mood: scene.mood,
  action: scene.replyAction || scene.action,
  female: scene.replies.female,
  male: scene.replies.male
}]));

const thinkingLibrary = Object.fromEntries(interactionScenes.map((scene) => [
  scene.id,
  scene.thinking
]));

function cleanText(value) {
  return String(value || '')
    .replace(/[<>&]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180);
}

function pickReply(list, text) {
  if (!list.length) return '';
  // 文本种子 + 随机扰动：同一句话不再永远命中同一条回复。
  const seed = [...text].reduce((sum, char) => sum + char.charCodeAt(0), text.length);
  const jitter = Math.floor(Math.random() * list.length);
  return list[Math.abs(seed + jitter) % list.length];
}

const LLM_TIMEOUT_MS = 7000;
const LLM_MODEL_WHITELIST = new Set([
  'kimi-k2.5', 'kimi-k2.6',
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
  return runtimeEnv('LLM_MODEL') || 'kimi-k2.5';
}

function gatewayModel() {
  return runtimeEnv('NETLIFY_AI_MODEL') || 'gpt-4.1-mini';
}

function sanitizeLlmKey(value) {
  const key = String(value || '').trim();
  if (!key || key.length > 200 || !key.startsWith('sk-')) return '';
  return key;
}

function sanitizeLlmModel(value) {
  const model = String(value || '').trim();
  return LLM_MODEL_WHITELIST.has(model) ? model : llmDefaultModel();
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
    .slice(-10);
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

export function buildLLMMessages(text, kind, history = [], soulmateValue = null) {
  const creatureId = creatureKind(kind);
  const p = profileForKind(kind);
  const soulmate = cleanSoulmateProfile(soulmateValue);
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
  const system = [
    soulmate
      ? `你是「${soulmate.name}」，一个会随着陪伴成长的 Soulmate 数字生命。你与用户平等相处，正在进行连续语音对话。`
      : creatureId
        ? `你是「${p.name}」，一个原创的 ${p.species} 数字生命（${p.description}）。你与用户平等相处。`
        : `你是「${p.name}」，主人的贴心 AI 伴侣（${p.desc}）。你们正在进行一段连续的语音对话。`,
    creatureId ? `原生形态：${p.name}，${p.species}。核心性格：${p.description}` : '',
    creatureId ? `表达风格：${p.speechStyle}` : '',
    creatureId ? `内在思考风格：${p.thinkingStyle}` : '',
    soulmate ? `身份：诞生日 ${soulmate.birthday || '未设定'}，${soulmate.species || soulmate.starter || '数字生命'}，${soulmate.stage || '初生形态'}，已陪伴 ${soulmate.daysTogether} 天。` : '',
    soulmate ? `人格数据：${traitSummary}。这些值会变化，请表现出倾向但不要朗读数值。` : '',
    soulmate?.memories.length ? `共同记忆：${soulmate.memories.join('；')}` : '',
    '规则：',
    '1. 必须严格输出 JSON（不要输出任何其他文字、不要用代码块）：',
    '{"thinking":"...","reply":"...","mood":"happy|calm|sad|sleepy 之一","action":"idle|nod|heart|wave|voice|walk|run 之一"}',
    creatureId
      ? '2. reply 是说给用户听的话：像熟悉的真实伙伴，短、口语、1~3 句；直接回应具体内容，禁止背模板、客服腔和空泛安慰。'
      : '2. reply 是给主人听的话：像熟悉的真人，短、口语、1~3 句；直接回应具体内容，禁止背模板、客服腔和空泛安慰。',
    creatureId
      ? '3. thinking 是你的真实心声：先察觉用户话里的细节，再写你此刻真实的情绪，最后写你打算怎么回应。第一人称、口语、一两句到三四句。'
      : '3. thinking 是你的真实心声：先察觉主人话里的细节，再写你此刻真实的情绪，最后写你打算怎么回应。第一人称、口语、一两句到三四句。',
    '4. 必须结合前文理解省略、代词和追问，不要重复问已经回答过的问题；最新一句是前文的自然延续。',
    '4.1 先判断这是提问、闲聊、玩笑、分享还是明显的情绪表达。只有用户真的在表达情绪时才安慰，普通聊天不要每句都“接住情绪”。',
    '4.2 回应中至少承接用户刚说的一个具体细节；需要追问时最多问一个自然的问题，不要连续盘问，也不要反复强调自己会陪伴。',
    '5. mood 选你此刻的情绪；action 选配合的肢体动作：安慰或亲密=heart，认同=nod，打招呼=wave，聊天=voice，散步=walk，其他=idle。',
    '6. 不得声称看到、听到或已经控制现实设备，除非请求里明确包含成功的工具结果。',
    creatureId ? '7. 你是原创生物伙伴，不是男友、女友或旧版人类角色；不要自称小栖、栖安，也不要称呼用户为主人。' : ''
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

async function callKimi(text, kind, history, {
  apiKey,
  baseUrl,
  model,
  soulmate
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
      body: JSON.stringify({
        model,
        messages: buildLLMMessages(text, kind, history, soulmate),
        temperature: 0.78,
        max_tokens: 320,
        response_format: { type: 'json_object' }
      }),
      signal: controller.signal
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    const content = data.choices?.[0]?.message?.content || '';
    const parsed = parseLLMReply(content);
    return parsed ? { ...parsed, provider: 'kimi', model: data.model || model } : null;
  } catch (error) {
    return null;
  } finally {
    clearTimeout(timer);
  }
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
      max_tokens: 320,
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
    return json({
      enabled: gateway.available || Boolean(serverKey),
      default_provider: gateway.available ? 'netlify_ai_gateway' : serverKey ? 'kimi' : 'fallback',
      gateway: {
        available: gateway.available,
        model: gateway.model,
        source: gateway.source
      },
      kimi: {
        server_key_available: Boolean(serverKey),
        byok_supported: true,
        default_model: llmDefaultModel()
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

  const personalKey = sanitizeLlmKey(payload.llm_key);
  const kimiKey = personalKey || serverKey;
  const kimiModel = sanitizeLlmModel(payload.llm_model);
  const llmBound = Boolean(personalKey);
  let llm = await callKimi(text, kind, history, {
    apiKey: kimiKey,
    baseUrl: llmBaseUrl(),
    model: kimiModel,
    soulmate
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
      context_turns: history.length
    }));
    return json({
      text: llm.reply,
      thinking: llm.thinking,
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
        bound: llmBound,
        provider: llm.provider,
        model: llm.model,
        gateway_available: gateway.available,
        context_turns: history.length
      }
    });
  }

  const reply = contextualFallbackReply({
    text,
    kind,
    scene: sceneId,
    history,
    companionName: soulmate?.name,
    memories: soulmate?.memories
  });
  const creatureProfile = creatureId ? creatureProfiles[creatureId] : null;
  const failure = personalKey
    ? 'personal_key_failed'
    : serverKey
      ? 'server_key_failed'
      : gateway.available
        ? 'gateway_failed'
        : 'not_configured';
  console.warn(JSON.stringify({
    event: 'chat_provider_result',
    mode: 'fallback',
    failure,
    personal_key_present: Boolean(personalKey),
    server_key_present: Boolean(serverKey),
    gateway_available: gateway.available,
    context_turns: history.length
  }));
  const thinkingPool = creatureProfile
    ? [`${creatureProfile.thinkingStyle} 用户刚才说：“${text}”。`]
    : ((thinkingLibrary[sceneId] || thinkingLibrary.daily)[kind] || thinkingLibrary[sceneId].female);
  const thinking = pickReply(thinkingPool, `${text}#think`);

  return json({
    text: reply,
    thinking,
    emotion: {
      mood: scene.mood,
      affection: Math.max(0, Math.min(100, Math.round(soulmate?.traits?.warmth || 72))),
      user_mood: scene.mood === 'sleepy' ? '困倦' : '平静'
    },
    actions: [
      { target: 'companion', action: scene.action, scene: sceneId }
    ],
    persona_id: personaIdForKind(kind),
    creature: creatureId || null,
    scene: sceneId,
    mode: 'cloud_scene_reply',
    llm: {
      bound: llmBound,
      provider: 'fallback',
      model: llmBound ? kimiModel : gateway.model,
      gateway_available: gateway.available,
      context_turns: history.length,
      failure
    }
  });
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
