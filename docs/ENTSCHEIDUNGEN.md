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

---

## E09 · Zuschnitt vor der Erkennung (18.09.2026)

**Entscheidung.** Zwischen Aufnahme und Erkennung liegt ein Rahmen, den die
erfassende Person auf das Anschriftenfeld zieht. Erkannt wird nur der Ausschnitt.

**Begründung.** An einem echten Paketetikett gemessen:

| erkannter Bereich | Zuversicht | Dauer |
|---|---|---|
| ganzes Etikett | 28 % | 4144 ms |
| Etikett ohne Rand | 45 % | 1691 ms |
| nur der Adressblock | **62 %** | **469 ms** |

Höhere Auflösung half nicht (1600/2400/3200 Pixel Kantenlänge ergaben 27–30 %),
der Ausschnitt half achtfach in der Zeit und verdoppelte die Zuversicht. Ein
Paketetikett trägt Frachtangaben, Strichcodes und Haftungstexte in zwei
Leserichtungen; alles davon ist für die Erkennung Störung. Kein Kunstgriff in
der Nachbearbeitung wiegt das auf.

**Preis.** Ein Handgriff mehr je Sendung. Er ersetzt aber das Berichtigen von
Feldern, die mit Unsinn gefüllt waren, und ist damit voraussichtlich schneller.
Der Erhebungsbogen des Pilotbetriebs misst das.

**Zurückzunehmen, wenn.** Der Pilotbetrieb zeigt, dass der Rahmen mehr Zeit
kostet als er spart – dann tritt eine automatische Feldsuche an seine Stelle, mit
dem Rahmen als Rückfall.

---

## E10 · Beschriftungen vor Anordnung, und nichts erfinden (18.09.2026)

**Entscheidung.** Trägt ein Bild Beschriftungen wie „Empfänger“ oder „Absender“,
bestimmen diese die Zuordnung; nur ohne sie gilt die Umschlagsregel (großer
Block = Empfänger, kleine Zeile darüber = Absender). Zeilen, die weder Name,
Organisation, Straße, Postleitzahl noch Ort sein können, werden verworfen und
gezählt, nicht eingetragen. War die Erkennung unsicher **und** ergibt das
Ergebnis keine vollständige Anschrift, bleibt jedes Feld leer und die Oberfläche
sagt das.

**Begründung.** Zuvor galt: „alles Übrige ist die Organisation“. Damit landete
auf einem Paketetikett der Frachtführer im Organisationsfeld und Strichcode-Reste
in der Anschrift. Die Zuversicht je Zeile hilft nicht weiter – gemessen trug
„DELISprint“ 61 %, der richtig gelesene Nachname 34 %. Nur die Form der Zeile
trägt.

**Preis.** Gelegentlich bleibt ein ungewöhnlich geschriebener Organisationsname
außen vor und muss getippt werden.

**Zurückzunehmen, wenn.** Nichts davon. Ein leeres Feld ist im Postbuch
richtig, ein falsch gefülltes ist ein Nachweisfehler.

---

## E11 · Die Beteiligten werden markiert, nicht erraten (21.09.2026)

**Entscheidung.** Nach der Aufnahme markiert die erfassende Person die Bereiche
selbst und sagt durch die Wahl der Seite, **was** dort steht: ein Rechteck für
den Empfänger, eines für den Absender. Jeder Bereich wird einzeln erkannt und
mit `parseAddress` zerlegt. Der Regelweg ist das Markieren; „Ganzes Bild“ bleibt
als Abkürzung, und dort gilt weiter die automatische Zuordnung nach E10.

**Begründung.** E09 und E10 haben die Erkennung messbar verbessert, im Praxistest
aber nicht überzeugt. Der Grund liegt in der Aufgabe selbst: die Maschine soll
aus einer Fläche gleichzeitig **lesen** und **deuten**, welche Zeile zu welcher
Seite gehört. Das Lesen ist schwer genug. Das Deuten kann der Mensch in einer
halben Sekunde und fehlerfrei — er sieht die Sendung ja in der Hand.

Damit fällt die ganze Zuordnungslogik als Fehlerquelle weg, und der zweite,
schon gemessene Gewinn kommt gratis dazu: ein markierter Adressblock ist eine
kleine Fläche, und kleine Flächen werden schnell und mit hoher Zuversicht
gelesen (62 % in 469 ms gegen 28 % in 4144 ms).

**Preis.** Ein bis zwei Wischbewegungen je Sendung. Dafür entfällt das
Berichtigen falsch zugeordneter Felder. Eine Markierung ist zudem eine Aussage
(„hier steht die Anschrift“), deshalb genügt in einem markierten Bereich ein
Anker — Postleitzahl oder Straße —, um zu übernehmen; ohne Markierung bleibt die
strengere Schwelle aus E10.

**Nicht gewählt.** Feldweises Markieren (Name, Organisation, Straße, PLZ/Ort
einzeln) wäre genauer und bräuchte keinen Parser mehr, verlangt aber vier bis
acht Rechtecke je Sendung. Im Takt einer Poststelle ist das zu langsam.

