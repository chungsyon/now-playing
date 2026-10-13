/**
 * THE DOCUMENT MODEL
 * ------------------
 * A project is plain JSON. Anything in here can be saved to IndexedDB, copied,
 * or printed to the console and read by eye. Nothing in this file touches the
 * screen; it only describes what a slide is made of.
 *
 * Shape:
 *
 *   {
 *     version, aspect, song, loopSeconds, template, showCover,
 *     layers: [ { id, type, name, visible, locked, props, effects } ]
 *   }
 *
 * Coordinates are NORMALISED: x and y run 0..1 across the slide, and sizes are
 * fractions of the slide width. That is what lets the small on-screen preview
 * and the full-size 1080px export share one render function.
 */

export const MODEL_VERSION = 1;

/** The three ratios Instagram likes, plus whatever the photo happens to be. */
export const ASPECTS = [
  { id: '1:1', label: '1:1', w: 1080, h: 1080 },
  { id: '4:5', label: '4:5', w: 1080, h: 1350 },
  { id: '3:4', label: '3:4', w: 1080, h: 1440 },
];

export const LOOP_MIN = 6;
// Ninety seconds is where Instagram stops taking a video, so it is where the
// slider stops too. A loop that long is a big file: see the note on the
// Export screen.
export const LOOP_MAX = 90;

// ---------------------------------------------------------------------------
// Animatable values
// ---------------------------------------------------------------------------

/**
 * Easing curves, by name. Used by keyframes.
 * All of them are ease-out shaped: things settle, they never overshoot.
 */
const EASES = {
  linear: u => u,
  out: u => 1 - Math.pow(1 - u, 3),
  inOut: u => (u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2),
};

/**
 * Read a property at a moment in time.
 *
 * Every numeric property is stored as EITHER a plain value:
 *
 *     { scale: 1.2 }
 *
 * OR as a list of keyframes:
 *
 *     { scale: { keyframes: [ { t: 0, value: 1 }, { t: 4, value: 1.2, ease: 'out' } ] } }
 *
 * Version 1 of the app only ever writes plain values. The keyframe branch is
 * here so a timeline editor can be added later without changing any of the
 * drawing code.
 */
export function valueAt(prop, t) {
  if (prop === null || typeof prop !== 'object') return prop;
  const frames = prop.keyframes;
  if (!Array.isArray(frames) || frames.length === 0) return prop;

  if (t <= frames[0].t) return frames[0].value;
  const last = frames[frames.length - 1];
  if (t >= last.t) return last.value;

  for (let i = 0; i < frames.length - 1; i++) {
    const a = frames[i];
    const b = frames[i + 1];
    if (t >= a.t && t <= b.t) {
      const span = b.t - a.t || 1;
      const ease = EASES[b.ease] || EASES.linear;
      const u = ease((t - a.t) / span);
      return a.value + (b.value - a.value) * u;
    }
  }
  return last.value;
}

// ---------------------------------------------------------------------------
// Keyframes
// ---------------------------------------------------------------------------
// A slider that is keyed holds { keyframes: [...] } instead of a number. These
// read and write one value of `holder[key]` at a moment `t`, in seconds.

/** Two keyframes closer than this are the same moment. */
export const SAME_MOMENT = 0.05;

export function isKeyed(prop) {
  return !!(prop && typeof prop === 'object' && Array.isArray(prop.keyframes));
}

/** The keyframe at this moment, or -1. */
export function keyIndexAt(prop, t) {
  if (!isKeyed(prop)) return -1;
  return prop.keyframes.findIndex(frame => Math.abs(frame.t - t) < SAME_MOMENT);
}

/**
 * Set the value at a moment. Unkeyed, that is just the value. Keyed, it is a
 * keyframe at that moment, made if there is none: once a slider is animated,
 * moving it anywhere on the timeline records a keyframe there.
 */
export function setValueAt(holder, key, t, value) {
  const prop = holder[key];
  if (!isKeyed(prop)) {
    holder[key] = value;
    return;
  }
  const index = keyIndexAt(prop, t);
  if (index >= 0) prop.keyframes[index].value = value;
  else {
    prop.keyframes.push({ t, value, ease: 'inOut' });
    prop.keyframes.sort((a, b) => a.t - b.t);
  }
}

