const assetUrl = (path) => new URL(`../NEXORA_3D_CREATURES/${path}`, import.meta.url).href;

const creature = (id, name, species, directory, voice, formYaw = {}) => {
  const idleAction = assetUrl(`${directory}/animations/idle.glb`);
  const nativeAction = (action) => assetUrl(`${directory}/animations/${action}.glb`);
  const forms = Object.freeze({
    seed: Object.freeze({
      id: 'seed',
      yaw: formYaw.seed || 0,
      model: assetUrl(`${directory}/model/rigged.glb`),
      thumbnail: assetUrl(`${directory}/model/thumbnail.png`)
    }),
    young: Object.freeze({
      id: 'young',
      yaw: formYaw.young || 0,
      model: assetUrl(`${directory}/evolution/young/rigged.glb`),
      thumbnail: assetUrl(`${directory}/evolution/young/thumbnail.png`)
    }),
    resonance: Object.freeze({
      id: 'resonance',
      yaw: formYaw.resonance || 0,
      model: assetUrl(`${directory}/evolution/resonance/rigged.glb`),
      thumbnail: assetUrl(`${directory}/evolution/resonance/thumbnail.png`)
    })
  });
  return Object.freeze({
    id,
    name,
    species,
    voice,
    forms,
    model: forms.seed.model,
    thumbnail: forms.seed.thumbnail,
    actions: Object.freeze({
      idle: idleAction,
      listening: idleAction,
      nod: idleAction,
      affection: idleAction,
      wave: idleAction,
      speaking: nativeAction('speaking'),
      walk: nativeAction('walk'),
      run: nativeAction('run'),
      charging: idleAction,
      'low-power': idleAction,
      sleep: idleAction
    })
  });
};

export const creature3DCatalog = Object.freeze({
  cute: creature('cute', 'LUMO / 露莫', '绒云兽', 'CUTE_LUMO', 'sprout', {
    resonance: -Math.PI / 4
  }),
  cool: creature('cool', 'VEYR / 维尔', '曜影兽', 'COOL_VEYR', 'edge'),
  beautiful: creature('beautiful', 'AERA / 艾拉', '月羽灵', 'BEAUTIFUL_AERA', 'aether')
});

export const creatureActionForPhase = Object.freeze({
  idle: 'idle',
  affection: 'affection',
  listening: 'listening',
  thinking: 'nod',
  speaking: 'speaking',
  happy: 'wave',
  ready: 'nod',
  error: 'idle',
  offline: 'idle',
  notice: 'wave',
  charging: 'charging',
  'low-power': 'low-power',
  sleep: 'sleep'
});

export const creatureActionProfiles = Object.freeze({
  idle: Object.freeze({
    timeScale: 1,
    stabilizeYaw: true,
    stabilizeXZ: true,
    bob: 0
  }),
  listening: Object.freeze({
    timeScale: 0.58,
    freezePose: true,
    procedural: 'listening',
    stabilizeYaw: true,
    stabilizeXZ: true,
    bob: 0.008,
    sway: 0.008,
    lean: -0.035
  }),
  nod: Object.freeze({
    timeScale: 1,
    freezePose: true,
    procedural: 'nod',
    stabilizeYaw: true,
    stabilizeXZ: true,
    bob: 0
  }),
  affection: Object.freeze({
    timeScale: 1,
    freezePose: true,
    procedural: 'affection',
    stabilizeYaw: true,
    stabilizeXZ: true,
    bob: 0
  }),
  wave: Object.freeze({
    timeScale: 1,
    freezePose: true,
    procedural: 'wave',
    stabilizeYaw: true,
    stabilizeXZ: true,
    bob: 0
  }),
  speaking: Object.freeze({
    timeScale: 1,
    stabilizeYaw: true,
    stabilizeXZ: true,
    bob: 0
  }),
  walk: Object.freeze({
    timeScale: 0.92,
    stabilizeYaw: true,
    stabilizeXZ: true,
    bob: 0
  }),
  run: Object.freeze({
    timeScale: 0.9,
    stabilizeYaw: true,
    stabilizeXZ: true,
    bob: 0
  }),
  charging: Object.freeze({
    timeScale: 0.46,
    freezePose: true,
    procedural: 'charging',
    stabilizeYaw: true,
    stabilizeXZ: true,
    bob: 0.018,
    sway: 0.003
  }),
  'low-power': Object.freeze({
    timeScale: 0.36,
    freezePose: true,
    procedural: 'low-power',
    stabilizeYaw: true,
    stabilizeXZ: true,
    bob: 0.003,
    lean: 0.055
  }),
  sleep: Object.freeze({
    timeScale: 0.24,
    freezePose: true,
    procedural: 'sleep',
    stabilizeYaw: true,
    stabilizeXZ: true,
    bob: 0.002,
    lean: 0.08,
    sway: 0.002
  })
});

export const creatureActionForResponse = Object.freeze({
  idle: 'idle',
  nod: 'nod',
  heart: 'affection',
  wave: 'wave',
  voice: 'speaking',
  walk: 'walk',
  run: 'run'
});

export function creature3DEntry(starter = 'cute', stage = 'seed') {
  const entry = creature3DCatalog[starter] || creature3DCatalog.cute;
  const form = entry.forms[stage] || entry.forms.seed;
  return Object.freeze({
    ...entry,
    stage: form.id,
    yaw: form.yaw,
    model: form.model,
    thumbnail: form.thumbnail
  });
}
