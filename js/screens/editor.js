/**
 * EDITOR
 * ------
 * The preview at the top, a loop bar under it, and a sheet of controls at the
 * bottom. The preview is drawn at a smaller size than the export, by the same
 * render function, so what you line up here is what comes out.
 */

import {
  h, clear, icon, iconButton, sliderRow, segmented, toast, loopTimer,
  sectionHead, section, footnote, switchRow, emptyState,
} from '../ui.js';
import {
  TEMPLATES, applyTemplate, valueAt, findLayer, formatTime,
  actualRpm, LOOP_MIN, LOOP_MAX, LAYER_LABELS, toStyle, movesWith,
  isKeyed, keyIndexAt, setValueAt, toggleKeyAt, moveKeyAt,
} from '../model.js';
import { EFFECTS, makeEffect } from '../effects.js';
import { Stage, render } from '../render.js';
import { FPS, bitrateFor } from '../export.js';
import { attachGestures, layerBounds, handleRadius, fitToSlide, setCard } from '../gestures.js';
import { putStyle } from '../db.js';
import { asRoomColour, dedupeHex } from '../color.js';

/**
 * How wide the slide is allowed to be drawn. On a phone the screen decides
 * long before this does; on a desktop or a sideways tablet it is this.
 */
function previewCap() {
  return window.innerWidth >= 1024 ? 900 : 560;
}

let stage = null;
let previewCanvas = null;
let previewCtx = null;
let overlay = null;
let overlayCtx = null;
let gestures = null;
let frameHandle = null;
let playing = false;
let playStart = 0;
let timer = null;
let sheetBody = null;
let activeTab = 'layers';
let currentApp = null;
let onResize = null;
let onKey = null;
let pendingDraw = 0;
let playButtonRef = null;
// Everything on the sheet that shows a value at the current moment: told
// every time the moment changes, by playing, scrubbing or jumping to a key.
let timeWatchers = [];
// Strips that need redrawing when a gesture records a keyframe.
let keyRefreshers = [];

// ---------------------------------------------------------------------------

export async function enter(root, app) {
  currentApp = app;
  clear(root);

  const preview = h('canvas', { 'aria-label': 'Preview of the slide' });
  overlay = h('canvas', { class: 'stagewrap__overlay' });
  overlayCtx = overlay.getContext('2d');

  const stagewrap = h('div', { class: 'stagewrap' }, preview, overlay);
  const stageArea = h('div', { class: 'editor-stage' }, stagewrap);

  timer = loopTimer();
  const sizeRead = h('span', { class: 'transport__size' },
    `${app.state.project.aspect.w}×${app.state.project.aspect.h}`);

  const playButton = iconButton('play', 'Play the loop', () => togglePlay(playButton));
  playButtonRef = playButton;
  attachScrub(app, timer);

  sheetBody = h('div', { class: 'sheet__body' });
  const tabSwitch = segmented([
    { value: 'layers', label: 'Layers' },
    { value: 'effects', label: 'Effects' },
    { value: 'animation', label: 'Motion' },
    { value: 'song', label: 'Song' },
  ], activeTab, value => {
    activeTab = value;
    tabSwitch.select(value);
    buildSheet(app);
    sheetBody.scrollTop = 0;
  }, 'Controls');
  const tabs = h('div', { class: 'sheet__tabs' }, tabSwitch);

  root.classList.add('screen--editor');
  root.append(
    stageArea,
    h('div', { class: 'transport' },
      playButton,
      timer.node,
      sizeRead,
    ),
    h('div', { class: 'sheet' }, tabs, sheetBody),
  );

  // The sheet is filled first: the preview is sized from the room left over,
  // so the room has to be real before it is measured.
  buildSheet(app);
  buildStage(app, preview);

  // The available height changes when the address bar hides or the phone
  // turns. iOS slides that bar a pixel at a time and fires this the whole
  // way, so it waits for the sliding to stop: rebuilding the stage means
  // throwing away canvases and making new ones.
  let resizeTimer = null;
  onResize = () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => buildStage(app, preview), 120);
  };
  window.addEventListener('resize', onResize);
  window.addEventListener('orientationchange', onResize);

  gestures = attachGestures(overlay, {
    getProject: () => app.state.project,
    getStage: () => stage,
    getSelectedId: () => app.state.selectedLayerId,
    onSelect: id => {
      app.state.selectedLayerId = id;
      if (activeTab === 'effects' || activeTab === 'layers') buildSheet(app);
      drawOnce(app);
    },
    onChange: () => {
      app.save();
      drawOnce(app);
      // Keyframes a drag just recorded show up on the strips straight away.
      for (const refresh of keyRefreshers) refresh();
    },
    getTime: () => currentTime(app),
    onStart: pause,
  });

  // Arrow keys nudge the selection. Listening on the window rather than the
  // canvas means it works without clicking the slide first, which is what
  // anyone with a keyboard expects.
  onKey = event => {
    const STEPS = {
      ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1],
    };
    const step = STEPS[event.key];
    if (!step) return;
    // Not while something is being typed into.
    const target = event.target;
    if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
    if (!app.state.selectedLayerId) return;

    const far = event.shiftKey ? 0.02 : 0.004;
    if (gestures.nudge(step[0] * far, step[1] * far)) event.preventDefault();
  };
  window.addEventListener('keydown', onKey);

  // Start paused when the phone asks for less movement.
  if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    togglePlay(playButton);
  } else {
    drawOnce(app);
  }
}

