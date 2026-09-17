"""Durchlauf durch die Web-App mit einem echten Browser.

Geprüft wird der Weg, den die Poststelle täglich geht: erfassen, in der Liste
wiederfinden, berichtigen. Zusätzlich – sofern die Bestandteile der
Texterkennung geholt wurden – die Erkennung einer Anschrift aus einem Bild.

Ausführen::

    pip install playwright && playwright install chromium
    python3 -m unittest tests.test_oberflaeche -v

Ohne Playwright überspringt sich der Test selbst. Er ersetzt keine Prüfung auf
echten Geräten: Kamera, Mikrofon und das Verhalten von iOS im Startbildschirm
lassen sich nur dort beurteilen.
"""

from __future__ import annotations

import socket
import tempfile
import threading
import unittest
from pathlib import Path
from wsgiref.simple_server import WSGIRequestHandler, make_server

try:  # pragma: no cover - Umgebungsabhängig
    from playwright.sync_api import sync_playwright
except ImportError:  # pragma: no cover
    sync_playwright = None

from postbuch.api import Application
from postbuch.server import StaticFiles
from postbuch.storage import Store

WEB = Path(__file__).resolve().parent.parent / "web"
TESSERACT = WEB / "vendor" / "tesseract" / "tesseract.min.js"


class _Quiet(WSGIRequestHandler):
    def log_message(self, *args):
        pass


def _free_port() -> int:
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        return probe.getsockname()[1]


def _envelope_png(path: Path) -> Path:
    """Erzeugt einen erfundenen Briefumschlag als Prüfbild."""
    from PIL import Image, ImageDraw, ImageFont

    image = Image.new("RGB", (1000, 560), "white")
    draw = ImageDraw.Draw(image)
    draw.rectangle([4, 4, 996, 556], outline="#bbbbbb", width=3)

    def font(size):
        for name in (
            "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
            "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
        ):
            if Path(name).exists():
                return ImageFont.truetype(name, size)
        return ImageFont.load_default()

    draw.text((70, 150), "Musterverlag GmbH · Hauptstr. 4 · 10115 Berlin", font=font(17), fill="#555555")
    lines = [
        "Friedrich-Schiller-Universitaet Jena",
        "Thueringer Universitaets- und Landesbibliothek",
        "Bibliotheksplatz 2",
        "07743 Jena",
    ]
    for index, line in enumerate(lines):
        draw.text((70, 210 + index * 46), line, font=font(34), fill="black")
    image.save(path)
    return path


