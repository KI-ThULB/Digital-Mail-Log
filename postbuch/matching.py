"""Vorschläge für Kontakte aus erkanntem oder getipptem Text.

Bewusst ohne generative KI: die Zuordnung soll erklärbar und wiederholbar sein.
Alle Vorschläge sind Vorschläge; übernommen wird nur, was bestätigt wurde.
"""

from __future__ import annotations

from .domain import Contact, normalise

__all__ = ["score", "suggest", "duplicate_groups"]


def _tokens(text: str) -> list[str]:
    return [t for t in normalise(text).split() if t]


def score(query: str, contact: Contact) -> float:
    """Ähnlichkeit zwischen 0 und 1.

    Bewertet wird, wie viel des Suchtexts in einer der Schreibweisen des
    Kontakts wiederzufinden ist. Volltreffer einer Schreibweise zählen am
    stärksten, damit „FSU Jena“ den Kontakt mit diesem Alias sicher findet.
    """
    needle = normalise(query)
    if not needle:
        return 0.0
    words = needle.split()
    best = 0.0
    for key in contact.keys():
        if not key:
            continue
        if key == needle:
            return 1.0
        key_words = set(key.split())
        hits = sum(1 for w in words if w in key_words)
        partial = sum(0.5 for w in words if w not in key_words and w in key)
        value = (hits + partial) / len(words)
        if needle in key or key in needle:
            value = max(value, 0.85)
        best = max(best, min(value, 0.95))
    return best


def suggest(query: str, contacts, *, limit: int = 5, threshold: float = 0.45):
    """Die plausibelsten Kontakte zu einem Text, beste zuerst."""
    scored = []
    for contact in contacts:
        if contact.merged_into:
            continue
        value = score(query, contact)
        if value >= threshold:
            scored.append((value, contact))
    scored.sort(key=lambda pair: (-pair[0], pair[1].label))
    return [(round(value, 3), contact) for value, contact in scored[:limit]]


def duplicate_groups(contacts, *, threshold: float = 0.9):
    """Gruppen mutmaßlicher Dubletten für die Prüfung durch Berechtigte.

    Es wird nichts automatisch zusammengeführt. Die Entscheidung trifft eine
    Person, weil eine falsche Zusammenführung den Adressstand vergangener
    Sendungen nicht rückgängig macht, wohl aber künftige verfälscht.
    """
    items = [c for c in contacts if not c.merged_into]
    seen: set[str] = set()
    groups = []
    for index, contact in enumerate(items):
        if contact.id in seen:
            continue
        group = [contact]
        for other in items[index + 1 :]:
            if other.id in seen:
                continue
            if max(score(other.label, contact), score(contact.label, other)) >= threshold:
                group.append(other)
                seen.add(other.id)
        if len(group) > 1:
            seen.add(contact.id)
            groups.append(tuple(group))
    return groups
