"""JSON-Schnittstelle als WSGI-Anwendung.

Bewusst ohne Web-Rahmenwerk: die Anwendung läuft mit der Standardbibliothek,
lässt sich aber unverändert hinter gunicorn, uWSGI oder Apache mod_wsgi
betreiben. Das hält die Menge des zu prüfenden Fremdcodes klein, was in einer
öffentlichen Einrichtung ein echter Vorteil ist.

Anmeldung
---------
Diese Anwendung führt **keine eigene Benutzerverwaltung**. Sie erwartet die
Kennung der angemeldeten Person in einem Kopffeld, das ein vorgelagerter
Webserver setzt (Shibboleth, Kerberos, mod_auth_openidc). Dieses Kopffeld muss
der Webserver bei jeder Anfrage von außen **überschreiben**, sonst kann es
gefälscht werden. Ohne eingerichteten Vorschalt-Webserver startet die Anwendung
nur im ausdrücklich gekennzeichneten Einzelplatz-Entwicklungsmodus.
"""

from __future__ import annotations

import csv
import io
import json
import os
import re
from datetime import date, datetime, timezone
from urllib.parse import parse_qs

from . import matching
from .domain import (
    DIRECTIONS,
    SHIPMENT_TYPES,
    Contact,
    Fields,
    NotFound,
    ValidationError,
    VersionConflict,
    format_postage,
    new_id,
    parse_iso_date,
)
from .storage import MAX_PHOTO_BYTES, Store

__all__ = ["Application", "create_app"]

MAX_BODY = MAX_PHOTO_BYTES + 64 * 1024

ROLES = ("lesen", "erfassen", "verwalten")
_RIGHTS = {
    "lesen": {"read"},
    "erfassen": {"read", "write"},
    "verwalten": {"read", "write", "admin"},
}


class ApiError(Exception):
    def __init__(self, status: int, message: str, **extra):
        super().__init__(message)
        self.status = status
        self.message = message
        self.extra = extra


