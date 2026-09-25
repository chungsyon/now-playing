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
export const LOOP_MAX = 15;

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
};

// ---------------------------------------------------------------------------
// Song
// ---------------------------------------------------------------------------

export function emptySong() {
  return {
    id: null,
    title: '',
    artist: '',
    album: '',
    year: '',
    durationMs: 0,
    version: '',
    artworkUrl: '',
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
          font: 'serif', align: 'center', tracking: 0, color: '#F3EFE9',
        }),
        makeLayer('text', 'Artist', {
          bind: 'artist', x: 0.5, y: 0.928, size: 0.026,
          font: 'sans', align: 'center', tracking: 0.16, uppercase: true, color: '#A8A097',
        }),
      ];
    },
  },

  player: {
    id: 'player',
    label: 'Player',
    description: 'A large cover over your blurred photo, with the time running underneath.',
    build() {
      return [
        makeLayer('photo', 'Photo', { mode: 'photo' }, {
          locked: true,
          effects: [{ type: 'blur', params: { radius: 34 } }],
        }),
        // Sizes are fractions of the WIDTH, so a square slide is the tight
        // case: these numbers are chosen to clear each other at 1:1 and to
        // simply have more air on taller shapes.
        makeLayer('cover', 'Cover', { x: 0.5, y: 0.34, scale: 0.58, shadow: 0.6 }),
        makeLayer('text', 'Title', {
          bind: 'title', x: 0.5, y: 0.68, size: 0.054,
          font: 'serif', align: 'center', tracking: 0, color: '#F3EFE9',
        }),
        makeLayer('text', 'Artist', {
          bind: 'artist', x: 0.5, y: 0.727, size: 0.026,
          font: 'sans', align: 'center', tracking: 0.16, uppercase: true, color: '#A8A097',
        }),
        makeLayer('progressBar', 'Progress', {
          x: 0.5, y: 0.79, scale: 0.74, speed: 1, showTimes: true,
        }),
        makeLayer('controls', 'Controls', { x: 0.5, y: 0.90, scale: 0.30 }),
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
    showCover: true,
    palette: [],            // colours pulled from the cover or the photo
    layers: TEMPLATES[template].build(),
  };
}

/**
 * Swap the template but keep the song, the ratio and the loop length. The
 * layers are rebuilt, because that is what a template is.
 */
export function applyTemplate(project, templateId) {
  project.template = templateId;
  project.layers = TEMPLATES[templateId].build();
  return project;
}

export function findLayer(project, id) {
  return project.layers.find(layer => layer.id === id) || null;
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