export function leave() {
  stopLoop();
  timer = null;
  if (onResize) {
    window.removeEventListener('resize', onResize);
    window.removeEventListener('orientationchange', onResize);
    onResize = null;
  }
  if (onKey) {
    window.removeEventListener('keydown', onKey);
    onKey = null;
  }
  previewCanvas = null;
  previewCtx = null;
  playButtonRef = null;
  timeWatchers = [];
  keyRefreshers = [];
  if (gestures) gestures.destroy();
  gestures = null;
  if (stage) stage.dispose();
  stage = null;
}

/** Called by the app when the ratio or the media changes underneath us. */
export function rebuild(app) {
  if (!previewCanvas) return;
  buildStage(app, previewCanvas);
  buildSheet(app);
}

// ---------------------------------------------------------------------------
// The preview canvas
// ---------------------------------------------------------------------------

function buildStage(app, preview) {
  const project = app.state.project;
  const wrap = preview.parentElement;
  const area = wrap.parentElement;

  // Fit the slide into whatever room is left, on both sides. Doing the sums
  // here rather than in CSS means the whole slide is always visible: nothing
  // ever disappears behind the sheet.
  const ratio = project.aspect.h / project.aspect.w;
  // clientWidth and clientHeight include the padding round the slide, which
  // is room the slide must not take.
  const pad = getComputedStyle(area);
  const padX = parseFloat(pad.paddingLeft) + parseFloat(pad.paddingRight);
  const padY = parseFloat(pad.paddingTop) + parseFloat(pad.paddingBottom);
  const roomWidth = Math.min(previewCap(), (area.clientWidth || 340) - padX);
  const roomHeight = Math.max(160, (area.clientHeight || 360) - padY);
  const cssWidth = Math.floor(Math.min(roomWidth, roomHeight / ratio));
  const cssHeight = Math.round(cssWidth * ratio);

  wrap.style.width = `${cssWidth}px`;
  wrap.style.height = `${cssHeight}px`;

  // Cap the working size so a phone is not drawing a 1080px frame sixty times
  // a second. Everything is stored as a fraction, so this changes nothing but
  // the sharpness of the preview.
  const width = Math.min(project.aspect.w,
    Math.round(cssWidth * Math.min(2, window.devicePixelRatio || 1)));
  const height = Math.round(width * ratio);

  // Within a few pixels, keep what is already there. The slide is drawn from
  // fractions, so a stage two pixels off shows the same picture.
  if (stage && Math.abs(stage.width - width) <= 4 && Math.abs(stage.height - height) <= 4) {
    drawOnce(app);
    return;
  }
  if (stage) stage.dispose();
  stage = new Stage(width, height, app.state.media);

  preview.width = width;
  preview.height = height;
  overlay.width = width;
  overlay.height = height;

  previewCanvas = preview;
  previewCtx = preview.getContext('2d');
  drawOnce(app);
}

/**
 * Ask for a redraw. Several asks in one frame are one redraw.
 *
 * A finger on an iPhone reports up to a hundred and twenty times a second,
 * and every report used to redraw the slide there and then. That is two or
 * three full frames of work inside one frame of screen time, which is what a
 * drag felt like: the picture arriving behind the thumb.
 */
function drawOnce(app) {
  if (!stage || pendingDraw) return;
  pendingDraw = requestAnimationFrame(() => {
    pendingDraw = 0;
    paintNow(app);
  });
}

function paintNow(app) {
  if (!stage) return;
  stage.media = app.state.media;
  const t = playing ? loopPosition(app) : app.state.previewTime || 0;
  render(stage, app.state.project, t);
  previewCtx.drawImage(stage.canvas, 0, 0);
  drawSelection(app, t);
  paintLoopBar(app, t);
  for (const watch of timeWatchers) watch(t);
}

/** The moment the slide is showing. */
function currentTime(app) {
  return playing ? loopPosition(app) : app.state.previewTime || 0;
}

/** Stop where it is. Editing a value means editing it at one moment. */
function pause() {
  if (playing && playButtonRef) togglePlay(playButtonRef);
}

