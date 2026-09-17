# Entscheidungen

Jede Entscheidung mit Anlass, Begründung, Preis und der Bedingung, unter der sie
zurückzunehmen wäre. Wer das Projekt später übernimmt, soll nicht raten müssen,
warum etwas so ist – und woran erkennbar wäre, dass es falsch war.

---

## E01 · Web-App statt nativer App (17.09.2026)

**Anlass.** Der erste Plan sah Flutter für Android und iPhone/iPad vor. Der
Flutter-Entwurf war nach einem Tag nicht lauffähig, und die Verteilung auf
dienstliche Geräte war noch gar nicht begonnen.

**Entscheidung.** Die Erfassung entsteht als installierbare Web-App. Eine native
App bleibt möglich, wird aber erst gebaut, wenn der Pilotbetrieb sie erzwingt.

**Begründung.**

* Eine Codebasis bedient Telefon, Tablet und Arbeitsplatzbildschirm. Die im Plan
  ohnehin geforderte Browseransicht für die Recherche ist dieselbe Anwendung.
* Keine Verteilung über App Stores, kein Apple-Developer-Programm, keine
  Signierung, keine Geräteverwaltung. Eine neue Fassung ist ein Dateiabgleich auf
  dem Webserver.
* Der Praxistest in der Poststelle kann in Tagen beginnen statt in Wochen.
* Zwei Umsetzungen derselben Fachregeln liefen bereits nach einem Tag
  auseinander (siehe `archiv/flutter-entwurf/README.md`). Eine Umsetzung weniger
  ist eine Fehlerquelle weniger.

**Preis.**

* Die Texterkennung im Browser ist langsamer als ML Kit oder Apple Vision. Auf
  einem Prüfbild im Entwicklungsrechner: rund 1,4 Sekunden. Auf einem älteren
  iPad ist mit deutlich mehr zu rechnen – das ist am Gerät zu messen.
* **Vollständig geräteinternes Diktat ist im Browser nicht verlässlich lösbar.**
  Die Spracherkennung des Browsers schickt Ton bei Apple und Google an deren
  Dienste. Das ist mit der Vorgabe „keine Cloud“ unvereinbar. Diktat entfällt
  deshalb vorerst; siehe E05.
* Der Kamerazugriff über `getUserMedia` gilt in aus dem Startbildschirm
  gestarteten iOS-Web-Apps als unzuverlässig. Deshalb wird nicht `getUserMedia`
  verwendet, sondern das Dateifeld mit `capture` – es öffnet die Systemkamera und
  ist auf beiden Plattformen stabil. Nebenbei liefert es die volle Bildqualität
  mit Autofokus und Blitz.

**Zurückzunehmen, wenn.** Die Erkennung auf dem tatsächlichen Zielgerät
regelmäßig über drei Sekunden braucht, oder wenn der Praxistest zeigt, dass
Diktat den Ablauf spürbar beschleunigt. Dann native App gegen dieselbe
Schnittstelle.

---

## E02 · Ein Fachkern, nicht zwei (17.09.2026)

**Anlass.** Python und Dart setzten dieselben Regeln unterschiedlich um:
Sendungsart als freier Text gegenüber fester Liste, Vorgabe „Sonstige“ gegenüber
„Brief“, UUID gegenüber laufender Zahl, verschiedene Filter.

**Entscheidung.** Die Regeln gelten serverseitig in `postbuch/domain.py`. Die
Web-App prüft nur so viel, wie für eine gute Bedienung nötig ist; verbindlich ist
der Server. Wo eine Regel notwendig doppelt vorkommt – die Umrechnung von Porto –
prüfen beide Seiten denselben Korpus in `tests/konformitaet/porto.json`.

**Preis.** Ein zusätzlicher Prüfkorpus, der bei jeder Regeländerung mitzupflegen
ist.

**Zurückzunehmen, wenn.** Nie ohne Ersatz. Wird doch nativ gebaut, tritt ein
gemeinsames Schema an die Stelle des Korpus.

---

## E03 · Kein Web-Rahmenwerk auf dem Server (17.09.2026)

**Entscheidung.** Die Schnittstelle ist eine WSGI-Anwendung der
Standardbibliothek, ohne Abhängigkeiten.

**Begründung.** In einer öffentlichen Einrichtung ist jede Abhängigkeit etwas,
das jemand pflegen, prüfen und aktualisieren muss. Der Umfang rechtfertigt kein
Rahmenwerk: rund ein Dutzend Endpunkte. Die Anwendung läuft unverändert unter
gunicorn, uWSGI oder Apache mod_wsgi.

**Preis.** Weg- und Rumpfbehandlung sind von Hand geschrieben. Keine erzeugte
Schnittstellendokumentation.

