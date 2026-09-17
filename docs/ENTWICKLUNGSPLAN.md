# Entwicklungs- und Testplan – Arbeitsstand 17.09.2026

## Ziel und offene Entscheidungen

Codex implementiert in überprüfbaren Schritten, führt Tests aus, reproduziert Fehler,
korrigiert deren Ursache und ergänzt Regressionstests. Noch zu entscheiden:
konkrete Zielgeräte, Sendungsvolumen, Nutzerzahl,
interner Server und Anmeldung, Aufbewahrung, Verteilprozess und PSP-Stammdaten.
Festgelegt: Android und iPhone/iPad; Flutter als gemeinsame App-Basis mit nativen
Erkennungsmodulen. Repository: https://github.com/KI-ThULB/Digital-Mail-Log (öffentlich).
GitHub ist Quellcodeverwaltung und Testumgebung, nicht Ablage der Postdaten.

## Anforderungen

F01 Eingang/Ausgang, getrennte Beteiligte und automatische Erfassungszeit.
F02 Fachliches Datum separat; bewusst unbekannte Beteiligte und Inhalte zulassen.
F03 Sendungsart und Beschreibung getrennt, Tastatur- und Spracheingabe.
F04 Kamera-OCR für Adressen, Vorschau und Bestätigung; optionale Belegfotos.
F05 Chronologische Liste, kombinierbare Filter und Volltextsuche.
F06 Versionierte Korrekturen und Stornierung; keine unprotokollierten Löschungen.
F07 Einfache Kontaktliste mit Aliasen; historischer Adressstand je Sendung.
F08 Offline-Erfassung, Wiederanlauf, idempotente Übertragung und Konfliktbehandlung.
F09 Rollen und Rechte auch für Suche, Export und Bilder.
F10 Ausgang: optionaler Portobetrag in EUR und optionales PSP-Element.
F11 Export; Portosummen und Filter nach PSP-Element als nächster Ausbau.

Porto wird in ganzzahligen Cent gespeichert, nie als Fließkommazahl. Negative
Beträge und mehr als zwei Nachkommastellen sind ungültig. Leer bleibt unbekannt;
0,00 EUR bedeutet ausdrücklich portofrei. PSP bleibt Text, einschließlich führender
Nullen. Ohne Vorgaben der Einrichtung wird kein SAP-spezifisches Format erfunden.
Eine Validierung gegen freigegebene PSP-Stammdaten kann später ergänzt werden.
Beim Wechsel von Ausgang zu Eingang müssen vorhandene Kostenfelder ausdrücklich
entfernt werden; die Oberfläche muss davor warnen und die Historie erhalten.

## Architektur

Mobile App mit lokaler OCR/ASR und optional kleinem Sprachmodell; verschlüsselter
lokaler Speicher; Synchronisation zu internem Server mit PostgreSQL und geschütztem
Bildspeicher. Browseroberfläche für Recherche. Flutter verbindet die gemeinsame mobile Oberfläche mit nativen Modulen. Die
vorhandene IT bestimmt den Serverstack. Das Python-Fachmodul ist vorerst die
ausführbare Referenz. Kamera und Mikrofon benötigen Tests auf beiden realen
Geräteplattformen; Emulatoren allein reichen für die Pilotfreigabe nicht aus.

OCR: ML Kit (gebündelt) auf Android beziehungsweise Apple Vision auf iOS prüfen.
ASR: mehrsprachiges Whisper base/small über whisper.cpp auf Zielgerät vergleichen.
Feldzuordnung: Regeln, Kontakte und optional Gemma 3n E2B über geeignete Laufzeit.
GLM-5.2 ist für den mobilen Einsatz nicht vorgesehen. Kein Cloud-Fallback.
Adapter liefern Vorschläge mit Quelle/Modellversion; kein direkter Datenbankzugriff.
Unbekannte Werte bleiben leer. Modellpakete werden versioniert, geprüft und intern
verteilt; Lizenz und Laufzeitkompatibilität vor Aufnahme dokumentieren.

## Meilensteine und Abschlusskriterien

1. **Fachkern und Projektgrundlage:** Porto/PSP, Validierung, Versionskonflikte,
   Testlauf und GitHub-Testworkflow. Referenzimplementierung lokal vorhanden.
