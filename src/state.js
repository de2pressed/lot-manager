const listeners = new Map();

function emit(event, payload) {
  (listeners.get(event) || []).forEach((listener) => listener(payload));
}

export const state = {
  lots: [],
  inventory: [],
  sales: [],
  products: [],
  log: [],
  profiles: [],
  currentUser: null,
  currentProfile: null,
  currentRole: null,
  currentRoute: 'dashboard',
  hydrated: false,
  viewActions: {},

  emit,

  on(event, listener) {
    if (!listeners.has(event)) {
      listeners.set(event, []);
    }

    listeners.get(event).push(listener);

    return () => {
      listeners.set(
        event,
        (listeners.get(event) || []).filter((entry) => entry !== listener)
      );
    };
  },

  set(partialState) {
    Object.assign(this, partialState);
    emit('state:updated', partialState);

    Object.keys(partialState).forEach((key) => {
      emit(`${key}:changed`, this[key]);
    });
  },

  setCollection(key, items) {
    this[key] = items;
    emit(`${key}:changed`, this[key]);
    emit('state:updated', { [key]: this[key] });
  },

  upsertCollectionRow(key, row, idField = 'id') {
    const next = [...this[key]];
    const index = next.findIndex((item) => item?.[idField] === row?.[idField]);

    if (index === -1) {
      next.unshift(row);
    } else {
      next[index] = { ...next[index], ...row };
    }

    this.setCollection(key, next);
  },

  removeCollectionRow(key, rowId, idField = 'id') {
    this.setCollection(
      key,
      this[key].filter((item) => item?.[idField] !== rowId)
    );
  },

  reset() {
    this.set({
      lots: [],
      inventory: [],
      sales: [],
      products: [],
      log: [],
      profiles: [],
      currentUser: null,
      currentProfile: null,
      currentRole: null,
      currentRoute: 'dashboard',
      hydrated: false,
      viewActions: {}
    });
  }
};
