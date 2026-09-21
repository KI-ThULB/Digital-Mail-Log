"""Entwicklungsserver.

Startet die Schnittstelle und liefert die Web-App aus einem Verzeichnis aus.
Gedacht für Entwicklung, Vorführung und den Test auf dem eigenen Mobilgerät im
selben Netz.

**Nicht für den Betrieb geeignet.** Der Server bearbeitet Anfragen nacheinander,
kennt kein TLS und keine Anmeldung. Für den Pilotbetrieb gehört die Anwendung
hinter einen Webserver, der TLS beendet und die Anmeldung durchführt; siehe
``docs/BETRIEB.md``.

    python3 -m postbuch.server --db postbuch.sqlite3 --host 0.0.0.0 --port 8000
"""

from __future__ import annotations

import argparse
import mimetypes
import os
import re
import socket
import subprocess
from pathlib import Path
from wsgiref.simple_server import WSGIRequestHandler, make_server

from .api import Application
from .storage import Store

WEB_ROOT = Path(__file__).resolve().parent.parent / "web"

_NO_CACHE = {".html", ".js", ".mjs", ".css", ".webmanifest", ".json"}


class StaticFiles:
    """Liefert die Web-App aus; alles unter ``/api/`` geht an die Anwendung."""

    def __init__(self, app, root: Path):
        self.app = app
        self.root = root.resolve()

    def __call__(self, environ, start_response):
        path = environ.get("PATH_INFO", "/")
        if path.startswith("/api/"):
            return self.app(environ, start_response)
        if environ.get("REQUEST_METHOD", "GET") not in ("GET", "HEAD"):
            start_response("405 Method Not Allowed", [("Content-Type", "text/plain")])
            return [b"Nur GET."]

        relative = path.lstrip("/") or "index.html"
        target = (self.root / relative).resolve()
        if not str(target).startswith(str(self.root)):
            start_response("403 Forbidden", [("Content-Type", "text/plain")])
            return [b"Ausserhalb des Web-Verzeichnisses."]
        if target.is_dir():
            target = target / "index.html"
        if not target.is_file():
            start_response("404 Not Found", [("Content-Type", "text/plain; charset=utf-8")])
            return [f"Nicht gefunden: {path}".encode("utf-8")]

        data = target.read_bytes()
        media_type, _ = mimetypes.guess_type(target.name)
        if target.suffix == ".webmanifest":
            media_type = "application/manifest+json"
        if target.suffix == ".mjs":
            media_type = "text/javascript"
        headers = [
            ("Content-Type", f"{media_type or 'application/octet-stream'}"
             + ("; charset=utf-8" if (media_type or "").startswith("text/") or target.suffix in _NO_CACHE else "")),
            ("Content-Length", str(len(data))),
            ("Cache-Control", "no-cache" if target.suffix in _NO_CACHE else "public, max-age=86400"),
        ]
        if target.name == "sw.js":
            headers.append(("Service-Worker-Allowed", "/"))
        start_response("200 OK", headers)
        return [] if environ.get("REQUEST_METHOD") == "HEAD" else [data]


class _Handler(WSGIRequestHandler):
    def log_message(self, fmt, *args):  # kürzere Protokollzeilen
        print(f"{self.address_string()} {fmt % args}")


# Schnittstellen, die kein erreichbares lokales Netz sind: Tunnel aller Art.
_TUNNEL = ("utun", "tun", "tap", "ppp", "ipsec", "gpd", "wg", "tailscale", "zt")
# Schnittstellen, an denen ein Telefon im selben WLAN hängt.
_FUNK = ("en", "wlan", "wl", "wifi", "eth")


def schnittstellen_aus_text(text: str) -> list[tuple[str, str]]:
    """Liest Name und IPv4-Adresse aus ``ifconfig`` oder ``ip -4 -o addr``.

    Zwei Formate, ein Parser – beide nennen den Namen und dahinter ``inet``:

        en0: flags=8863<UP,...>          ip: 3: en0    inet 192.168.178.43/24 ...
            inet 192.168.178.43 netmask ...

    Reine Textverarbeitung, damit sie sich ohne Netz und ohne Betriebssystem
    prüfen lässt.
    """
    gefunden: list[tuple[str, str]] = []
    name = ""
    for zeile in text.splitlines():
        # ip-Format: „3: en0    inet 10.0.0.5/24“ – Name und Adresse in einer Zeile.
        treffer = re.match(r"^\d+:\s+(\S+?)\s+inet\s+(\d+\.\d+\.\d+\.\d+)", zeile)
        if treffer:
            gefunden.append((treffer.group(1), treffer.group(2)))
            continue
        # ifconfig-Format: Name am Zeilenanfang, Adresse in einer Folgezeile.
        kopf = re.match(r"^(\S+?):\s", zeile)
        if kopf and not zeile.startswith((" ", "\t")):
            name = kopf.group(1)
            continue
        adresse = re.search(r"\binet\s+(\d+\.\d+\.\d+\.\d+)", zeile)
        if adresse and name:
            gefunden.append((name, adresse.group(1)))
    return [(n, a) for n, a in gefunden if not a.startswith("127.")]


