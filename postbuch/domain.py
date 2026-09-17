"""Fachliche Regeln des Postbuchs.

Dieses Modul ist die verbindliche Referenz für alle Gültigkeitsregeln. Es hält
keine Daten dauerhaft und kennt weder Datenbank noch Netzwerk; die Speicherung
liegt in ``postbuch.storage``, die Schnittstelle in ``postbuch.api``.

Grundsätze:

* Beträge sind ganzzahlige Cent. Fließkommazahlen kommen nicht vor.
* ``None`` bedeutet unbekannt und ist von ``0`` unterscheidbar.
* Einträge sind unveränderlich. Eine Korrektur erzeugt eine neue Revision;
  frühere Stände bleiben erhalten.
* Der Adressstand einer Sendung wird mitgespeichert. Eine spätere Änderung des
  Kontakts verändert vergangene Postbucheinträge nicht.
"""

from __future__ import annotations

from dataclasses import dataclass, field, replace
from datetime import date, datetime, timezone
import re
import unicodedata
from uuid import uuid4

__all__ = [
    "ValidationError",
    "VersionConflict",
    "NotFound",
    "DIRECTIONS",
    "SHIPMENT_TYPES",
    "Party",
    "Fields",
    "Revision",
    "Entry",
    "Contact",
    "Photo",
    "Register",
    "parse_postage",
    "format_postage",
    "normalise",
    "new_id",
]


class ValidationError(ValueError):
    """Die Eingabe verletzt eine fachliche Regel."""


class VersionConflict(ValueError):
    """Der Eintrag wurde zwischenzeitlich von anderer Stelle geändert."""


class NotFound(LookupError):
    """Der angeforderte Eintrag existiert nicht."""


DIRECTIONS = ("incoming", "outgoing")

#: Vorschlagsliste für die Oberfläche. Bewusst keine abschließende Aufzählung:
#: Poststellen brauchen eigene Begriffe (Päckchen, Kurier, Wertsendung).
SHIPMENT_TYPES = (
    "Brief",
    "Päckchen",
    "Paket",
    "Einschreiben",
    "Einschreiben Rückschein",
    "Kurier",
    "Wertsendung",
    "Sonstige",
)

STATUSES = ("active", "cancelled")

_MAX_TEXT = 4000
_MAX_SHORT = 256
_CONTROL = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")
_POSTAGE = re.compile(r"[0-9]{1,9}(?:[,.][0-9]{1,2})?")
_WHITESPACE = re.compile(r"\s+")


def new_id() -> str:
    """Technische Kennung. Wird auf dem Erfassungsgerät vergeben, auch offline."""
    return str(uuid4())


def parse_postage(value: str) -> int | None:
    """Wandelt eine Eingabe in ganzzahlige Cent.

    Leer bedeutet unbekannt und ergibt ``None``. ``"0"`` bedeutet ausdrücklich
    portofrei und ergibt ``0``. Tausendertrennzeichen werden abgelehnt, weil
    ``"1.000"`` sonst je nach Lesart 1000 EUR oder 1 EUR bedeuten könnte.
    """
    if not isinstance(value, str):
        raise ValidationError("Porto muss als Text eingegeben werden.")
    text = value.strip().removesuffix("€").strip()
    if not text:
        return None
    if not _POSTAGE.fullmatch(text):
        raise ValidationError(
            "Porto als EUR-Betrag ohne Tausendertrennzeichen, höchstens zwei "
            "Nachkommastellen, zum Beispiel 1,80."
        )
    parts = re.split(r"[,.]", text)
    whole = parts[0]
    fraction = parts[1] if len(parts) > 1 else ""
    return int(whole) * 100 + int(fraction.ljust(2, "0") or "0")


def format_postage(cents: int | None) -> str:
    """Anzeigeformat. Unbekannt bleibt als solches sichtbar."""
    if cents is None:
        return ""
    return f"{cents // 100},{cents % 100:02d}"


