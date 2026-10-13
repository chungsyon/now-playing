/**
 * PULLING COLOURS OUT OF AN IMAGE
 * -------------------------------
 * Median cut. The idea is simple: put every pixel in one box, repeatedly split
 * the box along whichever of red, green or blue is most spread out, and when
 * there are enough boxes take the average colour of each one.
 *
 * The image is shrunk to about 64px first, so this is a few thousand pixels
 * rather than a few million, and it runs in a couple of milliseconds.
 */

const SAMPLE_SIZE = 64;

function sample(image) {
  const scale = SAMPLE_SIZE / Math.max(image.width, image.height);
  const w = Math.max(1, Math.round(image.width * scale));
  const h = Math.max(1, Math.round(image.height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(image, 0, 0, w, h);

  const { data } = ctx.getImageData(0, 0, w, h);
  const pixels = [];
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 128) continue;              // skip transparent pixels
    pixels.push([data[i], data[i + 1], data[i + 2]]);
  }
  return pixels;
}

function splitOnce(box) {
  // Which channel is most spread out in this box?
  let widest = 0;
  let spread = -1;
  for (let channel = 0; channel < 3; channel++) {
    let min = 255;
    let max = 0;
    for (const p of box) {
      if (p[channel] < min) min = p[channel];
      if (p[channel] > max) max = p[channel];
    }
    if (max - min > spread) {
      spread = max - min;
      widest = channel;
    }
  }
  const sorted = box.slice().sort((a, b) => a[widest] - b[widest]);
  const middle = sorted.length >> 1;
  return [sorted.slice(0, middle), sorted.slice(middle)];
}

function average(box) {
  let r = 0;
  let g = 0;
  let b = 0;
  for (const p of box) {
    r += p[0];
    g += p[1];
    b += p[2];
  }
  const n = box.length || 1;
  return [Math.round(r / n), Math.round(g / n), Math.round(b / n)];
}

