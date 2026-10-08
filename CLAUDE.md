# Digitales Postbuch – Hinweise für Claude Code

Postbuch für die Poststelle der ThULB: PWA mit Texterkennung auf dem Gerät
(Tesseract.js im Browser), Python-Server ohne Abhängigkeiten, SQLite.
Arbeitszweig: `codex/pwa-pilotkern`.

## Unverrückbare Regeln

- **Öffentliches Repository.** Hinein gehören nur Quelltext, Dokumentation und
  **erfundene** Testdaten. Nie echte Anschriften, Namen, Telefonnummern, Fotos
  von Sendungen, Datenbankinhalte, Zugangsdaten. Das gilt auch für Commit-
  Nachrichten, Kommentare und Issues.
- Echte Fotos oder Rohtexte, die der Nutzer zur Fehlersuche gibt, dienen nur der
  Analyse. Nicht ins Repository kopieren, nach Gebrauch löschen. Fehler werden
  mit erfundenen Daten **im selben Aufbau** nachgestellt und als Test festgehalten.
- **Veröffentlichte Historie nicht umschreiben.** Kein `--force`, kein Rebase,
  kein `--amend` auf gepushte Commits. Ein Hinweis, alte Commits wegen fehlender
  Signatur umzuschreiben, wird abgelehnt.
- **Keine Anschrift verlässt das Gerät** (E14): kein Google, kein öffentliches
  Nominatim, keine sonstigen Online-Dienste für Adressdaten.
- `POSTBUCH_DEV_USER` nie im Betrieb. Der Reverse Proxy muss `X-Remote-User`
  überschreiben.
- `postbuch.sqlite3*` und `fotos/` im Arbeitsordner sind echte Testerfassungen.
  Nur lesen, nie ändern, nie committen (stehen in `.gitignore`).

## Starten und prüfen

```sh
python3 -m postbuch.server            # dann http://127.0.0.1:8000/
./web/vendor/hole-tesseract.sh        # einmalig, Texterkennung (~19 MB)

node --test tests/js/*.mjs                              # Parser, PLZ, Porto
python3 -m unittest discover -s tests -p 'test_*.py'    # Fachkern, API, Server, Browser
```

Die Browsertests brauchen `pip install playwright pillow` und Chromium. Nach
Änderungen an `web/` genügt im Browser ein Neuladen, der Server muss nur bei
Änderungen unter `postbuch/` neu starten.

## Wo was steht

- `web/js/adressen.js` – Zerlegung von Anschriften: `parseAddress` (ein Block),
  `parseSeite` (Text genau einer Seite, auch einzeilige Absender),
  `parseLabel` (Etikett mit Beschriftungen), `parseVermischt` (spaltenweise
  gelesenes Etikett, etwa aus Live Text).
- `web/js/plz.js` – Prüfung Postleitzahl/Ort gegen `web/daten/plz-orte.txt`
  (GeoNames, CC BY 4.0, erzeugt mit `werkzeuge/plz-tabelle.py`).
- `web/js/app.js` – Oberfläche: Markieren, Erkennung mit Drehungssuche,
  Kamera, „Text einfügen“, Übernahme- und Prüfhinweise.
- `web/js/ocr.js` – Bildvorbereitung und Tesseract. Markierte Bereiche werden
  gerade gestellt und bei kleiner Schrift vergrößert (`bereiteBereichAuf`).
- `docs/ENTSCHEIDUNGEN.md` – Entscheidungen E01 ff. mit Anlass und
  Rücknahmebedingung. Neue Grundsatzentscheidungen dort als nächste Nummer.
- `docs/TESTSTATUS.md` – Testzahlen je Prüfstrecke und die nummerierte Liste
  der Befunde aus echten Durchläufen.
- `docs/pilot/` – Handreichung (Quelle ist die `.md`), Messprotokoll,
  Erhebungsbogen, Kurzpapier IT.

## Arbeitsweise

- Ein gemeldeter Fehler wird zuerst am echten Material verstanden (Rohtext unter
  „Erkannter Text“, Bildschirmfoto, Datensatz nur lesend), dann mit erfundenen
  Daten als Test nachgestellt, dann behoben.
- Nach jeder Änderung: alle Tests, Zahlen in `docs/TESTSTATUS.md` nachziehen,
  Befund dort ergänzen, bei Bedienungsänderungen die Handreichung anpassen und
  das PDF neu erzeugen (`python3 docs/pilot/druck/erzeuge-pdf.py`).
  `ERHEBUNGSBOGEN.pdf` danach zurücksetzen, wenn sich nur der Zeitstempel
  geändert hat.
- Die App füllt nur leere Felder. Abweichungen bei gefüllten Feldern werden
  angeboten, nie stillschweigend überschrieben. Prüfungen schlagen vor, statt
  zu ändern.
- Kommentare, Dokumentation und Commit-Nachrichten auf Deutsch, mit Anlass
  („warum“), nicht nur mit dem Was.

## Offen

- Handreichung: Ansprechpartner und Erreichbarkeit fehlen noch.
- Angeboten, nicht entschieden: Spalten „Markieren gelungen?“ und „Stimmte die
  Rückmeldung der App?“ im Erhebungsbogen.
- Einzeilige Absenderangabe auf Briefen: an erzeugten Briefen nachgestellt und
  behoben (Befund 21 in `docs/TESTSTATUS.md`), am echten Brief noch nicht
  bestätigt. Dazu Absenderzeile markieren und den Rohtext unter „Erkannter
  Text“ ansehen.