def normalise(text: str) -> str:
    """Vergleichsform für Suche und Dublettenerkennung.

    Diakritika und Umlaute werden aufgelöst, damit "Universitat" auch
    "Universität" findet und OCR-Fehler bei Umlauten nicht zu Dubletten führen.
    """
    text = unicodedata.normalize("NFKD", (text or "").casefold())
    text = text.replace("ß", "ss")
    text = "".join(c for c in text if not unicodedata.combining(c))
    return _WHITESPACE.sub(" ", re.sub(r"[^a-z0-9]+", " ", text)).strip()


def _clean(value: object, name: str, *, limit: int = _MAX_TEXT) -> str:
    if value is None:
        return ""
    if not isinstance(value, str):
        raise ValidationError(f"Ungültiges Textfeld: {name}")
    text = value.replace("\r\n", "\n").replace("\r", "\n")
    if _CONTROL.search(text):
        raise ValidationError(f"Feld {name} enthält Steuerzeichen.")
    text = "\n".join(line.strip() for line in text.split("\n")).strip()
    if len(text) > limit:
        raise ValidationError(f"Feld {name} ist zu lang (höchstens {limit} Zeichen).")
    return text


@dataclass(frozen=True)
class Party:
    """Beteiligte einer Sendung, wie zum Zeitpunkt der Erfassung erfasst.

    ``contact_id`` verweist auf das Kontaktverzeichnis, ``address`` hält den
    damals verwendeten Anschriftentext fest. Beide sind optional: ungeöffnete
    oder unleserliche Post darf unvollständig bleiben.
    """

    name: str = ""
    organisation: str = ""
    address: str = ""
    contact_id: str | None = None

    def __post_init__(self) -> None:
        object.__setattr__(self, "name", _clean(self.name, "Name", limit=_MAX_SHORT))
        object.__setattr__(
            self, "organisation", _clean(self.organisation, "Organisation", limit=_MAX_SHORT)
        )
        object.__setattr__(self, "address", _clean(self.address, "Anschrift"))
        if self.contact_id is not None:
            cleaned = _clean(self.contact_id, "Kontaktkennung", limit=_MAX_SHORT)
            object.__setattr__(self, "contact_id", cleaned or None)

    @classmethod
    def of(cls, value: "Party | str | dict | None") -> "Party":
        if value is None:
            return cls()
        if isinstance(value, Party):
            return value
        if isinstance(value, str):
            return cls(name=value)
        if isinstance(value, dict):
            unknown = set(value) - {"name", "organisation", "address", "contact_id"}
            if unknown:
                raise ValidationError(f"Unbekannte Felder bei Beteiligten: {sorted(unknown)}")
            return cls(**value)
        raise ValidationError("Beteiligte müssen Text oder strukturierte Angaben sein.")

    @property
    def empty(self) -> bool:
        return not (self.name or self.organisation or self.address)

    @property
    def label(self) -> str:
        parts = [p for p in (self.organisation, self.name) if p]
        return " · ".join(parts)

    def searchable(self) -> str:
        return " ".join((self.name, self.organisation, self.address))

    def as_dict(self) -> dict:
        return {
            "name": self.name,
            "organisation": self.organisation,
            "address": self.address,
            "contact_id": self.contact_id,
        }


