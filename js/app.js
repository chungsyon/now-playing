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

const app = {
  state,
  go,
  save: debounce(saveNow, 700),
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

function go(name) {
  const leaving = SCREENS[state.screen];
  if (leaving && leaving.leave) leaving.leave();

  state.screen = name;
  buildTopbar();

  clear(screenRoot);
  screenRoot.classList.remove('is-entering', 'screen--editor');
  // Restart the fade so every screen change reads as a cut.
  void screenRoot.offsetWidth;
  screenRoot.classList.add('is-entering');

  SCREENS[name].enter(screenRoot, app);
  window.scrollTo(0, 0);
}

function buildTopbar() {
  clear(topbar);
  if (state.screen === 'home') {
    topbar.hidden = true;
    return;
  }
  topbar.hidden = false;

  const back = iconButton('arrow-left', 'Go back', () => {
    if (state.screen === 'song') go(state.project && state.project.song.title ? 'editor' : 'home');
    else if (state.screen === 'editor') go('home');
    else go('editor');
  });

  if (state.screen === 'editor') {
    topbar.append(
      back,
      h('div', { class: 'grow', style: { display: 'flex', justifyContent: 'center' } },
        editor.templateSwitcher(app)),
      h('button', {
        class: 'btn',
        type: 'button',
        style: { minHeight: '44px', padding: '9px 14px' },
        onclick: () => go('exportScreen'),
      }, 'Export'),
    );
  } else {
    const titles = { song: 'Song', exportScreen: 'Export' };
    topbar.append(
      back,
      h('div', { class: 'topbar__title' }, titles[state.screen] || ''),
      h('div', { style: { width: '44px' } }),
    );
  }
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

    state.project = createProject({ aspect: aspectFor(image) });
    state.photoPalette = extractPalette(image, 5);
    state.project.palette = state.photoPalette.slice();

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

  await loadIcons();
  // Text is measured during rendering, so the fonts have to be there first.
  if (document.fonts && document.fonts.ready) {
    try { await document.fonts.ready; } catch { /* carry on with fallbacks */ }
  }

  go('home');
  document.body.classList.add('is-ready');

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch(error => {
        console.warn('Offline support is unavailable:', error);
      });
    });
  }

  // Do not lose work if the app is closed mid-edit.
  window.addEventListener('pagehide', () => { app.save.flush(); });
}

boot();
