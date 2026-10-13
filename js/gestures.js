/**
 * TOUCH EDITING
 * -------------
 * Tap a layer to select it. Drag one finger to move it, pinch with two to
 * resize, twist with two to rotate.
 *
 * Two things happen on top of that. A gesture usually moves a GROUP rather
 * than a single layer, because the player furniture is one arrangement and
 * should stay one (see movesWith in model.js). And the last little bit of
 * every gesture SNAPS: to the middle of the slide, to anything standing
 * still, and to clean angles.
 *
 * Positions are stored as fractions of the slide (0 to 1), so a gesture on the
 * small preview means exactly the same thing at full export size.
 *
 * This file only works out what the fingers did. Drawing the selection outline
 * is the editor's job, on a separate canvas that sits on top, so nothing about
 * the selection ever reaches the exported video.
 */

import { valueAt, movesWith, setValueAt, makeLayer, isKeyed } from './model.js';

// Panels with a free shape: a corner reshapes them, and a selected one keeps
// hold of any touch inside it.
const PANES = new Set(['card', 'window', 'artPanel']);

// --- Snapping ---------------------------------------------------------------
// Lining a thing up by thumb is guesswork, so the last little bit is done for
// you: come close to the middle and it takes the middle exactly, tilt near a
// clean angle and it takes the clean angle. The tolerances are deliberately
// small, so deciding to sit slightly off-centre still works.

/** Within this fraction of the slide, a position is taken as centred. */
const SNAP_REACH = 0.014;
/** Angles worth landing on, and how near you have to get, in degrees. */
const SNAP_ANGLE = 15;
const SNAP_ANGLE_REACH = 4;

/** How far to move `value` to sit on the nearest target, or 0 for none. */
export function pullTo(value, targets, reach) {
  let shift = 0;
  let nearest = reach;
  for (const target of targets) {
    const gap = Math.abs(target - value);
    if (gap < nearest) { nearest = gap; shift = target - value; }
  }
  return shift;
}

/** The nearest clean angle, or the angle itself when none is near enough. */
export function pullAngle(degrees) {
  const nearest = Math.round(degrees / SNAP_ANGLE) * SNAP_ANGLE;
  return Math.abs(nearest - degrees) <= SNAP_ANGLE_REACH ? nearest : degrees;
}

// --- Corner handles ---------------------------------------------------------
// A finger can pinch and twist; a mouse cannot. So the four dots on the
// selection are grabbable: drag one to resize, drag just outside one to turn.
// The dots are drawn by the editor and hit here, from the same box, so what
// is grabbed is always what is shown.

/** How big a corner dot is drawn. */
export function handleRadius(stage) {
  return Math.max(5, stage.width * 0.013);
}

/** How near a dot counts as holding it, and how far outside counts as turning. */
function grabReach(stage) {
  return Math.max(20, stage.width * 0.038);
}
function turnReach(stage) {
  return Math.max(24, stage.width * 0.05);
}

/**
 * What this point is grabbing on the selected layer: its corner dot, the
 * space just outside one, or nothing.
 *
 * @returns 'scale' | 'rotate' | null
 */
export function handleAt(layer, project, stage, x, y, t = 0) {
  if (!layer || layer.locked || !layer.visible) return null;
  const b = layerBounds(layer, project, stage, t);

  // Into the box's own frame, so a turned box is still four square corners.
  const angle = (-b.rotation * Math.PI) / 180;
  const dx = x - b.cx;
  const dy = y - b.cy;
  const localX = dx * Math.cos(angle) - dy * Math.sin(angle);
  const localY = dx * Math.sin(angle) + dy * Math.cos(angle);

  const halfW = b.w / 2;
  const halfY = b.h / 2;
  const grab = grabReach(stage);
  const turn = turnReach(stage);
  const outside = Math.abs(localX) > halfW || Math.abs(localY) > halfY;

  // The nearest corner decides. On a short box two corners can both be in
  // reach, and the first one found is not always the one meant.
  const away = Math.min(...[[-1, -1], [1, -1], [1, 1], [-1, 1]]
    .map(([sx, sy]) => Math.hypot(localX - sx * halfW, localY - sy * halfY)));
  if (away <= grab) return 'scale';
  // Turning lives outside the box only, so the inside stays a plain drag.
  if (outside && away <= grab + turn) return 'rotate';
  return null;
}

