# Flutter-Entwurf (nicht mehr verfolgt)

Hier liegt der unvollendete Flutter-Entwurf vom 17.09.2026, so wie er entstanden
ist. Er wird **nicht weiterentwickelt**. Aufgehoben ist er, weil seine
Oberflächengliederung gut durchdacht war und weil die Entscheidung gegen ihn
nachvollziehbar bleiben soll.

## Was hier liegt

| Datei | Inhalt |
|---|---|
| `lib/domain.dart` | Fachliche Regeln, zweite Umsetzung neben `postbuch/domain.py` |
| `lib/main.dart` | App-Rumpf, Gestaltung, deutsche Lokalisierung |
| `lib/screens.dart` | Übersicht, Erfassungsmaske, Detailansicht |

Es fehlten `pubspec.yaml`, die Plattformverzeichnisse und jeder Test. Der
Entwurf war nicht lauffähig.

## Warum abgelöst

**1. Die Verteilung war der teuerste Teil und noch gar nicht begonnen.** Eine
native App auf dienstliche iPads zu bringen verlangt ein Apple-Developer-Programm,
Signierung, Bereitstellungsprofile und eine Geräteverwaltung, dazu die
Android-Signierung. Für eine Poststelle mit wenigen Geräten steht dieser
dauerhafte Aufwand in keinem Verhältnis zum Nutzen, und er hätte den Praxistest
um Wochen verschoben.

**2. Zwei Umsetzungen derselben Regeln liefen bereits auseinander.** Nach einem
einzigen Arbeitstag unterschieden sich Python- und Dart-Fassung schon in der
Sendungsart (freier Text gegenüber fester Liste), in der Vorgabe („Sonstige“
gegenüber „Brief“), in der Form der Kennung (UUID gegenüber laufender Zahl) und
im Umfang der Filter. Solche Abweichungen fallen erst im Betrieb auf, und dann
als falsche Zahlen.

**3. Die Arbeitsplatzansicht wäre zusätzlich nötig gewesen.** Der Plan sah von
Anfang an eine Browseroberfläche für Recherche vor. Mit einer Web-App ist sie
dieselbe Anwendung.

## Was übernommen wurde

Die Gliederung der Oberfläche ist in `web/` weitgehend erhalten: die Segmentwahl
für die Richtung, die Kostenfelder ausschließlich beim Ausgang, die Warnung beim
Richtungswechsel, die chronologische Liste mit kombinierbaren Filtern. Auch die
Farbwahl stammt von hier.

## Wann der Entwurf wieder wichtig würde

Wenn der Pilotbetrieb zeigt, dass die Erkennung im Browser zu langsam ist oder
dass Diktat unverzichtbar ist. Dann ist eine native App der richtige Weg – aber
gegen die dann bereits vorhandene Schnittstelle, mit gesicherten Daten und mit
belegten Zahlen als Begründung. Siehe `docs/ENTSCHEIDUNGEN.md`.
