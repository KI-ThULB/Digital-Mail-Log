/**
 * Plausibilitätsprüfung der Anschrift gegen eine Postleitzahltabelle.
 *
 * Anlass: die Texterkennung las „WE“, wo „WEIMAR“ stand. Die Postleitzahl
 * daneben ist fünfstellig, gut lesbar und eindeutig – sie weiß, wie der Ort
 * heißt. Das ist kein Wissens-, sondern ein Abgleichproblem, und es lässt sich
 * vollständig auf dem Gerät lösen.
 *
 * **Warum kein Kartendienst.** Eine Abfrage bei Google oder einem öffentlichen
 * Geokodierdienst trüge die Anschriften echter Post aus dem Haus. Für eine
 * Poststelle verbietet sich das; die Nutzungsbedingungen des öffentlichen
 * Nominatim-Dienstes untersagen systematische Abfragen ohnehin ausdrücklich.
 * Die Tabelle liegt deshalb im eigenen Webverzeichnis (``web/daten/``), stammt
 * von GeoNames unter CC BY 4.0 und wird mit ``werkzeuge/plz-tabelle.py``
 * erzeugt.
 *
 * **Vorgeschlagen, nicht eingesetzt.** Die Prüfung füllt kein Feld. Sie sagt,
 * was die Postleitzahl über den Ort weiß, und bietet die Übernahme an.
 */

import { normalise } from './adressen.js';

const QUELLE = new URL('../daten/plz-orte.txt', import.meta.url);

let tabelle = null;
let laden = null;

/**
 * Lädt die Tabelle einmalig. Fehlt sie, bleibt die Prüfung stumm – sie ist
 * eine Hilfe, keine Voraussetzung.
 */
export async function ladeTabelle(quelle = QUELLE) {
  if (tabelle) return tabelle;
  if (!laden) {
    laden = (async () => {
      const antwort = await fetch(quelle, { cache: 'force-cache' });
      if (!antwort.ok) throw new Error(`Postleitzahltabelle nicht gefunden (${antwort.status})`);
      const gelesen = new Map();
      for (const zeile of (await antwort.text()).split('\n')) {
        if (!zeile || zeile.startsWith('#')) continue;
        const [plz, namen] = zeile.split('\t');
        if (plz && namen) gelesen.set(plz.trim(), namen.trim().split('|'));
      }
      tabelle = gelesen;
      return tabelle;
    })();
  }
  return laden;
}

/** Die Ortsnamen zu einer Postleitzahl, oder ``null``. */
export function orteZu(plz) {
  if (!tabelle || !plz) return null;
  return tabelle.get(String(plz).trim()) || null;
}

/** Ist die Tabelle einsatzbereit? */
export function tabelleBereit() {
  return Boolean(tabelle && tabelle.size);
}

/**
 * Vergleichsform, die Umlaute und ihre Umschreibung gleichsetzt.
 *
 * „München“ und „Muenchen“ sollen dasselbe sein: auf Umschlägen steht beides,
 * und die Texterkennung wechselt ohnehin zwischen den Schreibweisen. Dass dabei
 * ein echtes „oe“ wie in „Soest“ mitgefaltet wird, ist ohne Folgen – beide
 * Seiten werden gleich behandelt.
 */
function falte(text) {
  return normalise(text).replace(/ue/g, 'u').replace(/oe/g, 'o').replace(/ae/g, 'a');
}

/**
 * Beurteilt einen gelesenen Ort gegen die Namen zu seiner Postleitzahl.
 *
 * Reine Funktion, damit sie ohne Netz und ohne Browser prüfbar ist.
 *
 * @returns {{status:'unbekannt'|'stimmt'|'ergaenzen'|'abkuerzung'|'widerspruch',
 *            vorschlag:string}}
 *
 * * ``ergaenzen``  – es wurde kein Ort gelesen, die Postleitzahl kennt einen.
 * * ``abkuerzung`` – das Gelesene ist ein Anfang des Namens („WE“ → „Weimar“).
 *   Das ist der häufige Fall eines abgeschnittenen Ausschnitts.
 * * ``widerspruch`` – beides ist lesbar und passt nicht zueinander. Dann wird
 *   **gesagt**, was nicht zusammenpasst, und nichts stillschweigend geändert:
 *   es kann ebenso gut die Postleitzahl falsch gelesen sein.
 */
export function beurteileOrt(namen, gelesen) {
  const liste = (namen || []).filter(Boolean);
  if (!liste.length) return { status: 'unbekannt', vorschlag: '' };

  const gesucht = falte(gelesen || '');
  if (!gesucht) return { status: 'ergaenzen', vorschlag: liste[0] };

  const verglichen = liste.map((name) => ({ name, vergleich: falte(name) }));
  if (verglichen.some((e) => e.vergleich === gesucht)) {
    return { status: 'stimmt', vorschlag: '' };
  }
  // Ein längerer gelesener Ort, der mit dem Tabellennamen beginnt, gilt als
  // richtig: „Weimar Nord“ ist kein Widerspruch zu „Weimar“.
  if (verglichen.some((e) => gesucht.startsWith(`${e.vergleich} `) || gesucht.startsWith(e.vergleich))) {
    return { status: 'stimmt', vorschlag: '' };
  }
  const anfang = verglichen.find((e) => e.vergleich.startsWith(gesucht));
  if (anfang) return { status: 'abkuerzung', vorschlag: anfang.name };

  return { status: 'widerspruch', vorschlag: liste[0] };
}

/** Prüft eine zerlegte Anschrift; ohne Tabelle oder ohne Postleitzahl stumm. */
export function pruefeAnschrift({ postalCode, city } = {}) {
  if (!tabelleBereit() || !postalCode) return { status: 'unbekannt', vorschlag: '' };
  return beurteileOrt(orteZu(postalCode), city);
}
