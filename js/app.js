/**
 * THE APP
 * -------
 * Holds the current project, moves between the four screens, and saves to the
 * device. Every screen is handed this object and asks it to do anything that
 * outlives the screen.
 */

import { h, clear, icon, iconButton, toast, decodeImage } from './ui.js';
import { ASPECTS, createProject, newId, applyTemplate } from './model.js';
import { extractPalette, dedupeHex } from './color.js';
import { putDraft, getDraft, debounce } from './db.js';
import { fitToSlide } from './gestures.js';

import * as home from './screens/home.js';
import * as song from './screens/song.js';
import * as editor from './screens/editor.js';
import * as exportScreen from './screens/exportscreen.js';

const SCREENS = { home, song, editor, exportScreen };

const state = {
  screen: 'home',
  draftId: null,
  project: null,
  media: { photo: null, cover: null },   // decoded, for drawing
  blobs: { photo: null, cover: null },   // the originals, for saving
  selectedLayerId: null,
  previewTime: 0,
  photoPalette: [],
  aspectPreference: 'photo',
  customHeight: 1350,
  lastQuery: '',
};

// ---------------------------------------------------------------------------
// Undo and redo
// ---------------------------------------------------------------------------
// The project is plain JSON, so a step in the history is just a copy of it.
// A copy is taken once things have been still for a moment, which makes one
// drag, one slider pull or a burst of arrow keys a single step.

const HISTORY_LIMIT = 100;
let past = [];
let future = [];

function snapshot() {
  return JSON.stringify(state.project);
}

/** Start a fresh history for the project that has just been opened. */
function resetHistory() {
  past = state.project ? [snapshot()] : [];
  future = [];
  syncHistoryButtons();
}

const checkpoint = debounce(() => {
  if (!state.project) return;
  const now = snapshot();
  if (now === past[past.length - 1]) return;
  past.push(now);
  if (past.length > HISTORY_LIMIT) past.shift();
  future = [];
  syncHistoryButtons();
}, 400);

function restore(json) {
  state.project = JSON.parse(json);
  if (!state.project.layers.some(l => l.id === state.selectedLayerId)) state.selectedLayerId = null;
  state.previewTime = Math.min(state.previewTime || 0, state.project.loopSeconds);
  buildTopbar();
  if (state.screen === 'editor') editor.rebuild(app);
  else go(state.screen);
  saveNow();
}

function undo() {
  checkpoint.flush();              // a change still settling is a step too
  if (past.length < 2) return;
  future.push(past.pop());
  restore(past[past.length - 1]);
  syncHistoryButtons();
}

function redo() {
  checkpoint.flush();
  if (!future.length) return;
  const next = future.pop();
  past.push(next);
  restore(next);
  syncHistoryButtons();
}

let undoButton = null;
let redoButton = null;
function syncHistoryButtons() {
  if (undoButton) undoButton.disabled = past.length < 2;
  if (redoButton) redoButton.disabled = future.length === 0;
}

const saveSoon = debounce(saveNow, 700);
/** Every change goes through here: saved to the device, and into the history. */
function save() {
  saveSoon();
  checkpoint();
}
save.flush = () => {
  checkpoint.flush();
  return saveSoon.flush();
};

const app = {
  state,
  go,
  save,
  undo,
  redo,
  saveNow,
  startWithPhoto,
  openDraft,
  startFromStyle,
  setCover,
  toast,
};

let screenRoot = null;
let topbar = null;

// ---------------------------------------------------------------------------
// Moving between screens
// ---------------------------------------------------------------------------

// The order of the stack. Moving to a later screen pushes, an earlier one pops.
const ORDER = ['home', 'song', 'editor', 'exportScreen'];
const TITLES = { home: 'Now Playing', song: 'Song', editor: 'Editor', exportScreen: 'Export' };

let updateWaiting = false;
let reloading = false;
async function reloadForUpdate() {
  if (reloading) return;
  reloading = true;
  // The save is finished before the page goes, so nothing is lost with it.
  try { await app.save.flush(); } catch { /* reload regardless */ }
  window.location.reload();
}

function go(name) {
  if (updateWaiting && name === 'home') {
    reloadForUpdate();
    return;
  }
  const leaving = SCREENS[state.screen];
  if (leaving && leaving.leave) leaving.leave();

  const direction = ORDER.indexOf(name) >= ORDER.indexOf(state.screen) ? 'is-push' : 'is-pop';
  state.screen = name;
  buildTopbar();

  clear(screenRoot);
  screenRoot.classList.remove('is-push', 'is-pop', 'screen--editor');
  // Restart the animation so every screen change plays it.
  void screenRoot.offsetWidth;
  screenRoot.classList.add(direction);

  SCREENS[name].enter(screenRoot, app);
  screenRoot.scrollTop = 0;
  syncTopbar();
}

