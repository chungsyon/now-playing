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

import { valueAt, movesWith } from './model.js';

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
 */
export function placeMembers(start, stage, k, turn, dx, dy) {
  const radians = (turn * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const px = start.pivotX * stage.width;
  const py = start.pivotY * stage.height;

  for (const m of start.members) {
    const ox = m.x * stage.width - px;
    const oy = m.y * stage.height - py;
    m.layer.props.x = (px + (ox * cos - oy * sin) * k) / stage.width + dx;
    m.layer.props.y = (py + (ox * sin + oy * cos) * k) / stage.height + dy;
    m.layer.props.scale = Math.max(0.02, m.scale * k);
    m.layer.props.rotation = m.rotation + turn;
  }
}

/**
 * Roughly where a layer sits, in slide pixels. Good enough to tap.
 * Returns the centre, the size, and the angle it is turned by.
 */
export function layerBounds(layer, project, stage) {
  const p = layer.props;
  const scale = valueAt(p.scale, 0);
  const cx = valueAt(p.x, 0) * stage.width;
  const cy = valueAt(p.y, 0) * stage.height;
  const rotation = valueAt(p.rotation, 0);

  let w;
  let h;
  switch (layer.type) {
    case 'photo':
      return { cx: stage.width / 2, cy: stage.height / 2, w: stage.width, h: stage.height, rotation: 0 };
    case 'disc':
    case 'cover':
      w = stage.width * scale;
      h = w;
      break;
    case 'text': {
      const size = stage.width * valueAt(p.size, 0) * scale;
      const text = p.bind === 'title' ? project.song.title
        : p.bind === 'artist' ? project.song.artist
        : p.text || '';
      const chars = Math.max(4, [...(text || 'Untitled')].length);
      w = chars * size * (0.55 + (p.tracking || 0));
      h = size * 1.6;
      break;
    }
    case 'progressBar':
      w = stage.width * scale;
      h = stage.width * 0.11;
      break;
    case 'controls':
      w = stage.width * scale;
      h = stage.width * scale * 0.42;
      break;
    default:
      w = stage.width * scale;
      h = w;
  }
  return { cx, cy, w, h, rotation };
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
export function layerAt(project, stage, x, y) {
  for (let i = project.layers.length - 1; i >= 0; i--) {
    const layer = project.layers[i];
    if (!layer.visible || layer.locked) continue;
    if (layer.type === 'cover' && !project.showCover) continue;
    if (inside(layerBounds(layer, project, stage), x, y)) return layer;
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
 */
export function attachGestures(element, api) {
  const pointers = new Map();
  let start = null;
  let snapped = { x: false, y: false, rotation: false };

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

  const beginGesture = () => {
    const layer = selectedLayer();
    if (!layer || layer.locked) { start = null; return; }
    const project = api.getProject();

    // Everything this gesture moves, with where it started. For a layer on
    // its own that list is just the layer.
    const members = movesWith(project, layer).map(other => ({
      layer: other,
      x: valueAt(other.props.x, 0),
      y: valueAt(other.props.y, 0),
      scale: valueAt(other.props.scale, 0),
      rotation: valueAt(other.props.rotation, 0),
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
    const base = {
      layer, members, pivotX, pivotY,
      lead: members.find(m => m.layer === layer) || members[0],
      xTargets: [0.5, ...others.map(other => valueAt(other.props.x, 0))],
      yTargets: [0.5, ...others.map(other => valueAt(other.props.y, 0))],
    };

    if (pointers.size >= 2) {
      start = { ...base, mode: 'two', ...twoFingerState() };
    } else {
      const only = [...pointers.values()][0];
      start = { ...base, mode: 'one', midX: only.x, midY: only.y };
    }
  };

  const place = (k, turn, dx, dy) => placeMembers(start, api.getStage(), k, turn, dx, dy);

  const onDown = event => {
    // Register the finger first. Capturing can fail, and if it does the
    // gesture must still work rather than falling over halfway through.
    pointers.set(event.pointerId, toStage(event));
    try { element.setPointerCapture(event.pointerId); } catch { /* not capturable */ }

    if (pointers.size === 1) {
      const point = [...pointers.values()][0];
      const hit = layerAt(api.getProject(), api.getStage(), point.x, point.y);
      api.onSelect(hit ? hit.id : null);
    }
    beginGesture();
  };

  const onMove = event => {
    if (!pointers.has(event.pointerId)) return;
    pointers.set(event.pointerId, toStage(event));
    if (!start) return;

    const stage = api.getStage();
    let k = 1;
    let turn = 0;
    let dx = 0;
    let dy = 0;

    if (start.mode === 'two' && pointers.size >= 2) {
      const now = twoFingerState();
      if (start.distance > 4) k = now.distance / start.distance;
      // Snap the angle the layer ENDS on, not the amount the fingers turned,
      // so a tilt lands on 15 degrees rather than 15 away from wherever it was.
      const wanted = start.lead.rotation + (now.angle - start.angle);
      turn = pullAngle(wanted) - start.lead.rotation;
      dx = (now.midX - start.midX) / stage.width;
      dy = (now.midY - start.midY) / stage.height;
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
    const pullX = pullTo(lead.x, start.xTargets, SNAP_REACH);
    const pullY = pullTo(lead.y, start.yTargets, SNAP_REACH);
    if (pullX || pullY) place(k, turn, dx + pullX, dy + pullY);

    snapped = {
      x: pullX !== 0,
      y: pullY !== 0,
      rotation: turn !== 0 && Math.abs(lead.rotation % SNAP_ANGLE) < 0.001,
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
    destroy() {
      element.removeEventListener('pointerdown', onDown);
      element.removeEventListener('pointermove', onMove);
      element.removeEventListener('pointerup', onUp);
      element.removeEventListener('pointercancel', onUp);
    },
  };
}
