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

/* ------------------------------------------------------------------ *
 * Kleine und schiefe Schrift im markierten Bereich
 *
 * Anlass war die einzeilige Absenderangabe auf Briefen. Sie ist die kleinste
 * Schrift auf dem Umschlag, meist unterstrichen, und ein von Hand gehaltenes
 * Foto steht nie ganz gerade. Gemessen an erzeugten Briefen in der Auflösung
 * einer angeschlossenen Kamera:
 *
 * - Bei sieben bis elf Pixeln Schrifthöhe las die Erkennung Ziffern falsch
 *   („98423“ statt „99423“) oder gar nichts, bei rund dreißig Pixeln dieselbe
 *   Zeile richtig.
 * - Schon bei anderthalb Grad Schräglage las sie die unterstrichene Zeile
 *   doppelt, weil sie die Unterstreichung für eine zweite Zeile hielt, oder
 *   sie lieferte nach dem Vergrößern nichts mehr.
 *
 * Deshalb wird ein markierter Bereich erst gerade gestellt, von Linien befreit
 * und dann, wenn die Schrift klein ist, vergrößert. Beides gilt nur für markierte Bereiche:
 * Im ganzen Bild stehen Schriften aller Größen und Richtungen nebeneinander,
 * und eine Messung über alles sagt dort wenig.
 * ------------------------------------------------------------------ */

/** Schrifthöhe in Pixeln, bei der die Erkennung am sichersten liest. */
const ZIELHOEHE = 30;
/** Darunter wird ein markierter Bereich vergrößert. */
const KLEINE_SCHRIFT = 20;
/** Mehr als das Vierfache erfindet nur Unschärfe. */
const HOECHSTE_VERGROESSERUNG = 4;
/** Bis zu dieser Schräglage wird gesucht. Mehr ist eine Frage der Drehung. */
const HOECHSTE_SCHRAEGLAGE = 6;

/**
 * Trennt Schrift von Papier in einem entsättigten Bild.
 *
 * @param pixels RGBA-Werte, Rot gleich Grün gleich Blau.
 * @returns {{schwelle:number, papier:number}|null} ``null``, wenn sich keine
 *          Schrift vom Papier abhebt.
 */
function trenneSchrift(pixels) {
  const haeufigkeit = new Uint32Array(256);
  for (let i = 0; i < pixels.length; i += 4) haeufigkeit[pixels[i]] += 1;
  const anteil = (quote) => {
    let summe = 0;
    const grenze = (pixels.length / 4) * quote;
    for (let wert = 0; wert < 256; wert += 1) {
      summe += haeufigkeit[wert];
      if (summe >= grenze) return wert;
    }
    return 255;
  };
  const dunkel = anteil(0.02);
  const papier = anteil(0.9);
  if (papier - dunkel < 40) return null;
  return { schwelle: (dunkel + papier) / 2, papier };
}

/**
 * Schätzt die Höhe einer Textzeile in einem entsättigten, gerade stehenden Bild.
 *
 * Gezählt wird, in welchen Bildzeilen Schrift steht: dunkle Punkte, aber
 * nicht über die ganze Breite, denn das wäre eine Linie oder ein Rand.
 * Zusammenhängende Bildzeilen mit Schrift ergeben je eine Textzeile, der
 * Median ihrer Höhen ist das Ergebnis.
 *
 * @returns {number} Höhe in Pixeln, 0 wenn sich keine Schrift abzeichnet.
 */
export function schaetzeZeilenhoehe(pixels, breite, hoehe) {
  const schrift = trenneSchrift(pixels);
  if (!schrift) return 0;
  const laeufe = [];
  let beginn = -1;
  for (let y = 0; y <= hoehe; y += 1) {
    let tinte = 0;
    if (y < hoehe) {
      for (let x = 0; x < breite; x += 1) {
        if (pixels[(y * breite + x) * 4] < schrift.schwelle) tinte += 1;
      }
    }
    const beschrieben = tinte >= Math.max(2, breite * 0.01) && tinte <= breite * 0.6;
    if (beschrieben && beginn === -1) beginn = y;
    if (!beschrieben && beginn !== -1) {
      if (y - beginn >= 3) laeufe.push(y - beginn);
      beginn = -1;
    }
  }
  if (!laeufe.length) return 0;
  laeufe.sort((a, b) => a - b);
  return laeufe[Math.floor(laeufe.length / 2)];
}

/**
 * Schätzt, um wie viel Grad die Zeilen eines Bildes schief stehen.
 *
 * Stehen die Zeilen gerade, fällt die Schrift auf wenige Bildzeilen und
 * dazwischen bleibt es leer. Für jeden Probewinkel wird deshalb gezählt, wie
 * ungleich sich die dunklen Punkte auf die Bildzeilen verteilen. Der Winkel
 * mit der größten Ungleichheit ist die Schräglage.
 *
 * @returns {number} Winkel in Grad, positiv, wenn die Zeile nach rechts
 *          abfällt. 0, wenn nichts zu messen ist oder das Bild gerade steht.
 */
