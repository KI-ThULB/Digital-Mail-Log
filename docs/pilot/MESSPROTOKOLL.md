# Messprotokoll für den Praxistest

Für die Testwoche in der Poststelle. Zweck ist **eine Entscheidung**, kein
Eindruck.

Die entscheidende Frage lautet nicht „funktioniert die Erkennung?“ — das tut sie
—, sondern: **spart sie in Eurem Arbeitsablauf genug Zeit, um den Aufwand zu
rechtfertigen?** Das ist bisher unbeantwortet, und es lässt sich nur am Packtisch
beantworten.

> **Die Entscheidungsregel steht in Abschnitt 5 und gilt, bevor gemessen wird.**
> Wer sie erst nach Ansicht der Zahlen festlegt, findet in jedem Ergebnis eine
> Bestätigung dessen, was er ohnehin wollte.

---

## 1 · Was vorher steht

| | |
|---|---|
| Zeitraum | fünf Arbeitstage |
| Umfang | 100 bis 200 Sendungen, davon mindestens 20 je Sendungsform |
| Geräte | die Geräte, die später wirklich benutzt werden — nicht das neueste im Haus |
| Daten | freigegebene Testsendungen oder echte Post, je nach Stand der Klärung mit Datenschutz und Archiv |
| Beteiligte | die Kolleginnen und Kollegen, die täglich dort arbeiten; nicht die Projektleitung |

Wer misst, erfasst nicht zugleich selbst. Eine Person erfasst, eine Person nimmt
die Zeit und trägt ein. Sonst misst man das Mitschreiben.

## 2 · Der Vergleich

Jede Sendung wird auf **einem** von zwei Wegen erfasst:

- **E** — mit Kamera-Erkennung: fotografieren, Empfänger- und Absenderbereich
  markieren, erkennen lassen, Vorschlag prüfen, ergänzen. Das Markieren gehört
  zur gemessenen Zeit: es sind ein bis zwei Wischbewegungen mehr, die aber das
  Berichtigen falsch zugeordneter Felder ersparen (E09 und E11 in
  `docs/ENTSCHEIDUNGEN.md`). Ob diese Rechnung aufgeht, soll der Test zeigen —
  bitte notieren Sie auffällige Fälle, in denen das Markieren gehakt hat.
- **T** — nur tippen: Felder von Hand ausfüllen.

**Abwechselnd**, Sendung für Sendung. Nicht erst fünfzig auf einem Weg, dann
fünfzig auf dem anderen: Übung und Ermüdung würden sonst als Unterschied
zwischen den Wegen erscheinen. Bei zwei erfassenden Personen tauschen beide nach
der Hälfte den Weg, damit persönliche Tippgeschwindigkeit sich herausmittelt.

Gemessen wird vom Griff zur Sendung bis zum Druck auf „Speichern“.

## 3 · Was eingetragen wird

Je Sendung eine Zeile:

| Spalte | Eintrag |
|---|---|
| Nr. | fortlaufend |
| Form | `F` Fensterumschlag · `B` Briefumschlag bedruckt · `P` Paketetikett · `H` handschriftlich · `A` Ausland |
| Weg | `E` mit Erkennung · `T` nur tippen |
| Zeit | Sekunden vom Griff bis „Speichern“ |
| Erk. | die Sekundenzahl, die die App nach der Erkennung anzeigt (nur bei `E`) |
| Korr. | Korrekturbedarf, siehe Schlüssel unten (nur bei `E`) |
| Bemerkung | nur wenn etwas auffiel |

**Schlüssel für den Korrekturbedarf**

| | |
|---|---|
| `0` | alles richtig übernommen, nichts geändert |
| `1` | ein Feld berichtigt oder ergänzt |
| `2` | mehrere Felder berichtigt |
| `3` | unbrauchbar, alles von Hand |

Diese vier Stufen genügen. Feiner zu unterscheiden kostet beim Eintragen mehr
Zeit, als die Genauigkeit später wert ist.

**Einmal je Halbtag zusätzlich**

- Akkustand des Geräts zu Beginn und am Ende.
- Wurde das Gerät spürbar warm? ja / nein.
- Gab es Abbrüche, Hänger oder Fehlermeldungen? Welche, wortgetreu.

## 4 · Was nebenher aufgeschrieben wird

