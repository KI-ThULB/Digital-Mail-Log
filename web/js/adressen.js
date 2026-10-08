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

/** Bestandteile, die am Ende eines zusammengesetzten Wortes eine Einrichtung anzeigen. */
const KOMPOSITA = [
  'bibliothek', 'verband', 'universitat', 'hochschule', 'verwaltung', 'klinikum',
  'museum', 'archiv', 'akademie', 'ministerium', 'amt', 'institut', 'druckerei',
  'buchhandlung', 'schule', 'kammer', 'stiftung', 'zentrum', 'werke', 'gesellschaft',
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
    // Satzzeichen an den Rändern stammen aus der Erkennung, nicht vom Umschlag:
    // aus einem Papierrand wird gern ein „;“ vor der Straße oder ein „_“ hinter
    // dem Namen. Punkt, Bindestrich und schließende Klammer bleiben stehen –
    // „e.V.“ und „e.V.-“ (am Zeilenende fortgesetzt) sind bedeutungstragend.
    .map((line) =>
      line
        .replace(/\s+/g, ' ')
        .replace(/^[^\p{L}\p{N}]+/u, '')
        .replace(/[^\p{L}\p{N}.\-)]+$/u, '')
        // „99423 WEN .“ – ein alleinstehender Punkt am Ende gehört zum Rand,
        // nicht zum Ort. „e.V.“ bleibt unberührt, dort klebt der Punkt am Wort.
        .replace(/\s+\.$/u, '')
        .trim(),
    )
    .filter(Boolean);
}

function isNoise(line) {
  return RAUSCHEN.some((pattern) => pattern.test(line));
}

/**
 * Glättet die typischen Verwechslungen der Texterkennung in einer
 * Postleitzahl: O/o/D/Q → 0, I/l → 1, S → 5, B → 8, Z → 2.
 *
 * Nur am Zeilenanfang, nur bei genau fünf Zeichen, nur wenn danach ein Ort
 * oder nichts folgt, und nur wenn mindestens drei echte Ziffern darunter sind.
 * So wird aus „O7749 Jena“ die Postleitzahl 07749, aus „Olbersdorf“ aber
 * nichts. Ohne diese Glättung verschwand die Zeile spurlos: sie war weder
 * Postleitzahl noch Straße noch Kopfzeile und fiel durch jedes Raster.
 */
export function glaetteZiffern(zeile) {
  const treffer = (zeile || '').match(/^([0-9OoDQIlSBZ]{5})(?=[\s-]*[A-Za-zÄÖÜäöüß]|\s*$)/);
  if (!treffer) return zeile;
  const roh = treffer[1];
  if ((roh.match(/\d/g) || []).length < 3) return zeile;
  const zahl = roh
    .replace(/[OoDQ]/g, '0')
    .replace(/[Il]/g, '1')
    .replace(/S/g, '5')
    .replace(/B/g, '8')
    .replace(/Z/g, '2');
  return zahl + zeile.slice(5);
}

/** Sieht die Zeile nach einer – womöglich verstümmelten – Postleitzahl aus? */
function moeglichePostleitzahl(zeile) {
  const geglaettet = glaetteZiffern(zeile);
  if (/^\d{5}$/.test(geglaettet)) return true;
  // Mindestens vier Ziffern und ein Wort: so sieht eine Postleitzahlzeile aus,
  // in die die Erkennung Zeichen hineingelesen hat („0?7#49 Jena“).
  return (geglaettet.match(/\d/g) || []).length >= 4 && /[A-Za-zÄÖÜäöüß]{3,}/.test(geglaettet);
}

/**
 * Führt eine allein stehende Postleitzahl mit der Ortszeile darunter zusammen.
 *
 * Bei großem Abstand zwischen Zahl und Ort trennt die Erkennung gern in zwei
 * Zeilen: „07749“ und „Jena“. Einzeln ist keine davon eine Postleitzahlzeile.
 */
function verbindeGetrenntePostleitzahl(zeilen) {
  const ergebnis = [];
  for (let i = 0; i < zeilen.length; i += 1) {
    const zahl = glaetteZiffern(zeilen[i]);
    const folgende = zeilen[i + 1];
    if (
      /^\d{5}$/.test(zahl) &&
      folgende &&
      /^[A-ZÄÖÜ][A-Za-zÄÖÜäöüß .()/-]{1,40}$/.test(folgende) &&
      folgende.split(/\s+/).length <= 4
    ) {
      ergebnis.push(`${zahl} ${folgende}`);
      i += 1;
    } else {
      ergebnis.push(zeilen[i]);
    }
  }
  return ergebnis;
}

