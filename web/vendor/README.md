# Lokale Texterkennung einrichten

Die Web-App erkennt Adressen **auf dem Gerät**. Weder Bild noch erkannter Text
verlassen den Browser. Dafür müssen die Bestandteile der Erkennung einmalig in
dieses Verzeichnis geholt und anschließend vom eigenen Webserver ausgeliefert
werden.

```sh
./web/vendor/hole-tesseract.sh
```

Danach liegt hier:

```
vendor/tesseract/
  tesseract.min.js                      62 KB   Steuerung im Hauptfenster
  worker.min.js                        111 KB   Arbeitsprozess
  core/tesseract-core-simd-lstm.wasm.js  3,8 MB Erkennung mit SIMD
  core/tesseract-core-lstm.wasm.js       3,8 MB Erkennung ohne SIMD
  lang/deu.traineddata.gz                6,8 MB deutsches Sprachmodell
  FASSUNGEN.txt                                 Herkunft und Datum
```

Zusammen rund 15 MB. Der Service Worker hält diese Dateien dauerhaft vor; ein
Gerät lädt sie genau einmal und arbeitet danach auch ohne Netz.

## Warum diese Dateien nicht im Repository liegen

Sie sind groß, unveränderlich und stammen von außen. Im Repository würden sie
jede Historie aufblähen und bei jeder Prüfung mitgelesen. Das Skript holt
festgeschriebene Fassungen; eine Aktualisierung ist damit eine bewusste,
nachvollziehbare Entscheidung.

## Ohne diesen Schritt

Die App läuft vollständig, nur die Kamera-Erkennung bleibt aus. Sie meldet das
deutlich und alle Felder werden von Hand ausgefüllt. **Es gibt keinen Rückfall
auf einen Erkennungsdienst im Netz** – weder heimlich noch auf Nachfrage.

## Andere Erkennung einsetzen

`web/js/ocr.js` beschreibt die Schnittstelle. Eine Erkennung ist ein Objekt mit
`name`, `version`, `available()` und `recognise(blob)`. Wird die App später doch
nativ gebaut, treten ML Kit auf Android und Apple Vision auf iOS an diese
Stelle, ohne dass die Oberfläche sich ändert.

## Lizenzen

Tesseract und tesseract.js stehen unter der Apache-Lizenz 2.0, die Sprachdaten
ebenfalls. Die Lizenztexte werden vom Skript mit abgelegt.
