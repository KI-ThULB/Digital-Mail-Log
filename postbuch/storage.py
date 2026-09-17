"""Dauerhafte Speicherung in SQLite.

Entwurfsentscheidungen:

* Revisionen sind fortschreibend. Datenbankauslöser weisen jedes ``UPDATE`` und
  ``DELETE`` auf der Revisionstabelle zurück. Eine Korrektur schreibt eine neue
  Zeile; der frühere Stand bleibt lesbar.
* Die Kennung einer Sendung vergibt das Erfassungsgerät, auch ohne Netz. Eine
  wiederholte Übertragung derselben Kennung legt keinen zweiten Eintrag an.
* Die lesbare Postbuchnummer vergibt ausschließlich der Server, fortlaufend je
  Jahr und Richtung.
* Fotos liegen als Dateien neben der Datenbank, nicht in ihr. Die Datenbank hält
  Metadaten und Prüfsumme.

SQLite trägt einen Pilotbetrieb einer Poststelle ohne Weiteres. Der Wechsel auf
PostgreSQL berührt nur dieses Modul; das Schema ist bewusst schlicht gehalten.
"""

from __future__ import annotations

import hashlib
import json
import sqlite3
import threading
from datetime import date, datetime, timezone
from pathlib import Path

from .domain import (
    Contact,
    Entry,
    Fields,
    NotFound,
    Photo,
    Revision,
    ValidationError,
    VersionConflict,
    new_id,
    normalise,
    postbuch_number,
)

__all__ = ["Store", "SCHEMA_VERSION"]

SCHEMA_VERSION = 1

_SCHEMA = """
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS meta (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS entries (
    id              TEXT PRIMARY KEY,
    number          TEXT UNIQUE,
    created_at      TEXT NOT NULL,
    current_version INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS revisions (
    entry_id             TEXT    NOT NULL REFERENCES entries(id),
    version              INTEGER NOT NULL,
    recorded_at          TEXT    NOT NULL,
    actor                TEXT    NOT NULL,
    reason               TEXT    NOT NULL DEFAULT '',
    fields_json          TEXT    NOT NULL,
    direction            TEXT    NOT NULL,
    shipment_date        TEXT,
    shipment_type        TEXT    NOT NULL,
    status               TEXT    NOT NULL,
    postage_cents        INTEGER,
    psp_element          TEXT,
    sender_contact_id    TEXT,
    recipient_contact_id TEXT,
    search_text          TEXT    NOT NULL,
    PRIMARY KEY (entry_id, version)
);

CREATE TRIGGER IF NOT EXISTS revisions_are_append_only_update
BEFORE UPDATE ON revisions
BEGIN
    SELECT RAISE(ABORT, 'Revisionen duerfen nicht veraendert werden.');
END;

CREATE TRIGGER IF NOT EXISTS revisions_are_append_only_delete
BEFORE DELETE ON revisions
BEGIN
    SELECT RAISE(ABORT, 'Revisionen duerfen nicht geloescht werden.');
END;

CREATE TABLE IF NOT EXISTS counters (
    direction TEXT    NOT NULL,
    year      INTEGER NOT NULL,
    used      INTEGER NOT NULL,
    PRIMARY KEY (direction, year)
);

CREATE TABLE IF NOT EXISTS contacts (
    id           TEXT PRIMARY KEY,
    name         TEXT NOT NULL DEFAULT '',
    organisation TEXT NOT NULL DEFAULT '',
    address      TEXT NOT NULL DEFAULT '',
    aliases_json TEXT NOT NULL DEFAULT '[]',
    internal     INTEGER NOT NULL DEFAULT 0,
    psp_element  TEXT,
    merged_into  TEXT REFERENCES contacts(id),
    search_text  TEXT NOT NULL DEFAULT '',
    updated_at   TEXT NOT NULL,
    updated_by   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS photos (
    id          TEXT PRIMARY KEY,
    entry_id    TEXT NOT NULL REFERENCES entries(id),
    filename    TEXT NOT NULL,
    media_type  TEXT NOT NULL,
    byte_size   INTEGER NOT NULL,
    sha256      TEXT NOT NULL,
    caption     TEXT NOT NULL DEFAULT '',
    added_by    TEXT NOT NULL,
    added_at    TEXT NOT NULL,
    removed_by  TEXT,
    removed_at  TEXT
);

CREATE INDEX IF NOT EXISTS revisions_current
    ON revisions (entry_id, version DESC);
CREATE INDEX IF NOT EXISTS revisions_by_date
    ON revisions (shipment_date DESC);
CREATE INDEX IF NOT EXISTS photos_by_entry
    ON photos (entry_id);
CREATE INDEX IF NOT EXISTS contacts_by_search
    ON contacts (search_text);
"""