/** Erkennt „07743 Jena“, „D-07743 Jena“, „CH-8001 Zürich“. */
export function matchPostalLine(line) {
  // „07743 Jena“, aber auch „07743Jena“: auf einem echten Umschlag stand das
  // Leerzeichen nicht, und die Erkennung erfindet keines.
  const german =
    line.match(/^(?:(?:d|de)\s*-\s*)?(\d{5})[\s-]*([A-Za-zÄÖÜäöüß].*)$/i) ||
    glaetteZiffern(line).match(/^(\d{5})[\s-]*([A-Za-zÄÖÜäöüß].*)$/);
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
  const alsWort = RECHTSFORMEN.some((form) => {
    const needle = normalise(form);
    return normalised === needle || normalised.includes(` ${needle}`) || normalised.startsWith(`${needle} `);
  });
  if (alsWort) return true;
  // Deutsche Einrichtungen stehen meist im Kompositum: „Universitätsbibliothek“,
  // „Landesverband“, „Stadtverwaltung“. Ohne diese Prüfung fiel auf einem echten
  // Umschlag die Bibliothek durch und landete über eine Auffangregel im Feld.
  return normalised
    .split(' ')
    .some((wort) =>
      KOMPOSITA.some((teil) => wort.length > teil.length && wort.endsWith(teil)),
    );
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

/* ------------------------------------------------------------------ *
 * Durcheinander gelesene Etiketten
 *
 * Die Texterkennung der Fotos-App liest ein Paketetikett spaltenweise und
 * gedrehte Blöcke rückwärts. An einem echten DPD-Etikett kam der Empfänger in
 * drei Teilen heraus: Name und Straße oben, dazwischen der kopfstehende
 * Absenderblock in umgekehrter Zeilenfolge, dann die Anschrift des Depots und
 * erst ganz am Ende, groß gedruckt, „DE-07749 Jena“. Ein Parser, der Zeilen in
 * ihrer Reihenfolge liest, verliert dabei Postleitzahl und Ort.
 *
 * Hier wird deshalb nach Bausteinen sortiert statt nach Reihenfolge:
 * erst der Frachtführer mit seiner eigenen Anschrift heraus, dann der Block
 * an der Beschriftung „Absender“, und was übrig bleibt, ist der Empfänger.
 * ------------------------------------------------------------------ */

/** Straße ohne Hausnummer, wie sie in Firmenanschriften von Depots steht. */
const STRASSE_OHNE_NUMMER = /(str\.?|stra(ß|ss)e|weg|platz|allee|ring|damm|gasse|ufer)$/i;

/** Der Frachtführer selbst als Firma oder Standort, nicht nur sein Logo. */
function istFrachtfuehrerFirma(zeile) {
  return (
    /^depot\b/i.test(zeile) ||
    (FRACHTFUEHRER.test(zeile) && /\b(gmbh|ag|se|kg|depot|niederlassung|hub)\b/i.test(zeile))
  );
}

function bausteinArt(zeile) {
  const anker = ANKER.find((a) => a.muster.test(zeile));
  if (anker) return `anker-${anker.seite}`;
  if (istFrachtfuehrerFirma(zeile) || istFremdzeile(zeile) || isNoise(zeile)) return 'fremd';
  if (matchPostalLine(zeile)) return 'plz';
  if (matchStreetLine(zeile) || STRASSE_OHNE_NUMMER.test(zeile)) return 'strasse';
  return 'name';
}

/**
 * Sammelt einen Adressblock an einer Beschriftung, erst dahinter, dann davor.
 * Der Block ist zusammenhängend und endet, sobald Straße und Postleitzahl
 * beisammen sind oder eine zweite Straße oder Postleitzahl käme.
 */
function sammleAnAnker(bausteine, index) {
  const sammle = (schritt) => {
    const block = [];
    let plz = false;
    let strasse = false;
    for (let i = index + schritt; i >= 0 && i < bausteine.length && block.length < 5; i += schritt) {
      const b = bausteine[i];
      if (b.vergeben || b.art === 'fremd' || b.art.startsWith('anker')) break;
      if ((b.art === 'plz' && plz) || (b.art === 'strasse' && strasse)) break;
      block.push(b);
      if (b.art === 'plz') plz = true;
      if (b.art === 'strasse') strasse = true;
      if (plz && strasse) break;
    }
    return { block, plz };
  };
  const danach = sammle(1);
  const gewaehlt = danach.plz ? danach : sammle(-1);
  if (!gewaehlt.plz) return [];
  // Rückwärts gesammelt heißt: wieder in Lesereihenfolge bringen.
  return gewaehlt === danach ? gewaehlt.block : gewaehlt.block.reverse();
}

/** Ordnet Bausteine so, wie eine Anschrift geschrieben wird. */
function inAnschriftfolge(bausteine) {
  const rang = { name: 0, strasse: 1, plz: 2 };
  return bausteine
    .map((b, i) => ({ b, i }))
    .sort((x, y) => rang[x.b.art] - rang[y.b.art] || x.i - y.i)
    .map(({ b }) => b.zeile)
    .join('\n');
}

/**
 * Zerlegt Text, dessen Zeilen nicht in Anschriftfolge stehen, in beide Seiten.
 *
 * @returns {{empfaenger:object, absender:object, notes:string[]}|null}
 *   ``null``, wenn der Text nur eine Postleitzahl enthält: dann ist er ein
 *   einzelner Adressblock und ``parseAddress`` der richtige Weg.
 */
export function parseVermischt(text) {
  const zeilen = tidy(text).filter(
    (z) => istAnkerzeile(z) || istFremdzeile(z) || isNoise(z) || istLesbar(z) || moeglichePostleitzahl(z),
  );
  const bausteine = zeilen.map((zeile) => ({ zeile, art: bausteinArt(zeile), vergeben: false }));
  if (bausteine.filter((b) => b.art === 'plz').length < 2) return null;

  const notes = [];
  // 1. Die eigene Anschrift des Frachtführers: Straße und Postleitzahl, die
  //    unmittelbar an seiner Firmenzeile stehen.
  for (const [i, b] of bausteine.entries()) {
    if (!istFrachtfuehrerFirma(b.zeile)) continue;
    for (const schritt of [-1, 1]) {
      const paar = [];
      for (let j = i + schritt; j >= 0 && j < bausteine.length && paar.length < 2; j += schritt) {
        const n = bausteine[j];
        if (n.vergeben) break;
        if (n.art === 'fremd') continue;
        if (n.art !== 'plz' && n.art !== 'strasse') break;
        if (paar.some((x) => x.art === n.art)) break;
        paar.push(n);
      }
      if (paar.length === 2) {
        for (const n of paar) n.vergeben = true;
        notes.push(`Anschrift des Frachtführers übergangen (${paar.map((n) => n.zeile).join(', ')}).`);
        break;
      }
    }
  }

  // 2. Die beschrifteten Blöcke.
  const seiten = { empfaenger: [], absender: [] };
  for (const [i, b] of bausteine.entries()) {
    if (!b.art.startsWith('anker-')) continue;
    const seite = b.art.slice('anker-'.length);
    const block = sammleAnAnker(bausteine, i);
    for (const n of block) n.vergeben = true;
    seiten[seite].push(...block);
  }

  // 3. Der Rest gehört der Seite ohne Beschriftung.
  const rest = bausteine.filter((b) => !b.vergeben && ['name', 'strasse', 'plz'].includes(b.art));
  const offen = seiten.empfaenger.length ? 'absender' : 'empfaenger';
  if (!seiten[offen].length && rest.filter((b) => b.art === 'plz').length === 1) {
    seiten[offen] = rest;
    notes.push('Die Zeilen standen nicht in Anschriftfolge und wurden nach Art sortiert.');
  }

  return {
    empfaenger: seiten.empfaenger.length ? parseAddress(inAnschriftfolge(seiten.empfaenger)) : leeresErgebnis(),
    absender: seiten.absender.length ? parseAddress(inAnschriftfolge(seiten.absender)) : leeresErgebnis(),
    notes,
  };
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
  // Eine verstümmelte Postleitzahlzeile („07749“ allein, „0?7#49 Jena“) besteht
  // die Lesbarkeitsprüfung nicht – sie hat zu wenige Buchstaben. Sie darf aber
  // nicht schon hier verschwinden, sonst kommt sie weder ins Feld noch in einen
  // Hinweis. Über der Straße fängt die Kopfzeilenprüfung sie später ab.
  const clean = all.filter(
    (line) => !isNoise(line) && (istLesbar(line) || moeglichePostleitzahl(line)),
  );
  if (all.length !== clean.length) notes.push('Unlesbare Zeilen und Frankierung wurden übergangen.');

  const { returnLine, rest: getrennt } = splitReturnLine(clean);
  if (returnLine) notes.push('Eine Zeile wurde als Absenderangabe des Fensterumschlags gewertet.');
  const rest = verbindeGetrenntePostleitzahl(getrennt);

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
  // Das Anschriftenfeld behält die Reihenfolge des Umschlags. Die Felder für
  // Name und Organisation ordnen ein; die Anschrift bleibt, wie sie dastand.
  const kopfzeilen = [];
  let verworfen = uebergangen;
  for (const line of head) {
    // Über der Straße gelten die strengen Regeln wie bisher: eine Zeile, die nur
    // als mögliche Postleitzahl durchgelassen wurde, ist hier kein Name.
    if (!istLesbar(line)) {
      verworfen += 1;
      continue;
    }
    const { text: ohneAnrede, had } = stripSalutation(line);
    // Eine Zeile, die nur aus „Herrn“ oder „Firma“ besteht, trägt nichts.
    if (had && !ohneAnrede) {
      verworfen += 1;
      continue;
    }
    if (looksLikeOrganisation(line)) {
      organisationLines.push(line);
      kopfzeilen.push(line);
    } else if (looksLikePerson(line)) {
      personLines.push(ohneAnrede);
      kopfzeilen.push(ohneAnrede);
    } else if (verankert && istLesbar(line) && !istFremdzeile(line)) {
      organisationLines.push(line);
      kopfzeilen.push(line);
    } else {
      verworfen += 1;
    }
  }
  if (verworfen) notes.push(`${verworfen} Zeile(n) waren nicht zuzuordnen und blieben außen vor.`);

  // Bleibt nur eine einzige Zeile übrig, ist sie eher die Organisation.
  if (!organisationLines.length && personLines.length > 1) {
    organisationLines.push(personLines.shift());
  }

  // Was unter der Straße steht und keine Postleitzahlzeile ergab, ging früher
  // spurlos verloren – kein Feld, kein Hinweis. Wurde keine Postleitzahl
  // erkannt, bleiben diese Zeilen jetzt in der Anschrift stehen, so wie sie
  // gelesen wurden: dann sieht man, was dort stand, und kann es berichtigen.
  const unterStrasse =
    postalIndex === -1 && streetIndex !== -1
      ? rest.slice(streetIndex + 1).filter((zeile) => istLesbar(zeile) || moeglichePostleitzahl(zeile))
      : [];
  if (unterStrasse.length) {
    notes.push('Die Zeile unter der Straße ließ sich nicht als Postleitzahl und Ort lesen und steht unverändert in der Anschrift.');
  }

  const person = personLines.join(', ');
  const organisation = organisationLines.join(', ');
  const address = [
    ...kopfzeilen,
    street,
    [postalCode, city].filter(Boolean).join(' '),
    ...unterStrasse,
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

/**
 * Zerlegt eine einzeilige Anschrift in ihre Zeilen.
 *
 * Absender stehen auf Briefen oft in einer Zeile: „Musterverein e.V. ·
 * Beispielweg 3 · 99423 Weimar“, mit Mittelpunkt, Gedankenstrich, Komma oder
 * nur mit Leerzeichen getrennt. Gibt ``null`` zurück, wenn sich keine
 * Postleitzahlzeile herauslösen lässt.
 */
export function zerlegeEinzeiler(zeile) {
  const text = (zeile || '').trim();
  if (!/\d{5}\s*[A-Za-zÄÖÜäöüß]/.test(glaetteZiffern(text)) && !/\d{5}\s*[A-Za-zÄÖÜäöüß]/.test(text)) {
    return null;
  }
  for (const trenner of [/\s*[·•]\s*/, /\s+[-–—]\s+/, /\s*;\s*/, /\s*,\s*/, /\s+\/\s+/]) {
    const teile = text.split(trenner).map((t) => t.trim()).filter(Boolean);
    if (teile.length >= 2 && teile.some((t) => matchPostalLine(t))) return teile;
  }
  // Nur Leerzeichen: vor der Postleitzahl trennen, dann die Straße mit
  // Hausnummer vom Namen davor.
  const plz = text.match(/^(.*?)\s+((?:(?:D|DE)\s*-\s*)?\d{5}\s*[A-Za-zÄÖÜäöüß].*)$/);
  if (!plz || !plz[1]) return null;
  const kopf = plz[1];
  const woerter = kopf.split(/\s+/);
  // Die Hausnummer ist das letzte Wort davor.
  if (woerter.length >= 3 && /^\d+\s*[a-zA-Z]?$/.test(woerter[woerter.length - 1])) {
    const nummer = woerter[woerter.length - 1];
    // „Am Steinbruch 12“, „Zur Alten Mühle 3“: das Vorwort gehört zur Straße.
    const VORWORT = /^(am|an|auf|im|in|zum|zur|zu|unter|hinter|vor|bei|beim|alte[nr]?|neue[nr]?|gro(ß|ss)e[nr]?|kleine[nr]?|obere[nr]?|untere[nr]?|st\.?)$/i;
    const mitVorwort = (start) => {
      let b = start;
      while (b > 1 && VORWORT.test(woerter[b - 1])) b -= 1;
      return b;
    };
    // Der Straßenname ist das Wort vor der Hausnummer, samt Vorwörtern. Ist
    // es selbst nur die Endung („Rudolf Breitscheid Straße 4“), gehören bis
    // zu zwei Wörter davor dazu.
    let start = woerter.length - 2;
    if (STRASSENENDUNGEN.includes(woerter[start].toLowerCase())) {
      start = Math.max(1, start - 2);
    }
    const beginn = mitVorwort(start);
    return [woerter.slice(0, beginn).join(' '), `${woerter.slice(beginn, -1).join(' ')} ${nummer}`, plz[2]];
  }
  return [kopf, plz[2]];
}

/**
 * Zerlegt den Text **einer** Seite – einen markierten Bereich, ein Foto nur
 * dieser Seite oder eingefügten Text.
 *
 * Anlass: ein Brief, bei dem der Absenderbereich sauber markiert war. Die
 * einzige Zeile darin war die einzeilige Absenderangabe, und ``parseAddress``
 * legte sie – für den ganzen Umschlag zu Recht – als Rücksendezeile beiseite.
 * Für die Anschrift blieb nichts übrig. Wer eine Seite markiert, meint aber
 * genau diese Zeile.
 */
export function parseSeite(text) {
  const bereinigt = ohneAnkerbeschriftung(text)
    .split('\n')
    .map((z) => z.replace(/^abs(?:ender)?\s*[.:]+\s*/i, '').trim())
    .filter(Boolean);
  const erst = parseAddress(bereinigt.join('\n'));
  if (erst.postalCode) return erst;

  const index = erst.returnLine
    ? bereinigt.findIndex((z) => z === erst.returnLine || erst.returnLine.includes(z))
    : bereinigt.findIndex((z) => zerlegeEinzeiler(z));
  const teile = index === -1 ? zerlegeEinzeiler(erst.returnLine) : zerlegeEinzeiler(bereinigt[index]);
  if (!teile) return erst;

  const zeilen = index === -1 ? teile : [...bereinigt.slice(0, index), ...teile, ...bereinigt.slice(index + 1)];
  const zweit = parseAddress(zeilen.join('\n'));
  if (!zweit.postalCode) return erst;
  zweit.notes = ['Die Anschrift stand in einer Zeile und wurde aufgeteilt.', ...zweit.notes];
  return zweit;
}

/**
 * Schreibt in einer Anschrift den Ort hinter der Postleitzahl neu.
 *
 * Für den Vorschlag der Plausibilitätsprüfung: „99423 WE“ wird zu
 * „99423 Weimar“, alles andere bleibt Zeile für Zeile stehen.
 */
export function ersetzeOrt(text, ort) {
  let getroffen = false;
  const zeilen = tidy(text).map((zeile) => {
    if (getroffen) return zeile;
    const treffer = matchPostalLine(zeile);
    if (!treffer) return zeile;
    getroffen = true;
    const vorsatz = /^(?:d|de)\s*-\s*/i.test(zeile) ? zeile.match(/^(?:d|de)\s*-\s*/i)[0] : '';
    return `${vorsatz}${treffer.postalCode} ${ort}`;
  });
  return zeilen.join('\n');
}

/** Schreibt in einer Anschrift die Postleitzahl neu, der Ort bleibt stehen. */
export function ersetzePostleitzahl(text, plz) {
  let getroffen = false;
  return tidy(text)
    .map((zeile) => {
      if (getroffen) return zeile;
      const treffer = matchPostalLine(zeile);
      if (!treffer) return zeile;
      getroffen = true;
      return `${plz} ${treffer.city}`.trim();
    })
    .join('\n');
}