def _schnittstellen() -> list[tuple[str, str]]:
    """Fragt das Betriebssystem nach seinen Schnittstellen. Fehler sind erlaubt."""
    for befehl in (["ip", "-4", "-o", "addr", "show"], ["ifconfig"], ["ifconfig", "-a"]):
        try:
            ergebnis = subprocess.run(befehl, capture_output=True, text=True, timeout=5)
        except (OSError, subprocess.SubprocessError):
            continue
        if ergebnis.returncode == 0:
            adressen = schnittstellen_aus_text(ergebnis.stdout)
            if adressen:
                return adressen
    return []


def _einordnung(name: str, adresse: str = "") -> str:
    """Sagt in einem Halbsatz, wofür eine Adresse taugt.

    Die Adresse wird zuerst betrachtet, denn zwei Bereiche sind Sackgassen, die
    aussehen wie ein gewöhnliches Netz:

    ``192.0.0.0/29`` vergibt macOS sich selbst, wenn das Netz nur IPv6 spricht
    (464XLAT). Das kommt im Hotspot eines Telefons vor, dessen Mobilfunknetz
    IPv6-only ist. Die Adresse ist eine Übersetzungsadresse des eigenen Rechners
    – kein anderes Gerät erreicht sie, auch nicht das Telefon, das den Hotspot
    aufspannt. Abhilfe: im iPhone „Maximale Kompatibilität“ einschalten, dann
    vergibt der Hotspot wieder IPv4 (172.20.10.x).

    ``169.254.0.0/16`` heißt, dass die Netzkonfiguration fehlgeschlagen ist.
    """
    if adresse.startswith("192.0.0."):
        return (
            "IPv6-Hotspot (464XLAT) – vom Telefon NICHT erreichbar; "
            "im iPhone „Maximale Kompatibilität“ einschalten"
        )
    if adresse.startswith("169.254."):
        return "ohne Netzkonfiguration – keine Verbindung zustande gekommen"
    if name.startswith(_TUNNEL):
        return "VPN oder Tunnel – vom Telefon aus nicht erreichbar"
    if name.startswith(_FUNK):
        return "lokales Netz – diese Adresse am Telefon verwenden"
    return "unklar"


def _local_addresses(port: int) -> list[str]:
    """Alle Adressen, unter denen der Server zu erreichen sein könnte.

    Absichtlich vollständig und beschriftet. Die frühere Fassung nannte nur die
    Adresse der Standardroute – bei aktivem VPN ist das die Tunneladresse, und
    genau die ist vom Telefon im WLAN nicht erreichbar. Wer sie abtippt, sucht
    den Fehler an der falschen Stelle.
    """
    zeilen = [f"http://127.0.0.1:{port}/ (nur dieser Rechner)"]
    schnittstellen = _schnittstellen()
    if not schnittstellen:
        try:
            probe = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            probe.connect(("192.0.2.1", 1))  # TEST-NET-1, es fließen keine Daten
            schnittstellen = [("", probe.getsockname()[0])]
            probe.close()
        except OSError:
            pass
    # Erst das lokale Netz, dann alles andere: oben steht, was gebraucht wird.
    for name, adresse in sorted(
        schnittstellen, key=lambda e: (not e[0].startswith(_FUNK), e[0], e[1])
    ):
        beschriftung = f" ({name}, {_einordnung(name, adresse)})" if name else ""
        zeilen.append(f"http://{adresse}:{port}/{beschriftung}")
    return zeilen


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description="Entwicklungsserver des digitalen Postbuchs")
    parser.add_argument("--db", default=os.environ.get("POSTBUCH_DB", "postbuch.sqlite3"))
    parser.add_argument("--fotos", default=os.environ.get("POSTBUCH_FOTOS"))
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument(
        "--benutzer",
        default=os.environ.get("POSTBUCH_DEV_USER", "entwicklung"),
        help="Feste Kennung für den Entwicklungsbetrieb ohne Anmeldung.",
    )
    parser.add_argument("--web", default=str(WEB_ROOT))
    args = parser.parse_args(argv)

    store = Store(args.db, photo_dir=args.fotos)
    app = StaticFiles(
        Application(store, development_user=args.benutzer, default_role="verwalten"),
        Path(args.web),
    )
    server = make_server(args.host, args.port, app, handler_class=_Handler)
    print("Digitales Postbuch – Entwicklungsserver")
    print(f"  Datenbank : {Path(args.db).resolve() if args.db != ':memory:' else 'Arbeitsspeicher'}")
    print(f"  Fotos     : {store.photo_dir or '(keines)'}")
    print(f"  Web-App   : {Path(args.web).resolve()}")
    print(f"  Kennung   : {args.benutzer} (Entwicklungsmodus, keine Anmeldung)")
    for url in _local_addresses(args.port) if args.host == "0.0.0.0" else [f"http://{args.host}:{args.port}/"]:
        print(f"  Adresse   : {url}")
    if args.host == "0.0.0.0":
        print(
            "\n  Auf dem Telefon die Adresse des lokalen Netzes verwenden. Ein aktives VPN\n"
            "  kann die Verbindung trotzdem verhindern: dann für den Test trennen."
        )
    print("\n  Achtung: ohne TLS und ohne Anmeldung. Keine echten Postdaten erfassen.")
    print("  Beenden mit Strg+C\n")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nBeendet.")
    finally:
        store.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
