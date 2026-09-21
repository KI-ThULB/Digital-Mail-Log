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


def _gedreht(quelle: Path, ziel: Path, grad: int = 90) -> Path:
    """Legt ein Prüfbild quer – so, wie eine Sendung auf dem Tisch liegt."""
    from PIL import Image

    Image.open(quelle).rotate(grad, expand=True).save(ziel)
    return ziel


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
        cls.browser = cls.playwright.chromium.launch(
            args=[
                # Erlaubt den Kameraweg im Test ohne echte Kamera: Chromium
                # liefert ein erzeugtes Bild und fragt nicht nach Erlaubnis.
                "--use-fake-ui-for-media-stream",
                "--use-fake-device-for-media-stream",
            ]
        )

    @classmethod
    def tearDownClass(cls):
        cls.browser.close()
        cls.playwright.stop()
        cls.server.shutdown()
        cls.store.close()
        cls.tmp.cleanup()

    def setUp(self):
        self.context = self.browser.new_context(
            viewport={"width": 414, "height": 896}, locale="de-DE", permissions=["camera"]
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

    def _markiere(self, seite, x0, y0, x1, y1):
        """Markiert einen Bereich für eine Seite, in Anteilen des Bildes."""
        page = self.page
        # Der Bereich wird sanft ins Bild gerollt; erst danach stehen die Maße fest.
        page.wait_for_timeout(800)
        if not page.is_hidden("#zuschnitt-rollen"):
            page.click(f'[data-rolle="{seite}"]')
        buehne = page.query_selector(".zuschnitt__buehne").bounding_box()
        page.mouse.move(buehne["x"] + x0 * buehne["width"], buehne["y"] + y0 * buehne["height"])
        page.mouse.down()
        page.mouse.move(
            buehne["x"] + x1 * buehne["width"],
            buehne["y"] + y1 * buehne["height"],
            steps=6,
        )
        page.mouse.up()
        self.assertIsNotNone(
            page.query_selector(f'[data-bereich="{seite}"]'),
            f"Der Bereich für {seite} muss nach dem Ziehen stehen",
        )

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

            # Ohne Markierung, über „Ganzes Bild“: dann muss die automatische
            # Zuordnung greifen – großer Block Empfänger, kleine Zeile darüber
            # Absender.
            page.wait_for_selector("#zuschnitt:not([hidden])")
            page.click("#zuschnitt-ganz")
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
            page.click("#zuschnitt-ganz")
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

    def test_angeschlossene_kamera_liefert_ein_bild_zum_markieren(self):
        """Der zweite Aufnahmeweg für den Arbeitsplatzrechner.

        Geprüft wird die Kette: Kamera öffnen, Bild abnehmen, Markieren steht
        bereit — und dass die Kamera danach wieder frei ist. Die Erkennung
        selbst bleibt außen vor; das erzeugte Prüfbild von Chromium trägt keinen
        Text. Der Server wird über 127.0.0.1 angesprochen, was im Browser als
        sicherer Kontext gilt — genau deshalb ist der Kamerazugriff ohne TLS
        überhaupt möglich.
        """
        page = self.page
        page.goto(self.base)
        page.wait_for_selector("#kennung:not(:empty)")
        self.assertTrue(page.evaluate("() => window.isSecureContext"))
        page.click("#neu")

        page.wait_for_selector("#kamera-oeffnen:not([hidden])")
        page.click("#kamera-oeffnen")
        page.wait_for_selector("#kamera:not([hidden])")
        page.wait_for_function("() => document.getElementById('kamera-bild').videoWidth > 0")

        page.click("#kamera-aufnehmen")
        page.wait_for_selector("#zuschnitt:not([hidden])")
        self.assertTrue(page.is_hidden("#kamera"), "Die Kamera schließt nach der Aufnahme")
        self.assertFalse(
            page.evaluate("() => Boolean(document.getElementById('kamera-bild').srcObject)"),
            "Das Lämpchen darf nicht weiterbrennen",
        )

        # Das abgenommene Bild steht als Vorlage zum Markieren bereit.
        masse = page.evaluate(
            """() => {
                const l = document.getElementById('zuschnitt-bild');
                return { b: l.width, h: l.height };
            }"""
        )
        self.assertGreater(masse["b"], 0)
        self.assertGreater(masse["h"], 0)

        # Und der gewohnte Weg funktioniert weiter.
        self._markiere("empfaenger", 0.1, 0.1, 0.9, 0.6)
        self.assertFalse(page.is_disabled("#zuschnitt-erkennen"))

    @unittest.skipUnless(
        TESSERACT.exists(), "Texterkennung nicht eingerichtet (web/vendor/hole-tesseract.sh)."
    )
    def test_markierte_bereiche_werden_seitenweise_erkannt(self):
        """Was markiert wurde, entscheidet über die Seite – ohne jedes Raten.

        Der Regelweg: die erfassende Person zieht ein Rechteck über die Anschrift
        und sagt durch die Wahl der Seite, was dort steht. Die Erkennung liest
        dann nur noch. Jeder Bereich wird einzeln erkannt, was ihn klein und
        damit schnell und sicher macht.
        """
        with tempfile.TemporaryDirectory() as folder:
            image = _parcel_label_png(Path(folder) / "etikett.png")
            page = self.page
            page.goto(self.base)
            page.wait_for_selector("#kennung:not(:empty)")
            page.click("#neu")
            page.set_input_files("#foto-erkennung", str(image))
            page.wait_for_selector("#zuschnitt:not([hidden])")

            # Die Lage der Blöcke im Prüfbild, in Anteilen der Bildhöhe. Die
            # Reihenfolge ist gleichgültig, deshalb hier der Absender zuerst.
            self._markiere("absender", 0.04, 0.38, 0.96, 0.58)
            self._markiere("empfaenger", 0.04, 0.13, 0.96, 0.36)
            self.assertIn("Empfänger und Absender", page.text_content("#zuschnitt-stand"))

            page.click("#zuschnitt-erkennen")
            page.wait_for_selector("#ocr-ergebnis:not([hidden])", timeout=180_000)

            empfaenger = " | ".join(
                page.input_value(f"#empfaenger-{feld}") for feld in ("name", "org", "adresse")
            )
            absender = " | ".join(
                page.input_value(f"#absender-{feld}") for feld in ("name", "org", "adresse")
            )
            self.assertIn("69121", empfaenger)
            self.assertIn("Tiergartenstr", empfaenger)
            self.assertIn("07743", absender)
            self.assertIn("Bibliotheksplatz", absender)

            # Ohne erkannte Person bleibt das Namensfeld leer. Früher wanderte
            # die Organisation ersatzweise hinein und stand dann doppelt da.
            self.assertEqual(page.input_value("#absender-name"), "")
            self.assertIn("Landesbibliothek", page.input_value("#absender-org"))
            self.assertNotIn("07743", empfaenger, "Die Seiten dürfen nicht vermischt werden")

            # Die Beschriftung lag mit im Rechteck; sie gehört in kein Feld.
            self.assertNotIn("mpfaenger", empfaenger)
            self.assertNotIn("bsender", absender)

            # Der Statustext benennt beide Seiten einzeln.
            status = page.text_content("#ocr-status")
            self.assertIn("Empfänger:", status)
            self.assertIn("Absender:", status)

    def test_schmaler_streifen_bleibt_ein_streifen(self):
        """Ein quer gedruckter Absender am Rand ist ein schmaler Streifen.

        Er wurde als Antippen gewertet und durch den großen Vorgaberahmen
        ersetzt — die Erkennung las dann den halben Umschlag statt des Namens.
        Am echten Umschlag gemessen: derselbe Absender einmal 18 % Zuversicht
        („EN A“), nach der Berichtigung 94 % („Kulturrat Thüringen e.V.“).
        """
        with tempfile.TemporaryDirectory() as folder:
            image = _parcel_label_png(Path(folder) / "etikett.png")
            page = self.page
            page.goto(self.base)
            page.wait_for_selector("#kennung:not(:empty)")
            page.click("#neu")
            page.set_input_files("#foto-erkennung", str(image))
            page.wait_for_selector("#zuschnitt:not([hidden])")

            # Vier Prozent breit, dreißig Prozent hoch: bewusst gezogen.
            self._markiere("empfaenger", 0.30, 0.20, 0.34, 0.50)
            breite = page.evaluate(
                "() => document.querySelector('[data-bereich=\"empfaenger\"]').style.width"
            )
            self.assertLess(
                float(breite.rstrip("%")), 10, "Der gezogene Streifen darf nicht aufgeblasen werden"
            )

            # Ein echtes Antippen dagegen setzt weiterhin einen Vorgaberahmen.
            buehne = page.query_selector(".zuschnitt__buehne").bounding_box()
            page.mouse.click(buehne["x"] + 0.6 * buehne["width"], buehne["y"] + 0.7 * buehne["height"])
            breite = page.evaluate(
                "() => document.querySelector('[data-bereich=\"empfaenger\"]').style.width"
            )
            self.assertGreater(
                float(breite.rstrip("%")), 50, "Ein Tipp setzt einen Rahmen in Vorgabegröße"
            )

    @unittest.skipUnless(
        TESSERACT.exists(), "Texterkennung nicht eingerichtet (web/vendor/hole-tesseract.sh)."
    )
    def test_quer_liegende_sendung_wird_aufgerichtet(self):
        """Ein quer liegender Umschlag ist für die Erkennung sonst unlesbar.

        Sie liest nur waagerechte Zeilen und deutet hochkant stehende Zeichen
        einzeln — heraus kommt Buchstabensalat. Geprüft wird beides: dass das
        Drehen von Hand Bild und Markierungen mitnimmt, und dass die Erkennung
        die Leserichtung notfalls selbst findet.
        """
        with tempfile.TemporaryDirectory() as folder:
            quer = _gedreht(
                _envelope_png(Path(folder) / "umschlag.png"), Path(folder) / "quer.png"
            )
            page = self.page
            page.goto(self.base)
            page.wait_for_selector("#kennung:not(:empty)")
            page.click("#neu")
            page.set_input_files("#foto-erkennung", str(quer))
            page.wait_for_selector("#zuschnitt:not([hidden])")

            # Das Bild steht quer: hoch statt breit.
            hoch = page.evaluate(
                "() => { const l = document.getElementById('zuschnitt-bild');"
                " return l.height > l.width; }"
            )
            self.assertTrue(hoch, "Das Prüfbild muss quer liegen")

            # Und es muss ganz auf den Bildschirm passen: über der Fläche ist
            # Scrollen abgeschaltet, sonst ließe sich nicht markieren. Ragte das
            # Bild darüber hinaus, wäre sein oberer Teil unerreichbar.
            page.wait_for_timeout(300)
            buehne = page.query_selector(".zuschnitt__buehne").bounding_box()
            fenster = page.viewport_size["height"]
            self.assertLessEqual(
                buehne["height"], fenster, "Das Bild darf nicht höher als das Fenster sein"
            )

            # Markieren, dann drehen: die Markierung muss mitwandern.
            self._markiere("empfaenger", 0.1, 0.1, 0.9, 0.5)
            vorher = page.evaluate(
                "() => document.querySelector('[data-bereich=\"empfaenger\"]').style.width"
            )
            page.click("#zuschnitt-drehen")
            nachher = page.evaluate(
                "() => document.querySelector('[data-bereich=\"empfaenger\"]').style.height"
            )
            self.assertEqual(vorher, nachher, "Aus der Breite wird beim Drehen die Höhe")
            breit = page.evaluate(
                "() => { const l = document.getElementById('zuschnitt-bild');"
                " return l.width > l.height; }"
            )
            self.assertTrue(breit, "Nach dem Drehen steht das Bild aufrecht")

            # Für die Erkennung wieder ganz von vorn: unmarkiert, quer, und die
            # Anwendung muss die Leserichtung allein finden.
            page.click("#zuschnitt-abbrechen")
            page.set_input_files("#foto-erkennung", str(quer))
            page.wait_for_selector("#zuschnitt:not([hidden])")
            self._markiere("empfaenger", 0.02, 0.02, 0.98, 0.98)
            page.click("#zuschnitt-erkennen")
            page.wait_for_selector("#ocr-ergebnis:not([hidden])", timeout=180_000)

            empfaenger = page.input_value("#empfaenger-adresse")
            self.assertIn("07743", empfaenger)
            self.assertIn("Bibliotheksplatz", empfaenger)
            self.assertIn("gedreht", page.text_content("#ocr-status"))

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

    def test_postleitzahl_prueft_den_ort(self):
        """Der gemeldete Fall: die Erkennung las „WE“, wo „WEIMAR“ stand.

        Die Postleitzahl daneben ist fünfstellig und eindeutig — sie weiß, wie
        der Ort heißt. Geprüft wird gegen eine Tabelle im eigenen
        Webverzeichnis; es geht keine Anschrift an einen Kartendienst.
        """
        page = self.page
        page.goto(self.base)
        page.wait_for_selector("#kennung:not(:empty)")
        page.click("#neu")

        # Abgekürzter Ort: die Prüfung bietet den vollen Namen an.
        page.fill("#empfaenger-adresse", "Musterverein e.V.\nBeispielweg 3\n99423 WE")
        page.wait_for_selector("#empfaenger-pruefung:not([hidden])")
        meldung = page.text_content("#empfaenger-pruefung")
        self.assertIn("Weimar", meldung)
        self.assertIn("WE", meldung)

        page.click("#empfaenger-pruefung button")
        self.assertEqual(
            page.input_value("#empfaenger-adresse"),
            "Musterverein e.V.\nBeispielweg 3\n99423 Weimar",
        )
        # Nach der Übernahme stimmt es, und die Meldung verschwindet.
        page.wait_for_selector("#empfaenger-pruefung", state="hidden")

        # Eine stimmige Anschrift löst gar keine Meldung aus.
        page.fill("#absender-adresse", "Musterverlag GmbH\nBeispielweg 3\n07743 Jena")
        page.wait_for_timeout(200)
        self.assertTrue(page.is_hidden("#absender-pruefung"))

        # Ein Widerspruch wird benannt, aber nichts stillschweigend geändert.
        page.fill("#absender-adresse", "Musterverlag GmbH\nBeispielweg 3\n07743 Erfurt")
        page.wait_for_selector("#absender-pruefung:not([hidden])")
        self.assertIn("Jena", page.text_content("#absender-pruefung"))
        self.assertIn("07743 Erfurt", page.input_value("#absender-adresse"))

    @unittest.skipUnless(
        TESSERACT.exists(), "Texterkennung nicht eingerichtet (web/vendor/hole-tesseract.sh)."
    )
    def test_gefuellte_felder_werden_nicht_stillschweigend_uebergangen(self):
        """Der stille Fehler: bei einem gefüllten Feld lief die Erkennung ins Leere.

        Bei der Bearbeitung eines gespeicherten Eintrags sind die Felder gefüllt.
        Eine neue Erkennung überschreibt sie nicht — zu Recht, sonst wäre jede
        Berichtigung von Hand verloren. Nur sagte die Meldung trotzdem
        „übernommen“. Wer das sieht, sucht den Fehler bei der Erkennung, wo
        keiner ist.
        """
        with tempfile.TemporaryDirectory() as folder:
            image = _envelope_png(Path(folder) / "umschlag.png")
            page = self.page
            page.goto(self.base)
            page.wait_for_selector("#kennung:not(:empty)")
            page.click("#neu")

            # Wie bei einem gespeicherten Eintrag: die Felder stehen schon.
            page.fill("#absender-org", "Von Hand eingetragen")
            page.fill("#absender-adresse", "Von Hand eingetragen 1\n00000 Musterstadt")
            page.set_input_files("#foto-absender", str(image))
            page.wait_for_selector("#zuschnitt:not([hidden])")
            page.click("#zuschnitt-ganz")
            page.wait_for_selector("#ocr-ergebnis:not([hidden])", timeout=180_000)

            # Das Eingetragene bleibt stehen …
            self.assertEqual(page.input_value("#absender-org"), "Von Hand eingetragen")
            self.assertIn("Musterstadt", page.input_value("#absender-adresse"))
            # … die Meldung sagt es …
            self.assertIn("schon gefüllt", page.text_content("#ocr-status"))
            # … und das Erkannte wird ausdrücklich angeboten.
            page.wait_for_selector("#absender-uebernahme:not([hidden])")
            angebot = page.text_content("#absender-uebernahme")
            self.assertIn("Landesbibliothek", angebot)

            page.click("#absender-uebernahme button")
            self.assertIn("Landesbibliothek", page.input_value("#absender-org"))
            page.wait_for_selector("#absender-uebernahme", state="hidden")

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
