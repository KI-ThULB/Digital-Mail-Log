#!/usr/bin/env python3
"""Erzeugt die druckfertigen Pilotunterlagen im A4-Format.

    pip install playwright markdown && playwright install chromium
    python3 docs/pilot/druck/erzeuge-pdf.py

Warum über den Browser und nicht über eine PDF-Bibliothek: die Unterlagen sind
Satz, kein Programm. In HTML und CSS lässt sich die Gestaltung von jeder Person
ändern, die eine Webseite anpassen kann — bei koordinatenweise gesetztem PDF
könnte das nur, wer die Bibliothek kennt. Die Textquelle der Handreichung bleibt
dabei die Markdown-Datei; sie wird nicht doppelt gepflegt.
"""

from __future__ import annotations

import sys
from pathlib import Path

HIER = Path(__file__).resolve().parent
PILOT = HIER.parent

# Welche Unterlage aus welcher Quelle entsteht.
AUS_MARKDOWN = [
    (PILOT / "HANDREICHUNG-POSTSTELLE.md", PILOT / "HANDREICHUNG-POSTSTELLE.pdf"),
]
AUS_HTML = [
    (HIER / "erhebungsbogen.html", PILOT / "ERHEBUNGSBOGEN.pdf"),
]

RAHMEN = """<!doctype html>
<html lang="de"><head><meta charset="utf-8"><title>{titel}</title>
<link rel="stylesheet" href="druckstil.css"></head><body>{inhalt}</body></html>
"""


def markdown_zu_html(quelle: Path) -> str:
    import markdown

    text = quelle.read_text("utf-8")
    inhalt = markdown.markdown(text, extensions=["tables", "sane_lists", "attr_list"])
    titel = text.lstrip().splitlines()[0].lstrip("# ").strip()
    return RAHMEN.format(titel=titel, inhalt=inhalt)


def main() -> int:
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        print("Playwright fehlt:  pip install playwright && playwright install chromium")
        return 1

    aufgaben: list[tuple[Path, Path]] = []
    zwischen: list[Path] = []

    for quelle, ziel in AUS_MARKDOWN:
        temporaer = HIER / f".{quelle.stem}.html"
        temporaer.write_text(markdown_zu_html(quelle), "utf-8")
        zwischen.append(temporaer)
        aufgaben.append((temporaer, ziel))
    aufgaben.extend(AUS_HTML)

    with sync_playwright() as pw:
        browser = pw.chromium.launch()
        seite = browser.new_page()
        for quelle, ziel in aufgaben:
            seite.goto(quelle.as_uri())
            seite.wait_for_load_state("networkidle")
            seite.emulate_media(media="print")
            seite.pdf(
                path=str(ziel),
                format="A4",
                print_background=True,
                prefer_css_page_size=True,
            )
            print(f"{ziel.relative_to(PILOT.parent.parent)}  ({ziel.stat().st_size // 1024} KB)")
        browser.close()

    for datei in zwischen:
        datei.unlink(missing_ok=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