@dataclass(frozen=True)
class Fields:
    """Der fachliche Inhalt einer Sendung in einer bestimmten Fassung."""

    direction: str
    sender: Party = field(default_factory=Party)
    recipient: Party = field(default_factory=Party)
    description: str = ""
    shipment_type: str = "Sonstige"
    shipment_date: date | None = None
    postage_cents: int | None = None
    psp_element: str | None = None
    status: str = "active"
    note: str = ""

    def __post_init__(self) -> None:
        if self.direction not in DIRECTIONS:
            raise ValidationError("Richtung muss Eingang oder Ausgang sein.")
        if self.status not in STATUSES:
            raise ValidationError("Unbekannter Status.")

        object.__setattr__(self, "sender", Party.of(self.sender))
        object.__setattr__(self, "recipient", Party.of(self.recipient))
        object.__setattr__(self, "description", _clean(self.description, "Beschreibung"))
        object.__setattr__(self, "note", _clean(self.note, "Vermerk"))

        shipment_type = _clean(self.shipment_type, "Sendungsart", limit=_MAX_SHORT)
        object.__setattr__(self, "shipment_type", shipment_type or "Sonstige")

        if self.shipment_date is not None and type(self.shipment_date) is not date:
            raise ValidationError("Ungültiges Sendungsdatum.")

        if self.postage_cents is not None and (
            type(self.postage_cents) is not int or self.postage_cents < 0
        ):
            raise ValidationError("Porto muss eine nichtnegative ganze Centzahl sein.")
        if self.postage_cents is not None and self.postage_cents > 100_000_00:
            raise ValidationError("Porto ist unplausibel hoch. Bitte prüfen.")

        if self.psp_element is not None:
            psp = _clean(self.psp_element, "PSP-Element", limit=128)
            if "\n" in psp:
                raise ValidationError("PSP-Element darf nur eine Zeile umfassen.")
            object.__setattr__(self, "psp_element", psp or None)

        if self.direction == "incoming" and (
            self.postage_cents is not None or self.psp_element is not None
        ):
            raise ValidationError(
                "Porto und PSP-Element sind nur für ausgehende Post zulässig. "
                "Beim Wechsel auf Eingang müssen die Kostenfelder ausdrücklich geleert werden."
            )

    @property
    def cancelled(self) -> bool:
        return self.status == "cancelled"

    def searchable(self) -> str:
        return " ".join(
            (
                self.sender.searchable(),
                self.recipient.searchable(),
                self.description,
                self.note,
                self.shipment_type,
                self.psp_element or "",
            )
        )

    def as_dict(self) -> dict:
        return {
            "direction": self.direction,
            "sender": self.sender.as_dict(),
            "recipient": self.recipient.as_dict(),
            "description": self.description,
            "shipment_type": self.shipment_type,
            "shipment_date": self.shipment_date.isoformat() if self.shipment_date else None,
            "postage_cents": self.postage_cents,
            "psp_element": self.psp_element,
            "status": self.status,
            "note": self.note,
        }

    @classmethod
    def from_dict(cls, data: dict) -> "Fields":
        if not isinstance(data, dict):
            raise ValidationError("Sendungsdaten müssen ein Objekt sein.")
        known = {
            "direction",
            "sender",
            "recipient",
            "description",
            "shipment_type",
            "shipment_date",
            "postage_cents",
            "psp_element",
            "status",
            "note",
        }
        unknown = set(data) - known
        if unknown:
            raise ValidationError(f"Unbekannte Felder: {sorted(unknown)}")
        raw_date = data.get("shipment_date")
        return cls(
            direction=data.get("direction", ""),
            sender=Party.of(data.get("sender")),
            recipient=Party.of(data.get("recipient")),
            description=data.get("description", ""),
            shipment_type=data.get("shipment_type", "Sonstige"),
            shipment_date=parse_iso_date(raw_date),
            postage_cents=data.get("postage_cents"),
            psp_element=data.get("psp_element"),
            status=data.get("status", "active"),
            note=data.get("note", ""),
        )


def parse_iso_date(value: object) -> date | None:
    """Nimmt ``None``, ein ``date`` oder ``JJJJ-MM-TT`` entgegen."""
    if value is None or isinstance(value, date) and not isinstance(value, datetime):
        return value
    if isinstance(value, str):
        text = value.strip()
        if not text:
            return None
        try:
            return date.fromisoformat(text)
        except ValueError as exc:
            raise ValidationError("Datum im Format JJJJ-MM-TT erwartet.") from exc
    raise ValidationError("Ungültiges Datum.")


