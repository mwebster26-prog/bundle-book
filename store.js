// Tiny IndexedDB wrapper. Everything Bundle Book knows lives here, on the device.
// Stores: bundles, trips, photos ({id, blob}), queue (Drive jobs), meta (sync state).
window.DB = (() => {
  const NAME = 'bundle-book', VERSION = 1;
  const STORES = ['bundles', 'trips', 'photos', 'queue', 'meta'];
  let dbp = null;
  function open() {
    return dbp || (dbp = new Promise((res, rej) => {
      const r = indexedDB.open(NAME, VERSION);
      r.onupgradeneeded = () => {
        const d = r.result;
        for (const s of STORES) if (!d.objectStoreNames.contains(s)) d.createObjectStore(s, { keyPath: 'id' });
      };
      r.onsuccess = () => {
        const d = r.result;
        d.onversionchange = () => { d.close(); dbp = null; };
        res(d);
      };
      r.onerror = () => { dbp = null; rej(r.error); };
      r.onblocked = () => rej(new Error('Storage is blocked by another open Bundle Book tab.'));
    }));
  }
  async function run(store, mode, fn) {
    const d = await open();
    return new Promise((res, rej) => {
      const t = d.transaction(store, mode), s = t.objectStore(store);
      let out;
      const r = fn(s);
      if (r) r.onsuccess = () => { out = r.result; };
      t.oncomplete = () => res(out);
      t.onerror = () => rej(t.error);
      t.onabort = () => rej(t.error || new Error('Storage write was aborted'));
    });
  }
  return {
    all: s => run(s, 'readonly', st => st.getAll()),
    get: (s, id) => run(s, 'readonly', st => st.get(id)),
    put: (s, v) => run(s, 'readwrite', st => st.put(v)),
    del: (s, id) => run(s, 'readwrite', st => st.delete(id)),
  };
})();