/** Add a keyframe here holding the value as it is, or take away the one here. */
export function toggleKeyAt(holder, key, t, fallback) {
  const prop = holder[key];
  const current = valueAt(prop, t) ?? fallback;
  if (!isKeyed(prop)) {
    holder[key] = { keyframes: [{ t, value: current, ease: 'inOut' }] };
    return;
  }
  const index = keyIndexAt(prop, t);
  if (index < 0) {
    setValueAt(holder, key, t, current);
    return;
  }
  prop.keyframes.splice(index, 1);
  // The last keyframe gone: back to a plain value, the one showing now.
  if (prop.keyframes.length === 0) holder[key] = current;
}

// ---------------------------------------------------------------------------
// Layers
// ---------------------------------------------------------------------------

let idCounter = 0;
/** Short, readable, unique-enough ids. */
export function newId(prefix = 'l') {
  idCounter += 1;
  return `${prefix}${Date.now().toString(36)}${idCounter.toString(36)}`;
}

/**
 * Make a layer. Every layer shares the same five transform properties so the
 * drag / pinch / twist gestures work on all of them without special cases.
 */
export function makeLayer(type, name, props = {}, options = {}) {
  return {
    id: newId(),
    type,
    name,
    visible: true,
    locked: options.locked === true,
    props: {
      x: 0.5,
      y: 0.5,
      scale: 1,
      rotation: 0,
      opacity: 1,
      ...props,
    },
    effects: options.effects ? options.effects.slice() : [],
  };
}

/** The layer types this version knows how to draw. */
export const LAYER_LABELS = {
  photo: 'Photo',
  disc: 'Record',
  cover: 'Cover',
  text: 'Text',
  progressBar: 'Progress',
  controls: 'Controls',
  card: 'Card',
  window: 'Window',
  artPanel: 'Art panel',
};

// ---------------------------------------------------------------------------
// Song
// ---------------------------------------------------------------------------

export function emptySong() {
  return {
    id: null,
    source: null,          // which catalogue it came from
    title: '',
    artist: '',
    album: '',
    year: '',
    durationMs: 0,
    version: '',
    artworkUrl100: '',
    coverUrls: [],         // biggest first; used when the cover is fetched
    clipStartSeconds: 0,
  };
}

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

/**
 * A template is a function that returns a starting list of layers. It is only
 * ever called when you pick a template; after that the layers are yours and the
 * template has no further say.
 */
