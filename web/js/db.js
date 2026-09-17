/**
 * Lokaler Speicher der Web-App (IndexedDB).
 *
 * Zweck: Erfassen ohne Netz. Was erfasst wurde, liegt zuerst hier und geht erst
 * danach an den Server. Die Warteschlange bleibt bestehen, bis der Server einen
 * Vorgang bestätigt oder ausdrücklich zurückweist – auch über einen Neustart
 * des Geräts hinweg.
 *
 * Wichtig: dieser Speicher gehört zum Browserprofil des Geräts. Er ersetzt
 * keine Datensicherung und darf nicht als alleinige Ablage dienen.
 */

const DB_NAME = 'postbuch';
const DB_VERSION = 1;

/** @type {Promise<IDBDatabase>|null} */
let connection = null;

function open() {
  if (connection) return connection;
  connection = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('entries')) {
        const store = db.createObjectStore('entries', { keyPath: 'id' });
        store.createIndex('shipment_date', 'shipment_date');
        store.createIndex('pending', 'pending');
      }
      if (!db.objectStoreNames.contains('queue')) {
        db.createObjectStore('queue', { keyPath: 'ref', autoIncrement: false });
      }
      if (!db.objectStoreNames.contains('photos')) {
        db.createObjectStore('photos', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('meta')) {
        db.createObjectStore('meta', { keyPath: 'key' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Datenbank ist durch ein anderes Fenster blockiert.'));
  });
  return connection;
}

function run(storeName, mode, work) {
  return open().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, mode);
        const store = tx.objectStore(storeName);
        let result;
        try {
          result = work(store);
        } catch (error) {
          tx.abort();
          reject(error);
          return;
        }
        tx.oncomplete = () => resolve(result && result.__request ? result.__request.result : result);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error || new Error('Vorgang abgebrochen.'));
      }),
  );
}

function asPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export const store = {
  async putEntry(entry) {
    await run('entries', 'readwrite', (s) => s.put(entry));
    return entry;
  },

  async putEntries(entries) {
    await run('entries', 'readwrite', (s) => entries.forEach((entry) => s.put(entry)));
    return entries.length;
  },

  async getEntry(id) {
    const db = await open();
    return asPromise(db.transaction('entries').objectStore('entries').get(id));
  },

  async allEntries() {
    const db = await open();
    const rows = await asPromise(db.transaction('entries').objectStore('entries').getAll());
    return rows.sort((a, b) =>
      `${b.shipment_date || ''}${b.created_at || ''}`.localeCompare(
        `${a.shipment_date || ''}${a.created_at || ''}`,
      ),
    );
  },

  async deleteEntry(id) {
    await run('entries', 'readwrite', (s) => s.delete(id));
  },

  /** Ersetzt den Serverstand vollständig, behält aber noch nicht übertragene Einträge. */
  async replaceServerEntries(entries) {
    const db = await open();
    const existing = await asPromise(db.transaction('entries').objectStore('entries').getAll());
    const pending = existing.filter((e) => e.pending);
    const pendingIds = new Set(pending.map((e) => e.id));
    await run('entries', 'readwrite', (s) => {
      s.clear();
      pending.forEach((entry) => s.put(entry));
      entries.filter((entry) => !pendingIds.has(entry.id)).forEach((entry) => s.put(entry));
    });
  },

  async enqueue(operation) {
    const ref = operation.ref || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const record = { ...operation, ref, queued_at: new Date().toISOString(), attempts: 0 };
    await run('queue', 'readwrite', (s) => s.put(record));
    return record;
  },

  async queue() {
    const db = await open();
    const rows = await asPromise(db.transaction('queue').objectStore('queue').getAll());
    return rows.sort((a, b) => a.queued_at.localeCompare(b.queued_at));
  },

  async dequeue(ref) {
    await run('queue', 'readwrite', (s) => s.delete(ref));
  },

  async markAttempt(ref, message) {
    const db = await open();
    const current = await asPromise(db.transaction('queue').objectStore('queue').get(ref));
    if (!current) return null;
    const updated = { ...current, attempts: (current.attempts || 0) + 1, last_error: message || '' };
    await run('queue', 'readwrite', (s) => s.put(updated));
    return updated;
  },

  async putPhoto(record) {
    await run('photos', 'readwrite', (s) => s.put(record));
    return record;
  },

  async photosFor(entryId) {
    const db = await open();
    const rows = await asPromise(db.transaction('photos').objectStore('photos').getAll());
    return rows.filter((row) => row.entry_id === entryId);
  },

  async pendingPhotos() {
    const db = await open();
    const rows = await asPromise(db.transaction('photos').objectStore('photos').getAll());
    return rows.filter((row) => !row.uploaded);
  },

  async deletePhoto(id) {
    await run('photos', 'readwrite', (s) => s.delete(id));
  },

  async setMeta(key, value) {
    await run('meta', 'readwrite', (s) => s.put({ key, value }));
    return value;
  },

  async getMeta(key, fallback = null) {
    const db = await open();
    const row = await asPromise(db.transaction('meta').objectStore('meta').get(key));
    return row ? row.value : fallback;
  },
};

/**
 * Bittet den Browser, den lokalen Speicher nicht selbsttätig zu räumen.
 * Ohne diese Zusage kann iOS Daten verwerfen, wenn der Speicher knapp wird.
 */
export async function requestPersistence() {
  if (!navigator.storage || !navigator.storage.persist) return { supported: false, granted: false };
  try {
    const already = navigator.storage.persisted ? await navigator.storage.persisted() : false;
    const granted = already || (await navigator.storage.persist());
    let quota = null;
    if (navigator.storage.estimate) {
      const estimate = await navigator.storage.estimate();
      quota = { usage: estimate.usage, quota: estimate.quota };
    }
    return { supported: true, granted, quota };
  } catch (error) {
    return { supported: true, granted: false, error: String(error) };
  }
}
