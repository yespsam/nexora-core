import {
  creatureProfiles,
  creatureVoiceResources,
  jsonResponse,
  personaKind,
  resolveCreatureStarter,
  voiceResources
} from './voice-data.mjs';

export const handler = async (event) => {
  const params = new URLSearchParams(event.rawQuery || '');
  const kind = personaKind(params.get('persona'));
  const starter = resolveCreatureStarter(params.get('persona'), params.get('starter'));
  const creatureMode = Boolean(starter);
  const selectedCreatureVoice = creatureVoiceResources.find((item) => item.starter === starter);
  return jsonResponse({
    enabled: true,
    pipeline_ready: true,
    tts_engine: 'edge_tts_netlify',
    persona: {
      id: creatureMode ? `creature_${starter}` : kind === 'male' ? 'male_companion' : 'female_companion',
      gender: creatureMode ? 'neutral' : kind,
      display_name: creatureMode ? creatureProfiles[starter].name : kind === 'male' ? '栖安' : '小栖'
    },
    active_archetype: creatureMode ? selectedCreatureVoice?.archetype || 'sprout' : '',
    resources: creatureMode ? creatureVoiceResources : voiceResources[kind],
    providers: [
      {
        id: 'edge_tts',
        name: 'Edge Neural TTS',
        status: 'ready',
        note: '云端同源函数实时合成 MP3。'
      }
    ]
  });
};
