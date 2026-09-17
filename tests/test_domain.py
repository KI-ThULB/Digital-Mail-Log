from dataclasses import FrozenInstanceError, replace
from datetime import date, datetime, timezone
import unittest

from postbuch.domain import Fields, Register, ValidationError, VersionConflict, parse_postage


class PostageTests(unittest.TestCase):
    def test_exact_cents_and_unknown(self):
        for text, expected in [("", None), ("  ", None), ("0,00", 0), ("1,05", 105),
                               ("2.7", 270), ("100", 10000), (" 0,01 ", 1)]:
            with self.subTest(text=text):
                self.assertEqual(parse_postage(text), expected)

    def test_reject_ambiguous_negative_and_nonfinite_amounts(self):
        for text in ["-1", "1,234", "1.000,00", "NaN", "inf", "1e3", "€2", "1,", 1.5]:
            with self.subTest(text=text):
                self.assertRaises(ValidationError, parse_postage, text)

    def test_input_cannot_bypass_money_validation(self):
        for value in [-1, True, 1.5, "105"]:
            with self.subTest(value=value):
                self.assertRaises(ValidationError, Fields, "outgoing", postage_cents=value)


class FieldsTests(unittest.TestCase):
    def test_psp_keeps_leading_zeroes_and_separators(self):
        self.assertEqual(Fields("outgoing", psp_element=" 001.A-02 ").psp_element, "001.A-02")
        self.assertIsNone(Fields("outgoing", psp_element=" ").psp_element)

    def test_incoming_rejects_cost_fields_even_zero(self):
        for values in [dict(postage_cents=0), dict(postage_cents=105), dict(psp_element="001")]:
            with self.subTest(values=values):
                self.assertRaises(ValidationError, Fields, "incoming", **values)

    def test_direction_change_requires_explicit_clearing(self):
        original = Fields("outgoing", postage_cents=105, psp_element="001")
        self.assertRaises(ValidationError, replace, original, direction="incoming")
        cleared = replace(original, direction="incoming", postage_cents=None, psp_element=None)
        self.assertEqual(cleared.direction, "incoming")

    def test_invalid_inputs(self):
        for values in [dict(direction="other"), dict(direction="incoming", sender=None),
                       dict(direction="outgoing", psp_element=123),
                       dict(direction="outgoing", psp_element="a\nb"),
                       dict(direction="incoming", shipment_date="2026-09-17")]:
            with self.subTest(values=values):
                self.assertRaises(ValidationError, Fields, **values)


class RegisterTests(unittest.TestCase):
    def setUp(self):
        self.now = datetime(2026, 9, 17, 23, 30, tzinfo=timezone.utc)
        self.local_date = date(2026, 9, 18)
        self.register = Register(clock=lambda: self.now)

    def create(self, fields=None):
        return self.register.create(fields or Fields("incoming"), "test-user", local_date=self.local_date)

    def test_local_date_is_not_utc_date(self):
        entry = self.create()
        self.assertEqual(entry.current.fields.shipment_date, self.local_date)
        self.assertEqual(entry.current.recorded_at, self.now)

    def test_explicit_shipment_date_survives(self):
        entry = self.create(Fields("incoming", shipment_date=date(2026, 9, 15)))
        self.assertEqual(entry.current.fields.shipment_date, date(2026, 9, 15))

    def test_changes_preserve_history_and_old_snapshot(self):
        entry = self.create(Fields("outgoing", postage_cents=105, psp_element="001"))
        updated = self.register.update(entry.id, replace(entry.current.fields, postage_cents=180),
                                       "editor", expected_version=1)
        self.assertEqual(updated.current.version, 2)
        self.assertEqual(updated.revisions[0].fields.postage_cents, 105)
        self.assertEqual(updated.current.fields.postage_cents, 180)
        self.assertEqual(updated.current.actor, "editor")
        self.assertEqual(len(entry.revisions), 1)
        with self.assertRaises(FrozenInstanceError):
            updated.current.fields.psp_element = "mutated"

    def test_stale_update_does_not_overwrite(self):
        entry = self.create()
        fields = replace(entry.current.fields, description="Bestätigte Änderung")
        self.register.update(entry.id, fields, "editor", expected_version=1)
        with self.assertRaises(VersionConflict):
            self.register.update(entry.id, entry.current.fields, "other", expected_version=1)
        self.assertEqual(self.register.entries()[0].current.fields.description, "Bestätigte Änderung")

    def test_combined_filters_and_order(self):
        self.create(Fields("incoming", sender="Universität"))
        desired = self.create(Fields("outgoing", recipient="Universität", psp_element="001",
                                     shipment_date=date(2026, 9, 19)))
        self.create(Fields("outgoing", recipient="Universität", psp_element="002"))
        self.assertEqual(self.register.entries(direction="outgoing", psp_element="001", query="UNIVERSITÄT"),
                         (desired,))
        self.assertEqual(self.register.entries()[0], desired)

    def test_missing_actor_or_naive_clock_is_rejected(self):
        self.assertRaises(ValidationError, self.register.create, Fields("incoming"), " ",
                          local_date=self.local_date)
        naive = Register(clock=lambda: datetime(2026, 9, 17))
        self.assertRaises(ValidationError, naive.create, Fields("incoming"), "user",
                          local_date=self.local_date)


if __name__ == "__main__":
    unittest.main()