class Application:
    """WSGI-Anwendung des Postbuchs."""

    def __init__(
        self,
        store: Store,
        *,
        user_header: str = "HTTP_X_REMOTE_USER",
        roles: dict | None = None,
        default_role: str = "erfassen",
        development_user: str | None = None,
    ):
        self.store = store
        self.user_header = user_header
        self.roles = dict(roles or {})
        if default_role not in ROLES:
            raise ValueError(f"Unbekannte Rolle: {default_role}")
        self.default_role = default_role
        self.development_user = development_user

    # -- WSGI -------------------------------------------------------------

    def __call__(self, environ, start_response):
        try:
            status, headers, body = self._handle(environ)
        except ApiError as exc:
            status, headers, body = self._error(exc.status, exc.message, **exc.extra)
        except ValidationError as exc:
            status, headers, body = self._error(422, str(exc))
        except VersionConflict as exc:
            status, headers, body = self._error(409, str(exc), code="version_conflict")
        except NotFound as exc:
            status, headers, body = self._error(404, str(exc))
        except Exception:  # pragma: no cover - unerwartete Fehler
            import traceback

            traceback.print_exc()
            status, headers, body = self._error(500, "Unerwarteter Serverfehler.")
        headers = [*headers, ("X-Content-Type-Options", "nosniff")]
        start_response(status, headers)
        return [body]

    def _handle(self, environ):
        path = environ.get("PATH_INFO", "/")
        method = environ.get("REQUEST_METHOD", "GET").upper()
        if not path.startswith("/api/"):
            raise ApiError(404, "Unbekannter Pfad.")
        route = path[len("/api/v1") :] if path.startswith("/api/v1") else None
        if route is None:
            raise ApiError(404, "Unbekannte Schnittstellenversion. Erwartet wird /api/v1.")

        if route == "/health" and method == "GET":
            return self._json(200, {"status": "ok", "schema": "v1"})

        actor, rights = self._identify(environ)
        query = parse_qs(environ.get("QUERY_STRING", ""), keep_blank_values=False)

        if route == "/session" and method == "GET":
            return self._json(
                200,
                {
                    "actor": actor,
                    "rights": sorted(rights),
                    "shipment_types": list(SHIPMENT_TYPES),
                    "directions": list(DIRECTIONS),
                    "development_mode": self.development_user is not None,
                },
            )

        handlers = [
            (r"^/entries$", {"GET": self._list_entries, "POST": self._create_entry}),
            (r"^/entries/([^/]+)$", {"GET": self._get_entry, "PUT": self._update_entry}),
            (r"^/entries/([^/]+)/cancel$", {"POST": self._cancel_entry}),
            (r"^/entries/([^/]+)/photos$", {"POST": self._add_photo}),
            (r"^/photos/([^/]+)$", {"GET": self._get_photo, "DELETE": self._remove_photo}),
            (r"^/contacts$", {"GET": self._list_contacts, "POST": self._save_contact}),
            (r"^/contacts/suggest$", {"GET": self._suggest_contacts}),
            (r"^/contacts/duplicates$", {"GET": self._duplicate_contacts}),
            (r"^/contacts/([^/]+)/merge$", {"POST": self._merge_contacts}),
            (r"^/summary/postage$", {"GET": self._postage_summary}),
            (r"^/export\.csv$", {"GET": self._export_csv}),
            (r"^/sync$", {"POST": self._sync}),
        ]
        for pattern, methods in handlers:
            match = re.match(pattern, route)
            if not match:
                continue
            handler = methods.get(method)
            if handler is None:
                raise ApiError(405, f"{method} ist auf {route} nicht zulässig.")
            return handler(environ, actor, rights, query, *match.groups())
        raise ApiError(404, "Unbekannter Pfad.")

    # -- Identität --------------------------------------------------------

    def _identify(self, environ) -> tuple[str, set]:
        raw = environ.get(self.user_header) or ""
        actor = raw.strip()[:128]
        if not actor:
            if self.development_user is None:
                raise ApiError(
                    401,
                    "Nicht angemeldet. Der vorgelagerte Webserver hat keine Benutzerkennung "
                    "übergeben.",
                )
            actor = self.development_user
        role = self.roles.get(actor, self.default_role)
        if role not in _RIGHTS:
            raise ApiError(403, f"Unbekannte Rolle für {actor}.")
        return actor, set(_RIGHTS[role])

    @staticmethod
    def _require(rights: set, needed: str) -> None:
        if needed not in rights:
            raise ApiError(403, "Für diesen Vorgang fehlt die Berechtigung.")

    # -- Sendungen --------------------------------------------------------

    def _list_entries(self, environ, actor, rights, query, *args):
        self._require(rights, "read")
        criteria = self._criteria(query)
        entries = self.store.entries(**criteria)
        return self._json(
            200,
            {
                "entries": [e.as_dict() for e in entries],
                "count": len(entries),
                "criteria": {k: _plain(v) for k, v in criteria.items()},
            },
        )

    def _create_entry(self, environ, actor, rights, query, *args):
        self._require(rights, "write")
        payload = self._body_json(environ)
        entry_id = payload.pop("id", None) or new_id()
        local_date = parse_iso_date(payload.pop("local_date", None)) or _today()
        fields = Fields.from_dict(payload)
        entry = self.store.create_entry(fields, actor, local_date=local_date, entry_id=entry_id)
        return self._json(201, entry.as_dict(with_history=True))

    def _get_entry(self, environ, actor, rights, query, entry_id):
        self._require(rights, "read")
        entry = self.store.get_entry(entry_id)
        return self._json(200, entry.as_dict(with_history=True))

    def _update_entry(self, environ, actor, rights, query, entry_id):
        self._require(rights, "write")
        payload = self._body_json(environ)
        expected = payload.pop("expected_version", None)
        reason = payload.pop("reason", "")
        if not isinstance(expected, int):
            raise ApiError(400, "expected_version fehlt. Ohne sie wäre stilles Überschreiben möglich.")
        payload.pop("id", None)
        fields = Fields.from_dict(payload)
        entry = self.store.update_entry(
            entry_id, fields, actor, expected_version=expected, reason=str(reason or "")
        )
        return self._json(200, entry.as_dict(with_history=True))

    def _cancel_entry(self, environ, actor, rights, query, entry_id):
        self._require(rights, "write")
        payload = self._body_json(environ)
        expected = payload.get("expected_version")
        if not isinstance(expected, int):
            raise ApiError(400, "expected_version fehlt.")
        entry = self.store.cancel_entry(
            entry_id, actor, expected_version=expected, reason=str(payload.get("reason", ""))
        )
        return self._json(200, entry.as_dict(with_history=True))

    # -- Fotos ------------------------------------------------------------

    def _add_photo(self, environ, actor, rights, query, entry_id):
        self._require(rights, "write")
        media_type = (environ.get("CONTENT_TYPE") or "").split(";")[0].strip()
        data = self._body_bytes(environ)
        photo = self.store.add_photo(
            entry_id,
            data,
            actor,
            media_type=media_type,
            filename=_first(query, "filename", ""),
            caption=_first(query, "caption", ""),
            photo_id=_first(query, "id", "") or None,
        )
        return self._json(201, photo.as_dict())

    def _get_photo(self, environ, actor, rights, query, photo_id):
        self._require(rights, "read")
        photo = self.store.get_photo(photo_id)
        data = self.store.photo_bytes(photo_id)
        headers = [
            ("Content-Type", photo.media_type),
            ("Content-Length", str(len(data))),
            ("Cache-Control", "private, max-age=0, no-store"),
            ("Content-Disposition", f'inline; filename="{photo.id}"'),
        ]
        return "200 OK", headers, data

    def _remove_photo(self, environ, actor, rights, query, photo_id):
        self._require(rights, "write")
        photo = self.store.remove_photo(photo_id, actor, reason=_first(query, "reason", ""))
        return self._json(200, photo.as_dict())

    # -- Kontakte ---------------------------------------------------------

    def _list_contacts(self, environ, actor, rights, query, *args):
        self._require(rights, "read")
        contacts = self.store.contacts(query=_first(query, "query", ""))
        return self._json(200, {"contacts": [c.as_dict() for c in contacts]})

    def _save_contact(self, environ, actor, rights, query, *args):
        self._require(rights, "write")
        payload = self._body_json(environ)
        contact = Contact(
            id=str(payload.get("id") or new_id()),
            name=payload.get("name", ""),
            organisation=payload.get("organisation", ""),
            address=payload.get("address", ""),
            aliases=tuple(payload.get("aliases") or ()),
            internal=bool(payload.get("internal")),
            psp_element=payload.get("psp_element"),
        )
        return self._json(201, self.store.save_contact(contact, actor).as_dict())

    def _suggest_contacts(self, environ, actor, rights, query, *args):
        self._require(rights, "read")
        text = _first(query, "text", "")
        found = matching.suggest(text, self.store.contacts(limit=1000))
        return self._json(
            200,
            {"suggestions": [{"score": s, "contact": c.as_dict()} for s, c in found]},
        )

    def _duplicate_contacts(self, environ, actor, rights, query, *args):
        self._require(rights, "admin")
        groups = matching.duplicate_groups(self.store.contacts(limit=1000))
        return self._json(
            200, {"groups": [[c.as_dict() for c in group] for group in groups]}
        )

    def _merge_contacts(self, environ, actor, rights, query, source_id):
        self._require(rights, "admin")
        payload = self._body_json(environ)
        target_id = str(payload.get("target_id") or "")
        if not target_id:
            raise ApiError(400, "target_id fehlt.")
        return self._json(200, self.store.merge_contacts(source_id, target_id, actor).as_dict())

    # -- Auswertung -------------------------------------------------------

    def _postage_summary(self, environ, actor, rights, query, *args):
        self._require(rights, "read")
        criteria = self._criteria(query)
        criteria.pop("direction", None)
        criteria.pop("status", None)
        summary = self.store.postage_summary(**criteria)
        summary["postage"] = format_postage(summary["postage_cents"])
        return self._json(200, summary)

    def _export_csv(self, environ, actor, rights, query, *args):
        self._require(rights, "read")
        criteria = self._criteria(query)
        criteria["limit"] = 1000
        entries = self.store.entries(**criteria)
        buffer = io.StringIO()
        writer = csv.writer(buffer, delimiter=";", quoting=csv.QUOTE_MINIMAL)
        writer.writerow(
            [
                "Postbuchnummer",
                "Richtung",
                "Sendungsdatum",
                "Sendungsart",
                "Absender",
                "Absenderanschrift",
                "Empfänger",
                "Empfängeranschrift",
                "Beschreibung",
                "Porto EUR",
                "PSP-Element",
                "Status",
                "Fassung",
                "Zuletzt bearbeitet",
                "Bearbeitet von",
                "Fotos",
                "Kennung",
            ]
        )
        for entry in entries:
            f = entry.current.fields
            writer.writerow(
                [
                    entry.number or "",
                    "Eingang" if f.direction == "incoming" else "Ausgang",
                    f.shipment_date.isoformat() if f.shipment_date else "",
                    f.shipment_type,
                    f.sender.label,
                    f.sender.address.replace("\n", ", "),
                    f.recipient.label,
                    f.recipient.address.replace("\n", ", "),
                    f.description.replace("\n", " "),
                    format_postage(f.postage_cents),
                    f.psp_element or "",
                    "storniert" if f.status == "cancelled" else "gültig",
                    entry.current.version,
                    entry.current.recorded_at.isoformat(),
                    entry.current.actor,
                    len(entry.active_photos),
                    entry.id,
                ]
            )
        # Byte-Order-Mark, damit Excel die Umlaute richtig liest.
        body = ("﻿" + buffer.getvalue()).encode("utf-8")
        stamp = datetime.now(timezone.utc).strftime("%Y%m%d")
        return (
            "200 OK",
            [
                ("Content-Type", "text/csv; charset=utf-8"),
                ("Content-Length", str(len(body))),
                ("Content-Disposition", f'attachment; filename="postbuch-{stamp}.csv"'),
            ],
            body,
        )

    # -- Offline-Warteschlange -------------------------------------------

    def _sync(self, environ, actor, rights, query, *args):
        """Nimmt offline erfasste Vorgänge gesammelt entgegen.

        Jeder Vorgang wird einzeln beantwortet. Ein fehlerhafter Vorgang hält
        die übrigen nicht auf, damit eine einzelne unsaubere Erfassung nicht die
        ganze Warteschlange blockiert. Wiederholte Übertragung ist gefahrlos:
        ``create`` mit bekannter Kennung liefert den vorhandenen Eintrag.
        """
        self._require(rights, "write")
        payload = self._body_json(environ)
        operations = payload.get("operations")
        if not isinstance(operations, list):
            raise ApiError(400, "operations muss eine Liste sein.")
        if len(operations) > 200:
            raise ApiError(413, "Höchstens 200 Vorgänge je Übertragung.")
        results = []
        for index, operation in enumerate(operations):
            reference = None
            try:
                if not isinstance(operation, dict):
                    raise ValidationError("Vorgang muss ein Objekt sein.")
                reference = operation.get("client_ref") or operation.get("id")
                kind = operation.get("op")
                data = dict(operation.get("data") or {})
                if kind == "create":
                    entry_id = operation.get("id") or new_id()
                    local_date = parse_iso_date(data.pop("local_date", None)) or _today()
                    entry = self.store.create_entry(
                        Fields.from_dict(data), actor, local_date=local_date, entry_id=entry_id
                    )
                elif kind == "update":
                    expected = operation.get("expected_version")
                    if not isinstance(expected, int):
                        raise ValidationError("expected_version fehlt.")
                    entry = self.store.update_entry(
                        operation["id"],
                        Fields.from_dict(data),
                        actor,
                        expected_version=expected,
                        reason=str(operation.get("reason", "")),
                    )
                elif kind == "cancel":
                    entry = self.store.cancel_entry(
                        operation["id"],
                        actor,
                        expected_version=int(operation.get("expected_version", -1)),
                        reason=str(operation.get("reason", "")),
                    )
                else:
                    raise ValidationError(f"Unbekannter Vorgang: {kind!r}")
                results.append(
                    {"index": index, "client_ref": reference, "status": "ok", "entry": entry.as_dict()}
                )
            except VersionConflict as exc:
                results.append(
                    {
                        "index": index,
                        "client_ref": reference,
                        "status": "conflict",
                        "message": str(exc),
                        "entry": _safe_entry(self.store, operation.get("id")),
                    }
                )
            except (ValidationError, NotFound, KeyError, TypeError, ValueError) as exc:
                results.append(
                    {
                        "index": index,
                        "client_ref": reference,
                        "status": "rejected",
                        "message": str(exc) or exc.__class__.__name__,
                    }
                )
        return self._json(200, {"results": results})

    # -- Hilfen -----------------------------------------------------------

    def _criteria(self, query) -> dict:
        criteria: dict = {}
        for key in ("query", "direction", "shipment_type", "status", "psp_element", "contact_id"):
            value = _first(query, key, "")
            if value:
                criteria[key] = value
        for key in ("date_from", "date_to"):
            value = _first(query, key, "")
            if value:
                criteria[key] = parse_iso_date(value)
        limit = _first(query, "limit", "")
        if limit:
            try:
                criteria["limit"] = int(limit)
            except ValueError as exc:
                raise ApiError(400, "limit muss eine Zahl sein.") from exc
        offset = _first(query, "offset", "")
        if offset:
            try:
                criteria["offset"] = int(offset)
            except ValueError as exc:
                raise ApiError(400, "offset muss eine Zahl sein.") from exc
        if criteria.get("direction") and criteria["direction"] not in DIRECTIONS:
            raise ApiError(400, "direction muss incoming oder outgoing sein.")
        return criteria

    def _body_bytes(self, environ) -> bytes:
        try:
            length = int(environ.get("CONTENT_LENGTH") or 0)
        except ValueError as exc:
            raise ApiError(400, "Ungültige Inhaltslänge.") from exc
        if length <= 0:
            raise ApiError(400, "Leerer Anfragerumpf.")
        if length > MAX_BODY:
            raise ApiError(413, "Anfrage ist zu groß.")
        return environ["wsgi.input"].read(length)

    def _body_json(self, environ) -> dict:
        try:
            data = json.loads(self._body_bytes(environ).decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as exc:
            raise ApiError(400, "Der Anfragerumpf ist kein gültiges JSON.") from exc
        if not isinstance(data, dict):
            raise ApiError(400, "Erwartet wird ein JSON-Objekt.")
        return data

    @staticmethod
    def _json(status: int, payload) -> tuple:
        body = json.dumps(payload, ensure_ascii=False, indent=None).encode("utf-8")
        return (
            f"{status} {_REASONS.get(status, 'OK')}",
            [
                ("Content-Type", "application/json; charset=utf-8"),
                ("Content-Length", str(len(body))),
                ("Cache-Control", "no-store"),
            ],
            body,
        )

    def _error(self, status: int, message: str, **extra) -> tuple:
        return self._json(status, {"error": message, **extra})


_REASONS = {
    200: "OK",
    201: "Created",
    400: "Bad Request",
    401: "Unauthorized",
    403: "Forbidden",
    404: "Not Found",
    405: "Method Not Allowed",
    409: "Conflict",
    413: "Payload Too Large",
    422: "Unprocessable Entity",
    500: "Internal Server Error",
}


def _first(query: dict, key: str, default: str = "") -> str:
    values = query.get(key)
    return values[0].strip() if values and values[0] is not None else default


def _plain(value):
    return value.isoformat() if isinstance(value, date) else value


def _today() -> date:
    return datetime.now().date()


def _safe_entry(store: Store, entry_id):
    try:
        return store.get_entry(entry_id).as_dict()
    except (NotFound, TypeError):
        return None


def create_app(
    database: str | None = None,
    *,
    photo_dir: str | None = None,
    development_user: str | None = None,
) -> Application:
    """Baut die Anwendung aus Umgebungsvariablen.

    ``POSTBUCH_DB``            Pfad zur SQLite-Datei
    ``POSTBUCH_FOTOS``         Verzeichnis für Belegfotos
    ``POSTBUCH_USER_HEADER``   Kopffeld mit der Benutzerkennung
    ``POSTBUCH_ROLLEN``        JSON-Datei mit ``{"kennung": "rolle"}``
    ``POSTBUCH_STANDARDROLLE`` Rolle für nicht aufgeführte Kennungen
    ``POSTBUCH_DEV_USER``      Nur für Entwicklung: feste Kennung ohne Anmeldung
    """
    database = database or os.environ.get("POSTBUCH_DB", "postbuch.sqlite3")
    photo_dir = photo_dir or os.environ.get("POSTBUCH_FOTOS") or None
    roles = {}
    roles_file = os.environ.get("POSTBUCH_ROLLEN")
    if roles_file and os.path.exists(roles_file):
        with open(roles_file, encoding="utf-8") as handle:
            roles = json.load(handle)
    header = os.environ.get("POSTBUCH_USER_HEADER", "X-Remote-User")
    header = "HTTP_" + header.upper().replace("-", "_")
    return Application(
        Store(database, photo_dir=photo_dir),
        user_header=header,
        roles=roles,
        default_role=os.environ.get("POSTBUCH_STANDARDROLLE", "erfassen"),
        development_user=development_user or os.environ.get("POSTBUCH_DEV_USER"),
    )
