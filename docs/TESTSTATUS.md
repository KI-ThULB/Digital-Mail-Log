# Teststatus

Stand 17.09.2026.

## Ergebnis

| Prüfstrecke | Umfang | Ergebnis |
|---|---:|---|
| Fachkern (`tests/test_domain.py`) | 38 | bestanden |
| Speicherung (`tests/test_storage.py`) | 21 | bestanden |
| Schnittstelle (`tests/test_api.py`) | 23 | bestanden |
| Adressparser und Portokorpus (`tests/js/`) | 17 | bestanden |
| Oberfläche im Browser (`tests/test_oberflaeche.py`) | 4 | bestanden |
| **Summe** | **103** | **bestanden** |

Umgebung des Laufs: Linux, Python 3.11.15, Node 22.22.2, Chromium über
Playwright. Die Bauumgebung prüft zusätzlich Python 3.13 und Node 20.

## Was dabei nachgewiesen wurde

**Geld.** Portobeträge werden in ganzzahligen Cent geführt; Fließkommazahlen
kommen nicht vor. „Leer“ und „0,00 €“ bleiben in Eingabe, Anzeige, Export und
Auswertung unterscheidbar. Tausendertrennzeichen werden abgewiesen, weil „1.000“
mehrdeutig ist. Fachkern und Web-App prüfen dieselben 28 Fälle aus
`tests/konformitaet/porto.json`.

**Kostenfelder.** Porto und PSP-Element sind beim Eingang unzulässig, auch mit
dem Wert 0. Beim Wechsel der Richtung werden sie entfernt – sichtbar gewarnt und
im Browser nachgewiesen; die früheren Werte bleiben in der Historie.

**PSP-Element.** Führende Nullen, Punkte und Bindestriche bleiben unverändert.
Steuerzeichen und mehrzeilige Eingaben werden abgewiesen.

**Historie.** Frühere Fassungen bleiben unverändert. Gesichert nicht nur durch
die Anwendungslogik, sondern durch Datenbankauslöser: `UPDATE` und `DELETE` auf
der Revisionstabelle werden von SQLite zurückgewiesen. Im Test unmittelbar an der
Datenbank geprüft.

**Gleichzeitiges Bearbeiten.** Eine Änderung auf veralteter Fassung wird mit 409
abgewiesen und liefert den aktuellen Stand mit. Stilles Überschreiben gibt es
nicht.

**Wiederholbare Übertragung.** Dieselbe Warteschlange zweimal gesendet erzeugt
keine Dubletten. Ein fehlerhafter Vorgang hält die übrigen nicht auf; jeder wird
einzeln mit `ok`, `conflict` oder `rejected` beantwortet.

**Nummernkreise.** Fortlaufend je Jahr und Richtung. Vier Threads mit je zehn
gleichzeitigen Erfassungen ergeben 40 eindeutige Nummern.

**Nebenläufigkeit.** Der Speicher ist aus mehreren Threads verwendbar – nötig,
weil ein WSGI-Server Anfragen nicht immer aus demselben Thread bedient. Dieser
Fehler war im Browserlauf aufgefallen und ist behoben.

**Datum.** Das Sendungsdatum stammt vom Gerät, nicht aus UTC. Um 23:30 UTC ist in
Jena bereits der Folgetag; der Test hält genau diesen Fall fest.

**Rechte.** Lesende Rollen können nicht schreiben, erfassende nicht verwalten.
Ohne Benutzerkennung vom vorgelagerten Webserver antwortet die Schnittstelle mit
401. Der Entwicklungsmodus ist als solcher erkennbar.

**Adresszerlegung.** Geprüft an erfundenen Vorlagen: vollständige
Geschäftsanschrift, Fensterumschlag mit Absenderzeile über dem Adressfeld,
Frankierzeilen und Sendungsnummern, Postfach, Auslandsanschrift mit Länderzeile,
Paketetikett ohne Person. Bei unleserlicher Vorlage bleiben die Felder **leer**
und die Zuversicht niedrig – es wird nichts erfunden.

