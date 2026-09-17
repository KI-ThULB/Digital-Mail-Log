# Digital-Mail-Log — Digitales Postbuch

Erfassung von Posteingängen und Postausgängen in der Poststelle einer
öffentlichen Einrichtung. Entwickelt für die Thüringer Universitäts- und
Landesbibliothek Jena.

Die Erfassung läuft als installierbare **Web-App** auf Telefon, Tablet und am
Arbeitsplatzbildschirm – aus einer Codebasis, ohne App Store. Adressen werden
über die Kamera gelesen; **Texterkennung und Bild bleiben auf dem Gerät**. Ohne
Netz wird weiter erfasst und später übertragen.

## In zwei Minuten ausprobieren

```sh
python3 -m postbuch.server --db /tmp/probe.sqlite3 --fotos /tmp/probe-fotos
```

Dann <http://127.0.0.1:8000/> öffnen. Für die Kamera-Erkennung zusätzlich einmal:

```sh
./web/vendor/hole-tesseract.sh      # rund 19 MB, einmalig
```

Um die App auf dem eigenen Telefon zu sehen, mit `--host 0.0.0.0` starten und die
angezeigte Adresse im Telefonbrowser öffnen; beide Geräte im selben Netz.

> Der Entwicklungsserver kennt **kein TLS und keine Anmeldung** und meldet das
> auch in der Oberfläche. Er ist für Entwicklung und Vorführung gedacht. Für den
> Pilotbetrieb siehe [`docs/BETRIEB.md`](docs/BETRIEB.md). Keine echten
> Postdaten erfassen, bevor das eingerichtet ist.

## Was die Anwendung kann

* Posteingang und Postausgang, mit getrennten Angaben zu Absender und Empfänger.
* **Adresse fotografieren**, Text lokal erkennen, Felder als Vorschlag befüllen.
  Erkanntes wird geprüft und bestätigt, nie ungefragt übernommen.
* Beschreibung, Sendungsart und Datum; „Inhalt unbekannt“ ist zulässig.
* **Porto und PSP-Element ausschließlich beim Ausgang.** Porto in ganzzahligen
  Cent; leer bedeutet unbekannt, 0,00 € bedeutet portofrei – beides bleibt
  unterscheidbar.
* Belegfotos am Eintrag. Das Foto zur Erkennung wird verworfen.
* Liste mit Filtern nach Richtung, Zeitraum, Sendungsart und Volltextsuche über
  alle Wörter, auch über die Postbuchnummer.
* **Berichtigen mit Änderungshistorie**, Stornieren mit Begründung. Gelöscht
  wird nichts.
* Kontaktverzeichnis mit Aliasen; jede Sendung behält den damaligen
  Adressstand.
* Portosummen je PSP-Element, CSV-Export für Excel.
* **Erfassen ohne Netz**, sichtbare Warteschlange, wiederholbare Übertragung
  ohne Dubletten, Konflikterkennung bei gleichzeitiger Bearbeitung.

## Aufbau

```
postbuch/     Fachkern, Speicherung, Schnittstelle (Python, ohne Fremdpakete)
web/          Web-App (HTML, CSS, ES-Module, kein Bauschritt)
tests/        Fach-, Speicher-, Schnittstellen-, Browser- und Node-Tests
docs/         Architektur, Betrieb, Entscheidungen, Teststatus, Plan
archiv/       Abgelöste Entwürfe mit Begründung
```

Weiterführend: [Architektur](docs/ARCHITEKTUR.md) ·
[Betrieb](docs/BETRIEB.md) · [Entscheidungen](docs/ENTSCHEIDUNGEN.md) ·
[Entwicklungsplan](docs/ENTWICKLUNGSPLAN.md) · [Teststatus](docs/TESTSTATUS.md)

## Tests

```sh
python3 -m unittest tests.test_domain tests.test_storage tests.test_api -v   # 82 Tests
node --test "tests/js/*.test.mjs"                                            # 17 Tests

pip install playwright pillow && playwright install chromium
python3 -m unittest tests.test_oberflaeche -v                                # 4 Tests im Browser
```

Fachkern und Web-App prüfen denselben Portokorpus in
`tests/konformitaet/porto.json`. Das hält die beiden Umsetzungen zusammen – im
ersten Entwurf waren sie bereits nach einem Tag auseinandergelaufen.

## Voraussetzungen

Python 3.11 oder neuer für den Server, ohne Fremdpakete. Node ab 20 für die
Web-Tests. Die Web-App selbst hat keinen Bauschritt: keine Abhängigkeiten, kein
Bündler, keine Übersetzung. Was im Verzeichnis liegt, läuft im Browser.

## Stand und Grenzen

Ein lauffähiger Pilotkern, noch kein eingeführtes Verfahren.

**Offen:** Anmeldung der Einrichtung (vorbereitet, aber einzurichten), Praxistest
auf echten Geräten mit echter Post, Aufbewahrungsfrist und Löschkonzept,
Spracheingabe (bewusst zurückgestellt, siehe E05).

**Nicht durch Tests belegbar:** Erkennungsgüte an echter Post, Dauer auf den
tatsächlichen Geräten, Akku und Erwärmung, das Verhalten von iOS bei aus dem
Startbildschirm gestarteten Web-Apps. Das entscheidet sich am Gerät.

Eine Änderungshistorie allein begründet keine Revisionssicherheit. Was daraus
folgt, ist mit Archiv, Datenschutz und Justiziariat zu klären; die Punkte stehen
in [`docs/BETRIEB.md`](docs/BETRIEB.md), Abschnitt 8.

## Datenschutz in der Entwicklung

GitHub dient der Entwicklung und den Tests. Echte Postdaten, Belegfotos,
Diktate, Zugangsdaten und Datenbanksicherungen gehören weder ins Repository noch
in Issues. In Tests und Dokumentation stehen ausschließlich erfundene Daten.
