#!/usr/bin/env bash
#
# Holt die Bestandteile der lokalen Texterkennung in dieses Verzeichnis.
#
# Warum nicht im Repository: die Dateien sind zusammen rund 15 MB und ändern
# sich nur mit einer neuen Fassung. Sie werden hier abgelegt und von dort
# ausgeliefert. Die Web-App lädt sie ausschließlich vom eigenen Server; es gibt
# keine Abfrage bei Dritten zur Laufzeit.
#
#   ./web/vendor/hole-tesseract.sh
#
# Voraussetzung: npm und tar. Die Fassungen sind festgeschrieben; eine Änderung
# ist eine bewusste Entscheidung und gehört in docs/ENTSCHEIDUNGEN.md.

set -euo pipefail

TESSERACT_VERSION="7.0.0"
CORE_VERSION="7.0.0"
SPRACHE="deu"
TESSDATA_URL="https://tessdata.projectnaptha.com/4.0.0"

ZIEL="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/tesseract"
ARBEIT="$(mktemp -d)"
trap 'rm -rf "$ARBEIT"' EXIT

echo "Zielverzeichnis: $ZIEL"
mkdir -p "$ZIEL/core" "$ZIEL/lang"

echo "1/3  tesseract.js@${TESSERACT_VERSION} und tesseract.js-core@${CORE_VERSION} laden …"
(
  cd "$ARBEIT"
  npm pack --silent "tesseract.js@${TESSERACT_VERSION}" "tesseract.js-core@${CORE_VERSION}" >/dev/null
  mkdir -p js core
  tar xzf "tesseract.js-${TESSERACT_VERSION}.tgz" -C js --strip-components=1
  tar xzf "tesseract.js-core-${CORE_VERSION}.tgz" -C core --strip-components=1
)

echo "2/3  Dateien übernehmen …"
cp "$ARBEIT/js/dist/tesseract.min.js" "$ZIEL/tesseract.min.js"
cp "$ARBEIT/js/dist/worker.min.js" "$ZIEL/worker.min.js"
# Es wird ausschließlich mit OEM 1 (nur LSTM) gearbeitet. Tesseract wählt zur
# Laufzeit je nach Gerät zwischen entspanntem SIMD, gewöhnlichem SIMD und ohne;
# deshalb müssen alle drei Ausführungen bereitliegen.
for variante in relaxedsimd-lstm simd-lstm lstm; do
  cp "$ARBEIT/core/tesseract-core-${variante}.wasm.js" "$ZIEL/core/"
done
cp "$ARBEIT/js/LICENSE" "$ZIEL/LIZENZ-tesseract.js.txt" 2>/dev/null || true
cp "$ARBEIT/core/LICENSE" "$ZIEL/LIZENZ-tesseract-core.txt" 2>/dev/null || true

echo "3/3  Sprachdaten ${SPRACHE} laden …"
curl -fsSL "${TESSDATA_URL}/${SPRACHE}.traineddata.gz" -o "$ZIEL/lang/${SPRACHE}.traineddata.gz"

cat > "$ZIEL/FASSUNGEN.txt" <<EOF
tesseract.js      ${TESSERACT_VERSION}
tesseract.js-core ${CORE_VERSION}
Sprachdaten       ${SPRACHE} von ${TESSDATA_URL}
Geholt am         $(date -u +"%Y-%m-%d %H:%M UTC")
EOF

echo
echo "Fertig. Umfang:"
du -sh "$ZIEL"
echo "Die Web-App erkennt die Texterkennung beim nächsten Start selbsttätig."