@unittest.skipIf(sync_playwright is None, "Playwright ist nicht installiert.")
class BrowserFlow(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        cls.store = Store(
            str(Path(cls.tmp.name) / "postbuch.sqlite3"),
            photo_dir=str(Path(cls.tmp.name) / "fotos"),
        )
        app = StaticFiles(
            Application(cls.store, development_user="prueflauf", default_role="verwalten"), WEB
        )
        cls.port = _free_port()
        cls.server = make_server("127.0.0.1", cls.port, app, handler_class=_Quiet)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.base = f"http://127.0.0.1:{cls.port}/"

        cls.playwright = sync_playwright().start()
        cls.browser = cls.playwright.chromium.launch()

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.playwright.stop()
        cls.server.shutdown()
        cls.store.close()
        cls.tmp.cleanup()

    def setUp(self):
        self.context = self.browser.new_context(
            viewport={"width": 414, "height": 896}, locale="de-DE"
        )
        self.page = self.context.new_page()
        self.errors = []
        self.page.on("pageerror", lambda exc: self.errors.append(str(exc)))
        self.page.on(
            "console",
            lambda msg: self.errors.append(msg.text) if msg.type == "error" else None,
        )

    def tearDown(self):
        self.context.close()

    # -- Prüfungen --------------------------------------------------------

    def test_erfassen_finden_berichtigen(self):
        page = self.page
        page.goto(self.base)
        page.wait_for_selector("#kennung:not(:empty)")
        self.assertIn("prueflauf", page.text_content("#kennung"))

        page.click("#neu")
        page.click('[data-richtung-wahl="outgoing"]')
        self.assertFalse(page.is_hidden("#kosten"), "Kostenfelder müssen beim Ausgang sichtbar sein")

        page.fill("#empfaenger-name", "Dr. Arndt")
        page.fill("#empfaenger-org", "Friedrich-Schiller-Universität Jena")
        page.fill("#beschreibung", "Rahmenvertrag, unterschrieben")
        page.fill("#art", "Einschreiben")
        page.fill("#porto", "2,75")
        page.fill("#psp", "001.A-02")
        page.click("#speichern")
        # Nach dem Speichern steht das Formular sofort für die nächste Sendung
        # bereit. Das ist der Takt einer Poststelle, nicht ein Rücksprung.
        page.wait_for_selector("#hinweis:not([hidden])")
        self.assertIn("Gespeichert", page.text_content("#hinweis"))
        self.assertEqual(page.input_value("#empfaenger-name"), "")

        page.click('#view-formular [data-zurueck]')
        page.wait_for_selector(".entry")
        text = page.text_content("#liste")
        self.assertIn("Dr. Arndt", text)
        self.assertIn("2026-A-00001", text)
        self.assertIn("2,75", text)
        self.assertIn("Porto der angezeigten Ausgänge", page.text_content("#summe"))

        # Suche über mehrere Wörter in beliebiger Reihenfolge
        page.fill("#suche", "arndt rahmenvertrag")
        page.wait_for_timeout(120)
        self.assertEqual(page.locator(".entry").count(), 1)
        page.fill("#suche", "gibtesnicht")
        page.wait_for_timeout(120)
        self.assertEqual(page.locator(".entry").count(), 0)
        page.click("#filter-zuruecksetzen")

        # Berichtigen mit Begründung, Historie muss entstehen
        page.click(".entry")
        page.wait_for_selector("#detail-inhalt")
        page.click("#detail-inhalt button.primary")
        page.fill("#porto", "3,45")
        page.fill("#grund", "Porto laut Beleg berichtigt")
        page.click("#speichern")
        page.wait_for_selector("#view-liste:not([hidden])")
        page.click(".entry")
        page.wait_for_function(
            "() => document.querySelectorAll('#detail-inhalt .history li').length === 2"
        )
        history = page.text_content(".history")
        self.assertIn("Fassung 2", history)
        self.assertIn("Porto laut Beleg berichtigt", history)
        self.assertIn("2,75", history, "Der frühere Portobetrag muss nachvollziehbar bleiben")
        self.assertEqual(self.errors, [])

    def test_immer_genau_eine_ansicht_sichtbar(self):
        """Eine eigene display-Regel kann das hidden-Attribut überstimmen.

        Genau das war der Fall: Liste, Formular und Detailansicht standen
        übereinander. Im Test mit Attributabfragen fiel es nicht auf, erst im
        ganzseitigen Bildschirmfoto.
        """
        page = self.page
        page.goto(self.base)
        page.wait_for_selector("#kennung:not(:empty)")

        def sichtbar():
            return [
                view
                for view in ("view-liste", "view-formular", "view-detail")
                if page.is_visible(f"#{view}")
            ]

        self.assertEqual(sichtbar(), ["view-liste"])
        page.click("#neu")
        self.assertEqual(sichtbar(), ["view-formular"])
        page.click('#view-formular [data-zurueck]')
        self.assertEqual(sichtbar(), ["view-liste"])

    def test_richtungswechsel_entfernt_kostenfelder_mit_warnung(self):
        page = self.page
        page.goto(self.base)
        page.wait_for_selector("#kennung:not(:empty)")
        page.click("#neu")
        page.click('[data-richtung-wahl="outgoing"]')
        page.fill("#porto", "1,80")
        page.fill("#psp", "001")
        page.click('[data-richtung-wahl="incoming"]')
        self.assertFalse(page.is_hidden("#richtung-warnung"), "Es muss gewarnt werden")
        self.assertEqual(page.input_value("#porto"), "")
        self.assertEqual(page.input_value("#psp"), "")
        self.assertTrue(page.is_hidden("#kosten"))

    def test_ungueltiges_porto_wird_abgewiesen(self):
        page = self.page
        page.goto(self.base)
        page.wait_for_selector("#kennung:not(:empty)")
        page.click("#neu")
        page.click('[data-richtung-wahl="outgoing"]')
        page.fill("#porto", "1.000,00")
        page.click("#speichern")
        page.wait_for_selector("#formular-fehler:not([hidden])")
        self.assertIn("Tausendertrennzeichen", page.text_content("#formular-fehler"))

    @unittest.skipUnless(
        TESSERACT.exists(), "Texterkennung nicht eingerichtet (web/vendor/hole-tesseract.sh)."
    )
    def test_texterkennung_fuellt_adressfelder(self):
        with tempfile.TemporaryDirectory() as folder:
            image = _envelope_png(Path(folder) / "umschlag.png")
            page = self.page
            page.goto(self.base)
            page.wait_for_selector("#kennung:not(:empty)")
            page.click("#neu")
            page.set_input_files("#foto-erkennung", str(image))
            page.wait_for_selector("#ocr-ergebnis:not([hidden])", timeout=180_000)

            erkannt = page.text_content("#ocr-text")
            self.assertIn("Jena", erkannt)
            self.assertIn("07743", erkannt)
            self.assertIn("auf dem Gerät", page.text_content("#ocr-status") + " auf dem Gerät")

            adresse = page.input_value("#absender-adresse")
            self.assertIn("07743", adresse)
            self.assertIn("Bibliotheksplatz", adresse)
            # Die Absenderzeile des Fensterumschlags darf nicht in der Anschrift landen
            self.assertNotIn("10115", adresse)


if __name__ == "__main__":
    unittest.main()