export const TEMPLATES = {
  vinyl: {
    id: 'vinyl',
    label: 'Vinyl',
    description: 'Your photo, with a sleeve in the corner and the record turning behind it.',
    build() {
      return [
        makeLayer('photo', 'Photo', { mode: 'photo' }, { locked: true }),
        makeLayer('disc', 'Record', {
          x: 0.66, y: 0.64, scale: 0.44,
          rpm: 30, direction: 1,
          labelColor: null,       // null means "take it from the cover"
          showLabelArt: true,
        }),
        makeLayer('cover', 'Sleeve', { x: 0.36, y: 0.64, scale: 0.44, shadow: 0.55 }),
        makeLayer('text', 'Title', {
          bind: 'title', x: 0.5, y: 0.875, size: 0.054,
          font: 'serif', align: 'center', tracking: 0,
        }),
        makeLayer('text', 'Artist', {
          bind: 'artist', x: 0.5, y: 0.928, size: 0.03,
          font: 'sans', align: 'center', tracking: 0.1, uppercase: true,
        }),
      ];
    },
  },

  player: {
    id: 'player',
    label: 'Player',
    description: 'A large cover on a pane of glass over your blurred photo, with the time running underneath.',
    // Laid out for the slide it is going on, so the card holds everything on
    // any shape. Sizes are fractions of the width, so the spacing is worked
    // out in widths too, then turned into fractions of the height.
    fitsAnyShape: true,
    build(aspect = ASPECTS[1]) {
      const across = aspect.w / aspect.h;
      // Distance from the middle of the slide, in slide widths.
      const at = offset => 0.5 + offset * across;
      const k = 0.93;
      return [
        makeLayer('photo', 'Photo', { mode: 'photo' }, {
          locked: true,
          effects: [{ type: 'blur', params: { radius: 34 } }],
        }),
        makeLayer('card', 'Card', {
          x: 0.5, y: at(0), scale: 0.78 * k, ratio: 0.92 / 0.78, radius: 0.075, blur: 12,
        }),
        makeLayer('cover', 'Cover', { x: 0.5, y: at(-0.17 * k), scale: 0.46 * k, shadow: 0.5 }),
        makeLayer('text', 'Title', {
          bind: 'title', x: 0.5, y: at(0.125 * k), size: 0.054, scale: k, maxWidth: 0.66,
          font: 'serif', align: 'center', tracking: 0,
        }),
        makeLayer('text', 'Artist', {
          bind: 'artist', x: 0.5, y: at(0.17 * k), size: 0.03, scale: k, maxWidth: 0.66,
          font: 'sans', align: 'center', tracking: 0.1, uppercase: true,
        }),
        makeLayer('progressBar', 'Progress', {
          x: 0.5, y: at(0.235 * k), scale: 0.62 * k, speed: 1, showTimes: true,
        }),
        makeLayer('controls', 'Controls', { x: 0.5, y: at(0.355 * k), scale: 0.27 * k }),
      ];
    },
  },

  window: {
    id: 'window',
    label: 'Window',
    description: 'Your photo in black and white, with one window where it stays in full colour.',
    fitsAnyShape: true,
    build(aspect = ASPECTS[1]) {
      const at = offset => 0.5 + offset * (aspect.w / aspect.h);
      return [
        makeLayer('photo', 'Photo', { mode: 'photo', mono: 1 }, { locked: true }),
        makeLayer('window', 'Window', { x: 0.5, y: at(-0.18), scale: 0.5, ratio: 1.3, radius: 0.06 }),
        // A small player under the window: the cover, and the song beside it.
        makeLayer('cover', 'Cover', { x: 0.31, y: at(0.245), scale: 0.12, shadow: 0.35 }),
        makeLayer('text', 'Title', {
          bind: 'title', x: 0.4, y: at(0.225), size: 0.056, maxWidth: 0.36,
          font: 'elegant', weight: 500, align: 'left', tracking: 0,
        }),
        makeLayer('text', 'Artist', {
          bind: 'artist', x: 0.4, y: at(0.272), size: 0.028, maxWidth: 0.36,
          font: 'sans', weight: 400, align: 'left', tracking: 0.02,
        }),
        makeLayer('progressBar', 'Progress', { x: 0.5, y: at(0.37), scale: 0.5, speed: 1, showTimes: true }),
        makeLayer('controls', 'Controls', { x: 0.5, y: at(0.47), scale: 0.24 }),
      ];
    },
  },

  media: {
    id: 'media',
    label: 'Media',
    description: 'A wide panel made of the cover, with the song and its controls on it, like a phone\'s media card.',
    fitsAnyShape: true,
    build(aspect = ASPECTS[1]) {
      const at = offset => 0.5 + offset * (aspect.w / aspect.h);
      const left = { font: 'clean', align: 'left', x: 0.14, maxWidth: 0.55 };
      return [
        makeLayer('photo', 'Photo', { mode: 'photo' }, { locked: true }),
        makeLayer('artPanel', 'Art panel', { x: 0.5, y: at(0), scale: 0.86, ratio: 0.5, radius: 0.09, dim: 0.35 }),
        makeLayer('text', 'Label', { ...left, bind: null, text: 'Phone speaker', y: at(-0.15), size: 0.026, weight: 500 }),
        makeLayer('text', 'Title', { ...left, bind: 'title', y: at(-0.087), size: 0.056, weight: 600, tracking: -0.01 }),
        makeLayer('text', 'Artist', { ...left, bind: 'artist', y: at(-0.037), size: 0.032, weight: 400 }),
        makeLayer('progressBar', 'Progress', {
          x: 0.5, y: at(0.035), scale: 0.72, speed: 1, showTimes: true, style: 'pill', font: 'clean',
        }),
        makeLayer('controls', 'Controls', { x: 0.5, y: at(0.15), scale: 0.62, style: 'media' }),
      ];
    },
  },

  bookmark: {
    id: 'bookmark',
    label: 'Bookmark',
    description: 'A tall strip of glass down one side, like a bookmark, with a round cover.',
    fitsAnyShape: true,
    build(aspect = ASPECTS[1]) {
      const at = offset => 0.5 + offset * (aspect.w / aspect.h);
      const x = 0.72;
      const round = { font: 'clean', align: 'center', x };
      return [
        makeLayer('photo', 'Photo', { mode: 'photo' }, { locked: true }),
        makeLayer('card', 'Card', {
          x, y: at(-0.02), scale: 0.4, ratio: 2.2, radius: 0.09, corners: 'bookmark', blur: 30,
        }),
        makeLayer('text', 'Label', {
          ...round, bind: null, text: 'Now playing', uppercase: true, maxWidth: 0.3,
          y: at(-0.372), size: 0.026, weight: 500, tracking: 0.06,
        }),
        makeLayer('text', 'Album', {
          ...round, bind: 'album', uppercase: true, maxWidth: 0.3,
          y: at(-0.336), size: 0.03, weight: 700, tracking: 0.08,
        }),
        makeLayer('cover', 'Cover', { x, y: at(-0.17), scale: 0.24, shadow: 0.35, round: true }),
        makeLayer('text', 'Title', {
          ...round, bind: 'title', maxWidth: 0.3,
          y: at(0.0), size: 0.05, weight: 700, tracking: -0.01, tone: 'accent',
        }),
        makeLayer('text', 'Artist', {
          ...round, bind: 'artist', maxWidth: 0.3,
          y: at(0.045), size: 0.028, weight: 400, tracking: 0, tone: 'accent',
        }),
        makeLayer('progressBar', 'Progress', { x, y: at(0.16), scale: 0.32, speed: 1, showTimes: true, font: 'clean' }),
        makeLayer('controls', 'Controls', { x, y: at(0.28), scale: 0.26, ring: true }),
      ];
    },
  },
};

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

