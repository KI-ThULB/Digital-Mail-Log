"""Tests der Speicherung.

Schwerpunkte: Fortschreibung statt Überschreiben, gefahrlose Wiederholung einer
Übertragung, getrennte Nummernkreise, Fotos als protokollierte Vorgänge und die
Verwendbarkeit aus mehreren Threads – ein WSGI-Server bedient Anfragen nicht
immer aus demselben Thread.
"""

import sqlite3
import tempfile
import threading
import unittest
from datetime import date, datetime, timezone
from pathlib import Path

from postbuch.domain import Contact, Fields, NotFound, Party, ValidationError, VersionConflict
from postbuch.storage import Store

PNG = b"\x89PNG\r\n\x1a\n" + b"0" * 64


class StoreTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.now = datetime(2026, 9, 17, 9, 0, tzinfo=timezone.utc)
        self.store = Store(
            str(Path(self.tmp.name) / "postbuch.sqlite3"),
            photo_dir=str(Path(self.tmp.name) / "fotos"),
            clock=lambda: self.now,
        )
        self.tag = date(2026, 9, 17)

    def tearDown(self):
        self.store.close()
        self.tmp.cleanup()

    def create(self, fields=None, **kwargs):
        return self.store.create_entry(
            fields or Fields("incoming", sender="Springer Nature"),
            kwargs.pop("actor", "postst"),
            local_date=self.tag,
            **kwargs,
        )

    # -- Grundlagen -------------------------------------------------------

    def test_anlegen_vergibt_nummer_und_erste_fassung(self):
        entry = self.create()
        self.assertEqual(entry.number, "2026-E-00001")
        self.assertEqual(entry.current.version, 1)
        self.assertEqual(entry.current.actor, "postst")
        self.assertEqual(entry.current.fields.shipment_date, self.tag)

    def test_nummernkreise_sind_je_richtung_und_jahr_getrennt(self):
        self.assertEqual(self.create().number, "2026-E-00001")
        self.assertEqual(self.create(Fields("outgoing")).number, "2026-A-00001")
        self.assertEqual(self.create().number, "2026-E-00002")
        alt = self.create(Fields("incoming", shipment_date=date(2025, 12, 31)))
        self.assertEqual(alt.number, "2025-E-00001")

    def test_wiederholte_uebertragung_erzeugt_keine_dublette(self):
        first = self.create(entry_id="fest-01")
        again = self.store.create_entry(
            Fields("outgoing", recipient="andere"), "andere", local_date=self.tag, entry_id="fest-01"
        )
        self.assertEqual(first.id, again.id)
        self.assertEqual(again.number, first.number)
        self.assertEqual(again.current.fields.direction, "incoming")
        self.assertEqual(len(self.store.entries()), 1)

    def test_daten_ueberleben_das_schliessen(self):
        path = str(Path(self.tmp.name) / "dauerhaft.sqlite3")
        with Store(path, photo_dir=str(Path(self.tmp.name) / "f2")) as store:
            store.create_entry(Fields("incoming", sender="A"), "x", local_date=self.tag)
        with Store(path, photo_dir=str(Path(self.tmp.name) / "f2")) as store:
            self.assertEqual(len(store.entries()), 1)
            self.assertEqual(store.entries()[0].number, "2026-E-00001")

    # -- Fortschreibung ---------------------------------------------------

    def test_revisionen_sind_nicht_veraenderbar(self):
        """Datenbankauslöser sichern die Historie, nicht nur die Anwendungslogik."""
        entry = self.create()
        with self.assertRaises(sqlite3.IntegrityError):
            self.store._db.execute("UPDATE revisions SET actor = 'fremd'")
        with self.assertRaises(sqlite3.IntegrityError):
            self.store._db.execute("DELETE FROM revisions")
        self.assertEqual(self.store.get_entry(entry.id).current.actor, "postst")

    def test_aenderung_haelt_beide_staende(self):
        entry = self.create(Fields("outgoing", postage_cents=105, psp_element="001"))
        updated = self.store.update_entry(
            entry.id,
            Fields("outgoing", postage_cents=265, psp_element="001", shipment_date=self.tag),
            "leitung",
            expected_version=1,
            reason="Beleg",
        )
        self.assertEqual(updated.current.version, 2)
        self.assertEqual(updated.revisions[0].fields.postage_cents, 105)
        self.assertEqual(updated.current.fields.postage_cents, 265)
        self.assertEqual(updated.current.reason, "Beleg")

    def test_veraltete_fassung_wird_zurueckgewiesen(self):
        entry = self.create()
        self.store.update_entry(
            entry.id,
            Fields("incoming", sender="berichtigt", shipment_date=self.tag),
            "a",
            expected_version=1,
        )
        with self.assertRaises(VersionConflict):
            self.store.update_entry(
                entry.id,
                Fields("incoming", sender="gleichzeitig", shipment_date=self.tag),
                "b",
                expected_version=1,
            )
        self.assertEqual(self.store.get_entry(entry.id).current.fields.sender.name, "berichtigt")

    def test_storno_und_ruecknahme(self):
        entry = self.create()
        self.assertRaises(
            ValidationError, self.store.cancel_entry, entry.id, "l", expected_version=1, reason=""
        )
        cancelled = self.store.cancel_entry(entry.id, "l", expected_version=1, reason="Doppelt")
        self.assertEqual(cancelled.current.fields.status, "cancelled")
        self.assertRaises(
            ValidationError, self.store.cancel_entry, entry.id, "l", expected_version=2,
            reason="nochmal"
        )
        gleiche = cancelled.current.fields
        self.assertRaises(
            ValidationError,
            self.store.update_entry,
            entry.id,
            gleiche,
            "l",
            expected_version=2,
        )

    def test_unbekannte_kennung(self):
        self.assertRaises(NotFound, self.store.get_entry, "gibt-es-nicht")

    # -- Suche und Auswertung ---------------------------------------------

    def test_suche_verlangt_alle_woerter(self):
        gesucht = self.create(
            Fields("outgoing", recipient=Party(name="Arndt", organisation="FSU Jena"),
                   description="Rahmenvertrag")
        )
        self.create(Fields("incoming", sender="Springer Nature"))
        self.assertEqual([e.id for e in self.store.entries(query="arndt rahmenvertrag")], [gesucht.id])
        self.assertEqual([e.id for e in self.store.entries(query="rahmenvertrag fsu")], [gesucht.id])
        self.assertEqual(self.store.entries(query="arndt springer"), ())

    def test_suche_ignoriert_umlautschreibweise(self):
        entry = self.create(Fields("incoming", sender="Universität Jena"))
        self.assertEqual([e.id for e in self.store.entries(query="universitat")], [entry.id])
        self.assertEqual([e.id for e in self.store.entries(query="Universität")], [entry.id])

    def test_suche_findet_ueber_die_postbuchnummer(self):
        entry = self.create()
        self.assertEqual([e.id for e in self.store.entries(query=entry.number)], [entry.id])

    def test_zeitraumfilter(self):
        frueh = self.create(Fields("incoming", shipment_date=date(2026, 1, 5)))
        spaet = self.create(Fields("incoming", shipment_date=date(2026, 9, 17)))
        self.assertEqual([e.id for e in self.store.entries(date_from=date(2026, 6, 1))], [spaet.id])
        self.assertEqual([e.id for e in self.store.entries(date_to=date(2026, 6, 1))], [frueh.id])

    def test_portoauswertung_trennt_unbekannt_von_null(self):
        self.create(Fields("outgoing", postage_cents=185, psp_element="001"))
        self.create(Fields("outgoing", postage_cents=0, psp_element="001"))
        self.create(Fields("outgoing", postage_cents=None, psp_element="002"))
        storniert = self.create(Fields("outgoing", postage_cents=10000, psp_element="001"))
        self.store.cancel_entry(storniert.id, "l", expected_version=1, reason="Fehlbuchung")

        summary = self.store.postage_summary()
        self.assertEqual(summary["postage_cents"], 185)
        self.assertEqual(summary["without_postage"], 1)
        self.assertEqual(summary["count"], 3)
        nach_psp = {b["psp_element"]: b for b in summary["by_psp_element"]}
        self.assertEqual(nach_psp["001"]["cents"], 185)
        self.assertEqual(nach_psp["002"]["unknown"], 1)

    # -- Fotos ------------------------------------------------------------

    def test_foto_anlegen_lesen_entfernen(self):
        entry = self.create()
        photo = self.store.add_photo(
            entry.id, PNG, "postst", media_type="image/png", caption="Umschlag"
        )
        self.assertEqual(self.store.photo_bytes(photo.id), PNG)
        self.assertEqual(len(self.store.get_entry(entry.id).active_photos), 1)

        removed = self.store.remove_photo(photo.id, "leitung", reason="Falsch zugeordnet")
        self.assertFalse(removed.active)
        self.assertEqual(removed.removed_by, "leitung")
        self.assertEqual(len(self.store.get_entry(entry.id).active_photos), 0)
        self.assertEqual(
            len(self.store.get_entry(entry.id).photos), 1, "Das Entfernen bleibt nachvollziehbar"
        )

    def test_foto_prueft_format_und_groesse(self):
        entry = self.create()
        self.assertRaises(
            ValidationError, self.store.add_photo, entry.id, PNG, "x", media_type="text/html"
        )
        self.assertRaises(
            ValidationError, self.store.add_photo, entry.id, b"", "x", media_type="image/png"
        )
        self.assertRaises(
            ValidationError, self.store.add_photo, entry.id, b"0" * (13 * 1024 * 1024), "x",
            media_type="image/jpeg"
        )

    def test_foto_mit_gleicher_kennung_wird_nicht_verdoppelt(self):
        entry = self.create()
        first = self.store.add_photo(entry.id, PNG, "x", media_type="image/png", photo_id="p1")
        again = self.store.add_photo(entry.id, PNG, "x", media_type="image/png", photo_id="p1")
        self.assertEqual(first.id, again.id)
        self.assertEqual(len(self.store.get_entry(entry.id).photos), 1)

    # -- Kontakte ---------------------------------------------------------

    def test_kontakte_speichern_und_suchen(self):
        self.store.save_contact(
            Contact(id="c1", organisation="Friedrich-Schiller-Universität Jena",
                    aliases=("FSU Jena",)),
            "leitung",
        )
        self.store.save_contact(Contact(id="c2", organisation="Springer Nature"), "leitung")
        self.assertEqual([c.id for c in self.store.contacts(query="fsu")], ["c1"])
        self.assertEqual([c.id for c in self.store.contacts(query="universitat jena")], ["c1"])
        self.assertEqual(len(self.store.contacts()), 2)

    def test_zusammenfuehren_veraendert_vergangene_sendungen_nicht(self):
        """Der Adressstand einer Sendung ist ein Beleg, keine Verknüpfung."""
        self.store.save_contact(Contact(id="c1", organisation="FSU Jena", address="Alt 1"), "l")
        self.store.save_contact(
            Contact(id="c2", organisation="Friedrich-Schiller-Universität Jena", address="Neu 2"),
            "l",
        )
        entry = self.create(
            Fields("outgoing", recipient=Party(organisation="FSU Jena", address="Alt 1",
                                               contact_id="c1"))
        )
        ziel = self.store.merge_contacts("c1", "c2", "leitung")
        self.assertIn("FSU Jena", ziel.aliases)
        self.assertEqual(self.store.get_contact("c1").merged_into, "c2")
        self.assertEqual([c.id for c in self.store.contacts()], ["c2"])

        unveraendert = self.store.get_entry(entry.id)
        self.assertEqual(unveraendert.current.fields.recipient.address, "Alt 1")
        self.assertEqual(unveraendert.current.fields.recipient.contact_id, "c1")
        self.assertEqual(len(unveraendert.revisions), 1)

    # -- Nebenläufigkeit --------------------------------------------------

    def test_verwendbar_aus_mehreren_threads(self):
        self.create()
        ergebnis = []

        def arbeiten():
            try:
                self.store.create_entry(
                    Fields("outgoing", recipient="aus Thread"), "thread", local_date=self.tag
                )
                ergebnis.append(len(self.store.entries()))
            except Exception as exc:  # pragma: no cover - soll nicht eintreten
                ergebnis.append(repr(exc))

        thread = threading.Thread(target=arbeiten)
        thread.start()
        thread.join()
        self.assertEqual(ergebnis, [2])
        self.assertEqual(len(self.store.entries()), 2)

    def test_gleichzeitige_nummernvergabe_bleibt_eindeutig(self):
        fehler = []

        def anlegen():
            try:
                for _ in range(10):
                    self.store.create_entry(Fields("incoming"), "t", local_date=self.tag)
            except Exception as exc:  # pragma: no cover
                fehler.append(repr(exc))

        threads = [threading.Thread(target=anlegen) for _ in range(4)]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join()
        self.assertEqual(fehler, [])
        nummern = [e.number for e in self.store.entries(limit=1000)]
        self.assertEqual(len(nummern), 40)
        self.assertEqual(len(set(nummern)), 40, "Postbuchnummern müssen eindeutig bleiben")


if __name__ == "__main__":
    unittest.main()
