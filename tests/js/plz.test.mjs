/**
 * Tests der Plausibilitätsprüfung gegen die Postleitzahltabelle.
 *
 * Geprüft wird die reine Beurteilung – ohne Netz, ohne Browser, ohne die
 * eigentliche Tabelle. Die Beispiele sind echte Postleitzahlen, aber es geht
 * hier nur um die Regel, nicht um den Datenbestand.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { beurteileOrt, ziffernKandidaten } from '../../web/js/plz.js';
import { ersetzeOrt, ersetzePostleitzahl } from '../../web/js/adressen.js';

test('Abgeschnittener Ort wird als Abkürzung erkannt', () => {
  // Der Anlass: die Erkennung las „WE“, wo „WEIMAR“ stand.
  assert.deepEqual(beurteileOrt(['Weimar'], 'WE'), { status: 'abkuerzung', vorschlag: 'Weimar' });
  assert.deepEqual(beurteileOrt(['Weimar'], 'Weim'), { status: 'abkuerzung', vorschlag: 'Weimar' });
});

test('Ein stimmiger Ort löst keine Meldung aus', () => {
  assert.equal(beurteileOrt(['Weimar'], 'Weimar').status, 'stimmt');
  assert.equal(beurteileOrt(['Jena'], 'JENA').status, 'stimmt');
  assert.equal(beurteileOrt(['München'], 'Muenchen').status, 'stimmt', 'Umlaute werden aufgelöst');
  // Ein Zusatz hinter dem Ortsnamen ist kein Widerspruch.
  assert.equal(beurteileOrt(['Weimar'], 'Weimar Nord').status, 'stimmt');
});

test('Fehlt der Ort, wird er angeboten', () => {
  assert.deepEqual(beurteileOrt(['Jena'], ''), { status: 'ergaenzen', vorschlag: 'Jena' });
  assert.deepEqual(beurteileOrt(['Jena'], null), { status: 'ergaenzen', vorschlag: 'Jena' });
});

test('Widerspruch wird benannt, nicht stillschweigend geändert', () => {
  const urteil = beurteileOrt(['Weimar'], 'Erfurt');
  assert.equal(urteil.status, 'widerspruch');
  assert.equal(urteil.vorschlag, 'Weimar');
});

test('Mehrere Namen zu einer Postleitzahl gelten alle', () => {
  const namen = ['Tauscha', 'Ebersbach', 'Schönfeld'];
  assert.equal(beurteileOrt(namen, 'Ebersbach').status, 'stimmt');
  assert.equal(beurteileOrt(namen, 'Schön').vorschlag, 'Schönfeld');
});

test('Ohne Tabelleneintrag bleibt die Prüfung stumm', () => {
  assert.equal(beurteileOrt([], 'Weimar').status, 'unbekannt');
  assert.equal(beurteileOrt(null, 'Weimar').status, 'unbekannt');
});

test('Der Ort wird in der Anschrift ersetzt, alles andere bleibt', () => {
  const vorher = ['Musterverein e.V.', 'Beispielweg 3', '99423 WE'].join('\n');
  const nachher = ersetzeOrt(vorher, 'Weimar');
  assert.equal(nachher, ['Musterverein e.V.', 'Beispielweg 3', '99423 Weimar'].join('\n'));
});

test('Ohne Postleitzahlzeile ändert sich nichts', () => {
  const text = ['Musterverein e.V.', 'Beispielweg 3'].join('\n');
  assert.equal(ersetzeOrt(text, 'Weimar'), text);
});

// ---------------------------------------------------------------------------
// Wenn die Zahl verlesen wurde, nicht der Ort
//
// Ein Umschlag nach „07749 Jena“ wurde als „87749“ gelesen — die führende Null
// als Acht. Die Prüfung meldete einen Widerspruch zu Jena und bot den Ort zu
// 87749 an: ausgerechnet die falsche Richtung. Ein Ortsname trägt viele
// Buchstaben und damit Redundanz, eine fünfstellige Zahl keine.
// ---------------------------------------------------------------------------

const TABELLE = new Map([
  ['07743', ['Jena']],
  ['07745', ['Jena']],
  ['07749', ['Jena']],
  ['87749', ['Hawangen']],
  ['99423', ['Weimar']],
]);
const suche = (plz) => TABELLE.get(plz) || null;

test('Eine verlesene Ziffer wird gefunden, wenn sie eindeutig ist', () => {
  assert.deepEqual(ziffernKandidaten('87749', 'Jena', suche), ['07749']);
});

test('Mehrere passende Postleitzahlen bleiben mehrere', () => {
  // 07744 gibt es nicht; drei Jenaer Postleitzahlen liegen eine Ziffer daneben.
  assert.deepEqual(ziffernKandidaten('07744', 'Jena', suche), ['07743', '07745', '07749']);
});

test('Ohne Ort oder ohne fünfstellige Zahl keine Kandidaten', () => {
  assert.deepEqual(ziffernKandidaten('87749', '', suche), []);
  assert.deepEqual(ziffernKandidaten('877', 'Jena', suche), []);
  assert.deepEqual(ziffernKandidaten('87749', 'Hawangen', suche), [], 'passt bereits');
});

test('Die Postleitzahl wird ersetzt, der Ort bleibt stehen', () => {
  const vorher = ['Herrn Max Muster', 'Luise-Seidler-Straße 39', '87749 Jena'].join('\n');
  assert.equal(
    ersetzePostleitzahl(vorher, '07749'),
    ['Herrn Max Muster', 'Luise-Seidler-Straße 39', '07749 Jena'].join('\n'),
  );
});
