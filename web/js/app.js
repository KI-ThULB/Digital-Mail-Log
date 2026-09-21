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
import { recogniseText, engineStatus, ladeBild, dreheBild, DREHUNGEN } from './ocr.js';
import { parseAddress, parseLabel, ohneAnkerbeschriftung } from './adressen.js';
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
  interneKontakte: [],
};

/** Die Seite, auf der die eigene Einrichtung steht: beim Ausgang der Absender. */
const interneSeite = () => (state.form?.direction === 'outgoing' ? 'absender' : 'empfaenger');

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

  const intern = outgoing ? 'absender' : 'empfaenger';
  const extern = outgoing ? 'empfaenger' : 'absender';
  $(`${intern}-rolle`).textContent = 'die eigene Einrichtung';
  $(`${extern}-rolle`).textContent = 'auswärtig';
  // Die auswärtige Seite zuerst: sie ist die veränderliche und damit die
  // eigentliche Arbeit. Die eigene Stelle steht meist mit einem Tipp fest.
  $(`partei-${extern}`).style.order = '1';
  $(`partei-${intern}`).style.order = '2';
  $(`merken-${intern}`).hidden = false;
  $(`merken-${extern}`).hidden = true;
  $('beteiligte-legende').textContent = outgoing
    ? 'Beteiligte – wichtig ist der Empfänger'
    : 'Beteiligte – wichtig ist der Absender';
  renderSchnellwahl();
}

/* ------------------------------------------------------------------ *
 * Interne Stellen: Schnellwahl statt Tippen
 * ------------------------------------------------------------------ */

/**
 * Lädt die als intern gekennzeichneten Kontakte.
 *
 * Sie sind der Grund, warum die eigene Seite nicht getippt werden muss: eine
 * Poststelle hat ein gutes Dutzend eigener Stellen, und die ändern sich selten.
 * Der zuletzt geholte Stand bleibt lokal liegen, damit die Schnellwahl auch
 * ohne Verbindung dasteht.
 */
async function ladeInterneKontakte() {
  let liste = (await store.getMeta('interne_kontakte', [])) || [];
  if (navigator.onLine) {
    try {
      const { contacts } = await api.contacts();
      liste = contacts.filter((kontakt) => kontakt.internal);
      await store.setMeta('interne_kontakte', liste);
    } catch {
      /* Serverstand nicht erreichbar – der lokale genügt. */
    }
  }
  state.interneKontakte = liste;
  renderSchnellwahl();
}

function renderSchnellwahl() {
  const intern = interneSeite();
  for (const seite of ['absender', 'empfaenger']) {
    const kasten = $(`${seite}-schnellwahl`);
    if (seite !== intern) {
      kasten.hidden = true;
      kasten.replaceChildren();
      continue;
    }
    if (!state.interneKontakte.length) {
      // Sichtbar bleiben statt zu verschwinden: sonst findet niemand heraus,
      // dass es die Schnellwahl gibt und wie sie sich füllt.
      kasten.hidden = false;
      kasten.replaceChildren(
        el('span', {
          class: 'hint',
          text: 'Noch keine eigene Stelle gemerkt. Angaben unten eintragen und „★ als interne Stelle merken“ drücken — dann steht sie künftig auf einen Fingertipp bereit.',
        }),
      );
      continue;
    }
    const gewaehlt = state.form?.[seite === 'absender' ? 'sender' : 'recipient']?.contact_id;
    kasten.hidden = false;
    kasten.replaceChildren(
      el('span', { class: 'schnellwahl__wort', text: 'Eigene Stelle:' }),
      ...state.interneKontakte.map((kontakt) =>
        el('button', {
          type: 'button',
          // Kurz beschriftet: die Organisation ist bei allen eigenen Stellen
          // dieselbe und würde die Schaltfläche über zwei Zeilen ziehen. Der
          // vollständige Name steht im Tooltip.
          class: `chip${kontakt.id === gewaehlt ? ' is-active' : ''}`,
          title: kontakt.label || '',
          text: kontakt.name || kontakt.organisation,
          onclick: () => takeContact(seite, kontakt),
        }),
      ),
    );
  }
}

