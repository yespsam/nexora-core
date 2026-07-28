export const PENDANT_SIMULATOR_CHANNEL = 'nexora-nc01-simulator-v1';
export const PENDANT_SIMULATOR_STORAGE_KEY = 'nexora-nc01-simulator-snapshot-v1';

const allowedStates = new Set([
  'boot',
  'idle',
  'affection',
  'listening',
  'thinking',
  'speaking',
  'happy',
  'notice',
  'charging',
  'low-power',
  'sleep'
]);
const allowedStarters = new Set(['cute', 'cool', 'beautiful']);
const allowedStages = new Set(['seed', 'young', 'resonance']);

function boundedInteger(value, fallback, min, max) {
  const number = Number(value);
  return Math.max(min, Math.min(max, Number.isFinite(number) ? Math.round(number) : fallback));
}

function cleanText(value, limit) {
  return String(value || '').replace(/[<>&]/g, '').replace(/\s+/g, ' ').trim().slice(0, limit);
}

export function normalizePendantSimulatorSnapshot(value) {
  if (!value || typeof value !== 'object') return null;
  const name = cleanText(value.name, 12);
  if (!name) return null;
  return {
    v: 1,
    profileId: cleanText(value.profileId, 64) || 'simulated-profile',
    name,
    starter: allowedStarters.has(value.starter) ? value.starter : 'cute',
    stage: allowedStages.has(value.stage) ? value.stage : 'seed',
    bond: boundedInteger(value.bond, 0, 0, 9999),
    state: allowedStates.has(value.state) ? value.state : 'idle',
    ...(value.battery === undefined ? {} : { battery: boundedInteger(value.battery, 76, 0, 100) }),
    ...(cleanText(value.notice, 16) ? { notice: cleanText(value.notice, 16) } : {})
  };
}

export function decodePendantSimulatorPayload(payload) {
  try {
    const text = typeof payload === 'string'
      ? payload
      : new TextDecoder().decode(payload instanceof Uint8Array ? payload : new Uint8Array(payload));
    return normalizePendantSimulatorSnapshot(JSON.parse(text));
  } catch (error) {
    return null;
  }
}

export function createPendantSimulatorEnvelope(payload, now = Date.now()) {
  const snapshot = decodePendantSimulatorPayload(payload);
  if (!snapshot) throw new Error('invalid NC-01 simulator snapshot');
  return { version: 1, type: 'snapshot', sentAt: now, snapshot };
}

export function openPendantSimulatorWriter(storage = globalThis.localStorage) {
  const channel = typeof BroadcastChannel === 'function'
    ? new BroadcastChannel(PENDANT_SIMULATOR_CHANNEL)
    : null;
  return {
    simulated: true,
    async writeValueWithResponse(payload) {
      const envelope = createPendantSimulatorEnvelope(payload);
      storage?.setItem(PENDANT_SIMULATOR_STORAGE_KEY, JSON.stringify(envelope));
      channel?.postMessage(envelope);
    },
    async writeValue(payload) {
      return this.writeValueWithResponse(payload);
    },
    close() {
      channel?.close();
    }
  };
}

export function observePendantSimulator(
  onSnapshot,
  storage = globalThis.localStorage,
  { replayStored = true, eventTarget = globalThis } = {}
) {
  let lastEnvelopeSignature = '';
  const deliver = (value) => {
    const signature = value?.snapshot
      ? `${value.sentAt || 0}:${JSON.stringify(value.snapshot)}`
      : '';
    if (signature && signature === lastEnvelopeSignature) return;
    const snapshot = normalizePendantSimulatorSnapshot(value?.snapshot || value);
    if (snapshot) {
      lastEnvelopeSignature = signature;
      onSnapshot(snapshot);
    }
  };
  if (replayStored) {
    try {
      const saved = JSON.parse(storage?.getItem(PENDANT_SIMULATOR_STORAGE_KEY) || 'null');
      if (saved) queueMicrotask(() => deliver(saved));
    } catch (error) {}
  }

  const channel = typeof BroadcastChannel === 'function'
    ? new BroadcastChannel(PENDANT_SIMULATOR_CHANNEL)
    : null;
  const onMessage = (event) => deliver(event.data);
  const onStorage = (event) => {
    if (event?.key !== PENDANT_SIMULATOR_STORAGE_KEY || !event.newValue) return;
    try {
      deliver(JSON.parse(event.newValue));
    } catch (error) {}
  };
  channel?.addEventListener('message', onMessage);
  eventTarget?.addEventListener?.('storage', onStorage);
  return () => {
    channel?.removeEventListener('message', onMessage);
    channel?.close();
    eventTarget?.removeEventListener?.('storage', onStorage);
  };
}
