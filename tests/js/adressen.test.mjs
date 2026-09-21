/**
 * Tests des Adressparsers.
 *
 * Ausführen: node --test tests/js/
 *
 * Die Beispiele sind erfunden und bilden typische Formen deutscher
 * Geschäftspost nach. Echte Sendungen gehören nicht in dieses Repository.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  parseAddress,
  matchPostalLine,
  matchStreetLine,
  looksLikePerson,
  looksLikeOrganisation,
  normalise,
  parseLabel,
  istLesbar,
  ohneAnkerbeschriftung,
} from '../../web/js/adressen.js';

test('Postleitzahlzeile in verschiedenen Schreibweisen', () => {
  assert.deepEqual(matchPostalLine('07743 Jena'), { postalCode: '07743', city: 'Jena', country: '' });
  assert.deepEqual(matchPostalLine('D-07743 Jena'), { postalCode: '07743', city: 'Jena', country: '' });
  assert.deepEqual(matchPostalLine('CH-8001 Zürich'), {
    postalCode: '8001',
    city: 'Zürich',
    country: 'Schweiz',
  });
  assert.equal(matchPostalLine('Bibliotheksplatz 2'), null);
  assert.equal(matchPostalLine('Rechnung 12345'), null);
});

test('Straßen- und Postfachzeile', () => {
  assert.equal(matchStreetLine('Bibliotheksplatz 2').street, 'Bibliotheksplatz 2');
  assert.equal(matchStreetLine('Am Steiger 3 c').street, 'Am Steiger 3 c');
  assert.equal(matchStreetLine('Tiergartenstr. 15-17').street, 'Tiergartenstr. 15-17');
  assert.equal(matchStreetLine('Postfach 10 01 41').street, 'Postfach 10 01 41');
  assert.equal(matchStreetLine('Postfach 10 01 41').isPostBox, true);
  assert.equal(matchStreetLine('07743 Jena'), null);
});

test('Person und Organisation unterscheiden', () => {
  assert.equal(looksLikePerson('Herrn Dr. André Karliczek'), true);
  assert.equal(looksLikePerson('Frau Prof. Dr. Maria Schmitt'), true);
  assert.equal(looksLikePerson('Springer Nature GmbH'), false);
  assert.equal(looksLikeOrganisation('Thüringer Universitäts- und Landesbibliothek'), true);
  assert.equal(looksLikeOrganisation('Springer Nature GmbH'), true);
  assert.equal(looksLikeOrganisation('Anna Beispiel'), false);
});

test('Vollständige Geschäftsanschrift', () => {
  const parsed = parseAddress(
    [
      'Friedrich-Schiller-Universität Jena',
      'Thüringer Universitäts- und Landesbibliothek',
      'Herrn Dr. André Karliczek',
      'Bibliotheksplatz 2',
      '07743 Jena',
    ].join('\n'),
  );
  assert.equal(parsed.postalCode, '07743');
  assert.equal(parsed.city, 'Jena');
  assert.equal(parsed.street, 'Bibliotheksplatz 2');
  assert.match(parsed.organisation, /Friedrich-Schiller-Universität Jena/);
  assert.equal(parsed.person, 'Dr. André Karliczek');
  assert.equal(parsed.confidence, 1);
});

test('Fensterumschlag mit Absenderzeile über der Anschrift', () => {
  const parsed = parseAddress(
    [
      'Springer Nature GmbH · Tiergartenstr. 17 · 69121 Heidelberg',
      'Thüringer Universitäts- und Landesbibliothek',
      'Erwerbung',
      'Bibliotheksplatz 2',
      '07743 Jena',
    ].join('\n'),
  );
  assert.equal(parsed.city, 'Jena');
  assert.match(parsed.returnLine, /Springer Nature/);
  assert.ok(!parsed.address.includes('Heidelberg'), 'Absenderzeile gehört nicht in die Anschrift');
});

test('Frankierzeilen und Sendungsnummern werden übergangen', () => {
  const parsed = parseAddress(
    [
      'DEUTSCHE POST',
      'Entgelt bezahlt',
      'EINSCHREIBEN',
      'Musterverlag GmbH',
      'Postfach 10 01 41',
      '10561 Berlin',
      'RR123456789DE',
    ].join('\n'),
  );
  assert.equal(parsed.postalCode, '10561');
  assert.equal(parsed.street, 'Postfach 10 01 41');
  assert.equal(parsed.shipmentType, 'Einschreiben');
  assert.ok(!parsed.address.includes('DEUTSCHE POST'));
  assert.ok(!parsed.address.includes('RR123456789DE'));
});

test('Auslandsanschrift mit Länderzeile', () => {
  const parsed = parseAddress(
    ['Bibliothek der ETH Zürich', 'Rämistrasse 101', 'CH-8092 Zürich', 'Schweiz'].join('\n'),
  );
  assert.equal(parsed.postalCode, '8092');
  assert.equal(parsed.country, 'Schweiz');
  assert.ok(parsed.address.includes('Schweiz'));
});

test('Unvollständige Erkennung erfindet nichts', () => {
  const parsed = parseAddress('unleserlich\n?????');
  assert.equal(parsed.postalCode, '');
  assert.equal(parsed.street, '');
  assert.ok(parsed.confidence < 0.5);
  assert.ok(parsed.notes.length >= 2);
});

test('Leerer Text ergibt leere Felder ohne Fehler', () => {
  const parsed = parseAddress('');
  assert.equal(parsed.confidence, 0);
  assert.equal(parsed.address, '');
  assert.deepEqual(parsed.lines, []);
});

test('Vergleichsform löst Umlaute und Ligaturen auf', () => {
  assert.equal(normalise('Universität Jena'), 'universitat jena');
  assert.equal(normalise('Straße'), 'strasse');
  assert.equal(normalise('FSU  Jena!'), 'fsu jena');
});

test('Paketetikett mit Empfänger ohne Person', () => {
  const parsed = parseAddress(
    ['DHL Paket', 'Universitätsklinikum Jena', 'Am Klinikum 1', '07747 Jena'].join('\n'),
  );
  assert.equal(parsed.shipmentType, 'Paket');
  assert.equal(parsed.person, '');
  assert.match(parsed.organisation, /Universitätsklinikum Jena/);
  assert.equal(parsed.street, 'Am Klinikum 1');
});

// ---------------------------------------------------------------------------
// Paketetiketten
//
// Ein Paketetikett ist kein Fensterumschlag: es benennt die Beteiligten
// ausdrücklich, und es steht viel darauf, was keine Anschrift ist. Die Vorlagen
// unten sind erfunden und bilden nach, was die Texterkennung an einem echten
// Etikett geliefert hat – Strichcodes als Buchstabensalat, Feldbeschriftungen,
// Haftungssätze.
// ---------------------------------------------------------------------------

const ETIKETT_MIT_ANKERN = [
  'DPD Deutschland GmbH',
  'ORT B4 0222',
  'lIl|Ilj 0H8Y',
  'Empfänger:',
  'Musterverlag GmbH',
  'Frau Anna Beispiel',
  'Tiergartenstr. 17',
  '69121 Heidelberg',
  'Absender:',
  'Thüringer Universitäts- und Landesbibliothek',
  'Bibliotheksplatz 2',
  '07743 Jena',
  'Referenz 1: 4711-0815',
  'Gewicht 22,00 kg',
  'Schäden müssen innerhalb von 7 Tagen gemeldet werden',
  '%(0Lj8 W1N',
];

test('Etikett: Beschriftungen trennen Empfänger und Absender', () => {
  const ergebnis = parseLabel(ETIKETT_MIT_ANKERN.join('\n'));
  assert.equal(ergebnis.ankerGefunden, true);
  assert.equal(ergebnis.empfaenger.postalCode, '69121');
  assert.equal(ergebnis.empfaenger.city, 'Heidelberg');
  assert.match(ergebnis.empfaenger.organisation, /Musterverlag GmbH/);
  assert.equal(ergebnis.empfaenger.person, 'Anna Beispiel');
  assert.equal(ergebnis.absender.postalCode, '07743');
  assert.match(ergebnis.absender.organisation, /Landesbibliothek/);
});

test('Etikett: Frachtführer, Feldbeschriftungen und Fließtext bleiben draußen', () => {
  const ergebnis = parseLabel(ETIKETT_MIT_ANKERN.join('\n'));
  const felder = [
    ergebnis.empfaenger.address,
    ergebnis.absender.address,
    ergebnis.empfaenger.organisation,
    ergebnis.absender.organisation,
  ].join(' | ');
  for (const fremd of ['DPD', 'Referenz', 'Gewicht', 'gemeldet', 'W1N', '0H8Y', 'ORT B4']) {
    assert.ok(!felder.includes(fremd), `„${fremd}“ gehört nicht in ein Adressfeld`);
  }
});

test('Etikett: Buchstabensalat aus Strichcodes fällt durch die Lesbarkeitsprüfung', () => {
  assert.equal(istLesbar('lIl|Ilj 0H8Y'), false);
  assert.equal(istLesbar('%(0Lj8 W1N'), false);
  assert.equal(istLesbar('J U 8 1 k'), false);
  assert.equal(istLesbar('0207'), false);
  assert.equal(istLesbar('Musterverlag GmbH'), true);
  assert.equal(istLesbar('07743 Jena'), true);
  assert.equal(istLesbar('Am Steiger 3'), true);
});

test('Etikett ohne Beschriftungen fällt auf die Umschlagsregel zurück', () => {
  const ergebnis = parseLabel(
    [
      'Springer Nature GmbH · Tiergartenstr. 17 · 69121 Heidelberg',
      'Thüringer Universitäts- und Landesbibliothek',
      'Bibliotheksplatz 2',
      '07743 Jena',
    ].join('\n'),
  );
  assert.equal(ergebnis.ankerGefunden, false);
  assert.equal(ergebnis.empfaenger.postalCode, '07743');
  assert.equal(ergebnis.absender.postalCode, '69121');
  assert.match(ergebnis.absender.organisation, /Springer Nature/);
});

test('Reines Rauschen füllt nichts', () => {
  const ergebnis = parseLabel(['lIl|Ilj 0H8Y', '%(0Lj8 W1N', 'J U 8 1 k', '0207'].join('\n'));
  assert.equal(ergebnis.empfaenger.address, '');
  assert.equal(ergebnis.absender.address, '');
  assert.equal(ergebnis.empfaenger.confidence, 0);
});

test('Ohne Postleitzahl und Straße wird keine Zeile zur Organisation befördert', () => {
  const parsed = parseAddress(['Sendung wurde sortiert', 'zugestellt am dienstag'].join('\n'));
  assert.equal(parsed.organisation, '');
  assert.equal(parsed.person, '');
  assert.equal(parsed.address, '');
});

test('Etikett: Beschriftung mit Angabe in derselben Zeile', () => {
  const ergebnis = parseLabel(
    [
      'Empfanger: Musterverlag GmbH',        // ohne Umlaut, wie oft erkannt
      'Tiergartenstr. 17',
      '69121 Heidelberg',
      'Absender Landesbibliothek Jena',
      'Bibliotheksplatz 2',
      '07743 Jena',
    ].join('\n'),
  );
  assert.equal(ergebnis.ankerGefunden, true);
  assert.match(ergebnis.empfaenger.organisation, /Musterverlag GmbH/);
  assert.equal(ergebnis.empfaenger.city, 'Heidelberg');
  assert.match(ergebnis.absender.organisation, /Landesbibliothek Jena/);
  assert.equal(ergebnis.absender.city, 'Jena');
});

test('Beschriftungen werden aus markierten Bereichen entfernt', () => {
  const text = ['Empfänger:', 'Musterverlag GmbH', 'Tiergartenstr. 17', '69121 Heidelberg'].join('\n');
  assert.equal(
    ohneAnkerbeschriftung(text),
    ['Musterverlag GmbH', 'Tiergartenstr. 17', '69121 Heidelberg'].join('\n'),
  );
  // Steht hinter der Beschriftung noch etwas, bleibt dieser Rest erhalten.
  assert.equal(ohneAnkerbeschriftung('Absender Landesbibliothek Jena'), 'Landesbibliothek Jena');
  assert.equal(ohneAnkerbeschriftung('Bibliotheksplatz 2'), 'Bibliotheksplatz 2');
});

test('Markierter Bereich: die Anschrift wird zerlegt, die Beschriftung nicht übernommen', () => {
  const parsed = parseAddress(
    ohneAnkerbeschriftung(
      ['Empfanger:', 'Musterverlag GmbH', 'Frau Anna Beispiel', 'Tiergartenstr. 17', '69121 Heidelberg'].join('\n'),
    ),
  );
  assert.equal(parsed.postalCode, '69121');
  assert.equal(parsed.person, 'Anna Beispiel');
  assert.match(parsed.organisation, /Musterverlag GmbH/);
  assert.ok(!parsed.address.includes('mpfanger'));
});

// ---------------------------------------------------------------------------
// Was ein echter Umschlag gelehrt hat
//
// Die Vorlage unten ist erfunden, bildet aber Zug um Zug nach, woran die
// Erkennung an einer echten Sendung scheiterte: Postleitzahl ohne Leerzeichen,
// Einrichtungen im Kompositum, eine Anrede allein auf einer Zeile und ein
// Satzzeichen, das die Erkennung an den Zeilenanfang setzte.
// ---------------------------------------------------------------------------

test('Postleitzahl auch ohne Leerzeichen vor dem Ort', () => {
  assert.deepEqual(matchPostalLine('04109Leipzig'), {
    postalCode: '04109',
    city: 'Leipzig',
    country: '',
  });
  assert.deepEqual(matchPostalLine('04109 Leipzig'), {
    postalCode: '04109',
    city: 'Leipzig',
    country: '',
  });
  // Eine Zahlenfolge ohne Ort bleibt keine Postleitzahlzeile.
  assert.equal(matchPostalLine('04109'), null);
  assert.equal(matchPostalLine('10011 41'), null);
});

test('Einrichtungen werden auch im Kompositum erkannt', () => {
  assert.equal(looksLikeOrganisation('Universitätsbibliothek Ilmenau'), true);
  assert.equal(looksLikeOrganisation('Landesverband Thüringen'), true);
  assert.equal(looksLikeOrganisation('Stadtverwaltung Jena'), true);
  assert.equal(looksLikeOrganisation('Anna Beispiel'), false);
  assert.equal(looksLikeOrganisation('André Karliczek'), false);
});

test('Geschäftspost mit Verband, c/o und Anrede auf eigener Zeile', () => {
  const parsed = parseAddress(
    [
      'Frau',
      'Maria Muster',
      'Deutscher Musterverband e.V.-',
      'Landesverband Sachsen c/o',
      'Stadtbibliothek Leipzig',
      '; Beispielplatz 2',
      '04109Leipzig',
    ].join('\n'),
  );
  assert.equal(parsed.postalCode, '04109');
  assert.equal(parsed.city, 'Leipzig');
  assert.equal(parsed.street, 'Beispielplatz 2', 'Satzzeichen vom Zeilenanfang fallen weg');
  assert.equal(parsed.person, 'Maria Muster');
  assert.match(parsed.organisation, /Stadtbibliothek Leipzig/);
  assert.match(parsed.organisation, /Musterverband/);

  // Das Anschriftenfeld behält die Reihenfolge des Umschlags.
  assert.equal(
    parsed.address,
    [
      'Maria Muster',
      'Deutscher Musterverband e.V.-',
      'Landesverband Sachsen c/o',
      'Stadtbibliothek Leipzig',
      'Beispielplatz 2',
      '04109 Leipzig',
    ].join('\n'),
  );
  // „Frau“ allein auf einer Zeile trägt nichts und gehört in kein Feld.
  assert.ok(!parsed.address.includes('Frau'));
});