**Zurückzunehmen, wenn.** Der Pilotbetrieb zeigt, dass zwei Wischbewegungen je
Sendung mehr kosten als das Berichtigen. Dann wird erst automatisch versucht und
nur bei unsicherem Ergebnis zum Markieren aufgefordert — die Technik dafür liegt
bereits vollständig vor, es wäre eine Änderung im Ablauf, nicht im Kern.

---

## E12 · Am Arbeitsplatz zusätzlich die angeschlossene Kamera (21.09.2026)

**Entscheidung.** Neben dem Dateifeld mit `capture` gibt es einen zweiten
Aufnahmeweg über `getUserMedia`: Live-Bild, Geräteauswahl, Einzelbild abnehmen.
Der Knopf erscheint **nur**, wo der Browser den Zugriff kennt und der Kontext
sicher ist. Auf dem Telefon bleibt alles, wie es war.

**Begründung.** E01 hatte `getUserMedia` verworfen — zu Recht, für iOS im
Startbildschirm. Für den Arbeitsplatzrechner gilt das Argument nicht, und dort
steht ein Weg offen, den das Telefon nicht hat: eine feste Kamera über dem
Sortiertisch, ein iPhone über Continuity, eine Webcam. Sendung hinlegen,
abnehmen, Bereiche mit der Maus markieren — die Hände bleiben bei der Post,
statt ein Telefon zu halten. Für eine Poststelle könnte das der eigentliche
Arbeitsplatz sein; das Telefon ist dann für die Ausnahme da, nicht für den Takt.

**Der Kontext.** Kamerazugriff verlangt einen sicheren Kontext. `127.0.0.1` gilt
im Browser als sicher, auch ohne TLS — deshalb funktioniert der Weg schon beim
örtlichen Ausprobieren. Im Betrieb liegt die Anwendung ohnehin hinter TLS. Auf
einer Adresse wie `http://192.168.178.43:8000/` erscheint der Knopf **nicht**,
und das ist richtig so: dort wäre der Zugriff auch nicht erlaubt.

**Preis.** Ein zweiter Aufnahmeweg, der gepflegt werden will. Beide münden nach
wenigen Zeilen in denselben Ablauf — Markieren, Erkennen, Prüfen —, deshalb
bleibt der Zusatz klein.

**Offen.** Ob ein fester Kameraarbeitsplatz schneller ist als das Telefon in der
Hand, ist nicht gemessen. Der Pilotbetrieb kann beides mitführen: derselbe Weg
`E` im Messprotokoll, mit einer Bemerkung, womit aufgenommen wurde.

---

## E13 · Die Leserichtung wird gesucht, nicht vorausgesetzt (21.09.2026)

**Entscheidung.** Das Bild lässt sich mit **↻ Drehen** von Hand aufrichten;
Markierungen drehen sich mit. Zusätzlich sucht die Erkennung die Leserichtung
selbst: zuerst die eingestellte, und wenn das Ergebnis nicht trägt, die übrigen
drei Vierteldrehungen. Genommen wird die beste – gemessen an der Zuversicht und
daran, ob eine Anschrift herauskommt.

**Begründung.** Ein Umschlag liegt quer auf dem Tisch, und quer wird er
fotografiert. Die Texterkennung liest ausschließlich waagerechte Zeilen; steht
die Anschrift hochkant, deutet sie die Zeichen einzeln und liefert Buchstaben­salat
mit hoher Zuversicht. Kein Nachbearbeiten hilft dagegen – das Bild muss vorher
stehen. Die EXIF-Drehung aus E09 löst nur den halben Fall: sie richtet das Bild
so aus, wie die Kamera gehalten wurde, nicht so, wie die Sendung darin liegt. Im
Test war es sogar die EXIF-Drehung, die den quer fotografierten Umschlag erst
hochkant stellte.

**Preis.** Im ungünstigen Fall drei zusätzliche Durchgänge – auf einer markierten
Fläche je etwa eine halbe Sekunde, und nur dann, wenn es ohne sie schiefginge.
Der erste gefundene Winkel gilt für den nächsten Bereich als erster Versuch, ein
zweiter Bereich kostet also nichts extra.

**Ein Fehler, den nur das echte Foto zeigte.** Zuerst wurde die Suchdrehung auf
das **ganze Bild** angewandt und der Ausschnitt danach genommen – damit lag der
markierte Bereich bei jeder Drehung woanders auf der Sendung. Gelesen wurde mit
84 % Zuversicht, und es fehlte der halbe Adressblock. Richtig ist: erst
schneiden, dann drehen. Die erfundene Prüfvorlage hätte das nie gezeigt, weil
dort das ganze Bild markiert war.

**Mitgelernt.** Drei Dinge, an denen die Zerlegung an einer echten Sendung
scheiterte, sind behoben: „07743Jena“ ohne Leerzeichen, Einrichtungen im
Kompositum („Universitätsbibliothek“, „Landesverband“) und ein Satzzeichen, das
die Erkennung an den Zeilenanfang setzt. Das Anschriftenfeld behält außerdem die
Reihenfolge des Umschlags, statt nach Organisation und Person umzusortieren.