**Durchlauf im Browser.** Erfassen, Wiederfinden über Mehrwortsuche, Berichtigen
mit Begründung, Entstehen der zweiten Fassung, Portosumme in der Liste,
Abweisung eines ungültigen Portobetrags. Auf einem Ansichtsfenster in
Telefongröße, ohne Fehler in der Browserkonsole.

**Texterkennung, örtlich.** Auf einem erzeugten Prüfumschlag: Tesseract mit
deutschen Sprachdaten, vollständig im Browser, **1,4 Sekunden**, Zuversicht 90 %.
Die Adressfelder wurden richtig befüllt, die Absenderzeile des Fensterumschlags
richtig **nicht** in die Anschrift übernommen. In der Bauumgebung wird dieser
Test übersprungen, weil die Bestandteile der Erkennung nicht im Repository
liegen.

## Was **nicht** geprüft ist

Diese Punkte entscheiden über die Eignung im Alltag und lassen sich in keiner
Bauumgebung beurteilen:

* **Erkennungsgüte an echter Post.** Der Prüfumschlag ist erzeugter, sauberer
  Druck. Fensterumschläge, Paketetiketten, Stempel, Knicke, schlechtes Licht und
  Handschrift sind etwas anderes.
* **Dauer auf den tatsächlichen Geräten.** 1,4 Sekunden auf einem
  Entwicklungsrechner sagen nichts über ein vier Jahre altes iPad.
* **Kamera, Akku, Erwärmung** über einen Vormittag.
* **iOS im Startbildschirm.** Der Kamerazugriff über `getUserMedia` gilt dort
  als unzuverlässig. Die App vermeidet ihn und verwendet das Dateifeld mit
  `capture`; ob das auf den Geräten der ThULB durchgängig trägt, ist dort zu
  prüfen.
* **Dauerhaftigkeit des lokalen Speichers.** Die App bittet den Browser um eine
  Zusage und zeigt an, ob sie erteilt wurde. Das Verhalten bei knappem Speicher
  ist am Gerät zu beobachten.
* **Sicherung und Wiederherstellung.** Noch nicht geprobt.
* **Anmeldung.** Der Vorschaltserver ist beschrieben, aber nicht eingerichtet.
  Insbesondere ist nicht geprüft, ob das Kopffeld mit der Benutzerkennung von
  außen fälschbar wäre. Das ist der wichtigste Punkt vor dem Pilotbetrieb.

**Eine grüne Prüfstrecke ist keine Freigabe.** Vor der ersten echten Sendung
gelten die Punkte in `docs/BETRIEB.md`, Abschnitt 8.

## In diesem Durchgang gefundene und behobene Fehler

1. **Zwei Fachkerne liefen auseinander.** Python und Dart unterschieden sich
   bereits in Sendungsart, Vorgabewert, Form der Kennung und Filterumfang.
   Behoben: ein Fachkern, gemeinsamer Prüfkorpus.
2. **Unbekannte Kennung warf einen nackten `KeyError`.** Die Schnittstelle hätte
   damit 500 statt 404 gemeldet. Behoben: eigene Ausnahme `NotFound`.
3. **Volltextsuche verlangte die zusammenhängende Zeichenkette.** „Springer
   Brief“ fand „Brief von Springer“ nicht. Behoben: alle Suchwörter, Reihenfolge
   gleichgültig, Umlaute aufgelöst.
4. **Speicher war nicht threadfähig.** Fiel erst im Browserlauf auf, hätte im
   Betrieb hinter gunicorn jede zweite Anfrage getroffen. Behoben: eine
   Verbindung je Thread.
5. **Texterkennung lud ihre Bestandteile nicht.** Relative Pfade lösen sich im
   Web Worker gegen das Worker-Skript auf, nicht gegen die Seite; zudem war die
   falsche Fassung der Kernbibliothek festgeschrieben. Behoben, am laufenden
   Browser nachgewiesen.
6. **Postbuchnummer war nicht durchsuchbar.** Sie hängt am Eintrag, die Suche lief
   über die Fassung. Behoben.
7. **Detailansicht zeigte beim Nachladen den alten Stand.** Sah aus wie der
   aktuelle. Behoben: die Ansicht wird zuerst geleert.
