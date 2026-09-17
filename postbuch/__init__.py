"""Digitales Postbuch – Fachkern, Speicherung und Schnittstelle.

* ``domain``   Fachliche Regeln. Kein Netz, keine Datenbank, keine Zeitzonenannahmen.
* ``storage``  Dauerhafte Speicherung in SQLite, Revisionen fortschreibend.
* ``api``      JSON-Schnittstelle als WSGI-Anwendung.
* ``matching`` Kontaktvorschläge und Dublettenhinweise, regelbasiert.
* ``server``   Entwicklungsserver. Nicht für den Betrieb; siehe docs/BETRIEB.md.

Die Web-App liegt in ``web/`` und spricht ausschließlich über ``api`` mit dieser
Seite.
"""

__version__ = "0.2.0"
