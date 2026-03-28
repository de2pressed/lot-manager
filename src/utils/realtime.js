import { state } from '../state.js';

export function applyRealtimePayload(collectionKey, payload) {
  if (!payload) return;

  if (payload.eventType === 'DELETE') {
    state.removeCollectionRow(collectionKey, payload.old.id);
    return;
  }

  state.upsertCollectionRow(collectionKey, payload.new);
}
