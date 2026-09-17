"""Fachtests des Postbuchkerns.

Geprüft wird, was schiefgehen kann und teuer wäre: Geldbeträge, die Trennung
von unbekannt und null, die Unveränderlichkeit früherer Fassungen und der
Schutz vor stillem Überschreiben.
"""

from dataclasses import FrozenInstanceError, replace
from datetime import date, datetime, timezone
import json
import unittest
from pathlib import Path

from postbuch.domain import (
    Contact,
    Fields,
    NotFound,
    Party,
    Register,
    ValidationError,
    VersionConflict,
    format_postage,
    normalise,
    parse_postage,
    postbuch_number,
)
from postbuch.matching import duplicate_groups, score, suggest

KORPUS = json.loads((Path(__file__).parent / "konformitaet" / "porto.json").read_text("utf-8"))


class PortoTests(unittest.TestCase):
    """Gegen denselben Korpus wie die Web-App (web/js/porto.js)."""

    def test_gueltige_betraege_aus_dem_korpus(self):
        for case in KORPUS["gueltig"]:
            with self.subTest(eingabe=case["eingabe"], warum=case["warum"]):
                self.assertEqual(parse_postage(case["eingabe"]), case["cent"])

    def test_ungueltige_betraege_aus_dem_korpus(self):
        for case in KORPUS["ungueltig"]:
            with self.subTest(eingabe=case["eingabe"], warum=case["warum"]):
                self.assertRaises(ValidationError, parse_postage, case["eingabe"])

    def test_anzeige_aus_dem_korpus(self):
        for case in KORPUS["anzeige"]:
            with self.subTest(cent=case["cent"]):
                self.assertEqual(format_postage(case["cent"]), case["text"])

    def test_unbekannt_und_null_bleiben_unterscheidbar(self):
        self.assertIsNone(parse_postage(""))
        self.assertEqual(parse_postage("0"), 0)
        self.assertNotEqual(parse_postage(""), parse_postage("0"))

    def test_keine_zahl_statt_text(self):
        for value in [1.5, 180, None, b"1,80"]:
            with self.subTest(value=value):
                self.assertRaises(ValidationError, parse_postage, value)

    def test_eingabe_umgeht_die_pruefung_nicht(self):
        for value in [-1, True, 1.5, "105"]:
            with self.subTest(value=value):
                self.assertRaises(ValidationError, Fields, "outgoing", postage_cents=value)

    def test_unplausibel_hohes_porto_wird_abgewiesen(self):
        Fields("outgoing", postage_cents=100_000_00)
        self.assertRaises(ValidationError, Fields, "outgoing", postage_cents=100_000_01)


