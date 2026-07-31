import { jsonResponse, voiceStatusBody } from './voice-data.mjs';

export const handler = async (event = {}) => {
  const params = new URLSearchParams(event.rawQuery || '');
  return jsonResponse(voiceStatusBody(params.get('starter') || params.get('persona') || 'cute'));
};