/** Where the back button goes from here. */
function backTarget() {
  if (state.screen === 'song') return state.project && state.project.song.title ? 'editor' : 'home';
  if (state.screen === 'editor') return 'home';
  return 'editor';
}

function buildTopbar() {
  clear(topbar);
  const left = h('div', { class: 'topbar__left' });
  const right = h('div', { class: 'topbar__right' });
  let middle = h('div', { class: 'topbar__title' }, TITLES[state.screen]);

  if (state.screen !== 'home') {
    const target = backTarget();
    left.append(h('button', {
      class: 'btn btn--back',
      type: 'button',
      'aria-label': `Back to ${TITLES[target]}`,
      onclick: () => go(target),
    }, icon('caret-left'),
    // The editor's bar is busy, so its back button is the chevron alone.
    state.screen === 'editor' ? null : h('span', {}, TITLES[target])));
  }

  undoButton = null;
  redoButton = null;
  if (state.screen === 'editor') {
    // Undo and redo sit by the back button, where a thumb already is.
    undoButton = iconButton('arrow-u-up-left', 'Undo', undo);
    redoButton = iconButton('arrow-u-up-right', 'Redo', redo);
    for (const b of [undoButton, redoButton]) b.classList.add('btn--history');
    left.append(undoButton, redoButton);
    syncHistoryButtons();
    middle = editor.templateSwitcher(app);
    middle.style.minWidth = '150px';
    right.append(h('button', {
      class: 'btn btn--primary btn--small',
      type: 'button',
      onclick: () => go('exportScreen'),
    }, 'Export'));
  }

  topbar.append(left, middle, right);
}

/**
 * The bar becomes a material once something has scrolled under it, and its
 * small title appears as the page's large one goes. The editor never
 * scrolls, so its bar is always solid.
 */
function syncTopbar() {
  topbar.classList.toggle('is-scrolled', state.screen === 'editor' || screenRoot.scrollTop > 30);
}

// ---------------------------------------------------------------------------
// Starting and loading work
// ---------------------------------------------------------------------------

/** H.264 needs both sides to be even numbers. */
const even = n => Math.round(n / 2) * 2;

function aspectFor(image) {
  const preference = state.aspectPreference;
  if (preference === 'custom') {
    return { id: 'custom', w: 1080, h: even(Math.min(1920, Math.max(600, state.customHeight))) };
  }
  const named = ASPECTS.find(a => a.id === preference);
  if (named) return { ...named };
  if (!image) return { ...ASPECTS[1] };
  const height = even(Math.min(1920, Math.max(600, 1080 * (image.height / image.width))));
  return { id: 'photo', w: 1080, h: height };
}

async function startWithPhoto(file) {
  try {
    const image = await decodeImage(file);
    state.draftId = newId('d');
    state.blobs = { photo: file, cover: null };
    state.media = { photo: image, cover: null };
    state.selectedLayerId = null;
    state.previewTime = 0;

    state.project = fitToSlide(createProject({ aspect: aspectFor(image) }));
    state.photoPalette = extractPalette(image, 5);
    state.project.palette = state.photoPalette.slice();
    resetHistory();

    await saveNow();
    go('song');
  } catch (error) {
    console.error(error);
    toast('That photo didn\'t come through. Try another one.');
  }
}

async function startFromStyle(style) {
  // A style has no photo, so this is the same flow as starting fresh, with the
  // look already in place.
  const fileInput = h('input', { type: 'file', accept: 'image/*', hidden: true });
  document.body.append(fileInput);
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files && fileInput.files[0];
    fileInput.remove();
    if (!file) return;
    await startWithPhoto(file);
    if (!state.project) return;
    const kept = state.project.song;
    const aspect = state.project.aspect;
    const palette = state.project.palette;
    state.project = structuredClone(style.project);
    state.project.song = kept;
    state.project.aspect = aspect;
    state.project.palette = palette;
    // The style may have been made on a different shape of slide.
    fitToSlide(state.project, style.project.layoutAspect || style.project.aspect);
    resetHistory();
    await saveNow();
    go('song');
  }, { once: true });
  fileInput.click();
}

