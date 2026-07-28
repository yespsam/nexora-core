const assetUrl = (path) => new URL(`../NEXORA_3D_CREATURES/${path}`, import.meta.url).href;

const creature = (id, name, species, directory, voice, formYaw = {}) => {
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
    idle: assetUrl(`${directory}/animations/idle.glb`),
    nod: assetUrl(`${directory}/animations/nod.glb`),
    affection: assetUrl(`${directory}/animations/affection.glb`),
    wave: assetUrl(`${directory}/animations/wave.glb`),
    speaking: assetUrl(`${directory}/animations/speaking.glb`),
    walk: assetUrl(`${directory}/animations/walk.glb`),
    run: assetUrl(`${directory}/animations/run.glb`)
    })
  });
};

export const creature3DCatalog = Object.freeze({
  cute: creature('cute', 'LUMO / 露莫', '绒云兽', 'CUTE_LUMO', 'sprout'),
  cool: creature('cool', 'VEYR / 维尔', '曜影兽', 'COOL_VEYR', 'edge'),
  beautiful: creature('beautiful', 'AERA / 艾拉', '月羽灵', 'BEAUTIFUL_AERA', 'aether')
});

export const creatureActionForPhase = Object.freeze({
  idle: 'idle',
  affection: 'affection',
  listening: 'idle',
  thinking: 'nod',
  speaking: 'speaking',
  happy: 'wave',
  ready: 'nod',
  error: 'idle',
  offline: 'idle',
  notice: 'wave',
  charging: 'idle',
  'low-power': 'idle',
  sleep: 'idle'
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
