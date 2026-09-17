# Betrieb

Dieses Dokument richtet sich an die IT, die den Pilotbetrieb einrichtet.

> **Der Entwicklungsserver ist nicht für den Betrieb geeignet.** Er kennt kein
> TLS, keine Anmeldung und bearbeitet Anfragen nacheinander. Für den Pilotbetrieb
> gehört die Anwendung hinter einen Webserver, der TLS beendet und die Anmeldung
> durchführt.

## 1. Was auf dem Server gebraucht wird

* Python 3.11 oder neuer. Der Fachkern kommt ohne Fremdpakete aus.
* Ein WSGI-fähiger Webserver: Apache mit `mod_wsgi`, oder nginx beziehungsweise
  Apache als Vorschaltserver vor `gunicorn`.
* TLS. Die Web-App verlangt einen sicheren Ursprung; ohne ihn arbeiten Kamera,
  Service Worker und dauerhafter lokaler Speicher nicht.
* Die vorhandene Anmeldung der Einrichtung.

## 2. Anmeldung – der wichtigste Punkt

Die Anwendung übernimmt die Kennung der angemeldeten Person aus einem Kopffeld.
**Der Webserver muss dieses Kopffeld bei jeder Anfrage von außen überschreiben.**
Tut er das nicht, kann sich jede Person als beliebige andere ausgeben.

Apache mit Shibboleth, als Muster:

```apache
<Location "/postbuch">
    AuthType shibboleth
    ShibRequestSetting requireSession 1
    Require valid-user

    # Zwingend: ein von außen mitgeschicktes Kopffeld wird verworfen und
    # ausschließlich aus der bestätigten Sitzung neu gesetzt.
    RequestHeader unset X-Remote-User
    RequestHeader set X-Remote-User "expr=%{REMOTE_USER}"

    ProxyPass        http://127.0.0.1:8001/
    ProxyPassReverse http://127.0.0.1:8001/
</Location>
```

Prüfen lässt sich das so:

```sh
curl -H 'X-Remote-User: fremde.kennung' https://server/postbuch/api/v1/session
```

Erscheint dort `fremde.kennung`, ist die Einrichtung **nicht** sicher.

## 3. Einstellungen

| Variable | Bedeutung |
|---|---|
| `POSTBUCH_DB` | Pfad zur SQLite-Datei, außerhalb des Webverzeichnisses |
| `POSTBUCH_FOTOS` | Verzeichnis für Belegfotos, außerhalb des Webverzeichnisses |
| `POSTBUCH_USER_HEADER` | Name des Kopffelds, Vorgabe `X-Remote-User` |
| `POSTBUCH_ROLLEN` | JSON-Datei `{"kennung": "lesen\|erfassen\|verwalten"}` |
| `POSTBUCH_STANDARDROLLE` | Rolle für nicht aufgeführte Kennungen, Vorgabe `erfassen` |
| `POSTBUCH_DEV_USER` | **Nur Entwicklung.** Feste Kennung ohne Anmeldung. Im Betrieb niemals setzen. |

Im Betrieb ist `POSTBUCH_STANDARDROLLE=lesen` die vorsichtigere Wahl; wer
erfassen darf, wird in der Rollendatei ausdrücklich genannt.

## 4. Start mit gunicorn

```sh
pip install gunicorn
export POSTBUCH_DB=/var/lib/postbuch/postbuch.sqlite3
export POSTBUCH_FOTOS=/var/lib/postbuch/fotos
export POSTBUCH_ROLLEN=/etc/postbuch/rollen.json
export POSTBUCH_STANDARDROLLE=lesen
gunicorn --workers 1 --threads 8 --bind 127.0.0.1:8001 "postbuch.api:create_app()"
```

**Ein Arbeiterprozess, mehrere Threads.** Die Postbuchnummer ist fortlaufend;
mehrere Prozesse auf derselben SQLite-Datei würden sich gegenseitig blockieren.
Für die Größenordnung einer Poststelle reicht ein Prozess bei weitem.