async function openDraft(id) {
  const draft = await getDraft(id);
  if (!draft) {
    toast('That draft is no longer here.');
    return;
  }
  state.draftId = draft.id;
  state.project = draft.project;
  state.blobs = { photo: draft.photo || null, cover: draft.cover || null };
  state.media = {
    photo: await decodeImage(draft.photo),
    cover: await decodeImage(draft.cover),
  };
  state.selectedLayerId = null;
  state.previewTime = 0;
  state.photoPalette = state.media.photo ? extractPalette(state.media.photo, 5) : [];
  refreshPalette();
  resetHistory();
  go('editor');
}

/**
 * The colours offered for the record label and the flat background.
 * The cover leads, because that is the record's own colour. The photo's
 * colours follow it, so a black-and-white sleeve still leaves a choice.
 */
function refreshPalette() {
  if (!state.project) return;
  const fromCover = state.media.cover ? extractPalette(state.media.cover, 5) : [];
  state.project.palette = dedupeHex([...fromCover, ...state.photoPalette]);
}

async function setCover(blob) {
  state.blobs.cover = blob;
  state.media.cover = await decodeImage(blob);
  refreshPalette();
  await saveNow();
  // The cover image is not part of the history, so a step from before it
  // changed would bring back the old song with the new cover. A new cover
  // starts the history again instead.
  resetHistory();
  if (state.screen === 'editor') editor.redraw(app);
}

async function saveNow() {
  if (!state.project || !state.draftId) return;
  try {
    await putDraft({
      id: state.draftId,
      project: state.project,
      photo: state.blobs.photo,
      cover: state.blobs.cover,
    });
  } catch (error) {
    console.warn('Could not save this draft:', error);
  }
}

// ---------------------------------------------------------------------------
// Start up
// ---------------------------------------------------------------------------

async function loadIcons() {
  try {
    const response = await fetch('assets/icons.svg');
    const markup = await response.text();
    const holder = document.createElement('div');
    holder.innerHTML = markup;
    holder.style.display = 'none';
    document.body.prepend(holder);
  } catch (error) {
    console.warn('Icons could not be loaded:', error);
  }
}

async function boot() {
  screenRoot = document.getElementById('screen');
  topbar = document.getElementById('topbar');

  screenRoot.addEventListener('scroll', syncTopbar, { passive: true });
  // Without a touch listener somewhere, iOS Safari never applies :active, and
  // buttons would only respond once the finger lifts.
  document.addEventListener('touchstart', () => {}, { passive: true });

  await loadIcons();
  // Text on the slide is measured during rendering, so its faces have to be
  // there first. The interface uses the system font, so nothing on screen
  // asks for them: they are loaded by name.
  if (document.fonts) {
    try {
      await Promise.all([
        '16px "DM Sans"', '16px "Instrument Serif"',
        'italic 16px "Instrument Serif"', '16px "JetBrains Mono"',
      ].map(face => document.fonts.load(face)));
    } catch { /* carry on with fallbacks */ }
  }

  go('home');
  document.body.classList.add('is-ready');

  // Registered straight away, not on the window's load event: this function
  // waits for the icons and the fonts first, and by then load has usually
  // already fired, so a listener added here would never run.
  if ('serviceWorker' in navigator) {
    // When an update takes over, reload once so the new version is what
    // shows, rather than the old one until the app is opened again. Not on
    // the very first install, when there was nothing old to replace.
    if (navigator.serviceWorker.controller) {
      // Only from Home, where nothing is being edited or rendered. Opening
      // the app lands there, which is when updates arrive; one that arrives
      // mid-edit waits until you are back.
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        updateWaiting = true;
        if (state.screen === 'home') reloadForUpdate();
      });
    }
    navigator.serviceWorker.register('sw.js').catch(error => {
      console.warn('Offline support is unavailable:', error);
    });
  }

  // ⌘Z / Ctrl+Z undoes, ⇧⌘Z or Ctrl+Y redoes. Inside a text field the
  // field keeps them, for undoing typing.
  window.addEventListener('keydown', event => {
    // Only in the editor: elsewhere there is nothing on screen to undo, and
    // on Export it would throw away a finished render.
    if (!(event.metaKey || event.ctrlKey) || !state.project || state.screen !== 'editor') return;
    const target = event.target;
    if (target && /^(INPUT|TEXTAREA)$/.test(target.tagName) && target.type !== 'range'
      && target.type !== 'checkbox') return;
    const key = event.key.toLowerCase();
    if (key === 'z' && !event.shiftKey) { event.preventDefault(); undo(); }
    else if ((key === 'z' && event.shiftKey) || key === 'y') { event.preventDefault(); redo(); }
  });

  // Do not lose work if the app is closed mid-edit.
  window.addEventListener('pagehide', () => { app.save.flush(); });
}

boot();