/** Go to a moment and stay there. */
function seek(app, t) {
  pause();
  app.state.previewTime = Math.max(0, Math.min(app.state.project.loopSeconds, t));
  drawOnce(app);
}

/**
 * The loop bar is a scrubber. The finger is followed from the moment it
 * lands, and keeps being followed if it slides off the bar.
 */
function attachScrub(app, timer) {
  const at = event => {
    const rect = timer.track.getBoundingClientRect();
    const fraction = Math.min(1, Math.max(0, (event.clientX - rect.left) / (rect.width || 1)));
    seek(app, fraction * app.state.project.loopSeconds);
  };
  // Held is tracked here rather than asked of the capture: capturing can
  // fail, and the scrub should still work when it does.
  let held = false;
  timer.node.addEventListener('pointerdown', event => {
    held = true;
    try { timer.node.setPointerCapture(event.pointerId); } catch { /* not capturable */ }
    timer.node.classList.add('is-scrubbing');
    at(event);
  });
  timer.node.addEventListener('pointermove', event => {
    if (held) at(event);
  });
  const end = () => {
    held = false;
    timer.node.classList.remove('is-scrubbing');
  };
  timer.node.addEventListener('pointerup', end);
  timer.node.addEventListener('pointercancel', end);
}

/**
 * KEYFRAMES ON THE SHEET
 * A track is one or more values that are keyframed together: a blur radius
 * on its own, or x and y for a position, across every layer that moves with
 * the selection. Each value is [holder, key], so `holder[key]` is either a
 * number or { keyframes }.
 *
 * The ◆ adds a keyframe at the playhead or takes away the one there. The
 * strip shows the keyframes along the loop: tap one to go to it, drag it to
 * move it in time.
 */
function keyTrack(app, { label, pairs, fallback = 0, onChange = () => {} }) {
  const lead = () => pairs()[0];
  const leadProp = () => { const [holder, key] = lead(); return holder[key]; };

  const changed = () => {
    paintMarks();
    app.save();
    drawOnce(app);
    onChange();
  };

  const diamond = h('button', { class: 'btn btn--icon key', type: 'button' });
  diamond.addEventListener('click', () => {
    pause();
    const t = currentTime(app);
    const on = keyIndexAt(leadProp(), t) >= 0;
    for (const [holder, key] of pairs()) {
      // All of them follow the lead: on together, off together.
      if ((keyIndexAt(holder[key], t) >= 0) === on) toggleKeyAt(holder, key, t, fallback);
    }
    changed();
  });

  const strip = h('div', { class: 'keys', hidden: true });
  const head = h('span', { class: 'keys__head' });

  function paintMarks() {
    clear(strip);
    const prop = leadProp();
    strip.hidden = !isKeyed(prop);
    if (strip.hidden) return;
    for (const frame of prop.keyframes) strip.append(markFor(frame.t));
    strip.append(head);
    watch(currentTime(app));
  }

  // A keyframe on the strip. It follows the finger 1:1 from the moment it
  // moves; a touch that never moves is a tap, and goes to it.
  function markFor(t) {
    const loop = app.state.project.loopSeconds;
    const mark = h('button', {
      class: 'keys__mark',
      type: 'button',
      'aria-label': `${label} keyframe at ${t.toFixed(1)} seconds. Click to delete, drag to move`,
      style: { left: `${Math.min(100, (t / loop) * 100)}%` },
    });
    let at = t;
    let downX = 0;
    let held = false;
    let dragging = false;
    mark.addEventListener('pointerdown', event => {
      held = true;
      try { mark.setPointerCapture(event.pointerId); } catch { /* not capturable */ }
      downX = event.clientX;
      dragging = false;
      pause();
    });
    mark.addEventListener('pointercancel', () => { held = false; });
    mark.addEventListener('pointermove', event => {
      if (!held) return;
      if (!dragging && Math.abs(event.clientX - downX) < 4) return;
      dragging = true;
      const rect = strip.getBoundingClientRect();
      const fraction = Math.min(1, Math.max(0, (event.clientX - rect.left) / (rect.width || 1)));
      const to = Math.round(fraction * loop * 10) / 10;
      if (to === at) return;
      for (const [holder, key] of pairs()) moveKeyAt(holder, key, at, to);
      at = to;
      mark.style.left = `${(to / loop) * 100}%`;
      seek(app, to);
    });
    mark.addEventListener('pointerup', () => {
      if (!held) return;
      held = false;
      if (!dragging) {
        // A click, not a drag: take the keyframe away. Undo brings it back.
        for (const [holder, key] of pairs()) {
          if (keyIndexAt(holder[key], at) >= 0) toggleKeyAt(holder, key, at, fallback);
        }
      }
      changed();
    });
    return mark;
  }

  function watch(t) {
    const on = keyIndexAt(leadProp(), t) >= 0;
    if (diamond.dataset.on !== String(on)) {
      diamond.dataset.on = String(on);
      clear(diamond).append(icon(on ? 'diamond-fill' : 'diamond'));
      diamond.setAttribute('aria-pressed', String(on));
      diamond.setAttribute('aria-label', on ? `Remove the ${label} keyframe here` : `Add a ${label} keyframe here`);
    }
    if (isKeyed(leadProp())) head.style.left = `${(t / app.state.project.loopSeconds) * 100}%`;
  }

  timeWatchers.push(watch);
  keyRefreshers.push(paintMarks);
  paintMarks();
  return { diamond, strip, paintMarks };
}

