# Architektur

## Überblick

```
Mobilgerät oder Arbeitsplatz                    Server der Einrichtung
┌──────────────────────────────────┐            ┌───────────────────────────┐
│ Web-App (installierbar)          │            │ Webserver mit TLS         │
│                                  │            │ und Anmeldung             │
│  Kamera ──► Texterkennung        │            │  (Shibboleth, Kerberos)   │
│            (Tesseract, lokal)    │            │        │                  │
│                 │                │            │        ▼                  │
│                 ▼                │  HTTPS     │ ┌───────────────────────┐ │
│          Adressparser (Regeln)   │ ◄────────► │ │ WSGI-Anwendung        │ │
│                 │                │  JSON      │ │ postbuch/api.py       │ │
│                 ▼                │            │ └───────────┬───────────┘ │
│        Prüfen und Bestätigen     │            │             ▼             │
│                 │                │            │ ┌───────────────────────┐ │
│                 ▼                │            │ │ Fachkern              │ │
│   IndexedDB + Warteschlange      │            │ │ postbuch/domain.py    │ │
│   (erfassen ohne Netz)           │            │ └───────────┬───────────┘ │
└──────────────────────────────────┘            │             ▼             │
                                                │  SQLite (WAL)  + Fotos    │
   Bild und Ton verlassen das Gerät nie.        │  Revisionen fortschreibend│
   Nur bestätigte Felder gehen hinaus.          └───────────────────────────┘
```

## Verzeichnisse

| Ort | Inhalt |
|---|---|
| `postbuch/domain.py` | Fachliche Regeln. Kein Netz, keine Datenbank, keine Zeitzonenannahmen. |
| `postbuch/storage.py` | SQLite: Sendungen, Revisionen, Kontakte, Fotos, Nummernkreise. |
| `postbuch/api.py` | JSON-Schnittstelle als WSGI-Anwendung, Rechte, Export. |
| `postbuch/matching.py` | Kontaktvorschläge und Dublettenhinweise, regelbasiert. |
| `postbuch/server.py` | Entwicklungsserver. Nicht für den Betrieb. |
| `web/` | Die Web-App: Rumpf, Gestaltung, Module, Service Worker. |
| `web/js/adressen.js` | Zerlegung erkannten Textes in Adressfelder. |
| `web/js/ocr.js` | Austauschbarer Anschluss für die Texterkennung. |
| `web/vendor/` | Bestandteile der Erkennung, per Skript geholt, nicht im Repository. |
| `tests/konformitaet/` | Gemeinsamer Prüfkorpus für Fachkern und Web-App. |
| `archiv/` | Abgelöste Entwürfe mit Begründung. |

## Datenmodell

Eine **Sendung** (`Entry`) hat eine technische Kennung, eine lesbare
Postbuchnummer und eine Folge unveränderlicher **Revisionen**. Die jeweils
letzte Revision ist der geltende Stand.

| Feld | Anmerkung |
|---|---|
| `direction` | `incoming` oder `outgoing` |
| `sender`, `recipient` | Name, Organisation, Anschrift und **optional** ein Kontaktverweis |
| `description` | freier Text; „Inhalt unbekannt“ ist zulässig |
| `shipment_type` | freier Text mit Vorschlagsliste; Poststellen brauchen eigene Begriffe |
| `shipment_date` | fachliches Datum, getrennt von der Erfassungszeit |
| `postage_cents` | ganzzahlige Cent, nur Ausgang; `null` heißt unbekannt |
| `psp_element` | Text, nur Ausgang, führende Nullen bleiben erhalten |
| `status` | `active` oder `cancelled` |

**Die Anschrift wird bei der Sendung mitgespeichert, nicht nur verknüpft.** Wird
ein Kontakt später geändert oder mit einer Dublette zusammengeführt, bleiben
vergangene Postbucheinträge, wie sie waren. Ein Postbuch hält fest, was damals
auf dem Umschlag stand.

### Postbuchnummer

`2026-E-00042` beziehungsweise `2026-A-00042`, fortlaufend je Jahr und Richtung,
vergeben ausschließlich vom Server. Offline erfasste Sendungen haben zunächst nur
ihre technische Kennung und bekommen die Nummer bei der Übertragung. Die
Oberfläche zeigt in diesem Zustand „Nummer folgt“ statt einer erfundenen Nummer.

## Erfassen ohne Netz

1. Die App vergibt die Kennung selbst. Sie steht sofort fest, auch ohne
   Verbindung.
2. Der Eintrag geht in IndexedDB und in die Warteschlange.
3. Bei Verbindung gehen die Vorgänge gesammelt an `POST /api/v1/sync`.
4. `create` mit bereits bekannter Kennung legt **keinen zweiten Eintrag** an,
   sondern liefert den vorhandenen. Deshalb ist ein abgebrochener Upload
   unschädlich.
5. Jeder Vorgang wird einzeln beantwortet: `ok`, `conflict` oder `rejected`. Ein
   fehlerhafter Vorgang hält die übrigen nicht auf.
6. Zurückgewiesene Vorgänge bleiben in der Warteschlange **sichtbar** stehen.
   Stilles Verwerfen wäre Datenverlust.

iOS führt keine Hintergrundsynchronisation aus. Übertragen wird deshalb, während
die App offen ist: beim Start, beim Zurückkehren in den Vordergrund, nach jeder
Erfassung und auf Knopfdruck. Für eine Poststelle ist das unkritisch – dort steht
man ohnehin am Gerät.

