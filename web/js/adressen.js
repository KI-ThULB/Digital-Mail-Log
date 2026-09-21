/**
 * Zerlegt erkannten Text in Adressfelder.
 *
 * Bewusst regelbasiert: deutsche Anschriften sind stark genormt, und eine Regel
 * lässt sich prüfen, begründen und korrigieren. Ein Sprachmodell würde hier
 * fehlende Angaben erfinden – genau das darf im Postbuch nicht passieren.
 *
 * Alle Rückgaben sind Vorschläge. Was nicht sicher erkannt wurde, bleibt leer;
 * die erfassende Person bestätigt oder überschreibt.
 */

const RECHTSFORMEN = [
  'gmbh', 'mbh', 'ag', 'kg', 'ohg', 'gbr', 'ug', 'e.v.', 'ev', 'se', 'kgaa',
  'verlag', 'universität', 'universitaet', 'hochschule', 'bibliothek', 'institut',
  'ministerium', 'amt', 'behörde', 'behoerde', 'stiftung', 'verein', 'gesellschaft',
  'akademie', 'archiv', 'museum', 'klinikum', 'kanzlei', 'sparkasse', 'bank',
  'buchhandlung', 'druckerei', 'agentur', 'stadtverwaltung', 'landkreis', 'fakultät',
  'fakultaet', 'dezernat', 'referat', 'abteilung', 'rechenzentrum', 'verbund',
];

const ANREDEN = [
  'herrn', 'herr', 'frau', 'familie', 'firma', 'an', 'z.hd.', 'z. hd.', 'z.h.',
  'zu händen', 'zu haenden', 'c/o', 'co', 'p.a.', 'i.a.',
];

const TITEL = ['dr', 'prof', 'dipl', 'mag', 'ing', 'phd', 'med', 'rer', 'nat', 'phil', 'jur', 'habil'];

const STRASSENENDUNGEN = [
  'straße', 'strasse', 'str.', 'str', 'weg', 'allee', 'platz', 'gasse', 'ring',
  'damm', 'ufer', 'chaussee', 'steig', 'pfad', 'markt', 'hof', 'berg', 'tal', 'graben',
];

/** Beschriftungen, die auf einem Etikett die Beteiligten benennen. */
// Die Umlaute sind nachsichtig geschrieben: die Texterkennung liest „Empfänger“
// auf einem gedruckten Etikett oft als „Empfanger“ oder „Empfaenger“.
// Gruppe 1 ist immer der Rest der Zeile hinter der Beschriftung.
const ANKER = [
  {
    seite: 'empfaenger',
    muster: /^(?:(?:waren)?empf(?:ä|ae|a)nger|lieferanschrift|lieferadresse|zustelladresse|consignee|ship\s*to|deliver(?:y)?\s*(?:address|to))\b[:.]?\s*(.*)$/i,
  },
  {
    seite: 'absender',
    muster: /^(?:absender|versender|retoure|r(?:ü|ue|u)cksendung|sender|shipper|return\s*(?:to|address)|ship\s*from)\b[:.]?\s*(.*)$/i,
  },
];

/** Feldbeschriftungen von Paketetiketten: sie beenden einen Adressblock. */
const ETIKETTENFELD = /^(referenz\s*\d*|ref\.?\s*\d*|lieferung|gewicht|weight|depot|track(ing)?|service|produkt|packst(ü|ue)ck|sendungs?nr|auftrag|kundennr|datum|st(ü|ue)ck|colli|nachnahme|cod)\b/i;

/** Frachtführer: ihre eigene Anschrift auf dem Etikett ist nicht die Beteiligte. */
const FRACHTFUEHRER = /\b(dpd\s*(deutschland)?|deutsche\s*post(\s*ag)?|dhl|ups|gls|hermes|fedex|tnt|dachser|schenker|go!?\s*express|trans-o-flex)\b/i;