@dataclass(frozen=True)
class Revision:
    """Ein unveränderlicher Stand eines Eintrags."""

    version: int
    fields: Fields
    actor: str
    recorded_at: datetime
    reason: str = ""

    def as_dict(self) -> dict:
        return {
            "version": self.version,
            "fields": self.fields.as_dict(),
            "actor": self.actor,
            "recorded_at": self.recorded_at.isoformat(),
            "reason": self.reason,
        }


@dataclass(frozen=True)
class Photo:
    """Belegfoto. Entfernen ist ein protokollierter Vorgang, kein Löschen."""

    id: str
    entry_id: str
    filename: str
    media_type: str
    byte_size: int
    added_by: str
    added_at: datetime
    caption: str = ""
    removed_by: str | None = None
    removed_at: datetime | None = None

    @property
    def active(self) -> bool:
        return self.removed_at is None

    def as_dict(self) -> dict:
        return {
            "id": self.id,
            "entry_id": self.entry_id,
            "filename": self.filename,
            "media_type": self.media_type,
            "byte_size": self.byte_size,
            "caption": self.caption,
            "added_by": self.added_by,
            "added_at": self.added_at.isoformat(),
            "removed_by": self.removed_by,
            "removed_at": self.removed_at.isoformat() if self.removed_at else None,
        }


@dataclass(frozen=True)
class Entry:
    """Eine Sendung mit ihrer vollständigen Änderungsgeschichte."""

    id: str
    revisions: tuple[Revision, ...]
    number: str | None = None
    photos: tuple[Photo, ...] = ()

    @property
    def current(self) -> Revision:
        return self.revisions[-1]

    @property
    def created_at(self) -> datetime:
        return self.revisions[0].recorded_at

    @property
    def active_photos(self) -> tuple[Photo, ...]:
        return tuple(p for p in self.photos if p.active)

    def as_dict(self, *, with_history: bool = False) -> dict:
        data = {
            "id": self.id,
            "number": self.number,
            "version": self.current.version,
            "created_at": self.created_at.isoformat(),
            "updated_at": self.current.recorded_at.isoformat(),
            "actor": self.current.actor,
            "photos": [p.as_dict() for p in self.active_photos],
            **self.current.fields.as_dict(),
        }
        if with_history:
            data["history"] = [r.as_dict() for r in self.revisions]
            data["all_photos"] = [p.as_dict() for p in self.photos]
        return data


@dataclass(frozen=True)
class Contact:
    """Kontakt im gemeinsamen Verzeichnis.

    Das Verzeichnis normiert Schreibweisen für künftige Erfassungen. Es
    verändert keine bereits gespeicherten Sendungen.
    """

    id: str
    name: str = ""
    organisation: str = ""
    address: str = ""
    aliases: tuple[str, ...] = ()
    internal: bool = False
    psp_element: str | None = None
    merged_into: str | None = None

    def __post_init__(self) -> None:
        object.__setattr__(self, "name", _clean(self.name, "Name", limit=_MAX_SHORT))
        object.__setattr__(
            self, "organisation", _clean(self.organisation, "Organisation", limit=_MAX_SHORT)
        )
        object.__setattr__(self, "address", _clean(self.address, "Anschrift"))
        aliases = tuple(
            dict.fromkeys(
                a for a in (_clean(x, "Alias", limit=_MAX_SHORT) for x in self.aliases) if a
            )
        )
        object.__setattr__(self, "aliases", aliases)
        if not (self.name or self.organisation):
            raise ValidationError("Ein Kontakt braucht mindestens Name oder Organisation.")
        if self.psp_element is not None:
            psp = _clean(self.psp_element, "PSP-Element", limit=128)
            object.__setattr__(self, "psp_element", psp or None)

    @property
    def label(self) -> str:
        return " · ".join(p for p in (self.organisation, self.name) if p)

    def keys(self) -> tuple[str, ...]:
        """Normierte Vergleichsformen für Suche und Dublettenerkennung."""
        raw = [self.name, self.organisation, f"{self.organisation} {self.name}", *self.aliases]
        return tuple(dict.fromkeys(k for k in (normalise(r) for r in raw) if k))

    def to_party(self) -> Party:
        return Party(
            name=self.name,
            organisation=self.organisation,
            address=self.address,
            contact_id=self.id,
        )

    def as_dict(self) -> dict:
        return {
            "id": self.id,
            "name": self.name,
            "organisation": self.organisation,
            "address": self.address,
            "aliases": list(self.aliases),
            "internal": self.internal,
            "psp_element": self.psp_element,
            "merged_into": self.merged_into,
            "label": self.label,
        }


