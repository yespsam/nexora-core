import {
  creatureVoiceResources,
  personaKind,
  voiceResources
} from '../../shared/companion-data.mjs';

export { creatureVoiceResources, personaKind, voiceResources };

export function jsonResponse(body, statusCode = 200) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store'
    },
    body: JSON.stringify(body)
  };
}

export function resolveVoice(persona, archetype, starter = '') {
  const creatureKey = String(archetype || '');
  const creatureCast = creatureVoiceResources.find((item) => item.archetype === creatureKey)
    || creatureVoiceResources.find((item) => item.starter === starter);
  if (creatureCast) return creatureCast;
  const kind = personaKind(persona);
  const resources = voiceResources[kind];
  const key = archetype === 'default' ? '' : String(archetype || '');
  return resources.find((item) => item.archetype === key) || resources[0];
}

export function voiceStatusBody() {
  const cast = creatureVoiceResources.find((item) => item.id === 'aether');
  return {
    enabled: true,
    voice_enabled: true,
    pipeline_ready: true,
    tts_engine: 'edge_tts_netlify',
    active_archetype: cast.archetype,
    voice_profile: 'cloud_neural',
    cast: {
      provider: 'edge_tts',
      engine: 'edge_tts',
      voice: cast.voice,
      name: cast.name
    },
    stt_model_size: '',
    error: ''
  };
}