/** Fließtext: Haftungs- und Hinweissätze, die auf Etiketten gedruckt sind. */
const FLIESSTEXT = /\b(m(ü|ue)ssen|werden|wurde|k(ö|oe)nnen|innerhalb|gemeldet|haftung|bedingungen|hinweis|bitte\s|has\s+to\s+be|must\s+be|within|reported|according)\b/i;

/** Zeilen, die zur Frankierung oder zum Transport gehören, nicht zur Anschrift. */
const RAUSCHEN = [
  /^deutsche\s*post\b/i,
  /^dhl\b/i,
  /^ups\b/i,
  /^dpd\b/i,
  /^hermes\b/i,
  /^gls\b/i,
  /entgelt\s*bezahlt/i,
  /porto\s*zahlt\s*empf/i,
  /^frankit\b/i,
  /^\d{2}[,.]\d{2}\s*eur?$/i,
  /^(sendungs|track)\w*\.?\s*(nr|nummer|id)/i,
  /^[0-9]{10,}$/,
  /^[A-Z]{2}\s?[0-9]{9}\s?[A-Z]{2}$/,
  /^priority$/i,
  /^prioritaire$/i,
  /^luftpost$/i,
  /^tel\.?\s|^telefon|^fon\b|^mobil\b|^\+\d{2}[\d\s/-]{6,}$/i,
  /^\d+[,.]\d{1,2}\s*kg$/i,
  /^\d+\s*\/\s*\d+$/,
  /delisprint|easylog|zebra|win\b\s*$/i,
  /^[A-Z]{2}-[A-Z]{3}-\d{3,}$/i,
];

/** So viele Zeilen über der Straße werden als Name und Organisation gewertet. */
const KOPFZEILEN = 4;

const SENDUNGSARTEN = [
  [/einschreiben\s*(mit\s*)?r(ü|ue)ckschein/i, 'Einschreiben Rückschein'],
  [/einschreiben\s*eigenh/i, 'Einschreiben'],
  [/\beinschreiben\b/i, 'Einschreiben'],
  [/\bb(ü|ue)chersendung\b/i, 'Brief'],
  [/\bwarensendung\b/i, 'Päckchen'],
  [/\bp(ä|ae)ckchen\b/i, 'Päckchen'],
  [/\bpaket\b/i, 'Paket'],
  [/\bnachnahme\b/i, 'Wertsendung'],
  [/\bwertbrief\b|\bwertsendung\b/i, 'Wertsendung'],
  [/\bkurier\b/i, 'Kurier'],
];

const LAENDER = new Map(Object.entries({
  d: 'Deutschland', de: 'Deutschland', deutschland: 'Deutschland', germany: 'Deutschland',
  a: 'Österreich', at: 'Österreich', österreich: 'Österreich', oesterreich: 'Österreich', austria: 'Österreich',
  ch: 'Schweiz', schweiz: 'Schweiz', switzerland: 'Schweiz', suisse: 'Schweiz',
  nl: 'Niederlande', niederlande: 'Niederlande', netherlands: 'Niederlande',
  f: 'Frankreich', fr: 'Frankreich', frankreich: 'Frankreich', france: 'Frankreich',
  pl: 'Polen', polen: 'Polen', poland: 'Polen',
  cz: 'Tschechien', tschechien: 'Tschechien',
  it: 'Italien', italien: 'Italien', italy: 'Italien',
  gb: 'Vereinigtes Königreich', uk: 'Vereinigtes Königreich',
  us: 'Vereinigte Staaten', usa: 'Vereinigte Staaten',
}));