## Gleichzeitiges Bearbeiten

Jede Änderung nennt die Fassung, auf der sie beruht (`expected_version`). Stimmt
sie nicht mehr, antwortet der Server mit 409 und liefert den aktuellen Stand mit.
Ein stilles Überschreiben gibt es nicht.

## Texterkennung

`web/js/ocr.js` beschreibt einen Anschluss: `name`, `version`, `available()`,
`recognise(blob)`. Vorhanden sind die Texterkennung des Betriebssystems, sofern
der Browser sie anbietet, und Tesseract als WebAssembly aus dem eigenen
Webverzeichnis. Wird die App später nativ gebaut, treten ML Kit und Apple Vision
an dieselbe Stelle.

Jedes Ergebnis führt Quelle, Fassung, Dauer und Zuversicht mit. Die Oberfläche
zeigt das an. Damit bleibt im Nachhinein unterscheidbar, was erkannt und was
bestätigt wurde.

**Ohne eingerichtete Erkennung gibt es keinen Rückfall auf einen Dienst im
Netz.** Die App meldet das und alle Felder werden von Hand ausgefüllt.

Das Bild zur Erkennung wird nach der Übernahme verworfen. Nur ausdrücklich
hinzugefügte Belegfotos bleiben am Eintrag – zwei verschiedene Zwecke, zwei
verschiedene Wege.

### Der Weg vom Bild zum Feld

0. **Aufnehmen.** Auf dem Telefon über das Dateifeld mit `capture`, das die
   Kamera des Geräts öffnet. Am Arbeitsplatzrechner wahlweise über eine
   angeschlossene Kamera (`getUserMedia`): iPhone über Continuity, Webcam,
   Kamera über dem Sortiertisch. Der zweite Weg erscheint nur im sicheren
   Kontext — wozu auch `127.0.0.1` zählt. Siehe E12.
1. **Markieren.** Die erfassende Person zieht je ein Rechteck über die Anschrift
   des Empfängers und des Absenders und benennt damit die Seite. Erkannt wird nur
   der markierte Ausschnitt (`crop` als Anteile des Bildes, also unabhängig von
   der Auflösung), jeder Bereich für sich. Das ist der wirksamste Schritt der
   ganzen Kette: es macht die Fläche klein **und** nimmt der Maschine das Deuten
   ab. Siehe E09 und E11 in `docs/ENTSCHEIDUNGEN.md`.
2. **Vorbereiten.** `prepareImage` lädt das Bild über ein `<img>`-Element, damit
   die Drehung aus den EXIF-Angaben berücksichtigt wird – ein um 90° gedrehtes
   Bild ist praktisch unlesbar –, schneidet zu, verkleinert auf 1600 Pixel
   Kantenlänge und entsättigt.
3. **Erkennen.** Der Anschluss liefert Text, Dauer und Zuversicht.
4. **Zerlegen.** Bei einem markierten Bereich steht die Seite fest: der Text
   wird mit `ohneAnkerbeschriftung` von mitmarkierten Beschriftungen befreit und
   mit `parseAddress` in Felder zerlegt. Ohne Markierung übernimmt `parseLabel`:
   es sucht zuerst Beschriftungen („Empfänger“, „Absender“, auch englisch und
   ohne Umlaute, wie die Erkennung sie oft liest) und folgt ihnen, sonst gilt die
   Umschlagsregel. Zeilen, die keine Anschrift sein können – Strichcode-Reste,
   Frachtangaben, Haftungstexte – werden verworfen und gezählt.
5. **Übernehmen oder nicht.** War die Zuversicht gering **und** ergibt das
   Ergebnis keine vollständige Anschrift, bleibt jedes Feld leer und die
   Oberfläche sagt es, je Seite einzeln. In einem markierten Bereich genügt ein
   Anker – Postleitzahl oder Straße –, weil die Markierung selbst eine Aussage
   ist. Siehe E10 und E11.

## Rechte

| Rolle | Darf |
|---|---|
| `lesen` | Liste, Suche, Detailansicht, Fotos, Export |
| `erfassen` | zusätzlich anlegen, berichtigen, stornieren, Fotos hinzufügen |
| `verwalten` | zusätzlich Kontakte zusammenführen, Dublettenübersicht |

Die Zuordnung liegt in einer JSON-Datei außerhalb des Repositorys
(`POSTBUCH_ROLLEN`). Die Kennung kommt vom vorgelagerten Webserver; siehe
`docs/BETRIEB.md`.

## Was bewusst fehlt

* **Diktat.** Begründung in `docs/ENTSCHEIDUNGEN.md`, E05.
* **Verschlüsselung der lokalen Daten.** Der Browser gibt der Web-App keinen
  Zugriff auf den sicheren Gerätespeicher. Deshalb: Gerätesperre und
  Geräteverschlüsselung verpflichtend, und offen Erfasstes zügig übertragen.
* **Verteilworkflow.** Übergabe, Zuständigkeit und Empfangsbestätigung sind
  nicht abgebildet. Ob das Postbuch bei der Registrierung endet, ist eine offene
  fachliche Frage.
* **Prüfung gegen PSP-Stammdaten.** Ohne Vorgaben der Einrichtung wird kein
  SAP-Format erfunden. Das Feld bleibt Text.
