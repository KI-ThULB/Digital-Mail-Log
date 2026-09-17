# Digital-Mail-Log – Digitales Postbuch

Mobile Erfassung von Posteingängen und Postausgängen einer öffentlichen Einrichtung.

Repository: https://github.com/KI-ThULB/Digital-Mail-Log

Zielplattformen: Android und iPhone/iPad. Gemeinsame mobile Oberfläche mit Flutter;
plattformabhängige lokale Erkennung über native Komponenten.

## Stand

Erstes ausführbares, plattformunabhängiges Fachmodul mit automatisierten Tests.
Noch keine produktionsfähige App: mobile Oberfläche, persistente Datenhaltung,
Authentifizierung, Synchronisation und lokale Erkennung folgen gemäß
[Entwicklungsplan](docs/ENTWICKLUNGSPLAN.md).

Voraussetzung für das Fachmodul: Python 3.11 oder neuer, keine externen Pakete.

```sh
python3 -m unittest discover -s tests -v
```

GitHub dient der Entwicklung und den Tests. Echte Postdaten, Fotos, Diktate,
Zugangsdaten und Datenbanksicherungen gehören nicht ins Repository oder in Issues.

## Fachliche Festlegungen

- Eingang und Ausgang besitzen getrennte Absender- und Empfängerangaben.
- Erfassungszeit und fachliches Sendungsdatum sind getrennt.
- Porto: optional, ausschließlich Ausgang, EUR, ganzzahlige Cent; leer ist nicht null Euro.
- PSP-Element: optional, ausschließlich Ausgang, Text mit erhaltenen führenden Nullen.
- Änderungen sind versioniert; veraltete Bearbeitungen werden zurückgewiesen.
- OCR und Sprache liefern prüfbare Vorschläge und verarbeiten Daten auf dem Endgerät.

Das Fachmodul ist eine ausführbare Referenz für die spätere Serverimplementierung.
Sein Speicher ist derzeit flüchtig und nicht für echte Postdaten vorgesehen.
