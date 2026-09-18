# Entwicklungs- und Testplan

Stand 17.09.2026. Überarbeitet nach der Entscheidung für eine Web-App
(`docs/ENTSCHEIDUNGEN.md`, E01).

## Wo das Projekt steht

Erreicht ist ein **lauffähiger Pilotkern**: erfassen, fotografieren, lokal
erkennen, speichern, suchen, berichtigen, stornieren, auswerten, exportieren –
auf Telefon, Tablet und Arbeitsplatzbildschirm, auch ohne Netz.

Nicht erreicht und bewusst offen: Anmeldung der Einrichtung (vorbereitet, aber
nicht eingerichtet), Diktat, Praxistest auf echten Geräten, Aufbewahrung und
Löschkonzept.

## Anforderungen

| | Anforderung | Stand |
|---|---|---|
| F01 | Eingang/Ausgang, getrennte Beteiligte, automatische Erfassungszeit | umgesetzt |
| F02 | Fachliches Datum getrennt; unbekannte Beteiligte und Inhalte zulässig | umgesetzt |
| F03 | Sendungsart und Beschreibung getrennt, Tastatureingabe | umgesetzt |
| F03b | Spracheingabe | zurückgestellt, E05 |
| F04 | Kamera-Erkennung für Adressen, Prüfen und Bestätigen, Belegfotos | umgesetzt |
| F05 | Chronologische Liste, kombinierbare Filter, Volltextsuche | umgesetzt |
| F06 | Versionierte Korrekturen und Stornierung, keine unprotokollierte Löschung | umgesetzt |
| F07 | Kontaktliste mit Aliasen, historischer Adressstand je Sendung | umgesetzt |
| F08 | Offline-Erfassung, Wiederanlauf, wiederholbare Übertragung, Konflikte | umgesetzt |
| F09 | Rollen und Rechte auch für Suche, Export und Bilder | umgesetzt, Anmeldung offen |
| F10 | Ausgang: optionales Porto in EUR und optionales PSP-Element | umgesetzt |
| F11 | Export; Portosummen und Auswertung nach PSP-Element | umgesetzt |

**Porto** wird in ganzzahligen Cent gespeichert, nie als Fließkommazahl.
Negative Beträge und mehr als zwei Nachkommastellen sind ungültig. Leer bleibt
unbekannt; 0,00 EUR bedeutet ausdrücklich portofrei. Beide Zustände bleiben in
Anzeige, Export und Auswertung unterscheidbar.

**PSP-Element** bleibt Text, einschließlich führender Nullen. Ohne Vorgaben der
Einrichtung wird kein SAP-Format erfunden. Eine Prüfung gegen freigegebene
Stammdaten kann später ergänzt werden.

**Beim Wechsel von Ausgang auf Eingang** werden vorhandene Kostenfelder
entfernt. Die Oberfläche warnt vorher sichtbar; die früheren Werte bleiben in
der Änderungshistorie.

## Nächste Schritte

### M1 · Praxistest in der Poststelle *(dringend, 2–3 Tage)*

Unterlagen dafür liegen bereit: [Messprotokoll mit Entscheidungsregel](pilot/MESSPROTOKOLL.md),
[Erhebungsbogen](pilot/ERHEBUNGSBOGEN.pdf) und
[Handreichung für die Poststelle](pilot/HANDREICHUNG-POSTSTELLE.md).

Vor jeder weiteren Programmierung. Die Web-App auf einem internen Server, auf
zwei Geräten installiert, eine Woche echte Post – oder, wenn die offenen Punkte
aus `docs/BETRIEB.md` Abschnitt 8 noch nicht geklärt sind, freigegebene
Testsendungen.

Zu messen, nicht zu schätzen:

* **Dauer der Erkennung** auf dem tatsächlichen Gerät, nicht auf dem
  Entwicklungsrechner. Zielmarke: 95 % unter drei Sekunden.
* **Feldgenauigkeit** bei 100 bis 200 Sendungen: Fensterumschläge,
  Paketetiketten, lange Organisationsnamen, ausländische Anschriften, schlechtes
  Licht. Zielmarke: 90 % vollständig richtige Adressfelder bei gut lesbarem
  Druck. Handschrift wird getrennt bewertet.
* **Zeit je Sendung** mit Erkennung gegenüber reinem Tippen. Das ist die Frage,
  die über den Wert der Erkennung entscheidet, und sie ist noch offen.
* **Akku und Erwärmung** über einen Vormittag.
* **Bedienung** durch die Mitarbeitenden der Poststelle, nicht durch die
  Entwicklung: Was fehlt, was stört, was wird missverstanden?

Ergebnis ist eine Entscheidung: bleibt es bei der Web-App, oder rechtfertigen die
Zahlen eine native App?