Die Dateien aus `web/` liefert der Webserver unmittelbar aus, mit `Cache-Control:
no-cache` für `index.html`, die Module und `sw.js`.

## 5. Texterkennung einrichten

```sh
./web/vendor/hole-tesseract.sh
```

Rund 19 MB, einmalig. Danach liefert der eigene Server alles aus; zur Laufzeit
wird nichts bei Dritten abgefragt. Ohne diesen Schritt läuft die App vollständig,
nur die Kamera-Erkennung bleibt aus und meldet das.

## 6. Auf den Geräten einrichten

**iPhone und iPad:** Seite in Safari öffnen, Teilen, „Zum Home-Bildschirm“.
Andere Browser bieten das auf iOS nicht an.
**Android:** Chrome bietet „App installieren“ an.

Beim ersten Öffnen bittet die App den Browser, den lokalen Speicher dauerhaft zu
halten. Die Fußzeile zeigt, ob das zugesagt wurde.

Bitte auf den Geräten verpflichtend:

* Gerätesperre mit Code oder Biometrie, kurze Sperrzeit.
* Geräteverschlüsselung eingeschaltet.
* Erfasstes zügig übertragen; das Gerät ist Erfassungsmittel, nicht Ablage.

## 7. Sicherung

Zu sichern sind zwei Dinge: die SQLite-Datei und das Fotoverzeichnis.

```sh
sqlite3 /var/lib/postbuch/postbuch.sqlite3 ".backup '/sicherung/postbuch-$(date +%F).sqlite3'"
tar czf "/sicherung/fotos-$(date +%F).tar.gz" -C /var/lib/postbuch fotos
```

`.backup` statt `cp`: die Datei läuft im WAL-Modus, eine einfache Kopie kann
mitten in einem Schreibvorgang entstehen.

**Eine Sicherung, die nie zurückgespielt wurde, ist keine Sicherung.** Die
Wiederherstellung gehört einmal geprobt und das Ergebnis vermerkt, bevor echte
Post erfasst wird.

## 8. Vor der ersten echten Sendung zu klären

Diese Punkte sind keine Programmierarbeit, aber ohne sie sollte der Pilotbetrieb
nicht beginnen:

- [ ] **Aufbewahrungsfrist** für Einträge und Belegfotos, abgestimmt mit Archiv
      und Datenschutz.
- [ ] **Löschkonzept:** wann werden Fotos endgültig entfernt, wer darf das
      auslösen, wie wird es vermerkt.
- [ ] **Vertrauliche Post:** was wird fotografiert, was ausdrücklich nicht.
      Personalsachen und Bewerbungen gehören in der Regel nicht abgelichtet.
- [ ] **Verzeichnis von Verarbeitungstätigkeiten** ergänzt.
- [ ] **Anforderungen an Nachweise** mit dem Justiziariat geklärt. Eine
      Änderungshistorie allein ist keine Revisionssicherheit.
- [ ] **Zuständigkeit** für Betrieb, Sicherung und Aktualisierungen benannt.
- [ ] **Wiederherstellung** einmal erfolgreich geprobt.

## 9. Störungen

| Beobachtung | Wahrscheinliche Ursache |
|---|---|
| „Nicht angemeldet“ | Der Webserver übergibt das Kopffeld nicht. Punkt 2 prüfen. |
| Kamera meldet sich nicht | Kein TLS, oder die Web-App wurde nicht installiert. |
| „Keine lokale Texterkennung“ | Punkt 5 nicht ausgeführt oder Dateien nicht erreichbar. |
| Warteschlange wird nicht leer | Serverfehler; die Fußzeile nennt die Rückmeldung. |
| „Eintrag wurde zwischenzeitlich geändert“ | Zwei Geräte am selben Eintrag. Neu laden, Änderung wiederholen. |
| Alte Fassung der App hält sich | `Cache-Control: no-cache` für `index.html` und `sw.js` prüfen. |