**Zurückzunehmen, wenn.** Die Schnittstelle deutlich wächst oder eine
maschinenlesbare Beschreibung verlangt wird. Der Übergang zu FastAPI beträfe nur
`postbuch/api.py`.

---

## E04 · SQLite für den Pilotbetrieb (17.09.2026)

**Entscheidung.** SQLite mit WAL, eine Verbindung je Thread. PostgreSQL bleibt
der Weg für den Regelbetrieb, falls die Zahlen es verlangen.

**Begründung.** Eine Poststelle erfasst Größenordnungen von einigen Dutzend bis
wenigen hundert Sendungen am Tag. Das ist für SQLite unauffällig. Eine Sicherung
ist eine Dateikopie. Die Schreibvorgänge laufen ohnehin nacheinander, weil die
Postbuchnummer fortlaufend sein muss.

**Preis.** Ein einzelner Serverprozess, kein verteilter Betrieb.

**Zurückzunehmen, wenn.** Mehrere Standorte gleichzeitig schreiben sollen oder
die Einrichtung eine zentrale Datenbank vorschreibt. Betroffen wäre nur
`postbuch/storage.py`.

---

## E05 · Kein Diktat in der ersten Fassung (17.09.2026)

**Entscheidung.** Die Beschreibung wird getippt. Die Spracherkennung des
Browsers wird **nicht** eingebunden.

**Begründung.** `SpeechRecognition` überträgt den Ton auf beiden Plattformen an
Dienste des Herstellers. Ein Postbuch mit dem Versprechen, die Verarbeitung
bleibe auf dem Gerät, darf das nicht heimlich tun. Whisper im Browser wäre
geräteintern möglich, ist aber auf älteren Tablets langsam und kostet weitere
40 bis 150 MB. Vor dieser Investition sollte erst gemessen werden, ob Tippen für
einen kurzen Freitext überhaupt ein Engpass ist.

**Hinweis für die Einführung.** Auch die Diktierfunktion der Gerätetastatur ist
nicht zuverlässig cloudfrei. Wer sie benutzt, sollte das wissen. Die Schulung
muss diesen Punkt ansprechen.

**Zurückzunehmen, wenn.** Der Praxistest zeigt, dass die Beschreibung
regelmäßig lang ausfällt. Dann Whisper geräteintern prüfen, mit Messung.

---

## E06 · Regeln statt Sprachmodell für die Adresszerlegung (17.09.2026)

**Entscheidung.** `web/js/adressen.js` zerlegt erkannten Text nach Regeln.

**Begründung.** Deutsche Anschriften sind stark genormt: fünfstellige
Postleitzahl, Straße mit Hausnummer darüber, Organisation und Person darüber.
Eine Regel lässt sich prüfen, begründen und berichtigen. Ein Sprachmodell füllt
Lücken mit Plausiblem – im Postbuch wäre das eine erfundene Angabe in einem
Nachweisdokument.

**Preis.** Ungewöhnliche Formen fallen durch. Sie bleiben dann leer, was die
richtige Reaktion ist.

**Zurückzunehmen, wenn.** Ein gemessener Anteil unerkannter Anschriften das
rechtfertigt – und auch dann nur so, dass das Modell ausschließlich vorhandene
Textstellen Feldern zuordnet, ohne eigene Formulierungen.

---

## E07 · Anmeldung über den vorgelagerten Webserver (17.09.2026)

**Entscheidung.** Die Anwendung führt keine eigene Benutzerverwaltung. Sie
übernimmt die Kennung aus einem Kopffeld, das der vorgelagerte Webserver setzt
(Shibboleth, Kerberos, mod_auth_openidc).

**Begründung.** Die Universität hat eine Anmeldung. Eine zweite zu bauen hieße,
Passwörter zu verwalten – das ist die riskanteste Stelle jeder Anwendung, und
hier ist sie vermeidbar.

**Preis.** Die Anwendung ist ohne richtig eingerichteten Webserver nicht sicher.
`docs/BETRIEB.md` beschreibt, was der Webserver leisten muss; das Kopffeld muss
er bei Anfragen von außen **überschreiben**, sonst ist es fälschbar.

---

## E08 · Storno statt Löschen (17.09.2026)

**Entscheidung.** Einträge werden nie gelöscht, sondern mit Begründung
storniert. Revisionen sichern Datenbankauslöser gegen `UPDATE` und `DELETE`.

**Begründung.** Ein Postbuch ist ein Nachweis. Eine Lücke darin ist schlimmer
als ein falscher, aber berichtigter Eintrag.

**Offen.** Ob das den Anforderungen an Revisionssicherheit genügt, entscheidet
nicht die Technik. Aufbewahrungsfristen und Löschkonzept sind mit Archiv,
Datenschutz und Justiziariat zu klären. Eine Änderungshistorie allein ist keine
Revisionssicherheit.
