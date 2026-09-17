# Teststatus – 17.09.2026

Ausgeführt: `python3 -m unittest discover -s tests -v`

Umgebung: lokales macOS, Python 3.13.8.
Ergebnis: 13 Tests bestanden, keine Fehler.

Geprüft: Geldformat und ungültige Beträge, leer gegenüber Null, Eingang ohne
Kostenfelder, explizites Entfernen beim Richtungswechsel, PSP-Schreibweise,
ungültige Felder, Erfassungszeit gegenüber lokalem Datum, historische Stände,
veraltete Änderungsversionen, kombinierte Filter und Sortierung.

Noch nicht geprüft oder implementiert: mobile App, Kamera, Mikrofon, OCR/ASR,
persistente Datenbank, Mehrbenutzerbetrieb, Rechte, Synchronisation, Export,
Fototransfer und Produktionsbetrieb. Die aktuelle Versionsprüfung ist eine
Referenz im flüchtigen Speicher, keine transaktionssichere Serverimplementierung.

GitHub-Workflow vorbereitet, aber noch nicht auf GitHub ausgeführt.
Ziel-Repository: KI-ThULB/Digital-Mail-Log. Dieser Stand wird als eigener
Entwicklungszweig mit Pull Request bereitgestellt. Der lokale Testlauf ersetzt
keinen erfolgreichen GitHub-Workflow oder mobile Gerätetests.