export function toHex([r, g, b]) {
  return '#' + [r, g, b].map(v => Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0')).join('');
}

/** How light a colour looks, 0..1. Used to keep text readable on top of it. */
export function luminance([r, g, b]) {
  const channel = v => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/**
 * The main one. Returns a handful of hex colours, most common first, with
 * near-identical shades merged so you do not get five browns.
 */
export function extractPalette(image, count = 5) {
  const pixels = sample(image);
  if (pixels.length === 0) return [];

  let boxes = [pixels];
  while (boxes.length < count * 2) {
    // Always split the biggest box; that is what keeps the result balanced.
    boxes.sort((a, b) => b.length - a.length);
    const biggest = boxes.shift();
    if (!biggest || biggest.length < 2) {
      if (biggest) boxes.push(biggest);
      break;
    }
    boxes.push(...splitOnce(biggest));
  }

  const candidates = boxes
    .filter(box => box.length > 0)
    .sort((a, b) => b.length - a.length)
    .map(average);

  const kept = [];
  for (const colour of candidates) {
    const tooClose = kept.some(other => {
      const d = Math.abs(other[0] - colour[0]) + Math.abs(other[1] - colour[1]) + Math.abs(other[2] - colour[2]);
      return d < 48;
    });
    if (!tooClose) kept.push(colour);
    if (kept.length >= count) break;
  }

  return kept.map(toHex);
}

/**
 * Drop colours that are near-copies of one already in the list. Used after
 * dimming as well as before it: two colours that looked different at full
 * brightness can land on the same shade once they are pulled down to the same
 * darkness, and five identical swatches are no use to anyone.
 */
export function dedupeHex(list, minDistance = 26) {
  const kept = [];
  for (const hex of list) {
    if (!hex) continue;
    const rgb = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
    const tooClose = kept.some(other => {
      const o = [1, 3, 5].map(i => parseInt(other.slice(i, i + 2), 16));
      return Math.abs(o[0] - rgb[0]) + Math.abs(o[1] - rgb[1]) + Math.abs(o[2] - rgb[2]) < minDistance;
    });
    if (!tooClose) kept.push(hex);
  }
  return kept;
}

/**
 * A colour dark enough to sit behind a photo without fighting it: take the
 * picked colour and pull it toward the room until it is properly dim.
 */
export function asRoomColour(hex, target = 0.09) {
  const rgb = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
  const current = luminance(rgb);
  const dimmed = current <= target
    ? rgb
    : rgb.map(v => Math.round(v * Math.sqrt(target / current)));
  // Never pure black. The room has a floor, and a colour darker than the room
  // reads as a hole in the screen rather than a background.
  const floor = [20, 19, 18];
  return toHex(dimmed.map((v, i) => Math.max(v, floor[i])));
}

const parse = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
const mix = (a, b, amount) => a.map((v, i) => Math.round(v + (b[i] - v) * amount));

/** How colourful a colour is, 0..1. Grey is 0. */
function saturation([r, g, b]) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  return max === 0 ? 0 : (max - min) / max;
}

/** `#rrggbb` plus an alpha, as an rgba() string a canvas takes. */
export function withAlpha(hex, alpha) {
  const [r, g, b] = parse(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

const tonesKept = new Map();

/**
 * The colours the player furniture is drawn in, taken from the cover, so the
 * bar, the buttons and the words look like they belong to the record rather
 * than sitting on top of it.
 *
 *   accent   the cover's most vivid colour, lifted until it shows on a dark
 *            or blurred background: the filled bar and its knob
 *   ink      near-white with a breath of that colour: titles, buttons
 *   soft     the same, quieter: the artist line, the times
 *   deep     the colour pulled most of the way to black: the card behind
 */
export function coverTones(palette) {
  const key = palette.slice(0, 5).join();
  if (tonesKept.has(key)) return tonesKept.get(key);

  const colours = palette.slice(0, 5).map(parse);
  // The most colourful of the cover's own colours, nudged toward the common
  // ones: a tiny fleck of red should not beat a cover that is mostly blue.
  const base = colours.length
    ? colours.reduce((best, c, i) => {
        const score = saturation(c) * (1 - i * 0.08);
        return score > best.score ? { c, score } : best;
      }, { c: colours[0], score: -1 }).c
    : [150, 150, 150];

  let accent = base;
  for (let step = 0; luminance(accent) < 0.2 && step < 12; step++) {
    accent = mix(accent, [255, 255, 255], 0.1);
  }

  const tones = {
    accent: toHex(accent),
    ink: toHex(mix(base, [255, 255, 255], 0.9)),
    soft: toHex(mix(base, [255, 255, 255], 0.68)),
    deep: toHex(mix(base, [0, 0, 0], 0.74)),
  };
  tonesKept.set(key, tones);
  return tones;
}

const darkKept = new Map();

/**
 * The same tones turned round for a bright backdrop: dark words in the
 * cover's own hue instead of pale ones, and an accent pulled down until it
 * holds against white.
 */
export function coverTonesDark(palette) {
  const key = palette.slice(0, 5).join();
  if (darkKept.has(key)) return darkKept.get(key);
  const light = coverTones(palette);
  let accent = parse(light.accent);
  for (let step = 0; luminance(accent) > 0.18 && step < 14; step++) {
    accent = mix(accent, [0, 0, 0], 0.12);
  }
  const base = parse(light.deep);
  const tones = {
    accent: toHex(accent),
    ink: toHex(mix(base, [0, 0, 0], 0.55)),
    soft: toHex(mix(base, [0, 0, 0], 0.25)),
    deep: light.ink,
  };
  darkKept.set(key, tones);
  return tones;
}

/** WCAG contrast between two colours, 1 (none) to 21 (black on white). */
export function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * The colour, moved toward white or black (whichever the backdrop allows
 * more of) just far enough to stand out against it by `ratio`, keeping as
 * much of its own hue as it can. 4.5 is the usual bar for reading text.
 */
export function legibleOn(hex, behind, ratio) {
  let rgb = parse(hex);
  if (contrast(rgb, behind) >= ratio) return hex;
  const toward = contrast([255, 255, 255], behind) >= contrast([0, 0, 0], behind)
    ? [255, 255, 255] : [0, 0, 0];
  for (let step = 0; contrast(rgb, behind) < ratio && step < 20; step++) {
    rgb = mix(rgb, toward, 0.12);
  }
  return toHex(rgb);
}