/** Merkt die eingetragene Stelle für künftige Erfassungen vor. */
async function merkeAlsIntern(seite) {
  const name = $(`${seite}-name`).value.trim();
  const organisation = $(`${seite}-org`).value.trim();
  if (!name && !organisation) {
    flash('Bitte zuerst Name oder Organisation eintragen.');
    return;
  }
  if (!navigator.onLine) {
    flash('Ohne Verbindung lässt sich keine interne Stelle anlegen.');
    return;
  }
  try {
    const kontakt = await api.saveContact({
      name,
      organisation,
      address: $(`${seite}-adresse`).value.trim(),
      psp_element: $('psp').value.trim() || null,
      internal: true,
    });
    state.form[seite === 'absender' ? 'sender' : 'recipient'].contact_id = kontakt.id;
    await ladeInterneKontakte();
    flash(`„${kontakt.label}“ steht jetzt in der Schnellwahl.`);
  } catch (error) {
    flash(`Konnte nicht gemerkt werden: ${error.message}`);
  }
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

const ZIELWORT = { umschlag: 'Umschlag', absender: 'Absender', empfaenger: 'Empfänger' };

/* ------------------------------------------------------------------ *
 * Bereiche markieren
 *
 * Der Ausschnitt ist die wirksamste Maßnahme überhaupt. An einem echten
 * Paketetikett gemessen: das ganze Etikett wurde mit 28 % Zuversicht in 4,1 s
 * gelesen, der Adressblock allein mit 62 % in 0,5 s. Höhere Auflösung half
 * nicht, der Ausschnitt half achtfach.
 *
 * Deshalb markiert die erfassende Person die Bereiche selbst und sagt durch die
 * Wahl der Seite, **was** dort steht. Damit entfällt das Raten der Zuordnung
 * vollständig: die Erkennung muss nur noch lesen, nicht mehr deuten. Jeder
 * Bereich wird einzeln erkannt – klein, schnell, sicher.
 * ------------------------------------------------------------------ */

const SEITEN = ['empfaenger', 'absender'];

const zuschnitt = {
  blob: null,
  bild: null,
  drehung: 0,
  ziel: 'umschlag',
  rolle: 'empfaenger',
  bereiche: { empfaenger: null, absender: null },
  zug: null,
};

const MINDESTANTEIL = 0.08;
const VORGABEHOEHE = 0.28;

function begrenze(wert, min, max) {
  return Math.max(min, Math.min(max, wert));
}

/** Zeigt das aufgenommene Bild zum Markieren. */
async function zeigeZuschnitt(file, ziel) {
  const bereich = $('zuschnitt');
  try {
    zuschnitt.bild = await ladeBild(file);
  } catch (error) {
    // Lässt sich das Bild nicht anzeigen, wird ohne Markierung erkannt.
    await runOcr(file, ziel);
    return;
  }
  zuschnitt.blob = file;
  zuschnitt.drehung = 0;
  zeichneVorschau();
  zuschnitt.ziel = ziel;
  zuschnitt.bereiche = { empfaenger: null, absender: null };
  zuschnitt.zug = null;
  // Ein Bild, das für eine Seite aufgenommen wurde, kennt nur diese Seite.
  zuschnitt.rolle = ziel === 'umschlag' ? 'empfaenger' : ziel;
  $('zuschnitt-rollen').hidden = ziel !== 'umschlag';
  waehleRolle(zuschnitt.rolle);
  zeichneBereiche();
  bereich.hidden = false;
  bereich.scrollIntoView({ block: 'center', behavior: 'smooth' });
}

/** Zeichnet das aufgenommene Bild in der gewählten Leserichtung. */
function zeichneVorschau() {
  const bild = zuschnitt.bild;
  if (!bild) return;
  const gedreht = zuschnitt.drehung ? dreheBild(bild, zuschnitt.drehung) : bild;
  const breite = gedreht.naturalWidth || gedreht.width;
  const hoehe = gedreht.naturalHeight || gedreht.height;
  const kante = 1200;
  const faktor = Math.min(1, kante / Math.max(breite, hoehe));
  const leinwand = $('zuschnitt-bild');
  leinwand.width = Math.max(1, Math.round(breite * faktor));
  leinwand.height = Math.max(1, Math.round(hoehe * faktor));
  leinwand.getContext('2d').drawImage(gedreht, 0, 0, leinwand.width, leinwand.height);
}

/**
 * Dreht Bild und Markierungen um eine Vierteldrehung im Uhrzeigersinn.
 *
 * Die Markierungen werden mitgedreht, statt verworfen zu werden: wer schon
 * markiert hat und dann merkt, dass das Bild quer liegt, soll nicht von vorn
 * anfangen. Ein Rechteck (x, y, b, h) in Anteilen wird dabei zu
 * (1 − y − h, x, h, b).
 */
function dreheZuschnitt() {
  zuschnitt.drehung = (zuschnitt.drehung + 90) % 360;
  for (const seite of SEITEN) {
    const alt = zuschnitt.bereiche[seite];
    if (!alt) continue;
    zuschnitt.bereiche[seite] = { x: 1 - alt.y - alt.h, y: alt.x, w: alt.h, h: alt.w };
  }
  zeichneVorschau();
  zeichneBereiche();
}

function waehleRolle(rolle) {
  zuschnitt.rolle = rolle;
  for (const knopf of document.querySelectorAll('[data-rolle]')) {
    knopf.classList.toggle('is-active', knopf.dataset.rolle === rolle);
  }
  zeichneBereiche();
}

/** Zeichnet die markierten Bereiche und schreibt den Stand darunter. */
function zeichneBereiche() {
  const buehne = document.querySelector('.zuschnitt__buehne');
  for (const seite of SEITEN) {
    const flaeche = zuschnitt.bereiche[seite];
    let kasten = buehne.querySelector(`[data-bereich="${seite}"]`);
    if (!flaeche) {
      kasten?.remove();
      continue;
    }
    if (!kasten) {
      kasten = el('div', { class: `rahmen rahmen--${seite}`, 'data-bereich': seite }, [
        el('span', { class: 'rahmen__marke', text: ZIELWORT[seite] }),
        ...['nw', 'ne', 'sw', 'se'].map((griff) =>
          el('span', { class: `rahmen__griff rahmen__griff--${griff}`, 'data-griff': griff }),
        ),
      ]);
      buehne.append(kasten);
    }
    kasten.style.left = `${flaeche.x * 100}%`;
    kasten.style.top = `${flaeche.y * 100}%`;
    kasten.style.width = `${flaeche.w * 100}%`;
    kasten.style.height = `${flaeche.h * 100}%`;
    kasten.classList.toggle('rahmen--aktiv', seite === zuschnitt.rolle);
  }

  const markiert = SEITEN.filter((seite) => zuschnitt.bereiche[seite]);
  const fehlt = SEITEN.filter((seite) => !zuschnitt.bereiche[seite]);
  const nurEine = zuschnitt.ziel !== 'umschlag';
  $('zuschnitt-stand').textContent = markiert.length
    ? `Markiert: ${markiert.map((s) => ZIELWORT[s]).join(' und ')}.` +
      (nurEine || !fehlt.length
        ? ''
        : ` ${fehlt.map((s) => ZIELWORT[s]).join(' und ')} fehlt noch – oder ohne erkennen.`)
    : 'Noch nichts markiert: ein Rechteck über die Anschrift ziehen.';
  $('zuschnitt-erkennen').disabled = !markiert.length;
}

function beendeZuschnitt() {
  $('zuschnitt').hidden = true;
  zuschnitt.blob = null;
  zuschnitt.bild = null;
  zuschnitt.zug = null;
  zuschnitt.bereiche = { empfaenger: null, absender: null };
  zeichneBereiche();
}

/** Markieren, Verschieben und Ziehen – mit Maus wie mit dem Finger. */
function wireZuschnitt() {
  const buehne = document.querySelector('.zuschnitt__buehne');

  const anteil = (event) => {
    const box = buehne.getBoundingClientRect();
    return {
      x: begrenze((event.clientX - box.left) / box.width, 0, 1),
      y: begrenze((event.clientY - box.top) / box.height, 0, 1),
    };
  };

  buehne.addEventListener('pointerdown', (event) => {
    if (!zuschnitt.blob) return;
    const punkt = anteil(event);
    const kasten = event.target.closest?.('[data-bereich]');
    const griff = event.target.dataset?.griff;
    if (kasten && griff) {
      zuschnitt.zug = {
        art: 'griff', griff, seite: kasten.dataset.bereich, punkt,
        rahmen: { ...zuschnitt.bereiche[kasten.dataset.bereich] },
      };
    } else if (kasten) {
      zuschnitt.zug = {
        art: 'verschieben', seite: kasten.dataset.bereich, punkt,
        rahmen: { ...zuschnitt.bereiche[kasten.dataset.bereich] },
      };
      waehleRolle(kasten.dataset.bereich);
    } else {
      // Auf freier Fläche beginnt ein neuer Bereich für die gewählte Seite.
      zuschnitt.zug = { art: 'neu', seite: zuschnitt.rolle, punkt, rahmen: null };
      zuschnitt.bereiche[zuschnitt.rolle] = { x: punkt.x, y: punkt.y, w: 0, h: 0 };
    }
    buehne.setPointerCapture?.(event.pointerId);
    event.preventDefault();
  });

  const bewege = (event) => {
    const zug = zuschnitt.zug;
    if (!zug) return;
    const jetzt = anteil(event);
    if (zug.art === 'neu') {
      zuschnitt.bereiche[zug.seite] = {
        x: Math.min(zug.punkt.x, jetzt.x),
        y: Math.min(zug.punkt.y, jetzt.y),
        w: Math.abs(jetzt.x - zug.punkt.x),
        h: Math.abs(jetzt.y - zug.punkt.y),
      };
    } else {
      const alt = zug.rahmen;
      const dx = jetzt.x - zug.punkt.x;
      const dy = jetzt.y - zug.punkt.y;
      if (zug.art === 'verschieben') {
        zuschnitt.bereiche[zug.seite] = {
          ...alt,
          x: begrenze(alt.x + dx, 0, 1 - alt.w),
          y: begrenze(alt.y + dy, 0, 1 - alt.h),
        };
      } else {
        let { x, y, w, h } = alt;
        if (zug.griff.includes('w')) {
          const kante = begrenze(alt.x + dx, 0, alt.x + alt.w - MINDESTANTEIL);
          w = alt.x + alt.w - kante;
          x = kante;
        } else {
          w = begrenze(alt.w + dx, MINDESTANTEIL, 1 - alt.x);
        }
        if (zug.griff.includes('n')) {
          const kante = begrenze(alt.y + dy, 0, alt.y + alt.h - MINDESTANTEIL);
          h = alt.y + alt.h - kante;
          y = kante;
        } else {
          h = begrenze(alt.h + dy, MINDESTANTEIL, 1 - alt.y);
        }
        zuschnitt.bereiche[zug.seite] = { x, y, w, h };
      }
    }
    zeichneBereiche();
    event.preventDefault();
  };

  const ende = () => {
    const zug = zuschnitt.zug;
    zuschnitt.zug = null;
    if (!zug) return;
    // Ein Antippen statt eines Zugs: ein Bereich in Vorgabegröße um den Punkt.
    const flaeche = zuschnitt.bereiche[zug.seite];
    if (flaeche && (flaeche.w < MINDESTANTEIL || flaeche.h < MINDESTANTEIL)) {
      const breite = 0.86;
      zuschnitt.bereiche[zug.seite] = {
        x: begrenze(zug.punkt.x - breite / 2, 0, 1 - breite),
        y: begrenze(zug.punkt.y - VORGABEHOEHE / 2, 0, 1 - VORGABEHOEHE),
        w: breite,
        h: VORGABEHOEHE,
      };
    }
    zeichneBereiche();
  };

  for (const ziel of [buehne, window]) {
    ziel.addEventListener('pointermove', bewege);
    ziel.addEventListener('pointerup', ende);
    ziel.addEventListener('pointercancel', ende);
  }

  for (const knopf of document.querySelectorAll('[data-rolle]')) {
    knopf.addEventListener('click', () => waehleRolle(knopf.dataset.rolle));
  }

  $('zuschnitt-erkennen').addEventListener('click', async () => {
    const aufgabe = SEITEN.filter((seite) => zuschnitt.bereiche[seite]).map((seite) => ({
      seite,
      flaeche: zuschnitt.bereiche[seite],
    }));
    const { blob, drehung } = zuschnitt;
    if (!blob || !aufgabe.length) return;
    beendeZuschnitt();
    await erkenneBereiche(blob, aufgabe, drehung);
  });
  $('zuschnitt-ganz').addEventListener('click', async () => {
    const { blob, ziel, drehung } = zuschnitt;
    if (!blob) return;
    beendeZuschnitt();
    await runOcr(blob, ziel, null, drehung);
  });
  $('zuschnitt-drehen').addEventListener('click', dreheZuschnitt);
  $('zuschnitt-abbrechen').addEventListener('click', () => {
    beendeZuschnitt();
    $('ocr-status').textContent = 'Abgebrochen. Die Felder lassen sich von Hand ausfüllen.';
  });
}

/**
 * Erkennt die markierten Bereiche, einen nach dem anderen.
 *
 * Die Seite steht fest – die erfassende Person hat sie benannt. Deshalb wird
 * hier nicht nach Empfänger und Absender gesucht, sondern nur eine Anschrift
 * zerlegt. Beschriftungen, die mit im Rechteck lagen, werden vorher entfernt.
 */
/** Trägt das Ergebnis genug, um es nicht noch einmal zu versuchen? */
function taugt(result, parsed) {
  return Boolean(result && result.confidence >= 0.6 && (parsed.postalCode || parsed.street));
}

/**
 * Erkennt einen Bereich und sucht dabei die Leserichtung.
 *
 * Eine quer liegende Anschrift ist für die Texterkennung praktisch unlesbar:
 * sie liest nur waagerechte Zeilen und deutet die hochkant stehenden Zeichen
 * einzeln. Herausgekommen ist im Test Buchstabensalat – die Anwendung hatte
 * nicht bemerkt, dass sie den Kopf schief legen müsste.
 *
 * Deshalb: zuerst die eingestellte Richtung. Trägt das Ergebnis, ist es fertig.
 * Sonst werden die übrigen drei Vierteldrehungen versucht und die beste
 * genommen – gemessen an der Zuversicht und daran, ob eine Anschrift
 * herauskommt. Das kostet im ungünstigen Fall drei weitere Durchgänge auf einer
 * kleinen Fläche, und nur dann, wenn es ohnehin schiefgegangen wäre.
 */
async function erkenneMitDrehung(blob, flaeche, anzeige = 0, start = 0) {
  const versuch = async (drehung) => {
    // `rotate` ist die Richtung, in der markiert wurde; `nachdrehen` ist der
    // Versuch. Der Ausschnitt bleibt dadurch genau der markierte.
    const result = await recogniseText(blob, {
      crop: flaeche,
      rotate: anzeige,
      nachdrehen: drehung,
    });
    if (!result) return null;
    const parsed = parseAddress(ohneAnkerbeschriftung(result.text));
    // Eine gefundene Anschrift wiegt schwerer als ein guter Zuversichtswert:
    // gerade gedrehter Text wird gelegentlich selbstbewusst falsch gelesen.
    const guete = result.confidence + (parsed.postalCode ? 1 : 0) + (parsed.street ? 0.5 : 0);
    return { result, parsed, drehung, guete };
  };

  let bester = await versuch(start);
  if (bester && taugt(bester.result, bester.parsed)) return bester;
  for (const drehung of DREHUNGEN.filter((g) => g !== start)) {
    // eslint-disable-next-line no-await-in-loop
    const weiterer = await versuch(drehung);
    if (weiterer && (!bester || weiterer.guete > bester.guete)) bester = weiterer;
    if (bester && taugt(bester.result, bester.parsed) && bester.drehung === drehung) break;
  }
  return bester;
}

async function erkenneBereiche(blob, aufgabe, drehung = 0) {
  const status = $('ocr-status');
  const rohtexte = [];
  const meldungen = [];
  const anmerkungen = [];
  // Die Suchdrehung gilt zusätzlich zur Richtung, in der markiert wurde.
  let richtung = 0;

  for (const [nummer, { seite, flaeche }] of aufgabe.entries()) {
    status.textContent =
      `Erkennung läuft (${ZIELWORT[seite]}${aufgabe.length > 1 ? `, ${nummer + 1} von ${aufgabe.length}` : ''}) …`;
    const begonnen = Date.now();
    try {
      // eslint-disable-next-line no-await-in-loop
      const gelesen = await erkenneMitDrehung(blob, flaeche, drehung, richtung);
      if (!gelesen) {
        status.textContent =
          'Keine lokale Texterkennung verfügbar. Bitte die Felder von Hand ausfüllen.';
        return;
      }
      const { result, parsed } = gelesen;
      // Die gefundene Richtung gilt für den nächsten Bereich als erster Versuch.
      richtung = gelesen.drehung;
      rohtexte.push(`— ${ZIELWORT[seite]} —\n${result.text || '(kein Text erkannt)'}`);
      anmerkungen.push(
        `${ZIELWORT[seite]}: ${result.durationMs} ms · Zuversicht ${(result.confidence * 100).toFixed(0)} %` +
          (gelesen.drehung ? ` · um ${gelesen.drehung}° gedreht gelesen` : '') +
          (parsed.notes.length ? ` · ${parsed.notes.join(' ')}` : ''),
      );
      const dauer = `${((Date.now() - begonnen) / 1000).toFixed(1)} s`;
      if (istBrauchbar(parsed, result, true)) {
        fuelleSeite(seite, parsed);
        if (parsed.shipmentType && !$('art').value) $('art').value = parsed.shipmentType;
        state.dirty = true;
        meldungen.push(
          `${ZIELWORT[seite]}: übernommen (${dauer}` +
            `${gelesen.drehung ? `, um ${gelesen.drehung}° gedreht` : ''}).`,
        );
      } else {
        meldungen.push(`${ZIELWORT[seite]}: nichts Sicheres gelesen (${dauer}) – bitte tippen.`);
      }
      state.form.ocr = { ...result, parsed };
    } catch (error) {
      meldungen.push(`${ZIELWORT[seite]}: Erkennung fehlgeschlagen (${error.message}).`);
    }
  }

  $('ocr-text').textContent = rohtexte.join('\n\n');
  $('ocr-herkunft').textContent = anmerkungen.join(' | ');
  $('ocr-ergebnis').hidden = false;
  $('ocr-ergebnis').open = true;
  status.textContent = `${meldungen.join(' ')} Bitte prüfen und bei Bedarf berichtigen.`;
}

/* ------------------------------------------------------------------ *
 * Angeschlossene Kamera
 *
 * Auf dem Telefon bleibt es beim Dateifeld mit ``capture``: der Zugriff über
 * ``getUserMedia`` gilt auf dem iOS-Startbildschirm als unzuverlässig. Am
 * Arbeitsplatzrechner gilt dieses Argument nicht, und dort steht ein Weg offen,
 * den das Telefon nicht hat: eine angeschlossene Kamera – ein iPhone über
 * Continuity, eine Webcam, eine Kamera über dem Sortiertisch. Die Hände bleiben
 * dann bei der Post, statt ein Telefon zu halten.
 *
 * ``http://127.0.0.1:8000/`` zählt im Browser als sicherer Kontext, obwohl kein
 * TLS im Spiel ist. Deshalb funktioniert der Kamerazugriff auch beim örtlichen
 * Ausprobieren; im Betrieb liegt die App ohnehin hinter TLS.
 * ------------------------------------------------------------------ */

const kamera = { stream: null, geraet: '' };

/** Kamerazugriff gibt es nur im sicheren Kontext und nur, wo der Browser ihn kennt. */
function kameraMoeglich() {
  return Boolean(window.isSecureContext && navigator.mediaDevices?.getUserMedia);
}

async function kameraListe() {
  const auswahl = $('kamera-geraet');
  const geraete = (await navigator.mediaDevices.enumerateDevices()).filter(
    (g) => g.kind === 'videoinput',
  );
  auswahl.replaceChildren(
    ...geraete.map((g, i) =>
      el('option', { value: g.deviceId, text: g.label || `Kamera ${i + 1}` }),
    ),
  );
  auswahl.hidden = geraete.length < 2;
  if (kamera.geraet) auswahl.value = kamera.geraet;
  return geraete;
}

async function kameraStarten(geraet = '') {
  kameraStoppen();
  const wunsch = geraet
    ? { deviceId: { exact: geraet } }
    : { facingMode: { ideal: 'environment' } };
  kamera.stream = await navigator.mediaDevices.getUserMedia({
    // Möglichst hoch auflösend: der Ausschnitt wird später klein, und je mehr
    // Bildpunkte auf der Anschrift liegen, desto besser liest die Erkennung.
    video: { ...wunsch, width: { ideal: 2560 }, height: { ideal: 1440 } },
    audio: false,
  });
  kamera.geraet = geraet;
  const bild = $('kamera-bild');
  bild.srcObject = kamera.stream;
  await bild.play().catch(() => {});
}

function kameraStoppen() {
  for (const spur of kamera.stream?.getTracks() || []) spur.stop();
  kamera.stream = null;
  $('kamera-bild').srcObject = null;
}

function kameraSchliessen() {
  kameraStoppen();
  $('kamera').hidden = true;
}

async function kameraOeffnen() {
  const stand = $('kamera-stand');
  $('kamera').hidden = false;
  stand.textContent = 'Kamera wird geöffnet …';
  try {
    await kameraStarten(kamera.geraet);
    // Die Namen der Geräte nennt der Browser erst, wenn der Zugriff erlaubt ist.
    const geraete = await kameraListe();
    stand.textContent = geraete.length
      ? 'Sendung ins Bild halten und aufnehmen.'
      : 'Keine Kamera gefunden.';
  } catch (error) {
    kameraStoppen();
    stand.textContent =
      error.name === 'NotAllowedError'
        ? 'Der Kamerazugriff wurde abgelehnt. Im Browser erlauben oder den Umschlag fotografieren.'
        : `Kamera nicht verfügbar: ${error.message}`;
  }
}

/** Nimmt das aktuelle Bild ab und übergibt es dem Markieren. */
async function kameraAufnehmen() {
  const bild = $('kamera-bild');
  if (!kamera.stream || !bild.videoWidth) return;
  const leinwand = document.createElement('canvas');
  leinwand.width = bild.videoWidth;
  leinwand.height = bild.videoHeight;
  leinwand.getContext('2d').drawImage(bild, 0, 0);
  const blob = await new Promise((fertig) => leinwand.toBlob(fertig, 'image/png'));
  kameraSchliessen();
  if (blob) await zeigeZuschnitt(blob, 'umschlag');
}

function wireKamera() {
  const knopf = $('kamera-oeffnen');
  if (!kameraMoeglich()) return;
  knopf.hidden = false;
  knopf.addEventListener('click', kameraOeffnen);
  $('kamera-aufnehmen').addEventListener('click', kameraAufnehmen);
  $('kamera-schliessen').addEventListener('click', () => {
    kameraSchliessen();
    $('ocr-status').textContent = 'Kamera geschlossen.';
  });
  $('kamera-geraet').addEventListener('change', async (event) => {
    try {
      await kameraStarten(event.target.value);
      $('kamera-stand').textContent = 'Sendung ins Bild halten und aufnehmen.';
    } catch (error) {
      $('kamera-stand').textContent = `Kamera nicht verfügbar: ${error.message}`;
    }
  });
  // Eine offene Kamera in einer verlassenen Ansicht ist ein Ärgernis: das
  // Lämpchen brennt weiter. Deshalb beim Wechsel der Ansicht schließen.
  for (const knopfZurueck of document.querySelectorAll('[data-zurueck]')) {
    knopfZurueck.addEventListener('click', kameraSchliessen);
  }
  window.addEventListener('pagehide', kameraStoppen);
}

async function runOcr(file, ziel = 'umschlag', crop = null, drehung = 0) {
  const status = $('ocr-status');
  const started = Date.now();
  status.textContent = `Erkennung läuft (${ZIELWORT[ziel]}) …`;
  try {
    // Auch ohne Markierung wird die Leserichtung gesucht: ein quer liegender
    // Umschlag ist sonst unlesbar, und das Bild sagt von sich aus nichts darüber.
    const versuche = DREHUNGEN;
    let result = null;
    let beste = -1;
    let gefunden = 0;
    for (const grad of versuche) {
      // eslint-disable-next-line no-await-in-loop
      const versuch = await recogniseText(file, {
        ...(crop ? { crop } : {}),
        rotate: drehung,
        nachdrehen: grad,
      });
      if (!versuch) break;
      if (versuch.confidence > beste) {
        beste = versuch.confidence;
        result = versuch;
        gefunden = grad;
      }
      if (versuch.confidence >= 0.7) break;
    }
    if (!result) {
      status.textContent =
        'Keine lokale Texterkennung verfügbar. Bitte die Felder von Hand ausfüllen.';
      return;
    }
    // Ein Bild des ganzen Umschlags oder Etiketts wird als Etikett gelesen: mit
    // Beschriftungen als Anker, sonst nach der Umschlagsregel. Ein Bild einer
    // einzelnen Seite ist eine Anschrift und nichts weiter.
    const einzeln = ziel !== 'umschlag';
    const gelesen = einzeln ? parseAddress(result.text) : parseLabel(result.text);
    const haupt = einzeln ? gelesen : gelesen.empfaenger;
    state.form.ocr = { ...result, parsed: haupt, etikett: einzeln ? null : gelesen };

    $('ocr-text').textContent = result.text || '(kein Text erkannt)';
    $('ocr-herkunft').textContent =
      `${result.source} · ${result.model} · ${result.durationMs} ms · ` +
      `Zuversicht der Erkennung ${(result.confidence * 100).toFixed(0)} %` +
      (gefunden ? ` · um ${gefunden}° gedreht gelesen` : '') +
      (gelesen.notes.length ? ` · ${gelesen.notes.join(' ')}` : '');
    $('ocr-ergebnis').hidden = false;
    $('ocr-ergebnis').open = true;

    const uebernommen = applySuggestion(gelesen, ziel, result);
    const dauer = `${((Date.now() - started) / 1000).toFixed(1)} s`;
    status.textContent = uebernommen
      ? `Erkannt in ${dauer}. Bitte prüfen und bei Bedarf berichtigen.`
      : `In ${dauer} gelesen, aber nichts Sicheres gefunden – nichts übernommen. ` +
        'Bitte näher an das Anschriftenfeld gehen, sodass es das Bild füllt, ' +
        'oder die Felder von Hand ausfüllen. Der erkannte Text steht unten.';
  } catch (error) {
    status.textContent = `Erkennung fehlgeschlagen: ${error.message}. Bitte von Hand ausfüllen.`;
  }
}

/** Füllt eine Seite aus einem Erkennungsergebnis, ohne Vorhandenes zu überschreiben. */
function fuelleSeite(seite, quelle) {
  const name = $(`${seite}-name`);
  const organisation = $(`${seite}-org`);
  const anschrift = $(`${seite}-adresse`);
  if (quelle.person && !name.value) name.value = quelle.person;
  if (quelle.organisation && !organisation.value) organisation.value = quelle.organisation;
  if (!name.value && quelle.organisation) name.value = quelle.organisation;
  if (quelle.address && !anschrift.value) anschrift.value = quelle.address;
  suggestContacts(seite);
}

/** Unterhalb dieser Zuversicht muss das Ergebnis für sich sprechen. */
const ERKENNUNGSSCHWELLE = 0.55;

/**
 * Entscheidet, ob ein Ergebnis gut genug ist, um in ein Feld zu wandern.
 *
 * Gemessen an einem echten Paketetikett: das ganze Etikett wurde mit 28 %
 * Zuversicht gelesen, allein der Adressblock mit 62 %. Bei niedriger Zuversicht
 * ist das Ergebnis meist Unsinn – dann wird nur übernommen, was in sich eine
 * Anschrift ergibt: Postleitzahl und dazu Straße, Organisation oder Name.
 * Nichts einzutragen ist besser als etwas Falsches einzutragen.
 */
function istBrauchbar(teil, erkennung, markiert = false) {
  if (!teil) return false;
  if (!teil.address) return false;
  if (erkennung.confidence >= ERKENNUNGSSCHWELLE) return true;
  // Ein markierter Bereich ist eine Aussage: „hier steht die Anschrift“. Dann
  // genügt ein Anker – Postleitzahl oder Straße –, um zu übernehmen. Ohne
  // Markierung muss das Ergebnis für sich eine Anschrift ergeben.
  if (markiert) return Boolean(teil.postalCode || teil.street);
  return Boolean(teil.postalCode && (teil.street || teil.organisation || teil.person));
}

/**
 * Trägt erkannte Angaben ein.
 *
 * @param gelesen   Ergebnis von parseLabel (ganzer Umschlag) oder parseAddress
 *                  (einzelne Seite).
 * @param ziel      'umschlag' für ein Bild des ganzen Umschlags oder Etiketts,
 *                  sonst die gemeinte Seite ('absender' oder 'empfaenger').
 * @param erkennung Rohergebnis der Texterkennung, wegen der Zuversicht.
 * @returns {boolean} true, wenn mindestens ein Feld gefüllt wurde.
 *
 * Beim ganzen Umschlag gilt: **der große Adressblock ist der Empfänger, die
 * kleine Zeile darüber der Absender** – bei Eingang wie bei Ausgang. Das folgt
 * aus der Bauform des Umschlags, nicht aus der Richtung der Sendung. Genau hier
 * lag zuvor ein Fehler: der Hauptblock landete stets beim Absender, bei
 * eingehender Post also die eigene Anschrift auf der falschen Seite. Trägt das
 * Bild ausdrückliche Beschriftungen („Empfänger“, „Absender“), gelten sie vor
 * dieser Regel – ein Paketetikett sagt selbst, wer wer ist.
 */
function applySuggestion(gelesen, ziel = 'umschlag', erkennung = { confidence: 1 }) {
  let etwas = false;
  if (ziel === 'umschlag') {
    if (istBrauchbar(gelesen.empfaenger, erkennung)) {
      fuelleSeite('empfaenger', gelesen.empfaenger);
      etwas = true;
    }
    if (istBrauchbar(gelesen.absender, erkennung)) {
      fuelleSeite('absender', gelesen.absender);
      etwas = true;
    } else if (!gelesen.ankerGefunden && gelesen.empfaenger.returnLine) {
      // Die Rücksendezeile des Fensterumschlags steht in einer Zeile. Ließ sie
      // sich nicht zerlegen, wandert sie unzerlegt in das Anschriftenfeld.
      const zeilen = gelesen.empfaenger.returnLine
        .replace(/\s*[·•]\s*/g, '\n')
        .replace(/\s+[-–]\s+/g, '\n');
      fuelleSeite('absender', { address: zeilen });
      etwas = true;
    }
  } else if (istBrauchbar(gelesen, erkennung)) {
    fuelleSeite(ziel, gelesen);
    etwas = true;
  }

  const art = ziel === 'umschlag' ? gelesen.empfaenger.shipmentType : gelesen.shipmentType;
  if (art && !$('art').value) $('art').value = art;
  if (etwas) state.dirty = true;
  return etwas;
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
  renderSchnellwahl();
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

  for (const seite of ['absender', 'empfaenger']) {
    $(`${seite}-name`).addEventListener('input', () => suggestContacts(seite));
    $(`${seite}-org`).addEventListener('input', () => suggestContacts(seite));
    $(`merken-${seite}`).addEventListener('click', () => merkeAlsIntern(seite));
    $(`foto-${seite}`).addEventListener('change', async (event) => {
      const file = event.target.files?.[0];
      event.target.value = '';
      if (file) await zeigeZuschnitt(file, seite);
    });
  }

  $('foto-erkennung').addEventListener('change', async (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    // Erst der Ausschnitt, dann die Erkennung. Das Erkennungsfoto wird nicht
    // gespeichert: es diente nur dem Auslesen.
    await zeigeZuschnitt(file, 'umschlag');
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
  wireZuschnitt();
  wireKamera();
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
  await ladeInterneKontakte();
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
