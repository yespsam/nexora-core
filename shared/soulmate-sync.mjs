import {
  createSoulmateExportBundle,
  normalizeSoulmateExportBundle
} from './soulmate-profile.mjs?v=2';

export const SOULMATE_SYNC_VERSION = 1;
export const SOULMATE_SYNC_CHANNEL = 'nexora-core-continuity-v1';
export const SOULMATE_SYNC_STORAGE_KEY = 'nexora-core-continuity-state-v1';

function cleanSourceId(value) {
  return String(value || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64);
}

function createSourceId() {
  try {
    return cleanSourceId(globalThis.crypto?.randomUUID?.()) || `surface-${Date.now().toString(36)}`;
  } catch (error) {
    return `surface-${Date.now().toString(36)}`;
  }
}

export function createSoulmateSyncEnvelope(profile, history, {
  sourceId = createSourceId(),
  revision = Date.now(),
  now = Date.now()
} = {}) {
  const bundle = createSoulmateExportBundle(profile, history, now);
  const source = cleanSourceId(sourceId);
  if (!bundle || !source) return null;
  return {
    version: SOULMATE_SYNC_VERSION,
    type: 'companion-state',
    sourceId: source,
    revision: Math.max(1, Math.floor(Number(revision) || now)),
    profileId: bundle.profile.id,
    bundle
  };
}

export function normalizeSoulmateSyncEnvelope(value, now = Date.now()) {
  if (!value || typeof value !== 'object') return null;
  if (value.version !== SOULMATE_SYNC_VERSION || value.type !== 'companion-state') return null;
  const sourceId = cleanSourceId(value.sourceId);
  const revision = Math.max(0, Math.floor(Number(value.revision) || 0));
  const bundle = normalizeSoulmateExportBundle(value.bundle, now);
  if (!sourceId || !revision || !bundle || value.profileId !== bundle.profile.id) return null;
  return {
    version: SOULMATE_SYNC_VERSION,
    type: 'companion-state',
    sourceId,
    revision,
    profileId: bundle.profile.id,
    bundle
  };
}

export function loadSoulmateSyncSnapshot(
  storage = globalThis.localStorage,
  now = Date.now()
) {
  try {
    const serialized = storage?.getItem?.(SOULMATE_SYNC_STORAGE_KEY);
    return serialized ? normalizeSoulmateSyncEnvelope(JSON.parse(serialized), now) : null;
  } catch (error) {
    return null;
  }
}

export function openSoulmateSync({
  onState,
  sourceId = createSourceId(),
  storage = globalThis.localStorage,
  eventTarget = globalThis,
  hydrateStoredState = true,
  channelFactory = typeof BroadcastChannel === 'function'
    ? (name) => new BroadcastChannel(name)
    : null
} = {}) {
  const localSourceId = cleanSourceId(sourceId) || createSourceId();
  const channel = channelFactory?.(SOULMATE_SYNC_CHANNEL) || null;
  let latestRevision = 0;
  let closed = false;

  const deliver = (value) => {
    const envelope = normalizeSoulmateSyncEnvelope(value);
    if (!envelope || envelope.sourceId === localSourceId || envelope.revision <= latestRevision) return false;
    latestRevision = envelope.revision;
    onState?.(envelope.bundle, envelope);
    return true;
  };

  const onMessage = (event) => deliver(event?.data);
  const onStorage = (event) => {
    if (event?.key !== SOULMATE_SYNC_STORAGE_KEY || !event.newValue) return;
    try {
      deliver(JSON.parse(event.newValue));
    } catch (error) {}
  };

  channel?.addEventListener?.('message', onMessage);
  eventTarget?.addEventListener?.('storage', onStorage);
  if (hydrateStoredState) {
    const snapshot = loadSoulmateSyncSnapshot(storage);
    if (snapshot) deliver(snapshot);
  }

  return {
    sourceId: localSourceId,
    publish(profile, history) {
      if (closed) return null;
      const revision = Math.max(Date.now(), latestRevision + 1);
      const envelope = createSoulmateSyncEnvelope(profile, history, {
        sourceId: localSourceId,
        revision
      });
      if (!envelope) return null;
      latestRevision = envelope.revision;
      try {
        storage?.setItem(SOULMATE_SYNC_STORAGE_KEY, JSON.stringify(envelope));
      } catch (error) {}
      channel?.postMessage?.(envelope);
      return envelope;
    },
    receive: deliver,
    close() {
      if (closed) return;
      closed = true;
      channel?.removeEventListener?.('message', onMessage);
      channel?.close?.();
      eventTarget?.removeEventListener?.('storage', onStorage);
    }
  };
}