/**
 * A slider whose value can be keyframed. One value (`holder`, `key`), or
 * several moved together (`pairs`), such as the opacity of a whole group.
 */
function keyedSlider(app, { label, holder, key, pairs, min, max, step, fallback, format }) {
  const all = pairs || (() => [[holder, key]]);
  const read = t => { const [h0, k0] = all()[0]; return valueAt(h0[k0], t) ?? fallback; };
  const keyed = () => { const [h0, k0] = all()[0]; return isKeyed(h0[k0]); };
  const row = sliderRow({
    label, min, max, step,
    value: read(currentTime(app)),
    format,
    onInput: value => {
      pause();
      const t = currentTime(app);
      for (const [h0, k0] of all()) setValueAt(h0, k0, t, value);
      track.paintMarks();
      app.save();
      drawOnce(app);
    },
  });
  const track = keyTrack(app, {
    label, fallback,
    pairs: all,
    onChange: () => row.set(read(currentTime(app))),
  });
  row.head.append(track.diamond);
  // While it plays, the slider follows the keyframes.
  timeWatchers.push(t => { if (keyed()) row.set(read(t)); });
  return h('div', {}, row, track.strip);
}


function loopPosition(app) {
  const loop = app.state.project.loopSeconds;
  return ((performance.now() - playStart) / 1000) % loop;
}

function paintLoopBar(app, t) {
  if (timer) timer.set(t, app.state.project.loopSeconds);
}

function togglePlay(button) {
  const app = currentApp;
  playing = !playing;
  clear(button).append(icon(playing ? 'pause' : 'play'));
  button.setAttribute('aria-label', playing ? 'Pause the loop' : 'Play the loop');
  if (playing) {
    playStart = performance.now() - (app.state.previewTime || 0) * 1000;
    // The file is thirty frames a second, so the preview is too. Drawing at
    // the screen's rate instead would be twice the work to show the same
    // thing, and on a phone that is the difference between smooth and not.
    let lastPaint = 0;
    const tick = now => {
      if (!playing) return;
      if (now - lastPaint >= 1000 / FPS - 1) {
        lastPaint = now;
        paintNow(app);
      }
      frameHandle = requestAnimationFrame(tick);
    };
    frameHandle = requestAnimationFrame(tick);
  } else {
    app.state.previewTime = loopPosition(app);
    stopLoop();
    drawOnce(app);
  }
}

function stopLoop() {
  playing = false;
  if (frameHandle) cancelAnimationFrame(frameHandle);
  frameHandle = null;
  if (pendingDraw) cancelAnimationFrame(pendingDraw);
  pendingDraw = 0;
}

