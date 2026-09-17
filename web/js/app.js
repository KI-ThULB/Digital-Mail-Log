/**
 * Oberfläche des digitalen Postbuchs.
 *
 * Leitgedanken der Bedienung:
 *
 * * Die Erkennung schlägt vor, die erfassende Person entscheidet. Kein Feld
 *   wird ohne Bestätigung gefüllt, kein Wert wird erfunden.
 * * Erfassen funktioniert ohne Netz. Was noch nicht übertragen ist, bleibt als
 *   solches sichtbar statt still zu verschwinden.
 * * Porto und PSP-Element erscheinen ausschließlich beim Postausgang. Beim
 *   Wechsel der Richtung wird ausdrücklich gewarnt, bevor Werte entfallen.
 */

import { store, requestPersistence } from './db.js';
import { api, ApiError, flushQueue, refreshFromServer, uuid } from './api.js';
import { recogniseText, engineStatus } from './ocr.js';
import { parseAddress } from './adressen.js';
import { parsePostage, displayPostage } from './porto.js';

const $ = (id) => document.getElementById(id);
const el = (tag, attrs = {}, children = []) => {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else if (value !== null && value !== undefined && value !== false) node.setAttribute(key, value);
  }
  for (const child of [].concat(children)) {
    if (child) node.append(child.nodeType ? child : document.createTextNode(child));
  }
  return node;
};

const state = {
  session: null,
  entries: [],
  filter: { direction: '', query: '', date_from: '', date_to: '', shipment_type: '', withCancelled: false },
  form: null,
  dirty: false,
};

/* ------------------------------------------------------------------ *
 * Formatierung
 * ------------------------------------------------------------------ */

const RICHTUNG = { incoming: 'Eingang', outgoing: 'Ausgang' };

