"""Validated, immutable mail entries. This module does not persist data."""

from dataclasses import dataclass, replace
from datetime import date, datetime, timezone
import re
from uuid import uuid4


class ValidationError(ValueError):
    pass


class VersionConflict(ValueError):
    pass


def parse_postage(value: str) -> int | None:
    """Accept ungrouped EUR amounts, including German decimal commas."""
    if not isinstance(value, str):
        raise ValidationError("Porto muss als Text eingegeben werden.")
    value = value.strip()
    if not value:
        return None
    if not re.fullmatch(r"[0-9]+(?:[,.][0-9]{1,2})?", value) or len(value) > 12:
        raise ValidationError("Porto: positiver EUR-Betrag mit maximal zwei Nachkommastellen.")
    parts = re.split(r"[,.]", value)
    return int(parts[0]) * 100 + int(parts[1].ljust(2, "0") if len(parts) > 1 else "0")


@dataclass(frozen=True)
class Fields:
    direction: str
    sender: str = ""
    recipient: str = ""
    description: str = ""
    shipment_type: str = "Sonstige"
    shipment_date: date | None = None
    postage_cents: int | None = None
    psp_element: str | None = None

    def __post_init__(self):
        if self.direction not in ("incoming", "outgoing"):
            raise ValidationError("Richtung muss Eingang oder Ausgang sein.")
        for name in ("sender", "recipient", "description", "shipment_type"):
            value = getattr(self, name)
            if not isinstance(value, str) or len(value) > 4000:
                raise ValidationError(f"Ungültiges Textfeld: {name}")
        if self.shipment_date is not None and type(self.shipment_date) is not date:
            raise ValidationError("Ungültiges Sendungsdatum.")
        if self.postage_cents is not None and (
            type(self.postage_cents) is not int or self.postage_cents < 0
        ):
            raise ValidationError("Porto muss eine nichtnegative ganze Centzahl sein.")
        if self.psp_element is not None:
            if not isinstance(self.psp_element, str) or len(self.psp_element) > 128:
                raise ValidationError("PSP-Element muss ein Text mit maximal 128 Zeichen sein.")
            if any(ord(c) < 32 or ord(c) == 127 for c in self.psp_element):
                raise ValidationError("PSP-Element enthält Steuerzeichen.")
            object.__setattr__(self, "psp_element", self.psp_element.strip() or None)
        if self.direction == "incoming" and (
            self.postage_cents is not None or self.psp_element is not None
        ):
            raise ValidationError("Porto und PSP-Element sind nur für ausgehende Post zulässig.")


@dataclass(frozen=True)
class Revision:
    version: int
    fields: Fields
    actor: str
    recorded_at: datetime


@dataclass(frozen=True)
class Entry:
    id: str
    revisions: tuple[Revision, ...]

    @property
    def current(self):
        return self.revisions[-1]


class Register:
    """In-memory reference only; authentication belongs at the service boundary."""

    def __init__(self, clock=None):
        self._entries: dict[str, Entry] = {}
        self._clock = clock or (lambda: datetime.now(timezone.utc))

    def _context(self, actor):
        if not isinstance(actor, str) or not actor.strip():
            raise ValidationError("Bearbeitende Person fehlt.")
        now = self._clock()
        if now.tzinfo is None or now.utcoffset() is None:
            raise ValidationError("Zeitstempel benötigt eine Zeitzone.")
        return actor.strip(), now

    def create(self, fields: Fields, actor: str, *, local_date: date) -> Entry:
        actor, now = self._context(actor)
        if not isinstance(fields, Fields) or type(local_date) is not date:
            raise ValidationError("Ungültige Erfassungsdaten.")
        if fields.shipment_date is None:
            fields = replace(fields, shipment_date=local_date)
        entry = Entry(str(uuid4()), (Revision(1, fields, actor, now),))
        self._entries[entry.id] = entry
        return entry

    def update(self, entry_id: str, fields: Fields, actor: str, *, expected_version: int) -> Entry:
        actor, now = self._context(actor)
        if not isinstance(fields, Fields) or fields.shipment_date is None:
            raise ValidationError("Sendungsdatum fehlt.")
        entry = self._entries[entry_id]
        if type(expected_version) is not int or entry.current.version != expected_version:
            raise VersionConflict("Eintrag wurde zwischenzeitlich geändert. Neu laden.")
        updated = replace(entry, revisions=entry.revisions + (
            Revision(expected_version + 1, fields, actor, now),
        ))
        self._entries[entry_id] = updated
        return updated

    def entries(self, *, direction=None, psp_element=None, query="") -> tuple[Entry, ...]:
        result = []
        for entry in self._entries.values():
            fields = entry.current.fields
            if direction is not None and fields.direction != direction:
                continue
            if psp_element is not None and fields.psp_element != psp_element:
                continue
            haystack = " ".join((fields.sender, fields.recipient, fields.description,
                                 fields.shipment_type, fields.psp_element or ""))
            if query.casefold() not in haystack.casefold():
                continue
            result.append(entry)
        return tuple(sorted(result, key=lambda e: (e.current.fields.shipment_date,
                                                   e.revisions[0].recorded_at, e.id), reverse=True))
