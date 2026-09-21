# Teststatus

Stand 21.09.2026.

## Ergebnis

| Prüfstrecke | Umfang | Ergebnis |
|---|---:|---|
| Fachkern (`tests/test_domain.py`) | 38 | bestanden |
| Speicherung (`tests/test_storage.py`) | 21 | bestanden |
| Schnittstelle (`tests/test_api.py`) | 23 | bestanden |
| Entwicklungsserver (`tests/test_server.py`) | 6 | bestanden |
| Adressparser und Portokorpus (`tests/js/`) | 31 | bestanden |
| Oberfläche im Browser (`tests/test_oberflaeche.py`) | 11 | bestanden |
| **Summe** | **130** | **bestanden** |

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

**Adressauskunft des Entwicklungsservers.** Aus `ifconfig` (macOS) und
`ip -4 -o addr` (Linux) werden alle IPv4-Adressen samt Schnittstellennamen
gelesen und beschriftet: lokales Netz, Tunnel oder Sackgasse. Anlass waren zwei
verlorene Testläufe — bei aktivem VPN nannte der Server nur die Tunneladresse,
und im Hotspot eines IPv6-only-Mobilfunknetzes trug der Rechner die
Übersetzungsadresse 192.0.0.2, die kein anderes Gerät erreicht. Beides sieht in
`ifconfig` aus wie ein gewöhnliches Netz und wird jetzt benannt.

**Rechte.** Lesende Rollen können nicht schreiben, erfassende nicht verwalten.
Ohne Benutzerkennung vom vorgelagerten Webserver antwortet die Schnittstelle mit
401. Der Entwicklungsmodus ist als solcher erkennbar.

**Adresszerlegung.** Geprüft an erfundenen Vorlagen: vollständige
Geschäftsanschrift, Fensterumschlag mit Absenderzeile über dem Adressfeld,
Frankierzeilen und Sendungsnummern, Postfach, Auslandsanschrift mit Länderzeile,
Paketetikett ohne Person. Bei unleserlicher Vorlage bleiben die Felder **leer**
und die Zuversicht niedrig – es wird nichts erfunden.

**Paketetiketten.** Beschriftungen („Empfänger“, „Absender“, auch englisch und
ohne Umlaute) bestimmen die Zuordnung; ohne sie gilt die Umschlagsregel.
Frachtführer, Feldbeschriftungen wie „Referenz“ oder „Gewicht“, Haftungssätze
und Strichcode-Reste landen in **keinem** Feld. Reines Rauschen füllt nichts.
Nachgewiesen an einer erfundenen Vorlage, die der Bauform eines echten Etiketts
nachgebildet ist – im Textparser und zusätzlich am erzeugten Etikettenbild im
Browser.

**Durchlauf im Browser.** Erfassen, Wiederfinden über Mehrwortsuche, Berichtigen
mit Begründung, Entstehen der zweiten Fassung, Portosumme in der Liste,
Abweisung eines ungültigen Portobetrags. Auf einem Ansichtsfenster in
Telefongröße, ohne Fehler in der Browserkonsole.

**Markierte Bereiche.** Am erzeugten Etikettenbild im Browser: Absender- und
Empfängerbereich werden mit dem Zeiger gezogen, in beliebiger Reihenfolge, und
jeder Bereich einzeln erkannt. Die Angaben landen auf der Seite, die markiert
wurde — nicht auf der anderen —, mitmarkierte Beschriftungen („Empfänger:“)
landen in keinem Feld, und der Statustext benennt jede Seite einzeln. Geprüft ist
damit auch die Umrechnung von Anteilen in Bildpunkte.

**Absender ohne Anschrift.** Steht als Absender nur der Name des Hauses — quer
am Rand gedruckt, ohne Straße und Ort —, wird er übernommen statt verworfen.
Ohne erkannte Person bleibt das Namensfeld leer; früher wanderte die
Organisation ersatzweise hinein und stand dann dreifach da.

**Quer liegende Sendungen.** Am gedrehten Prüfumschlag: „↻ Drehen“ richtet Bild
**und** Markierungen auf (aus der Breite wird die Höhe), und ohne Zutun findet
die Erkennung die Leserichtung selbst. Am echten Foto nachgemessen — es liegt
nicht im Repository —: 85 % Zuversicht in 449 ms, Anschrift vollständig, Drehung
270° selbst gefunden.

