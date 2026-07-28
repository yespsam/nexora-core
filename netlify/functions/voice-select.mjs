import {
  creatureVoiceResources,
  jsonResponse,
  resolveVoice,
  voiceResources,
  personaKind
} from './voice-data.mjs';

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return jsonResponse({ error: 'method not allowed' }, 405);
  }
  const payload = JSON.parse(event.body || '{}');
  const kind = personaKind(payload.persona);
  const selected = resolveVoice(kind, payload.archetype || payload.voice || '', payload.starter || '');
  const resources = payload.starter || creatureVoiceResources.some((item) => item.archetype === payload.archetype)
    ? creatureVoiceResources
    : voiceResources[kind];
  return jsonResponse({
    ok: true,
    active_archetype: selected.archetype,
    selected,
    resources
  });
};