export function schaetzeSchraeglage(pixels, breite, hoehe) {
  const schrift = trenneSchrift(pixels);
  if (!schrift) return 0;
  // Für die Schätzung genügt eine Stichprobe der dunklen Punkte.
  const schritt = Math.max(1, Math.floor(Math.sqrt((breite * hoehe) / 400000)));
  const xs = [];
  const ys = [];
  for (let y = 0; y < hoehe; y += schritt) {
    for (let x = 0; x < breite; x += schritt) {
      if (pixels[(y * breite + x) * 4] < schrift.schwelle) {
        xs.push(x);
        ys.push(y);
      }
    }
  }
  if (xs.length < 50) return 0;

  const faecher = new Float64Array(Math.ceil((hoehe + breite) / schritt) + 2);
  const versatz = breite;
  const ungleichheit = (grad) => {
    const steigung = Math.tan((grad * Math.PI) / 180);
    faecher.fill(0);
    for (let i = 0; i < xs.length; i += 1) {
      faecher[Math.round((ys[i] - xs[i] * steigung + versatz * Math.abs(steigung)) / schritt)] += 1;
    }
    let summe = 0;
    for (let i = 0; i < faecher.length; i += 1) summe += faecher[i] * faecher[i];
    return summe;
  };

  const gerade = ungleichheit(0);
  let bester = 0;
  let wert = gerade;
  const suche = (von, bis, weite) => {
    for (let grad = von; grad <= bis + 1e-9; grad += weite) {
      const probe = ungleichheit(grad);
      if (probe > wert) {
        wert = probe;
        bester = grad;
      }
    }
  };
  suche(-HOECHSTE_SCHRAEGLAGE, HOECHSTE_SCHRAEGLAGE, 0.5);
  suche(bester - 0.4, bester + 0.4, 0.1);
  // Ein knapper Vorsprung ist Zufall. Dann bleibt das Bild, wie es ist.
  if (wert < gerade * 1.05 || Math.abs(bester) < 0.3) return 0;
  return Math.round(bester * 10) / 10;
}

/** Zeichnet eine Fläche gerade gestellt und vergrößert neu, auf Papiergrund. */
function richteAus(flaeche, schraeglage, faktor, papier) {
  const ziel = Object.assign(document.createElement('canvas'), {
    width: Math.max(1, Math.round(flaeche.width * faktor)),
    height: Math.max(1, Math.round(flaeche.height * faktor)),
  });
  const stift = ziel.getContext('2d', { willReadFrequently: true });
  // Die Ecken, die beim Drehen frei werden, bekommen die Farbe des Papiers.
  // Schwarze Keile läse die Erkennung als Zeichen.
  stift.fillStyle = `rgb(${papier},${papier},${papier})`;
  stift.fillRect(0, 0, ziel.width, ziel.height);
  stift.imageSmoothingQuality = 'high';
  stift.translate(ziel.width / 2, ziel.height / 2);
  stift.rotate((-schraeglage * Math.PI) / 180);
  stift.scale(faktor, faktor);
  stift.drawImage(flaeche, -flaeche.width / 2, -flaeche.height / 2);
  return ziel;
}

/**
 * Übermalt Linien in einem entsättigten, gerade stehenden Bild mit Papier.
 *
 * Anlass war ein echtes Paketetikett: Die Anschrift des Empfängers steht dort
 * in einem Kasten. Lag beim großzügigen Markieren die untere und die rechte
 * Kastenlinie mit im Rechteck, las die Erkennung die Zeile direkt über der
 * Linie, Postleitzahl und Ort, als Buchstabensalat. Ohne die Linien las sie
 * dieselbe Zeile richtig. Dasselbe gilt für die Unterstreichung einer
 * Absenderzeile.
 *
 * Als Linie gilt ein durchgehend dunkler Lauf, der länger ist, als ein
 * Schriftzeichen breit oder hoch sein kann: waagerecht ein Fünftel der Breite
 * und mehr als die halbe Höhe, senkrecht vier Fünftel der Höhe.
 *
 * @returns {number} Anzahl der übermalten Läufe.
 */