def postbuch_number(direction: str, year: int, sequence: int) -> str:
    """Lesbare Postbuchnummer, zum Beispiel ``2026-E-00042``.

    Die Nummer wird zentral vergeben. Offline erfasste Sendungen tragen bis zur
    Übertragung nur ihre technische Kennung.
    """
    if direction not in DIRECTIONS:
        raise ValidationError("Richtung muss Eingang oder Ausgang sein.")
    if sequence < 1:
        raise ValidationError("Laufende Nummer beginnt bei 1.")
    return f"{year:04d}-{'E' if direction == 'incoming' else 'A'}-{sequence:05d}"


def matches(entry: Entry, *, query: str = "", **criteria) -> bool:
    """Prüft einen Eintrag gegen kombinierbare Filter.

    Die Volltextsuche verlangt alle Suchwörter, nicht die zusammenhängende
    Zeichenkette: „Springer Brief“ findet auch „Brief von Springer“.
    """
    fields = entry.current.fields
    direction = criteria.get("direction")
    if direction is not None and fields.direction != direction:
        return False
    shipment_type = criteria.get("shipment_type")
    if shipment_type is not None and fields.shipment_type != shipment_type:
        return False
    status = criteria.get("status")
    if status is not None and fields.status != status:
        return False
    psp_element = criteria.get("psp_element")
    if psp_element is not None and fields.psp_element != psp_element:
        return False
    contact_id = criteria.get("contact_id")
    if contact_id is not None and contact_id not in (
        fields.sender.contact_id,
        fields.recipient.contact_id,
    ):
        return False
    date_from = criteria.get("date_from")
    if date_from is not None and (
        fields.shipment_date is None or fields.shipment_date < date_from
    ):
        return False
    date_to = criteria.get("date_to")
    if date_to is not None and (fields.shipment_date is None or fields.shipment_date > date_to):
        return False
    if query:
        haystack = normalise(f"{fields.searchable()} {entry.number or ''}")
        if not all(word in haystack for word in normalise(query).split()):
            return False
    return True


