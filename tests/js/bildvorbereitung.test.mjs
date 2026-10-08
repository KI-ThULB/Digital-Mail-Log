/**
 * Tests der Bildvorbereitung für markierte Bereiche.
 *
 * Geprüft werden die reinen Rechenschritte auf erzeugten Graustufenflächen,
 * ohne Browser und ohne Texterkennung: Linien finden und übermalen,
 * Zeilenhöhe und Schräglage schätzen. Ob die Erkennung danach besser liest,
 * zeigen die Browsertests und am Ende nur das echte Foto.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { entferneLinien, schaetzeZeilenhoehe, schaetzeSchraeglage } from '../../web/js/ocr.js';

const PAPIER = 230;
const TINTE = 30;
const SCHRIFT = { schwelle: 130, papier: PAPIER };

/** Eine helle Fläche als RGBA-Feld mit Malhilfe. */
function flaeche(breite, hoehe) {
  const pixels = new Uint8ClampedArray(breite * hoehe * 4).fill(PAPIER);
  const setze = (x, y, wert = TINTE) => {
    if (x < 0 || y < 0 || x >= breite || y >= hoehe) return;
    const i = (Math.round(y) * breite + Math.round(x)) * 4;
    pixels[i] = wert;
    pixels[i + 1] = wert;
    pixels[i + 2] = wert;
  };
  const lies = (x, y) => pixels[(y * breite + x) * 4];
  return { pixels, setze, lies, breite, hoehe };
}

/**
 * Malt eine „Textzeile“: kurze senkrechte und waagerechte Striche wie von
 * Buchstaben, keiner länger als die Zeile hoch ist.
 */
function zeile(f, x0, y0, laenge, hoch, steigung = 0) {
  for (let x = x0; x < x0 + laenge; x += 1) {
    const versatz = Math.round((x - x0) * steigung);
    const imZeichen = (x - x0) % (hoch + 6) < hoch;
    if (!imZeichen) continue;
    const stamm = (x - x0) % (hoch + 6) < 3;
    for (let y = 0; y < hoch; y += 1) {
      if (stamm || y < 3 || y >= hoch - 3) f.setze(x, y0 + y + versatz);
    }
  }
}

// Anlass: am echten Paketetikett lag die Kastenlinie unter der Zeile mit
// Postleitzahl und Ort mit im markierten Bereich, rechts eine senkrechte.
test('Kastenlinien werden übermalt, die Schrift bleibt', () => {
  const f = flaeche(600, 200);
  zeile(f, 30, 30, 300, 24);
  zeile(f, 30, 130, 300, 24);
  for (let x = 10; x < 590; x += 1) for (let d = 0; d < 3; d += 1) f.setze(x, 170 + d);
  for (let y = 5; y < 195; y += 1) for (let d = 0; d < 3; d += 1) f.setze(520 + d, y);

  const vorher = f.lies(31, 40);
  assert.ok(entferneLinien(f.pixels, f.breite, f.hoehe, SCHRIFT) > 0);
  assert.equal(f.lies(300, 171), PAPIER, 'waagerechte Linie ist weg');
  assert.equal(f.lies(521, 100), PAPIER, 'senkrechte Linie ist weg');
  assert.equal(f.lies(31, 40), vorher, 'der Stamm eines Zeichens steht noch');
  assert.equal(f.lies(40, 31), TINTE, 'der Querstrich eines Zeichens steht noch');
});

test('Ohne Linien wird nichts verändert', () => {
  const f = flaeche(600, 120);
  zeile(f, 30, 40, 400, 30);
  const kopie = f.pixels.slice();
  assert.equal(entferneLinien(f.pixels, f.breite, f.hoehe, SCHRIFT), 0);
  assert.deepEqual(f.pixels, kopie);
});

// Eine einzelne große Zeile, eng markiert: die Striche der Zeichen sind lang,
// aber keine Linien.
test('Große Schrift in engem Rahmen gilt nicht als Linie', () => {
  const f = flaeche(400, 70);
  zeile(f, 10, 10, 380, 50);
  assert.equal(entferneLinien(f.pixels, f.breite, f.hoehe, SCHRIFT), 0);
});

test('Zeilenhöhe: Median der Textzeilen, eine Unterstreichung zählt nicht', () => {
  const f = flaeche(500, 160);
  zeile(f, 20, 20, 300, 12);
  zeile(f, 20, 60, 300, 12);
  zeile(f, 20, 100, 300, 12);
  for (let x = 5; x < 495; x += 1) f.setze(x, 140);
  assert.equal(schaetzeZeilenhoehe(f.pixels, f.breite, f.hoehe), 12);
  assert.equal(schaetzeZeilenhoehe(flaeche(100, 50).pixels, 100, 50), 0, 'leeres Papier');
});

test('Schräglage wird in Betrag und Richtung gefunden', () => {
  for (const grad of [-2, -1, 1.5, 3]) {
    const f = flaeche(700, 220);
    const steigung = Math.tan((grad * Math.PI) / 180);
    zeile(f, 30, 70, 600, 14, steigung);
    zeile(f, 30, 120, 600, 14, steigung);
    const gemessen = schaetzeSchraeglage(f.pixels, f.breite, f.hoehe);
    assert.ok(Math.abs(gemessen - grad) <= 0.4, `${grad}° gemessen als ${gemessen}°`);
  }
  const gerade = flaeche(700, 220);
  zeile(gerade, 30, 70, 600, 14);
  assert.equal(schaetzeSchraeglage(gerade.pixels, gerade.breite, gerade.hoehe), 0);
});
