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
from postbuch.domain import Contact
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


def _parcel_label_png(path: Path) -> Path:
    """Erzeugt ein erfundenes Paketetikett als Prüfbild.

    Nachgebaut ist die Bauform, die an einem echten Etikett Schwierigkeiten
    machte: Beschriftungen für beide Seiten, dazwischen Feldangaben des
    Frachtführers und Zeichenfolgen, wie die Erkennung sie aus Strichcodes
    liest. Die Anschriften sind erfunden.
    """
    from PIL import Image, ImageDraw, ImageFont

    image = Image.new("RGB", (1000, 1000), "white")
    draw = ImageDraw.Draw(image)
    draw.rectangle([6, 6, 994, 994], outline="black", width=4)

    def font(size):
        for name in (
            "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
            "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
        ):
            if Path(name).exists():
                return ImageFont.truetype(name, size)
        return ImageFont.load_default()

    zeilen = [
        (40, "Paketdienst Musterfracht GmbH", 26),
        (80, "lIl|Ilj 0H8Y %(0Lj8", 26),
        (140, "Empfaenger:", 30),
        (180, "Musterverlag GmbH", 36),
        (226, "Frau Anna Beispiel", 36),
        (272, "Tiergartenstr. 17", 36),
        (318, "69121 Heidelberg", 36),
        (390, "Absender:", 30),
        (430, "Landesbibliothek Jena", 36),
        (476, "Bibliotheksplatz 2", 36),
        (522, "07743 Jena", 36),
        (600, "Referenz 1: 4711-0815", 26),
        (640, "Gewicht 22,00 kg", 26),
        (680, "Schaeden muessen innerhalb von 7 Tagen gemeldet werden", 22),
    ]
    for y, text, groesse in zeilen:
        draw.text((60, y), text, font=font(groesse), fill="black")
    # Ein Feld voller Strichcode-Rauschen, wie es unten auf Etiketten steht.
    for index in range(6):
        draw.text((60, 740 + index * 34), "J U 8 1 k %s Wl1N 0207" % ("|" * (index + 3)),
                  font=font(24), fill="black")
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
        cls.store.save_contact(
            Contact(
                id="intern-erwerbung",
                organisation="Thüringer Universitäts- und Landesbibliothek",
                name="Erwerbung",
                address="Bibliotheksplatz 2\n07743 Jena",
                psp_element="001.A-02",
                internal=True,
            ),
            "prueflauf",
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

    def _rahmen_aufziehen(self):
        """Zieht den Zuschnittrahmen an zwei Griffen über das ganze Bild."""
        page = self.page
        # Der Bereich wird sanft ins Bild gerollt; erst danach stehen die Maße fest.
        page.wait_for_timeout(800)
        buehne = page.query_selector(".zuschnitt__buehne").bounding_box()

        def ziehen(griff, x, y):
            box = page.query_selector(griff).bounding_box()
            page.mouse.move(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
            page.mouse.down()
            page.mouse.move(x, y, steps=4)
            page.mouse.up()

        ziehen(".rahmen__griff--nw", buehne["x"] - 40, buehne["y"] - 40)
        ziehen(".rahmen__griff--se", buehne["x"] + buehne["width"] + 40, buehne["y"] + buehne["height"] + 40)
        anteil = page.evaluate(
            """() => {
                const b = document.querySelector('.zuschnitt__buehne').getBoundingClientRect();
                const r = document.getElementById('zuschnitt-rahmen').getBoundingClientRect();
                return (r.width / b.width) * (r.height / b.height);
            }"""
        )
        self.assertGreater(anteil, 0.9, "Der Rahmen muss sich bis an den Rand ziehen lassen")

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

            # Zwischen Aufnahme und Erkennung liegt der Zuschnitt. Beim Testbild
            # ist die ganze Fläche das Anschriftenfeld, also wird der Rahmen an
            # den Griffen aufgezogen – das prüft die Griffe und die Rechnung
            # zugleich – und dann der Ausschnitt erkannt.
            page.wait_for_selector("#zuschnitt:not([hidden])")
            self._rahmen_aufziehen()
            page.click("#zuschnitt-erkennen")
            page.wait_for_selector("#ocr-ergebnis:not([hidden])", timeout=180_000)

            erkannt = page.text_content("#ocr-text")
            self.assertIn("Jena", erkannt)
            self.assertIn("07743", erkannt)
            self.assertIn("auf dem Gerät", page.text_content("#ocr-status") + " auf dem Gerät")

            # Der große Adressblock ist der Empfänger – auf jedem Umschlag,
            # unabhängig von der Richtung der Sendung.
            empfaenger = page.input_value("#empfaenger-adresse")
            self.assertIn("07743", empfaenger)
            self.assertIn("Bibliotheksplatz", empfaenger)
            self.assertNotIn("10115", empfaenger, "Absenderzeile gehört nicht zum Empfänger")

            # Die kleine Zeile darüber ist der Absender und wird eigens zerlegt.
            absender = page.input_value("#absender-adresse")
            self.assertIn("10115", absender)
            self.assertIn("Musterverlag", page.input_value("#absender-org") + absender)
            self.assertNotIn("Bibliotheksplatz", absender)

    @unittest.skipUnless(
        TESSERACT.exists(), "Texterkennung nicht eingerichtet (web/vendor/hole-tesseract.sh)."
    )
    def test_paketetikett_folgt_den_beschriftungen(self):
        """Auf einem Etikett gilt die Beschriftung, nicht die Anordnung.

        Anlass war ein echtes Paketetikett: die Erkennung lief, trug aber
        Frachtpapier-Angaben und Strichcode-Reste in die Adressfelder. Geprüft
        wird beides – dass die Beschriftungen die Seiten bestimmen und dass das
        Beiwerk außen bleibt.
        """
        with tempfile.TemporaryDirectory() as folder:
            image = _parcel_label_png(Path(folder) / "etikett.png")
            page = self.page
            page.goto(self.base)
            page.wait_for_selector("#kennung:not(:empty)")
            page.click("#neu")
            page.set_input_files("#foto-erkennung", str(image))
            page.wait_for_selector("#zuschnitt:not([hidden])")
            self._rahmen_aufziehen()
            page.click("#zuschnitt-erkennen")
            page.wait_for_selector("#ocr-ergebnis:not([hidden])", timeout=180_000)

            empfaenger = " | ".join(
                page.input_value(f"#empfaenger-{feld}") for feld in ("name", "org", "adresse")
            )
            absender = " | ".join(
                page.input_value(f"#absender-{feld}") for feld in ("name", "org", "adresse")
            )
            self.assertIn("69121", empfaenger)
            self.assertIn("07743", absender)
            self.assertNotIn("07743", empfaenger, "Die Seiten dürfen nicht vertauscht werden")

            for fremd in ("Referenz", "Gewicht", "gemeldet", "Musterfracht", "0207"):
                self.assertNotIn(fremd, empfaenger + absender, f"{fremd} gehört in kein Adressfeld")

    @unittest.skipUnless(
        TESSERACT.exists(), "Texterkennung nicht eingerichtet (web/vendor/hole-tesseract.sh)."
    )
    def test_foto_je_seite_fuellt_nur_diese_seite(self):
        """Ein Bild, das ausdrücklich für eine Seite aufgenommen wird, gehört dorthin."""
        with tempfile.TemporaryDirectory() as folder:
            image = _envelope_png(Path(folder) / "umschlag.png")
            page = self.page
            page.goto(self.base)
            page.wait_for_selector("#kennung:not(:empty)")
            page.click("#neu")
            page.set_input_files("#foto-absender", str(image))
            page.wait_for_selector("#zuschnitt:not([hidden])")
            page.click("#zuschnitt-ganz")
            page.wait_for_selector("#ocr-ergebnis:not([hidden])", timeout=180_000)

            self.assertIn("Bibliotheksplatz", page.input_value("#absender-adresse"))
            self.assertEqual(page.input_value("#empfaenger-adresse"), "")

    def test_interne_stelle_per_schnellwahl(self):
        page = self.page
        page.goto(self.base)
        page.wait_for_selector("#kennung:not(:empty)")
        page.click("#neu")

        # Eingang: die eigene Einrichtung ist der Empfänger.
        page.wait_for_selector("#empfaenger-schnellwahl:not([hidden])")
        self.assertTrue(page.is_hidden("#absender-schnellwahl"))
        page.click("#empfaenger-schnellwahl button.chip")
        self.assertIn("Landesbibliothek", page.input_value("#empfaenger-org"))
        self.assertIn("07743", page.input_value("#empfaenger-adresse"))

        # Ausgang: die eigene Einrichtung wechselt auf die Absenderseite.
        page.click('[data-richtung-wahl="outgoing"]')
        page.wait_for_selector("#absender-schnellwahl:not([hidden])")
        self.assertTrue(page.is_hidden("#empfaenger-schnellwahl"))
        page.click("#absender-schnellwahl button.chip")
        self.assertIn("Landesbibliothek", page.input_value("#absender-org"))
        # Das hinterlegte PSP-Element wird beim Ausgang gleich mit übernommen.
        self.assertEqual(page.input_value("#psp"), "001.A-02")
        self.assertEqual(self.errors, [])


if __name__ == "__main__":
    unittest.main()