/**
 * Put every member of a gesture where that gesture says it goes.
 *
 * Turning and resizing happen about the pivot in slide PIXELS, not in the
 * 0..1 fractions the positions are stored as: a slide is taller than it is
 * wide, so a circle drawn in fractions would come out an ellipse on the slide.
 *
 * `k` resizes, `turn` is in degrees, `dx` and `dy` shift, all measured from
 * where the gesture started. Applying them from the start every time, rather
 * than accumulating, is what keeps a long drag from drifting.
 *
 * Values are written at `start.t`: a plain number stays a plain number, and
 * a keyframed one gets a keyframe at that moment.
 */
export function placeMembers(start, stage, k, turn, dx, dy) {
  const t = start.t || 0;
  // If anything in the group is keyframed, the rest are given keyframes at
  // the same moments, holding still. Otherwise a plain member would move at
  // every moment while the keyed ones moved only at this one, and the group
  // would come apart.
  for (const key of ['x', 'y', 'scale', 'rotation']) {
    const times = new Set();
    for (const m of start.members) {
      const prop = m.layer.props[key];
      if (isKeyed(prop)) for (const frame of prop.keyframes) times.add(frame.t);
    }
    if (!times.size) continue;
    for (const m of start.members) {
      const props = m.layer.props;
      if (isKeyed(props[key])) continue;
      const still = valueAt(props[key], t);
      props[key] = {
        keyframes: [...times].sort((a, b) => a - b).map(at => ({ t: at, value: still, ease: 'inOut' })),
      };
    }
  }
  const radians = (turn * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const px = start.pivotX * stage.width;
  const py = start.pivotY * stage.height;

  for (const m of start.members) {
    const ox = m.x * stage.width - px;
    const oy = m.y * stage.height - py;
    const props = m.layer.props;
    setValueAt(props, 'x', t, (px + (ox * cos - oy * sin) * k) / stage.width + dx);
    setValueAt(props, 'y', t, (py + (ox * sin + oy * cos) * k) / stage.height + dy);
    setValueAt(props, 'scale', t, Math.max(0.02, m.scale * k));
    setValueAt(props, 'rotation', t, m.rotation + turn);
  }
}

/**
 * Roughly where a layer sits, in slide pixels. Good enough to tap.
 * Returns the centre, the size, and the angle it is turned by.
 */
export function layerBounds(layer, project, stage, t = 0) {
  const p = layer.props;
  const scale = valueAt(p.scale, t);
  const cx = valueAt(p.x, t) * stage.width;
  const cy = valueAt(p.y, t) * stage.height;
  const rotation = valueAt(p.rotation, t);

  let w;
  let h;
  // Text set from its left or right end sits to one side of its point, and
  // a bar's times hang below it, so the box is not always centred on x, y.
  let shift = 0;
  let drop = 0;
  switch (layer.type) {
    case 'photo':
      return { cx: stage.width / 2, cy: stage.height / 2, w: stage.width, h: stage.height, rotation: 0 };
    case 'disc':
    case 'cover':
      w = stage.width * scale;
      h = w;
      break;
    case 'text': {
      const size = stage.width * valueAt(p.size, t) * scale;
      const text = p.bind === 'title' ? project.song.title
        : p.bind === 'artist' ? project.song.artist
        : p.bind === 'album' ? project.song.album
        : p.text || '';
      const chars = Math.max(4, [...(text || 'Untitled')].length);
      w = chars * size * (0.55 + (p.tracking || 0));
      if (p.maxWidth) w = Math.min(w, stage.width * p.maxWidth * scale);
      h = size * 1.6;
      shift = p.align === 'left' ? w / 2 : p.align === 'right' ? -w / 2 : 0;
      break;
    }
    case 'progressBar': {
      // Just the bar, its knob and the times under it, as render.js draws them.
      w = stage.width * scale;
      const pill = p.style === 'pill';
      const thickness = pill ? w * 0.032 : Math.max(2, w * 0.0075);
      const knob = pill ? thickness * 0.85 : thickness * 1.9;
      const timeSize = w * (p.font ? 0.045 : 0.036);
      const timesAt = pill ? thickness / 2 + timeSize * 1.3 : timeSize * 1.9;
      const pad = stage.width * 0.012;
      const top = -knob - pad;
      const bottom = (p.showTimes ? timesAt + timeSize * 0.6 : knob) + pad;
      h = bottom - top;
      drop = (top + bottom) / 2;
      break;
    }
    case 'controls':
      w = stage.width * scale;
      h = stage.width * scale * 0.42;
      break;
    case 'card':
    case 'window':
    case 'artPanel':
      w = stage.width * scale;
      h = w * (valueAt(p.ratio, t) || { card: 1.2, window: 1.6, artPanel: 0.5 }[layer.type]);
      break;
    default:
      w = stage.width * scale;
      h = w;
  }
  const turn = (rotation * Math.PI) / 180;
  return {
    cx: cx + shift * Math.cos(turn) - drop * Math.sin(turn),
    cy: cy + shift * Math.sin(turn) + drop * Math.cos(turn),
    w, h, rotation,
  };
}

/**
 * Fit the furniture, as one piece, inside the slide.
 *
 * Positions are fractions of each side but sizes are fractions of the width,
 * so a layout made for an upright slide does not survive being stretched
 * onto a wide one: the words land on the sleeve and the sleeve runs off the
 * bottom. This lays the arrangement out on the slide it was made for
 * (`madeFor`, else the project's `layoutAspect`, else 4:5), shrinks it there as one piece until
 * it fits the real slide with a margin, and centres it. A slide it already
 * fits is left exactly as it is.
 */
export function fitToSlide(project, madeFor = null) {
  const W = project.aspect.w;
  const H = project.aspect.h;
  const layers = project.layers.filter(l => l.type !== 'photo');
  if (!layers.length) return project;

  const edges = stage => {
    const box = { left: Infinity, right: -Infinity, top: Infinity, bottom: -Infinity };
    for (const layer of layers) {
      const b = layerBounds(layer, project, stage);
      box.left = Math.min(box.left, b.cx - b.w / 2);
      box.right = Math.max(box.right, b.cx + b.w / 2);
      box.top = Math.min(box.top, b.cy - b.h / 2);
      box.bottom = Math.max(box.bottom, b.cy + b.h / 2);
    }
    return box;
  };

  const now = edges({ width: W, height: H });
  if (now.left >= 0 && now.top >= 0 && now.right <= W && now.bottom <= H) return project;

  // The slide the layout was drawn for, at the same width, so sizes match.
  const from = madeFor || project.layoutAspect;
  const ratio = from ? from.h / from.w : 1350 / 1080;
  const source = { width: W, height: W * ratio };
  const box = edges(source);
  const margin = 0.06;
  const k = Math.min(1,
    (W * (1 - margin * 2)) / (box.right - box.left),
    (H * (1 - margin * 2)) / (box.bottom - box.top));
  const midX = (box.left + box.right) / 2;
  const midY = (box.top + box.bottom) / 2;

  // Keyframed values are moved keyframe by keyframe, so a style that
  // animates keeps animating on a slide of another shape.
  const remap = (prop, fn) => {
    if (!isKeyed(prop)) return fn(prop);
    for (const frame of prop.keyframes) frame.value = fn(frame.value);
    return prop;
  };
  for (const layer of layers) {
    const p = layer.props;
    p.x = remap(p.x, x => (W / 2 + (x * source.width - midX) * k) / W);
    p.y = remap(p.y, y => (H / 2 + (y * source.height - midY) * k) / H);
    p.scale = remap(p.scale, scale => scale * k);
  }
  project.layoutAspect = { w: W, h: H };
  return project;
}

/**
 * Put a glass card behind whatever furniture is on the slide, with room
 * round it, or take it away. It goes straight above the photo, which is
 * where the glass expects to be.
 */
export function setCard(project, on) {
  project.layers = project.layers.filter(l => l.type !== 'card');
  if (!on) return project;

  const stage = { width: project.aspect.w, height: project.aspect.h };
  const furniture = project.layers.filter(l => l.type !== 'photo' && l.visible);
  if (!furniture.length) return project;

  // Where the card goes at one moment: round the furniture, with room.
  const around = t => {
    let left = Infinity;
    let right = -Infinity;
    let top = Infinity;
    let bottom = -Infinity;
    for (const layer of furniture) {
      const b = layerBounds(layer, project, stage, t);
      const reach = Math.max(b.w, b.h) / 2;
      const halfW = b.rotation ? reach : b.w / 2;
      const halfH = b.rotation ? reach : b.h / 2;
      left = Math.min(left, b.cx - halfW);
      right = Math.max(right, b.cx + halfW);
      top = Math.min(top, b.cy - halfH);
      bottom = Math.max(bottom, b.cy + halfH);
    }
    const pad = stage.width * 0.06;
    const w = right - left + pad * 2;
    return {
      x: (left + right) / 2 / stage.width,
      y: (top + bottom) / 2 / stage.height,
      scale: w / stage.width,
      ratio: (bottom - top + pad * 2) / w,
    };
  };

  // If the furniture is animated, the card is worked out at each of its
  // keyframes and keyed to match, so it travels with what it holds.
  const times = new Set();
  for (const layer of furniture) {
    for (const key of ['x', 'y', 'scale']) {
      const prop = layer.props[key];
      if (isKeyed(prop)) for (const frame of prop.keyframes) times.add(frame.t);
    }
  }
  const first = around([...times][0] ?? 0);
  const props = { ...first, radius: 0.075, blur: 12 };
  if (times.size) {
    const sorted = [...times].sort((a, b) => a - b);
    const at = sorted.map(around);
    for (const key of ['x', 'y', 'scale']) {
      props[key] = { keyframes: sorted.map((t, i) => ({ t, value: at[i][key], ease: 'inOut' })) };
    }
  }
  const card = makeLayer('card', 'Card', props);
  const index = project.layers.findIndex(l => l.type === 'photo') + 1;
  project.layers.splice(index, 0, card);
  return project;
}

function inside(bounds, x, y) {
  const angle = (-bounds.rotation * Math.PI) / 180;
  const dx = x - bounds.cx;
  const dy = y - bounds.cy;
  const localX = dx * Math.cos(angle) - dy * Math.sin(angle);
  const localY = dx * Math.sin(angle) + dy * Math.cos(angle);
  // A little slack, so small text is still easy to hit with a thumb.
  const padX = Math.max(bounds.w / 2, 22);
  const padY = Math.max(bounds.h / 2, 22);
  return Math.abs(localX) <= padX && Math.abs(localY) <= padY;
}

/** The topmost layer under this point that can actually be picked up. */
export function layerAt(project, stage, x, y, t = 0) {
  for (let i = project.layers.length - 1; i >= 0; i--) {
    const layer = project.layers[i];
    if (!layer.visible || layer.locked) continue;
    if (layer.type === 'cover' && !project.showCover) continue;
    if (inside(layerBounds(layer, project, stage, t), x, y)) return layer;
  }
  return null;
}

/**
 * Wire up the gestures.
 *
 * @param {HTMLElement} element  the thing fingers touch (the overlay canvas)
 * @param {object} api
 *   getProject()      the current document
 *   getStage()        the preview stage, for its width and height
 *   getSelectedId()   which layer is selected, or null
 *   onSelect(id)      called when the selection changes
 *   onChange()        called after any property has moved
 *   getTime()         the moment the slide is showing, in seconds
 *   onStart()         a finger or the mouse has gone down
 */
export function attachGestures(element, api) {
  const pointers = new Map();
  let start = null;
  let snapped = { x: false, y: false, rotation: false };
  let grabbed = null;      // 'scale' | 'rotate' when a corner is being held
  const now = () => (api.getTime ? api.getTime() : 0);

  const toStage = event => {
    const rect = element.getBoundingClientRect();
    const stage = api.getStage();
    return {
      x: ((event.clientX - rect.left) / rect.width) * stage.width,
      y: ((event.clientY - rect.top) / rect.height) * stage.height,
    };
  };

  const selectedLayer = () => {
    const project = api.getProject();
    const id = api.getSelectedId();
    return project.layers.find(layer => layer.id === id) || null;
  };

  const twoFingerState = () => {
    const [a, b] = [...pointers.values()];
    return {
      midX: (a.x + b.x) / 2,
      midY: (a.y + b.y) / 2,
      distance: Math.hypot(b.x - a.x, b.y - a.y),
      angle: (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI,
    };
  };

  /**
   * Where everything stands at the moment a gesture begins. A drag, a handle
   * and an arrow key all work from one of these.
   */
  const snapshotOf = layer => {
    const project = api.getProject();
    const t = now();

    // Everything this gesture moves, with where it started. For a layer on
    // its own that list is just the layer.
    const members = movesWith(project, layer).map(other => ({
      layer: other,
      x: valueAt(other.props.x, t),
      y: valueAt(other.props.y, t),
      scale: valueAt(other.props.scale, t),
      rotation: valueAt(other.props.rotation, t),
    }));

    // A pinch or a twist turns the whole arrangement about its middle, which
    // keeps it looking like one thing rather than pieces drifting apart.
    const pivotX = members.reduce((sum, m) => sum + m.x, 0) / members.length;
    const pivotY = members.reduce((sum, m) => sum + m.y, 0) / members.length;

    // Guides to line up against: the middle of the slide, and the middle of
    // anything that is standing still.
    const others = project.layers.filter(
      other => other.visible && other.type !== 'photo'
        && !members.some(m => m.layer === other),
    );
    return {
      layer, members, pivotX, pivotY, t,
      lead: members.find(m => m.layer === layer) || members[0],
      xTargets: [0.5, ...others.map(other => valueAt(other.props.x, t))],
      yTargets: [0.5, ...others.map(other => valueAt(other.props.y, t))],
    };
  };

  const beginGesture = () => {
    const layer = selectedLayer();
    if (!layer || layer.locked) { start = null; return; }
    const base = snapshotOf(layer);

    if (pointers.size >= 2) {
      start = { ...base, mode: 'two', ...twoFingerState() };
      return;
    }

    const only = [...pointers.values()][0];
    if (!grabbed) {
      start = { ...base, mode: 'one', midX: only.x, midY: only.y };
      return;
    }

    // A handle turns and resizes about the middle of the layer it belongs
    // to, not the middle of the group. Two reasons: the corner then stays
    // under the pointer instead of drifting away from it, and a handle that
    // happened to sit near the group's middle would otherwise have enormous
    // leverage, a few pixels of movement doubling everything. The rest of
    // the group still follows, anchored on the one you are holding.
    const stage = api.getStage();
    const px = base.lead.x * stage.width;
    const py = base.lead.y * stage.height;
    start = {
      ...base,
      pivotX: base.lead.x,
      pivotY: base.lead.y,
      // On its own, a card's corner changes its width and height apart, so
      // its shape is whatever you drag it to. Moving together, the corner
      // resizes the whole arrangement like any other layer's does.
      mode: grabbed === 'scale' && base.members.length === 1
        && PANES.has(layer.type) ? 'stretch' : grabbed,
      midX: only.x,
      midY: only.y,
      grabRadius: Math.hypot(only.x - px, only.y - py),
      grabAngle: (Math.atan2(only.y - py, only.x - px) * 180) / Math.PI,
    };
  };

  const place = (k, turn, dx, dy) => placeMembers(start, api.getStage(), k, turn, dx, dy);

  /**
   * Say what is under the pointer. Touch never sees this: it only runs when
   * something moves across the slide with nothing held down.
   */
  const showCursor = point => {
    const project = api.getProject();
    const stage = api.getStage();
    const layer = selectedLayer();
    const grab = handleAt(layer, project, stage, point.x, point.y, now());

    if (grab === 'rotate') { element.style.cursor = 'grab'; return; }
    if (grab === 'scale') {
      // Which way the arrow lies: the corner's own diagonal.
      const b = layerBounds(layer, project, stage, now());
      const same = (point.x - b.cx) * (point.y - b.cy) >= 0;
      element.style.cursor = same ? 'nwse-resize' : 'nesw-resize';
      return;
    }
    element.style.cursor = layerAt(project, stage, point.x, point.y, now()) ? 'move' : 'default';
  };

  /**
   * Move the selection by hand, in slide fractions. This is the arrow keys,
   * and it does not snap: pressing an arrow is already saying exactly where
   * you want it, and a guide would swallow every step near the middle.
   */
  const nudgeBy = (dx, dy) => {
    const layer = selectedLayer();
    if (!layer || layer.locked) return false;
    const held = start;
    start = snapshotOf(layer);
    place(1, 0, dx, dy);
    start = held;
    api.onChange();
    return true;
  };

  const onDown = event => {
    // Register the finger first. Capturing can fail, and if it does the
    // gesture must still work rather than falling over halfway through.
    pointers.set(event.pointerId, toStage(event));
    try { element.setPointerCapture(event.pointerId); } catch { /* not capturable */ }
    // Moving something means moving it at one moment, so time stops first.
    if (api.onStart) api.onStart();

    if (pointers.size === 1) {
      const point = [...pointers.values()][0];
      // A corner of what is already selected is taken first, so reaching for
      // a handle never picks up whatever happens to sit behind it.
      grabbed = handleAt(selectedLayer(), api.getProject(), api.getStage(), point.x, point.y, now());
      // A selected card keeps hold anywhere inside it. It sits under
      // everything else, so otherwise almost every touch on it would land on
      // the cover or the words instead.
      const held = selectedLayer();
      const keepCard = !grabbed && held && PANES.has(held.type)
        && inside(layerBounds(held, api.getProject(), api.getStage(), now()), point.x, point.y);
      if (!grabbed && !keepCard) {
        const hit = layerAt(api.getProject(), api.getStage(), point.x, point.y, now());
        api.onSelect(hit ? hit.id : null);
      }
    }
    beginGesture();
  };

  const onMove = event => {
    // A mouse moving with no button down is hovering, not dragging. That is
    // the moment to say what the cursor is over.
    if (!pointers.has(event.pointerId)) {
      showCursor(toStage(event));
      return;
    }
    pointers.set(event.pointerId, toStage(event));
    if (!start) return;

    const stage = api.getStage();
    let k = 1;
    let turn = 0;
    let dx = 0;
    let dy = 0;

    if (start.mode === 'stretch') {
      // The corner goes where the pointer is; the opposite corner mirrors it,
      // so the card stays centred where it was.
      const only = [...pointers.values()][0];
      const angle = (-start.lead.rotation * Math.PI) / 180;
      const ox = only.x - start.pivotX * stage.width;
      const oy = only.y - start.pivotY * stage.height;
      const localX = ox * Math.cos(angle) - oy * Math.sin(angle);
      const localY = ox * Math.sin(angle) + oy * Math.cos(angle);
      const w = Math.max(stage.width * 0.08, Math.abs(localX) * 2);
      const h = Math.max(stage.width * 0.08, Math.abs(localY) * 2);
      const props = start.lead.layer.props;
      setValueAt(props, 'scale', start.t, w / stage.width);
      setValueAt(props, 'ratio', start.t, h / w);
      api.onChange();
      event.preventDefault();
      return;
    }

    if (start.mode === 'two' && pointers.size >= 2) {
      const now = twoFingerState();
      if (start.distance > 4) k = now.distance / start.distance;
      // Snap the angle the layer ENDS on, not the amount the fingers turned,
      // so a tilt lands on 15 degrees rather than 15 away from wherever it was.
      const wanted = start.lead.rotation + (now.angle - start.angle);
      turn = pullAngle(wanted) - start.lead.rotation;
      dx = (now.midX - start.midX) / stage.width;
      dy = (now.midY - start.midY) / stage.height;
    } else if (start.mode === 'scale' || start.mode === 'rotate') {
      const only = [...pointers.values()][0];
      const px = start.pivotX * stage.width;
      const py = start.pivotY * stage.height;
      if (start.mode === 'scale') {
        const reach = Math.hypot(only.x - px, only.y - py);
        if (start.grabRadius > 4) k = reach / start.grabRadius;
      } else {
        const now = (Math.atan2(only.y - py, only.x - px) * 180) / Math.PI;
        const wanted = start.lead.rotation + (now - start.grabAngle);
        turn = pullAngle(wanted) - start.lead.rotation;
      }
    } else if (start.mode === 'one') {
      const only = [...pointers.values()][0];
      dx = (only.x - start.midX) / stage.width;
      dy = (only.y - start.midY) / stage.height;
    }

    // Placed once to see where the finger put it, then nudged onto whichever
    // guide it came close to and placed again. The nudge moves the whole
    // group, so nothing inside it shifts relative to anything else.
    place(k, turn, dx, dy);
    const lead = start.lead.layer.props;
    const leadX = valueAt(lead.x, start.t);
    const leadY = valueAt(lead.y, start.t);
    // A handle is not moving the layer, so there is nothing to line up with.
    const lining = start.mode === 'one' || start.mode === 'two';
    const pullX = lining ? pullTo(leadX, start.xTargets, SNAP_REACH) : 0;
    const pullY = lining ? pullTo(leadY, start.yTargets, SNAP_REACH) : 0;
    if (pullX || pullY) place(k, turn, dx + pullX, dy + pullY);

    snapped = {
      x: pullX !== 0,
      y: pullY !== 0,
      rotation: turn !== 0 && Math.abs(valueAt(lead.rotation, start.t) % SNAP_ANGLE) < 0.001,
    };

    api.onChange();
    event.preventDefault();
  };

  const onUp = event => {
    pointers.delete(event.pointerId);
    try {
      if (element.hasPointerCapture && element.hasPointerCapture(event.pointerId)) {
        element.releasePointerCapture(event.pointerId);
      }
    } catch { /* already gone */ }
    if (pointers.size === 0) {
      start = null;
      grabbed = null;
      snapped = { x: false, y: false, rotation: false };
      api.onChange();             // the guides go away with the fingers
    } else {
      beginGesture();             // a finger lifted: carry on with what is left
    }
  };

  element.addEventListener('pointerdown', onDown);
  element.addEventListener('pointermove', onMove);
  element.addEventListener('pointerup', onUp);
  element.addEventListener('pointercancel', onUp);

  return {
    /** Which guides the layer is sitting on right now. The editor draws them. */
    snapped: () => snapped,
    /** Shift the selection by a fraction of the slide. Used by the arrow keys. */
    nudge: nudgeBy,
    destroy() {
      element.style.cursor = '';
      element.removeEventListener('pointerdown', onDown);
      element.removeEventListener('pointermove', onMove);
      element.removeEventListener('pointerup', onUp);
      element.removeEventListener('pointercancel', onUp);
    },
  };
}