class FeldTests(unittest.TestCase):
    def test_psp_behaelt_fuehrende_nullen_und_trennzeichen(self):
        self.assertEqual(Fields("outgoing", psp_element=" 001.A-02 ").psp_element, "001.A-02")
        self.assertIsNone(Fields("outgoing", psp_element="  ").psp_element)

    def test_psp_bleibt_einzeilig_und_ohne_steuerzeichen(self):
        self.assertRaises(ValidationError, Fields, "outgoing", psp_element="a\nb")
        self.assertRaises(ValidationError, Fields, "outgoing", psp_element="a\x00b")
        self.assertRaises(ValidationError, Fields, "outgoing", psp_element=123)

    def test_eingang_kennt_keine_kostenfelder_auch_nicht_null(self):
        for values in [dict(postage_cents=0), dict(postage_cents=105), dict(psp_element="001")]:
            with self.subTest(values=values):
                self.assertRaises(ValidationError, Fields, "incoming", **values)

    def test_richtungswechsel_verlangt_ausdrueckliches_leeren(self):
        original = Fields("outgoing", postage_cents=105, psp_element="001")
        self.assertRaises(ValidationError, replace, original, direction="incoming")
        geleert = replace(original, direction="incoming", postage_cents=None, psp_element=None)
        self.assertEqual(geleert.direction, "incoming")

    def test_ungueltige_eingaben(self):
        for values in [
            dict(direction="other"),
            dict(direction=""),
            dict(direction="incoming", shipment_date="2026-09-17"),
            dict(direction="incoming", status="geloescht"),
            dict(direction="incoming", description=42),
        ]:
            with self.subTest(values=values):
                self.assertRaises(ValidationError, Fields, **values)

    def test_unbekannte_beteiligte_sind_zulaessig(self):
        """Ungeöffnete oder unleserliche Post darf unvollständig bleiben."""
        fields = Fields("incoming")
        self.assertTrue(fields.sender.empty)
        self.assertEqual(Fields("incoming", sender=None).sender, Party())

    def test_beteiligte_nehmen_text_oder_struktur_entgegen(self):
        self.assertEqual(Fields("incoming", sender="Springer").sender.name, "Springer")
        strukturiert = Fields(
            "incoming", sender={"organisation": "Springer Nature", "address": "Tiergartenstr. 17"}
        )
        self.assertEqual(strukturiert.sender.organisation, "Springer Nature")
        self.assertRaises(ValidationError, Fields, "incoming", sender={"unbekannt": "x"})
        self.assertRaises(ValidationError, Fields, "incoming", sender=42)

    def test_text_wird_bereinigt_aber_nicht_umgeschrieben(self):
        fields = Fields("incoming", description="  Zeitschriften \r\n  lieferung  ")
        self.assertEqual(fields.description, "Zeitschriften\nlieferung")
        self.assertEqual(Fields("incoming", shipment_type="  ").shipment_type, "Sonstige")

    def test_rundreise_durch_json_veraendert_nichts(self):
        fields = Fields(
            "outgoing",
            recipient=Party(name="Dr. Arndt", organisation="FSU Jena", address="Jena"),
            postage_cents=185,
            psp_element="001.A-02",
            shipment_date=date(2026, 9, 17),
            description="Vertrag",
        )
        self.assertEqual(Fields.from_dict(fields.as_dict()), fields)

    def test_unbekannte_felder_werden_abgewiesen(self):
        self.assertRaises(ValidationError, Fields.from_dict, {"direction": "incoming", "foo": 1})


class NormierungTests(unittest.TestCase):
    def test_umlaute_und_schreibweisen(self):
        self.assertEqual(normalise("Universität Jena"), "universitat jena")
        self.assertEqual(normalise("Straße"), "strasse")
        self.assertEqual(normalise("FSU  Jena!"), "fsu jena")
        self.assertEqual(normalise(""), "")

    def test_postbuchnummer(self):
        self.assertEqual(postbuch_number("incoming", 2026, 42), "2026-E-00042")
        self.assertEqual(postbuch_number("outgoing", 2026, 1), "2026-A-00001")
        self.assertRaises(ValidationError, postbuch_number, "incoming", 2026, 0)
        self.assertRaises(ValidationError, postbuch_number, "sideways", 2026, 1)


