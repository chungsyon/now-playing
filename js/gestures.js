/**
 * TOUCH EDITING
 * -------------
 * Tap a layer to select it. Drag one finger to move it, pinch with two to
 * resize, twist with two to rotate.
 *
 * Positions are stored as fractions of the slide (0 to 1), so a gesture on the
 * small preview means exactly the same thing at full export size.
 *
 * This file only works out what the fingers did. Drawing the selection outline
 * is the editor's job, on a separate canvas that sits on top, so nothing about
 * the selection ever reaches the exported video.
 */

import { valueAt } from './model.js';

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
    const props = layer.props;
    const base = {
      layer,
      x: valueAt(props.x, 0),
      y: valueAt(props.y, 0),
      scale: valueAt(props.scale, 0),
      rotation: valueAt(props.rotation, 0),
    };
    if (pointers.size >= 2) {
      start = { ...base, mode: 'two', ...twoFingerState() };
    } else {
      const only = [...pointers.values()][0];
      start = { ...base, mode: 'one', midX: only.x, midY: only.y };
    }
  };

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
    const props = start.layer.props;

    if (start.mode === 'two' && pointers.size >= 2) {
      const now = twoFingerState();
      if (start.distance > 4) {
        props.scale = Math.max(0.02, start.scale * (now.distance / start.distance));
      }
      props.rotation = start.rotation + (now.angle - start.angle);
      props.x = start.x + (now.midX - start.midX) / stage.width;
      props.y = start.y + (now.midY - start.midY) / stage.height;
    } else if (start.mode === 'one') {
      const only = [...pointers.values()][0];
      props.x = start.x + (only.x - start.midX) / stage.width;
      props.y = start.y + (only.y - start.midY) / stage.height;
    }

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
    if (pointers.size === 0) start = null;
    else beginGesture();          // a finger lifted: carry on with what is left
  };

  element.addEventListener('pointerdown', onDown);
  element.addEventListener('pointermove', onMove);
  element.addEventListener('pointerup', onUp);
  element.addEventListener('pointercancel', onUp);

  return {
    destroy() {
      element.removeEventListener('pointerdown', onDown);
      element.removeEventListener('pointermove', onMove);
      element.removeEventListener('pointerup', onUp);
      element.removeEventListener('pointercancel', onUp);
    },
  };
}
