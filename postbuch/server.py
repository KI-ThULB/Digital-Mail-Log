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
import socket
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


def _local_addresses(port: int) -> list[str]:
    names = {"127.0.0.1"}
    try:
        probe = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        probe.connect(("192.0.2.1", 1))  # TEST-NET-1, es fließen keine Daten
        names.add(probe.getsockname()[0])
        probe.close()
    except OSError:
        pass
    return [f"http://{name}:{port}/" for name in sorted(names)]


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
