/**
 * Zugriff auf die Schnittstelle, mit Warteschlange für den Betrieb ohne Netz.
 *
 * Ablauf einer Erfassung:
 *
 * 1. Die App vergibt die Kennung selbst (UUID). Sie steht sofort fest, auch
 *    ohne Verbindung.
 * 2. Der Eintrag wird lokal gespeichert und in die Warteschlange gestellt.
 * 3. Sobald eine Verbindung besteht, gehen die Vorgänge gesammelt an ``/sync``.
 *    Eine wiederholte Übertragung derselben Kennung erzeugt keinen zweiten
 *    Eintrag; deshalb ist ein abgebrochener Upload unschädlich.
 *
 * iOS kennt keine Hintergrundsynchronisation. Übertragen wird deshalb, während
 * die App geöffnet ist: beim Start, beim Zurückkehren in den Vordergrund, nach
 * jeder Erfassung und auf Knopfdruck.
 */

import { store } from './db.js';

const BASE = 'api/v1';

export class ApiError extends Error {
  constructor(status, payload) {
    super((payload && payload.error) || `Serverfehler ${status}`);
    this.status = status;
    this.payload = payload || {};
    this.code = this.payload.code || '';
  }
}

export function uuid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

async function request(path, { method = 'GET', body, headers = {}, raw = false, signal } = {}) {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: body && !raw ? { 'Content-Type': 'application/json', ...headers } : headers,
    body: raw ? body : body ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
    signal,
  });
  const type = response.headers.get('content-type') || '';
  if (!response.ok) {
    let payload = null;
    if (type.includes('application/json')) payload = await response.json().catch(() => null);
    throw new ApiError(response.status, payload);
  }
  if (type.includes('application/json')) return response.json();
  return response;
}

export const api = {
  session: () => request('/session'),
  listEntries: (params = {}) => request(`/entries?${new URLSearchParams(clean(params))}`),
  getEntry: (id) => request(`/entries/${encodeURIComponent(id)}`),
  createEntry: (payload) => request('/entries', { method: 'POST', body: payload }),
  updateEntry: (id, payload) =>
    request(`/entries/${encodeURIComponent(id)}`, { method: 'PUT', body: payload }),
  cancelEntry: (id, payload) =>
    request(`/entries/${encodeURIComponent(id)}/cancel`, { method: 'POST', body: payload }),
  contacts: (query = '') => request(`/contacts?${new URLSearchParams(clean({ query }))}`),
  saveContact: (payload) => request('/contacts', { method: 'POST', body: payload }),
  suggestContacts: (text) => request(`/contacts/suggest?${new URLSearchParams({ text })}`),
  postageSummary: (params = {}) => request(`/summary/postage?${new URLSearchParams(clean(params))}`),
  sync: (operations) => request('/sync', { method: 'POST', body: { operations } }),
  uploadPhoto: (entryId, blob, { id, filename = '', caption = '' } = {}) =>
    request(
      `/entries/${encodeURIComponent(entryId)}/photos?${new URLSearchParams(clean({ id, filename, caption }))}`,
      { method: 'POST', body: blob, raw: true, headers: { 'Content-Type': blob.type } },
    ),
  exportUrl: (params = {}) => `${BASE}/export.csv?${new URLSearchParams(clean(params))}`,
  photoUrl: (photoId) => `${BASE}/photos/${encodeURIComponent(photoId)}`,
};

function clean(params) {
  return Object.fromEntries(
    Object.entries(params).filter(([, value]) => value !== undefined && value !== null && value !== ''),
  );
}

/**
 * Felder, die der Server als Sendungsdaten annimmt. Andere Schlüssel weist er
 * ausdrücklich zurück, damit ein Tippfehler nicht stillschweigend verschwindet.
 */
export const FIELD_KEYS = [
  'direction',
  'sender',
  'recipient',
  'description',
  'shipment_type',
  'shipment_date',
  'postage_cents',
  'psp_element',
  'status',
  'note',
];

/** Reduziert einen Eintrag des Servers auf die änderbaren Felder. */
export function fieldsOf(entry) {
  return Object.fromEntries(
    FIELD_KEYS.map((key) => [key, entry[key]]).filter(([, value]) => value !== undefined),
  );
}

/**
 * Überträgt die Warteschlange.
 *
 * @returns {Promise<{sent:number, conflicts:Array, rejected:Array, offline:boolean}>}
 */
export async function flushQueue({ onProgress } = {}) {
  const queued = await store.queue();
  if (!queued.length) return { sent: 0, conflicts: [], rejected: [], offline: false };
  if (!navigator.onLine) return { sent: 0, conflicts: [], rejected: [], offline: true };

  const operations = queued.map((item) => ({
    op: item.op,
    id: item.id,
    client_ref: item.ref,
    expected_version: item.expected_version,
    reason: item.reason,
    data: item.data,
  }));

  let response;
  try {
    response = await api.sync(operations);
  } catch (error) {
    await Promise.all(queued.map((item) => store.markAttempt(item.ref, error.message)));
    return { sent: 0, conflicts: [], rejected: [], offline: true, error: error.message };
  }

  const conflicts = [];
  const rejected = [];
  let sent = 0;
  for (const result of response.results) {
    const ref = result.client_ref;
    if (result.status === 'ok') {
      sent += 1;
      await store.dequeue(ref);
      if (result.entry) await store.putEntry({ ...result.entry, pending: 0 });
    } else if (result.status === 'conflict') {
      conflicts.push(result);
      await store.markAttempt(ref, result.message);
      if (result.entry) await store.putEntry({ ...result.entry, pending: 0 });
    } else {
      rejected.push(result);
      // Zurückgewiesene Vorgänge bleiben stehen und werden sichtbar gemacht.
      // Stilles Verwerfen wäre Datenverlust.
      await store.markAttempt(ref, result.message);
    }
    onProgress?.({ sent, total: response.results.length });
  }

  await flushPhotos();
  return { sent, conflicts, rejected, offline: false };
}

/** Lädt Belegfotos nach, sobald ihr Eintrag auf dem Server angekommen ist. */
export async function flushPhotos() {
  const pending = await store.pendingPhotos();
  let uploaded = 0;
  for (const photo of pending) {
    const entry = await store.getEntry(photo.entry_id);
    if (!entry || entry.pending) continue;
    try {
      await api.uploadPhoto(photo.entry_id, photo.blob, {
        id: photo.id,
        filename: photo.filename,
        caption: photo.caption,
      });
      await store.putPhoto({ ...photo, uploaded: 1, blob: photo.blob });
      uploaded += 1;
    } catch (error) {
      if (error instanceof ApiError && error.status === 422) {
        await store.putPhoto({ ...photo, error: error.message });
      }
      break;
    }
  }
  return uploaded;
}

/** Holt den Serverstand und legt ihn lokal ab, ohne offene Erfassungen zu verwerfen. */
export async function refreshFromServer(params = {}) {
  const data = await api.listEntries({ limit: 300, ...params });
  await store.replaceServerEntries(data.entries.map((entry) => ({ ...entry, pending: 0 })));
  await store.setMeta('last_sync', new Date().toISOString());
  return data.entries.length;
}