export function entferneLinien(pixels, breite, hoehe, schrift) {
  const dunkel = (x, y) => pixels[(y * breite + x) * 4] < schrift.schwelle;
  const male = (x, y) => {
    if (x < 0 || y < 0 || x >= breite || y >= hoehe) return;
    const i = (y * breite + x) * 4;
    pixels[i] = schrift.papier;
    pixels[i + 1] = schrift.papier;
    pixels[i + 2] = schrift.papier;
  };
  // Erst suchen, dann malen: sonst zerschnitte die erste gefundene Linie die
  // Läufe der kreuzenden.
  const funde = [];
  const waagerecht = Math.max(40, breite * 0.2, hoehe * 0.6);
  if (waagerecht <= breite) {
    for (let y = 0; y < hoehe; y += 1) {
      let beginn = -1;
      for (let x = 0; x <= breite; x += 1) {
        const an = x < breite && dunkel(x, y);
        if (an && beginn === -1) beginn = x;
        if (!an && beginn !== -1) {
          if (x - beginn >= waagerecht) funde.push({ quer: true, fest: y, von: beginn, bis: x });
          beginn = -1;
        }
      }
    }
  }
  const senkrecht = Math.max(40, hoehe * 0.8);
  if (senkrecht <= hoehe) {
    for (let x = 0; x < breite; x += 1) {
      let beginn = -1;
      for (let y = 0; y <= hoehe; y += 1) {
        const an = y < hoehe && dunkel(x, y);
        if (an && beginn === -1) beginn = y;
        if (!an && beginn !== -1) {
          if (y - beginn >= senkrecht) funde.push({ quer: false, fest: x, von: beginn, bis: y });
          beginn = -1;
        }
      }
    }
  }
  // Mit einem Punkt Saum, denn der Rand einer Linie ist heller als ihr Kern.
  for (const { quer, fest, von, bis } of funde) {
    for (let lauf = von - 1; lauf <= bis; lauf += 1) {
      for (let saum = -1; saum <= 1; saum += 1) {
        if (quer) male(lauf, fest + saum);
        else male(fest + saum, lauf);
      }
    }
  }
  return funde.length;
}

/**
 * Stellt einen markierten Bereich gerade, nimmt Linien heraus und vergrößert
 * kleine Schrift. Gibt die Fläche unverändert zurück, wenn nichts zu tun ist.
 */
function bereiteBereichAuf(flaeche, maxEdge) {
  const lies = (c) => c.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, c.width, c.height);
  const pixels = lies(flaeche).data;
  const schrift = trenneSchrift(pixels);
  if (!schrift) return flaeche;

  // Gemessen wird in Leserichtung, also nach der Suchdrehung. Steht der Text
  // hochkant, findet sich keine Schräglage und nur ein einziger hoher Lauf,
  // und es geschieht nichts.
  const schraeglage = schaetzeSchraeglage(pixels, flaeche.width, flaeche.height);
  // Stets auf einer eigenen Fläche weiter, damit die Ausgangsfläche für den
  // Rückfall ohne Aufbereitung unberührt bleibt.
  const gerade = richteAus(flaeche, schraeglage, 1, schrift.papier);
  const bild = lies(gerade);
  // Erst gerade stellen, dann Linien suchen: auf einer schiefen Fläche
  // zerfällt eine Linie in viele kurze Läufe.
  if (entferneLinien(bild.data, gerade.width, gerade.height, schrift)) {
    gerade.getContext('2d').putImageData(bild, 0, 0);
  }
  const zeilenhoehe = schaetzeZeilenhoehe(bild.data, gerade.width, gerade.height);

  let faktor = 1;
  if (zeilenhoehe > 0 && zeilenhoehe < KLEINE_SCHRIFT) {
    faktor = Math.min(
      ZIELHOEHE / zeilenhoehe,
      HOECHSTE_VERGROESSERUNG,
      (maxEdge * 1.5) / Math.max(flaeche.width, flaeche.height),
    );
  }
  return faktor < 1.2 ? gerade : richteAus(gerade, 0, faktor, schrift.papier);
}

/**
 * Bereitet das Bild für die Erkennung vor: Ausschnitt, Größe, Graustufen.
 * Große Bilder werden verkleinert, das beschleunigt die Erkennung deutlich.
 *
 * @param options.rotate Drehung in Grad (0, 90, 180, 270), vor dem Ausschnitt
 *        angewandt. Der Ausschnitt gilt also im gedrehten Bild – so, wie die
 *        erfassende Person es auf dem Bildschirm sieht und markiert hat.
 * @param options.crop Ausschnitt in Anteilen des Bildes (0…1), also unabhängig
 *        von der Auflösung: ``{x, y, w, h}``. Gemessen an einem Paketetikett
 *        brachte der Ausschnitt mehr als jede andere Maßnahme: 28 % Zuversicht
 *        in 4,1 s für das ganze Etikett, 62 % in 0,5 s für den Adressblock.
 * @param options.aufbereiten Markierten Bereich gerade stellen und kleine
 *        Schrift vergrößern. Nur mit ``crop`` wirksam.
 */
export async function prepareImage(
  blob,
  { maxEdge = 1600, contrast = 1.25, crop = null, rotate = 0, nachdrehen = 0, aufbereiten = true } = {},
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

  const fertig = crop && aufbereiten ? bereiteBereichAuf(canvas, maxEdge) : canvas;
  return new Promise((resolve) => fertig.toBlob(resolve, 'image/png'));
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
  const result = await engine.recognise(prepared);
  // Das Aufbereiten darf nie schlechter sein als gar nichts: Bleibt der Text
  // danach leer, wird der Bereich noch einmal so gelesen, wie er ist.
  if (!options.raw && options.crop && options.aufbereiten !== false && !(result.text || '').trim()) {
    return engine.recognise(await prepareImage(blob, { ...options, aufbereiten: false }));
  }
  return result;
}

export const engines = { platformOcr, tesseractOcr };