function formatDate(iso) {
  if (!iso) return '–';
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}.${m}.${y}`;
}

function formatDateTime(iso) {
  if (!iso) return '–';
  const value = new Date(iso);
  return value.toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' });
}

const formatMoney = displayPostage;

function today() {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

/* ------------------------------------------------------------------ *
 * Ansichtswechsel
 * ------------------------------------------------------------------ */

function show(view) {
  for (const section of document.querySelectorAll('.view')) section.hidden = section.id !== view;
  $('hauptbereich').focus();
  window.scrollTo({ top: 0 });
}

function notice(text, kind = 'warn') {
  const banner = $('hinweis');
  banner.textContent = text || '';
  banner.className = `banner banner--${kind}`;
  banner.hidden = !text;
}

/* ------------------------------------------------------------------ *
 * Liste
 * ------------------------------------------------------------------ */

function matchesFilter(entry) {
  const f = state.filter;
  if (f.direction && entry.direction !== f.direction) return false;
  if (f.shipment_type && entry.shipment_type !== f.shipment_type) return false;
  if (!f.withCancelled && entry.status === 'cancelled') return false;
  if (f.date_from && (entry.shipment_date || '') < f.date_from) return false;
  if (f.date_to && (entry.shipment_date || '') > f.date_to) return false;
  if (f.query) {
    const haystack = [
      entry.number,
      entry.sender?.name, entry.sender?.organisation, entry.sender?.address,
      entry.recipient?.name, entry.recipient?.organisation, entry.recipient?.address,
      entry.description, entry.note, entry.shipment_type, entry.psp_element,
    ].join(' ').toLowerCase();
    const words = f.query.toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.every((word) => haystack.includes(word))) return false;
  }
  return true;
}

function partyLabel(party) {
  if (!party) return '';
  return [party.organisation, party.name].filter(Boolean).join(' · ');
}

function renderEntry(entry) {
  const outgoing = entry.direction === 'outgoing';
  const parties = outgoing
    ? `an ${partyLabel(entry.recipient) || 'unbekannt'}`
    : `von ${partyLabel(entry.sender) || 'unbekannt'}`;
  const meta = [
    entry.number || 'Nummer folgt',
    entry.shipment_type,
    entry.photos?.length ? `${entry.photos.length} Foto${entry.photos.length > 1 ? 's' : ''}` : '',
    entry.version > 1 ? `Fassung ${entry.version}` : '',
    entry.psp_element ? `PSP ${entry.psp_element}` : '',
  ].filter(Boolean);

  return el('li', {}, [
    el('button', {
      class: `entry entry--${entry.direction}${entry.status === 'cancelled' ? ' entry--cancelled' : ''}`,
      type: 'button',
      onclick: () => openDetail(entry.id),
    }, [
      el('span', { class: 'entry__parties' }, [
        el('span', { class: `badge badge--${entry.direction}`, text: RICHTUNG[entry.direction] }),
        ' ',
        parties,
        entry.pending ? ' ' : '',
        entry.pending ? el('span', { class: 'badge badge--pending', text: 'nicht übertragen' }) : '',
        entry.status === 'cancelled' ? ' ' : '',
        entry.status === 'cancelled' ? el('span', { class: 'badge', text: 'storniert' }) : '',
      ]),
      el('span', { class: 'entry__right' }, [
        formatDate(entry.shipment_date),
        outgoing ? el('br') : '',
        outgoing ? el('small', { class: 'muted', text: formatMoney(entry.postage_cents) }) : '',
      ]),
      entry.description ? el('span', { class: 'entry__desc', text: entry.description }) : '',
      el('span', { class: 'entry__meta' }, meta.map((m) => el('span', { text: m }))),
    ]),
  ]);
}

function renderList() {
  const visible = state.entries.filter(matchesFilter);
  const list = $('liste');
  list.replaceChildren(...visible.map(renderEntry));
  $('liste-status').textContent = visible.length
    ? `${visible.length} von ${state.entries.length} Sendungen`
    : state.entries.length
      ? 'Keine Sendung passt zu den Filtern.'
      : 'Noch keine Sendung erfasst. Beginnen Sie mit „Sendung erfassen“.';

  const outgoing = visible.filter((e) => e.direction === 'outgoing' && e.status !== 'cancelled');
  const known = outgoing.filter((e) => e.postage_cents !== null && e.postage_cents !== undefined);
  const sum = known.reduce((total, e) => total + e.postage_cents, 0);
  const summary = $('summe');
  if (outgoing.length) {
    summary.hidden = false;
    summary.textContent =
      `Porto der angezeigten Ausgänge: ${formatMoney(sum)} aus ${known.length} Sendungen` +
      (outgoing.length - known.length
        ? ` · ${outgoing.length - known.length} ohne Portoangabe (nicht als 0,00 € gewertet)`
        : '');
  } else {
    summary.hidden = true;
  }

  $('export').href = api.exportUrl({
    query: state.filter.query,
    direction: state.filter.direction,
    date_from: state.filter.date_from,
    date_to: state.filter.date_to,
    shipment_type: state.filter.shipment_type,
  });
}

async function loadEntries({ fromServer = true } = {}) {
  if (fromServer && navigator.onLine) {
    try {
      await refreshFromServer();
      notice('');
    } catch (error) {
      notice(
        error instanceof ApiError && error.status === 401
          ? 'Nicht angemeldet. Der Server hat keine Benutzerkennung erhalten.'
          : `Serverstand konnte nicht geladen werden: ${error.message} Angezeigt wird der lokale Stand.`,
      );
    }
  }
  state.entries = await store.allEntries();
  renderList();
  await renderQueueStatus();
}

/* ------------------------------------------------------------------ *
 * Formular
 * ------------------------------------------------------------------ */

function blankForm(direction = 'incoming') {
  return {
    id: uuid(),
    isNew: true,
    version: 0,
    number: null,
    direction,
    sender: { name: '', organisation: '', address: '', contact_id: null },
    recipient: { name: '', organisation: '', address: '', contact_id: null },
    description: '',
    shipment_type: '',
    shipment_date: today(),
    postage_cents: null,
    psp_element: null,
    status: 'active',
    note: '',
    photos: [],
    newPhotos: [],
    ocr: null,
  };
}

function fillForm(form) {
  state.form = form;
  state.dirty = false;
  $('formular-titel').textContent = form.isNew ? 'Sendung erfassen' : 'Sendung bearbeiten';
  $('formular-nummer').textContent = form.number ? `${form.number} · Fassung ${form.version}` : '';
  $('absender-name').value = form.sender.name || '';
  $('absender-org').value = form.sender.organisation || '';
  $('absender-adresse').value = form.sender.address || '';
  $('empfaenger-name').value = form.recipient.name || '';
  $('empfaenger-org').value = form.recipient.organisation || '';
  $('empfaenger-adresse').value = form.recipient.address || '';
  $('beschreibung').value = form.description || '';
  $('art').value = form.shipment_type || '';
  $('datum').value = form.shipment_date || today();
  $('porto').value =
    form.postage_cents === null || form.postage_cents === undefined
      ? ''
      : (form.postage_cents / 100).toFixed(2).replace('.', ',');
  $('psp').value = form.psp_element || '';
  $('grund').value = '';
  $('grund-feld').hidden = form.isNew;
  $('stornieren').hidden = form.isNew || form.status === 'cancelled';
  $('formular-fehler').hidden = true;
  $('ocr-ergebnis').hidden = true;
  $('richtung-warnung').hidden = true;
  $('absender-vorschlaege').replaceChildren();
  $('empfaenger-vorschlaege').replaceChildren();
  applyDirection(form.direction, { silent: true });
  renderPhotoThumbs();
}

function applyDirection(direction, { silent = false } = {}) {
  const form = state.form;
  const outgoing = direction === 'outgoing';

  if (!silent && form.direction !== direction && !outgoing) {
    const hasCosts = $('porto').value.trim() || $('psp').value.trim();
    if (hasCosts) {
      $('richtung-warnung').hidden = false;
      $('porto').value = '';
      $('psp').value = '';
    }
  }
  form.direction = direction;

  for (const button of document.querySelectorAll('[data-richtung-wahl]')) {
    const active = button.dataset.richtungWahl === direction;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-pressed', String(active));
  }
  $('kosten').hidden = !outgoing;
  $('label-absender').textContent = outgoing ? 'Absender (intern)' : 'Absender';
  $('label-empfaenger').textContent = outgoing ? 'Empfänger' : 'Empfänger (intern)';
  $('beteiligte-legende').textContent = outgoing
    ? 'Beteiligte – wichtig ist der Empfänger'
    : 'Beteiligte – wichtig ist der Absender';
}

function readForm() {
  const form = state.form;
  const postage = parsePostage($('porto').value);
  const psp = $('psp').value.trim();
  const outgoing = form.direction === 'outgoing';
  return {
    direction: form.direction,
    sender: {
      name: $('absender-name').value.trim(),
      organisation: $('absender-org').value.trim(),
      address: $('absender-adresse').value.trim(),
      contact_id: form.sender.contact_id || null,
    },
    recipient: {
      name: $('empfaenger-name').value.trim(),
      organisation: $('empfaenger-org').value.trim(),
      address: $('empfaenger-adresse').value.trim(),
      contact_id: form.recipient.contact_id || null,
    },
    description: $('beschreibung').value.trim(),
    shipment_type: $('art').value.trim() || 'Sonstige',
    shipment_date: $('datum').value || today(),
    postage_cents: outgoing ? postage : null,
    psp_element: outgoing && psp ? psp : null,
    status: form.status,
    note: form.note || '',
  };
}

async function saveForm(event) {
  event.preventDefault();
  const form = state.form;
  const error = $('formular-fehler');
  error.hidden = true;

  let data;
  try {
    data = readForm();
  } catch (problem) {
    error.textContent = problem.message;
    error.hidden = false;
    $('porto').focus();
    return;
  }

  if (!data.shipment_date) {
    error.textContent = 'Das Sendungsdatum fehlt.';
    error.hidden = false;
    return;
  }

  const button = $('speichern');
  button.disabled = true;
  try {
    if (form.isNew) {
      await store.putEntry({
        ...data,
        id: form.id,
        number: null,
        version: 1,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        actor: state.session?.actor || 'lokal',
        photos: [],
        pending: 1,
      });
      await store.enqueue({
        op: 'create',
        id: form.id,
        data: { ...data, local_date: today() },
      });
    } else {
      await store.putEntry({
        ...(await store.getEntry(form.id)),
        ...data,
        id: form.id,
        version: form.version,
        pending: 1,
      });
      await store.enqueue({
        op: 'update',
        id: form.id,
        expected_version: form.version,
        reason: $('grund').value.trim(),
        data,
      });
    }

    for (const photo of form.newPhotos) {
      await store.putPhoto({ ...photo, entry_id: form.id, uploaded: 0 });
    }

    state.dirty = false;
    const result = await synchronise({ quiet: true });
    await loadEntries({ fromServer: false });

    if (result.rejected.length) {
      notice(`Der Server hat einen Vorgang zurückgewiesen: ${result.rejected[0].message}`, 'error');
    } else if (result.conflicts.length) {
      notice(
        'Der Eintrag wurde zwischenzeitlich von anderer Stelle geändert. Der Serverstand ist geladen; ' +
          'bitte die Änderung erneut vornehmen.',
      );
    } else {
      notice('');
    }

    if (form.isNew) {
      // Direkt weiter zur nächsten Sendung: das ist der Takt einer Poststelle.
      fillForm(blankForm(form.direction));
      $('absender-name').focus();
      flash(result.offline ? 'Gespeichert. Übertragung folgt, sobald Netz besteht.' : 'Gespeichert.');
    } else {
      show('view-liste');
    }
  } catch (problem) {
    error.textContent = `Speichern fehlgeschlagen: ${problem.message}`;
    error.hidden = false;
  } finally {
    button.disabled = false;
  }
}

function flash(text) {
  notice(text, 'warn');
  window.setTimeout(() => {
    if ($('hinweis').textContent === text) notice('');
  }, 4000);
}

async function openEdit(id) {
  const entry = await store.getEntry(id);
  if (!entry) return;
  fillForm({
    ...blankForm(entry.direction),
    ...entry,
    id: entry.id,
    isNew: false,
    version: entry.version,
    newPhotos: [],
    sender: entry.sender || { name: '', organisation: '', address: '', contact_id: null },
    recipient: entry.recipient || { name: '', organisation: '', address: '', contact_id: null },
  });
  show('view-formular');
}

/* ------------------------------------------------------------------ *
 * Texterkennung
 * ------------------------------------------------------------------ */

async function initOcr() {
  const status = $('ocr-status');
  const engines = await engineStatus();
  const ready = engines.find((e) => e.available);
  if (ready) {
    status.textContent = `Texterkennung bereit: ${ready.name} (${ready.version}). Die Verarbeitung bleibt auf dem Gerät.`;
  } else {
    status.textContent =
      'Keine lokale Texterkennung eingerichtet. Fotografieren ist weiterhin möglich; ' +
      'die Adressfelder werden dann von Hand ausgefüllt. Einrichtung: web/vendor/README.md';
  }
}

async function runOcr(file) {
  const status = $('ocr-status');
  const started = Date.now();
  status.textContent = 'Erkennung läuft …';
  try {
    const result = await recogniseText(file);
    if (!result) {
      status.textContent =
        'Keine lokale Texterkennung verfügbar. Bitte die Felder von Hand ausfüllen.';
      return;
    }
    const parsed = parseAddress(result.text);
    state.form.ocr = { ...result, parsed };

    $('ocr-text').textContent = result.text || '(kein Text erkannt)';
    $('ocr-herkunft').textContent =
      `${result.source} · ${result.model} · ${result.durationMs} ms · ` +
      `Zuversicht der Erkennung ${(result.confidence * 100).toFixed(0)} %` +
      (parsed.notes.length ? ` · ${parsed.notes.join(' ')}` : '');
    $('ocr-ergebnis').hidden = false;
    $('ocr-ergebnis').open = true;

    applySuggestion(parsed);
    status.textContent = `Erkannt in ${((Date.now() - started) / 1000).toFixed(1)} s. Bitte prüfen und bei Bedarf berichtigen.`;
  } catch (error) {
    status.textContent = `Erkennung fehlgeschlagen: ${error.message}. Bitte von Hand ausfüllen.`;
  }
}

/** Trägt erkannte Angaben in die noch leeren Felder der Gegenseite ein. */
function applySuggestion(parsed) {
  const outgoing = state.form.direction === 'outgoing';
  const prefix = outgoing ? 'empfaenger' : 'absender';
  const targets = {
    name: $(`${prefix}-name`),
    org: $(`${prefix}-org`),
    address: $(`${prefix}-adresse`),
  };

  if (parsed.person && !targets.name.value) targets.name.value = parsed.person;
  if (parsed.organisation && !targets.org.value) targets.org.value = parsed.organisation;
  if (!targets.name.value && parsed.organisation) targets.name.value = parsed.organisation;
  if (parsed.address && !targets.address.value) targets.address.value = parsed.address;
  if (parsed.shipmentType && !$('art').value) $('art').value = parsed.shipmentType;

  if (parsed.returnLine && !outgoing) {
    // Die Rücksendezeile des Fensterumschlags nennt oft den Absender.
    const other = $('absender-adresse');
    if (!other.value) other.value = parsed.returnLine.replace(/\s*[·•]\s*/g, '\n');
  }

  state.dirty = true;
  suggestContacts(prefix);
}

/* ------------------------------------------------------------------ *
 * Kontaktvorschläge
 * ------------------------------------------------------------------ */

let suggestTimer = null;

function suggestContacts(prefix) {
  window.clearTimeout(suggestTimer);
  suggestTimer = window.setTimeout(async () => {
    const container = $(`${prefix}-vorschlaege`);
    const text = [$(`${prefix}-org`).value, $(`${prefix}-name`).value].filter(Boolean).join(' ');
    if (text.trim().length < 3 || !navigator.onLine) {
      container.replaceChildren();
      return;
    }
    try {
      const { suggestions } = await api.suggestContacts(text);
      container.replaceChildren(
        ...suggestions.map(({ score, contact }) =>
          el('button', {
            type: 'button',
            title: `Übereinstimmung ${(score * 100).toFixed(0)} %`,
            text: `${contact.label} übernehmen`,
            onclick: () => takeContact(prefix, contact),
          }),
        ),
      );
    } catch {
      container.replaceChildren();
    }
  }, 350);
}

function takeContact(prefix, contact) {
  $(`${prefix}-name`).value = contact.name || '';
  $(`${prefix}-org`).value = contact.organisation || '';
  $(`${prefix}-adresse`).value = contact.address || '';
  const side = prefix === 'absender' ? 'sender' : 'recipient';
  state.form[side].contact_id = contact.id;
  if (contact.psp_element && !$('psp').value) $('psp').value = contact.psp_element;
  $(`${prefix}-vorschlaege`).replaceChildren();
  state.dirty = true;
}

/* ------------------------------------------------------------------ *
 * Belegfotos
 * ------------------------------------------------------------------ */

function renderPhotoThumbs() {
  const list = $('beleg-liste');
  const form = state.form;
  const items = [
    ...(form.photos || []).map((photo) => ({
      key: photo.id,
      src: api.photoUrl(photo.id),
      saved: true,
      caption: photo.caption,
    })),
    ...(form.newPhotos || []).map((photo) => ({
      key: photo.id,
      src: URL.createObjectURL(photo.blob),
      saved: false,
      caption: photo.filename,
    })),
  ];
  list.replaceChildren(
    ...items.map((item) =>
      el('li', {}, [
        el('img', { src: item.src, alt: item.caption || 'Belegfoto', loading: 'lazy' }),
        item.saved
          ? ''
          : el('button', {
              type: 'button',
              title: 'Foto wieder entfernen',
              'aria-label': 'Foto wieder entfernen',
              text: '×',
              onclick: () => {
                form.newPhotos = form.newPhotos.filter((p) => p.id !== item.key);
                renderPhotoThumbs();
              },
            }),
      ]),
    ),
  );
}

/* ------------------------------------------------------------------ *
 * Detailansicht
 * ------------------------------------------------------------------ */

async function openDetail(id) {
  // Erst leeren: ein stehengebliebener älterer Stand sähe aus wie der aktuelle.
  $('detail-inhalt').replaceChildren(el('p', { class: 'muted', text: 'Wird geladen …' }));
  let entry = await store.getEntry(id);
  if (navigator.onLine && entry && !entry.pending) {
    try {
      entry = { ...(await api.getEntry(id)), pending: 0 };
      await store.putEntry(entry);
    } catch {
      /* lokaler Stand genügt */
    }
  }
  if (!entry) return;

  $('detail-titel').textContent = `${RICHTUNG[entry.direction]} ${entry.number || '(Nummer folgt)'}`;
  const outgoing = entry.direction === 'outgoing';

  const facts = [
    ['Sendungsdatum', formatDate(entry.shipment_date)],
    ['Sendungsart', entry.shipment_type],
    ['Absender', [partyLabel(entry.sender), entry.sender?.address].filter(Boolean).join('\n') || '–'],
    ['Empfänger', [partyLabel(entry.recipient), entry.recipient?.address].filter(Boolean).join('\n') || '–'],
    ['Beschreibung', entry.description || '–'],
    ...(outgoing
      ? [
          ['Porto', formatMoney(entry.postage_cents)],
          ['PSP-Element', entry.psp_element || '–'],
        ]
      : []),
    ['Status', entry.status === 'cancelled' ? 'storniert' : 'gültig'],
    ['Erfasst', `${formatDateTime(entry.created_at)}`],
    ['Zuletzt bearbeitet', `${formatDateTime(entry.updated_at)} durch ${entry.actor || '–'}`],
    ['Kennung', entry.id],
  ];

  const definitions = el('dl', { class: 'detail-grid' });
  for (const [term, value] of facts) {
    definitions.append(el('dt', { text: term }), el('dd', { text: value }));
  }

  const photos = (entry.photos || []).map((photo) =>
    el('li', {}, [
      el('a', { href: api.photoUrl(photo.id), target: '_blank', rel: 'noopener' }, [
        el('img', { src: api.photoUrl(photo.id), alt: photo.caption || 'Belegfoto', loading: 'lazy' }),
      ]),
    ]),
  );

  const history = (entry.history || []).slice().reverse().map((revision) =>
    el('li', {}, [
      el('strong', { text: `Fassung ${revision.version}` }),
      el('span', { class: 'muted', text: `${formatDateTime(revision.recorded_at)} · ${revision.actor}` }),
      revision.reason ? el('span', { text: revision.reason }) : '',
      el('span', {
        class: 'muted',
        text:
          revision.fields.direction === 'outgoing'
            ? `Porto ${formatMoney(revision.fields.postage_cents)} · PSP ${revision.fields.psp_element || '–'}`
            : `${revision.fields.shipment_type} · ${revision.fields.status === 'cancelled' ? 'storniert' : 'gültig'}`,
      }),
    ]),
  );

  $('detail-inhalt').replaceChildren(
    entry.pending
      ? el('p', { class: 'banner banner--warn', text: 'Dieser Eintrag ist noch nicht an den Server übertragen.' })
      : '',
    definitions,
    photos.length ? el('h2', { text: 'Belegfotos' }) : '',
    photos.length ? el('ul', { class: 'thumbs' }, photos) : '',
    el('div', { class: 'actions' }, [
      el('button', { class: 'primary', type: 'button', text: 'Bearbeiten', onclick: () => openEdit(entry.id) }),
      el('button', { class: 'ghost', type: 'button', text: 'Zurück zur Liste', onclick: () => show('view-liste') }),
    ]),
    history.length ? el('h2', { text: 'Änderungshistorie' }) : '',
    history.length ? el('ol', { class: 'history' }, history) : '',
  );
  show('view-detail');
}

/* ------------------------------------------------------------------ *
 * Stornierung
 * ------------------------------------------------------------------ */

async function cancelEntry() {
  const form = state.form;
  const reason = window.prompt(
    'Warum wird die Sendung storniert?\n\nDer Eintrag bleibt mit Begründung erhalten; gelöscht wird nichts.',
  );
  if (!reason || !reason.trim()) return;
  await store.enqueue({ op: 'cancel', id: form.id, expected_version: form.version, reason: reason.trim() });
  const local = await store.getEntry(form.id);
  await store.putEntry({ ...local, status: 'cancelled', pending: 1 });
  await synchronise({ quiet: true });
  await loadEntries({ fromServer: false });
  show('view-liste');
}

/* ------------------------------------------------------------------ *
 * Übertragung
 * ------------------------------------------------------------------ */

async function synchronise({ quiet = false } = {}) {
  const result = await flushQueue();
  if (!quiet) {
    if (result.offline) notice('Keine Verbindung. Die Erfassungen bleiben gespeichert und gehen später hinaus.');
    else if (result.rejected.length) notice(`Zurückgewiesen: ${result.rejected[0].message}`, 'error');
    else if (result.sent) flash(`${result.sent} Vorgang${result.sent > 1 ? 'änge' : ''} übertragen.`);
    else notice('');
  }
  await renderQueueStatus();
  return result;
}

async function renderQueueStatus() {
  const queued = await store.queue();
  const failed = queued.filter((item) => item.attempts > 0);
  $('warteschlange').textContent = queued.length
    ? `${queued.length} Vorgang${queued.length > 1 ? 'änge' : ''} in der Warteschlange` +
      (failed.length ? ` · ${failed.length} mit Rückmeldung: ${failed[0].last_error || ''}` : '')
    : 'Warteschlange leer';
  $('jetzt-uebertragen').hidden = !queued.length;
}

function renderConnection() {
  const pill = $('netz');
  const online = navigator.onLine;
  pill.textContent = online ? 'verbunden' : 'ohne Netz – Erfassung möglich';
  pill.className = `pill ${online ? 'pill--online' : 'pill--offline'}`;
}

/* ------------------------------------------------------------------ *
 * Start
 * ------------------------------------------------------------------ */

function wire() {
  for (const button of document.querySelectorAll('[data-richtung]')) {
    button.addEventListener('click', () => {
      state.filter.direction = button.dataset.richtung;
      for (const other of document.querySelectorAll('[data-richtung]')) {
        other.classList.toggle('is-active', other === button);
      }
      renderList();
    });
  }
  for (const button of document.querySelectorAll('[data-richtung-wahl]')) {
    button.addEventListener('click', () => applyDirection(button.dataset.richtungWahl));
  }
  for (const button of document.querySelectorAll('[data-zurueck]')) {
    button.addEventListener('click', () => {
      if (state.dirty && !window.confirm('Die Eingaben sind noch nicht gespeichert. Verwerfen?')) return;
      state.dirty = false;
      show('view-liste');
    });
  }

  $('suche').addEventListener('input', (e) => {
    state.filter.query = e.target.value.trim();
    renderList();
  });
  $('datum-von').addEventListener('change', (e) => { state.filter.date_from = e.target.value; renderList(); });
  $('datum-bis').addEventListener('change', (e) => { state.filter.date_to = e.target.value; renderList(); });
  $('filter-art').addEventListener('change', (e) => { state.filter.shipment_type = e.target.value; renderList(); });
  $('filter-storniert').addEventListener('change', (e) => { state.filter.withCancelled = e.target.checked; renderList(); });
  $('filter-zuruecksetzen').addEventListener('click', () => {
    state.filter = { direction: '', query: '', date_from: '', date_to: '', shipment_type: '', withCancelled: false };
    $('suche').value = '';
    $('datum-von').value = '';
    $('datum-bis').value = '';
    $('filter-art').value = '';
    $('filter-storniert').checked = false;
    document.querySelectorAll('[data-richtung]').forEach((b) => b.classList.toggle('is-active', !b.dataset.richtung));
    renderList();
  });

  $('neu').addEventListener('click', () => {
    fillForm(blankForm(state.filter.direction || 'incoming'));
    show('view-formular');
    $('absender-name').focus();
  });

  $('formular').addEventListener('submit', saveForm);
  $('formular').addEventListener('input', () => { state.dirty = true; });
  $('stornieren').addEventListener('click', cancelEntry);
  $('jetzt-uebertragen').addEventListener('click', () => synchronise());

  $('absender-name').addEventListener('input', () => suggestContacts('absender'));
  $('absender-org').addEventListener('input', () => suggestContacts('absender'));
  $('empfaenger-name').addEventListener('input', () => suggestContacts('empfaenger'));
  $('empfaenger-org').addEventListener('input', () => suggestContacts('empfaenger'));

  $('foto-erkennung').addEventListener('change', async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    await runOcr(file);
    // Das Erkennungsfoto wird nicht gespeichert: es diente nur dem Auslesen.
  });

  $('foto-beleg').addEventListener('change', (event) => {
    const files = [...(event.target.files || [])];
    event.target.value = '';
    for (const file of files) {
      state.form.newPhotos.push({
        id: uuid(),
        blob: file,
        filename: file.name || 'foto.jpg',
        caption: '',
      });
    }
    state.dirty = true;
    renderPhotoThumbs();
  });

  window.addEventListener('online', () => { renderConnection(); synchronise({ quiet: true }); });
  window.addEventListener('offline', renderConnection);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') synchronise({ quiet: true });
  });
  window.addEventListener('beforeunload', (event) => {
    if (state.dirty) event.preventDefault();
  });
}

async function start() {
  wire();
  renderConnection();
  state.form = blankForm();

  try {
    state.session = await api.session();
    $('kennung').textContent = state.session.development_mode
      ? `${state.session.actor} · Entwicklungsmodus ohne Anmeldung`
      : state.session.actor;
    const arten = state.session.shipment_types || [];
    $('arten').replaceChildren(...arten.map((art) => el('option', { value: art })));
    $('filter-art').replaceChildren(
      el('option', { value: '', text: 'Alle Arten' }),
      ...arten.map((art) => el('option', { value: art, text: art })),
    );
    if (state.session.development_mode) {
      notice(
        'Entwicklungsmodus: keine Anmeldung, keine Verschlüsselung. Bitte keine echten Postdaten erfassen.',
      );
    }
  } catch (error) {
    $('kennung').textContent = 'nicht angemeldet';
    notice(`Der Server ist nicht erreichbar (${error.message}). Erfassen ist möglich; die Übertragung folgt später.`);
  }

  const persistence = await requestPersistence();
  $('speicher-info').textContent = persistence.supported
    ? persistence.granted
      ? 'Lokaler Speicher dauerhaft zugesagt'
      : 'Lokaler Speicher nicht dauerhaft zugesagt – vor längeren Offline-Phasen übertragen'
    : 'Lokaler Speicher ohne Dauerzusage';

  await initOcr();
  await loadEntries();
  await synchronise({ quiet: true });

  // Verknüpfungen vom Startbildschirm: ?neu=incoming bzw. ?neu=outgoing
  const wunsch = new URLSearchParams(location.search).get('neu');
  if (wunsch === 'incoming' || wunsch === 'outgoing') {
    fillForm(blankForm(wunsch));
    show('view-formular');
  }

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {
      /* Offlinebetrieb ist dann eingeschränkt, die App läuft trotzdem. */
    });
  }
}

start();