/** The selection outline lives on its own canvas, so it never reaches the file. */
function drawSelection(app, t) {
  const ctx = overlayCtx;
  ctx.clearRect(0, 0, overlay.width, overlay.height);
  const layer = findLayer(app.state.project, app.state.selectedLayerId);
  if (!layer || layer.locked || !layer.visible) return;

  drawGroupBox(app, layer, t);
  drawGuides(app, t);

  // The same box gestures.js hit-tests, so a corner dot is grabbable exactly
  // where it is drawn.
  const { cx, cy, w, h, rotation } = layerBounds(layer, app.state.project, stage, t);

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate((rotation * Math.PI) / 180);
  // White with a soft shadow, the way Photos draws a crop box: it reads on
  // a light photo and a dark one alike.
  ctx.shadowColor = 'rgba(0, 0, 0, 0.45)';
  ctx.shadowBlur = Math.max(2, stage.width * 0.006);
  ctx.strokeStyle = '#FFFFFF';
  ctx.lineWidth = Math.max(1.5, stage.width * 0.003);
  ctx.strokeRect(-w / 2, -h / 2, w, h);

  const handle = handleRadius(stage);
  ctx.fillStyle = '#FFFFFF';
  for (const [hx, hy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    ctx.beginPath();
    ctx.arc((hx * w) / 2, (hy * h) / 2, handle, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

/**
 * A faint box round everything that will move with this layer, so it is
 * obvious before you touch it that the furniture travels as one piece.
 * Only drawn when there is more than one thing in it.
 */
function drawGroupBox(app, layer, t) {
  const members = movesWith(app.state.project, layer);
  if (members.length < 2) return;

  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const member of members) {
    // The widest the box can be once turned: good enough for a hint.
    const b = layerBounds(member, app.state.project, stage, t);
    const reach = Math.max(b.w, b.h) / 2;
    left = Math.min(left, b.cx - reach);
    right = Math.max(right, b.cx + reach);
    top = Math.min(top, b.cy - reach);
    bottom = Math.max(bottom, b.cy + reach);
  }

  const ctx = overlayCtx;
  ctx.save();
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
  ctx.lineWidth = Math.max(1, stage.width * 0.002);
  ctx.setLineDash([stage.width * 0.012, stage.width * 0.01]);
  ctx.strokeRect(left, top, right - left, bottom - top);
  ctx.restore();
}

/** The lines a gesture has just snapped onto. They live only while it lasts. */
function drawGuides(app, t) {
  if (!gestures) return;
  const on = gestures.snapped();
  if (!on.x && !on.y && !on.rotation) return;

  const ctx = overlayCtx;
  const layer = findLayer(app.state.project, app.state.selectedLayerId);
  ctx.save();
  // Alignment guides in yellow, like Keynote's.
  ctx.strokeStyle = '#FFD60A';
  ctx.lineWidth = Math.max(1, stage.width * 0.003);

  if (on.x) {
    const x = valueAt(layer.props.x, t) * stage.width;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, stage.height);
    ctx.stroke();
  }
  if (on.y) {
    const y = valueAt(layer.props.y, t) * stage.height;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(stage.width, y);
    ctx.stroke();
  }
  if (on.rotation) {
    // The angle it landed on, written beside the layer.
    const size = Math.max(11, stage.width * 0.035);
    ctx.font = `600 ${size}px system-ui, -apple-system, sans-serif`;
    ctx.fillStyle = '#FFD60A';
    ctx.textAlign = 'center';
    ctx.fillText(
      `${Math.round(valueAt(layer.props.rotation, t))}\u00B0`,
      valueAt(layer.props.x, t) * stage.width,
      valueAt(layer.props.y, t) * stage.height - size,
    );
  }
  ctx.restore();
}

// ---------------------------------------------------------------------------
// The bottom sheet
// ---------------------------------------------------------------------------

function buildSheet(app) {
  clear(sheetBody);
  timeWatchers = [];
  keyRefreshers = [];
  const build = { layers: layersTab, effects: effectsTab, animation: animationTab, song: songTab };
  build[activeTab](sheetBody, app);
}

// --- Layers ----------------------------------------------------------------

function layersTab(box, app) {
  const project = app.state.project;
  const photo = project.layers.find(l => l.type === 'photo');

  // Background
  const backgroundValue = photo.props.mode === 'solid'
    ? 'solid'
    : photo.effects.some(e => e.type === 'blur') ? 'blur' : 'photo';

  const swatches = h('div', { class: 'swatches', role: 'group', 'aria-label': 'Background colour', hidden: backgroundValue !== 'solid' });
  const paintSwatches = () => {
    clear(swatches);
    // Dim first, then merge: pulling colours down to the same darkness is what
    // makes near-copies of each other out of colours that started apart.
    const source = project.palette.length ? project.palette : ['#2A2724'];
    // Wrapped in an arrow on purpose: passing asRoomColour straight to map
    // would hand it the array index as its second argument.
    const colours = dedupeHex(source.map(hex => asRoomColour(hex)), 14);
    for (const dimmed of colours) {
      const button = h('button', {
        type: 'button',
        'aria-pressed': String(photo.props.solidColor === dimmed),
        'aria-label': `Background colour ${dimmed}`,
        style: { background: dimmed },
        onclick: () => {
          photo.props.solidColor = dimmed;
          paintSwatches();
          app.save();
          drawOnce(app);
        },
      });
      swatches.append(button);
    }
  };
  paintSwatches();

  // How soft the photo is, shown only while it is the blurred background.
  // Written into rather than rebuilt, so the drag never drops.
  const blurSpec = EFFECTS.blur.params.radius;
  const blurBox = h('div', { class: 'group group--pad', hidden: backgroundValue !== 'blur' });
  const paintBlur = () => {
    clear(blurBox);
    const blur = photo.effects.find(e => e.type === 'blur');
    if (!blur) return;
    blurBox.append(keyedSlider(app, {
      label: 'Blur amount',
      holder: blur.params, key: 'radius',
      min: blurSpec.min, max: blurSpec.max, step: blurSpec.step,
      fallback: blurSpec.default,
      format: value => String(value),
    }));
    blurBox.append(h('p', { class: 'footnote', style: { padding: '8px 0 0' } },
      'Drag the bar under the slide to a moment, then tap \u25C6 to keyframe the blur there.'));
  };
  paintBlur();

  const background = segmented([
    { value: 'photo', label: 'Photo' },
    { value: 'blur', label: 'Blurred' },
    { value: 'solid', label: 'Colour' },
  ], backgroundValue, value => {
    photo.props.mode = value === 'solid' ? 'solid' : 'photo';
    photo.effects = photo.effects.filter(e => e.type !== 'blur');
    if (value === 'blur') photo.effects.unshift({ type: 'blur', params: { radius: 34 } });
    if (value === 'solid' && !photo.props.solidColor) {
      photo.props.solidColor = asRoomColour(project.palette[0] || '#2A2724');
    }
    swatches.hidden = value !== 'solid';
    blurBox.hidden = value !== 'blur';
    background.select(value);
    paintSwatches();
    paintBlur();
    app.save();
    drawOnce(app);
  }, 'Background');

  const groupNote = footnote('');
  const toggle = (label, checked, onChange) => switchRow(label, checked, on => {
    onChange(on);
    app.save();
    drawOnce(app);
  });

  box.append(
    section('Background', h('div', { class: 'section', style: { gap: '10px' } }, background, blurBox, swatches)),

    section('Arrange',
      h('div', { class: 'group' },
        toggle('Show cover', project.showCover, on => { project.showCover = on; }),
        // The frosted pane behind the furniture. Any template can have one.
        switchRow('Glass card', project.layers.some(l => l.type === 'card'), on => {
          setCard(project, on, currentTime(app));
          app.save();
          buildSheet(app);
          drawOnce(app);
        }),
        toggle('Move together', project.grouped !== false, on => {
          project.grouped = on;
          groupNote.textContent = groupText();
        }),
      ),
      groupNote,
    ),
  );
  // Written into rather than rebuilt, so the switch keeps sliding.
  const groupText = () => (project.grouped === false
    ? 'Drag any layer and only that layer moves.'
    : 'Cover, words and bar move as one, keeping their spacing. Lock one to leave it behind.')
    // Said only where it applies. A finger pinches and twists and needs no
    // telling; a mouse has to be shown the corners.
    + (window.matchMedia('(pointer: fine)').matches
      ? ' Drag a corner to resize, just outside one to turn. Arrow keys nudge, Shift for bigger steps.'
      : '');
  groupNote.textContent = groupText();

  // Keyframes for where the selection is and how big. They apply to
  // everything that moves with it, so a grouped arrangement animates as one.
  const selected = findLayer(project, app.state.selectedLayerId);
  if (selected && selected.type !== 'photo' && !selected.locked) {
    const members = () => movesWith(project, selected);
    const keyRow = (label, keys) => {
      const track = keyTrack(app, {
        label,
        pairs: () => members().flatMap(layer => keys.map(key => [layer.props, key])),
      });
      return h('div', { class: 'row', style: { flexDirection: 'column', alignItems: 'stretch', gap: '0' } },
        h('div', { style: { display: 'flex', alignItems: 'center' } },
          h('span', { class: 'row__main' }, label), track.diamond),
        track.strip);
    };
    box.append(section(sectionHead('Animate', members().length > 1 ? `${selected.name} and group` : selected.name),
      h('div', { class: 'group' },
        keyRow('Position', ['x', 'y']),
        keyRow('Size', ['scale']),
        keyRow('Rotation', ['rotation']),
        h('div', { class: 'group--pad' }, keyedSlider(app, {
          label: 'Opacity',
          pairs: () => members().map(layer => [layer.props, 'opacity']),
          min: 0, max: 1, step: 0.01, fallback: 1,
          format: value => `${Math.round(value * 100)}%`,
        })),
      ),
      footnote('Drag the bar under the slide to a moment and tap \u25C6, then move, resize or '
        + 'turn the layer at another moment. Drag a keyframe to change when it happens; '
        + 'click one to delete it.'),
    ));
  }

  // The list, topmost first, which is how it looks on the slide.
  const rows = h('div', { class: 'group' });
  for (const layer of [...project.layers].reverse()) {
    const select = h('button', {
      class: 'row' + (layer.id === app.state.selectedLayerId ? ' is-selected' : ''),
      type: 'button',
      onclick: () => {
        app.state.selectedLayerId = layer.locked ? null : layer.id;
        buildSheet(app);
        drawOnce(app);
      },
    },
      h('span', { class: 'row__main', style: { opacity: layer.visible ? '1' : '0.45' } },
        h('span', { class: 'row__title' }, layer.name),
        h('span', { class: 'row__sub' },
          [LAYER_LABELS[layer.type], layer.effects.length
            ? `${layer.effects.length} effect${layer.effects.length > 1 ? 's' : ''}` : null]
            .filter(Boolean).join(' · ')),
      ),
    );

    const visibility = iconButton(
      layer.visible ? 'eye' : 'eye-slash',
      layer.visible ? `Hide ${layer.name}` : `Show ${layer.name}`,
      () => {
        layer.visible = !layer.visible;
        app.save();
        buildSheet(app);
        drawOnce(app);
      },
    );
    const lock = iconButton(
      layer.locked ? 'lock-simple' : 'lock-simple-open',
      layer.locked ? `Unlock ${layer.name}` : `Lock ${layer.name}`,
      () => {
        layer.locked = !layer.locked;
        if (layer.locked && app.state.selectedLayerId === layer.id) app.state.selectedLayerId = null;
        app.save();
        buildSheet(app);
        drawOnce(app);
      },
    );

    rows.append(h('div', { class: 'row-wrap' }, select, visibility, lock));
  }

  box.append(
    section(sectionHead('Layers', String(project.layers.length)), rows),
    h('button', {
      class: 'btn btn--block',
      type: 'button',
      onclick: async () => {
        const name = `${TEMPLATES[project.template].label} ${new Date().toLocaleDateString()}`;
        await putStyle(toStyle(project, name));
        toast('Look saved to your styles.');
      },
    }, icon('swatches', { size: 'sm' }), 'Save Look as Style'),
  );
}

// --- Effects ---------------------------------------------------------------

function effectsTab(box, app) {
  const project = app.state.project;
  const layer = findLayer(project, app.state.selectedLayerId)
    || project.layers.find(l => l.type === 'photo');

  box.append(footnote(`Effects on ${layer.name}, applied from the top down.`));
  box.lastChild.style.padding = '0 4px';

  if (layer.effects.length === 0) {
    box.append(emptyState('No effects on this layer yet.'));
  }

  layer.effects.forEach((effect, index) => {
    const spec = EFFECTS[effect.type];
    if (!spec) return;

    const controls = h('div', { class: 'group--pad', style: { display: 'flex', flexDirection: 'column', gap: '10px', paddingTop: '0' } });
    for (const [key, def] of Object.entries(spec.params)) {
      controls.append(keyedSlider(app, {
        label: def.label,
        holder: effect.params, key,
        min: def.min, max: def.max, step: def.step,
        fallback: def.default,
        format: value => (def.step < 1 ? value.toFixed(2) : String(value)),
      }));
    }

    const move = direction => {
      const target = index + direction;
      if (target < 0 || target >= layer.effects.length) return;
      const [item] = layer.effects.splice(index, 1);
      layer.effects.splice(target, 0, item);
      app.save();
      buildSheet(app);
      drawOnce(app);
    };

    box.append(h('div', { class: 'group' },
      h('div', { class: 'effect__head' },
        h('span', { class: 'effect__name' }, spec.label),
        index > 0 ? iconButton('caret-up', `Move ${spec.label} earlier`, () => move(-1)) : null,
        index < layer.effects.length - 1
          ? iconButton('caret-down', `Move ${spec.label} later`, () => move(1)) : null,
        iconButton('x', `Remove ${spec.label}`, () => {
          layer.effects.splice(index, 1);
          app.save();
          buildSheet(app);
          drawOnce(app);
        }),
      ),
      controls,
    ));
  });

  const adders = h('div', { class: 'chips' });
  for (const [type, spec] of Object.entries(EFFECTS)) {
    adders.append(h('button', {
      class: 'chip',
      type: 'button',
      onclick: () => {
        layer.effects.push(makeEffect(type));
        app.save();
        buildSheet(app);
        drawOnce(app);
      },
    }, icon('plus', { size: 'sm' }), spec.label));
  }
  box.append(section('Add effect', adders));
}

// --- Animation -------------------------------------------------------------

function animationTab(box, app) {
  const project = app.state.project;
  const disc = project.layers.find(l => l.type === 'disc');
  const bar = project.layers.find(l => l.type === 'progressBar');

  // Filled in below when there is a record; the loop slider calls it either way.
  let refreshDisc = () => {};
  const readout = footnote('');
  const showTurns = () => {
    if (!disc) return;
    const real = actualRpm(disc.props.rpm, project.loopSeconds);
    readout.textContent =
      `Rounded to ${Math.round((real / 60) * project.loopSeconds)} whole turns, `
      + `which is ${real.toFixed(1)} rpm. Whole turns are what let the loop close `
      + 'without a jump.';
  };

  // The readout and the note are written into, never rebuilt. Rebuilding the
  // sheet from inside onInput throws away the slider the thumb is holding, so
  // the drag stopped dead after one step.
  const loopNote = footnote('');
  const showLoop = () => {
    const seconds = project.loopSeconds;
    const rate = (bitrateFor(seconds) / 1e6).toFixed(1);
    const megabytes = Math.round((bitrateFor(seconds) * seconds) / 8 / 1e6);
    loopNote.textContent = seconds > 60
      ? `${Math.round(seconds * FPS)} frames at ${rate} Mbps, about ${megabytes} MB. `
        + 'Longer than a minute is a Reel, not a carousel slide.'
      : `${Math.round(seconds * FPS)} frames at ${FPS} a second, `
        + `${rate} Mbps, about ${megabytes} MB.`;
  };
  showLoop();

  box.append(
    section('Loop',
      h('div', { class: 'group group--pad' },
        sliderRow({
          label: 'Length',
          min: LOOP_MIN, max: LOOP_MAX, step: 1,
          value: project.loopSeconds,
          format: value => `${value} s`,
          onInput: value => {
            project.loopSeconds = value;
            showLoop();
            refreshDisc();
            app.save();
            drawOnce(app);
          },
        }),
      ),
      loopNote,
    ),
  );

  if (disc) {
    const discValue = h('span', { class: 'section__value' });
    const showDisc = () => {
      showTurns();
      discValue.textContent =
        `${Math.round(actualRpm(disc.props.rpm, project.loopSeconds))} rpm`;
    };
    showDisc();
    refreshDisc = showDisc;

    const direction = segmented([
      { value: 1, label: 'Clockwise' },
      { value: -1, label: 'Anticlockwise' },
    ], disc.props.direction, value => {
      disc.props.direction = value;
      direction.select(value);
      app.save();
      drawOnce(app);
    }, 'Direction');

    box.append(
      section(h('p', { class: 'section__head' }, h('span', {}, 'Record'), discValue),
        h('div', { class: 'group group--pad' },
          sliderRow({
            label: 'Speed',
            min: 8, max: 90, step: 1,
            value: disc.props.rpm,
            format: value => `${value} rpm`,
            onInput: value => {
              disc.props.rpm = value;
              showDisc();
              app.save();
              drawOnce(app);
            },
          }),
          direction,
        ),
        readout,
      ),
    );
  }

  if (bar) {
    const speed = segmented([
      { value: 1, label: 'Real time' },
      { value: 4, label: '4×' },
      { value: 12, label: '12×' },
    ], bar.props.speed, value => {
      bar.props.speed = value;
      speed.select(value);
      app.save();
      drawOnce(app);
    }, 'Progress speed');

    box.append(
      section('Progress bar',
        speed,
        footnote('Real time matches the song. Faster makes the movement easy to see in a ' +
          'short loop.'),
      ),
    );
  }
}

// --- Song ------------------------------------------------------------------

function songTab(box, app) {
  const project = app.state.project;
  const song = project.song;
  const total = Math.max(1, Math.round((song.durationMs || 0) / 1000));
  const cover = app.state.media.cover;

  const art = h('canvas', { class: 'art', width: 96, height: 96 });
  if (cover) art.getContext('2d').drawImage(cover, 0, 0, 96, 96);

  const card = h('div', { class: 'group' },
    h('button', {
      class: 'row',
      type: 'button',
      onclick: () => app.go('song'),
    },
      art,
      h('span', { class: 'row__main' },
        h('span', { class: 'row__title' }, song.title || 'No song yet'),
        h('span', { class: 'row__sub' },
          [song.artist, song.album, song.year].filter(Boolean).join(' · ') || 'Choose one to begin'),
      ),
      h('span', { class: 'row__value' }, song.title ? 'Change' : 'Choose'),
      icon('caret-right', { size: 'sm' }),
    ),
  );
  card.querySelector('.icon').classList.add('icon--chevron');

  box.append(section('Song', card));

  if (song.title) {
    box.append(section('Clip',
      h('div', { class: 'group group--pad' },
        sliderRow({
          label: 'Starts at',
          min: 0, max: Math.max(1, total - 1), step: 1,
          value: Math.min(song.clipStartSeconds, total - 1),
          format: value => `${formatTime(value)} of ${formatTime(total)}`,
          onInput: value => {
            song.clipStartSeconds = value;
            app.save();
            drawOnce(app);
          },
        }),
      ),
    ));
  }
}

// ---------------------------------------------------------------------------
// The template switcher, which lives in the top bar
// ---------------------------------------------------------------------------

export function templateSwitcher(app) {
  const switcher = segmented(
    Object.values(TEMPLATES).map(t => ({ value: t.id, label: t.label })),
    app.state.project.template,
    value => {
      fitToSlide(applyTemplate(app.state.project, value));
      app.state.selectedLayerId = null;
      switcher.select(value);
      app.save();
      buildSheet(app);
      drawOnce(app);
    },
    'Template',
  );
  return switcher;
}

export function redraw(app) {
  drawOnce(app);
}