Ein leeres Blatt, formlos. Diese Notizen sind am Ende oft mehr wert als die
Zahlen:

- Wo zögert jemand, weil unklar ist, was in ein Feld gehört?
- Was wird gefragt? Was wird falsch verstanden?
- Welcher Handgriff ist unbequem — einhändig, im Stehen, mit Handschuhen?
- Was fehlt, das die Poststelle bisher anders gelöst hat?
- Welche Sendungsarten kommen vor, die in der Liste der App fehlen?

## 5 · Die Entscheidungsregel

Nach der Woche werden Mediane gebildet, keine Mittelwerte: ein einzelner
Ausreißer, weil jemand ans Telefon musste, soll das Ergebnis nicht tragen.

**Die Erkennung bleibt**, wenn alle drei Bedingungen zutreffen:

1. Die mittlere Zeit je Sendung auf Weg `E` liegt **mindestens 20 % unter** der
   auf Weg `T`.
2. Bei gut lesbaren Druckadressen (`F`, `B`, `P`) haben **mindestens 80 %** den
   Korrekturbedarf `0` oder `1`.
3. **Mindestens 95 %** der Erkennungen brauchen weniger als **3 Sekunden**.

**Die Erkennung wird verworfen**, wenn Bedingung 1 oder 2 deutlich verfehlt
wird. Die App bleibt dann vollständig benutzbar; die Erfassung erfolgt von Hand,
und es entfällt der gesamte Aufwand für Pflege und Aktualisierung der
Erkennungsbestandteile.

**Eine native App wird geprüft**, wenn 1 und 2 erfüllt sind, aber 3 verfehlt
wird. Genau diesen Fall — gute Treffer, zu langsam — lösen ML Kit auf Android
und Apple Vision auf iOS. Nur dann rechtfertigt der Aufwand einer nativen App
sich; die Schnittstelle bliebe dieselbe, siehe `docs/ENTSCHEIDUNGEN.md`, E01.

**Handschrift wird getrennt ausgewertet** und geht in keine der drei Bedingungen
ein. Tesseract ist auf Druck trainiert; an Handschrift wird es scheitern, und
das ist kein Argument gegen den Weg insgesamt.

## 6 · Was ausdrücklich nicht gemessen wird

Damit die Woche nicht ausufert:

- Die Suche und die Auswertung. Beide sind durch Tests abgedeckt und im
  Tagesbetrieb nicht zeitkritisch.
- Die Offline-Synchronisation. Wird geprüft, indem einmal bewusst das WLAN
  abgeschaltet, zehn Sendungen erfasst und danach wieder eingeschaltet wird.
  Ergebnis: Warteschlange wird leer, keine Dublette, kein Verlust. Ja oder nein.
- Die Gestaltung. Anmerkungen dazu gehören auf das formlose Blatt, nicht in eine
  Messung.

## 7 · Nach der Woche

Eine Seite genügt:

- Anzahl der Sendungen je Form und Weg.
- Mittlere Zeit je Sendung, `E` gegen `T`, und die Differenz in Prozent.
- Verteilung des Korrekturbedarfs, getrennt nach Sendungsform.
- Anteil der Erkennungen unter 3 Sekunden.
- Welche der drei Bedingungen sind erfüllt, welche nicht.
- Die daraus folgende Entscheidung, in einem Satz.
- Die fünf wichtigsten Anmerkungen vom formlosen Blatt.

Das Ergebnis gehört in `docs/TESTSTATUS.md`, auch und gerade wenn es gegen die
Erkennung ausfällt. Ein verworfener Weg, dessen Verwerfen begründet
nachvollziehbar ist, ist ein Projektergebnis und kein Fehlschlag.

---

## Erhebungsbogen

Druckfertig in `ERHEBUNGSBOGEN.pdf`. Ein Blatt fasst 20 Sendungen.

| Nr. | Form | Weg | Zeit (s) | Erk. (s) | Korr. | Bemerkung |
|----:|:----:|:---:|---------:|---------:|:-----:|-----------|
| 1 | | | | | | |
| 2 | | | | | | |
| … | | | | | | |

Form: `F` Fenster · `B` Brief bedruckt · `P` Paketetikett · `H` handschriftlich · `A` Ausland
Weg: `E` Erkennung · `T` Tippen · Korr.: `0` nichts · `1` ein Feld · `2` mehrere · `3` unbrauchbar