2. **Geräteexperiment:** echte Kamera und Mikrofon; 100–200 freigegebene Testfälle,
   deutsches Diktat, schwierige Namen, Fensterumschläge, internationale Anschriften.
   Offlinefähigkeit einschließlich Neustart nachweisen. Latenz, RAM, Akku und
   Erwärmung messen; Modellentscheidung dokumentieren. Keine simulierte Erkennung
   als fertig ausweisen.
3. **Durchgängiger erster Ablauf:** Eingabe → Prüfen → Speichern → Liste → Korrektur.
   Porto/PSP nur beim Ausgang anzeigen; ungespeicherte Eingaben absichern.
4. **Server und Sicherheit:** Migrationen, zentrale Anmeldung, Berechtigungen,
   Fototransfer, Datenvalidierung, Versionierung und revisionsbezogene Anforderungen.
5. **Offline und Suche:** lokale Warteschlange, wiederholte Requests ohne Dubletten,
   gleichzeitige Änderungen ohne stillen Datenverlust, Datum/Porto/PSP-Filter.
6. **Pilot:** Barrierearme Bedienung mit Mitarbeitenden prüfen; Geräteverlust,
   Sicherung/Wiederherstellung, Löschfristen, Update und Rollback testen.
7. **Einführung:** Betriebsanleitung, Zuständigkeit, Gerätemanagement und Freigabe.

## Test- und Debuggingstrategie

- Fachtests: Geldformat, unbekannt/Null, PSP-Zeichen, Richtung, ungültige Eingaben,
  automatische Datumswerte, unveränderliche Historie und Versionskonflikte.
- Integration: Datenbankmigrationen, Transaktionen, Authentifizierung, unberechtigte
  Zugriffe, Fotozugriff, Suchrechte und Exportrechte.
- Synchronisation: Verbindungsabbruch zwischen Metadaten und Foto, wiederholte
  Übermittlung, App-Abbruch, Zeitabweichung und zwei gleichzeitig editierende Geräte.
- Oberfläche: Eingang/Ausgang samt Kostenfeldern, Korrektur, Foto und Diktat,
  Tastatur, Screenreader, große Schrift und kleine Bildschirme.
- KI: Feldgenauigkeit statt nur Texterkennung; keine erfundenen Felder; Regression
  gegen festes synthetisches Testset bei Modellupdates. Echte Testdaten intern halten.
- Offline/Datenschutz: Netzwerkverkehr messen; kein externer Datenversand, keine
  Cloud-Diktierfunktion als unbemerkter Ersatz. Audio nach Transkription verwerfen.
- Fehlerbehebung: reproduzierbares Beispiel → fehlschlagender Test → Korrektur →
  gezielter Test → relevante Gesamttests. Befunde und Grenzen im Änderungsbericht.

Vorläufige Leistungsziele (erst am Gerät validieren): 90 % vollständig korrekte
Adressfelder bei gut lesbaren Druckadressen; 95 % OCR-Antworten unter 3 Sekunden.
Handschrift separat bewerten. Pilotfreigabe setzt reale Geräte- und Betriebstests voraus.

## GitHub und Codex-Arbeitsablauf

Das vom Nutzer gewählte Repository ist öffentlich. Ausschließlich Quellcode,
Dokumentation und synthetische Tests veröffentlichen. Hauptbranch-Schutz und
verbindliche CI-Prüfungen nach dem ersten erfolgreichen Workflow einrichten.
Pro Arbeitspaket Branch und prüfbarer Pull Request; keine automatische Veröffentlichung
oder Produktivbereitstellung. Jeder Pull Request nennt Problem, Änderung, Tests und
offene Grenzen. CI führt zunächst Fachtests auf Python 3.11/3.13 aus; mobile Builds,
Integrations- und Oberflächentests werden mit deren Implementierung ergänzt.
CI enthält nur synthetische Daten und minimale Leserechte. Secrets nur in dafür
vorgesehenen GitHub-/Betriebsgeheimnisspeichern, niemals im Chat oder Quellcode.

## Quellen der Vorrecherche

- https://www.miditas.de/postbuch.html
- https://www.postbuch-online.de/Default.aspx
- https://docs.paperless-ngx.com/
- https://developers.google.com/ml-kit/vision/text-recognition/v2/android
- https://developer.apple.com/documentation/vision/recognizing-text-in-images
- https://github.com/ggml-org/whisper.cpp
- https://ai.google.dev/gemma/docs/gemma-3n
- https://github.com/google-ai-edge/LiteRT-LM