**Angeschlossene Kamera.** Mit einer erzeugten Kamera von Chromium: Kamera
öffnen, Bild abnehmen, Markieren steht mit diesem Bild bereit, und die Kamera
ist danach wieder frei — das Lämpchen brennt nicht weiter. Mitgeprüft ist, dass
`127.0.0.1` im Browser als sicherer Kontext gilt; nur deshalb ist der Zugriff
ohne TLS überhaupt möglich.

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
  Handschrift sind etwas anderes. An einem einzelnen echten Paketetikett gemessen:
  ganzes Etikett 28 % Zuversicht in 4144 ms, nur der Adressblock 62 % in 469 ms.
  Ein Etikett ist keine Messreihe; der Pilotbetrieb muss das prüfen.
* **Das Markieren in der Hand der Poststelle.** Ob zwei Wischbewegungen je
  Sendung am Telefon schnell genug sitzen, ist am Gerät zu beurteilen, nicht im
  Browser auf einem Entwicklungsrechner. Im Test mit dem Zeiger gezogen — der
  Daumen auf Glas ist etwas anderes.
* **Dauer auf den tatsächlichen Geräten.** 1,4 Sekunden auf einem
  Entwicklungsrechner sagen nichts über ein vier Jahre altes iPad.
* **Kamera, Akku, Erwärmung** über einen Vormittag.
* **Die angeschlossene Kamera an echter Hardware.** Geprüft ist die Kette mit
  einem erzeugten Bild. Ob ein iPhone über Continuity, eine Webcam oder eine
  Kamera über dem Sortiertisch scharf genug und hell genug abbildet — und ob
  ein solcher Arbeitsplatz schneller ist als das Telefon in der Hand —, muss der
  Pilotbetrieb zeigen.
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
8. **Drei Ansichten lagen übereinander.** Eine eigene `display`-Regel überstimmte
   das `hidden`-Attribut. In Abfragen auf Attribute unsichtbar, erst im
   ganzseitigen Bildschirmfoto zu sehen. Behoben, mit eigenem Test.
9. **Der Hauptadressblock landete stets beim Absender.** Auf einem Umschlag ist
   der große Block immer der Empfänger – bei eingehender Post stand damit die
   eigene Anschrift auf der falschen Seite. Der Browsertest hatte das falsche
   Verhalten festgeschrieben und wurde mitberichtigt.
10. **„Alles Übrige ist die Organisation“.** Diese Auffangregel im Parser war die
    unmittelbare Ursache dafür, dass auf einem echten Paketetikett Frachtangaben
    und Strichcode-Reste in den Adressfeldern standen. Entfernt: nicht
    zuzuordnende Zeilen werden verworfen und gezählt.
11. **Strichcode-Reste wurden als Straße gelesen.** „J U 8 1 k“ ergab die Straße
    „J U 8“, weil kurze Namen als Straßenname durchgingen. Behoben: ein
    Straßenname muss mindestens ein Wort mit drei Buchstaben enthalten.
12. **Die Drehung aus den EXIF-Angaben wurde nicht berücksichtigt.**
    `createImageBitmap` folgt ihr nicht überall; ein quer aufgenommenes
    Telefonfoto war damit für die Erkennung praktisch unlesbar. Behoben: das Bild
    wird über ein `<img>`-Element geladen.
13. **Ein hohes Foto ragte aus dem Bildschirm.** Über der Markierfläche ist
    Scrollen abgeschaltet — sonst ließe sich nicht markieren —, also war der
    obere Teil einer hochformatigen Sendung schlicht unerreichbar. Behoben: das
    Bild wird auf Fensterhöhe begrenzt. Aufgefallen im eigenen Prüflauf am
    echten Foto, nicht in den Tests: dort war das Prüfbild klein genug.
14. **Die Suchdrehung verschob den markierten Bereich.** Sie wurde auf das ganze
    Bild angewandt und der Ausschnitt danach genommen — bei jeder Drehung lag der
    markierte Bereich damit woanders auf der Sendung. Gelesen wurde mit 84 %
    Zuversicht, und es fehlte der halbe Adressblock. Behoben: erst schneiden,
    dann drehen. **Nur am echten Foto sichtbar geworden**; die erfundene Vorlage
    hatte das ganze Bild markiert und konnte den Fehler nicht zeigen.
