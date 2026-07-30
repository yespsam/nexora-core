function json(body, status = 200) {
  return Response.json(body, {
    status,
    headers: {
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff'
    }
  });
}

export function createDeviceCloudDeletionWorker(options) {
  const enabled = options.enabled === true;
  const getStore = options.getStore;
  const getSnapshotObjects = options.getSnapshotObjects;
  const limit = Math.min(10, Math.max(1, Math.floor(Number(options.limit) || 3)));
  const onError = options.onError || (() => {});

  return async function deletionWorker() {
    if (!enabled) return json({ enabled: false, processed: 0 });
    const store = getStore();
    const due = await store.listDueDeletions(limit);
    if (!due.length) return json({ enabled: true, processed: 0, failed: 0 });
    const objects = getSnapshotObjects();
    let processed = 0;
    let failed = 0;
    for (const request of due) {
      try {
        await store.executeDeletion(request.ownerId, request.requestId, {
          deleteObjects: async (keys) => {
            if (typeof objects.deleteMany === 'function') return objects.deleteMany(keys);
            for (const key of keys) await objects.delete(key);
          }
        });
        processed += 1;
      } catch (error) {
        failed += 1;
        onError(error);
      }
    }
    return json({ enabled: true, processed, failed });
  };
}