export function createProject({ aspect, template = 'vinyl', song = null } = {}) {
  const chosen = aspect || ASPECTS[1];
  return {
    version: MODEL_VERSION,
    aspect: { id: chosen.id, w: chosen.w, h: chosen.h },
    song: song || emptySong(),
    loopSeconds: 8,
    template,
    // The shape the layers were laid out for. fitToSlide works from this.
    layoutAspect: { w: TEMPLATES[template].fitsAnyShape ? chosen.w : 1080,
      h: TEMPLATES[template].fitsAnyShape ? chosen.h : 1350 },
    showCover: true,
    grouped: true,          // the furniture moves as one arrangement
    palette: [],            // colours pulled from the cover or the photo
    layers: TEMPLATES[template].build(chosen),
  };
}

/**
 * Swap the template but keep the song, the ratio and the loop length. The
 * layers are rebuilt, because that is what a template is.
 */
export function applyTemplate(project, templateId) {
  project.template = templateId;
  project.layers = TEMPLATES[templateId].build(project.aspect);
  project.layoutAspect = TEMPLATES[templateId].fitsAnyShape
    ? { w: project.aspect.w, h: project.aspect.h } : { w: 1080, h: 1350 };
  return project;
}

export function findLayer(project, id) {
  return project.layers.find(layer => layer.id === id) || null;
}

/**
 * WHAT MOVES TOGETHER
 * -------------------
 * The cover, the words, the bar and the buttons are one arrangement, not five
 * loose pieces. Spacing them by hand and then nudging one of them out of line
 * is the easiest way to spoil a slide, so by default dragging any of them
 * drags all of them and the spacing you set stays set.
 *
 * Two ways out, both the user's: turn grouping off for the project, or lock
 * the one layer you want to leave where it is. A locked layer is not in the
 * group and is not picked up by a finger either.
 *
 * The photo never joins. It is the background, and it is sized to fill.
 */
export function movesWith(project, layer) {
  if (!layer) return [];
  // Older drafts have no flag. Grouping is the default, so only an explicit
  // false turns it off.
  const grouped = project.grouped !== false;
  // With Move together on, the card travels with everything on it, whichever
  // of them is held. Off, each moves alone.
  if (!grouped || layer.type === 'photo') return [layer];
  // The layer itself always belongs, even hidden: what is done to the
  // selection must reach the selection.
  return project.layers.filter(
    other => other === layer || (other.type !== 'photo' && !other.locked && other.visible),
  );
}

/**
 * How many whole turns the record makes over one loop.
 *
 * The loop only closes if the record ends where it started, so the requested
 * speed is rounded to the nearest whole number of turns. The editor shows the
 * real speed that results, rather than pretending it used the number you typed.
 */
export function turnsPerLoop(rpm, loopSeconds) {
  return Math.max(1, Math.round((rpm / 60) * loopSeconds));
}

export function actualRpm(rpm, loopSeconds) {
  return (turnsPerLoop(rpm, loopSeconds) / loopSeconds) * 60;
}

/** A project without the photo or the song: that is what a saved style is. */
export function toStyle(project, name) {
  const copy = structuredClone(project);
  copy.song = emptySong();
  return { id: newId('s'), name, updatedAt: Date.now(), project: copy };
}

/** mm:ss, used everywhere a time is shown. */
export function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
  const whole = Math.floor(seconds);
  const m = Math.floor(whole / 60);
  const s = whole % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}