_ALLOWED_MEDIA = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "application/pdf": ".pdf",
}

MAX_PHOTO_BYTES = 12 * 1024 * 1024


def _iso(value: datetime) -> str:
    return value.astimezone(timezone.utc).isoformat()


def _from_iso(value: str | None) -> datetime | None:
    return datetime.fromisoformat(value) if value else None


class Store:
    """Zugriff auf Postbuchdaten. Nicht thread-übergreifend geteilt verwenden."""

    def __init__(self, path: str | Path = ":memory:", *, photo_dir: str | Path | None = None, clock=None):
        self.path = str(path)
        self._clock = clock or (lambda: datetime.now(timezone.utc))
        # Eine Verbindung je Thread: SQLite-Verbindungen sind nicht
        # threadübergreifend verwendbar, ein WSGI-Server bedient Anfragen aber
        # aus wechselnden Threads. Bei ``:memory:`` teilen sich alle Threads
        # dieselbe Datenbank über einen benannten gemeinsamen Zwischenspeicher.
        self._shared_memory = self.path == ":memory:"
        if self._shared_memory:
            self._dsn = f"file:postbuch-{id(self):x}?mode=memory&cache=shared"
            self._keepalive = self._connect()
        else:
            self._dsn = self.path
            self._keepalive = None
        self._local = threading.local()
        self._connections: list[sqlite3.Connection] = []
        self._lock = threading.Lock()

        db = self._db
        db.executescript(_SCHEMA)
        db.execute(
            "INSERT OR IGNORE INTO meta (key, value) VALUES ('schema_version', ?)",
            (str(SCHEMA_VERSION),),
        )
        if photo_dir is None and not self._shared_memory:
            photo_dir = Path(self.path).resolve().parent / "fotos"
        self.photo_dir = Path(photo_dir) if photo_dir else None
        if self.photo_dir:
            self.photo_dir.mkdir(parents=True, exist_ok=True)

    # -- Infrastruktur ----------------------------------------------------

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(
            getattr(self, "_dsn", self.path),
            isolation_level=None,
            uri=getattr(self, "_shared_memory", False),
            timeout=15,
            check_same_thread=False,
        )
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys = ON")
        connection.execute("PRAGMA busy_timeout = 10000")
        return connection

    @property
    def _db(self) -> sqlite3.Connection:
        connection = getattr(self._local, "connection", None)
        if connection is None:
            connection = self._connect()
            self._local.connection = connection
            with self._lock:
                self._connections.append(connection)
        return connection

    def close(self) -> None:
        with self._lock:
            for connection in self._connections:
                try:
                    connection.close()
                except sqlite3.Error:
                    pass
            self._connections.clear()
        self._local = threading.local()
        if self._keepalive is not None:
            self._keepalive.close()
            self._keepalive = None

    def __enter__(self) -> "Store":
        return self

    def __exit__(self, *exc) -> None:
        self.close()

    def _now(self) -> datetime:
        now = self._clock()
        if now.tzinfo is None or now.utcoffset() is None:
            raise ValidationError("Zeitstempel benötigt eine Zeitzone.")
        return now

    @staticmethod
    def _actor(actor: object) -> str:
        if not isinstance(actor, str) or not actor.strip():
            raise ValidationError("Bearbeitende Person fehlt.")
        return actor.strip()

    # -- Sendungen --------------------------------------------------------

    def create_entry(
        self,
        fields: Fields,
        actor: str,
        *,
        local_date: date,
        entry_id: str | None = None,
    ) -> Entry:
        """Legt eine Sendung an oder liefert die bereits vorhandene zurück.

        Die zweite Übertragung derselben Kennung ist folgenlos. Das ist die
        Grundlage dafür, dass ein abgebrochener Upload gefahrlos wiederholt
        werden darf, ohne Dubletten im Postbuch zu erzeugen.
        """
        if not isinstance(fields, Fields):
            raise ValidationError("Ungültige Erfassungsdaten.")
        if type(local_date) is not date:
            raise ValidationError("Erfassungsdatum des Geräts fehlt.")
        actor = self._actor(actor)
        now = self._now()
        entry_id = entry_id or new_id()

        if fields.shipment_date is None:
            fields = Fields(**{**_fields_kwargs(fields), "shipment_date": local_date})

        try:
            self._db.execute("BEGIN IMMEDIATE")
            existing = self._db.execute(
                "SELECT id FROM entries WHERE id = ?", (entry_id,)
            ).fetchone()
            if existing:
                self._db.execute("COMMIT")
                return self.get_entry(entry_id)

            number = self._reserve_number(fields.direction, fields.shipment_date.year)
            self._db.execute(
                "INSERT INTO entries (id, number, created_at, current_version) VALUES (?, ?, ?, 1)",
                (entry_id, number, _iso(now)),
            )
            self._insert_revision(entry_id, Revision(1, fields, actor, now))
            self._db.execute("COMMIT")
        except Exception:
            self._db.execute("ROLLBACK")
            raise
        return self.get_entry(entry_id)

    def update_entry(
        self,
        entry_id: str,
        fields: Fields,
        actor: str,
        *,
        expected_version: int,
        reason: str = "",
    ) -> Entry:
        if not isinstance(fields, Fields):
            raise ValidationError("Ungültige Sendungsdaten.")
        if fields.shipment_date is None:
            raise ValidationError("Sendungsdatum fehlt.")
        actor = self._actor(actor)
        now = self._now()
        try:
            self._db.execute("BEGIN IMMEDIATE")
            row = self._db.execute(
                "SELECT current_version FROM entries WHERE id = ?", (entry_id,)
            ).fetchone()
            if row is None:
                raise NotFound(f"Eintrag {entry_id} existiert nicht.")
            if type(expected_version) is not int or row["current_version"] != expected_version:
                raise VersionConflict(
                    "Eintrag wurde zwischenzeitlich geändert. Bitte neu laden."
                )
            current = self._revision(entry_id, expected_version)
            if current.fields.status == "cancelled":
                if fields.status != "active":
                    raise ValidationError("Stornierte Sendungen können nicht bearbeitet werden.")
                if not reason.strip():
                    raise ValidationError(
                        "Die Rücknahme einer Stornierung braucht eine Begründung."
                    )
            version = expected_version + 1
            self._insert_revision(entry_id, Revision(version, fields, actor, now, reason.strip()))
            self._db.execute(
                "UPDATE entries SET current_version = ? WHERE id = ?", (version, entry_id)
            )
            self._db.execute("COMMIT")
        except Exception:
            self._db.execute("ROLLBACK")
            raise
        return self.get_entry(entry_id)

    def cancel_entry(
        self, entry_id: str, actor: str, *, expected_version: int, reason: str
    ) -> Entry:
        if not reason or not reason.strip():
            raise ValidationError("Eine Stornierung braucht eine Begründung.")
        entry = self.get_entry(entry_id)
        if entry.current.fields.status == "cancelled":
            raise ValidationError("Der Eintrag ist bereits storniert.")
        fields = Fields(**{**_fields_kwargs(entry.current.fields), "status": "cancelled"})
        return self.update_entry(
            entry_id, fields, actor, expected_version=expected_version, reason=reason
        )

    def get_entry(self, entry_id: str) -> Entry:
        row = self._db.execute("SELECT * FROM entries WHERE id = ?", (entry_id,)).fetchone()
        if row is None:
            raise NotFound(f"Eintrag {entry_id} existiert nicht.")
        revisions = tuple(
            self._row_to_revision(r)
            for r in self._db.execute(
                "SELECT * FROM revisions WHERE entry_id = ? ORDER BY version", (entry_id,)
            )
        )
        photos = tuple(
            self._row_to_photo(p)
            for p in self._db.execute(
                "SELECT * FROM photos WHERE entry_id = ? ORDER BY added_at", (entry_id,)
            )
        )
        return Entry(id=row["id"], revisions=revisions, number=row["number"], photos=photos)

    def entries(
        self,
        *,
        query: str = "",
        direction: str | None = None,
        shipment_type: str | None = None,
        status: str | None = None,
        psp_element: str | None = None,
        contact_id: str | None = None,
        date_from: date | None = None,
        date_to: date | None = None,
        limit: int = 200,
        offset: int = 0,
    ) -> tuple[Entry, ...]:
        sql = [
            "SELECT e.id FROM entries e",
            "JOIN revisions r ON r.entry_id = e.id AND r.version = e.current_version",
            "WHERE 1 = 1",
        ]
        args: list = []
        if direction:
            sql.append("AND r.direction = ?")
            args.append(direction)
        if shipment_type:
            sql.append("AND r.shipment_type = ?")
            args.append(shipment_type)
        if status:
            sql.append("AND r.status = ?")
            args.append(status)
        if psp_element:
            sql.append("AND r.psp_element = ?")
            args.append(psp_element)
        if contact_id:
            sql.append("AND (r.sender_contact_id = ? OR r.recipient_contact_id = ?)")
            args.extend((contact_id, contact_id))
        if date_from:
            sql.append("AND r.shipment_date >= ?")
            args.append(date_from.isoformat())
        if date_to:
            sql.append("AND r.shipment_date <= ?")
            args.append(date_to.isoformat())
        for word in normalise(query).split():
            # Die Postbuchnummer hängt am Eintrag, nicht an der Fassung. Sie wird
            # deshalb eigens durchsucht, damit „2026-A-00042“ den Eintrag findet.
            sql.append("AND (r.search_text LIKE ? OR LOWER(IFNULL(e.number, '')) LIKE ?)")
            args.extend((f"%{word}%", f"%{word}%"))
        sql.append("ORDER BY r.shipment_date DESC, e.created_at DESC, e.id DESC")
        sql.append("LIMIT ? OFFSET ?")
        args.extend((max(1, min(int(limit), 1000)), max(0, int(offset))))
        ids = [r["id"] for r in self._db.execute(" ".join(sql), args)]
        return tuple(self.get_entry(i) for i in ids)

    def postage_summary(self, **criteria) -> dict:
        """Portosummen für die Kostenstellenabrechnung.

        Sendungen ohne Portoangabe werden gezählt, nicht als null Euro gewertet.
        Stornierte Sendungen bleiben außen vor.
        """
        criteria = {**criteria, "direction": "outgoing", "status": "active"}
        criteria.setdefault("limit", 1000)
        by_psp: dict[str, dict] = {}
        total = 0
        unknown = 0
        count = 0
        for entry in self.entries(**criteria):
            fields = entry.current.fields
            count += 1
            key = fields.psp_element or ""
            bucket = by_psp.setdefault(key, {"psp_element": fields.psp_element, "cents": 0, "count": 0, "unknown": 0})
            bucket["count"] += 1
            if fields.postage_cents is None:
                unknown += 1
                bucket["unknown"] += 1
            else:
                total += fields.postage_cents
                bucket["cents"] += fields.postage_cents
        return {
            "count": count,
            "postage_cents": total,
            "without_postage": unknown,
            "by_psp_element": sorted(by_psp.values(), key=lambda b: (b["psp_element"] or "")),
        }

    # -- Fotos ------------------------------------------------------------

    def add_photo(
        self,
        entry_id: str,
        data: bytes,
        actor: str,
        *,
        media_type: str,
        filename: str = "",
        caption: str = "",
        photo_id: str | None = None,
    ) -> Photo:
        actor = self._actor(actor)
        self.get_entry(entry_id)
        if media_type not in _ALLOWED_MEDIA:
            raise ValidationError(f"Nicht unterstütztes Dateiformat: {media_type}")
        if not isinstance(data, (bytes, bytearray)) or not data:
            raise ValidationError("Leere Datei.")
        if len(data) > MAX_PHOTO_BYTES:
            raise ValidationError("Die Datei ist zu groß.")
        if self.photo_dir is None:
            raise ValidationError("Für diesen Speicher ist kein Fotoverzeichnis eingerichtet.")
        photo_id = photo_id or new_id()
        existing = self._db.execute("SELECT id FROM photos WHERE id = ?", (photo_id,)).fetchone()
        if existing:
            return self.get_photo(photo_id)
        digest = hashlib.sha256(data).hexdigest()
        target = self.photo_dir / f"{photo_id}{_ALLOWED_MEDIA[media_type]}"
        target.write_bytes(bytes(data))
        now = self._now()
        self._db.execute(
            "INSERT INTO photos (id, entry_id, filename, media_type, byte_size, sha256,"
            " caption, added_by, added_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                photo_id,
                entry_id,
                (filename or target.name)[:256],
                media_type,
                len(data),
                digest,
                caption.strip()[:512],
                actor,
                _iso(now),
            ),
        )
        return self.get_photo(photo_id)

    def get_photo(self, photo_id: str) -> Photo:
        row = self._db.execute("SELECT * FROM photos WHERE id = ?", (photo_id,)).fetchone()
        if row is None:
            raise NotFound("Foto existiert nicht.")
        return self._row_to_photo(row)

    def photo_bytes(self, photo_id: str) -> bytes:
        photo = self.get_photo(photo_id)
        if self.photo_dir is None:
            raise NotFound("Kein Fotoverzeichnis eingerichtet.")
        path = self.photo_dir / f"{photo.id}{_ALLOWED_MEDIA[photo.media_type]}"
        if not path.exists():
            raise NotFound("Bilddatei fehlt im Speicher.")
        return path.read_bytes()

    def remove_photo(self, photo_id: str, actor: str, *, reason: str = "") -> Photo:
        """Entfernt ein Foto aus der Ansicht und protokolliert das.

        Die Datei bleibt bis zu einem geregelten Löschlauf erhalten. Ein
        unprotokolliertes Entfernen gibt es nicht.
        """
        actor = self._actor(actor)
        photo = self.get_photo(photo_id)
        if not photo.active:
            return photo
        self._db.execute(
            "UPDATE photos SET removed_by = ?, removed_at = ?, caption = ? WHERE id = ?",
            (
                actor,
                _iso(self._now()),
                (photo.caption + (f" · entfernt: {reason.strip()}" if reason.strip() else "")).strip()[:512],
                photo_id,
            ),
        )
        return self.get_photo(photo_id)

    # -- Kontakte ---------------------------------------------------------

    def save_contact(self, contact: Contact, actor: str) -> Contact:
        actor = self._actor(actor)
        if not isinstance(contact, Contact):
            raise ValidationError("Ungültiger Kontakt.")
        search = " ".join(contact.keys())
        self._db.execute(
            "INSERT INTO contacts (id, name, organisation, address, aliases_json, internal,"
            " psp_element, merged_into, search_text, updated_at, updated_by)"
            " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
            " ON CONFLICT(id) DO UPDATE SET name = excluded.name,"
            " organisation = excluded.organisation, address = excluded.address,"
            " aliases_json = excluded.aliases_json, internal = excluded.internal,"
            " psp_element = excluded.psp_element, merged_into = excluded.merged_into,"
            " search_text = excluded.search_text, updated_at = excluded.updated_at,"
            " updated_by = excluded.updated_by",
            (
                contact.id,
                contact.name,
                contact.organisation,
                contact.address,
                json.dumps(list(contact.aliases), ensure_ascii=False),
                1 if contact.internal else 0,
                contact.psp_element,
                contact.merged_into,
                search,
                _iso(self._now()),
                actor,
            ),
        )
        return self.get_contact(contact.id)

    def get_contact(self, contact_id: str) -> Contact:
        row = self._db.execute("SELECT * FROM contacts WHERE id = ?", (contact_id,)).fetchone()
        if row is None:
            raise NotFound("Kontakt existiert nicht.")
        return self._row_to_contact(row)

    def contacts(self, *, query: str = "", limit: int = 200, include_merged: bool = False):
        sql = ["SELECT * FROM contacts WHERE 1 = 1"]
        args: list = []
        if not include_merged:
            sql.append("AND merged_into IS NULL")
        for word in normalise(query).split():
            sql.append("AND search_text LIKE ?")
            args.append(f"%{word}%")
        sql.append("ORDER BY organisation, name LIMIT ?")
        args.append(max(1, min(int(limit), 1000)))
        return tuple(self._row_to_contact(r) for r in self._db.execute(" ".join(sql), args))

    def merge_contacts(self, source_id: str, target_id: str, actor: str) -> Contact:
        """Führt eine Dublette auf einen Zielkontakt zusammen.

        Bereits erfasste Sendungen behalten ihren damaligen Adressstand. Nur
        künftige Erfassungen greifen auf den Zielkontakt zu.
        """
        actor = self._actor(actor)
        if source_id == target_id:
            raise ValidationError("Quelle und Ziel sind identisch.")
        source = self.get_contact(source_id)
        target = self.get_contact(target_id)
        if target.merged_into:
            raise ValidationError("Der Zielkontakt ist selbst eine Dublette.")
        aliases = tuple(
            dict.fromkeys(
                (*target.aliases, source.label, source.name, source.organisation, *source.aliases)
            )
        )
        merged = Contact(
            id=target.id,
            name=target.name,
            organisation=target.organisation,
            address=target.address,
            aliases=tuple(a for a in aliases if a and a != target.label),
            internal=target.internal,
            psp_element=target.psp_element,
        )
        self.save_contact(merged, actor)
        self._db.execute(
            "UPDATE contacts SET merged_into = ?, updated_at = ?, updated_by = ? WHERE id = ?",
            (target.id, _iso(self._now()), actor, source.id),
        )
        return self.get_contact(target.id)

    # -- interne Helfer ---------------------------------------------------

    def _reserve_number(self, direction: str, year: int) -> str:
        self._db.execute(
            "INSERT INTO counters (direction, year, used) VALUES (?, ?, 0)"
            " ON CONFLICT(direction, year) DO NOTHING",
            (direction, year),
        )
        self._db.execute(
            "UPDATE counters SET used = used + 1 WHERE direction = ? AND year = ?",
            (direction, year),
        )
        used = self._db.execute(
            "SELECT used FROM counters WHERE direction = ? AND year = ?", (direction, year)
        ).fetchone()["used"]
        return postbuch_number(direction, year, used)

    def _insert_revision(self, entry_id: str, revision: Revision) -> None:
        fields = revision.fields
        self._db.execute(
            "INSERT INTO revisions (entry_id, version, recorded_at, actor, reason, fields_json,"
            " direction, shipment_date, shipment_type, status, postage_cents, psp_element,"
            " sender_contact_id, recipient_contact_id, search_text)"
            " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                entry_id,
                revision.version,
                _iso(revision.recorded_at),
                revision.actor,
                revision.reason,
                json.dumps(fields.as_dict(), ensure_ascii=False),
                fields.direction,
                fields.shipment_date.isoformat() if fields.shipment_date else None,
                fields.shipment_type,
                fields.status,
                fields.postage_cents,
                fields.psp_element,
                fields.sender.contact_id,
                fields.recipient.contact_id,
                normalise(f"{fields.searchable()} {entry_id}"),
            ),
        )

    def _revision(self, entry_id: str, version: int) -> Revision:
        row = self._db.execute(
            "SELECT * FROM revisions WHERE entry_id = ? AND version = ?", (entry_id, version)
        ).fetchone()
        if row is None:
            raise NotFound("Revision existiert nicht.")
        return self._row_to_revision(row)

    @staticmethod
    def _row_to_revision(row: sqlite3.Row) -> Revision:
        return Revision(
            version=row["version"],
            fields=Fields.from_dict(json.loads(row["fields_json"])),
            actor=row["actor"],
            recorded_at=datetime.fromisoformat(row["recorded_at"]),
            reason=row["reason"] or "",
        )

    @staticmethod
    def _row_to_photo(row: sqlite3.Row) -> Photo:
        return Photo(
            id=row["id"],
            entry_id=row["entry_id"],
            filename=row["filename"],
            media_type=row["media_type"],
            byte_size=row["byte_size"],
            caption=row["caption"] or "",
            added_by=row["added_by"],
            added_at=datetime.fromisoformat(row["added_at"]),
            removed_by=row["removed_by"],
            removed_at=_from_iso(row["removed_at"]),
        )

    @staticmethod
    def _row_to_contact(row: sqlite3.Row) -> Contact:
        return Contact(
            id=row["id"],
            name=row["name"],
            organisation=row["organisation"],
            address=row["address"],
            aliases=tuple(json.loads(row["aliases_json"])),
            internal=bool(row["internal"]),
            psp_element=row["psp_element"],
            merged_into=row["merged_into"],
        )


def _fields_kwargs(fields: Fields) -> dict:
    return {
        "direction": fields.direction,
        "sender": fields.sender,
        "recipient": fields.recipient,
        "description": fields.description,
        "shipment_type": fields.shipment_type,
        "shipment_date": fields.shipment_date,
        "postage_cents": fields.postage_cents,
        "psp_element": fields.psp_element,
        "status": fields.status,
        "note": fields.note,
    }