class RegisterTests(unittest.TestCase):
    def setUp(self):
        self.now = datetime(2026, 9, 17, 23, 30, tzinfo=timezone.utc)
        self.local_date = date(2026, 9, 18)
        self.register = Register(clock=lambda: self.now)

    def create(self, fields=None):
        return self.register.create(
            fields or Fields("incoming"), "postst", local_date=self.local_date
        )

    def test_geraetedatum_ist_nicht_das_utc_datum(self):
        """Um 23:30 UTC ist in Jena bereits der Folgetag. Das Postbuch zählt vor Ort."""
        entry = self.create()
        self.assertEqual(entry.current.fields.shipment_date, self.local_date)
        self.assertEqual(entry.current.recorded_at, self.now)

    def test_ausdrueckliches_sendungsdatum_bleibt_erhalten(self):
        entry = self.create(Fields("incoming", shipment_date=date(2026, 9, 15)))
        self.assertEqual(entry.current.fields.shipment_date, date(2026, 9, 15))

    def test_nummer_laeuft_je_jahr_und_richtung(self):
        self.assertEqual(self.create().number, "2026-E-00001")
        self.assertEqual(self.create().number, "2026-E-00002")
        self.assertEqual(self.create(Fields("outgoing")).number, "2026-A-00001")
        alt = self.create(Fields("incoming", shipment_date=date(2025, 12, 30)))
        self.assertEqual(alt.number, "2025-E-00001")

    def test_gleiche_kennung_legt_keinen_zweiten_eintrag_an(self):
        """Grundlage dafür, dass ein abgebrochener Upload wiederholt werden darf."""
        first = self.register.create(
            Fields("incoming"), "postst", local_date=self.local_date, entry_id="abc"
        )
        again = self.register.create(
            Fields("outgoing"), "postst", local_date=self.local_date, entry_id="abc"
        )
        self.assertEqual(first.id, again.id)
        self.assertEqual(again.current.fields.direction, "incoming")
        self.assertEqual(len(self.register.entries()), 1)

    def test_aenderung_erhaelt_historie_und_alten_stand(self):
        entry = self.create(Fields("outgoing", postage_cents=105, psp_element="001"))
        updated = self.register.update(
            entry.id,
            replace(entry.current.fields, postage_cents=180),
            "leitung",
            expected_version=1,
            reason="Porto laut Beleg",
        )
        self.assertEqual(updated.current.version, 2)
        self.assertEqual(updated.revisions[0].fields.postage_cents, 105)
        self.assertEqual(updated.current.fields.postage_cents, 180)
        self.assertEqual(updated.current.actor, "leitung")
        self.assertEqual(updated.current.reason, "Porto laut Beleg")
        self.assertEqual(len(entry.revisions), 1, "Der frühere Eintrag darf sich nicht ändern")
        with self.assertRaises(FrozenInstanceError):
            updated.current.fields.psp_element = "veraendert"

    def test_veraltete_aenderung_ueberschreibt_nicht(self):
        entry = self.create()
        fields = replace(entry.current.fields, description="Bestätigte Änderung")
        self.register.update(entry.id, fields, "leitung", expected_version=1)
        with self.assertRaises(VersionConflict):
            self.register.update(entry.id, entry.current.fields, "andere", expected_version=1)
        self.assertEqual(
            self.register.entries()[0].current.fields.description, "Bestätigte Änderung"
        )

    def test_unbekannte_kennung_meldet_sich_deutlich(self):
        self.assertRaises(NotFound, self.register.get, "gibt-es-nicht")
        self.assertRaises(
            NotFound, self.register.update, "gibt-es-nicht", Fields("incoming",
            shipment_date=self.local_date), "x", expected_version=1
        )

    def test_storno_loescht_nicht_und_verlangt_begruendung(self):
        entry = self.create()
        self.assertRaises(
            ValidationError, self.register.cancel, entry.id, "leitung", expected_version=1, reason=" "
        )
        cancelled = self.register.cancel(
            entry.id, "leitung", expected_version=1, reason="Doppelt erfasst"
        )
        self.assertTrue(cancelled.current.fields.cancelled)
        self.assertEqual(cancelled.current.reason, "Doppelt erfasst")
        self.assertEqual(len(cancelled.revisions), 2)
        self.assertEqual(cancelled.revisions[0].fields.status, "active")

    def test_stornierte_sendung_bleibt_unveraendert(self):
        entry = self.create()
        self.register.cancel(entry.id, "leitung", expected_version=1, reason="Doppelt")
        gleiche = replace(self.register.get(entry.id).current.fields, description="neu")
        self.assertRaises(
            ValidationError, self.register.update, entry.id, gleiche, "x", expected_version=2
        )
        zurueck = replace(gleiche, status="active")
        wieder = self.register.update(
            entry.id, zurueck, "leitung", expected_version=2, reason="Storno war falsch"
        )
        self.assertEqual(wieder.current.fields.status, "active")

    def test_volltextsuche_findet_ueber_wortgrenzen(self):
        gesucht = self.create(
            Fields("outgoing", recipient=Party(name="Arndt", organisation="FSU Jena"),
                   description="Rahmenvertrag", psp_element="001")
        )
        self.create(Fields("incoming", sender="Springer Nature"))
        self.assertEqual(self.register.entries(query="arndt rahmenvertrag"), (gesucht,))
        self.assertEqual(self.register.entries(query="rahmenvertrag arndt"), (gesucht,))
        self.assertEqual(self.register.entries(query="UNIVERSITAT"), ())
        self.assertEqual(self.register.entries(query="fsu"), (gesucht,))

    def test_kombinierte_filter_und_reihenfolge(self):
        self.create(Fields("incoming", sender="Universität"))
        gesucht = self.create(
            Fields("outgoing", recipient="Universität", psp_element="001",
                   shipment_date=date(2026, 9, 19))
        )
        self.create(Fields("outgoing", recipient="Universität", psp_element="002"))
        self.assertEqual(
            self.register.entries(direction="outgoing", psp_element="001", query="UNIVERSITÄT"),
            (gesucht,),
        )
        self.assertEqual(self.register.entries()[0], gesucht)
        self.assertEqual(
            self.register.entries(date_from=date(2026, 9, 19), date_to=date(2026, 9, 19)),
            (gesucht,),
        )

    def test_portosumme_zaehlt_unbekannt_nicht_als_null(self):
        self.create(Fields("outgoing", postage_cents=185))
        self.create(Fields("outgoing", postage_cents=None))
        self.create(Fields("outgoing", postage_cents=0))
        self.create(Fields("incoming"))
        total, unknown = self.register.postage_total()
        self.assertEqual(total, 185)
        self.assertEqual(unknown, 1)

    def test_fehlende_person_oder_zeitzone_wird_abgewiesen(self):
        self.assertRaises(
            ValidationError, self.register.create, Fields("incoming"), " ",
            local_date=self.local_date
        )
        ohne_zone = Register(clock=lambda: datetime(2026, 9, 17))
        self.assertRaises(
            ValidationError, ohne_zone.create, Fields("incoming"), "person",
            local_date=self.local_date
        )


