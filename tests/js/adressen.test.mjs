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
