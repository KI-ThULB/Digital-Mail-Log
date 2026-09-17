/**
 * Portobeträge.
 *
 * Gegenstück zu ``parse_postage`` und ``format_postage`` im Fachkern. Beide
 * Seiten werden gegen denselben Prüfkorpus getestet
 * (``tests/konformitaet/porto.json``), damit sie nicht auseinanderlaufen.
 *
 * Festlegungen:
 *
 * * Beträge sind ganzzahlige Cent. Fließkommazahlen kommen nicht vor, weil
 *   0,1 + 0,2 dort nicht 0,3 ergibt und Portosummen darunter leiden.
 * * Leer bedeutet **unbekannt** und ergibt ``null``. ``0`` bedeutet
 *   ausdrücklich portofrei. Diese beiden Zustände bleiben unterscheidbar.
 * * Tausendertrennzeichen werden abgelehnt: „1.000“ ist je nach Lesart
 *   1000 EUR oder 1 EUR. Raten wäre hier die falsche Freundlichkeit.
 */

const MUSTER = /^\d{1,9}([,.]\d{1,2})?$/;

export class PortoFehler extends Error {}

/** @returns {number|null} Cent, oder ``null`` für unbekannt. */
export function parsePostage(input) {
  if (input === null || input === undefined) return null;
  if (typeof input !== 'string') throw new PortoFehler('Porto muss als Text eingegeben werden.');
  const text = input.trim().replace(/\s*€$/, '').trim();
  if (!text) return null;
  if (!MUSTER.test(text)) {
    throw new PortoFehler(
      'Porto als EUR-Betrag ohne Tausendertrennzeichen, höchstens zwei Nachkommastellen, zum Beispiel 1,80.',
    );
  }
  const [whole, fraction = ''] = text.split(/[,.]/);
  return Number(whole) * 100 + Number(fraction.padEnd(2, '0') || '0');
}

/** Anzeigeform ohne Währungszeichen. Unbekannt bleibt leer. */
export function formatPostage(cents) {
  if (cents === null || cents === undefined) return '';
  return `${Math.trunc(cents / 100)},${String(Math.abs(cents % 100)).padStart(2, '0')}`;
}

/** Anzeigeform für die Oberfläche, mit deutlicher Kennzeichnung des Unbekannten. */
export function displayPostage(cents) {
  if (cents === null || cents === undefined) return 'nicht angegeben';
  return `${(cents / 100).toLocaleString('de-DE', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} €`;
}
