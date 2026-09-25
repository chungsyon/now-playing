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
