#!/usr/bin/env python3
"""Erzeugt die Postleitzahl-Ort-Tabelle für die Plausibilitätsprüfung.

    python3 werkzeuge/plz-tabelle.py

Quelle: GeoNames, Datei ``DE.zip`` aus dem Postleitzahl-Export, veröffentlicht
unter **CC BY 4.0**. Die Namensnennung steht in ``web/daten/LIZENZ-plz.txt`` und
muss dort bleiben.

Warum überhaupt eine eigene Tabelle: die Prüfung läuft auf dem Gerät. Eine
Abfrage bei einem Kartendienst würde die Anschriften echter Post aus dem Haus
tragen – das verbietet sich für eine Poststelle, und die Nutzungsbedingungen des
öffentlichen Nominatim-Dienstes untersagen systematische Abfragen ausdrücklich.

Aussortiert werden Großempfänger-Postleitzahlen: dort steht im Datensatz statt
eines Ortes der Name einer Firma. Lieber keine Angabe als eine falsche – eine
Prüfung, die „Musterbank AG“ als Ort vorschlägt, wäre schlimmer als gar keine.

Vollständig gelingt das Aussortieren nicht; einzelne Dienststellen bleiben in der
Tabelle. Die Oberfläche fängt das ab, indem sie einen Ort nur dann vorschlägt,
wenn das Erkannte ein Anfang des Tabellennamens ist („WE“ → „Weimar“) oder gar
kein Ort gelesen wurde. Ein richtig gelesener Ort wird nie überschrieben.
"""

from __future__ import annotations

import io
import re
import sys
import urllib.request
import zipfile
from collections import Counter, defaultdict
from pathlib import Path

QUELLE = "https://download.geonames.org/export/zip/DE.zip"
ZIEL = Path(__file__).resolve().parent.parent / "web" / "daten" / "plz-orte.txt"

# Zeilen, in denen statt eines Ortes ein Unternehmen steht (Großempfänger).
# Wörter, die eine Einrichtung benennen und nie allein einen Ort. Sie stehen im
# Datensatz bei Großempfänger-Postleitzahlen anstelle des Ortes.
EINRICHTUNG = (
    r"GmbH|mbH|AG|KG|SE|OHG|KGaA|e\.\s?V\.|Co\.|AöR|GbR|Corporate|Holding|Audit|"
    r"Zentrale|Zentralstelle|Postfach|Gro(?:ß|ss)kunden|Sparkasse|Finanzamt|Landesamt|"
    r"Bundesamt|Rundfunk|Lotto|Direktion|Hauptverwaltung|Vertrieb|Kundenservice|"
    r"Agentur|Amtsgericht|Landgericht|Landratsamt|Krankenhaus|Klinik|Klinikum|"
    r"Universit(?:ä|ae)t|Hochschule|Staatskanzlei|Ministerium|Beh(?:ö|oe)rde|Kammer|Kasse|"
    r"Rentenversicherung|Zollamt|Polizei|Jobcenter|Studentenwerk|Stiftung|Verlag|"
    r"Druckerei|Redaktion|Zeitung|Stadtwerke|Werke|Institut|Akademie|Museum|Archiv"
)
FIRMA = re.compile(
    rf"\b(?:{EINRICHTUNG})\b|\w*Bank\b|\sfür\s|Vermögensverwaltung|Versicherung|gesellschaft",
    re.IGNORECASE,
)
# Form eines Ortsnamens: beginnt groß, keine Ziffern, keine Klammern, kein
# Gedankenstrich (der trennt in diesem Datensatz Dienststellen: „… - Nord“).
ORT = re.compile(r"^[A-ZÄÖÜ][A-Za-zÄÖÜäöüßéèçñ' .\-/]{1,38}$")


def hole(quelle: str = QUELLE) -> str:
    with urllib.request.urlopen(quelle, timeout=120) as antwort:
        paket = zipfile.ZipFile(io.BytesIO(antwort.read()))
    return paket.read("DE.txt").decode("utf-8")


def tabelle(rohtext: str) -> dict[str, list[str]]:
    namen: dict[str, Counter] = defaultdict(Counter)
    for zeile in rohtext.splitlines():
        felder = zeile.split("\t")
        if len(felder) < 3:
            continue
        plz, ort = felder[1].strip(), felder[2].strip()
        if not re.fullmatch(r"\d{5}", plz) or not ort:
            continue
        if FIRMA.search(ort) or not ORT.match(ort) or " - " in ort:
            continue
        namen[plz][ort] += 1

    fertig: dict[str, list[str]] = {}
    for plz, zaehler in namen.items():
        sortiert = [name for name, _ in sorted(zaehler.items(), key=lambda e: (-e[1], len(e[0]), e[0]))]
        haupt = sortiert[0]
        # Stadtteile wie „Dresden Innere Altstadt“ tragen nichts bei: der
        # Vergleich prüft ohnehin auf den Anfang des Namens.
        weitere = [n for n in sortiert[1:] if not n.startswith(haupt)]
        fertig[plz] = [haupt, *weitere[:2]]
    return fertig


def schreibe(daten: dict[str, list[str]], ziel: Path = ZIEL) -> int:
    zeilen = [f"{plz}\t{'|'.join(namen)}" for plz, namen in sorted(daten.items())]
    kopf = (
        "# Postleitzahl -> Ort, für die Plausibilitätsprüfung auf dem Gerät.\n"
        "# Quelle: GeoNames (CC BY 4.0), siehe LIZENZ-plz.txt.\n"
        "# Erzeugt mit werkzeuge/plz-tabelle.py – nicht von Hand ändern.\n"
    )
    ziel.write_text(kopf + "\n".join(zeilen) + "\n", encoding="utf-8")
    return len(zeilen)


def main() -> int:
    daten = tabelle(hole())
    anzahl = schreibe(daten)
    print(f"{anzahl} Postleitzahlen nach {ZIEL} geschrieben ({ZIEL.stat().st_size // 1024} KB).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
