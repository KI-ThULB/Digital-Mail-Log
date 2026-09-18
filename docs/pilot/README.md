# Unterlagen für den Pilotbetrieb

Drei Papiere für die Testwoche in der Poststelle und die Einrichtung durch die
IT. Sie liegen hier, weil sie sich auf den Stand beziehen, der im selben
Repository liegt — Änderungen an der App und an den Unterlagen bleiben so
beieinander.

| Datei | Für wen | Zweck |
|---|---|---|
| [`MESSPROTOKOLL.md`](MESSPROTOKOLL.md) | Projektleitung | Messgrößen, Stichprobe und die **Entscheidungsregel, die vor dem Test feststeht** |
| [`ERHEBUNGSBOGEN.pdf`](ERHEBUNGSBOGEN.pdf) | Poststelle | Ein Blatt für 20 Sendungen, zum Ausdrucken und Mitführen |
| [`HANDREICHUNG-POSTSTELLE.md`](HANDREICHUNG-POSTSTELLE.md) · [PDF](HANDREICHUNG-POSTSTELLE.pdf) | Poststelle | Zwei Seiten: einrichten, erfassen, berichtigen, Grenzen |
| [`KURZPAPIER-IT.md`](KURZPAPIER-IT.md) | Rechenzentrum | Eine Seite zum Weiterleiten: Voraussetzungen, Anmeldung, Sicherung |

## Druckfassungen erneuern

Textquelle der Handreichung ist die Markdown-Datei, nicht das PDF. Nach einer
Änderung:

```sh
pip install playwright markdown && playwright install chromium
python3 docs/pilot/druck/erzeuge-pdf.py
```

Der Erhebungsbogen hat seine eigene Quelle in `druck/erhebungsbogen.html`; die
Zeilenzahl steht dort an einer einzigen Stelle. Gestaltung für beide:
`druck/druckstil.css`.

## Vor dem Start

Die Handreichung hat zwei Lücken, die noch zu füllen sind: **Ansprechpartner**
und **Erreichbarkeit**. Ohne beides landet jede Störung bei niemandem.
