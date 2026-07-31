import assert from 'node:assert/strict';
import test from 'node:test';

import { voiceProsody } from '../netlify/functions/voice-speak.mjs';

test('voice prosody keeps mood changes subtle and route-specific', () => {
  const cast = { rate: '+5%', pitch: '+7Hz' };
  assert.deepEqual(voiceProsody(cast, 'happy'), {
    rate: '+7%',
    pitch: '+8Hz',
    volume: '94%'
  });
  assert.deepEqual(voiceProsody(cast, 'calm'), {
    rate: '+3%',
    pitch: '+6Hz',
    volume: '94%'
  });
});
