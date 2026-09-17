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
];

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
  const clean = all.filter((line) => !isNoise(line));
  if (all.length !== clean.length) notes.push('Zeilen zur Frankierung wurden übergangen.');

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

  const head = rest.slice(0, streetIndex === -1 ? upper : streetIndex);
  const organisationLines = [];
  const personLines = [];
  for (const line of head) {
    if (looksLikeOrganisation(line)) organisationLines.push(line);
    else if (looksLikePerson(line)) personLines.push(stripSalutation(line).text);
    else organisationLines.push(line);
  }

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