/** Vergleichsform: ohne Diakritika, klein, einfache Leerzeichen. */
export function normalise(text) {
  return (text || '')
    .toLowerCase()
    .replace(/ß/g, 'ss')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function tidy(text) {
  return (text || '')
    .replace(/\r\n?/g, '\n')
    .replace(/[|¦]/g, '\n')
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

function isNoise(line) {
  return RAUSCHEN.some((pattern) => pattern.test(line));
}

/** Erkennt „07743 Jena“, „D-07743 Jena“, „CH-8001 Zürich“. */
export function matchPostalLine(line) {
  const german = line.match(/^(?:(?:d|de)\s*-\s*)?(\d{5})\s+(.+)$/i);
  if (german) return { postalCode: german[1], city: german[2].trim(), country: '' };
  const foreign = line.match(/^([A-Z]{1,3})\s*-\s*(\d{4,6})\s+(.+)$/i);
  if (foreign) {
    return {
      postalCode: foreign[2],
      city: foreign[3].trim(),
      country: LAENDER.get(foreign[1].toLowerCase()) || foreign[1].toUpperCase(),
    };
  }
  const austrian = line.match(/^(\d{4})\s+([A-ZÄÖÜ][^\d]{2,})$/);
  if (austrian) return { postalCode: austrian[1], city: austrian[2].trim(), country: '' };
  return null;
}

/** Erkennt „Bibliotheksplatz 2“, „Am Steiger 3c“, „Postfach 10 01 41“. */
export function matchStreetLine(line) {
  const box = line.match(/^post(?:fach|schliessfach|schließfach)\s*([\d\s]{2,})$/i);
  if (box) return { street: `Postfach ${box[1].replace(/\s+/g, ' ').trim()}`, isPostBox: true };
  const withNumber = line.match(/^(.+?)\s+(\d+\s*[a-zA-Z]?(?:\s*[-/]\s*\d+\s*[a-zA-Z]?)?)$/);
  if (!withNumber) return null;
  const name = withNumber[1].trim();
  if (/^\d/.test(name) || name.length < 2) return null;
  // Ein Straßenname enthält mindestens ein richtiges Wort. Ohne diese Prüfung
  // liest die Erkennung „J U 8 1 k“ aus einem Strichcode als „Straße J U 8“.
  if (!/(^|\s)[A-Za-zÄÖÜäöüß][A-Za-zÄÖÜäöüß.'-]{2,}(\s|$)/.test(name)) return null;
  const words = normalise(name).split(' ');
  const last = words[words.length - 1] || '';
  const looksLikeStreet =
    STRASSENENDUNGEN.some((ending) => last.endsWith(normalise(ending)) || name.toLowerCase().endsWith(ending)) ||
    /str\.?$/i.test(name) ||
    words.length <= 4;
  if (!looksLikeStreet) return null;
  return { street: `${name} ${withNumber[2].replace(/\s*([-/])\s*/g, '$1')}`, isPostBox: false };
}

function stripSalutation(line) {
  let text = line;
  let had = false;
  for (const word of ANREDEN) {
    const pattern = new RegExp(`^${word.replace(/[.\\/]/g, '\\$&')}\\b[\\s:]*`, 'i');
    if (pattern.test(text)) {
      text = text.replace(pattern, '').trim();
      had = true;
    }
  }
  return { text, had };
}

export function looksLikePerson(line) {
  const { text, had } = stripSalutation(line);
  if (had && text) return true;
  const normalised = normalise(text);
  if (!normalised) return false;
  if (RECHTSFORMEN.some((form) => normalised.includes(normalise(form)))) return false;
  const words = text.split(' ').filter(Boolean);
  if (words.length < 2 || words.length > 5) return false;
  const titled = words.some((w) => TITEL.includes(normalise(w)));
  const capitalised = words.filter((w) => /^[A-ZÄÖÜ]/.test(w)).length >= 2;
  return titled || capitalised;
}

export function looksLikeOrganisation(line) {
  const normalised = normalise(line);
  if (!normalised) return false;
  return RECHTSFORMEN.some((form) => {
    const needle = normalise(form);
    return normalised === needle || normalised.includes(` ${needle}`) || normalised.startsWith(`${needle} `);
  });
}

/**
 * Trennt die Rücksendezeile des Fensterumschlags von der eigentlichen Anschrift.
 * Diese Zeile steht klein über dem Adressfeld und enthält die Anschrift des
 * Absenders in einer Zeile, getrennt durch Punkte, Kommas oder Mittelpunkte.
 */
export function splitReturnLine(lines) {
  const index = lines.findIndex(
    (line) =>
      /\d{5}\s+\S/.test(line) &&
      (line.match(/[·•]/g) || []).length + (line.match(/\s[-–]\s/g) || []).length >= 1 &&
      line.length > 25,
  );
  if (index === -1 || index > 2) return { returnLine: '', rest: lines };
  return { returnLine: lines[index], rest: lines.filter((_, i) => i !== index) };
}

/**
 * Beurteilt, ob eine Zeile überhaupt Adressmaterial sein kann.
 *
 * Texterkennung auf einem Paketetikett liefert neben der Anschrift reichlich
 * Unsinn: Strichcodes und Matrixcodes werden als Buchstabenfolgen „gelesen“.
 * Auf einem echten Etikett standen 83 Zeilen im Ergebnis, brauchbar waren drei.
 * Was diese Prüfung nicht passiert, wird verworfen und in den Anmerkungen
 * gezählt – es landet nie in einem Feld.
 */
export function istLesbar(zeile) {
  const text = (zeile || '').trim();
  if (text.length < 2) return false;
  // Klar erkennbare Formen gelten immer, auch wenn sie kurz sind.
  if (matchPostalLine(text) || matchStreetLine(text)) return true;

  const teile = text.split(/\s+/);
  const wortartig = teile.filter((t) => /^[A-Za-zÄÖÜäöüß][A-Za-zÄÖÜäöüß.''-]+$/.test(t));
  // Ohne ein einziges richtiges Wort ist es kein Name und keine Organisation.
  if (!wortartig.some((t) => t.length >= 4)) return false;
  if (wortartig.length / teile.length < 0.5) return false;
  const einzeln = teile.filter((t) => t.length === 1 && !/\d/.test(t));
  if (einzeln.length * 3 > teile.length) return false;
  const buchstaben = (text.match(/[A-Za-zÄÖÜäöüß]/g) || []).length;
  return buchstaben / text.length >= 0.45;
}

/** Benennt die Zeile eine Seite („Empfänger:“, „Absender“, „Ship to“)? */
export function istAnkerzeile(zeile) {
  return ANKER.some((a) => a.muster.test(zeile));
}

/** Gehört die Zeile zum Frachtführer, zu einem Etikettenfeld oder zu Fließtext? */
export function istFremdzeile(zeile) {
  return (
    ETIKETTENFELD.test(zeile) ||
    FRACHTFUEHRER.test(zeile) ||
    (FLIESSTEXT.test(zeile) && zeile.length > 30)
  );
}

/**
 * Teilt Etikettenzeilen anhand der Beschriftungen „Empfänger“ und „Absender“ auf.
 *
 * Paketetiketten benennen die Beteiligten ausdrücklich. Wo diese Anker lesbar
 * sind, sind sie verlässlicher als jede Annahme über die Anordnung. Ein Block
 * endet beim nächsten Anker oder bei einer Feldbeschriftung wie „Referenz“.
 *
 * @returns {{empfaenger:string[], absender:string[], rest:string[], gefunden:boolean}}
 */
export function segmentiereEtikett(zeilen) {
  const bloecke = { empfaenger: [], absender: [], rest: [] };
  let aktuell = null;
  let gefunden = false;

  for (const zeile of zeilen) {
    const anker = ANKER.map((a) => ({ seite: a.seite, treffer: zeile.match(a.muster) }))
      .find((a) => a.treffer);
    if (anker) {
      gefunden = true;
      aktuell = anker.seite;
      // „Empfänger: Max Mustermann“ – der Rest der Zeile gehört schon dazu.
      const rest = (anker.treffer[1] || '').trim();
      if (rest && istLesbar(rest)) bloecke[aktuell].push(rest);
      continue;
    }
    if (istFremdzeile(zeile)) {
      aktuell = null;
      bloecke.rest.push(zeile);
      continue;
    }
    (aktuell ? bloecke[aktuell] : bloecke.rest).push(zeile);
  }
  return { ...bloecke, gefunden };
}

/**
 * Zerlegt ein Paketetikett in beide Beteiligte.
 *
 * Findet sie die Beschriftungen, folgt sie ihnen. Findet sie keine, fällt sie
 * auf die Umschlagsregel zurück: großer Block Empfänger, kleine Zeile darüber
 * Absender.
 */
export function parseLabel(text) {
  const alle = tidy(text);
  // Ankerzeilen und Feldbeschriftungen tragen selbst keine Anschrift, ordnen aber
  // die Blöcke – sie müssen die Lesbarkeitsprüfung überstehen.
  const lesbar = alle.filter(
    (z) => istAnkerzeile(z) || istFremdzeile(z) || (!isNoise(z) && istLesbar(z)),
  );
  const verworfen = alle.length - lesbar.length;
  const teile = segmentiereEtikett(lesbar);

  if (!teile.gefunden) {
    const ganz = parseAddress(text);
    const rueck = ganz.returnLine
      ? parseAddress(ganz.returnLine.replace(/\s*[·•]\s*/g, '\n').replace(/\s+[-–]\s+/g, '\n'))
      : leeresErgebnis();
    return {
      empfaenger: ganz,
      absender: rueck,
      ankerGefunden: false,
      verworfeneZeilen: verworfen,
      notes: ganz.notes,
    };
  }

  const empfaenger = parseAddress(teile.empfaenger.join('\n'));
  const absender = parseAddress(teile.absender.join('\n'));
  const notes = [];
  if (verworfen) notes.push(`${verworfen} unlesbare Zeilen übergangen.`);
  notes.push('Beschriftungen „Empfänger“ und „Absender“ wurden als Anker genutzt.');
  if (!teile.absender.length) notes.push('Keine Absenderangabe gefunden.');
  return { empfaenger, absender, ankerGefunden: true, verworfeneZeilen: verworfen, notes };
}

function leeresErgebnis() {
  return {
    person: '', organisation: '', street: '', postalCode: '', city: '', country: '',
    address: '', returnLine: '', shipmentType: '', confidence: 0, notes: [], lines: [],
  };
}

/**
 * Hauptfunktion: erkannter Text in Adressfelder.
 *
 * @param {string} text Rohtext aus der Texterkennung oder aus der Zwischenablage.
 * @returns {{person:string,organisation:string,street:string,postalCode:string,
 *            city:string,country:string,address:string,returnLine:string,
 *            shipmentType:string,confidence:number,notes:string[],lines:string[]}}
 */
export function parseAddress(text) {
  const notes = [];
  const all = tidy(text);
  const clean = all.filter((line) => !isNoise(line) && istLesbar(line));
  if (all.length !== clean.length) notes.push('Unlesbare Zeilen und Frankierung wurden übergangen.');

  const { returnLine, rest } = splitReturnLine(clean);
  if (returnLine) notes.push('Eine Zeile wurde als Absenderangabe des Fensterumschlags gewertet.');

  let postalCode = '';
  let city = '';
  let country = '';
  let postalIndex = -1;
  for (let i = rest.length - 1; i >= 0; i -= 1) {
    const hit = matchPostalLine(rest[i]);
    if (hit) {
      ({ postalCode, city, country } = hit);
      postalIndex = i;
      break;
    }
  }

  const tail = postalIndex === -1 ? [] : rest.slice(postalIndex + 1);
  for (const line of tail) {
    const candidate = LAENDER.get(normalise(line).replace(/\s/g, ''));
    if (candidate) country = candidate;
  }

  let street = '';
  let streetIndex = -1;
  const upper = postalIndex === -1 ? rest.length : postalIndex;
  for (let i = upper - 1; i >= 0; i -= 1) {
    const hit = matchStreetLine(rest[i]);
    if (hit) {
      street = hit.street;
      streetIndex = i;
      break;
    }
  }

  // Über der Straße stehen Name und Organisation. Steht dort mehr, ist der
  // Überschuss auf einem Etikett fast immer Beiwerk; die Anschrift steht direkt
  // über der Straße. Deshalb zählen nur die letzten Zeilen des Kopfes.
  const kopfGanz = rest.slice(0, streetIndex === -1 ? upper : streetIndex);
  const head = kopfGanz.slice(-KOPFZEILEN);
  const uebergangen = kopfGanz.length - head.length;

  // Ein Block gilt als verankert, wenn Postleitzahl oder Straße gefunden wurden.
  // Nur dann ist eine nicht eingeordnete Zeile plausibel ein Organisationsname –
  // ohne diesen Anker wäre sie bloß Text, der zufällig über etwas anderem stand.
  const verankert = postalIndex !== -1 || streetIndex !== -1;
  const organisationLines = [];
  const personLines = [];
  let verworfen = uebergangen;
  for (const line of head) {
    if (looksLikeOrganisation(line)) organisationLines.push(line);
    else if (looksLikePerson(line)) personLines.push(stripSalutation(line).text);
    else if (verankert && istLesbar(line) && !istFremdzeile(line)) organisationLines.push(line);
    else verworfen += 1;
  }
  if (verworfen) notes.push(`${verworfen} Zeile(n) waren nicht zuzuordnen und blieben außen vor.`);

  // Bleibt nur eine einzige Zeile übrig, ist sie eher die Organisation.
  if (!organisationLines.length && personLines.length > 1) {
    organisationLines.push(personLines.shift());
  }

  const person = personLines.join(', ');
  const organisation = organisationLines.join(', ');
  const address = [
    ...organisationLines,
    ...personLines,
    street,
    [postalCode, city].filter(Boolean).join(' '),
    country && country !== 'Deutschland' ? country : '',
  ]
    .filter(Boolean)
    .join('\n');

  let shipmentType = '';
  const haystack = all.join(' ');
  for (const [pattern, value] of SENDUNGSARTEN) {
    if (pattern.test(haystack)) {
      shipmentType = value;
      break;
    }
  }

  let confidence = 0;
  if (postalCode && city) confidence += 0.5;
  if (street) confidence += 0.25;
  if (organisation || person) confidence += 0.25;
  if (!clean.length) confidence = 0;

  if (!postalCode) notes.push('Keine Postleitzahl erkannt.');
  if (!street) notes.push('Keine Straße oder Postfach erkannt.');

  return {
    person,
    organisation,
    street,
    postalCode,
    city,
    country,
    address,
    returnLine,
    shipmentType,
    confidence: Math.round(confidence * 100) / 100,
    notes,
    lines: all,
  };
}

/** Kurzes Etikett für Listen und Vorschläge. */
export function label(parsed) {
  return [parsed.organisation, parsed.person].filter(Boolean).join(' · ');
}

/**
 * Entfernt Beschriftungen wie „Empfänger:“ aus dem Text.
 *
 * Wird ein Bereich von Hand markiert, liegt die Beschriftung oft mit im
 * Rechteck. Die Seite ist dann schon bekannt; das Wort selbst gehört in kein
 * Feld. Steht hinter der Beschriftung noch etwas, bleibt dieser Rest erhalten.
 */
export function ohneAnkerbeschriftung(text) {
  return tidy(text)
    .map((zeile) => {
      for (const anker of ANKER) {
        const treffer = zeile.match(anker.muster);
        if (treffer) return (treffer[1] || '').trim();
      }
      return zeile;
    })
    .filter(Boolean)
    .join('\n');
}
