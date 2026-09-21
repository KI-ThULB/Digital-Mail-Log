/**
 * Tests der Plausibilitätsprüfung gegen die Postleitzahltabelle.
 *
 * Geprüft wird die reine Beurteilung – ohne Netz, ohne Browser, ohne die
 * eigentliche Tabelle. Die Beispiele sind echte Postleitzahlen, aber es geht
 * hier nur um die Regel, nicht um den Datenbestand.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { beurteileOrt } from '../../web/js/plz.js';
import { ersetzeOrt } from '../../web/js/adressen.js';

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
