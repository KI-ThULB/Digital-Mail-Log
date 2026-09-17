/**
 * Prüft die Web-App gegen denselben Portokorpus wie den Fachkern.
 *
 * Zweck: zwei Umsetzungen derselben Regel laufen sonst auseinander. Genau das
 * war im ersten Entwurf bereits geschehen, als Fachkern und mobile Fassung
 * unterschiedliche Sendungsarten und unterschiedliche Vorgaben hatten. Der
 * gemeinsame Korpus in tests/konformitaet/ hält beide Seiten zusammen.
 *
 * Ausführen: node --test "tests/js/*.test.mjs"
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { parsePostage, formatPostage, displayPostage, PortoFehler } from '../../web/js/porto.js';

const korpus = JSON.parse(
  readFileSync(fileURLToPath(new URL('../konformitaet/porto.json', import.meta.url)), 'utf-8'),
);

test('gültige Beträge aus dem gemeinsamen Korpus', () => {
  for (const fall of korpus.gueltig) {
    assert.equal(
      parsePostage(fall.eingabe),
      fall.cent,
      `${JSON.stringify(fall.eingabe)} (${fall.warum})`,
    );
  }
});

test('ungültige Beträge aus dem gemeinsamen Korpus', () => {
  for (const fall of korpus.ungueltig) {
    assert.throws(
      () => parsePostage(fall.eingabe),
      PortoFehler,
      `${JSON.stringify(fall.eingabe)} (${fall.warum})`,
    );
  }
});

test('Anzeigeform aus dem gemeinsamen Korpus', () => {
  for (const fall of korpus.anzeige) {
    assert.equal(formatPostage(fall.cent), fall.text, String(fall.cent));
  }
});

test('unbekannt und portofrei bleiben unterscheidbar', () => {
  assert.equal(parsePostage(''), null);
  assert.equal(parsePostage('0'), 0);
  assert.notEqual(parsePostage(''), parsePostage('0'));
  assert.equal(displayPostage(null), 'nicht angegeben');
  assert.equal(displayPostage(0), '0,00 €');
});

test('keine Zahl statt Text', () => {
  assert.throws(() => parsePostage(180), PortoFehler);
  assert.throws(() => parsePostage(1.8), PortoFehler);
  assert.equal(parsePostage(undefined), null);
});

test('Beträge bleiben ganzzahlige Cent', () => {
  // 0,1 + 0,2 ergibt in Fließkomma nicht 0,3. In Cent gerechnet stimmt es.
  const summe = parsePostage('0,10') + parsePostage('0,20');
  assert.equal(summe, 30);
  assert.equal(formatPostage(summe), '0,30');
  assert.equal(Number.isInteger(parsePostage('1,05')), true);
});
