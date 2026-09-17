"""Tests der Schnittstelle.

Schwerpunkte: Rechte, Schutz vor stillem Überschreiben, gefahrlose Wiederholung
der Warteschlange, sauberer Export und die Frage, was geschieht, wenn der
vorgelagerte Webserver keine Benutzerkennung übergibt.
"""

import io
import json
import tempfile
import unittest
from pathlib import Path
from wsgiref.util import setup_testing_defaults

from postbuch.api import Application
from postbuch.storage import Store

PNG = b"\x89PNG\r\n\x1a\n" + b"0" * 64


class Klient:
    """Minimaler WSGI-Aufrufer, damit kein Server laufen muss."""

    def __init__(self, app, user=None, header="HTTP_X_REMOTE_USER"):
        self.app = app
        self.user = user
        self.header = header

    def __call__(self, method, path, body=None, content_type="application/json", user=...):
        environ = {}
        setup_testing_defaults(environ)
        environ["REQUEST_METHOD"] = method
        path, _, query = path.partition("?")
        environ["PATH_INFO"] = path
        environ["QUERY_STRING"] = query
        person = self.user if user is ... else user
        if person:
            environ[self.header] = person
        raw = json.dumps(body).encode("utf-8") if isinstance(body, (dict, list)) else (body or b"")
        environ["CONTENT_LENGTH"] = str(len(raw))
        environ["CONTENT_TYPE"] = content_type
        environ["wsgi.input"] = io.BytesIO(raw)

        captured = {}

        def start_response(status, headers):
            captured["status"] = int(status.split()[0])
            captured["headers"] = dict(headers)

        data = b"".join(self.app(environ, start_response))
        if captured["headers"].get("Content-Type", "").startswith("application/json"):
            return captured["status"], json.loads(data.decode("utf-8")), captured["headers"]
        return captured["status"], data, captured["headers"]


class ApiTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.store = Store(
            str(Path(self.tmp.name) / "postbuch.sqlite3"),
            photo_dir=str(Path(self.tmp.name) / "fotos"),
        )
        self.app = Application(
            self.store,
            roles={"leitung": "verwalten", "gast": "lesen", "postst": "erfassen"},
            default_role="erfassen",
        )
        self.call = Klient(self.app, user="postst")

    def tearDown(self):
        self.store.close()
        self.tmp.cleanup()

    def anlegen(self, **overrides):
        payload = {
            "direction": "outgoing",
            "recipient": {"name": "Dr. Arndt", "organisation": "FSU Jena"},
            "description": "Rahmenvertrag",
            "shipment_type": "Einschreiben",
            "postage_cents": 275,
            "psp_element": "001.A-02",
            "local_date": "2026-09-17",
            **overrides,
        }
        return self.call("POST", "/api/v1/entries", payload)

    # -- Anmeldung und Rechte ---------------------------------------------

    def test_ohne_kennung_kein_zugriff(self):
        status, body, _ = self.call("GET", "/api/v1/entries", user=None)
        self.assertEqual(status, 401)
        self.assertIn("angemeldet", body["error"])

    def test_gesundheitspruefung_braucht_keine_anmeldung(self):
        status, body, _ = self.call("GET", "/api/v1/health", user=None)
        self.assertEqual(status, 200)
        self.assertEqual(body["status"], "ok")

    def test_entwicklungsmodus_ist_als_solcher_erkennbar(self):
        app = Application(self.store, development_user="entwicklung")
        status, body, _ = Klient(app)("GET", "/api/v1/session", user=None)
        self.assertEqual(status, 200)
        self.assertTrue(body["development_mode"])
        self.assertEqual(body["actor"], "entwicklung")

    def test_lesende_rolle_darf_nicht_schreiben(self):
        gast = Klient(self.app, user="gast")
        self.assertEqual(gast("GET", "/api/v1/entries")[0], 200)
        status, body, _ = gast("POST", "/api/v1/entries", {"direction": "incoming"})
        self.assertEqual(status, 403)
        self.assertIn("Berechtigung", body["error"])

    def test_verwaltung_nur_fuer_die_leitung(self):
        self.assertEqual(self.call("GET", "/api/v1/contacts/duplicates")[0], 403)
        self.assertEqual(
            Klient(self.app, user="leitung")("GET", "/api/v1/contacts/duplicates")[0], 200
        )

    def test_die_kennung_landet_in_der_historie(self):
        _, entry, _ = self.anlegen()
        self.assertEqual(entry["actor"], "postst")
        self.assertEqual(entry["history"][0]["actor"], "postst")

    # -- Sendungen --------------------------------------------------------

    def test_anlegen_liefert_nummer_und_historie(self):
        status, entry, _ = self.anlegen()
        self.assertEqual(status, 201)
        self.assertEqual(entry["number"], "2026-A-00001")
        self.assertEqual(entry["version"], 1)
        self.assertEqual(entry["postage_cents"], 275)
        self.assertEqual(len(entry["history"]), 1)

    def test_eingang_mit_kostenfeldern_wird_abgewiesen(self):
        status, body, _ = self.anlegen(direction="incoming", recipient={}, sender={"name": "x"})
        self.assertEqual(status, 422)
        self.assertIn("ausgehende Post", body["error"])

    def test_aenderung_ohne_fassungsangabe_wird_abgewiesen(self):
        _, entry, _ = self.anlegen()
        status, body, _ = self.call(
            "PUT", f"/api/v1/entries/{entry['id']}", {"direction": "outgoing",
                                                     "shipment_date": entry["shipment_date"]}
        )
        self.assertEqual(status, 400)
        self.assertIn("expected_version", body["error"])

    def test_veraltete_fassung_meldet_konflikt(self):
        _, entry, _ = self.anlegen()
        felder = {k: entry[k] for k in
                  ("direction", "sender", "recipient", "description", "shipment_type",
                   "shipment_date", "postage_cents", "psp_element", "status", "note")}
        self.call("PUT", f"/api/v1/entries/{entry['id']}",
                  {**felder, "expected_version": 1, "postage_cents": 300, "reason": "Beleg"})
        status, body, _ = self.call(
            "PUT", f"/api/v1/entries/{entry['id']}", {**felder, "expected_version": 1}
        )
        self.assertEqual(status, 409)
        self.assertEqual(body["code"], "version_conflict")

    def test_unbekannte_kennung_ergibt_404(self):
        self.assertEqual(self.call("GET", "/api/v1/entries/gibt-es-nicht")[0], 404)

    def test_stornieren_verlangt_begruendung(self):
        _, entry, _ = self.anlegen()
        status, _, _ = self.call(
            "POST", f"/api/v1/entries/{entry['id']}/cancel", {"expected_version": 1, "reason": ""}
        )
        self.assertEqual(status, 422)
        status, body, _ = self.call(
            "POST", f"/api/v1/entries/{entry['id']}/cancel",
            {"expected_version": 1, "reason": "Doppelt erfasst"},
        )
        self.assertEqual(status, 200)
        self.assertEqual(body["status"], "cancelled")

    def test_falsche_methode_und_unbekannter_pfad(self):
        self.assertEqual(self.call("DELETE", "/api/v1/entries")[0], 405)
        self.assertEqual(self.call("GET", "/api/v1/gibtesnicht")[0], 404)
        self.assertEqual(self.call("GET", "/api/v2/entries")[0], 404)

    def test_kaputtes_json_wird_freundlich_abgewiesen(self):
        status, body, _ = self.call("POST", "/api/v1/entries", b"{kein json")
        self.assertEqual(status, 400)
        self.assertIn("JSON", body["error"])

    # -- Filter und Auswertung --------------------------------------------

    def test_filter_und_volltextsuche(self):
        self.anlegen()
        self.anlegen(direction="incoming", sender={"name": "Springer Nature"}, recipient={},
                     postage_cents=None, psp_element=None, description="Zeitschriften")
        _, alle, _ = self.call("GET", "/api/v1/entries")
        self.assertEqual(alle["count"], 2)
        _, gefiltert, _ = self.call("GET", "/api/v1/entries?direction=incoming")
        self.assertEqual(gefiltert["count"], 1)
        _, gesucht, _ = self.call("GET", "/api/v1/entries?query=arndt%20rahmenvertrag")
        self.assertEqual(gesucht["count"], 1)
        self.assertEqual(self.call("GET", "/api/v1/entries?direction=seitwaerts")[0], 400)

    def test_portoauswertung(self):
        self.anlegen()
        self.anlegen(postage_cents=None)
        _, summary, _ = self.call("GET", "/api/v1/summary/postage")
        self.assertEqual(summary["postage_cents"], 275)
        self.assertEqual(summary["postage"], "2,75")
        self.assertEqual(summary["without_postage"], 1)

    def test_export_traegt_ein_bom_und_semikolon(self):
        self.anlegen()
        status, data, headers = self.call("GET", "/api/v1/export.csv")
        self.assertEqual(status, 200)
        self.assertTrue(data.startswith("﻿".encode("utf-8")), "Excel braucht das BOM")
        text = data.decode("utf-8-sig")
        self.assertIn("Postbuchnummer;Richtung;", text)
        self.assertIn("2026-A-00001;Ausgang;", text)
        self.assertIn("2,75", text)
        self.assertIn("attachment", headers["Content-Disposition"])

    # -- Fotos ------------------------------------------------------------

    def test_foto_hochladen_abrufen_entfernen(self):
        _, entry, _ = self.anlegen()
        status, photo, _ = self.call(
            "POST", f"/api/v1/entries/{entry['id']}/photos?caption=Umschlag", PNG, "image/png"
        )
        self.assertEqual(status, 201)
        status, data, headers = self.call("GET", f"/api/v1/photos/{photo['id']}")
        self.assertEqual(status, 200)
        self.assertEqual(data, PNG)
        self.assertEqual(headers["Content-Type"], "image/png")
        self.assertIn("no-store", headers["Cache-Control"])

        self.assertEqual(self.call("DELETE", f"/api/v1/photos/{photo['id']}")[0], 200)
        _, wieder, _ = self.call("GET", f"/api/v1/entries/{entry['id']}")
        self.assertEqual(wieder["photos"], [])
        self.assertEqual(len(wieder["all_photos"]), 1, "Das Entfernen bleibt protokolliert")

    def test_fremdes_dateiformat_wird_abgewiesen(self):
        _, entry, _ = self.anlegen()
        status, _, _ = self.call(
            "POST", f"/api/v1/entries/{entry['id']}/photos", b"<script>", "text/html"
        )
        self.assertEqual(status, 422)

    # -- Kontakte ---------------------------------------------------------

    def test_kontakte_anlegen_und_vorschlagen(self):
        status, contact, _ = self.call(
            "POST", "/api/v1/contacts",
            {"organisation": "Friedrich-Schiller-Universität Jena", "aliases": ["FSU Jena"],
             "psp_element": "001.A-02"},
        )
        self.assertEqual(status, 201)
        _, suggestions, _ = self.call("GET", "/api/v1/contacts/suggest?text=FSU%20Jena")
        self.assertEqual(suggestions["suggestions"][0]["contact"]["id"], contact["id"])
        self.assertEqual(suggestions["suggestions"][0]["score"], 1.0)

    # -- Warteschlange ----------------------------------------------------

    def test_warteschlange_ist_wiederholbar_und_meldet_einzeln(self):
        operations = [
            {"op": "create", "id": "offline-1", "client_ref": "a",
             "data": {"direction": "incoming", "sender": {"name": "Springer"},
                      "local_date": "2026-09-17"}},
            {"op": "create", "id": "offline-2", "client_ref": "b",
             "data": {"direction": "outgoing", "postage_cents": 185, "local_date": "2026-09-17"}},
            {"op": "update", "id": "gibt-es-nicht", "client_ref": "c", "expected_version": 1,
             "data": {"direction": "incoming", "shipment_date": "2026-09-17"}},
            {"op": "unsinn", "client_ref": "d", "data": {}},
        ]
        status, body, _ = self.call("POST", "/api/v1/sync", {"operations": operations})
        self.assertEqual(status, 200)
        zustand = [r["status"] for r in body["results"]]
        self.assertEqual(zustand, ["ok", "ok", "rejected", "rejected"])
        self.assertEqual([r["client_ref"] for r in body["results"]], ["a", "b", "c", "d"])

        # Dieselbe Warteschlange erneut: es darf nichts verdoppelt werden.
        status, wieder, _ = self.call("POST", "/api/v1/sync", {"operations": operations})
        self.assertEqual([r["status"] for r in wieder["results"]][:2], ["ok", "ok"])
        _, alle, _ = self.call("GET", "/api/v1/entries")
        self.assertEqual(alle["count"], 2)

    def test_warteschlange_meldet_konflikt_mit_aktuellem_stand(self):
        _, entry, _ = self.anlegen()
        felder = {k: entry[k] for k in
                  ("direction", "sender", "recipient", "description", "shipment_type",
                   "shipment_date", "postage_cents", "psp_element", "status", "note")}
        self.call("PUT", f"/api/v1/entries/{entry['id']}",
                  {**felder, "expected_version": 1, "postage_cents": 300})
        _, body, _ = self.call("POST", "/api/v1/sync", {"operations": [
            {"op": "update", "id": entry["id"], "client_ref": "x", "expected_version": 1,
             "data": felder}
        ]})
        result = body["results"][0]
        self.assertEqual(result["status"], "conflict")
        self.assertEqual(result["entry"]["postage_cents"], 300,
                         "Der aktuelle Stand wird mitgeliefert, damit das Gerät nachziehen kann")

    def test_warteschlange_begrenzt_die_menge(self):
        status, _, _ = self.call(
            "POST", "/api/v1/sync", {"operations": [{"op": "create", "data": {}}] * 201}
        )
        self.assertEqual(status, 413)


if __name__ == "__main__":
    unittest.main()
