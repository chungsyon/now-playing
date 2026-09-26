/**
 * EDITOR
 * ------
 * The preview at the top, a loop bar under it, and a sheet of controls at the
 * bottom. The preview is drawn at a smaller size than the export, by the same
 * render function, so what you line up here is what comes out.
 */

import { h, clear, icon, iconButton, sliderRow, segmented, toast, bottle, loopTimer } from '../ui.js';
import {
  TEMPLATES, applyTemplate, valueAt, findLayer, formatTime,
  actualRpm, LOOP_MIN, LOOP_MAX, LAYER_LABELS, toStyle, movesWith,
} from '../model.js';
import { EFFECTS, makeEffect } from '../effects.js';
import { Stage, render } from '../render.js';
import { FPS } from '../export.js';
import { attachGestures, layerBounds } from '../gestures.js';
import { putStyle } from '../db.js';
import { asRoomColour, dedupeHex } from '../color.js';

const PREVIEW_MAX_WIDTH = 560;

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

// ---------------------------------------------------------------------------

export async function enter(root, app) {
  currentApp = app;
  clear(root);

  const preview = h('canvas', { 'aria-label': 'Preview of the slide' });
  overlay = h('canvas', { class: 'stagewrap__overlay' });
  overlayCtx = overlay.getContext('2d');

  const stagewrap = h('div', { class: 'stagewrap develops' }, preview, overlay);
  const stageArea = h('div', { class: 'editor-stage' }, stagewrap);

  timer = loopTimer();
  const sizeRead = h('span', { class: 'timer__read' },
    `${app.state.project.aspect.w} x ${app.state.project.aspect.h}`);

  const playButton = iconButton('play', 'Play the loop', () => togglePlay(playButton));

  sheetBody = h('div', { class: 'sheet__body' });
  const tabs = h('div', { class: 'sheet__tabs', role: 'tablist' });
  for (const [id, label] of [
    ['layers', 'Layers'], ['effects', 'Effects'], ['animation', 'Animation'], ['song', 'Song'],
  ]) {
    tabs.append(h('button', {
      class: 'sheet__tab',
      type: 'button',
      role: 'tab',
      'aria-selected': String(activeTab === id),
      onclick: () => {
        activeTab = id;
        for (const tab of tabs.children) {
          tab.setAttribute('aria-selected', String(tab.textContent === label));
        }
        buildSheet(app);
      },
    }, label));
  }

  root.classList.add('screen--editor');
  root.append(
    stageArea,
    h('div', { class: 'loopbar' },
      playButton,
      timer.node,
      h('div', { class: 'grow' }),
      sizeRead,
    ),
    h('div', { class: 'sheet' }, tabs, sheetBody),
  );

  // The sheet is filled first: the preview is sized from the room left over,
  // so the room has to be real before it is measured.
  buildSheet(app);
  buildStage(app, preview);

  // The available height changes when the address bar hides or the phone turns.
  onResize = () => buildStage(app, preview);
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
    },
  });

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
  previewCanvas = null;
  previewCtx = null;
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
  const roomWidth = Math.min(PREVIEW_MAX_WIDTH, area.clientWidth || 340);
  const roomHeight = Math.max(160, area.clientHeight || 360);
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

  if (stage && stage.width === width && stage.height === height) {
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

function drawOnce(app) {
  if (!stage) return;
  stage.media = app.state.media;
  const t = playing ? loopPosition(app) : app.state.previewTime || 0;
  render(stage, app.state.project, t);
  previewCtx.drawImage(stage.canvas, 0, 0);
  drawSelection(app);
  paintLoopBar(app, t);
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
    const tick = () => {
      if (!playing) return;
      drawOnce(app);
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
}

/** The selection outline lives on its own canvas, so it never reaches the file. */
function drawSelection(app) {
  const ctx = overlayCtx;
  ctx.clearRect(0, 0, overlay.width, overlay.height);
  const layer = findLayer(app.state.project, app.state.selectedLayerId);
  if (!layer || layer.locked || !layer.visible) return;

  drawGroupBox(app, layer);
  drawGuides(app);

  const p = layer.props;
  const cx = valueAt(p.x, 0) * stage.width;
  const cy = valueAt(p.y, 0) * stage.height;
  const scale = valueAt(p.scale, 0);
  let w = stage.width * scale;
  let h = w;
  if (layer.type === 'text') {
    const size = stage.width * valueAt(p.size, 0) * scale;
    w = stage.width * 0.8;
    h = size * 1.8;
  } else if (layer.type === 'progressBar') {
    h = stage.width * 0.11;
  } else if (layer.type === 'controls') {
    h = w * 0.42;
  }

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate((valueAt(p.rotation, 0) * Math.PI) / 180);
  ctx.strokeStyle = '#F2A65A';
  ctx.lineWidth = Math.max(1.5, stage.width * 0.004);
  ctx.setLineDash([stage.width * 0.018, stage.width * 0.014]);
  ctx.strokeRect(-w / 2, -h / 2, w, h);

  ctx.setLineDash([]);
  const handle = Math.max(5, stage.width * 0.013);
  ctx.fillStyle = '#F2A65A';
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
function drawGroupBox(app, layer) {
  const members = movesWith(app.state.project, layer);
  if (members.length < 2) return;

  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const member of members) {
    // The widest the box can be once turned: good enough for a hint.
    const b = layerBounds(member, app.state.project, stage);
    const reach = Math.max(b.w, b.h) / 2;
    left = Math.min(left, b.cx - reach);
    right = Math.max(right, b.cx + reach);
    top = Math.min(top, b.cy - reach);
    bottom = Math.max(bottom, b.cy + reach);
  }

  const ctx = overlayCtx;
  ctx.save();
  ctx.strokeStyle = 'rgba(242, 166, 90, 0.34)';
  ctx.lineWidth = Math.max(1, stage.width * 0.002);
  ctx.strokeRect(left, top, right - left, bottom - top);
  ctx.restore();
}

/** The lines a gesture has just snapped onto. They live only while it lasts. */
function drawGuides(app) {
  if (!gestures) return;
  const on = gestures.snapped();
  if (!on.x && !on.y && !on.rotation) return;

  const ctx = overlayCtx;
  const layer = findLayer(app.state.project, app.state.selectedLayerId);
  ctx.save();
  ctx.strokeStyle = '#F2A65A';
  ctx.lineWidth = Math.max(1, stage.width * 0.003);

  if (on.x) {
    const x = valueAt(layer.props.x, 0) * stage.width;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, stage.height);
    ctx.stroke();
  }
  if (on.y) {
    const y = valueAt(layer.props.y, 0) * stage.height;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(stage.width, y);
    ctx.stroke();
  }
  if (on.rotation) {
    // The angle it landed on, written beside the layer.
    const size = Math.max(11, stage.width * 0.035);
    ctx.font = `${size}px ${'"DM Sans", system-ui, sans-serif'}`;
    ctx.fillStyle = '#F2A65A';
    ctx.textAlign = 'center';
    ctx.fillText(
      `${Math.round(valueAt(layer.props.rotation, 0))}\u00B0`,
      valueAt(layer.props.x, 0) * stage.width,
      valueAt(layer.props.y, 0) * stage.height - size,
    );
  }
  ctx.restore();
}

// ---------------------------------------------------------------------------
// The bottom sheet
// ---------------------------------------------------------------------------

function buildSheet(app) {
  clear(sheetBody);
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
        style: { background: dimmed, minWidth: '46px' },
        onclick: () => {
          photo.props.solidColor = dimmed;
          paintSwatches();
          app.save();
          drawOnce(app);
        },
      }, ' ');
      swatches.append(button);
    }
  };
  paintSwatches();

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
    background.select(value);
    paintSwatches();
    app.save();
    drawOnce(app);
  }, 'Background');

  box.append(
    bottle('Background'),
    background,
    swatches,
    h('div', { style: { height: '14px' } }),
  );

  // Cover on or off
  box.append(
    h('button', {
      class: 'btn btn--block',
      type: 'button',
      onclick: () => {
        project.showCover = !project.showCover;
        app.save();
        buildSheet(app);
        drawOnce(app);
      },
    },
      icon(project.showCover ? 'eye' : 'eye-slash', { size: 'sm' }),
      project.showCover ? 'Cover is showing' : 'Cover is hidden, colours only',
    ),
    h('div', { style: { height: '8px' } }),
    h('button', {
      class: 'btn btn--block',
      type: 'button',
      onclick: () => {
        project.grouped = project.grouped === false;
        app.save();
        buildSheet(app);
        drawOnce(app);
      },
    },
      icon(project.grouped === false ? 'frame-corners' : 'stack-simple', { size: 'sm' }),
      project.grouped === false
        ? 'Each layer moves on its own'
        : 'Cover, words and bar move as one',
    ),
    h('p', { class: 'body body--tight' },
      project.grouped === false
        ? 'Drag any layer and only that layer moves.'
        : 'Drag any of them and the whole arrangement follows, keeping its '
          + 'spacing. Lock one to leave it behind.'),
    h('div', { style: { height: '18px' } }),
    bottle('Layers', `${String(project.layers.length).padStart(2, '0')} total`),
  );

  // The list, topmost first, which is how it looks on the slide.
  const rows = h('div', { class: 'items' });
  for (const layer of [...project.layers].reverse()) {
    const select = h('button', {
      class: 'item' + (layer.id === app.state.selectedLayerId ? ' is-selected' : ''),
      type: 'button',
      onclick: () => {
        app.state.selectedLayerId = layer.locked ? null : layer.id;
        buildSheet(app);
        drawOnce(app);
      },
    },
      h('span', { class: 'item__main' },
        h('span', { class: 'item__title' }, layer.name),
        h('span', { class: 'item__sub' },
          [LAYER_LABELS[layer.type], layer.effects.length
            ? `${layer.effects.length} effect${layer.effects.length > 1 ? 's' : ''}` : null]
            .filter(Boolean).join('  /  ')),
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

    rows.append(h('div', { class: 'item-row' },
      h('div', { class: 'grow', style: { minWidth: '0' } }, select),
      visibility,
      lock,
    ));
  }
  box.append(rows);

  box.append(
    h('div', { style: { height: '18px' } }),
    h('button', {
      class: 'btn btn--bare btn--block',
      type: 'button',
      onclick: async () => {
        const name = `${TEMPLATES[project.template].label} ${new Date().toLocaleDateString()}`;
        await putStyle(toStyle(project, name));
        toast('Look saved to your styles.');
      },
    }, icon('swatches', { size: 'sm' }), 'Save this look as a style'),
  );
}

// --- Effects ---------------------------------------------------------------

function effectsTab(box, app) {
  const project = app.state.project;
  const layer = findLayer(project, app.state.selectedLayerId)
    || project.layers.find(l => l.type === 'photo');

  box.append(
    bottle('Effects', layer.name),
    h('p', { class: 'body body--tight' }, 'Applied from the top down.'),
    h('div', { style: { height: '10px' } }),
  );

  if (layer.effects.length === 0) {
    box.append(h('p', { class: 'empty' }, 'No effects on this layer yet.'));
  }

  layer.effects.forEach((effect, index) => {
    const spec = EFFECTS[effect.type];
    if (!spec) return;

    const controls = h('div', { class: 'stack' });
    for (const [key, def] of Object.entries(spec.params)) {
      const current = effect.params[key] ?? def.default;
      controls.append(sliderRow({
        label: def.label,
        min: def.min,
        max: def.max,
        step: def.step,
        value: current,
        format: value => (def.step < 1 ? value.toFixed(2) : String(value)),
        onInput: value => {
          effect.params[key] = value;
          app.save();
          drawOnce(app);
        },
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

    box.append(h('div', { class: 'effect' },
      h('div', { class: 'effect__head' },
        h('span', { class: 'effect__name' }, spec.label),
        iconButton('caret-up', `Move ${spec.label} earlier`, () => move(-1)),
        iconButton('caret-down', `Move ${spec.label} later`, () => move(1)),
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

  const adders = h('div', { class: 'choices' });
  for (const [type, spec] of Object.entries(EFFECTS)) {
    adders.append(h('button', {
      type: 'button',
      onclick: () => {
        layer.effects.push(makeEffect(type));
        app.save();
        buildSheet(app);
        drawOnce(app);
      },
    }, spec.label));
  }
  box.append(bottle('Add'), adders);
}

// --- Animation -------------------------------------------------------------

function animationTab(box, app) {
  const project = app.state.project;
  const disc = project.layers.find(l => l.type === 'disc');
  const bar = project.layers.find(l => l.type === 'progressBar');

  const loopNote = h('p', { class: 'body body--tight' });
  const showLoopNote = () => {
    const seconds = project.loopSeconds;
    loopNote.textContent = seconds > 60
      ? `${Math.round(seconds * FPS)} frames. Longer than a minute is a Reel, `
        + 'not a carousel slide, and the file will be large.'
      : `${Math.round(seconds * FPS)} frames at ${FPS} a second.`;
  };
  showLoopNote();

  box.append(
    bottle('Loop', `${project.loopSeconds.toFixed(1)}s`),
    sliderRow({
      label: 'Length',
      min: LOOP_MIN, max: LOOP_MAX, step: 1,
      value: project.loopSeconds,
      format: value => `${value}s`,
      onInput: value => {
        project.loopSeconds = value;
        app.save();
        buildSheet(app);
        drawOnce(app);
      },
    }),
    loopNote,
  );

  if (disc) {
    const readout = h('p', { class: 'body body--tight' });
    const showTurns = () => {
      const real = actualRpm(disc.props.rpm, project.loopSeconds);
      readout.textContent =
        `Rounded to ${Math.round((real / 60) * project.loopSeconds)} whole turns, ` +
        `which is ${real.toFixed(1)} rpm. Whole turns are what let the loop close ` +
        `without a jump.`;
    };
    showTurns();

    box.append(
      h('div', { style: { height: '18px' } }),
      bottle('Record', `${Math.round(actualRpm(disc.props.rpm, project.loopSeconds))} rpm`),
      sliderRow({
        label: 'Speed',
        min: 8, max: 90, step: 1,
        value: disc.props.rpm,
        format: value => `${value} rpm`,
        onInput: value => {
          disc.props.rpm = value;
          showTurns();
          app.save();
          drawOnce(app);
        },
      }),
      readout,
      segmented([
        { value: 1, label: 'Clockwise' },
        { value: -1, label: 'Anticlockwise' },
      ], disc.props.direction, value => {
        disc.props.direction = value;
        app.save();
        buildSheet(app);
        drawOnce(app);
      }, 'Direction'),
    );
  }

  if (bar) {
    box.append(
      h('div', { style: { height: '18px' } }),
      bottle('Progress bar'),
      segmented([
        { value: 1, label: 'Real time' },
        { value: 4, label: '4 times' },
        { value: 12, label: '12 times' },
      ], bar.props.speed, value => {
        bar.props.speed = value;
        app.save();
        buildSheet(app);
        drawOnce(app);
      }, 'Progress speed'),
      h('p', { class: 'body body--tight' },
        'Real time matches the song. Faster makes the movement easy to see in a ' +
        'short loop.'),
    );
  }
}

// --- Song ------------------------------------------------------------------

function songTab(box, app) {
  const project = app.state.project;
  const song = project.song;
  const total = Math.max(1, Math.round((song.durationMs || 0) / 1000));

  box.append(
    bottle('Song', song.durationMs ? formatTime(song.durationMs / 1000) : null),
    h('div', { class: 'item', style: { cursor: 'default', borderTop: 'none' } },
      h('span', { class: 'item__main' },
        h('span', { class: 'item__title' }, song.title || 'No song yet'),
        h('span', { class: 'item__sub' },
          [song.artist, song.album, song.year].filter(Boolean).join('  /  ') || 'Pick one to begin'),
      ),
      song.version ? h('span', { class: 'tag' }, song.version) : null,
    ),
  );

  if (song.title) {
    box.append(sliderRow({
      label: 'Clip starts at',
      min: 0, max: Math.max(1, total - 1), step: 1,
      value: Math.min(song.clipStartSeconds, total - 1),
      format: value => `${formatTime(value)} of ${formatTime(total)}`,
      onInput: value => {
        song.clipStartSeconds = value;
        app.save();
        drawOnce(app);
      },
    }));
  }

  box.append(
    h('div', { style: { height: '14px' } }),
    h('button', {
      class: 'btn btn--bare btn--block',
      type: 'button',
      onclick: () => app.go('song'),
    }, icon('magnifying-glass', { size: 'sm' }), song.title ? 'Change the song' : 'Find the song'),
  );
}

// ---------------------------------------------------------------------------
// The template switcher, which lives in the top bar
// ---------------------------------------------------------------------------

export function templateSwitcher(app) {
  const switcher = segmented(
    Object.values(TEMPLATES).map(t => ({ value: t.id, label: t.label })),
    app.state.project.template,
    value => {
      applyTemplate(app.state.project, value);
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
