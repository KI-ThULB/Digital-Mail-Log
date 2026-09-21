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

/**
 * Lädt ein Bild und berücksichtigt dabei die Drehung aus den EXIF-Angaben.
 *
 * Telefone speichern das Bild so, wie der Sensor es liest, und legen die Drehung
 * daneben. ``createImageBitmap`` folgt dieser Angabe nicht überall; ein
 * ``<img>``-Element tut es zuverlässig. Ein um 90° gedrehtes Bild ist für die
 * Texterkennung praktisch unlesbar, deshalb steht das hier vor allem anderen.
 */
export async function ladeBild(blob) {
  const url = URL.createObjectURL(blob);
  try {
    const bild = new Image();
    bild.src = url;
    if (bild.decode) await bild.decode();
    else {
      await new Promise((resolve, reject) => {
        bild.onload = resolve;
        bild.onerror = () => reject(new Error('Das Bild konnte nicht geladen werden.'));
      });
    }
    return bild;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Die vier Leserichtungen, in denen eine Anschrift auf einem Bild stehen kann. */
export const DREHUNGEN = [0, 90, 180, 270];

/**
 * Dreht ein Bild um ein Vielfaches von 90° und gibt eine Zeichenfläche zurück.
 *
 * Nötig, weil ein Umschlag quer auf dem Tisch liegt oder quer fotografiert wird.
 * Die Texterkennung liest nur waagerechte Zeilen; steht die Anschrift hochkant,
 * deutet sie die Zeichen einzeln und liefert Unsinn. Kein Nachbearbeiten hilft
 * dagegen – das Bild muss vorher stehen.
 */
export function dreheBild(bild, grad) {
  const breite = bild.naturalWidth || bild.width;
  const hoehe = bild.naturalHeight || bild.height;
  const quer = ((((grad % 360) + 360) % 360) % 180) !== 0;
  const leinwand = document.createElement('canvas');
  leinwand.width = quer ? hoehe : breite;
  leinwand.height = quer ? breite : hoehe;
  const stift = leinwand.getContext('2d');
  stift.translate(leinwand.width / 2, leinwand.height / 2);
  stift.rotate((grad * Math.PI) / 180);
  stift.drawImage(bild, -breite / 2, -hoehe / 2);
  return leinwand;
}

/**
 * Verkleinert und entsättigt das Bild. Das beschleunigt die Erkennung deutlich.
 *
 * @param options.rotate Drehung in Grad (0, 90, 180, 270), vor dem Ausschnitt
 *        angewandt. Der Ausschnitt gilt also im gedrehten Bild – so, wie die
 *        erfassende Person es auf dem Bildschirm sieht und markiert hat.
 * @param options.crop Ausschnitt in Anteilen des Bildes (0…1), also unabhängig
 *        von der Auflösung: ``{x, y, w, h}``. Gemessen an einem Paketetikett
 *        brachte der Ausschnitt mehr als jede andere Maßnahme: 28 % Zuversicht
 *        in 4,1 s für das ganze Etikett, 62 % in 0,5 s für den Adressblock.
 */
export async function prepareImage(
  blob,
  { maxEdge = 1600, contrast = 1.25, crop = null, rotate = 0, nachdrehen = 0 } = {},
) {
  const geladen = await ladeBild(blob);
  const quelle = rotate % 360 === 0 ? geladen : dreheBild(geladen, rotate);
  const ganz = { breite: quelle.naturalWidth || quelle.width, hoehe: quelle.naturalHeight || quelle.height };
  const bereich = crop
    ? {
        x: Math.max(0, Math.round(crop.x * ganz.breite)),
        y: Math.max(0, Math.round(crop.y * ganz.hoehe)),
        breite: Math.max(1, Math.round(crop.w * ganz.breite)),
        hoehe: Math.max(1, Math.round(crop.h * ganz.hoehe)),
      }
    : { x: 0, y: 0, breite: ganz.breite, hoehe: ganz.hoehe };

  const scale = Math.min(1, maxEdge / Math.max(bereich.breite, bereich.hoehe));
  const width = Math.max(1, Math.round(bereich.breite * scale));
  const height = Math.max(1, Math.round(bereich.hoehe * scale));
  const ausschnitt = Object.assign(document.createElement('canvas'), { width, height });
  ausschnitt
    .getContext('2d')
    .drawImage(quelle, bereich.x, bereich.y, bereich.breite, bereich.hoehe, 0, 0, width, height);

  // Erst schneiden, dann suchen: die Suchdrehung wird auf den **Ausschnitt**
  // angewandt, nicht auf das ganze Bild. Andernfalls verschöbe jede Drehung den
  // markierten Bereich auf eine ganz andere Stelle der Sendung – ein Fehler, der
  // sich nur am echten Foto zeigte: gelesen wurde mit 84 % Zuversicht, aber der
  // halbe Adressblock fehlte.
  const canvas = nachdrehen % 360 === 0 ? ausschnitt : dreheBild(ausschnitt, nachdrehen);
  const context = canvas.getContext('2d', { willReadFrequently: true });

  const image = context.getImageData(0, 0, canvas.width, canvas.height);
  const pixels = image.data;
  for (let i = 0; i < pixels.length; i += 4) {
    const grey = 0.299 * pixels[i] + 0.587 * pixels[i + 1] + 0.114 * pixels[i + 2];
    const adjusted = Math.max(0, Math.min(255, (grey - 128) * contrast + 128));
    pixels[i] = adjusted;
    pixels[i + 1] = adjusted;
    pixels[i + 2] = adjusted;
  }
  context.putImageData(image, 0, 0);

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
