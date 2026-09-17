/**
 * Texterkennung auf dem Gerät.
 *
 * Der Anschluss ist austauschbar: eine Erkennung ist ein Objekt mit ``name``,
 * ``version``, ``available()`` und ``recognise(blob)``. Wird die App später
 * doch nativ gebaut, tritt an dieser Stelle ML Kit beziehungsweise Apple Vision
 * an die Stelle von Tesseract, ohne dass die Oberfläche sich ändert.
 *
 * Zwei Festlegungen, die nicht verhandelbar sind:
 *
 * 1. **Kein Rückfall in die Cloud.** Steht keine lokale Erkennung bereit, bleibt
 *    die Erkennung aus und die Eingabe erfolgt von Hand. Es wird niemals ein
 *    Bild an einen fremden Dienst geschickt.
 * 2. **Erkanntes ist ein Vorschlag.** Jedes Ergebnis führt Quelle und
 *    Modellfassung mit, damit im Nachhinein unterscheidbar bleibt, was erkannt
 *    und was bestätigt wurde.
 */

// Absolute Adressen: die Bestandteile werden in einem Web Worker geladen, in dem
// relative Pfade sich gegen das Worker-Skript auflösen und nicht gegen die Seite.
const VENDOR = new URL('../vendor/tesseract/', import.meta.url).href;

/** Verkleinert und entsättigt das Bild. Das beschleunigt die Erkennung deutlich. */
export async function prepareImage(blob, { maxEdge = 1600, contrast = 1.25 } = {}) {
  const bitmap = await createImageBitmap(blob);
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas =
    typeof OffscreenCanvas === 'function'
      ? new OffscreenCanvas(width, height)
      : Object.assign(document.createElement('canvas'), { width, height });
  const context = canvas.getContext('2d', { willReadFrequently: true });
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close?.();

  const image = context.getImageData(0, 0, width, height);
  const pixels = image.data;
  for (let i = 0; i < pixels.length; i += 4) {
    const grey = 0.299 * pixels[i] + 0.587 * pixels[i + 1] + 0.114 * pixels[i + 2];
    const adjusted = Math.max(0, Math.min(255, (grey - 128) * contrast + 128));
    pixels[i] = adjusted;
    pixels[i + 1] = adjusted;
    pixels[i + 2] = adjusted;
  }
  context.putImageData(image, 0, 0);

  if (canvas.convertToBlob) return canvas.convertToBlob({ type: 'image/png' });
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
}

/** Texterkennung des Betriebssystems, sofern der Browser sie anbietet. */
const platformOcr = {
  name: 'Plattform-Texterkennung',
  version: 'Browser',
  local: true,
  async available() {
    return typeof window !== 'undefined' && typeof window.TextDetector === 'function';
  },
  async recognise(blob) {
    const started = performance.now();
    const detector = new window.TextDetector();
    const bitmap = await createImageBitmap(blob);
    const blocks = await detector.detect(bitmap);
    bitmap.close?.();
    const lines = blocks
      .slice()
      .sort((a, b) => a.boundingBox.top - b.boundingBox.top)
      .map((block) => block.rawValue.trim())
      .filter(Boolean);
    return {
      text: lines.join('\n'),
      source: this.name,
      model: this.version,
      durationMs: Math.round(performance.now() - started),
      confidence: lines.length ? 0.8 : 0,
    };
  },
};

/** Tesseract als WebAssembly, vollständig aus dem eigenen Webverzeichnis geladen. */
const tesseractOcr = {
  name: 'Tesseract',
  version: 'deu (lokal)',
  local: true,
  _worker: null,
  _checked: null,

  async available() {
    if (this._checked !== null) return this._checked;
    try {
      // Die Fassungsdatei ist klein und sagt zugleich, welche Fassung installiert
      // ist. Das gehört in jede Meldung über ein Erkennungsergebnis.
      const response = await fetch(`${VENDOR}FASSUNGEN.txt`, { cache: 'no-cache' });
      if (response.ok) {
        const text = await response.text();
        const match = text.match(/tesseract\.js\s+(\S+)/);
        if (match) this.version = `deu · tesseract.js ${match[1]}`;
      }
      this._checked = response.ok;
    } catch {
      this._checked = false;
    }
    return this._checked;
  },

  async _load() {
    if (this._worker) return this._worker;
    if (!window.Tesseract) {
      await new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = `${VENDOR}tesseract.min.js`;
        script.onload = resolve;
        script.onerror = () => reject(new Error('Tesseract konnte nicht geladen werden.'));
        document.head.append(script);
      });
    }
    this._worker = await window.Tesseract.createWorker('deu', 1, {
      workerPath: `${VENDOR}worker.min.js`,
      corePath: `${VENDOR}core`,
      langPath: `${VENDOR}lang`,
      // Keine Fernabfrage: alle Bestandteile stammen aus dem eigenen Verzeichnis.
      workerBlobURL: false,
      gzip: true,
    });
    return this._worker;
  },

  async recognise(blob) {
    const started = performance.now();
    const worker = await this._load();
    const { data } = await worker.recognize(blob);
    return {
      text: (data.text || '').trim(),
      source: this.name,
      model: this.version,
      durationMs: Math.round(performance.now() - started),
      confidence: typeof data.confidence === 'number' ? data.confidence / 100 : 0,
    };
  },

  async release() {
    if (this._worker) {
      await this._worker.terminate();
      this._worker = null;
    }
  },
};

const ADAPTERS = [platformOcr, tesseractOcr];

/** Liefert die erste einsatzbereite Erkennung oder ``null``. */
export async function chooseEngine() {
  for (const adapter of ADAPTERS) {
    // eslint-disable-next-line no-await-in-loop
    if (await adapter.available()) return adapter;
  }
  return null;
}

export async function engineStatus() {
  const entries = [];
  for (const adapter of ADAPTERS) {
    // Erst prüfen, dann lesen: die Prüfung stellt die tatsächlich installierte
    // Fassung fest, die in jeder Meldung über ein Ergebnis auftauchen soll.
    // eslint-disable-next-line no-await-in-loop
    const available = await adapter.available();
    entries.push({ name: adapter.name, version: adapter.version, available });
  }
  return entries;
}

/**
 * Erkennt Text in einem Bild.
 *
 * @returns {Promise<{text:string,source:string,model:string,durationMs:number,
 *                    confidence:number}|null>} ``null``, wenn keine lokale
 *          Erkennung bereitsteht. Dann bleibt nur die Eingabe von Hand – das ist
 *          ein gültiger Zustand, kein Fehler.
 */
export async function recogniseText(blob, options = {}) {
  const engine = options.engine || (await chooseEngine());
  if (!engine) return null;
  const prepared = options.raw ? blob : await prepareImage(blob, options);
  return engine.recognise(prepared);
}

export const engines = { platformOcr, tesseractOcr };
