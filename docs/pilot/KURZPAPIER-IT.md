# Digitales Postbuch — Kurzpapier für die IT

Einseitige Zusammenfassung zum Weiterleiten. Vollständige Fassung:
[`docs/BETRIEB.md`](../BETRIEB.md) im Repository
<https://github.com/KI-ThULB/Digital-Mail-Log>.

## Worum es geht

Erfassung von Post­ein- und -ausgängen in der Poststelle. Eine installierbare
Web-App auf Telefon, Tablet und Arbeitsplatzbildschirm, dazu ein kleiner Server
für Datenhaltung, Suche und Auswertung.

**Geschätzter Einrichtungsaufwand: ein halber Tag**, überwiegend für die
Anmeldung.

## Was gebraucht wird

- Python 3.11 oder neuer. **Der Fachkern kommt ohne Fremdpakete aus**; einziges
  Betriebspaket ist ein WSGI-Server (gunicorn oder `mod_wsgi`).
- Apache oder nginx als Vorschaltserver mit TLS.
- Die vorhandene Anmeldung der FSU (Shibboleth, Kerberos oder `mod_auth_openidc`).
- Wenige hundert MB Plattenplatz, wachsend mit den Belegfotos.

## Was **nicht** gebraucht wird

Das ist der Grund für die Bauform: kein App Store, kein
Apple-Developer-Programm, keine Signierung, keine Geräteverwaltung, kein
Node.js zur Laufzeit, kein Bündler, kein Übersetzungsschritt. Eine neue Fassung
ist ein Dateiabgleich im Webverzeichnis. Die Verteilung auf die Geräte entfällt
vollständig — die Nutzer legen die Seite über den Browser auf den
Startbildschirm.

## Der kritische Punkt: Anmeldung

**Die Anwendung führt keine eigene Benutzerverwaltung.** Sie übernimmt die
Kennung der angemeldeten Person aus einem Kopffeld. Der Vorschaltserver muss
dieses Kopffeld **bei jeder Anfrage von außen überschreiben** — sonst kann sich
jede Person als beliebige andere ausgeben.

```apache
<Location "/postbuch">
    AuthType shibboleth
    ShibRequestSetting requireSession 1
    Require valid-user

    # Zwingend: von außen mitgeschicktes Kopffeld verwerfen und ausschließlich
    # aus der bestätigten Sitzung neu setzen.
    RequestHeader unset X-Remote-User
    RequestHeader set X-Remote-User "expr=%{REMOTE_USER}"

    ProxyPass        http://127.0.0.1:8001/
    ProxyPassReverse http://127.0.0.1:8001/
</Location>
```

**Prüfung nach der Einrichtung:**

```sh
curl -H 'X-Remote-User: fremde.kennung' https://server/postbuch/api/v1/session
```

Erscheint in der Antwort `fremde.kennung`, ist die Einrichtung **nicht** sicher.
Bitte nicht in Betrieb nehmen, bevor diese Prüfung sauber durchläuft.

## Einstellungen

| Variable | Bedeutung |
|---|---|
| `POSTBUCH_DB` | SQLite-Datei, außerhalb des Webverzeichnisses |
| `POSTBUCH_FOTOS` | Verzeichnis für Belegfotos, außerhalb des Webverzeichnisses |
| `POSTBUCH_USER_HEADER` | Kopffeld mit der Kennung, Vorgabe `X-Remote-User` |
| `POSTBUCH_ROLLEN` | JSON-Datei `{"kennung": "lesen\|erfassen\|verwalten"}` |
| `POSTBUCH_STANDARDROLLE` | Rolle für nicht aufgeführte Kennungen — im Betrieb `lesen` |
| `POSTBUCH_DEV_USER` | **Nur Entwicklung.** Im Betrieb niemals setzen. |

## Start

```sh
gunicorn --workers 1 --threads 8 --bind 127.0.0.1:8001 "postbuch.api:create_app()"
```

**Ein Arbeiterprozess, mehrere Threads.** Die Postbuchnummer ist fortlaufend;
mehrere Prozesse auf derselben SQLite-Datei blockierten sich gegenseitig. Für die
Größenordnung einer Poststelle — einige Dutzend bis wenige hundert Sendungen am
Tag — reicht ein Prozess bei weitem. PostgreSQL bleibt möglich und beträfe nur
ein Modul.

Die Dateien aus `web/` liefert der Webserver unmittelbar aus, mit
`Cache-Control: no-cache` für `index.html`, die Module und `sw.js`.

Einmalig für die lokale Texterkennung: `./web/vendor/hole-tesseract.sh` — rund
19 MB, die anschließend vom eigenen Server ausgeliefert werden. Zur Laufzeit wird
nichts bei Dritten abgefragt.

Mitgeliefert ist außerdem `web/daten/plz-orte.txt` (186 KB): eine Postleitzahl-
Ort-Tabelle für die Plausibilitätsprüfung der Anschriften. Quelle GeoNames,
CC BY 4.0, Namensnennung in `web/daten/LIZENZ-plz.txt` und in der Fußzeile der
Anwendung. Neu erzeugen mit `python3 werkzeuge/plz-tabelle.py` — der einzige
Schritt, der überhaupt ins Netz geht, und er gehört in die Pflegeroutine, nicht
in den Betrieb. **Die Prüfung selbst läuft auf dem Gerät; es werden keine
Anschriften an Kartendienste übermittelt.**

## Sicherung

```sh
sqlite3 $POSTBUCH_DB ".backup '/sicherung/postbuch-$(date +%F).sqlite3'"
tar czf "/sicherung/fotos-$(date +%F).tar.gz" -C $(dirname $POSTBUCH_FOTOS) fotos
```

`.backup` statt `cp`: die Datei läuft im WAL-Modus, eine einfache Kopie kann
mitten in einem Schreibvorgang entstehen. **Die Wiederherstellung bitte einmal
proben, bevor echte Post erfasst wird.**

## Sicherheitsrelevante Eigenschaften

- Revisionen sind fortschreibend; Datenbankauslöser weisen `UPDATE` und `DELETE`
  auf der Revisionstabelle zurück. Einträge werden storniert, nie gelöscht.
- Belegfotos werden weder vom Service Worker noch vom Browser zwischengespeichert
  (`Cache-Control: no-store`) und liegen außerhalb des Webverzeichnisses.
- Es gibt keinen Rückfall auf einen Erkennungsdienst im Netz. Ohne lokale
  Erkennung bleibt sie aus und meldet das.
- Der lokale Speicher der Web-App ist **nicht** verschlüsselt — der Browser gibt
  ihr keinen Zugriff auf den sicheren Gerätespeicher. Daraus folgt:
  Gerätesperre und Geräteverschlüsselung auf den Erfassungsgeräten verpflichtend.

## Rückfragen

Quellcode, Architektur und Entscheidungen einschließlich Begründung liegen offen
im Repository. `docs/ARCHITEKTUR.md` beschreibt den Aufbau,
`docs/ENTSCHEIDUNGEN.md` warum es so und nicht anders gebaut ist.