class KontaktTests(unittest.TestCase):
    def setUp(self):
        self.fsu = Contact(
            id="c1",
            organisation="Friedrich-Schiller-Universität Jena",
            aliases=("FSU Jena", "Uni Jena"),
        )
        self.springer = Contact(id="c2", organisation="Springer Nature", name="Kundenservice")

    def test_kontakt_braucht_name_oder_organisation(self):
        self.assertRaises(ValidationError, Contact, id="x")
        self.assertEqual(Contact(id="x", name="Anna Beispiel").label, "Anna Beispiel")

    def test_aliase_werden_entdoppelt_und_bereinigt(self):
        contact = Contact(id="x", organisation="A", aliases=(" B ", "B", "", "C"))
        self.assertEqual(contact.aliases, ("B", "C"))

    def test_alias_findet_den_kontakt(self):
        self.assertEqual(score("FSU Jena", self.fsu), 1.0)
        self.assertGreater(score("Friedrich Schiller Universitaet Jena", self.fsu), 0.6)
        self.assertLess(score("Springer", self.fsu), 0.45)

    def test_vorschlaege_sind_nach_guete_sortiert(self):
        found = suggest("FSU Jena", [self.springer, self.fsu])
        self.assertEqual(found[0][1].id, "c1")
        self.assertEqual(suggest("völlig anderes", [self.fsu, self.springer]), [])

    def test_dubletten_werden_vorgeschlagen_nicht_zusammengefuehrt(self):
        doppelt = Contact(id="c3", organisation="Springer Nature", name="Kundenservice")
        groups = duplicate_groups([self.fsu, self.springer, doppelt])
        self.assertEqual(len(groups), 1)
        self.assertEqual({c.id for c in groups[0]}, {"c2", "c3"})

    def test_kontakt_wird_zu_beteiligten_mit_verweis(self):
        party = self.fsu.to_party()
        self.assertEqual(party.contact_id, "c1")
        self.assertEqual(party.organisation, "Friedrich-Schiller-Universität Jena")


if __name__ == "__main__":
    unittest.main()