### M2 · Anmeldung einrichten *(1 Woche, mit der IT)*

Zum Weiterleiten: [Kurzpapier für die IT](pilot/KURZPAPIER-IT.md).

Vorschaltserver mit TLS und der Anmeldung der Einrichtung, Rollendatei,
Prüfung auf Fälschbarkeit des Kopffelds (`docs/BETRIEB.md`, Abschnitt 2).
Ohne diesen Schritt keine echten Postdaten.

### M3 · Betrieb absichern *(1 Woche)*

Sicherung samt geprobter Wiederherstellung, Löschlauf für Fotos nach der
festgelegten Frist, Protokollierung, Verhalten bei Geräteverlust, Aktualisierung
und Rücknahme einer Fassung.

### M4 · Ausbau nach dem Praxistest *(offen)*

Nach Bedarf und nur mit Begründung aus M1:

* Kontaktverzeichnis aus dem Adressbestand der Einrichtung vorbelegen.
* Auswertung nach PSP-Element für die Kostenstellenabrechnung ausbauen.
* Übergabe an die Fachabteilung mit Empfangsbestätigung, falls das Postbuch
  nicht bei der Registrierung enden soll.
* Diktat, falls sich die Beschreibung als Engpass erweist (E05).
* Native App, falls die Erkennung zu langsam ist (E01).

## Test- und Prüfstrategie

| Ebene | Was geprüft wird | Wo |
|---|---|---|
| Fachregeln | Geldformat, unbekannt gegenüber null, PSP-Schreibweisen, Richtung, Datum, Historie, Versionskonflikte | `tests/test_domain.py` |
| Speicherung | Fortschreibung durch Datenbankauslöser, Nummernkreise, wiederholbare Übertragung, Nebenläufigkeit, Fotos, Kontakte | `tests/test_storage.py` |
| Schnittstelle | Rechte, Anmeldung, Konflikte, Warteschlange, Export, Fehlerfälle | `tests/test_api.py` |
| Adresszerlegung | Fensterumschläge, Frankierzeilen, Postfächer, Ausland, unleserliche Vorlagen | `tests/js/adressen.test.mjs` |
| Gleichlauf | Fachkern und Web-App gegen denselben Portokorpus | `tests/konformitaet/porto.json` |
| Oberfläche | Erfassen, Suchen, Berichtigen, Kostenfelder, Erkennung im echten Browser | `tests/test_oberflaeche.py` |
| Gerät | Kamera, Erwärmung, Akku, Startbildschirm-App auf iOS, Erkennungsdauer | **nur am Gerät, M1** |

**Was Tests hier nicht leisten.** Kamera, Mikrofon, das Verhalten von iOS im
Startbildschirm und die Erkennungsgüte an echter Post lassen sich in einer
Bauumgebung nicht beurteilen. Eine grüne Prüfstrecke ist keine Freigabe für den
Pilotbetrieb.

### Vorgehen bei Fehlern

Reproduzierbares Beispiel → fehlschlagender Test → Ursache beheben → gezielter
Test → gesamte Prüfstrecke. Befunde und verbleibende Grenzen kommen in den
Änderungsbericht des Pull Requests, nicht nur in die Beschreibung.

### Datenschutz in der Entwicklung

Im Repository und in der Prüfstrecke ausschließlich erfundene Daten. Keine
echten Anschriften, keine echten Belegfotos, keine Datenbankauszüge. Der
Prüflauf `hinweise` in der Bauumgebung sucht nach versehentlich mitgegebenen
Datenbanken, Bildern und Schlüsseldateien.

## Arbeitsweise

Ein Arbeitspaket, ein Entwicklungszweig, ein prüfbarer Pull Request. Jeder Pull
Request nennt Problem, Änderung, geprüfte Punkte und verbleibende Grenzen. Keine
selbsttätige Veröffentlichung und keine automatische Bereitstellung.

Das Repository ist öffentlich. Veröffentlicht werden ausschließlich Quellcode,
Dokumentation und erfundene Testdaten. Zugangsdaten gehören in die dafür
vorgesehenen Geheimnisspeicher, niemals in den Quellcode, in Issues oder in
einen Chat.

## Vorrecherche

* <https://www.miditas.de/postbuch.html>
* <https://www.postbuch-online.de/Default.aspx>
* <https://docs.paperless-ngx.com/>
* <https://developers.google.com/ml-kit/vision/text-recognition/v2/android>
* <https://developer.apple.com/documentation/vision/recognizing-text-in-images>
* <https://github.com/naptha/tesseract.js>
* <https://github.com/ggml-org/whisper.cpp>
* <https://firt.dev/notes/pwa-ios/>