class Register:
    """Referenz im Arbeitsspeicher.

    Bildet die Regeln vollständig ab und dient als Vergleichsmaßstab für die
    Datenbankfassung in ``postbuch.storage``. Nicht für den Betrieb geeignet:
    der Inhalt geht mit dem Prozess verloren.
    """

    def __init__(self, clock=None):
        self._entries: dict[str, Entry] = {}
        self._sequence: dict[tuple[str, int], int] = {}
        self._clock = clock or (lambda: datetime.now(timezone.utc))

    def _context(self, actor: object) -> tuple[str, datetime]:
        if not isinstance(actor, str) or not actor.strip():
            raise ValidationError("Bearbeitende Person fehlt.")
        now = self._clock()
        if now.tzinfo is None or now.utcoffset() is None:
            raise ValidationError("Zeitstempel benötigt eine Zeitzone.")
        return actor.strip(), now

    def _next_number(self, direction: str, when: date) -> str:
        key = (direction, when.year)
        self._sequence[key] = self._sequence.get(key, 0) + 1
        return postbuch_number(direction, when.year, self._sequence[key])

    def create(
        self,
        fields: Fields,
        actor: str,
        *,
        local_date: date,
        entry_id: str | None = None,
    ) -> Entry:
        """Legt eine Sendung an.

        ``entry_id`` erlaubt es dem Erfassungsgerät, die Kennung offline zu
        vergeben. Eine wiederholte Übertragung derselben Kennung legt keinen
        zweiten Eintrag an, sondern liefert den vorhandenen zurück.
        """
        actor, now = self._context(actor)
        if not isinstance(fields, Fields) or type(local_date) is not date:
            raise ValidationError("Ungültige Erfassungsdaten.")
        if entry_id is not None and entry_id in self._entries:
            return self._entries[entry_id]
        if fields.shipment_date is None:
            fields = replace(fields, shipment_date=local_date)
        entry = Entry(
            id=entry_id or new_id(),
            revisions=(Revision(1, fields, actor, now),),
            number=self._next_number(fields.direction, fields.shipment_date),
        )
        self._entries[entry.id] = entry
        return entry

    def get(self, entry_id: str) -> Entry:
        try:
            return self._entries[entry_id]
        except KeyError as exc:
            raise NotFound(f"Eintrag {entry_id} existiert nicht.") from exc

    def update(
        self,
        entry_id: str,
        fields: Fields,
        actor: str,
        *,
        expected_version: int,
        reason: str = "",
    ) -> Entry:
        actor, now = self._context(actor)
        if not isinstance(fields, Fields) or fields.shipment_date is None:
            raise ValidationError("Sendungsdatum fehlt.")
        entry = self.get(entry_id)
        if type(expected_version) is not int or entry.current.version != expected_version:
            raise VersionConflict("Eintrag wurde zwischenzeitlich geändert. Bitte neu laden.")
        reason = _clean(reason, "Grund")
        if entry.current.fields.status == "cancelled":
            # Stornierte Sendungen bleiben unverändert stehen. Zulässig ist nur
            # die ausdrücklich begründete Rücknahme der Stornierung.
            if fields.status != "active":
                raise ValidationError("Stornierte Sendungen können nicht bearbeitet werden.")
            if not reason:
                raise ValidationError("Die Rücknahme einer Stornierung braucht eine Begründung.")
        updated = replace(
            entry,
            revisions=entry.revisions
            + (Revision(expected_version + 1, fields, actor, now, reason),),
        )
        self._entries[entry_id] = updated
        return updated

    def cancel(self, entry_id: str, actor: str, *, expected_version: int, reason: str) -> Entry:
        """Storniert statt zu löschen. Der Eintrag bleibt mit Begründung sichtbar."""
        reason = _clean(reason, "Grund")
        if not reason:
            raise ValidationError("Eine Stornierung braucht eine Begründung.")
        entry = self.get(entry_id)
        if entry.current.fields.status == "cancelled":
            raise ValidationError("Der Eintrag ist bereits storniert.")
        fields = replace(entry.current.fields, status="cancelled")
        return self.update(
            entry_id, fields, actor, expected_version=expected_version, reason=reason
        )

    def entries(self, *, query: str = "", limit: int | None = None, **criteria) -> tuple[Entry, ...]:
        found = [e for e in self._entries.values() if matches(e, query=query, **criteria)]
        found.sort(
            key=lambda e: (
                e.current.fields.shipment_date or date.min,
                e.created_at,
                e.id,
            ),
            reverse=True,
        )
        return tuple(found[:limit] if limit else found)

    def postage_total(self, **criteria) -> tuple[int, int]:
        """Summe des bekannten Portos und Anzahl der Sendungen ohne Angabe."""
        total = 0
        unknown = 0
        for entry in self.entries(**criteria):
            fields = entry.current.fields
            if fields.status == "cancelled":
                continue
            if fields.direction != "outgoing":
                continue
            if fields.postage_cents is None:
                unknown += 1
            else:
                total += fields.postage_cents
        return total, unknown
